import { useMemo, useState } from 'react';
import {
  Check, Crown, History, LockKeyhole, Shield, Sparkles, Trophy, Zap,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  useSetMyAvatar, useTrophyProfiles, type CommercialTrophy,
  type TrophyCollection, type TrophyRarity,
} from '../hooks/use-prospects';
import ErrorState from '../components/ErrorState';
import LoadingSpinner from '../components/LoadingSpinner';
import { usePersistentState } from '../hooks/use-persistent-state';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

const AVATARS = [
  { key: 'summit', name: 'Alpiniste', glyph: '🧗', gradient: 'from-cyan-500 to-blue-700' },
  { key: 'navigator', name: 'Navigateur', glyph: '🧭', gradient: 'from-sky-500 to-indigo-700' },
  { key: 'closer', name: 'Closer', glyph: '🎯', gradient: 'from-violet-500 to-purple-800' },
  { key: 'vanguard', name: 'Avant-garde', glyph: '⚔️', gradient: 'from-amber-400 to-orange-700' },
  { key: 'strategist', name: 'Stratège', glyph: '♟️', gradient: 'from-emerald-400 to-teal-700' },
  { key: 'ace', name: 'As', glyph: '🂡', gradient: 'from-rose-500 to-red-800' },
] as const;

const COLLECTIONS: Array<{ key: TrophyCollection; label: string; subtitle: string }> = [
  { key: 'closing', label: 'Closing', subtitle: 'La maîtrise de la signature' },
  { key: 'revenue', label: "Chiffre d'affaires", subtitle: 'La montée en puissance' },
  { key: 'regularity', label: 'Régularité', subtitle: "L'excellence sur une année civile" },
  { key: 'special', label: 'Trophées spéciaux', subtitle: 'Les distinctions les plus rares' },
];

const RARITY: Record<TrophyRarity, { label: string; cup: string; glow: string; border: string }> = {
  bronze: { label: 'Bronze', cup: 'from-amber-300 via-orange-500 to-amber-800', glow: 'shadow-orange-500/20', border: 'border-orange-400/25' },
  silver: { label: 'Argent', cup: 'from-white via-slate-300 to-slate-500', glow: 'shadow-slate-300/20', border: 'border-slate-300/25' },
  gold: { label: 'Or', cup: 'from-yellow-100 via-amber-400 to-yellow-700', glow: 'shadow-amber-400/25', border: 'border-amber-300/30' },
  epic: { label: 'Épique', cup: 'from-fuchsia-200 via-violet-500 to-purple-900', glow: 'shadow-violet-500/30', border: 'border-violet-400/30' },
  legendary: { label: 'Légendaire', cup: 'from-amber-100 via-orange-500 to-red-700', glow: 'shadow-orange-500/35', border: 'border-orange-400/35' },
  mythic: { label: 'Mythique', cup: 'from-cyan-100 via-violet-400 to-fuchsia-700', glow: 'shadow-violet-400/40', border: 'border-violet-300/40' },
};

const formatNumber = (value: number) => new Intl.NumberFormat('fr-FR').format(Math.round(value));
const formatEuro = (value: number) => `${formatNumber(value)} €`;

function progressLabel(trophy: CommercialTrophy) {
  const current = Math.min(trophy.progress, trophy.threshold);
  if (trophy.code.startsWith('revenue_') || trophy.code === 'special_recordman') {
    return `${formatEuro(current)} / ${formatEuro(trophy.threshold)}`;
  }
  if (trophy.code.startsWith('regularity_')) return `${formatNumber(current)} / ${formatNumber(trophy.threshold)} mois`;
  if (trophy.code.startsWith('closing_')) return `${formatNumber(current)} / ${formatNumber(trophy.threshold)} contrats`;
  return trophy.unlocked ? 'Débloqué' : 'Pas encore débloqué';
}

