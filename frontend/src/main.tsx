import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import ErrorBoundary from './components/ErrorBoundary.tsx';

// Le backend applicatif est Supabase (PostgREST + Auth) : il n'y a pas de
// config runtime à charger depuis un serveur maison, donc pas d'étape async
// avant le premier rendu (ancien appel à /api/config supprimé — ce endpoint
// n'a jamais existé côté Supabase et échouait silencieusement à chaque
// démarrage).
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);