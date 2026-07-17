import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { client } from '../lib/api';
import {
  useProspects, useProspectActions, useInvalidateProspects, useInvalidateActions,
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
  PhoneCall, PhoneOff, User,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../hooks/use-prospects';

const PIPELINE_STAGES = [
  'Appel telephonique', 'Relance 1', 'Relance 2', 'Relance 3', 'Relance 4',
  'Visio', 'Demande de documents', 'Signature', 'Refus / Perdu',
];

const stageGradients: Record<string, string> = {
  'Appel telephonique': 'from-slate-500 to-slate-600',
  'Relance 1': 'from-blue-400 to-blue-500',
  'Relance 2': 'from-blue-500 to-blue-600',
  'Relance 3': 'from-indigo-400 to-indigo-500',
  'Relance 4': 'from-indigo-500 to-indigo-600',
  Visio: 'from-purple-500 to-purple-600',
  'Demande de documents': 'from-amber-400 to-amber-500',
  Signature: 'from-emerald-500 to-emerald-600',
  'Refus / Perdu': 'from-red-400 to-red-500',
};

const actionTypeLabels: Record<string, string> = {
  appel: 'Appel', relance: 'Relance', visio: 'Visio',
  demande_documents: 'Demande de documents', signature: 'Signature',
  refus: 'Refus', status_change: 'Changement de statut',
};

export default function ProspectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const prospectId = id ? Number(id) : undefined;

  const { data: allProspects = [], isLoading: loadingP } = useProspects();
  const { data: actions = [], isLoading: loadingA } = useProspectActions(prospectId);
  const invalidateProspects = useInvalidateProspects();
  const invalidateActions = useInvalidateActions();
  const queryClient = useQueryClient();

  const prospect = allProspects.find((p) => p.id === prospectId) || null;

  const [editNotes, setEditNotes] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [showCallDialog, setShowCallDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notesInitialized, setNotesInitialized] = useState(false);

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

  const handleStatusChange = useCallback(async (newStatus: string) => {
    if (!prospect || prospect.statut_avancement === newStatus) return;
    const oldStatus = prospect.statut_avancement;
    const updates: Partial<Prospect> = { statut_avancement: newStatus };
    if (newStatus === 'Signature') updates.statut_gagne_perdu = 'gagne';
    else if (newStatus === 'Refus / Perdu') updates.statut_gagne_perdu = 'perdu';

    updateProspectOptimistic(updates);
    try {
      const updateData: Record<string, unknown> = { statut_avancement: newStatus };
      if (newStatus === 'Signature') updateData.statut_gagne_perdu = 'gagne';
      else if (newStatus === 'Refus / Perdu') updateData.statut_gagne_perdu = 'perdu';
      await client.entities.prospects.update({ id: String(prospect.id), data: updateData });
      await client.entities.commercial_actions.create({
        data: { prospect_id: prospect.id, action_type: 'status_change', appel_repondu: false, from_status: oldStatus, to_status: newStatus, notes: actionNote || `Statut: "${oldStatus}" → "${newStatus}"`, action_date: new Date().toISOString() },
      });
      invalidateActions(prospect.id);
      setActionNote('');
      if (newStatus === 'Signature') toast.success('🚀 Signature obtenue !');
      else if (newStatus === 'Visio') toast.success('🎉 Visio planifiée !');
      else toast.success(`Statut: ${newStatus}`);
    } catch { invalidateProspects(); toast.error('Erreur lors du changement de statut'); }
  }, [prospect, actionNote, updateProspectOptimistic, invalidateProspects, invalidateActions]);

  const handleCallResult = useCallback(async (answered: boolean) => {
    if (!prospect) return;
    setShowCallDialog(false);
    const currentAppels = prospect.nombre_appels || 0;
    const currentRelances = prospect.nombre_relances || 0;
    const currentRepondus = prospect.nombre_appels_repondus || 0;
    const isFirstCall = currentAppels === 0;

    const updates: Partial<Prospect> = {
      nombre_appels: currentAppels + 1,
      date_dernier_appel: new Date().toISOString(),
      nombre_appels_repondus: answered ? currentRepondus + 1 : currentRepondus,
    };

    let actionType = 'appel';
    let newStatus = prospect.statut_avancement;

    if (!isFirstCall) {
      const newRelanceCount = currentRelances + 1;
      updates.nombre_relances = newRelanceCount;
      actionType = 'relance';
      if (newRelanceCount === 1) newStatus = 'Relance 1';
      else if (newRelanceCount === 2) newStatus = 'Relance 2';
      else if (newRelanceCount === 3) newStatus = 'Relance 3';
      else if (newRelanceCount >= 4) newStatus = 'Relance 4';
      updates.statut_avancement = newStatus;
    }

    const nextRelance = new Date();
    nextRelance.setDate(nextRelance.getDate() + 5);
    updates.date_prochaine_relance = nextRelance.toISOString();

    updateProspectOptimistic(updates);

    try {
      const updateData: Record<string, unknown> = {
        nombre_appels: currentAppels + 1, date_dernier_appel: new Date().toISOString(),
        date_prochaine_relance: nextRelance.toISOString(),
      };
      if (answered) updateData.nombre_appels_repondus = currentRepondus + 1;
      if (!isFirstCall) { updateData.nombre_relances = currentRelances + 1; updateData.statut_avancement = newStatus; }

      await client.entities.prospects.update({ id: String(prospect.id), data: updateData });

      const relanceLabel = !isFirstCall ? ` (Relance ${currentRelances + 1})` : '';
      const answeredLabel = answered ? ' - Répondu' : ' - Non répondu';
      await client.entities.commercial_actions.create({
        data: { prospect_id: prospect.id, action_type: actionType, appel_repondu: answered, from_status: prospect.statut_avancement, to_status: newStatus, notes: actionNote || `${isFirstCall ? 'Appel' : 'Relance'}${relanceLabel}${answeredLabel}`, action_date: new Date().toISOString() },
      });
      invalidateActions(prospect.id);
      setActionNote('');
      toast.success(`${isFirstCall ? 'Appel' : `Relance ${currentRelances + 1}`} enregistré${answered ? ' (répondu)' : ' (non répondu)'}`);
    } catch { invalidateProspects(); toast.error("Erreur lors de l'enregistrement"); }
  }, [prospect, actionNote, updateProspectOptimistic, invalidateProspects, invalidateActions]);

  const handleLogVisio = useCallback(async () => {
    if (!prospect) return;
    updateProspectOptimistic({ statut_avancement: 'Visio', date_visio: new Date().toISOString() });
    try {
      await client.entities.prospects.update({ id: String(prospect.id), data: { statut_avancement: 'Visio', date_visio: new Date().toISOString() } });
      await client.entities.commercial_actions.create({
        data: { prospect_id: prospect.id, action_type: 'visio', appel_repondu: false, from_status: prospect.statut_avancement, to_status: 'Visio', notes: actionNote || 'Rendez-vous visio effectué', action_date: new Date().toISOString() },
      });
      invalidateActions(prospect.id);
      setActionNote('');
      toast.success('🎉 Visio enregistrée !');
    } catch { invalidateProspects(); toast.error("Erreur lors de l'enregistrement"); }
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
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => navigate('/prospects')} className="gap-2 rounded-xl hover:bg-slate-100">
          <ArrowLeft className="w-4 h-4" /> Retour
        </Button>
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
                { label: 'Source', value: prospect.source_lead || '-' },
                { label: 'Total appels', value: String(prospect.nombre_appels || 0), bold: true },
                { label: 'Appels répondus', value: String(prospect.nombre_appels_repondus || 0), color: 'text-emerald-600', bold: true },
                { label: 'Relances', value: String(prospect.nombre_relances || 0), bold: true },
                { label: 'Dernier appel', value: formatDate(prospect.date_dernier_appel) },
                { label: 'Prochaine relance', value: formatDate(prospect.date_prochaine_relance) },
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
              <Button size="sm" onClick={() => setShowCallDialog(true)} className="gap-1.5 bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] hover:from-[#4A8B93] hover:to-[#5A9BA4] text-white rounded-xl shadow-md shadow-[#6AABB4]/20">
                <Phone className="w-3.5 h-3.5" /> {callButtonLabel}
              </Button>
              <Button size="sm" variant="outline" onClick={handleLogVisio} className="gap-1.5 rounded-xl">Visio</Button>
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

      {/* Call Dialog */}
      <Dialog open={showCallDialog} onOpenChange={setShowCallDialog}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-[#5A9BA3] to-[#6AABB4] rounded-lg flex items-center justify-center"><Phone className="w-4 h-4 text-white" /></div>
              Résultat de l&apos;appel
            </DialogTitle>
            <DialogDescription>{isFirstCall ? `Premier appel à ${prospect.nom_societe}` : `Relance ${(prospect.nombre_relances || 0) + 1} - ${prospect.nom_societe}`}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <Button onClick={() => handleCallResult(true)} className="gap-2 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white h-12 text-base rounded-xl shadow-md shadow-emerald-500/20">
              <PhoneCall className="w-5 h-5" /> Appel répondu
            </Button>
            <Button onClick={() => handleCallResult(false)} variant="outline" className="gap-2 border-red-200 text-red-600 hover:bg-red-50 h-12 text-base rounded-xl">
              <PhoneOff className="w-5 h-5" /> Non répondu
            </Button>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setShowCallDialog(false)} className="w-full rounded-xl">Annuler</Button></DialogFooter>
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