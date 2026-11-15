import { describe, expect, it } from 'vitest';
import { applyCommand, bind, canStack, makeInstance, makeNode, safeImage, stackMembers, validateProject, visibleBack, visibleStackMembers } from '../src/domain';
import { starterProject, template } from '../src/templates';
import { parseArchive, parseComponent } from '../src/storage';

describe('component design and bindings', () => {
  it('substitutes multiple bindings without evaluating HTML or expressions', () => {
    expect(bind('Cost: {{ cost }} / {{name}} {{missing}}', { cost: '4', name: '<script>' })).toBe('Cost: 4 / <script> ');
  });
  it('keeps instances linked to the live component and row when CSV changes', () => {
    const p = starterProject();
    const c = p.components[0];
    const id = p.instances.find(i => i.componentId === c.id)!.id;
    const next = applyCommand(p, { type: 'component', component: { ...c, rows: [{ name: 'Updated spirit' }] } });
    const i = next.instances.find(i => i.id === id)!;
    expect(i.componentId).toBe(c.id);
    expect(bind('{{name}}', next.components[0].rows[0])).toBe('Updated spirit');
    expect(p.components[0].rows[0].name).toBe('Forest guardian');
  });
  it('rejects broken, duplicate and cyclic hierarchy layers', () => {
    const p = starterProject();
    const frame = makeNode('frame');
    const child = makeNode('frame', { parent: frame.id });
    frame.parent = child.id;
    p.components[0].front = [frame, child];
    expect(() => validateProject(p)).toThrow('cycle');
    frame.parent = 'missing';
    expect(() => validateProject(p)).toThrow('existing frame');
  });
  it('accepts nested frames and all templates', () => {
    for (const kind of ['card', 'board', 'token', 'dice', 'blank'] as const) {
      expect(parseComponent(JSON.stringify(template(kind))).id).toBeTruthy();
    }
    const p = starterProject();
    const frame = makeNode('frame', { layout: 'column' });
    p.components[0].front = [frame, makeNode('text', { parent: frame.id })];
    expect(validateProject(p)).toBe(p);
  });
  it('only accepts remote http textures and safe raster data URLs', () => {
    expect(safeImage('javascript:alert(1)')).toBeUndefined();
    expect(safeImage('data:image/svg+xml,<svg/>')).toBeUndefined();
    expect(safeImage('https://example.com/image.png')).toBeTruthy();
  });
});

