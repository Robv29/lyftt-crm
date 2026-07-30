import { useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  Crown,
  Gem,
  History,
  LockKeyhole,
  Medal,
  Shield,
  Sparkles,
  Star,
  Swords,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  useSetMyAvatar,
  useTrophyProfiles,
  type CommercialTrophy,
  type TrophyCollection,
  type TrophyRarity,
} from '../hooks/use-prospects';
import ErrorState from '../components/ErrorState';
import LoadingSpinner from '../components/LoadingSpinner';
import { usePersistentState } from '../hooks/use-persistent-state';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

const CHAMPION_SPRITE = '/assets/lyftt-champions-v1.jpg';

const AVATARS = [
  {
    key: 'summit',
    name: 'Gardien du Sommet',
    role: 'Sentinelle polaire',
    position: '0% 0%',
    accent: '#67e8f9',
    glow: 'rgba(34,211,238,.32)',
  },
  {
    key: 'navigator',
    name: 'Navigateur Céleste',
    role: 'Maître des trajectoires',
    position: '50% 0%',
    accent: '#60a5fa',
    glow: 'rgba(59,130,246,.32)',
  },
  {
    key: 'closer',
    name: 'Arcaniste du Closing',
    role: 'Architecte des victoires',
    position: '100% 0%',
    accent: '#c084fc',
    glow: 'rgba(168,85,247,.36)',
  },
  {
    key: 'vanguard',
    name: 'Avant-garde',
    role: 'Conquérant des objectifs',
    position: '0% 100%',
    accent: '#fbbf24',
    glow: 'rgba(245,158,11,.34)',
  },
  {
    key: 'strategist',
    name: 'Grand Stratège',
    role: 'Visionnaire de la saison',
    position: '50% 100%',
    accent: '#34d399',
    glow: 'rgba(16,185,129,.3)',
  },
  {
    key: 'ace',
    name: 'As Écarlate',
    role: 'Duelliste commercial',
    position: '100% 100%',
    accent: '#fb7185',
    glow: 'rgba(244,63,94,.34)',
  },
] as const;

type Avatar = (typeof AVATARS)[number];

const COLLECTIONS: Array<{
  key: TrophyCollection;
  label: string;
  subtitle: string;
  eyebrow: string;
}> = [
  {
    key: 'closing',
    label: 'Closing',
    subtitle: 'La maîtrise de la signature',
    eyebrow: 'Acte I · Conquête',
  },
  {
    key: 'revenue',
    label: "Chiffre d'affaires",
    subtitle: 'La montée en puissance',
    eyebrow: 'Acte II · Prospérité',
  },
  {
    key: 'regularity',
    label: 'Régularité',
    subtitle: "L'excellence sur une année civile",
    eyebrow: 'Acte III · Discipline',
  },
  {
    key: 'special',
    label: 'Trophées spéciaux',
    subtitle: 'Les distinctions les plus rares',
    eyebrow: 'Acte IV · Légende',
  },
];

const RARITY: Record<
  TrophyRarity,
  { label: string; color: string; soft: string; glow: string; border: string }
> = {
  bronze: {
    label: 'Bronze',
    color: '#d97745',
    soft: 'rgba(217,119,69,.18)',
    glow: 'rgba(217,119,69,.3)',
    border: 'rgba(251,146,60,.28)',
  },
  silver: {
    label: 'Argent',
    color: '#d8e3ed',
    soft: 'rgba(216,227,237,.14)',
    glow: 'rgba(203,213,225,.26)',
    border: 'rgba(203,213,225,.26)',
  },
  gold: {
    label: 'Or',
    color: '#f6c760',
    soft: 'rgba(246,199,96,.18)',
    glow: 'rgba(245,158,11,.34)',
    border: 'rgba(246,199,96,.34)',
  },
  epic: {
    label: 'Épique',
    color: '#bd8cff',
    soft: 'rgba(189,140,255,.17)',
    glow: 'rgba(168,85,247,.38)',
    border: 'rgba(192,132,252,.34)',
  },
  legendary: {
    label: 'Légendaire',
    color: '#ff9c4b',
    soft: 'rgba(255,156,75,.18)',
    glow: 'rgba(249,115,22,.42)',
    border: 'rgba(251,146,60,.38)',
  },
  mythic: {
    label: 'Mythique',
    color: '#70e1ff',
    soft: 'rgba(112,225,255,.17)',
    glow: 'rgba(34,211,238,.42)',
    border: 'rgba(103,232,249,.4)',
  },
};

const formatNumber = (value: number) =>
  new Intl.NumberFormat('fr-FR').format(Math.round(value));
const formatEuro = (value: number) => `${formatNumber(value)} €`;

function progressLabel(trophy: CommercialTrophy) {
  const current = Math.min(trophy.progress, trophy.threshold);
  if (trophy.code.startsWith('revenue_') || trophy.code === 'special_recordman') {
    return `${formatEuro(current)} / ${formatEuro(trophy.threshold)}`;
  }
  if (trophy.code.startsWith('regularity_')) {
    return `${formatNumber(current)} / ${formatNumber(trophy.threshold)} mois`;
  }
  if (trophy.code.startsWith('closing_')) {
    return `${formatNumber(current)} / ${formatNumber(trophy.threshold)} contrats`;
  }
  return trophy.unlocked ? 'Débloqué' : 'Pas encore débloqué';
}

