import { describe, expect, it } from 'vitest';
import { applyCommand, makeInstance, type Command } from '../src/domain';
import { applyPlaygroundCommand, emptyPlaygroundHistory, undoPlayground } from '../src/playgroundHistory';
import { blankProject, template } from '../src/templates';

function example() {
  const component = template('blank');
  return { ...blankProject(), components: [component], instances: [
    { ...makeInstance(component.id, 0, 111, 121), id: 'one' },
    { ...makeInstance(component.id, 0, 134, 168), id: 'two' },
  ] };
}
describe('atomic absolute selection movement', () => {
  it('moves each piece to an independent destination and undoes the entire drop together', () => {
    const project = example(), command: Command = { type: 'transform', ids: ['one', 'two'],
      positions: [{ id: 'one', x: 125, y: 125 }, { id: 'two', x: 150, y: 175 }] };
    const moved = applyPlaygroundCommand(project, emptyPlaygroundHistory(), command, project.players[0].id);
    expect(moved.project.instances.map(({ x, y }) => [x, y])).toEqual([[125, 125], [150, 175]]);
    expect(moved.project.components).toBe(project.components);
    expect(undoPlayground(moved.project, moved.history).project).toEqual(project);
  });

  it('rejects incomplete, extra, duplicate, nonfinite or ambiguous destinations without changing the source', () => {
    const project = example(), original = structuredClone(project);
    const valid = [{ id: 'one', x: 0, y: 0 }, { id: 'two', x: 25, y: 25 }];
    for (const positions of [valid.slice(0, 1), [...valid, valid[0]], [...valid, { id: 'extra', x: 0, y: 0 }],
      [valid[0], { id: 'missing', x: 0, y: 0 }], [valid[0], { ...valid[1], x: Infinity }]]) {
      expect(() => applyCommand(project, { type: 'transform', ids: ['one', 'two'], positions })).toThrow();
    }
    expect(() => applyCommand(project, { type: 'transform', ids: ['one', 'two'], positions: valid, dx: 0 })).toThrow('not both');
    expect(project).toEqual(original);
  });

  it('enforces locks, hand ownership and full-stack movement', () => {
    const project = example(), positions = [{ id: 'one', x: 0, y: 0 }, { id: 'two', x: 25, y: 25 }];
    const locked = { ...project, instances: project.instances.map(item => ({ ...item, locked: item.id === 'two' })) };
    expect(() => applyCommand(locked, { type: 'transform', ids: ['one', 'two'], positions })).toThrow('Unlock');
    const held = { ...project, instances: project.instances.map(item => ({ ...item, holder: project.players[0].id })) };
    expect(() => applyCommand(held, { type: 'transform', ids: ['one', 'two'], positions }, 'someone-else')).toThrow('Switch');
    const stack = applyCommand(project, { type: 'stack', ids: ['one', 'two'], stackId: 'stack' });
    expect(() => applyCommand(stack, { type: 'transform', ids: ['one'], positions: positions.slice(0, 1) })).toThrow('entire stack');
    expect(() => applyCommand(stack, { type: 'transform', ids: ['one', 'two'], positions })).toThrow('same destination');
    expect(applyCommand(stack, { type: 'transform', ids: ['one', 'two'], positions: positions.map(position => ({ ...position, x: 50, y: 50 })) }).instances.every(item => item.x === 50 && item.y === 50)).toBe(true);
  });
});
