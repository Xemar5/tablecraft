import { describe, expect, it } from 'vitest';
import { applyCommand, makeInstance, stackFilterOf, type Component, type Project } from '../src/domain';
import { commonTags, describeFilter, matchesTags, type TagFilter } from '../src/tags';
import { blankProject, template } from '../src/templates';

const component = (id: string, stackTags: string[]): Component => ({ ...template('token'), id, name: id, stackTag: '', stackTags, stackable: true });
/** A table with one loose piece of each component, ids `piece-<component>`. */
function table(...components: Component[]): Project {
  const p = blankProject();
  return { ...p, components, instances: components.map((c, n) => ({ ...makeInstance(c.id, 0, 100 * n, 0), id: `piece-${c.id}` })) };
}
const filter = (p: Project, piece: string) => stackFilterOf(p, p.instances.find(i => i.id === piece)!.stack!);

describe('stack tags and filters', () => {
  it('match rules: (blue and red) or not white', () => {
    const rules: TagFilter = { anyOf: [{ has: ['blue', 'red'], lacks: [] }, { has: [], lacks: ['white'] }] };
    expect(matchesTags(rules, ['blue', 'red', 'white'])).toBe(true);
    expect(matchesTags(rules, ['Blue', 'RED'])).toBe(true);
    expect(matchesTags(rules, ['blue', 'white'])).toBe(false);
    expect(matchesTags(rules, ['green'])).toBe(true);
    // Untagged components fit everything, and a filter without rules takes anything.
    expect(matchesTags(rules, [])).toBe(true);
    expect(matchesTags({ anyOf: [] }, ['white'])).toBe(true);
    expect(describeFilter(rules)).toBe('blue and red or not white');
    expect(commonTags([['a', 'b'], [], ['B', 'c']])).toEqual({ tags: ['b'], shared: true });
    expect(commonTags([['a'], ['c']]).shared).toBe(false);
  });

  it('give a new stack every tag its pieces share, and refuse pieces with none in common', () => {
    let p = table(component('red-blue', ['red', 'blue']), component('red-blue-gold', ['red', 'blue', 'gold']), component('plain', []), component('green', ['green']));
    p = applyCommand(p, { type: 'stack', ids: ['piece-red-blue', 'piece-red-blue-gold', 'piece-plain'], stackId: 's' });
    expect(filter(p, 'piece-plain')).toEqual({ anyOf: [{ has: ['red'], lacks: [] }, { has: ['blue'], lacks: [] }] });
    expect(p.instances.filter(i => i.stack === 's').every(i => i.stackFilter)).toBe(true);
    // Green shares nothing with the stack's filter; a fresh stack of red and green pieces can't form either.
    expect(() => applyCommand(p, { type: 'dropStack', ids: ['piece-green'], targetId: 'piece-plain', stackId: 'x' })).toThrow('takes red or blue');
    const q = table(component('red', ['red']), component('green', ['green']));
    expect(() => applyCommand(q, { type: 'stack', ids: ['piece-red', 'piece-green'], stackId: 'y' })).toThrow('no stack tag in common');
    expect(() => applyCommand(q, { type: 'dropStack', ids: ['piece-green'], targetId: 'piece-red', stackId: 'y' })).toThrow('no stack tag in common');
  });

  it('let untagged pieces into any stack and keep the target’s filter when stacks merge', () => {
    let p = table(component('gold', ['gold']), component('gold-2', ['gold', 'coin']), component('plain', []), component('plain-2', []));
    p = applyCommand(p, { type: 'stack', ids: ['piece-gold', 'piece-gold-2'], stackId: 'coins' });
    p = applyCommand(p, { type: 'dropStack', ids: ['piece-plain'], targetId: 'piece-gold', stackId: 'merged' });
    expect(p.instances.filter(i => i.stack === 'merged')).toHaveLength(3);
    expect(filter(p, 'piece-plain')).toEqual({ anyOf: [{ has: ['gold'], lacks: [] }] });
    // Untagged pieces alone make a stack that takes anything.
    p = applyCommand(p, { type: 'extractMove', id: 'piece-plain', x: 0, y: 0 });
    p = applyCommand(p, { type: 'stack', ids: ['piece-plain', 'piece-plain-2'], stackId: 'loose' });
    expect(filter(p, 'piece-plain')).toEqual({ anyOf: [] });
    p = applyCommand(p, { type: 'dropStack', ids: ['merged'].flatMap(stack => p.instances.filter(i => i.stack === stack).map(i => i.id)), targetId: 'piece-plain', stackId: 'all' });
    expect(p.instances.filter(i => i.stack === 'all')).toHaveLength(4);
  });

  it('edit an ordinary stack’s filter, kept when it becomes persistent and back', () => {
    let p = table(component('blue', ['blue']), component('blue-2', ['blue', 'white']), component('white', ['white']));
    p = applyCommand(p, { type: 'stack', ids: ['piece-blue', 'piece-blue-2'], stackId: 's' });
    const notWhite: TagFilter = { anyOf: [{ has: [], lacks: ['white'] }] };
    p = applyCommand(p, { type: 'setStackFilter', stackId: 's', filter: notWhite });
    expect(() => applyCommand(p, { type: 'dropStack', ids: ['piece-white'], targetId: 'piece-blue', stackId: 't' })).toThrow('takes not white');
    p = applyCommand(p, { type: 'persistStack', ids: ['piece-blue', 'piece-blue-2'], stackId: 'unused' });
    expect(p.stacks?.[0].filter).toEqual(notWhite);
    expect(p.instances.some(i => i.stackFilter)).toBe(false);
    p = applyCommand(p, { type: 'unpersistStack', stackId: 's' });
    expect(filter(p, 'piece-blue')).toEqual(notWhite);
    // Pieces leaving a stack drop its filter.
    p = applyCommand(p, { type: 'unstack', id: 'piece-blue' });
    expect(p.instances.some(i => i.stackFilter)).toBe(false);
  });
});
