import { describe, expect, it } from 'vitest';
import { makeNode } from '../src/domain';
import { combineLayers, uncombineLayers } from '../src/designerOperations';
import { compoundGeometry, pathForCompound, pathForShape, polygonArea } from '../src/vectorGeometry';

function overlappingSquares() {
  return [
    makeNode('shape', { name: 'A', x: 0, y: 0, width: 100, height: 100, fill: '#f00' }),
    makeNode('shape', { name: 'B', x: 50, y: 0, width: 100, height: 100, fill: '#00f' }),
  ];
}

describe('live vector geometry', () => {
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
