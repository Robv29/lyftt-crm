import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePersistentState } from '../hooks/use-persistent-state';
import {
  useProspects, useRegisteredUsers, useObjectifsCA, useUpsertObjectifCA, useUpdateTauxCommission,
  usePaiements, useAddPaiement, useDeletePaiement, useInvalidateProspects, type Prospect,
} from '../hooks/use-prospects';
import { client } from '../lib/api';
import ErrorState from '../components/ErrorState';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Target, Wallet, CheckCircle2, Pencil, Check, X,
  Trophy, Flame, Search, Plus, Trash2, Receipt,
  AlertTriangle, ExternalLink, PiggyBank, Download,
  ArrowUpRight, Banknote, Home, Info, Lock, Moon, Sun, RefreshCw,
  CalendarDays, Users, Zap, MoreHorizontal, Crosshair, Star, ShieldCheck,
} from 'lucide-react';

const MONTH_NAMES = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

// Dossiers "gagnés" mais pas encore confirmés/transmis à Mathilde -> CA probable.
const PROBABLE_STAGES = new Set(['Signature', 'Dossier complet']);
// Tous les dossiers "clients signés" (peu importe l'étape) pour l'onglet paiements.
const WON_STAGES = new Set(['Signature', 'Dossier complet', 'Envoyé à Mathilde']);
// Classement par statut de règlement pour l'onglet "Suivi paiements clients"
// (du plus urgent/à traiter au plus abouti) : CA non renseigné en premier
// (impossible de savoir où on en est tant que ce n'est pas rempli), puis
// aucun paiement reçu, puis paiement partiel, puis soldé en dernier.
const PAIEMENT_STATUT_LABELS = ['CA non renseigné', 'Pas de paiement reçu', 'Paiement pas reçu en totalité', 'Paiement reçu'] as const;
function paiementStatutRank(max: number, paye: number): number {
  if (!(max > 0)) return 0;
  if (paye <= 0) return 1;
  if (paye < max) return 2;
  return 3;
}

const eur = (n: number) =>
  n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

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

// Paliers de la jauge de gamification "Niveau" (CA probable cumulé du mois).
// Échelle fixe et commune à toute l'équipe, indépendante de l'objectif
// individuel de chacun. Uniquement affichée en vue "un commercial" — jamais
// en vue "Tous les commerciaux" (un niveau individuel n'a pas de sens agrégé).
type GameLevel = { level: number; amount: number };
const LEVELS: GameLevel[] = [
  { level: 1, amount: 2000 },
  { level: 2, amount: 4000 },
  { level: 3, amount: 6000 },
  { level: 4, amount: 8000 },
  { level: 5, amount: 10000 },
  { level: 6, amount: 12000 },
  { level: 7, amount: 15000 },
  { level: 8, amount: 18000 },
  { level: 9, amount: 21000 },
  { level: 10, amount: 25000 },
];

