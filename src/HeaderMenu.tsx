import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import './headerMenu.css';

export type HeaderMenuItem = { label: string; icon: ReactNode; checked: boolean; onToggle: () => void; hint?: string };

/**
 * A header button with a dropdown of on/off items (the Visibility and Scripting menus). Items toggle without closing the
 * menu; it closes on a click elsewhere, Escape or Tab. Arrow keys, Home and End move between items.
 */
export function HeaderMenu({ label, icon, items, title }: { label: string; icon: ReactNode; items: HeaderMenuItem[]; title?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useId();
  const active = items.some(item => item.checked);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!(event.target instanceof Node && root.current?.contains(event.target))) setOpen(false); };
    // Capture phase: the table and panels stop their pointer events from bubbling.
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [open]);
  const focusItem = (index: number) => {
    const entries = [...root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]') ?? []];
    entries[(index + entries.length) % entries.length]?.focus();
  };
  const openMenu = (index = 0) => { setOpen(true); requestAnimationFrame(() => focusItem(index)); };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const entries = [...root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]') ?? []];
    const current = entries.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    else if (event.key === 'Tab') setOpen(false);
    else if (event.key === 'ArrowDown') { event.preventDefault(); if (open) focusItem(current + 1); else openMenu(0); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); if (open) focusItem(current - 1); else openMenu(-1); }
    else if (open && event.key === 'Home') { event.preventDefault(); focusItem(0); }
    else if (open && event.key === 'End') { event.preventDefault(); focusItem(-1); }
  };
  return <div className="header-menu" ref={root} onKeyDown={keyDown}>
    <button ref={trigger} type="button" className={`header-menu-trigger${active ? ' has-active' : ''}`} aria-label={label} title={title ?? label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menu : undefined} onClick={() => open ? setOpen(false) : setOpen(true)}>
      {icon}<ChevronDown size={12} className="header-menu-chevron" aria-hidden="true" />
    </button>
    {open && <div className="header-menu-list" role="menu" id={menu} aria-label={label}>
      {items.map(item => <button key={item.label} type="button" role="menuitemcheckbox" aria-checked={item.checked} title={item.hint} onClick={item.onToggle}>
        <span className="header-menu-icon" aria-hidden="true">{item.icon}</span>
        <span className="header-menu-label">{item.label}</span>
        <span className="header-menu-check" aria-hidden="true">{item.checked && <Check size={14} />}</span>
      </button>)}
    </div>}
  </div>;
}
