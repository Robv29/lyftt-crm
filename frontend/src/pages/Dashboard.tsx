import { useState, useMemo, useCallback } from 'react';
import { usePersistentState } from '../hooks/use-persistent-state';
import { useAuth } from '../contexts/AuthContext';
import {
  useProspects,
  useActions,
  useCityAttributions,
  useRegisteredUsers,
  type Prospect,
  type CommercialAction,
} from '../hooks/use-prospects';
import ErrorState from '../components/ErrorState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import SpeedRun from '../components/SpeedRun';
import {
  Phone,
  PhoneCall,
  PhoneOff,
  Video,
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
} from 'lucide-react';

type PeriodKey = 'today' | 'week' | 'month' | 'prev_month' | 'year';

const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Aujourd'hui",
  week: 'Cette semaine',
  month: 'Ce mois',
  prev_month: 'Mois précédent',
  year: 'Cette année',
};

const priorityColors: Record<string, string> = {
  haute: 'bg-red-100 text-red-700 border-red-200',
  moyenne: 'bg-amber-100 text-amber-700 border-amber-200',
  basse: 'bg-slate-100 text-slate-600 border-slate-200',
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

function computeConversionRate(actions: CommercialAction[], start: Date, end: Date) {
  const filtered = actions.filter((a) => {
    const d = new Date(a.action_date || a.created_at);
    return d >= start && d < end;
  });
  const totalAppels = filtered.filter((a) => a.action_type === 'appel' || a.action_type === 'relance').length;
  const signatures = filtered.filter((a) => a.action_type === 'status_change' && a.to_status === 'Signature').length;
  if (totalAppels === 0) return 0;
  return (signatures / totalAppels) * 100;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data: allProspects = [], isLoading: loadingP, error: errorP, refetch: refetchP, isFetching: fetchingP } = useProspects();
  const { data: allActions = [], isLoading: loadingA, error: errorA, refetch: refetchA, isFetching: fetchingA } = useActions();
  const { data: cityAttributions = [] } = useCityAttributions();
  const { data: registeredUsers = [] } = useRegisteredUsers();

  const hasError = errorP || errorA;
  const handleRetryAll = useCallback(() => {
    if (errorP) refetchP();
    if (errorA) refetchA();
  }, [errorP, errorA, refetchP, refetchA]);

  const [selectedPeriod, setSelectedPeriod] = usePersistentState<PeriodKey>('lyftt.dash.periode', 'today');
  const [selectedCommercial, setSelectedCommercial] = usePersistentState<string>('lyftt.dash.commercial', 'global');
  const [showSpeedRun, setShowSpeedRun] = useState(false);

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
      for (const k of keys) row[headers[k]] = (p as Record<string, unknown>)[k] ?? '';
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

  const commercialCities = useMemo(() => {
    if (selectedCommercial === 'global') return null;
    const matched = registeredUsers.find(
      (u) => normName(`${u.first_name || ''} ${u.last_name || ''}`) === normName(selectedCommercial)
    );
    if (!matched) return [];
    return cityAttributions.filter((a) => a.user_role_id === matched.id).map((a) => a.city);
  }, [selectedCommercial, cityAttributions, registeredUsers]);

  const prospects = useMemo(() => {
    if (selectedCommercial === 'global') return allProspects;
    const target = normName(selectedCommercial);
    return allProspects.filter((p) => {
      if (normName(p.commercial_assigne) === target) return true;
      if (commercialCities && commercialCities.length > 0) return commercialCities.includes(p.zone_geographique);
      return false;
    });
  }, [allProspects, selectedCommercial, commercialCities]);

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
    const signatures = fa.filter((a) => a.action_type === 'status_change' && a.to_status === 'Signature').length;
    const visios = fa.filter((a) => a.action_type === 'visio').length;
    const currentRate = computeConversionRate(actions, start, end);
    const { start: ps, end: pe } = getPreviousDateRange(selectedPeriod);
    const previousRate = computeConversionRate(actions, ps, pe);
    let trend: 'up' | 'down' | 'stable' = 'stable';
    if (currentRate > previousRate + 0.5) trend = 'up';
    else if (currentRate < previousRate - 0.5) trend = 'down';
    return { totalAppels, appelsRepondus, refus, signatures, visios, currentRate, previousRate, trend };
  }, [actions, selectedPeriod]);

  const prospectsToCallback = useMemo(() => {
    const now = new Date();
    const fiveDaysAgo = new Date(now.getTime() - 5 * 86400000);
    return prospects
      .filter((p) => {
        if (p.statut_gagne_perdu !== 'actif') return false;
        if (p.date_dernier_appel && !p.date_dernier_appel.startsWith('2026-01-01')) {
          return new Date(p.date_dernier_appel) <= fiveDaysAgo;
        }
        return (p.nombre_appels || 0) > 0;
      })
      .sort((a, b) => {
        const da = a.date_dernier_appel ? new Date(a.date_dernier_appel).getTime() : 0;
        const db = b.date_dernier_appel ? new Date(b.date_dernier_appel).getTime() : 0;
        return da - db;
      })
      .slice(0, 10);
  }, [prospects]);

  // Relances DATÉES : celles du jour (triées par heure) + celles en retard.
  // Une relance datée non appelée passe EN ROUGE dès le lendemain.
  const relancesDate = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getTime() + 86400000);
    return prospects
      .filter((p) => {
        if (p.statut_gagne_perdu !== 'actif') return false;
        if (!p.date_relance_planifiee) return false;
        return new Date(p.date_relance_planifiee) < end;
      })
      .sort((a, b) => new Date(a.date_relance_planifiee).getTime() - new Date(b.date_relance_planifiee).getTime())
      .map((p) => ({ p, overdue: new Date(p.date_relance_planifiee) < start }));
  }, [prospects]);

  const activeProspects = useMemo(() => prospects.filter((p) => p.statut_gagne_perdu === 'actif').length, [prospects]);
  const wonDeals = useMemo(() => prospects.filter((p) => p.statut_gagne_perdu === 'gagne').length, [prospects]);

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
      {showSpeedRun && <SpeedRun onClose={() => setShowSpeedRun(false)} />}
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
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSpeedRun(true)}
            className="group relative inline-flex items-center gap-2 rounded-xl px-4 py-2 font-bold text-white bg-gradient-to-r from-amber-400 via-orange-500 to-pink-500 shadow-[0_0_25px_rgba(251,146,60,0.45)] hover:shadow-[0_0_35px_rgba(251,146,60,0.7)] hover:scale-[1.03] active:scale-95 transition-all"
          >
            <span className="absolute inset-0 rounded-xl bg-white/20 opacity-0 group-hover:opacity-100 animate-pulse" />
            <Zap className="w-4 h-4 relative" fill="white" />
            <span className="relative tracking-wide">Speed Run</span>
          </button>
          <Button
            onClick={handleExportExcel}
            disabled={allProspects.length === 0}
            className="rounded-xl bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] hover:from-[#4A8B93] hover:to-[#5A9BA4] text-white shadow-md shadow-[#6AABB4]/20"
          >
            <Download className="w-4 h-4 mr-2" /> Exporter Excel
          </Button>
          {commercialNames.length > 0 && (
            <Select value={selectedCommercial} onValueChange={setSelectedCommercial}>
              <SelectTrigger className="w-56 rounded-xl border-slate-200 bg-white shadow-sm">
                <UserCircle className="w-4 h-4 mr-2 text-[#6AABB4]" />
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

      {/* Commercial info banner */}
      {selectedCommercial !== 'global' && (
        <div className="bg-gradient-to-r from-teal-50 to-cyan-50 rounded-2xl p-4 border border-teal-100">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-[#5A9BA3] to-[#6AABB4] rounded-lg flex items-center justify-center">
                <UserCircle className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-teal-900">{selectedCommercial}</span>
            </div>
            <div className="text-sm text-teal-700">
              {commercialCities && commercialCities.length > 0 ? (
                <span className="flex flex-wrap items-center gap-1">
                  Zones :
                  {commercialCities.map((city) => (
                    <Badge key={city} variant="secondary" className="bg-teal-100/80 text-teal-700 border-0 text-xs">{city}</Badge>
                  ))}
                </span>
              ) : (
                <span className="text-teal-400 italic">Aucune zone attribuée</span>
              )}
            </div>
            <div className="ml-auto text-sm text-teal-600 font-semibold">
              {prospects.length} prospect{prospects.length > 1 ? 's' : ''}
            </div>
          </div>
        </div>
      )}

      {/* General KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-0 shadow-sm rounded-2xl overflow-hidden">
          <CardContent className="p-6 relative">
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-teal-100/50 to-transparent rounded-bl-full" />
            <div className="flex items-center justify-between relative">
              <div>
                <p className="text-sm font-medium text-slate-500">Prospects actifs</p>
                <p className="text-3xl font-bold text-slate-900 mt-1 tracking-tight">{activeProspects}</p>
              </div>
              <div className="w-12 h-12 bg-gradient-to-br from-teal-100 to-teal-200 rounded-2xl flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-[#5A9BA3]" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm rounded-2xl overflow-hidden">
          <CardContent className="p-6 relative">
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-emerald-100/50 to-transparent rounded-bl-full" />
            <div className="flex items-center justify-between relative">
              <div>
                <p className="text-sm font-medium text-slate-500">Deals gagnés</p>
                <p className="text-3xl font-bold text-emerald-600 mt-1 tracking-tight">{wonDeals}</p>
              </div>
              <div className="w-12 h-12 bg-gradient-to-br from-emerald-100 to-emerald-200 rounded-2xl flex items-center justify-center">
                <FileSignature className="w-6 h-6 text-emerald-600" />
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

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatBox icon={Phone} value={periodStats.totalAppels} label="Appels" gradient="from-teal-50 to-teal-100/50" iconBg="bg-teal-100" iconColor="text-[#5A9BA3]" />
            <StatBox icon={PhoneCall} value={periodStats.appelsRepondus} label="Répondus" gradient="from-emerald-50 to-emerald-100/50" iconBg="bg-emerald-100" iconColor="text-emerald-600" valueColor="text-emerald-600" />
            <StatBox icon={XCircle} value={periodStats.refus} label="Refus" gradient="from-red-50 to-red-100/50" iconBg="bg-red-100" iconColor="text-red-600" valueColor="text-red-600" />
            <StatBox icon={FileSignature} value={periodStats.signatures} label="Signatures" gradient="from-emerald-50 to-emerald-100/50" iconBg="bg-emerald-100" iconColor="text-emerald-600" valueColor="text-emerald-600" />
            <StatBox icon={Video} value={periodStats.visios} label="Visios" gradient="from-purple-50 to-purple-100/50" iconBg="bg-purple-100" iconColor="text-purple-600" valueColor="text-purple-600" />

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

      {/* Deux colonnes de relance : NRP (appels non répondus) + Relances datées du jour */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Relance NRP */}
        <Card className="border-0 shadow-sm rounded-2xl">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <PhoneOff className="w-5 h-5 text-red-500" /> Relance NRP
            </CardTitle>
            <p className="text-xs text-slate-400 mt-1">Appels non répondus à rappeler (dernier appel il y a 5+ jours)</p>
          </CardHeader>
          <CardContent>
            {prospectsToCallback.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3"><Phone className="w-5 h-5 text-slate-400" /></div>
                <p className="text-sm text-slate-400">Aucune relance NRP en attente</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                {prospectsToCallback.map((p) => <CallbackRow key={p.id} prospect={p} overdue={!!p.date_prochaine_relance && new Date(p.date_prochaine_relance) <= new Date()} />)}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Relance date (aujourd'hui, par heure) */}
        <Card className="border-0 shadow-sm rounded-2xl">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Clock className="w-5 h-5 text-[#5A9BA3]" /> Relance date — aujourd'hui
            </CardTitle>
            <p className="text-xs text-slate-400 mt-1">Relances planifiées aujourd'hui, classées par heure</p>
          </CardHeader>
          <CardContent>
            {relancesDate.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3"><Clock className="w-5 h-5 text-slate-400" /></div>
                <p className="text-sm text-slate-400">Aucune relance datée aujourd'hui</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                {relancesDate.map(({ p, overdue }) => <RelanceDateRow key={p.id} prospect={p} overdue={overdue} />)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
  icon: React.ElementType; value: number; label: string; gradient: string; iconBg: string; iconColor: string; valueColor?: string;
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

function RelanceDateRow({ prospect: p, overdue = false }: { prospect: Prospect; overdue?: boolean }) {
  const dt = p.date_relance_planifiee ? new Date(p.date_relance_planifiee) : null;
  const heure = dt ? dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
  const jour = dt ? dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '';
  return (
    <Link
      to={`/prospects/${p.id}`}
      className={`flex items-center gap-3 p-3 rounded-xl border transition-colors group ${overdue ? 'border-red-200 bg-red-50/70 hover:bg-red-50' : 'border-slate-100 hover:border-[#6AABB4]/40 hover:bg-gradient-to-r hover:from-teal-50/50 hover:to-cyan-50/30'}`}
    >
      <div className="w-16 shrink-0 text-center">
        <span className={`inline-block px-2 py-1 rounded-lg text-sm font-bold tabular-nums ${overdue ? 'bg-red-500 text-white' : 'bg-[#5A9BA3]/10 text-[#5A9BA3]'}`}>{heure}</span>
        {overdue && <p className="text-[10px] font-bold text-red-600 mt-0.5">{jour} en retard</p>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900 truncate group-hover:text-[#5A9BA3] transition-colors">{p.nom_societe}</p>
        <p className="text-xs text-slate-500 mt-0.5 truncate">{p.nom_dirigeant || p.telephone || p.zone_geographique}</p>
      </div>
      <span className="text-xs text-slate-500 shrink-0">{p.statut_avancement}</span>
    </Link>
  );
}

function CallbackRow({ prospect: p, overdue = false }: { prospect: Prospect; overdue?: boolean }) {
  const lastCallDate = p.date_dernier_appel ? new Date(p.date_dernier_appel) : null;
  const daysAgo = lastCallDate ? Math.floor((Date.now() - lastCallDate.getTime()) / 86400000) : null;
  return (
    <Link
      to={`/prospects/${p.id}`}
      className={`block p-3 rounded-xl border transition-colors group ${overdue ? 'border-red-200 bg-red-50/70 hover:bg-red-50' : 'border-slate-100 hover:border-[#6AABB4]/40 hover:bg-gradient-to-r hover:from-teal-50/50 hover:to-cyan-50/30'}`}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate group-hover:text-[#5A9BA3] transition-colors">{p.nom_societe}</p>
          <p className="text-xs text-slate-500 mt-0.5">{p.nom_dirigeant}</p>
        </div>
        <Badge className={`text-[10px] ${priorityColors[p.priorite] || 'bg-slate-100 text-slate-700'}`}>{p.priorite}</Badge>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs font-semibold text-orange-600">{daysAgo !== null ? `Il y a ${daysAgo} jour${daysAgo > 1 ? 's' : ''}` : '-'}</span>
        <span className="text-xs text-slate-300">•</span>
        <span className="text-xs text-slate-500">{p.statut_avancement}</span>
        <span className="text-xs text-slate-300">•</span>
        <span className="text-xs text-slate-500">{p.nombre_appels || 0} appel{(p.nombre_appels || 0) > 1 ? 's' : ''}</span>
      </div>
    </Link>
  );
}