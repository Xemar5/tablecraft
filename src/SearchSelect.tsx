import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

export type SearchOption = { value: string; label: string; detail?: string; icon?: ReactNode };

/**
 * A select with a search box, for long lists such as the components a linked artwork layer can show. Typing filters
 * by label and detail; arrow keys move, Enter picks and Escape closes.
 */
export function SearchSelect({ label, value, options, onChange, placeholder = 'Choose…', disabled = false, hint }: {
  label: string; value: string | undefined; options: SearchOption[]; onChange: (value: string) => void;
  placeholder?: string; disabled?: boolean; hint?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = options.find(option => option.value === value);
  const terms = query.trim().toLowerCase();
  const shown = terms ? options.filter(option => `${option.label} ${option.detail ?? ''}`.toLowerCase().includes(terms)) : options;
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active, open]);
  const show = () => {
    setQuery(''); setOpen(true);
    setActive(Math.max(0, options.findIndex(option => option.value === value)));
  };
  const pick = (option: SearchOption) => {
    setOpen(false);
    if (option.value !== value) onChange(option.value);
    trigger.current?.focus();
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(index => shown.length ? (index + step + shown.length) % shown.length : 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (shown[active]) pick(shown[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      setOpen(false); trigger.current?.focus();
    }
  };
  return <div ref={root} className={`field search-select${open ? ' open' : ''}`}>
    <span>{label}{hint}</span>
    <button ref={trigger} type="button" className="search-select-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${selected?.label ?? placeholder}`}
      disabled={disabled} onClick={() => open ? setOpen(false) : show()}
      onKeyDown={event => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); show(); } }}>
      {selected?.icon}<span className={selected ? undefined : 'placeholder'}>{selected?.label ?? placeholder}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <div className="search-select-popover">
      <label className="search-select-search"><Search size={13} aria-hidden="true" />
        <input ref={search} role="combobox" aria-label={`Search ${label.toLowerCase()}`} aria-expanded aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined} placeholder="Search…" value={query} spellCheck={false}
          onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={keyDown} />
      </label>
      <ul ref={list} id={listId} role="listbox" aria-label={label}>
        {shown.map((option, index) => <li key={option.value} id={`${listId}-${index}`} role="option" aria-selected={option.value === value} data-active={index === active}
          onPointerDown={event => event.preventDefault()} onPointerEnter={() => setActive(index)} onClick={() => pick(option)}>
          {option.icon}<span>{option.label}{option.detail && <small>{option.detail}</small>}</span>{option.value === value && <Check size={13} aria-hidden="true" />}
        </li>)}
        {!shown.length && <li className="search-select-empty" role="presentation">No matches for “{query.trim()}”</li>}
      </ul>
    </div>}
  </div>;
}
