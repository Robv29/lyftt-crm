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
  MapPin, Building2, User, UserCircle,
} from 'lucide-react';
import { usePersistentState } from '../hooks/use-persistent-state';

const toLocalInputValue = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function VisiosPassees() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: allProspects = [], isLoading: loadingP, error: errorP, refetch: refetchP, isFetching: fetchingP } = useProspects();
  const { data: cityAttributions = [] } = useCityAttributions();
  const { data: registeredUsers = [] } = useRegisteredUsers();
  const invalidateProspects = useInvalidateProspects();
  const invalidateActions = useInvalidateActions();

  const [busyId, setBusyId] = useState<number | null>(null);
  const [relanceTarget, setRelanceTarget] = useState<Prospect | null>(null);
  const [relanceDateTime, setRelanceDateTime] = useState('');
  const [selectedCommercial, setSelectedCommercial] = usePersistentState<string>('lyftt.visios.commercial', 'tous');

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

  // Visios "passées" = statut encore sur "Visio" (pas déjà fait avancer vers
  // Documents/Signature/Refus) ET date du RDV déjà écoulée (ou non renseignée,
  // auquel cas on la fait quand même remonter pour ne rien perdre).
  const visiosPassees = useMemo(() => {
    const now = new Date();
    return allProspects.filter((p) => {
      if (p.statut_avancement !== 'Visio') return false;
      if (p.statut_gagne_perdu !== 'actif') return false;
      if (!p.date_visio) return true;
      return new Date(p.date_visio) <= now;
    });
  }, [allProspects]);

  const groups = useMemo(() => {
    const map = new Map<string, Prospect[]>();
    for (const p of visiosPassees) {
      const commercial = cityToCommercial.get(p.zone_geographique?.trim() || '') || 'Non attribué';
      const arr = map.get(commercial) || [];
      arr.push(p);
      map.set(commercial, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const da = a.date_visio ? new Date(a.date_visio).getTime() : 0;
        const db = b.date_visio ? new Date(b.date_visio).getTime() : 0;
        return da - db;
      });
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Non attribué') return 1;
      if (b === 'Non attribué') return -1;
      return a.localeCompare(b, 'fr');
    });
  }, [visiosPassees, cityToCommercial]);

  // Liste des commerciaux pour le filtre — uniquement ceux qui ont au moins
  // une visio en attente (évite de proposer des noms vides dans le menu).
  const commercialFilterOptions = useMemo(
    () => groups.map(([commercial]) => commercial),
    [groups]
  );

  const visibleGroups = useMemo(
    () => selectedCommercial === 'tous' ? groups : groups.filter(([commercial]) => commercial === selectedCommercial),
    [groups, selectedCommercial]
  );

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

    updateProspectOptimistic(prospect.id, updates as Partial<Prospect>);
    try {
      await client.entities.prospects.update({ id: String(prospect.id), data: updates });
      await client.entities.commercial_actions.create({
        data: {
          prospect_id: prospect.id, action_type: 'status_change', appel_repondu: false,
          from_status: prospect.statut_avancement, to_status: newStatus,
          notes: `Depuis "Mes visios passées" : "${prospect.statut_avancement}" → "${newStatus}"`,
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
  }, [updateProspectOptimistic, invalidateProspects, invalidateActions]);

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
    updateProspectOptimistic(prospect.id, { date_relance_planifiee: iso });
    try {
      await client.entities.prospects.update({ id: String(prospect.id), data: { date_relance_planifiee: iso } });
      await client.entities.commercial_actions.create({
        data: {
          prospect_id: prospect.id, action_type: 'relance_planifiee', appel_repondu: false,
          from_status: prospect.statut_avancement, to_status: prospect.statut_avancement,
          notes: `Relance planifiée depuis "Mes visios passées" le ${new Date(iso).toLocaleString('fr-FR')}`,
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Video className="w-6 h-6 text-purple-600" /> Mes visios passées
          </h1>
          <p className="text-slate-500 mt-1">
            {visiosPassees.length} visio{visiosPassees.length > 1 ? 's' : ''} en attente de suite, groupées par commercial.
          </p>
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

      {visiosPassees.length === 0 ? (
        <Card className="border-0 shadow-sm rounded-2xl">
          <CardContent className="py-16 text-center">
            <div className="w-14 h-14 bg-purple-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Video className="w-6 h-6 text-purple-400" />
            </div>
            <p className="text-sm text-slate-400">Aucune visio en attente de suite pour le moment.</p>
          </CardContent>
        </Card>
      ) : visibleGroups.length === 0 ? (
        <Card className="border-0 shadow-sm rounded-2xl">
          <CardContent className="py-16 text-center">
            <p className="text-sm text-slate-400">Aucune visio en attente pour ce commercial.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {visibleGroups.map(([commercial, prospects]) => (
            <div key={commercial}>
              <div className="flex items-center gap-2 mb-3">
                <UserCircle className="w-5 h-5 text-[#5A9BA3]" />
                <h2 className="text-lg font-semibold text-slate-900">{commercial}</h2>
                <Badge className="bg-purple-50 text-purple-700 border-purple-200 rounded-lg text-xs font-bold">{prospects.length}</Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {prospects.map((p) => (
                  <VisioCard
                    key={p.id}
                    prospect={p}
                    busy={busyId === p.id}
                    onOpen={() => navigate(`/prospects/${p.id}`)}
                    onDemandeDocuments={() => handleStatusAction(p, 'Demande de documents', 'date_demande_documents')}
                    onDocumentsRecus={() => handleStatusAction(p, 'Signature', 'date_signature')}
                    onRelance={() => openRelanceDialog(p)}
                    onRefus={() => handleStatusAction(p, 'Refus / Perdu')}
                  />
                ))}
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

function VisioCard({ prospect: p, busy, onOpen, onDemandeDocuments, onDocumentsRecus, onRelance, onRefus }: {
  prospect: Prospect; busy: boolean; onOpen: () => void;
  onDemandeDocuments: () => void; onDocumentsRecus: () => void; onRelance: () => void; onRefus: () => void;
}) {
  const dateVisio = p.date_visio ? new Date(p.date_visio).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); if (!busy) fn(); };

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
          <Badge className="bg-purple-100 text-purple-700 border-purple-200 rounded-lg text-[10px] font-bold shrink-0">Visio</Badge>
        </div>

        <div className="space-y-1 text-xs text-slate-500">
          {dateVisio && <p className="flex items-center gap-1.5"><Video className="w-3.5 h-3.5 text-purple-500" /> RDV : {dateVisio}</p>}
          {p.telephone && <p className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {p.telephone}</p>}
          {p.zone_geographique && <p className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {p.zone_geographique}</p>}
          {p.categorie_metier && <p className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> {p.categorie_metier}</p>}
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
        </div>
      </CardContent>
    </Card>
  );
}