describe('tabletop commands', () => {
  it('turns incoming cards face up by default and optionally preserves their visible face on every hand-entry path', () => {
    for (const type of ['draw', 'drawMany', 'drawSelection', 'transferToHand'] as const) {
      for (const faceUp of [undefined, false]) {
        const p = starterProject();
        p.settings.allowOtherHands = true;
        const card = p.instances.find(i => i.componentId === p.components[0].id && !i.stack)!;
        card.flipped = true;
        const command = type === 'draw' ? { type, id: card.id, playerId: 'player-1', faceUp }
          : type === 'drawMany' ? { type, id: card.id, playerId: 'player-1', count: 1, faceUp }
          : { type, ids: [card.id], playerId: 'player-1', faceUp };
        const next = applyCommand(p, command, 'player-1');
        expect(next.instances.find(i => i.id === card.id)).toMatchObject({ holder: 'player-1', flipped: faceUp === false });
        expect(card.flipped).toBe(true);
      }
    }
  });
  it('only allows cross-hand transfers and plays when explicitly enabled for an authenticated actor', () => {
    let p = starterProject();
    const card = p.instances.find(i => i.componentId === p.components[0].id && !i.stack)!;
    p = applyCommand(p, { type: 'drawSelection', ids: [card.id], playerId: 'player-1' }, 'player-1');
    expect(() => applyCommand(p, { type: 'transferToHand', ids: [card.id], playerId: 'player-2' }, 'player-1')).toThrow('disabled');
    expect(() => applyCommand(p, { type: 'playVisibleHand', id: card.id, x: 1, y: 2 }, 'player-2')).toThrow('disabled');
    p = applyCommand(p, { type: 'settings', patch: { allowOtherHands: true } }, 'player-1');
    expect(() => applyCommand(p, { type: 'transferToHand', ids: [card.id], playerId: 'player-2' })).toThrow('active player');
    p = applyCommand(p, { type: 'transferToHand', ids: [card.id], playerId: 'player-2' }, 'player-1');
    expect(p.instances.find(i => i.id === card.id)?.holder).toBe('player-2');
    expect(() => applyCommand(p, { type: 'release', id: card.id, x: 1, y: 2 }, 'player-1')).toThrow('Switch');
    p = applyCommand(p, { type: 'playVisibleHand', id: card.id, x: 1, y: 2 }, 'player-1');
    expect(p.instances.find(i => i.id === card.id)).toMatchObject({ holder: null, x: 1, y: 2 });
  });
  it('flips a stack as a view without mutating member order or faces, and draws from its visible top', () => {
    let p = starterProject();
    const deck = p.instances.find(i => i.stack)!;
    const original = stackMembers(p, deck);
    original[0].flipped = false;
    original[1].flipped = true;
    const before = original.map(i => ({ id: i.id, order: i.order, flipped: i.flipped }));
    p = applyCommand(p, { type: 'transform', ids: original.map(i => i.id), flip: true }, 'player-1');
    const flipped = stackMembers(p, p.instances.find(i => i.id === deck.id)!);
    expect(flipped.map(i => ({ id: i.id, order: i.order, flipped: i.flipped }))).toEqual(before);
    expect(visibleStackMembers(p, flipped[0]).map(i => i.id)).toEqual(before.map(i => i.id).reverse());
    expect(visibleBack(flipped[0])).toBe(!before[0].flipped);
    p = applyCommand(p, { type: 'drawMany', id: flipped[0].id, playerId: 'player-1', count: 2, faceUp: false }, 'player-1');
    const held = p.instances.filter(i => i.holder === 'player-1').sort((a, b) => a.order - b.order);
    expect(held.map(i => i.id)).toEqual(before.slice(0, 2).map(i => i.id));
    expect(held.map(i => i.flipped)).toEqual(before.slice(0, 2).map(i => !i.flipped));
    const remaining = p.instances.find(i => i.stack)!;
    p = applyCommand(p, { type: 'transform', ids: stackMembers(p, remaining).map(i => i.id), flip: true }, 'player-1');
    expect(stackMembers(p, p.instances.find(i => i.id === remaining.id)!).map(i => i.flipped)).toEqual(before.slice(2).map(i => i.flipped));
  });
  it('materializes a reversed stack when merging or extracting its visible top', () => {
    let p = starterProject();
    const deck = p.instances.find(i => i.stack)!;
    const members = stackMembers(p, deck), ids = members.map(i => i.id);
    p = applyCommand(p, { type: 'transform', ids, flip: true }, 'player-1');
    const selected = p.instances.find(i => i.id === ids[0])!;
    p = applyCommand(p, { type: 'extractMove', id: selected.id, x: 5, y: 6 }, 'player-1');
    expect(p.instances.find(i => i.id === selected.id)).toMatchObject({ flipped: !members[0].flipped, stack: null });
    const target = p.instances.find(i => i.id === ids[1])!;
    p = applyCommand(p, { type: 'dropStack', ids: [selected.id], targetId: target.id, stackId: 'merged' }, 'player-1');
    const merged = stackMembers(p, p.instances.find(i => i.id === selected.id)!);
    expect(merged.map(i => i.id)).toEqual([...ids.slice(1).reverse(), selected.id]);
    expect(merged.every(i => !i.stackReversed)).toBe(true);
    for (const item of merged) expect(item.flipped).toBe(!members.find(original => original.id === item.id)!.flipped);
  });
  it('draws a complete flipped stack in visible top-first order', () => {
    let p = starterProject();
    const deck = p.instances.find(i => i.stack)!;
    const members = stackMembers(p, deck), ids = members.map(i => i.id);
    p = applyCommand(p, { type: 'transform', ids, flip: true }, 'player-1');
    p = applyCommand(p, { type: 'drawSelection', ids: [...ids].reverse(), playerId: 'player-1', faceUp: false }, 'player-1');
    const held = p.instances.filter(i => i.holder === 'player-1').sort((a, b) => a.order - b.order);
    expect(held.map(i => i.id)).toEqual(ids);
    expect(held.map(i => i.flipped)).toEqual(members.map(i => !i.flipped));
  });
  it('duplicates complete stacks without joining the original or changing their order', () => {
    const p = starterProject();
    const deck = p.instances.find(i => i.stack)!;
    const original = stackMembers(p, deck);
    const copies = original.map((item, index) => ({ sourceId: item.id, id: `copy-${index}`, stack: 'copied-stack' }));
    const next = applyCommand(p, { type: 'duplicate', copies, dx: 50, dy: 60 }, 'player-1');
    const copied = stackMembers(next, next.instances.find(i => i.id === copies[0].id)!);
    expect(copied.map(i => i.id)).toEqual(copies.map(i => i.id));
    expect(copied.map(i => i.flipped)).toEqual(original.map(i => i.flipped));
    expect(copied[0].x).toBe(original[0].x + 50);
    expect(stackMembers(next, next.instances.find(i => i.id === deck.id)!)).toHaveLength(original.length);
    expect(() => applyCommand(p, { type: 'duplicate', copies: copies.slice(0, 1), dx: 0, dy: 0 }, 'player-1')).toThrow('entire stack');
  });
  it('pastes validated snapshots as new independent stacks', () => {
    let p = starterProject();
    const deck = p.instances.find(i => i.stack)!;
    const copies = stackMembers(p, deck).map((i, index) => ({ ...i, id: `pasted-${index}`, stack: 'pasted-stack' }));
    p = applyCommand(p, { type: 'delete', ids: stackMembers(p, deck).map(i => i.id) }, 'player-1');
    const pasted = applyCommand(p, { type: 'paste', instances: copies }, 'player-1');
    expect(stackMembers(pasted, pasted.instances.find(i => i.id === copies[0].id)!).map(i => i.id)).toEqual(copies.map(i => i.id));
    expect(() => applyCommand(pasted, { type: 'paste', instances: copies }, 'player-1')).toThrow('identifier');
    expect(() => applyCommand(p, { type: 'paste', instances: [{ ...copies[0], holder: 'player-2' }] }, 'player-1')).toThrow('unlocked');
  });
  it('raises pieces, extracts one from a stack and rolls dice without rotating them', () => {
    let p = starterProject();
    const deck = p.instances.find(i => i.stack)!;
    const original = stackMembers(p, deck);
    const top = original.at(-1)!;
    p = applyCommand(p, { type: 'front', ids: original.map(i => i.id) }, 'player-1');
    expect(p.instances.at(-1)?.id).toBe(top.id);
    p = applyCommand(p, { type: 'extractMove', id: top.id, x: 100, y: 200 }, 'player-1');
    expect(p.instances.find(i => i.id === top.id)).toMatchObject({ stack: null, x: 100, y: 200 });
    expect(stackMembers(p, p.instances.find(i => i.id === deck.id)!).length).toBe(original.length - 1);
    const die = template('dice');
    p.components.push(die);
    const piece = { ...makeInstance(die.id), rotation: 37 };
    p.instances.push(piece);
    p = applyCommand(p, { type: 'roll', ids: [piece.id], seed: 42 }, 'player-1');
    expect(p.instances.find(i => i.id === piece.id)?.rotation).toBe(37);
    expect(p.instances.find(i => i.id === piece.id)?.id).toBe(piece.id);
  });
  it('releases multiple held pieces atomically and enforces hand ownership', () => {
    let p = starterProject();
    const cards = p.instances.filter(i => i.componentId === p.components[0].id && !i.stack).slice(0, 2);
    const ids = cards.map(i => i.id);
    p = applyCommand(p, { type: 'drawSelection', ids, playerId: 'player-1' }, 'player-1');
    expect(() => applyCommand(p, { type: 'releaseMany', ids, x: 10, y: 20 }, 'player-2')).toThrow('Switch');
    expect(p.instances.filter(i => ids.includes(i.id) && i.holder === 'player-1')).toHaveLength(2);
    const next = applyCommand(p, { type: 'releaseMany', ids, x: 10, y: 20 }, 'player-1');
    expect(next.instances.find(i => i.id === ids[0])).toMatchObject({ holder: null, x: 10, y: 20 });
    expect(next.instances.find(i => i.id === ids[1])).toMatchObject({ holder: null, x: 34, y: 44 });
    const target = p.instances.find(i => i.stack)!;
    expect(() => applyCommand(p, { type: 'dropManyFromHand', ids, targetId: target.id, stackId: 'new-stack' }, 'player-2')).toThrow('Switch');
    const stacked = applyCommand(p, { type: 'dropManyFromHand', ids, targetId: target.id, stackId: 'new-stack' }, 'player-1');
    expect(stackMembers(stacked, stacked.instances.find(i => i.id === target.id)!).slice(-2).map(i => i.id)).toEqual(ids);
  });
  it('transforms a selection atomically, preserving relative rotation, scale and individual faces', () => {
    const p = starterProject();
    const cards = p.instances.filter(i => i.componentId === p.components[0].id && !i.stack).slice(0, 2);
    cards[0].rotation = 15; cards[1].rotation = -20;
    cards[0].scale = .5; cards[1].scale = 1.5;
    cards[1].flipped = true;
    const ids = cards.map(i => i.id);
    const next = applyCommand(p, { type: 'transform', ids: [...ids, ids[0]], dx: 40, dy: -10, rotation: 90, scaleFactor: 2, flip: true }, 'player-1');
    expect(next.instances.find(i => i.id === ids[0])).toMatchObject({ rotation: 105, scale: 1, flipped: true, x: cards[0].x + 40, y: cards[0].y - 10 });
    expect(next.instances.find(i => i.id === ids[1])).toMatchObject({ rotation: 70, scale: 3, flipped: false });
    expect(cards[0].rotation).toBe(15);
    expect(() => applyCommand(p, { type: 'transform', ids, scaleFactor: 10 })).toThrow();
    cards[1].locked = true;
    expect(() => applyCommand(p, { type: 'transform', ids, rotation: 90 })).toThrow('Unlock');
    expect(cards[0].rotation).toBe(15);
  });
  it('draws arbitrary selections atomically, appends hand order and validates ownership', () => {
    let p = starterProject();
    const cards = p.instances.filter(i => i.componentId === p.components[0].id && !i.stack);
    const ids = cards.map(i => i.id);
    p = applyCommand(p, { type: 'drawSelection', ids: [ids[0]], playerId: 'player-1' }, 'player-1');
    expect(() => applyCommand(p, { type: 'drawSelection', ids: ids.slice(1), playerId: 'player-1' }, 'player-2')).toThrow('active hand');
    expect(() => applyCommand(p, { type: 'transform', ids: [ids[0]], flip: true }, 'player-2')).toThrow('Switch');
    const next = applyCommand(p, { type: 'drawSelection', ids: ids.slice(1), playerId: 'player-1' }, 'player-1');
    expect(next.instances.filter(i => i.holder === 'player-1').sort((a, b) => a.order - b.order).map(i => i.id)).toEqual(ids);
    const invalid = { ...p, instances: p.instances.map(i => i.id === ids.at(-1) ? { ...i, locked: true } : i) };
    expect(() => applyCommand(invalid, { type: 'drawSelection', ids: ids.slice(1), playerId: 'player-1' }, 'player-1')).toThrow('unlocked');
    expect(invalid.instances.filter(i => i.holder)).toHaveLength(1);
    expect(() => applyCommand({ ...p, settings: { ...p.settings, hands: false } }, { type: 'drawSelection', ids: ids.slice(1), playerId: 'player-1' }, 'player-1')).toThrow('Enable hands');
  });
  it('creates any number of hotseat players and preserves source state', () => {
    let p = starterProject();
    const source = p;
    for (let n = 0; n < 32; n++) p = applyCommand(p, { type: 'player', player: { ...p.players[0], id: `seat-${n}`, name: `Player ${n}` } });
    expect(p.players).toHaveLength(34);
    expect(source.players).toHaveLength(2);
  });
  it('requires matching tags, or the exact same untagged component, for stacking', () => {
    const a = template('card'), b = template('card');
    expect(canStack([a, b])).toBe(false);
    expect(canStack([a, a])).toBe(true);
    a.stackTag = b.stackTag = 'cards';
    expect(canStack([a, b])).toBe(true);
    b.stackable = false;
    expect(canStack([a, b])).toBe(false);
  });
  it('stacks, shuffles, reorders, draws and releases pieces without losing instances', () => {
    let p = starterProject();
    const deck = p.instances.find(i => i.stack)!;
    const original = stackMembers(p, deck).map(i => i.id);
    p = applyCommand(p, { type: 'shuffle', id: deck.id, seed: 78236 });
    const shuffled = stackMembers(p, p.instances.find(i => i.id === deck.id)!).map(i => i.id);
    expect(shuffled).not.toEqual(original);
    expect([...shuffled].sort()).toEqual([...original].sort());
    p = applyCommand(p, { type: 'reorder', ids: original });
    p = applyCommand(p, { type: 'draw', id: deck.id, playerId: 'player-1' }, 'player-1');
    const drawn = p.instances.find(i => i.id === original.at(-1))!;
    expect(drawn.holder).toBe('player-1');
    expect(drawn.stack).toBeNull();
    expect(p.instances).toHaveLength(22);
    p = applyCommand(p, { type: 'release', id: drawn.id, x: 123, y: 456 }, 'player-1');
    expect(p.instances.find(i => i.id === drawn.id)).toMatchObject({ holder: null, x: 123, y: 456 });
  });
  it('disallows editing another player hand, nonflippable pieces and locked pieces', () => {
    let p = starterProject();
    const deck = p.instances.find(i => i.stack)!;
    p = applyCommand(p, { type: 'draw', id: deck.id, playerId: 'player-1' }, 'player-1');
    const held = p.instances.find(i => i.holder)!;
    expect(() => applyCommand(p, { type: 'delete', ids: [held.id] }, 'player-2')).toThrow('Switch');
    const token = p.instances.find(i => i.componentId === p.components[1].id)!;
    expect(() => applyCommand(p, { type: 'move', ids: [token.id], patch: { flipped: true } })).toThrow('not flippable');
    const board = p.instances.find(i => i.locked)!;
    expect(() => applyCommand(p, { type: 'move', ids: [board.id], patch: { x: 1 } })).toThrow('Unlock');
    expect(applyCommand(p, { type: 'move', ids: [board.id], patch: { locked: false } }).instances.find(i => i.id === board.id)?.locked).toBe(false);
  });
  it('disallows drawing with hands off or into a different active hand', () => {
    let p = starterProject();
    const deck = p.instances.find(i => i.stack)!;
    expect(() => applyCommand(p, { type: 'draw', id: deck.id, playerId: 'player-2' }, 'player-1')).toThrow('active hand');
    p = applyCommand(p, { type: 'settings', patch: { hands: false } });
    expect(() => applyCommand(p, { type: 'draw', id: deck.id, playerId: 'player-1' })).toThrow('Enable hands');
  });
  it('normalizes singleton stacks and removes incompatible stacks on design updates', () => {
    let p = starterProject();
    const deck = p.instances.filter(i => i.stack);
    p = applyCommand(p, { type: 'delete', ids: deck.slice(1).map(i => i.id) });
    expect(p.instances.find(i => i.id === deck[0].id)?.stack).toBeNull();
    p = starterProject();
    p = applyCommand(p, { type: 'component', component: { ...p.components[0], stackable: false, hand: false, flippable: false } });
    expect(p.instances.some(i => i.stack)).toBe(false);
    expect(p.instances.some(i => i.flipped)).toBe(false);
  });
  it('rejects duplicate instance IDs, incomplete stack reorder and bad references', () => {
    const p = starterProject();
    expect(() => applyCommand(p, { type: 'spawn', instances: [p.instances[0]] })).toThrow('already exists');
    expect(() => applyCommand(p, { type: 'spawn', instances: [makeInstance('missing')] })).toThrow('no longer exists');
    expect(() => applyCommand(p, { type: 'reorder', ids: [p.instances.find(i => i.stack)!.id] })).toThrow('every item');
  });
  it('atomically drops whole compatible stacks and rejects stale or unsafe drops', () => {
    let p = starterProject();
    const deck = p.instances.filter(i => i.stack);
    const card = p.instances.find(i => i.componentId === p.components[0].id && !i.stack)!;
    expect(() => applyCommand(p, { type: 'dropStack', ids: [deck[0].id], targetId: card.id, stackId: 'new' }, 'player-1')).toThrow('entire stack');
    const token = p.instances.find(i => i.componentId === p.components[1].id)!;
    expect(() => applyCommand(p, { type: 'dropStack', ids: [token.id], targetId: card.id, stackId: 'new' }, 'player-1')).toThrow('compatible');
    p = applyCommand(p, { type: 'dropStack', ids: [card.id], targetId: deck[0].id, stackId: 'new' }, 'player-1');
    const result = stackMembers(p, p.instances.find(i => i.id === card.id)!);
    expect(result).toHaveLength(13);
    expect(result.at(-1)?.id).toBe(card.id);
    expect(result.every(i => i.x === deck[0].x && i.y === deck[0].y)).toBe(true);
  });
  it('draws multiple cards in order, validates hand ordering and releases onto a stack', () => {
    let p = starterProject();
    const deck = p.instances.find(i => i.stack)!;
    const before = stackMembers(p, deck).map(i => i.id);
    p = applyCommand(p, { type: 'drawMany', id: deck.id, playerId: 'player-1', count: 3 }, 'player-1');
    const held = p.instances.filter(i => i.holder === 'player-1').sort((a, b) => a.order - b.order);
    expect(held.map(i => i.id)).toEqual(before.slice(-3).reverse());
    expect(() => applyCommand(p, { type: 'reorderHand', ids: held.map(i => i.id), playerId: 'player-1' }, 'player-2')).toThrow('active hand');
    expect(() => applyCommand(p, { type: 'reorderHand', ids: [held[0].id], playerId: 'player-1' }, 'player-1')).toThrow('every item');
    p = applyCommand(p, { type: 'reorderHand', ids: held.map(i => i.id).reverse(), playerId: 'player-1' }, 'player-1');
    expect(p.instances.find(i => i.id === held[2].id)?.order).toBe(0);
    expect(() => applyCommand(p, { type: 'release', id: held[0].id, x: 0, y: 0 }, 'player-2')).toThrow('Switch');
    p = applyCommand(p, { type: 'dropFromHand', id: held[0].id, targetId: deck.id, stackId: 'new' }, 'player-1');
    expect(stackMembers(p, p.instances.find(i => i.id === held[0].id)!).at(-1)?.id).toBe(held[0].id);
  });
});

describe('portable saves', () => {
  it('round-trips full designs, seats, stacks, hands and settings', () => {
    const p = starterProject();
    const next = applyCommand(p, { type: 'draw', id: p.instances.find(i => i.stack)!.id, playerId: p.players[0].id });
    expect(parseArchive(JSON.stringify({ format: 'tablecraft', version: 1, projects: [next] })).projects[0]).toEqual(next);
  });
  it('rejects unsupported formats and dangling references', () => {
    expect(() => parseArchive('{"format":"other","version":1,"projects":[]}')).toThrow();
    const p = starterProject();
    p.instances[0].componentId = 'missing';
    expect(() => parseArchive(JSON.stringify({ format: 'tablecraft', version: 1, projects: [p] }))).toThrow('Broken');
  });
});
