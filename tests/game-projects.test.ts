import { describe, expect, it } from 'vitest';
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
    for (const id of ['chess', 'checkers', 'backgammon', 'go'] as const) {
      const project = build(id);
      expect(lockedGroups(project)).toEqual(['Board']);
      expect(named(project, 'Board')).toHaveLength(1);
    }
    const chess = build('chess');
    expect([named(chess, 'White pieces').length, named(chess, 'Black pieces').length]).toEqual([16, 16]);
    expect(named(chess, 'White pieces').every(item => chess.components[1].rows[item.row].side === 'white' && !item.locked)).toBe(true);
    const checkers = build('checkers');
    expect([named(checkers, 'Light checkers').length, named(checkers, 'Dark checkers').length]).toEqual([12, 12]);
    const backgammon = build('backgammon');
    expect([named(backgammon, 'Light checkers').length, named(backgammon, 'Dark checkers').length, named(backgammon, 'Dice and doubling cube').length]).toEqual([15, 15, 3]);
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

  it('sets up chess, checkers, backgammon and go', () => {
    const chess = build('chess');
    expect(count(chess, 'Chess pieces')).toBe(32);
    expect([0, 1, 2, 3, 4, 5].map(row => count(chess, 'Chess pieces', row))).toEqual([1, 1, 2, 2, 2, 8]);
    expect(count(build('checkers'), 'Checker', 0)).toBe(12);
    expect(count(build('checkers'), 'Checker', 1)).toBe(12);
    const backgammon = build('backgammon');
    expect([count(backgammon, 'Backgammon checker', 0), count(backgammon, 'Backgammon checker', 1), count(backgammon, 'Die')]).toEqual([15, 15, 2]);
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
    expect(steps(build('backgammon'))).toEqual({ 'Backgammon board': 180, 'Doubling cube': 180 });
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
    expect([build('chess'), build('checkers'), build('backgammon')].map(project => project.stacks)).toEqual([undefined, undefined, undefined]);
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

  it('snaps backgammon checkers to spots along the points and on the bar', () => {
    const game = build('backgammon');
    const spots = game.grids!.find(grid => grid.id === 'grid-spots')!;
    expect(spots.points).toHaveLength(24 * 5 + 2 * 5);
    // The starting checkers all sit on spots.
    for (const piece of piecesOf(game, 'Backgammon checker')) expect(snapOf(game, piece)?.grid).toBe('grid-spots');
    const checker = componentNamed(game, 'Backgammon checker'), first = spots.points![0];
    expect(snapTarget(game, checker, first.x + 15, first.y + 10)).toMatchObject({ point: first.id, x: first.x, y: first.y });
    // Far from every spot (the bear-off tray), and for the dice and cube, nothing snaps.
    expect(snapTarget(game, checker, 980 + 330, 550)).toBeUndefined();
    for (const name of ['Die', 'Doubling cube', 'Backgammon board']) expect(snapTarget(game, componentNamed(game, name), first.x, first.y), name).toBeUndefined();
  });

  describe("Tidewater's rules script", () => {
    const announcements = (p: Project) => (p.scriptLog ?? []).filter(line => line.level === 'announce').map(line => line.text);
    const errors = (p: Project) => (p.scriptLog ?? []).filter(line => line.level === 'error').map(line => line.text);
    const hand = (p: Project, seat: number) => p.instances.filter(item => item.holder === p.players[seat].id)
      .map(item => p.components.find(c => c.id === item.componentId)!.rows[item.row].terrain).sort();
    const near = (a: { x: number; y: number }, b: { x: number; y: number }, distance: number, slack: number) => Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - distance) < slack;
    const terrainOf = (p: Project, item: Instance) => componentNamed(p, 'Island tile').rows[item.row].terrain;
    /** Tiles around a corner point that produce a resource. */
    const tilesAt = (p: Project, at: { x: number; y: number }) => piecesOf(p, 'Island tile').filter(tile => near(tile, at, 56, 1) && terrainOf(p, tile) !== 'dunes');
    const numberOn = (p: Project, tile: Instance) => {
      const marker = piecesOf(p, 'Tide marker').find(item => Math.hypot(item.x - tile.x, item.y - tile.y) < 45);
      return marker ? Number(componentNamed(p, 'Tide marker').rows[marker.row].number) : undefined;
    };
    const call = (name: string, seed: number): Parameters<typeof applyCommand>[1] => ({ type: 'call', name, args: [], seed });
    /** Moves the top piece of a colour's pile of a component to a point. */
    const placeFrom = (p: Project, component: string, color: string, at: { x: number; y: number }) => {
      const top = piecesOf(p, component).filter(item => item.stack && p.components.find(c => c.id === item.componentId)!.rows[item.row].color === color)
        .sort((a, b) => b.order - a.order)[0];
      return { p: applyCommand(p, { type: 'extractMove', id: top.id, x: at.x, y: at.y }), id: top.id };
    };
    /** The edge points of the island beside a corner. */
    const edgesBeside = (p: Project, at: { x: number; y: number }) =>
      p.grids!.find(grid => grid.id === 'grid-edges')!.points!.filter(point => Math.abs(Math.hypot(point.x - at.x, point.y - at.y) - 28) < 1);
    // Crimson (seat 1) builds two huts on corners of the island, the second on a corner between three producing tiles.
    // The other seats haven't set up, so these games skip Start game's setup check.
    const setup = () => {
      let p = build('tidewater');
      p = { ...p, memory: { ...p.memory, autoRoll: false, checkSetup: false } };
      const corners = p.grids!.find(grid => grid.id === 'grid-corners')!.points!;
      const inland = corners.filter(point => tilesAt(p, point).length === 3);
      const [first, second] = [inland[0], inland.find(point => Math.hypot(point.x - inland[0].x, point.y - inland[0].y) > 150)!];
      const huts = piecesOf(p, 'Hut').filter(item => p.components.find(c => c.id === item.componentId)!.rows[item.row].color === 'crimson')
        .sort((a, b) => b.order - a.order);
      const seat = p.players[0].id;
      p = applyCommand(p, { type: 'extractMove', id: huts[0].id, x: first.x, y: first.y }, seat);
      p = applyCommand(p, { type: 'extractMove', id: huts[1].id, x: second.x, y: second.y }, seat);
      return { p, seat, huts: [huts[0], huts[1]], first, second };
    };

    it('is valid Lua with the buttons and events it promises, and starts with its memory', () => {
      expect(checkScriptSyntax(TIDEWATER_SCRIPT)).toBeUndefined();
      const game = build('tidewater');
      // The buttons' functions, and the events it handles.
      expect(scriptFunctions(game.scripts)).toEqual(expect.arrayContaining(['startGame', 'rollDice']));
      for (const event of ['onTurnStart', 'onSnap', 'onMove']) expect(TIDEWATER_SCRIPT).toMatch(new RegExp(`^function ${event}\\(`, 'm'));
      expect(game.memory).toMatchObject({ colors: ['crimson', 'azure', 'ivory', 'amber'], checkSetup: true, autoRoll: true, started: false, round: 0 });
      expect(componentNamed(game, 'Start game')).toMatchObject({ kind: 'button', action: 'startGame' });
      expect(componentNamed(game, 'Roll dice')).toMatchObject({ kind: 'button', action: 'rollDice' });
    });

    it('starts only once every seat has set up its huts and boardwalks, pointing out what is wrong', () => {
      let p = build('tidewater');
      p = { ...p, memory: { ...p.memory, autoRoll: false } };
      const seat = p.players[0].id, names = p.players.map(player => player.name);
      const start = (project: Project) => applyCommand(project, call('startGame', 3), seat);
      const refused = start(p);
      expect(errors(refused)).toEqual([]);
      expect(refused.memory!.started).toBe(false);
      expect(announcements(refused).at(-1)).toBe(`Not ready to start: ${names.map(name => `${name} has 0 huts on the island instead of 2, 0 boardwalks on the island instead of 2`).join('; ')}.`);
      // Every colour places two huts on corners well apart, each with a boardwalk beside it.
      const corners = p.grids!.find(grid => grid.id === 'grid-corners')!.points!, chosen: { x: number; y: number }[] = [];
      for (const corner of corners) if (chosen.length < 8 && chosen.every(other => Math.hypot(other.x - corner.x, other.y - corner.y) > 120)) chosen.push(corner);
      const walks: Record<string, string[]> = {};
      ['crimson', 'azure', 'ivory', 'amber'].forEach((color, index) => {
        for (const corner of chosen.slice(index * 2, index * 2 + 2)) {
          p = placeFrom(p, 'Hut', color, corner).p;
          const placed = placeFrom(p, 'Boardwalk', color, edgesBeside(p, corner)[0]);
          p = placed.p; (walks[color] ??= []).push(placed.id);
        }
      });
      expect(errors(p)).toEqual([]);
      const ready = start(p);
      expect(errors(ready)).toEqual([]);
      expect(ready.memory!.started).toBe(true);
      expect(announcements(ready).some(text => text.startsWith('Not ready'))).toBe(false);
      // Azure's boardwalk moved away from its huts, and an ivory hut beside a crimson one, are pointed out (pinged).
      const far = p.grids!.find(grid => grid.id === 'grid-edges')!.points!.find(point => chosen.every(corner => Math.hypot(point.x - corner.x, point.y - corner.y) > 90))!;
      let broken = applyCommand(p, { type: 'move', ids: [walks.azure[0]], patch: { x: far.x, y: far.y } });
      const crowding = corners.find(corner => Math.abs(Math.hypot(corner.x - chosen[0].x, corner.y - chosen[0].y) - 56) < 1)!;
      const ivoryHut = piecesOf(broken, 'Hut').find(item => Math.hypot(item.x - chosen[4].x, item.y - chosen[4].y) < 1)!;
      broken = applyCommand(broken, { type: 'move', ids: [ivoryHut.id], patch: { x: crowding.x, y: crowding.y } });
      const blocked = start(broken);
      expect(errors(blocked)).toEqual([]);
      expect(blocked.memory!.started).toBe(false);
      const text = announcements(blocked).at(-1)!;
      expect(text).toContain(`${names[1]} has 1 hut without a boardwalk beside it, 1 boardwalk away from their huts`);
      expect(text).toContain(`${names[2]} has 1 hut without a boardwalk beside it, 1 boardwalk away from their huts`);
      expect(text).toContain(`huts of ${names[0]} and ${names[2]} stand on neighbouring corners`);
      expect(blocked.instances.find(item => item.id === walks.azure[0])!.pings).toBe(1);
      // With checkSetup off, it starts anyway.
      expect(start({ ...broken, memory: { ...broken.memory, checkSetup: false } }).memory!.started).toBe(true);
    });

    it('records the huts placed before the game, keeps building points, and deals starting resources for the second hut', () => {
      const { p, seat, huts, second } = setup();
      expect(errors(p)).toEqual([]);
      expect(p.memory).toMatchObject({ placed: { crimson: huts.map(item => item.id) }, points: { crimson: 2, azure: 0 } });
      const started = applyCommand(p, call('startGame', 3), seat);
      expect(errors(started)).toEqual([]);
      expect(started.memory).toMatchObject({ started: true, round: 1 });
      // One resource for each tile touching the second hut.
      expect(hand(started, 0)).toEqual(tilesAt(p, second).map(tile => terrainOf(p, tile)).sort());
      expect(announcements(started).at(-1)).toMatch(/^The game begins\. Starting resources: .* takes /);
    });

    it('hands out resources for the huts beside the tiles showing the roll, and warns about the squall on a 7', () => {
      const { p, seat, first, second } = setup();
      const started = applyCommand(p, call('startGame', 3), seat);
      const before = hand(started, 0).length;
      const rolls = new Map<number, Project>();
      for (let seed = 1; seed < 400 && rolls.size < 11; seed++) {
        const rolled = applyCommand(started, call('rollDice', seed), seat);
        const total = rolled.memory!.lastRoll as number;
        if (!rolls.has(total)) rolls.set(total, rolled);
      }
      // Every roll from 2 to 12 came up.
      expect([...rolls.keys()].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      for (const [total, rolled] of rolls) {
        expect(errors(rolled), String(total)).toEqual([]);
        const expected = total === 7 ? 0 : [first, second].flatMap(at => tilesAt(started, at)).filter(tile => numberOn(started, tile) === total).length;
        expect(hand(rolled, 0).length - before, `roll ${total}`).toBe(expected);
        expect(announcements(rolled).at(-1)).toMatch(new RegExp(`rolled ${total} `));
      }
      expect(announcements(rolls.get(7)!).at(-1)).toMatch(/The squall! Move it to another tile/);
    });

    it('shows only the buttons that apply: Start game before the game, Roll dice after it while the dice don\'t roll by themselves', () => {
      const hiddenFrom = (p: Project, name: string) => piecesOf(p, name)[0].hiddenFrom ?? [];
      const everyone = (p: Project) => p.players.map(player => player.id);
      const game = build('tidewater');
      expect([hiddenFrom(game, 'Start game'), hiddenFrom(game, 'Roll dice')]).toEqual([[], everyone(game)]);
      const { p, seat } = setup();
      // With autoRoll off, starting hides Start game and shows Roll dice.
      const manual = applyCommand(p, call('startGame', 3), seat);
      expect(errors(manual)).toEqual([]);
      expect([hiddenFrom(manual, 'Start game'), hiddenFrom(manual, 'Roll dice')]).toEqual([everyone(manual), []]);
      // Turning autoRoll on in memory hides Roll dice again; with it on from the start, Roll dice never shows.
      const auto = applyCommand(manual, { type: 'memory', changes: [{ path: ['autoRoll'], value: true }] }, seat);
      expect(errors(auto)).toEqual([]);
      expect(hiddenFrom(auto, 'Roll dice')).toEqual(everyone(auto));
      const automatic = applyCommand({ ...p, memory: { ...p.memory, autoRoll: true } }, call('startGame', 3), seat);
      expect([hiddenFrom(automatic, 'Start game'), hiddenFrom(automatic, 'Roll dice')]).toEqual([everyone(automatic), everyone(automatic)]);
    });

    it('rolls by itself when a turn starts once the game is on, and names the players beside the squall', () => {
      const { p, seat, second } = setup();
      const started = applyCommand({ ...p, memory: { ...p.memory, autoRoll: true } }, call('startGame', 3), seat);
      // Starting rolls for the current player straight away.
      expect(announcements(started).at(-1)).toMatch(/rolled \d+ \(\d \+ \d\)/);
      const next = applyCommand(started, { type: 'endTurn' }, seat);
      expect(errors(next)).toEqual([]);
      expect(announcements(next).at(-1)).toMatch(new RegExp(`^${next.players[1].name} rolled \\d+`));
      // Moving the squall onto a tile beside crimson's hut names crimson.
      const squall = piecesOf(next, 'Squall')[0], target = tilesAt(next, second).find(tile => Math.hypot(tile.x - squall.x, tile.y - squall.y) > 60)!;
      const slot = next.grids!.find(grid => grid.id === 'grid-slots')!.points!.find(point => Math.hypot(point.x - target.x, point.y - target.y) < 45)!;
      const moved = applyCommand(next, { type: 'move', ids: [squall.id], patch: { x: slot.x, y: slot.y } }, next.players[1].id);
      expect(announcements(moved).at(-1)).toMatch(new RegExp(`^The squall settles on the .*\\. Take a random card from ${next.players[0].name}\\.$`));
    });
  });

  it('gives every component with a transparent background a back design, so no printed back comes out blank', () => {
    const backless: string[] = [];
    for (const { id } of GAME_PROJECTS) for (const component of build(id).components.filter(hasOpenFace)) {
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
    for (const id of ['backgammon', 'tidewater'] as const) expect(build(id).settings).toMatchObject({ grid: false, snap: false });
  });

  it('snaps to grid points at the offset plus whole cells', () => {
    expect(snapToGrid(77, 60, 50)).toBe(50);
    expect(snapToGrid(81, 60, 50)).toBe(110);
    expect(snapToGrid(-31, 60, 50)).toBe(-10);
    expect(snapToGrid(13, 25)).toBe(25);
  });
});
