import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw, WifiOff } from 'lucide-react';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
}

export default function ErrorState({
  message = 'Erreur lors du chargement des données.',
  onRetry,
  retrying = false,
}: ErrorStateProps) {
  const isNetworkError =
    message.toLowerCase().includes('network') ||
    message.toLowerCase().includes('fetch') ||
    message.toLowerCase().includes('timeout') ||
    message.toLowerCase().includes('connexion');

  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-4 text-center max-w-md px-4">
        <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center">
          {isNetworkError ? (
            <WifiOff className="w-7 h-7 text-red-400" />
          ) : (
            <AlertCircle className="w-7 h-7 text-red-400" />
          )}
        </div>
        <div>
          <p className="text-sm font-medium text-slate-700">{message}</p>
          <p className="text-xs text-slate-400 mt-1.5">
            {isNetworkError
              ? 'Vérifiez votre connexion internet et réessayez.'
              : 'Le serveur a rencontré un problème. Réessayez dans quelques instants.'}
          </p>
        </div>
        {onRetry && (
          <Button
            onClick={onRetry}
            disabled={retrying}
            variant="outline"
            className="gap-2 rounded-xl border-slate-200 hover:bg-slate-50"
          >
            <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
            {retrying ? 'Chargement...' : 'Réessayer'}
          </Button>
        )}
      </div>
    </div>
  );
}