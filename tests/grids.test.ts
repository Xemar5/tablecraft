import { describe, expect, it } from 'vitest';
import { applyCommand, makeInstance, type Component, type Project } from '../src/domain';
import { gridPointPosition, legacyGrid, nearestGridPoint, projectGrids, snapOf, snapTarget, type Grid } from '../src/grids';
import { applyPlaygroundCommand, emptyPlaygroundHistory, undoPlayground } from '../src/playgroundHistory';
import { blankProject, template } from '../src/templates';
import { gameProject } from '../src/gameProjects';

const square = (patch: Partial<Grid> = {}): Grid => ({ id: 'squares', name: 'Squares', shape: 'square', visible: true, snap: true, size: 50, offsetX: 10, offsetY: 20, ...patch });
const hex = (patch: Partial<Grid> = {}): Grid => ({ id: 'hexes', name: 'Hexes', shape: 'hex', visible: true, snap: true, size: 100, offsetX: 0, offsetY: 0, ...patch });
const points = (patch: Partial<Grid> = {}): Grid => ({ id: 'spots', name: 'Spots', shape: 'points', visible: true, snap: true, size: 50, offsetX: 0, offsetY: 0,
  points: [{ id: 'start', x: 500, y: 500, rotation: 90, label: 'Start' }, { id: 'end', x: 900, y: 500 }], ...patch });
const token = (id: string, patch: Partial<Component> = {}): Component => ({ ...template('token'), id, name: id, stackTag: '', stackTags: ['coin'], ...patch });
function table(grids: Grid[], ...components: Component[]): Project {
  const p = blankProject();
  return { ...p, grids, components, instances: components.map((c, n) => ({ ...makeInstance(c.id, 0, 100 * n + 3, 7), id: `piece-${c.id}` })) };
}
const piece = (p: Project, id: string) => p.instances.find(i => i.id === `piece-${id}`)!;

