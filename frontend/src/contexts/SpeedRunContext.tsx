import { createContext, useContext, useState, type ReactNode } from 'react';

// Contexte global pour le Speed Run : monté au-dessus de <Routes> (dans App.tsx)
// pour que la session (file d'appels, index, stats...) ne soit JAMAIS démontée
// quand on change de page — seul le composant <SpeedRun> lit cet état pour
// savoir s'il doit s'afficher plein écran, réduit en pastille, ou pas du tout.
interface SpeedRunContextType {
  isOpen: boolean;
  minimized: boolean;
  open: () => void;
  close: () => void;
  minimize: () => void;
  maximize: () => void;
}

const SpeedRunContext = createContext<SpeedRunContextType | null>(null);

export function useSpeedRun() {
  const ctx = useContext(SpeedRunContext);
  if (!ctx) throw new Error('useSpeedRun doit être utilisé dans un SpeedRunProvider');
  return ctx;
}

export function SpeedRunProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const value: SpeedRunContextType = {
    isOpen,
    minimized,
    open: () => { setIsOpen(true); setMinimized(false); },
    close: () => { setIsOpen(false); setMinimized(false); },
    minimize: () => setMinimized(true),
    maximize: () => setMinimized(false),
  };

  return <SpeedRunContext.Provider value={value}>{children}</SpeedRunContext.Provider>;
}
