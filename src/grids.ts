import { z } from 'zod';
import type { Component, Instance, Project } from './domain';
import { matchesTags, normalizeTags, tagFilterSchema } from './tags';

/**
 * Table grids. A project has a list of grid layers; the first grid in the list wins when several could take a piece.
 * Square and hex grids are endless lattices; a points grid is a set of snap points placed by hand. Each grid's tag
 * filter picks the components (by their grid tags) that snap to it; components without grid tags snap to every grid,
 * and a component's "Can snap to grids" setting turns snapping off for it.
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
});
export type GridPoint = z.infer<typeof gridPointSchema>;
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
  /** Points grids: how close (px) a piece's centre must come to a point to snap (50 when absent). */
  radius: z.number().finite().min(1).max(2000).optional(),
  /** Which components snap here, by their grid tags. */
  filter: tagFilterSchema.optional(),
  color: z.string().max(80).optional(),
});
export type Grid = z.infer<typeof gridSchema>;
export type GridSnap = { grid: string; point: string; x: number; y: number; rotation?: number };

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
 * Where a piece of `component` dropped with its centre at (x, y) snaps: the nearest point of the first grid (in list
 * order) that snaps, takes the component and has a point in range (always, for square and hex grids). Undefined when
 * it stays where it was dropped.
 */
export function snapTarget(project: Pick<Project, 'grids' | 'settings'>, component: Pick<Component, 'gridTags' | 'snapToGrid'>, x: number, y: number): GridSnap | undefined {
  for (const grid of projectGrids(project)) {
    if (!grid.snap || !gridAccepts(grid, component)) continue;
    const nearest = nearestGridPoint(grid, x, y);
    if (!nearest || (grid.shape === 'points' && nearest.distance > (grid.radius ?? DEFAULT_POINT_RADIUS))) continue;
    const { distance: _, ...target } = nearest;
    return target;
  }
  return undefined;
}

/** The grid point a table piece is snapped to: the first grid it snaps to that has a point exactly at its centre. */
export function snapOf(project: Pick<Project, 'grids' | 'settings' | 'components'>, item: Instance, grids = projectGrids(project)): GridSnap | undefined {
  if (item.holder) return undefined;
  const component = project.components.find(c => c.id === item.componentId);
  if (!component) return undefined;
  for (const grid of grids) {
    if (!grid.snap || !gridAccepts(grid, component)) continue;
    const nearest = nearestGridPoint(grid, item.x, item.y);
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
  }
}

/** The corners of a hex cell centred at (x, y), for drawing. */
export function hexCorners(grid: Pick<Grid, 'size' | 'orientation'>, x: number, y: number): { x: number; y: number }[] {
  const radius = grid.size / SQRT3;
  return Array.from({ length: 6 }, (_, n) => {
    const angle = (60 * n + (grid.orientation === 'flat' ? 0 : 30)) * Math.PI / 180;
    return { x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle) };
  });
}
