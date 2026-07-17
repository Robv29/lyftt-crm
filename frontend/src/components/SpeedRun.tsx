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
  XCircle, Shuffle, MapPin, Building2, Trophy, User,
} from 'lucide-react';

const norm = (s?: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

type Mode = 'aleatoire' | 'ville' | 'secteur';

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/95 backdrop-blur-md">
      <button onClick={onClose} className="absolute top-5 right-5 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors" aria-label="Quitter">
        <X className="w-6 h-6" />
      </button>

      {/* SETUP */}
      {phase === 'setup' && (
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-pink-500 shadow-[0_0_40px_rgba(251,146,60,0.5)] mb-4">
              <Zap className="w-8 h-8 text-white" fill="white" />
            </div>
            <h2 className="text-3xl font-black text-white tracking-tight">SPEED RUN</h2>
            <p className="text-slate-400 mt-1 text-sm">Enchaîne tes appels sans réfléchir.</p>
          </div>

          <div className="space-y-5 bg-white/5 border border-white/10 rounded-3xl p-6">
            <div>
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5 mb-2"><User className="w-3.5 h-3.5" /> Ton nom</label>
              <Select value={commercial} onValueChange={(v) => { setCommercial(v); setSubValue(''); }}>
                <SelectTrigger className="rounded-xl bg-white/10 border-white/10 text-white"><SelectValue placeholder="Sélectionne ton nom" /></SelectTrigger>
                <SelectContent>{commercialNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {commercial && (
              <>
                <div>
                  <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Mode</p>
                  <div className="grid grid-cols-3 gap-2">
                    {([['aleatoire', 'Aléatoire', Shuffle], ['ville', 'Ville', MapPin], ['secteur', 'Secteur', Building2]] as const).map(([m, label, Icon]) => (
                      <button key={m} onClick={() => { setMode(m); setSubValue(''); }}
                        className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border text-xs font-semibold transition-all ${mode === m ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white border-transparent shadow-lg' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`}>
                        <Icon className="w-4 h-4" /> {label}
                      </button>
                    ))}
                  </div>
                </div>

                {mode === 'ville' && (
                  <Select value={subValue} onValueChange={setSubValue}>
                    <SelectTrigger className="rounded-xl bg-white/10 border-white/10 text-white"><SelectValue placeholder="Choisir une ville" /></SelectTrigger>
                    <SelectContent>{villes.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                {mode === 'secteur' && (
                  <Select value={subValue} onValueChange={setSubValue}>
                    <SelectTrigger className="rounded-xl bg-white/10 border-white/10 text-white"><SelectValue placeholder="Choisir un secteur" /></SelectTrigger>
                    <SelectContent>{secteurs.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                )}

                <p className="text-center text-sm text-slate-400">{poolPreview.length} entreprise{poolPreview.length > 1 ? 's' : ''} dans la liste</p>

                <Button onClick={startRun} disabled={poolPreview.length === 0 || ((mode === 'ville' || mode === 'secteur') && !subValue)}
                  className="w-full h-12 text-base font-bold rounded-xl bg-gradient-to-r from-amber-400 via-orange-500 to-pink-500 hover:opacity-90 text-white shadow-[0_0_30px_rgba(251,146,60,0.4)]">
                  <Zap className="w-5 h-5 mr-1" fill="white" /> C'EST PARTI
                </Button>
              </>
            )}
            {commercial && commercialCities.length === 0 && (
              <p className="text-center text-xs text-amber-300">Tu n'as aucune ville attribuée. Va dans Attributions pour en ajouter.</p>
            )}
          </div>
        </div>
      )}

      {/* RUN */}
      {phase === 'run' && current && (
        <div className="w-full max-w-lg">
          <div className="flex items-center justify-center gap-4 mb-5 text-white/80 text-sm font-semibold">
            <span>{index + 1} / {queue.length}</span>
            <span className="text-emerald-400">✓ {stats.answered} répondus</span>
            <span className="text-white/50">{stats.done} traités</span>
          </div>

          <div className="bg-white rounded-3xl p-8 shadow-2xl">
            <div className="text-center">
              <p className="text-xs font-bold uppercase tracking-widest text-[#5A9BA3]">{current.categorie_metier || 'Prospect'} · {current.zone_geographique}</p>
              <h2 className="text-3xl font-black text-slate-900 mt-2 leading-tight">{current.nom_societe}</h2>
              {current.nom_dirigeant && <p className="text-lg text-slate-500 mt-1">{current.nom_dirigeant}</p>}
            </div>

            {/* Téléphone + copier */}
            <div className="mt-6 flex items-center justify-center gap-3 bg-slate-50 rounded-2xl p-4">
              <span className="text-2xl font-bold text-slate-900 tabular-nums tracking-wide">{current.telephone || 'Aucun numéro'}</span>
              <button onClick={copyPhone} disabled={!current.telephone}
                className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${copied ? 'bg-emerald-500 text-white' : 'bg-[#5A9BA3] text-white hover:bg-[#4A8B93]'}`}
                title="Copier le numéro">
                {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
              </button>
            </div>

            {/* Étape 1 : inviter à copier */}
            {step === 'card' && (
              <p className="text-center text-sm text-slate-400 mt-5">Copie le numéro pour lancer l'appel 👆</p>
            )}

            {/* Étape 2 : résultat de l'appel */}
            {step === 'result' && (
              <div className="grid grid-cols-2 gap-3 mt-6">
                <Button onClick={answered} className="h-14 text-base font-bold rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white">
                  <PhoneCall className="w-5 h-5 mr-1" /> Répondu
                </Button>
                <Button onClick={noAnswer} variant="outline" className="h-14 text-base font-bold rounded-2xl border-red-200 text-red-600 hover:bg-red-50">
                  <PhoneOff className="w-5 h-5 mr-1" /> Non répondu
                </Button>
              </div>
            )}

            {/* Étape 3 : suite (répondu) */}
            {step === 'followup' && (
              <div className="mt-6 space-y-3">
                <p className="text-center text-sm font-semibold text-slate-500">Prochaine étape ?</p>
                <div className="grid grid-cols-2 gap-3">
                  <Button onClick={doVisio} className="h-12 rounded-2xl bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white gap-2"><Video className="w-4 h-4" /> Visio</Button>
                  <Button onClick={doRefus} variant="outline" className="h-12 rounded-2xl border-red-200 text-red-600 hover:bg-red-50 gap-2"><XCircle className="w-4 h-4" /> Refus</Button>
                </div>
                <div className="rounded-2xl border border-slate-200 p-3">
                  <p className="text-xs text-slate-500 mb-1">Relance à une date précise</p>
                  <div className="flex gap-2">
                    <input type="datetime-local" value={relanceDateTime} onChange={(e) => setRelanceDateTime(e.target.value)}
                      className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6AABB4]/40" />
                    <Button onClick={doRelanceDate} disabled={!relanceDateTime} size="sm" className="gap-1.5 bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] text-white rounded-xl"><CalendarClock className="w-4 h-4" /> OK</Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <button onClick={next} className="mt-4 mx-auto block text-sm text-white/60 hover:text-white/90 transition-colors">Passer cette entreprise →</button>
        </div>
      )}

      {/* DONE */}
      {phase === 'done' && (
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-[0_0_50px_rgba(251,146,60,0.5)] mb-5">
            <Trophy className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-3xl font-black text-white">Speed run terminé !</h2>
          <p className="text-slate-400 mt-2">Tu as traité <span className="text-white font-bold">{stats.done}</span> entreprise(s), dont <span className="text-emerald-400 font-bold">{stats.answered}</span> qui ont répondu.</p>
          <div className="flex gap-3 justify-center mt-8">
            <Button onClick={() => setPhase('setup')} variant="outline" className="rounded-xl bg-white/5 border-white/10 text-white hover:bg-white/10">Relancer un run</Button>
            <Button onClick={onClose} className="rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-white">Terminer</Button>
          </div>
        </div>
      )}
    </div>
  );
}
