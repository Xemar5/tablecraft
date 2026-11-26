import { z } from 'zod';
import type { Component, Instance, Project } from './domain';
import { matchesTags, normalizeTags, tagFilterSchema } from './tags';

/**
 * Grids. A project has a list of table grid layers; the first grid in the list wins when several could take a piece.
 * Square and hex grids are endless lattices; a points grid is a set of snap points placed by hand. Each grid's tag
 * filter picks the components (by their grid tags) that snap to it; components without grid tags snap to every grid,
 * and a component's "Can snap to grids" setting turns snapping off for it.
 *
 * Components can carry grids too (`Component.grids`, edited in the designer): the same settings in the component's
 * own coordinates, limited to their `bounds`. Each piece of the component on the table takes them along as it moves,
 * turns and scales (see placedGrids), and they come before the table's grids, the topmost piece's first.
 *
 * Point ids: square grids use "col,row" (x = offsetX + col × size, y = offsetY + row × cell height), hex grids axial
 * "q,r", points grids their own ids. A piece is snapped to a point when its centre sits exactly on it; that is
 * derived from positions (see snapOf), never stored.
 */
const id = z.string().min(1).max(100);
const coord = z.number().finite().min(-100000).max(100000);
export const gridPointSchema = z.object({
  id, x: coord, y: coord,
  /** The rotation pieces get when they snap here (overrides the grid's). */
  rotation: z.number().finite().min(-360).max(360).optional(),
  label: z.string().max(60).optional(),
  /** The point group (in the grid's `pointGroups`) it sits in, for the Points panel. */
  group: id.optional(),
});
export type GridPoint = z.infer<typeof gridPointSchema>;
/** Nestable groups organising a points grid's points in the Points panel. They don't change snapping. */
export const pointGroupSchema = z.object({ id, name: z.string().trim().min(1).max(60), parent: id.nullable() });
export type PointGroup = z.infer<typeof pointGroupSchema>;
export const gridSchema = z.object({
  id, name: z.string().trim().min(1).max(60), shape: z.enum(['square', 'hex', 'points']),
  visible: z.boolean(), snap: z.boolean(),
  /** Square: cell width; hex: the distance between neighbouring cell centres. */
  size: z.number().finite().min(5).max(2000),
  /** Square: cell height (the cell width when absent). */
  sizeY: z.number().finite().min(5).max(2000).optional(),
  offsetX: coord, offsetY: coord,
  /** Hex: pointy-topped (rows) or flat-topped (columns) cells. */
  orientation: z.enum(['pointy', 'flat']).optional(),
  /** The rotation pieces get when they snap to this grid. */
  rotation: z.number().finite().min(-360).max(360).optional(),
  points: z.array(gridPointSchema).max(2000).optional(),
  pointGroups: z.array(pointGroupSchema).max(500).optional(),
  /** Points grids: how close (px) a piece's centre must come to a point to snap (50 when absent). */
  radius: z.number().finite().min(1).max(2000).optional(),
  /** Which components snap here, by their grid tags. */
  filter: tagFilterSchema.optional(),
  color: z.string().max(80).optional(),
});
export type Grid = z.infer<typeof gridSchema>;
/** Where a component's grid applies, in the component's own coordinates (from its top-left corner). */
export const gridBoundsSchema = z.object({ x: coord, y: coord, width: z.number().finite().min(1).max(100000), height: z.number().finite().min(1).max(100000) });
export type GridBounds = z.infer<typeof gridBoundsSchema>;
/** A grid a component carries: a grid in the component's coordinates, with points (and snapping) only inside its bounds. */
export const componentGridSchema = gridSchema.extend({ bounds: gridBoundsSchema });
export type ComponentGrid = z.infer<typeof componentGridSchema>;
/** A grid point a piece snaps or is snapped to: its grid's key (see PlacedGrid), point id, table position and rotation. */
export type GridSnap = { grid: string; point: string; x: number; y: number; rotation?: number; label?: string };

