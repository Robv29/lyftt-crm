import { createClient } from '@supabase/supabase-js';

// La clé ANON est PUBLIQUE par nature (elle est de toute façon incluse dans le
// bundle du navigateur). La sécurité repose sur les policies RLS de Supabase.
// On l'utilise en valeur par défaut pour que l'app fonctionne même sans variable
// d'environnement configurée. Les variables Vite restent prioritaires si définies.
const FALLBACK_URL = 'https://cobzfojmxtobrbgzconr.supabase.co';
const FALLBACK_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvYnpmb2pteHRvYnJiZ3pjb25yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNzM2NjMsImV4cCI6MjA5OTg0OTY2M30.kl6-6cAr4WIbwDoP7XRPSz_TYmI426yaZ2QcfW81kLs';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || FALLBACK_URL;
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || FALLBACK_ANON;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
