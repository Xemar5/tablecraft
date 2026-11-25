import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cssPx } from './uiScale';
// The windows' and button pieces' styles load with the app, before the editors themselves.
import './scripting.css';

type Rect = { x: number; y: number; width: number; height: number };
const EDGE = 8, HEADER = 40;
let topLayer = 900;

const viewport = () => ({ width: cssPx(window.innerWidth), height: cssPx(window.innerHeight) });
/** Keeps a window inside the page, with at least its title bar reachable. */
function fit(rect: Rect, minWidth: number, minHeight: number): Rect {
  const { width, height } = viewport();
  const w = Math.max(minWidth, Math.min(rect.width, width - EDGE * 2)), h = Math.max(minHeight, Math.min(rect.height, height - EDGE * 2));
  return { width: w, height: h, x: Math.max(EDGE, Math.min(rect.x, width - w - EDGE)), y: Math.max(EDGE, Math.min(rect.y, height - HEADER - EDGE)) };
}

/**
 * A movable, resizable window over the workspace that stays open while you play (the script editor and the memory
 * editor). Its place and size are remembered per browser. It is not a dialog: the table keeps its shortcuts, except
 * while typing inside the window.
 */
export function FloatingWindow({ id, title, icon, actions, onClose, children, initial, minWidth = 340, minHeight = 220 }: {
  id: string; title: string; icon?: ReactNode; actions?: ReactNode; onClose: () => void; children: ReactNode;
  initial: (page: { width: number; height: number }) => Rect; minWidth?: number; minHeight?: number;
}) {
  const key = `tablecraft.window.${id}`;
  const [rect, setRect] = useState<Rect>(() => {
    let saved: Rect | undefined;
    try { saved = JSON.parse(localStorage.getItem(key) ?? 'null') ?? undefined; } catch { /* ignore a broken entry */ }
    const valid = saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite);
    return fit(valid ? saved! : initial(viewport()), minWidth, minHeight);
  });
  const [layer, setLayer] = useState(() => ++topLayer);
  const gesture = useRef<{ pointer: number; x: number; y: number; start: Rect; mode: 'move' | 'right' | 'bottom' | 'corner' } | null>(null);
  const raise = useCallback(() => setLayer(current => current === topLayer ? current : ++topLayer), []);
  useEffect(() => {
    const resized = () => setRect(current => fit(current, minWidth, minHeight));
    window.addEventListener('resize', resized);
    return () => window.removeEventListener('resize', resized);
  }, [minWidth, minHeight]);
  useLayoutEffect(() => {
    const timer = window.setTimeout(() => { try { localStorage.setItem(key, JSON.stringify(rect)); } catch { /* storage full or blocked */ } }, 250);
    return () => window.clearTimeout(timer);
  }, [key, rect]);
  const start = (mode: 'move' | 'right' | 'bottom' | 'corner') => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (mode === 'move' && (event.target as HTMLElement).closest('button, input, select, textarea'))) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, start: rect, mode };
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId) return;
    const dx = cssPx(event.clientX - g.x), dy = cssPx(event.clientY - g.y);
    const next = g.mode === 'move' ? { ...g.start, x: g.start.x + dx, y: g.start.y + dy }
      : { ...g.start, width: g.start.width + (g.mode === 'bottom' ? 0 : dx), height: g.start.height + (g.mode === 'right' ? 0 : dy) };
    setRect(fit(next, minWidth, minHeight));
  };
  const end = (event: ReactPointerEvent<HTMLElement>) => { if (gesture.current?.pointer === event.pointerId) gesture.current = null; };
  const handlers = (mode: 'move' | 'right' | 'bottom' | 'corner') => ({ onPointerDown: start(mode), onPointerMove: move, onPointerUp: end, onPointerCancel: end });
  return <section className="floating-window" role="region" aria-label={title} data-window={id}
    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: layer }} onPointerDownCapture={raise} onFocusCapture={raise}>
    <header className="floating-window-header" {...handlers('move')}>
      <h2>{icon}{title}</h2>
      <div className="floating-window-actions">{actions}<button className="icon-button" aria-label={`Close ${title}`} title="Close" onClick={onClose}><X size={15} /></button></div>
    </header>
    <div className="floating-window-body">{children}</div>
    <div className="floating-window-resize resize-right" aria-hidden="true" {...handlers('right')} />
    <div className="floating-window-resize resize-bottom" aria-hidden="true" {...handlers('bottom')} />
    <div className="floating-window-resize resize-corner" aria-hidden="true" {...handlers('corner')} />
  </section>;
}