export const DEFAULT_POINT_RADIUS = 50;
const SQRT3 = Math.sqrt(3);
/** Pieces count as snapped when their centre is this close to a point (positions are floats). */
const ON_POINT = 0.01;

/** The grid a project had before grid layers: one square grid from its table settings. */
export function legacyGrid(settings: Project['settings']): Grid {
  return { id: 'grid', name: 'Grid', shape: 'square', visible: settings.grid, snap: settings.snap, size: settings.gridSize,
    offsetX: settings.gridOffsetX ?? 0, offsetY: settings.gridOffsetY ?? 0 };
}
/** A project's grid layers, in priority order. */
export const projectGrids = (project: Pick<Project, 'grids' | 'settings'>): Grid[] => project.grids ?? [legacyGrid(project.settings)];

export const componentGridTags = (component: Pick<Component, 'gridTags'>) => normalizeTags(component.gridTags ?? []);
/** Whether a component's pieces snap to a grid (whether or not its snapping is on). */
export const gridAccepts = (grid: Pick<Grid, 'filter'>, component: Pick<Component, 'gridTags' | 'snapToGrid'>) =>
  component.snapToGrid !== false && matchesTags(grid.filter, componentGridTags(component));

const hexCenter = (grid: Grid, q: number, r: number) => grid.orientation === 'flat'
  ? { x: grid.offsetX + grid.size * SQRT3 / 2 * q, y: grid.offsetY + grid.size * (r + q / 2) }
  : { x: grid.offsetX + grid.size * (q + r / 2), y: grid.offsetY + grid.size * SQRT3 / 2 * r };

/** Where a grid point is, or undefined when the grid has no such point. */
export function gridPointPosition(grid: Grid, point: string): { x: number; y: number; rotation?: number } | undefined {
  if (grid.shape === 'points') {
    const found = grid.points?.find(item => item.id === point);
    return found && { x: found.x, y: found.y, rotation: found.rotation ?? grid.rotation };
  }
  const match = /^(-?\d+),(-?\d+)$/.exec(point.trim());
  if (!match) return undefined;
  const a = Number(match[1]), b = Number(match[2]);
  const at = grid.shape === 'hex' ? hexCenter(grid, a, b) : { x: grid.offsetX + a * grid.size, y: grid.offsetY + b * (grid.sizeY ?? grid.size) };
  return { ...at, rotation: grid.rotation };
}

const EDGE = 1e-6;
const insideBounds = (bounds: GridBounds, x: number, y: number) =>
  x >= bounds.x - EDGE && x <= bounds.x + bounds.width + EDGE && y >= bounds.y - EDGE && y <= bounds.y + bounds.height + EDGE;

/** A grid's point nearest to (x, y), with its distance; undefined for a points grid without points. */
export function nearestGridPoint(grid: Grid, x: number, y: number): (GridSnap & { distance: number }) | undefined {
  let point: string, at: { x: number; y: number; rotation?: number };
  if (grid.shape === 'points') {
    let best: GridPoint | undefined, distance = Infinity;
    for (const item of grid.points ?? []) {
      const d = Math.hypot(item.x - x, item.y - y);
      if (d < distance) { best = item; distance = d; }
    }
    if (!best) return undefined;
    point = best.id; at = { x: best.x, y: best.y, rotation: best.rotation ?? grid.rotation };
  } else if (grid.shape === 'hex') {
    const dx = x - grid.offsetX, dy = y - grid.offsetY, s = grid.size, row = s * SQRT3 / 2;
    // Fractional axial coordinates (the inverse of hexCenter).
    const q0 = grid.orientation === 'flat' ? dx / row : dx / s - dy / row / 2;
    const r0 = grid.orientation === 'flat' ? dy / s - dx / row / 2 : dy / row;
    // Cube rounding: round each coordinate, then fix the one that moved most so q + r + s stays 0.
    const s0 = -q0 - r0;
    let q = Math.round(q0), r = Math.round(r0);
    const t = Math.round(s0);
    const dq = Math.abs(q - q0), dr = Math.abs(r - r0), ds = Math.abs(t - s0);
    if (dq > dr && dq > ds) q = -r - t; else if (dr > ds) r = -q - t;
    q = q || 0; r = r || 0;
    point = `${q},${r}`; at = { ...hexCenter(grid, q, r), rotation: grid.rotation };
  } else {
    const height = grid.sizeY ?? grid.size;
    const col = Math.round((x - grid.offsetX) / grid.size) || 0, row = Math.round((y - grid.offsetY) / height) || 0;
    point = `${col},${row}`; at = { x: grid.offsetX + col * grid.size, y: grid.offsetY + row * height, rotation: grid.rotation };
  }
  return { grid: grid.id, point, x: at.x, y: at.y, ...(at.rotation !== undefined ? { rotation: at.rotation } : {}), distance: Math.hypot(at.x - x, at.y - y) };
}

