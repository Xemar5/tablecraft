import { X, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { cloneElement, isValidElement, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

export function useSmoothHorizontalWheel(target: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    let frame: number | undefined, destination = element.scrollLeft, previous = 0;
    const stop = () => { if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined; };
    const tick = (now: number) => {
      const elapsed = Math.min(now - previous, 50);
      previous = now;
      destination = Math.max(0, Math.min(destination, element.scrollWidth - element.clientWidth));
      const distance = destination - element.scrollLeft;
      element.scrollLeft = Math.abs(distance) <= 1 ? destination : element.scrollLeft + distance * (1 - Math.exp(-elapsed / 55));
      if (Math.abs(destination - element.scrollLeft) <= 1) { element.scrollLeft = destination; frame = undefined; }
      else frame = requestAnimationFrame(tick);
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || element.scrollWidth <= element.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      event.preventDefault();
      const amount = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1);
      destination = Math.max(0, Math.min((frame === undefined ? element.scrollLeft : destination) + amount, element.scrollWidth - element.clientWidth));
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { stop(); element.scrollLeft = destination; }
      else if (frame === undefined) { previous = performance.now(); frame = requestAnimationFrame(tick); }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    document.addEventListener('pointerdown', stop, true);
    window.addEventListener('blur', stop);
    return () => { stop(); element.removeEventListener('wheel', wheel); document.removeEventListener('pointerdown', stop, true); window.removeEventListener('blur', stop); };
  }, [target]);
}

export function ScrollArrows({ target, left, right, label }: {
  target: RefObject<HTMLDivElement | null>; left: boolean; right: boolean; label: string;
}) {
  const frame = useRef<number | null>(null);
  const stop = () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; };
  useEffect(() => {
    window.addEventListener('blur', stop);
    return () => { stop(); window.removeEventListener('blur', stop); };
  }, []);
  return <>{([-1, 1] as const).map(direction => {
    const available = direction === -1 ? left : right;
    return available && <button key={direction} type="button" className={`horizontal-scroll-arrow scroll-${direction === -1 ? 'left' : 'right'}`}
      aria-label={`Scroll ${label} ${direction === -1 ? 'left' : 'right'}`}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); stop();
        event.currentTarget.setPointerCapture(event.pointerId);
        let previous = performance.now();
        const tick = (now: number) => {
          const element = target.current;
          if (!element) { stop(); return; }
          const before = element.scrollLeft;
          element.scrollLeft += direction * Math.min(now - previous, 50) * .4;
          previous = now;
          if (element.scrollLeft === before && (direction < 0 ? element.scrollLeft <= 0 : element.scrollLeft + element.clientWidth >= element.scrollWidth - 1)) { stop(); return; }
          frame.current = requestAnimationFrame(tick);
        };
        frame.current = requestAnimationFrame(tick);
      }}
      onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
      onClick={event => { if (event.detail === 0) target.current?.scrollBy({ left: direction * 80 }); }}>
      {direction === -1 ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
    </button>;
  })}</>;
}

export function HorizontalScroll({ children, label, contentClassName = '', className = '', target }: {
  children: ReactNode; label: string; contentClassName?: string; className?: string; target?: RefObject<HTMLDivElement | null>;
}) {
  const internal = useRef<HTMLDivElement>(null);
  const ref = target ?? internal;
  useSmoothHorizontalWheel(ref);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setEdges(previous => {
      const left = element.scrollLeft > 1, right = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      return previous.left === left && previous.right === right ? previous : { left, right };
    });
    const resize = new ResizeObserver(measure);
    const observe = () => {
      resize.disconnect(); resize.observe(element);
      for (const child of element.children) resize.observe(child);
      measure();
    };
    const mutations = new MutationObserver(observe);
    mutations.observe(element, { childList: true, subtree: true, characterData: true });
    element.addEventListener('scroll', measure);
    observe();
    return () => { resize.disconnect(); mutations.disconnect(); element.removeEventListener('scroll', measure); };
  }, [ref]);
  return <div className={`horizontal-scroll ${className}${edges.left ? ' overflow-left' : ''}${edges.right ? ' overflow-right' : ''}`}>
    <div ref={ref} className={`horizontal-scroll-content ${contentClassName}`} aria-label={label}>{children}</div>
    <ScrollArrows target={ref} {...edges} label={label} />
  </div>;
}

