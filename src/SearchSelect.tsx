import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cssPx } from './uiScale';

export type SearchOption = { value: string; label: string; detail?: string; icon?: ReactNode };

/** Space between the trigger and its list, and the least room kept to the window edges, in page CSS pixels. */
const GAP = 4, EDGE = 8, MIN_WIDTH = 200, MAX_HEIGHT = 280;

/**
 * A select with a search box, used for every list whose options come from the project's data (rows, pages, imported
 * assets, components). Typing filters by label and detail; arrow keys move, Enter picks and Escape closes. The list
 * opens in a layer above the page, so scrolling toolbars and panels never clip it.
 */
export function SearchSelect({ label, value, options, onChange, placeholder = 'Choose…', disabled = false, hint, hideLabel = false, className = '' }: {
  label: string; value: string | undefined; options: SearchOption[]; onChange: (value: string) => void;
  placeholder?: string; disabled?: boolean; hint?: ReactNode;
  /** Show no label (the trigger and list are still named by it), for compact toolbars. */
  hideLabel?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>();
  const root = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = options.find(option => option.value === value);
  const terms = query.trim().toLowerCase();
  const shown = terms ? options.filter(option => `${option.label} ${option.detail ?? ''}`.toLowerCase().includes(terms)) : options;
  // Below the trigger when it fits, otherwise above; as wide as the trigger but never narrower than MIN_WIDTH.
  const place = () => {
    const button = trigger.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const top = cssPx(rect.top), bottom = cssPx(rect.bottom), left = cssPx(rect.left);
    const windowWidth = cssPx(window.innerWidth), windowHeight = cssPx(window.innerHeight);
    const width = Math.min(Math.max(cssPx(rect.width), MIN_WIDTH), windowWidth - EDGE * 2);
    const below = windowHeight - bottom - GAP - EDGE, above = top - GAP - EDGE;
    const up = below < Math.min(MAX_HEIGHT, 160) && above > below;
    setPosition({
      left: Math.max(EDGE, Math.min(left, windowWidth - width - EDGE)), width,
      ...(up ? { bottom: windowHeight - top + GAP } : { top: bottom + GAP }),
      maxHeight: Math.max(120, Math.min(MAX_HEIGHT, up ? above : below)),
    });
  };
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const inside = (target: EventTarget | null) => target instanceof Node && (root.current?.contains(target) || popover.current?.contains(target));
    const close = (event: PointerEvent) => { if (!inside(event.target)) setOpen(false); };
    // Scrolling a panel moves the list along with its trigger (a panel can scroll just as the list opens, to bring its
    // trigger into view), and closes it once the trigger has scrolled out of sight; scrolling the list itself is fine.
    const scrolled = (event: Event) => {
      if (inside(event.target)) return;
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) setOpen(false); else place();
    };
    document.addEventListener('pointerdown', close);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active, open]);
  const show = () => {
    place(); setQuery(''); setOpen(true);
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
    } else if (event.key === 'Tab') setOpen(false);
  };
  return <div ref={root} className={`field search-select${open ? ' open' : ''}${hideLabel ? ' search-select-compact' : ''} ${className}`}>
    {!hideLabel && <span>{label}{hint}</span>}
    <button ref={trigger} type="button" className="search-select-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${selected?.label ?? placeholder}`}
      disabled={disabled} onClick={() => open ? setOpen(false) : show()}
      onKeyDown={event => { if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !open) { event.preventDefault(); show(); } }}>
      {selected?.icon}<span className={selected ? undefined : 'placeholder'}>{selected?.label ?? placeholder}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={popover} className="search-select-popover" style={position ?? { visibility: 'hidden' }}>
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
    </div>, document.body)}
  </div>;
}
