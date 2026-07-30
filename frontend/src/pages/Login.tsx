import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

type Mode = 'signin' | 'signup';

export default function Login() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Déjà connecté -> on renvoie vers le tableau de bord
  useEffect(() => {
    if (!authLoading && user) navigate('/', { replace: true });
  }, [authLoading, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error('Email et mot de passe requis');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        navigate('/', { replace: true });
      } else {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { first_name: firstName.trim(), last_name: lastName.trim() } },
        });
        if (error) throw error;
        toast.success('Compte créé. Vérifie tes emails si une confirmation est demandée.');
        navigate('/', { replace: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Échec de la connexion';
      toast.error(
        msg === 'Invalid login credentials' ? 'Identifiants incorrects' : msg
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#eef4f4] px-4 flex items-center justify-center">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_12%,rgba(90,155,163,.12),transparent_26rem),radial-gradient(circle_at_12%_88%,rgba(185,144,70,.07),transparent_22rem)]" />
      <div className="relative w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="rounded-2xl border border-white/80 bg-white p-2 shadow-[0_16px_40px_-24px_rgba(15,40,48,.4)]">
            <img src="/assets/lyftt-logo.png" alt="LYFTT" className="h-14 w-14 rounded-xl" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-[#16313a]">LYFTT CRM</h1>
          <p className="text-sm text-slate-500">Pilotage commercial</p>
        </div>

        <div className="relative overflow-hidden bg-white rounded-2xl shadow-[0_24px_70px_-42px_rgba(15,40,48,.45)] border border-[#d7e4e5] p-6">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#b99046]/70 to-transparent" />
          <div className="flex gap-1 p-1 bg-[#edf4f4] rounded-lg mb-6">
            <button
              type="button"
              onClick={() => setMode('signin')}
              className={`flex-1 text-sm font-medium py-2 rounded-md transition ${
                mode === 'signin' ? 'bg-white shadow-sm text-[#16313a]' : 'text-slate-500'
              }`}
            >
              Connexion
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`flex-1 text-sm font-medium py-2 rounded-md transition ${
                mode === 'signup' ? 'bg-white shadow-sm text-[#16313a]' : 'text-slate-500'
              }`}
            >
              Créer un compte
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">Prénom</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Robin"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">Nom</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Vergnes"
                  />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="robin@vgs-autos.fr"
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
            </div>

            <Button
              type="submit"
              disabled={submitting}
              className="w-full"
            >
              {submitting
                ? 'Veuillez patienter…'
                : mode === 'signin'
                  ? 'Se connecter'
                  : 'Créer mon compte'}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Accès réservé à l'équipe LYFTT
        </p>
      </div>
    </div>
  );
}
