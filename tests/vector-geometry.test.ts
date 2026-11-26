import { describe, expect, it } from 'vitest';
import { makeNode } from '../src/domain';
import { combineLayers, uncombineLayers } from '../src/designerOperations';
import { toParent } from '../src/layerGeometry';
import { closestSegmentParameter, compoundGeometry, cubicAt, expandPathBounds, pathBounds, pathForCompound, pathForShape, polygonArea, segmentControls, splitPathSegment } from '../src/vectorGeometry';

function overlappingSquares() {
  return [
    makeNode('shape', { name: 'A', x: 0, y: 0, width: 100, height: 100, fill: '#f00' }),
    makeNode('shape', { name: 'B', x: 50, y: 0, width: 100, height: 100, fill: '#00f' }),
  ];
}

describe('live vector geometry', () => {
  it('finds exact cubic extrema and includes stroke, without using the control hull', () => {
    const node = makeNode('shape', { shapeKind: 'path', pathClosed: false, width: 100, height: 100, stroke: '#111', strokeWidth: 10, points: [
      { x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 120 },
      { x: 100, y: 0, inX: 0, inY: 120, outX: 0, outY: 0 },
    ] });
    expect(pathBounds(node)).toEqual({ minX: -5, minY: -5, maxX: 105, maxY: 95 });
    // Growing the box keeps every point where it was, whichever point the layer turns about.
    for (const [pivotX, pivotY] of [[0, 0], [.5, .5], [1, .2]]) {
      const rotated = { ...node, rotation: 37, x: 42, y: 23, pivotX, pivotY };
      const expanded = expandPathBounds(rotated);
      const before = toParent(rotated, node.points[0].x, node.points[0].y);
      const after = toParent(expanded, expanded.points[0].x, expanded.points[0].y);
      expect(after.x).toBeCloseTo(before.x, 10);
      expect(after.y).toBeCloseTo(before.y, 10);
      expect(expanded.width).toBe(110);
    }
  });
  it('splits a cubic exactly at the clicked curve parameter, including the closing segment', () => {
    const points = [
      { x: 10, y: 20, inX: -20, inY: 7, outX: 33, outY: -50 },
      { x: 130, y: 80, inX: -40, inY: 45, outX: 10, outY: 4 },
      { x: 70, y: 140, inX: 0, inY: 0, outX: -30, outY: 8 },
    ];
    for (const index of [0, 2]) {
      const t = .37, controls = segmentControls(points[index], points[(index + 1) % points.length]);
      const click = cubicAt(controls, t);
      expect(closestSegmentParameter(controls, click)).toBeCloseTo(t, 5);
      const split = splitPathSegment(points, index, t);
      const left = segmentControls(split[index], split[index + 1]);
      const right = segmentControls(split[index + 1], split[(index + 2) % split.length]);
      for (const u of [0, .15, .5, .9, 1]) {
        const a = cubicAt(controls, u * t), b = cubicAt(left, u);
        expect(b[0]).toBeCloseTo(a[0], 9); expect(b[1]).toBeCloseTo(a[1], 9);
        const c = cubicAt(controls, t + u * (1 - t)), d = cubicAt(right, u);
        expect(d[0]).toBeCloseTo(c[0], 9); expect(d[1]).toBeCloseTo(c[1], 9);
      }
    }
  });
  it('computes actual union, subtract, intersection and symmetric-difference regions', () => {
    const [a, b] = overlappingSquares();
    expect(polygonArea(compoundGeometry([a, b], 'union'))).toBeCloseTo(15000, 5);
    expect(polygonArea(compoundGeometry([a, b], 'subtract'))).toBeCloseTo(5000, 5);
    expect(polygonArea(compoundGeometry([a, b], 'intersect'))).toBeCloseTo(5000, 5);
    expect(polygonArea(compoundGeometry([a, b], 'exclude'))).toBeCloseTo(10000, 5);
  });

  it('preserves holes in a boolean difference instead of painting a flattened silhouette', () => {
    const outer = makeNode('shape', { x: 0, y: 0, width: 100, height: 100 });
    const inner = makeNode('shape', { x: 25, y: 25, width: 50, height: 50 });
    const difference = compoundGeometry([outer, inner], 'subtract');
    expect(difference[0]).toHaveLength(2);
    expect(polygonArea(difference)).toBeCloseTo(7500, 5);
  });

  it('keeps source paths editable and recomputes a live boolean after source edits', () => {
    const [a, b] = overlappingSquares();
    const result = combineLayers([a, b], [a.id, b.id], 'subtract');
    const compound = result.nodes.find(node => node.type === 'compound')!;
    expect(result.selected).toEqual([compound.id]);
    expect(compound.compoundOperation).toBe('subtract');
    expect(result.nodes.filter(node => node.parent === compound.id)).toHaveLength(2);
    expect(pathForCompound(result.nodes, compound)).toContain('M');
    const children = result.nodes.filter(node => node.parent === compound.id);
    expect(polygonArea(compoundGeometry(children, compound.compoundOperation, result.nodes))).toBeCloseTo(5000, 5);
    const edited = result.nodes.map(node => node.id === b.id ? { ...node, width: 25 } : node);
    const editedChildren = edited.filter(node => node.parent === compound.id);
    expect(polygonArea(compoundGeometry(editedChildren, compound.compoundOperation, edited))).toBeCloseTo(7500, 5);
    const restored = uncombineLayers(result.nodes, [compound.id]).nodes;
    expect(restored.find(node => node.id === a.id)).toMatchObject({ parent: null, x: 0, y: 0 });
    expect(restored.find(node => node.id === b.id)).toMatchObject({ parent: null, x: 50, y: 0 });
  });

  it('renders standard vector primitives and Bézier paths as SVG geometry', () => {
    const ellipse = makeNode('shape', { shapeKind: 'ellipse', width: 80, height: 40 });
    const star = makeNode('shape', { shapeKind: 'star', sides: 5, width: 80, height: 80 });
    const path = makeNode('shape', { shapeKind: 'path', width: 100, height: 100, points: [
      { x: 10, y: 50, inX: 0, inY: 0, outX: 20, outY: -30 },
      { x: 90, y: 50, inX: -20, inY: -30, outX: 0, outY: 0 },
      { x: 50, y: 90, inX: 0, inY: 0, outX: 0, outY: 0 },
    ] });
    expect(pathForShape(ellipse)).toContain('A');
    expect(pathForShape(star).match(/ L /g)).toHaveLength(9);
    expect(pathForShape(path)).toContain('C');
  });
});
