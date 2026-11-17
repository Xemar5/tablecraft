import { describe, expect, it } from 'vitest';
import { applyCommand, bind, canStack, makeInstance, makeNode, nextSeatPlacement, safeImage, shareComponents, stackMembers, validateProject, visibleBack, visibleStackMembers } from '../src/domain';
import { starterProject, template } from '../src/templates';
import { parseArchive, parseComponent } from '../src/storage';

describe('component design and bindings', () => {
  it('reorders components relative to a target without changing designs or placed pieces', () => {
    const p = starterProject();
    const ids = p.components.map(c => c.id);
    const moved = applyCommand(p, { type: 'reorderComponent', id: ids[0], targetId: ids[2], position: 'after' });
    expect(moved.components.map(c => c.id)).toEqual([ids[1], ids[2], ids[0], ...ids.slice(3)]);
    expect(moved.instances).toEqual(p.instances);
    expect(moved.components.find(c => c.id === ids[0])).toEqual(p.components[0]);
    expect(p.components.map(c => c.id)).toEqual(ids);
    const restored = applyCommand(moved, { type: 'reorderComponent', id: ids[0], targetId: ids[1], position: 'before' });
    expect(restored).toEqual(p);
    expect(applyCommand(p, { type: 'reorderComponent', id: ids[0], targetId: ids[0], position: 'after' })).toEqual(p);
    for (const [id, targetId] of [['missing', ids[0]], [ids[0], 'missing']]) {
      expect(() => applyCommand(p, { type: 'reorderComponent', id, targetId, position: 'before' })).toThrow('Component no longer exists');
    }
  });

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
  it('changes component types without replacing artwork, data or existing instances', () => {
    const p = starterProject();
    const original = p.components[0];
    for (const kind of ['card', 'token', 'board', 'dice'] as const) {
      const next = applyCommand(p, { type: 'component', component: { ...original, kind } });
      expect(next.components[0]).toEqual({ ...original, kind });
      expect(next.instances).toEqual(p.instances);
    }
  });
  it('removes dice variants atomically and remaps dice and fixed nested references', () => {
    const p = starterProject();
    const die = p.components.find(c => c.kind === 'dice')!;
    const placed = p.instances.find(i => i.componentId === die.id)!;
    placed.row = 5;
    p.components[0].front.push(makeNode('component', { componentId: die.id, dataSource: 'row', dataRow: 3 }));
    p.components[0].front.push(makeNode('component', { componentId: die.id, dataSource: 'row', dataRow: 5 }));
    const component = { ...die, rows: die.rows.filter((_, index) => index !== 3), csv: 'value\n1\n2\n3\n5\n6' };
    const next = applyCommand(p, { type: 'component', component, removedDataRow: 3 });
    expect(next.instances.find(i => i.id === placed.id)?.row).toBe(4);
    expect(next.components[0].front.slice(-2).map(node => node.dataRow)).toEqual([3, 4]);
    expect(next.components.find(c => c.id === die.id)?.rows[3].value).toBe('5');
    expect(p.instances.find(i => i.id === placed.id)?.row).toBe(5);
    const lastRemoved = applyCommand(p, { type: 'component', component: { ...die, rows: die.rows.slice(0, -1) }, removedDataRow: 5 });
    expect(lastRemoved.instances.find(i => i.id === placed.id)?.row).toBe(4);
    expect(() => applyCommand(p, { type: 'component', component: die, removedDataRow: 3 })).toThrow('exactly one');
    const fresh = starterProject();
    const one = { ...fresh.components.find(c => c.kind === 'dice')!, rows: [{ value: '1' }] };
    const single = applyCommand(fresh, { type: 'component', component: one });
    expect(() => applyCommand(single, { type: 'component', component: { ...one, rows: [] }, removedDataRow: 0 })).toThrow('at least one');
  });
  it('rolls using the current dice variant count after additions and removals', () => {
    const p = starterProject();
    const die = p.components.find(c => c.kind === 'dice')!;
    const placed = p.instances.find(i => i.componentId === die.id)!;
    for (const count of [1, 4, 9]) {
      const component = { ...die, rows: Array.from({ length: count }, (_, index) => ({ value: String(index + 1) })) };
      const edited = applyCommand(p, { type: 'component', component });
      const results = new Set<number>();
      for (let seed = 0; seed < 100; seed++) {
        const rolled = applyCommand(edited, { type: 'roll', ids: [placed.id], seed });
        const item = rolled.instances.find(i => i.id === placed.id)!;
        expect(item.row).toBeGreaterThanOrEqual(0);
        expect(item.row).toBeLessThan(count);
        expect(item.rotation).toBe(placed.rotation);
        results.add(item.row);
      }
      expect(results.size).toBe(count);
    }
  });
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
  it('separately authorizes inserting and taking with an authenticated actor', () => {
    let p = starterProject();
    const card = p.instances.find(i => i.componentId === p.components[0].id && !i.stack)!;
    p = applyCommand(p, { type: 'drawSelection', ids: [card.id], playerId: 'player-1' }, 'player-1');
    const inserted = applyCommand(p, { type: 'transferToHand', ids: [card.id], playerId: 'player-2' }, 'player-1');
    expect(inserted.instances.find(i => i.id === card.id)?.holder).toBe('player-2');
    expect(() => applyCommand(inserted, { type: 'transferToHand', ids: [card.id], playerId: 'player-1' }, 'player-1')).toThrow('Taking');
    expect(() => applyCommand(p, { type: 'playVisibleHand', id: card.id, x: 1, y: 2 }, 'player-2')).toThrow('disabled');
    p = applyCommand(p, { type: 'handSettings', playerId: 'player-2', patch: { allowHandInsert: false, allowHandTake: true } }, 'player-2');
    expect(() => applyCommand(p, { type: 'transferToHand', ids: [card.id], playerId: 'player-2' }, 'player-1')).toThrow('Inserting');
    p = applyCommand(p, { type: 'handSettings', playerId: 'player-2', patch: { allowHandInsert: true } }, 'player-2');
    expect(() => applyCommand(p, { type: 'transferToHand', ids: [card.id], playerId: 'player-2' })).toThrow('active player');
    p = applyCommand(p, { type: 'transferToHand', ids: [card.id], playerId: 'player-2' }, 'player-1');
    expect(p.instances.find(i => i.id === card.id)?.holder).toBe('player-2');
    expect(() => applyCommand(p, { type: 'release', id: card.id, x: 1, y: 2 }, 'player-1')).toThrow('Switch');
    p = applyCommand(p, { type: 'playVisibleHand', id: card.id, x: 1, y: 2 }, 'player-1');
    expect(p.instances.find(i => i.id === card.id)).toMatchObject({ holder: null, x: 1, y: 2 });
  });
  it('inserts multiple cards atomically at the beginning, middle and end of a hand', () => {
    for (const index of [0, 1, 2]) {
      let p = starterProject();
      const deck = p.instances.find(i => i.stack)!;
      p = applyCommand(p, { type: 'drawMany', id: deck.id, count: 2, playerId: 'player-1' }, 'player-1');
      const held = p.instances.filter(i => i.holder).sort((a, b) => a.order - b.order).map(i => i.id);
      const moving = p.instances.filter(i => i.stack === deck.stack).slice(0, 2).map(i => i.id);
      const next = applyCommand(p, { type: 'transferToHand', ids: moving, playerId: 'player-1', index }, 'player-1');
      const expected = [...held]; expected.splice(index, 0, ...[...moving].reverse());
      expect(next.instances.filter(i => i.holder).sort((a, b) => a.order - b.order).map(i => i.id)).toEqual(expected);
      expect(() => applyCommand(p, { type: 'transferToHand', ids: moving, playerId: 'player-1', index: 3 }, 'player-1')).toThrow('out of range');
      expect(p.instances.filter(i => i.holder)).toHaveLength(2);
    }
  });
  it('keeps own reordering available with both permissions off and preserves faces', () => {
    let p = starterProject();
    p.players[0].allowHandInsert = false; p.players[0].allowHandTake = false;
    p = applyCommand(p, { type: 'drawMany', id: p.instances.find(i => i.stack)!.id, count: 3, playerId: 'player-1' }, 'player-1');
    const held = p.instances.filter(i => i.holder).sort((a, b) => a.order - b.order);
    held[2].flipped = true;
    const next = applyCommand(p, { type: 'transferToHand', ids: [held[2].id], playerId: 'player-1', index: 0 }, 'player-1');
    expect(next.instances.find(i => i.id === held[2].id)).toMatchObject({ order: 0, flipped: true });
  });
  it('preserves legacy permissions until the separate controls override them', () => {
    let p = starterProject();
    const card = p.instances.find(i => i.componentId === p.components[0].id && !i.stack)!;
    p.settings.allowOtherHands = false;
    expect(() => applyCommand(p, { type: 'transferToHand', ids: [card.id], playerId: 'player-2' }, 'player-1')).toThrow('Inserting');
    p.settings.allowOtherHands = true;
    p = applyCommand(p, { type: 'transferToHand', ids: [card.id], playerId: 'player-2' }, 'player-1');
    p = applyCommand(p, { type: 'handSettings', playerId: 'player-2', patch: { allowHandTake: false } }, 'player-2');
    expect(() => applyCommand(p, { type: 'playVisibleHand', id: card.id, x: 1, y: 2 }, 'player-1')).toThrow('Taking');
    p = applyCommand(p, { type: 'handSettings', playerId: 'player-2', patch: { allowHandTake: true } }, 'player-2');
    expect(applyCommand(p, { type: 'playVisibleHand', id: card.id, x: 1, y: 2 }, 'player-1').instances.find(i => i.id === card.id)?.holder).toBeNull();
  });
  it('configures hands on existing seats (seat managers include the host and viewers) and checks every source independently', () => {
    let p = starterProject();
    p.players.push({ ...p.players[1], id: 'player-3' });
    const cards = p.instances.filter(i => i.componentId === p.components[0].id && !i.stack).slice(0, 2);
    cards[0].holder = 'player-2'; cards[1].holder = 'player-3';
    expect(applyCommand(p, { type: 'handSettings', playerId: 'player-1', patch: { allowHandTake: true } }).players[0].allowHandTake).toBe(true);
    expect(() => applyCommand(p, { type: 'handSettings', playerId: 'missing', patch: { allowHandTake: true } }, 'player-1')).toThrow('Seat no longer exists');
    expect(() => applyCommand(p, { type: 'settings', patch: { allowHandTake: true } }, 'player-1')).toThrow('per-hand');
    p = applyCommand(p, { type: 'handSettings', playerId: 'player-2', patch: { allowHandTake: true, allowHandInsert: false } }, 'player-2');
    expect(p.players[0].allowHandTake).toBeUndefined();
    expect(p.players[2].allowHandTake).toBeUndefined();
    const transfer = { type: 'transferToHand' as const, ids: cards.map(i => i.id), playerId: 'player-1' };
    expect(() => applyCommand(p, transfer, 'player-1')).toThrow('Taking');
    expect(() => applyCommand(p, { type: 'transferToHand', ids: [cards[1].id], playerId: 'player-2' }, 'player-3')).toThrow('Inserting');
    p = applyCommand(p, { type: 'handSettings', playerId: 'player-3', patch: { allowHandTake: true } }, 'player-3');
    const next = applyCommand(p, transfer, 'player-1');
    expect(next.instances.filter(i => transfer.ids.includes(i.id)).every(i => i.holder === 'player-1')).toBe(true);
  });
  it('stores face-up, table-hand visibility and seat lock preferences per player', () => {
    let p = starterProject();
    const patch = { handFaceUp: false, tableHandHidden: true, tableHandUnlocked: true };
    // Ownership (or the room host's override) is enforced by the multiplayer server, so the shared engine accepts other seats.
    expect(applyCommand(p, { type: 'handSettings', playerId: 'player-2', patch }, 'player-1').players[1]).toMatchObject(patch);
    p = applyCommand(p, { type: 'handSettings', playerId: 'player-2', patch }, 'player-2');
    expect(p.players[1]).toMatchObject(patch);
    expect(p.players[0]).not.toHaveProperty('handFaceUp');
    expect(p.players[0]).not.toHaveProperty('tableHandHidden');
    expect(p.players[0]).not.toHaveProperty('tableHandUnlocked');
    expect(validateProject(p).players[1]).toMatchObject(patch);
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
    expect(p.instances.find(i => i.id === piece.id)?.rolls).toBe(1);
    p = applyCommand(p, { type: 'roll', ids: [piece.id], seed: 42 }, 'player-1');
    expect(p.instances.find(i => i.id === piece.id)?.rolls).toBe(2);
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
    cards[1].scale = .3;
    const relative = applyCommand(p, { type: 'transform', ids: [ids[1]], scaleFactor: .7 / .3 }, 'player-1');
    expect(relative.instances.find(i => i.id === ids[1])?.scale).toBe(.7);
    cards[1].scale = 1.5;
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
describe('removing seats', () => {
  it('spreads the hand where the seat was and supports removing the active and last seat', () => {
    let p = starterProject();
    const cards = p.instances.filter(i => i.stack).slice(-3);
    p = applyCommand(p, { type: 'settings', patch: { turn: 1 } });
    p = applyCommand(p, { type: 'drawMany', id: cards[0].id, playerId: 'player-2', count: 3 }, 'player-2');
    const held = p.instances.filter(i => i.holder === 'player-2').sort((a, b) => a.order - b.order);
    expect(held).toHaveLength(3);
    expect(applyCommand(p, { type: 'removePlayer', playerId: 'player-2' }, 'player-2').players).toHaveLength(1);
    expect(() => applyCommand(p, { type: 'removePlayer', playerId: 'missing' }, 'player-1')).toThrow('Seat no longer exists');
    const next = applyCommand(p, { type: 'removePlayer', playerId: 'player-2' }, 'player-1');
    expect(next.players.map(player => player.id)).toEqual(['player-1']);
    expect(next.settings.turn).toBe(0);
    const placed = held.map(item => next.instances.find(i => i.id === item.id)!);
    expect(placed.every(i => i.holder === null && i.stack === null)).toBe(true);
    // Player 2 sits at (980, 100) facing down (180 degrees): the row runs right to left, centered on the seat.
    expect(placed.map(i => i.y)).toEqual([100, 100, 100]);
    expect(placed[1].x).toBe(980);
    expect(placed[0].x).toBeGreaterThan(980);
    expect(placed[2].x).toBeLessThan(980);
    const empty = applyCommand(next, { type: 'removePlayer', playerId: 'player-1' }, 'player-1');
    expect(empty.players).toHaveLength(0);
    expect(empty.settings.turn).toBe(0);
    expect(empty.instances.every(item => item.holder === null)).toBe(true);
  });

  it('wraps large hands into rows that grow toward the table', () => {
    let p = starterProject();
    const deck = p.instances.find(i => i.stack)!;
    const size = p.instances.filter(i => i.stack === deck.stack).length;
    p = applyCommand(p, { type: 'drawMany', id: deck.id, playerId: 'player-2', count: size }, 'player-2');
    const next = applyCommand(p, { type: 'removePlayer', playerId: 'player-2' }, 'player-1');
    const placed = p.instances.filter(i => i.holder === 'player-2').map(item => next.instances.find(i => i.id === item.id)!);
    const rows = new Set(placed.map(i => i.y));
    expect(rows.size).toBe(Math.ceil(size / 8));
    expect(Math.min(...rows)).toBe(100);
  });
});
describe('seat order and turns', () => {
  it('reorders seats while keeping the current turn with the same player', () => {
    let p = starterProject();
    p = applyCommand(p, { type: 'player', player: { ...p.players[0], id: 'player-3', name: 'Player 3' } });
    p = applyCommand(p, { type: 'settings', patch: { turns: true, turn: 1 } });
    const next = applyCommand(p, { type: 'reorderPlayers', ids: ['player-2', 'player-3', 'player-1'] });
    expect(next.players.map(player => player.id)).toEqual(['player-2', 'player-3', 'player-1']);
    expect(next.settings.turn).toBe(0);
    for (const ids of [['player-1', 'player-2'], ['player-1', 'player-1', 'player-2'], ['player-1', 'player-2', 'missing']])
      expect(() => applyCommand(p, { type: 'reorderPlayers', ids })).toThrow('every seat once');
  });

  it('ends the turn by passing it to the next seat in order, wrapping around', () => {
    let p = starterProject();
    expect(() => applyCommand(p, { type: 'endTurn' })).toThrow('turn tracker');
    p = applyCommand(p, { type: 'settings', patch: { turns: true } });
    p = applyCommand(p, { type: 'endTurn' });
    expect(p.settings.turn).toBe(1);
    p = applyCommand(p, { type: 'endTurn' });
    expect(p.settings.turn).toBe(0);
  });
});

describe('seat placement', () => {
  it('fills the table bottom, opposite, left, right, then the spaces between', () => {
    const seats: { x: number; y: number; rotation: number }[] = [];
    for (let n = 0; n < 8; n++) seats.push(nextSeatPlacement(seats));
    expect(seats.slice(0, 4)).toEqual([
      { x: 980, y: 1000, rotation: 0 }, { x: 980, y: 100, rotation: 180 },
      { x: 220, y: 550, rotation: 90 }, { x: 1740, y: 550, rotation: -90 },
    ]);
    expect(seats.slice(4).map(seat => seat.rotation)).toEqual([45, -135, 135, -45]);
    expect(seats[4].x).toBeLessThan(980); expect(seats[4].y).toBeGreaterThan(550);
  });

  it('matches the starter seats and reuses the widest gap after seats move or leave', () => {
    const starter = starterProject().players;
    expect(nextSeatPlacement(starter.slice(0, 1))).toEqual({ x: starter[1].x, y: starter[1].y, rotation: starter[1].rotation });
    expect(nextSeatPlacement(starter).rotation).toBe(90);
    expect(nextSeatPlacement([{ x: 980, y: 100 }])).toEqual({ x: 980, y: 1000, rotation: 0 });
    expect(nextSeatPlacement([{ x: 980, y: 1000 }, { x: 220, y: 550 }, { x: 1740, y: 550 }]).rotation).toBe(180);
  });
});

describe('structural sharing for large projects', () => {
  it('keeps component objects for tabletop commands and replaces them for design commands', () => {
    const p = validateProject(starterProject());
    const piece = p.instances.find(i => !i.locked)!;
    const moved = applyCommand(p, { type: 'move', ids: [piece.id], patch: { x: piece.x + 10 } });
    expect(moved.components).toBe(p.components);
    expect(moved.instances).not.toBe(p.instances);
    expect(p.instances.find(i => i.id === piece.id)!.x).toBe(piece.x);
    const renamed = applyCommand(p, { type: 'component', component: { ...p.components[0], name: 'Renamed' } });
    expect(renamed.components).not.toBe(p.components);
    expect(renamed.components[0].name).toBe('Renamed');
    expect(p.components[0].name).not.toBe('Renamed');
  });

  it('still rejects broken tabletop state when the designs were already validated', () => {
    const p = validateProject(starterProject());
    expect(() => validateProject({ ...p, instances: [...p.instances, { ...p.instances[0], componentId: 'missing' }] })).toThrow();
    expect(() => validateProject({ ...p, instances: p.instances.map((i, index) => index ? i : { ...i, holder: 'nobody' }) })).toThrow('Broken component or player reference.');
    expect(() => validateProject({ ...p, components: [...p.components, { ...p.components[0] }] })).toThrow('Duplicate identifiers in project.');
  });

  it('reuses unchanged components from a previous room update', () => {
    const p = starterProject();
    const copy = structuredClone(p.components);
    expect(shareComponents(p.components, copy)).toBe(p.components);
    copy[1] = { ...copy[1], name: 'Changed' };
    const shared = shareComponents(p.components, copy);
    expect(shared).not.toBe(p.components);
    expect(shared[0]).toBe(p.components[0]);
    expect(shared[1]).toBe(copy[1]);
  });
});
