import { describe, expect, it } from 'vitest';
import { applyCommand, makeInstance, validateProject, type Component, type Instance, type Project } from '../src/domain';
import { fromFrame, nearestBoundedPoint, placedGrids, placedPointPosition, snapOf, snapTarget, toFrame, type ComponentGrid, type Grid } from '../src/grids';
import { blankProject, template } from '../src/templates';
import { filterFromTags } from '../src/tags';

// A 400 × 300 board carrying a square grid of 50 px cells whose points sit in the cells' centres, over its left half.
const cells = (patch: Partial<ComponentGrid> = {}): ComponentGrid => ({ id: 'cells', name: 'Cells', shape: 'square', visible: true, snap: true, size: 50,
  offsetX: 25, offsetY: 25, bounds: { x: 0, y: 0, width: 200, height: 300 }, ...patch });
const board = (grids: ComponentGrid[] = [cells()], patch: Partial<Component> = {}): Component =>
  ({ ...template('board'), id: 'board', name: 'Board', width: 400, height: 300, grids, ...patch });
const token = (id = 'token', patch: Partial<Component> = {}): Component => ({ ...template('token'), id, name: id, stackTag: '', stackTags: [], ...patch });
const tableGrid: Grid = { id: 'table', name: 'Table', shape: 'square', visible: true, snap: true, size: 10, offsetX: 0, offsetY: 0 };
function table(components: Component[], instances: Partial<Instance>[], grids: Grid[] = []): Project {
  return { ...blankProject(), grids, components, instances: instances.map((patch, n) => ({ ...makeInstance(patch.componentId!, 0, 0, 0), id: `piece-${n}`, ...patch })) };
}
const at = (p: Project, id: string) => p.instances.find(item => item.id === id)!;

