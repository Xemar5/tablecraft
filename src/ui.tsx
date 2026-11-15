import { X, Check } from 'lucide-react';
import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';

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
export function NumberField({ label, value, onChange, min, max, step = 1 }: {
  label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const drag = useRef<{ pointer: number; y: number; value: number }>(null);
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);
  return <Field label={label}><input aria-label={label} type="number" value={draft} min={min} max={max} step={step}
    onFocus={e => { setEditing(true); e.currentTarget.select(); }}
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
