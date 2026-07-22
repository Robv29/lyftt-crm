import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  useProspects, useRegisteredUsers, useObjectifsCA, useUpsertObjectifCA, useUpdateTauxCommission,
  usePaiements, useAddPaiement, useDeletePaiement, useInvalidateProspects, type Prospect,
} from '../hooks/use-prospects';
import { client } from '../lib/api';
import ErrorState from '../components/ErrorState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  TrendingUp, Target, Wallet, CheckCircle2, Pencil, Check, X,
  Trophy, Flame, Percent, Search, Plus, Trash2, Receipt,
  AlertTriangle, ExternalLink, PiggyBank,
} from 'lucide-react';

// Dossiers "gagnés" mais pas encore confirmés/transmis à Mathilde -> CA probable.
const PROBABLE_STAGES = new Set(['Signature', 'Dossier complet']);
// Tous les dossiers "clients signés" (peu importe l'étape) pour l'onglet paiements.
const WON_STAGES = new Set(['Signature', 'Dossier complet', 'Envoyé à Mathilde']);

const eur = (n: number) =>
  n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

// 'YYYY-MM' -> 'YYYY-MM-01' (format attendu par la colonne objectifs_ca.mois)
const moisToDate = (mois: string) => `${mois}-01`;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Jours ouvrés (lun-ven) restants dans le mois, aujourd'hui inclus. Ne tient
// pas compte des jours fériés (raffinement possible plus tard si besoin).
function joursOuvresRestants(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  let count = 0;
  for (let d = now.getDate(); d <= lastDay; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), d).getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

