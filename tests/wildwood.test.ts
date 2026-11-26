import { describe, expect, it } from 'vitest';
import { applyCommand, validateProject } from '../src/domain';
import { gridAccepts } from '../src/grids';
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
    // The table grid is drawn faintly, with a translucent colour.
    expect(project.grids!.find(grid => grid.id === 'table-grid')!.color).toMatch(/^#[0-9a-f]{8}$/i);
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

  it('gives illustrated templates their own art, linked and fitted inside', () => {
    for (const kind of ['card', 'token', 'board'] as const) {
      const { root, components } = templateBundle(kind);
      expect(components.map(component => component.kind)).toEqual(['artwork', root.kind]);
      const links = [...root.front, ...root.back].filter(node => node.type === 'component');
      expect(links.every(node => node.componentId === components[0].id && node.nestedFit === 'contain')).toBe(true);
    }
  });
});
