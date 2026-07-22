import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { client } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  useProspects, useProspectActions, useInvalidateProspects, useInvalidateActions,
  useMondaySyncLog, useInvalidateMondaySyncLog,
  type Prospect, type CommercialAction,
} from '../hooks/use-prospects';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  ArrowLeft, Phone, Mail, MapPin, Building2, Save, ChevronRight,
  PhoneCall, PhoneOff, User, Video, CalendarClock, XCircle, Pencil, Trash2,
  FileCheck2, ExternalLink, RefreshCw, AlertTriangle, CheckCircle2, Send, Clock3,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../hooks/use-prospects';
import { ConfettiBurst, MoneyFireworks } from '../components/Celebration';

const toLocalInputValue = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const PIPELINE_STAGES = [
  'Appel telephonique', 'Relance 1', 'Relance 2', 'Relance 3', 'Relance 4',
  'Visio', 'Demande de documents', 'Signature', 'Dossier complet', 'Envoyé à Mathilde', 'Refus / Perdu',
];

// Une fois signe, le dossier reste "gagne" quel que soit son avancement
// administratif (Dossier complet / Envoye a Mathilde) — seul un vrai refus
// repasse en "perdu".
const WON_STAGES = new Set(['Signature', 'Dossier complet', 'Envoyé à Mathilde']);

const stageGradients: Record<string, string> = {
  'Appel telephonique': 'from-slate-500 to-slate-600',
  'Relance 1': 'from-blue-400 to-blue-500',
  'Relance 2': 'from-blue-500 to-blue-600',
  'Relance 3': 'from-indigo-400 to-indigo-500',
  'Relance 4': 'from-indigo-500 to-indigo-600',
  Visio: 'from-purple-500 to-purple-600',
  'Demande de documents': 'from-amber-400 to-amber-500',
  Signature: 'from-emerald-500 to-emerald-600',
  'Dossier complet': 'from-teal-500 to-cyan-600',
  'Envoyé à Mathilde': 'from-cyan-500 to-sky-600',
  'Refus / Perdu': 'from-red-400 to-red-500',
};

const actionTypeLabels: Record<string, string> = {
  appel: 'Appel', relance: 'Relance', visio: 'Visio',
  relance_planifiee: 'Relance planifiée',
  demande_documents: 'Demande de documents', signature: 'Signature',
  refus: 'Refus', status_change: 'Changement de statut',
};

type ProspectFormFields = {
  nom_societe: string; nom_dirigeant: string; telephone: string; email: string;
  zone_geographique: string; categorie_metier: string; source_lead: string;
  montant_potentiel: number; priorite: string;
  forme_juridique: string; nombre_salaries: string;
};

const emptyProspectForm: ProspectFormFields = {
  nom_societe: '', nom_dirigeant: '', telephone: '', email: '',
  zone_geographique: '', categorie_metier: '', source_lead: '',
  montant_potentiel: 0, priorite: 'moyenne',
  forme_juridique: '', nombre_salaries: '',
};

