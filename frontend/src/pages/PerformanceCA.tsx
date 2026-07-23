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
  CalendarDays, Users, Zap,
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
  // Le thème sombre du nouveau design ne s'applique qu'à l'onglet "Aperçu du
  // mois" (celui redessiné) ; l'onglet "Suivi paiements clients" garde son
  // habillage clair actuel pour ne pas retoucher son fonctionnement.
  const isDark = theme === 'dark' && tab === 'apercu';

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
      const pct = objectifCa > 0 ? Math.round((realise / objectifCa) * 100) : null;

      const ecart = objectifCa - realise;
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
  }, [prospects, paiementsByProspect, paiements, commerciaux, search, commercialFilter, statutFilter]);

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
    <div className="space-y-4">
      {/* HEADER */}
      <header
        className={`rounded-[24px] border p-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between transition-colors ${
          isDark ? 'border-white/10 bg-[#050b18] text-white' : 'border-slate-200 bg-white shadow-sm text-slate-900'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${isDark ? 'border-white/10 bg-white/[0.04]' : 'border-slate-200 bg-slate-50'}`}>
            <Target className="h-5 w-5 text-violet-500" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight md:text-2xl">PERFORMANCE CA</h1>
            <p className={`mt-0.5 text-sm ${textMuted}`}>
              CA probable (dossiers gagnés), confirmé (transmis à Mathilde) et encaissé, par commercial.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setTab('apercu')}
            className={`flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition hover:-translate-y-0.5 ${
              tab === 'apercu'
                ? 'border-2 border-violet-500 bg-violet-500/10 text-violet-300 shadow-[0_0_20px_rgba(139,92,246,.2)]'
                : isDark ? 'border border-white/10 bg-white/[0.035] hover:bg-white/[0.07]' : 'border border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <Home className="h-4 w-4" /> Aperçu du mois
          </button>
          <button
            onClick={() => setTab('paiements')}
            className={`flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition hover:-translate-y-0.5 ${
              tab === 'paiements'
                ? 'border-2 border-violet-500 bg-violet-500/10 text-violet-300 shadow-[0_0_20px_rgba(139,92,246,.2)]'
                : isDark ? 'border border-white/10 bg-white/[0.035] hover:bg-white/[0.07]' : 'border border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <Receipt className="h-4 w-4" /> Suivi paiements clients
          </button>
          {isAdmin && tab === 'apercu' && (
            <Select value={heroCommercialId} onValueChange={setHeroCommercialId}>
              <SelectTrigger className={`h-11 w-[180px] rounded-xl ${isDark ? 'border-white/10 bg-white/[0.035] text-white' : 'border-slate-200 bg-white'}`}>
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
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition hover:-translate-y-0.5 ${
              isDark ? 'border-white/10 bg-white/[0.035]' : 'border-slate-200 bg-white shadow-sm'
            }`}
          >
            {theme === 'dark' ? <Sun className="h-5 w-5 text-amber-400" /> : <Moon className="h-5 w-5 text-violet-600" />}
          </button>
          {tab === 'apercu' && (
            <div className={`flex h-11 items-center gap-1.5 rounded-xl border pl-3 pr-1.5 ${isDark ? 'border-white/10 bg-white/[0.035]' : 'border-slate-200 bg-white'}`}>
              <CalendarDays className="h-4 w-4 shrink-0 opacity-60" />
              <Select value={String(selectedMonthIdx)} onValueChange={setMonthPart}>
                <SelectTrigger className={`h-8 w-[110px] rounded-lg border-0 shadow-none px-2 ${isDark ? 'text-white' : ''}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((m, i) => (
                    <SelectItem key={m} value={String(i)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedYear} onValueChange={setYearPart}>
                <SelectTrigger className={`h-8 w-[72px] rounded-lg border-0 shadow-none px-2 ${isDark ? 'text-white' : ''}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {yearsOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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
            className={`relative overflow-hidden rounded-[28px] border min-h-[360px] md:min-h-[400px] flex flex-col justify-center ${
              isDark ? 'border-violet-500/20 bg-[#070c1a] text-white' : 'border-slate-200 bg-white shadow-sm text-slate-900'
            }`}
          >
            {/* Montagne + chemin lumineux : visible, aucun voile opaque par-dessus */}
            <MountainScene
              dark={isDark}
              progress={viewMode === 'global' ? performance.progressPercent : (performance.currentLevel ? ((performance.currentLevel.level - 1) / 9) * 100 : 0)}
            />
            <div
              className={`pointer-events-none absolute inset-0 ${
                isDark
                  ? 'bg-[radial-gradient(circle_at_75%_20%,rgba(124,58,237,.18),transparent_38%)]'
                  : 'bg-[radial-gradient(circle_at_75%_20%,rgba(124,58,237,.06),transparent_38%)]'
              }`}
            />
            <div className="relative grid gap-5 p-6 md:p-8 md:grid-cols-[190px_1fr] xl:grid-cols-[210px_1fr_300px] items-center">
              {viewMode === 'commercial' && performance.currentLevel ? (
                <RankCard level={performance.currentLevel.level} name={heroCommercialName} stars={Math.floor((performance.levelProgress ?? 0) / 34)} />
              ) : (
                <TeamBadge progress={performance.progressPercent} />
              )}

              {/* progression principale */}
              <div className="flex flex-col justify-center">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-violet-300">
                    {viewMode === 'global' ? 'CA PROBABLE ÉQUIPE' : 'CA PROBABLE'}
                  </span>
                  <Info className="h-4 w-4 opacity-50" />
                </div>
                <div className="mt-1 flex flex-wrap items-end gap-4">
                  <strong className="text-5xl font-black tracking-tight md:text-7xl">{eur(performance.probable)}</strong>
                </div>

                {viewMode === 'commercial' && performance.currentLevel && performance.nextLevel ? (
                  <>
                    <div className="mt-6 flex items-center gap-5">
                      <div className={`h-7 flex-1 overflow-hidden rounded-full ring-1 ${isDark ? 'bg-black/50 ring-white/10' : 'bg-slate-200 ring-black/5'}`}>
                        <div
                          className="relative h-full rounded-full bg-gradient-to-r from-fuchsia-400 via-purple-500 to-violet-500 shadow-[0_0_30px_rgba(168,85,247,.75)] transition-all duration-700"
                          style={{ width: `${Math.max(performance.levelProgress ?? 0, 4)}%` }}
                        >
                          <div className="absolute right-0 top-1/2 h-9 w-9 -translate-y-1/2 translate-x-1/2 rounded-full bg-white/90 blur-md" />
                        </div>
                      </div>
                      <div className="text-3xl font-black text-violet-300">{Math.round(performance.levelProgress ?? 0)}%</div>
                    </div>
                    <div className="mt-4 flex justify-between gap-4 text-sm">
                      <div>
                        <div className={isDark ? 'text-white/60' : 'text-slate-500'}>Niveau {performance.currentLevel.level}</div>
                        <div className="mt-0.5 font-semibold">{eur(performance.currentLevel.amount)}</div>
                      </div>
                      <div className="text-right">
                        <div className={isDark ? 'text-white/60' : 'text-slate-500'}>Niveau {performance.nextLevel.level}</div>
                        <div className="mt-0.5 font-semibold">{eur(performance.nextLevel.amount)}</div>
                      </div>
                    </div>
                    {performance.currentLevel.level < performance.nextLevel.level ? (
                      <div className={`mt-5 inline-flex w-fit items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${isDark ? 'border-violet-500/20 bg-violet-500/[0.08]' : 'border-violet-100 bg-violet-50'}`}>
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
                    <div className="mt-6 flex items-center gap-5">
                      <div className={`h-7 flex-1 overflow-hidden rounded-full ring-1 ${isDark ? 'bg-black/50 ring-white/10' : 'bg-slate-200 ring-black/5'}`}>
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#5A9BA3] via-[#6AABB4] to-violet-500 shadow-[0_0_25px_rgba(106,171,180,.55)] transition-all duration-700"
                          style={{ width: `${Math.max(performance.progressPercent, 4)}%` }}
                        />
                      </div>
                      <div className="text-3xl font-black text-[#6AABB4]">{Math.round(performance.progressPercent)}%</div>
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

              {/* restant — carte "verre" séparée mais intégrée au hero */}
              <div className={`flex flex-col justify-center rounded-2xl border p-5 backdrop-blur-md ${isDark ? 'border-white/15 bg-white/[0.06]' : 'border-slate-200 bg-white/85 shadow-sm'}`}>
                <span className={`text-sm font-semibold ${isDark ? 'text-white/70' : 'text-slate-500'}`}>RESTANT À ATTEINDRE</span>
                <strong className="mt-2 text-3xl font-black">{eur(performance.remaining)}</strong>
                <div className={`mt-3 text-sm leading-6 ${isDark ? 'text-white/70' : 'text-slate-600'}`}>
                  {performance.remaining <= 0 && performance.objectifCa > 0 ? (
                    <span className="flex items-center gap-2 font-semibold text-emerald-400"><Trophy className="w-5 h-5" /> Objectif atteint ce mois !</span>
                  ) : performance.objectifCa === 0 ? (
                    <span>Aucun objectif défini pour ce mois.</span>
                  ) : isMoisCourant ? (
                    <>
                      Il manque <strong className="text-white">{eur(performance.remaining)}</strong> — soit{' '}
                      <strong className="text-amber-400">{eur(performance.dailyNeeded)}/jour ouvré</strong> sur{' '}
                      <strong className="text-amber-400">{joRestants} j. restants</strong>.
                    </>
                  ) : (
                    <>Il manquait <strong className="text-white">{eur(performance.remaining)}</strong> pour atteindre l'objectif de {MONTH_NAMES[selectedMonthIdx]} {selectedYear}.</>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* PROGRESSION — compacte, individuelle (10 niveaux) ou équipe (25/50/75/100%) */}
          {viewMode === 'commercial' && performance.currentLevel ? (
            <LevelProgression dark={isDark} currentLevel={performance.currentLevel} />
          ) : (
            <TeamProgression dark={isDark} progress={performance.progressPercent} />
          )}

          {/* KPI — toujours ces 4-là */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              dark={isDark} title="CA PROBABLE" value={eur(performance.probable)} subtitle="Cumulé du mois"
              growth={performance.probableGrowth} accent="violet"
              progress={performance.objectifCa > 0 ? clamp((performance.probable / performance.objectifCa) * 100, 0, 100) : 0}
              icon={<ArrowUpRight className="h-5 w-5" />}
            />
            <KpiCard
              dark={isDark} title="CA ENCAISSÉ" value={eur(performance.encaisse)} subtitle="Règlements reçus"
              growth={performance.encaisseGrowth} accent="blue"
              progress={performance.objectifCa > 0 ? clamp((performance.encaisse / performance.objectifCa) * 100, 0, 100) : 0}
              icon={<Wallet className="h-5 w-5" />}
            />
            <KpiCard
              dark={isDark} title="OBJECTIF" value={eur(performance.objectifCa)} subtitle="Objectif du mois"
              accent="amber" progress={100} icon={<Target className="h-5 w-5" />}
            />
            <KpiCard
              dark={isDark} title="COMMISSION PAYÉE" value={eur(performance.commission)} subtitle="Règlements encaissés ce mois"
              growth={performance.commissionGrowth} accent="green" icon={<Banknote className="h-5 w-5" />}
            />
          </div>

          {/* Graphique réel + récapitulatif (CA confirmé toujours visible ici, jamais fusionné) */}
          <div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
            <RevenueChart dark={isDark} series={dailySeries} objectif={performance.objectifCa} />
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

// Décor de fond du hero : chaîne de montagnes en couches + chemin lumineux
// ascendant vers un sommet marqué d'un fanion, avec un repère qui monte selon
// la progression réelle — jamais masqué par un overlay opaque.
function MountainScene({ dark, progress }: { dark: boolean; progress: number }) {
  const markerY = 450 - clamp(progress, 0, 100) * 3.3;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg viewBox="0 0 1600 500" preserveAspectRatio="xMidYMax slice" className="absolute bottom-0 right-[-6%] h-full w-[75%]">
        <defs>
          <linearGradient id="mountainMain" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={dark ? '#253B70' : '#DCE8FF'} />
            <stop offset="55%" stopColor={dark ? '#17274D' : '#B8CDF5'} />
            <stop offset="100%" stopColor={dark ? '#0E1B36' : '#8FADE3'} />
          </linearGradient>
          <linearGradient id="pathGradient" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#6D28D9" />
            <stop offset="60%" stopColor="#C084FC" />
            <stop offset="100%" stopColor="#FFFFFF" />
          </linearGradient>
          <filter id="pathGlow">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <path
          d="M0 500 L160 350 L260 420 L430 260 L560 390 L720 235 L850 395 L1010 255 L1160 405 L1320 300 L1600 500 Z"
          fill={dark ? '#0A1429' : '#E2EAF8'} opacity=".8"
        />
        <path
          d="M430 500 L640 390 L770 330 L880 235 L985 45 L1090 218 L1200 310 L1320 385 L1530 500 Z"
          fill="url(#mountainMain)"
        />
        <path d="M985 45 L925 150 L970 130 L1000 170 L1020 125 L1090 218 Z" fill={dark ? '#AFC8FF' : '#FFFFFF'} opacity=".88" />
        <path
          d="M760 500 C790 440 920 465 925 395 C930 335 855 350 900 300 C945 250 1040 280 1005 220 C980 175 945 165 985 85"
          stroke="url(#pathGradient)" strokeWidth="8" fill="none" strokeLinecap="round" filter="url(#pathGlow)"
        />
        <line x1="985" y1="42" x2="985" y2="4" stroke="#FFFFFF" strokeWidth="3" />
        <path d="M987 5 L1040 22 L987 39 Z" fill="#8B5CF6" />
        <circle cx="910" cy={markerY} r="11" fill="#FFFFFF" stroke="#8B5CF6" strokeWidth="5" filter="url(#pathGlow)" />
      </svg>
      <div className={`absolute inset-0 ${dark ? 'bg-gradient-to-r from-[#07101f] via-[#07101f]/50 to-transparent' : 'bg-gradient-to-r from-white via-white/45 to-transparent'}`} />
    </div>
  );
}

// Vue "Tous les commerciaux" (admin) : pas de niveau individuel, uniquement
// la progression collective vers l'objectif de l'équipe.
function TeamBadge({ progress }: { progress: number }) {
  return (
    <div className="flex items-center justify-center">
      <div className="flex h-[200px] w-[172px] flex-col items-center justify-center rounded-[34px] border border-[#6AABB4]/30 bg-white/10 text-center backdrop-blur-md md:h-[220px] md:w-[188px]">
        <Users className="h-6 w-6 text-[#6AABB4]" />
        <div className="mt-3 text-[10px] font-black uppercase tracking-[0.2em] text-[#6AABB4]">Performance équipe</div>
        <div className="mt-2 text-[60px] font-black leading-none tracking-tight text-white md:text-[68px]">{Math.round(progress)}%</div>
        <div className="mt-3 text-xs text-white/70">de l'objectif collectif</div>
      </div>
    </div>
  );
}

// Vue "un commercial" : badge de rang façon jeu vidéo premium, gros niveau,
// diamants de progression réels (dérivés de levelProgress).
function RankCard({ level, name, stars }: { level: number; name?: string; stars: number }) {
  return (
    <div className="flex items-center justify-center">
      <div className="relative flex h-[200px] w-[172px] flex-col items-center justify-center overflow-hidden rounded-[34px] border border-violet-400/30 bg-white/10 backdrop-blur-md md:h-[220px] md:w-[188px]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(124,58,237,.35),transparent_55%)]" />
        <Trophy className="relative z-10 h-6 w-6 text-amber-400" />
        <div className="relative z-10 mt-2 text-[10px] font-black uppercase tracking-[0.22em] text-violet-300">Niveau actuel</div>
        <div className="relative z-10 mt-1 bg-gradient-to-b from-white via-violet-200 to-violet-500 bg-clip-text text-[76px] font-black leading-none tracking-tight text-transparent drop-shadow-[0_2px_10px_rgba(0,0,0,.4)] md:text-[84px]">
          {String(level).padStart(2, '0')}
        </div>
        <div className="relative z-10 mt-3 flex gap-2">
          {[0, 1, 2].map((s) => (
            <span key={s} className={`h-2.5 w-2.5 rotate-45 rounded-[2px] ${s < stars ? 'bg-amber-400' : 'bg-white/20'}`} />
          ))}
        </div>
        {name && <div className="relative z-10 mt-3 text-xs text-white/70">{name}</div>}
      </div>
    </div>
  );
}

// Frise des 10 niveaux — compacte (utilisée uniquement en vue individuelle).
function LevelProgression({ dark, currentLevel }: { dark: boolean; currentLevel: GameLevel }) {
  const currentIndex = LEVELS.findIndex((l) => l.level === currentLevel.level);
  return (
    <section className={`rounded-[20px] border p-4 ${dark ? 'border-white/10 bg-[#080d1a] text-white' : 'border-slate-200 bg-white shadow-sm text-slate-900'}`}>
      <h2 className="mb-3 text-xs font-bold uppercase tracking-wide">Progression des niveaux</h2>
      <div className="relative overflow-x-auto pb-1">
        <div className="min-w-[820px]">
          <div className="relative flex items-start justify-between">
            <div className={`absolute left-3 right-3 top-[14px] h-[2px] ${dark ? 'bg-white/10' : 'bg-slate-200'}`} />
            <div className="absolute left-3 top-[14px] h-[2px] bg-lime-500" style={{ width: `${clamp((currentIndex / (LEVELS.length - 1)) * 100, 0, 100)}%` }} />
            {LEVELS.map((level, index) => {
              const done = index < currentIndex;
              const current = index === currentIndex;
              const locked = index > currentIndex;
              return (
                <div key={level.level} className="relative z-10 flex w-[72px] flex-col items-center text-center">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold ${
                      done ? 'border-lime-400 bg-lime-500 text-white'
                        : current ? 'border-violet-400 bg-violet-600 text-white shadow-[0_0_16px_rgba(139,92,246,.7)]'
                        : dark ? 'border-white/20 bg-[#101827] text-white/40' : 'border-slate-300 bg-slate-50 text-slate-400'
                    }`}
                  >
                    {done ? <Check className="h-3.5 w-3.5" /> : locked ? <Lock className="h-3 w-3" /> : level.level}
                  </div>
                  <div className={`mt-1.5 text-[10px] font-bold ${current ? 'text-violet-400' : ''}`}>NIV. {level.level}</div>
                  <div className={`text-[10px] ${dark ? 'text-white/40' : 'text-slate-400'}`}>{eur(level.amount)}</div>
                </div>
              );
            })}
          </div>
        </div>
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
  dark, icon, title, value, subtitle, growth, progress, accent,
}: {
  dark: boolean;
  icon: ReactNode;
  title: string;
  value: string;
  subtitle: string;
  growth?: number | null;
  progress?: number;
  accent: 'violet' | 'blue' | 'amber' | 'green';
}) {
  const styles = {
    violet: { icon: 'bg-violet-500/15 text-violet-500', bar: 'bg-violet-500' },
    blue: { icon: 'bg-blue-500/15 text-blue-500', bar: 'bg-blue-500' },
    amber: { icon: 'bg-amber-400/15 text-amber-500', bar: 'bg-amber-400' },
    green: { icon: 'bg-emerald-500/15 text-emerald-500', bar: 'bg-emerald-500' },
  }[accent];
  return (
    <div className={`rounded-[22px] border p-5 ${dark ? 'border-white/10 bg-[#080d1a] text-white' : 'border-slate-200 bg-white shadow-sm text-slate-800'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${styles.icon}`}>{icon}</div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold">{title}</span>
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
      <div className="mt-4 text-3xl font-black">{value}</div>
      <div className={`mt-1 text-xs ${dark ? 'text-white/45' : 'text-slate-500'}`}>{subtitle}</div>
      {progress !== undefined && (
        <div className={`mt-7 h-2 overflow-hidden rounded-full ${dark ? 'bg-white/10' : 'bg-slate-100'}`}>
          <div className={`h-full rounded-full ${styles.bar}`} style={{ width: `${clamp(progress, 0, 100)}%` }} />
        </div>
      )}
    </div>
  );
}