/**
 * A grid's point nearest to (x, y) among those inside `bounds`, in the grid's own coordinates. Square grids clamp to the
 * columns and rows inside; hex grids look through the cells around the nearest one. Undefined when no point is inside.
 */
export function nearestBoundedPoint(grid: Grid, bounds: GridBounds, x: number, y: number): (GridSnap & { distance: number }) | undefined {
  const result = (point: string, at: { x: number; y: number }, rotation = grid.rotation, label?: string) =>
    ({ grid: grid.id, point, x: at.x, y: at.y, ...(rotation !== undefined ? { rotation } : {}), ...(label ? { label } : {}), distance: Math.hypot(at.x - x, at.y - y) });
  if (grid.shape === 'points') {
    let best: GridPoint | undefined, distance = Infinity;
    for (const item of grid.points ?? []) {
      if (!insideBounds(bounds, item.x, item.y)) continue;
      const d = Math.hypot(item.x - x, item.y - y);
      if (d < distance) { best = item; distance = d; }
    }
    return best && result(best.id, best, best.rotation ?? grid.rotation, best.label);
  }
  if (grid.shape === 'square') {
    const height = grid.sizeY ?? grid.size;
    const range = (offset: number, size: number, from: number, length: number) => [Math.ceil((from - offset) / size - EDGE), Math.floor((from + length - offset) / size + EDGE)];
    const [col0, col1] = range(grid.offsetX, grid.size, bounds.x, bounds.width), [row0, row1] = range(grid.offsetY, height, bounds.y, bounds.height);
    if (col0 > col1 || row0 > row1) return undefined;
    const col = Math.max(col0, Math.min(col1, Math.round((x - grid.offsetX) / grid.size))) || 0;
    const row = Math.max(row0, Math.min(row1, Math.round((y - grid.offsetY) / height))) || 0;
    return result(`${col},${row}`, { x: grid.offsetX + col * grid.size, y: grid.offsetY + row * height });
  }
  const [q, r] = nearestGridPoint(grid, x, y)!.point.split(',').map(Number);
  let best: ReturnType<typeof result> | undefined;
  for (let dq = -3; dq <= 3; dq++) for (let dr = Math.max(-3, -3 - dq); dr <= Math.min(3, 3 - dq); dr++) {
    const at = hexCenter(grid, q + dq, r + dr);
    if (!insideBounds(bounds, at.x, at.y)) continue;
    const candidate = result(`${(q + dq) || 0},${(r + dr) || 0}`, at);
    if (!best || candidate.distance < best.distance) best = candidate;
  }
  return best;
}

/** Whether (x, y) is close enough to a component grid's bounds to snap: inside them or within half a cell of them. */
function withinReach(grid: Grid, bounds: GridBounds, x: number, y: number) {
  const reachX = grid.shape === 'points' ? 0 : grid.size / 2, reachY = grid.shape === 'square' ? (grid.sizeY ?? grid.size) / 2 : reachX;
  return x >= bounds.x - reachX && x <= bounds.x + bounds.width + reachX && y >= bounds.y - reachY && y <= bounds.y + bounds.height + reachY;
}

