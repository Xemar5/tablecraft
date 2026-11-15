import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

export type PanelName = 'library' | 'layers' | 'designerInspector' | 'playgroundInspector' | 'hand';
type Sizes = Record<PanelName, number>;
const defaults: Sizes = { library: 235, layers: 187, designerInspector: 250, playgroundInspector: 250, hand: 130 };
const minimum: Sizes = { library: 120, layers: 110, designerInspector: 150, playgroundInspector: 150, hand: 90 };
const maximum: Sizes = { library: 480, layers: 400, designerInspector: 480, playgroundInspector: 480, hand: 400 };
const storageKey = 'tablecraft.panel-sizes.v1';

export function clampPanel(value: number, min: number, max: number) {
  return Math.round(Math.max(min, Math.min(Math.max(min, max), value)));
}

function readSizes(): { sizes: Sizes; error?: string } {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { sizes: defaults };
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid panel sizes');
    const sizes = { ...defaults };
    for (const name of Object.keys(defaults) as PanelName[]) {
      const value = (saved as Record<string, unknown>)[name];
      if (value !== undefined) {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid panel size');
        sizes[name] = clampPanel(value, minimum[name], maximum[name]);
      }
    }
    return { sizes };
  } catch (error) {
    return { sizes: defaults, error: `Panel sizes couldn't be read and have not been overwritten. ${String(error)}` };
  }
}

// Keep preferred sizes independently of the temporary viewport-constrained sizes.
export function resolvePanelSizes(preferred: Sizes, width: number, height: number, mode: 'designer' | 'playground', libraryVisible: boolean, inspectorVisible: boolean) {
  const active: PanelName[] = [
    ...(libraryVisible ? ['library' as const] : []),
    ...(mode === 'designer' ? ['layers' as const, 'designerInspector' as const] : inspectorVisible ? ['playgroundInspector' as const] : []),
  ];
  const sizes = { ...preferred };
  const budget = Math.max(0, width - 200 - active.length * 6);
  let excess = active.reduce((sum, name) => sum + sizes[name], 0) - budget;
  for (const name of active) {
    const reduction = Math.min(Math.max(0, excess), sizes[name] - minimum[name]);
    sizes[name] -= reduction;
    excess -= reduction;
  }
  // Extremely narrow windows may not fit even the normal minimums.
  if (excess > 0) for (const name of active) {
    const reduction = Math.min(excess, Math.max(0, sizes[name] - 60));
    sizes[name] -= reduction;
    excess -= reduction;
  }
  sizes.hand = clampPanel(sizes.hand, minimum.hand, Math.min(maximum.hand, height - 270));
  const limits = {} as Record<PanelName, { min: number; max: number }>;
  for (const name of active) {
    const other = active.filter(item => item !== name).reduce((sum, item) => sum + sizes[item], 0);
    const max = Math.min(maximum[name], budget - other);
    limits[name] = { min: Math.min(minimum[name], Math.max(60, max)), max: Math.max(60, max) };
  }
  limits.hand = { min: minimum.hand, max: Math.max(minimum.hand, Math.min(maximum.hand, height - 270)) };
  return { sizes, limits };
}

export function usePanelLayout(mode: 'designer' | 'playground', libraryVisible: boolean, inspectorVisible: boolean, notify: (message: string, error?: boolean) => void) {
  const [initial] = useState(readSizes);
  const [preferred, setPreferred] = useState(initial.sizes);
  const [bounds, setBounds] = useState({ width: 1440, height: 900 });
  const container = useRef<HTMLElement>(null);
  const canWrite = useRef(!initial.error);
  useEffect(() => { if (initial.error) notify(initial.error, true); }, [initial.error, notify]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setBounds({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { sizes, limits } = resolvePanelSizes(preferred, bounds.width, bounds.height, mode, libraryVisible, inspectorVisible);
  const resize = (name: PanelName, value: number) => {
    const limit = limits[name];
    if (!limit) return;
    const next = { ...preferred, [name]: clampPanel(value, limit.min, limit.max) };
    setPreferred(next);
    if (!canWrite.current) return;
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch (error) { canWrite.current = false; notify(`Panel sizes couldn't be saved in this browser. ${String(error)}`, true); }
  };
  return { container, sizes, limits, resize };
}

type SeparatorProps = {
  label: string; controls: string; value: number; min: number; max: number;
  orientation?: 'vertical' | 'horizontal'; direction?: 1 | -1; onResize: (value: number) => void;
};
export function PanelSeparator({ label, controls, value, min, max, orientation = 'vertical', direction = 1, onResize }: SeparatorProps) {
  const drag = useRef<{ pointer: number; position: number; value: number }>(null);
  const position = (event: PointerEvent<HTMLDivElement>) => orientation === 'vertical' ? event.clientX : event.clientY;
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const increment = event.shiftKey ? 50 : 10;
    const positive = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    const negative = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    if (event.key === positive || event.key === negative) {
      event.preventDefault();
      onResize(value + (event.key === positive ? 1 : -1) * direction * increment);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); onResize(event.key === 'Home' ? min : max);
    }
  };
  return <div className={`panel-separator ${orientation}`} role="separator" aria-label={label} aria-controls={controls}
    aria-orientation={orientation} aria-valuenow={Math.round(value)} aria-valuemin={Math.round(min)} aria-valuemax={Math.round(max)}
    tabIndex={0} onKeyDown={keyDown}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag.current = { pointer: event.pointerId, position: position(event), value };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (start?.pointer === event.pointerId) onResize(start.value + (position(event) - start.position) * direction);
    }}
    onPointerUp={event => { if (drag.current?.pointer === event.pointerId) drag.current = null; }}
    onPointerCancel={() => { drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }} />;
}
