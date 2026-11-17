import * as clipping from 'polygon-clipping';
import type { DesignNode } from './domain';

type Point = [number, number];
type MultiPolygon = clipping.MultiPolygon;
type VectorPoint = DesignNode['points'][number];

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export function segmentControls(from: VectorPoint, to: VectorPoint): [Point, Point, Point, Point] {
  return [[from.x, from.y], [from.x + from.outX, from.y + from.outY],
    [to.x + to.inX, to.y + to.inY], [to.x, to.y]];
}
export function cubicAt(p: [Point, Point, Point, Point], t: number): Point {
  const u = 1 - t;
  return [0, 1].map(axis => u ** 3 * p[0][axis] + 3 * u ** 2 * t * p[1][axis] +
    3 * u * t ** 2 * p[2][axis] + t ** 3 * p[3][axis]) as Point;
}
export function splitPathSegment(points: VectorPoint[], index: number, t: number): VectorPoint[] {
  const next = (index + 1) % points.length, from = points[index], to = points[next];
  const [p0, p1, p2, p3] = segmentControls(from, to);
  const q0 = lerp(p0, p1, t), q1 = lerp(p1, p2, t), q2 = lerp(p2, p3, t);
  const r0 = lerp(q0, q1, t), r1 = lerp(q1, q2, t), s = lerp(r0, r1, t);
  const result = points.map(point => ({ ...point }));
  result[index] = { ...from, outX: q0[0] - p0[0], outY: q0[1] - p0[1] };
  result[next] = { ...to, inX: q2[0] - p3[0], inY: q2[1] - p3[1] };
  result.splice(index + 1, 0, { x: s[0], y: s[1], inX: r0[0] - s[0], inY: r0[1] - s[1],
    outX: r1[0] - s[0], outY: r1[1] - s[1] });
  return result;
}
// Search every interval, not just the closest sample: a cubic can loop back on itself.
export function closestSegmentParameter(controls: [Point, Point, Point, Point], target: Point): number {
  const distance = (t: number) => { const p = cubicAt(controls, t); return (p[0] - target[0]) ** 2 + (p[1] - target[1]) ** 2; };
  let best = 0, bestDistance = distance(0);
  for (let i = 0; i < 64; i++) {
    let a = i / 64, b = (i + 1) / 64;
    for (let j = 0; j < 24; j++) {
      const l = a + (b - a) / 3, r = b - (b - a) / 3;
      if (distance(l) < distance(r)) b = r; else a = l;
    }
    const t = (a + b) / 2, d = distance(t);
    if (d < bestDistance) { best = t; bestDistance = d; }
  }
  return best;
}
export function pathBounds(node: DesignNode) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = ([x, y]: Point) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  node.points.forEach(point => add([point.x, point.y]));
  const count = node.points.length - (node.pathClosed ? 0 : 1);
  for (let i = 0; i < count; i++) {
    const p = segmentControls(node.points[i], node.points[(i + 1) % node.points.length]);
    for (let axis = 0; axis < 2; axis++) {
      const a = -p[0][axis] + 3 * p[1][axis] - 3 * p[2][axis] + p[3][axis];
      const b = 2 * (p[0][axis] - 2 * p[1][axis] + p[2][axis]);
      const c = p[1][axis] - p[0][axis];
      const roots: number[] = [];
      if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) roots.push(-c / b); }
      else { const d = b * b - 4 * a * c; if (d >= 0) roots.push((-b + Math.sqrt(d)) / (2 * a), (-b - Math.sqrt(d)) / (2 * a)); }
      roots.filter(t => t > 0 && t < 1).forEach(t => add(cubicAt(p, t)));
    }
  }
  const padding = node.pathClosed ? (node.stroke === 'transparent' ? 0 : node.strokeWidth / 2) : Math.max(1, node.strokeWidth) / 2;
  return { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding };
}
// Expand only, keeping every existing point fixed in the parent's coordinate system,
// including when the node rotates about its own centre.
export function expandPathBounds(node: DesignNode): DesignNode {
  if (node.type !== 'shape' || node.shapeKind !== 'path' || !node.points.length) return node;
  const bounds = pathBounds(node);
  const left = Math.min(0, bounds.minX), top = Math.min(0, bounds.minY);
  const width = Math.max(node.width, bounds.maxX) - left, height = Math.max(node.height, bounds.maxY) - top;
  if (width > 4000 || height > 4000) throw new Error('Path bounds cannot exceed 4000 units.');
  if (!left && !top && width === node.width && height === node.height) return node;
  const angle = node.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = left + width / 2 - node.width / 2, dy = top + height / 2 - node.height / 2;
  return { ...node, x: node.x + node.width / 2 + dx * cos - dy * sin - width / 2,
    y: node.y + node.height / 2 + dx * sin + dy * cos - height / 2, width, height,
    points: node.points.map(point => ({ ...point, x: point.x - left, y: point.y - top })) };
}
const clippingApi = (clipping as unknown as { default: {
  difference: (geometry: MultiPolygon, ...others: MultiPolygon[]) => MultiPolygon;
  intersection: (geometry: MultiPolygon, ...others: MultiPolygon[]) => MultiPolygon;
  xor: (geometry: MultiPolygon, ...others: MultiPolygon[]) => MultiPolygon;
  union: (geometry: MultiPolygon, ...others: MultiPolygon[]) => MultiPolygon;
} }).default;

