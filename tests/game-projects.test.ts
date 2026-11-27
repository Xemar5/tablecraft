import { describe, expect, it } from 'vitest';
import { scopeOf, seatsCovered } from '../src/access';
import { applyCommand, projectSchema, validateProject, withGroupLocks, type Instance, type Project } from '../src/domain';
import { GAME_PROJECTS, gameProject } from '../src/gameProjects';
import { hasOpenFace } from '../src/ComponentView';
import { snapToGrid } from '../src/playgroundPreview';
import { snapOf, snapTarget } from '../src/grids';
import { checkScriptSyntax, scriptFunctions } from '../src/scripting';
import { TIDEWATER_SCRIPT } from '../src/tidewaterScript';
import { groupMembers } from '../src/pieceGroups';

const profile = { name: 'Tester', color: '#b7cc91' };
const build = (id: Parameters<typeof gameProject>[0]) => validateProject(projectSchema.parse(gameProject(id, 'Game', 'About the game', profile)));
const componentNamed = (project: Project, name: string) => project.components.find(component => component.name === name)!;
const piecesOf = (project: Project, name: string) => project.instances.filter(instance => instance.componentId === componentNamed(project, name).id);
const count = (project: Project, name: string, row?: number) => project.instances.filter(instance =>
  project.components.find(component => component.id === instance.componentId)?.name === name && (row === undefined || instance.row === row)).length;

