import * as clipping from 'polygon-clipping';
import type { DesignNode } from './domain';

type Point = [number, number];
type MultiPolygon = clipping.MultiPolygon;
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
