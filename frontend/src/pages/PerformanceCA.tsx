import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  useProspects, useRegisteredUsers, useObjectifsCA, useUpsertObjectifCA,
} from '../hooks/use-prospects';
import ErrorState from '../components/ErrorState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { TrendingUp, Target, Wallet, CheckCircle2, Pencil, Check, X } from 'lucide-react';

// Dossiers "gagnés" mais pas encore confirmés/transmis à Mathilde -> CA probable.
const PROBABLE_STAGES = new Set(['Signature', 'Dossier complet']);

const eur = (n: number) =>
  n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

// 'YYYY-MM' -> 'YYYY-MM-01' (format attendu par la colonne objectifs_ca.mois)
const moisToDate = (mois: string) => `${mois}-01`;

export default function PerformanceCA() {
  const { isAdmin, userRole } = useAuth();
  const { data: prospects = [], isLoading: loadingP, error: errorP } = useProspects();
  const { data: registeredUsers = [], isLoading: loadingU } = useRegisteredUsers();
  const { data: objectifs = [], isLoading: loadingO } = useObjectifsCA();
  const upsertObjectif = useUpsertObjectifCA();

  const now = new Date();
  const [mois, setMois] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const loading = loadingP || loadingU || loadingO;

  const commerciaux = useMemo(
    () => registeredUsers.filter((u) => u.is_active && (u.role === 'commercial' || u.role === 'admin')),
    [registeredUsers]
  );

  const rows = useMemo(() => {
    return commerciaux.map((u) => {
      // Un dossier est rattaché au mois de sa signature (date_signature),
      // quel que soit l'écran où on le regarde ensuite (probable, confirmé
      // ou encaissé restent dans le même mois — c'est l'argent de ce mois-là).
      const deals = prospects.filter((p) => {
        if (p.signed_by_user_id !== u.id) return false;
        if (!p.date_signature) return false;
        return p.date_signature.slice(0, 7) === mois;
      });

      let probable = 0, confirme = 0, encaisse = 0;
      for (const p of deals) {
        const montant = Number(p.montant_potentiel) || 0;
        if (p.ca_encaisse) encaisse += montant;
        else if (p.statut_avancement === 'Envoyé à Mathilde') confirme += montant;
        else if (PROBABLE_STAGES.has(p.statut_avancement)) probable += montant;
      }
      const realise = probable + confirme + encaisse;

      const objectifRow = objectifs.find((o) => o.user_role_id === u.id && o.mois.slice(0, 7) === mois);
      const objectifCa = objectifRow?.objectif_ca ?? 0;
      const pct = objectifCa > 0 ? Math.round((realise / objectifCa) * 100) : null;

      return {
        user: u,
        probable, confirme, encaisse, realise,
        objectifCa, objectifId: objectifRow?.id,
        pct, dealsCount: deals.length,
      };
    });
  }, [commerciaux, prospects, objectifs, mois]);

  const visibleRows = isAdmin ? rows : rows.filter((r) => r.user.id === userRole?.id);

  const totals = useMemo(() => visibleRows.reduce(
    (acc, r) => ({
      probable: acc.probable + r.probable,
      confirme: acc.confirme + r.confirme,
      encaisse: acc.encaisse + r.encaisse,
      realise: acc.realise + r.realise,
      objectifCa: acc.objectifCa + r.objectifCa,
    }),
    { probable: 0, confirme: 0, encaisse: 0, realise: 0, objectifCa: 0 }
  ), [visibleRows]);

  const startEdit = (rowUserId: number, objectifId: number | undefined, current: number) => {
    setEditingId(rowUserId);
    setEditValue(current ? String(current) : '');
    void objectifId;
  };

  const saveObjectif = async (row: (typeof rows)[number]) => {
    const val = Number(editValue.replace(',', '.'));
    if (Number.isNaN(val) || val < 0) { toast.error('Montant invalide'); return; }
    try {
      await upsertObjectif.mutateAsync({
        userRoleId: row.user.id, mois: moisToDate(mois), objectifCa: val, existingId: row.objectifId,
      });
      toast.success('Objectif mis à jour');
      setEditingId(null);
    } catch {
      toast.error("Erreur lors de l'enregistrement de l'objectif");
    }
  };

  if (errorP) return <ErrorState message="Erreur de chargement des données." />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-[#5A9BA3]" /> Performance CA
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            CA probable (dossiers gagnés), confirmé (transmis à Mathilde) et encaissé, par commercial.
          </p>
        </div>
        <Input
          type="month"
          value={mois}
          onChange={(e) => setMois(e.target.value)}
          className="w-44 rounded-xl"
        />
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-12 text-center">Chargement...</div>
      ) : (
        <>
          {/* Totaux globaux */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'CA probable', value: totals.probable, icon: TrendingUp, color: 'text-amber-600 bg-amber-50' },
              { label: 'CA confirmé', value: totals.confirme, icon: CheckCircle2, color: 'text-sky-600 bg-sky-50' },
              { label: 'CA encaissé', value: totals.encaisse, icon: Wallet, color: 'text-emerald-600 bg-emerald-50' },
              { label: 'Objectif total', value: totals.objectifCa, icon: Target, color: 'text-slate-600 bg-slate-100' },
            ].map((k) => (
              <Card key={k.label} className="border-0 shadow-sm rounded-2xl">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${k.color}`}>
                    <k.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">{k.label}</p>
                    <p className="text-lg font-bold text-slate-800">{eur(k.value)}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Tableau par commercial */}
          <Card className="border-0 shadow-sm rounded-2xl">
            <CardHeader><CardTitle className="text-lg">Détail par commercial</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-100">
                    <th className="py-2 pr-4 font-medium">Commercial</th>
                    <th className="py-2 pr-4 font-medium text-right">CA probable</th>
                    <th className="py-2 pr-4 font-medium text-right">CA confirmé</th>
                    <th className="py-2 pr-4 font-medium text-right">CA encaissé</th>
                    <th className="py-2 pr-4 font-medium text-right">Réalisé</th>
                    <th className="py-2 pr-4 font-medium text-right">Objectif</th>
                    <th className="py-2 pr-4 font-medium text-right">% atteint</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => (
                    <tr key={r.user.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-3 pr-4 font-medium text-slate-700">
                        {r.user.first_name} {r.user.last_name}
                        <span className="text-xs text-slate-400 ml-1.5">({r.dealsCount} dossier{r.dealsCount > 1 ? 's' : ''})</span>
                      </td>
                      <td className="py-3 pr-4 text-right text-amber-600">{eur(r.probable)}</td>
                      <td className="py-3 pr-4 text-right text-sky-600">{eur(r.confirme)}</td>
                      <td className="py-3 pr-4 text-right text-emerald-600 font-semibold">{eur(r.encaisse)}</td>
                      <td className="py-3 pr-4 text-right font-semibold text-slate-800">{eur(r.realise)}</td>
                      <td className="py-3 pr-4 text-right">
                        {editingId === r.user.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              autoFocus
                              type="number"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="w-24 h-8 rounded-lg text-right"
                            />
                            <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => saveObjectif(r)}>
                              <Check className="w-4 h-4 text-emerald-600" />
                            </Button>
                            <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => setEditingId(null)}>
                              <X className="w-4 h-4 text-slate-400" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="text-slate-600">{r.objectifCa ? eur(r.objectifCa) : '-'}</span>
                            {isAdmin && (
                              <button onClick={() => startEdit(r.user.id, r.objectifId, r.objectifCa)} className="text-slate-300 hover:text-slate-600">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        {r.pct === null ? (
                          <span className="text-slate-300">-</span>
                        ) : (
                          <span className={`font-semibold ${r.pct >= 100 ? 'text-emerald-600' : r.pct >= 60 ? 'text-amber-600' : 'text-red-500'}`}>
                            {r.pct}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {visibleRows.length === 0 && (
                    <tr><td colSpan={7} className="py-8 text-center text-slate-400">Aucune donnée pour ce mois.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
