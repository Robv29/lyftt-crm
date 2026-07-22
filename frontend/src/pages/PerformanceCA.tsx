import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  useProspects, useRegisteredUsers, useObjectifsCA, useUpsertObjectifCA, useUpdateTauxCommission,
} from '../hooks/use-prospects';
import ErrorState from '../components/ErrorState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  TrendingUp, Target, Wallet, CheckCircle2, Pencil, Check, X,
  Trophy, Flame, Percent,
} from 'lucide-react';

// Dossiers "gagnés" mais pas encore confirmés/transmis à Mathilde -> CA probable.
const PROBABLE_STAGES = new Set(['Signature', 'Dossier complet']);

const eur = (n: number) =>
  n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

// 'YYYY-MM' -> 'YYYY-MM-01' (format attendu par la colonne objectifs_ca.mois)
const moisToDate = (mois: string) => `${mois}-01`;

// Jours ouvrés (lun-ven) restants dans le mois, aujourd'hui inclus. Ne tient
// pas compte des jours fériés (raffinement possible plus tard si besoin).
function joursOuvresRestants(): number {
  const today = new Date();
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  let count = 0;
  for (let d = today.getDate(); d <= lastDay; d++) {
    const day = new Date(today.getFullYear(), today.getMonth(), d).getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

export default function PerformanceCA() {
  const { isAdmin, userRole } = useAuth();
  const { data: prospects = [], isLoading: loadingP, error: errorP } = useProspects();
  const { data: registeredUsers = [], isLoading: loadingU } = useRegisteredUsers();
  const { data: objectifs = [], isLoading: loadingO } = useObjectifsCA();
  const upsertObjectif = useUpsertObjectifCA();
  const updateTaux = useUpdateTauxCommission();

  const now = new Date();
  const moisCourant = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [mois, setMois] = useState(moisCourant);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editingTauxId, setEditingTauxId] = useState<number | null>(null);
  const [editTauxValue, setEditTauxValue] = useState('');

  const loading = loadingP || loadingU || loadingO;
  const isMoisCourant = mois === moisCourant;

  const commerciaux = useMemo(
    () => registeredUsers.filter((u) => u.is_active && (u.role === 'commercial' || u.role === 'admin')),
    [registeredUsers]
  );

  const rows = useMemo(() => {
    return commerciaux.map((u) => {
      // Un dossier est rattaché au mois de sa signature (date_signature) pour
      // le probable/confirmé/encaissé "de ce mois" — c'est l'argent généré ce
      // mois-là, quel que soit l'écran où on le regarde ensuite.
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

      // La commission, elle, se calcule sur le mois de PAIE = mois de
      // l'encaissement (date_encaissement), pas le mois de signature — c'est
      // l'argent réellement collecté et payable ce mois-ci.
      const taux = Number(u.taux_commission) || 0;
      const encaisseCeMoisPourPaie = prospects.filter((p) =>
        p.signed_by_user_id === u.id && p.ca_encaisse && p.date_encaissement?.slice(0, 7) === mois
      );
      const assietteCommission = encaisseCeMoisPourPaie.reduce((s, p) => s + (Number(p.montant_potentiel) || 0), 0);
      const commission = assietteCommission * (taux / 100);

      const objectifRow = objectifs.find((o) => o.user_role_id === u.id && o.mois.slice(0, 7) === mois);
      const objectifCa = objectifRow?.objectif_ca ?? 0;
      const pct = objectifCa > 0 ? Math.round((realise / objectifCa) * 100) : null;

      const ecart = objectifCa - realise;
      const jo = joursOuvresRestants();
      const parJourNecessaire = isMoisCourant && ecart > 0 && jo > 0 ? ecart / jo : 0;

      return {
        user: u,
        probable, confirme, encaisse, realise,
        objectifCa, objectifId: objectifRow?.id,
        pct, dealsCount: deals.length,
        taux, commission, assietteCommission,
        ecart, parJourNecessaire,
      };
    });
  }, [commerciaux, prospects, objectifs, mois, isMoisCourant]);

  const visibleRows = isAdmin ? rows : rows.filter((r) => r.user.id === userRole?.id);

  const totals = useMemo(() => visibleRows.reduce(
    (acc, r) => ({
      probable: acc.probable + r.probable,
      confirme: acc.confirme + r.confirme,
      encaisse: acc.encaisse + r.encaisse,
      realise: acc.realise + r.realise,
      objectifCa: acc.objectifCa + r.objectifCa,
      commission: acc.commission + r.commission,
    }),
    { probable: 0, confirme: 0, encaisse: 0, realise: 0, objectifCa: 0, commission: 0 }
  ), [visibleRows]);

  // Classement : par % d'objectif atteint (ceux sans objectif défini passent
  // après, triés par CA réalisé) — visible à tous, c'est le côté gamification.
  const classement = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (a.pct !== null && b.pct !== null) return b.pct - a.pct;
      if (a.pct !== null) return -1;
      if (b.pct !== null) return 1;
      return b.realise - a.realise;
    });
  }, [rows]);

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

  const saveTaux = async (row: (typeof rows)[number]) => {
    const val = Number(editTauxValue.replace(',', '.'));
    if (Number.isNaN(val) || val < 0 || val > 100) { toast.error('Taux invalide (0-100)'); return; }
    try {
      await updateTaux.mutateAsync({ userId: row.user.id, taux: val });
      toast.success('Taux de commission mis à jour');
      setEditingTauxId(null);
    } catch {
      toast.error("Erreur lors de l'enregistrement du taux");
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
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { label: 'CA probable', value: totals.probable, icon: TrendingUp, color: 'text-amber-600 bg-amber-50' },
              { label: 'CA confirmé', value: totals.confirme, icon: CheckCircle2, color: 'text-sky-600 bg-sky-50' },
              { label: 'CA encaissé', value: totals.encaisse, icon: Wallet, color: 'text-emerald-600 bg-emerald-50' },
              { label: 'Objectif total', value: totals.objectifCa, icon: Target, color: 'text-slate-600 bg-slate-100' },
              { label: 'Commissions (paie)', value: totals.commission, icon: Percent, color: 'text-purple-600 bg-purple-50' },
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

          {/* Rattrapage — uniquement pertinent sur le mois en cours */}
          {isMoisCourant && (
            <Card className="border-0 shadow-sm rounded-2xl">
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Flame className="w-5 h-5 text-orange-500" /> Rattrapage — mois en cours</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {visibleRows.filter((r) => r.objectifCa > 0).length === 0 ? (
                  <p className="text-sm text-slate-400">Aucun objectif défini ce mois-ci.</p>
                ) : (
                  visibleRows.filter((r) => r.objectifCa > 0).map((r) => (
                    <div key={r.user.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50">
                      <span className="text-sm font-medium text-slate-700">{r.user.first_name} {r.user.last_name}</span>
                      {r.ecart <= 0 ? (
                        <span className="text-sm font-semibold text-emerald-600 flex items-center gap-1"><Trophy className="w-4 h-4" /> Objectif atteint</span>
                      ) : (
                        <span className="text-sm text-orange-600">
                          Il manque <span className="font-semibold">{eur(r.ecart)}</span>
                          {joursOuvresRestants() > 0 && (
                            <> — soit <span className="font-semibold">{eur(r.parJourNecessaire)}</span>/jour ouvré sur {joursOuvresRestants()} j. restants</>
                          )}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          )}

          {/* Classement — gamification, visible à tous */}
          <Card className="border-0 shadow-sm rounded-2xl">
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Trophy className="w-5 h-5 text-amber-500" /> Classement du mois</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {classement.map((r, idx) => (
                <div key={r.user.id} className={`flex items-center justify-between p-2.5 rounded-xl ${r.user.id === userRole?.id ? 'bg-[#5A9BA3]/10' : 'bg-slate-50'}`}>
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-center text-sm font-bold text-slate-400">
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                    </span>
                    <span className="text-sm font-medium text-slate-700">{r.user.first_name} {r.user.last_name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-slate-500">{eur(r.realise)}</span>
                    {r.pct !== null && (
                      <span className={`font-semibold ${r.pct >= 100 ? 'text-emerald-600' : r.pct >= 60 ? 'text-amber-600' : 'text-red-500'}`}>{r.pct}%</span>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

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
                    <th className="py-2 pr-4 font-medium text-right">Taux comm.</th>
                    <th className="py-2 pr-4 font-medium text-right">Commission (paie)</th>
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
                      <td className="py-3 pr-4 text-right">
                        {editingTauxId === r.user.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              autoFocus
                              type="number"
                              value={editTauxValue}
                              onChange={(e) => setEditTauxValue(e.target.value)}
                              className="w-16 h-8 rounded-lg text-right"
                            />
                            <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => saveTaux(r)}>
                              <Check className="w-4 h-4 text-emerald-600" />
                            </Button>
                            <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => setEditingTauxId(null)}>
                              <X className="w-4 h-4 text-slate-400" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="text-slate-600">{r.taux ? `${r.taux}%` : '-'}</span>
                            {isAdmin && (
                              <button onClick={() => { setEditingTauxId(r.user.id); setEditTauxValue(r.taux ? String(r.taux) : ''); }} className="text-slate-300 hover:text-slate-600">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right font-semibold text-purple-600">{eur(r.commission)}</td>
                    </tr>
                  ))}
                  {visibleRows.length === 0 && (
                    <tr><td colSpan={9} className="py-8 text-center text-slate-400">Aucune donnée pour ce mois.</td></tr>
                  )}
                </tbody>
              </table>
              <p className="text-xs text-slate-400 mt-3">
                La commission est calculée sur le CA encaissé <strong>ce mois-ci</strong> (mois de paiement réel), indépendamment du mois de signature du dossier.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