function Cup({ trophy }: { trophy: CommercialTrophy }) {
  const rarity = RARITY[trophy.rarity];
  return (
    <div className={`relative flex h-28 w-28 items-center justify-center rounded-[2rem] border ${trophy.unlocked ? `${rarity.border} bg-white/[0.06] shadow-2xl ${rarity.glow}` : 'border-white/[0.07] bg-white/[0.025]'}`}>
      {trophy.unlocked && <div className={`absolute inset-3 rounded-full bg-gradient-to-br ${rarity.cup} opacity-20 blur-xl`} />}
      <Trophy
        strokeWidth={1.5}
        className={`relative h-20 w-20 transition duration-300 ${
          trophy.unlocked
            ? `bg-gradient-to-br ${rarity.cup} drop-shadow-xl`
            : 'text-slate-600 grayscale'
        }`}
        style={trophy.unlocked ? { color: trophy.rarity === 'gold' ? '#fbbf24' : trophy.rarity === 'mythic' ? '#c084fc' : undefined } : undefined}
      />
      {!trophy.unlocked && (
        <span className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-[#090f1e]">
          <LockKeyhole className="h-4 w-4 text-slate-500" />
        </span>
      )}
      {trophy.dynamic && trophy.unlocked && (
        <span className="absolute -right-2 -top-2 rounded-full border border-cyan-300/30 bg-cyan-400/15 p-2 text-cyan-200">
          <Zap className="h-4 w-4" />
        </span>
      )}
    </div>
  );
}

function TrophyCard({ trophy }: { trophy: CommercialTrophy }) {
  const rarity = RARITY[trophy.rarity];
  const percent = trophy.threshold > 0 ? Math.min(100, (trophy.progress / trophy.threshold) * 100) : 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <article className={`group relative min-h-[280px] overflow-hidden rounded-3xl border p-5 transition duration-300 hover:-translate-y-1 ${
          trophy.unlocked
            ? `${rarity.border} bg-gradient-to-b from-white/[0.075] to-white/[0.025]`
            : 'border-white/[0.07] bg-white/[0.018]'
        }`}>
          {trophy.unlocked && <div className={`absolute -right-12 -top-12 h-36 w-36 rounded-full bg-gradient-to-br ${rarity.cup} opacity-10 blur-3xl`} />}
          <div className="relative flex flex-col items-center text-center">
            <Cup trophy={trophy} />
            <span className={`mt-4 text-[10px] font-black uppercase tracking-[0.2em] ${trophy.unlocked ? 'text-white/55' : 'text-slate-600'}`}>
              {rarity.label}{trophy.dynamic ? ' · Trophée vivant' : ''}
            </span>
            <h3 className={`mt-2 text-base font-black ${trophy.unlocked ? 'text-white' : 'text-slate-500'}`}>{trophy.name}</h3>
            <p className={`mt-2 line-clamp-2 text-xs leading-5 ${trophy.unlocked ? 'text-white/50' : 'text-slate-600'}`}>{trophy.description}</p>
            <div className="mt-4 w-full">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div className={`h-full rounded-full transition-all duration-700 ${trophy.unlocked ? 'bg-gradient-to-r from-[#5A9BA3] to-violet-500' : 'bg-slate-700'}`} style={{ width: `${percent}%` }} />
              </div>
              <div className={`mt-2 text-[10px] font-bold ${trophy.unlocked ? 'text-white/45' : 'text-slate-600'}`}>{progressLabel(trophy)}</div>
            </div>
          </div>
        </article>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] border-white/10 bg-[#0b1324] p-4 text-white shadow-2xl">
        <p className="font-bold">{trophy.unlocked ? `${trophy.name} débloqué` : `Comment obtenir ${trophy.name} ?`}</p>
        <p className="mt-1 text-xs leading-5 text-white/65">{trophy.description}</p>
        <p className="mt-2 text-xs font-semibold text-[#6AABB4]">Progression : {progressLabel(trophy)}</p>
        {trophy.dynamic && <p className="mt-2 text-[11px] text-violet-300">Unique : il est transféré dès qu’un meilleur record est réalisé.</p>}
      </TooltipContent>
    </Tooltip>
  );
}

