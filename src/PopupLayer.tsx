import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { X } from 'lucide-react';
import { ComponentView } from './ComponentView';
import type { Command, Component, DesignNode, Project } from './domain';
import { popupBox, popupSettings, popupShownTo, type Popup } from './popups';
import { cssPx } from './uiScale';

/** A popup shown only on this screen (the library's preview of a popup component), closed without a command. */
export type LocalPopup = Popup & { local: true };

type Gesture = { pointer: number; popup: string; x: number; y: number; from: { x: number; y: number }; node?: string; moved: boolean };

/** The names of a layer and the layers it's in, outermost first. */
function layerPath(nodes: DesignNode[], id: string): string[] {
  const path: string[] = [];
  for (let node = nodes.find(item => item.id === id); node; node = node.parent ? nodes.find(item => item.id === node!.parent) : undefined) path.unshift(node.name);
  return path;
}

/**
 * The popups open for this screen, over the table (the game area): each placed by its settings (see popupBox) as the
 * area changes size, oldest underneath. A popup with `blur` blurs and blocks the table behind it; `draggable` ones
 * move by dragging (on this screen only); `closable` ones have a × button and close with Escape (topmost first);
 * `duration` ones close by themselves. Closing sends `closePopup` for your seat (a viewer, who can't, just hides it
 * here). Clicking a layer runs the popup component's script action with (popup, player, layer name, layer path), and
 * closes it after when `closeOnAction` is on.
 */
export function PopupLayer({ project, actor, viewer, dispatch, local, onCloseLocal }: {
  project: Project; actor?: string; viewer: boolean; dispatch: (command: Command) => Promise<boolean>;
  local?: LocalPopup; onCloseLocal?: () => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = layer.current;
    if (!element) return;
    const measure = () => setArea({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Popups this screen hid by itself (a viewer closing one, or a duration running out without a seat to close it for).
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const gesture = useRef<Gesture | null>(null);
  const seat = viewer ? undefined : actor;
  const components = useMemo(() => new Map(project.components.map(component => [component.id, component])), [project.components]);
  const shown = useMemo(() => [...(project.popups ?? []).filter(popup => popupShownTo(popup, seat) && !hidden.has(popup.id)), ...local ? [local] : []]
    .flatMap(popup => { const component = components.get(popup.componentId); return component?.kind === 'popup' ? [{ popup, component, settings: popupSettings(component, popup) }] : []; }),
  [project.popups, seat, hidden, local, components]);

  const close = (popup: Popup) => {
    setOffsets(({ [popup.id]: _, ...rest }) => rest);
    if ((popup as LocalPopup).local) { onCloseLocal?.(); return; }
    if (seat) void dispatch({ type: 'closePopup', ids: [popup.id] });
    else setHidden(current => new Set([...current, popup.id]));
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  // Popups that close by themselves: each counts from when it first shows here.
  const timers = useRef(new Map<string, number>());
  useEffect(() => {
    const live = new Set(shown.map(entry => entry.popup.id));
    for (const [id, timer] of timers.current) if (!live.has(id)) { window.clearTimeout(timer); timers.current.delete(id); }
    for (const { popup, settings } of shown) {
      if (!settings.duration || timers.current.has(popup.id)) continue;
      timers.current.set(popup.id, window.setTimeout(() => { timers.current.delete(popup.id); closeRef.current(popup); }, settings.duration * 1000));
    }
  }, [shown]);
  useEffect(() => () => { for (const timer of timers.current.values()) window.clearTimeout(timer); }, []);

  // Escape closes the topmost closable popup before the table sees the key.
  const top = [...shown].reverse().find(entry => entry.settings.closable);
  useEffect(() => {
    if (!top) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      event.preventDefault(); event.stopImmediatePropagation();
      closeRef.current(top.popup);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [top]);

  const runAction = (popup: Popup, component: Component, node: string | undefined) => {
    if ((popup as LocalPopup).local || !seat || !component.action) return;
    const path = node ? layerPath(component.front, node) : [];
    void dispatch({ type: 'call', name: component.action, popup: popup.id, args: [path.at(-1) ?? '', path], seed: crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff })
      .then(ok => { if (ok && popupSettings(component, popup).closeOnAction) close(popup); });
  };
  const begin = (event: PointerEvent<HTMLElement>, popup: Popup, node?: string) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    gesture.current = { pointer: event.pointerId, popup: popup.id, x: event.clientX, y: event.clientY, from: offsets[popup.id] ?? { x: 0, y: 0 }, node, moved: false };
    event.currentTarget.closest<HTMLElement>('.table-popup')?.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLElement>, draggable: boolean) => {
    const drag = gesture.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) <= 3) return;
    drag.moved = true;
    if (draggable) setOffsets(current => ({ ...current, [drag.popup]: { x: drag.from.x + cssPx(event.clientX - drag.x), y: drag.from.y + cssPx(event.clientY - drag.y) } }));
  };
  const end = (event: PointerEvent<HTMLElement>, popup: Popup, component: Component) => {
    const drag = gesture.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    gesture.current = null;
    if (!drag.moved) runAction(popup, component, drag.node);
  };

  return <div ref={layer} className="popup-layer" aria-live="polite">
    {area.width > 0 && shown.map(({ popup, component, settings }) => {
      const box = popupBox(component, area, settings), offset = offsets[popup.id] ?? { x: 0, y: 0 };
      // Its own data row, with the call's field values over it.
      const shownComponent = popup.data ? { ...component, rows: component.rows.length
        ? component.rows.map((row, index) => index === popup.row ? { ...row, ...popup.data } : row) : [popup.data] } : component;
      const clickable = !!component.action && !!seat && !(popup as LocalPopup).local;
      return <div key={popup.id} className="popup-slot">
        {settings.blur && <div className="popup-backdrop" aria-hidden="true" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} />}
        <div className={`table-popup${settings.draggable ? ' draggable' : ''}${clickable ? ' clickable' : ''}`} role="dialog" aria-modal={settings.blur || undefined}
          aria-label={component.name} data-popup-id={popup.id}
          style={{ left: box.left + offset.x, top: box.top + offset.y, width: box.width, height: box.height }}
          onPointerDown={event => begin(event, popup)} onPointerMove={event => move(event, settings.draggable)}
          onPointerUp={event => end(event, popup, component)} onPointerCancel={() => { gesture.current = null; }}
          onWheel={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}>
          <div className="popup-face" style={{ width: component.width, height: component.height, transform: `scale(${box.scale})` }}>
            <ComponentView component={shownComponent} components={project.components} row={popup.row}
              onNode={(id, event) => begin(event, popup, id)} />
          </div>
          {settings.closable && <button type="button" className="popup-close" aria-label={`Close ${component.name}`} title="Close (Esc)"
            onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); close(popup); }}><X size={15} /></button>}
        </div>
      </div>;
    })}
  </div>;
}