/** Where a piece puts its component's grids on the table: its centre, rotation (degrees) and scale, and the component's size. */
export type GridFrame = { x: number; y: number; rotation: number; scale: number; width: number; height: number };
/** A point in a component (from its top-left corner) on the table, for a piece placed by `frame`. */
export function fromFrame(frame: GridFrame, x: number, y: number) {
  const angle = frame.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = (x - frame.width / 2) * frame.scale, dy = (y - frame.height / 2) * frame.scale;
  return { x: frame.x + dx * cos - dy * sin, y: frame.y + dx * sin + dy * cos };
}
/** A table point in a component's own coordinates, for a piece placed by `frame` (the inverse of fromFrame). */
export function toFrame(frame: GridFrame, x: number, y: number) {
  const angle = frame.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = x - frame.x, dy = y - frame.y;
  return { x: frame.width / 2 + (dx * cos + dy * sin) / frame.scale, y: frame.height / 2 + (-dx * sin + dy * cos) / frame.scale };
}

/**
 * A grid where it acts: a table grid, or a component's grid carried by a table piece (`host`, placed by `frame`, inside
 * `bounds`). `key` names it in snaps and commands: the table grid's id, or "piece id/grid id" for a carried grid.
 */
export type PlacedGrid = { key: string; grid: Grid; host?: string; hostStack?: string; frame?: GridFrame; bounds?: GridBounds };
export const pieceGridKey = (piece: string, grid: string) => `${piece}/${grid}`;

/**
 * The grids pieces snap to, highest priority first: those carried by pieces on the table (the topmost piece first, as
 * the table draws them: boards under everything else, later pieces over earlier ones; each component's grids in its
 * list order), then the table's own grids. Only a stack's top piece carries grids, and held pieces carry none.
 * `exclude` leaves out the grids carried by these pieces (pieces never snap to their own grids).
 */
export function placedGrids(project: Pick<Project, 'grids' | 'settings' | 'instances' | 'components'>, exclude?: ReadonlySet<string>): PlacedGrid[] {
  const components = new Map(project.components.map(component => [component.id, component]));
  const stacks = new Map<string, Instance[]>();
  for (const item of project.instances) if (item.stack && !item.holder) stacks.set(item.stack, [...stacks.get(item.stack) ?? [], item]);
  const isTop = (item: Instance) => {
    const members = item.stack ? stacks.get(item.stack)?.sort((a, b) => a.order - b.order) : undefined;
    return !members || (item.stackReversed ? members[0] : members.at(-1))?.id === item.id;
  };
  const hosts = project.instances.map((item, index) => ({ item, index, component: components.get(item.componentId) }))
    .filter(({ item, component }) => !item.holder && component?.grids?.length && !exclude?.has(item.id) && isTop(item))
    .sort((a, b) => (b.component!.kind === 'board' ? 0 : b.index + 2) - (a.component!.kind === 'board' ? 0 : a.index + 2) || b.index - a.index);
  const carried = hosts.flatMap(({ item, component }) => component!.grids!.map(grid => ({
    key: pieceGridKey(item.id, grid.id), grid, host: item.id, hostStack: item.stack ?? undefined, bounds: grid.bounds,
    frame: { x: item.x, y: item.y, rotation: item.rotation, scale: item.scale, width: component!.width, height: component!.height },
  })));
  return [...carried, ...projectGrids(project).map(grid => ({ key: grid.id, grid }))];
}

