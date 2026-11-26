import { describe, expect, it } from 'vitest';
import { makeNode } from '../src/domain';
import { combineLayers, copySubtrees, groupLayers, pasteSubtrees, reorderLayers, uncombineLayers, ungroupLayers } from '../src/designerOperations';

describe('designer subtree operations', () => {
  it('moves layers forward, backward, to the front or back among their own siblings only', () => {
    const a = makeNode('text', { name: 'a' }), frame = makeNode('frame', { name: 'frame' });
    const inner1 = makeNode('text', { name: 'inner1', parent: frame.id }), b = makeNode('text', { name: 'b' });
    const inner2 = makeNode('text', { name: 'inner2', parent: frame.id }), c = makeNode('text', { name: 'c' });
    const nodes = [a, frame, inner1, b, inner2, c];
    const names = (list: typeof nodes, parent: string | null = null) => list.filter(node => node.parent === parent).map(node => node.name);
    expect(names(reorderLayers(nodes, [a.id], 'forward'))).toEqual(['frame', 'a', 'b', 'c']);
    expect(names(reorderLayers(nodes, [a.id], 'front'))).toEqual(['frame', 'b', 'c', 'a']);
    expect(names(reorderLayers(nodes, [c.id], 'back'))).toEqual(['c', 'a', 'frame', 'b']);
    expect(names(reorderLayers(nodes, [b.id], 'backward'))).toEqual(['a', 'b', 'frame', 'c']);
    // Children reorder inside their parent; other layers keep their array slots.
    const inner = reorderLayers(nodes, [inner2.id, b.id], 'back');
    expect(names(inner, frame.id)).toEqual(['inner2', 'inner1']);
    expect(names(inner)).toEqual(['b', 'a', 'frame', 'c']);
    expect(inner.map(node => node.parent)).toEqual(nodes.map(node => node.parent));
    // A selected child of a selected layer moves with its parent, not on its own.
    expect(names(reorderLayers(nodes, [frame.id, inner1.id], 'back'), frame.id)).toEqual(['inner1', 'inner2']);
    expect(reorderLayers(nodes, [c.id], 'forward')).toEqual(nodes);
  });
  it('copies selected subtrees once, remapping every ID and internal parent', () => {
    const frame = makeNode('frame');
    const child = makeNode('frame', { parent: frame.id });
    const leaf = makeNode('text', { parent: child.id });
    const copied = copySubtrees([frame, child, leaf], [frame.id, leaf.id]);
    const pasted = pasteSubtrees([frame, child, leaf], copied);
    const [frameCopy, childCopy, leafCopy] = pasted.nodes.slice(3);
    expect(new Set(pasted.nodes.map(node => node.id)).size).toBe(6);
    expect(pasted.selected).toEqual([frameCopy.id]);
    expect(childCopy.parent).toBe(frameCopy.id);
    expect(leafCopy.parent).toBe(childCopy.id);
    expect(frameCopy.x).toBe(frame.x + 16);
    expect(leafCopy.x).toBe(leaf.x);
    expect(() => pasteSubtrees([], copied.slice(1))).toThrow('parent');
    expect(() => pasteSubtrees(Array.from({ length: 298 }, () => makeNode('text')), copied)).toThrow('300');
  });

  it('groups and ungroups rotated siblings without changing their positions or angles', () => {
    const a = makeNode('shape', { x: 30, y: 40, width: 100, height: 40, rotation: 45 });
    const b = makeNode('shape', { x: 170, y: 80, rotation: -20 });
    const grouped = groupLayers([a, b], [a.id, b.id]);
    const frame = grouped.nodes.find(node => node.id === grouped.selected[0])!;
    const restored = ungroupLayers(grouped.nodes, [frame.id]);
    for (const original of [a, b]) {
      const actual = restored.nodes.find(node => node.id === original.id)!;
      expect(actual.parent).toBeNull();
      expect(actual.x).toBeCloseTo(original.x);
      expect(actual.y).toBeCloseTo(original.y);
      expect(actual.rotation).toBeCloseTo(original.rotation);
    }
  });

  it('rotates children about their pivots when ungrouping a rotated frame', () => {
    // Made turned without pivots, both turn about their centres, so their X/Y are their centres.
    const frame = makeNode('frame', { x: 10, y: 20, width: 200, height: 200, rotation: 90, fill: 'transparent' });
    const child = makeNode('shape', { parent: frame.id, x: 20, y: 30, width: 40, height: 20, rotation: 15 });
    const result = ungroupLayers([frame, child], [frame.id]);
    expect(result.nodes[0]).toMatchObject({ parent: null, rotation: 105, pivotX: .5, pivotY: .5 });
    expect(result.nodes[0].x).toBeCloseTo(170);
    expect(result.nodes[0].y).toBeCloseTo(60);
    // A frame turning about its top-left corner takes a top-left-pivoted child with it.
    const corner = makeNode('frame', { x: 100, y: 100, width: 200, height: 200, rotation: 90, pivotX: 0, pivotY: 0, fill: 'transparent' });
    const inside = makeNode('shape', { parent: corner.id, x: 20, y: 30, width: 40, height: 20 });
    const out = ungroupLayers([corner, inside], [corner.id]).nodes[0];
    expect(out).toMatchObject({ rotation: 90, pivotX: 0, pivotY: 0 });
    expect(out.x).toBeCloseTo(70); expect(out.y).toBeCloseTo(120);
  });

  it('rejects unsafe flow and sibling reorder cases and ungroups overflowing children in place', () => {
    const frame = makeNode('frame', { layout: 'row', fill: 'transparent' });
    const child = makeNode('shape', { parent: frame.id });
    expect(() => groupLayers([frame, child], [child.id])).toThrow('flow');
    expect(() => ungroupLayers([frame, child], [frame.id])).toThrow('absolute');
    const [a, b, c] = [makeNode('shape'), makeNode('shape'), makeNode('shape')];
    expect(() => groupLayers([a, b, c], [a.id, c.id])).toThrow('consecutive');
    const small = makeNode('frame', { x: 5, y: 7, width: 30, height: 30, radius: 8, fill: 'transparent' });
    const overflowing = { ...child, parent: small.id, x: 20, y: -10, width: 100, height: 60 };
    expect(ungroupLayers([small, overflowing], [small.id]).nodes[0]).toMatchObject({ parent: null, x: 25, y: -3 });
  });

  it('creates live compounds and round-trips editable source subtrees', () => {
    const a = makeNode('shape', { x: 10, y: 20, width: 80, height: 60 });
    const b = makeNode('shape', { x: 50, y: 30, width: 80, height: 60 });
    const result = combineLayers([a, b], [a.id, b.id], 'exclude');
    const compound = result.nodes.find(node => node.type === 'compound')!;
    expect(compound.compoundOperation).toBe('exclude');
    expect(result.nodes.filter(node => node.parent === compound.id)).toHaveLength(2);
    const copied = copySubtrees(result.nodes, [compound.id]);
    const pasted = pasteSubtrees(result.nodes, copied);
    expect(pasted.nodes.filter(node => node.type === 'compound')).toHaveLength(2);
    expect(pasted.nodes.filter(node => node.parent === pasted.selected[0])).toHaveLength(2);
    const uncombined = uncombineLayers(result.nodes, [compound.id]);
    expect(uncombined.nodes.filter(node => node.type === 'compound')).toHaveLength(0);
    expect(uncombined.nodes.find(node => node.id === a.id)).toMatchObject({ parent: null, x: 10, y: 20 });
    expect(uncombined.nodes.find(node => node.id === b.id)).toMatchObject({ parent: null, x: 50, y: 30 });
  });
});