const regularPoints = (node: DesignNode, star = false): Point[] => Array.from({ length: node.sides * (star ? 2 : 1) }, (_, index) => {
  const outer = Math.min(node.width, node.height) / 2;
  const radius = star && index % 2 ? outer * node.innerRadius : outer;
  const angle = -Math.PI / 2 + index * Math.PI * 2 / (node.sides * (star ? 2 : 1));
  return [node.width / 2 + Math.cos(angle) * radius, node.height / 2 + Math.sin(angle) * radius];
});

export function pathForShape(node: DesignNode): string {
  const { width: w, height: h } = node;
  if (node.shapeKind === 'ellipse') return `M ${w / 2} 0 A ${w / 2} ${h / 2} 0 1 1 ${w / 2} ${h} A ${w / 2} ${h / 2} 0 1 1 ${w / 2} 0 Z`;
  if (node.shapeKind === 'rectangle') {
    const r = Math.min(node.radius, w / 2, h / 2);
    return r ? `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`
      : `M 0 0 H ${w} V ${h} H 0 Z`;
  }
  const points = node.shapeKind === 'polygon' ? regularPoints(node) : node.shapeKind === 'star' ? regularPoints(node, true) : node.points.map(point => [point.x, point.y] as Point);
  if (!points.length) return '';
  if (node.shapeKind !== 'path') return `M ${points.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`;
  const commands = [`M ${points[0][0]} ${points[0][1]}`];
  for (let index = 0; index < points.length - (node.pathClosed ? 0 : 1); index++) {
    const from = node.points[index], to = node.points[(index + 1) % points.length];
    if (from.outX || from.outY || to.inX || to.inY) commands.push(`C ${from.x + from.outX} ${from.y + from.outY} ${to.x + to.inX} ${to.y + to.inY} ${to.x} ${to.y}`);
    else commands.push(`L ${to.x} ${to.y}`);
  }
  if (node.pathClosed) commands.push('Z');
  return commands.join(' ');
}

function flattenPath(node: DesignNode): Point[] {
  if (!node.points.length || !node.pathClosed) return [];
  const result: Point[] = [];
  for (let index = 0; index < node.points.length; index++) {
    const from = node.points[index], to = node.points[(index + 1) % node.points.length];
    if (!result.length) result.push([from.x, from.y]);
    if (!(from.outX || from.outY || to.inX || to.inY)) { result.push([to.x, to.y]); continue; }
    const p0: Point = [from.x, from.y], p1: Point = [from.x + from.outX, from.y + from.outY];
    const p2: Point = [to.x + to.inX, to.y + to.inY], p3: Point = [to.x, to.y];
    for (let step = 1; step <= 16; step++) {
      const t = step / 16, u = 1 - t;
      result.push([
        u ** 3 * p0[0] + 3 * u ** 2 * t * p1[0] + 3 * u * t ** 2 * p2[0] + t ** 3 * p3[0],
        u ** 3 * p0[1] + 3 * u ** 2 * t * p1[1] + 3 * u * t ** 2 * p2[1] + t ** 3 * p3[1],
      ]);
    }
  }
  result.pop();
  return result;
}