/** A placed grid's point nearest to (x, y) on the table (a carried grid's only inside its bounds, and only when (x, y) is near them). */
export function nearestPlacedPoint(placed: PlacedGrid, x: number, y: number): (GridSnap & { distance: number }) | undefined {
  if (!placed.frame || !placed.bounds) {
    const nearest = nearestGridPoint(placed.grid, x, y);
    const label = placed.grid.shape === 'points' ? placed.grid.points?.find(point => point.id === nearest?.point)?.label : undefined;
    return nearest && { ...nearest, grid: placed.key, ...(label ? { label } : {}) };
  }
  const local = toFrame(placed.frame, x, y);
  if (!withinReach(placed.grid, placed.bounds, local.x, local.y)) return undefined;
  const near = nearestBoundedPoint(placed.grid, placed.bounds, local.x, local.y);
  if (!near) return undefined;
  const at = fromFrame(placed.frame, near.x, near.y);
  return { grid: placed.key, point: near.point, x: at.x, y: at.y, ...(near.rotation !== undefined ? { rotation: near.rotation + placed.frame.rotation } : {}),
    ...(near.label ? { label: near.label } : {}), distance: Math.hypot(at.x - x, at.y - y) };
}

/** Where a placed grid's point is on the table; undefined when it has no such point (or it lies outside its bounds). */
export function placedPointPosition(placed: PlacedGrid, point: string): { x: number; y: number; rotation?: number } | undefined {
  const at = gridPointPosition(placed.grid, point);
  if (!at || !placed.frame || !placed.bounds) return at;
  if (!insideBounds(placed.bounds, at.x, at.y)) return undefined;
  return { ...fromFrame(placed.frame, at.x, at.y), ...(at.rotation !== undefined ? { rotation: at.rotation + placed.frame.rotation } : {}) };
}

/** How far a placed points grid reaches on the table: its snap distance, scaled with the piece that carries it. */
const pointReach = (placed: PlacedGrid) => (placed.grid.radius ?? DEFAULT_POINT_RADIUS) * (placed.frame?.scale ?? 1);

/**
 * Where a piece of `component` dropped with its centre at (x, y) snaps: the nearest point of the first grid (see
 * placedGrids) that snaps, takes the component and has a point in range (always, for square and hex grids, though a
 * carried grid only near its bounds). Undefined when it stays where it was dropped. `exclude` are the pieces being
 * moved, whose own grids don't count.
 */
export function snapTarget(project: Pick<Project, 'grids' | 'settings' | 'instances' | 'components'>, component: Pick<Component, 'gridTags' | 'snapToGrid'>, x: number, y: number,
  exclude?: ReadonlySet<string>): GridSnap | undefined {
  for (const placed of placedGrids(project, exclude)) {
    if (!placed.grid.snap || !gridAccepts(placed.grid, component)) continue;
    const nearest = nearestPlacedPoint(placed, x, y);
    if (!nearest || (placed.grid.shape === 'points' && nearest.distance > pointReach(placed))) continue;
    const { distance: _, ...target } = nearest;
    return target;
  }
  return undefined;
}

/**
 * The grid point a table piece is snapped to: the first grid it snaps to (see placedGrids, never one it carries itself)
 * that has a point exactly at its centre. Pass `placed` when checking many pieces of one project.
 */
export function snapOf(project: Pick<Project, 'grids' | 'settings' | 'components' | 'instances'>, item: Instance, placed = placedGrids(project)): GridSnap | undefined {
  if (item.holder) return undefined;
  const component = project.components.find(c => c.id === item.componentId);
  if (!component) return undefined;
  for (const entry of placed) {
    if (entry.host === item.id || (entry.hostStack && entry.hostStack === item.stack) || !entry.grid.snap || !gridAccepts(entry.grid, component)) continue;
    const nearest = nearestPlacedPoint(entry, item.x, item.y);
    if (nearest && nearest.distance <= ON_POINT) { const { distance: _, ...snap } = nearest; return snap; }
  }
  return undefined;
}

