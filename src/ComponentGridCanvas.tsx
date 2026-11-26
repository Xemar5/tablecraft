import { useRef, type PointerEvent } from 'react';
import { uid } from './domain';
import { boundsReach, DEFAULT_POINT_RADIUS, type ComponentGrid, type GridBounds } from './grids';
import { cssPx } from './uiScale';

const BOUNDS_HANDLES = [[-1, -1, 'top-left corner'], [0, -1, 'top edge'], [1, -1, 'top-right corner'], [1, 0, 'right edge'],
  [1, 1, 'bottom-right corner'], [0, 1, 'bottom edge'], [-1, 1, 'bottom-left corner'], [-1, 0, 'left edge']] as const;

type Gesture = { pointer: number; x: number; y: number; grid: ComponentGrid; kind: 'offset' | 'point' | 'bounds'; point?: string; hx?: number; hy?: number; changed: boolean };

/**
 * Editing a component's grid on the designer canvas, over its layers (in screen pixels, so handles keep their size):
 * drag the canvas to move a square or hex grid's points, drag the handles of the dashed frame to set the grid's bounds,
 * and on a points grid click to add a snap point (into the selected point group), drag points to move them and click
 * one to select it. Changes show at once (`onDraft`) and are saved when the drag ends (`onCommit`), so each drag is one
 * undo step. It also shows how far the grid reaches: a dotted frame half a cell outside a square or hex grid's bounds,
 * and a dashed circle of the snap distance around each point of a points grid inside its bounds.
 */
export function ComponentGridCanvas({ grid, zoom, color, point, group, highlighted, onSelectPoint, onDraft, onCommit, readOnly }: {
  grid: ComponentGrid; zoom: number; color: string; point?: string; onSelectPoint: (id: string | undefined) => void;
  /** The selected point group: new points go into it, and `highlighted` are the points in it. */
  group?: string; highlighted?: string[];
  onDraft: (grid: ComponentGrid | undefined) => void; onCommit: (grid: ComponentGrid) => void; readOnly?: boolean;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const draft = useRef<ComponentGrid | undefined>(undefined);
  const show = (next: ComponentGrid | undefined) => { draft.current = next; onDraft(next); };
  /** A pointer position in the component's own coordinates. */
  const local = (event: PointerEvent) => {
    const box = layer.current!.getBoundingClientRect();
    return { x: cssPx(event.clientX - box.left) / zoom, y: cssPx(event.clientY - box.top) / zoom };
  };
  const round = (value: number) => Math.round(value);
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || readOnly) return;
    event.preventDefault(); event.stopPropagation();
    const target = event.target as Element;
    const handle = target.closest<HTMLElement>('[data-bounds-handle]')?.dataset.boundsHandle;
    const hit = target.closest<SVGElement>('[data-grid-point]')?.dataset.gridPoint;
    let next = grid, kind: Gesture['kind'] = 'offset', id: string | undefined, changed = false;
    if (handle) kind = 'bounds';
    else if (grid.shape === 'points') {
      kind = 'point';
      id = hit;
      if (!id) {
        // A click where there's no point adds one there.
        const at = local(event);
        id = uid('point');
        next = { ...grid, points: [...grid.points ?? [], { id, x: round(at.x), y: round(at.y), ...(group ? { group } : {}) }] };
        changed = true;
        show(next);
      }
      onSelectPoint(id);
    }
    const [hx, hy] = handle ? handle.split(',').map(Number) : [0, 0];
    gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, grid: next, kind, point: id, hx, hy, changed };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const drag = gesture.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    event.stopPropagation();
    const dx = round(cssPx(event.clientX - drag.x) / zoom), dy = round(cssPx(event.clientY - drag.y) / zoom);
    if (!dx && !dy && !drag.changed) return;
    const start = drag.grid;
    if (drag.kind === 'bounds') {
      const b = start.bounds, bounds: GridBounds = { ...b };
      // The edge or corner dragged moves; the opposite one stays.
      if (drag.hx === -1) { bounds.x = Math.min(b.x + b.width - 1, b.x + dx); bounds.width = b.x + b.width - bounds.x; }
      if (drag.hx === 1) bounds.width = Math.max(1, b.width + dx);
      if (drag.hy === -1) { bounds.y = Math.min(b.y + b.height - 1, b.y + dy); bounds.height = b.y + b.height - bounds.y; }
      if (drag.hy === 1) bounds.height = Math.max(1, b.height + dy);
      show({ ...start, bounds });
    } else if (drag.kind === 'point') {
      show({ ...start, points: (start.points ?? []).map(item => item.id === drag.point ? { ...item, x: item.x + dx, y: item.y + dy } : item) });
    } else show({ ...start, offsetX: start.offsetX + dx, offsetY: start.offsetY + dy });
    drag.changed = true;
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    const drag = gesture.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    event.stopPropagation();
    gesture.current = null;
    const changed = drag.changed ? draft.current : undefined;
    if (changed) onCommit(changed);
    show(undefined);
  };
  const cancel = () => { gesture.current = null; show(undefined); };
  const { bounds } = grid, reach = boundsReach(grid), radius = (grid.radius ?? DEFAULT_POINT_RADIUS) * zoom;
  const inside = (item: { x: number; y: number }) => item.x >= bounds.x && item.x <= bounds.x + bounds.width && item.y >= bounds.y && item.y <= bounds.y + bounds.height;
  return <div ref={layer} className={`grid-edit-layer${grid.shape === 'points' ? ' points' : ''}`} style={{ color }}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}>
    {grid.shape !== 'points' && <div className="grid-snap-reach-bounds" aria-hidden="true" style={{ left: (bounds.x - reach.x) * zoom, top: (bounds.y - reach.y) * zoom,
      width: (bounds.width + 2 * reach.x) * zoom, height: (bounds.height + 2 * reach.y) * zoom }} />}
    <div className="grid-bounds" style={{ left: bounds.x * zoom, top: bounds.y * zoom, width: bounds.width * zoom, height: bounds.height * zoom }}>
      {!readOnly && BOUNDS_HANDLES.map(([hx, hy, label]) => <button key={label} type="button" tabIndex={-1} className={`transform-handle${hx && hy ? ' corner' : ''}`}
        data-bounds-handle={`${hx},${hy}`} aria-label={`Resize grid bounds from ${label}`} title="Drag to set where the grid applies"
        style={{ left: `${(hx + 1) * 50}%`, top: `${(hy + 1) * 50}%`, cursor: hx && hy ? (hx === hy ? 'nwse-resize' : 'nesw-resize') : hx ? 'ew-resize' : 'ns-resize' }} />)}
    </div>
    {grid.shape === 'points' && <svg className="grid-edit-points" aria-hidden="false">
      <g aria-hidden="true">{(grid.points ?? []).filter(inside).map(item => <circle key={item.id} className="grid-snap-reach" cx={item.x * zoom} cy={item.y * zoom} r={radius} />)}</g>
      {(grid.points ?? []).map(item => <g key={item.id} data-grid-point={item.id} className={`grid-handle${item.id === point ? ' selected' : ''}${highlighted?.includes(item.id) ? ' highlighted' : ''}`}
        transform={`translate(${item.x * zoom} ${item.y * zoom})`} role="button" aria-label={`Point ${item.label || item.id}`}>
        <circle className="grid-handle-hit" />
        <circle className="grid-handle-dot" />
      </g>)}
    </svg>}
  </div>;
}
