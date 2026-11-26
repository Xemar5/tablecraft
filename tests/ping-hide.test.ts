import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/domain';
import { applyPlaygroundCommand, emptyPlaygroundHistory } from '../src/playgroundHistory';
import { starterTable } from './fixtures';

const call = (name: string) => ({ type: 'call' as const, name, args: [], seed: 1 });

describe('pinging and hiding pieces', () => {
  it('pings count up for everyone with the pinging seat, without an undo step', () => {
    const p = starterTable();
    const id = p.instances[1].id;
    const pinged = applyPlaygroundCommand(p, emptyPlaygroundHistory(), { type: 'ping', ids: [id] }, 'player-2');
    expect(pinged.project.instances[1]).toMatchObject({ pings: 1, pingedBy: 'player-2' });
    expect(pinged.history.entries).toHaveLength(0);
    expect(applyCommand(pinged.project, { type: 'ping', ids: [id] }).instances[1].pings).toBe(2);
  });

  it('hide whole stacks from seats, and forget it in hands and for removed seats', () => {
    const p = starterTable();
    const deck = p.instances.filter(i => i.stack === 'starter-deck');
    let next = applyCommand(p, { type: 'hideFrom', ids: [deck[0].id], players: ['player-2'] });
    expect(next.instances.filter(i => i.stack === 'starter-deck').every(i => i.hiddenFrom?.[0] === 'player-2')).toBe(true);
    // A card drawn into a hand isn't hidden any more; one dropped onto the hidden stack is hidden like it.
    next = applyCommand(next, { type: 'draw', id: deck[0].id, playerId: 'player-1' }, 'player-1');
    const drawn = next.instances.find(i => i.holder === 'player-1')!;
    expect(drawn.hiddenFrom).toBeUndefined();
    const top = next.instances.find(i => i.stack === 'starter-deck')!;
    next = applyCommand(next, { type: 'dropFromHand', id: drawn.id, targetId: top.id, stackId: 'again' }, 'player-1');
    expect(next.instances.find(i => i.id === drawn.id)!.hiddenFrom).toEqual(['player-2']);
    expect(() => applyCommand(next, { type: 'hideFrom', ids: [top.id], players: ['nobody'] })).toThrow('no longer exists');
    next = applyCommand(next, { type: 'removePlayer', playerId: 'player-2' });
    expect(next.instances.some(i => i.hiddenFrom)).toBe(false);
  });

  it('let scripts ping and hide pieces, and read who they are hidden from', () => {
    const source = 'function go() local t = game.pieces({ kind = "token" })[1]; game.ping(t); game.hideFrom(t, { "Player 2" }); memory.hidden = game.piece(t.id).hiddenFrom[1] end';
    const p = applyCommand(starterTable(), { type: 'script', script: { id: 's', name: 'Rules', source } });
    const next = applyCommand(p, call('go'), 'player-1');
    const token = next.instances.find(i => next.components.find(c => c.id === i.componentId)?.kind === 'token')!;
    expect(token).toMatchObject({ pings: 1, pingedBy: 'player-1', hiddenFrom: ['player-2'] });
    expect(next.memory).toEqual({ hidden: 'player-2' });
  });

  it('let scripts show pieces again, and clear lists, with an empty table {}', () => {
    const source = `
      function hide() game.hideFrom(game.pieces({ kind = "token" })[1], { "Player 2" }) end
      function show() game.hideFrom(game.pieces({ kind = "token" })[1], {}) end
      function nothing() game.move({}, 10, 10) end
      function filter() local deck = game.stackOf("starter-deck"); game.setStackFilter(deck, { { has = { "amber" }, lacks = {} } }) end
      function clear() game.setStackFilter(game.stackOf("starter-deck"), {}) end`;
    const p = applyCommand(starterTable(), { type: 'script', script: { id: 's', name: 'Rules', source } });
    const errors = (project: typeof p) => (project.scriptLog ?? []).filter(line => line.level === 'error').map(line => line.text);
    const token = (project: typeof p) => project.instances.find(i => project.components.find(c => c.id === i.componentId)?.kind === 'token')!;
    const hidden = applyCommand(p, call('hide'), 'player-1');
    const shown = applyCommand(hidden, call('show'), 'player-1');
    expect(errors(shown)).toEqual([]);
    expect(token(shown).hiddenFrom).toBeUndefined();
    // An empty list of pieces does nothing.
    const moved = applyCommand(p, call('nothing'), 'player-1');
    expect([errors(moved), moved.instances]).toEqual([[], p.instances]);
    // An empty list of tags adds no tag, and an empty list of rules takes every piece.
    const filtered = applyCommand(p, call('filter'), 'player-1');
    expect(errors(filtered)).toEqual([]);
    expect(filtered.instances.find(i => i.stack === 'starter-deck')!.stackFilter).toEqual({ anyOf: [{ has: ['amber'], lacks: [] }] });
    const cleared = applyCommand(filtered, call('clear'), 'player-1');
    expect(errors(cleared)).toEqual([]);
    expect(cleared.instances.find(i => i.stack === 'starter-deck')!.stackFilter).toEqual({ anyOf: [] });
  });
});