export function Modal({ title, subtitle, children, onClose, wide = false }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="modal-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20} /></button></header>
      {children}
    </section>
  </div>;
}
export function Toggle({ label, checked, onChange, description, disabled = false }: {
  label: string; checked: boolean; onChange: (value: boolean) => void; description?: string; disabled?: boolean;
}) {
  return <label className={`toggle-row ${disabled ? 'disabled' : ''}`}><span>{label}{description && <small>{description}</small>}</span>
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} disabled={disabled} />
    <span className="toggle-track"><span>{checked && <Check size={10} />}</span></span>
  </label>;
}
export function Field({ label, children, icon }: { label: string; children: ReactNode; icon?: ReactNode }) {
  const control = isValidElement<{ 'aria-label'?: string }>(children) &&
    typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type)
    ? cloneElement(children, { 'aria-label': children.props['aria-label'] ?? label }) : children;
  return <label className="field"><span className={icon ? 'field-icon-label' : undefined} title={icon ? label : undefined}>
    {icon ? <><span aria-hidden="true">{icon}</span><span className="visually-hidden">{label}</span></> : label}
  </span>{control}</label>;
}
export function Notice({ message, children, className = 'error-banner', role = 'alert', hidden = false }: {
  message: string; children?: ReactNode; className?: string; role?: 'alert' | 'status'; hidden?: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => setDismissed(false), [message]);
  if (!message || dismissed) return null;
  return <div className={`${className} dismissible-notice`} role={role} hidden={hidden}>
    <div className="notice-content"><span>{message}</span>{children}</div>
    <button type="button" className="icon-button notice-close" aria-label="Dismiss notification" title="Dismiss notification" onClick={() => setDismissed(true)}><X size={16} /></button>
  </div>;
}
export function ColorField({ label, value: committed, onChange, deferred = false, alpha = true }: {
  label: string; value: string; onChange: (value: string) => void;
  /** Offer an alpha slider; without it the color is always opaque. */
  alpha?: boolean;
  /** Report the color only when an edit finishes (slider release, picker close, text blur or Enter). */
  deferred?: boolean;
}) {
  const [draft, setDraft] = useState(committed);
  const latest = useRef(committed);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => { setDraft(committed); latest.current = committed; }, [committed]);
  const value = deferred ? draft : committed;
  const report = (next: string) => { if (deferred) { latest.current = next; setDraft(next); } else onChange(next); };
  useEffect(() => {
    const element = container.current; if (!deferred || !element) return;
    const change = () => { if (latest.current !== committed) onChange(latest.current); };
    element.addEventListener('change', change);
    return () => element.removeEventListener('change', change);
  }, [deferred, committed, onChange]);
  const parsed = useMemo(() => {
    if (!CSS.supports('color', value)) return null;
    const context = document.createElement('canvas').getContext('2d');
    if (!context) throw new Error('Unable to initialize the color picker.');
    context.fillStyle = value;
    const normalized = context.fillStyle;
    const hex = normalized.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
    if (hex) return { rgb: `#${hex[1]}`, alpha: hex[2] ? parseInt(hex[2], 16) : 255 };
    const rgba = normalized.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
    if (!rgba) return null;
    return {
      rgb: `#${rgba.slice(1, 4).map(channel => Math.round(Number(channel)).toString(16).padStart(2, '0')).join('')}`,
      alpha: Math.round(Number(rgba[4] ?? 1) * 255),
    };
  }, [value]);
  const withAlpha = (rgb: string, opacity: number) => !alpha || opacity === 255 ? rgb : `${rgb}${opacity.toString(16).padStart(2, '0')}`;
  return <div ref={container} className="field color-field"><span>{label}</span>
    <div className="color-input">
      <input type="color" aria-label={label} value={parsed?.rgb ?? '#000000'} disabled={!parsed}
        style={parsed ? { '--swatch': value } as CSSProperties : undefined}
        onChange={event => { if (parsed) report(withAlpha(event.target.value, parsed.alpha)); }} />
      <input aria-label={`${label} value`} value={value} onChange={event => report(event.target.value)}
        onKeyDown={event => { if (deferred && event.key === 'Enter') event.currentTarget.blur(); }} />
    </div>
    {alpha && <div className="color-alpha"><span>Alpha</span><input type="range" aria-label={`${label} alpha`} min={0} max={255} step={1} value={parsed?.alpha ?? 255} disabled={!parsed}
      onChange={event => { if (parsed) report(withAlpha(parsed.rgb, event.target.valueAsNumber)); }} />
      <output>{parsed ? `${Math.round(parsed.alpha / 255 * 100)}%` : 'N/A'}</output>
    </div>}
  </div>;
}
export function NumberField({ label, value, onChange, min, max, step = 1, icon, deferred = false, disabled = false, title }: {
  label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; icon?: ReactNode; disabled?: boolean; title?: string;
  /** Report the value only when typing, stepping or scrubbing finishes. */
  deferred?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const drag = useRef<{ pointer: number; y: number; value: number; next?: number }>(null);
  const committed = useRef<number>(undefined);
  useEffect(() => { committed.current = undefined; if (!editing) setDraft(String(value)); }, [value, editing]);
  const endDrag = () => {
    const next = drag.current?.next; drag.current = null;
    if (deferred && next !== undefined && next !== value) { committed.current = next; onChange(next); }
  };
  return <Field label={label} icon={icon}><input aria-label={label} type="number" value={draft} min={min} max={max} step={step} disabled={disabled} title={title}
    onFocus={() => setEditing(true)}
    onPointerDown={e => {
      if (e.button !== 0) return;
      drag.current = { pointer: e.pointerId, y: e.clientY, value };
      e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerMove={e => {
      const start = drag.current;
      if (!start || start.pointer !== e.pointerId || Math.abs(start.y - e.clientY) < 4) return;
      const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Number((start.value + Math.trunc((start.y - e.clientY) / 4) * step).toFixed(10))));
      start.next = next; setDraft(String(next)); if (!deferred) onChange(next);
    }}
    onPointerUp={endDrag}
    onPointerCancel={endDrag}
    onChange={e => {
      setDraft(e.target.value);
      const n = e.target.valueAsNumber;
      if (!deferred && Number.isFinite(n) && n >= (min ?? -Infinity) && n <= (max ?? Infinity)) onChange(n);
    }}
    onBlur={() => {
      const n = Number(draft);
      const next = draft.trim() && Number.isFinite(n) ? Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)) : value;
      setDraft(String(next)); setEditing(false);
      if (next !== value && next !== committed.current) onChange(next);
    }}
    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></Field>;
}
