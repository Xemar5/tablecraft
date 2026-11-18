import { describe, expect, it } from 'vitest';
import { projectSchema, validateProject, type Project } from '../src/domain';
import { GAME_PROJECTS, gameProject } from '../src/gameProjects';
import { groupMembers } from '../src/pieceGroups';

const profile = { name: 'Tester', color: '#b7cc91' };
const build = (id: Parameters<typeof gameProject>[0]) => validateProject(projectSchema.parse(gameProject(id, 'Game', 'About the game', profile)));
const count = (project: Project, name: string, row?: number) => project.instances.filter(instance =>
  project.components.find(component => component.id === instance.componentId)?.name === name && (row === undefined || instance.row === row)).length;

describe('game projects', () => {
  it('builds every listed game as a valid project seated with the profile first', () => {
    for (const { id } of GAME_PROJECTS) {
      const project = build(id);
      expect(project.name).toBe('Game');
      expect(project.players[0]).toMatchObject({ name: 'Tester', color: '#b7cc91' });
      // The board is placed and locked, so pieces can be box-selected over it.
      expect(project.instances[0].locked).toBe(true);
    }
  });

  it('files every movable piece in a named group and locks the parts that never move', () => {
    const named = (project: Project, name: string) => {
      const group = (project.groups ?? []).find(item => item.name === name);
      expect(group, name).toBeDefined();
      return groupMembers(project, group!.id).map(id => project.instances.find(item => item.id === id)!);
    };
    const kind = (project: Project, id: string) => project.components.find(component => component.id === id)!.kind;
    for (const { id } of GAME_PROJECTS) {
      const project = build(id);
      // Only boards stay outside the groups.
      expect(project.instances.filter(item => !item.group).every(item => kind(project, item.componentId) === 'board' && item.locked)).toBe(true);
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
    for (const name of ['Island tiles', 'Tide markers', 'Harbors']) expect(named(tidewater, name).every(item => item.locked), name).toBe(true);
    expect([named(tidewater, 'Island tiles').length, named(tidewater, 'Tide markers').length, named(tidewater, 'Harbors').length]).toEqual([19, 18, 9]);
    // The squall moves during play; the island group holds it beside its locked subgroups.
    expect(named(tidewater, 'Island').filter(item => !item.locked).map(item => tidewater.components.find(component => component.id === item.componentId)!.name)).toEqual(['Squall']);
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
  });
});
