import { useEffect, useState } from 'react';

/**
 * Effets de célébration réutilisables : confettis (appel répondu) et
 * feu d'artifice de billets (visio décrochée). Purement CSS/JS, sans
 * dépendance externe. Se déclenchent en passant un `id` incrémental —
 * chaque nouvel id relance l'animation.
 */

const CONFETTI_COLORS = ['#fbbf24', '#f97316', '#ec4899', '#10b981', '#6AABB4', '#8b5cf6', '#3b82f6'];

export function ConfettiBurst({ id }: { id: number }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!id) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), 1500);
    return () => clearTimeout(t);
  }, [id]);

  if (!show) return null;

  const pieces = Array.from({ length: 70 });

  return (
    <div className="fixed inset-0 pointer-events-none z-[200] overflow-hidden">
      <style>{`
        .confetti-piece { position: absolute; top: -6%; border-radius: 2px; opacity: 0; animation-name: confetti-fall; animation-timing-function: cubic-bezier(.15,.6,.4,1); animation-fill-mode: forwards; }
        @keyframes confetti-fall {
          0% { opacity: 1; transform: translate(0,0) rotate(0deg); }
          100% { opacity: 0; transform: translate(var(--drift), 108vh) rotate(560deg); }
        }
      `}</style>
      {pieces.map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.3;
        const duration = 1 + Math.random() * 0.9;
        const size = 6 + Math.random() * 7;
        const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        const rotate = Math.random() * 360;
        const drift = (Math.random() - 0.5) * 220;
        return (
          <span
            key={`${id}-${i}`}
            className="confetti-piece"
            style={{
              left: `${left}%`,
              width: size,
              height: size * 0.4,
              background: color,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
              transform: `rotate(${rotate}deg)`,
              ['--drift' as string]: `${drift}px`,
            } as React.CSSProperties}
          />
        );
      })}
    </div>
  );
}

export function MoneyFireworks({ id }: { id: number }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!id) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), 1900);
    return () => clearTimeout(t);
  }, [id]);

  if (!show) return null;

  const bursts = Array.from({ length: 4 });

  return (
    <div className="fixed inset-0 pointer-events-none z-[200] overflow-hidden">
      <style>{`
        .money-piece { position: absolute; font-size: 24px; opacity: 0; animation: money-burst 1.4s cubic-bezier(.15,.6,.4,1) forwards; will-change: transform, opacity; }
        @keyframes money-burst {
          0% { opacity: 1; transform: translate(0,0) scale(.3) rotate(0deg); }
          65% { opacity: 1; }
          100% { opacity: 0; transform: translate(var(--dx), calc(var(--dy) + 90px)) scale(1.15) rotate(400deg); }
        }
        .money-glow { position: absolute; inset: 0; background: radial-gradient(circle, rgba(16,185,129,.25), transparent 60%); animation: money-glow-fade 1s ease-out forwards; }
        @keyframes money-glow-fade { from { opacity: 1 } to { opacity: 0 } }
      `}</style>
      <div className="money-glow" />
      {bursts.map((_, b) => {
        const cx = 18 + Math.random() * 64;
        const cy = 18 + Math.random() * 40;
        const particles = Array.from({ length: 14 });
        return (
          <div key={`${id}-${b}`} style={{ position: 'absolute', left: `${cx}%`, top: `${cy}%` }}>
            {particles.map((_, i) => {
              const angle = (i / particles.length) * Math.PI * 2 + Math.random() * 0.4;
              const dist = 60 + Math.random() * 70;
              const dx = Math.cos(angle) * dist;
              const dy = Math.sin(angle) * dist;
              const delay = b * 0.15 + Math.random() * 0.12;
              const emoji = i % 3 === 0 ? '🎉' : '💵';
              return (
                <span
                  key={i}
                  className="money-piece"
                  style={{
                    animationDelay: `${delay}s`,
                    ['--dx' as string]: `${dx}px`,
                    ['--dy' as string]: `${dy}px`,
                  } as React.CSSProperties}
                >
                  {emoji}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
