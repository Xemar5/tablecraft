import { describe, expect, it } from 'vitest';
import { applyCommand, validateProject } from '../src/domain';
import { gridAccepts, placedGrids, placedPointPosition } from '../src/grids';
import { gridColor } from '../src/GridLayers';
import { templateBundle } from '../src/templates';
import { wildwoodProject } from '../src/wildwood';

describe('Wildwood sample', () => {
  it('is a valid project with one shared art component, fitted inside every frame', () => {
    const project = validateProject(wildwoodProject());
    const names = project.components.map(component => component.name);
    expect(new Set(names).size).toBe(names.length);
    const art = project.components.filter(component => component.kind === 'artwork');
    expect(art.map(component => component.name)).toEqual(['Botanical artwork']);
    const links = project.components.flatMap(component => [...component.front, ...component.back]).filter(node => node.type === 'component');
    expect(links.length).toBeGreaterThanOrEqual(5);
    expect(links.every(node => node.componentId === art[0].id && node.nestedFit === 'contain')).toBe(true);
    // The table grid is drawn faintly, in the default colour at 10% alpha.
    const table = project.grids!.findIndex(grid => grid.id === 'table-grid');
    expect(gridColor(project.grids![table], table)).toMatch(/^#[0-9a-f]{6}1a$/i);
  });

  it('shows auto font size and pivots: fitted names, rules and pages, and numbers that grow around their pivots', () => {
    const project = validateProject(wildwoodProject());
    const layer = (component: string, name: string) => project.components.find(item => item.name === component)!.front.find(node => node.name === name)!;
    for (const [component, name] of [['Spirit cards', 'Card name'], ['Spirit cards', 'Rules text'], ['Wanderer’s guide', 'Body']]) {
      expect(layer(component, name)).toMatchObject({ autoFontSize: true });
    }
    // One card's name is too long for its box at full size, and one power has two digits.
    const cards = project.components.find(item => item.name === 'Spirit cards')!;
    expect(cards.rows.some(row => row.name.length > 25)).toBe(true);
    expect(cards.rows.some(row => row.power.length > 1)).toBe(true);
    expect(layer('Spirit cards', 'Power')).toMatchObject({ pivotX: 1, pivotY: 1, widthMode: 'hug', heightMode: 'hug' });
    expect(layer('Wanderer’s guide', 'Page number')).toMatchObject({ pivotX: .5, pivotY: 1, widthMode: 'hug' });
  });

  it('gathers amber from the persistent supply into the presser’s hand and counts it in memory', () => {
    const before = wildwoodProject();
    const supply = () => before.instances.filter(item => item.stack === 'amber-supply');
    const after = applyCommand(before, { type: 'call', name: 'gatherAmber', args: [], seed: 1 }, 'player-1');
    expect(after.memory).toMatchObject({ gathered: 1 });
    expect(after.instances.filter(item => item.holder === 'player-1')).toHaveLength(1);
    expect(after.instances.filter(item => item.stack === 'amber-supply')).toHaveLength(supply().length - 1);
    expect(after.scriptLog?.at(-1)?.text).toBe('Player 1 gathers amber.');
  });

  it('carries the path stones on the path board, snapping wanderers (only) onto them wherever the board goes', () => {
    const project = wildwoodProject();
    const byName = (name: string) => project.components.find(component => component.name === name)!;
    const stones = byName('Wanderer’s path').grids![0], label = stones.points![2].label;
    expect(project.grids!.map(grid => grid.id)).toEqual(['table-grid']);
    expect(gridAccepts(stones, byName('Wanderer'))).toBe(true);
    expect(gridAccepts(stones, byName('Spirit cards'))).toBe(false);
    const board = project.instances.find(item => item.componentId === byName('Wanderer’s path').id)!;
    const walker = project.instances.find(item => item.componentId === byName('Wanderer').id)!;
    const dropNear = (state: typeof project) => {
      const stone = placedPointPosition(placedGrids(state).find(grid => grid.host === board.id)!, 'stone-3')!;
      const moved = applyCommand(state, { type: 'transform', ids: [walker.id], dx: stone.x + 12 - walker.x, dy: stone.y - 9 - walker.y, snap: true }, 'player-1');
      expect(moved.instances.find(item => item.id === walker.id)).toMatchObject({ x: stone.x, y: stone.y });
      expect(moved.scriptLog?.at(-1)?.text).toBe(`${walker.row ? 'Ember' : 'Moss'} wanderer reaches the ${label}.`);
      return stone;
    };
    const before = dropNear(project);
    // Unlocked and moved, the board takes its stones along.
    const unlocked = { ...project, groups: project.groups!.map(group => ({ ...group, locked: false })) };
    const shifted = applyCommand(unlocked, { type: 'transform', ids: [board.id], dx: -300, dy: 80 }, 'player-1');
    const after = dropNear(shifted);
    expect(after.x).toBeCloseTo(before.x - 300); expect(after.y).toBeCloseTo(before.y + 80);
  });

  it('gives the card template one drawing for every variant, fitted inside its frame without stretching', () => {
    const { root, components } = templateBundle('card');
    expect(components).toEqual([root]);
    expect(root.rows.every(row => !('art' in row))).toBe(true);
    const frame = root.front.find(node => node.name === 'Art')!;
    const stem = root.front.find(node => node.parent === frame.id && node.name === 'Stem')!;
    // The 200 × 180 drawing keeps its proportions: the stem is scaled as much across as along.
    expect(stem.width / 3).toBeCloseTo(stem.height / 148, 2);
  });
});