// 'YYYY-MM' -> 'YYYY-MM' du mois précédent (pour un vrai comparatif d'un mois
// sur l'autre sur les KPI, sans jamais inventer de chiffre).
function shiftMonth(mois: string, delta: number): string {
  const [y, m] = mois.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Évolution en % vs le mois précédent. Retourne null si le mois précédent est
// à 0 (comparaison non pertinente) plutôt que d'afficher un faux pourcentage.
function growthPct(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

type RowAgg = { probable: number; confirme: number; encaisse: number; realise: number; objectifCa: number; commission: number };
function aggregateRows(rowsArr: RowAgg[]): RowAgg {
  return rowsArr.reduce(
    (acc, r) => ({
      probable: acc.probable + r.probable,
      confirme: acc.confirme + r.confirme,
      encaisse: acc.encaisse + r.encaisse,
      realise: acc.realise + r.realise,
      objectifCa: acc.objectifCa + r.objectifCa,
      commission: acc.commission + r.commission,
    }),
    { probable: 0, confirme: 0, encaisse: 0, realise: 0, objectifCa: 0, commission: 0 }
  );
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
  // Etat de la page persistant (localStorage) : on garde l'onglet, le mois, le
  // thème, la vue (globale/commercial) et les filtres d'une visite à l'autre.
  const [tab, setTab] = usePersistentState<'apercu' | 'paiements'>('lyftt.performanceCa.tab', 'apercu');
  const [mois, setMois] = usePersistentState<string>('lyftt.performanceCa.mois', moisCourant);
  const [theme, setTheme] = usePersistentState<'dark' | 'light'>('lyftt.performanceCa.theme', 'dark');
  // Vue Aperçu : 'tous' = équipe complète (admin uniquement) ; sinon l'id du
  // commercial affiché. Un commercial non-admin n'a jamais accès au sélecteur
  // et ne voit toujours que ses propres données.
  const [heroCommercialId, setHeroCommercialId] = usePersistentState<string>('lyftt.performanceCa.heroCommercialId', 'tous');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editingTauxId, setEditingTauxId] = useState<number | null>(null);
  const [editTauxValue, setEditTauxValue] = useState('');

  // --- Onglet "Suivi paiements clients" ---
  const [search, setSearch] = usePersistentState<string>('lyftt.performanceCa.search', '');
  const [commercialFilter, setCommercialFilter] = usePersistentState<string>('lyftt.performanceCa.commercialFilter', 'tous');
  const [statutFilter, setStatutFilter] = usePersistentState<string>('lyftt.performanceCa.statutFilter', 'tous');
  const [editingCaMaxId, setEditingCaMaxId] = useState<number | null>(null);
  const [editCaMaxValue, setEditCaMaxValue] = useState('');
  const [addingPaiementFor, setAddingPaiementFor] = useState<number | null>(null);
  const [newMontant, setNewMontant] = useState('');
  const [newDate, setNewDate] = useState(today());
  const [newNote, setNewNote] = useState('');

  const loading = loadingP || loadingU || loadingO || loadingPmt;
  const isMoisCourant = mois === moisCourant;
  // Les deux vues appartiennent au même module : le thème reste donc cohérent
  // quand on bascule de l'aperçu au suivi des paiements.
  const isDark = theme === 'dark';

  // Sélecteurs mois / année séparés (plus fiables que l'input date natif,
  // notamment pour naviguer rapidement d'une année à l'autre).
  const selectedYear = mois.slice(0, 4);
  const selectedMonthIdx = Number(mois.slice(5, 7)) - 1;
  const yearsOptions = useMemo(() => {
    const years = new Set<number>([now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]);
    for (const p of prospects) {
      if (p.date_signature) years.add(Number(p.date_signature.slice(0, 4)));
    }
    for (const o of objectifs) {
      if (o.mois) years.add(Number(o.mois.slice(0, 4)));
    }
    return Array.from(years).filter((y) => y > 2000 && y < 3000).sort((a, b) => a - b);
  }, [prospects, objectifs]);
  const setMonthPart = (idx: string) => setMois(`${selectedYear}-${String(Number(idx) + 1).padStart(2, '0')}`);
  const setYearPart = (y: string) => setMois(`${y}-${String(selectedMonthIdx + 1).padStart(2, '0')}`);

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

  // Calcule probable/confirmé/encaissé/objectif/commission pour un mois donné
  // ('YYYY-MM'), par commercial. Factorisé pour pouvoir aussi calculer le mois
  // précédent (comparatif réel des KPI) sans dupliquer la logique.
  const buildRowsForMois = useCallback((moisStr: string) => {
    return commerciaux.map((u) => {
      // Un dossier est rattaché au mois de sa signature (date_signature) pour
      // le probable/confirmé/encaissé "de ce mois" — c'est l'argent généré ce
      // mois-là, quel que soit l'écran où on le regarde ensuite.
      const deals = prospects.filter((p) => {
        if (p.signed_by_user_id !== u.id) return false;
        if (!p.date_signature) return false;
        return p.date_signature.slice(0, 7) === moisStr;
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
        if (pmt.date_paiement.slice(0, 7) !== moisStr) return false;
        const p = prospects.find((pp) => pp.id === pmt.prospect_id);
        return p?.signed_by_user_id === u.id;
      });
      const assietteCommission = paiementsDuMoisPourCeCommercial.reduce((s, pmt) => s + Number(pmt.montant), 0);
      const commission = assietteCommission * (taux / 100);

      const objectifRow = objectifs.find((o) => o.user_role_id === u.id && o.mois.slice(0, 7) === moisStr);
      const objectifCa = objectifRow?.objectif_ca ?? 0;
      // L'objectif et le classement sont pilotés par le CA probable. Le
      // réalisé (probable + confirmé + encaissé) reste une lecture comptable
      // utile, mais ne doit pas gonfler artificiellement l'avancement.
      const pct = objectifCa > 0 ? Math.round((probable / objectifCa) * 100) : null;

      const ecart = objectifCa - probable;
      const jo = joursOuvresRestants();
      const parJourNecessaire = moisStr === moisCourant && ecart > 0 && jo > 0 ? ecart / jo : 0;

      return {
        user: u,
        probable, confirme, encaisse, realise,
        objectifCa, objectifId: objectifRow?.id,
        pct, dealsCount: deals.length,
        taux, commission, assietteCommission,
        ecart, parJourNecessaire,
      };
    });
  }, [commerciaux, prospects, objectifs, paiements, paiementsByProspect, moisCourant]);

  const rows = useMemo(() => buildRowsForMois(mois), [buildRowsForMois, mois]);
  const prevMoisStr = useMemo(() => shiftMonth(mois, -1), [mois]);
  const prevRows = useMemo(() => buildRowsForMois(prevMoisStr), [buildRowsForMois, prevMoisStr]);

  // --- Vue Aperçu : globale (équipe) ou centrée sur un commercial ---------
  // Admin : "Tous les commerciaux" = vue globale, ou un id précis = vue
  // individuelle avec niveau/rang. Commercial non-admin : toujours sa propre
  // vue individuelle, jamais de sélecteur, jamais les données d'un collègue.
  const viewMode: 'global' | 'commercial' = isAdmin && heroCommercialId === 'tous' ? 'global' : 'commercial';
  const selectedUserId = isAdmin ? (heroCommercialId === 'tous' ? null : Number(heroCommercialId)) : (userRole?.id ?? null);
  const selectedRow = useMemo(
    () => (selectedUserId != null ? rows.find((r) => r.user.id === selectedUserId) ?? null : null),
    [rows, selectedUserId]
  );
  const prevSelectedRow = useMemo(
    () => (selectedUserId != null ? prevRows.find((r) => r.user.id === selectedUserId) ?? null : null),
    [prevRows, selectedUserId]
  );
  const teamTotals = useMemo(() => aggregateRows(rows), [rows]);
  const prevTeamTotals = useMemo(() => aggregateRows(prevRows), [prevRows]);
  const heroCommercialName = viewMode === 'commercial' && selectedRow
    ? `${selectedRow.user.first_name || ''} ${selectedRow.user.last_name || ''}`.trim()
    : undefined;

  const joRestants = joursOuvresRestants();

  const performance = useMemo(() => {
    const base: RowAgg = viewMode === 'global' ? teamTotals : (selectedRow ?? { probable: 0, confirme: 0, encaisse: 0, realise: 0, objectifCa: 0, commission: 0 });
    const prevBase: RowAgg = viewMode === 'global' ? prevTeamTotals : (prevSelectedRow ?? { probable: 0, confirme: 0, encaisse: 0, realise: 0, objectifCa: 0, commission: 0 });
    const progressPercent = base.objectifCa > 0 ? clamp((base.probable / base.objectifCa) * 100, 0, 100) : 0;
    const remaining = Math.max(base.objectifCa - base.probable, 0);
    const dailyNeeded = isMoisCourant && joRestants > 0 ? Math.ceil(remaining / joRestants) : remaining;

    let currentLevel: GameLevel | null = null;
    let nextLevel: GameLevel | null = null;
    let levelProgress: number | null = null;
    let remainingToNextLevel: number | null = null;
    if (viewMode === 'commercial') {
      let idx = 0;
      LEVELS.forEach((lvl, i) => { if (base.probable >= lvl.amount) idx = i; });
      currentLevel = LEVELS[idx];
      nextLevel = LEVELS[idx + 1] ?? LEVELS[LEVELS.length - 1];
      levelProgress = nextLevel.amount === currentLevel.amount
        ? 100
        : clamp(((base.probable - currentLevel.amount) / (nextLevel.amount - currentLevel.amount)) * 100, 0, 100);
      remainingToNextLevel = Math.max(nextLevel.amount - base.probable, 0);
    }

    return {
      ...base,
      progressPercent,
      remaining,
      dailyNeeded,
      probableGrowth: growthPct(base.probable, prevBase.probable),
      encaisseGrowth: growthPct(base.encaisse, prevBase.encaisse),
      commissionGrowth: growthPct(base.commission, prevBase.commission),
      currentLevel, nextLevel, levelProgress, remainingToNextLevel,
    };
  }, [viewMode, teamTotals, prevTeamTotals, selectedRow, prevSelectedRow, isMoisCourant, joRestants]);

  // Classement : par CA probable / objectif en %, jamais par CA brut — visible
  // à tous (y compris les chiffres des collègues), c'est le levier d'émulation
  // d'équipe. Toujours l'équipe complète, indépendamment de la vue Aperçu.
  const classement = useMemo(() => {
    return rows
      .map((r) => ({ ...r, objectivePercentProbable: r.objectifCa > 0 ? (r.probable / r.objectifCa) * 100 : null }))
      .sort((a, b) => {
        if (a.objectivePercentProbable !== null && b.objectivePercentProbable !== null) return b.objectivePercentProbable - a.objectivePercentProbable;
        if (a.objectivePercentProbable !== null) return -1;
        if (b.objectivePercentProbable !== null) return 1;
        return b.probable - a.probable;
      });
  }, [rows]);

  // Rattrapage : toute l'équipe en vue globale, uniquement la personne
  // affichée en vue individuelle (admin sur un commercial précis, ou un
  // commercial sur lui-même).
  const rattrapageRows = viewMode === 'global'
    ? rows.filter((r) => r.objectifCa > 0)
    : (selectedRow && selectedRow.objectifCa > 0 ? [selectedRow] : []);

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
  const paiementScopeUserId = isAdmin ? null : (userRole?.id ?? null);
  const effectiveCommercialFilter = isAdmin ? commercialFilter : String(paiementScopeUserId ?? '');

  const clientsSignes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return prospects
      .filter((p) => WON_STAGES.has(p.statut_avancement))
      .filter((p) => isAdmin || p.signed_by_user_id === paiementScopeUserId)
      .filter((p) => !q || p.nom_societe?.toLowerCase().includes(q))
      .filter((p) => effectiveCommercialFilter === 'tous' || String(p.signed_by_user_id) === effectiveCommercialFilter)
      .map((p) => {
        const max = Number(p.montant_potentiel) || 0;
        const paye = paiementsByProspect.get(p.id) || 0;
        const pct = max > 0 ? Math.min(100, Math.round((paye / max) * 100)) : 0;
        const commercialUser = commerciaux.find((u) => u.id === p.signed_by_user_id);
        const commercialName = commercialUser ? `${commercialUser.first_name || ''} ${commercialUser.last_name || ''}`.trim() : 'Non attribué';
        const pmts = paiements
          .filter((pmt) => pmt.prospect_id === p.id)
          .sort((a, b) => b.date_paiement.localeCompare(a.date_paiement));
        const statutRank = paiementStatutRank(max, paye);
        const statutLabel = PAIEMENT_STATUT_LABELS[statutRank];
        return { prospect: p, max, paye, pct, commercialName, pmts, statutRank, statutLabel };
      })
      .filter((c) => statutFilter === 'tous' || String(c.statutRank) === statutFilter)
      // Classé par statut de règlement : CA non renseigné -> pas de paiement
      // reçu -> paiement partiel -> paiement reçu ; alphabétique dans chaque
      // groupe.
      .sort((a, b) => {
        if (a.statutRank !== b.statutRank) return a.statutRank - b.statutRank;
        return a.prospect.nom_societe.localeCompare(b.prospect.nom_societe, 'fr');
      });
  }, [prospects, paiementsByProspect, paiements, commerciaux, search, effectiveCommercialFilter, statutFilter, isAdmin, paiementScopeUserId]);

  // Reste à encaisser sur TOUS les clients signés (pas seulement ceux filtrés
  // par la recherche/commercial) — vision globale de ce qu'il reste à percevoir.
  const resteAEncaisserTotal = useMemo(() => {
    return prospects
      .filter((p) => WON_STAGES.has(p.statut_avancement))
      .filter((p) => isAdmin || p.signed_by_user_id === paiementScopeUserId)
      .reduce((sum, p) => {
        const max = Number(p.montant_potentiel) || 0;
        const paye = Math.min(paiementsByProspect.get(p.id) || 0, max);
        return sum + Math.max(0, max - paye);
      }, 0);
  }, [prospects, paiementsByProspect, isAdmin, paiementScopeUserId]);

  const clientsSansCaMax = useMemo(
    () => prospects.filter((p) =>
      WON_STAGES.has(p.statut_avancement)
      && (isAdmin || p.signed_by_user_id === paiementScopeUserId)
      && !(Number(p.montant_potentiel) > 0)
    ).length,
    [prospects, isAdmin, paiementScopeUserId]
  );

  // Export Excel de la liste actuellement affichée (respecte la recherche,
  // le filtre commercial et le tri par statut en cours).
  const handleExportClients = async () => {
    if (clientsSignes.length === 0) { toast.error('Rien à exporter avec ces filtres.'); return; }
    const XLSX = await import('xlsx');
    const rowsXlsx = clientsSignes.map(({ prospect: p, max, paye, pct, commercialName, statutLabel }) => ({
      'Société': p.nom_societe,
      'Statut dossier': p.statut_avancement,
      'Statut règlement': statutLabel,
      'Commercial': commercialName,
      'CA max (€)': max,
      'Réglé (€)': paye,
      'Reste (€)': Math.max(0, max - paye),
      '% réglé': pct,
      'Date envoi Mathilde': p.date_envoi_mathilde
        ? new Date(p.date_envoi_mathilde).toLocaleDateString('fr-FR')
        : '',
    }));
    const ws = XLSX.utils.json_to_sheet(rowsXlsx);
    ws['!cols'] = Object.keys(rowsXlsx[0]).map((h) => ({ wch: Math.max(h.length, 16) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Clients signés');
    XLSX.writeFile(wb, `performance_ca_clients_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

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

  // Courbes réelles jour par jour du mois sélectionné pour la vue Aperçu
  // affichée (équipe complète, ou un seul commercial) — aucune donnée
  // inventée. Le CA confirmé est daté par son passage réel "Envoyé à
  // Mathilde" (date_envoi_mathilde) quand elle tombe dans le mois affiché,
  // sinon par la date de signature.
  const chartUserIds = useMemo(() => {
    if (viewMode === 'global') return new Set(commerciaux.map((u) => u.id));
    return new Set(selectedUserId != null ? [selectedUserId] : []);
  }, [viewMode, commerciaux, selectedUserId]);

  const dailySeries = useMemo(() => {
    const [y, m] = mois.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const probableByDay = new Array(lastDay + 1).fill(0);
    const confirmeByDay = new Array(lastDay + 1).fill(0);
    const encaisseByDay = new Array(lastDay + 1).fill(0);
    const commissionByDay = new Array(lastDay + 1).fill(0);

    for (const p of prospects) {
      if (!p.date_signature || p.date_signature.slice(0, 7) !== mois) continue;
      if (p.signed_by_user_id == null || !chartUserIds.has(p.signed_by_user_id)) continue;
      const max = Number(p.montant_potentiel) || 0;
      const paye = Math.min(paiementsByProspect.get(p.id) || 0, max);
      const restant = max - paye;
      if (restant <= 0) continue;
      if (p.statut_avancement === 'Envoyé à Mathilde') {
        const evtDate = p.date_envoi_mathilde && p.date_envoi_mathilde.slice(0, 7) === mois ? p.date_envoi_mathilde : p.date_signature;
        const day = Number(evtDate.slice(8, 10));
        if (day >= 1 && day <= lastDay) confirmeByDay[day] += restant;
      } else if (PROBABLE_STAGES.has(p.statut_avancement)) {
        const day = Number(p.date_signature.slice(8, 10));
        if (day >= 1 && day <= lastDay) probableByDay[day] += restant;
      }
    }

    const tauxByUser = new Map(commerciaux.map((u) => [u.id, Number(u.taux_commission) || 0]));
    for (const pmt of paiements) {
      if (pmt.date_paiement.slice(0, 7) !== mois) continue;
      const p = prospects.find((pp) => pp.id === pmt.prospect_id);
      if (!p || p.signed_by_user_id == null || !chartUserIds.has(p.signed_by_user_id)) continue;
      const day = Number(pmt.date_paiement.slice(8, 10));
      if (day < 1 || day > lastDay) continue;
      const amt = Number(pmt.montant) || 0;
      encaisseByDay[day] += amt;
      commissionByDay[day] += amt * ((tauxByUser.get(p.signed_by_user_id) || 0) / 100);
    }

    const probable: { day: number; cumul: number }[] = [];
    const confirme: { day: number; cumul: number }[] = [];
    const encaisse: { day: number; cumul: number }[] = [];
    const commission: { day: number; cumul: number }[] = [];
    let cp = 0, cc2 = 0, ce = 0, cco = 0;
    for (let d = 1; d <= lastDay; d++) {
      cp += probableByDay[d]; cc2 += confirmeByDay[d]; ce += encaisseByDay[d]; cco += commissionByDay[d];
      probable.push({ day: d, cumul: cp });
      confirme.push({ day: d, cumul: cc2 });
      encaisse.push({ day: d, cumul: ce });
      commission.push({ day: d, cumul: cco });
    }
    return { probable, confirme, encaisse, commission };
  }, [prospects, paiements, mois, chartUserIds, commerciaux, paiementsByProspect]);

  // Horodatage réel de dernière mise à jour des données (dernier prospect ou
  // règlement modifié) — jamais une date figée en dur.
  const lastUpdatedAt = useMemo(() => {
    let max = '';
    for (const p of prospects) if (p.updated_at && p.updated_at > max) max = p.updated_at;
    for (const pmt of paiements) if (pmt.created_at && pmt.created_at > max) max = pmt.created_at;
    return max;
  }, [prospects, paiements]);
  const lastUpdatedLabel = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  if (errorP) return <ErrorState message="Erreur de chargement des données." />;

  const cardShell = isDark
    ? 'border-white/10 bg-[#080d1a] text-white'
    : 'border-slate-200 bg-white shadow-sm text-slate-900';
  const textMuted = isDark ? 'text-white/55' : 'text-slate-500';
  const textMuted2 = isDark ? 'text-white/40' : 'text-slate-400';

  return (
    <div
      className={`-m-4 min-h-[calc(100vh-3.5rem)] space-y-3 p-4 transition-colors sm:-m-6 sm:p-5 lg:-m-8 lg:min-h-screen lg:p-6 ${
        isDark
          ? 'bg-[radial-gradient(circle_at_75%_0%,rgba(91,33,182,.12),transparent_28%),linear-gradient(135deg,#030713_0%,#06101f_55%,#030713_100%)] text-white'
          : 'bg-[radial-gradient(circle_at_75%_0%,rgba(91,33,182,.08),transparent_28%),linear-gradient(135deg,#f8fafc_0%,#eef4f8_55%,#f8fafc_100%)] text-slate-950'
      }`}
    >
      {/* HEADER */}
      <header
        className={`flex flex-col gap-4 border-b pb-4 transition-colors xl:flex-row xl:items-center xl:justify-between ${
          isDark ? 'border-white/[0.08] text-white' : 'border-slate-200 text-slate-900'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border ${isDark ? 'border-amber-300/20 bg-amber-300/[0.04]' : 'border-amber-300/40 bg-amber-50'}`}>
            <Crosshair className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-[-0.035em] md:text-[26px]">PERFORMANCE CA</h1>
            <p className={`mt-0.5 text-sm ${textMuted}`}>
              Atteignez vos objectifs et débloquez de nouveaux niveaux.
            </p>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
          <button
            onClick={() => setTab('apercu')}
            className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold uppercase tracking-wide transition hover:-translate-y-0.5 sm:flex-none ${
              tab === 'apercu'
                ? 'border border-violet-400 bg-violet-500/10 text-violet-200 shadow-[0_0_22px_rgba(139,92,246,.28),inset_0_0_18px_rgba(139,92,246,.08)]'
                : isDark ? 'border border-white/10 bg-white/[0.035] hover:bg-white/[0.07]' : 'border border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <Home className="h-4 w-4" /> Aperçu du mois
          </button>
          <button
            onClick={() => setTab('paiements')}
            className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold uppercase tracking-wide transition hover:-translate-y-0.5 sm:flex-none ${
              tab === 'paiements'
                ? 'border border-violet-400 bg-violet-500/10 text-violet-200 shadow-[0_0_22px_rgba(139,92,246,.28),inset_0_0_18px_rgba(139,92,246,.08)]'
                : isDark ? 'border border-white/10 bg-white/[0.035] hover:bg-white/[0.07]' : 'border border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <Receipt className="h-4 w-4" /> Suivi paiements clients
          </button>
          {isAdmin && tab === 'apercu' && (
            <Select value={heroCommercialId} onValueChange={setHeroCommercialId}>
              <SelectTrigger className={`h-12 w-full rounded-xl text-xs sm:w-[190px] ${isDark ? 'border-white/10 bg-white/[0.035] text-white' : 'border-slate-200 bg-white'}`}>
                <SelectValue placeholder="Tous les commerciaux" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">Tous les commerciaux</SelectItem>
                {commerciaux.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>{u.first_name} {u.last_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Changer le thème"
            title={tab === 'paiements' ? "S'applique à l'onglet Aperçu du mois" : 'Changer le thème'}
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border transition hover:-translate-y-0.5 ${
              isDark ? 'border-white/10 bg-white/[0.035]' : 'border-slate-200 bg-white shadow-sm'
            }`}
          >
            {theme === 'dark' ? <Sun className="h-5 w-5 text-amber-400" /> : <Moon className="h-5 w-5 text-violet-600" />}
          </button>
          <button
            type="button"
            aria-label="Plus d'options"
            className={`hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl border transition hover:-translate-y-0.5 sm:flex ${
              isDark ? 'border-white/10 bg-white/[0.035]' : 'border-slate-200 bg-white shadow-sm'
            }`}
          >
            <MoreHorizontal className="h-5 w-5 opacity-70" />
          </button>
        </div>
      </header>

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
            {isAdmin && (
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
            )}
            <Select value={statutFilter} onValueChange={setStatutFilter}>
              <SelectTrigger className="w-full sm:w-56 rounded-xl">
                <SelectValue placeholder="Tous les statuts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">Tous les statuts de règlement</SelectItem>
                {PAIEMENT_STATUT_LABELS.map((label, i) => (
                  <SelectItem key={label} value={String(i)}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={handleExportClients}
              className="rounded-xl gap-1.5 shrink-0"
            >
              <Download className="w-4 h-4" /> Exporter ({clientsSignes.length})
            </Button>
          </div>

          {clientsSignes.length === 0 ? (
            <Card className="border-0 shadow-sm rounded-2xl">
              <CardContent className="py-12 text-center text-sm text-slate-400">Aucun client signé pour le moment.</CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {clientsSignes.map(({ prospect: p, max, paye, pct, commercialName, pmts, statutRank, statutLabel }, idx) => (
                <div key={p.id}>
                  {(idx === 0 || clientsSignes[idx - 1].statutRank !== statutRank) && (
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 pt-2 pb-1 first:pt-0">
                      {statutLabel} · {clientsSignes.filter((c) => c.statutRank === statutRank).length}
                    </p>
                  )}
                  <Card className="border-0 shadow-sm rounded-2xl">
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
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {/* HERO GAMIFIÉ */}
          <div
            className={`relative overflow-hidden rounded-[24px] border ${
              isDark
                ? 'border-white/[0.10] bg-[#050a17] text-white shadow-[0_24px_70px_rgba(0,0,0,.28)]'
                : 'border-slate-200 bg-white text-slate-900 shadow-[0_20px_60px_rgba(15,23,42,.10)]'
            }`}
          >
            <MountainScene
              dark={isDark}
              progress={
                viewMode === 'global'
                  ? performance.progressPercent
                  : clamp((performance.probable / LEVELS[LEVELS.length - 1].amount) * 100, 0, 100)
              }
            />

            {/* Le mois reste dans le hero comme sur la maquette de référence. */}
            <div
              className={`absolute right-4 top-4 z-20 flex h-10 items-center gap-1 rounded-xl border pl-3 pr-1.5 backdrop-blur-xl sm:right-5 sm:top-4 ${
                isDark ? 'border-white/15 bg-[#020611]/70' : 'border-slate-200 bg-white/85'
              }`}
            >
              <CalendarDays className="h-4 w-4 shrink-0 opacity-70" />
              <Select value={String(selectedMonthIdx)} onValueChange={setMonthPart}>
                <SelectTrigger className={`h-8 w-[104px] rounded-lg border-0 px-2 text-xs shadow-none ${isDark ? 'text-white' : ''}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((m, i) => (
                    <SelectItem key={m} value={String(i)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedYear} onValueChange={setYearPart}>
                <SelectTrigger className={`h-8 w-[68px] rounded-lg border-0 px-2 text-xs shadow-none ${isDark ? 'text-white' : ''}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearsOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="relative z-10 grid min-h-[350px] grid-cols-1 items-center gap-6 px-5 pb-6 pt-[72px] sm:px-6 md:grid-cols-[180px_minmax(0,1fr)] md:px-7 md:pb-7 md:pt-16 xl:grid-cols-[220px_minmax(320px,580px)_minmax(260px,300px)] xl:justify-between xl:gap-8 xl:py-7">
              {viewMode === 'commercial' && performance.currentLevel ? (
                <RankCard level={performance.currentLevel.level} name={heroCommercialName} stars={Math.floor((performance.levelProgress ?? 0) / 34)} />
              ) : (
                <TeamBadge progress={performance.progressPercent} />
              )}

              {/* progression principale */}
              <div className="flex min-w-0 flex-col justify-center">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold uppercase tracking-[0.08em] ${isDark ? 'text-white/75' : 'text-slate-600'}`}>
                    {viewMode === 'global' ? 'CA PROBABLE ÉQUIPE' : 'CA PROBABLE'}
                  </span>
                  <Info className="h-4 w-4 opacity-60" />
                </div>
                <div className="mt-1 flex flex-wrap items-end gap-4">
                  <strong className="text-[44px] font-black leading-none tracking-[-0.045em] sm:text-[56px] xl:text-[62px]">
                    {eur(performance.probable)}
                  </strong>
                </div>

                {viewMode === 'commercial' && performance.currentLevel && performance.nextLevel ? (
                  <>
                    <div className="mt-6 flex items-center gap-4">
                      <div className={`h-4 min-w-0 flex-1 overflow-hidden rounded-full ring-1 ${isDark ? 'bg-black/55 ring-white/25' : 'bg-slate-200 ring-black/5'}`}>
                        <div
                          className="relative h-full rounded-full bg-gradient-to-r from-violet-700 via-purple-500 to-fuchsia-300 shadow-[0_0_24px_rgba(192,132,252,.72)] transition-all duration-700"
                          style={{ width: `${Math.max(performance.levelProgress ?? 0, 4)}%` }}
                        >
                          <div className="absolute right-0 top-1/2 h-7 w-7 -translate-y-1/2 translate-x-1/2 rounded-full bg-white/90 blur-md" />
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-2xl font-black text-violet-200">{Math.round(performance.levelProgress ?? 0)}%</div>
                        <div className={`text-[10px] ${isDark ? 'text-white/55' : 'text-slate-500'}`}>du niveau actuel</div>
                      </div>
                    </div>
                    <div className="mt-4 flex justify-between gap-4 text-xs sm:text-sm">
                      <div>
                        <div className={`font-semibold uppercase ${isDark ? 'text-white/90' : 'text-slate-700'}`}>Niveau {performance.currentLevel.level}</div>
                        <div className={`mt-1 ${isDark ? 'text-white/55' : 'text-slate-500'}`}>{eur(performance.currentLevel.amount)}</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-semibold uppercase ${isDark ? 'text-white/90' : 'text-slate-700'}`}>Niveau {performance.nextLevel.level}</div>
                        <div className={`mt-1 ${isDark ? 'text-white/55' : 'text-slate-500'}`}>{eur(performance.nextLevel.amount)}</div>
                      </div>
                    </div>
                    {performance.currentLevel.level < performance.nextLevel.level ? (
                      <div className={`mt-5 hidden w-fit items-center gap-2 rounded-xl border px-3 py-2 text-xs sm:inline-flex ${isDark ? 'border-violet-400/20 bg-[#050816]/60 text-white/75' : 'border-violet-100 bg-white/75'}`}>
                        <Zap className="h-4 w-4 text-violet-500" />
                        Encore <strong>{eur(performance.remainingToNextLevel ?? 0)}</strong> pour débloquer le niveau {performance.nextLevel.level}
                      </div>
                    ) : (
                      <div className={`mt-5 inline-flex w-fit items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${isDark ? 'border-lime-500/20 bg-lime-500/[0.08] text-lime-300' : 'border-lime-200 bg-lime-50 text-lime-700'}`}>
                        <Trophy className="h-4 w-4" /> Niveau maximum atteint !
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="mt-6 flex items-center gap-4">
                      <div className={`h-4 flex-1 overflow-hidden rounded-full ring-1 ${isDark ? 'bg-black/55 ring-white/25' : 'bg-slate-200 ring-black/5'}`}>
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#5A9BA3] via-[#6AABB4] to-violet-500 shadow-[0_0_25px_rgba(106,171,180,.55)] transition-all duration-700"
                          style={{ width: `${Math.max(performance.progressPercent, 4)}%` }}
                        />
                      </div>
                      <div className="text-2xl font-black text-[#87d1dc]">{Math.round(performance.progressPercent)}%</div>
                    </div>
                    <div className="mt-4 flex justify-between text-sm">
                      <div>
                        <div className={isDark ? 'text-white/60' : 'text-slate-500'}>CA probable équipe</div>
                        <div className="mt-0.5 font-semibold">{eur(performance.probable)}</div>
                      </div>
                      <div className="text-right">
                        <div className={isDark ? 'text-white/60' : 'text-slate-500'}>Objectif équipe</div>
                        <div className="mt-0.5 font-semibold">{eur(performance.objectifCa)}</div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* restant — 3e zone du hero, empilée sous les deux autres sur tablette */}
              <div className={`relative flex min-h-[176px] flex-col justify-center overflow-hidden rounded-[18px] border p-5 backdrop-blur-xl md:col-span-2 md:min-h-[154px] xl:col-span-1 xl:min-h-[190px] ${
                isDark
                  ? 'border-white/20 bg-[#030815]/78 shadow-[0_18px_45px_rgba(0,0,0,.30)]'
                  : 'border-slate-200 bg-white/88 shadow-lg'
              }`}>
                <Crosshair className="absolute right-5 top-1/2 h-16 w-16 -translate-y-1/2 text-violet-400/85 drop-shadow-[0_0_14px_rgba(139,92,246,.55)]" />
                <div className="relative z-10 max-w-[205px]">
                  <span className={`text-xs font-semibold uppercase tracking-[0.06em] ${isDark ? 'text-white/80' : 'text-slate-600'}`}>Restant à atteindre</span>
                  <strong className="mt-2 block text-[34px] font-black leading-none tracking-[-0.035em]">{eur(performance.remaining)}</strong>
                  <div className={`mt-4 text-sm leading-6 ${isDark ? 'text-white/75' : 'text-slate-600'}`}>
                    {performance.remaining <= 0 && performance.objectifCa > 0 ? (
                      <span className="flex items-center gap-2 font-semibold text-emerald-400"><Trophy className="w-5 h-5" /> Objectif atteint ce mois !</span>
                    ) : performance.objectifCa === 0 ? (
                      <span>Aucun objectif défini pour ce mois.</span>
                    ) : isMoisCourant ? (
                      <>
                        Il manque {eur(performance.remaining)} —{' '}
                        <strong className="text-amber-400">soit {eur(performance.dailyNeeded)}/jour ouvré sur {joRestants} j. restants</strong>.
                      </>
                    ) : (
                      <>Il manquait {eur(performance.remaining)} pour atteindre l'objectif de {MONTH_NAMES[selectedMonthIdx]} {selectedYear}.</>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* PROGRESSION — compacte, individuelle (10 niveaux) ou équipe (25/50/75/100%) */}
          {viewMode === 'commercial' && performance.currentLevel ? (
            <LevelProgression
              dark={isDark}
              currentLevel={performance.currentLevel}
              levelProgress={performance.levelProgress ?? 0}
            />
          ) : (
            <TeamProgression dark={isDark} progress={performance.progressPercent} />
          )}

          {/* KPI — toujours ces 4-là */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              dark={isDark} title="CA PROBABLE" value={eur(performance.probable)} subtitle="Cumulé du mois"
              growth={performance.probableGrowth} accent="violet"
              series={dailySeries.probable}
              icon={<ArrowUpRight className="h-5 w-5" />}
            />
            <KpiCard
              dark={isDark} title="CA ENCAISSÉ" value={eur(performance.encaisse)} subtitle="Règlements reçus"
              growth={performance.encaisseGrowth} accent="blue"
              series={dailySeries.encaisse}
              icon={<Wallet className="h-5 w-5" />}
            />
            <KpiCard
              dark={isDark} title="OBJECTIF" value={eur(performance.objectifCa)} subtitle="Objectif du mois"
              accent="amber" progress={performance.progressPercent} icon={<Target className="h-5 w-5" />}
            />
            <KpiCard
              dark={isDark} title="COMMISSION PAYÉE" value={eur(performance.commission)} subtitle="Règlements encaissés ce mois"
              growth={performance.commissionGrowth} accent="green" series={dailySeries.commission} icon={<Banknote className="h-5 w-5" />}
            />
          </div>

          {/* Graphique réel + récapitulatif (CA confirmé toujours visible ici, jamais fusionné) */}
          <div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
            <RevenueChart
              dark={isDark}
              series={dailySeries}
              objectif={performance.objectifCa}
              showLevelMarkers={viewMode === 'commercial'}
            />
            <MonthlySummary
              dark={isDark}
              probable={performance.probable}
              confirme={performance.confirme}
              encaisse={performance.encaisse}
              objectif={performance.objectifCa}
              commission={performance.commission}
              lastUpdatedLabel={lastUpdatedLabel}
            />
          </div>

          {/* Rattrapage — uniquement sur le mois en cours */}
          {isMoisCourant && (
            <section className={`rounded-[24px] border p-5 ${cardShell}`}>
              <h2 className="text-sm font-black uppercase tracking-wide flex items-center gap-2"><Flame className="w-4 h-4 text-orange-500" /> Rattrapage du mois</h2>
              <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                {rattrapageRows.length === 0 ? (
                  <p className={`text-sm ${textMuted2}`}>Aucun objectif défini ce mois-ci.</p>
                ) : (
                  rattrapageRows.map((r) => (
                    <div key={r.user.id} className={`rounded-2xl border p-4 ${isDark ? 'border-white/[0.07] bg-white/[0.025]' : 'border-slate-200 bg-slate-50'}`}>
                      <div className="font-bold">{r.user.first_name} {r.user.last_name}</div>
                      {r.ecart <= 0 ? (
                        <div className="mt-3 text-sm font-semibold text-emerald-500 flex items-center gap-1"><Trophy className="w-4 h-4" /> Objectif atteint</div>
                      ) : (
                        <>
                          <div className={`mt-3 text-sm ${textMuted}`}>Reste <strong>{eur(r.ecart)}</strong></div>
                          {joRestants > 0 && <div className="mt-1 text-xl font-black text-amber-500">{eur(r.parJourNecessaire)}/jour</div>}
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {/* Classement — trié par CA probable / objectif, toujours toute l'équipe */}
          <section className={`rounded-[24px] border p-5 ${cardShell}`}>
            <h2 className="text-sm font-black uppercase tracking-wide flex items-center gap-2"><Trophy className="w-4 h-4 text-amber-500" /> Classement</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {classement.map((r, idx) => (
                <div key={r.user.id} className={`rounded-2xl border p-4 ${r.user.id === userRole?.id ? 'border-violet-400/30 bg-violet-500/10' : isDark ? 'border-white/[0.07] bg-white/[0.025]' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-center justify-between">
                    <div className="font-bold">{idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`} {r.user.first_name} {r.user.last_name}</div>
                    <strong className="text-violet-400">{r.objectivePercentProbable === null ? '—' : `${Math.round(r.objectivePercentProbable)}%`}</strong>
                  </div>
                  <div className={`mt-2 text-xs ${textMuted2}`}>{eur(r.probable)} / {eur(r.objectifCa)}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Détail par commercial — admin uniquement, toujours l'équipe complète */}
          {isAdmin && (
            <section className={`overflow-hidden rounded-[24px] border ${cardShell}`}>
              <div className="px-5 py-4">
                <h2 className="text-sm font-black uppercase tracking-wide">Détail par commercial</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] text-sm">
                  <thead className={isDark ? 'bg-white/[0.035]' : 'bg-slate-50'}>
                    <tr className={`text-left ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
                      <th className="px-5 py-3 font-medium">Commercial</th>
                      <th className="px-5 py-3 font-medium text-right">CA probable</th>
                      <th className="px-5 py-3 font-medium text-right">CA confirmé</th>
                      <th className="px-5 py-3 font-medium text-right">CA encaissé</th>
                      <th className="px-5 py-3 font-medium text-right">Objectif</th>
                      <th className="px-5 py-3 font-medium text-right">% atteint</th>
                      <th className="px-5 py-3 font-medium text-right">Taux comm.</th>
                      <th className="px-5 py-3 font-medium text-right">Commission (paie)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.user.id} className={`border-t ${isDark ? 'border-white/[0.06]' : 'border-slate-100'}`}>
                        <td className="px-5 py-4 font-medium">
                          {r.user.first_name} {r.user.last_name}
                          <span className={`text-xs ml-1.5 ${textMuted2}`}>({r.dealsCount} dossier{r.dealsCount > 1 ? 's' : ''})</span>
                        </td>
                        <td className="px-5 py-4 text-right text-amber-500">{eur(r.probable)}</td>
                        <td className="px-5 py-4 text-right text-[#6AABB4]">{eur(r.confirme)}</td>
                        <td className="px-5 py-4 text-right text-emerald-500 font-semibold">{eur(r.encaisse)}</td>
                        <td className="px-5 py-4 text-right">
                          {editingId === r.user.id ? (
                            <div className="flex items-center justify-end gap-1">
                              <Input autoFocus type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-24 h-8 rounded-lg text-right" />
                              <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => saveObjectif(r)}><Check className="w-4 h-4 text-emerald-600" /></Button>
                              <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => setEditingId(null)}><X className="w-4 h-4 text-slate-400" /></Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              <span className={textMuted}>{r.objectifCa ? eur(r.objectifCa) : '-'}</span>
                              <button onClick={() => startEdit(r.user.id, r.objectifId, r.objectifCa)} className={isDark ? 'text-white/30 hover:text-white' : 'text-slate-300 hover:text-slate-600'}>
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right">
                          {r.pct === null ? <span className={textMuted2}>-</span> : (
                            <span className={`font-semibold ${r.pct >= 100 ? 'text-emerald-500' : r.pct >= 60 ? 'text-amber-500' : 'text-red-500'}`}>{r.pct}%</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right">
                          {editingTauxId === r.user.id ? (
                            <div className="flex items-center justify-end gap-1">
                              <Input autoFocus type="number" value={editTauxValue} onChange={(e) => setEditTauxValue(e.target.value)} className="w-16 h-8 rounded-lg text-right" />
                              <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => saveTaux(r)}><Check className="w-4 h-4 text-emerald-600" /></Button>
                              <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => setEditingTauxId(null)}><X className="w-4 h-4 text-slate-400" /></Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              <span className={textMuted}>{r.taux ? `${r.taux}%` : '-'}</span>
                              <button onClick={() => { setEditingTauxId(r.user.id); setEditTauxValue(r.taux ? String(r.taux) : ''); }} className={isDark ? 'text-white/30 hover:text-white' : 'text-slate-300 hover:text-slate-600'}>
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right font-semibold text-purple-500">{eur(r.commission)}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td colSpan={8} className={`py-8 text-center ${textMuted2}`}>Aucune donnée pour ce mois.</td></tr>
                    )}
                  </tbody>
                </table>
                <p className={`px-5 pb-4 pt-3 text-xs ${textMuted2}`}>
                  La commission est calculée sur les règlements reçus <strong>ce mois-ci</strong> (voir l'onglet "Suivi paiements clients"), indépendamment du mois de signature du dossier.
                </p>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// Fond panoramique local généré pour cette page. L'image ne contient aucun
// texte ni composant UI : les données réelles restent du HTML accessible.
function MountainScene({ dark, progress }: { dark: boolean; progress: number }) {
  const normalized = clamp(progress, 0, 100);
  const trailPoints = [
    { x: 81, y: 82 },
    { x: 76, y: 70 },
    { x: 79, y: 58 },
    { x: 75, y: 45 },
    { x: 78, y: 31 },
    { x: 76, y: 15 },
  ];
  const scaled = (normalized / 100) * (trailPoints.length - 1);
  const pointIndex = Math.min(Math.floor(scaled), trailPoints.length - 2);
  const pointProgress = scaled - pointIndex;
  const from = trailPoints[pointIndex];
  const to = trailPoints[pointIndex + 1];
  const markerX = from.x + (to.x - from.x) * pointProgress;
  const markerY = from.y + (to.y - from.y) * pointProgress;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <img
        src="/assets/performance-ca/hero-mountain-ascent.jpg"
        alt=""
        aria-hidden="true"
        className={`absolute inset-0 h-full w-full object-cover object-[68%_center] transition duration-500 ${
          dark ? 'opacity-100' : 'opacity-45 saturate-75'
        }`}
      />
      <div className={`absolute inset-0 ${
        dark
          ? 'bg-[linear-gradient(90deg,rgba(2,6,18,.84)_0%,rgba(3,8,24,.55)_39%,rgba(3,8,24,.08)_69%,rgba(2,6,18,.38)_100%)]'
          : 'bg-[linear-gradient(90deg,rgba(255,255,255,.96)_0%,rgba(248,250,252,.76)_42%,rgba(255,255,255,.18)_70%,rgba(255,255,255,.62)_100%)]'
      }`} />
      <div className={`absolute inset-x-0 bottom-0 h-24 ${dark ? 'bg-gradient-to-t from-[#040915] to-transparent' : 'bg-gradient-to-t from-white/80 to-transparent'}`} />
      <div
        className="absolute hidden h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-violet-300 bg-white shadow-[0_0_9px_3px_rgba(168,85,247,.85)] transition-all duration-700 lg:block"
        style={{ left: `${markerX}%`, top: `${markerY}%` }}
      />
    </div>
  );
}

// Vue "Tous les commerciaux" (admin) : pas de niveau individuel, uniquement
// la progression collective vers l'objectif de l'équipe.
function TeamBadge({ progress }: { progress: number }) {
  return (
    <div className="flex items-center justify-center">
      <div className="relative flex h-[190px] w-[170px] flex-col items-center justify-center overflow-hidden rounded-[28px] border border-[#6AABB4]/35 bg-[#050a18]/78 text-center shadow-[0_18px_46px_rgba(0,0,0,.32)] backdrop-blur-xl md:h-[222px] md:w-[192px]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,rgba(106,171,180,.30),transparent_52%)]" />
        <ShieldCheck className="relative z-10 h-7 w-7 text-[#87d1dc]" />
        <div className="relative z-10 mt-3 text-[10px] font-black uppercase tracking-[0.2em] text-[#87d1dc]">Performance équipe</div>
        <div className="relative z-10 mt-2 text-[58px] font-black leading-none tracking-[-0.06em] text-white md:text-[68px]">{Math.round(progress)}%</div>
        <div className="relative z-10 mt-3 text-xs text-white/65">de l'objectif collectif</div>
      </div>
    </div>
  );
}

// Vue "un commercial" : badge de rang façon jeu vidéo premium, gros niveau,
// diamants de progression réels (dérivés de levelProgress).
function RankCard({ level, name, stars }: { level: number; name?: string; stars: number }) {
  return (
    <div className="flex items-center justify-center">
      <div className="relative h-[194px] w-[170px] md:h-[238px] md:w-[210px]">
        {/* Ailes métalliques : géométrie pure, légère et responsive. */}
        <div className="absolute left-[-2px] top-[52px] h-[96px] w-[50px] -rotate-[7deg] bg-gradient-to-br from-amber-100/80 via-violet-400/50 to-slate-950 [clip-path:polygon(100%_0,35%_20%,78%_34%,12%_48%,72%_61%,27%_78%,100%_100%)] md:left-[-8px] md:top-[60px] md:h-[116px] md:w-[62px]" />
        <div className="absolute right-[-2px] top-[52px] h-[96px] w-[50px] rotate-[7deg] bg-gradient-to-bl from-amber-100/80 via-violet-400/50 to-slate-950 [clip-path:polygon(0_0,65%_20%,22%_34%,88%_48%,28%_61%,73%_78%,0_100%)] md:right-[-8px] md:top-[60px] md:h-[116px] md:w-[62px]" />
        <div className="absolute inset-x-[22px] inset-y-0 bg-gradient-to-b from-amber-100 via-violet-400 to-violet-950 p-[2px] shadow-[0_0_26px_rgba(139,92,246,.48)] [clip-path:polygon(50%_0,94%_13%,91%_68%,77%_87%,50%_100%,23%_87%,9%_68%,6%_13%)] md:inset-x-[25px]">
          <div className="flex h-full w-full flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_40%,rgba(124,58,237,.50),transparent_48%),linear-gradient(180deg,#11102a_0%,#070918_62%,#140d2d_100%)] [clip-path:polygon(50%_1%,93%_14%,90%_67%,76%_86%,50%_98%,24%_86%,10%_67%,7%_14%)]">
            <div className="text-[9px] font-black uppercase tracking-[0.14em] text-violet-100 md:text-[10px]">Niveau actuel</div>
            <div className="mt-1 bg-gradient-to-b from-white via-violet-200 to-violet-500 bg-clip-text text-[60px] font-black leading-none tracking-[-0.08em] text-transparent drop-shadow-[0_0_14px_rgba(167,139,250,.55)] md:text-[78px]">
              {String(level).padStart(2, '0')}
            </div>
            <div className="mt-3 flex gap-2">
              {[0, 1, 2].map((s) => (
                <Star key={s} className={`h-4 w-4 ${s < stars ? 'fill-amber-300 text-amber-300' : 'fill-white/15 text-white/20'}`} />
              ))}
            </div>
          </div>
        </div>
        <div className="absolute left-1/2 top-[-3px] h-7 w-7 -translate-x-1/2 rotate-45 border border-amber-100/80 bg-gradient-to-br from-white via-violet-300 to-violet-700 shadow-[0_0_16px_rgba(167,139,250,.7)] md:h-8 md:w-8">
          <div className="absolute inset-[7px] rounded-full bg-white/90 shadow-[0_0_7px_white]" />
        </div>
        {name && <span className="sr-only">{name}</span>}
      </div>
    </div>
  );
}

// Frise des 10 niveaux — compacte (utilisée uniquement en vue individuelle).
function LevelProgression({
  dark,
  currentLevel,
  levelProgress,
}: {
  dark: boolean;
  currentLevel: GameLevel;
  levelProgress: number;
}) {
  const currentIndex = LEVELS.findIndex((l) => l.level === currentLevel.level);
  const milestones = [25, 50, 75, 100];
  const nextMilestone = milestones.find((milestone) => levelProgress < milestone) ?? 100;

  return (
    <section className={`overflow-hidden rounded-[20px] border ${dark ? 'border-white/10 bg-[#050b18]/92 text-white shadow-[0_18px_48px_rgba(0,0,0,.18)]' : 'border-slate-200 bg-white shadow-sm text-slate-900'}`}>
      <div className="p-4 pb-3 sm:px-5">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide">Progression des niveaux</h2>
        <div className="relative overflow-x-auto pb-2 [scrollbar-width:thin]">
          <div className="min-w-[920px]">
          <div className="relative flex items-start justify-between">
              <div className={`absolute left-5 right-5 top-[18px] h-[3px] rounded-full ${dark ? 'bg-white/20' : 'bg-slate-200'}`} />
              <div
                className="absolute left-5 top-[18px] h-[3px] rounded-full bg-lime-400 shadow-[0_0_10px_rgba(163,230,53,.55)]"
                style={{ width: `calc(${clamp((currentIndex / (LEVELS.length - 1)) * 100, 0, 100)}% - 20px)` }}
              />
            {LEVELS.map((level, index) => {
              const done = index < currentIndex;
              const current = index === currentIndex;
              const locked = index > currentIndex;
              return (
                  <div key={level.level} className="relative z-10 flex w-[82px] flex-col items-center text-center">
                    {current && <span className="absolute -top-4 h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-violet-300" />}
                  <div
                      className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-xs font-bold ${
                        done ? 'border-lime-300 bg-[#183113] text-lime-200 shadow-[0_0_14px_rgba(163,230,53,.32)]'
                          : current ? 'scale-110 border-violet-300 bg-[#281249] text-white shadow-[0_0_20px_rgba(168,85,247,.72)]'
                          : dark ? 'border-white/25 bg-[#10131a] text-white/45' : 'border-slate-300 bg-slate-50 text-slate-400'
                    }`}
                  >
                      {done ? <Check className="h-4 w-4" /> : locked ? <Lock className="h-3.5 w-3.5" /> : level.level}
                  </div>
                    <div className={`mt-2 text-[10px] font-bold uppercase ${current ? 'text-violet-300' : ''}`}>Niveau {level.level}</div>
                    <div className={`mt-0.5 text-[10px] ${dark ? 'text-white/55' : 'text-slate-400'}`}>{eur(level.amount)}</div>
                </div>
              );
            })}
            </div>
          </div>
        </div>
      </div>

      <div className={`grid grid-cols-2 border-t sm:grid-cols-4 ${dark ? 'border-white/[0.08] bg-[#07101d]/82' : 'border-slate-200 bg-slate-50/80'}`}>
        {milestones.map((milestone, index) => {
          const reached = levelProgress >= milestone;
          const active = !reached && milestone === nextMilestone;
          return (
            <div
              key={milestone}
              className={`flex min-h-[68px] items-center justify-center gap-3 px-3 py-3 ${
                index > 0 ? dark ? 'border-l border-white/[0.08]' : 'border-l border-slate-200' : ''
              }`}
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-[12px] border ${
                reached
                  ? 'border-lime-300/50 bg-lime-400/15 text-lime-300'
                  : active
                    ? 'border-violet-300/50 bg-violet-500/20 text-violet-200 shadow-[0_0_16px_rgba(168,85,247,.30)]'
                    : dark
                      ? 'border-white/20 bg-white/[0.04] text-white/45'
                      : 'border-slate-300 bg-white text-slate-400'
              }`}>
                {reached ? <Check className="h-5 w-5" /> : active ? <Star className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              </div>
              <div>
                <div className={`text-sm font-bold ${reached ? 'text-lime-300' : active ? 'text-violet-300' : ''}`}>{milestone}%</div>
                <div className={`text-[10px] ${dark ? 'text-white/50' : 'text-slate-500'}`}>du niveau</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Progression collective (vue "Tous les commerciaux") — jalons 25/50/75/100%
// de l'objectif d'équipe, en remplacement de la frise de niveaux individuelle.
function TeamProgression({ dark, progress }: { dark: boolean; progress: number }) {
  const milestones = [25, 50, 75, 100];
  return (
    <section className={`rounded-[20px] border p-4 ${dark ? 'border-white/10 bg-[#080d1a] text-white' : 'border-slate-200 bg-white shadow-sm text-slate-900'}`}>
      <h2 className="mb-3 text-xs font-bold uppercase tracking-wide">Progression de l'équipe vers l'objectif</h2>
      <div className="flex items-center gap-3">
        {milestones.map((milestone, index) => {
          const reached = progress >= milestone;
          return (
            <div key={milestone} className="flex flex-1 items-center gap-3">
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full border-2 font-bold text-xs ${
                  reached ? 'border-[#6AABB4] bg-[#6AABB4] text-white' : dark ? 'border-white/15 bg-[#101827] text-white/40' : 'border-slate-300 bg-slate-50 text-slate-400'
                }`}>
                  {reached ? <Check className="h-4 w-4" /> : <Lock className="h-3 w-3" />}
                </div>
                <div className="text-[10px] font-bold">{milestone}%</div>
              </div>
              {index < milestones.length - 1 && (
                <div className={`h-[2px] flex-1 rounded-full ${progress >= milestone ? 'bg-[#6AABB4]' : dark ? 'bg-white/10' : 'bg-slate-200'}`} />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function KpiCard({
  dark, icon, title, value, subtitle, growth, progress, series, accent,
}: {
  dark: boolean;
  icon: ReactNode;
  title: string;
  value: string;
  subtitle: string;
  growth?: number | null;
  progress?: number;
  series?: DailyPoint[];
  accent: 'violet' | 'blue' | 'amber' | 'green';
}) {
  const styles = {
    violet: { icon: 'border-violet-400/30 bg-violet-500/20 text-violet-300', bar: 'bg-gradient-to-r from-violet-700 to-fuchsia-300', stroke: '#c084fc' },
    blue: { icon: 'border-blue-400/30 bg-blue-500/20 text-blue-300', bar: 'bg-gradient-to-r from-blue-700 to-sky-300', stroke: '#60a5fa' },
    amber: { icon: 'border-amber-400/30 bg-amber-400/15 text-amber-300', bar: 'bg-gradient-to-r from-amber-700 to-amber-300', stroke: '#fbbf24' },
    green: { icon: 'border-lime-400/25 bg-lime-400/15 text-lime-300', bar: 'bg-gradient-to-r from-lime-700 to-lime-300', stroke: '#a3e635' },
  }[accent];
  return (
    <div className={`group relative min-h-[160px] overflow-hidden rounded-[18px] border p-4 transition duration-300 hover:-translate-y-0.5 ${
      dark
        ? 'border-white/10 bg-[#070c18]/95 text-white shadow-[0_16px_38px_rgba(0,0,0,.16)] hover:border-white/20'
        : 'border-slate-200 bg-white text-slate-800 shadow-sm hover:shadow-lg'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border shadow-[inset_0_0_18px_rgba(255,255,255,.04)] ${styles.icon}`}>{icon}</div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.03em]">{title}</span>
            <Info className="h-3.5 w-3.5 opacity-40" />
          </div>
        </div>
        {growth !== undefined && growth !== null && (
          <div className="text-right">
            <div className={`text-sm font-bold ${growth >= 0 ? 'text-lime-500' : 'text-red-500'}`}>{growth >= 0 ? '+' : ''}{growth}%</div>
            <div className={`mt-1 text-[10px] ${dark ? 'text-white/40' : 'text-slate-400'}`}>vs mois dernier</div>
          </div>
        )}
      </div>
      <div className="mt-3 text-[32px] font-black leading-none tracking-[-0.04em]">{value}</div>
      <div className={`mt-1 text-xs ${dark ? 'text-white/45' : 'text-slate-500'}`}>{subtitle}</div>
      {series ? (
        <KpiSparkline dark={dark} series={series} stroke={styles.stroke} id={`${accent}-${title.replace(/\s+/g, '-').toLowerCase()}`} />
      ) : progress !== undefined ? (
        <div className={`mt-6 h-2 overflow-hidden rounded-full ${dark ? 'bg-white/10' : 'bg-slate-100'}`}>
          <div className={`h-full rounded-full shadow-[0_0_12px_currentColor] ${styles.bar}`} style={{ width: `${clamp(progress, 0, 100)}%` }} />
        </div>
      ) : null}
    </div>
  );
}

type DailyPoint = { day: number; cumul: number };

function KpiSparkline({
  dark,
  series,
  stroke,
  id,
}: {
  dark: boolean;
  series: DailyPoint[];
  stroke: string;
  id: string;
}) {
  const width = 320;
  const height = 54;
  const max = Math.max(...series.map((point) => point.cumul), 1);
  const path = series.map((point, index) => {
    const x = series.length <= 1 ? 0 : (index / (series.length - 1)) * width;
    const y = height - 4 - (point.cumul / max) * (height - 10);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  const areaPath = path ? `${path} L${width} ${height} L0 ${height} Z` : '';

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="absolute inset-x-3 bottom-2 h-[52px] w-[calc(100%-24px)] overflow-visible"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={dark ? 0.38 : 0.26} />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {areaPath && <path d={areaPath} fill={`url(#spark-${id})`} />}
      {path && <path d={path} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />}
      {series.filter((_, index) => index % Math.max(Math.floor(series.length / 10), 1) === 0).map((point, index, sampled) => {
        const originalIndex = series.findIndex((candidate) => candidate.day === point.day);
        const x = series.length <= 1 ? 0 : (originalIndex / (series.length - 1)) * width;
        const y = height - 4 - (point.cumul / max) * (height - 10);
        return <circle key={`${point.day}-${index}-${sampled.length}`} cx={x} cy={y} r="2.1" fill={dark ? '#07101d' : '#ffffff'} stroke={stroke} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />;
      })}
    </svg>
  );
}

// Graphique réel à 3 courbes (probable / confirmé / encaissé) + objectif en
// pointillé — dérivé des vraies signatures, transmissions à Mathilde et
// règlements du mois affiché (jamais un tracé fixe).
function RevenueChart({
  dark,
  series,
  objectif,
  showLevelMarkers,
}: {
  dark: boolean;
  series: { probable: DailyPoint[]; confirme: DailyPoint[]; encaisse: DailyPoint[] };
  objectif: number;
  showLevelMarkers: boolean;
}) {
  const lastDay = series.probable.length || 1;
  const maxVal = Math.max(
    objectif,
    series.probable[lastDay - 1]?.cumul || 0,
    series.confirme[lastDay - 1]?.cumul || 0,
    series.encaisse[lastDay - 1]?.cumul || 0,
    1
  ) * 1.08;
  const toX = (day: number) => ((day - 1) / Math.max(lastDay - 1, 1)) * 900;
  const toY = (val: number) => 290 - Math.min(val / maxVal, 1) * 290;
  const pathFor = (pts: DailyPoint[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.day)} ${toY(p.cumul)}`).join(' ');
  const probablePath = pathFor(series.probable);
  const probableAreaPath = probablePath ? `${probablePath} L900 290 L0 290 Z` : '';
  const objY = toY(objectif);
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(maxVal * f));
  const xLabels = [1, 5, 10, 15, 20, 25, lastDay].filter((d, i, arr) => arr.indexOf(d) === i && d <= lastDay);
  const levelMarkers = showLevelMarkers
    ? LEVELS.flatMap((level) => {
        const point = series.probable.find((candidate) => candidate.cumul >= level.amount);
        return point ? [{ ...level, point }] : [];
      })
    : [];

  return (
    <div className={`overflow-hidden rounded-[18px] border p-4 sm:p-5 ${dark ? 'border-white/10 bg-[#050b18]/95 text-white shadow-[0_16px_42px_rgba(0,0,0,.16)]' : 'border-slate-200 bg-white shadow-sm text-slate-900'}`}>
      <h3 className="text-sm font-black">ÉVOLUTION DU CA PROBABLE</h3>
      <div className={`mt-2 flex flex-wrap gap-4 text-[11px] ${dark ? 'text-white/40' : 'text-slate-500'}`}>
        <span className="flex items-center gap-1.5"><span className="h-[2px] w-4 bg-violet-500" /> CA probable</span>
        <span className="flex items-center gap-1.5"><span className="h-[2px] w-4 bg-[#5A9BA3]" /> CA confirmé</span>
        <span className="flex items-center gap-1.5"><span className="h-[2px] w-4 bg-blue-500" /> CA encaissé</span>
        <span className="flex items-center gap-1.5"><span className="h-[2px] w-4 border-t border-dashed border-slate-400" /> Objectif</span>
      </div>
      <div className="mt-4 overflow-x-auto pb-1 [scrollbar-width:thin]">
        <div className="relative h-[286px] min-w-[620px]">
          <div className="absolute inset-0 flex flex-col justify-between">
            {ticks.map((value) => (
              <div key={value} className="flex items-center gap-3">
                <span className={`w-14 text-right text-[11px] ${dark ? 'text-white/35' : 'text-slate-400'}`}>{eur(value)}</span>
                <div className={`h-px flex-1 border-t border-dashed ${dark ? 'border-white/[0.07]' : 'border-slate-200'}`} />
              </div>
            ))}
          </div>
          <svg className="absolute bottom-4 left-[64px] right-0 h-[256px] w-[calc(100%-64px)] overflow-visible" viewBox="0 0 900 290" preserveAspectRatio="none">
            <defs>
              <linearGradient id="revenue-area-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8B5CF6" stopOpacity={dark ? 0.34 : 0.22} />
                <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
              </linearGradient>
            </defs>
            {probableAreaPath && <path d={probableAreaPath} fill="url(#revenue-area-gradient)" />}
            {probablePath && <path d={probablePath} fill="none" stroke="#A855F7" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            {series.confirme.length > 0 && <path d={pathFor(series.confirme)} fill="none" stroke="#5A9BA3" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity=".9" vectorEffect="non-scaling-stroke" />}
            {series.encaisse.length > 0 && <path d={pathFor(series.encaisse)} fill="none" stroke="#3B82F6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity=".9" vectorEffect="non-scaling-stroke" />}
            {objectif > 0 && <path d={`M0 ${objY} L900 ${objY}`} fill="none" stroke="#CBD5E1" strokeWidth="2" strokeDasharray="9 9" opacity="0.65" vectorEffect="non-scaling-stroke" />}
            {levelMarkers.map(({ level, point }) => (
              <g key={level}>
                <circle cx={toX(point.day)} cy={toY(point.cumul)} r="8" fill={dark ? '#090d1b' : '#ffffff'} stroke="#C4B5FD" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                <text
                  x={toX(point.day)}
                  y={toY(point.cumul) - 16}
                  fill={dark ? '#DDD6FE' : '#6D28D9'}
                  fontSize="12"
                  fontWeight="700"
                  textAnchor="middle"
                  vectorEffect="non-scaling-stroke"
                >
                  NIV. {level}
                </text>
              </g>
            ))}
          </svg>
          <div className={`absolute bottom-0 left-[64px] right-0 flex justify-between text-[11px] ${dark ? 'text-white/35' : 'text-slate-400'}`}>
            {xLabels.map((d) => <span key={d}>{String(d).padStart(2, '0')}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}

// Récapitulatif du mois : les 3 CA (probable/confirmé/encaissé) + objectif +
// commission, chacun avec sa vraie progression vs l'objectif.
function MonthlySummary({
  dark, probable, confirme, encaisse, objectif, commission, lastUpdatedLabel,
}: {
  dark: boolean;
  probable: number;
  confirme: number;
  encaisse: number;
  objectif: number;
  commission: number;
  lastUpdatedLabel: string | null;
}) {
  const rows = [
    { label: 'CA probable', value: probable, percent: objectif > 0 ? (probable / objectif) * 100 : 0, color: 'bg-violet-500' },
    { label: 'CA confirmé', value: confirme, percent: objectif > 0 ? (confirme / objectif) * 100 : 0, color: 'bg-[#5A9BA3]' },
    { label: 'CA encaissé', value: encaisse, percent: objectif > 0 ? (encaisse / objectif) * 100 : 0, color: 'bg-blue-500' },
    { label: 'Objectif', value: objectif, percent: 100, color: 'bg-amber-400' },
    { label: 'Commission payée', value: commission, percent: null as number | null, color: 'bg-emerald-500' },
  ];
  return (
    <div className={`rounded-[18px] border p-4 sm:p-5 ${dark ? 'border-white/10 bg-[#050b18]/95 text-white shadow-[0_16px_42px_rgba(0,0,0,.16)]' : 'border-slate-200 bg-white shadow-sm text-slate-900'}`}>
      <h3 className="text-sm font-black">RÉCAPITULATIF DU MOIS</h3>
      <div className="mt-6 space-y-5">
        {rows.map((row) => {
          const width = row.percent === null ? Math.min((row.value / (objectif || 1)) * 100, 100) : clamp(row.percent, 0, 100);
          return (
            <div key={row.label} className="grid grid-cols-[92px_minmax(55px,1fr)_76px_38px] items-center gap-2 text-xs sm:grid-cols-[108px_minmax(70px,1fr)_88px_42px] sm:gap-3 sm:text-sm">
              <span className={dark ? 'text-white/65' : 'text-slate-600'}>{row.label}</span>
              <div className={`h-2 overflow-hidden rounded-full ${dark ? 'bg-white/[0.08]' : 'bg-slate-100'}`}>
                <div className={`h-full rounded-full ${row.color}`} style={{ width: `${width}%` }} />
              </div>
              <strong className="text-right">{eur(row.value)}</strong>
              <span className={`text-right ${dark ? 'text-white/45' : 'text-slate-500'}`}>{row.percent === null ? '—' : `${Math.round(row.percent)}%`}</span>
            </div>
          );
        })}
      </div>
      <div className={`mt-7 flex items-center gap-2 border-t pt-4 text-[11px] ${dark ? 'border-white/[0.08] text-white/35' : 'border-slate-100 text-slate-400'}`}>
        <RefreshCw className="h-3.5 w-3.5" />
        {lastUpdatedLabel ? <>Données mises à jour le {lastUpdatedLabel}</> : 'Données synchronisées en direct'}
      </div>
    </div>
  );
}
