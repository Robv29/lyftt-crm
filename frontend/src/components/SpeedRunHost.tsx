import { useSpeedRun } from '../contexts/SpeedRunContext';
import SpeedRun from './SpeedRun';

// Rendu au-dessus de <Routes> dans App.tsx : reste monté quelle que soit la
// page affichée, donc la session Speed Run (file d'appels, index, stats)
// survit à toute navigation. Ne rend rien tant que la session n'est pas
// ouverte.
export default function SpeedRunHost() {
  const { isOpen, minimized, close, minimize, maximize } = useSpeedRun();
  if (!isOpen) return null;
  return <SpeedRun onClose={close} minimized={minimized} onMinimize={minimize} onMaximize={maximize} />;
}