/** Checks a project's grid layers: unique grid ids, and unique point ids within each points grid. */
export function validateGrids(grids: Grid[] | undefined) {
  if (!grids) return;
  if (new Set(grids.map(grid => grid.id)).size !== grids.length) throw new Error('Duplicate grid identifiers.');
  for (const grid of grids) {
    const points = grid.points ?? [];
    if (new Set(points.map(point => point.id)).size !== points.length) throw new Error(`Grid “${grid.name}” has duplicate point identifiers.`);
    const groups = new Map((grid.pointGroups ?? []).map(group => [group.id, group]));
    if (groups.size !== (grid.pointGroups ?? []).length) throw new Error(`Grid “${grid.name}” has duplicate point group identifiers.`);
    for (const group of groups.values()) {
      let depth = 0;
      for (let parent = group.parent; parent; parent = groups.get(parent)!.parent) {
        if (!groups.has(parent)) throw new Error(`A point group in “${grid.name}” references a missing parent group.`);
        if (parent === group.id || ++depth > 32) throw new Error('Point groups cannot contain themselves or nest more than 32 levels deep.');
      }
    }
    if (points.some(point => point.group && !groups.has(point.group))) throw new Error(`A point in “${grid.name}” references a missing point group.`);
  }
}

export type PointTreeRow =
  | { kind: 'group'; key: string; depth: number; group: PointGroup; points: string[]; expanded: boolean }
  | { kind: 'point'; key: string; depth: number; point: GridPoint; index: number };

/** A points grid's points as the Points panel shows them: each group (groups first, then points, in list order) and its contents. */
export function pointTree(grid: Pick<Grid, 'points' | 'pointGroups'>, collapsed: ReadonlySet<string> = new Set()): PointTreeRow[] {
  const groups = grid.pointGroups ?? [], points = grid.points ?? [];
  const known = new Set(groups.map(group => group.id));
  const inside = (parent: string | null): string[] => [
    ...points.filter(point => (point.group && known.has(point.group) ? point.group : null) === parent).map(point => point.id),
    ...groups.filter(group => group.parent === parent).flatMap(group => inside(group.id)),
  ];
  const rows: PointTreeRow[] = [];
  const visit = (parent: string | null, depth: number, seen: Set<string>) => {
    for (const group of groups.filter(item => item.parent === parent && !seen.has(item.id))) {
      const expanded = !collapsed.has(group.id);
      rows.push({ kind: 'group', key: `group:${group.id}`, depth, group, points: inside(group.id), expanded });
      if (expanded) visit(group.id, depth + 1, new Set([...seen, group.id]));
    }
    points.forEach((point, index) => {
      if ((point.group && known.has(point.group) ? point.group : null) === parent) rows.push({ kind: 'point', key: `point:${point.id}`, depth, point, index });
    });
  };
  visit(null, 0, new Set());
  return rows;
}

/** Point group ids containing `id` (inclusive), from the group itself up to its top-level ancestor. */
export function pointGroupAncestors(groups: PointGroup[], id: string | null | undefined): string[] {
  const byId = new Map(groups.map(group => [group.id, group])), chain: string[] = [];
  for (let current = id ? byId.get(id) : undefined; current && !chain.includes(current.id); current = current.parent ? byId.get(current.parent) : undefined) chain.push(current.id);
  return chain;
}

/** Removes a point group, moving its points and subgroups up into its parent. */
export function ungroupPoints(grid: Grid, groupId: string): Grid {
  const group = grid.pointGroups?.find(item => item.id === groupId);
  if (!group) return grid;
  return {
    ...grid,
    pointGroups: grid.pointGroups!.filter(item => item.id !== groupId).map(item => item.parent === groupId ? { ...item, parent: group.parent } : item),
    points: (grid.points ?? []).map(point => point.group === groupId ? (({ group: _, ...rest }) => group.parent ? { ...rest, group: group.parent } : rest)(point) : point),
  };
}

/** The corners of a hex cell centred at (x, y), for drawing. */
export function hexCorners(grid: Pick<Grid, 'size' | 'orientation'>, x: number, y: number): { x: number; y: number }[] {
  const radius = grid.size / SQRT3;
  return Array.from({ length: 6 }, (_, n) => {
    const angle = (60 * n + (grid.orientation === 'flat' ? 0 : 30)) * Math.PI / 180;
    return { x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle) };
  });
}
