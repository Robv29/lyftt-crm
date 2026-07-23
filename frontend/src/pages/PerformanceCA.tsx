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
  Trophy, Flame, Percent, Search, Plus, Trash2, Receipt,
  AlertTriangle, ExternalLink, PiggyBank, Download,
  ArrowUpRight, Banknote, Home, Info, Lock, Moon, Sun, RefreshCw,
  CalendarDays,
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
// individuel de chacun.
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
  // thème et les filtres d'une visite à l'autre plutôt que de repartir de zéro.
  const [tab, setTab] = usePersistentState<'apercu' | 'paiements'>('lyftt.performanceCa.tab', 'apercu');
  const [mois, setMois] = usePersistentState<string>('lyftt.performanceCa.mois', moisCourant);
  const [theme, setTheme] = usePersistentState<'dark' | 'light'>('lyftt.performanceCa.theme', 'dark');
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

  // Mois précédent : uniquement pour les badges d'évolution des 4 KPI de la
  // page (aucune autre section ne s'en sert) — jamais de chiffre inventé.
  const prevMoisStr = useMemo(() => shiftMonth(mois, -1), [mois]);
  const prevRows = useMemo(() => buildRowsForMois(prevMoisStr), [buildRowsForMois, prevMoisStr]);
  const prevVisibleRows = isAdmin ? prevRows : prevRows.filter((r) => r.user.id === userRole?.id);
  const prevTotals = useMemo(() => prevVisibleRows.reduce(
    (acc, r) => ({
      probable: acc.probable + r.probable,
      encaisse: acc.encaisse + r.encaisse,
      commission: acc.commission + r.commission,
    }),
    { probable: 0, encaisse: 0, commission: 0 }
  ), [prevVisibleRows]);

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

  // --- Jauge de gamification "Niveau", basée sur le CA probable réel du mois sélectionné ---
  const currentLevelIndex = useMemo(() => {
    let index = 0;
    LEVELS.forEach((item, i) => { if (totals.probable >= item.amount) index = i; });
    return index;
  }, [totals.probable]);
  const currentLevel = LEVELS[currentLevelIndex];
  const nextLevel = LEVELS[currentLevelIndex + 1] ?? LEVELS[LEVELS.length - 1];
  const previousThreshold = currentLevelIndex > 0 ? LEVELS[currentLevelIndex - 1].amount : 0;
  const levelProgress = Math.min(
    Math.max(((totals.probable - previousThreshold) / (nextLevel.amount - previousThreshold || 1)) * 100, 0),
    100
  );

  const targetProgress = totals.objectifCa > 0 ? Math.min(Math.round((totals.probable / totals.objectifCa) * 100), 100) : 0;
  const collectedProgress = totals.objectifCa > 0 ? Math.min(Math.round((totals.encaisse / totals.objectifCa) * 100), 100) : 0;

  const remaining = Math.max(totals.objectifCa - totals.probable, 0);
  const joRestants = joursOuvresRestants();
  const dailyNeeded = isMoisCourant && joRestants > 0 ? Math.ceil(remaining / joRestants) : remaining;

  const probableGrowth = growthPct(totals.probable, prevTotals.probable);
  const collectedGrowth = growthPct(totals.encaisse, prevTotals.encaisse);
  const commissionGrowth = growthPct(totals.commission, prevTotals.commission);

  // Courbes réelles jour par jour du mois sélectionné (aucune donnée
  // inventée) : cumul du CA probable signé, du CA effectivement encaissé et
  // de la commission générée — utilisées pour le grand graphique et les
  // mini-sparklines des cartes KPI.
  const visibleUserIds = useMemo(() => new Set(visibleRows.map((r) => r.user.id)), [visibleRows]);
  const dailySeries = useMemo(() => {
    const [y, m] = mois.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const probableByDay = new Array(lastDay + 1).fill(0);
    const encaisseByDay = new Array(lastDay + 1).fill(0);
    const commissionByDay = new Array(lastDay + 1).fill(0);

    for (const p of prospects) {
      if (!p.date_signature || p.date_signature.slice(0, 7) !== mois) continue;
      if (p.signed_by_user_id == null || !visibleUserIds.has(p.signed_by_user_id)) continue;
      const day = Number(p.date_signature.slice(8, 10));
      if (day >= 1 && day <= lastDay) probableByDay[day] += Number(p.montant_potentiel) || 0;
    }

    const tauxByUser = new Map(commerciaux.map((u) => [u.id, Number(u.taux_commission) || 0]));
    for (const pmt of paiements) {
      if (pmt.date_paiement.slice(0, 7) !== mois) continue;
      const p = prospects.find((pp) => pp.id === pmt.prospect_id);
      if (!p || p.signed_by_user_id == null || !visibleUserIds.has(p.signed_by_user_id)) continue;
      const day = Number(pmt.date_paiement.slice(8, 10));
      if (day < 1 || day > lastDay) continue;
      const amt = Number(pmt.montant) || 0;
      encaisseByDay[day] += amt;
      commissionByDay[day] += amt * ((tauxByUser.get(p.signed_by_user_id) || 0) / 100);
    }

    const probable: { day: number; cumul: number }[] = [];
    const encaisse: { day: number; cumul: number }[] = [];
    const commission: { day: number; cumul: number }[] = [];
    let cp = 0, ce = 0, cc = 0;
    for (let d = 1; d <= lastDay; d++) {
      cp += probableByDay[d]; ce += encaisseByDay[d]; cc += commissionByDay[d];
      probable.push({ day: d, cumul: cp });
      encaisse.push({ day: d, cumul: ce });
      commission.push({ day: d, cumul: cc });
    }
    return { probable, encaisse, commission };
  }, [prospects, paiements, mois, visibleUserIds, commerciaux]);
  const chartPoints = dailySeries.probable;
  const chartMax = Math.max(totals.objectifCa, ...chartPoints.map((p) => p.cumul), 1) * 1.08;

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
    ? 'border-white/10 bg-[#091225] text-white'
    : 'border-slate-200 bg-white shadow-sm text-slate-800';
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
            <MountainScene dark={isDark} />
            <div
              className={`pointer-events-none absolute inset-0 ${
                isDark
                  ? 'bg-[radial-gradient(circle_at_75%_20%,rgba(124,58,237,.22),transparent_38%)]'
                  : 'bg-[radial-gradient(circle_at_75%_20%,rgba(124,58,237,.08),transparent_38%)]'
              }`}
            />
            <div className="relative grid gap-5 p-6 md:p-8 md:grid-cols-[190px_1fr] xl:grid-cols-[210px_1fr_300px] items-center">
              {/* niveau — badge premium façon rang de jeu vidéo */}
              <RankBadge level={currentLevel.level} stars={Math.floor(levelProgress / 34)} />

              {/* progression principale */}
              <div className="flex flex-col justify-center">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-violet-300">CA PROBABLE</span>
                  <Info className="h-4 w-4 opacity-50" />
                </div>
                <div className="mt-1 flex flex-wrap items-end gap-4">
                  <strong className="text-5xl font-black tracking-tight md:text-7xl">{eur(totals.probable)}</strong>
                  <div className="mb-2 text-2xl font-black text-violet-300">{Math.round(levelProgress)}%</div>
                </div>
                <div className={`mt-6 h-7 overflow-hidden rounded-full ring-1 ${isDark ? 'bg-black/50 ring-white/10' : 'bg-slate-200 ring-black/5'}`}>
                  <div
                    className="relative h-full rounded-full bg-gradient-to-r from-fuchsia-400 via-purple-500 to-violet-500 shadow-[0_0_30px_rgba(168,85,247,.75)] transition-all duration-700"
                    style={{ width: `${Math.max(levelProgress, 4)}%` }}
                  >
                    <div className="absolute right-0 top-1/2 h-9 w-9 -translate-y-1/2 translate-x-1/2 rounded-full bg-white/90 blur-md" />
                  </div>
                </div>
                <div className="mt-4 flex justify-between gap-4 text-sm">
                  <div>
                    <div className="font-semibold">Niveau {currentLevel.level}</div>
                    <div className={isDark ? 'text-white/60' : 'text-slate-500'}>{eur(currentLevel.amount)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">Prochain niveau {nextLevel.level}</div>
                    <div className={isDark ? 'text-white/60' : 'text-slate-500'}>{eur(nextLevel.amount)}</div>
                  </div>
                </div>
              </div>

              {/* restant — carte "verre" séparée mais intégrée au hero */}
              <div
                className={`flex flex-col justify-center rounded-2xl border p-5 backdrop-blur-md ${
                  isDark ? 'border-white/15 bg-white/[0.06]' : 'border-slate-200 bg-white/80 shadow-sm'
                }`}
              >
                <span className={`text-sm font-semibold ${isDark ? 'text-white/70' : 'text-slate-500'}`}>RESTANT À ATTEINDRE</span>
                <strong className="mt-2 text-3xl font-black">{eur(remaining)}</strong>
                <div className={`mt-3 text-sm leading-6 ${isDark ? 'text-white/70' : 'text-slate-600'}`}>
                  {remaining <= 0 && totals.objectifCa > 0 ? (
                    <span className="flex items-center gap-2 font-semibold text-emerald-400"><Trophy className="w-5 h-5" /> Objectif atteint ce mois !</span>
                  ) : totals.objectifCa === 0 ? (
                    <span>Aucun objectif défini pour ce mois.</span>
                  ) : isMoisCourant ? (
                    <>
                      Il manque <strong className="text-white">{eur(remaining)}</strong> — soit{' '}
                      <strong className="text-amber-400">{eur(dailyNeeded)}/jour ouvré</strong> sur{' '}
                      <strong className="text-amber-400">{joRestants} j. restants</strong>.
                    </>
                  ) : (
                    <>Il manquait <strong className="text-white">{eur(remaining)}</strong> pour atteindre l'objectif de {MONTH_NAMES[selectedMonthIdx]} {selectedYear}.</>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* LEVEL TRACK — compact */}
          <div className={`rounded-[20px] border p-4 ${isDark ? 'border-white/10 bg-[#091225] text-white' : 'border-slate-200 bg-white shadow-sm text-slate-900'}`}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wide">Progression des niveaux</h2>
              <span className={`text-xs ${textMuted2}`}>{targetProgress}% de l'objectif</span>
            </div>
            <div className="relative overflow-x-auto pb-1">
              <div className="min-w-[820px]">
                <div className="relative flex items-start justify-between">
                  <div className={`absolute left-3 right-3 top-[14px] h-[2px] ${isDark ? 'bg-white/10' : 'bg-slate-200'}`} />
                  <div
                    className="absolute left-3 top-[14px] h-[2px] bg-lime-500"
                    style={{ width: `${Math.min((currentLevelIndex / (LEVELS.length - 1)) * 100, 100)}%` }}
                  />
                  {LEVELS.map((level, index) => {
                    const completed = index < currentLevelIndex;
                    const current = index === currentLevelIndex;
                    const locked = index > currentLevelIndex;
                    return (
                      <div key={level.level} className="relative z-10 flex w-[72px] flex-col items-center text-center">
                        <div
                          className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold ${
                            completed
                              ? 'border-lime-400 bg-lime-500 text-white'
                              : current
                              ? 'border-violet-400 bg-violet-600 text-white shadow-[0_0_16px_rgba(139,92,246,.7)]'
                              : isDark ? 'border-white/20 bg-[#101827] text-white/40' : 'border-slate-300 bg-slate-50 text-slate-400'
                          }`}
                        >
                          {completed ? <Check className="h-3.5 w-3.5" /> : locked ? <Lock className="h-3 w-3" /> : level.level}
                        </div>
                        <div className={`mt-1.5 text-[10px] font-bold ${current ? 'text-violet-400' : ''}`}>NIV. {level.level}</div>
                        <div className={`text-[10px] ${textMuted2}`}>{eur(level.amount)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* KPI */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard dark={isDark} icon={<ArrowUpRight className="h-5 w-5" />} title="CA PROBABLE" value={eur(totals.probable)} subtitle="Cumulé ce mois" growth={probableGrowth} accent="violet" sparkline={dailySeries.probable} />
            <KpiCard dark={isDark} icon={<Wallet className="h-5 w-5" />} title="CA ENCAISSÉ" value={eur(totals.encaisse)} subtitle="Cumulé ce mois" growth={collectedGrowth} accent="blue" sparkline={dailySeries.encaisse} />
            <KpiCard dark={isDark} icon={<Target className="h-5 w-5" />} title="OBJECTIF" value={eur(totals.objectifCa)} subtitle="Objectif du mois" progress={targetProgress} accent="amber" />
            <KpiCard dark={isDark} icon={<Banknote className="h-5 w-5" />} title="COMMISSION PAYÉE" value={eur(totals.commission)} subtitle="Ce mois" growth={commissionGrowth} accent="green" sparkline={dailySeries.commission} />
          </div>

          {/* BAS DE PAGE */}
          <div className="grid gap-4 xl:grid-cols-[1.35fr_.9fr]">
            <div className={`rounded-[24px] border p-5 ${isDark ? 'border-white/10 bg-[#091225] text-white' : 'border-slate-200 bg-white shadow-sm text-slate-900'}`}>
              <div className="mb-6">
                <h2 className="font-bold">ÉVOLUTION DU CA PROBABLE</h2>
                <div className={`mt-2 flex gap-4 text-xs ${textMuted2}`}>
                  <span className="flex items-center gap-2"><span className="h-[2px] w-5 bg-violet-500" /> CA probable</span>
                  <span className="flex items-center gap-2"><span className="h-[2px] w-5 border-t border-dashed border-slate-400" /> Objectif</span>
                </div>
              </div>
              <EvolutionChart points={chartPoints} max={chartMax} objectif={totals.objectifCa} dark={isDark} levels={LEVELS} />
            </div>
            <div className={`rounded-[24px] border p-5 ${isDark ? 'border-white/10 bg-[#091225] text-white' : 'border-slate-200 bg-white shadow-sm text-slate-900'}`}>
              <h2 className="font-bold">RÉCAPITULATIF DU MOIS</h2>
              <div className="mt-8 space-y-7">
                <SummaryRow dark={isDark} label="CA probable" value={totals.probable} total={totals.objectifCa || 1} percentage={targetProgress} color="bg-violet-500" />
                <SummaryRow dark={isDark} label="CA encaissé" value={totals.encaisse} total={totals.objectifCa || 1} percentage={collectedProgress} color="bg-blue-500" />
                <SummaryRow dark={isDark} label="Objectif" value={totals.objectifCa} total={totals.objectifCa || 1} percentage={100} color="bg-amber-400" />
                <SummaryRow dark={isDark} label="Commission payée" value={totals.commission} total={totals.objectifCa || 1} percentage={null} color="bg-emerald-500" />
              </div>
              <div className={`mt-10 flex items-center gap-2 text-xs ${textMuted2}`}>
                <RefreshCw className="h-3.5 w-3.5" />
                {lastUpdatedLabel ? <>Données mises à jour le {lastUpdatedLabel}</> : 'Données synchronisées en direct'}
              </div>
            </div>
          </div>

          {/* Rattrapage — uniquement pertinent sur le mois en cours */}
          {isMoisCourant && (
            <div className={`rounded-[24px] border ${cardShell}`}>
              <div className="p-5 pb-0">
                <h2 className="text-lg font-bold flex items-center gap-2"><Flame className="w-5 h-5 text-orange-500" /> Rattrapage — mois en cours</h2>
              </div>
              <div className="p-5 space-y-2">
                {visibleRows.filter((r) => r.objectifCa > 0).length === 0 ? (
                  <p className={`text-sm ${textMuted2}`}>Aucun objectif défini ce mois-ci.</p>
                ) : (
                  visibleRows.filter((r) => r.objectifCa > 0).map((r) => (
                    <div key={r.user.id} className={`flex items-center justify-between p-3 rounded-xl ${isDark ? 'bg-white/[0.04]' : 'bg-slate-50'}`}>
                      <span className="text-sm font-medium">{r.user.first_name} {r.user.last_name}</span>
                      {r.ecart <= 0 ? (
                        <span className="text-sm font-semibold text-emerald-500 flex items-center gap-1"><Trophy className="w-4 h-4" /> Objectif atteint</span>
                      ) : (
                        <span className="text-sm text-orange-500">
                          Il manque <span className="font-semibold">{eur(r.ecart)}</span>
                          {joursOuvresRestants() > 0 && (
                            <> — soit <span className="font-semibold">{eur(r.parJourNecessaire)}</span>/jour ouvré sur {joursOuvresRestants()} j. restants</>
                          )}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Classement — gamification, visible à tous */}
          <div className={`rounded-[24px] border ${cardShell}`}>
            <div className="p-5 pb-0">
              <h2 className="text-lg font-bold flex items-center gap-2"><Trophy className="w-5 h-5 text-amber-500" /> Classement du mois</h2>
            </div>
            <div className="p-5 space-y-1.5">
              {classement.map((r, idx) => (
                <div key={r.user.id} className={`flex items-center justify-between p-2.5 rounded-xl ${r.user.id === userRole?.id ? 'bg-violet-500/10' : isDark ? 'bg-white/[0.04]' : 'bg-slate-50'}`}>
                  <div className="flex items-center gap-3">
                    <span className={`w-6 text-center text-sm font-bold ${textMuted2}`}>
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                    </span>
                    <span className="text-sm font-medium">{r.user.first_name} {r.user.last_name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className={textMuted}>{eur(r.realise)}</span>
                    {r.pct !== null && (
                      <span className={`font-semibold ${r.pct >= 100 ? 'text-emerald-500' : r.pct >= 60 ? 'text-amber-500' : 'text-red-500'}`}>{r.pct}%</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tableau par commercial */}
          <div className={`rounded-[24px] border ${cardShell}`}>
            <div className="p-5 pb-0">
              <h2 className="text-lg font-bold">Détail par commercial</h2>
            </div>
            <div className="p-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={`text-left border-b ${isDark ? 'text-white/40 border-white/10' : 'text-slate-400 border-slate-100'}`}>
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
                    <tr key={r.user.id} className={`border-b last:border-0 ${isDark ? 'border-white/5' : 'border-slate-50'}`}>
                      <td className="py-3 pr-4 font-medium">
                        {r.user.first_name} {r.user.last_name}
                        <span className={`text-xs ml-1.5 ${textMuted2}`}>({r.dealsCount} dossier{r.dealsCount > 1 ? 's' : ''})</span>
                      </td>
                      <td className="py-3 pr-4 text-right text-amber-500">{eur(r.probable)}</td>
                      <td className="py-3 pr-4 text-right text-sky-500">{eur(r.confirme)}</td>
                      <td className="py-3 pr-4 text-right text-emerald-500 font-semibold">{eur(r.encaisse)}</td>
                      <td className="py-3 pr-4 text-right font-semibold">{eur(r.realise)}</td>
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
                            <span className={textMuted}>{r.objectifCa ? eur(r.objectifCa) : '-'}</span>
                            {isAdmin && (
                              <button onClick={() => startEdit(r.user.id, r.objectifId, r.objectifCa)} className={isDark ? 'text-white/30 hover:text-white' : 'text-slate-300 hover:text-slate-600'}>
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        {r.pct === null ? (
                          <span className={textMuted2}>-</span>
                        ) : (
                          <span className={`font-semibold ${r.pct >= 100 ? 'text-emerald-500' : r.pct >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
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
                            <span className={textMuted}>{r.taux ? `${r.taux}%` : '-'}</span>
                            {isAdmin && (
                              <button onClick={() => { setEditingTauxId(r.user.id); setEditTauxValue(r.taux ? String(r.taux) : ''); }} className={isDark ? 'text-white/30 hover:text-white' : 'text-slate-300 hover:text-slate-600'}>
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right font-semibold text-purple-500">{eur(r.commission)}</td>
                    </tr>
                  ))}
                  {visibleRows.length === 0 && (
                    <tr><td colSpan={9} className={`py-8 text-center ${textMuted2}`}>Aucune donnée pour ce mois.</td></tr>
                  )}
                </tbody>
              </table>
              <p className={`text-xs mt-3 ${textMuted2}`}>
                La commission est calculée sur les règlements reçus <strong>ce mois-ci</strong> (voir l'onglet "Suivi paiements clients"), indépendamment du mois de signature du dossier.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Décor de fond du hero : chaîne de montagnes en couches + chemin lumineux
// ascendant vers un sommet marqué d'un fanion — renforce "je monte vers le
// prochain sommet" sans overlay opaque au-dessus du texte.
function MountainScene({ dark }: { dark: boolean }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1200 400"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="mtnBack" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={dark ? '#4c1d95' : '#a5b4fc'} stopOpacity={dark ? 0.4 : 0.55} />
          <stop offset="100%" stopColor={dark ? '#1e1b4b' : '#e0e7ff'} stopOpacity="0" />
        </linearGradient>
        <linearGradient id="mtnFront" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={dark ? '#6d28d9' : '#818cf8'} stopOpacity={dark ? 0.5 : 0.45} />
          <stop offset="100%" stopColor={dark ? '#0b1220' : '#eef2ff'} stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pathGlow" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#f472b6" />
          <stop offset="100%" stopColor="#c4b5fd" />
        </linearGradient>
      </defs>
      <path d="M0,320 L120,205 L230,270 L340,155 L460,260 L600,125 L740,240 L880,165 L1020,250 L1200,185 L1200,400 L0,400 Z" fill="url(#mtnBack)" />
      <path d="M0,400 L0,300 L150,195 L300,280 L470,145 L650,260 L820,175 L980,270 L1200,195 L1200,400 Z" fill="url(#mtnFront)" />
      <path d="M880,400 L1000,150 L1080,260 L1150,190 L1200,255 L1200,400 Z" fill={dark ? '#7c3aed' : '#8b5cf6'} opacity={dark ? 0.4 : 0.3} />
      <path
        d="M50,375 C210,345 250,305 330,275 S460,195 555,235 S695,155 795,195 S945,125 995,152"
        fill="none"
        stroke="url(#pathGlow)"
        strokeWidth="3"
        strokeDasharray="2 11"
        strokeLinecap="round"
        opacity="0.9"
      />
      <g transform="translate(992,142)">
        <line x1="0" y1="0" x2="0" y2="-28" stroke={dark ? '#f5f3ff' : '#4c1d95'} strokeWidth="2.5" />
        <path d="M0,-28 L20,-21 L0,-14 Z" fill="#f472b6" />
        <circle cx="0" cy="-14" r="4" fill="#f472b6" opacity="0.6" />
      </g>
    </svg>
  );
}

// Badge de niveau façon rang de jeu vidéo premium (écusson dégradé + gros
// chiffre + étoiles), en overlay au-dessus de la montagne.
function RankBadge({ level, stars }: { level: number; stars: number }) {
  return (
    <div className="relative mx-auto flex h-[168px] w-[152px] shrink-0 items-center justify-center md:h-[190px] md:w-[172px]">
      <svg viewBox="0 0 200 220" className="absolute inset-0 h-full w-full drop-shadow-[0_0_32px_rgba(139,92,246,.55)]">
        <defs>
          <linearGradient id="rankGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ddd6fe" />
            <stop offset="50%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#4c1d95" />
          </linearGradient>
        </defs>
        <path
          d="M100 6 L188 42 L188 112 C188 166 150 202 100 214 C50 202 12 166 12 112 L12 42 Z"
          fill="url(#rankGrad)"
          stroke="#f5f3ff"
          strokeOpacity="0.55"
          strokeWidth="2.5"
        />
      </svg>
      <div className="relative flex flex-col items-center justify-center pt-1 text-center">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-100">Niveau actuel</span>
        <span className="text-6xl font-black leading-none text-white drop-shadow-[0_2px_8px_rgba(0,0,0,.4)] md:text-7xl">
          {String(level).padStart(2, '0')}
        </span>
        <div className="mt-2 flex items-center gap-1">
          {[0, 1, 2].map((s) => (
            <Trophy key={s} className={`h-4 w-4 ${s < stars ? 'text-amber-300' : 'text-white/25'}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  dark, icon, title, value, subtitle, growth, progress, sparkline, accent,
}: {
  dark: boolean;
  icon: ReactNode;
  title: string;
  value: string;
  subtitle: string;
  growth?: number | null;
  progress?: number;
  sparkline?: { day: number; cumul: number }[];
  accent: 'violet' | 'blue' | 'amber' | 'green';
}) {
  const styles = {
    violet: { icon: 'bg-violet-500/15 text-violet-500', bar: 'bg-violet-500', stroke: '#8b5cf6' },
    blue: { icon: 'bg-blue-500/15 text-blue-500', bar: 'bg-blue-500', stroke: '#3b82f6' },
    amber: { icon: 'bg-amber-400/15 text-amber-500', bar: 'bg-amber-400', stroke: '#f59e0b' },
    green: { icon: 'bg-emerald-500/15 text-emerald-500', bar: 'bg-emerald-500', stroke: '#22c55e' },
  }[accent];
  return (
    <div className={`rounded-[22px] border p-5 ${dark ? 'border-white/10 bg-[#091225] text-white' : 'border-slate-200 bg-white shadow-sm text-slate-800'}`}>
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
          <div className={`h-full rounded-full ${styles.bar}`} style={{ width: `${progress}%` }} />
        </div>
      )}
      {progress === undefined && sparkline && sparkline.length > 1 && (
        <MiniSparkline points={sparkline} stroke={styles.stroke} />
      )}
    </div>
  );
}

// Mini-courbe réelle (cumul jour par jour) affichée sous chaque KPI — dérivée
// des mêmes séries que le grand graphique, jamais une forme décorative fixe.
function MiniSparkline({ points, stroke }: { points: { day: number; cumul: number }[]; stroke: string }) {
  const max = Math.max(...points.map((p) => p.cumul), 1);
  const toX = (i: number) => (i / Math.max(points.length - 1, 1)) * 280;
  const toY = (val: number) => 50 - Math.min(val / max, 1) * 46;
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i)} ${toY(p.cumul)}`).join(' ');
  const areaPath = `${linePath} L${toX(points.length - 1)} 55 L0 55 Z`;
  const gradId = `spark-${stroke.replace('#', '')}`;
  return (
    <svg viewBox="0 0 280 55" className="mt-5 h-[55px] w-full overflow-visible" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SummaryRow({
  dark, label, value, total, percentage, color,
}: {
  dark: boolean;
  label: string;
  value: number;
  total: number;
  percentage: number | null;
  color: string;
}) {
  const width = percentage === null ? Math.min((value / total) * 100, 100) : percentage;
  return (
    <div className="grid grid-cols-[120px_1fr_90px_50px] items-center gap-3 text-sm">
      <div className={dark ? 'text-white/70' : 'text-slate-600'}>{label}</div>
      <div className={`h-3 overflow-hidden rounded-full ${dark ? 'bg-white/10' : 'bg-slate-100'}`}>
        <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
      </div>
      <div className="text-right font-medium">{eur(value)}</div>
      <div className={`text-right ${dark ? 'text-white/60' : 'text-slate-500'}`}>{percentage === null ? '—' : `${percentage}%`}</div>
    </div>
  );
}

// Courbe d'évolution réelle (cumul jour par jour du CA signé sur le mois
// sélectionné) + ligne pointillée de l'objectif — remplace le graphique de
// démonstration à données fixes.
function EvolutionChart({ points, max, objectif, dark, levels }: { points: { day: number; cumul: number }[]; max: number; objectif: number; dark: boolean; levels?: { level: number; amount: number }[] }) {
  const lastDay = points.length || 1;
  const toX = (day: number) => ((day - 1) / Math.max(lastDay - 1, 1)) * 900;
  const toY = (val: number) => 270 - Math.min(val / max, 1) * 270;
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.day)} ${toY(p.cumul)}`).join(' ');
  const areaPath = `${linePath} L${toX(points[points.length - 1]?.day || 1)} 270 L${toX(1)} 270 Z`;
  const objY = toY(objectif);
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(max * f));
  const xLabels = [1, 5, 10, 15, 20, 25, lastDay].filter((d, i, arr) => arr.indexOf(d) === i && d <= lastDay);
  // Marqueurs de niveaux : le jour où le cumul réel a franchi chaque palier
  // ce mois-ci (première fois où cumul >= palier) — dérivé de la courbe
  // réelle, pas d'une position décorative.
  const levelMarkers = (levels || [])
    .map((lvl) => {
      const hit = points.find((p) => p.cumul >= lvl.amount);
      return hit ? { level: lvl.level, day: hit.day, cumul: hit.cumul } : null;
    })
    .filter((m): m is { level: number; day: number; cumul: number } => m !== null);

  return (
    <div className="relative h-[330px]">
      <div className="absolute inset-0 flex flex-col justify-between">
        {ticks.map((value) => (
          <div key={value} className="flex items-center gap-4">
            <span className={`w-14 text-right text-[11px] ${dark ? 'text-white/35' : 'text-slate-400'}`}>{eur(value)}</span>
            <div className={`h-px flex-1 ${dark ? 'bg-white/[0.07]' : 'bg-slate-100'}`} />
          </div>
        ))}
      </div>
      <svg className="absolute bottom-4 left-[70px] right-0 h-[270px] w-[calc(100%-70px)]" viewBox="0 0 900 270" preserveAspectRatio="none">
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {points.length > 0 && <path d={areaPath} fill="url(#chartFill)" />}
        {points.length > 0 && <path d={linePath} fill="none" stroke="#8b5cf6" strokeWidth="4" strokeLinecap="round" />}
        {objectif > 0 && (
          <path d={`M0 ${objY} L900 ${objY}`} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="9 9" opacity="0.7" />
        )}
        {levelMarkers.map((m) => (
          <g key={m.level}>
            <circle cx={toX(m.day)} cy={toY(m.cumul)} r="9" fill={dark ? '#111827' : '#ffffff'} stroke="#8b5cf6" strokeWidth="3" />
            <text x={toX(m.day)} y={toY(m.cumul) - 16} fill={dark ? '#ddd6fe' : '#6d28d9'} fontSize="11" textAnchor="middle" fontWeight="700">
              NIV. {m.level}
            </text>
          </g>
        ))}
      </svg>
      <div className={`absolute bottom-0 left-[70px] right-0 flex justify-between text-[11px] ${dark ? 'text-white/35' : 'text-slate-400'}`}>
        {xLabels.map((d) => <span key={d}>{String(d).padStart(2, '0')}</span>)}
      </div>
    </div>
  );
}
