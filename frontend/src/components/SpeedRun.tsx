import { useState, useMemo, useCallback } from 'react';
import { client } from '../lib/api';
import {
  useProspects, useRegisteredUsers, useCityAttributions,
  useInvalidateProspects, useInvalidateActions, type Prospect,
} from '../hooks/use-prospects';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Zap, X, Copy, Check, PhoneCall, PhoneOff, Video, CalendarClock,
  XCircle, Shuffle, MapPin, Building2, Trophy, User, Flame,
} from 'lucide-react';

const norm = (s?: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

type Mode = 'aleatoire' | 'ville' | 'secteur';

const STYLES = `
@keyframes sr-pop { from { transform: scale(.94) translateY(8px); opacity: 0 } to { transform: scale(1) translateY(0); opacity: 1 } }
@keyframes sr-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-7px) } }
@keyframes sr-shine { from { background-position: 0% 50% } to { background-position: 200% 50% } }
@keyframes sr-ring { from { box-shadow: 0 0 0 0 rgba(16,185,129,.55) } to { box-shadow: 0 0 0 20px rgba(16,185,129,0) } }
@keyframes sr-slide { from { transform: translateY(10px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
.sr-pop { animation: sr-pop .35s cubic-bezier(.22,1,.36,1) both }
.sr-slide { animation: sr-slide .25s ease-out both }
.sr-float { animation: sr-float 3.5s ease-in-out infinite }
.sr-shine { background-size: 200% 100%; animation: sr-shine 3s linear infinite }
.sr-ring { animation: sr-ring 1.4s ease-out infinite }
`;

export default function SpeedRun({ onClose }: { onClose: () => void }) {
  const { data: prospects = [] } = useProspects();
  const { data: users = [] } = useRegisteredUsers();
  const { data: cityAttributions = [] } = useCityAttributions();
  const invalidateProspects = useInvalidateProspects();
  const invalidateActions = useInvalidateActions();

  const [phase, setPhase] = useState<'setup' | 'run' | 'done'>('setup');
  const [commercial, setCommercial] = useState('');
  const [mode, setMode] = useState<Mode>('aleatoire');
  const [subValue, setSubValue] = useState('');
  const [queue, setQueue] = useState<Prospect[]>([]);
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<'card' | 'result' | 'followup'>('card');
  const [copied, setCopied] = useState(false);
  const [relanceDateTime, setRelanceDateTime] = useState('');
  const [stats, setStats] = useState({ done: 0, answered: 0 });

  const commercialNames = useMemo(
    () => users.filter((u) => u.first_name || u.last_name).map((u) => `${u.first_name || ''} ${u.last_name || ''}`.trim()).filter(Boolean).sort(),
    [users]
  );
  const commercialCities = useMemo(() => {
    const u = users.find((r) => norm(`${r.first_name || ''} ${r.last_name || ''}`) === norm(commercial));
    if (!u) return [] as string[];
    return cityAttributions.filter((a) => a.user_role_id === u.id).map((a) => a.city);
  }, [commercial, users, cityAttributions]);

  const basePool = useMemo(() => {
    const set = new Set(commercialCities);
    return prospects.filter((p) => p.statut_gagne_perdu === 'actif' && set.has(p.zone_geographique));
  }, [prospects, commercialCities]);

  const villes = useMemo(() => Array.from(new Set(basePool.map((p) => p.zone_geographique).filter(Boolean))).sort(), [basePool]);
  const secteurs = useMemo(() => Array.from(new Set(basePool.map((p) => p.categorie_metier).filter(Boolean))).sort(), [basePool]);

  const poolPreview = useMemo(() => {
    let pool = basePool;
    if (mode === 'ville' && subValue) pool = pool.filter((p) => p.zone_geographique === subValue);
    if (mode === 'secteur' && subValue) pool = pool.filter((p) => p.categorie_metier === subValue);
    return pool;
  }, [basePool, mode, subValue]);

  const current = queue[index] || null;

  const startRun = () => {
    const q = mode === 'aleatoire'
      ? shuffle(poolPreview)
      : [...poolPreview].sort((a, b) => (a.nombre_appels || 0) - (b.nombre_appels || 0));
    if (q.length === 0) { toast.error('Aucun prospect pour ce choix'); return; }
    setQueue(q); setIndex(0); setStep('card'); setCopied(false); setRelanceDateTime('');
    setStats({ done: 0, answered: 0 }); setPhase('run');
  };

  const next = useCallback(() => {
    setStep('card'); setCopied(false); setRelanceDateTime('');
    setIndex((i) => {
      if (i + 1 >= queue.length) { setPhase('done'); return i; }
      return i + 1;
    });
  }, [queue.length]);

  const copyPhone = async () => {
    if (!current) return;
    try { await navigator.clipboard.writeText(current.telephone || ''); toast.success('Numéro copié'); } catch { /* ignore */ }
    setCopied(true); setStep('result');
  };

  const noAnswer = useCallback(async () => {
    const p = current; if (!p) return;
    const isFirst = (p.nombre_appels || 0) === 0;
    const rel = (p.nombre_relances || 0) + (isFirst ? 0 : 1);
    let st = p.statut_avancement;
    if (!isFirst) st = rel === 1 ? 'Relance 1' : rel === 2 ? 'Relance 2' : rel === 3 ? 'Relance 3' : 'Relance 4';
    const nextR = new Date(); nextR.setDate(nextR.getDate() + 5);
    const data: Record<string, unknown> = { nombre_appels: (p.nombre_appels || 0) + 1, date_dernier_appel: new Date().toISOString(), date_prochaine_relance: nextR.toISOString() };
    if (!isFirst) { data.nombre_relances = rel; data.statut_avancement = st; }
    data.date_relance_planifiee = null; // le NRP consomme la relance datée
    try {
      await client.entities.prospects.update({ id: String(p.id), data });
      await client.entities.commercial_actions.create({ data: { prospect_id: p.id, action_type: isFirst ? 'appel' : 'relance', appel_repondu: false, from_status: p.statut_avancement, to_status: st, notes: 'NRP (speed run)', action_date: new Date().toISOString() } });
    } catch { /* ignore */ }
    setStats((s) => ({ ...s, done: s.done + 1 }));
    invalidateProspects(); invalidateActions(p.id); next();
  }, [current, next, invalidateProspects, invalidateActions]);

  const answered = useCallback(async () => {
    const p = current; if (!p) return;
    try {
      await client.entities.prospects.update({ id: String(p.id), data: { nombre_appels: (p.nombre_appels || 0) + 1, nombre_appels_repondus: (p.nombre_appels_repondus || 0) + 1, date_dernier_appel: new Date().toISOString() } });
      await client.entities.commercial_actions.create({ data: { prospect_id: p.id, action_type: 'appel', appel_repondu: true, from_status: p.statut_avancement, to_status: p.statut_avancement, notes: 'Appel répondu (speed run)', action_date: new Date().toISOString() } });
    } catch { /* ignore */ }
    setStats((s) => ({ ...s, answered: s.answered + 1 }));
    invalidateProspects(); invalidateActions(p.id); setStep('followup');
  }, [current, invalidateProspects, invalidateActions]);

  const doVisio = useCallback(async () => {
    const p = current; if (!p) return;
    try {
      await client.entities.prospects.update({ id: String(p.id), data: { statut_avancement: 'Visio', date_visio: new Date().toISOString() } });
      await client.entities.commercial_actions.create({ data: { prospect_id: p.id, action_type: 'visio', appel_repondu: false, from_status: p.statut_avancement, to_status: 'Visio', notes: 'Visio (speed run)', action_date: new Date().toISOString() } });
    } catch { /* ignore */ }
    setStats((s) => ({ ...s, done: s.done + 1 }));
    invalidateProspects(); invalidateActions(p.id); next();
  }, [current, next, invalidateProspects, invalidateActions]);

  const doRelanceDate = useCallback(async () => {
    const p = current; if (!p || !relanceDateTime) return;
    const iso = new Date(relanceDateTime).toISOString();
    try {
      await client.entities.prospects.update({ id: String(p.id), data: { date_relance_planifiee: iso } });
      await client.entities.commercial_actions.create({ data: { prospect_id: p.id, action_type: 'relance_planifiee', appel_repondu: false, from_status: p.statut_avancement, to_status: p.statut_avancement, notes: `Relance planifiée ${new Date(iso).toLocaleString('fr-FR')} (speed run)`, action_date: new Date().toISOString() } });
    } catch { /* ignore */ }
    setStats((s) => ({ ...s, done: s.done + 1 }));
    invalidateProspects(); invalidateActions(p.id); next();
  }, [current, relanceDateTime, next, invalidateProspects, invalidateActions]);

  const doRefus = useCallback(async () => {
    const p = current; if (!p) return;
    try {
      await client.entities.prospects.update({ id: String(p.id), data: { statut_avancement: 'Refus / Perdu', statut_gagne_perdu: 'perdu' } });
      await client.entities.commercial_actions.create({ data: { prospect_id: p.id, action_type: 'status_change', appel_repondu: false, from_status: p.statut_avancement, to_status: 'Refus / Perdu', notes: 'Refus (speed run)', action_date: new Date().toISOString() } });
    } catch { /* ignore */ }
    setStats((s) => ({ ...s, done: s.done + 1 }));
    invalidateProspects(); invalidateActions(p.id); next();
  }, [current, next, invalidateProspects, invalidateActions]);

  const progress = queue.length ? ((index) / queue.length) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0b1220]/95 backdrop-blur-md">
      <style>{STYLES}</style>

      {/* halos décoratifs */}
      <div className="pointer-events-none absolute -top-24 -left-24 w-96 h-96 rounded-full bg-orange-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-pink-500/20 blur-3xl" />

      <button onClick={onClose} className="absolute top-5 right-5 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors z-10" aria-label="Quitter">
        <X className="w-6 h-6" />
      </button>

      {/* ---------------- SETUP ---------------- */}
      {phase === 'setup' && (
        <div className="sr-pop w-[440px] max-w-[92vw] min-h-[520px] flex flex-col">
          <div className="text-center mb-6">
            <div className="sr-float inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-pink-500 shadow-[0_0_45px_rgba(251,146,60,0.55)] mb-4">
              <Zap className="w-8 h-8 text-white" fill="white" />
            </div>
            <h2 className="text-4xl font-black text-white tracking-tighter">SPEED RUN</h2>
            <p className="text-slate-400 mt-1 text-sm">Enchaîne tes appels sans réfléchir.</p>
          </div>

          <div className="flex-1 space-y-5 bg-white/[0.06] border border-white/10 rounded-3xl p-6 backdrop-blur">
            <div>
              <label className="text-[11px] font-bold text-slate-300 uppercase tracking-widest flex items-center gap-1.5 mb-2"><User className="w-3.5 h-3.5" /> Ton nom</label>
              <Select value={commercial} onValueChange={(v) => { setCommercial(v); setSubValue(''); }}>
                <SelectTrigger className="rounded-xl bg-white/10 border-white/10 text-white h-11"><SelectValue placeholder="Sélectionne ton nom" /></SelectTrigger>
                <SelectContent>{commercialNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {commercial ? (
              <div className="sr-slide space-y-5">
                <div>
                  <p className="text-[11px] font-bold text-slate-300 uppercase tracking-widest mb-2">Mode</p>
                  <div className="grid grid-cols-3 gap-2">
                    {([['aleatoire', 'Aléatoire', Shuffle], ['ville', 'Ville', MapPin], ['secteur', 'Secteur', Building2]] as const).map(([m, label, Icon]) => (
                      <button key={m} onClick={() => { setMode(m); setSubValue(''); }}
                        className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border text-xs font-bold transition-all duration-200 ${mode === m ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white border-transparent shadow-lg scale-105' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10 hover:scale-[1.02]'}`}>
                        <Icon className="w-4 h-4" /> {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-11">
                  {mode === 'ville' && (
                    <Select value={subValue} onValueChange={setSubValue}>
                      <SelectTrigger className="rounded-xl bg-white/10 border-white/10 text-white h-11"><SelectValue placeholder="Choisir une ville" /></SelectTrigger>
                      <SelectContent>{villes.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  {mode === 'secteur' && (
                    <Select value={subValue} onValueChange={setSubValue}>
                      <SelectTrigger className="rounded-xl bg-white/10 border-white/10 text-white h-11"><SelectValue placeholder="Choisir un secteur" /></SelectTrigger>
                      <SelectContent>{secteurs.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  {mode === 'aleatoire' && (
                    <div className="h-11 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-xs text-slate-400">Toutes tes villes, dans le désordre</div>
                  )}
                </div>

                <div className="flex items-center justify-center gap-2 text-sm">
                  <Flame className="w-4 h-4 text-orange-400" />
                  <span className="text-white font-bold">{poolPreview.length}</span>
                  <span className="text-slate-400">entreprise{poolPreview.length > 1 ? 's' : ''} à appeler</span>
                </div>

                <Button onClick={startRun} disabled={poolPreview.length === 0 || ((mode === 'ville' || mode === 'secteur') && !subValue)}
                  className="sr-shine w-full h-12 text-base font-black tracking-wide rounded-xl text-white shadow-[0_0_30px_rgba(251,146,60,0.45)] hover:scale-[1.02] transition-transform disabled:opacity-40"
                  style={{ backgroundImage: 'linear-gradient(90deg,#fbbf24,#f97316,#ec4899,#f97316,#fbbf24)' }}>
                  <Zap className="w-5 h-5 mr-1" fill="white" /> C'EST PARTI
                </Button>

                {commercialCities.length === 0 && (
                  <p className="text-center text-xs text-amber-300">Aucune ville attribuée. Va dans Attributions pour en ajouter.</p>
                )}
              </div>
            ) : (
              <div className="h-[280px] flex items-center justify-center text-sm text-slate-500">Choisis ton nom pour commencer</div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- RUN ---------------- */}
      {phase === 'run' && current && (
        <div className="w-[540px] max-w-[94vw] flex flex-col">
          {/* barre de progression + compteurs (hauteur fixe) */}
          <div className="h-[52px] shrink-0">
            <div className="flex items-center justify-between text-xs font-bold text-white/70 mb-2">
              <span>{index + 1} / {queue.length}</span>
              <div className="flex items-center gap-3">
                <span className="text-emerald-400">✓ {stats.answered}</span>
                <span className="text-white/40">{stats.done} traités</span>
              </div>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-pink-500 transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>

          {/* carte à dimensions FIXES */}
          <div key={current.id} className="sr-pop mt-3 h-[430px] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="h-1.5 shrink-0 sr-shine" style={{ backgroundImage: 'linear-gradient(90deg,#fbbf24,#f97316,#ec4899,#f97316,#fbbf24)' }} />

            {/* identité — hauteur réservée, texte tronqué */}
            <div className="px-7 pt-5 text-center shrink-0">
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#5A9BA3] truncate">
                {current.categorie_metier || 'Prospect'} · {current.zone_geographique}
              </p>
              <h2 className="mt-1.5 h-[62px] flex items-center justify-center text-[26px] leading-[1.15] font-black text-slate-900 overflow-hidden">
                <span className="line-clamp-2">{current.nom_societe}</span>
              </h2>
              <p className="h-[22px] text-base text-slate-500 truncate">{current.nom_dirigeant || '—'}</p>
            </div>

            {/* téléphone + copier — hauteur fixe */}
            <div className="px-7 mt-3 shrink-0">
              <div className="h-[68px] flex items-center justify-center gap-3 bg-slate-50 rounded-2xl px-4">
                <span className="text-[26px] font-black text-slate-900 tabular-nums tracking-tight truncate">{current.telephone || 'Aucun numéro'}</span>
                <button onClick={copyPhone} disabled={!current.telephone}
                  className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-all active:scale-90 ${copied ? 'bg-emerald-500 text-white' : 'bg-[#5A9BA3] text-white hover:bg-[#4A8B93] sr-ring'}`}
                  title="Copier le numéro">
                  {copied ? <Check className="w-6 h-6" /> : <Copy className="w-6 h-6" />}
                </button>
              </div>
            </div>

            {/* zone d'action — hauteur FIXE : le contenu change, la carte ne bouge pas */}
            <div className="px-7 pb-5 pt-4 h-[186px] shrink-0">
              {step === 'card' && (
                <div className="sr-slide h-full flex flex-col items-center justify-center gap-2">
                  <Copy className="w-7 h-7 text-slate-300" />
                  <p className="text-sm text-slate-400 font-medium">Copie le numéro pour lancer l'appel</p>
                </div>
              )}

              {step === 'result' && (
                <div className="sr-slide h-full grid grid-cols-2 gap-3 items-center">
                  <Button onClick={answered} className="h-16 text-base font-black rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white flex-col gap-1 hover:scale-[1.03] transition-transform">
                    <PhoneCall className="w-6 h-6" /> Répondu
                  </Button>
                  <Button onClick={noAnswer} variant="outline" className="h-16 text-base font-black rounded-2xl border-2 border-red-200 text-red-600 hover:bg-red-50 flex-col gap-1 hover:scale-[1.03] transition-transform">
                    <PhoneOff className="w-6 h-6" /> Non répondu
                  </Button>
                </div>
              )}

              {step === 'followup' && (
                <div className="sr-slide h-full flex flex-col justify-center gap-2.5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <Button onClick={doVisio} className="h-11 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white gap-2 font-bold hover:scale-[1.03] transition-transform"><Video className="w-4 h-4" /> Visio</Button>
                    <Button onClick={doRefus} variant="outline" className="h-11 rounded-xl border-2 border-red-200 text-red-600 hover:bg-red-50 gap-2 font-bold hover:scale-[1.03] transition-transform"><XCircle className="w-4 h-4" /> Refus</Button>
                  </div>
                  <div className="flex gap-2">
                    <input type="datetime-local" value={relanceDateTime} onChange={(e) => setRelanceDateTime(e.target.value)}
                      className="flex-1 min-w-0 h-11 rounded-xl border-2 border-slate-200 px-3 text-sm focus:outline-none focus:border-[#6AABB4]" />
                    <Button onClick={doRelanceDate} disabled={!relanceDateTime} className="h-11 shrink-0 gap-1.5 bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] text-white rounded-xl font-bold"><CalendarClock className="w-4 h-4" /> Relance</Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <button onClick={next} className="mt-3 mx-auto block text-sm text-white/50 hover:text-white transition-colors">Passer cette entreprise →</button>
        </div>
      )}

      {/* ---------------- DONE ---------------- */}
      {phase === 'done' && (
        <div className="sr-pop w-[440px] max-w-[92vw] min-h-[520px] flex flex-col items-center justify-center text-center">
          <div className="sr-float inline-flex items-center justify-center w-24 h-24 rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-[0_0_60px_rgba(251,146,60,0.55)] mb-6">
            <Trophy className="w-12 h-12 text-white" />
          </div>
          <h2 className="text-4xl font-black text-white tracking-tighter">TERMINÉ !</h2>
          <div className="flex gap-4 mt-6">
            <div className="w-32 py-4 rounded-2xl bg-white/[0.06] border border-white/10">
              <p className="text-3xl font-black text-white">{stats.done}</p>
              <p className="text-xs text-slate-400 mt-0.5">traitées</p>
            </div>
            <div className="w-32 py-4 rounded-2xl bg-emerald-500/10 border border-emerald-400/20">
              <p className="text-3xl font-black text-emerald-400">{stats.answered}</p>
              <p className="text-xs text-emerald-300/70 mt-0.5">répondus</p>
            </div>
          </div>
          <div className="flex gap-3 justify-center mt-8">
            <Button onClick={() => setPhase('setup')} variant="outline" className="rounded-xl bg-white/5 border-white/10 text-white hover:bg-white/10 font-bold">Relancer un run</Button>
            <Button onClick={onClose} className="rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-white font-bold">Terminer</Button>
          </div>
        </div>
      )}
    </div>
  );
}
