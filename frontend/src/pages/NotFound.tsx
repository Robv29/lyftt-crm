import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-4">
        <h1 className="text-6xl font-bold text-slate-300">404</h1>
        <p className="text-lg text-slate-500">Page introuvable</p>
        <Link to="/">
          <Button className="gap-2 bg-blue-600 hover:bg-blue-700 text-white mt-4">
            <Home className="w-4 h-4" />
            Retour au tableau de bord
          </Button>
        </Link>
      </div>
    </div>
  );
}