export default function ProspectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin, userRole } = useAuth();
  const prospectId = id ? Number(id) : undefined;

  const { data: allProspects = [], isLoading: loadingP } = useProspects();
  const { data: actions = [], isLoading: loadingA } = useProspectActions(prospectId);
  const { data: syncLog = [] } = useMondaySyncLog(prospectId);
  const invalidateProspects = useInvalidateProspects();
  const invalidateActions = useInvalidateActions();
  const invalidateSyncLog = useInvalidateMondaySyncLog();
  const queryClient = useQueryClient();

  const prospect = allProspects.find((p) => p.id === prospectId) || null;

  const [editNotes, setEditNotes] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [showCallDialog, setShowCallDialog] = useState(false);
  const [callStep, setCallStep] = useState<'result' | 'followup'>('result');
  const [followupMode, setFollowupMode] = useState<'default' | 'visio'>('default');
  const [relanceDateTime, setRelanceDateTime] = useState('');
  const [visioDateTime, setVisioDateTime] = useState('');
  const [quickVisioDateTime, setQuickVisioDateTime] = useState('');
  const [callAnsweredNote, setCallAnsweredNote] = useState('');
  const [confettiId, setConfettiId] = useState(0);
  const [moneyId, setMoneyId] = useState(0);
  const [saving, setSaving] = useState(false);
  const [notesInitialized, setNotesInitialized] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editForm, setEditForm] = useState<ProspectFormFields>(emptyProspectForm);
  const [savingInfo, setSavingInfo] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Initialize notes from prospect data
  if (prospect && !notesInitialized) {
    setEditNotes(prospect.notes || '');
    setNotesInitialized(true);
  }

  const updateProspectOptimistic = useCallback((updates: Partial<Prospect>) => {
    if (!prospectId) return;
    queryClient.setQueryData(queryKeys.prospects, (old: Prospect[] | undefined) =>
      (old || []).map((p) => p.id === prospectId ? { ...p, ...updates } : p)
    );
  }, [prospectId, queryClient]);

  const handleSaveNotes = useCallback(async () => {
    if (!prospect) return;
    setSaving(true);
    try {
      await client.entities.prospects.update({ id: String(prospect.id), data: { notes: editNotes } });
      updateProspectOptimistic({ notes: editNotes });
      toast.success('Notes sauvegardées');
    } catch { toast.error('Erreur lors de la sauvegarde'); }
    finally { setSaving(false); }
  }, [prospect, editNotes, updateProspectOptimistic]);

  // Ouvre la fiche en édition : pré-remplit le formulaire avec les valeurs
  // actuelles (permet d'ajouter, modifier ou vider — donc "supprimer" — un
  // champ précis : téléphone, email, dirigeant, montant, etc.).
  const handleOpenEdit = useCallback(() => {
    if (!prospect) return;
    setEditForm({
      nom_societe: prospect.nom_societe || '',
      nom_dirigeant: prospect.nom_dirigeant || '',
      telephone: prospect.telephone || '',
      email: prospect.email || '',
      zone_geographique: prospect.zone_geographique || '',
      categorie_metier: prospect.categorie_metier || '',
      source_lead: prospect.source_lead || '',
      montant_potentiel: prospect.montant_potentiel || 0,
      priorite: prospect.priorite || 'moyenne',
      forme_juridique: prospect.forme_juridique || '',
      nombre_salaries: prospect.nombre_salaries || '',
    });
    setShowEditDialog(true);
  }, [prospect]);

  const handleSaveInfo = useCallback(async () => {
    if (!prospect || savingInfo) return;
    if (!editForm.nom_societe.trim()) { toast.error('Le nom de la société est requis'); return; }
    setSavingInfo(true);
    try {
      await client.entities.prospects.update({ id: String(prospect.id), data: editForm });
      updateProspectOptimistic(editForm);
      toast.success('Fiche mise à jour');
      setShowEditDialog(false);
    } catch { toast.error('Erreur lors de la mise à jour'); }
    finally { setSavingInfo(false); }
  }, [prospect, editForm, savingInfo, updateProspectOptimistic]);

  // Suppression réservée aux admins (RLS : delete sur prospects/commercial_actions
  // limité aux admins depuis le correctif de sécurité de l'audit du 21/07/2026).
  const handleDeleteProspect = useCallback(async () => {
    if (!prospect || deleting) return;
    if (!window.confirm(`Supprimer définitivement "${prospect.nom_societe}" ? Cette action supprime aussi tout son historique d'appels et est irréversible.`)) return;
    setDeleting(true);
    try {
      await client.entities.prospects.delete({ id: String(prospect.id) });
      toast.success('Prospect supprimé');
      invalidateProspects();
      navigate('/prospects');
    } catch {
      toast.error("Erreur lors de la suppression (droits admin requis)");
      setDeleting(false);
    }
  }, [prospect, deleting, invalidateProspects, navigate]);

  const handleStatusChange = useCallback(async (newStatus: string, noteOverride?: string) => {
    if (!prospect || prospect.statut_avancement === newStatus) return;
    const oldStatus = prospect.statut_avancement;
    const updates: Partial<Prospect> = { statut_avancement: newStatus };
    if (WON_STAGES.has(newStatus)) updates.statut_gagne_perdu = 'gagne';
    else if (newStatus === 'Refus / Perdu') updates.statut_gagne_perdu = 'perdu';
    // Le commercial signataire est fige a la premiere Signature (partie 18) :
    // on ne le reecrit jamais ensuite, meme si le dossier change de main.
    if (newStatus === 'Signature' && !prospect.signed_by_user_id && userRole?.id) {
      updates.signed_by_user_id = userRole.id;
    }

    updateProspectOptimistic(updates);
    try {
      const updateData: Record<string, unknown> = { statut_avancement: newStatus };
      if (WON_STAGES.has(newStatus)) updateData.statut_gagne_perdu = 'gagne';
      else if (newStatus === 'Refus / Perdu') updateData.statut_gagne_perdu = 'perdu';
      if (newStatus === 'Signature' && !prospect.signed_by_user_id && userRole?.id) {
        updateData.signed_by_user_id = userRole.id;
      }
      await client.entities.prospects.update({ id: String(prospect.id), data: updateData });
      await client.entities.commercial_actions.create({
        data: { prospect_id: prospect.id, action_type: 'status_change', appel_repondu: false, from_status: oldStatus, to_status: newStatus, notes: noteOverride || actionNote || `Statut: "${oldStatus}" → "${newStatus}"`, action_date: new Date().toISOString() },
      });
      invalidateActions(prospect.id);
      setActionNote('');
      if (newStatus === 'Signature') toast.success('🚀 Signature obtenue !');
      else if (newStatus === 'Visio') toast.success('🎉 Visio planifiée !');
      else toast.success(`Statut: ${newStatus}`);
    } catch { invalidateProspects(); toast.error('Erreur lors du changement de statut'); }
  }, [prospect, actionNote, userRole, updateProspectOptimistic, invalidateProspects, invalidateActions]);

  // --- Documents & transmission Monday (Dossier complet) -----------------
  const [savingDoc, setSavingDoc] = useState<string | null>(null);
  const [markingComplete, setMarkingComplete] = useState(false);
  const [syncingMonday, setSyncingMonday] = useState(false);
  const [showSyncError, setShowSyncError] = useState(false);

  const handleToggleDoc = useCallback(async (field: 'doc_cfp_recu' | 'doc_kbis_recu' | 'doc_cni_recu', checked: boolean) => {
    if (!prospect) return;
    setSavingDoc(field);
    updateProspectOptimistic({ [field]: checked } as Partial<Prospect>);
    try {
      await client.entities.prospects.update({ id: String(prospect.id), data: { [field]: checked } });
    } catch {
      invalidateProspects();
      toast.error('Erreur lors de la mise à jour du document');
    } finally {
      setSavingDoc(null);
    }
  }, [prospect, updateProspectOptimistic, invalidateProspects]);

  // Appelle l'Edge Function Supabase "monday-sync" (creation/mise a jour
  // idempotente de l'item sur le board Monday TRANSMISSION CLIENTS). Le
  // statut CRM ne passe a "Envoyé à Mathilde" QUE si l'API confirme le
  // succes (partie 10/11) — sinon on reste sur "Dossier complet" avec un
  // statut de synchro "error", jamais de doublon possible (l'Edge Function
  // verifie monday_item_id avant de creer).
  const runMondaySync = useCallback(async (prospectId: number) => {
    setSyncingMonday(true);
    updateProspectOptimistic({ monday_sync_status: 'pending' } as Partial<Prospect>);
    try {
      const { data, error } = await supabase.functions.invoke('monday-sync', {
        body: { prospect_id: prospectId },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success('✅ Transmis à Mathilde sur Monday');
      } else {
        toast.error(data?.message || 'Transmission Monday échouée');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      invalidateProspects();
      toast.error(`Transmission Monday échouée : ${msg}`);
    } finally {
      invalidateProspects();
      invalidateSyncLog(prospectId);
      setSyncingMonday(false);
    }
  }, [updateProspectOptimistic, invalidateProspects, invalidateSyncLog]);

  const handleMarkDossierComplet = useCallback(async () => {
    if (!prospect || markingComplete) return;
    setMarkingComplete(true);
    try {
      await client.entities.prospects.update({ id: String(prospect.id), data: { statut_avancement: 'Dossier complet', statut_gagne_perdu: 'gagne' } });
      await client.entities.commercial_actions.create({
        data: { prospect_id: prospect.id, action_type: 'status_change', appel_repondu: false, from_status: prospect.statut_avancement, to_status: 'Dossier complet', notes: 'Dossier complet — documents reçus', action_date: new Date().toISOString() },
      });
      invalidateActions(prospect.id);
      invalidateProspects();
      toast.success('📁 Dossier marqué complet — transmission Monday en cours...');
      await runMondaySync(prospect.id);
    } catch {
      toast.error('Erreur lors du passage en "Dossier complet"');
    } finally {
      setMarkingComplete(false);
    }
  }, [prospect, markingComplete, invalidateActions, invalidateProspects, runMondaySync]);

  const handleRetryMondaySync = useCallback(() => {
    if (!prospect || syncingMonday) return;
    runMondaySync(prospect.id);
  }, [prospect, syncingMonday, runMondaySync]);

  // Appel RÉPONDU : on incrémente, on journalise, puis on passe à l'étape "suite"
  // (Visio / Relance date / Refus). On NE programme PAS de relance NRP.
  const handleCallAnswered = useCallback(async () => {
    if (!prospect) return;
    const currentAppels = prospect.nombre_appels || 0;
    const currentRepondus = prospect.nombre_appels_repondus || 0;
    updateProspectOptimistic({
      nombre_appels: currentAppels + 1,
      nombre_appels_repondus: currentRepondus + 1,
      date_dernier_appel: new Date().toISOString(),
      date_relance_planifiee: '',
    });
    try {
      // Un appel répondu consomme la relance datée : elle disparaît de la colonne "Relance date".
      await client.entities.prospects.update({ id: String(prospect.id), data: { nombre_appels: currentAppels + 1, nombre_appels_repondus: currentRepondus + 1, date_dernier_appel: new Date().toISOString(), date_relance_planifiee: null } });
      await client.entities.commercial_actions.create({
        data: { prospect_id: prospect.id, action_type: 'appel', appel_repondu: true, from_status: prospect.statut_avancement, to_status: prospect.statut_avancement, notes: actionNote || 'Appel - Répondu', action_date: new Date().toISOString() },
      });
      invalidateActions(prospect.id);
      setConfettiId((n) => n + 1);
    } catch { invalidateProspects(); toast.error("Erreur lors de l'enregistrement"); }
    setCallStep('followup');
    setFollowupMode('default');
  }, [prospect, actionNote, updateProspectOptimistic, invalidateProspects, invalidateActions]);

  // Appel NON RÉPONDU (NRP) : relance automatique dans 5 jours.
  const handleCallNoAnswer = useCallback(async () => {
    if (!prospect) return;
    setShowCallDialog(false);
    const currentAppels = prospect.nombre_appels || 0;
    const currentRelances = prospect.nombre_relances || 0;
    const isFirstCall = currentAppels === 0;

    const updates: Partial<Prospect> = {
      nombre_appels: currentAppels + 1,
      date_dernier_appel: new Date().toISOString(),
    };
    let newStatus = prospect.statut_avancement;
    if (!isFirstCall) {
      const newRelanceCount = currentRelances + 1;
      updates.nombre_relances = newRelanceCount;
      if (newRelanceCount === 1) newStatus = 'Relance 1';
      else if (newRelanceCount === 2) newStatus = 'Relance 2';
      else if (newRelanceCount === 3) newStatus = 'Relance 3';
      else if (newRelanceCount >= 4) newStatus = 'Relance 4';
      updates.statut_avancement = newStatus;
    }
    const nextRelance = new Date();
    nextRelance.setDate(nextRelance.getDate() + 5);
    updates.date_prochaine_relance = nextRelance.toISOString();

    updateProspectOptimistic({ ...updates, date_relance_planifiee: '' });
    try {
      // Un NRP consomme la relance datée : le prospect bascule dans la colonne NRP.
      await client.entities.prospects.update({ id: String(prospect.id), data: { ...updates, date_relance_planifiee: null } });
      await client.entities.commercial_actions.create({
        data: { prospect_id: prospect.id, action_type: isFirstCall ? 'appel' : 'relance', appel_repondu: false, from_status: prospect.statut_avancement, to_status: newStatus, notes: actionNote || `NRP (non répondu) — relance dans 5 jours`, action_date: new Date().toISOString() },
      });
      invalidateActions(prospect.id);
      setActionNote('');
      toast.success('Appel non répondu — relance NRP programmée (5 j)');
    } catch { invalidateProspects(); toast.error("Erreur lors de l'enregistrement"); }
  }, [prospect, actionNote, updateProspectOptimistic, invalidateProspects, invalidateActions]);

  // Relance à une date/heure précise (option "Relance date" ou champ dédié de la fiche).
  const handleSetRelanceDate = useCallback(async (localDateTime: string, noteOverride?: string) => {
    if (!prospect || !localDateTime) return;
    const iso = new Date(localDateTime).toISOString();
    updateProspectOptimistic({ date_relance_planifiee: iso });
    try {
      await client.entities.prospects.update({ id: String(prospect.id), data: { date_relance_planifiee: iso } });
      await client.entities.commercial_actions.create({
        data: { prospect_id: prospect.id, action_type: 'relance_planifiee', appel_repondu: false, from_status: prospect.statut_avancement, to_status: prospect.statut_avancement, notes: noteOverride || actionNote || `Relance planifiée le ${new Date(iso).toLocaleString('fr-FR')}`, action_date: new Date().toISOString() },
      });
      invalidateActions(prospect.id);
      setActionNote('');
      toast.success('📅 Relance planifiée');
    } catch { invalidateProspects(); toast.error('Erreur lors de la planification'); }
    setShowCallDialog(false);
    setCallStep('result');
    setFollowupMode('default');
    setRelanceDateTime('');
    setCallAnsweredNote('');
  }, [prospect, actionNote, updateProspectOptimistic, invalidateProspects, invalidateActions]);

  // Visio : on demande désormais la date & heure du rendez-vous (au lieu de figer l'instant présent).
  const handleLogVisio = useCallback(async (dateTimeLocal?: string, noteOverride?: string) => {
    if (!prospect) return;
    const iso = dateTimeLocal ? new Date(dateTimeLocal).toISOString() : new Date().toISOString();
    updateProspectOptimistic({ statut_avancement: 'Visio', date_visio: iso, date_relance_planifiee: '' });
    try {
      await client.entities.prospects.update({ id: String(prospect.id), data: { statut_avancement: 'Visio', date_visio: iso, date_relance_planifiee: null } });
      await client.entities.commercial_actions.create({
        data: { prospect_id: prospect.id, action_type: 'visio', appel_repondu: false, from_status: prospect.statut_avancement, to_status: 'Visio', notes: noteOverride || actionNote || `Visio planifiée le ${new Date(iso).toLocaleString('fr-FR')}`, action_date: new Date().toISOString() },
      });
      invalidateActions(prospect.id);
      setActionNote('');
      setMoneyId((n) => n + 1);
      toast.success('🎉 Visio enregistrée !');
    } catch { invalidateProspects(); toast.error("Erreur lors de l'enregistrement"); }
    setShowCallDialog(false);
    setCallStep('result');
    setFollowupMode('default');
    setCallAnsweredNote('');
    setVisioDateTime('');
    setQuickVisioDateTime('');
  }, [prospect, actionNote, updateProspectOptimistic, invalidateProspects, invalidateActions]);

  const formatDate = (dateStr: string) => {
    if (!dateStr || dateStr.startsWith('2026-01-01')) return '-';
    return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const loading = loadingP || loadingA;

  if (loading || !prospect) {
    if (!loading && !prospect) {
      toast.error('Prospect introuvable');
      navigate('/prospects');
      return null;
    }
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-[#6AABB4] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Chargement du prospect...</p>
        </div>
      </div>
    );
  }

  const currentStageIndex = PIPELINE_STAGES.indexOf(prospect.statut_avancement);
  const isFirstCall = (prospect.nombre_appels || 0) === 0;
  const callButtonLabel = isFirstCall ? 'Appel' : `Appel (Relance ${(prospect.nombre_relances || 0) + 1})`;

  return (
    <div className="space-y-6">
      <ConfettiBurst id={confettiId} />
      <MoneyFireworks id={moneyId} />
      <div className="flex items-center justify-between gap-4">
        <Button variant="ghost" onClick={() => navigate('/prospects')} className="gap-2 rounded-xl hover:bg-slate-100">
          <ArrowLeft className="w-4 h-4" /> Retour
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleOpenEdit} className="gap-1.5 rounded-xl border-slate-200">
            <Pencil className="w-3.5 h-3.5" /> Modifier la fiche
          </Button>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={handleDeleteProspect} disabled={deleting} className="gap-1.5 rounded-xl border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700">
              <Trash2 className="w-3.5 h-3.5" /> {deleting ? 'Suppression...' : 'Supprimer'}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{prospect.nom_societe}</h1>
          <p className="text-slate-500">{prospect.nom_dirigeant}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={`rounded-lg ${prospect.statut_gagne_perdu === 'gagne' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : prospect.statut_gagne_perdu === 'perdu' ? 'bg-red-100 text-red-700 border-red-200' : 'bg-blue-100 text-blue-700 border-blue-200'}`}>
            {prospect.statut_gagne_perdu.toUpperCase()}
          </Badge>
          <Badge className="bg-slate-100 text-slate-700 border-slate-200 rounded-lg">{(prospect.montant_potentiel || 0).toLocaleString('fr-FR')} €</Badge>
        </div>
      </div>

      {/* Pipeline Progress */}
      <Card className="border-0 shadow-sm rounded-2xl">
        <CardHeader><CardTitle className="text-lg">Progression dans le pipeline</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {PIPELINE_STAGES.map((stage, idx) => {
              const isActive = idx === currentStageIndex;
              const isPast = idx < currentStageIndex;
              return (
                <button key={stage} onClick={() => handleStatusChange(stage)}
                  className={`flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
                    isActive ? `bg-gradient-to-r ${stageGradients[stage] || 'from-blue-500 to-blue-600'} text-white shadow-md scale-105`
                    : isPast ? 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                    : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600'
                  }`}>
                  {stage}{idx < PIPELINE_STAGES.length - 1 && <ChevronRight className="w-3 h-3 ml-1" />}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Documents & transmission Monday — visible uniquement une fois le
          dossier signé (Signature / Dossier complet / Envoyé à Mathilde). */}
      {currentStageIndex >= PIPELINE_STAGES.indexOf('Signature') && prospect.statut_avancement !== 'Refus / Perdu' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-0 shadow-sm rounded-2xl">
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><FileCheck2 className="w-5 h-5 text-teal-600" /> Documents du dossier</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {([
                { field: 'doc_cfp_recu' as const, label: 'CFP reçue' },
                { field: 'doc_kbis_recu' as const, label: 'Kbis reçu' },
                { field: 'doc_cni_recu' as const, label: 'CNI reçue' },
              ]).map(({ field, label }) => (
                <label key={field} className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!prospect[field]}
                    disabled={savingDoc === field}
                    onChange={(e) => handleToggleDoc(field, e.target.checked)}
                    className="w-4 h-4 rounded accent-[#5A9BA3]"
                  />
                  <span className="text-sm text-slate-700">{label}</span>
                  {savingDoc === field && <span className="text-xs text-slate-400 ml-auto">...</span>}
                </label>
              ))}

              {prospect.statut_avancement === 'Signature' && (
                <Button
                  onClick={handleMarkDossierComplet}
                  disabled={markingComplete || !(prospect.doc_cfp_recu && prospect.doc_kbis_recu && prospect.doc_cni_recu)}
                  className="w-full gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white mt-2"
                >
                  <Send className="w-4 h-4" /> {markingComplete ? 'Traitement...' : 'Marquer dossier complet'}
                </Button>
              )}
              {!(prospect.doc_cfp_recu && prospect.doc_kbis_recu && prospect.doc_cni_recu) && prospect.statut_avancement === 'Signature' && (
                <p className="text-xs text-slate-400 text-center">Coche les 3 documents pour pouvoir transmettre le dossier.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm rounded-2xl">
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Send className="w-5 h-5 text-sky-600" /> Transmission Monday</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {prospect.statut_avancement === 'Signature' ? (
                <p className="text-sm text-slate-400">En attente des documents pour transmettre le dossier.</p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    {prospect.monday_sync_status === 'synced' ? (
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 rounded-lg gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Synchronisé</Badge>
                    ) : prospect.monday_sync_status === 'error' ? (
                      <Badge className="bg-red-50 text-red-700 border-red-200 rounded-lg gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Transmission échouée</Badge>
                    ) : (
                      <Badge className="bg-amber-50 text-amber-700 border-amber-200 rounded-lg gap-1"><Clock3 className="w-3.5 h-3.5" /> En attente</Badge>
                    )}
                    {syncingMonday && <span className="text-xs text-slate-400">Synchronisation...</span>}
                  </div>

                  {prospect.monday_synced_at && (
                    <p className="text-xs text-slate-500">Synchronisé le {formatDate(prospect.monday_synced_at || '')}</p>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {prospect.monday_item_url && (
                      <Button asChild variant="outline" size="sm" className="gap-1.5 rounded-xl">
                        <a href={prospect.monday_item_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5" /> Ouvrir dans Monday</a>
                      </Button>
                    )}
                    {prospect.monday_sync_status === 'error' && (
                      <>
                        <Button variant="outline" size="sm" onClick={handleRetryMondaySync} disabled={syncingMonday} className="gap-1.5 rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50">
                          <RefreshCw className={`w-3.5 h-3.5 ${syncingMonday ? 'animate-spin' : ''}`} /> Réessayer
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setShowSyncError(true)} className="gap-1.5 rounded-xl border-red-200 text-red-600 hover:bg-red-50">
                          <AlertTriangle className="w-3.5 h-3.5" /> Voir l'erreur
                        </Button>
                      </>
                    )}
                  </div>

                  {syncLog.length > 0 && (
                    <div className="pt-3 border-t border-slate-100 space-y-1.5 max-h-40 overflow-y-auto">
                      {syncLog.map((l) => (
                        <div key={l.id} className="text-xs flex items-start gap-2">
                          <span className="text-slate-400 shrink-0">{formatDate(l.created_at)}</span>
                          <span className={l.success ? 'text-slate-600' : 'text-red-600'}>{l.event}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={showSyncError} onOpenChange={setShowSyncError}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>Erreur de transmission Monday</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600 whitespace-pre-wrap">{prospect.monday_sync_error || 'Aucun détail disponible.'}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSyncError(false)} className="rounded-xl">Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Contact Info */}
        <Card className="border-0 shadow-sm rounded-2xl">
          <CardHeader><CardTitle className="text-lg">Informations</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {[
              { icon: Phone, value: prospect.telephone || '-', color: 'text-[#5A9BA3]' },
              { icon: Mail, value: prospect.email || '-', color: 'text-[#5A9BA3]' },
              { icon: MapPin, value: prospect.zone_geographique || '-', color: 'text-[#5A9BA3]' },
              { icon: Building2, value: prospect.categorie_metier || '-', color: 'text-[#5A9BA3]' },
            ].map((item, idx) => (
              <div key={idx} className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
                <item.icon className={`w-4 h-4 ${item.color}`} /><span className="text-sm text-slate-700">{item.value}</span>
              </div>
            ))}
            <div className="pt-3 border-t border-slate-100 space-y-2.5">
              {[
                { label: 'Statut juridique', value: prospect.forme_juridique || '-' },
                { label: "Nombre d'employés", value: prospect.nombre_salaries || '-' },
                { label: 'Source', value: prospect.source_lead || '-' },
                { label: 'Total appels', value: String(prospect.nombre_appels || 0), bold: true },
                { label: 'Appels répondus', value: String(prospect.nombre_appels_repondus || 0), color: 'text-emerald-600', bold: true },
                { label: 'Relances', value: String(prospect.nombre_relances || 0), bold: true },
                { label: 'Dernier appel', value: formatDate(prospect.date_dernier_appel) },
                { label: 'Relance NRP', value: formatDate(prospect.date_prochaine_relance) },
                { label: 'Relance datée', value: formatDate(prospect.date_relance_planifiee), color: 'text-[#5A9BA3]', bold: true },
                { label: 'Visio', value: formatDate(prospect.date_visio), color: 'text-purple-600', bold: true },
                { label: 'Créé le', value: formatDate(prospect.created_at) },
              ].map((item) => (
                <div key={item.label} className="flex justify-between text-sm">
                  <span className="text-slate-500">{item.label}</span>
                  <span className={`${item.bold ? 'font-semibold' : ''} ${item.color || 'text-slate-700'}`}>{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Actions & Notes */}
        <Card className="lg:col-span-2 border-0 shadow-sm rounded-2xl">
          <CardHeader><CardTitle className="text-lg">Actions rapides</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Note pour l&apos;action</Label>
              <Input value={actionNote} onChange={(e) => setActionNote(e.target.value)} placeholder="Ajouter une note (optionnel)..." className="rounded-xl" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => { setCallStep('result'); setFollowupMode('default'); setRelanceDateTime(''); setVisioDateTime(''); setCallAnsweredNote(''); setShowCallDialog(true); }} className="gap-1.5 bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] hover:from-[#4A8B93] hover:to-[#5A9BA4] text-white rounded-xl shadow-md shadow-[#6AABB4]/20">
                <Phone className="w-3.5 h-3.5" /> {callButtonLabel}
              </Button>
            </div>

            {/* Relance planifiée (date/heure) — alimente la colonne "Relance date" du tableau de bord */}
            <div className="pt-4 border-t border-slate-100">
              <Label>Relance planifiée (date &amp; heure)</Label>
              <div className="flex gap-2 mt-1">
                <input
                  type="datetime-local"
                  value={relanceDateTime}
                  onChange={(e) => setRelanceDateTime(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6AABB4]/40"
                />
                <Button onClick={() => handleSetRelanceDate(relanceDateTime)} disabled={!relanceDateTime} size="sm" className="gap-1.5 bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] hover:from-[#4A8B93] hover:to-[#5A9BA4] text-white rounded-xl">
                  <CalendarClock className="w-4 h-4" /> Planifier
                </Button>
              </div>
              {prospect.date_relance_planifiee && (
                <p className="text-xs text-slate-500 mt-1.5">Prochaine relance datée : <span className="font-semibold text-slate-700">{formatDate(prospect.date_relance_planifiee)}</span></p>
              )}
            </div>

            {/* Visio planifiée (date/heure précise) */}
            <div className="pt-4 border-t border-slate-100">
              <Label>Visio planifiée (date &amp; heure)</Label>
              <div className="flex gap-2 mt-1">
                <input
                  type="datetime-local"
                  value={quickVisioDateTime}
                  onChange={(e) => setQuickVisioDateTime(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/40"
                />
                <Button onClick={() => handleLogVisio(quickVisioDateTime || undefined, actionNote)} size="sm" className="gap-1.5 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white rounded-xl">
                  <Video className="w-4 h-4" /> Planifier
                </Button>
              </div>
              {prospect.date_visio && (
                <p className="text-xs text-slate-500 mt-1.5">Visio prévue : <span className="font-semibold text-purple-600">{formatDate(prospect.date_visio)}</span></p>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100">
              <Label>Changer le statut</Label>
              <Select value={prospect.statut_avancement} onValueChange={handleStatusChange}>
                <SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>{PIPELINE_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <Label>Notes</Label>
              <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={4} className="mt-1 rounded-xl" />
              <Button onClick={handleSaveNotes} disabled={saving} size="sm" className="mt-2 gap-1.5 bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] hover:from-[#4A8B93] hover:to-[#5A9BA4] text-white rounded-xl shadow-sm">
                <Save className="w-3.5 h-3.5" /> {saving ? 'Sauvegarde...' : 'Sauvegarder'}
              </Button>
            </div>

            {/* Action History */}
            <div className="pt-4 border-t border-slate-100">
              <h3 className="font-semibold text-slate-900 mb-3">Historique des actions</h3>
              {actions.length === 0 ? (
                <div className="text-center py-6">
                  <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-2"><Phone className="w-4 h-4 text-slate-400" /></div>
                  <p className="text-sm text-slate-400">Aucune action enregistrée</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {actions.map((a) => (
                    <ActionRow key={a.id} action={a} formatDate={formatDate} />
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Call Dialog — dimensions fixes : le contenu change, la fenêtre ne bouge pas */}
      <Dialog open={showCallDialog} onOpenChange={(o) => { setShowCallDialog(o); if (!o) { setCallStep('result'); setFollowupMode('default'); setCallAnsweredNote(''); setVisioDateTime(''); } }}>
        <DialogContent className="w-[400px] max-w-[92vw] rounded-3xl p-0 overflow-hidden gap-0">
          <div className="h-1.5 bg-gradient-to-r from-[#5A9BA3] via-[#6AABB4] to-emerald-400" />
          <DialogHeader className="px-6 pt-5 pb-0 space-y-1">
            <DialogTitle className="flex items-center gap-2.5 text-lg">
              <div className="w-9 h-9 bg-gradient-to-br from-[#5A9BA3] to-[#6AABB4] rounded-xl flex items-center justify-center shrink-0">
                <Phone className="w-4 h-4 text-white" />
              </div>
              <span className="truncate">{callStep === 'result' ? "Résultat de l'appel" : 'Et ensuite ?'}</span>
            </DialogTitle>
            <DialogDescription className="truncate text-left">{prospect.nom_societe}</DialogDescription>
          </DialogHeader>

          <div className="px-6 py-5 h-[300px]">
            {callStep === 'result' ? (
              <div className="h-full grid grid-rows-2 gap-3">
                <Button onClick={handleCallAnswered} className="h-full text-base font-black rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white gap-2 hover:scale-[1.02] transition-transform">
                  <PhoneCall className="w-5 h-5" /> Appel répondu
                </Button>
                <Button onClick={handleCallNoAnswer} variant="outline" className="h-full text-base font-black rounded-2xl border-2 border-red-200 text-red-600 hover:bg-red-50 gap-2 hover:scale-[1.02] transition-transform">
                  <PhoneOff className="w-5 h-5" /> Non répondu (NRP)
                </Button>
              </div>
            ) : (
              <div className="h-full flex flex-col gap-2.5">
                <textarea
                  value={callAnsweredNote}
                  onChange={(e) => setCallAnsweredNote(e.target.value)}
                  placeholder="Note sur l'appel (optionnel)..."
                  rows={2}
                  className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#6AABB4]"
                />
                {followupMode === 'default' ? (
                  <>
                    <div className="grid grid-cols-2 gap-2.5">
                      <Button onClick={() => { setVisioDateTime(toLocalInputValue(new Date())); setFollowupMode('visio'); }} className="h-11 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white gap-2 font-bold"><Video className="w-4 h-4" /> Visio</Button>
                      <Button onClick={() => { handleStatusChange('Refus / Perdu', callAnsweredNote); setShowCallDialog(false); setCallStep('result'); setCallAnsweredNote(''); }} variant="outline" className="h-11 rounded-xl border-2 border-red-200 text-red-600 hover:bg-red-50 gap-2 font-bold"><XCircle className="w-4 h-4" /> Refus</Button>
                    </div>
                    <div className="rounded-2xl border-2 border-slate-100 p-3">
                      <p className="text-xs font-semibold text-slate-500 mb-1.5">Relance à une date précise</p>
                      <div className="flex gap-2">
                        <input type="datetime-local" value={relanceDateTime} onChange={(e) => setRelanceDateTime(e.target.value)}
                          className="flex-1 min-w-0 h-10 rounded-xl border-2 border-slate-200 px-2.5 text-sm focus:outline-none focus:border-[#6AABB4]" />
                        <Button onClick={() => handleSetRelanceDate(relanceDateTime, callAnsweredNote)} disabled={!relanceDateTime} className="h-10 shrink-0 gap-1.5 bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] text-white rounded-xl font-bold"><CalendarClock className="w-4 h-4" /> OK</Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl border-2 border-purple-100 bg-purple-50/40 p-3 flex-1 flex flex-col justify-center gap-2.5">
                    <p className="text-xs font-semibold text-purple-600 flex items-center gap-1.5"><Video className="w-3.5 h-3.5" /> Date &amp; heure de la visio</p>
                    <input type="datetime-local" value={visioDateTime} onChange={(e) => setVisioDateTime(e.target.value)}
                      className="w-full h-10 rounded-xl border-2 border-purple-200 px-2.5 text-sm focus:outline-none focus:border-purple-400 bg-white" />
                    <div className="flex gap-2">
                      <Button onClick={() => setFollowupMode('default')} variant="ghost" className="h-10 rounded-xl flex-1">← Retour</Button>
                      <Button onClick={() => handleLogVisio(visioDateTime, callAnsweredNote)} disabled={!visioDateTime} className="h-10 flex-[1.4] gap-1.5 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white rounded-xl font-bold"><Video className="w-4 h-4" /> Confirmer</Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="px-6 pb-5 pt-0">
            <Button variant="ghost" onClick={() => { setShowCallDialog(false); setCallStep('result'); setFollowupMode('default'); setCallAnsweredNote(''); }} className="w-full rounded-xl">Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Édition de la fiche — société, dirigeant, coordonnées, montant, priorité.
          Vider un champ puis sauvegarder revient à "supprimer" cette info. */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader><DialogTitle>Modifier la fiche prospect</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Société *</Label><Input value={editForm.nom_societe} onChange={(e) => setEditForm({ ...editForm, nom_societe: e.target.value })} placeholder="Nom de la société" className="rounded-xl" /></div>
              <div><Label>Dirigeant</Label><Input value={editForm.nom_dirigeant} onChange={(e) => setEditForm({ ...editForm, nom_dirigeant: e.target.value })} placeholder="Nom du dirigeant" className="rounded-xl" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Téléphone</Label><Input value={editForm.telephone} onChange={(e) => setEditForm({ ...editForm, telephone: e.target.value })} placeholder="01 23 45 67 89" className="rounded-xl" /></div>
              <div><Label>Email</Label><Input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} placeholder="email@example.com" className="rounded-xl" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Zone géographique</Label><Input value={editForm.zone_geographique} onChange={(e) => setEditForm({ ...editForm, zone_geographique: e.target.value })} placeholder="Paris, Lyon..." className="rounded-xl" /></div>
              <div><Label>Catégorie métier</Label><Input value={editForm.categorie_metier} onChange={(e) => setEditForm({ ...editForm, categorie_metier: e.target.value })} placeholder="BTP, Restaurant..." className="rounded-xl" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Statut juridique</Label>
                <Input value={editForm.forme_juridique} onChange={(e) => setEditForm({ ...editForm, forme_juridique: e.target.value })} placeholder="SARL, SAS, E.I..." className="rounded-xl" list="formes-juridiques" />
                <datalist id="formes-juridiques">
                  <option value="SARL" /><option value="SAS / SASU" /><option value="E.I" /><option value="EURL" /><option value="Auto-entrepreneur" /><option value="SA" /><option value="Association" />
                </datalist>
              </div>
              <div><Label>Nombre d'employés</Label><Input value={editForm.nombre_salaries} onChange={(e) => setEditForm({ ...editForm, nombre_salaries: e.target.value })} placeholder="Ex : 5, Entre 6 et 9, plus de 100..." className="rounded-xl" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Source du lead</Label><Input value={editForm.source_lead} onChange={(e) => setEditForm({ ...editForm, source_lead: e.target.value })} placeholder="LinkedIn, Salon..." className="rounded-xl" /></div>
              <div><Label>Montant potentiel (€)</Label><Input type="number" value={editForm.montant_potentiel} onChange={(e) => setEditForm({ ...editForm, montant_potentiel: Number(e.target.value) })} className="rounded-xl" /></div>
            </div>
            <div>
              <Label>Priorité</Label>
              <Select value={editForm.priorite} onValueChange={(v) => setEditForm({ ...editForm, priorite: v })}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="haute">Haute</SelectItem>
                  <SelectItem value="moyenne">Moyenne</SelectItem>
                  <SelectItem value="basse">Basse</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)} disabled={savingInfo} className="rounded-xl">Annuler</Button>
            <Button onClick={handleSaveInfo} disabled={savingInfo} className="bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] hover:from-[#4A8B93] hover:to-[#5A9BA4] text-white rounded-xl">{savingInfo ? 'Enregistrement...' : 'Enregistrer'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { memo } from 'react';

const ActionRow = memo(function ActionRow({ action: a, formatDate }: { action: CommercialAction; formatDate: (s: string) => string }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
      <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${
        a.action_type === 'appel' || a.action_type === 'relance' ? (a.appel_repondu ? 'bg-emerald-500' : 'bg-red-400') : 'bg-[#5A9BA3]'
      }`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-900">{actionTypeLabels[a.action_type] || a.action_type}</span>
            {(a.action_type === 'appel' || a.action_type === 'relance') && (
              <Badge className={`text-[10px] rounded-md ${a.appel_repondu ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-red-100 text-red-600 border-red-200'}`}>
                {a.appel_repondu ? 'Répondu' : 'Non répondu'}
              </Badge>
            )}
          </div>
          <span className="text-xs text-slate-400 shrink-0 ml-2">{formatDate(a.action_date || a.created_at)}</span>
        </div>
        {a.from_status !== a.to_status && <p className="text-xs text-slate-500 mt-0.5">{a.from_status} → {a.to_status}</p>}
        {a.notes && <p className="text-sm text-slate-600 mt-1">{a.notes}</p>}
      </div>
    </div>
  );
});