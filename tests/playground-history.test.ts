import { describe, expect, it } from 'vitest';
import { makeInstance, type Command, type Project } from '../src/domain';
import { applyPlaygroundCommand, emptyPlaygroundHistory, PLAYGROUND_HISTORY_LIMIT, undoPlayground } from '../src/playgroundHistory';
import { template } from '../src/templates';
import { starterTable } from './fixtures';

function table(): Project {
  const project = starterTable();
  const card = template('card');
  card.id = 'card';
  project.components = [card];
  project.instances = ['a', 'b', 'c'].map((id, order) => ({ ...makeInstance(card.id), id, order }));
  project.players = [
    { id: 'alice', owner: 'identity-a', name: 'Alice', color: '#ffffff', x: 100, y: 100, rotation: 0 },
    { id: 'bob', owner: 'identity-b', name: 'Bob', color: '#000000', x: 200, y: 100, rotation: 0 },
  ];
  return project;
}

describe('shared Playground history', () => {
  it('preserves per-hand permissions across tabletop undo without recording permission changes', () => {
    const before = table();
    const moved = applyPlaygroundCommand(before, emptyPlaygroundHistory(), { type: 'move', ids: ['a'], patch: { x: 999 } }, 'alice');
    const configured = applyPlaygroundCommand(moved.project, moved.history, { type: 'handSettings', playerId: 'bob', patch: { allowHandInsert: false, allowHandTake: true } }, 'bob');
    expect(configured.history).toEqual(moved.history);
    const undone = undoPlayground(configured.project, configured.history);
    expect(undone.project.instances).toEqual(before.instances);
    expect(undone.project.players.find(player => player.id === 'bob')).toMatchObject({ allowHandInsert: false, allowHandTake: true });
    expect(undone.project.players.find(player => player.id === 'alice')?.allowHandTake).toBeUndefined();
  });
  it('keeps library ordering outside tabletop undo without clearing existing history', () => {
    const before = table();
    before.components.push({ ...before.components[0], id: 'other' });
    const moved = applyPlaygroundCommand(before, emptyPlaygroundHistory(), { type: 'move', ids: ['a'], patch: { x: 999 } }, 'alice');
    const reordered = applyPlaygroundCommand(moved.project, moved.history, { type: 'reorderComponent', id: 'other', targetId: 'card', position: 'before' }, 'bob');
    expect(reordered.history).toEqual(moved.history);
    const undone = undoPlayground(reordered.project, reordered.history);
    expect(undone.project.components.map(c => c.id)).toEqual(['other', 'card']);
    expect(undone.project.instances).toEqual(before.instances);
    expect(undone.history.entries).toHaveLength(0);
  });

  const commands: Command[] = [
    { type: 'spawn', instances: [{ ...makeInstance('card'), id: 'new' }] },
    { type: 'paste', instances: [{ ...makeInstance('card'), id: 'pasted' }] },
    { type: 'duplicate', copies: [{ sourceId: 'a', id: 'copy', stack: null }], dx: 20, dy: 20 },
    { type: 'front', ids: ['a'] },
    { type: 'move', ids: ['a', 'b'], patch: { x: 400, rotation: 90, flipped: true, locked: true } },
    { type: 'transform', ids: ['a', 'b'], dx: 100, rotation: 90, scaleFactor: 1.5 },
    { type: 'delete', ids: ['a', 'b'] },
    { type: 'stack', ids: ['a', 'b'], stackId: 'deck' },
    { type: 'dropStack', ids: ['a'], targetId: 'b', stackId: 'deck' },
    { type: 'drawSelection', ids: ['a', 'b'], playerId: 'alice', faceUp: true },
    { type: 'settings', patch: { hands: false, grid: false, turn: 1 } },
  ];
  it.each(commands.map(command => [command.type, command] as const))('restores all state changed by %s atomically', (_type, command) => {
    const before = table();
    const result = applyPlaygroundCommand(before, emptyPlaygroundHistory(), command, 'alice');
    expect(result.history.entries).toHaveLength(1);
    const undone = undoPlayground(result.project, result.history);
    expect(undone.undone).toBe(true);
    expect(undone.project).toEqual(before);
    expect(undone.history.entries).toHaveLength(0);
    expect(before.instances).toHaveLength(3);
  });

  it('undoes multiple actors in global reverse order, including private hand actions', () => {
    const before = table();
    const alice = applyPlaygroundCommand(before, emptyPlaygroundHistory(), { type: 'drawSelection', ids: ['a'], playerId: 'alice' }, 'alice');
    const bob = applyPlaygroundCommand(alice.project, alice.history, { type: 'move', ids: ['b'], patch: { x: 999 } }, 'bob');
    const undoBob = undoPlayground(bob.project, bob.history);
    expect(undoBob.project).toEqual(alice.project);
    expect(undoPlayground(undoBob.project, undoBob.history).project).toEqual(before);
  });

  const stackedCommands: Command[] = [
    { type: 'unstack', id: 'a' },
    { type: 'extractMove', id: 'a', x: 120, y: 120 },
    { type: 'reorder', ids: ['c', 'a', 'b'] },
    { type: 'shuffle', id: 'a', seed: 0 },
    { type: 'draw', id: 'a', playerId: 'alice' },
    { type: 'drawMany', id: 'a', playerId: 'alice', count: 2 },
  ];
  it.each(stackedCommands.map(command => [command.type, command] as const))('restores a stack after %s', (_type, command) => {
    const before = table();
    before.instances.forEach(piece => { piece.stack = 'deck'; });
    const result = applyPlaygroundCommand(before, emptyPlaygroundHistory(), command, 'alice');
    expect(undoPlayground(result.project, result.history).project).toEqual(before);
  });

  const handCommands: Command[] = [
    { type: 'release', id: 'a', x: 100, y: 100 },
    { type: 'releaseMany', ids: ['a', 'b'], x: 100, y: 100 },
    { type: 'dropFromHand', id: 'a', targetId: 'c', stackId: 'deck' },
    { type: 'dropManyFromHand', ids: ['a', 'b'], targetId: 'c', stackId: 'deck' },
    { type: 'reorderHand', ids: ['b', 'a'], playerId: 'alice' },
    { type: 'transferToHand', ids: ['a', 'b'], playerId: 'bob' },
    { type: 'playVisibleHand', id: 'a', x: 100, y: 100 },
  ];
  it.each(handCommands.map(command => [command.type, command] as const))('restores a hand after %s', (_type, command) => {
    const before = table();
    before.settings.allowOtherHands = true;
    before.instances.slice(0, 2).forEach(piece => { piece.holder = 'alice'; });
    const result = applyPlaygroundCommand(before, emptyPlaygroundHistory(), command, 'alice');
    expect(undoPlayground(result.project, result.history).project).toEqual(before);
  });

  it('restores rolled dice rows without restoring or changing their live design', () => {
    const before = table();
    before.components[0].kind = 'dice';
    before.components[0].rows = [{ face: 'one' }, { face: 'two' }, { face: 'three' }];
    const result = applyPlaygroundCommand(before, emptyPlaygroundHistory(), { type: 'roll', ids: ['a', 'b', 'c'], seed: 14 }, 'bob');
    const undone = undoPlayground(result.project, result.history);
    expect(undone.project).toEqual(before);
  });

  it('restores reversed stacks, shuffled order and drawn cards exactly', () => {
    let result = applyPlaygroundCommand(table(), emptyPlaygroundHistory(), { type: 'stack', ids: ['a', 'b', 'c'], stackId: 'deck' }, 'alice');
    result = applyPlaygroundCommand(result.project, result.history, { type: 'transform', ids: ['a', 'b', 'c'], flip: true }, 'alice');
    const flipped = result.project;
    result = applyPlaygroundCommand(result.project, result.history, { type: 'shuffle', id: 'a', seed: 0 }, 'alice');
    const shuffled = result.project;
    result = applyPlaygroundCommand(result.project, result.history, { type: 'drawMany', id: 'a', playerId: 'bob', count: 2 }, 'bob');
    const drawnBack = undoPlayground(result.project, result.history);
    expect(drawnBack.project).toEqual(shuffled);
    expect(undoPlayground(drawnBack.project, drawnBack.history).project).toEqual(flipped);
  });

  it('preserves joined seats, live identity ownership, and project metadata', () => {
    const before = table();
    const seat = { ...before.players[0], x: 345, name: 'New name' };
    const result = applyPlaygroundCommand(before, emptyPlaygroundHistory(), { type: 'player', player: seat }, 'alice');
    const current = {
      ...result.project, name: 'New project name',
      players: [...result.project.players.map(player => ({ ...player, owner: `live-${player.id}` })), { ...before.players[1], id: 'joined', owner: 'new-identity' }],
    };
    const undone = undoPlayground(current, result.history);
    expect(undone.project.name).toBe('New project name');
    expect(undone.project.players[0]).toEqual({ ...before.players[0], owner: 'live-alice' });
    expect(undone.project.players[2]).toEqual(current.players[2]);
  });

  it('never restores designs or obsolete data rows after a component edit', () => {
    const before = table();
    let result = applyPlaygroundCommand(before, emptyPlaygroundHistory(), { type: 'delete', ids: ['a'] }, 'alice');
    result = applyPlaygroundCommand(result.project, result.history, { type: 'component', component: { ...before.components[0], name: 'Edited design', stackable: false } }, 'bob');
    expect(result.history.entries).toHaveLength(0);
    expect(result.history.notice).toMatch(/component designs changed/);
    expect(undoPlayground(result.project, result.history).project).toEqual(result.project);
    expect(result.project.instances.some(piece => piece.id === 'a')).toBe(false);
  });

  it('makes explicit seat creation a barrier, but ordinary joins can interleave without losing history', () => {
    const moved = applyPlaygroundCommand(table(), emptyPlaygroundHistory(), { type: 'move', ids: ['a'], patch: { x: 123 } }, 'alice');
    const seat = { ...moved.project.players[0], id: 'hotseat' };
    const added = applyPlaygroundCommand(moved.project, moved.history, { type: 'player', player: seat }, 'alice');
    expect(added.history.entries).toHaveLength(0);
    expect(added.history.notice).toMatch(/seat was added/);
    const joined = { ...moved.project, players: [...moved.project.players, seat] };
    expect(undoPlayground(joined, moved.history).project.players).toEqual(joined.players);
  });

  it('clears history when a seat is removed so undo cannot reference it', () => {
    const moved = applyPlaygroundCommand(table(), emptyPlaygroundHistory(), { type: 'move', ids: ['a'], patch: { x: 123 } }, 'alice');
    const seat = { ...moved.project.players[0], id: 'hotseat' };
    const project = { ...moved.project, players: [...moved.project.players, seat] };
    const removed = applyPlaygroundCommand(project, moved.history, { type: 'removePlayer', playerId: 'hotseat' }, 'alice');
    expect(removed.project.players.map(player => player.id)).not.toContain('hotseat');
    expect(removed.history.entries).toHaveLength(0);
    expect(removed.history.notice).toMatch(/seat was removed/);
  });

  it('invalidates an incompatible inverse explicitly without changing the table', () => {
    const result = applyPlaygroundCommand(table(), emptyPlaygroundHistory(), { type: 'delete', ids: ['a'] }, 'alice');
    const changed = { ...result.project, components: [], instances: [] };
    const undone = undoPlayground(changed, result.history);
    expect(undone.undone).toBe(false);
    expect(undone.project).toBe(changed);
    expect(undone.history.entries).toHaveLength(0);
    expect(undone.history.notice).toMatch(/no longer compatible/);
  });

  it('does not record failed commands, rename, or no-op actions and caps history', () => {
    let result = { project: table(), history: emptyPlaygroundHistory() };
    expect(() => applyPlaygroundCommand(result.project, result.history, { type: 'release', id: 'missing', x: 0, y: 0 }, 'bob')).toThrow();
    result = applyPlaygroundCommand(result.project, result.history, { type: 'rename', name: 'Renamed' }, 'alice');
    result = applyPlaygroundCommand(result.project, result.history, { type: 'move', ids: [], patch: {} }, 'alice');
    expect(result.history.entries).toHaveLength(0);
    for (let x = 0; x < PLAYGROUND_HISTORY_LIMIT + 10; x++) {
      result = applyPlaygroundCommand(result.project, result.history, { type: 'move', ids: ['a'], patch: { x } }, x % 2 ? 'alice' : 'bob');
    }
    expect(result.history.entries).toHaveLength(PLAYGROUND_HISTORY_LIMIT);
    for (let n = 0; n < PLAYGROUND_HISTORY_LIMIT; n++) result = undoPlayground(result.project, result.history);
    expect(result.project.instances[0].x).toBe(9);
    expect(undoPlayground(result.project, result.history).undone).toBe(false);
  });
});

describe('undo with shared designs', () => {
  it('restores tabletop state without replacing component objects', () => {
    const project = table();
    const moved = applyPlaygroundCommand(project, emptyPlaygroundHistory(), { type: 'move', ids: ['a'], patch: { x: 999 } });
    expect(moved.project.components).toBe(project.components);
    const undone = undoPlayground(moved.project, moved.history);
    expect(undone.undone).toBe(true);
    expect(undone.project.components).toBe(project.components);
    expect(undone.project.instances.find(i => i.id === 'a')!.x).toBe(project.instances.find(i => i.id === 'a')!.x);
  });
});