describe('grids', () => {
  it('find the nearest square, hex and hand-placed points', () => {
    expect(nearestGridPoint(square(), 84, 46)).toMatchObject({ point: '1,1', x: 60, y: 70 });
    expect(gridPointPosition(square({ sizeY: 30 }), '-2,3')).toMatchObject({ x: -90, y: 110 });
    // Pointy hexes: neighbours sit `size` apart along a row, and rows are √3/2 × size apart, offset by half a cell.
    const pointy = hex();
    expect(gridPointPosition(pointy, '1,0')).toMatchObject({ x: 100, y: 0 });
    const below = gridPointPosition(pointy, '0,1')!;
    expect(below.x).toBeCloseTo(50); expect(below.y).toBeCloseTo(86.6, 1);
    expect(nearestGridPoint(pointy, 60, 80)?.point).toBe('0,1');
    expect(nearestGridPoint(pointy, -48, 86)?.point).toBe('-1,1');
    const flat = hex({ orientation: 'flat' });
    const right = gridPointPosition(flat, '1,0')!;
    expect(right.x).toBeCloseTo(86.6, 1); expect(right.y).toBeCloseTo(50);
    expect(nearestGridPoint(flat, 80, 40)?.point).toBe('1,0');
    // Every hex cell centre maps back to itself.
    for (const grid of [pointy, flat]) for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) {
      const at = gridPointPosition(grid, `${q},${r}`)!;
      expect(nearestGridPoint(grid, at.x + 3, at.y - 2)?.point).toBe(`${q},${r}`);
    }
    expect(nearestGridPoint(points(), 880, 470)).toMatchObject({ point: 'end', x: 900, y: 500 });
    expect(nearestGridPoint(points({ points: [] }), 0, 0)).toBeUndefined();
  });

  it('snap to the first grid in the list that takes the piece and has a point in range', () => {
    const p = table([points({ filter: { anyOf: [{ has: ['meeple'], lacks: [] }] } }), square()], token('coin'), token('meeple', { stackTags: [], gridTags: ['meeple'] }), token('free', { gridTags: [] }));
    const coin = p.components[0], meeple = p.components[1], free = p.components[2];
    // The coin's grid tags don't fit the points grid: it snaps to the squares.
    expect(snapTarget(p, { ...coin, gridTags: ['coin'] }, 495, 505)).toMatchObject({ grid: 'squares', point: '10,10' });
    // The meeple fits the points grid and wins it near a point, taking the point's rotation; far away it uses the squares.
    expect(snapTarget(p, meeple, 495, 505)).toMatchObject({ grid: 'spots', point: 'start', x: 500, y: 500, rotation: 90 });
    expect(snapTarget(p, meeple, 700, 505)).toMatchObject({ grid: 'squares' });
    // Untagged components snap to every grid; turning their snapping off or the grid's snapping off leaves them free.
    expect(snapTarget(p, free, 495, 505)?.grid).toBe('spots');
    expect(snapTarget(p, { ...free, snapToGrid: false }, 495, 505)).toBeUndefined();
    expect(snapTarget({ ...p, grids: p.grids!.map(grid => ({ ...grid, snap: false })) }, free, 495, 505)).toBeUndefined();
    // Older projects have the one grid from their table settings.
    const legacy = { ...p, grids: undefined, settings: { ...p.settings, snap: true, gridSize: 40, gridOffsetX: 5 } };
    expect(projectGrids(legacy)).toEqual([legacyGrid(legacy.settings)]);
    expect(snapTarget(legacy, coin, 52, 38)).toMatchObject({ grid: 'grid', point: '1,1', x: 45, y: 40 });
  });

  it('snap moved pieces and stacks in the shared engine, and know which point a piece sits on', () => {
    let p = table([square({ rotation: 45 })], token('a'), token('b'));
    p = applyCommand(p, { type: 'stack', ids: ['piece-a', 'piece-b'], stackId: 's' });
    p = applyCommand(p, { type: 'transform', ids: ['piece-a', 'piece-b'], dx: 140, dy: 90, snap: true });
    expect([piece(p, 'a').x, piece(p, 'a').y, piece(p, 'a').rotation]).toEqual([160, 120, 45]);
    expect([piece(p, 'b').x, piece(p, 'b').y]).toEqual([160, 120]);
    expect(snapOf(p, piece(p, 'a'))).toMatchObject({ grid: 'squares', point: '3,2' });
    // Moving without snapping leaves the grid point.
    p = applyCommand(p, { type: 'transform', ids: ['piece-a', 'piece-b'], dx: 7, dy: 0 });
    expect(snapOf(p, piece(p, 'a'))).toBeUndefined();
    // snapTo puts pieces (with their stack) on a named point.
    p = applyCommand(p, { type: 'snapTo', ids: ['piece-b'], grid: 'squares', point: '-1,4' });
    expect([piece(p, 'a').x, piece(p, 'a').y]).toEqual([-40, 220]);
    expect(() => applyCommand(p, { type: 'snapTo', ids: ['piece-a'], grid: 'squares', point: 'nowhere' })).toThrow('no point nowhere');
  });

  it('give scripts the grids, their points and the pieces on them, and call onSnap when pieces snap', () => {
    let p = table([points(), square()], token('a'), token('b'));
    p = applyCommand(p, { type: 'script', script: { id: 'rules', name: 'Rules', source: `
      function setup()
        local start = game.gridPoint("Spots", "start")
        game.snapTo("piece-a", "spots", "start")
        game.snapTo("piece-b", "squares", 2, 3)
        memory.start = { start.x, start.y, start.rotation, start.label }
        memory.grids = #game.grids()
        memory.points = #game.gridPoints("spots")
        memory.at = game.piecesAt("squares", "2,3")[1].id
        memory.near = game.nearestGridPoint(890, 510).point
        memory.snapA = game.piece("piece-a").snap.point
      end
      function onSnap(pieces, player) memory.snapped = pieces[1].snap.grid .. ":" .. pieces[1].snap.point end` } });
    p = applyCommand(p, { type: 'call', name: 'setup', args: [], seed: 1 });
    expect((p.scriptLog ?? []).filter(line => line.level === 'error')).toEqual([]);
    expect(p.memory).toMatchObject({ start: [500, 500, 90, 'Start'], grids: 2, points: 2, at: 'piece-b', near: 'end', snapA: 'start' });
    expect([piece(p, 'a').x, piece(p, 'a').y, piece(p, 'a').rotation]).toEqual([500, 500, 90]);
    // A player's move that snaps runs onSnap.
    p = applyCommand(p, { type: 'transform', ids: ['piece-a'], dx: 395, dy: 3, snap: true });
    expect(p.memory?.snapped).toBe('spots:end');
  });

  it('give Tidewater a hex grid under its tiles and snap points for buildings and boardwalks', () => {
    let p = gameProject('tidewater', 'Tidewater', '', { name: 'Tester', color: '#b7cc91' });
    const kind = (name: string) => p.components.find(c => c.name === name)!;
    const tiles = p.instances.filter(i => i.componentId === kind('Island tile').id);
    expect(tiles.every(i => snapOf(p, i)?.grid === 'grid-island')).toBe(true);
    const corners = p.grids!.find(grid => grid.id === 'grid-corners')!.points!, edges = p.grids!.find(grid => grid.id === 'grid-edges')!.points!;
    expect([corners.length, edges.length]).toEqual([54, 72]);
    // A hut dropped near a corner snaps onto it; a resource card stays where it is dropped.
    const hut = p.instances.find(i => i.componentId === kind('Hut').id && !i.holder)!;
    const corner = corners[0];
    p = applyCommand(p, { type: 'transform', ids: hut.stack ? p.instances.filter(i => i.stack === hut.stack).map(i => i.id) : [hut.id], dx: corner.x + 9 - hut.x, dy: corner.y - 6 - hut.y, snap: true }, p.players[0].id);
    expect(p.instances.find(i => i.id === hut.id)).toMatchObject({ x: corner.x, y: corner.y });
    expect(snapTarget(p, kind('Resource'), corner.x, corner.y)).toBeUndefined();
  });

  it('edit grid layers as undoable table actions, materializing the grid from older settings', () => {
    const p = { ...table([], token('a')), grids: undefined };
    let state = applyPlaygroundCommand(p, emptyPlaygroundHistory(), { type: 'grid', grid: hex() });
    expect(state.project.grids?.map(grid => grid.id)).toEqual(['grid', 'hexes']);
    state = applyPlaygroundCommand(state.project, state.history, { type: 'reorderGrids', ids: ['hexes', 'grid'] });
    state = applyPlaygroundCommand(state.project, state.history, { type: 'removeGrid', id: 'grid' });
    expect(state.project.grids?.map(grid => grid.id)).toEqual(['hexes']);
    state = applyPlaygroundCommand(state.project, state.history, { type: 'grid', grid: { ...hex(), size: 80 } });
    expect(state.project.grids?.[0].size).toBe(80);
    expect(undoPlayground(state.project, state.history).project.grids?.[0].size).toBe(100);
    expect(() => applyCommand(state.project, { type: 'grid', grid: points({ points: [{ id: 'x', x: 0, y: 0 }, { id: 'x', x: 1, y: 1 }] }) })).toThrow('duplicate point');
  });
});
