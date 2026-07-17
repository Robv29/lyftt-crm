interface LoadingSpinnerProps {
  message?: string;
  compact?: boolean;
}

export default function LoadingSpinner({
  message = 'Chargement...',
  compact = false,
}: LoadingSpinnerProps) {
  if (compact) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-[#6AABB4] border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-400">{message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-3 border-[#6AABB4] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-400">{message}</p>
      </div>
    </div>
  );
}