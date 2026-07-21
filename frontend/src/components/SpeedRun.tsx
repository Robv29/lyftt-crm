import { useState, useMemo, useCallback, useEffect } from 'react';
import { client } from '../lib/api';
import {
  useProspects, useRegisteredUsers, useCityAttributions,
  useInvalidateProspects, useInvalidateActions, type Prospect,
} from '../hooks/use-prospects';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ConfettiBurst, MoneyFireworks, FlashPulse, usePrefersReducedMotion } from './Celebration';
import {
  Zap, X, Copy, Check, PhoneCall, PhoneOff, Video, CalendarClock,
  XCircle, Shuffle, MapPin, Building2, Trophy, User, Flame, Minus, Pencil,
} from 'lucide-react';

const norm = (s?: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Le statut juridique ("Forme") et l'effectif ("Effectif") ne sont pas des
// colonnes dédiées en base : ils viennent de l'import Monday et sont
// embarqués dans le champ notes au format "Effectif: X · Forme: Y · ...".
// On les extrait à l'affichage pour donner ce contexte en un coup d'œil
// pendant un appel, sans changer le schéma de la table.
function extractFromNotes(notes: string | undefined, label: string): string | null {
  if (!notes) return null;
  const m = notes.match(new RegExp(`${label}\\s*:\\s*([^·\\n]+)`, 'i'));
  return m ? m[1].trim() : null;
}

type ProspectFormFields = {
  nom_societe: string; nom_dirigeant: string; telephone: string; email: string;
  zone_geographique: string; categorie_metier: string;
};
const emptyProspectForm: ProspectFormFields = {
  nom_societe: '', nom_dirigeant: '', telephone: '', email: '', zone_geographique: '', categorie_metier: '',
};
const toLocalInputValue = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

type OrderMode = 'aleatoire' | 'moins_appeles';

const STYLES = `
@keyframes sr-pop { from { transform: scale(.94) translateY(8px); opacity: 0 } to { transform: scale(1) translateY(0); opacity: 1 } }
@keyframes sr-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-7px) } }
@keyframes sr-shine { from { background-position: 0% 50% } to { background-position: 200% 50% } }
@keyframes sr-ring { from { box-shadow: 0 0 0 0 rgba(16,185,129,.55) } to { box-shadow: 0 0 0 20px rgba(16,185,129,0) } }
@keyframes sr-slide { from { transform: translateY(10px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
@keyframes sr-exit-left { to { transform: translate(-130%, 8%) rotate(-10deg); opacity: 0 } }
@keyframes sr-exit-right { to { transform: translate(130%, 8%) rotate(10deg); opacity: 0 } }
@keyframes sr-exit-up { to { transform: translate(0, -120%) scale(.92); opacity: 0 } }
@keyframes sr-digit { from { transform: translateY(60%); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
.sr-pop { animation: sr-pop .35s cubic-bezier(.22,1,.36,1) both }
.sr-slide { animation: sr-slide .25s ease-out both }
.sr-float { animation: sr-float 3.5s ease-in-out infinite }
.sr-shine { background-size: 200% 100%; animation: sr-shine 3s linear infinite }
.sr-ring { animation: sr-ring 1.4s ease-out infinite }
.sr-exit-left { animation: sr-exit-left .26s cubic-bezier(.16,1,.3,1) forwards }
.sr-exit-right { animation: sr-exit-right .26s cubic-bezier(.16,1,.3,1) forwards }
.sr-exit-up { animation: sr-exit-up .22s cubic-bezier(.16,1,.3,1) forwards }
.sr-digit { display: inline-block; animation: sr-digit .32s cubic-bezier(.16,1,.3,1) both }
@media (prefers-reduced-motion: reduce) {
  .sr-pop, .sr-float, .sr-shine, .sr-ring, .sr-slide, .sr-digit { animation: none !important; }
  .sr-exit-left, .sr-exit-right, .sr-exit-up { animation: sr-pop .15s ease-out reverse both !important; }
}
`;

interface SpeedRunProps {
  onClose: () => void;
  // Réduction en pastille flottante : permet de naviguer sur une autre page
  // du CRM (Prospects, Pipeline...) SANS perdre la session en cours (file
  // d'appels, index, stats). L'état reste vivant, seul l'affichage change.
  minimized?: boolean;
  onMinimize?: () => void;
  onMaximize?: () => void;
}

export default function SpeedRun({ onClose, minimized = false, onMinimize, onMaximize }: SpeedRunProps) {
  const { data: prospects = [] } = useProspects();
  const { data: users = [] } = useRegisteredUsers();
  const { data: cityAttributions = [] } = useCityAttributions();
  const invalidateProspects = useInvalidateProspects();
  const invalidateActions = useInvalidateActions();

  const [phase, setPhase] = useState<'setup' | 'run' | 'done'>('setup');
  const [commercial, setCommercial] = useState('');
  const [selectedVilles, setSelectedVilles] = useState<string[]>([]);
  const [selectedSecteurs, setSelectedSecteurs] = useState<string[]>([]);
  const [orderMode, setOrderMode] = useState<OrderMode>('aleatoire');
  const [queue, setQueue] = useState<Prospect[]>([]);
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<'card' | 'result' | 'followup'>('card');
  const [copied, setCopied] = useState(false);
  const [relanceDateTime, setRelanceDateTime] = useState('');
  const [followupMode, setFollowupMode] = useState<'default' | 'visio'>('default');
  const [visioDateTime, setVisioDateTime] = useState('');
  const [noteText, setNoteText] = useState('');
  const [confettiId, setConfettiId] = useState(0);
  const [moneyId, setMoneyId] = useState(0);
  const [flashId, setFlashId] = useState(0);
  const [flashTone, setFlashTone] = useState<'success' | 'danger' | 'neutral'>('neutral');
  const [exitDirection, setExitDirection] = useState<'left' | 'right' | 'up' | null>(null);
  const [stats, setStats] = useState({ done: 0, answered: 0 });
  const reducedMotion = usePrefersReducedMotion();
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editForm, setEditForm] = useState<ProspectFormFields>(emptyProspectForm);
  const [savingInfo, setSavingInfo] = useState(false);

  // Finale : gros lâcher de confettis à l'arrivée sur l'écran de fin.
  useEffect(() => {
    if (phase === 'done') setConfettiId((n) => n + 1);
  }, [phase]);

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
    // Un prospect déjà en "Visio" a un RDV calé : il ne doit plus ressortir
    // en speed dial (sinon on rappelle des gens qui ont déjà un rendez-vous).
    return prospects.filter((p) => p.statut_gagne_perdu === 'actif' && p.statut_avancement !== 'Visio' && set.has(p.zone_geographique));
  }, [prospects, commercialCities]);

  const villes = useMemo(() => Array.from(new Set(basePool.map((p) => p.zone_geographique).filter(Boolean))).sort(), [basePool]);
  const secteurs = useMemo(() => Array.from(new Set(basePool.map((p) => p.categorie_metier).filter(Boolean))).sort(), [basePool]);

  // Sélection multiple : villes ET/OU secteurs combinables (vide = tous).
  // Permet d'élargir un run ("plusieurs villes") tout en restant ciblé
  // (croisé avec un ou plusieurs secteurs si besoin).
  const poolPreview = useMemo(() => {
    let pool = basePool;
    if (selectedVilles.length > 0) pool = pool.filter((p) => selectedVilles.includes(p.zone_geographique));
    if (selectedSecteurs.length > 0) pool = pool.filter((p) => selectedSecteurs.includes(p.categorie_metier));
    return pool;
  }, [basePool, selectedVilles, selectedSecteurs]);

  const current = queue[index] || null;

  // Modifier la fiche sans quitter le Speed Run : corrige un numéro/nom faux
  // repéré pendant l'appel, sans casser le fil de la session en cours.
  const handleOpenEdit = useCallback(() => {
    if (!current) return;
    setEditForm({
      nom_societe: current.nom_societe || '',
      nom_dirigeant: current.nom_dirigeant || '',
      telephone: current.telephone || '',
      email: current.email || '',
      zone_geographique: current.zone_geographique || '',
      categorie_metier: current.categorie_metier || '',
    });
    setShowEditDialog(true);
  }, [current]);

  const handleSaveInfo = useCallback(async () => {
    if (!current || savingInfo) return;
    if (!editForm.nom_societe.trim()) { toast.error('Le nom de la société est requis'); return; }
    setSavingInfo(true);
    try {
      await client.entities.prospects.update({ id: String(current.id), data: editForm });
      // La file du run est une copie locale (pas branchée sur le cache React
      // Query) : on met à jour la carte affichée tout de suite, en plus
      // d'invalider le cache pour le reste de l'app.
      setQueue((q) => q.map((p) => (p.id === current.id ? { ...p, ...editForm } : p)));
      invalidateProspects();
      toast.success('Fiche mise à jour');
      setShowEditDialog(false);
    } catch { toast.error('Erreur lors de la mise à jour'); }
    finally { setSavingInfo(false); }
  }, [current, editForm, savingInfo, invalidateProspects]);

  const startRun = () => {
    const q = orderMode === 'aleatoire'
      ? shuffle(poolPreview)
      : [...poolPreview].sort((a, b) => (a.nombre_appels || 0) - (b.nombre_appels || 0));
    if (q.length === 0) { toast.error('Aucun prospect pour ce choix'); return; }
    setQueue(q); setIndex(0); setStep('card'); setCopied(false); setRelanceDateTime('');
    setFollowupMode('default'); setVisioDateTime(''); setNoteText('');
    setStats({ done: 0, answered: 0 }); setPhase('run');
  };

  // direction/tone pilotent la sortie de la carte (swipe + flash coloré) avant
  // d'enchaîner sur l'entreprise suivante. Sans direction (ou en mode "mouvement
  // réduit"), on avance immédiatement.
  const next = useCallback((direction?: 'left' | 'right' | 'up', tone?: 'success' | 'danger' | 'neutral') => {
    const advance = () => {
      setStep('card'); setCopied(false); setRelanceDateTime('');
      setFollowupMode('default'); setVisioDateTime(''); setNoteText('');
      setExitDirection(null);
      setIndex((i) => {
        if (i + 1 >= queue.length) { setPhase('done'); return i; }
        return i + 1;
      });
    };
    if (direction && !reducedMotion) {
      setExitDirection(direction);
      setFlashTone(tone || 'neutral');
      setFlashId((n) => n + 1);
      setTimeout(advance, 260);
    } else {
      if (tone) { setFlashTone(tone); setFlashId((n) => n + 1); }
      advance();
    }
  }, [queue.length, reducedMotion]);

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
    invalidateProspects(); invalidateActions(p.id); next('left', 'danger');
  }, [current, next, invalidateProspects, invalidateActions]);

  const answered = useCallback(async () => {
    const p = current; if (!p) return;
    try {
      // Un appel répondu consomme la relance datée : elle disparaît de la colonne "Relance date".
      await client.entities.prospects.update({ id: String(p.id), data: { nombre_appels: (p.nombre_appels || 0) + 1, nombre_appels_repondus: (p.nombre_appels_repondus || 0) + 1, date_dernier_appel: new Date().toISOString(), date_relance_planifiee: null } });
      await client.entities.commercial_actions.create({ data: { prospect_id: p.id, action_type: 'appel', appel_repondu: true, from_status: p.statut_avancement, to_status: p.statut_avancement, notes: 'Appel répondu (speed run)', action_date: new Date().toISOString() } });
    } catch { /* ignore */ }
    setStats((s) => ({ ...s, answered: s.answered + 1 }));
    setConfettiId((n) => n + 1);
    invalidateProspects(); invalidateActions(p.id); setStep('followup'); setFollowupMode('default');
  }, [current, invalidateProspects, invalidateActions]);

  // Visio : demande la date & heure du rendez-vous plutôt que de figer l'instant présent.
  const doVisio = useCallback(async (dateTimeLocal?: string) => {
    const p = current; if (!p) return;
    const iso = dateTimeLocal ? new Date(dateTimeLocal).toISOString() : new Date().toISOString();
    try {
      await client.entities.prospects.update({ id: String(p.id), data: { statut_avancement: 'Visio', date_visio: iso, date_relance_planifiee: null } });
      await client.entities.commercial_actions.create({ data: { prospect_id: p.id, action_type: 'visio', appel_repondu: false, from_status: p.statut_avancement, to_status: 'Visio', notes: noteText || `Visio planifiée ${new Date(iso).toLocaleString('fr-FR')} (speed run)`, action_date: new Date().toISOString() } });
    } catch { /* ignore */ }
    setStats((s) => ({ ...s, done: s.done + 1 }));
    setMoneyId((n) => n + 1);
    invalidateProspects(); invalidateActions(p.id); next('right', 'success');
  }, [current, noteText, next, invalidateProspects, invalidateActions]);

  const doRelanceDate = useCallback(async () => {
    const p = current; if (!p || !relanceDateTime) return;
    const iso = new Date(relanceDateTime).toISOString();
    try {
      await client.entities.prospects.update({ id: String(p.id), data: { date_relance_planifiee: iso } });
      await client.entities.commercial_actions.create({ data: { prospect_id: p.id, action_type: 'relance_planifiee', appel_repondu: false, from_status: p.statut_avancement, to_status: p.statut_avancement, notes: noteText || `Relance planifiée ${new Date(iso).toLocaleString('fr-FR')} (speed run)`, action_date: new Date().toISOString() } });
    } catch { /* ignore */ }
    setStats((s) => ({ ...s, done: s.done + 1 }));
    invalidateProspects(); invalidateActions(p.id); next('right', 'success');
  }, [current, relanceDateTime, noteText, next, invalidateProspects, invalidateActions]);

  const doRefus = useCallback(async () => {
    const p = current; if (!p) return;
    try {
      await client.entities.prospects.update({ id: String(p.id), data: { statut_avancement: 'Refus / Perdu', statut_gagne_perdu: 'perdu' } });
      await client.entities.commercial_actions.create({ data: { prospect_id: p.id, action_type: 'status_change', appel_repondu: false, from_status: p.statut_avancement, to_status: 'Refus / Perdu', notes: noteText || 'Refus (speed run)', action_date: new Date().toISOString() } });
    } catch { /* ignore */ }
    setStats((s) => ({ ...s, done: s.done + 1 }));
    invalidateProspects(); invalidateActions(p.id); next('left', 'danger');
  }, [current, noteText, next, invalidateProspects, invalidateActions]);

  const progress = queue.length ? ((index) / queue.length) * 100 : 0;

  // ---- Mode réduit : pastille flottante, laisse le reste de l'app cliquable
  // (navigation possible vers Prospects/Pipeline/etc.) sans perdre la session.
  if (minimized) {
    return (
      <>
        <style>{STYLES}</style>
        <ConfettiBurst id={confettiId} />
        <MoneyFireworks id={moneyId} />
        <button
          onClick={onMaximize}
          className="sr-pop fixed bottom-5 right-5 z-[120] flex items-center gap-3 pl-3 pr-4 py-2.5 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.35)] text-white hover:scale-[1.03] active:scale-95 transition-transform"
          style={{ backgroundImage: 'linear-gradient(90deg,#fbbf24,#f97316,#ec4899)' }}
        >
          <span className="sr-float w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4" fill="white" />
          </span>
          <span className="text-left leading-tight">
            <span className="block text-[10px] font-bold uppercase tracking-wider opacity-80">Speed Run en cours</span>
            <span className="block text-sm font-black truncate max-w-[180px]">
              {phase === 'run' && current ? `${index + 1}/${queue.length} · ${current.nom_societe}` : phase === 'done' ? 'Terminé — voir résultats' : 'Reprendre'}
            </span>
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onClose(); } }}
            className="w-7 h-7 rounded-full bg-black/20 hover:bg-black/35 flex items-center justify-center shrink-0"
            aria-label="Quitter le Speed Run"
          >
            <X className="w-3.5 h-3.5" />
          </span>
        </button>
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0b1220]/95 backdrop-blur-md">
      <style>{STYLES}</style>
      <ConfettiBurst id={confettiId} />
      <MoneyFireworks id={moneyId} />
      <FlashPulse id={flashId} tone={flashTone} />

      {/* halos décoratifs */}
      <div className="pointer-events-none absolute -top-24 -left-24 w-96 h-96 rounded-full bg-orange-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-pink-500/20 blur-3xl" />

      <div className="absolute top-5 right-5 flex items-center gap-2 z-10">
        {onMinimize && phase === 'run' && (
          <button
            onClick={onMinimize}
            title="Réduire — continuer à naviguer sans perdre la session"
            className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
            aria-label="Réduire"
          >
            <Minus className="w-6 h-6" />
          </button>
        )}
        <button onClick={onClose} className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors" aria-label="Quitter">
          <X className="w-6 h-6" />
        </button>
      </div>

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

          <div className="flex-1 space-y-4 bg-white/[0.06] border border-white/10 rounded-3xl p-6 backdrop-blur">
            <div>
              <label className="text-[11px] font-bold text-slate-300 uppercase tracking-widest flex items-center gap-1.5 mb-2"><User className="w-3.5 h-3.5" /> Ton nom</label>
              <Select value={commercial} onValueChange={(v) => { setCommercial(v); setSelectedVilles([]); setSelectedSecteurs([]); }}>
                <SelectTrigger className="rounded-xl bg-white/10 border-white/10 text-white h-11"><SelectValue placeholder="Sélectionne ton nom" /></SelectTrigger>
                <SelectContent>{commercialNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {commercial ? (
              <div className="sr-slide space-y-4">
                {/* Sélection multiple : combine plusieurs villes et/ou plusieurs
                    secteurs — élargit le run tout en restant ciblé. Vide = tout. */}
                <div>
                  <p className="text-[11px] font-bold text-slate-300 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" /> Villes <span className="text-slate-500 normal-case font-medium">(vide = toutes)</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5 max-h-[92px] overflow-y-auto p-2 rounded-xl bg-white/5 border border-white/10">
                    {villes.length === 0 ? (
                      <span className="text-xs text-slate-500 px-1 py-1">Aucune ville attribuée</span>
                    ) : villes.map((v) => {
                      const active = selectedVilles.includes(v);
                      return (
                        <button key={v} type="button"
                          onClick={() => setSelectedVilles((prev) => active ? prev.filter((x) => x !== v) : [...prev, v])}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${active ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
                          {v}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-bold text-slate-300 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5" /> Secteurs <span className="text-slate-500 normal-case font-medium">(vide = tous)</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5 max-h-[92px] overflow-y-auto p-2 rounded-xl bg-white/5 border border-white/10">
                    {secteurs.length === 0 ? (
                      <span className="text-xs text-slate-500 px-1 py-1">Aucun secteur disponible</span>
                    ) : secteurs.map((s) => {
                      const active = selectedSecteurs.includes(s);
                      return (
                        <button key={s} type="button"
                          onClick={() => setSelectedSecteurs((prev) => active ? prev.filter((x) => x !== s) : [...prev, s])}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${active ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-bold text-slate-300 uppercase tracking-widest mb-2">Ordre</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([['aleatoire', 'Aléatoire', Shuffle], ['moins_appeles', 'Moins appelés', Flame]] as const).map(([m, label, Icon]) => (
                      <button key={m} onClick={() => setOrderMode(m)}
                        className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-xs font-bold transition-all duration-200 ${orderMode === m ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white border-transparent shadow-lg scale-105' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10 hover:scale-[1.02]'}`}>
                        <Icon className="w-4 h-4" /> {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-center gap-2 text-sm">
                  <Flame className="w-4 h-4 text-orange-400" />
                  <span className="text-white font-bold">{poolPreview.length}</span>
                  <span className="text-slate-400">entreprise{poolPreview.length > 1 ? 's' : ''} à appeler</span>
                </div>

                <Button onClick={startRun} disabled={poolPreview.length === 0}
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

          {/* carte à dimensions FIXES — sort en swipe coloré selon l'issue, puis la
              suivante entre avec sr-pop (remount via key). */}
          <div
            key={current.id}
            className={`relative mt-3 h-[500px] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden ${
              exitDirection === 'left' ? 'sr-exit-left' : exitDirection === 'right' ? 'sr-exit-right' : exitDirection === 'up' ? 'sr-exit-up' : 'sr-pop'
            }`}
          >
            <div className="h-1.5 shrink-0 sr-shine" style={{ backgroundImage: 'linear-gradient(90deg,#fbbf24,#f97316,#ec4899,#f97316,#fbbf24)' }} />

            {/* Modifier la fiche sans quitter le run — corrige un nom/numéro faux
                repéré pendant l'appel. Positionné en absolu : n'ajoute pas de
                hauteur à la carte (dimensions fixes). */}
            <button
              onClick={handleOpenEdit}
              title="Modifier la fiche"
              className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 flex items-center justify-center transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>

            {/* identité — hauteur réservée, texte tronqué */}
            <div className="px-7 pt-5 text-center shrink-0">
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#5A9BA3] truncate">
                {current.categorie_metier || 'Prospect'} · {current.zone_geographique}
              </p>
              <h2 className="mt-1.5 h-[62px] flex items-center justify-center text-[26px] leading-[1.15] font-black text-slate-900 overflow-hidden">
                <span className="line-clamp-2">{current.nom_societe}</span>
              </h2>
              {/* Dirigeant + statut juridique/effectif sur la même ligne à
                  hauteur fixe (extraits du champ notes, import Monday — pas
                  de colonne dédiée) : n'ajoute pas de hauteur à la carte. */}
              <p className="h-[22px] text-sm text-slate-500 truncate">
                {current.nom_dirigeant || '—'}
                {(() => {
                  const extra = [extractFromNotes(current.notes, 'Forme'), extractFromNotes(current.notes, 'Effectif')].filter(Boolean).join(' · ');
                  return extra ? <span className="text-slate-400"> · {extra}</span> : null;
                })()}
              </p>
            </div>

            {/* téléphone + copier — hauteur fixe */}
            <div className="px-7 mt-3 shrink-0">
              <div className="h-[68px] flex items-center justify-center gap-3 bg-slate-50 rounded-2xl px-4">
                <span className="text-[26px] font-black text-slate-900 tabular-nums tracking-tight truncate">
                  {current.telephone
                    ? current.telephone.split('').map((ch, i) => (
                        <span key={i} className="sr-digit" style={{ animationDelay: `${Math.min(i, 14) * 0.025}s` }}>{ch}</span>
                      ))
                    : 'Aucun numéro'}
                </span>
                <button onClick={copyPhone} disabled={!current.telephone}
                  className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-all active:scale-90 ${copied ? 'bg-emerald-500 text-white' : 'bg-[#5A9BA3] text-white hover:bg-[#4A8B93] sr-ring'}`}
                  title="Copier le numéro">
                  {copied ? <Check className="w-6 h-6" /> : <Copy className="w-6 h-6" />}
                </button>
              </div>
            </div>

            {/* zone d'action — hauteur FIXE : le contenu change, la carte ne bouge pas */}
            <div className="px-7 pb-5 pt-4 h-[256px] shrink-0">
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
                <div className="sr-slide h-full flex flex-col gap-2.5">
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Note sur l'appel (optionnel)..."
                    rows={2}
                    className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#6AABB4]"
                  />
                  {followupMode === 'default' ? (
                    <>
                      <div className="grid grid-cols-2 gap-2.5">
                        <Button onClick={() => { setVisioDateTime(toLocalInputValue(new Date())); setFollowupMode('visio'); }} className="h-11 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white gap-2 font-bold hover:scale-[1.03] transition-transform"><Video className="w-4 h-4" /> Visio</Button>
                        <Button onClick={doRefus} variant="outline" className="h-11 rounded-xl border-2 border-red-200 text-red-600 hover:bg-red-50 gap-2 font-bold hover:scale-[1.03] transition-transform"><XCircle className="w-4 h-4" /> Refus</Button>
                      </div>
                      <div className="flex gap-2">
                        <input type="datetime-local" value={relanceDateTime} onChange={(e) => setRelanceDateTime(e.target.value)}
                          className="flex-1 min-w-0 h-11 rounded-xl border-2 border-slate-200 px-3 text-sm focus:outline-none focus:border-[#6AABB4]" />
                        <Button onClick={doRelanceDate} disabled={!relanceDateTime} className="h-11 shrink-0 gap-1.5 bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] text-white rounded-xl font-bold"><CalendarClock className="w-4 h-4" /> Relance</Button>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-2xl border-2 border-purple-100 bg-purple-50/40 p-3 flex-1 flex flex-col justify-center gap-2.5">
                      <p className="text-xs font-semibold text-purple-600 flex items-center gap-1.5"><Video className="w-3.5 h-3.5" /> Date &amp; heure de la visio</p>
                      <input type="datetime-local" value={visioDateTime} onChange={(e) => setVisioDateTime(e.target.value)}
                        className="w-full h-10 rounded-xl border-2 border-purple-200 px-2.5 text-sm focus:outline-none focus:border-purple-400 bg-white" />
                      <div className="flex gap-2">
                        <Button onClick={() => setFollowupMode('default')} variant="ghost" className="h-10 rounded-xl flex-1">← Retour</Button>
                        <Button onClick={() => doVisio(visioDateTime)} disabled={!visioDateTime} className="h-10 flex-[1.4] gap-1.5 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white rounded-xl font-bold"><Video className="w-4 h-4" /> Confirmer</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <button onClick={() => next('up', 'neutral')} className="mt-3 mx-auto block text-sm text-white/50 hover:text-white transition-colors">Passer cette entreprise →</button>
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

      {/* Modifier la fiche — accessible depuis la carte en plein run, sans
          quitter le Speed Run. Champs essentiels seulement (édition complète
          disponible sur la fiche prospect). */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader><DialogTitle>Modifier la fiche</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Société *</Label><Input value={editForm.nom_societe} onChange={(e) => setEditForm({ ...editForm, nom_societe: e.target.value })} className="rounded-xl" /></div>
              <div><Label>Dirigeant</Label><Input value={editForm.nom_dirigeant} onChange={(e) => setEditForm({ ...editForm, nom_dirigeant: e.target.value })} className="rounded-xl" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Téléphone</Label><Input value={editForm.telephone} onChange={(e) => setEditForm({ ...editForm, telephone: e.target.value })} className="rounded-xl" /></div>
              <div><Label>Email</Label><Input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="rounded-xl" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Zone géographique</Label><Input value={editForm.zone_geographique} onChange={(e) => setEditForm({ ...editForm, zone_geographique: e.target.value })} className="rounded-xl" /></div>
              <div><Label>Catégorie métier</Label><Input value={editForm.categorie_metier} onChange={(e) => setEditForm({ ...editForm, categorie_metier: e.target.value })} className="rounded-xl" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)} disabled={savingInfo} className="rounded-xl">Annuler</Button>
            <Button onClick={handleSaveInfo} disabled={savingInfo} className="bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] hover:from-[#4A8B93] hover:to-[#5A9BA4] text-white rounded-xl">{savingInfo ? 'Enregistrement...' : 'Enregistrer'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