function shapeRing(node: DesignNode): Point[] {
  if (node.shapeKind === 'rectangle') {
    const r = Math.min(node.radius, node.width / 2, node.height / 2);
    if (!r) return [[0, 0], [node.width, 0], [node.width, node.height], [0, node.height]];
    const ring: Point[] = [];
    for (const [cx, cy, start] of [[node.width - r, r, -90], [node.width - r, node.height - r, 0], [r, node.height - r, 90], [r, r, 180]] as const) {
      for (let step = 0; step <= 8; step++) {
        const angle = (start + step * 90 / 8) * Math.PI / 180;
        ring.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
      }
    }
    return ring;
  }
  if (node.shapeKind === 'ellipse') return Array.from({ length: 64 }, (_, index) => {
    const angle = index * Math.PI / 32;
    return [node.width / 2 + Math.cos(angle) * node.width / 2, node.height / 2 + Math.sin(angle) * node.height / 2];
  });
  if (node.shapeKind === 'polygon') return regularPoints(node);
  if (node.shapeKind === 'star') return regularPoints(node, true);
  return flattenPath(node);
}

function operationGeometry(inputs: MultiPolygon[], operation: DesignNode['compoundOperation']): MultiPolygon {
  if (!inputs.length) return [];
  if (inputs.length === 1) return inputs[0];
  if (operation === 'subtract') return clippingApi.difference(inputs[0], ...inputs.slice(1));
  if (operation === 'intersect') return clippingApi.intersection(inputs[0], ...inputs.slice(1));
  if (operation === 'exclude') return clippingApi.xor(inputs[0], ...inputs.slice(1));
  return clippingApi.union(inputs[0], ...inputs.slice(1));
}

function transformGeometry(geometry: MultiPolygon, node: DesignNode): MultiPolygon {
  const angle = node.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return geometry.map(polygon => polygon.map(ring => ring.map(([x, y]) => {
    const cx = x - node.width / 2, cy = y - node.height / 2;
    return [node.x + node.width / 2 + cx * cos - cy * sin, node.y + node.height / 2 + cx * sin + cy * cos] as Point;
  })));
}

function geometryForNode(node: DesignNode, siblings: DesignNode[]): MultiPolygon {
  if (node.type === 'shape') {
    const ring = shapeRing(node);
    return ring.length < 3 ? [] : [[ring]] as MultiPolygon;
  }
  if (node.type !== 'compound') return [];
  const children = siblings.filter(child => child.parent === node.id);
  const geometries = children.map(child => transformGeometry(geometryForNode(child, siblings), child));
  return operationGeometry(geometries, node.compoundOperation);
}

export function compoundGeometry(children: DesignNode[], operation: DesignNode['compoundOperation'], allNodes = children): MultiPolygon {
  return operationGeometry(children.map(node => transformGeometry(geometryForNode(node, allNodes), node)), operation);
}

export function pathForCompound(nodes: DesignNode[], compound: DesignNode): string {
  const children = nodes.filter(node => node.parent === compound.id);
  const geometry = compoundGeometry(children, compound.compoundOperation, nodes);
  return geometry.flatMap(polygon => polygon.flatMap(ring => {
    if (!ring.length) return [];
    return [`M ${ring.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`];
  })).join(' ');
}

export function polygonArea(geometry: MultiPolygon): number {
  return geometry.reduce((sum, polygon) => sum + polygon.reduce((area, ring, index) => {
    const ringArea = Math.abs(ring.reduce((value, [x, y], i) => {
      const [nextX, nextY] = ring[(i + 1) % ring.length];
      return value + x * nextY - nextX * y;
    }, 0) / 2);
    return area + (index === 0 ? ringArea : -ringArea);
  }, 0), 0);
}

/** Shrinks or grows a path layer's box to fit its points exactly, keeping every point fixed in the parent's space. */
export function fitPathBounds(node: DesignNode): DesignNode {
  if (node.type !== 'shape' || node.shapeKind !== 'path' || !node.points.length) return node;
  const bounds = pathBounds(node);
  const width = Math.max(1, bounds.maxX - bounds.minX), height = Math.max(1, bounds.maxY - bounds.minY);
  if (width > 4000 || height > 4000) throw new Error('Path bounds cannot exceed 4000 units.');
  const angle = node.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = bounds.minX + width / 2 - node.width / 2, dy = bounds.minY + height / 2 - node.height / 2;
  const round = (value: number) => Math.round(value * 100) / 100;
  return { ...node, x: round(node.x + node.width / 2 + dx * cos - dy * sin - width / 2),
    y: round(node.y + node.height / 2 + dx * sin + dy * cos - height / 2), width: round(width), height: round(height),
    points: node.points.map(point => ({ ...point, x: round(point.x - bounds.minX), y: round(point.y - bounds.minY),
      inX: round(point.inX), inY: round(point.inY), outX: round(point.outX), outY: round(point.outY) })) };
}

