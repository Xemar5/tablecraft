import { describe, expect, it } from 'vitest';
import { makeNode, type DesignNode } from '../src/domain';
import { resizeNode, rotateNode } from '../src/designTransform';
import { toParent } from '../src/layerGeometry';

/** A corner or edge middle (hx, hy in -1..1) in the layer's parent. */
const corner = (node: DesignNode, hx: number, hy: number) => toParent(node, (hx + 1) / 2 * node.width, (hy + 1) / 2 * node.height);

describe('designer transform handles', () => {
  it('resizes from an edge or corner while the opposite side stays fixed', () => {
    const node = makeNode('frame', { x: 10, y: 20, width: 100, height: 50 });
    expect(resizeNode(node, 1, 1, 30, 10, 0, false)).toMatchObject({ x: 10, y: 20, width: 130, height: 60 });
    expect(resizeNode(node, -1, 0, 25, 99, 0, false)).toMatchObject({ x: 35, y: 20, width: 75, height: 50 });
    expect(resizeNode(node, 0, -1, 0, -500, 0, false)).toMatchObject({ y: -480, height: 550 });
    expect(resizeNode(node, 1, 0, -500, 0, 0, false)).toMatchObject({ x: 10, width: 1 });
  });

  it('keeps the anchor corner fixed for rotated layers and rotated parents', () => {
    const node = makeNode('frame', { x: 40, y: 40, width: 100, height: 60, rotation: 30 });
    const anchor = corner(node, -1, -1);
    const angle = 30 * Math.PI / 180;
    const resized = { ...node, ...resizeNode(node, 1, 1, 20 * Math.cos(angle) - 10 * Math.sin(angle), 20 * Math.sin(angle) + 10 * Math.cos(angle), 0, false) };
    expect(resized.width).toBe(120); expect(resized.height).toBe(70);
    expect(corner(resized, -1, -1).x).toBeCloseTo(anchor.x, 1); expect(corner(resized, -1, -1).y).toBeCloseTo(anchor.y, 1);
    const unrotated = makeNode('frame', { x: 0, y: 0, width: 100, height: 60 });
    expect(resizeNode(unrotated, 1, 0, 0, 40, Math.PI / 2, false)).toMatchObject({ width: 140, height: 60 });
  });

  it('keeps the opposite corner fixed whatever the pivot, as X/Y follow the pivot', () => {
    for (const [pivotX, pivotY] of [[0, 0], [1, 1], [.25, .75]]) {
      const node = makeNode('frame', { x: 80, y: 60, width: 100, height: 60, rotation: -40, pivotX, pivotY });
      for (const [hx, hy] of [[1, 1], [-1, -1], [-1, 0], [0, 1]]) {
        const anchor = corner(node, -hx || -1, -hy || -1);
        const resized = { ...node, ...resizeNode(node, hx, hy, 17, -9, 0, false) };
        const after = corner(resized, -hx || -1, -hy || -1);
        expect(after.x).toBeCloseTo(anchor.x, 1); expect(after.y).toBeCloseTo(anchor.y, 1);
      }
    }
  });

  it('keeps proportions on corners and scales path points with the box', () => {
    const node = makeNode('shape', { shapeKind: 'path', width: 100, height: 50,
      points: [{ x: 10, y: 10, inX: 0, inY: 0, outX: 20, outY: 4 }, { x: 90, y: 40, inX: 0, inY: 0, outX: 0, outY: 0 }] });
    const patch = resizeNode(node, 1, 1, 100, 5, 0, true);
    expect(patch).toMatchObject({ width: 200, height: 100 });
    expect(patch.points?.[0]).toEqual({ x: 20, y: 20, inX: 0, inY: 0, outX: 40, outY: 8 });
  });

  it('rotates by the pointer sweep, snapping with Shift and normalising', () => {
    const node = makeNode('frame', { rotation: 170 });
    expect(rotateNode(node, Math.PI / 6, false)).toBe(-160);
    expect(rotateNode({ ...node, rotation: 0 }, 0.3, true)).toBe(15);
    expect(rotateNode({ ...node, rotation: 0 }, -0.2, false)).toBe(-11);
  });
});
