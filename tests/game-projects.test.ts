import { describe, expect, it } from 'vitest';
import { applyCommand, projectSchema, validateProject, withGroupLocks, type Instance, type Project } from '../src/domain';
import { GAME_PROJECTS, gameProject } from '../src/gameProjects';
import { hasOpenFace } from '../src/ComponentView';
import { snapToGrid } from '../src/playgroundPreview';
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
    expect(tidewater.components.filter(component => component.previewWhenLocked).map(component => component.name)).toEqual(['Island tile', 'Tide marker', 'Harbor', 'Building costs']);
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