describe('grids components carry', () => {
  it('map between a piece’s component and the table through its centre, turn and scale', () => {
    const frame = { x: 1000, y: 500, rotation: 90, scale: 2, width: 400, height: 300 };
    // The component's centre is the piece's centre; its top-left corner turns a quarter round it, twice as far out.
    expect(fromFrame(frame, 200, 150)).toEqual({ x: 1000, y: 500 });
    const corner = fromFrame(frame, 0, 0);
    expect(corner.x).toBeCloseTo(1300); expect(corner.y).toBeCloseTo(100);
    const back = toFrame(frame, corner.x, corner.y);
    expect(back.x).toBeCloseTo(0); expect(back.y).toBeCloseTo(0);
  });

  it('offer only the points inside their bounds', () => {
    const bounds = { x: 0, y: 0, width: 200, height: 300 };
    // Square grids clamp to the columns and rows inside.
    expect(nearestBoundedPoint(cells(), bounds, 390, 20)).toMatchObject({ point: '3,0', x: 175, y: 25 });
    expect(nearestBoundedPoint(cells(), { x: 30, y: 30, width: 10, height: 10 }, 0, 0)).toBeUndefined();
    // Hex grids take the nearest cell inside: 3,0 (at 210, 30) is out, and 2,1 (at 180, 82) is nearer than 2,0.
    const hex: Grid = { id: 'hex', name: 'Hex', shape: 'hex', visible: true, snap: true, size: 60, offsetX: 30, offsetY: 30 };
    const near = nearestBoundedPoint(hex, bounds, 230, 30)!;
    expect(near.x).toBeLessThanOrEqual(200);
    expect(near).toMatchObject({ point: '2,1', x: 180 });
    // Points grids skip points outside.
    const spots: Grid = { id: 'spots', name: 'Spots', shape: 'points', visible: true, snap: true, size: 50, offsetX: 0, offsetY: 0,
      points: [{ id: 'in', x: 150, y: 150, label: 'In' }, { id: 'out', x: 300, y: 150 }] };
    expect(nearestBoundedPoint(spots, bounds, 290, 150)).toMatchObject({ point: 'in', label: 'In' });
  });

  it('come before the table’s grids, the topmost piece’s first, and only for pieces on the table', () => {
    const second = board([cells({ id: 'other' })], { id: 'mat', name: 'Mat', kind: 'card' });
    const p = table([board(), second, token()], [
      { componentId: 'board', x: 500, y: 500 }, { componentId: 'mat', x: 500, y: 500 }, { componentId: 'mat', x: 0, y: 0, holder: 'player-1' },
    ], [tableGrid]);
    // The mat (a card) is drawn over the board; the held mat carries nothing.
    expect(placedGrids(p).map(grid => grid.key)).toEqual(['piece-1/other', 'piece-0/cells', 'table']);
    expect(placedGrids(p, new Set(['piece-1'])).map(grid => grid.key)).toEqual(['piece-0/cells', 'table']);
  });

  it('snap dropped pieces onto a turned, scaled board, turning them with it, and the board never to its own grid', () => {
    const p = table([board([cells({ rotation: 10 })]), token()], [
      { componentId: 'board', x: 1000, y: 500, rotation: 90, scale: 2 }, { componentId: 'token', x: 0, y: 0 },
    ], [tableGrid]);
    // The cell centre (25, 25) of the turned board is at (1250, 150) on the table.
    const target = fromFrame({ x: 1000, y: 500, rotation: 90, scale: 2, width: 400, height: 300 }, 25, 25);
    let next = applyCommand(p, { type: 'transform', ids: ['piece-1'], dx: target.x + 20, dy: target.y - 15, snap: true });
    expect(at(next, 'piece-1').x).toBeCloseTo(target.x); expect(at(next, 'piece-1').y).toBeCloseTo(target.y);
    expect(at(next, 'piece-1').rotation).toBe(100);
    expect(snapOf(next, at(next, 'piece-1'))).toMatchObject({ grid: 'piece-0/cells', point: '0,0' });
    // Outside the bounds (the board's right half), the table grid takes it.
    const right = fromFrame({ x: 1000, y: 500, rotation: 90, scale: 2, width: 400, height: 300 }, 330, 150);
    next = applyCommand(p, { type: 'transform', ids: ['piece-1'], dx: right.x + 3, dy: right.y + 3, snap: true });
    expect(snapOf(next, at(next, 'piece-1'))?.grid).toBe('table');
    // The board snaps to the table grid, not to the grid it carries.
    next = applyCommand(p, { type: 'transform', ids: ['piece-0'], dx: 3, dy: 4, snap: true });
    expect([at(next, 'piece-0').x, at(next, 'piece-0').y]).toEqual([1000, 500]);
  });

  it('follow the grid settings: tag filters, snapping off and points grid snap distances (scaled with the piece)', () => {
    const spots: ComponentGrid = { id: 'spots', name: 'Spots', shape: 'points', visible: true, snap: true, size: 50, offsetX: 0, offsetY: 0, radius: 20,
      bounds: { x: 0, y: 0, width: 400, height: 300 }, points: [{ id: 'a', x: 100, y: 100, label: 'Clearing' }] };
    const p = table([board([spots]), token('token', { gridTags: ['meeple'] }), token('coin', { gridTags: ['coin'] })], [
      { componentId: 'board', x: 200, y: 150, scale: 2 }, { componentId: 'token' }, { componentId: 'coin' },
    ]);
    // (100, 100) on the board is (0, 50) on the table; scaled twice, the 20 px snap distance reaches 40 px.
    expect(snapTarget(p, token(), 30, 50)).toMatchObject({ grid: 'piece-0/spots', point: 'a', x: 0, y: 50, label: 'Clearing' });
    expect(snapTarget(p, token(), 45, 50)).toBeUndefined();
    const filtered = { ...p, components: p.components.map(c => c.id === 'board' ? { ...c, grids: [{ ...spots, filter: filterFromTags(['meeple']) }] } : c) };
    expect(snapTarget(filtered, token('token', { gridTags: ['meeple'] }), 10, 50)).toBeDefined();
    expect(snapTarget(filtered, token('coin', { gridTags: ['coin'] }), 10, 50)).toBeUndefined();
    const off = { ...p, components: p.components.map(c => c.id === 'board' ? { ...c, grids: [{ ...spots, snap: false }] } : c) };
    expect(snapTarget(off, token(), 10, 50)).toBeUndefined();
  });

  it('take snapTo by their "piece/grid" keys, and are checked like table grids', () => {
    const p = table([board(), token()], [{ componentId: 'board', x: 200, y: 150 }, { componentId: 'token' }]);
    const next = applyCommand(p, { type: 'snapTo', ids: ['piece-1'], grid: 'piece-0/cells', point: '1,2' });
    expect([at(next, 'piece-1').x, at(next, 'piece-1').y]).toEqual([75, 125]);
    expect(placedPointPosition(placedGrids(p)[0], '5,0')).toBeUndefined();
    expect(() => applyCommand(p, { type: 'snapTo', ids: ['piece-1'], grid: 'piece-0/cells', point: '5,0' })).toThrow('no point 5,0');
    expect(() => applyCommand(p, { type: 'snapTo', ids: ['piece-0'], grid: 'piece-0/cells', point: '1,2' })).toThrow('carries');
    expect(() => validateProject({ ...p, components: [board([cells(), cells()]), token()] })).toThrow('Duplicate grid');
  });

  it('show in scripts with their piece, bounds and keys, and snaps name their point’s label', () => {
    const spots: ComponentGrid = { id: 'spots', name: 'Spots', shape: 'points', visible: true, snap: true, size: 50, offsetX: 0, offsetY: 0,
      bounds: { x: 0, y: 0, width: 400, height: 300 }, points: [{ id: 'a', x: 100, y: 100, label: 'Clearing' }] };
    let p = table([board([spots]), token()], [{ componentId: 'board', x: 200, y: 150 }, { componentId: 'token' }], [tableGrid]);
    p = applyCommand(p, { type: 'script', script: { id: 'rules', name: 'Rules', source: `
      function setup()
        local grids = game.grids()
        memory.first = { grids[1].id, grids[1].piece, grids[1].bounds.width, grids[2].id }
        local point = game.gridPoint("piece-0/Spots", "a")
        memory.point = { point.x, point.y, point.label }
        game.snapTo("piece-1", grids[1].id, "a")
        memory.snap = { game.piece("piece-1").snap.label, game.piece("piece-1").snap.piece }
        memory.on = #game.piecesAt("piece-0/spots", "a")
      end` } });
    p = applyCommand(p, { type: 'call', name: 'setup', args: [], seed: 1 });
    expect((p.scriptLog ?? []).filter(line => line.level === 'error')).toEqual([]);
    expect(p.memory).toMatchObject({ first: ['piece-0/spots', 'piece-0', 400, 'table'], point: [100, 100, 'Clearing'], snap: ['Clearing', 'piece-0'], on: 1 });
  });
});