const corner = (x: number, y: number, inX = 0, inY = 0, outX = 0, outY = 0): VectorPoint => ({ x, y, inX, inY, outX, outY });
/** Merges consecutive points at the same place (a fully rounded side), keeping the curve on both sides. */
function mergeCoincident(points: VectorPoint[]): VectorPoint[] {
  const result: VectorPoint[] = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last && Math.abs(last.x - point.x) < 1e-6 && Math.abs(last.y - point.y) < 1e-6) result[result.length - 1] = { ...last, outX: point.outX, outY: point.outY };
    else result.push(point);
  }
  const first = result[0], last = result.at(-1);
  if (result.length > 1 && first && last && Math.abs(last.x - first.x) < 1e-6 && Math.abs(last.y - first.y) < 1e-6) {
    result[0] = { ...first, inX: last.inX, inY: last.inY };
    result.pop();
  }
  return result;
}

/**
 * The points and Bézier handles that draw a rectangle, ellipse, polygon or star exactly as it renders, so it can be
 * edited as a pen path. Rounded corners are quadratic curves, which convert to cubic handles of 2/3 the radius.
 */
export function shapeAsPath(node: DesignNode): VectorPoint[] {
  const { width: w, height: h } = node;
  if (node.shapeKind === 'path') return node.points;
  if (node.shapeKind === 'ellipse') {
    const k = 0.5522847498, rx = w / 2, ry = h / 2;
    return [corner(rx, 0, -k * rx, 0, k * rx, 0), corner(w, ry, 0, -k * ry, 0, k * ry),
      corner(rx, h, k * rx, 0, -k * rx, 0), corner(0, ry, 0, k * ry, 0, -k * ry)];
  }
  if (node.shapeKind === 'rectangle') {
    const r = Math.min(node.radius, w / 2, h / 2), c = r * 2 / 3;
    if (!r) return [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)];
    return mergeCoincident([corner(r, 0, -c, 0), corner(w - r, 0, 0, 0, c, 0), corner(w, r, 0, -c), corner(w, h - r, 0, 0, 0, c),
      corner(w - r, h, c, 0), corner(r, h, 0, 0, -c, 0), corner(0, h - r, 0, c), corner(0, r, 0, 0, 0, -c)]);
  }
  return regularPoints(node, node.shapeKind === 'star').map(([x, y]) => corner(x, y));
}

/** Removes points that barely change a closed ring's outline (Ramer–Douglas–Peucker), within `tolerance` units. */
export function simplifyRing(ring: Point[], tolerance: number): Point[] {
  if (ring.length <= 3) return ring;
  const distance = ([x, y]: Point, [ax, ay]: Point, [bx, by]: Point) => {
    const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
  };
  const keep = (points: Point[]): Point[] => {
    let index = -1, furthest = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const d = distance(points[i], points[0], points[points.length - 1]);
      if (d > furthest) { furthest = d; index = i; }
    }
    if (furthest <= tolerance) return [points[0], points[points.length - 1]];
    return [...keep(points.slice(0, index + 1)).slice(0, -1), ...keep(points.slice(index))];
  };
  // Split the closed ring at its two most distant points so both halves simplify as open lines.
  let far = 0;
  ring.forEach((point, i) => { if (Math.hypot(point[0] - ring[0][0], point[1] - ring[0][1]) > Math.hypot(ring[far][0] - ring[0][0], ring[far][1] - ring[0][1])) far = i; });
  const first = keep(ring.slice(0, far + 1)), second = keep([...ring.slice(far), ring[0]]);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/** The outline rings of a live compound in its own coordinates, each simplified to at most `maxPoints` points. */
export function compoundRings(nodes: DesignNode[], compound: DesignNode, maxPoints = 128): Point[][] {
  const geometry = compoundGeometry(nodes.filter(node => node.parent === compound.id), compound.compoundOperation, nodes);
  return geometry.flatMap(polygon => polygon).map(ring => {
    // polygon-clipping repeats the first point at the end of each ring.
    const open = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
    let tolerance = .05, simplified = simplifyRing(open as Point[], tolerance);
    while (simplified.length > maxPoints && tolerance < 1000) simplified = simplifyRing(open as Point[], tolerance *= 2);
    return simplified;
  }).filter(ring => ring.length >= 3);
}