export default function Profile() {
  const { userRole, isAdmin } = useAuth();
  const { data, isLoading, error } = useTrophyProfiles();
  const setAvatar = useSetMyAvatar();
  const [selectedProfileId, setSelectedProfileId] = usePersistentState<number | null>('lyftt.profil.commercial', null);
  const [activeTab, setActiveTab] = usePersistentState<'trophies' | 'record'>('lyftt.profil.onglet', 'trophies');
  const [avatarOpen, setAvatarOpen] = useState(false);

  const ownProfile = data?.profiles.find((profile) => profile.userRoleId === userRole?.id);
  const activeProfile = data?.profiles.find((profile) => profile.userRoleId === selectedProfileId) ?? ownProfile ?? data?.profiles[0];
  const selectedAvatar = AVATARS.find((avatar) => avatar.key === activeProfile?.avatarKey) ?? AVATARS[0];
  const unlocked = activeProfile?.trophies.filter((trophy) => trophy.unlocked).length ?? 0;
  const completion = activeProfile?.trophies.length ? Math.round((unlocked / activeProfile.trophies.length) * 100) : 0;

  const trophiesByCollection = useMemo(() => {
    const map = new Map<TrophyCollection, CommercialTrophy[]>();
    for (const collection of COLLECTIONS) map.set(collection.key, []);
    for (const trophy of activeProfile?.trophies ?? []) map.get(trophy.collection)?.push(trophy);
    return map;
  }, [activeProfile]);

  const changeAvatar = async (key: string) => {
    if (activeProfile?.userRoleId !== userRole?.id) return;
    try {
      await setAvatar.mutateAsync(key);
      setAvatarOpen(false);
      toast.success('Personnage mis à jour');
    } catch {
      toast.error("Impossible de modifier le personnage");
    }
  };

  if (isLoading) return <div className="flex h-80 items-center justify-center"><LoadingSpinner /></div>;
  if (error || !activeProfile) return <ErrorState message="Impossible de charger les trophées du profil." />;

  const fullName = `${activeProfile.firstName ?? ''} ${activeProfile.lastName ?? ''}`.trim() || 'Commercial LYFTT';
  const isOwnProfile = activeProfile.userRoleId === userRole?.id;

  return (
    <div className="-m-4 min-h-[calc(100vh-3.5rem)] bg-[radial-gradient(circle_at_70%_0%,rgba(124,58,237,.16),transparent_28%),linear-gradient(145deg,#040814,#071322_52%,#040814)] p-4 text-white sm:-m-6 sm:p-6 lg:-m-8 lg:min-h-screen lg:p-8">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <header className="flex flex-col gap-4 border-b border-white/[0.08] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-3 text-xs font-black uppercase tracking-[0.22em] text-[#6AABB4]">
              <Shield className="h-4 w-4" /> Profil commercial
            </div>
            <h1 className="mt-2 text-3xl font-black tracking-[-0.045em]">MON PROFIL</h1>
            <p className="mt-1 text-sm text-white/45">Votre identité, vos exploits et les prochains sommets à atteindre.</p>
          </div>
          {isAdmin && (
            <select
              value={activeProfile.userRoleId}
              onChange={(event) => setSelectedProfileId(Number(event.target.value))}
              className="h-11 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-white outline-none"
            >
              {data.profiles.map((profile) => (
                <option key={profile.userRoleId} value={profile.userRoleId} className="bg-slate-900">
                  {[profile.firstName, profile.lastName].filter(Boolean).join(' ') || `Commercial ${profile.userRoleId}`}
                </option>
              ))}
            </select>
          )}
        </header>

        <section className="relative overflow-hidden rounded-[2rem] border border-white/[0.09] bg-white/[0.035] p-5 shadow-2xl shadow-black/25 md:p-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,rgba(90,155,163,.16),transparent_26%),radial-gradient(circle_at_80%_20%,rgba(124,58,237,.18),transparent_30%)]" />
          <div className="relative grid gap-7 lg:grid-cols-[210px_1fr_300px] lg:items-center">
            <div className="relative">
              <button
                onClick={() => isOwnProfile && setAvatarOpen((value) => !value)}
                className={`relative flex h-48 w-full items-center justify-center overflow-hidden rounded-[2rem] border border-white/15 bg-gradient-to-br ${selectedAvatar.gradient} shadow-2xl sm:w-48`}
              >
                <span className="text-7xl drop-shadow-2xl">{selectedAvatar.glyph}</span>
                {isOwnProfile && <span className="absolute bottom-3 rounded-full bg-black/35 px-3 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur">Changer</span>}
              </button>
              {avatarOpen && isOwnProfile && (
                <div className="absolute left-0 top-[calc(100%+10px)] z-30 grid w-[310px] grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-[#091222] p-3 shadow-2xl">
                  {AVATARS.map((avatar) => (
                    <button key={avatar.key} onClick={() => changeAvatar(avatar.key)} className={`rounded-xl border p-3 text-center transition hover:bg-white/[0.06] ${activeProfile.avatarKey === avatar.key ? 'border-[#6AABB4]' : 'border-white/[0.07]'}`}>
                      <span className="text-3xl">{avatar.glyph}</span>
                      <span className="mt-1 block text-[9px] font-bold text-white/55">{avatar.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <span className="text-xs font-black uppercase tracking-[0.18em] text-white/40">{selectedAvatar.name}</span>
              <h2 className="mt-2 text-4xl font-black tracking-[-0.05em] md:text-5xl">{fullName}</h2>
              <div className="mt-5 flex flex-wrap gap-2">
                <span className="rounded-full border border-[#6AABB4]/25 bg-[#6AABB4]/10 px-3 py-1.5 text-xs font-bold text-[#9bd0d6]">{unlocked} trophées débloqués</span>
                <span className="rounded-full border border-violet-400/25 bg-violet-500/10 px-3 py-1.5 text-xs font-bold text-violet-300">{completion} % complété</span>
              </div>
              <div className="mt-6 max-w-xl">
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-white/40"><span>Collection globale</span><span>{unlocked} / {activeProfile.trophies.length}</span></div>
                <div className="mt-2 h-3 overflow-hidden rounded-full bg-black/30">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#5A9BA3] via-[#6AABB4] to-violet-500 shadow-[0_0_20px_rgba(106,171,180,.35)]" style={{ width: `${completion}%` }} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Stat value={String(unlocked)} label="Débloqués" icon={<Check className="h-4 w-4" />} />
              <Stat value={String(activeProfile.trophies.length - unlocked)} label="À conquérir" icon={<LockKeyhole className="h-4 w-4" />} />
              <Stat value={String(trophiesByCollection.get('special')?.filter((t) => t.unlocked).length ?? 0)} label="Spéciaux" icon={<Sparkles className="h-4 w-4" />} />
              <Stat value={`${completion}%`} label="Progression" icon={<Crown className="h-4 w-4" />} />
            </div>
          </div>
        </section>

        <div className="flex gap-2 overflow-x-auto rounded-2xl border border-white/[0.08] bg-white/[0.025] p-1.5">
          <button onClick={() => setActiveTab('trophies')} className={`flex h-10 items-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-bold ${activeTab === 'trophies' ? 'bg-[#5A9BA3] text-white' : 'text-white/45 hover:text-white'}`}><Trophy className="h-4 w-4" /> Trophées</button>
          <button onClick={() => setActiveTab('record')} className={`flex h-10 items-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-bold ${activeTab === 'record' ? 'bg-violet-600 text-white' : 'text-white/45 hover:text-white'}`}><History className="h-4 w-4" /> Histoire du Recordman</button>
        </div>

        {activeTab === 'trophies' ? (
          <div className="space-y-7">
            {COLLECTIONS.map((collection) => (
              <section key={collection.key}>
                <div className="mb-4 flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-black uppercase tracking-[0.08em]">Collection {collection.label}</h2>
                    <p className="mt-1 text-xs text-white/40">{collection.subtitle}</p>
                  </div>
                  <span className="text-xs font-bold text-white/35">{trophiesByCollection.get(collection.key)?.filter((t) => t.unlocked).length ?? 0} / {trophiesByCollection.get(collection.key)?.length ?? 0}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
                  {trophiesByCollection.get(collection.key)?.map((trophy) => <TrophyCard key={trophy.code} trophy={trophy} />)}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <RecordHistory entries={data.recordHistory} />
        )}
      </div>
    </div>
  );
}

function Stat({ value, label, icon }: { value: string; label: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-black/15 p-4">
      <div className="flex items-center gap-2 text-[#6AABB4]">{icon}<strong className="text-xl text-white">{value}</strong></div>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-white/35">{label}</p>
    </div>
  );
}

function RecordHistory({ entries }: { entries: NonNullable<ReturnType<typeof useTrophyProfiles>['data']>['recordHistory'] }) {
  return (
    <section className="overflow-hidden rounded-[2rem] border border-violet-400/20 bg-white/[0.03]">
      <div className="border-b border-white/[0.08] p-6">
        <div className="flex items-center gap-3"><Crown className="h-6 w-6 text-violet-300" /><h2 className="text-xl font-black">LA CEINTURE RECORDMAN</h2></div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">Un seul détenteur à la fois. Le trophée change automatiquement de profil lorsqu’un commercial bat le record historique de CA signé sur un mois.</p>
      </div>
      <div className="divide-y divide-white/[0.07]">
        {entries.length === 0 && <p className="p-8 text-center text-sm text-white/40">Le premier record apparaîtra dès qu’un mois signé sera disponible.</p>}
        {entries.map((entry, index) => (
          <div key={`${entry.userRoleId}-${entry.acquiredAt}`} className="grid gap-3 p-5 sm:grid-cols-[52px_1fr_auto] sm:items-center">
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${index === 0 && !entry.relinquishedAt ? 'bg-violet-500/20 text-violet-200' : 'bg-white/[0.05] text-white/35'}`}>{index === 0 && !entry.relinquishedAt ? <Crown className="h-5 w-5" /> : <Trophy className="h-5 w-5" />}</div>
            <div>
              <p className="font-bold">{[entry.firstName, entry.lastName].filter(Boolean).join(' ')}</p>
              <p className="mt-1 text-xs text-white/40">{new Date(entry.month).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })} · acquis le {new Date(entry.acquiredAt).toLocaleDateString('fr-FR')}</p>
              {entry.relinquishedAt && <p className="mt-1 text-[11px] text-white/30">Conservé jusqu’au {new Date(entry.relinquishedAt).toLocaleDateString('fr-FR')}</p>}
            </div>
            <div className="text-left sm:text-right"><p className="text-2xl font-black text-violet-300">{formatEuro(entry.amount)}</p><p className="text-[10px] font-bold uppercase tracking-wider text-white/30">{!entry.relinquishedAt ? 'Détenteur actuel' : 'Ancien record'}</p></div>
          </div>
        ))}
      </div>
    </section>
  );
}
