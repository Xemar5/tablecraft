import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/domain';
import { applyPlaygroundCommand, emptyPlaygroundHistory } from '../src/playgroundHistory';
import { starterProject } from '../src/templates';

const call = (name: string) => ({ type: 'call' as const, name, args: [], seed: 1 });

describe('pinging and hiding pieces', () => {
  it('pings count up for everyone with the pinging seat, without an undo step', () => {
    const p = starterProject();
    const id = p.instances[1].id;
    const pinged = applyPlaygroundCommand(p, emptyPlaygroundHistory(), { type: 'ping', ids: [id] }, 'player-2');
    expect(pinged.project.instances[1]).toMatchObject({ pings: 1, pingedBy: 'player-2' });
    expect(pinged.history.entries).toHaveLength(0);
    expect(applyCommand(pinged.project, { type: 'ping', ids: [id] }).instances[1].pings).toBe(2);
  });

  it('hide whole stacks from seats, and forget it in hands and for removed seats', () => {
    const p = starterProject();
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
    const p = applyCommand(starterProject(), { type: 'script', script: { id: 's', name: 'Rules', source } });
    const next = applyCommand(p, call('go'), 'player-1');
    const token = next.instances.find(i => next.components.find(c => c.id === i.componentId)?.kind === 'token')!;
    expect(token).toMatchObject({ pings: 1, pingedBy: 'player-1', hiddenFrom: ['player-2'] });
    expect(next.memory).toEqual({ hidden: 'player-2' });
  });
});
