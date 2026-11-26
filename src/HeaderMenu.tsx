import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import './headerMenu.css';

/**
 * An on/off item (with `checked`), an action (without it) that closes the menu when chosen, or a submenu (with `items`)
 * that opens beside it.
 */
export type HeaderMenuItem = { label: string; icon: ReactNode; checked?: boolean; onToggle?: () => void; hint?: string; disabled?: boolean;
  /** A keyboard shortcut shown beside the item. */
  shortcut?: string;
  /** Draw a line after this item. */
  divider?: boolean;
  /** The items of a submenu this item opens. */
  items?: HeaderMenuItem[] };
const ITEMS = '[role="menuitemcheckbox"], [role="menuitem"]';
/** The items of one menu list, not those of the submenus inside it. */
const itemsOf = (list: Element | null | undefined) => [...list?.querySelectorAll<HTMLButtonElement>(ITEMS) ?? []].filter(item => item.closest('[role="menu"]') === list);

/**
 * A header button with a dropdown of items. On/off items toggle without closing the menu; actions close it. A submenu
 * opens beside its item on hover, click, Enter or the right arrow, on the side with room, and the left arrow or Escape
 * closes it again. The menu closes on a click elsewhere, Escape or Tab. Arrow keys, Home and End move between the items
 * of the list that has focus.
 */
export function HeaderMenu({ label, icon, items, title }: { label: string; icon: ReactNode; items: HeaderMenuItem[]; title?: string }) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<string>();
  const [flipped, setFlipped] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menu = useId();
  const active = items.some(item => item.checked);
  const close = () => { setOpen(false); setSubmenu(undefined); };
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!(event.target instanceof Node && root.current?.contains(event.target))) close(); };
    // Capture phase: the table and panels stop their pointer events from bubbling.
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);
  // A submenu opens to the right unless that would leave the window; then it opens to the left.
  useLayoutEffect(() => {
    if (!submenu) { setFlipped(false); return; }
    const box = list.current?.getBoundingClientRect();
    if (box) setFlipped(box.right + 230 > document.documentElement.clientWidth);
  }, [submenu]);
  const focusIn = (target: Element | null | undefined, index: number) => {
    const entries = itemsOf(target);
    entries[(index + entries.length) % entries.length]?.focus();
  };
  const openMenu = (index = 0) => { setOpen(true); requestAnimationFrame(() => focusIn(list.current, index)); };
  const openSubmenu = (name: string, focus: boolean) => {
    setSubmenu(name);
    if (focus) requestAnimationFrame(() => focusIn(root.current?.querySelector(`[role="menu"][aria-label="${CSS.escape(name)}"]`), 0));
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const focused = document.activeElement as HTMLButtonElement | null;
    const current = focused?.closest('[role="menu"]') ?? list.current;
    const entries = itemsOf(current), index = entries.indexOf(focused!);
    const inSubmenu = !!current && current !== list.current;
    const parentItem = inSubmenu ? current.parentElement?.querySelector<HTMLButtonElement>(':scope > [aria-haspopup="menu"]') : undefined;
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation();
      if (inSubmenu) { setSubmenu(undefined); parentItem?.focus(); } else { close(); trigger.current?.focus(); }
    } else if (event.key === 'Tab') close();
    else if (event.key === 'ArrowDown') { event.preventDefault(); if (open) focusIn(current, index + 1); else openMenu(0); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); if (open) focusIn(current, index - 1); else openMenu(-1); }
    else if (open && event.key === 'Home') { event.preventDefault(); focusIn(current, 0); }
    else if (open && event.key === 'End') { event.preventDefault(); focusIn(current, -1); }
    else if (open && event.key === 'ArrowRight' && focused?.getAttribute('aria-haspopup') === 'menu') { event.preventDefault(); openSubmenu(focused.dataset.submenu!, true); }
    else if (open && event.key === 'ArrowLeft' && inSubmenu) { event.preventDefault(); setSubmenu(undefined); parentItem?.focus(); }
  };
  const entry = (item: HeaderMenuItem) => <Fragment key={item.label}>
    <button type="button" role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={item.checked} title={item.hint}
      aria-disabled={item.disabled || undefined} className={item.disabled ? 'disabled' : undefined}
      onPointerEnter={() => setSubmenu(current => items.some(top => top.label === item.label) ? undefined : current)}
      onClick={() => { if (item.disabled) return; if (item.checked === undefined) close(); item.onToggle?.(); }}>
      <span className="header-menu-icon" aria-hidden="true">{item.icon}</span>
      <span className="header-menu-label">{item.label}</span>
      <span className="header-menu-check" aria-hidden="true">{item.checked ? <Check size={14} /> : item.shortcut && <kbd>{item.shortcut}</kbd>}</span>
    </button>{item.divider && <hr className="header-menu-divider" />}</Fragment>;
  return <div className="header-menu" ref={root} onKeyDown={keyDown}>
    <button ref={trigger} type="button" className={`header-menu-trigger${active ? ' has-active' : ''}`} aria-label={label} title={title ?? label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menu : undefined} onClick={() => open ? close() : setOpen(true)}>
      {icon}<ChevronDown size={12} className="header-menu-chevron" aria-hidden="true" />
    </button>
    {open && <div ref={list} className="header-menu-list" role="menu" id={menu} aria-label={label}>
      {items.map(item => item.items ? <Fragment key={item.label}>
        <div className="header-submenu" onPointerEnter={() => setSubmenu(item.label)}>
          <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={submenu === item.label} data-submenu={item.label} title={item.hint}
            className={item.items.some(child => child.checked) ? 'has-active' : undefined}
            onClick={event => openSubmenu(item.label, event.detail === 0)}>
            <span className="header-menu-icon" aria-hidden="true">{item.icon}</span>
            <span className="header-menu-label">{item.label}</span>
            <span className="header-menu-check" aria-hidden="true">{flipped && submenu === item.label ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}</span>
          </button>
          {submenu === item.label && <div className={`header-menu-list header-submenu-list${flipped ? ' opens-left' : ''}`} role="menu" aria-label={item.label}>
            {item.items.map(entry)}
          </div>}
        </div>{item.divider && <hr className="header-menu-divider" />}</Fragment> : entry(item))}
    </div>}
  </div>;
}
