import { describe, expect, it } from 'vitest';
import { applyCommand, makeInstance, withGroupLocks, type Command, type Component, type Project } from '../src/domain';
import { blankProject, template } from '../src/templates';

const token = (id: string): Component => ({ ...template('token'), id, name: id, stackTag: '', stackTags: [id] });
/** Four loose tokens, bottom (piece-a) to top (piece-d), the middle two in group "pair". */
function table(): Project {
  let p: Project = { ...blankProject(), components: ['a', 'b', 'c', 'd'].map(token),
    instances: ['a', 'b', 'c', 'd'].map((key, n) => ({ ...makeInstance(key, 0, n * 200, 0), id: `piece-${key}` })) };
  p = applyCommand(p, { type: 'createGroup', id: 'pair', name: 'Pair', parent: null, ids: ['piece-b', 'piece-c'], groups: [] });
  return p;
}
const order = (p: Project) => p.instances.map(item => item.id.slice(6)).join('');
const run = (p: Project, ...commands: Command[]) => commands.reduce((state, command) => applyCommand(state, command, 'player-1'), p);

describe('order locks', () => {
  it('keep a piece in its place in the order and its group, while it still moves on the table', () => {
    let p = run(table(), { type: 'move', ids: ['piece-a'], patch: { orderLocked: true } });
    expect(order(p)).toBe('abcd');
    expect(() => run(p, { type: 'zOrder', ids: ['piece-a'], move: 'front' })).toThrow('order is locked');
    expect(() => run(p, { type: 'arrangePieces', parent: null, ids: ['piece-a'], groups: [], target: ['piece-d'], position: 'above' })).toThrow('order is locked');
    expect(() => run(p, { type: 'moveToGroup', parent: 'pair', ids: ['piece-a'], groups: [] })).toThrow('order is locked');
    expect(() => run(p, { type: 'createGroup', id: 'solo', name: 'Solo', parent: null, ids: ['piece-a'], groups: [] })).toThrow('order is locked');
    // Picking it up doesn't raise it, but it moves; other pieces still reorder around it.
    expect(order(run(p, { type: 'front', ids: ['piece-a', 'piece-d'] }))).toBe('abcd');
    expect(run(p, { type: 'transform', ids: ['piece-a'], dx: 30, dy: 0 }).instances[0].x).toBe(30);
    expect(order(run(p, { type: 'zOrder', ids: ['piece-d'], move: 'back' }))).toBe('dabc');
    // Unlocked, it reorders again.
    p = run(p, { type: 'move', ids: ['piece-a'], patch: { orderLocked: false } });
    expect(order(run(p, { type: 'zOrder', ids: ['piece-a'], move: 'front' }))).toBe('bcda');
  });

  it('change even on pieces held in place, separately from that lock', () => {
    let p = run(table(), { type: 'move', ids: ['piece-a'], patch: { locked: true } });
    p = run(p, { type: 'move', ids: ['piece-a'], patch: { orderLocked: true } });
    expect(p.instances[0]).toMatchObject({ locked: true, orderLocked: true });
    expect(() => run(p, { type: 'move', ids: ['piece-a'], patch: { x: 5 } })).toThrow('Unlock this component first');
  });

  it('keep an order-locked group, its subgroups and its pieces in place in the hierarchy', () => {
    let p = run(table(), { type: 'lockGroups', ids: ['pair'], locked: true, order: true });
    expect(p.groups![0]).toMatchObject({ orderLocked: true });
    expect(p.groups![0].locked).toBeUndefined();
    expect(withGroupLocks(p).instances.filter(item => item.orderLocked).map(item => item.id)).toEqual(['piece-b', 'piece-c']);
    expect(() => run(p, { type: 'zOrder', ids: ['piece-b'], move: 'forward' })).toThrow('order is locked');
    expect(() => run(p, { type: 'moveToGroup', parent: null, ids: ['piece-c'], groups: [] })).toThrow('order is locked');
    expect(() => run(p, { type: 'moveToGroup', parent: null, ids: [], groups: ['pair'] })).toThrow('order is locked');
    expect(() => run(p, { type: 'ungroup', ids: ['pair'] })).toThrow('order is locked');
    // A subgroup made before the lock is held by it too.
    const nested = run(table(), { type: 'createGroup', id: 'inner', name: 'Inner', parent: 'pair', ids: ['piece-c'], groups: [] }, { type: 'lockGroups', ids: ['pair'], locked: true, order: true });
    expect(() => run(nested, { type: 'ungroup', ids: ['inner'] })).toThrow('order is locked');
    // Pieces outside still move into place around it, and the group still moves on the table.
    expect(order(run(p, { type: 'zOrder', ids: ['piece-a'], move: 'front' }))).toBe('bcda');
    p = run(p, { type: 'lockGroups', ids: ['pair'], locked: false, order: true });
    expect(p.groups![0].orderLocked).toBeUndefined();
    expect(order(run(p, { type: 'zOrder', ids: ['piece-b'], move: 'front' }))).toBe('adcb');
  });
});
