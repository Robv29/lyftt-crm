import { useMemo, useCallback } from 'react';
import { usePersistentState } from '../hooks/use-persistent-state';
import { useAuth } from '../contexts/AuthContext';
import {
  useProspects,
  useActions,
  useCityAttributions,
  useRegisteredUsers,
  useObjectifsCA,
  useInvalidateProspects,
  type Prospect,
  type CommercialAction,
} from '../hooks/use-prospects';
import { client } from '../lib/api';
import { toast } from 'sonner';
import ErrorState from '../components/ErrorState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link } from 'react-router-dom';
import { useSpeedRun } from '../contexts/SpeedRunContext';
import {
  Phone,
  PhoneCall,
  PhoneOff,
  Video,
  FileText,
  FileSignature,
  Zap,
  Clock,
  TrendingUp,
  TrendingDown,
  XCircle,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Percent,
  UserCircle,
  Download,
  AlertTriangle,
  CheckCircle2,
  Target,
  LayoutDashboard,
} from 'lucide-react';

type PeriodKey = 'today' | 'week' | 'month' | 'prev_month' | 'year';

const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Aujourd'hui",
  week: 'Cette semaine',
  month: 'Ce mois',
  prev_month: 'Mois précédent',
  year: 'Cette année',
};

function getDateRange(period: PeriodKey): { start: Date; end: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case 'today':
      return { start: today, end: new Date(today.getTime() + 86400000) };
    case 'week': {
      const d = today.getDay();
      const mon = new Date(today);
      mon.setDate(today.getDate() - ((d + 6) % 7));
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 7);
      return { start: mon, end: sun };
    }
    case 'month':
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
    case 'prev_month':
      return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 1) };
    case 'year':
      return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear() + 1, 0, 1) };
  }
}

function getPreviousDateRange(period: PeriodKey): { start: Date; end: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case 'today':
      return { start: new Date(today.getTime() - 86400000), end: today };
    case 'week': {
      const d = today.getDay();
      const mon = new Date(today);
      mon.setDate(today.getDate() - ((d + 6) % 7));
      const prev = new Date(mon);
      prev.setDate(mon.getDate() - 7);
      return { start: prev, end: mon };
    }
    case 'month':
      return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 1) };
    case 'prev_month':
      return { start: new Date(now.getFullYear(), now.getMonth() - 2, 1), end: new Date(now.getFullYear(), now.getMonth() - 1, 1) };
    case 'year':
      return { start: new Date(now.getFullYear() - 1, 0, 1), end: new Date(now.getFullYear(), 0, 1) };
  }
}

const eur = (n: number) =>
  n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

// Jours ouvrés (lun-ven) restants dans le mois, aujourd'hui inclus.
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

function computeConversionRate(actions: CommercialAction[], start: Date, end: Date) {
  const filtered = actions.filter((a) => {
    const d = new Date(a.action_date || a.created_at);
    return d >= start && d < end;
  });
  const totalAppels = filtered.filter((a) => a.action_type === 'appel' || a.action_type === 'relance').length;
  // Signatures DISTINCTES par prospect : un dossier qui repasse en "Signature"
  // apres un aller-retour dans le pipeline generait plusieurs lignes pour une
  // seule vraie signature.
  const signatures = new Set(
    filtered.filter((a) => a.action_type === 'status_change' && a.to_status === 'Signature').map((a) => a.prospect_id)
  ).size;
  if (totalAppels === 0) return 0;
  return (signatures / totalAppels) * 100;
}

