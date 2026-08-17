import { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { client } from '../lib/api';
import {
  useProspects, useCityAttributions, useRegisteredUsers,
  useInvalidateProspects, useInvalidateActions,
  queryKeys, type Prospect,
} from '../hooks/use-prospects';
import ErrorState from '../components/ErrorState';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Video, FileUp, FileCheck2, XCircle, CalendarClock, Phone,
  MapPin, Building2, User, UserCircle, History, Sun, Clock,
  Rabbit, Bell, Users,
} from 'lucide-react';
import { usePersistentState } from '../hooks/use-persistent-state';
import { useAuth } from '../contexts/AuthContext';

const toLocalInputValue = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Rappel de confirmation automatique programmé 48h avant (J-2) une visio (violet) —
// null si le rendez-vous est déjà à moins de 24h (pas de sens à programmer un
// rappel dans le passé). Même logique que ProspectDetail.tsx / SpeedRun.tsx :
// dupliquée ici car ce fichier gère aussi le "rattrapage" de visios déjà
// planifiées avant l'existence de ce marquage.
function computeVisioReminder(dateVisioIso: string): { date_relance_planifiee: string; type_relance_planifiee: string } | null {
  const visio = new Date(dateVisioIso);
  const reminder = new Date(visio.getTime() - 48 * 60 * 60 * 1000);
  if (reminder.getTime() <= Date.now()) return null;
  return { date_relance_planifiee: reminder.toISOString(), type_relance_planifiee: 'confirmation_visio' };
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const endOfToday = () => { const d = startOfToday(); d.setDate(d.getDate() + 1); return d; };

type VisioTab = 'passe' | 'aujourdhui' | 'bientot';
type ViewMode = 'commercial' | 'global';

// Classe une visio dans un des 3 onglets selon sa date. Sans date_visio, on
// la range en "Passé" (comportement historique : ne rien perdre, ça remonte
// pour qu'on la traite).
function bucketOf(p: Prospect): VisioTab {
  if (!p.date_visio) return 'passe';
  const d = new Date(p.date_visio);
  if (d < startOfToday()) return 'passe';
  if (d < endOfToday()) return 'aujourdhui';
  return 'bientot';
}

export default function VisiosPassees() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { userRole } = useAuth();
  const { data: allProspects = [], isLoading: loadingP, error: errorP, refetch: refetchP, isFetching: fetchingP } = useProspects();
  const { data: cityAttributions = [] } = useCityAttributions();
  const { data: registeredUsers = [] } = useRegisteredUsers();
  const invalidateProspects = useInvalidateProspects();
  const invalidateActions = useInvalidateActions();

  const [busyId, setBusyId] = useState<number | null>(null);
  const [relanceTarget, setRelanceTarget] = useState<Prospect | null>(null);
  const [relanceDateTime, setRelanceDateTime] = useState('');
  const [selectedCommercial, setSelectedCommercial] = usePersistentState<string>('lyftt.visios.commercial', 'tous');
  const [tab, setTab] = usePersistentState<VisioTab>('lyftt.visios.tab', 'passe');
  const [viewMode, setViewMode] = usePersistentState<ViewMode>('lyftt.visios.viewMode', 'commercial');

  // Une ville n'est attribuée qu'à un seul commercial (l'écran Attributions
  // empêche l'attribution d'une ville déjà prise) : mapping direct ville -> nom.
  const cityToCommercial = useMemo(() => {
    const userNameById = new Map<number, string>();
    for (const u of registeredUsers) {
      const name = `${u.first_name || ''} ${u.last_name || ''}`.trim();
      if (name) userNameById.set(u.id, name);
    }
    const map = new Map<string, string>();
    for (const a of cityAttributions) {
      const name = userNameById.get(a.user_role_id);
      if (name) map.set(a.city, name);
    }
    return map;
  }, [registeredUsers, cityAttributions]);

  const commercialOf = useCallback(
    (p: Prospect) => cityToCommercial.get(p.zone_geographique?.trim() || '') || 'Non attribué',
    [cityToCommercial]
  );

  // Toutes les visios en cours (statut encore "Visio", dossier actif), tous
  // onglets confondus — sert de base aux 3 listes et au filtre commercial.
  const visiosEnCours = useMemo(
    () => allProspects.filter((p) => p.statut_avancement === 'Visio' && p.statut_gagne_perdu === 'actif'),
    [allProspects]
  );

  const visiosByTab = useMemo(() => {
    const m: Record<VisioTab, Prospect[]> = { passe: [], aujourdhui: [], bientot: [] };
    for (const p of visiosEnCours) m[bucketOf(p)].push(p);
    return m;
  }, [visiosEnCours]);

  // Liste des commerciaux pour le filtre — sur l'ensemble des visios (pas
  // seulement l'onglet actif), pour que le menu ne change pas de contenu en
  // changeant d'onglet.
  const commercialFilterOptions = useMemo(() => {
    const set = new Set(visiosEnCours.map(commercialOf));
    return Array.from(set).sort((a, b) => a === 'Non attribué' ? 1 : b === 'Non attribué' ? -1 : a.localeCompare(b, 'fr'));
  }, [visiosEnCours, commercialOf]);

  const currentList = useMemo(() => {
    const list = visiosByTab[tab];
    if (selectedCommercial === 'tous') return list;
    return list.filter((p) => commercialOf(p) === selectedCommercial);
  }, [visiosByTab, tab, selectedCommercial, commercialOf]);

  const byDate = (a: Prospect, b: Prospect) =>
    (a.date_visio ? new Date(a.date_visio).getTime() : 0) - (b.date_visio ? new Date(b.date_visio).getTime() : 0);

  // Vue "Par commercial" : groupée en sections, comme avant.
  const groupedForTab = useMemo(() => {
    const map = new Map<string, Prospect[]>();
    for (const p of currentList) {
      const commercial = commercialOf(p);
      const arr = map.get(commercial) || [];
      arr.push(p);
      map.set(commercial, arr);
    }
    for (const arr of map.values()) arr.sort(byDate);
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Non attribué') return 1;
      if (b === 'Non attribué') return -1;
      return a.localeCompare(b, 'fr');
    });
  }, [currentList, commercialOf]);

  // Vue "Global" : une seule liste triée par date, tous commerciaux mélangés
  // (le nom du commercial est alors affiché sur chaque carte).
  const globalListForTab = useMemo(() => [...currentList].sort(byDate), [currentList]);

  const updateProspectOptimistic = useCallback((id: number, updates: Partial<Prospect>) => {
    queryClient.setQueryData(queryKeys.prospects, (old: Prospect[] | undefined) =>
      (old || []).map((p) => p.id === id ? { ...p, ...updates } : p)
    );
  }, [queryClient]);

  // Action générique : fait avancer le statut (journalisée dans commercial_actions,
  // identique au comportement de la fiche prospect) — utilisée pour Demande de
  // documents / Documents reçus (Signature) / Refus.
  const handleStatusAction = useCallback(async (prospect: Prospect, newStatus: string, extraDateField?: 'date_demande_documents' | 'date_signature') => {
    setBusyId(prospect.id);
    const nowIso = new Date().toISOString();
    const updates: Record<string, unknown> = { statut_avancement: newStatus };
    if (extraDateField) updates[extraDateField] = nowIso;
    if (newStatus === 'Signature') updates.statut_gagne_perdu = 'gagne';
    else if (newStatus === 'Refus / Perdu') updates.statut_gagne_perdu = 'perdu';
    // Commercial signataire (partie 18) : figé à la première Signature, même
    // règle que sur la fiche prospect — sans ça, le dossier reste invisible
    // dans tout le module Performance CA (CA, commissions, classement).
    if (newStatus === 'Signature' && !prospect.signed_by_user_id && userRole?.id) {
      updates.signed_by_user_id = userRole.id;
    }

    updateProspectOptimistic(prospect.id, updates as Partial<Prospect>);
    try {
      await client.entities.prospects.update({ id: String(prospect.id), data: updates });
      await client.entities.commercial_actions.create({
        data: {
          prospect_id: prospect.id, action_type: 'status_change', appel_repondu: false,
          from_status: prospect.statut_avancement, to_status: newStatus,
          notes: `Depuis "Mes visios" : "${prospect.statut_avancement}" → "${newStatus}"`,
          action_date: nowIso,
        },
      });
      invalidateActions(prospect.id);
      if (newStatus === 'Signature') toast.success('🚀 Signature obtenue !');
      else if (newStatus === 'Refus / Perdu') toast.success('Prospect classé en refus');
      else toast.success(`Statut : ${newStatus}`);
    } catch {
      invalidateProspects();
      toast.error('Erreur lors de la mise à jour');
    } finally {
      setBusyId(null);
    }
  }, [updateProspectOptimistic, invalidateProspects, invalidateActions, userRole]);

  const openRelanceDialog = useCallback((prospect: Prospect) => {
    setRelanceTarget(prospect);
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    setRelanceDateTime(toLocalInputValue(d));
  }, []);

  const handleConfirmRelance = useCallback(async () => {
    if (!relanceTarget || !relanceDateTime) return;
    const prospect = relanceTarget;
    const iso = new Date(relanceDateTime).toISOString();
    setBusyId(prospect.id);
    const patch = { date_relance_planifiee: iso, type_relance_planifiee: null as string | null };
    updateProspectOptimistic(prospect.id, patch);
    try {
      await client.entities.prospects.update({ id: String(prospect.id), data: patch });
      await client.entities.commercial_actions.create({
        data: {
          prospect_id: prospect.id, action_type: 'relance_planifiee', appel_repondu: false,
          from_status: prospect.statut_avancement, to_status: prospect.statut_avancement,
          notes: `Relance planifiée depuis "Mes visios" le ${new Date(iso).toLocaleString('fr-FR')}`,
          action_date: new Date().toISOString(),
        },
      });
      invalidateActions(prospect.id);
      toast.success('📅 Relance planifiée');
      setRelanceTarget(null);
      setRelanceDateTime('');
    } catch {
      invalidateProspects();
      toast.error('Erreur lors de la planification');
    } finally {
      setBusyId(null);
    }
  }, [relanceTarget, relanceDateTime, updateProspectOptimistic, invalidateProspects, invalidateActions]);

  // "Lapin" (onglet Aujourd'hui uniquement) : le prospect n'est pas venu à sa
  // visio. Reprogramme automatiquement une relance le lendemain 9h, marquée
  // 'lapin' (couleur ambre dédiée sur le Dashboard) — aucune saisie requise.
  const handleLapin = useCallback(async (prospect: Prospect) => {
    setBusyId(prospect.id);
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    const iso = d.toISOString();
    const patch = { date_relance_planifiee: iso, type_relance_planifiee: 'lapin' };
    updateProspectOptimistic(prospect.id, patch);
    try {
      await client.entities.prospects.update({ id: String(prospect.id), data: patch });
      await client.entities.commercial_actions.create({
        data: {
          prospect_id: prospect.id, action_type: 'relance_planifiee', appel_repondu: false,
          from_status: prospect.statut_avancement, to_status: prospect.statut_avancement,
          notes: `Lapin posé — relance reprogrammée automatiquement le ${new Date(iso).toLocaleString('fr-FR')} (Mes visios)`,
          action_date: new Date().toISOString(),
        },
      });
      invalidateActions(prospect.id);
      toast.success('🐇 Lapin noté — relance programmée demain 9h');
    } catch {
      invalidateProspects();
      toast.error('Erreur lors de la mise à jour');
    } finally {
      setBusyId(null);
    }
  }, [updateProspectOptimistic, invalidateProspects, invalidateActions]);

  // "Programmer le rappel J-1" (onglet Bientôt) : rattrapage pour les visios
  // déjà planifiées avant que le rappel automatique n'existe, ou dont la
  // relance a été effacée manuellement.
  const handleScheduleReminder = useCallback(async (prospect: Prospect) => {
    if (!prospect.date_visio) return;
    const reminder = computeVisioReminder(prospect.date_visio);
    if (!reminder) return;
    setBusyId(prospect.id);
    updateProspectOptimistic(prospect.id, reminder);
    try {
      await client.entities.prospects.update({ id: String(prospect.id), data: reminder });
      await client.entities.commercial_actions.create({
        data: {
          prospect_id: prospect.id, action_type: 'relance_planifiee', appel_repondu: false,
          from_status: prospect.statut_avancement, to_status: prospect.statut_avancement,
          notes: `Rappel de confirmation visio programmé le ${new Date(reminder.date_relance_planifiee).toLocaleString('fr-FR')} (Mes visios)`,
          action_date: new Date().toISOString(),
        },
      });
      invalidateActions(prospect.id);
      toast.success('🔔 Rappel de confirmation programmé');
    } catch {
      invalidateProspects();
      toast.error('Erreur lors de la planification');
    } finally {
      setBusyId(null);
    }
  }, [updateProspectOptimistic, invalidateProspects, invalidateActions]);

  const loading = loadingP;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-[#6AABB4] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Chargement des visios...</p>
        </div>
      </div>
    );
  }

  if (errorP) {
    return <ErrorState message="Impossible de charger les visios." onRetry={refetchP} retrying={fetchingP} />;
  }

  const TABS: { key: VisioTab; label: string; icon: typeof History }[] = [
    { key: 'passe', label: 'Passé', icon: History },
    { key: 'aujourdhui', label: "Aujourd'hui", icon: Sun },
    { key: 'bientot', label: 'Bientôt', icon: Clock },
  ];

  const renderCard = (p: Prospect) => (
    <VisioCard
      key={p.id}
      prospect={p}
      busy={busyId === p.id}
      commercialBadge={viewMode === 'global' ? commercialOf(p) : null}
      onOpen={() => navigate(`/prospects/${p.id}`)}
      onDemandeDocuments={() => handleStatusAction(p, 'Demande de documents', 'date_demande_documents')}
      onDocumentsRecus={() => handleStatusAction(p, 'Signature', 'date_signature')}
      onRelance={() => openRelanceDialog(p)}
      onRefus={() => handleStatusAction(p, 'Refus / Perdu')}
      showLapin={tab === 'aujourdhui'}
      onLapin={() => handleLapin(p)}
      showScheduleReminder={tab === 'bientot' && !p.date_relance_planifiee && !!p.date_visio && !!computeVisioReminder(p.date_visio)}
      onScheduleReminder={() => handleScheduleReminder(p)}
    />
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Video className="w-6 h-6 text-purple-600" /> Mes visios
          </h1>
          <p className="text-slate-500 mt-1">
            {currentList.length} visio{currentList.length > 1 ? 's' : ''} {tab === 'passe' ? 'en attente de suite' : tab === 'aujourdhui' ? "aujourd'hui" : 'à venir'}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Toggle Par commercial / Global */}
          <div className="flex items-center rounded-xl border border-slate-200 bg-white shadow-sm p-0.5">
            <button
              onClick={() => setViewMode('commercial')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${viewMode === 'commercial' ? 'bg-[#6AABB4] text-white' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <UserCircle className="w-3.5 h-3.5" /> Par commercial
            </button>
            <button
              onClick={() => setViewMode('global')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${viewMode === 'global' ? 'bg-[#6AABB4] text-white' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Users className="w-3.5 h-3.5" /> Global
            </button>
          </div>
          {commercialFilterOptions.length > 1 && (
            <Select value={selectedCommercial} onValueChange={setSelectedCommercial}>
              <SelectTrigger className="w-56 rounded-xl border-slate-200 bg-white shadow-sm">
                <UserCircle className="w-4 h-4 mr-2 text-[#6AABB4]" />
                <SelectValue placeholder="Filtrer par commercial" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">🌐 Tous les commerciaux</SelectItem>
                {commercialFilterOptions.map((name) => (
                  <SelectItem key={name} value={name}>👤 {name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Onglets Passé / Aujourd'hui / Bientôt */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        {TABS.map(({ key, label, icon: Icon }) => {
          const count = selectedCommercial === 'tous' ? visiosByTab[key].length : visiosByTab[key].filter((p) => commercialOf(p) === selectedCommercial).length;
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold border-b-2 transition-colors -mb-px ${
                active ? 'border-[#6AABB4] text-[#5A9BA3]' : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
              <Badge className={`rounded-lg text-[10px] font-bold ${active ? 'bg-[#6AABB4]/10 text-[#5A9BA3] border-[#6AABB4]/20' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>{count}</Badge>
            </button>
          );
        })}
      </div>

      {currentList.length === 0 ? (
        <Card className="border-0 shadow-sm rounded-2xl">
          <CardContent className="py-16 text-center">
            <div className="w-14 h-14 bg-purple-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Video className="w-6 h-6 text-purple-400" />
            </div>
            <p className="text-sm text-slate-400">
              {tab === 'passe' ? 'Aucune visio en attente de suite pour le moment.' : tab === 'aujourdhui' ? "Aucune visio aujourd'hui." : 'Aucune visio à venir.'}
            </p>
          </CardContent>
        </Card>
      ) : viewMode === 'global' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {globalListForTab.map(renderCard)}
        </div>
      ) : (
        <div className="space-y-8">
          {groupedForTab.map(([commercial, prospects]) => (
            <div key={commercial}>
              <div className="flex items-center gap-2 mb-3">
                <UserCircle className="w-5 h-5 text-[#5A9BA3]" />
                <h2 className="text-lg font-semibold text-slate-900">{commercial}</h2>
                <Badge className="bg-purple-50 text-purple-700 border-purple-200 rounded-lg text-xs font-bold">{prospects.length}</Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {prospects.map(renderCard)}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!relanceTarget} onOpenChange={(open) => { if (!open) { setRelanceTarget(null); setRelanceDateTime(''); } }}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Planifier une relance</DialogTitle>
          </DialogHeader>
          {relanceTarget && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">{relanceTarget.nom_societe}</p>
              <div className="space-y-1.5">
                <Label>Date et heure</Label>
                <Input type="datetime-local" value={relanceDateTime} onChange={(e) => setRelanceDateTime(e.target.value)} className="rounded-xl" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRelanceTarget(null); setRelanceDateTime(''); }} className="rounded-xl">Annuler</Button>
            <Button
              onClick={handleConfirmRelance}
              disabled={!relanceDateTime || busyId === relanceTarget?.id}
              className="rounded-xl bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] hover:from-[#4A8B93] hover:to-[#5A9BA4] text-white gap-1.5"
            >
              <CalendarClock className="w-4 h-4" /> Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VisioCard({
  prospect: p, busy, commercialBadge, onOpen, onDemandeDocuments, onDocumentsRecus, onRelance, onRefus,
  showLapin, onLapin, showScheduleReminder, onScheduleReminder,
}: {
  prospect: Prospect; busy: boolean; commercialBadge: string | null; onOpen: () => void;
  onDemandeDocuments: () => void; onDocumentsRecus: () => void; onRelance: () => void; onRefus: () => void;
  showLapin: boolean; onLapin: () => void;
  showScheduleReminder: boolean; onScheduleReminder: () => void;
}) {
  const dateVisio = p.date_visio ? new Date(p.date_visio).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); if (!busy) fn(); };

  // Ligne d'info sur la relance déjà programmée (le cas échéant), colorée
  // selon son type — cohérent avec le Dashboard.
  const relanceInfo = p.date_relance_planifiee ? new Date(p.date_relance_planifiee).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
  const relanceColor = p.type_relance_planifiee === 'lapin' ? 'text-amber-600' : p.type_relance_planifiee === 'confirmation_visio' ? 'text-purple-600' : 'text-[#5A9BA3]';
  const relanceLabel = p.type_relance_planifiee === 'lapin' ? '🐇 Relance (lapin)' : p.type_relance_planifiee === 'confirmation_visio' ? '🔔 Rappel confirmation' : 'Relance';

  return (
    <Card
      onClick={onOpen}
      className={`border-0 shadow-sm rounded-2xl cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 ${busy ? 'opacity-60 pointer-events-none' : ''}`}
    >
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 truncate">{p.nom_societe || 'Sans nom'}</p>
            {p.nom_dirigeant && <p className="text-xs text-slate-500 truncate flex items-center gap-1 mt-0.5"><User className="w-3 h-3" /> {p.nom_dirigeant}</p>}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Badge className="bg-purple-100 text-purple-700 border-purple-200 rounded-lg text-[10px] font-bold">Visio</Badge>
            {commercialBadge && <Badge className="bg-slate-100 text-slate-600 border-slate-200 rounded-lg text-[10px] font-bold">{commercialBadge}</Badge>}
          </div>
        </div>

        <div className="space-y-1 text-xs text-slate-500">
          {dateVisio && <p className="flex items-center gap-1.5"><Video className="w-3.5 h-3.5 text-purple-500" /> RDV : {dateVisio}</p>}
          {p.telephone && <p className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {p.telephone}</p>}
          {p.zone_geographique && <p className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {p.zone_geographique}</p>}
          {p.categorie_metier && <p className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> {p.categorie_metier}</p>}
          {relanceInfo && <p className={`flex items-center gap-1.5 font-semibold ${relanceColor}`}><CalendarClock className="w-3.5 h-3.5" /> {relanceLabel} : {relanceInfo}</p>}
        </div>

        <div className="grid grid-cols-2 gap-1.5 pt-1">
          <Button size="sm" variant="outline" onClick={stop(onDemandeDocuments)} className="rounded-lg text-xs h-8 border-amber-200 text-amber-700 hover:bg-amber-50 gap-1">
            <FileUp className="w-3.5 h-3.5" /> Demande docs
          </Button>
          <Button size="sm" variant="outline" onClick={stop(onDocumentsRecus)} className="rounded-lg text-xs h-8 border-emerald-200 text-emerald-700 hover:bg-emerald-50 gap-1">
            <FileCheck2 className="w-3.5 h-3.5" /> Docs reçus
          </Button>
          <Button size="sm" variant="outline" onClick={stop(onRelance)} className="rounded-lg text-xs h-8 border-[#6AABB4]/40 text-[#5A9BA3] hover:bg-teal-50 gap-1">
            <CalendarClock className="w-3.5 h-3.5" /> Relance
          </Button>
          <Button size="sm" variant="outline" onClick={stop(onRefus)} className="rounded-lg text-xs h-8 border-red-200 text-red-600 hover:bg-red-50 gap-1">
            <XCircle className="w-3.5 h-3.5" /> Refus
          </Button>
          {showLapin && (
            <Button size="sm" variant="outline" onClick={stop(onLapin)} className="col-span-2 rounded-lg text-xs h-8 border-amber-300 text-amber-700 hover:bg-amber-50 gap-1">
              <Rabbit className="w-3.5 h-3.5" /> Lapin — reprogrammer demain 9h
            </Button>
          )}
          {showScheduleReminder && (
            <Button size="sm" variant="outline" onClick={stop(onScheduleReminder)} className="col-span-2 rounded-lg text-xs h-8 border-purple-200 text-purple-700 hover:bg-purple-50 gap-1">
              <Bell className="w-3.5 h-3.5" /> Programmer le rappel J-1
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