export default function PerformanceCA() {
  const { isAdmin, userRole } = useAuth();
  const { data: prospects = [], isLoading: loadingP, error: errorP } = useProspects();
  const { data: registeredUsers = [], isLoading: loadingU } = useRegisteredUsers();
  const { data: objectifs = [], isLoading: loadingO } = useObjectifsCA();
  const { data: paiements = [], isLoading: loadingPmt } = usePaiements();
  const upsertObjectif = useUpsertObjectifCA();
  const updateTaux = useUpdateTauxCommission();
  const addPaiement = useAddPaiement();
  const deletePaiement = useDeletePaiement();
  const invalidateProspects = useInvalidateProspects();

  const now = new Date();
  const moisCourant = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [tab, setTab] = useState<'apercu' | 'paiements'>('apercu');
  const [mois, setMois] = useState(moisCourant);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editingTauxId, setEditingTauxId] = useState<number | null>(null);
  const [editTauxValue, setEditTauxValue] = useState('');

  // --- Onglet "Suivi paiements clients" ---
  const [search, setSearch] = useState('');
  const [commercialFilter, setCommercialFilter] = useState('tous');
  const [editingCaMaxId, setEditingCaMaxId] = useState<number | null>(null);
  const [editCaMaxValue, setEditCaMaxValue] = useState('');
  const [addingPaiementFor, setAddingPaiementFor] = useState<number | null>(null);
  const [newMontant, setNewMontant] = useState('');
  const [newDate, setNewDate] = useState(today());
  const [newNote, setNewNote] = useState('');

  const loading = loadingP || loadingU || loadingO || loadingPmt;
  const isMoisCourant = mois === moisCourant;

  const commerciaux = useMemo(
    () => registeredUsers.filter((u) => u.is_active && (u.role === 'commercial' || u.role === 'admin')),
    [registeredUsers]
  );

  // Total réglé par dossier — remplace l'ancien flag binaire ca_encaisse : un
  // client peut payer en plusieurs fois, chaque règlement a sa propre date.
  const paiementsByProspect = useMemo(() => {
    const map = new Map<number, number>();
    for (const pmt of paiements) {
      map.set(pmt.prospect_id, (map.get(pmt.prospect_id) || 0) + Number(pmt.montant));
    }
    return map;
  }, [paiements]);

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
        const montantMax = Number(p.montant_potentiel) || 0;
        const paye = Math.min(paiementsByProspect.get(p.id) || 0, montantMax);
        encaisse += paye;
        const restant = montantMax - paye;
        if (restant > 0) {
          if (p.statut_avancement === 'Envoyé à Mathilde') confirme += restant;
          else if (PROBABLE_STAGES.has(p.statut_avancement)) probable += restant;
        }
      }
      const realise = probable + confirme + encaisse;

      // La commission se calcule sur les RÈGLEMENTS reçus ce mois-ci (mois de
      // paiement réel de chaque règlement), pas sur le mois de signature —
      // chaque règlement génère sa part de commission dès qu'il est encaissé.
      const taux = Number(u.taux_commission) || 0;
      const paiementsDuMoisPourCeCommercial = paiements.filter((pmt) => {
        if (pmt.date_paiement.slice(0, 7) !== mois) return false;
        const p = prospects.find((pp) => pp.id === pmt.prospect_id);
        return p?.signed_by_user_id === u.id;
      });
      const assietteCommission = paiementsDuMoisPourCeCommercial.reduce((s, pmt) => s + Number(pmt.montant), 0);
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
  }, [commerciaux, prospects, objectifs, paiements, paiementsByProspect, mois, isMoisCourant]);

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

  // --- Suivi paiements clients : tous les dossiers signés, tous mois confondus ---
  const clientsSignes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return prospects
      .filter((p) => WON_STAGES.has(p.statut_avancement))
      .filter((p) => !q || p.nom_societe?.toLowerCase().includes(q))
      .filter((p) => commercialFilter === 'tous' || String(p.signed_by_user_id) === commercialFilter)
      .map((p) => {
        const max = Number(p.montant_potentiel) || 0;
        const paye = paiementsByProspect.get(p.id) || 0;
        const pct = max > 0 ? Math.min(100, Math.round((paye / max) * 100)) : 0;
        const commercialUser = commerciaux.find((u) => u.id === p.signed_by_user_id);
        const commercialName = commercialUser ? `${commercialUser.first_name || ''} ${commercialUser.last_name || ''}`.trim() : 'Non attribué';
        const pmts = paiements
          .filter((pmt) => pmt.prospect_id === p.id)
          .sort((a, b) => b.date_paiement.localeCompare(a.date_paiement));
        return { prospect: p, max, paye, pct, commercialName, pmts };
      })
      .sort((a, b) => a.prospect.nom_societe.localeCompare(b.prospect.nom_societe, 'fr'));
  }, [prospects, paiementsByProspect, paiements, commerciaux, search, commercialFilter]);

  // Reste à encaisser sur TOUS les clients signés (pas seulement ceux filtrés
  // par la recherche/commercial) — vision globale de ce qu'il reste à percevoir.
  const resteAEncaisserTotal = useMemo(() => {
    return prospects
      .filter((p) => WON_STAGES.has(p.statut_avancement))
      .reduce((sum, p) => {
        const max = Number(p.montant_potentiel) || 0;
        const paye = Math.min(paiementsByProspect.get(p.id) || 0, max);
        return sum + Math.max(0, max - paye);
      }, 0);
  }, [prospects, paiementsByProspect]);

  const clientsSansCaMax = useMemo(
    () => prospects.filter((p) => WON_STAGES.has(p.statut_avancement) && !(Number(p.montant_potentiel) > 0)).length,
    [prospects]
  );

  const saveCaMax = async (p: Prospect) => {
    const val = Number(editCaMaxValue.replace(',', '.'));
    if (Number.isNaN(val) || val < 0) { toast.error('Montant invalide'); return; }
    try {
      await client.entities.prospects.update({ id: String(p.id), data: { montant_potentiel: val } });
      toast.success('CA max mis à jour');
      setEditingCaMaxId(null);
      invalidateProspects();
    } catch {
      toast.error("Erreur lors de l'enregistrement du CA max");
    }
  };

  const savePaiement = async (prospectId: number) => {
    const val = Number(newMontant.replace(',', '.'));
    if (Number.isNaN(val) || val <= 0) { toast.error('Montant invalide'); return; }
    if (!newDate) { toast.error('Date requise'); return; }
    try {
      await addPaiement.mutateAsync({ prospectId, montant: val, datePaiement: newDate, note: newNote.trim() || undefined });
      toast.success('Règlement enregistré — prime recalculée automatiquement');
      setAddingPaiementFor(null);
      setNewMontant('');
      setNewDate(today());
      setNewNote('');
    } catch {
      toast.error("Erreur lors de l'enregistrement du règlement");
    }
  };

  // Raccourci "Marquer soldé" : pré-remplit le formulaire avec le reste à
  // encaisser exact et la date du jour, pour éviter la saisie manuelle du
  // dernier règlement quand le client vient de tout payer.
  const startSolde = (prospectId: number, max: number, paye: number) => {
    setAddingPaiementFor(prospectId);
    setNewMontant(String(Math.max(0, max - paye)));
    setNewDate(today());
    setNewNote('Solde');
  };

  const removePaiement = async (id: number) => {
    try {
      await deletePaiement.mutateAsync(id);
      toast.success('Règlement supprimé');
    } catch {
      toast.error('Erreur lors de la suppression');
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
        {tab === 'apercu' && (
          <Input
            type="month"
            value={mois}
            onChange={(e) => setMois(e.target.value)}
            className="w-44 rounded-xl"
          />
        )}
      </div>

      {/* Onglets */}
      <div className="flex gap-2">
        <Button
          variant={tab === 'apercu' ? 'default' : 'outline'}
          onClick={() => setTab('apercu')}
          className={`rounded-xl ${tab === 'apercu' ? 'bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] text-white' : ''}`}
        >
          Aperçu du mois
        </Button>
        <Button
          variant={tab === 'paiements' ? 'default' : 'outline'}
          onClick={() => setTab('paiements')}
          className={`rounded-xl gap-1.5 ${tab === 'paiements' ? 'bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] text-white' : ''}`}
        >
          <Receipt className="w-4 h-4" /> Suivi paiements clients
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-12 text-center">Chargement...</div>
      ) : tab === 'paiements' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm rounded-2xl">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-orange-600 bg-orange-50">
                  <PiggyBank className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Reste à encaisser (tous clients signés)</p>
                  <p className="text-lg font-bold text-slate-800">{eur(resteAEncaisserTotal)}</p>
                </div>
              </CardContent>
            </Card>
            {clientsSansCaMax > 0 && (
              <Card className="border-0 shadow-sm rounded-2xl bg-amber-50">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-amber-600 bg-amber-100">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs text-amber-700 font-medium">
                      {clientsSansCaMax} client{clientsSansCaMax > 1 ? 's' : ''} signé{clientsSansCaMax > 1 ? 's' : ''} sans CA max renseigné
                    </p>
                    <p className="text-xs text-amber-600">La barre de progression et les commissions restent à 0 tant que ce n'est pas rempli.</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un client..."
                className="pl-9 rounded-xl"
              />
            </div>
            <Select value={commercialFilter} onValueChange={setCommercialFilter}>
              <SelectTrigger className="w-full sm:w-56 rounded-xl">
                <SelectValue placeholder="Tous les commerciaux" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">Tous les commerciaux</SelectItem>
                {commerciaux.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>{u.first_name} {u.last_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {clientsSignes.length === 0 ? (
            <Card className="border-0 shadow-sm rounded-2xl">
              <CardContent className="py-12 text-center text-sm text-slate-400">Aucun client signé pour le moment.</CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {clientsSignes.map(({ prospect: p, max, paye, pct, commercialName, pmts }) => (
                <Card key={p.id} className="border-0 shadow-sm rounded-2xl">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="font-semibold text-slate-800">{p.nom_societe}</p>
                          <Link to={`/prospects/${p.id}`} className="text-slate-300 hover:text-[#5A9BA3]" title="Ouvrir la fiche client">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                        <p className="text-xs text-slate-400">{commercialName} · {p.statut_avancement}</p>
                        {max === 0 && (
                          <p className="text-xs text-amber-600 font-medium flex items-center gap-1 mt-0.5">
                            <AlertTriangle className="w-3 h-3" /> CA max non renseigné
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500 mb-0.5">CA max</p>
                        {editingCaMaxId === p.id ? (
                          <div className="flex items-center gap-1">
                            <Input
                              autoFocus
                              type="number"
                              value={editCaMaxValue}
                              onChange={(e) => setEditCaMaxValue(e.target.value)}
                              className="w-28 h-8 rounded-lg text-right"
                            />
                            <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => saveCaMax(p)}>
                              <Check className="w-4 h-4 text-emerald-600" />
                            </Button>
                            <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => setEditingCaMaxId(null)}>
                              <X className="w-4 h-4 text-slate-400" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 justify-end">
                            <span className="font-semibold text-slate-700">{eur(max)}</span>
                            {isAdmin && (
                              <button onClick={() => { setEditingCaMaxId(p.id); setEditCaMaxValue(max ? String(max) : ''); }} className="text-slate-300 hover:text-slate-600">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Barre de progression — visible à tous */}
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-slate-500">Réglé : <strong className="text-emerald-600">{eur(paye)}</strong> / {eur(max)}</span>
                        <span className="font-semibold text-slate-600">{pct}%</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-emerald-400 to-emerald-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {/* Règlements */}
                    {pmts.length > 0 && (
                      <div className="space-y-1 pt-1">
                        {pmts.map((pmt) => (
                          <div key={pmt.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-2.5 py-1.5">
                            <span className="text-slate-500">
                              {new Date(pmt.date_paiement).toLocaleDateString('fr-FR')}
                              {pmt.note && <span className="text-slate-400 italic ml-1.5">· {pmt.note}</span>}
                            </span>
                            <span className="font-semibold text-slate-700">{eur(Number(pmt.montant))}</span>
                            {isAdmin && (
                              <button onClick={() => removePaiement(pmt.id)} className="text-slate-300 hover:text-red-500">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {isAdmin && (
                      addingPaiementFor === p.id ? (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="w-36 h-8 rounded-lg" />
                          <Input type="number" placeholder="Montant" value={newMontant} onChange={(e) => setNewMontant(e.target.value)} className="w-28 h-8 rounded-lg" />
                          <Input type="text" placeholder="Note (optionnel)" value={newNote} onChange={(e) => setNewNote(e.target.value)} className="w-36 h-8 rounded-lg" />
                          <Button size="sm" onClick={() => savePaiement(p.id)} className="h-8 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white px-2.5"><Check className="w-3.5 h-3.5" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => { setAddingPaiementFor(null); setNewNote(''); }} className="h-8 rounded-lg px-2.5 text-slate-400"><X className="w-3.5 h-3.5" /></Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 pt-1">
                          <button
                            onClick={() => { setAddingPaiementFor(p.id); setNewMontant(''); setNewDate(today()); setNewNote(''); }}
                            className="text-xs font-semibold text-[#5A9BA3] hover:text-[#4A8B93] flex items-center gap-1"
                          >
                            <Plus className="w-3.5 h-3.5" /> Ajouter un règlement
                          </button>
                          {max > 0 && paye < max && (
                            <button
                              onClick={() => startSolde(p.id, max, paye)}
                              className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" /> Marquer soldé ({eur(max - paye)})
                            </button>
                          )}
                        </div>
                      )
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
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
                La commission est calculée sur les règlements reçus <strong>ce mois-ci</strong> (voir l'onglet "Suivi paiements clients"), indépendamment du mois de signature du dossier.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
