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

  it('hides one spirit card from everyone, seats that join later too, for game master mode to show', () => {
    const project = wildwoodProject();
    const hidden = project.instances.filter(item => item.hidden);
    expect(hidden).toHaveLength(1);
    expect(hidden[0].hidePlayers).toBeUndefined();
    expect(project.components.find(component => component.id === hidden[0].componentId)!.name).toBe('Spirit cards');
  });

  it('keeps the guide and its controls in their place in the order', () => {
    const project = wildwoodProject();
    expect(project.groups!.find(group => group.id === 'group-guide')).toMatchObject({ orderLocked: true });
    const guide = project.instances.find(item => item.group === 'group-guide')!;
    expect(() => applyCommand(project, { type: 'zOrder', ids: [guide.id], move: 'back' }, 'player-1')).toThrow('order is locked');
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

  it('marks the supply empty in memory, which the Amber tally shows, and full again once amber goes back', () => {
    let p = wildwoodProject();
    const tally = p.components.find(component => component.name === 'Amber tally')!;
    expect(tally.front.find(node => node.name === 'Supply empty')).toMatchObject({ visibilityField: 'memory.supplyEmpty', visibilityValue: 'true' });
    const count = p.instances.filter(item => item.stack === 'amber-supply').length;
    for (let n = 0; n < count; n++) p = applyCommand(p, { type: 'call', name: 'gatherAmber', args: [], seed: n }, 'player-1');
    expect(p.memory).toMatchObject({ gathered: count, supplyEmpty: true });
    const held = p.instances.find(item => item.holder === 'player-1')!;
    p = applyCommand(p, { type: 'releaseMany', ids: [held.id], x: 0, y: 0 }, 'player-1');
    p = applyCommand(p, { type: 'dropIntoStack', ids: [held.id], stackId: 'amber-supply' }, 'player-1');
    expect(p.memory).toMatchObject({ supplyEmpty: false });
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
      // The script shows the Stone reached popup to everyone, saying who reached which stone.
      expect(moved.popups?.at(-1)).toMatchObject({ componentId: byName('Stone reached').id, data: { name: `${walker.row ? 'Ember' : 'Moss'} wanderer`, stone: label } });
      expect(moved.popups?.at(-1)?.to).toBeUndefined();
      return stone;
    };
    const before = dropNear(project);
    // Unlocked and moved, the board takes its stones along.
    const unlocked = { ...project, groups: project.groups!.map(group => ({ ...group, locked: false })) };
    const shifted = applyCommand(unlocked, { type: 'transform', ids: [board.id], dx: -300, dy: 80 }, 'player-1');
    const after = dropNear(shifted);
    expect(after.x).toBeCloseTo(before.x - 300); expect(after.y).toBeCloseTo(before.y + 80);
  });

  it('shows sample popups: the heart of the wood in its wanderer’s row, and Quick rules toggled by its button', () => {
    const project = wildwoodProject();
    const byName = (name: string) => project.components.find(component => component.name === name)!;
    expect(project.components.filter(component => component.kind === 'popup').map(component => component.name))
      .toEqual(['Amber milestone', 'Stone reached', 'Heart of the wood', 'Quick rules']);
    // Each sample shows popup settings of its own.
    expect(byName('Stone reached').popup).toMatchObject({ anchor: 'top-right', duration: 4, dismiss: 'all' });
    expect(byName('Heart of the wood').popup).toMatchObject({ fit: 'fill', blur: true });
    expect(byName('Quick rules').popup).toMatchObject({ layout: 'fixed', draggable: true });
    // The last stone opens the Heart of the wood with the data row of the wanderer that reached it.
    const board = project.instances.find(item => item.componentId === byName('Wanderer’s path').id)!;
    const walker = project.instances.filter(item => item.componentId === byName('Wanderer').id).find(item => item.row === 1)!;
    const heart = placedPointPosition(placedGrids(project).find(grid => grid.host === board.id)!, 'stone-5')!;
    // (The ember wanderer is Player 2's: it's locked for everyone else.)
    expect(() => applyCommand(project, { type: 'transform', ids: [walker.id], dx: 1, dy: 0 }, 'player-1')).toThrow(/[Uu]nlock/);
    const arrived = applyCommand(project, { type: 'transform', ids: [walker.id], dx: heart.x - walker.x, dy: heart.y - walker.y, snap: true }, 'player-2');
    expect(arrived.popups?.at(-1)).toMatchObject({ componentId: byName('Heart of the wood').id, row: 1 });
    expect(byName('Heart of the wood').rows[1]).toMatchObject({ color: 'ember', wanderer: 'Ember wanderer' });
    // The Quick rules button opens the panel for whoever pressed it, and closes it on the next press.
    const button = project.instances.find(item => item.componentId === byName('Quick rules button').id)!;
    const press = (state: typeof project) => applyCommand(state, { type: 'call', name: 'showRules', piece: button.id, args: [], seed: 3 }, 'player-2');
    const opened = press(project);
    expect(opened.popups).toEqual([expect.objectContaining({ componentId: byName('Quick rules').id, to: ['player-2'] })]);
    expect(press(opened).popups).toBeUndefined();
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
