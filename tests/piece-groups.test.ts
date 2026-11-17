import { describe, expect, it } from 'vitest';
import { applyCommand, makeInstance, validateProject, type Project } from '../src/domain';
import { applyPlaygroundCommand, emptyPlaygroundHistory, undoPlayground } from '../src/playgroundHistory';
import { createGroupCommand, groupMembers, groupSelection, nextGroupName, pieceTree, selectedGroups } from '../src/pieceGroups';
import { starterProject } from '../src/templates';

const ids = (p: Project) => {
  const card = p.components.find(c => c.kind === 'card')!.id, token = p.components.find(c => c.kind === 'token')!.id;
  return {
    deck: p.instances.filter(i => i.stack === 'starter-deck').map(i => i.id),
    cards: p.instances.filter(i => i.componentId === card && !i.stack).map(i => i.id),
    tokens: p.instances.filter(i => i.componentId === token).map(i => i.id),
  };
};
const group = (p: Project, id: string, name: string, pieces: string[], groups: string[] = [], parent: string | null = null) =>
  applyCommand(p, { type: 'createGroup', id, name, parent, ids: pieces, groups });

describe('piece groups', () => {
  it('groups whole stacks, renames, nests and ungroups without moving anything on the table', () => {
    const p = starterProject(), { deck, cards, tokens } = ids(p);
    let next = group(p, 'tokens', 'Amber', tokens.slice(0, 2));
    next = group(next, 'deck', 'Deck', [deck[3]]);
    expect(next.instances.filter(i => i.stack === 'starter-deck').every(i => i.group === 'deck')).toBe(true);
    expect(next.instances.map(({ group: _group, ...rest }) => rest)).toEqual(p.instances);
    next = group(next, 'outer', 'Supplies', [cards[0]], ['tokens', 'deck']);
    expect(next.groups).toEqual([
      { id: 'tokens', name: 'Amber', parent: 'outer' }, { id: 'deck', name: 'Deck', parent: 'outer' }, { id: 'outer', name: 'Supplies', parent: null },
    ]);
    expect(groupMembers(next, 'outer').sort()).toEqual([...tokens.slice(0, 2), ...deck, cards[0]].sort());
    next = applyCommand(next, { type: 'renameGroup', id: 'outer', name: '  Market  ' });
    expect(next.groups!.find(g => g.id === 'outer')!.name).toBe('Market');
    next = applyCommand(next, { type: 'ungroup', ids: ['outer'] });
    expect(next.groups).toEqual([{ id: 'tokens', name: 'Amber', parent: null }, { id: 'deck', name: 'Deck', parent: null }]);
    expect(next.instances.find(i => i.id === cards[0])!.group).toBeUndefined();
    expect(() => applyCommand(next, { type: 'renameGroup', id: 'missing', name: 'x' })).toThrow('no longer exists');
    expect(() => applyCommand(next, { type: 'renameGroup', id: 'deck', name: '   ' })).toThrow();
  });

  it('moves pieces and groups between groups, rejects cycles and removes groups that become empty', () => {
    const p = starterProject(), { cards, tokens } = ids(p);
    let next = group(p, 'a', 'A', [cards[0]]);
    next = group(next, 'b', 'B', [cards[1]], [], 'a');
    expect(() => applyCommand(next, { type: 'moveToGroup', parent: 'b', ids: [], groups: ['a'] })).toThrow('into itself');
    expect(() => applyCommand(next, { type: 'createGroup', id: 'c', name: 'C', parent: 'b', ids: [], groups: ['a'] })).toThrow('into itself');
    next = applyCommand(next, { type: 'moveToGroup', parent: 'b', ids: [tokens[0]], groups: [] });
    expect(next.instances.find(i => i.id === tokens[0])!.group).toBe('b');
    next = applyCommand(next, { type: 'moveToGroup', parent: null, ids: [cards[0]], groups: ['b'] });
    // "a" lost its last piece and subgroup, so it disappears.
    expect(next.groups).toEqual([{ id: 'b', name: 'B', parent: null }]);
    next = applyCommand(next, { type: 'delete', ids: [cards[1], tokens[0]] });
    expect(next.groups).toBeUndefined();
    expect(() => applyCommand(p, { type: 'createGroup', id: 'x', name: 'X', parent: null, ids: [], groups: [] })).toThrow('Select pieces or groups');
  });

  it('keeps stacks in one group, drops held pieces from groups and validates references', () => {
    const p = starterProject(), { cards } = ids(p);
    let next = group(p, 'played', 'Played', [cards[0]]);
    // Stacking adopts the group of the bottom piece.
    next = applyCommand(next, { type: 'stack', ids: [cards[1], cards[0]], stackId: 'pile' });
    expect(next.instances.filter(i => i.stack === 'pile').map(i => i.group)).toEqual([undefined, undefined]);
    expect(next.groups).toBeUndefined();
    next = group(next, 'pile-group', 'Pile', [cards[0]]);
    expect(next.instances.filter(i => i.stack === 'pile').every(i => i.group === 'pile-group')).toBe(true);
    next = applyCommand(next, { type: 'drawSelection', ids: next.instances.filter(i => i.stack === 'pile').map(i => i.id), playerId: 'player-1' }, 'player-1');
    expect(next.instances.filter(i => i.holder).every(i => i.group === undefined)).toBe(true);
    expect(next.groups).toBeUndefined();
    const held = next.instances.find(i => i.holder)!;
    expect(() => applyCommand(next, { type: 'createGroup', id: 'h', name: 'Hand', parent: null, ids: [held.id], groups: [] })).toThrow('Only table pieces');
    expect(() => validateProject({ ...p, instances: p.instances.map((i, n) => n ? i : { ...i, group: 'nope' }) })).toThrow('missing group');
    expect(() => validateProject({ ...p, groups: [{ id: 'g', name: 'G', parent: 'g' }] })).toThrow();
    const split = p.instances.map(i => i.id === ids(p).deck[0] ? { ...i, group: 'g' } : i);
    expect(() => validateProject({ ...p, groups: [{ id: 'g', name: 'G', parent: null }], instances: split })).toThrow('share its group');
  });

  it('undoes grouping with the rest of the table', () => {
    const p = starterProject(), { tokens } = ids(p);
    const result = applyPlaygroundCommand(p, emptyPlaygroundHistory(), { type: 'createGroup', id: 'g', name: 'Tokens', parent: null, ids: tokens, groups: [] }, 'player-1');
    const renamed = applyPlaygroundCommand(result.project, result.history, { type: 'renameGroup', id: 'g', name: 'Amber' }, 'player-1');
    const back = undoPlayground(renamed.project, renamed.history);
    expect(back.project.groups).toEqual([{ id: 'g', name: 'Tokens', parent: null }]);
    expect(undoPlayground(back.project, back.history).project).toEqual(p);
  });

  it('plans grouping from the selection: whole groups nest, loose pieces join, in the deepest common group', () => {
    const p = starterProject(), { deck, cards, tokens } = ids(p);
    let next = group(p, 'outer', 'Outer', [cards[0]]);
    next = group(next, 'inner', 'Inner', tokens.slice(0, 2), [], 'outer');
    expect(selectedGroups(next, tokens.slice(0, 2)).map(g => g.id)).toEqual(['inner']);
    expect(selectedGroups(next, [cards[0], ...tokens.slice(0, 2)]).map(g => g.id)).toEqual(['outer']);
    expect(groupSelection(next, [...tokens.slice(0, 2), cards[1]])).toEqual({ ids: [cards[1]], groups: ['inner'], parent: null });
    expect(groupSelection(next, [tokens[0]])).toEqual({ ids: [tokens[0]], groups: [], parent: 'inner' });
    expect(groupSelection(next, [tokens[0], cards[0]])).toEqual({ ids: [cards[0], tokens[0]].sort((a, b) => next.instances.findIndex(i => i.id === a) - next.instances.findIndex(i => i.id === b)), groups: [], parent: 'outer' });
    // A selected stack member brings the whole stack.
    expect(groupSelection(next, [deck[0]])!.ids).toEqual(deck);
    expect(groupSelection(next, [])).toBeUndefined();
    expect(nextGroupName(next)).toBe('Group 1');
    const command = createGroupCommand(next, [cards[1]])!;
    expect(command).toMatchObject({ type: 'createGroup', name: 'Group 1', ids: [cards[1]], groups: [], parent: null });
    expect(nextGroupName(applyCommand(next, command))).toBe('Group 2');
  });

  it('lists groups and pieces topmost first with collapsible groups and expandable stacks', () => {
    const p = starterProject(), { deck, tokens } = ids(p);
    const next = group(p, 'g', 'Tokens', tokens);
    const rows = pieceTree(next, new Set(), new Set());
    const groupRow = rows.findIndex(row => row.kind === 'group');
    expect(rows[groupRow]).toMatchObject({ kind: 'group', depth: 0, count: tokens.length, expanded: true });
    expect(rows.slice(groupRow + 1, groupRow + 1 + tokens.length).map(row => row.kind === 'piece' && row.item.id)).toEqual([...tokens].reverse());
    expect(rows.slice(groupRow + 1, groupRow + 1 + tokens.length).every(row => row.depth === 1)).toBe(true);
    const collapsed = pieceTree(next, new Set(['g']), new Set(['starter-deck']));
    expect(collapsed.filter(row => row.kind === 'piece' && row.depth === 1).map(row => row.kind === 'piece' && row.item.id)).toEqual([...deck].reverse());
    expect(collapsed.some(row => row.kind === 'piece' && tokens.includes(row.item.id))).toBe(false);
    // The board is always the bottom row.
    expect(rows.at(-1)).toMatchObject({ kind: 'piece', item: { componentId: p.components.find(c => c.kind === 'board')!.id } });
    const extra = applyCommand(next, { type: 'spawn', instances: [makeInstance(p.components.find(c => c.kind === 'token')!.id)] });
    expect(pieceTree(extra, new Set(), new Set())[0]).toMatchObject({ kind: 'piece', depth: 0 });
  });
});
