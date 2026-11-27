import { describe, expect, it } from 'vitest';
import { appliesTo, scopeOf, toggleSeat } from '../src/access';
import { applyCommand, withGroupLocks, type Command, type Project } from '../src/domain';
import { starterTable } from './fixtures';

const run = (p: Project, command: Command, actor?: string) => applyCommand(p, command, actor);
/** The starter table's tokens: two loose ones to work with. */
const tokens = (p: Project) => p.instances.filter(item => p.components.find(c => c.id === item.componentId)?.kind === 'token' && !item.stack);
const joined = (p: Project): Project => ({ ...p, players: [...p.players, { id: 'player-3', owner: 'local', name: 'Player 3', color: '#8899aa', x: 0, y: 0, rotation: 0 }] });

describe('hiding, locks and order locks', () => {
  it('cover the listed seats with the switch off, and everyone else (later seats too) with it on', () => {
    expect([appliesTo({ all: false, players: ['a'] }, 'a'), appliesTo({ all: false, players: ['a'] }, 'b'), appliesTo({ all: false, players: ['a'] }, undefined)]).toEqual([true, false, false]);
    expect([appliesTo({ all: true, players: ['a'] }, 'a'), appliesTo({ all: true, players: ['a'] }, 'b'), appliesTo({ all: true, players: ['a'] }, undefined)]).toEqual([false, true, true]);
    expect(toggleSeat({ all: true, players: ['a'] }, 'a')).toEqual({ all: true, players: [] });
    // Older saves' hiddenFrom lists read as seats it's hidden from.
    expect(scopeOf({ hiddenFrom: ['b'] }, 'hide')).toEqual({ all: false, players: ['b'] });
  });

  it('lock a piece for some seats only, or for everyone but some: seats that join later and scripts follow the switch', () => {
    const start = starterTable(), [token] = tokens(start);
    const moveBy = (p: Project, actor?: string) => run(p, { type: 'transform', ids: [token.id], dx: 10, dy: 0 }, actor);
    // Locked for Player 2 only: Player 1 and scripts (no seat) still move it.
    const forTwo = run(start, { type: 'move', ids: [token.id], patch: { locked: false, lockPlayers: ['player-2'] } }, 'player-1');
    expect(() => moveBy(forTwo, 'player-2')).toThrow(/[Uu]nlock/);
    expect(moveBy(forTwo, 'player-1').instances.find(item => item.id === token.id)!.x).toBe(token.x + 10);
    expect(() => moveBy(forTwo)).not.toThrow();
    expect(() => moveBy(joined(forTwo), 'player-3')).not.toThrow();
    // Locked for everyone but Player 1: a seat that joins later is locked out too, and so are scripts.
    const butOne = run(start, { type: 'move', ids: [token.id], patch: { locked: true, lockPlayers: ['player-1'] } }, 'player-1');
    expect(() => moveBy(butOne, 'player-1')).not.toThrow();
    expect(() => moveBy(butOne, 'player-2')).toThrow(/[Uu]nlock/);
    expect(() => moveBy(joined(butOne), 'player-3')).toThrow(/[Uu]nlock/);
    expect(() => moveBy(butOne)).toThrow(/[Uu]nlock/);
    // The play view says whether it's locked for the seat looking.
    expect(withGroupLocks(butOne, 'player-1').instances.find(item => item.id === token.id)!.locked).toBe(false);
    expect(withGroupLocks(butOne, 'player-2').instances.find(item => item.id === token.id)!.locked).toBe(true);
    // Switching the lock off for everyone (as the Lock button and L do) clears the list.
    const off = run(butOne, { type: 'move', ids: [token.id], patch: { locked: false, lockPlayers: [] } }, 'player-2');
    expect(off.instances.find(item => item.id === token.id)).toMatchObject({ locked: false });
    expect(off.instances.find(item => item.id === token.id)!.lockPlayers).toBeUndefined();
  });

  it('keep a piece’s order for some seats, and hide it from everyone but some, seats that join later included', () => {
    const start = starterTable(), [first, second] = tokens(start);
    const ordered = run(start, { type: 'move', ids: [first.id], patch: { orderLocked: false, orderLockPlayers: ['player-2'] } }, 'player-1');
    expect(() => run(ordered, { type: 'zOrder', ids: [first.id], move: 'front' }, 'player-2')).toThrow('order is locked');
    expect(run(ordered, { type: 'zOrder', ids: [first.id], move: 'front' }, 'player-1').instances.at(-1)!.id).toBe(first.id);
    // Picking it up doesn't raise it for Player 2.
    const ids = (p: Project) => p.instances.map(item => item.id);
    expect(ids(run(ordered, { type: 'front', ids: [first.id] }, 'player-2'))).toEqual(ids(ordered));

    const hidden = run(start, { type: 'hide', ids: [second.id], hidden: true, players: ['player-1'] }, 'player-1');
    const seen = (p: Project, seat?: string) => withGroupLocks(p, seat).instances.find(item => item.id === second.id)!.hidden ?? false;
    expect([seen(hidden, 'player-1'), seen(hidden, 'player-2'), seen(joined(hidden), 'player-3'), seen(hidden)]).toEqual([false, true, true, true]);
    // The older hideFrom hides from the listed seats only.
    const fromTwo = run(start, { type: 'hideFrom', ids: [second.id], players: ['player-2'] }, 'player-1');
    expect([seen(fromTwo, 'player-1'), seen(fromTwo, 'player-2'), seen(joined(fromTwo), 'player-3')]).toEqual([false, true, false]);
  });

  it('work the same for groups, cover the pieces in them, and forget seats that leave', () => {
    let p = starterTable();
    const [first, second] = tokens(p);
    p = run(p, { type: 'createGroup', id: 'pair', name: 'Pair', parent: null, ids: [first.id, second.id], groups: [] }, 'player-1');
    p = run(p, { type: 'lockGroups', ids: ['pair'], locked: true, players: ['player-2'] }, 'player-1');
    p = run(p, { type: 'lockGroups', ids: ['pair'], locked: false, hide: true, players: ['player-2'] }, 'player-1');
    expect(p.groups![0]).toMatchObject({ locked: true, lockPlayers: ['player-2'], hidePlayers: ['player-2'] });
    expect(() => run(p, { type: 'transform', ids: [first.id], dx: 5, dy: 0 }, 'player-1')).toThrow(/[Uu]nlock/);
    expect(() => run(p, { type: 'transform', ids: [first.id], dx: 5, dy: 0 }, 'player-2')).not.toThrow();
    expect(withGroupLocks(p, 'player-2').instances.find(item => item.id === first.id)!.hidden).toBe(true);
    expect(withGroupLocks(p, 'player-1').instances.find(item => item.id === first.id)!.hidden).toBeUndefined();
    // Player 2 leaves: the group's lists forget them, and older hiddenFrom lists become hidePlayers on the next change.
    const legacy: Project = { ...p, instances: p.instances.map(item => item.id === second.id ? { ...item, hiddenFrom: ['player-1'] } : item) };
    const left = run(legacy, { type: 'removePlayer', playerId: 'player-2' }, 'player-1');
    expect(left.groups![0].lockPlayers).toBeUndefined();
    expect(left.groups![0].hidePlayers).toBeUndefined();
    expect(left.instances.find(item => item.id === second.id)).toMatchObject({ hidePlayers: ['player-1'] });
    expect(left.instances.find(item => item.id === second.id)!.hiddenFrom).toBeUndefined();
  });

  it('are set and read by scripts the same way', () => {
    const source = `
      function go()
        local t = game.pieces({ kind = "token" })[1]
        game.lock(t, true, { "Player 1" })
        game.hide(t, true, 1)
        game.lockOrder(t, false, "Player 2")
        local piece = game.piece(t.id)
        memory.lock = piece.lock
        memory.hide = piece.hide
        memory.order = piece.orderLock
        memory.hiddenFrom = piece.hiddenFrom
      end`;
    const p = run(run(starterTable(), { type: 'script', script: { id: 's', name: 'Rules', source } }), { type: 'call', name: 'go', args: [], seed: 1 }, 'player-1');
    expect(p.scriptLog?.filter(line => line.level === 'error')).toBeUndefined();
    expect(p.memory).toEqual({
      lock: { everyone: true, players: ['player-1'] }, hide: { everyone: true, players: ['player-1'] }, order: { everyone: false, players: ['player-2'] }, hiddenFrom: ['player-2'],
    });
  });
});
