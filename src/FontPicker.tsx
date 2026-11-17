import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { GOOGLE_FONTS } from './assets';

let previewsRequested = false;
/** Loads the suggested Google fonts once, so each option can be shown in its own typeface. */
function loadFontPreviews() {
  if (previewsRequested || typeof document === 'undefined') return;
  previewsRequested = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${GOOGLE_FONTS.map(font => `family=${encodeURIComponent(font)}`).join('&')}&display=swap`;
  document.head.appendChild(link);
}

/**
 * A font combobox: pick one of the suggested Google fonts (shown in their own typeface), or type any Google font,
 * an imported font's name or a {{binding}}. The value is committed on Enter, on blur or when an option is picked.
 */
export function FontPicker({ label, value, onChange, disabled = false, fonts = GOOGLE_FONTS }: {
  label: string; value: string; onChange: (font: string) => void; disabled?: boolean; fonts?: readonly string[];
}) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (open) loadFontPreviews(); }, [open]);
  const options = filter ? fonts.filter(font => font.toLowerCase().includes(filter.trim().toLowerCase())) : fonts;
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active, open]);
  const commit = (font: string) => {
    const next = font.trim();
    setOpen(false); setFilter(''); setActive(-1);
    setDraft(next || value);
    if (next && next !== value) onChange(next);
  };
  const show = () => {
    setFilter(''); setOpen(true);
    setActive(Math.max(0, fonts.findIndex(font => font.toLowerCase() === value.trim().toLowerCase())));
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { show(); return; }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(index => options.length ? (index + step + options.length) % options.length : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit(open && options[active] ? options[active] : draft);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation();
      setOpen(false); setFilter(''); setDraft(value);
    }
  };
  return <div className={`field font-picker${open ? ' open' : ''}`}>
    <span>{label}</span>
    <div className="font-picker-control">
      <input ref={input} role="combobox" aria-label={label} aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined} disabled={disabled} value={draft} spellCheck={false}
        style={{ fontFamily: `"${draft}", "DM Sans", sans-serif` }}
        onChange={event => { setDraft(event.target.value); setFilter(event.target.value); setActive(0); setOpen(true); }}
        onKeyDown={keyDown} onBlur={() => commit(draft)} />
      <button type="button" className="font-picker-toggle" tabIndex={-1} aria-label={open ? 'Hide fonts' : 'Show fonts'} disabled={disabled}
        onPointerDown={event => event.preventDefault()}
        onClick={() => { if (open) { setOpen(false); setFilter(''); } else { show(); input.current?.focus(); } }}><ChevronDown size={14} /></button>
    </div>
    {open && <ul ref={list} id={listId} role="listbox" aria-label={`${label} suggestions`} className="font-picker-list">
      {options.map((font, index) => <li key={font} id={`${listId}-${index}`} role="option" aria-selected={font === value} data-active={index === active}
        style={{ fontFamily: `"${font}", "DM Sans", sans-serif` }}
        onPointerDown={event => event.preventDefault()} onPointerEnter={() => setActive(index)} onClick={() => commit(font)}>
        <span>{font}</span>{font === value && <Check size={13} aria-hidden="true" />}
      </li>)}
      {!options.length && <li className="font-picker-empty" role="presentation">Press Enter to use “{draft.trim()}”</li>}
    </ul>}
  </div>;
}