export default function Dashboard() {
  const { user, isAdmin, userRole } = useAuth();
  const { data: allProspects = [], isLoading: loadingP, error: errorP, refetch: refetchP, isFetching: fetchingP } = useProspects();
  const { data: allActions = [], isLoading: loadingA, error: errorA, refetch: refetchA, isFetching: fetchingA } = useActions();
  const { data: cityAttributions = [] } = useCityAttributions();
  const { data: registeredUsers = [] } = useRegisteredUsers();
  const { data: objectifsCA = [] } = useObjectifsCA();
  const invalidateProspects = useInvalidateProspects();

  const hasError = errorP || errorA;
  const handleRetryAll = useCallback(() => {
    if (errorP) refetchP();
    if (errorA) refetchA();
  }, [errorP, errorA, refetchP, refetchA]);

  const [selectedPeriod, setSelectedPeriod] = usePersistentState<PeriodKey>('lyftt.dash.periode', 'today');
  const [selectedCommercial, setSelectedCommercial] = usePersistentState<string>('lyftt.dash.commercial', 'global');
  const [activeTab, setActiveTab] = usePersistentState<string>('lyftt.dash.tab', 'apercu');
  // Session Speed Run gérée au niveau global (App.tsx) pour survivre à un
  // changement de page — cette page ne fait plus que déclencher l'ouverture.
  const { open: openSpeedRun } = useSpeedRun();

  const loading = loadingP || loadingA;

  const handleExportExcel = useCallback(async () => {
    if (allProspects.length === 0) return;
    const XLSX = await import('xlsx');
    const headers: Record<string, string> = {
      nom_societe: 'Société', nom_dirigeant: 'Dirigeant', telephone: 'Téléphone',
      email: 'Email', zone_geographique: 'Zone géographique', categorie_metier: 'Catégorie métier',
      commercial_assigne: 'Commercial assigné', statut_avancement: "Statut d'avancement",
      statut_gagne_perdu: 'Statut gagné/perdu', nombre_appels: "Nombre d'appels",
      nombre_appels_repondus: 'Appels répondus', nombre_relances: 'Nombre de relances',
      montant_potentiel: 'Montant potentiel (€)', priorite: 'Priorité', source_lead: 'Source du lead',
      notes: 'Notes', date_prochaine_relance: 'Prochaine relance', date_dernier_appel: 'Dernier appel',
      created_at: 'Date de création', updated_at: 'Dernière mise à jour',
    };
    const keys = Object.keys(headers);
    const rows = allProspects.map((p) => {
      const row: Record<string, unknown> = {};
      for (const k of keys) row[headers[k]] = (p as unknown as Record<string, unknown>)[k] ?? '';
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.values(headers).map((h) => ({ wch: Math.max(h.length, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Prospects');
    XLSX.writeFile(wb, `export_prospects_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [allProspects]);

  const commercialNames = useMemo(() => {
    return registeredUsers
      .filter((u) => u.first_name || u.last_name)
      .map((u) => `${u.first_name || ''} ${u.last_name || ''}`.trim())
      .filter((n) => n.length > 0)
      .sort();
  }, [registeredUsers]);

  // Normalise pour comparer les noms sans souci de casse / espaces
  // (ex: "Yoan RUANS" importé == "Yoan Ruans" du compte).
  const normName = (s?: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

  // Utilisateur correspondant au commercial sélectionné dans le filtre —
  // nécessaire pour aller chercher SES données financières (signed_by_user_id,
  // objectifs_ca), qui sont rattachées à un id, pas à un nom texte.
  const matchedCommercialUser = useMemo(() => {
    if (selectedCommercial === 'global') return null;
    return registeredUsers.find(
      (u) => normName(`${u.first_name || ''} ${u.last_name || ''}`) === normName(selectedCommercial)
    ) || null;
  }, [selectedCommercial, registeredUsers]);

  // Mapping ville -> commercial pour TOUS les commerciaux (pas seulement celui
  // sélectionné) — sert à regrouper la relance datée par commercial en vue globale.
  const cityToCommercialAll = useMemo(() => {
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

  // Résout le commercial d'un prospect : d'abord un nom connu retrouvé dans
  // commercial_assigne (gère les valeurs combinées type "Utilisateur supprimé,
  // Yoan RUANS"), sinon la ville attribuée, sinon "Non attribué".
  const resolveCommercialFor = useCallback((p: Prospect): string => {
    const assignedNorm = normName(p.commercial_assigne);
    if (assignedNorm) {
      for (const name of commercialNames) {
        if (assignedNorm.includes(normName(name))) return name;
      }
    }
    const viaVille = cityToCommercialAll.get(p.zone_geographique);
    if (viaVille) return viaVille;
    return 'Non attribué';
  }, [commercialNames, cityToCommercialAll]);

  // Le filtre par commercial utilise EXACTEMENT la meme regle que les blocs de
  // la page (resolveCommercialFor). Avant, il testait l'egalite stricte du nom
  // puis retombait sur la ville — y compris pour des fiches explicitement
  // assignees a quelqu'un d'autre : 245 fiches (163 de Yoan, 82 de Robin)
  // remontaient ainsi dans les statistiques de Clement, et la somme des vues
  // individuelles depassait le nombre reel de fiches.
  const prospects = useMemo(() => {
    if (selectedCommercial === 'global') return allProspects;
    return allProspects.filter((p) => resolveCommercialFor(p) === selectedCommercial);
  }, [allProspects, selectedCommercial, resolveCommercialFor]);

  const filteredProspectIds = useMemo(() => new Set(prospects.map((p) => p.id)), [prospects]);

  const actions = useMemo(() => {
    if (selectedCommercial === 'global') return allActions;
    return allActions.filter((a) => filteredProspectIds.has(a.prospect_id));
  }, [allActions, selectedCommercial, filteredProspectIds]);

  const periodStats = useMemo(() => {
    const { start, end } = getDateRange(selectedPeriod);
    const fa = actions.filter((a) => { const d = new Date(a.action_date || a.created_at); return d >= start && d < end; });
    const totalAppels = fa.filter((a) => a.action_type === 'appel' || a.action_type === 'relance').length;
    const appelsRepondus = fa.filter((a) => (a.action_type === 'appel' || a.action_type === 'relance') && a.appel_repondu).length;
    const refus = fa.filter((a) => a.action_type === 'status_change' && a.to_status === 'Refus / Perdu').length;
    // Signatures DISTINCTES par prospect (meme raison que les visios ci-dessous).
    const signatures = new Set(
      fa.filter((a) => a.action_type === 'status_change' && a.to_status === 'Signature').map((a) => a.prospect_id)
    ).size;
    // Compte des visios DISTINCTES (par prospect), pas des actions "visio"
    // brutes : reprogrammer 2 fois le même rendez-vous (changement de date/
    // heure) crée 3 lignes commercial_actions pour un seul RDV réel — sans
    // dédoublonnage, le KPI comptait ce genre de cas comme 3 visios.
    const visiosSet = new Set(fa.filter((a) => a.action_type === 'visio').map((a) => a.prospect_id));
    const visios = visiosSet.size;
    // Lapins DISTINCTS. Detection tolerante : le libelle exact de la note auto
    // peut evoluer, on accepte donc toute note contenant "lapin" sur une action
    // de relance plutot qu'un prefixe figé qui casserait silencieusement.
    const lapinsSet = new Set(
      fa.filter((a) =>
        (a.action_type === 'relance_planifiee' || a.action_type === 'relance') &&
        (a.notes || '').toLowerCase().includes('lapin')
      ).map((a) => a.prospect_id)
    );
    const lapins = lapinsSet.size;
    const currentRate = computeConversionRate(actions, start, end);
    const { start: ps, end: pe } = getPreviousDateRange(selectedPeriod);
    const previousRate = computeConversionRate(actions, ps, pe);
    let trend: 'up' | 'down' | 'stable' = 'stable';
    if (currentRate > previousRate + 0.5) trend = 'up';
    else if (currentRate < previousRate - 0.5) trend = 'down';
    // Taux de transformation Visio -> Signature : sur la meme periode, combien
    // de visios distinctes se sont transformees en signature (independant du
    // taux appels -> signature deja affiche par "Transformation" ci-dessus).
    const visioSignatureRate = visios > 0 ? (signatures / visios) * 100 : 0;
    // Taux de lapin : part des RDV programmes ou le prospect ne s'est pas
    // presente. Denominateur = UNION des visios et des lapins : un lapin a
    // souvent aussi sa propre action "visio" dans la periode, l'addition
    // double-comptait donc ces dossiers et sous-estimait le taux.
    const rdvProgrammes = new Set([...visiosSet, ...lapinsSet]).size;
    const lapinRate = rdvProgrammes > 0 ? (lapins / rdvProgrammes) * 100 : 0;
    return { totalAppels, appelsRepondus, refus, signatures, visios, lapins, lapinRate, currentRate, previousRate, trend, visioSignatureRate };
  }, [actions, selectedPeriod]);

  // RÉSERVE À RAPPELER : le vivier de prospects à reprendre, pas une liste de
  // tâches du jour. Trois filtres corrigent les faux positifs de l'ancien bloc
  // "NRP" (qui ne testait que l'ancienneté du dernier appel) :
  //   - jamais décroché : quelqu'un qui a répondu n'est pas un NRP ;
  //   - aucun rappel déjà calé : sinon on propose de rappeler une personne
  //     qu'on a justement prévu de rappeler plus tard (elle est dans "À faire") ;
  //   - pas de RDV ni de dossier en cours : il n'y a rien à relancer.
  // Sur les données réelles, ça retire ~95 fiches sur 418.
  const NON_RELANCABLE = useMemo(
    () => new Set(['Visio', 'Demande de documents', 'Signature', 'Envoyé à Mathilde', 'Refus / Perdu']),
    []
  );
  const reserveARappelerAll = useMemo(() => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400000);
    return prospects
      .filter((p) => {
        if (p.statut_gagne_perdu !== 'actif') return false;
        if ((p.nombre_appels_repondus || 0) > 0) return false;
        if (p.date_relance_planifiee) return false;
        if (NON_RELANCABLE.has(p.statut_avancement)) return false;
        if (p.date_signature) return false;
        if (p.date_dernier_appel && !p.date_dernier_appel.startsWith('2026-01-01')) {
          return new Date(p.date_dernier_appel) <= fiveDaysAgo;
        }
        return (p.nombre_appels || 0) > 0;
      })
      .sort((a, b) => {
        const da = a.date_dernier_appel ? new Date(a.date_dernier_appel).getTime() : 0;
        const db = b.date_dernier_appel ? new Date(b.date_dernier_appel).getTime() : 0;
        return da - db;
      });
  }, [prospects, NON_RELANCABLE]);

  // Réserve éclatée par commercial : on n'affiche que des compteurs, pas des
  // listes — 300+ lignes ne se travaillent pas à l'œil mais au Speed Run.
  const reserveGrouped = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of reserveARappelerAll) {
      const name = resolveCommercialFor(p);
      map.set(name, (map.get(name) || 0) + 1);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Non attribué') return 1;
      if (b === 'Non attribué') return -1;
      return a.localeCompare(b, 'fr');
    });
  }, [reserveARappelerAll, resolveCommercialFor]);

  // ===== À FAIRE AUJOURD'HUI =====
  // UNE seule liste de tâches, qui remplace les trois anciens blocs
  // (confirmations visio / lapins / relance datée) : ils puisaient tous dans
  // le même vivier — une relance datée — et un même prospect pouvait donc
  // apparaître deux ou trois fois dans l'onglet.
  // Le motif n'est plus un bloc, c'est une pastille sur la ligne.
  // Sont exclus les rappels de confirmation dont le RDV est DÉJÀ passé : il
  // n'y a plus rien à confirmer, le dossier doit être qualifié dans "Mes
  // visios" (tenu / lapin / reporté).
  const aFaireAujourdhui = useMemo(() => {
    const now = new Date();
    const debutJour = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const finJour = new Date(debutJour.getTime() + 86400000);
    return allProspects
      .filter((p) => {
        if (p.statut_gagne_perdu !== 'actif') return false;
        if (!p.date_relance_planifiee) return false;
        if (new Date(p.date_relance_planifiee) >= finJour) return false;
        if (p.type_relance_planifiee === 'confirmation_visio' && p.date_visio && new Date(p.date_visio) < now) return false;
        return true;
      })
      .sort((a, b) => new Date(a.date_relance_planifiee).getTime() - new Date(b.date_relance_planifiee).getTime())
      .map((p) => ({
        p,
        overdue: new Date(p.date_relance_planifiee) < debutJour,
        motif: (p.type_relance_planifiee === 'confirmation_visio'
          ? 'confirmation'
          : p.type_relance_planifiee === 'lapin'
            ? 'lapin'
            : 'relance') as 'confirmation' | 'lapin' | 'relance',
      }));
  }, [allProspects]);

  // Groupé par commercial. "Non attribué" reste toujours visible, même quand
  // un commercial précis est sélectionné : sinon ces fiches ne sont dans la
  // liste de personne.
  const aFaireGrouped = useMemo(() => {
    const map = new Map<string, typeof aFaireAujourdhui>();
    for (const item of aFaireAujourdhui) {
      const name = resolveCommercialFor(item.p);
      const arr = map.get(name) || [];
      arr.push(item);
      map.set(name, arr);
    }
    let entries = Array.from(map.entries());
    if (selectedCommercial !== 'global') {
      entries = entries.filter(([name]) => name === selectedCommercial || name === 'Non attribué');
    }
    return entries.sort(([a], [b]) => {
      if (a === 'Non attribué') return 1;
      if (b === 'Non attribué') return -1;
      return a.localeCompare(b, 'fr');
    });
  }, [aFaireAujourdhui, resolveCommercialFor, selectedCommercial]);
  const aFaireTotal = useMemo(() => aFaireGrouped.reduce((s, [, arr]) => s + arr.length, 0), [aFaireGrouped]);
  const aFaireEnRetard = useMemo(
    () => aFaireGrouped.reduce((s, [, arr]) => s + arr.filter((i) => i.overdue).length, 0),
    [aFaireGrouped]
  );

  // Visios à venir : simple ligne de visibilité. Le détail vit dans "Mes
  // visios" — inutile de dupliquer la liste ici, le rappel de confirmation
  // arrive tout seul dans "À faire aujourd'hui" deux jours avant le RDV.
  const visiosAVenir = useMemo(() => {
    const now = new Date();
    const dans7j = new Date(now.getTime() + 7 * 86400000);
    const list = prospects
      .filter((p) => p.statut_gagne_perdu === 'actif' && !!p.date_visio && new Date(p.date_visio) >= now && new Date(p.date_visio) <= dans7j)
      .sort((a, b) => new Date(a.date_visio!).getTime() - new Date(b.date_visio!).getTime());
    return { count: list.length, next: list[0] || null };
  }, [prospects]);

  // Demandes de documents en attente, groupées par commercial : tous les
  // dossiers encore au statut "Demande de documents" (pas encore signés),
  // avec la date du dernier appel à ce sujet à côté pour voir d'un coup
  // d'œil qui n'a pas été relancé depuis longtemps. Tri du plus urgent
  // (appel le plus ancien, ou jamais appelé) au plus récent.
  // Toujours calculé sur allProspects (non filtré par le sélecteur de
  // commercial) : les fiches "Non attribué" doivent rester visibles même
  // quand un commercial précis est sélectionné, sinon elles disparaissent
  // du radar de tout le monde.
  const demandesDocsGrouped = useMemo(() => {
    // Pas de filtre sur statut_gagne_perdu : un dossier "Demande de documents"
    // peut être marqué "gagné" (client déjà signé, en attente de pièces) —
    // il doit quand même apparaître ici tant que les docs ne sont pas reçus.
    const enAttente = allProspects.filter((p) => p.statut_avancement === 'Demande de documents');
    const map = new Map<string, Prospect[]>();
    for (const p of enAttente) {
      const name = resolveCommercialFor(p);
      const arr = map.get(name) || [];
      arr.push(p);
      map.set(name, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const da = a.date_dernier_appel ? new Date(a.date_dernier_appel).getTime() : 0;
        const db = b.date_dernier_appel ? new Date(b.date_dernier_appel).getTime() : 0;
        return da - db;
      });
    }
    let entries = Array.from(map.entries());
    // Quand un commercial précis est sélectionné, on ne garde que son
    // groupe + "Non attribué" (toujours visible, peu importe le filtre).
    if (selectedCommercial !== 'global') {
      entries = entries.filter(([name]) => name === selectedCommercial || name === 'Non attribué');
    }
    return entries.sort(([a], [b]) => {
      if (a === 'Non attribué') return 1;
      if (b === 'Non attribué') return -1;
      return a.localeCompare(b, 'fr');
    });
  }, [allProspects, resolveCommercialFor, selectedCommercial]);
  const demandesDocsTotal = useMemo(() => demandesDocsGrouped.reduce((s, [, arr]) => s + arr.length, 0), [demandesDocsGrouped]);

  // Total pour le badge de l'onglet Relances : confirmations visio + NRP + relance datée du jour.
  // Badge de l'onglet = uniquement ce qui est réellement à faire aujourd'hui.
  // La réserve n'y entre pas : c'est un stock, pas une tâche du jour.
  const relancesTabCount = aFaireTotal;

  // Conseil du jour : nombre d'appels/jour recommandé pour rattraper l'objectif
  // CA du mois, basé sur le taux de transformation ANNUEL réel du commercial
  // sélectionné (signatures/appels sur les 12 derniers mois) et son panier
  // moyen. Uniquement calculable pour un commercial précis (pas en vue globale).
  const conseilAppels = useMemo(() => {
    if (!matchedCommercialUser) return null;
    const uid = matchedCommercialUser.id;
    const now = new Date();
    const moisCourant = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const yearAgo = new Date(now);
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);

    const dealsCeMois = allProspects.filter(
      (p) => p.signed_by_user_id === uid && p.date_signature && p.date_signature.slice(0, 7) === moisCourant
    );
    const realise = dealsCeMois.reduce((s, p) => s + (Number(p.montant_potentiel) || 0), 0);

    const objectifRow = objectifsCA.find((o) => o.user_role_id === uid && o.mois.slice(0, 7) === moisCourant);
    const objectifCa = objectifRow?.objectif_ca ?? 0;
    if (objectifCa <= 0) return { state: 'no_objectif' as const };

    const ecart = objectifCa - realise;
    if (ecart <= 0) return { state: 'atteint' as const };

    const dealsAnnee = allProspects.filter(
      (p) => p.signed_by_user_id === uid && p.date_signature && new Date(p.date_signature) >= yearAgo && (Number(p.montant_potentiel) || 0) > 0
    );
    const valeurMoyenne = dealsAnnee.length > 0
      ? dealsAnnee.reduce((s, p) => s + (Number(p.montant_potentiel) || 0), 0) / dealsAnnee.length
      : 0;

    const tauxAnnuelPct = computeConversionRate(actions, yearAgo, now);
    if (valeurMoyenne <= 0 || tauxAnnuelPct <= 0) return { state: 'pas_assez_historique' as const };

    const signaturesNecessaires = ecart / valeurMoyenne;
    const appelsNecessaires = signaturesNecessaires / (tauxAnnuelPct / 100);
    const jo = joursOuvresRestants();
    if (jo <= 0) return { state: 'fin_de_mois' as const };

    const appelsParJour = Math.ceil(appelsNecessaires / jo);
    return { state: 'ok' as const, appelsParJour, ecart, tauxAnnuelPct, valeurMoyenne, jo };
  }, [matchedCommercialUser, allProspects, objectifsCA, actions]);

  const activeProspects = useMemo(() => prospects.filter((p) => p.statut_gagne_perdu === 'actif').length, [prospects]);
  // "Deals gagnes" = meme definition que Performance CA : une vente signee et
  // non perdue. On ne s'appuie plus sur statut_gagne_perdu, qui restait a
  // "gagne" a vie meme quand un dossier redescendait dans le pipeline (d'ou
  // 115 deals affiches ici contre 63 dans Performance CA).
  const wonDeals = useMemo(
    () => prospects.filter((p) => !!p.date_signature && p.statut_avancement !== 'Refus / Perdu').length,
    [prospects]
  );

  // Fiches créées automatiquement depuis le Monday "Transmission Clients"
  // (dossiers sans fiche CRM préexistante) — à compléter/vérifier par le
  // commercial concerné. Un commercial ne voit que les siennes ; l'admin voit
  // tout, y compris celles sans commercial identifiable (owners Monday =
  // Robin/Théo uniquement, donc non attribuables).
  const aVerifierList = useMemo(() => {
    return allProspects
      .filter((p) => p.a_verifier)
      .filter((p) => isAdmin || p.signed_by_user_id === userRole?.id)
      .sort((a, b) => (b.montant_potentiel || 0) - (a.montant_potentiel || 0));
  }, [allProspects, isAdmin, userRole]);

  const commercialNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const u of registeredUsers) map.set(u.id, `${u.first_name || ''} ${u.last_name || ''}`.trim());
    return map;
  }, [registeredUsers]);

  // Liste des commerciaux assignables sur les fiches importées — seul l'admin
  // peut réattribuer (ça touche l'attribution CA/commission dans Performance CA).
  const assignableCommerciaux = useMemo(
    () => registeredUsers.filter((u) => u.is_active && (u.role === 'commercial' || u.role === 'admin')),
    [registeredUsers]
  );

  const markVerified = useCallback(async (id: number) => {
    try {
      await client.entities.prospects.update({ id: String(id), data: { a_verifier: false } });
      invalidateProspects();
      toast.success('Fiche marquée comme vérifiée');
    } catch {
      toast.error('Erreur lors de la mise à jour');
    }
  }, [invalidateProspects]);

  const assignCommercial = useCallback(async (id: number, value: string) => {
    const userRoleId = value === 'none' ? null : Number(value);
    try {
      await client.entities.prospects.update({ id: String(id), data: { signed_by_user_id: userRoleId } });
      invalidateProspects();
      toast.success(userRoleId ? 'Commercial attribué' : 'Attribution retirée');
    } catch {
      toast.error("Erreur lors de l'attribution");
    }
  }, [invalidateProspects]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-[#6AABB4] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Chargement du tableau de bord...</p>
        </div>
      </div>
    );
  }

  if (hasError) {
    return (
      <ErrorState
        message="Impossible de charger le tableau de bord."
        onRetry={handleRetryAll}
        retrying={fetchingP || fetchingA}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Tableau de bord</h1>
          <p className="text-slate-500 mt-1">
            {selectedCommercial === 'global'
              ? `Bienvenue, ${user?.name || 'Commercial'}. Vue globale de l'activité.`
              : `Statistiques de ${selectedCommercial}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <button
            onClick={openSpeedRun}
            className="group relative flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 font-bold text-white bg-gradient-to-r from-amber-400 via-orange-500 to-pink-500 shadow-[0_0_25px_rgba(251,146,60,0.45)] hover:shadow-[0_0_35px_rgba(251,146,60,0.7)] hover:scale-[1.03] active:scale-95 transition-all"
          >
            <span className="absolute inset-0 rounded-xl bg-white/20 opacity-0 group-hover:opacity-100 animate-pulse" />
            <Zap className="w-4 h-4 relative shrink-0" fill="white" />
            <span className="relative tracking-wide">Speed Run</span>
          </button>
          <Button
            onClick={handleExportExcel}
            disabled={allProspects.length === 0}
            className="flex-1 sm:flex-none rounded-xl bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] hover:from-[#4A8B93] hover:to-[#5A9BA4] text-white shadow-md shadow-[#6AABB4]/20"
          >
            <Download className="w-4 h-4 mr-2 shrink-0" /> Exporter Excel
          </Button>
          {commercialNames.length > 0 && (
            <Select value={selectedCommercial} onValueChange={setSelectedCommercial}>
              <SelectTrigger className="w-full sm:w-56 rounded-xl border-slate-200 bg-white shadow-sm">
                <UserCircle className="w-4 h-4 mr-2 text-[#6AABB4] shrink-0" />
                <SelectValue placeholder="Sélectionner un commercial" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">🌐 Global (tous)</SelectItem>
                {commercialNames.map((name) => (
                  <SelectItem key={name} value={name}>👤 {name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Alerte : fiches importées depuis le Monday Transmission Clients à
          compléter/vérifier (créées sans être passées par le pipeline CRM). */}
      {aVerifierList.length > 0 && (
        <Card className="border-0 shadow-sm rounded-2xl bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-amber-800">
              <AlertTriangle className="w-5 h-5" />
              {aVerifierList.length} dossier{aVerifierList.length > 1 ? 's' : ''} importé{aVerifierList.length > 1 ? 's' : ''} depuis Monday à vérifier
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {aVerifierList.slice(0, 10).map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 bg-white rounded-xl px-3 py-2 flex-wrap">
                <Link to={`/prospects/${p.id}`} className="flex-1 min-w-[140px]">
                  <p className="font-medium text-slate-800 truncate">{p.nom_societe || '(sans nom)'}</p>
                  <p className="text-xs text-slate-400">
                    {p.montant_potentiel ? `${Number(p.montant_potentiel).toLocaleString('fr-FR')} €` : 'CA non renseigné'}
                    {!isAdmin && p.signed_by_user_id && ` · ${commercialNameById.get(p.signed_by_user_id) || ''}`}
                  </p>
                </Link>
                {isAdmin && (
                  <Select value={p.signed_by_user_id ? String(p.signed_by_user_id) : 'none'} onValueChange={(v) => assignCommercial(p.id, v)}>
                    <SelectTrigger className="h-8 w-40 rounded-lg text-xs shrink-0">
                      <SelectValue placeholder="Non attribué" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Non attribué</SelectItem>
                      {assignableCommerciaux.map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>{u.first_name} {u.last_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => markVerified(p.id)}
                  className="h-8 rounded-lg text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 gap-1.5 shrink-0"
                >
                  <CheckCircle2 className="w-4 h-4" /> Vérifié
                </Button>
              </div>
            ))}
            {aVerifierList.length > 10 && (
              <p className="text-xs text-amber-700 pt-1">+ {aVerifierList.length - 10} autre{aVerifierList.length - 10 > 1 ? 's' : ''}, ouvre la fiche prospect concernée pour les voir.</p>
            )}
          </CardContent>
        </Card>
      )}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="rounded-xl bg-slate-100 p-1 h-auto flex-wrap">
          <TabsTrigger value="apercu" className="rounded-lg gap-1.5 data-[state=active]:shadow-sm">
            <LayoutDashboard className="w-4 h-4" /> Aperçu
          </TabsTrigger>
          <TabsTrigger value="relances" className="rounded-lg gap-1.5 data-[state=active]:shadow-sm">
            <PhoneCall className="w-4 h-4" /> Relances
            {relancesTabCount > 0 && (
              <Badge className="bg-red-50 text-red-600 border-red-200 rounded-md text-[10px] font-bold px-1.5 py-0 ml-0.5">{relancesTabCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="documents" className="rounded-lg gap-1.5 data-[state=active]:shadow-sm">
            <FileText className="w-4 h-4" /> Documents
            {demandesDocsTotal > 0 && (
              <Badge className="bg-amber-50 text-amber-600 border-amber-200 rounded-md text-[10px] font-bold px-1.5 py-0 ml-0.5">{demandesDocsTotal}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="apercu" className="space-y-6 mt-4">
      {/* Conseil du jour : appels/jour recommandés pour rattraper l'objectif,
          basé sur le taux de transformation annuel réel du commercial. */}
      {selectedCommercial !== 'global' && conseilAppels && (
        <Card className="border-0 shadow-sm rounded-2xl bg-gradient-to-br from-orange-50 to-amber-50">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
                <PhoneCall className="w-5 h-5 text-orange-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800">Conseil du jour</p>
                {conseilAppels.state === 'no_objectif' && (
                  <p className="text-sm text-slate-500 mt-0.5">
                    Aucun objectif CA défini ce mois-ci pour {selectedCommercial} — à définir dans Performance CA pour obtenir une recommandation.
                  </p>
                )}
                {conseilAppels.state === 'atteint' && (
                  <p className="text-sm text-emerald-600 font-medium mt-0.5">🎉 Objectif du mois déjà atteint, continue comme ça !</p>
                )}
                {conseilAppels.state === 'pas_assez_historique' && (
                  <p className="text-sm text-slate-500 mt-0.5">
                    Pas assez d'historique (signatures / appels sur 12 mois) pour calculer une recommandation fiable.
                  </p>
                )}
                {conseilAppels.state === 'fin_de_mois' && (
                  <p className="text-sm text-red-500 mt-0.5">Plus de jour ouvré restant ce mois-ci pour rattraper l'objectif.</p>
                )}
                {conseilAppels.state === 'ok' && (
                  <p className="text-sm text-slate-700 mt-0.5">
                    Il manque <strong>{eur(conseilAppels.ecart)}</strong> pour atteindre l'objectif — fais environ{' '}
                    <strong className="text-orange-600">{conseilAppels.appelsParJour} appel{conseilAppels.appelsParJour > 1 ? 's' : ''}/jour</strong>{' '}
                    sur les {conseilAppels.jo} jours ouvrés restants (taux de transformation annuel : {conseilAppels.tauxAnnuelPct.toFixed(1)}%, panier moyen {eur(conseilAppels.valeurMoyenne)}).
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* General KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-0 shadow-sm rounded-2xl">
          <CardContent className="p-5 sm:p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-50">
                <TrendingUp className="w-6 h-6 text-[#5A9BA3]" />
              </div>
              <div className="flex min-h-12 min-w-0 flex-col justify-center">
                <p className="text-2xl font-bold leading-none text-slate-900">{activeProspects}</p>
                <p className="mt-1.5 truncate text-sm leading-5 text-slate-500">Prospects actifs</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm rounded-2xl">
          <CardContent className="p-5 sm:p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50">
                <FileSignature className="w-6 h-6 text-emerald-600" />
              </div>
              <div className="flex min-h-12 min-w-0 flex-col justify-center">
                <p className="text-2xl font-bold leading-none text-emerald-600">{wonDeals}</p>
                <p className="mt-1.5 truncate text-sm leading-5 text-slate-500">Deals gagnés</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Period Stats */}
      <Card className="border-0 shadow-sm rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold text-slate-900">Statistiques par période</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-6">
            {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((key) => (
              <Button
                key={key}
                variant={selectedPeriod === key ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedPeriod(key)}
                className={`rounded-xl ${
                  selectedPeriod === key
                    ? 'bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] hover:from-[#4A8B93] hover:to-[#5A9BA4] text-white shadow-md shadow-[#6AABB4]/20'
                    : 'hover:bg-slate-100'
                }`}
              >
                {PERIOD_LABELS[key]}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-8 gap-3">
            <StatBox icon={Phone} value={periodStats.totalAppels} label="Appels" gradient="from-teal-50 to-teal-100/50" iconBg="bg-teal-100" iconColor="text-[#5A9BA3]" />
            <StatBox icon={PhoneCall} value={periodStats.appelsRepondus} label="Répondus" gradient="from-emerald-50 to-emerald-100/50" iconBg="bg-emerald-100" iconColor="text-emerald-600" valueColor="text-emerald-600" />
            <StatBox icon={XCircle} value={periodStats.refus} label="Refus" gradient="from-red-50 to-red-100/50" iconBg="bg-red-100" iconColor="text-red-600" valueColor="text-red-600" />
            <StatBox icon={FileSignature} value={periodStats.signatures} label="Signatures" gradient="from-emerald-50 to-emerald-100/50" iconBg="bg-emerald-100" iconColor="text-emerald-600" valueColor="text-emerald-600" />
            <StatBox icon={Video} value={periodStats.visios} label="Visios" gradient="from-purple-50 to-purple-100/50" iconBg="bg-purple-100" iconColor="text-purple-600" valueColor="text-purple-600" />
            <StatBox
              icon={Target}
              value={`${periodStats.visioSignatureRate.toFixed(0)}%`}
              label="Visio → Signature"
              gradient="from-indigo-50 to-indigo-100/50"
              iconBg="bg-indigo-100"
              iconColor="text-indigo-600"
              valueColor="text-indigo-600"
            />
            <StatBox
              icon={AlertTriangle}
              value={`${periodStats.lapinRate.toFixed(0)}%`}
              label={`Taux de lapin${periodStats.lapins > 0 ? ` (${periodStats.lapins})` : ''}`}
              gradient="from-amber-50 to-amber-100/50"
              iconBg="bg-amber-100"
              iconColor="text-amber-600"
              valueColor="text-amber-600"
            />

            {/* Conversion rate */}
            <div className={`rounded-2xl p-4 text-center ${
              periodStats.trend === 'up' ? 'bg-gradient-to-br from-emerald-50 to-emerald-100/50 ring-1 ring-emerald-200/50'
                : periodStats.trend === 'down' ? 'bg-gradient-to-br from-red-50 to-red-100/50 ring-1 ring-red-200/50'
                : 'bg-gradient-to-br from-amber-50 to-amber-100/50 ring-1 ring-amber-200/50'
            }`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 ${
                periodStats.trend === 'up' ? 'bg-emerald-100' : periodStats.trend === 'down' ? 'bg-red-100' : 'bg-amber-100'
              }`}>
                {periodStats.trend === 'up' ? <TrendingUp className="w-5 h-5 text-emerald-600" />
                  : periodStats.trend === 'down' ? <TrendingDown className="w-5 h-5 text-red-500" />
                  : <Percent className="w-5 h-5 text-amber-600" />}
              </div>
              <p className={`text-2xl font-bold ${
                periodStats.trend === 'up' ? 'text-emerald-600' : periodStats.trend === 'down' ? 'text-red-500' : 'text-amber-600'
              }`}>
                {periodStats.currentRate.toFixed(1)}%
              </p>
              <p className="text-xs text-slate-500 mt-1 font-medium">Transformation</p>
              <div className="flex items-center justify-center gap-1 mt-1">
                {periodStats.trend === 'up' ? <ArrowUpRight className="w-3 h-3 text-emerald-500" />
                  : periodStats.trend === 'down' ? <ArrowDownRight className="w-3 h-3 text-red-400" />
                  : <Minus className="w-3 h-3 text-amber-500" />}
                <span className={`text-[10px] font-semibold ${
                  periodStats.trend === 'up' ? 'text-emerald-500' : periodStats.trend === 'down' ? 'text-red-400' : 'text-amber-500'
                }`}>
                  {periodStats.trend === 'stable' ? 'Stable' : `${periodStats.currentRate - periodStats.previousRate > 0 ? '+' : ''}${(periodStats.currentRate - periodStats.previousRate).toFixed(1)}%`}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="relances" className="space-y-6 mt-4">
      {/* Ligne de visibilité sur les RDV visio à venir — pas une liste : le
          rappel de confirmation arrive tout seul dans "À faire" 2 jours avant. */}
      {visiosAVenir.count > 0 && (
        <Link
          to="/visios"
          className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl border border-purple-200 bg-purple-50/60 hover:bg-purple-50 transition-colors group"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-purple-700">
            <Video className="w-4 h-4 shrink-0" />
            {visiosAVenir.count} RDV visio dans les 7 jours
          </span>
          {visiosAVenir.next && (
            <span className="text-xs text-purple-600 truncate">
              prochain : {visiosAVenir.next.nom_societe} — {new Date(visiosAVenir.next.date_visio!).toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <ArrowRight className="w-4 h-4 text-purple-400 group-hover:translate-x-1 transition-transform shrink-0" />
        </Link>
      )}

      {/* À FAIRE AUJOURD'HUI — liste unique, motif en pastille */}
      <Card className="border-0 shadow-sm rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Clock className="w-5 h-5 text-[#5A9BA3]" /> À faire aujourd'hui
            {aFaireTotal > 0 && (
              <Badge className="bg-[#5A9BA3]/10 text-[#4A8B93] border-[#5A9BA3]/20 rounded-lg text-xs font-bold">{aFaireTotal}</Badge>
            )}
            {aFaireEnRetard > 0 && (
              <Badge className="bg-red-50 text-red-600 border-red-200 rounded-lg text-xs font-bold">{aFaireEnRetard} en retard</Badge>
            )}
          </CardTitle>
          <p className="text-xs text-slate-400 mt-1">Relances dues et en retard, tous motifs confondus</p>
        </CardHeader>
        <CardContent>
          {aFaireTotal === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-3"><CheckCircle2 className="w-5 h-5 text-emerald-500" /></div>
              <p className="text-sm text-slate-400">Rien à relancer aujourd'hui</p>
            </div>
          ) : (
            <div className="space-y-4 max-h-[460px] overflow-y-auto pr-1">
              {aFaireGrouped.map(([commercialName, items]) => (
                <div key={commercialName}>
                  <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
                    <UserCircle className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{commercialName}</span>
                    <Badge className="bg-slate-100 text-slate-500 border-0 rounded-lg text-[10px] font-bold">{items.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {items.map(({ p, overdue, motif }) => <TacheRow key={p.id} prospect={p} overdue={overdue} motif={motif} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* RÉSERVE À RAPPELER — compteurs uniquement, on travaille au Speed Run */}
      {reserveARappelerAll.length > 0 && (
        <Card className="border-0 shadow-sm rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              <PhoneOff className="w-4 h-4 text-slate-400" /> Réserve à rappeler
              <Badge className="bg-slate-100 text-slate-600 border-slate-200 rounded-md text-[10px] font-bold px-1.5 py-0">{reserveARappelerAll.length}</Badge>
            </CardTitle>
            <p className="text-xs text-slate-400 mt-1">Jamais décroché, aucun rappel calé, aucun RDV en cours</p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap items-center gap-2">
              {reserveGrouped.map(([name, n]) => (
                <span key={name} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-xs font-medium text-slate-600">{name}</span>
                  <span className="text-xs font-bold text-slate-900">{n}</span>
                </span>
              ))}
            </div>
            <button
              onClick={openSpeedRun}
              className="mt-3 inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-bold text-white bg-gradient-to-r from-amber-400 via-orange-500 to-pink-500 shadow-sm hover:shadow-md active:scale-95 transition-all"
            >
              <Zap className="w-4 h-4 shrink-0" fill="white" /> Travailler la réserve en Speed Run
            </button>
          </CardContent>
        </Card>
      )}
        </TabsContent>

        <TabsContent value="documents" className="space-y-6 mt-4">
      {/* Demandes de documents en attente, par commercial */}
      {demandesDocsGrouped.length > 0 && (
        <Card className="border-0 shadow-sm rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-amber-500" /> Demandes de documents en attente
              <Badge className="bg-amber-50 text-amber-600 border-amber-200 rounded-md text-[10px] font-bold px-1.5 py-0">{demandesDocsTotal}</Badge>
            </CardTitle>
            <p className="text-xs text-slate-400 mt-1">Par commercial, avec la date du dernier appel à ce sujet</p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 max-h-[420px] overflow-y-auto pr-1">
              {demandesDocsGrouped.map(([commercialName, items]) => (
                <div key={commercialName}>
                  <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
                    <UserCircle className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{commercialName}</span>
                    <Badge className="bg-slate-100 text-slate-500 border-0 rounded-lg text-[10px] font-bold">{items.length}</Badge>
                  </div>
                  <div className="space-y-1.5">
                    {items.map((p) => <DocRequestRow key={p.id} prospect={p} />)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
        </TabsContent>
      </Tabs>

      <div className="pt-1">
        <Link to="/prospects" className="text-sm text-[#5A9BA3] hover:text-[#4A8B93] font-semibold flex items-center gap-1 group">
          Voir tous les prospects <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </Link>
      </div>
    </div>
  );
}

// Extracted components to prevent re-renders
function StatBox({ icon: Icon, value, label, gradient, iconBg, iconColor, valueColor }: {
  icon: React.ElementType; value: number | string; label: string; gradient: string; iconBg: string; iconColor: string; valueColor?: string;
}) {
  return (
    <div className={`bg-gradient-to-br ${gradient} rounded-2xl p-4 text-center`}>
      <div className={`w-10 h-10 ${iconBg} rounded-xl flex items-center justify-center mx-auto mb-2`}>
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
      <p className={`text-2xl font-bold ${valueColor || 'text-slate-900'}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-1 font-medium">{label}</p>
    </div>
  );
}

function TacheRow({ prospect: p, overdue = false, motif }: {
  prospect: Prospect; overdue?: boolean; motif: 'confirmation' | 'lapin' | 'relance';
}) {
  const dt = p.date_relance_planifiee ? new Date(p.date_relance_planifiee) : null;
  const heure = dt ? dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
  const jour = dt ? dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '';
  // Le retard prime sur le motif : une tâche en retard doit sauter aux yeux
  // quelle qu'en soit la raison. Le motif reste lisible en bout de ligne.
  const rowClass = overdue
    ? 'border-red-200 bg-red-50/70 hover:bg-red-50'
    : motif === 'lapin'
      ? 'border-amber-200 bg-amber-50/70 hover:bg-amber-50'
      : motif === 'confirmation'
        ? 'border-purple-200 bg-purple-50/70 hover:bg-purple-50'
        : 'border-slate-100 hover:border-[#6AABB4]/40 hover:bg-teal-50/40';
  const badgeClass = overdue
    ? 'bg-red-500 text-white'
    : motif === 'lapin'
      ? 'bg-amber-500 text-white'
      : motif === 'confirmation'
        ? 'bg-purple-500 text-white'
        : 'bg-[#5A9BA3]/10 text-[#5A9BA3]';
  const motifLabel = motif === 'lapin' ? 'Lapin' : motif === 'confirmation' ? 'Confirmer RDV' : 'Relance';
  const motifColor = motif === 'lapin' ? 'text-amber-600' : motif === 'confirmation' ? 'text-purple-600' : 'text-slate-400';
  return (
    <Link
      to={`/prospects/${p.id}`}
      className={`flex items-center gap-3 p-3 rounded-xl border transition-colors group ${rowClass}`}
    >
      <div className="w-16 shrink-0 text-center">
        <span className={`inline-block px-2 py-1 rounded-lg text-sm font-bold tabular-nums ${badgeClass}`}>{heure}</span>
        {overdue && <p className="text-[10px] font-bold text-red-600 mt-0.5">{jour} en retard</p>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900 truncate group-hover:text-[#5A9BA3] transition-colors">{p.nom_societe}</p>
        <p className="text-xs text-slate-500 mt-0.5 truncate">{p.nom_dirigeant || p.telephone || p.zone_geographique}</p>
      </div>
      <span className={`text-[10px] font-bold shrink-0 ${motifColor}`}>{motifLabel}</span>
    </Link>
  );
}

function DocRequestRow({ prospect: p }: { prospect: Prospect }) {
  const lastCallDate = p.date_dernier_appel ? new Date(p.date_dernier_appel) : null;
  const daysAgo = lastCallDate ? Math.floor((Date.now() - lastCallDate.getTime()) / 86400000) : null;
  const stale = daysAgo === null || daysAgo >= 5;
  return (
    <Link
      to={`/prospects/${p.id}`}
      className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border transition-colors group ${stale ? 'border-amber-200 bg-amber-50/60 hover:bg-amber-50' : 'border-slate-100 hover:border-[#6AABB4]/40 hover:bg-slate-50'}`}
    >
      <span className="text-xs font-medium text-slate-800 truncate group-hover:text-amber-700 transition-colors">{p.nom_societe}</span>
      <span className={`text-[10px] font-semibold shrink-0 ${stale ? 'text-amber-700' : 'text-slate-400'}`}>
        {daysAgo === null ? 'Jamais appelé' : daysAgo === 0 ? "Appelé aujourd'hui" : `Appelé il y a ${daysAgo}j`}
      </span>
    </Link>
  );
}
