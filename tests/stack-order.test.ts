import { describe, expect, it } from 'vitest';
import { applyCommand, makeInstance, type Project } from '../src/domain';
import { stackPlan, stackSlot } from '../src/stackOrder';
import { starterProject, template } from '../src/templates';

function table(): Project {
  const project = starterProject();
  const card = { ...template('card'), id: 'card', stackable: true };
  const token = { ...template('token'), id: 'token', stackable: true, stackTag: '' };
  project.components = [card, token];
  project.instances = [
    ...['a', 'b', 'c'].map((id, order) => ({ ...makeInstance(card.id), id, order })),
    { ...makeInstance(token.id), id: 't', order: 0 },
  ];
  project.players = [];
  return project;
}

describe('stack order preview', () => {
  it('numbers table units in selection order and stacks the first selected at the bottom', () => {
    const project = table();
    const plan = stackPlan(project, ['c', 'a', 'b']);
    expect(plan).toEqual({ units: ['c', 'a', 'b'] });
    const stacked = applyCommand(project, { type: 'stack', ids: ['c', 'a', 'b'], stackId: 'deck' });
    expect(stacked.instances.filter(i => i.stack === 'deck').sort((x, y) => x.order - y.order).map(i => i.id)).toEqual(['c', 'a', 'b']);
    expect(['c', 'a', 'b'].map((_, index) => stackSlot(index, 3))).toEqual(['bottom', 'middle', 'top']);
  });
  it('treats an existing stack as one unit and ignores single units or held pieces', () => {
    const project = applyCommand(table(), { type: 'stack', ids: ['a', 'b'], stackId: 'deck' });
    expect(stackPlan(project, ['a', 'b'])).toBeUndefined();
    expect(stackPlan(project, ['c', 'a', 'b'])?.units).toEqual(['c', 'deck']);
    project.instances.find(i => i.id === 'c')!.holder = 'someone';
    expect(stackPlan(project, ['c', 'a', 'b'])).toBeUndefined();
  });
  it('explains why incompatible pieces cannot be stacked', () => {
    expect(stackPlan(table(), ['a', 't'])?.error).toMatch(/compatible stackable/);
  });
});