function ChampionArt({
  avatar,
  className = '',
  overlay = true,
}: {
  avatar: Avatar;
  className?: string;
  overlay?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden bg-[#07101d] ${className}`}
      style={{
        backgroundImage: `url(${CHAMPION_SPRITE})`,
        backgroundPosition: avatar.position,
        backgroundSize: '300% 200%',
        boxShadow: `0 0 55px ${avatar.glow}`,
      }}
    >
      {overlay && (
        <>
          <div className="absolute inset-0 bg-gradient-to-t from-[#030711] via-transparent to-black/10" />
          <div
            className="absolute inset-x-0 bottom-0 h-1/3"
            style={{
              background: `linear-gradient(to top, ${avatar.glow}, transparent)`,
            }}
          />
        </>
      )}
    </div>
  );
}

function ArenaBackdrop({ avatar }: { avatar: Avatar }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <ChampionArt
        avatar={avatar}
        className="absolute -right-[38%] -top-[18%] h-[118%] w-[125%] opacity-[0.13] blur-[1px] [mask-image:linear-gradient(to_left,black,transparent)] sm:-right-[18%] sm:-top-[30%] sm:h-[135%] sm:w-[92%] sm:opacity-[0.15] 2xl:-right-[4%] 2xl:-top-[42%] 2xl:h-[150%] 2xl:w-[72%] 2xl:opacity-[0.17]"
        overlay={false}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(214,179,91,.16),transparent_30%),radial-gradient(circle_at_80%_30%,rgba(20,91,111,.22),transparent_31%),linear-gradient(115deg,#02050c_0%,#07101e_49%,#02050c_100%)]" />
      <svg
        viewBox="0 0 1600 520"
        preserveAspectRatio="none"
        className="absolute -right-1/2 bottom-0 h-[62%] w-[180%] opacity-45 sm:-right-1/4 sm:h-[72%] sm:w-[140%] sm:opacity-55 2xl:inset-x-0 2xl:h-[82%] 2xl:w-full 2xl:opacity-60"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="citadel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#17324a" stopOpacity=".62" />
            <stop offset="1" stopColor="#02050c" stopOpacity=".98" />
          </linearGradient>
          <linearGradient id="summit-light" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#49b9c5" stopOpacity="0" />
            <stop offset=".55" stopColor="#6AABB4" stopOpacity=".4" />
            <stop offset="1" stopColor="#e8c77d" stopOpacity=".76" />
          </linearGradient>
          <filter id="path-blur">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        <path
          d="M0 520V420L110 355l75 45 130-116 89 93 164-170 105 145 118-211 111 173 125-120 91 131 165-88 217 183v95Z"
          fill="url(#citadel)"
        />
        <path
          d="M640 520c80-75 79-144 170-178 88-32 42-103 123-120 94-19 74-101 147-139"
          fill="none"
          stroke="url(#summit-light)"
          strokeWidth="7"
          strokeLinecap="round"
          filter="url(#path-blur)"
        />
        <path
          d="M640 520c80-75 79-144 170-178 88-32 42-103 123-120 94-19 74-101 147-139"
          fill="none"
          stroke="url(#summit-light)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path d="M1082 83V29" stroke="#e8c77d" strokeWidth="2" />
        <path d="m1084 31 58 20-58 20Z" fill="#b99046" />
      </svg>
      <div className="profile-stars absolute inset-0 opacity-55" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#02050c] via-transparent to-[#02050c]/55" />
      <div className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-[#02050c] to-transparent" />
    </div>
  );
}

function OrnamentalRule({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#b99046]/60 to-[#b99046]" />
      <span className="h-2.5 w-2.5 rotate-45 border border-[#d6b35b] bg-[#08101a] shadow-[0_0_14px_rgba(214,179,91,.45)]" />
      {label && (
        <span className="font-display text-[9px] font-bold uppercase tracking-[0.32em] text-[#d6b35b]/70">
          {label}
        </span>
      )}
      <span className="h-2.5 w-2.5 rotate-45 border border-[#d6b35b] bg-[#08101a] shadow-[0_0_14px_rgba(214,179,91,.45)]" />
      <div className="h-px flex-1 bg-gradient-to-l from-transparent via-[#b99046]/60 to-[#b99046]" />
    </div>
  );
}

function ChampionFrame({
  avatar,
  canChange,
  onOpen,
}: {
  avatar: Avatar;
  canChange: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="relative mx-auto w-full max-w-[220px] pb-7 sm:max-w-[272px] sm:pb-8">
      <div
        className="profile-champion-float absolute -inset-7 rounded-full opacity-60 blur-3xl"
        style={{ background: avatar.glow }}
      />
      <div className="absolute left-1/2 top-[-18px] z-20 h-16 w-16 -translate-x-1/2 rotate-45 border border-[#f1d488]/70 bg-gradient-to-br from-[#20324a] via-[#07101e] to-[#2c1e0b] shadow-[0_0_28px_rgba(214,179,91,.38)]">
        <Crown className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 -rotate-45 text-[#f1d488]" />
      </div>
      <button
        type="button"
        onClick={onOpen}
        disabled={!canChange}
        aria-label={canChange ? 'Changer de personnage' : avatar.name}
        className="group relative block w-full disabled:cursor-default"
      >
        <div className="relative border border-[#b99046]/65 bg-[#030711] p-[6px] shadow-[0_28px_70px_rgba(0,0,0,.65)] [clip-path:polygon(12%_0,88%_0,100%_10%,100%_86%,84%_100%,16%_100%,0_86%,0_10%)]">
          <div className="border border-[#f1d488]/30 bg-[#06101c] p-1 [clip-path:polygon(10%_0,90%_0,100%_9%,100%_87%,83%_100%,17%_100%,0_87%,0_9%)]">
            <ChampionArt
              avatar={avatar}
              className="aspect-[4/5] w-full transition duration-700 group-hover:scale-[1.035]"
            />
          </div>
          <span className="absolute left-3 top-3 h-10 w-10 border-l border-t border-[#f1d488]/70" />
          <span className="absolute right-3 top-3 h-10 w-10 border-r border-t border-[#f1d488]/70" />
          <span className="absolute bottom-3 left-3 h-10 w-10 border-b border-l border-[#f1d488]/70" />
          <span className="absolute bottom-3 right-3 h-10 w-10 border-b border-r border-[#f1d488]/70" />
          {canChange && (
            <span className="absolute inset-x-6 bottom-5 flex items-center justify-center gap-2 border border-[#d6b35b]/35 bg-[#02050c]/85 px-3 py-2 font-display text-[9px] font-bold uppercase tracking-[0.2em] text-[#f1d488] backdrop-blur-md transition group-hover:border-[#f1d488]/70 group-hover:bg-[#10182a]/95">
              <Sparkles className="h-3.5 w-3.5" />
              Choisir un héros
            </span>
          )}
        </div>
      </button>
      <div className="absolute inset-x-8 bottom-0 h-8 border-x border-b border-[#b99046]/35 [clip-path:polygon(0_0,100%_0,82%_100%,18%_100%)]" />
    </div>
  );
}

function AvatarSelector({
  activeKey,
  onSelect,
  onClose,
}: {
  activeKey: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-[#01040a]/80 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Sélection du héros"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        aria-label="Fermer la sélection"
      />
      <div className="profile-reveal relative max-h-[92dvh] w-full overflow-y-auto border-x border-t border-[#b99046]/50 bg-[#040914]/[0.98] p-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_30px_90px_rgba(0,0,0,.8)] sm:max-w-[620px] sm:border sm:p-5">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center border border-[#b99046]/35 bg-[#07101d] text-[#f1d488] transition hover:border-[#f1d488]"
          aria-label="Fermer"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="pr-12">
          <OrnamentalRule label="Sélection du héros" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {AVATARS.map((avatar) => {
            const active = activeKey === avatar.key;
            return (
              <button
                key={avatar.key}
                type="button"
                onClick={() => onSelect(avatar.key)}
                className={`group relative overflow-hidden border p-1 text-left transition duration-300 ${
                  active
                    ? 'border-[#f1d488] bg-[#d6b35b]/10'
                    : 'border-white/10 bg-white/[0.025] hover:border-[#d6b35b]/55'
                }`}
              >
                <ChampionArt
                  avatar={avatar}
                  className="aspect-square w-full transition duration-500 group-hover:scale-105"
                />
                <div className="relative min-h-[58px] px-2 pb-2 pt-2">
                  <p className="font-display text-[9px] font-bold uppercase leading-4 tracking-[0.06em] text-[#f4e6bc]">
                    {avatar.name}
                  </p>
                  <p className="mt-1 text-[9px] leading-4 text-white/38">{avatar.role}</p>
                </div>
                {active && (
                  <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center border border-[#f1d488]/70 bg-[#050913]/90 text-[#f1d488]">
                    <Check className="h-4 w-4" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Cup({ trophy }: { trophy: CommercialTrophy }) {
  const rarity = RARITY[trophy.rarity];
  return (
    <div className="relative flex h-24 w-24 shrink-0 items-center justify-center sm:h-32 sm:w-32">
      <div
        className={`absolute inset-2 rotate-45 border transition duration-500 group-hover:rotate-[50deg] ${
          trophy.unlocked ? '' : 'border-slate-700/40 bg-slate-900/35'
        }`}
        style={
          trophy.unlocked
            ? {
                borderColor: rarity.border,
                background: `radial-gradient(circle, ${rarity.soft}, rgba(3,7,17,.4) 70%)`,
                boxShadow: `0 0 42px ${rarity.glow}`,
              }
            : undefined
        }
      />
      <div
        className={`absolute inset-5 -rotate-45 border ${
          trophy.unlocked ? '' : 'border-slate-700/35'
        }`}
        style={trophy.unlocked ? { borderColor: rarity.border } : undefined}
      />
      {trophy.unlocked && (
        <>
          <span
            className="profile-rarity-pulse absolute inset-8 rounded-full blur-2xl"
            style={{ background: rarity.glow }}
          />
          <Star
            className="absolute -top-1 h-4 w-4"
            style={{ color: rarity.color, fill: rarity.color }}
          />
        </>
      )}
      <Trophy
        strokeWidth={1.25}
        className={`relative h-14 w-14 transition duration-500 group-hover:scale-110 sm:h-[76px] sm:w-[76px] ${
          trophy.unlocked ? '' : 'text-slate-700 grayscale'
        }`}
        style={
          trophy.unlocked
            ? {
                color: rarity.color,
                filter: `drop-shadow(0 0 14px ${rarity.glow})`,
              }
            : undefined
        }
      />
      {!trophy.unlocked && (
        <span className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rotate-45 border border-slate-600/35 bg-[#070c16] sm:h-9 sm:w-9">
          <LockKeyhole className="h-3.5 w-3.5 -rotate-45 text-slate-600 sm:h-4 sm:w-4" />
        </span>
      )}
      {trophy.dynamic && trophy.unlocked && (
        <span className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rotate-45 border border-cyan-300/45 bg-cyan-400/10 text-cyan-200 shadow-[0_0_20px_rgba(34,211,238,.35)] sm:h-9 sm:w-9">
          <Zap className="h-3.5 w-3.5 -rotate-45 sm:h-4 sm:w-4" />
        </span>
      )}
    </div>
  );
}

function TrophyCard({ trophy, index }: { trophy: CommercialTrophy; index: number }) {
  const rarity = RARITY[trophy.rarity];
  const percent =
    trophy.threshold > 0 ? Math.min(100, (trophy.progress / trophy.threshold) * 100) : 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <article
          tabIndex={0}
          aria-label={`${trophy.name}. ${progressLabel(trophy)}`}
          className={`profile-trophy-card profile-reveal group relative min-h-[218px] overflow-hidden border p-[1px] transition duration-500 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d6b35b]/70 sm:min-h-[330px] sm:hover:-translate-y-2 ${
            trophy.unlocked
              ? 'border-[#b99046]/35'
              : 'border-white/[0.065] grayscale-[.45]'
          }`}
          style={{ animationDelay: `${Math.min(index, 6) * 65}ms` }}
        >
          <div
            className="absolute inset-0 opacity-80"
            style={{
              background: trophy.unlocked
                ? `radial-gradient(circle at 50% 28%, ${rarity.soft}, transparent 37%), linear-gradient(180deg,rgba(12,24,40,.96),rgba(3,7,16,.99))`
                : 'linear-gradient(180deg,rgba(13,20,31,.8),rgba(4,7,13,.97))',
            }}
          />
          <span className="absolute left-2 top-2 h-8 w-8 border-l border-t border-[#d6b35b]/35" />
          <span className="absolute right-2 top-2 h-8 w-8 border-r border-t border-[#d6b35b]/35" />
          <span className="absolute bottom-2 left-2 h-8 w-8 border-b border-l border-[#d6b35b]/25" />
          <span className="absolute bottom-2 right-2 h-8 w-8 border-b border-r border-[#d6b35b]/25" />

          <div className="relative grid h-full grid-cols-[96px_minmax(0,1fr)] items-center gap-3 px-3 py-4 text-left sm:flex sm:flex-col sm:px-5 sm:py-6 sm:text-center">
            <Cup trophy={trophy} />
            <div className="flex min-w-0 flex-col sm:w-full sm:flex-1 sm:items-center">
              <div className="flex max-w-full items-center gap-2">
                <span className="hidden h-px w-5 bg-[#d6b35b]/35 sm:block" />
                <span
                  className={`truncate font-display text-[8px] font-bold uppercase tracking-[0.16em] sm:text-[9px] sm:tracking-[0.2em] ${
                    trophy.unlocked ? '' : 'text-slate-600'
                  }`}
                  style={trophy.unlocked ? { color: rarity.color } : undefined}
                >
                  {rarity.label}
                  {trophy.dynamic ? ' · Vivant' : ''}
                </span>
                <span className="hidden h-px w-5 bg-[#d6b35b]/35 sm:block" />
              </div>
              <h3
                className={`mt-2 break-words font-display text-[13px] font-bold uppercase leading-5 tracking-[0.035em] sm:mt-3 sm:text-[15px] sm:tracking-[0.045em] ${
                  trophy.unlocked ? 'text-[#f5ebcf]' : 'text-slate-500'
                }`}
              >
                {trophy.name}
              </h3>
              <p
                className={`mt-1.5 line-clamp-2 text-[10px] leading-4 sm:mt-2 sm:text-[11px] sm:leading-5 ${
                  trophy.unlocked ? 'text-white/45' : 'text-slate-600'
                }`}
              >
                {trophy.description}
              </p>
              <div className="mt-4 w-full sm:mt-auto sm:pt-5">
                <div className="relative h-1 overflow-hidden bg-white/[0.055]">
                  <div
                    className="h-full transition-all duration-1000"
                    style={{
                      width: `${percent}%`,
                      background: trophy.unlocked
                        ? `linear-gradient(90deg,#5A9BA3,${rarity.color})`
                        : '#334155',
                      boxShadow: trophy.unlocked ? `0 0 14px ${rarity.glow}` : undefined,
                    }}
                  />
                </div>
                <div
                  className={`mt-2 text-[8px] font-bold uppercase leading-4 tracking-[0.08em] sm:mt-3 sm:text-[9px] sm:tracking-[0.12em] ${
                    trophy.unlocked ? 'text-white/45' : 'text-slate-600'
                  }`}
                >
                  {progressLabel(trophy)}
                </div>
              </div>
            </div>
          </div>
        </article>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-[310px] border-[#b99046]/45 bg-[#050a13] p-5 text-white shadow-[0_24px_70px_rgba(0,0,0,.7)]"
      >
        <p className="font-display text-xs font-bold uppercase tracking-[0.08em] text-[#f1d488]">
          {trophy.unlocked ? `${trophy.name} · Acquis` : `Quête · ${trophy.name}`}
        </p>
        <p className="mt-3 text-xs leading-5 text-white/60">{trophy.description}</p>
        <div className="mt-4 border-l border-[#d6b35b]/50 pl-3 text-xs font-semibold text-[#8cc9d0]">
          Progression : {progressLabel(trophy)}
        </div>
        {trophy.dynamic && (
          <p className="mt-3 text-[11px] leading-5 text-violet-300">
            Trophée unique : il change de détenteur lorsqu’un meilleur record est établi.
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function CollectionIcon({ collection }: { collection: TrophyCollection }) {
  const className = 'h-5 w-5';
  if (collection === 'closing') return <Swords className={className} />;
  if (collection === 'revenue') return <Gem className={className} />;
  if (collection === 'regularity') return <Shield className={className} />;
  return <Crown className={className} />;
}

export default function Profile() {
  const { userRole, isAdmin } = useAuth();
  const { data, isLoading, error } = useTrophyProfiles();
  const setAvatar = useSetMyAvatar();
  const [selectedProfileId, setSelectedProfileId] = usePersistentState<number | null>(
    'lyftt.profil.commercial',
    null,
  );
  const [activeTab, setActiveTab] = usePersistentState<'trophies' | 'record'>(
    'lyftt.profil.onglet',
    'trophies',
  );
  const [avatarOpen, setAvatarOpen] = useState(false);

  const ownProfile = data?.profiles.find((profile) => profile.userRoleId === userRole?.id);
  const activeProfile =
    data?.profiles.find((profile) => profile.userRoleId === selectedProfileId) ??
    ownProfile ??
    data?.profiles[0];
  const selectedAvatar =
    AVATARS.find((avatar) => avatar.key === activeProfile?.avatarKey) ?? AVATARS[0];
  const unlocked = activeProfile?.trophies.filter((trophy) => trophy.unlocked).length ?? 0;
  const completion = activeProfile?.trophies.length
    ? Math.round((unlocked / activeProfile.trophies.length) * 100)
    : 0;

  const trophiesByCollection = useMemo(() => {
    const map = new Map<TrophyCollection, CommercialTrophy[]>();
    for (const collection of COLLECTIONS) map.set(collection.key, []);
    for (const trophy of activeProfile?.trophies ?? []) {
      map.get(trophy.collection)?.push(trophy);
    }
    return map;
  }, [activeProfile]);

  const changeAvatar = async (key: string) => {
    if (activeProfile?.userRoleId !== userRole?.id) return;
    try {
      await setAvatar.mutateAsync(key);
      setAvatarOpen(false);
      toast.success('Votre héros a rejoint le profil');
    } catch {
      toast.error("Impossible de modifier le personnage");
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-80 items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }
  if (error || !activeProfile) {
    return <ErrorState message="Impossible de charger les trophées du profil." />;
  }

  const fullName =
    `${activeProfile.firstName ?? ''} ${activeProfile.lastName ?? ''}`.trim() ||
    'Commercial LYFTT';
  const isOwnProfile = activeProfile.userRoleId === userRole?.id;
  const totalTrophies = activeProfile.trophies.length;
  const specialUnlocked =
    trophiesByCollection.get('special')?.filter((trophy) => trophy.unlocked).length ?? 0;

  return (
    <div className="-m-4 min-h-[calc(100vh-3.5rem)] overflow-x-hidden bg-[#02050c] p-4 text-white sm:-m-6 sm:p-6 lg:-m-8 lg:min-h-screen lg:p-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_82%_0%,rgba(20,91,111,.14),transparent_32%),radial-gradient(circle_at_14%_45%,rgba(185,144,70,.08),transparent_30%)]" />
      <div className="relative mx-auto max-w-[1660px] space-y-5 sm:space-y-7">
        <header className="profile-reveal flex flex-col gap-5 border-b border-[#b99046]/20 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-display text-[8px] font-bold uppercase tracking-[0.22em] text-[#d6b35b] sm:gap-3 sm:text-[10px] sm:tracking-[0.32em]">
              <span className="h-2 w-2 rotate-45 border border-[#f1d488] bg-[#b99046]/35" />
              Temple des accomplissements
            </div>
            <h1 className="mt-3 break-words font-display text-2xl font-bold uppercase leading-tight tracking-[0.045em] text-[#f4e6bc] sm:text-3xl sm:tracking-[0.06em] md:text-4xl">
              Profil du conquérant
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/42">
              Choisissez votre héros, bâtissez votre légende et gravez vos victoires dans
              l’histoire de LYFTT.
            </p>
          </div>
          {isAdmin && (
            <label className="flex w-full flex-col gap-2 lg:w-auto">
              <span className="font-display text-[9px] font-bold uppercase tracking-[0.22em] text-[#d6b35b]/70">
                Observer un commercial
              </span>
              <select
                value={activeProfile.userRoleId}
                onChange={(event) => {
                  setSelectedProfileId(Number(event.target.value));
                  setAvatarOpen(false);
                }}
                className="h-12 w-full min-w-0 border border-[#b99046]/35 bg-[#07101d] px-4 text-sm font-semibold text-[#f4e6bc] outline-none transition focus:border-[#f1d488] sm:min-w-[250px] lg:w-auto"
              >
                {data.profiles.map((profile) => (
                  <option
                    key={profile.userRoleId}
                    value={profile.userRoleId}
                    className="bg-[#07101d]"
                  >
                    {[profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
                      `Commercial ${profile.userRoleId}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>

        <section className="profile-reveal relative overflow-hidden border border-[#b99046]/35 shadow-[0_42px_120px_rgba(0,0,0,.48)] [clip-path:none] sm:[clip-path:polygon(2%_0,98%_0,100%_6%,100%_94%,98%_100%,2%_100%,0_94%,0_6%)]">
          <ArenaBackdrop avatar={selectedAvatar} />
          <span className="pointer-events-none absolute left-3 top-3 h-12 w-12 border-l border-t border-[#f1d488]/50 sm:left-4 sm:top-4 sm:h-20 sm:w-20" />
          <span className="pointer-events-none absolute right-3 top-3 h-12 w-12 border-r border-t border-[#f1d488]/50 sm:right-4 sm:top-4 sm:h-20 sm:w-20" />
          <span className="pointer-events-none absolute bottom-3 left-3 h-12 w-12 border-b border-l border-[#f1d488]/35 sm:bottom-4 sm:left-4 sm:h-20 sm:w-20" />
          <span className="pointer-events-none absolute bottom-3 right-3 h-12 w-12 border-b border-r border-[#f1d488]/35 sm:bottom-4 sm:right-4 sm:h-20 sm:w-20" />

          <div className="relative grid gap-8 px-4 py-8 sm:px-6 sm:py-10 md:grid-cols-[220px_minmax(0,1fr)] md:items-center md:gap-8 md:px-8 xl:grid-cols-[250px_minmax(0,1fr)] xl:px-10 2xl:min-h-[520px] 2xl:grid-cols-[285px_minmax(0,1fr)_300px] 2xl:gap-10 2xl:px-14">
            <div className="relative">
              <ChampionFrame
                avatar={selectedAvatar}
                canChange={isOwnProfile}
                onOpen={() => isOwnProfile && setAvatarOpen((value) => !value)}
              />
            </div>

            <div className="min-w-0 text-center md:text-left">
              <div
                className="inline-flex max-w-full items-center gap-2 border border-white/10 bg-black/25 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.14em] backdrop-blur sm:text-[10px] sm:tracking-[0.22em]"
                style={{ color: selectedAvatar.accent }}
              >
                <Shield className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{selectedAvatar.role}</span>
              </div>
              <h2 className="mt-5 break-words font-display text-3xl font-bold uppercase leading-[.98] tracking-[0.015em] text-[#f4e6bc] drop-shadow-[0_6px_25px_rgba(0,0,0,.7)] sm:text-4xl md:text-5xl md:tracking-[0.025em] xl:text-6xl 2xl:text-7xl">
                {fullName}
              </h2>
              <p className="mt-4 font-display text-[10px] font-bold uppercase leading-5 tracking-[0.16em] text-[#d6b35b]/75 sm:text-xs sm:tracking-[0.26em]">
                {selectedAvatar.name}
              </p>

              <div className="mx-auto mt-7 max-w-2xl md:mx-0 md:mt-8">
                <div className="flex items-end justify-between gap-4">
                  <div className="min-w-0 text-left">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/38">
                      Ascension globale
                    </span>
                    <p className="mt-1 text-xs leading-5 text-white/60 sm:text-sm">
                      <strong className="text-[#f1d488]">{unlocked}</strong> trophées
                      conquis sur {totalTrophies}
                    </p>
                  </div>
                  <span className="shrink-0 font-display text-2xl font-bold text-[#f1d488] sm:text-3xl">
                    {completion}%
                  </span>
                </div>
                <div className="relative mt-4 h-[10px] border border-[#b99046]/25 bg-black/45 p-[2px]">
                  <div
                    className="profile-progress-shimmer h-full bg-gradient-to-r from-[#376f78] via-[#7fc5cd] to-[#f1d488] shadow-[0_0_24px_rgba(106,171,180,.4)] transition-all duration-1000"
                    style={{ width: `${completion}%` }}
                  />
                  {[25, 50, 75].map((mark) => (
                    <span
                      key={mark}
                      className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-[#d6b35b]/45"
                      style={{ left: `${mark}%` }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="mx-auto w-full max-w-[220px] sm:max-w-[260px] md:col-span-2 2xl:col-span-1 2xl:max-w-[300px]">
              <div className="relative aspect-square">
                <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
                  <defs>
                    <linearGradient id="profile-progress" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#5A9BA3" />
                      <stop offset=".55" stopColor="#8fd5dd" />
                      <stop offset="1" stopColor="#f1d488" />
                    </linearGradient>
                    <filter id="profile-ring-glow">
                      <feGaussianBlur stdDeviation="2.5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <circle
                    cx="80"
                    cy="80"
                    r="65"
                    fill="rgba(2,5,12,.55)"
                    stroke="rgba(214,179,91,.12)"
                    strokeWidth="2"
                  />
                  <circle
                    cx="80"
                    cy="80"
                    r="61"
                    fill="none"
                    stroke="rgba(255,255,255,.07)"
                    strokeWidth="7"
                  />
                  <circle
                    cx="80"
                    cy="80"
                    r="61"
                    fill="none"
                    stroke="url(#profile-progress)"
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray={`${Math.PI * 122}`}
                    strokeDashoffset={`${Math.PI * 122 * (1 - completion / 100)}`}
                    filter="url(#profile-ring-glow)"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <Crown className="h-7 w-7 text-[#f1d488]" />
                  <strong className="mt-2 font-display text-5xl text-[#f4e6bc]">
                    {unlocked}
                  </strong>
                  <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.22em] text-white/35">
                    exploits
                  </span>
                </div>
                <span className="absolute left-1/2 top-0 h-5 w-5 -translate-x-1/2 rotate-45 border border-[#f1d488]/70 bg-[#07101d]" />
                <span className="absolute bottom-0 left-1/2 h-5 w-5 -translate-x-1/2 rotate-45 border border-[#f1d488]/40 bg-[#07101d]" />
              </div>

              <div className="mt-2 grid grid-cols-2 gap-px border border-[#b99046]/22 bg-[#b99046]/15">
                <ProfileStat
                  value={String(totalTrophies - unlocked)}
                  label="À conquérir"
                  icon={<LockKeyhole className="h-4 w-4" />}
                />
                <ProfileStat
                  value={String(specialUnlocked)}
                  label="Rares"
                  icon={<Gem className="h-4 w-4" />}
                />
              </div>
            </div>
          </div>
        </section>

        {avatarOpen && isOwnProfile && (
          <AvatarSelector
            activeKey={activeProfile.avatarKey}
            onSelect={changeAvatar}
            onClose={() => setAvatarOpen(false)}
          />
        )}

        <nav className="profile-reveal mx-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center justify-center gap-1 border-y border-[#b99046]/20 py-3 sm:grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] sm:gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('trophies')}
            className={`group flex min-h-12 min-w-0 items-center justify-center gap-2 px-2 font-display text-[9px] font-bold uppercase tracking-[0.08em] transition sm:gap-3 sm:px-5 sm:text-[10px] sm:tracking-[0.16em] ${
              activeTab === 'trophies'
                ? 'border border-[#d6b35b]/55 bg-[#d6b35b]/10 text-[#f1d488] shadow-[inset_0_0_30px_rgba(214,179,91,.08)]'
                : 'border border-transparent text-white/38 hover:text-white/75'
            }`}
          >
            <Trophy className="h-4 w-4" />
            <span className="sm:hidden">Trophées</span>
            <span className="hidden sm:inline">Panthéon des trophées</span>
          </button>
          <span className="hidden h-7 w-7 rotate-45 border border-[#b99046]/35 bg-[#07101d] sm:block">
            <span className="block h-full w-full scale-50 border border-[#d6b35b]/45" />
          </span>
          <button
            type="button"
            onClick={() => setActiveTab('record')}
            className={`group flex min-h-12 min-w-0 items-center justify-center gap-2 px-2 font-display text-[9px] font-bold uppercase tracking-[0.08em] transition sm:gap-3 sm:px-5 sm:text-[10px] sm:tracking-[0.16em] ${
              activeTab === 'record'
                ? 'border border-cyan-300/45 bg-cyan-300/[0.07] text-cyan-100 shadow-[inset_0_0_30px_rgba(34,211,238,.06)]'
                : 'border border-transparent text-white/38 hover:text-white/75'
            }`}
          >
            <History className="h-4 w-4" />
            <span className="sm:hidden">Recordman</span>
            <span className="hidden sm:inline">Chroniques du Recordman</span>
          </button>
        </nav>

        {activeTab === 'trophies' ? (
          <div className="space-y-12 pb-10">
            {COLLECTIONS.map((collection) => {
              const trophies = trophiesByCollection.get(collection.key) ?? [];
              const collectionUnlocked = trophies.filter((trophy) => trophy.unlocked).length;
              return (
                <section key={collection.key} className="profile-reveal">
                  <div className="mb-5 grid gap-4 sm:mb-6 md:grid-cols-[1fr_auto_1fr] md:items-end">
                    <div className="min-w-0">
                      <span className="font-display text-[8px] font-bold uppercase tracking-[0.2em] text-[#d6b35b]/60 sm:text-[9px] sm:tracking-[0.28em]">
                        {collection.eyebrow}
                      </span>
                      <div className="mt-2 flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 rotate-45 items-center justify-center border border-[#b99046]/50 bg-[#0a1422] text-[#f1d488] shadow-[0_0_25px_rgba(214,179,91,.1)] sm:h-10 sm:w-10">
                          <span className="-rotate-45">
                            <CollectionIcon collection={collection.key} />
                          </span>
                        </span>
                        <div className="min-w-0">
                          <h2 className="break-words font-display text-lg font-bold uppercase leading-tight tracking-[0.055em] text-[#f4e6bc] sm:text-xl sm:tracking-[0.08em] md:text-2xl">
                            Collection {collection.label}
                          </h2>
                          <p className="mt-1 text-xs text-white/38">{collection.subtitle}</p>
                        </div>
                      </div>
                    </div>
                    <div className="hidden min-w-24 md:block">
                      <OrnamentalRule />
                    </div>
                    <div className="flex items-center justify-start gap-3 md:justify-end">
                      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/32">
                        Conquis
                      </span>
                      <strong className="font-display text-xl text-[#f1d488]">
                        {collectionUnlocked}
                        <span className="text-white/25"> / {trophies.length}</span>
                      </strong>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
                    {trophies.map((trophy, index) => (
                      <TrophyCard key={trophy.code} trophy={trophy} index={index} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <RecordHistory entries={data.recordHistory} />
        )}
      </div>
    </div>
  );
}

function ProfileStat({
  value,
  label,
  icon,
}: {
  value: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-[#050a13]/85 px-4 py-4 text-center">
      <div className="flex items-center justify-center gap-2 text-[#74bec7]">
        {icon}
        <strong className="font-display text-xl text-[#f4e6bc]">{value}</strong>
      </div>
      <p className="mt-1 text-[8px] font-bold uppercase tracking-[0.17em] text-white/30">
        {label}
      </p>
    </div>
  );
}

function RecordHistory({
  entries,
}: {
  entries: NonNullable<ReturnType<typeof useTrophyProfiles>['data']>['recordHistory'];
}) {
  return (
    <section className="profile-reveal relative overflow-hidden border border-[#b99046]/35 bg-[#030711] pb-2">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,.12),transparent_32%),linear-gradient(135deg,transparent,rgba(214,179,91,.035))]" />
      <span className="absolute left-4 top-4 h-16 w-16 border-l border-t border-[#f1d488]/45" />
      <span className="absolute right-4 top-4 h-16 w-16 border-r border-t border-[#f1d488]/45" />

      <div className="relative border-b border-[#b99046]/20 px-6 py-10 text-center md:px-10">
        <div className="mx-auto flex h-20 w-20 rotate-45 items-center justify-center border border-cyan-200/50 bg-cyan-300/[0.06] shadow-[0_0_45px_rgba(34,211,238,.24)]">
          <Crown className="h-9 w-9 -rotate-45 text-cyan-100" />
        </div>
        <p className="mt-8 font-display text-[9px] font-bold uppercase tracking-[0.34em] text-[#d6b35b]/70">
          Trophée vivant · Un seul détenteur
        </p>
        <h2 className="mt-3 font-display text-2xl font-bold uppercase tracking-[0.08em] text-[#f4e6bc] md:text-4xl">
          Chroniques du Recordman
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-white/45">
          Le record absolu change de main lorsqu’un commercial réalise le plus grand
          chiffre d’affaires mensuel de l’histoire LYFTT. Chaque règne reste gravé ici.
        </p>
      </div>

      <div className="relative mx-auto max-w-5xl px-5 py-8 md:px-10">
        {entries.length === 0 && (
          <div className="border border-dashed border-[#b99046]/30 px-6 py-16 text-center">
            <Medal className="mx-auto h-10 w-10 text-[#d6b35b]/45" />
            <p className="mt-5 font-display text-sm uppercase tracking-[0.12em] text-[#f4e6bc]/60">
              La première légende reste à écrire
            </p>
            <p className="mt-2 text-sm text-white/32">
              Le premier record apparaîtra dès qu’un mois signé sera disponible.
            </p>
          </div>
        )}
        <div className="relative">
          {entries.length > 0 && (
            <span className="absolute bottom-6 left-6 top-6 w-px bg-gradient-to-b from-cyan-300/70 via-[#d6b35b]/45 to-transparent sm:left-9" />
          )}
          {entries.map((entry, index) => {
            const current = index === 0 && !entry.relinquishedAt;
            return (
              <div
                key={`${entry.userRoleId}-${entry.acquiredAt}`}
                className={`relative mb-4 grid gap-4 border p-5 pl-16 transition duration-300 sm:grid-cols-[1fr_auto] sm:items-center sm:pl-20 ${
                  current
                    ? 'border-cyan-300/35 bg-cyan-300/[0.055] shadow-[0_0_55px_rgba(34,211,238,.07)]'
                    : 'border-white/[0.07] bg-white/[0.018]'
                }`}
              >
                <div
                  className={`absolute left-[11px] top-1/2 flex h-12 w-12 -translate-y-1/2 rotate-45 items-center justify-center border sm:left-[12px] sm:h-14 sm:w-14 ${
                    current
                      ? 'border-cyan-200/55 bg-[#071622] text-cyan-100 shadow-[0_0_25px_rgba(34,211,238,.25)]'
                      : 'border-[#b99046]/30 bg-[#080d16] text-[#d6b35b]/55'
                  }`}
                >
                  {current ? (
                    <Crown className="h-5 w-5 -rotate-45" />
                  ) : (
                    <Trophy className="h-5 w-5 -rotate-45" />
                  )}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="font-display text-sm font-bold uppercase tracking-[0.06em] text-[#f4e6bc]">
                      {[entry.firstName, entry.lastName].filter(Boolean).join(' ')}
                    </p>
                    {current && (
                      <span className="border border-cyan-300/30 bg-cyan-300/[0.08] px-2 py-1 text-[8px] font-bold uppercase tracking-[0.18em] text-cyan-100">
                        Détenteur actuel
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-white/36">
                    {new Date(entry.month).toLocaleDateString('fr-FR', {
                      month: 'long',
                      year: 'numeric',
                    })}{' '}
                    · acquis le {new Date(entry.acquiredAt).toLocaleDateString('fr-FR')}
                  </p>
                  {entry.relinquishedAt && (
                    <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-white/24">
                      Règne achevé le{' '}
                      {new Date(entry.relinquishedAt).toLocaleDateString('fr-FR')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 text-left sm:text-right">
                  <div>
                    <p
                      className={`font-display text-2xl font-bold ${
                        current ? 'text-cyan-100' : 'text-[#d6b35b]/75'
                      }`}
                    >
                      {formatEuro(entry.amount)}
                    </p>
                    <p className="mt-1 text-[8px] font-bold uppercase tracking-[0.16em] text-white/25">
                      {current ? 'Record à battre' : 'Ancien record'}
                    </p>
                  </div>
                  <ChevronRight
                    className={`h-5 w-5 ${current ? 'text-cyan-200' : 'text-white/15'}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
import { useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  Crown,
  Gem,
  History,
  LockKeyhole,
  Medal,
  Shield,
  Sparkles,
  Star,
  Swords,
  Trophy,
  Zap,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  useSetMyAvatar,
  useTrophyProfiles,
  type CommercialTrophy,
  type TrophyCollection,
  type TrophyRarity,
} from '../hooks/use-prospects';
import ErrorState from '../components/ErrorState';
import LoadingSpinner from '../components/LoadingSpinner';
import { usePersistentState } from '../hooks/use-persistent-state';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

const CHAMPION_SPRITE = '/assets/lyftt-champions-v1.jpg';

const AVATARS = [
  {
    key: 'summit',
    name: 'Gardien du Sommet',
    role: 'Sentinelle polaire',
    position: '0% 0%',
    accent: '#67e8f9',
    glow: 'rgba(34,211,238,.32)',
  },
  {
    key: 'navigator',
    name: 'Navigateur Céleste',
    role: 'Maître des trajectoires',
    position: '50% 0%',
    accent: '#60a5fa',
    glow: 'rgba(59,130,246,.32)',
  },
  {
    key: 'closer',
    name: 'Arcaniste du Closing',
    role: 'Architecte des victoires',
    position: '100% 0%',
    accent: '#c084fc',
    glow: 'rgba(168,85,247,.36)',
  },
  {
    key: 'vanguard',
    name: 'Avant-garde',
    role: 'Conquérant des objectifs',
    position: '0% 100%',
    accent: '#fbbf24',
    glow: 'rgba(245,158,11,.34)',
  },
  {
    key: 'strategist',
    name: 'Grand Stratège',
    role: 'Visionnaire de la saison',
    position: '50% 100%',
    accent: '#34d399',
    glow: 'rgba(16,185,129,.3)',
  },
  {
    key: 'ace',
    name: 'As Écarlate',
    role: 'Duelliste commercial',
    position: '100% 100%',
    accent: '#fb7185',
    glow: 'rgba(244,63,94,.34)',
  },
] as const;

type Avatar = (typeof AVATARS)[number];

const COLLECTIONS: Array<{
  key: TrophyCollection;
  label: string;
  subtitle: string;
  eyebrow: string;
}> = [
  {
    key: 'closing',
    label: 'Closing',
    subtitle: 'La maîtrise de la signature',
    eyebrow: 'Acte I · Conquête',
  },
  {
    key: 'revenue',
    label: "Chiffre d'affaires",
    subtitle: 'La montée en puissance',
    eyebrow: 'Acte II · Prospérité',
  },
  {
    key: 'regularity',
    label: 'Régularité',
    subtitle: "L'excellence sur une année civile",
    eyebrow: 'Acte III · Discipline',
  },
  {
    key: 'special',
    label: 'Trophées spéciaux',
    subtitle: 'Les distinctions les plus rares',
    eyebrow: 'Acte IV · Légende',
  },
];

const RARITY: Record<
  TrophyRarity,
  { label: string; color: string; soft: string; glow: string; border: string }
> = {
  bronze: {
    label: 'Bronze',
    color: '#d97745',
    soft: 'rgba(217,119,69,.18)',
    glow: 'rgba(217,119,69,.3)',
    border: 'rgba(251,146,60,.28)',
  },
  silver: {
    label: 'Argent',
    color: '#d8e3ed',
    soft: 'rgba(216,227,237,.14)',
    glow: 'rgba(203,213,225,.26)',
    border: 'rgba(203,213,225,.26)',
  },
  gold: {
    label: 'Or',
    color: '#f6c760',
    soft: 'rgba(246,199,96,.18)',
    glow: 'rgba(245,158,11,.34)',
    border: 'rgba(246,199,96,.34)',
  },
  epic: {
    label: 'Épique',
    color: '#bd8cff',
    soft: 'rgba(189,140,255,.17)',
    glow: 'rgba(168,85,247,.38)',
    border: 'rgba(192,132,252,.34)',
  },
  legendary: {
    label: 'Légendaire',
    color: '#ff9c4b',
    soft: 'rgba(255,156,75,.18)',
    glow: 'rgba(249,115,22,.42)',
    border: 'rgba(251,146,60,.38)',
  },
  mythic: {
    label: 'Mythique',
    color: '#70e1ff',
    soft: 'rgba(112,225,255,.17)',
    glow: 'rgba(34,211,238,.42)',
    border: 'rgba(103,232,249,.4)',
  },
};

const formatNumber = (value: number) =>
  new Intl.NumberFormat('fr-FR').format(Math.round(value));
const formatEuro = (value: number) => `${formatNumber(value)} €`;

function progressLabel(trophy: CommercialTrophy) {
  const current = Math.min(trophy.progress, trophy.threshold);
  if (trophy.code.startsWith('revenue_') || trophy.code === 'special_recordman') {
    return `${formatEuro(current)} / ${formatEuro(trophy.threshold)}`;
  }
  if (trophy.code.startsWith('regularity_')) {
    return `${formatNumber(current)} / ${formatNumber(trophy.threshold)} mois`;
  }
  if (trophy.code.startsWith('closing_')) {
    return `${formatNumber(current)} / ${formatNumber(trophy.threshold)} contrats`;
  }
  return trophy.unlocked ? 'Débloqué' : 'Pas encore débloqué';
}

function ChampionArt({
  avatar,
  className = '',
  overlay = true,
}: {
  avatar: Avatar;
  className?: string;
  overlay?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden bg-[#07101d] ${className}`}
      style={{
        backgroundImage: `url(${CHAMPION_SPRITE})`,
        backgroundPosition: avatar.position,
        backgroundSize: '300% 200%',
        boxShadow: `0 0 55px ${avatar.glow}`,
      }}
    >
      {overlay && (
        <>
          <div className="absolute inset-0 bg-gradient-to-t from-[#030711] via-transparent to-black/10" />
          <div
            className="absolute inset-x-0 bottom-0 h-1/3"
            style={{
              background: `linear-gradient(to top, ${avatar.glow}, transparent)`,
            }}
          />
        </>
      )}
    </div>
  );
}

function ArenaBackdrop({ avatar }: { avatar: Avatar }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <ChampionArt
        avatar={avatar}
        className="absolute -right-[4%] -top-[42%] h-[150%] w-[72%] opacity-[0.17] blur-[1px] [mask-image:linear-gradient(to_left,black,transparent)]"
        overlay={false}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(214,179,91,.16),transparent_30%),radial-gradient(circle_at_80%_30%,rgba(20,91,111,.22),transparent_31%),linear-gradient(115deg,#02050c_0%,#07101e_49%,#02050c_100%)]" />
      <svg
        viewBox="0 0 1600 520"
        preserveAspectRatio="none"
        className="absolute inset-x-0 bottom-0 h-[82%] w-full opacity-60"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="citadel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#17324a" stopOpacity=".62" />
            <stop offset="1" stopColor="#02050c" stopOpacity=".98" />
          </linearGradient>
          <linearGradient id="summit-light" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#49b9c5" stopOpacity="0" />
            <stop offset=".55" stopColor="#6AABB4" stopOpacity=".4" />
            <stop offset="1" stopColor="#e8c77d" stopOpacity=".76" />
          </linearGradient>
          <filter id="path-blur">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        <path
          d="M0 520V420L110 355l75 45 130-116 89 93 164-170 105 145 118-211 111 173 125-120 91 131 165-88 217 183v95Z"
          fill="url(#citadel)"
        />
        <path
          d="M640 520c80-75 79-144 170-178 88-32 42-103 123-120 94-19 74-101 147-139"
          fill="none"
          stroke="url(#summit-light)"
          strokeWidth="7"
          strokeLinecap="round"
          filter="url(#path-blur)"
        />
        <path
          d="M640 520c80-75 79-144 170-178 88-32 42-103 123-120 94-19 74-101 147-139"
          fill="none"
          stroke="url(#summit-light)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path d="M1082 83V29" stroke="#e8c77d" strokeWidth="2" />
        <path d="m1084 31 58 20-58 20Z" fill="#b99046" />
      </svg>
      <div className="profile-stars absolute inset-0 opacity-55" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#02050c] via-transparent to-[#02050c]/55" />
      <div className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-[#02050c] to-transparent" />
    </div>
  );
}

function OrnamentalRule({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#b99046]/60 to-[#b99046]" />
      <span className="h-2.5 w-2.5 rotate-45 border border-[#d6b35b] bg-[#08101a] shadow-[0_0_14px_rgba(214,179,91,.45)]" />
      {label && (
        <span className="font-display text-[9px] font-bold uppercase tracking-[0.32em] text-[#d6b35b]/70">
          {label}
        </span>
      )}
      <span className="h-2.5 w-2.5 rotate-45 border border-[#d6b35b] bg-[#08101a] shadow-[0_0_14px_rgba(214,179,91,.45)]" />
      <div className="h-px flex-1 bg-gradient-to-l from-transparent via-[#b99046]/60 to-[#b99046]" />
    </div>
  );
}

function ChampionFrame({
  avatar,
  canChange,
  onOpen,
}: {
  avatar: Avatar;
  canChange: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="relative mx-auto w-full max-w-[272px] pb-8">
      <div
        className="profile-champion-float absolute -inset-7 rounded-full opacity-60 blur-3xl"
        style={{ background: avatar.glow }}
      />
      <div className="absolute left-1/2 top-[-18px] z-20 h-16 w-16 -translate-x-1/2 rotate-45 border border-[#f1d488]/70 bg-gradient-to-br from-[#20324a] via-[#07101e] to-[#2c1e0b] shadow-[0_0_28px_rgba(214,179,91,.38)]">
        <Crown className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 -rotate-45 text-[#f1d488]" />
      </div>
      <button
        type="button"
        onClick={onOpen}
        disabled={!canChange}
        aria-label={canChange ? 'Changer de personnage' : avatar.name}
        className="group relative block w-full disabled:cursor-default"
      >
        <div className="relative border border-[#b99046]/65 bg-[#030711] p-[6px] shadow-[0_28px_70px_rgba(0,0,0,.65)] [clip-path:polygon(12%_0,88%_0,100%_10%,100%_86%,84%_100%,16%_100%,0_86%,0_10%)]">
          <div className="border border-[#f1d488]/30 bg-[#06101c] p-1 [clip-path:polygon(10%_0,90%_0,100%_9%,100%_87%,83%_100%,17%_100%,0_87%,0_9%)]">
            <ChampionArt
              avatar={avatar}
              className="aspect-[4/5] w-full transition duration-700 group-hover:scale-[1.035]"
            />
          </div>
          <span className="absolute left-3 top-3 h-10 w-10 border-l border-t border-[#f1d488]/70" />
          <span className="absolute right-3 top-3 h-10 w-10 border-r border-t border-[#f1d488]/70" />
          <span className="absolute bottom-3 left-3 h-10 w-10 border-b border-l border-[#f1d488]/70" />
          <span className="absolute bottom-3 right-3 h-10 w-10 border-b border-r border-[#f1d488]/70" />
          {canChange && (
            <span className="absolute inset-x-6 bottom-5 flex items-center justify-center gap-2 border border-[#d6b35b]/35 bg-[#02050c]/85 px-3 py-2 font-display text-[9px] font-bold uppercase tracking-[0.2em] text-[#f1d488] backdrop-blur-md transition group-hover:border-[#f1d488]/70 group-hover:bg-[#10182a]/95">
              <Sparkles className="h-3.5 w-3.5" />
              Choisir un héros
            </span>
          )}
        </div>
      </button>
      <div className="absolute inset-x-8 bottom-0 h-8 border-x border-b border-[#b99046]/35 [clip-path:polygon(0_0,100%_0,82%_100%,18%_100%)]" />
    </div>
  );
}

function AvatarSelector({
  activeKey,
  onSelect,
}: {
  activeKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="profile-reveal absolute left-1/2 top-[calc(100%+12px)] z-40 w-[min(92vw,560px)] -translate-x-1/2 border border-[#b99046]/50 bg-[#040914]/95 p-3 shadow-[0_30px_90px_rgba(0,0,0,.8)] backdrop-blur-xl sm:p-4">
      <OrnamentalRule label="Sélection du héros" />
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {AVATARS.map((avatar) => {
          const active = activeKey === avatar.key;
          return (
            <button
              key={avatar.key}
              type="button"
              onClick={() => onSelect(avatar.key)}
              className={`group relative overflow-hidden border p-1 text-left transition duration-300 ${
                active
                  ? 'border-[#f1d488] bg-[#d6b35b]/10'
                  : 'border-white/10 bg-white/[0.025] hover:border-[#d6b35b]/55'
              }`}
            >
              <ChampionArt
                avatar={avatar}
                className="aspect-square w-full transition duration-500 group-hover:scale-105"
              />
              <div className="relative px-2 pb-2 pt-2">
                <p className="font-display text-[9px] font-bold uppercase tracking-[0.08em] text-[#f4e6bc]">
                  {avatar.name}
                </p>
                <p className="mt-1 text-[9px] text-white/38">{avatar.role}</p>
              </div>
              {active && (
                <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center border border-[#f1d488]/70 bg-[#050913]/90 text-[#f1d488]">
                  <Check className="h-4 w-4" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Cup({ trophy }: { trophy: CommercialTrophy }) {
  const rarity = RARITY[trophy.rarity];
  return (
    <div className="relative flex h-32 w-32 items-center justify-center">
      <div
        className={`absolute inset-2 rotate-45 border transition duration-500 group-hover:rotate-[50deg] ${
          trophy.unlocked ? '' : 'border-slate-700/40 bg-slate-900/35'
        }`}
        style={
          trophy.unlocked
            ? {
                borderColor: rarity.border,
                background: `radial-gradient(circle, ${rarity.soft}, rgba(3,7,17,.4) 70%)`,
                boxShadow: `0 0 42px ${rarity.glow}`,
              }
            : undefined
        }
      />
      <div
        className={`absolute inset-5 -rotate-45 border ${
          trophy.unlocked ? '' : 'border-slate-700/35'
        }`}
        style={trophy.unlocked ? { borderColor: rarity.border } : undefined}
      />
      {trophy.unlocked && (
        <>
          <span
            className="profile-rarity-pulse absolute inset-8 rounded-full blur-2xl"
            style={{ background: rarity.glow }}
          />
          <Star
            className="absolute -top-1 h-4 w-4"
            style={{ color: rarity.color, fill: rarity.color }}
          />
        </>
      )}
      <Trophy
        strokeWidth={1.25}
        className={`relative h-[76px] w-[76px] transition duration-500 group-hover:scale-110 ${
          trophy.unlocked ? '' : 'text-slate-700 grayscale'
        }`}
        style={
          trophy.unlocked
            ? {
                color: rarity.color,
                filter: `drop-shadow(0 0 14px ${rarity.glow})`,
              }
            : undefined
        }
      />
      {!trophy.unlocked && (
        <span className="absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rotate-45 border border-slate-600/35 bg-[#070c16]">
          <LockKeyhole className="h-4 w-4 -rotate-45 text-slate-600" />
        </span>
      )}
      {trophy.dynamic && trophy.unlocked && (
        <span className="absolute -right-1 -top-1 flex h-9 w-9 items-center justify-center rotate-45 border border-cyan-300/45 bg-cyan-400/10 text-cyan-200 shadow-[0_0_20px_rgba(34,211,238,.35)]">
          <Zap className="h-4 w-4 -rotate-45" />
        </span>
      )}
    </div>
  );
}

function TrophyCard({ trophy, index }: { trophy: CommercialTrophy; index: number }) {
  const rarity = RARITY[trophy.rarity];
  const percent =
    trophy.threshold > 0 ? Math.min(100, (trophy.progress / trophy.threshold) * 100) : 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <article
          className={`profile-trophy-card profile-reveal group relative min-h-[330px] overflow-hidden border p-[1px] transition duration-500 hover:-translate-y-2 ${
            trophy.unlocked
              ? 'border-[#b99046]/35'
              : 'border-white/[0.065] grayscale-[.45]'
          }`}
          style={{ animationDelay: `${Math.min(index, 6) * 65}ms` }}
        >
          <div
            className="absolute inset-0 opacity-80"
            style={{
              background: trophy.unlocked
                ? `radial-gradient(circle at 50% 28%, ${rarity.soft}, transparent 37%), linear-gradient(180deg,rgba(12,24,40,.96),rgba(3,7,16,.99))`
                : 'linear-gradient(180deg,rgba(13,20,31,.8),rgba(4,7,13,.97))',
            }}
          />
          <span className="absolute left-2 top-2 h-8 w-8 border-l border-t border-[#d6b35b]/35" />
          <span className="absolute right-2 top-2 h-8 w-8 border-r border-t border-[#d6b35b]/35" />
          <span className="absolute bottom-2 left-2 h-8 w-8 border-b border-l border-[#d6b35b]/25" />
          <span className="absolute bottom-2 right-2 h-8 w-8 border-b border-r border-[#d6b35b]/25" />

          <div className="relative flex h-full flex-col items-center px-5 py-6 text-center">
            <Cup trophy={trophy} />
            <div className="mt-4 flex items-center gap-2">
              <span className="h-px w-5 bg-[#d6b35b]/35" />
              <span
                className={`font-display text-[9px] font-bold uppercase tracking-[0.2em] ${
                  trophy.unlocked ? '' : 'text-slate-600'
                }`}
                style={trophy.unlocked ? { color: rarity.color } : undefined}
              >
                {rarity.label}
                {trophy.dynamic ? ' · Vivant' : ''}
              </span>
              <span className="h-px w-5 bg-[#d6b35b]/35" />
            </div>
            <h3
              className={`mt-3 font-display text-[15px] font-bold uppercase tracking-[0.045em] ${
                trophy.unlocked ? 'text-[#f5ebcf]' : 'text-slate-500'
              }`}
            >
              {trophy.name}
            </h3>
            <p
              className={`mt-2 line-clamp-2 text-[11px] leading-5 ${
                trophy.unlocked ? 'text-white/45' : 'text-slate-600'
              }`}
            >
              {trophy.description}
            </p>
            <div className="mt-auto w-full pt-5">
              <div className="relative h-1 overflow-hidden bg-white/[0.055]">
                <div
                  className="h-full transition-all duration-1000"
                  style={{
                    width: `${percent}%`,
                    background: trophy.unlocked
                      ? `linear-gradient(90deg,#5A9BA3,${rarity.color})`
                      : '#334155',
                    boxShadow: trophy.unlocked ? `0 0 14px ${rarity.glow}` : undefined,
                  }}
                />
              </div>
              <div
                className={`mt-3 text-[9px] font-bold uppercase tracking-[0.12em] ${
                  trophy.unlocked ? 'text-white/45' : 'text-slate-600'
                }`}
              >
                {progressLabel(trophy)}
              </div>
            </div>
          </div>
        </article>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-[310px] border-[#b99046]/45 bg-[#050a13] p-5 text-white shadow-[0_24px_70px_rgba(0,0,0,.7)]"
      >
        <p className="font-display text-xs font-bold uppercase tracking-[0.08em] text-[#f1d488]">
          {trophy.unlocked ? `${trophy.name} · Acquis` : `Quête · ${trophy.name}`}
        </p>
        <p className="mt-3 text-xs leading-5 text-white/60">{trophy.description}</p>
        <div className="mt-4 border-l border-[#d6b35b]/50 pl-3 text-xs font-semibold text-[#8cc9d0]">
          Progression : {progressLabel(trophy)}
        </div>
        {trophy.dynamic && (
          <p className="mt-3 text-[11px] leading-5 text-violet-300">
            Trophée unique : il change de détenteur lorsqu’un meilleur record est établi.
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function CollectionIcon({ collection }: { collection: TrophyCollection }) {
  const className = 'h-5 w-5';
  if (collection === 'closing') return <Swords className={className} />;
  if (collection === 'revenue') return <Gem className={className} />;
  if (collection === 'regularity') return <Shield className={className} />;
  return <Crown className={className} />;
}

export default function Profile() {
  const { userRole, isAdmin } = useAuth();
  const { data, isLoading, error } = useTrophyProfiles();
  const setAvatar = useSetMyAvatar();
  const [selectedProfileId, setSelectedProfileId] = usePersistentState<number | null>(
    'lyftt.profil.commercial',
    null,
  );
  const [activeTab, setActiveTab] = usePersistentState<'trophies' | 'record'>(
    'lyftt.profil.onglet',
    'trophies',
  );
  const [avatarOpen, setAvatarOpen] = useState(false);

  const ownProfile = data?.profiles.find((profile) => profile.userRoleId === userRole?.id);
  const activeProfile =
    data?.profiles.find((profile) => profile.userRoleId === selectedProfileId) ??
    ownProfile ??
    data?.profiles[0];
  const selectedAvatar =
    AVATARS.find((avatar) => avatar.key === activeProfile?.avatarKey) ?? AVATARS[0];
  const unlocked = activeProfile?.trophies.filter((trophy) => trophy.unlocked).length ?? 0;
  const completion = activeProfile?.trophies.length
    ? Math.round((unlocked / activeProfile.trophies.length) * 100)
    : 0;

  const trophiesByCollection = useMemo(() => {
    const map = new Map<TrophyCollection, CommercialTrophy[]>();
    for (const collection of COLLECTIONS) map.set(collection.key, []);
    for (const trophy of activeProfile?.trophies ?? []) {
      map.get(trophy.collection)?.push(trophy);
    }
    return map;
  }, [activeProfile]);

  const changeAvatar = async (key: string) => {
    if (activeProfile?.userRoleId !== userRole?.id) return;
    try {
      await setAvatar.mutateAsync(key);
      setAvatarOpen(false);
      toast.success('Votre héros a rejoint le profil');
    } catch {
      toast.error("Impossible de modifier le personnage");
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-80 items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }
  if (error || !activeProfile) {
    return <ErrorState message="Impossible de charger les trophées du profil." />;
  }

  const fullName =
    `${activeProfile.firstName ?? ''} ${activeProfile.lastName ?? ''}`.trim() ||
    'Commercial LYFTT';
  const isOwnProfile = activeProfile.userRoleId === userRole?.id;
  const totalTrophies = activeProfile.trophies.length;
  const specialUnlocked =
    trophiesByCollection.get('special')?.filter((trophy) => trophy.unlocked).length ?? 0;

  return (
    <div className="-m-4 min-h-[calc(100vh-3.5rem)] overflow-hidden bg-[#02050c] p-4 text-white sm:-m-6 sm:p-6 lg:-m-8 lg:min-h-screen lg:p-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_82%_0%,rgba(20,91,111,.14),transparent_32%),radial-gradient(circle_at_14%_45%,rgba(185,144,70,.08),transparent_30%)]" />
      <div className="relative mx-auto max-w-[1660px] space-y-7">
        <header className="profile-reveal flex flex-col gap-5 border-b border-[#b99046]/20 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-3 font-display text-[10px] font-bold uppercase tracking-[0.32em] text-[#d6b35b]">
              <span className="h-2 w-2 rotate-45 border border-[#f1d488] bg-[#b99046]/35" />
              Temple des accomplissements
            </div>
            <h1 className="mt-3 font-display text-3xl font-bold uppercase tracking-[0.06em] text-[#f4e6bc] md:text-4xl">
              Profil du conquérant
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/42">
              Choisissez votre héros, bâtissez votre légende et gravez vos victoires dans
              l’histoire de LYFTT.
            </p>
          </div>
          {isAdmin && (
            <label className="flex flex-col gap-2">
              <span className="font-display text-[9px] font-bold uppercase tracking-[0.22em] text-[#d6b35b]/70">
                Observer un commercial
              </span>
              <select
                value={activeProfile.userRoleId}
                onChange={(event) => {
                  setSelectedProfileId(Number(event.target.value));
                  setAvatarOpen(false);
                }}
                className="h-12 min-w-[250px] border border-[#b99046]/35 bg-[#07101d] px-4 text-sm font-semibold text-[#f4e6bc] outline-none transition focus:border-[#f1d488]"
              >
                {data.profiles.map((profile) => (
                  <option
                    key={profile.userRoleId}
                    value={profile.userRoleId}
                    className="bg-[#07101d]"
                  >
                    {[profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
                      `Commercial ${profile.userRoleId}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>

        <section className="profile-reveal relative min-h-[520px] overflow-hidden border border-[#b99046]/35 shadow-[0_42px_120px_rgba(0,0,0,.48)] [clip-path:polygon(2%_0,98%_0,100%_6%,100%_94%,98%_100%,2%_100%,0_94%,0_6%)]">
          <ArenaBackdrop avatar={selectedAvatar} />
          <span className="pointer-events-none absolute left-4 top-4 h-20 w-20 border-l border-t border-[#f1d488]/50" />
          <span className="pointer-events-none absolute right-4 top-4 h-20 w-20 border-r border-t border-[#f1d488]/50" />
          <span className="pointer-events-none absolute bottom-4 left-4 h-20 w-20 border-b border-l border-[#f1d488]/35" />
          <span className="pointer-events-none absolute bottom-4 right-4 h-20 w-20 border-b border-r border-[#f1d488]/35" />

          <div className="relative grid min-h-[520px] gap-10 px-6 py-10 md:px-10 lg:grid-cols-[285px_minmax(0,1fr)_300px] lg:items-center lg:px-14">
            <div className="relative">
              <ChampionFrame
                avatar={selectedAvatar}
                canChange={isOwnProfile}
                onOpen={() => isOwnProfile && setAvatarOpen((value) => !value)}
              />
              {avatarOpen && isOwnProfile && (
                <AvatarSelector activeKey={activeProfile.avatarKey} onSelect={changeAvatar} />
              )}
            </div>

            <div className="text-center lg:text-left">
              <div
                className="inline-flex items-center gap-2 border border-white/10 bg-black/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] backdrop-blur"
                style={{ color: selectedAvatar.accent }}
              >
                <Shield className="h-3.5 w-3.5" />
                {selectedAvatar.role}
              </div>
              <h2 className="mt-5 font-display text-4xl font-bold uppercase leading-[.96] tracking-[0.025em] text-[#f4e6bc] drop-shadow-[0_6px_25px_rgba(0,0,0,.7)] md:text-6xl xl:text-7xl">
                {fullName}
              </h2>
              <p className="mt-4 font-display text-xs font-bold uppercase tracking-[0.26em] text-[#d6b35b]/75">
                {selectedAvatar.name}
              </p>

              <div className="mx-auto mt-8 max-w-2xl lg:mx-0">
                <div className="flex items-end justify-between gap-4">
                  <div className="text-left">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/38">
                      Ascension globale
                    </span>
                    <p className="mt-1 text-sm text-white/60">
                      <strong className="text-[#f1d488]">{unlocked}</strong> trophées
                      conquis sur {totalTrophies}
                    </p>
                  </div>
                  <span className="font-display text-3xl font-bold text-[#f1d488]">
                    {completion}%
                  </span>
                </div>
                <div className="relative mt-4 h-[10px] border border-[#b99046]/25 bg-black/45 p-[2px]">
                  <div
                    className="profile-progress-shimmer h-full bg-gradient-to-r from-[#376f78] via-[#7fc5cd] to-[#f1d488] shadow-[0_0_24px_rgba(106,171,180,.4)] transition-all duration-1000"
                    style={{ width: `${completion}%` }}
                  />
                  {[25, 50, 75].map((mark) => (
                    <span
                      key={mark}
                      className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-[#d6b35b]/45"
                      style={{ left: `${mark}%` }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="mx-auto w-full max-w-[300px]">
              <div className="relative aspect-square">
                <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
                  <defs>
                    <linearGradient id="profile-progress" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#5A9BA3" />
                      <stop offset=".55" stopColor="#8fd5dd" />
                      <stop offset="1" stopColor="#f1d488" />
                    </linearGradient>
                    <filter id="profile-ring-glow">
                      <feGaussianBlur stdDeviation="2.5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <circle
                    cx="80"
                    cy="80"
                    r="65"
                    fill="rgba(2,5,12,.55)"
                    stroke="rgba(214,179,91,.12)"
                    strokeWidth="2"
                  />
                  <circle
                    cx="80"
                    cy="80"
                    r="61"
                    fill="none"
                    stroke="rgba(255,255,255,.07)"
                    strokeWidth="7"
                  />
                  <circle
                    cx="80"
                    cy="80"
                    r="61"
                    fill="none"
                    stroke="url(#profile-progress)"
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray={`${Math.PI * 122}`}
                    strokeDashoffset={`${Math.PI * 122 * (1 - completion / 100)}`}
                    filter="url(#profile-ring-glow)"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <Crown className="h-7 w-7 text-[#f1d488]" />
                  <strong className="mt-2 font-display text-5xl text-[#f4e6bc]">
                    {unlocked}
                  </strong>
                  <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.22em] text-white/35">
                    exploits
                  </span>
                </div>
                <span className="absolute left-1/2 top-0 h-5 w-5 -translate-x-1/2 rotate-45 border border-[#f1d488]/70 bg-[#07101d]" />
                <span className="absolute bottom-0 left-1/2 h-5 w-5 -translate-x-1/2 rotate-45 border border-[#f1d488]/40 bg-[#07101d]" />
              </div>

              <div className="mt-2 grid grid-cols-2 gap-px border border-[#b99046]/22 bg-[#b99046]/15">
                <ProfileStat
                  value={String(totalTrophies - unlocked)}
                  label="À conquérir"
                  icon={<LockKeyhole className="h-4 w-4" />}
                />
                <ProfileStat
                  value={String(specialUnlocked)}
                  label="Rares"
                  icon={<Gem className="h-4 w-4" />}
                />
              </div>
            </div>
          </div>
        </section>

        <nav className="profile-reveal mx-auto flex w-full max-w-3xl items-center justify-center gap-2 border-y border-[#b99046]/20 py-3">
          <button
            type="button"
            onClick={() => setActiveTab('trophies')}
            className={`group flex min-h-12 flex-1 items-center justify-center gap-3 px-5 font-display text-[10px] font-bold uppercase tracking-[0.16em] transition ${
              activeTab === 'trophies'
                ? 'border border-[#d6b35b]/55 bg-[#d6b35b]/10 text-[#f1d488] shadow-[inset_0_0_30px_rgba(214,179,91,.08)]'
                : 'border border-transparent text-white/38 hover:text-white/75'
            }`}
          >
            <Trophy className="h-4 w-4" />
            Panthéon des trophées
          </button>
          <span className="h-7 w-7 rotate-45 border border-[#b99046]/35 bg-[#07101d]">
            <span className="block h-full w-full scale-50 border border-[#d6b35b]/45" />
          </span>
          <button
            type="button"
            onClick={() => setActiveTab('record')}
            className={`group flex min-h-12 flex-1 items-center justify-center gap-3 px-5 font-display text-[10px] font-bold uppercase tracking-[0.16em] transition ${
              activeTab === 'record'
                ? 'border border-cyan-300/45 bg-cyan-300/[0.07] text-cyan-100 shadow-[inset_0_0_30px_rgba(34,211,238,.06)]'
                : 'border border-transparent text-white/38 hover:text-white/75'
            }`}
          >
            <History className="h-4 w-4" />
            Chroniques du Recordman
          </button>
        </nav>

        {activeTab === 'trophies' ? (
          <div className="space-y-12 pb-10">
            {COLLECTIONS.map((collection) => {
              const trophies = trophiesByCollection.get(collection.key) ?? [];
              const collectionUnlocked = trophies.filter((trophy) => trophy.unlocked).length;
              return (
                <section key={collection.key} className="profile-reveal">
                  <div className="mb-6 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-end">
                    <div>
                      <span className="font-display text-[9px] font-bold uppercase tracking-[0.28em] text-[#d6b35b]/60">
                        {collection.eyebrow}
                      </span>
                      <div className="mt-2 flex items-center gap-3">
                        <span className="flex h-10 w-10 rotate-45 items-center justify-center border border-[#b99046]/50 bg-[#0a1422] text-[#f1d488] shadow-[0_0_25px_rgba(214,179,91,.1)]">
                          <span className="-rotate-45">
                            <CollectionIcon collection={collection.key} />
                          </span>
                        </span>
                        <div>
                          <h2 className="font-display text-xl font-bold uppercase tracking-[0.08em] text-[#f4e6bc] md:text-2xl">
                            Collection {collection.label}
                          </h2>
                          <p className="mt-1 text-xs text-white/38">{collection.subtitle}</p>
                        </div>
                      </div>
                    </div>
                    <div className="hidden min-w-24 md:block">
                      <OrnamentalRule />
                    </div>
                    <div className="flex items-center justify-start gap-3 md:justify-end">
                      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/32">
                        Conquis
                      </span>
                      <strong className="font-display text-xl text-[#f1d488]">
                        {collectionUnlocked}
                        <span className="text-white/25"> / {trophies.length}</span>
                      </strong>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
                    {trophies.map((trophy, index) => (
                      <TrophyCard key={trophy.code} trophy={trophy} index={index} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <RecordHistory entries={data.recordHistory} />
        )}
      </div>
    </div>
  );
}

function ProfileStat({
  value,
  label,
  icon,
}: {
  value: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-[#050a13]/85 px-4 py-4 text-center">
      <div className="flex items-center justify-center gap-2 text-[#74bec7]">
        {icon}
        <strong className="font-display text-xl text-[#f4e6bc]">{value}</strong>
      </div>
      <p className="mt-1 text-[8px] font-bold uppercase tracking-[0.17em] text-white/30">
        {label}
      </p>
    </div>
  );
}

function RecordHistory({
  entries,
}: {
  entries: NonNullable<ReturnType<typeof useTrophyProfiles>['data']>['recordHistory'];
}) {
  return (
    <section className="profile-reveal relative overflow-hidden border border-[#b99046]/35 bg-[#030711] pb-2">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,.12),transparent_32%),linear-gradient(135deg,transparent,rgba(214,179,91,.035))]" />
      <span className="absolute left-4 top-4 h-16 w-16 border-l border-t border-[#f1d488]/45" />
      <span className="absolute right-4 top-4 h-16 w-16 border-r border-t border-[#f1d488]/45" />

      <div className="relative border-b border-[#b99046]/20 px-6 py-10 text-center md:px-10">
        <div className="mx-auto flex h-20 w-20 rotate-45 items-center justify-center border border-cyan-200/50 bg-cyan-300/[0.06] shadow-[0_0_45px_rgba(34,211,238,.24)]">
          <Crown className="h-9 w-9 -rotate-45 text-cyan-100" />
        </div>
        <p className="mt-8 font-display text-[9px] font-bold uppercase tracking-[0.34em] text-[#d6b35b]/70">
          Trophée vivant · Un seul détenteur
        </p>
        <h2 className="mt-3 font-display text-2xl font-bold uppercase tracking-[0.08em] text-[#f4e6bc] md:text-4xl">
          Chroniques du Recordman
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-white/45">
          Le record absolu change de main lorsqu’un commercial réalise le plus grand
          chiffre d’affaires mensuel de l’histoire LYFTT. Chaque règne reste gravé ici.
        </p>
      </div>

      <div className="relative mx-auto max-w-5xl px-5 py-8 md:px-10">
        {entries.length === 0 && (
          <div className="border border-dashed border-[#b99046]/30 px-6 py-16 text-center">
            <Medal className="mx-auto h-10 w-10 text-[#d6b35b]/45" />
            <p className="mt-5 font-display text-sm uppercase tracking-[0.12em] text-[#f4e6bc]/60">
              La première légende reste à écrire
            </p>
            <p className="mt-2 text-sm text-white/32">
              Le premier record apparaîtra dès qu’un mois signé sera disponible.
            </p>
          </div>
        )}
        <div className="relative">
          {entries.length > 0 && (
            <span className="absolute bottom-6 left-6 top-6 w-px bg-gradient-to-b from-cyan-300/70 via-[#d6b35b]/45 to-transparent sm:left-9" />
          )}
          {entries.map((entry, index) => {
            const current = index === 0 && !entry.relinquishedAt;
            return (
              <div
                key={`${entry.userRoleId}-${entry.acquiredAt}`}
                className={`relative mb-4 grid gap-4 border p-5 pl-16 transition duration-300 sm:grid-cols-[1fr_auto] sm:items-center sm:pl-20 ${
                  current
                    ? 'border-cyan-300/35 bg-cyan-300/[0.055] shadow-[0_0_55px_rgba(34,211,238,.07)]'
                    : 'border-white/[0.07] bg-white/[0.018]'
                }`}
              >
                <div
                  className={`absolute left-[11px] top-1/2 flex h-12 w-12 -translate-y-1/2 rotate-45 items-center justify-center border sm:left-[12px] sm:h-14 sm:w-14 ${
                    current
                      ? 'border-cyan-200/55 bg-[#071622] text-cyan-100 shadow-[0_0_25px_rgba(34,211,238,.25)]'
                      : 'border-[#b99046]/30 bg-[#080d16] text-[#d6b35b]/55'
                  }`}
                >
                  {current ? (
                    <Crown className="h-5 w-5 -rotate-45" />
                  ) : (
                    <Trophy className="h-5 w-5 -rotate-45" />
                  )}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="font-display text-sm font-bold uppercase tracking-[0.06em] text-[#f4e6bc]">
                      {[entry.firstName, entry.lastName].filter(Boolean).join(' ')}
                    </p>
                    {current && (
                      <span className="border border-cyan-300/30 bg-cyan-300/[0.08] px-2 py-1 text-[8px] font-bold uppercase tracking-[0.18em] text-cyan-100">
                        Détenteur actuel
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-white/36">
                    {new Date(entry.month).toLocaleDateString('fr-FR', {
                      month: 'long',
                      year: 'numeric',
                    })}{' '}
                    · acquis le {new Date(entry.acquiredAt).toLocaleDateString('fr-FR')}
                  </p>
                  {entry.relinquishedAt && (
                    <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-white/24">
                      Règne achevé le{' '}
                      {new Date(entry.relinquishedAt).toLocaleDateString('fr-FR')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 text-left sm:text-right">
                  <div>
                    <p
                      className={`font-display text-2xl font-bold ${
                        current ? 'text-cyan-100' : 'text-[#d6b35b]/75'
                      }`}
                    >
                      {formatEuro(entry.amount)}
                    </p>
                    <p className="mt-1 text-[8px] font-bold uppercase tracking-[0.16em] text-white/25">
                      {current ? 'Record à battre' : 'Ancien record'}
                    </p>
                  </div>
                  <ChevronRight
                    className={`h-5 w-5 ${current ? 'text-cyan-200' : 'text-white/15'}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
