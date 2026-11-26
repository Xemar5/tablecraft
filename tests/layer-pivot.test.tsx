import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComponentView } from '../src/ComponentView';
import { makeNode, nodeSchema } from '../src/domain';
import { combineLayers, groupLayers } from '../src/designerOperations';
import { fromParent, parentBounds, pivotOf, repivoted, toParent, withPivot } from '../src/layerGeometry';
import { starterTable } from './fixtures';

const styleOf = (markup: string, text: string) => {
  const match = markup.match(new RegExp(`<div style="([^"]*)" class="design-node node-text"[^>]*>(?:(?!</div>).)*${text}`));
  if (!match) throw new Error(`No layer with ${text}`);
  return match[1];
};
const corners = (node: Parameters<typeof toParent>[0]) => [[0, 0], [node.width, 0], [0, node.height], [node.width, node.height]].map(([x, y]) => toParent(node, x, y));

describe('layer pivots', () => {
  it('places the pivot at X/Y and turns the layer about it', () => {
    const node = makeNode('shape', { x: 100, y: 50, width: 40, height: 20, rotation: 90, pivotX: 1, pivotY: .5 });
    // The pivot (right middle) sits at X/Y; the left middle swings round it, 40 below.
    expect(toParent(node, 40, 10)).toEqual({ x: 100, y: 50 });
    const left = toParent(node, 0, 10);
    expect(left.x).toBeCloseTo(100); expect(left.y).toBeCloseTo(10);
    const back = fromParent(node, left.x, left.y);
    expect(back.x).toBeCloseTo(0); expect(back.y).toBeCloseTo(10);
  });

  it('moves the pivot without moving the layer', () => {
    for (const rotation of [0, 35, -120]) {
      const node = makeNode('shape', { x: 60, y: 40, width: 80, height: 30, rotation, pivotX: 0, pivotY: 0 });
      for (const [pivotX, pivotY] of [[.5, .5], [1, 0], [.2, .9]]) {
        const moved = { ...node, ...repivoted(node, pivotX, pivotY) };
        expect(pivotOf(moved)).toEqual({ x: pivotX, y: pivotY });
        corners(moved).forEach((corner, index) => {
          expect(corner.x).toBeCloseTo(corners(node)[index].x, 1); expect(corner.y).toBeCloseTo(corners(node)[index].y, 1);
        });
      }
    }
    // Axes a layout places keep their X/Y: only the point the layer turns about changes there.
    expect(repivoted(makeNode('text', { x: 5, y: 7, width: 100 }), 1, 1, 100, 40, { x: false, y: true })).toEqual({ x: 5, y: 47, pivotX: 1, pivotY: 1 });
  });

  it('keeps layers saved before pivots where they were: top-left placed, turning about their centre', () => {
    const { pivotX: _x, pivotY: _y, ...saved } = makeNode('shape', { x: 10, y: 20, width: 100, height: 60 });
    expect(nodeSchema.parse(saved)).toMatchObject({ x: 10, y: 20, pivotX: 0, pivotY: 0 });
    const turned = nodeSchema.parse({ ...saved, rotation: 30 });
    expect(turned).toMatchObject({ x: 60, y: 50, pivotX: .5, pivotY: .5 });
    // The same box, turned about the same centre as before.
    const center = toParent(turned, 50, 30);
    expect(center.x).toBeCloseTo(60); expect(center.y).toBeCloseTo(50);
    // A full turn is no turn; a saved pivot is kept; one saved axis keeps the other at its edge.
    expect(withPivot({ ...saved, rotation: 360 })).toMatchObject({ x: 10, pivotX: 0 });
    expect(nodeSchema.parse({ ...saved, rotation: 30, pivotX: 1, pivotY: 0 })).toMatchObject({ x: 10, y: 20, pivotX: 1, pivotY: 0 });
    expect(withPivot({ ...saved, rotation: 30, pivotX: .5 })).toMatchObject({ x: 10, pivotX: .5, pivotY: 0 });
    expect(() => nodeSchema.parse({ ...saved, pivotX: 1.5 })).toThrow();
    // Made in code with a turn but no pivot, the same.
    expect(makeNode('shape', { x: 10, y: 20, width: 100, height: 60, rotation: 30 })).toMatchObject({ x: 60, y: 50, pivotX: .5, pivotY: .5 });
  });

  it('renders the pivot at X/Y, shifting the box by its share of the size and turning about it', () => {
    const pinned = makeNode('text', { text: 'Pinned', x: 200, y: 100, width: 80, height: 20, pivotX: 1, pivotY: 1 });
    const turned = makeNode('text', { text: 'Turned', x: 200, y: 100, width: 80, height: 20, pivotX: .5, pivotY: .5, rotation: 45 });
    const plain = makeNode('text', { text: 'Plain', x: 200, y: 100 });
    // A Fill axis has no X/Y: its margins place the box, so only the other axis shifts.
    const filled = makeNode('text', { text: 'Filled', x: 200, y: 100, pivotX: 1, pivotY: 1, widthMode: 'fill' });
    const markup = renderToStaticMarkup(<ComponentView component={{ ...starterTable().components[0], front: [pinned, turned, plain, filled] }} />);
    expect(styleOf(markup, 'Pinned')).toMatch(/left:200px;top:100px;.*transform:translate\(-100%, -100%\)/);
    expect(styleOf(markup, 'Turned')).toContain('transform:translate(-50%, -50%) rotate(45deg);transform-origin:50% 50%');
    expect(styleOf(markup, 'Plain')).not.toContain('transform');
    expect(styleOf(markup, 'Filled')).toContain('transform:translate(0%, -100%)');
  });

  it('groups and combines turned layers by the box they cover', () => {
    const a = makeNode('shape', { x: 50, y: 50, width: 40, height: 20, rotation: 90, pivotX: 0, pivotY: 0 });
    expect(parentBounds(a)).toMatchObject({ left: 30, top: 50, right: 50, bottom: 90 });
    const b = makeNode('shape', { x: 100, y: 100, width: 10, height: 10, pivotX: 1, pivotY: 1 });
    const grouped = groupLayers([a, b], [a.id, b.id]);
    expect(grouped.nodes[0]).toMatchObject({ x: 30, y: 50, width: 70, height: 50 });
    expect(grouped.nodes[1]).toMatchObject({ x: 20, y: 0 });
    expect(grouped.nodes[2]).toMatchObject({ x: 70, y: 50 });
    const compound = combineLayers([a, b], [a.id, b.id], 'union');
    expect(compound.nodes[0]).toMatchObject({ x: 30, y: 50, width: 70, height: 50 });
  });
});
