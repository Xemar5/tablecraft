import { describe, expect, it } from 'vitest';
import { makeNode, moveLayer, nodeSchema } from '../src/domain';

describe('designer layer hierarchy', () => {
  it('reparents layers, reorders siblings and supports returning them to the root', () => {
    const first = makeNode('frame', { name: 'First' });
    const second = makeNode('frame', { name: 'Second' });
    const child = makeNode('text', { parent: first.id });
    const other = makeNode('shape', { parent: first.id });
    const nodes = [first, second, child, other];

    const moved = moveLayer(nodes, child.id, second.id);
    expect(moved.find(node => node.id === child.id)?.parent).toBe(second.id);
    expect(moveLayer(moved, child.id, null).find(node => node.id === child.id)?.parent).toBeNull();
    expect(moveLayer(nodes, second.id, null, first.id).filter(node => node.parent === null).map(node => node.id)).toEqual([second.id, first.id]);
  });

  it('rejects invalid parents and moves that would introduce cycles', () => {
    const frame = makeNode('frame');
    const child = makeNode('frame', { parent: frame.id });
    expect(() => moveLayer([frame, child], frame.id, child.id)).toThrow('descendants');
    expect(() => moveLayer([frame, child], child.id, 'missing')).toThrow('existing frame');
  });

  it('defaults responsive sizing fields while accepting older saved nodes', () => {
    const node = makeNode('frame');
    const { widthMode: _widthMode, heightMode: _heightMode, wrap: _wrap, ...legacy } = node;
    expect(nodeSchema.parse(legacy)).toMatchObject({ widthMode: 'fixed', heightMode: 'fixed', wrap: false });
    expect(node).toMatchObject({
      widthMode: 'fixed', heightMode: 'fixed', wrap: false,
      paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
    });
    expect(makeNode('frame', { padding: 12 })).toMatchObject({
      paddingTop: 12, paddingRight: 12, paddingBottom: 12, paddingLeft: 12,
    });
    expect(() => nodeSchema.parse({ ...node, paddingTop: 201 })).toThrow();
  });
});