type DailyPoint = { day: number; cumul: number };

// Graphique réel à 3 courbes (probable / confirmé / encaissé) + objectif en
// pointillé — dérivé des vraies signatures, transmissions à Mathilde et
// règlements du mois affiché (jamais un tracé fixe).
function RevenueChart({ dark, series, objectif }: { dark: boolean; series: { probable: DailyPoint[]; confirme: DailyPoint[]; encaisse: DailyPoint[] }; objectif: number }) {
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
  const objY = toY(objectif);
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(maxVal * f));
  const xLabels = [1, 5, 10, 15, 20, 25, lastDay].filter((d, i, arr) => arr.indexOf(d) === i && d <= lastDay);

  return (
    <div className={`rounded-[24px] border p-5 md:p-6 ${dark ? 'border-white/10 bg-[#080d1a] text-white' : 'border-slate-200 bg-white shadow-sm text-slate-900'}`}>
      <h3 className="text-sm font-black">ÉVOLUTION DU CA</h3>
      <div className={`mt-2 flex flex-wrap gap-4 text-[11px] ${dark ? 'text-white/40' : 'text-slate-500'}`}>
        <span className="flex items-center gap-1.5"><span className="h-[2px] w-4 bg-violet-500" /> CA probable</span>
        <span className="flex items-center gap-1.5"><span className="h-[2px] w-4 bg-[#5A9BA3]" /> CA confirmé</span>
        <span className="flex items-center gap-1.5"><span className="h-[2px] w-4 bg-blue-500" /> CA encaissé</span>
        <span className="flex items-center gap-1.5"><span className="h-[2px] w-4 border-t border-dashed border-slate-400" /> Objectif</span>
      </div>
      <div className="relative mt-5 h-[300px]">
        <div className="absolute inset-0 flex flex-col justify-between">
          {ticks.map((value) => (
            <div key={value} className="flex items-center gap-3">
              <span className={`w-14 text-right text-[11px] ${dark ? 'text-white/35' : 'text-slate-400'}`}>{eur(value)}</span>
              <div className={`h-px flex-1 ${dark ? 'bg-white/[0.06]' : 'bg-slate-100'}`} />
            </div>
          ))}
        </div>
        <svg className="absolute bottom-4 left-[64px] right-0 h-[270px] w-[calc(100%-64px)]" viewBox="0 0 900 290" preserveAspectRatio="none">
          {series.probable.length > 0 && <path d={pathFor(series.probable)} fill="none" stroke="#8B5CF6" strokeWidth="3.5" strokeLinecap="round" />}
          {series.confirme.length > 0 && <path d={pathFor(series.confirme)} fill="none" stroke="#5A9BA3" strokeWidth="3.5" strokeLinecap="round" />}
          {series.encaisse.length > 0 && <path d={pathFor(series.encaisse)} fill="none" stroke="#3B82F6" strokeWidth="3.5" strokeLinecap="round" />}
          {objectif > 0 && <path d={`M0 ${objY} L900 ${objY}`} fill="none" stroke="#94A3B8" strokeWidth="2" strokeDasharray="9 9" opacity="0.7" />}
        </svg>
        <div className={`absolute bottom-0 left-[64px] right-0 flex justify-between text-[11px] ${dark ? 'text-white/35' : 'text-slate-400'}`}>
          {xLabels.map((d) => <span key={d}>{String(d).padStart(2, '0')}</span>)}
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
    <div className={`rounded-[24px] border p-5 md:p-6 ${dark ? 'border-white/10 bg-[#080d1a] text-white' : 'border-slate-200 bg-white shadow-sm text-slate-900'}`}>
      <h3 className="text-sm font-black">RÉCAPITULATIF DU MOIS</h3>
      <div className="mt-7 space-y-6">
        {rows.map((row) => {
          const width = row.percent === null ? Math.min((row.value / (objectif || 1)) * 100, 100) : clamp(row.percent, 0, 100);
          return (
            <div key={row.label}>
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className={dark ? 'text-white/60' : 'text-slate-600'}>{row.label}</span>
                <div className="flex gap-4">
                  <strong>{eur(row.value)}</strong>
                  <span className={`w-10 text-right ${dark ? 'text-white/40' : 'text-slate-500'}`}>{row.percent === null ? '—' : `${Math.round(row.percent)}%`}</span>
                </div>
              </div>
              <div className={`mt-2 h-2 overflow-hidden rounded-full ${dark ? 'bg-white/[0.08]' : 'bg-slate-100'}`}>
                <div className={`h-full rounded-full ${row.color}`} style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className={`mt-8 flex items-center gap-2 text-xs ${dark ? 'text-white/35' : 'text-slate-400'}`}>
        <RefreshCw className="h-3.5 w-3.5" />
        {lastUpdatedLabel ? <>Données mises à jour le {lastUpdatedLabel}</> : 'Données synchronisées en direct'}
      </div>
    </div>
  );
}
