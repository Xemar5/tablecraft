/**
 * Layer pivots, as in game-engine UI (Unity's RectTransform pivot) and design tools' reference point. A pivot is a point
 * in the layer's box, as fractions of its width and height: 0,0 is the top-left corner, 0.5,0.5 the centre and 1,1 the
 * bottom-right corner.
 *
 * - X/Y place the pivot in the parent. A layer whose size changes (a Width/Height edit, or Hug following its text) grows
 *   and shrinks around its pivot: a right pivot keeps the right edge where it is, a centre pivot grows both ways.
 * - The layer turns about its pivot.
 * - Fill parent axes and stacked layers have no X/Y (see src/layoutRules.ts). There the layout places the box, and the
 *   pivot only sets the point the layer turns about.
 *
 * Layers saved before pivots existed were placed by their top-left corner and turned about their centre. `withPivot`
 * gives them the pivot that keeps them where they were.
 */
export type Point = { x: number; y: number };
/** What places a layer (its own types, so the layer schema can use `withPivot` without a type cycle). */
type Pivot = { pivotX?: number; pivotY?: number };
type Placed = { x: number; y: number; width: number; height: number; rotation: number } & Pivot;

export const pivotOf = (node: Pivot): Point => ({ x: node.pivotX ?? 0, y: node.pivotY ?? 0 });

const turnOf = (node: { rotation: number }) => {
  const angle = node.rotation * Math.PI / 180;
  return { cos: Math.cos(angle), sin: Math.sin(angle) };
};
const round = (value: number) => Math.round(value * 100) / 100;

/** A point given in a layer's own box (0..width, 0..height, before it turns) in its parent's coordinates. */
export function toParent(node: Placed, x: number, y: number): Point {
  const pivot = pivotOf(node), { cos, sin } = turnOf(node);
  const dx = x - pivot.x * node.width, dy = y - pivot.y * node.height;
  return { x: node.x + dx * cos - dy * sin, y: node.y + dx * sin + dy * cos };
}

/** A point in a layer's parent, in the layer's own box (the inverse of `toParent`). */
export function fromParent(node: Placed, x: number, y: number): Point {
  const pivot = pivotOf(node), { cos, sin } = turnOf(node);
  const dx = x - node.x, dy = y - node.y;
  return { x: pivot.x * node.width + dx * cos + dy * sin, y: pivot.y * node.height - dx * sin + dy * cos };
}

/** The box a turned layer covers in its parent, upright. */
export function parentBounds(node: Placed) {
  const corners = [[0, 0], [node.width, 0], [0, node.height], [node.width, node.height]].map(([x, y]) => toParent(node, x, y));
  const xs = corners.map(corner => corner.x), ys = corners.map(corner => corner.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

/**
 * X/Y that keep what a layer shows in place when its box changes: the new box is `width` × `height` and its top-left
 * corner is at (`left`, `top`) in the old box (before turning). Resize handles and path bounds use it.
 */
export function reboxed(node: Placed, left: number, top: number, width: number, height: number): Point {
  const pivot = pivotOf(node), { cos, sin } = turnOf(node);
  const dx = left + pivot.x * (width - node.width), dy = top + pivot.y * (height - node.height);
  return { x: node.x + dx * cos - dy * sin, y: node.y + dx * sin + dy * cos };
}

/**
 * A new pivot with the X/Y that keep the layer where it is, as changing the pivot does in design tools and Unity.
 * `width` and `height` are the layer's shown size (measured, for Hug and Fill). Only the axes whose X/Y place the
 * layer (`placed`) move; elsewhere the layout places it.
 */
export function repivoted(node: Placed, pivotX: number, pivotY: number, width = node.width, height = node.height,
  placed: { x: boolean; y: boolean } = { x: true, y: true }): { x: number; y: number; pivotX: number; pivotY: number } {
  const at = toParent({ ...node, width, height }, pivotX * width, pivotY * height);
  return { x: placed.x ? round(at.x) : node.x, y: placed.y ? round(at.y) : node.y, pivotX, pivotY };
}

/**
 * A layer with its pivot set. One without a pivot (saved before pivots existed, or made in code without one) is placed by
 * its top-left corner and turns about its centre: unturned it gets the top-left pivot; turned, the centre pivot with
 * X/Y moved to its centre, which keeps it exactly where it was.
 */
export function withPivot<T extends Placed>(node: T): T & { pivotX: number; pivotY: number } {
  if (node.pivotX !== undefined && node.pivotY !== undefined) return node as T & { pivotX: number; pivotY: number };
  if (node.pivotX !== undefined || node.pivotY !== undefined || !(node.rotation % 360)) return { ...node, pivotX: node.pivotX ?? 0, pivotY: node.pivotY ?? 0 };
  return { ...node, pivotX: .5, pivotY: .5, x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

/** The nine pivot presets: corners, edge middles and centre. */
export const PIVOT_PRESETS = ([
  [0, 0, 'Top left'], [.5, 0, 'Top'], [1, 0, 'Top right'],
  [0, .5, 'Left'], [.5, .5, 'Center'], [1, .5, 'Right'],
  [0, 1, 'Bottom left'], [.5, 1, 'Bottom'], [1, 1, 'Bottom right'],
] as const).map(([x, y, label]) => ({ x, y, label }));
