import { X, Check } from 'lucide-react';
import { cloneElement, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

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
export function Field({ label, children }: { label: string; children: ReactNode }) {
  const control = isValidElement<{ 'aria-label'?: string }>(children) &&
    typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type)
    ? cloneElement(children, { 'aria-label': children.props['aria-label'] ?? label }) : children;
  return <label className="field"><span>{label}</span>{control}</label>;
}
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
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
  const withAlpha = (rgb: string, alpha: number) => alpha === 255 ? rgb : `${rgb}${alpha.toString(16).padStart(2, '0')}`;
  return <div className="field color-field"><span>{label}</span>
    <div className="color-input">
      <input type="color" aria-label={label} value={parsed?.rgb ?? '#000000'} disabled={!parsed}
        onChange={event => { if (parsed) onChange(withAlpha(event.target.value, parsed.alpha)); }} />
      <input aria-label={`${label} value`} value={value} onChange={event => onChange(event.target.value)} />
    </div>
    <div className="color-alpha"><span>Alpha</span><input type="range" aria-label={`${label} alpha`} min={0} max={255} step={1} value={parsed?.alpha ?? 255} disabled={!parsed}
      onChange={event => { if (parsed) onChange(withAlpha(parsed.rgb, event.target.valueAsNumber)); }} />
      <output>{parsed ? `${Math.round(parsed.alpha / 255 * 100)}%` : 'N/A'}</output>
    </div>
  </div>;
}
export function NumberField({ label, value, onChange, min, max, step = 1 }: {
  label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const drag = useRef<{ pointer: number; y: number; value: number }>(null);
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);
  return <Field label={label}><input aria-label={label} type="number" value={draft} min={min} max={max} step={step}
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
      setDraft(String(next)); onChange(next);
    }}
    onPointerUp={() => { drag.current = null; }}
    onPointerCancel={() => { drag.current = null; }}
    onChange={e => {
      setDraft(e.target.value);
      const n = e.target.valueAsNumber;
      if (Number.isFinite(n) && n >= (min ?? -Infinity) && n <= (max ?? Infinity)) onChange(n);
    }}
    onBlur={() => {
      const n = Number(draft);
      const next = draft.trim() && Number.isFinite(n) ? Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)) : value;
      setDraft(String(next)); setEditing(false);
      if (next !== value) onChange(next);
    }}
    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></Field>;
}
