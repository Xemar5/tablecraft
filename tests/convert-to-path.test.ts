import { describe, expect, it } from 'vitest';
import { combineLayers, convertToPaths } from '../src/designerOperations';
import { applyCommand, makeNode, validateComponentEdit, type Component, type DesignNode } from '../src/domain';
import { resizeNode, snapTo, zoomPrecision } from '../src/designTransform';
import { compoundRings, cubicAt, pathBounds, segmentControls, shapeAsPath, simplifyRing } from '../src/vectorGeometry';
import { blankProject } from '../src/templates';

const shape = (values: Partial<DesignNode>) => makeNode('shape', { x: 10, y: 20, width: 100, height: 60, ...values });
const curvePoints = (node: DesignNode) => node.points.flatMap((point, index) => {
  const controls = segmentControls(point, node.points[(index + 1) % node.points.length]);
  return [0, .25, .5, .75].map(t => cubicAt(controls, t));
});

describe('converting shapes to pen paths', () => {
  it('recreates ellipses with four smooth points that stay on the ellipse', () => {
    const ellipse = shape({ shapeKind: 'ellipse' });
    const points = shapeAsPath(ellipse);
    expect(points).toHaveLength(4);
    for (const [x, y] of curvePoints({ ...ellipse, shapeKind: 'path', points })) {
      expect(((x - 50) / 50) ** 2 + ((y - 30) / 30) ** 2).toBeCloseTo(1, 2);
    }
  });

  it('recreates rounded rectangles with curved corners and merges fully rounded sides', () => {
    expect(shapeAsPath(shape({ shapeKind: 'rectangle', radius: 0 }))).toHaveLength(4);
    const rounded = shapeAsPath(shape({ shapeKind: 'rectangle', radius: 10 }));
    expect(rounded).toHaveLength(8);
    expect(rounded[1]).toMatchObject({ x: 90, y: 0, outX: 20 / 3 });
    // A 60-high box with radius 30 has no straight vertical sides: the points there coincide and are merged.
    expect(shapeAsPath(shape({ shapeKind: 'rectangle', radius: 30 }))).toHaveLength(6);
    expect(shapeAsPath(shape({ shapeKind: 'star', sides: 5 }))).toHaveLength(10);
  });

  it('keeps a converted shape in place and editable', () => {
    const star = shape({ id: 'star', shapeKind: 'star', rotation: 30, fill: '#123456' });
    const { nodes, selected } = convertToPaths([star], ['star']);
    expect(selected).toEqual(['star']);
    expect(nodes[0]).toMatchObject({ id: 'star', shapeKind: 'path', pathClosed: true, x: 10, y: 20, width: 100, height: 60, rotation: 30, fill: '#123456' });
    expect(() => convertToPaths(nodes, ['star'])).toThrow('Select shapes or boolean groups');
  });

  it('flattens boolean groups into one path, or a group of outlines when there are holes', () => {
    const outer = shape({ id: 'outer', x: 0, y: 0, width: 100, height: 100 });
    const inner = shape({ id: 'inner', x: 25, y: 25, width: 50, height: 50 });
    const subtracted = combineLayers([outer, inner], ['outer', 'inner'], 'subtract');
    const compound = subtracted.nodes.find(node => node.type === 'compound')!;
    expect(compoundRings(subtracted.nodes, compound)).toHaveLength(2);
    const holed = convertToPaths(subtracted.nodes, [compound.id]).nodes;
    expect(holed.find(node => node.id === compound.id)).toMatchObject({ type: 'compound', compoundOperation: 'exclude' });
    expect(holed.filter(node => node.parent === compound.id).map(node => node.shapeKind)).toEqual(['path', 'path']);
    expect(holed.some(node => node.id === 'outer' || node.id === 'inner')).toBe(false);

    const side = shape({ id: 'side', x: 50, y: 0, width: 100, height: 100 });
    const united = combineLayers([outer, side], ['outer', 'side'], 'union');
    const group = united.nodes.find(node => node.type === 'compound')!;
    const flat = convertToPaths(united.nodes, [group.id]).nodes;
    expect(flat).toHaveLength(1);
    expect(flat[0]).toMatchObject({ id: group.id, type: 'shape', shapeKind: 'path', x: 0, y: 0, width: 150, height: 100 });
    expect(flat[0].points).toHaveLength(4);
  });

  it('simplifies dense outlines to fit the path point limit', () => {
    const circle = Array.from({ length: 400 }, (_, index) => [Math.cos(index / 400 * Math.PI * 2) * 100, Math.sin(index / 400 * Math.PI * 2) * 100] as [number, number]);
    expect(simplifyRing(circle, 1).length).toBeLessThan(60);
    const ellipses = combineLayers([shape({ id: 'a', shapeKind: 'ellipse' }), shape({ id: 'b', shapeKind: 'ellipse', x: 60 })], ['a', 'b'], 'union');
    const group = ellipses.nodes.find(node => node.type === 'compound')!;
    const flat = convertToPaths(ellipses.nodes, [group.id]).nodes[0];
    expect(flat.points.length).toBeLessThanOrEqual(128);
    expect(pathBounds(flat).maxX).toBeCloseTo(flat.width, 0);
  });
});

describe('design precision and new layer settings', () => {
  it('moves and resizes in about one screen pixel at any zoom', () => {
    expect(zoomPrecision(.5)).toBe(1);
    expect(zoomPrecision(1)).toBe(1);
    expect(zoomPrecision(3)).toBe(.25);
    expect(zoomPrecision(10)).toBe(.1);
    expect(snapTo(10.2999999, .1)).toBe(10.3);
    const node = shape({ x: 0, y: 0 });
    expect(resizeNode(node, 1, 0, 0.3, 0, 0, false, .1)).toMatchObject({ width: 100.3 });
    expect(resizeNode(node, 1, 0, 0.3, 0, 0, false)).toMatchObject({ width: 100 });
  });

  it('accepts typography settings, justified text and linked artwork without a chosen component', () => {
    const card: Component = { id: 'card', name: 'Card', kind: 'card', width: 100, height: 140, color: '#fff', back: [], csv: '', rows: [],
      flippable: false, hand: true, hideInHand: false, stackable: true, shufflable: true, stackTag: '',
      front: [makeNode('text', { align: 'justify', fontWeight: 700, italic: true, textDecoration: 'underline', textTransform: 'uppercase',
        letterSpacing: 1.5, lineHeight: 1.4, verticalAlign: 'end', textStroke: '#000', textStrokeWidth: 2, textShadow: '#0008', textShadowY: 2 }),
      makeNode('component', { name: 'Linked artwork' })] };
    expect(() => validateComponentEdit([], card)).not.toThrow();
    expect(applyCommand({ ...blankProject(), components: [card] }, { type: 'component', component: card }).components[0].front[0]).toMatchObject({ fontWeight: 700, align: 'justify' });
    expect(() => validateComponentEdit([], { ...card, front: [makeNode('component', { componentId: 'missing' })] })).toThrow('missing component');
  });
});
