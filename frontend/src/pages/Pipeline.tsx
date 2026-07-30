import { useMemo, useCallback } from 'react';
import { client } from '../lib/api';
import { Link } from 'react-router-dom';
import { useProspects, useInvalidateProspects, useInvalidateActions, type Prospect } from '../hooks/use-prospects';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ExternalLink } from 'lucide-react';
import ErrorState from '../components/ErrorState';
import { memo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../hooks/use-prospects';

const PIPELINE_STAGES = [
  { key: 'Appel telephonique', label: 'Appel téléphonique', gradient: 'from-slate-400 to-slate-500', light: 'bg-slate-100 text-slate-700' },
  { key: 'Relance 1', label: 'Relance 1', gradient: 'from-blue-400 to-blue-500', light: 'bg-blue-100 text-blue-700' },
  { key: 'Relance 2', label: 'Relance 2', gradient: 'from-blue-500 to-blue-600', light: 'bg-blue-100 text-blue-800' },
  { key: 'Relance 3', label: 'Relance 3', gradient: 'from-indigo-400 to-indigo-500', light: 'bg-indigo-100 text-indigo-700' },
  { key: 'Relance 4', label: 'Relance 4', gradient: 'from-indigo-500 to-indigo-600', light: 'bg-indigo-100 text-indigo-800' },
  { key: 'Visio', label: 'Visio', gradient: 'from-purple-500 to-purple-600', light: 'bg-purple-100 text-purple-700' },
  { key: 'Demande de documents', label: 'Demande docs', gradient: 'from-amber-400 to-amber-500', light: 'bg-amber-100 text-amber-700' },
  { key: 'Signature', label: 'Signature', gradient: 'from-emerald-500 to-emerald-600', light: 'bg-emerald-100 text-emerald-700' },
  { key: 'Dossier complet', label: 'Dossier complet', gradient: 'from-teal-500 to-cyan-600', light: 'bg-teal-100 text-teal-700' },
  { key: 'Envoyé à Mathilde', label: 'Envoyé à Mathilde', gradient: 'from-cyan-500 to-sky-600', light: 'bg-sky-100 text-sky-700' },
  { key: 'Refus / Perdu', label: 'Refus / Perdu', gradient: 'from-red-400 to-red-500', light: 'bg-red-100 text-red-700' },
];

// Une fois signé, le dossier reste "gagne" quel que soit son avancement
// administratif (Dossier complet / Envoye a Mathilde) — seul un vrai refus
// repasse en "perdu".
const WON_STAGES = new Set(['Signature', 'Dossier complet', 'Envoyé à Mathilde']);

const priorityColors: Record<string, string> = {
  haute: 'border-l-red-500',
  moyenne: 'border-l-amber-400',
  basse: 'border-l-slate-300',
};

export default function Pipeline() {
  const { data: prospects = [], isLoading: loading, error, refetch, isFetching } = useProspects();
  const invalidateProspects = useInvalidateProspects();
  const invalidateActions = useInvalidateActions();
  const queryClient = useQueryClient();

  const handleMoveProspect = useCallback(async (prospectId: number, newStage: string) => {
    const prospect = prospects.find((p) => p.id === prospectId);
    if (!prospect) return;

    // Optimistic update
    queryClient.setQueryData(queryKeys.prospects, (old: Prospect[] | undefined) =>
      (old || []).map((p) =>
        p.id === prospectId
          ? { ...p, statut_avancement: newStage, statut_gagne_perdu: WON_STAGES.has(newStage) ? 'gagne' : newStage === 'Refus / Perdu' ? 'perdu' : p.statut_gagne_perdu }
          : p
      )
    );

    try {
      const updateData: Record<string, unknown> = { statut_avancement: newStage };
      if (WON_STAGES.has(newStage)) updateData.statut_gagne_perdu = 'gagne';
      else if (newStage === 'Refus / Perdu') updateData.statut_gagne_perdu = 'perdu';

      await client.entities.prospects.update({ id: String(prospectId), data: updateData });
      await client.entities.commercial_actions.create({
        data: {
          prospect_id: prospectId, action_type: 'status_change',
          from_status: prospect.statut_avancement, to_status: newStage,
          notes: `Pipeline: déplacé vers "${newStage}"`, action_date: new Date().toISOString(),
        },
      });
      invalidateActions(prospectId);
      toast.success(`Prospect déplacé vers "${newStage}"`);
    } catch {
      // Revert on error
      invalidateProspects();
      toast.error('Erreur lors du déplacement');
    }
  }, [prospects, queryClient, invalidateProspects, invalidateActions]);

  // Avec ~15 000 prospects, une colonne (ex. "Appel téléphonique") peut
  // contenir plusieurs milliers de cartes : les rendre toutes fait ramer le
  // navigateur. On plafonne l'affichage par colonne et on renvoie vers
  // Prospects (filtré par statut) pour voir le reste.
  const CARDS_PER_STAGE = 40;

  const totalActive = useMemo(() => prospects.filter((p) => p.statut_gagne_perdu === 'actif').length, [prospects]);
  const totalValue = useMemo(() => prospects.filter((p) => p.statut_gagne_perdu === 'actif').reduce((s, p) => s + (p.montant_potentiel || 0), 0), [prospects]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-[#6AABB4] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Chargement du pipeline...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        message="Impossible de charger le pipeline."
        onRetry={() => refetch()}
        retrying={isFetching}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Pipeline commercial</h1>
          <p className="text-slate-500 mt-1">{totalActive} prospect(s) actif(s) • {totalValue.toLocaleString('fr-FR')} € en pipeline</p>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {PIPELINE_STAGES.map((stage) => {
          const stageProspects = prospects.filter((p) => p.statut_avancement === stage.key);
          const stageTotal = stageProspects.reduce((s, p) => s + (p.montant_potentiel || 0), 0);
          return (
            <div key={stage.key} className="min-w-[270px] w-[270px] shrink-0">
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className={`w-2.5 h-2.5 rounded-full bg-gradient-to-r ${stage.gradient}`} />
                <h3 className="text-sm font-semibold text-slate-700">{stage.label}</h3>
                <Badge variant="secondary" className={`ml-auto min-w-7 shrink-0 px-2 font-semibold ${stage.light}`}>{stageProspects.length}</Badge>
              </div>
              {stageTotal > 0 && <p className="text-xs text-slate-400 mb-2 px-1 font-medium">{stageTotal.toLocaleString('fr-FR')} €</p>}
              <div className="space-y-2">
                {stageProspects.length === 0 ? (
                  <div className="rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center"><p className="text-xs text-slate-400">Aucun prospect</p></div>
                ) : (
                  <>
                    {stageProspects.slice(0, CARDS_PER_STAGE).map((p) => (
                      <PipelineCard key={p.id} prospect={p} onMove={handleMoveProspect} />
                    ))}
                    {stageProspects.length > CARDS_PER_STAGE && (
                      <Link
                        to="/prospects"
                        className="block text-center text-xs font-semibold text-[#5A9BA3] hover:text-[#4A8B93] py-2 rounded-xl border border-dashed border-slate-200 hover:border-[#6AABB4]/40"
                      >
                        +{stageProspects.length - CARDS_PER_STAGE} autre(s) — voir dans Prospects
                      </Link>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PipelineCard = memo(function PipelineCard({ prospect: p, onMove }: { prospect: Prospect; onMove: (id: number, stage: string) => void }) {
  return (
    <Card className={`border-0 shadow-sm border-l-[3px] rounded-xl ${priorityColors[p.priorite] || 'border-l-slate-300'}`}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between mb-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 truncate">{p.nom_societe}</p>
            <p className="text-xs text-slate-500 truncate">{p.nom_dirigeant}</p>
          </div>
          <Link to={`/prospects/${p.id}`}><ExternalLink className="w-4 h-4 text-slate-400 hover:text-[#5A9BA3] shrink-0 transition-colors" /></Link>
        </div>
        <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
          <span className="font-medium">{(p.montant_potentiel || 0).toLocaleString('fr-FR')} €</span>
          <span>{p.nombre_appels} appels</span>
        </div>
        <Select value={p.statut_avancement} onValueChange={(val) => onMove(p.id, val)}>
          <SelectTrigger className="h-7 text-xs rounded-lg border-slate-200"><SelectValue /></SelectTrigger>
          <SelectContent>{PIPELINE_STAGES.map((s) => <SelectItem key={s.key} value={s.key} className="text-xs">{s.label}</SelectItem>)}</SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
});
