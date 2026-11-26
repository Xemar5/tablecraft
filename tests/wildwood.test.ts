import { describe, expect, it } from 'vitest';
import { applyCommand, validateProject } from '../src/domain';
import { gridAccepts } from '../src/grids';
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

  it('snaps wanderers (only) onto the path stones and announces where they rest', () => {
    const project = wildwoodProject();
    const path = project.grids!.find(grid => grid.id === 'wanderers-path')!, stone = path.points![2];
    const byName = (name: string) => project.components.find(component => component.name === name)!;
    expect(gridAccepts(path, byName('Wanderer'))).toBe(true);
    expect(gridAccepts(path, byName('Spirit cards'))).toBe(false);
    const walker = project.instances.find(item => item.componentId === byName('Wanderer').id)!;
    const moved = applyCommand(project, { type: 'transform', ids: [walker.id], dx: stone.x + 12 - walker.x, dy: stone.y - 9 - walker.y, snap: true }, 'player-1');
    expect(moved.instances.find(item => item.id === walker.id)).toMatchObject({ x: stone.x, y: stone.y });
    expect(moved.scriptLog?.at(-1)?.text).toBe(`${walker.row ? 'Ember' : 'Moss'} wanderer reaches the ${stone.label}.`);
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
