import { describe, expect, it } from 'vitest';
import { makeNode, type DesignNode } from '../src/domain';
import { resizeNode, rotateNode } from '../src/designTransform';

const corner = (node: DesignNode, hx: number, hy: number) => {
  const angle = node.rotation * Math.PI / 180, x = hx * node.width / 2, y = hy * node.height / 2;
  return { x: node.x + node.width / 2 + x * Math.cos(angle) - y * Math.sin(angle), y: node.y + node.height / 2 + x * Math.sin(angle) + y * Math.cos(angle) };
};

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
