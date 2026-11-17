// Small drawing toolkit that produces Tablecraft DesignNode layers.
import { makeNode, type Component, type DesignNode } from '../../../src/domain';
import { splitPathSegment } from '../../../src/vectorGeometry';

export const PAPER = '#F6F3EC', INK = '#2A2C35', MUTED = '#85868F', WHITE = '#FFFFFF';
export const TITLE = 'Russo One', BODY = 'Inter', WORDMARK = 'Cinzel';

export type Pt = { x: number; y: number; inX: number; inY: number; outX: number; outY: number };
export const P = (x: number, y: number): Pt => ({ x, y, inX: 0, inY: 0, outX: 0, outY: 0 });
export const C = (x: number, y: number, inX: number, inY: number, outX: number, outY: number): Pt => ({ x, y, inX, inY, outX, outY });

type Props = Partial<DesignNode>;

/** Accumulates layers for one component face with deterministic IDs. */
export class Layers {
  nodes: DesignNode[] = [];
  private count = 0;
  constructor(private prefix: string) {}
  add(type: DesignNode['type'], parent: string | null, props: Props): string {
    const id = `${this.prefix}-${(++this.count).toString(36)}`;
    this.nodes.push(makeNode(type, { name: type, ...props, id, parent }));
    return id;
  }
  draw(parent: string | null = null): Draw { return new Draw(this, parent); }
}

/** Drawing context bound to a parent frame (or the face root). Coordinates are parent-relative. */
export class Draw {
  constructor(readonly layers: Layers, readonly parent: string | null) {}
  frame(x: number, y: number, w: number, h: number, props: Props = {}): Draw {
    const id = this.layers.add('frame', this.parent, { name: 'Group', x, y, width: w, height: h, fill: 'transparent', layout: 'absolute', ...props });
    return new Draw(this.layers, id);
  }
  rect(x: number, y: number, w: number, h: number, fill: string, props: Props = {}) {
    return this.layers.add('shape', this.parent, { name: 'Rectangle', shapeKind: 'rectangle', x, y, width: w, height: h, fill, ...props });
  }
  ell(x: number, y: number, w: number, h: number, fill: string, props: Props = {}) {
    return this.layers.add('shape', this.parent, { name: 'Ellipse', shapeKind: 'ellipse', x, y, width: w, height: h, fill, ...props });
  }
  poly(x: number, y: number, w: number, h: number, sides: number, fill: string, props: Props = {}) {
    return this.layers.add('shape', this.parent, { name: 'Polygon', shapeKind: 'polygon', sides, x, y, width: w, height: h, fill, ...props });
  }
  star(x: number, y: number, w: number, h: number, points: number, inner: number, fill: string, props: Props = {}) {
    return this.layers.add('shape', this.parent, { name: 'Star', shapeKind: 'star', sides: points, innerRadius: inner, x, y, width: w, height: h, fill, ...props });
  }
  /** Closed (filled) or open (stroked) bezier path in parent coordinates. */
  path(points: Pt[], fill: string, opts: { stroke?: string; sw?: number; closed?: boolean; name?: string } & Props = {}) {
    const { stroke, sw, closed = true, name = 'Path', ...props } = opts;
    // Tablecraft needs three anchors for a closed path: split a two-anchor shape exactly.
    if (closed && points.length === 2) points = splitPathSegment(points, 0, 0.5) as Pt[];
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const width = Math.max(1, Math.max(...xs) - minX), height = Math.max(1, Math.max(...ys) - minY);
    const round = (n: number) => Math.round(n * 100) / 100;
    return this.layers.add('shape', this.parent, {
      name, shapeKind: 'path', pathClosed: closed, x: round(minX), y: round(minY), width: round(width), height: round(height), fill,
      stroke: stroke ?? 'transparent', strokeWidth: sw ?? 0,
      points: points.map(p => ({ x: round(p.x - minX), y: round(p.y - minY), inX: round(p.inX), inY: round(p.inY), outX: round(p.outX), outY: round(p.outY) })),
      ...props,
    });
  }
  /** Open stroked polyline/curve; Tablecraft strokes open paths with their fill colour. */
  line(points: Pt[], color: string, width: number, props: Props = {}) {
    return this.path(points, color, { closed: false, sw: width, name: 'Line', ...props });
  }
  ring(cx: number, cy: number, r: number, color: string, width: number, props: Props = {}) {
    return this.path(circlePts(cx, cy, r), 'transparent', { stroke: color, sw: width, name: 'Ring', ...props });
  }
  text(x: number, y: number, w: number, h: number, text: string, props: Props & { size?: number } = {}) {
    const { size = 12, ...rest } = props;
    return this.layers.add('text', this.parent, { name: 'Text', x, y, width: w, height: h, text, fontSize: size, font: BODY, color: INK, fill: 'transparent', align: 'start', ...rest });
  }
  /** Text whose top edge is fixed and whose height hugs its content (Tablecraft centres fixed-height text vertically). */
  textTop(x: number, y: number, w: number, text: string, props: Props & { size?: number } = {}) {
    return this.text(x, 0, w, 20, text, { heightMode: 'hug', marginTop: y, ...props });
  }
  nest(x: number, y: number, w: number, h: number, componentId: string, props: Props = {}) {
    return this.layers.add('component', this.parent, { name: 'Linked component', x, y, width: w, height: h, componentId, fill: 'transparent', dataSource: 'inherit', ...props });
  }
}