describe('game projects', () => {
  it('builds every listed game as a valid project seated with the profile first', () => {
    for (const { id } of GAME_PROJECTS) {
      const project = build(id);
      expect(project.name).toBe('Game');
      expect(project.players[0]).toMatchObject({ name: 'Tester', color: '#b7cc91' });
      // The board is placed and locked (by its group), so pieces can be box-selected over it.
      expect(withGroupLocks(project).instances[0].locked).toBe(true);
    }
  });

  it('files every piece in a named group and locks the parts that never move', () => {
    const named = (project: Project, name: string) => {
      const group = (project.groups ?? []).find(item => item.name === name);
      expect(group, name).toBeDefined();
      return groupMembers(project, group!.id).map(id => project.instances.find(item => item.id === id)!);
    };
    const kind = (project: Project, id: string) => project.components.find(component => component.id === id)!.kind;
    const lockedGroups = (project: Project) => (project.groups ?? []).filter(group => group.locked).map(group => group.name);
    const heldByGroup = (project: Project, items: Instance[]) => {
      const playing = withGroupLocks(project);
      return items.every(item => !item.locked && playing.instances.find(other => other.id === item.id)!.locked);
    };
    for (const { id } of GAME_PROJECTS) {
      const project = build(id);
      expect(project.instances.every(item => item.group)).toBe(true);
      // Boards are held in place by their group's lock rather than their own, so unlocking the group frees them.
      expect(heldByGroup(project, project.instances.filter(item => kind(project, item.componentId) === 'board'))).toBe(true);
    }
    for (const id of ['chess', 'checkers', 'go'] as const) {
      const project = build(id);
      expect(lockedGroups(project)).toEqual(['Board']);
      expect(named(project, 'Board')).toHaveLength(1);
    }
    const chess = build('chess');
    expect([named(chess, 'White pieces').length, named(chess, 'Black pieces').length]).toEqual([16, 16]);
    expect(named(chess, 'White pieces').every(item => chess.components[1].rows[item.row].side === 'white' && !item.locked)).toBe(true);
    const checkers = build('checkers');
    expect([named(checkers, 'Light checkers').length, named(checkers, 'Dark checkers').length]).toEqual([12, 12]);
    const wildwood = build('wildwood');
    expect(lockedGroups(wildwood)).toEqual(['Clearing', 'Wanderer’s path']);
    expect([named(wildwood, 'Spirit cards').length, named(wildwood, 'Amber and die').length, named(wildwood, 'Wanderers').length]).toEqual([15, 14, 2]);
    const go = build('go');
    const black = named(go, 'Black stones');
    expect(black.filter(item => item.locked).map(item => go.components.find(component => component.id === item.componentId)!.name)).toEqual(['Stone bowl']);
    expect(black.filter(item => !item.locked)).toHaveLength(181);

    const tidewater = build('tidewater');
    expect(lockedGroups(tidewater)).toEqual(['Open sea', 'Island tiles', 'Tide markers', 'Harbors']);
    for (const name of ['Open sea', 'Island tiles', 'Tide markers', 'Harbors']) expect(heldByGroup(tidewater, named(tidewater, name)), name).toBe(true);
    expect([named(tidewater, 'Island tiles').length, named(tidewater, 'Tide markers').length, named(tidewater, 'Harbors').length]).toEqual([19, 18, 9]);
    // The squall moves during play; the unlocked island group holds it beside its locked subgroups.
    const playing = withGroupLocks(tidewater);
    expect(named(tidewater, 'Island').filter(item => !playing.instances.find(other => other.id === item.id)!.locked)
      .map(item => tidewater.components.find(component => component.id === item.componentId)!.name)).toEqual(['Squall']);
    // The locked island parts players read during play still show their hover preview.
    expect(tidewater.components.filter(component => component.previewWhenLocked).map(component => component.name)).toEqual(['Island tile', 'Tide marker', 'Harbor', 'Building costs', 'Scoreboard']);
    expect(named(tidewater, 'Supply').some(item => item.locked)).toBe(false);
    for (const { name } of [{ name: 'Crimson' }, { name: 'Azure' }, { name: 'Ivory' }, { name: 'Amber' }]) {
      const pieces = named(tidewater, `${name} pieces`);
      expect(pieces).toHaveLength(25);
      expect(pieces.filter(item => item.locked).map(item => tidewater.components.find(component => component.id === item.componentId)!.name)).toEqual(['Building costs']);
    }
  });

  it('sets up chess, checkers and go', () => {
    const chess = build('chess');
    expect(count(chess, 'Chess pieces')).toBe(32);
    expect([0, 1, 2, 3, 4, 5].map(row => count(chess, 'Chess pieces', row))).toEqual([1, 1, 2, 2, 2, 8]);
    expect(count(build('checkers'), 'Checker', 0)).toBe(12);
    expect(count(build('checkers'), 'Checker', 1)).toBe(12);
    const go = build('go');
    expect([count(go, 'Go stone', 0), count(go, 'Go stone', 1)]).toEqual([181, 180]);
    expect(new Set(go.instances.filter(instance => instance.stack).map(instance => instance.stack)).size).toBe(2);
  });

  it('lays out Tidewater Isles for four players', () => {
    const game = build('tidewater');
    expect(game.players).toHaveLength(4);
    const tiles = game.components.find(component => component.name === 'Island tile')!;
    const terrains = game.instances.filter(instance => instance.componentId === tiles.id).map(instance => tiles.rows[instance.row].terrain);
    expect([...terrains].sort()).toEqual(['clay', 'clay', 'clay', 'dunes', 'fish', 'fish', 'fish', 'fish', 'reed', 'reed', 'reed', 'reed', 'salt', 'salt', 'salt', 'salt', 'stone', 'stone', 'stone']);
    const markers = game.components.find(component => component.name === 'Tide marker')!;
    const numbers = game.instances.filter(instance => instance.componentId === markers.id).map(instance => Number(markers.rows[instance.row].number));
    expect([...numbers].sort((a, b) => a - b)).toEqual([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
    expect(count(game, 'Resource')).toBe(95);
    expect(count(game, 'Tide card')).toBe(25);
    expect([count(game, 'Hut'), count(game, 'Lighthouse'), count(game, 'Boardwalk'), count(game, 'Harbor'), count(game, 'Squall')]).toEqual([20, 16, 60, 9, 1]);
    expect(game.components.find(component => component.name === 'Tidewater rules')!.rows.length).toBeGreaterThan(3);
    // The top and bottom seats sit further out, so the cards fanned above their table hands (up to about 95 px
    // towards the table) stay clear of the pieces in front of them.
    expect(game.players.map(seat => [seat.x, seat.y])).toEqual([[980, 1060], [980, 40], [220, 550], [1740, 550]]);
    for (const [index, seat] of game.players.slice(0, 2).entries()) {
      const group = (game.groups ?? []).find(item => item.name === `${['Crimson', 'Azure'][index]} pieces`)!;
      const pieces = game.instances.filter(item => item.group === group.id);
      // Huts, lighthouses, boardwalks and the costs card reach at most 44 px from their centres towards the seat.
      expect(Math.min(...pieces.map(item => Math.abs(item.y - seat.y))) - 44).toBeGreaterThan(115);
    }
  });

  it('holds the laid-out island in place until its group is unlocked', () => {
    const game = build('tidewater');
    const tile = piecesOf(game, 'Island tile')[0], tiles = (game.groups ?? []).find(group => group.name === 'Island tiles')!;
    const move = (project: Project) => applyCommand(project, { type: 'move', ids: [tile.id], patch: { x: tile.x + 40 } });
    expect(() => move(game)).toThrow('Unlock its group first.');
    const moved = move(applyCommand(game, { type: 'lockGroups', ids: [tiles.id], locked: false }));
    expect(moved.instances.find(item => item.id === tile.id)!.x).toBe(tile.x + 40);
  });

  it('keeps boards, the island and reference pieces in their place in the order, under the pieces played on them', () => {
    const orderGroups = (project: Project) => (project.groups ?? []).filter(group => group.orderLocked).map(group => group.name);
    const orderPieces = (project: Project) =>
      [...new Set(project.instances.filter(item => item.orderLocked).map(item => project.components.find(c => c.id === item.componentId)!.name))];
    for (const id of ['chess', 'checkers', 'go'] as const) expect(orderGroups(build(id)), id).toEqual(['Board']);
    expect(orderPieces(build('go'))).toEqual(['Stone bowl']);
    expect(orderGroups(build('wildwood'))).toEqual(['Clearing', 'Wanderer’s path', 'Guide and controls']);
    const game = build('tidewater');
    expect(orderGroups(game)).toEqual(['Island', 'Controls']);
    expect(orderPieces(game)).toEqual(['Tidewater rules', 'Building costs']);
    // Picking up the squall (which raises the pieces picked up) leaves it under the huts and the table order as it was;
    // a hut still comes to the front.
    const squall = piecesOf(game, 'Squall')[0], hut = piecesOf(game, 'Hut')[0];
    const order = (project: Project) => project.instances.map(item => item.id);
    expect(order(applyCommand(game, { type: 'front', ids: [squall.id] }))).toEqual(order(game));
    expect(order(applyCommand(game, { type: 'front', ids: [hut.id] })).at(-1)).toBe(hut.id);
    expect(() => applyCommand(game, { type: 'zOrder', ids: [squall.id], move: 'front' })).toThrow('order is locked');
  });

  it("puts every tide marker, and the squall on the dunes, in its island tile's number slot", () => {
    const game = build('tidewater');
    const tile = componentNamed(game, 'Island tile'), slot = tile.front.find(node => node.name === 'Number slot')!;
    const offset = { x: slot.x + slot.width / 2 - tile.width / 2, y: slot.y + slot.height / 2 - tile.height / 2 };
    // The slot sits below the art and the resource name, clear of every layer but the tile outline and its own well.
    expect(offset.x).toBe(0);
    expect(offset.y).toBeGreaterThan(15);
    for (const node of tile.front.filter(node => !node.name.startsWith('Number slot') && node.shapeKind !== 'path')) expect(node.y + node.height, node.name).toBeLessThanOrEqual(slot.y);
    const slotted = [...piecesOf(game, 'Tide marker'), ...piecesOf(game, 'Squall')];
    const tiles = piecesOf(game, 'Island tile');
    for (const piece of tiles) {
      const inSlot = slotted.filter(item => item.x === piece.x + offset.x && item.y === piece.y + offset.y);
      expect(inSlot).toHaveLength(1);
      expect(inSlot[0].componentId === componentNamed(game, 'Squall').id).toBe(tile.rows[piece.row].terrain === 'dunes');
    }
    expect(slotted).toHaveLength(tiles.length);
  });

  it('turns each harbor pier out to sea, flush against a coastal edge with its posts on the two corners it serves', () => {
    const game = build('tidewater');
    const harbor = componentNamed(game, 'Harbor'), tiles = piecesOf(game, 'Island tile'), harbors = piecesOf(game, 'Harbor');
    // An open face shaped by its layers, not a round token.
    expect(harbor.kind).toBe('card');
    expect(hasOpenFace(harbor)).toBe(true);
    const corners = (tile: Instance) => [[0, -56], [48.5, -28], [48.5, 28], [0, 56], [-48.5, 28], [-48.5, -28]].map(([x, y]) => ({ x: tile.x + x, y: tile.y + y }));
    const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < .5;
    const posts = harbor.front.filter(node => node.name.endsWith('corner post'));
    expect(posts).toHaveLength(2);
    const served = new Set<string>();
    for (const piece of harbors) {
      const turn = piece.rotation * Math.PI / 180;
      const [left, right] = posts.map(post => {
        const x = post.x + post.width / 2 - harbor.width / 2, y = post.y + post.height / 2 - harbor.height / 2;
        return { x: piece.x + x * Math.cos(turn) - y * Math.sin(turn), y: piece.y + x * Math.sin(turn) + y * Math.cos(turn) };
      });
      // Both posts sit on corners of one tile, so the pier spans exactly one of its edges...
      const tile = tiles.find(item => [left, right].every(post => corners(item).some(corner => near(corner, post))));
      expect(tile, harbor.rows[piece.row].name).toBeDefined();
      const middle = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
      expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeCloseTo(56, 0);
      // ...a coastal edge, with no tile across it...
      const across = { x: 2 * middle.x - tile!.x, y: 2 * middle.y - tile!.y };
      expect(tiles.some(item => near(item, across))).toBe(false);
      // ...and the pier reaches out from it, away from the tile.
      expect(Math.hypot(piece.x - tile!.x, piece.y - tile!.y)).toBeGreaterThan(Math.hypot(middle.x - tile!.x, middle.y - tile!.y));
      for (const post of [left, right]) {
        const key = `${Math.round(post.x)},${Math.round(post.y)}`;
        expect(served.has(key), 'no two harbors share a corner').toBe(false);
        served.add(key);
      }
    }
    expect(harbors).toHaveLength(9);
    // They are spread around the island: every sixth of the way round has one or two.
    const sectors = harbors.map(piece => Math.floor(((Math.atan2(piece.y - 550, piece.x - 980) * 180 / Math.PI) + 360) % 360 / 60));
    for (let sector = 0; sector < 6; sector++) expect(sectors.filter(item => item === sector).length).toBeGreaterThanOrEqual(1);
  });

  it('turns pieces in steps that suit each game', () => {
    const steps = (project: Project) => Object.fromEntries(project.components.filter(component => component.rotationStep).map(component => [component.name, component.rotationStep]));
    expect(steps(build('chess'))).toEqual({ 'Chess board': 180, 'Chess pieces': 180 });
    expect(steps(build('checkers'))).toEqual({ 'Checkers board': 180 });
    expect(steps(build('go'))).toEqual({});
    const game = build('tidewater');
    expect(steps(game)).toEqual({ 'Island tile': 60, Harbor: 60, Hut: 30, Lighthouse: 30, Boardwalk: 60 });
    // Hex pieces start on angles their steps keep on the grid: tiles upright, harbors and boardwalks along tile edges.
    const angle = (value: number) => ((value % 360) + 360) % 360;
    expect(piecesOf(game, 'Island tile').every(item => angle(item.rotation) % 60 === 0)).toBe(true);
    for (const name of ['Harbor', 'Boardwalk']) expect(piecesOf(game, name).every(item => angle(item.rotation) % 60 === 30), name).toBe(true);
    // Huts and lighthouses face their seat, which a 30 degree step reaches from any angle.
    for (const name of ['Hut', 'Lighthouse']) expect(piecesOf(game, name).every(item => angle(item.rotation) % 30 === 0), name).toBe(true);
  });

  it('keeps every starting pile as a persistent stack, which stays on the table once it runs out', () => {
    const piles = (project: Project) => new Set(project.instances.flatMap(item => item.stack ? [item.stack] : []));
    for (const { id } of GAME_PROJECTS) {
      const project = build(id);
      expect((project.stacks ?? []).map(record => record.id).sort(), id).toEqual([...piles(project)].sort());
      for (const record of project.stacks ?? []) {
        const bottom = project.instances.filter(item => item.stack === record.id).sort((a, b) => a.order - b.order)[0];
        expect(record).toMatchObject({ tag: '', x: bottom.x, y: bottom.y, rotation: bottom.rotation, componentId: bottom.componentId });
        // Its filter takes its own component's stack tags, so an empty pile only takes its own kind back.
        const tags = project.components.find(component => component.id === bottom.componentId)!.stackTags ?? [];
        expect(record.filter, record.id).toEqual({ anyOf: tags.map(tag => ({ has: [tag], lacks: [] })) });
      }
    }
    expect([build('chess'), build('checkers')].map(project => project.stacks)).toEqual([undefined, undefined]);
    expect(build('wildwood').stacks!.map(record => record.id)).toEqual(['starter-deck', 'amber-supply']);
    expect(build('go').stacks).toHaveLength(2);
    // Tidewater: five resource piles, the tide card deck, and a hut, lighthouse and boardwalk pile per player.
    const game = build('tidewater');
    expect(game.stacks).toHaveLength(5 + 1 + 4 * 3);
    // Building every hut leaves the pile behind as an empty slot, which takes huts back.
    const huts = piecesOf(game, 'Hut').filter(item => item.stack === piecesOf(game, 'Hut')[0].stack).sort((a, b) => b.order - a.order);
    let next = game;
    huts.forEach((item, index) => { next = applyCommand(next, { type: 'extractMove', id: item.id, x: 980 + index * 30, y: 550 }); });
    const slot = next.stacks!.find(record => record.id === huts[0].stack)!;
    expect(next.instances.some(item => item.stack === slot.id)).toBe(false);
    expect(slot).toMatchObject({ x: huts[0].x, y: huts[0].y });
    next = applyCommand(next, { type: 'dropIntoStack', ids: [huts[0].id], stackId: slot.id });
    expect(next.instances.find(item => item.id === huts[0].id)).toMatchObject({ stack: slot.id, x: slot.x, y: slot.y });
    expect(() => applyCommand(next, { type: 'dropIntoStack', ids: [piecesOf(game, 'Lighthouse')[0].id], stackId: slot.id })).toThrow();
  });

  it("snaps Tidewater's tide markers and the squall to the tiles' number slots, and nothing else to them", () => {
    const game = build('tidewater');
    const slots = game.grids!.find(grid => grid.id === 'grid-slots')!;
    const tiles = piecesOf(game, 'Island tile');
    expect(slots.points).toHaveLength(tiles.length);
    // Every marker and the squall start snapped to a slot.
    for (const piece of [...piecesOf(game, 'Tide marker'), ...piecesOf(game, 'Squall')]) expect(snapOf(game, piece)?.grid).toBe('grid-slots');
    // Dropped near a slot, the squall lands on it; huts and resources ignore the slots.
    const point = slots.points![4];
    expect(snapTarget(game, componentNamed(game, 'Squall'), point.x + 12, point.y - 10)).toMatchObject({ grid: 'grid-slots', point: point.id, x: point.x, y: point.y });
    expect(snapTarget(game, componentNamed(game, 'Hut'), point.x, point.y)?.grid).not.toBe('grid-slots');
    expect(snapTarget(game, componentNamed(game, 'Resource'), point.x, point.y)).toBeUndefined();
  });

  describe("Tidewater's rules script", () => {
    const errors = (p: Project) => (p.scriptLog ?? []).filter(line => line.level === 'error').map(line => line.text);
    const hand = (p: Project, seat: number) => p.instances.filter(item => item.holder === p.players[seat].id)
      .map(item => p.components.find(c => c.id === item.componentId)!.rows[item.row].terrain).sort();
    const near = (a: { x: number; y: number }, b: { x: number; y: number }, distance: number, slack: number) => Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - distance) < slack;
    const terrainOf = (p: Project, item: Instance) => componentNamed(p, 'Island tile').rows[item.row].terrain;
    /** Tiles around a corner point that produce a resource. */
    const tilesAt = (p: Project, at: { x: number; y: number }) => piecesOf(p, 'Island tile').filter(tile => near(tile, at, 56, 1) && terrainOf(p, tile) !== 'dunes');
    const markerOn = (p: Project, tile: Instance) => piecesOf(p, 'Tide marker').filter(item => Math.hypot(item.x - tile.x, item.y - tile.y) < 45);
    const numberOn = (p: Project, tile: Instance) => {
      const [marker] = markerOn(p, tile);
      return marker ? Number(componentNamed(p, 'Tide marker').rows[marker.row].number) : undefined;
    };
    const call = (name: string, seed: number): Parameters<typeof applyCommand>[1] => ({ type: 'call', name, args: [], seed });
    /** The popups of a popup component, and who each is for. */
    const popupsOf = (p: Project, name: string) => (p.popups ?? []).filter(popup => popup.componentId === componentNamed(p, name).id);
    /** The latest note in the corner for a seat. */
    const notice = (p: Project, seat = p.players[0].id) => popupsOf(p, 'Notice').filter(popup => (!popup.to || popup.to.includes(seat)) && !popup.closed?.includes(seat)).at(-1)?.data;
    /** Clicks a layer of the open Game setup popup, as the host. */
    const choose = (p: Project, layer: string, seed = 1) =>
      applyCommand(p, { type: 'call', name: 'gameSetup', popup: popupsOf(p, 'Game setup')[0].id, args: [layer, [layer]], seed }, p.players[0].id);
    const colorOf = (p: Project, item: Instance) => p.components.find(c => c.id === item.componentId)!.rows[item.row].color;
    /** Moves the top piece of a colour's pile of a component to a point, as a seat. */
    const placeFrom = (p: Project, component: string, color: string, at: { x: number; y: number }, seat: string) => {
      const top = piecesOf(p, component).filter(item => item.stack === `${component.toLowerCase()}-${color}`).sort((a, b) => b.order - a.order)[0];
      return { p: applyCommand(p, { type: 'extractMove', id: top.id, x: at.x, y: at.y }, seat), id: top.id };
    };
    const corners = (p: Project) => p.grids!.find(grid => grid.id === 'grid-corners')!.points!;
    /** The edge points of the island beside a corner. */
    const edgesBeside = (p: Project, at: { x: number; y: number }) =>
      p.grids!.find(grid => grid.id === 'grid-edges')!.points!.filter(point => Math.abs(Math.hypot(point.x - at.x, point.y - at.y) - 28) < 1);
    /** A comparable picture of the island: each tile's terrain and number, and the harbors' rows, by position. */
    const islandOf = (p: Project) => ({
      tiles: piecesOf(p, 'Island tile').map(tile => `${tile.x},${tile.y} ${terrainOf(p, tile)} ${numberOn(p, tile) ?? '-'}`).sort(),
      harbors: piecesOf(p, 'Harbor').map(item => `${item.x},${item.y} ${item.row}`).sort(),
    });
    const COLORS = ['crimson', 'azure', 'ivory', 'amber'];
    /**
     * Corners for every colour's two huts, all far enough apart that no two share a tile: the first round's, and the
     * second round's (those touching the most producing tiles).
     */
    const hutSpots = (p: Project) => {
      const chosen: { x: number; y: number }[] = [];
      for (const corner of corners(p)) if (chosen.length < 8 && chosen.every(other => Math.hypot(other.x - corner.x, other.y - corner.y) > 113)) chosen.push(corner);
      expect(chosen).toHaveLength(8);
      chosen.sort((a, b) => tilesAt(p, b).length - tilesAt(p, a).length);
      return { first: chosen.slice(4), second: chosen.slice(0, 4) };
    };
    /** Places a seat's hut on a corner and a boardwalk beside it. */
    const placePair = (p: Project, index: number, corner: { x: number; y: number }) => {
      const seat = p.players[index].id;
      p = placeFrom(p, 'Hut', COLORS[index], corner, seat).p;
      return placeFrom(p, 'Boardwalk', COLORS[index], edgesBeside(p, corner)[0], seat).p;
    };
    /** The beginner island, dice on the button (unless `auto`), through the setup rounds into the game. */
    const playing = (auto = false) => {
      let p = choose(choose(build('tidewater'), 'Beginner island'), auto ? 'Automatic dice' : 'Dice button');
      p = choose(p, 'Start placing');
      const spots = hutSpots(p);
      for (const index of [0, 1, 2, 3]) p = placePair(p, index, spots.first[index]);
      for (const index of [3, 2, 1, 0]) p = placePair(p, index, spots.second[index]);
      return { p, spots };
    };

    it('is valid Lua with the buttons, popups and events it promises, and starts in its setup phase', () => {
      expect(checkScriptSyntax(TIDEWATER_SCRIPT)).toBeUndefined();
      const game = build('tidewater');
      expect(scriptFunctions(game.scripts)).toEqual(expect.arrayContaining(['openSetup', 'gameSetup', 'rollDice']));
      for (const event of ['onTurnStart', 'onSnap', 'onMove', 'onMemoryChanged']) expect(TIDEWATER_SCRIPT).toMatch(new RegExp(`^function ${event}\\(`, 'm'));
      expect(game.memory).toMatchObject({ colors: COLORS, phase: 'setup', host: game.players[0].id, randomIsland: true, goal: 10, autoRoll: true, round: 0 });
      expect(componentNamed(game, 'Game setup button')).toMatchObject({ kind: 'button', action: 'openSetup' });
      expect(componentNamed(game, 'Roll dice')).toMatchObject({ kind: 'button', action: 'rollDice' });
      expect(game.components.filter(item => item.kind === 'popup').map(item => item.name)).toEqual(['Game setup', 'Notice', 'Status', 'Victory']);
      expect(componentNamed(game, 'Game setup')).toMatchObject({ action: 'gameSetup' });
      // The host sees Game setup as soon as the table opens; the others see whom they're waiting for.
      expect(popupsOf(game, 'Game setup').map(popup => popup.to)).toEqual([[game.players[0].id]]);
      expect(popupsOf(game, 'Status')).toMatchObject([{ to: game.players.slice(1).map(seat => seat.id), data: { text: `Waiting for ${game.players[0].name} to choose the settings and deal the island.` } }]);
    });

    it('lets the host deal a shuffled island, deal it again or go back to the beginner island, and choose the goal and dice', () => {
      const game = build('tidewater'), beginner = islandOf(game);
      const red = (p: Project, tile: Instance) => [6, 8].includes(numberOn(p, tile) ?? 0);
      const shuffled = [3, 4].map(seed => choose(game, 'Random island', seed));
      for (const p of shuffled) {
        expect(errors(p)).toEqual([]);
        const island = islandOf(p);
        expect(island).not.toEqual(beginner);
        // The same tiles, numbers and harbors in other places.
        const parts = (list: string[], at: number) => list.map(line => line.split(' ')[at]).sort();
        for (const at of [1, 2]) expect(parts(island.tiles, at)).toEqual(parts(beginner.tiles, at));
        expect(parts(island.harbors, 1)).toEqual(parts(beginner.harbors, 1));
        // A marker on every tile but the dunes, which has the squall in its slot; no 6 or 8 beside another.
        const tiles = piecesOf(p, 'Island tile');
        for (const tile of tiles) expect(markerOn(p, tile)).toHaveLength(terrainOf(p, tile) === 'dunes' ? 0 : 1);
        const dunes = tiles.find(tile => terrainOf(p, tile) === 'dunes')!, squall = piecesOf(p, 'Squall')[0];
        expect([squall.x, squall.y]).toEqual([dunes.x, dunes.y + 23]);
        for (const a of tiles) for (const b of tiles) if (a !== b && red(p, a) && red(p, b)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(100);
        // The tide markers' group is locked again.
        expect(p.groups!.find(group => group.name === 'Tide markers')!.locked).toBe(true);
        expect(p.memory).toMatchObject({ randomIsland: true, shuffled: true });
      }
      expect(islandOf(shuffled[0])).not.toEqual(islandOf(shuffled[1]));
      expect(islandOf(choose(shuffled[0], 'Shuffle island', 9))).not.toEqual(islandOf(shuffled[0]));
      const back = choose(shuffled[0], 'Beginner island');
      expect(errors(back)).toEqual([]);
      expect(islandOf(back)).toEqual(beginner);
      expect(back.memory).toMatchObject({ randomIsland: false, shuffled: false });
      // The goal goes from 5 to 15; the dice roll by themselves or with the button.
      let p = game;
      for (let n = 0; n < 7; n++) p = choose(p, 'Fewer points');
      expect(p.memory!.goal).toBe(5);
      p = choose(choose(p, 'More points'), 'Dice button');
      expect(p.memory).toMatchObject({ goal: 6, autoRoll: false });
      // Starting with a random island that was never shuffled shuffles it first.
      const started = choose(game, 'Start placing');
      expect(errors(started)).toEqual([]);
      expect(islandOf(started)).not.toEqual(beginner);
      expect(popupsOf(started, 'Game setup')).toEqual([]);
    });

    it('runs the setup rounds in turn order and back, sending back what is placed out of turn or in the wrong place', () => {
      let p = choose(choose(build('tidewater'), 'Beginner island'), 'Dice button');
      p = choose(p, 'Start placing');
      const ids = p.players.map(seat => seat.id), names = p.players.map(seat => seat.name);
      expect(errors(p)).toEqual([]);
      expect(p.memory).toMatchObject({ phase: 'placing', step: 1, order: [...ids, ...[...ids].reverse()] });
      expect(p.settings.turn).toBe(0);
      expect(popupsOf(p, 'Status').map(popup => [popup.to, popup.data!.text])).toEqual([
        [ids.slice(1), `${names[0]} is placing their first hut and boardwalk.`],
        [[ids[0]], 'Your turn: place your first hut on a corner of the island, then a boardwalk beside it.'],
      ]);
      const spots = hutSpots(p);
      const backInPile = (project: Project, id: string, pile: string) => expect(project.instances.find(item => item.id === id)!.stack).toBe(pile);
      // Azure places out of turn: the hut goes back to its pile, with a note for Azure only.
      const early = placeFrom(p, 'Hut', 'azure', spots.first[1], ids[1]);
      expect(errors(early.p)).toEqual([]);
      backInPile(early.p, early.id, 'hut-azure');
      expect(notice(early.p, ids[1])).toEqual({ title: 'Not there', text: `It's ${names[0]}'s turn to place a hut and a boardwalk.` });
      expect(notice(early.p, ids[0])!.title).toBe('The setup rounds');
      // A boardwalk before the hut, then one away from the new hut, go back too.
      const walkFirst = placeFrom(p, 'Boardwalk', 'crimson', edgesBeside(p, spots.first[0])[0], ids[0]);
      backInPile(walkFirst.p, walkFirst.id, 'boardwalk-crimson');
      expect(notice(walkFirst.p)!.text).toBe('Place your hut first, then the boardwalk beside it.');
      p = placeFrom(p, 'Hut', 'crimson', spots.first[0], ids[0]).p;
      expect(p.memory!.stepHut).toBeDefined();
      const away = placeFrom(p, 'Boardwalk', 'crimson', edgesBeside(p, spots.first[1])[0], ids[0]);
      backInPile(away.p, away.id, 'boardwalk-crimson');
      expect(notice(away.p)!.text).toBe('The boardwalk goes on an edge beside the hut you just placed.');
      // The pair is placed: it's locked, and Azure is next.
      p = placeFrom(p, 'Boardwalk', 'crimson', edgesBeside(p, spots.first[0])[0], ids[0]).p;
      expect(errors(p)).toEqual([]);
      expect(p.memory).toMatchObject({ step: 2 });
      expect(p.settings.turn).toBe(1);
      expect(p.instances.filter(item => p.memory!.placedPieces && (p.memory!.placedPieces as string[]).includes(item.id)).map(item => item.locked)).toEqual([true, true]);
      // Azure's hut on a corner next to Crimson's goes back.
      const crowding = corners(p).find(corner => near(corner, spots.first[0], 56, 1))!;
      const close = placeFrom(p, 'Hut', 'azure', crowding, ids[1]);
      backInPile(close.p, close.id, 'hut-azure');
      expect(notice(close.p, ids[1])!.text).toBe('Too close: no hut may stand on a corner next to another hut.');
      // Ending the turn doesn't skip a placement: the turn goes back to Azure.
      const skipped = applyCommand(p, { type: 'endTurn' }, ids[1]);
      expect(errors(skipped)).toEqual([]);
      expect(skipped.settings.turn).toBe(1);
      // Lighthouses wait for the game.
      const tower = placeFrom(p, 'Lighthouse', 'azure', spots.first[1], ids[1]);
      backInPile(tower.p, tower.id, 'lighthouse-azure');
    });

    it('begins the game after the last placement, with starting resources for the second huts', () => {
      const { p, spots } = playing();
      expect(errors(p)).toEqual([]);
      expect(p.memory).toMatchObject({ phase: 'playing', round: 1, points: { crimson: 2, azure: 2, ivory: 2, amber: 2 } });
      expect(p.settings.turn).toBe(0);
      // The placed pieces are free to move again, and the banner is gone.
      expect(p.instances.filter(item => (p.memory!.placedPieces as string[]).includes(item.id)).every(item => !item.locked)).toBe(true);
      expect(popupsOf(p, 'Status')).toEqual([]);
      // One resource for each tile touching each seat's second hut.
      for (const index of [0, 1, 2, 3]) expect(hand(p, index)).toEqual(tilesAt(p, spots.second[index]).map(tile => terrainOf(p, tile)).sort());
      expect(notice(p)).toMatchObject({ title: 'The game begins' });
      expect(notice(p)!.text).toMatch(new RegExp(`^Starting resources: ${p.players[0].name} takes .*\\. First to 10 points wins\\.$`));
    });

    it('hands out resources for the huts beside the tiles showing the roll, and warns about the squall on a 7', () => {
      const { p: started, spots } = playing();
      const seat = started.players[0].id, before = hand(started, 0).length;
      const rolls = new Map<number, Project>();
      for (let seed = 1; seed < 400 && rolls.size < 11; seed++) {
        const rolled = applyCommand(started, call('rollDice', seed), seat);
        const total = rolled.memory!.lastRoll as number;
        if (!rolls.has(total)) rolls.set(total, rolled);
      }
      expect([...rolls.keys()].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      for (const [total, rolled] of rolls) {
        expect(errors(rolled), String(total)).toEqual([]);
        const expected = total === 7 ? 0 : [spots.first[0], spots.second[0]].flatMap(at => tilesAt(started, at)).filter(tile => numberOn(started, tile) === total).length;
        expect(hand(rolled, 0).length - before, `roll ${total}`).toBe(expected);
        expect(notice(rolled, started.players[2].id)!.title).toMatch(new RegExp(`^${started.players[0].name} rolled ${total} \\(\\d \\+ \\d\\)`));
        // Only the latest note stays open.
        expect(popupsOf(rolled, 'Notice')).toHaveLength(1);
      }
      expect(notice(rolls.get(7)!)).toMatchObject({ title: expect.stringMatching(/: the squall!$/), text: expect.stringMatching(/^Move the squall to another tile/) });
    });

    it("shows only the buttons that apply: Game setup before the setup rounds, Roll dice in the game while the dice don't roll by themselves", () => {
      // The seats a piece is hidden from now (hidden from everyone, or from some seats).
      const hiddenFrom = (p: Project, name: string) => seatsCovered(scopeOf(piecesOf(p, name)[0], 'hide'), p.players.map(player => player.id));
      const everyone = (p: Project) => p.players.map(player => player.id);
      const game = build('tidewater');
      expect([hiddenFrom(game, 'Game setup button'), hiddenFrom(game, 'Roll dice')]).toEqual([[], everyone(game)]);
      const placing = choose(game, 'Start placing');
      expect([hiddenFrom(placing, 'Game setup button'), hiddenFrom(placing, 'Roll dice')]).toEqual([everyone(game), everyone(game)]);
      const manual = playing().p;
      expect([hiddenFrom(manual, 'Game setup button'), hiddenFrom(manual, 'Roll dice')]).toEqual([everyone(manual), []]);
      // Turning autoRoll on in memory hides Roll dice again; with it on from the start, Roll dice never shows.
      const auto = applyCommand(manual, { type: 'memory', changes: [{ path: ['autoRoll'], value: true }] }, manual.players[0].id);
      expect(errors(auto)).toEqual([]);
      expect(hiddenFrom(auto, 'Roll dice')).toEqual(everyone(auto));
      const automatic = playing(true).p;
      expect(hiddenFrom(automatic, 'Roll dice')).toEqual(everyone(automatic));
      // Game setup (the button) opens the popup again for whoever presses it, who becomes the host.
      const closed = { ...game, popups: [] };
      const reopened = applyCommand(closed, { type: 'call', name: 'openSetup', piece: piecesOf(game, 'Game setup button')[0].id, args: [], seed: 1 }, game.players[1].id);
      expect(errors(reopened)).toEqual([]);
      expect(popupsOf(reopened, 'Game setup').map(popup => popup.to)).toEqual([[game.players[1].id]]);
      expect(reopened.memory!.host).toBe(game.players[1].id);
    });

    it('rolls by itself when a turn starts once the game is on, names the players beside the squall, and declares the winner', () => {
      const { p: started, spots } = playing(true);
      // Beginning rolls for the first player straight away.
      expect(notice(started)!.text).toMatch(new RegExp(`${started.players[0].name} rolled \\d+ \\(\\d \\+ \\d\\)`));
      const next = applyCommand(started, { type: 'endTurn' }, started.players[0].id);
      expect(errors(next)).toEqual([]);
      expect(notice(next)!.title).toMatch(new RegExp(`^${next.players[1].name} rolled \\d+`));
      // Moving the squall onto a tile beside Crimson's second hut names Crimson.
      // (Huts stand well apart, so no other colour's hut touches that tile.)
      const squall = piecesOf(next, 'Squall')[0], target = tilesAt(next, spots.second[0]).find(tile => Math.hypot(tile.x - squall.x, tile.y - squall.y) > 60)!;
      const slot = next.grids!.find(grid => grid.id === 'grid-slots')!.points!.find(point => Math.hypot(point.x - target.x, point.y - target.y) < 45)!;
      const moved = applyCommand(next, { type: 'move', ids: [squall.id], patch: { x: slot.x, y: slot.y } }, next.players[1].id);
      expect(notice(moved)).toEqual({ title: `The squall settles on the ${componentNamed(next, 'Island tile').rows[target.row].name}`, text: `${next.players[1].name} takes a random card from ${next.players[0].name}.` });
      // With the goal at 3, a third crimson hut wins the game.
      const lowered = applyCommand(next, { type: 'memory', changes: [{ path: ['goal'], value: 3 }] }, next.players[0].id);
      const free = corners(lowered).find(corner => [...spots.first, ...spots.second].every(at => Math.hypot(at.x - corner.x, at.y - corner.y) > 100))!;
      const won = placeFrom(lowered, 'Hut', 'crimson', free, next.players[0].id).p;
      expect(errors(won)).toEqual([]);
      expect(won.memory!.winner).toBe('crimson');
      expect(popupsOf(won, 'Victory')).toMatchObject([{ data: { name: next.players[0].name } }]);
      expect(colorOf(won, won.instances.find(item => item.x === free.x && item.y === free.y)!)).toBe('crimson');
    });
  });

  it('gives every component with a transparent background a back design, so no printed back comes out blank', () => {
    const backless: string[] = [];
    // Popups show on screen and are never printed.
    for (const { id } of GAME_PROJECTS) for (const component of build(id).components.filter(item => hasOpenFace(item) && item.kind !== 'popup')) {
      // Every variant shows something on its back.
      const rows = component.rows.length ? component.rows : [{}];
      const shown = rows.every(row => component.back.some(node => !node.visibilityField || (row as Record<string, string>)[node.visibilityField] === node.visibilityValue));
      if (!shown) backless.push(`${id}: ${component.name}`);
    }
    expect(backless).toEqual([]);
  });

  it('treats only fully transparent backgrounds as open faces shaped by their layers', () => {
    for (const color of ['transparent', '', '#0000', '#12345600', 'rgba(1, 2, 3, 0)', 'hsla(0 0% 0% / 0)']) expect(hasOpenFace({ color })).toBe(true);
    for (const color of ['#fff', '#e9e5d7', '#12345601', 'rgba(1, 2, 3, .5)', 'white']) expect(hasOpenFace({ color })).toBe(false);
    const tiles = gameProject('tidewater', 'Game', '', profile).components.find(component => component.name === 'Island tile')!;
    expect(hasOpenFace(tiles)).toBe(true);
  });

  it('turns on a snapping grid lined up with the squares or crossings of square boards only', () => {
    for (const [id, piece, size] of [['chess', 'Chess pieces', 60], ['checkers', 'Checker', 60], ['go', 'Go stone', 30]] as const) {
      const game = build(id);
      expect(game.settings).toMatchObject({ grid: true, snap: true, gridSize: size });
      const { gridOffsetX = 0, gridOffsetY = 0 } = game.settings;
      const board = game.instances.find(instance => game.components.find(component => component.id === instance.componentId)?.kind === 'board')!;
      // Every square centre (or line crossing) on the board is a snap point, and the starting pieces sit on them.
      for (const step of [0, 1, 7]) {
        const x = board.x - (id === 'go' ? 270 : 210) + step * size, y = board.y - (id === 'go' ? 270 : 210) + step * size;
        expect([snapToGrid(x, size, gridOffsetX), snapToGrid(y, size, gridOffsetY)]).toEqual([x, y]);
      }
      const placed = game.instances.filter(instance => !instance.stack && game.components.find(component => component.id === instance.componentId)?.name === piece);
      for (const instance of placed) expect([snapToGrid(instance.x, size, gridOffsetX), snapToGrid(instance.y, size, gridOffsetY)]).toEqual([instance.x, instance.y]);
    }
    expect(build('tidewater').settings).toMatchObject({ grid: false, snap: false });
  });

  it('snaps to grid points at the offset plus whole cells', () => {
    expect(snapToGrid(77, 60, 50)).toBe(50);
    expect(snapToGrid(81, 60, 50)).toBe(110);
    expect(snapToGrid(-31, 60, 50)).toBe(-10);
    expect(snapToGrid(13, 25)).toBe(25);
  });
});