const K = 0.5523;
export function ellipsePts(cx: number, cy: number, rx: number, ry: number, rotation = 0): Pt[] {
  const a = rotation * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  const rot = (x: number, y: number) => [x * cos - y * sin, x * sin + y * cos];
  const raw = [
    [0, -ry, -K * rx, 0, K * rx, 0], [rx, 0, 0, -K * ry, 0, K * ry],
    [0, ry, K * rx, 0, -K * rx, 0], [-rx, 0, 0, K * ry, 0, -K * ry],
  ];
  return raw.map(([x, y, ix, iy, ox, oy]) => {
    const [px, py] = rot(x, y), [ax, ay] = rot(ix, iy), [bx, by] = rot(ox, oy);
    return C(cx + px, cy + py, ax, ay, bx, by);
  });
}
export const circlePts = (cx: number, cy: number, r: number) => ellipsePts(cx, cy, r, r);

export function gearPts(cx: number, cy: number, outer: number, inner: number, teeth: number, tip = 0.45): Pt[] {
  const pts: Pt[] = [], step = Math.PI * 2 / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = -Math.PI / 2 + i * step, half = step * tip / 2, base = step * (tip + 0.18) / 2;
    for (const [angle, r] of [[a - base, inner], [a - half, outer], [a + half, outer], [a + base, inner]] as const) {
      pts.push(P(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r));
    }
  }
  return pts;
}
export function polyPts(cx: number, cy: number, r: number, sides: number, startDeg = -90): Pt[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = (startDeg + i * 360 / sides) * Math.PI / 180;
    return P(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  });
}
export function roundRectPts(x: number, y: number, w: number, h: number, r: number): Pt[] {
  const k = r * K;
  return [
    C(x + r, y, -k, 0, 0, 0), C(x + w - r, y, 0, 0, k, 0),
    C(x + w, y + r, 0, -k, 0, 0), C(x + w, y + h - r, 0, 0, 0, k),
    C(x + w - r, y + h, k, 0, 0, 0), C(x + r, y + h, 0, 0, -k, 0),
    C(x, y + h - r, 0, k, 0, 0), C(x, y + r, 0, 0, 0, -k),
  ];
}
/** Archimedean spiral from r0 to r1 over `turns`, as an open path. */
export function spiralPts(cx: number, cy: number, r0: number, r1: number, turns: number): Pt[] {
  const steps = Math.round(turns * 4), dt = Math.PI / 2, b = (r1 - r0) / (turns * Math.PI * 2);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i * dt, r = r0 + b * t, c = Math.cos(t - Math.PI / 2), s = Math.sin(t - Math.PI / 2);
    const dx = b * c - r * s, dy = b * s + r * c, h = dt / 3;
    return C(cx + r * c, cy + r * s, -dx * h, -dy * h, dx * h, dy * h);
  });
}
/** Teardrop flame: tip at (cx, top), width w, height h. */
export function flamePts(cx: number, top: number, w: number, h: number): Pt[] {
  return [
    C(cx, top, -w * 0.12, h * 0.3, w * 0.12, h * 0.3),
    C(cx + w / 2, top + h * 0.62, 0, -h * 0.3, 0, h * 0.2),
    C(cx, top + h, w * 0.3, 0, -w * 0.3, 0),
    C(cx - w / 2, top + h * 0.62, 0, h * 0.2, 0, -h * 0.3),
  ];
}
/** Water/sap drop with the point upward. */
export function dropPts(cx: number, top: number, w: number, h: number): Pt[] {
  return [
    C(cx, top, -w * 0.08, h * 0.2, w * 0.08, h * 0.2),
    C(cx + w / 2, top + h * 0.64, 0, -h * 0.28, 0, h * 0.2),
    C(cx, top + h, w * 0.28, 0, -w * 0.28, 0),
    C(cx - w / 2, top + h * 0.64, 0, h * 0.2, 0, -h * 0.28),
  ];
}
/** Pointed leaf between two anchor points with the given half-width. */
export function leafPts(ax: number, ay: number, bx: number, by: number, width: number): Pt[] {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), nx = -dy / len * width, ny = dx / len * width;
  return [
    C(ax, ay, dx * 0.3 - nx, dy * 0.3 - ny, dx * 0.3 + nx, dy * 0.3 + ny),
    C(bx, by, -dx * 0.3 + nx, -dy * 0.3 + ny, -dx * 0.3 - nx, -dy * 0.3 - ny),
  ];
}
export function heartPts(cx: number, top: number, w: number, h: number): Pt[] {
  // Bottom tip and top dip; the lobes come from long control handles.
  const dip = top + h * 0.26;
  return [
    C(cx, top + h, w * 0.62, -h * 0.62, -w * 0.62, -h * 0.62),
    C(cx, dip, -w * 0.3, -h * 0.5, w * 0.3, -h * 0.5),
  ];
}
export function crescentPts(cx: number, top: number, h: number): Pt[] {
  const s = h / 88;
  return [C(cx, top, -34 * s, 14 * s, -66 * s, 12 * s), C(cx, top + h, -66 * s, -12 * s, -34 * s, -14 * s)];
}
export function workerPts(x: number, y: number, w: number, h: number): Pt[] {
  return [
    P(x, y + h),
    C(x, y + h * 0.66, 0, 0, 0, -h * 0.16),
    C(x + w / 2, y + h * 0.42, -w * 0.38, 0, w * 0.38, 0),
    C(x + w, y + h * 0.66, 0, -h * 0.16, 0, 0),
    P(x + w, y + h),
  ];
}

export function mix(a: string, b: string, t: number): string {
  const parse = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [parse(a), parse(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
export const rgba = (hex: string, alpha: number) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
export const spaced = (s: string) => s.toUpperCase().split('').join(' ').replace(/ {3}/g, '   ');

/** CSV with a header row; rows must share the column list. */
export function toCsv(columns: string[], rows: Record<string, string>[]): string {
  const cell = (v: string) => /[",\n\r]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return [columns.map(cell).join(','), ...rows.map(row => columns.map(c => cell(row[c] ?? '')).join(','))].join('\n');
}
export function withRows(columns: string[], rows: Record<string, string>[]): Pick<Component, 'csv' | 'rows'> {
  const full = rows.map(row => Object.fromEntries(columns.map(c => [c, row[c] ?? ''])));
  return { csv: toCsv(columns, full), rows: full };
}

export function component(id: string, name: string, kind: Component['kind'], width: number, height: number, props: Partial<Component> = {}): Component {
  return {
    id, name, kind, width, height, color: 'transparent', front: [], back: [], csv: '', rows: [],
    flippable: false, hand: false, hideInHand: false, stackable: false, shufflable: false, stackTag: '', ...props,
  };
}
