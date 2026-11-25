import { describe, expect, it } from 'vitest';
import { applyCommand, validateProject, type Project } from '../src/domain';
import { starterProject } from '../src/templates';

const setup = () => {
  const p = starterProject();
  const card = p.components.find(c => c.kind === 'card')!, token = p.components.find(c => c.kind === 'token')!;
  return {
    p, card, token,
    deck: p.instances.filter(i => i.stack === 'starter-deck').sort((a, b) => a.order - b.order).map(i => i.id),
    cards: p.instances.filter(i => i.componentId === card.id && !i.stack).map(i => i.id),
    tokens: p.instances.filter(i => i.componentId === token.id).map(i => i.id),
  };
};
const members = (p: Project, stack: string) => p.instances.filter(i => i.stack === stack).sort((a, b) => a.order - b.order).map(i => i.id);
const record = (p: Project, stack: string) => (p.stacks ?? []).find(item => item.id === stack);

describe('persistent stacks', () => {
  it('keep a stack with one piece or none, and take pieces into an empty one', () => {
    const { p, deck, cards, token, tokens } = setup();
    let next = applyCommand(p, { type: 'persistStack', ids: deck, stackId: 'unused' });
    expect(record(next, 'starter-deck')).toMatchObject({ tag: '' });
    // Taking all but one piece off keeps the stack.
    for (const id of deck.slice(1).reverse()) next = applyCommand(next, { type: 'extractMove', id, x: 100, y: 100 });
    expect(members(next, 'starter-deck')).toEqual([deck[0]]);
    // The last one too: the stack stays as an empty slot where it was.
    const at = record(next, 'starter-deck')!;
    next = applyCommand(next, { type: 'extractMove', id: deck[0], x: 50, y: 50 });
    expect(members(next, 'starter-deck')).toEqual([]);
    expect(record(next, 'starter-deck')).toMatchObject({ x: at.x, y: at.y });
    next = applyCommand(next, { type: 'moveStack', stackId: 'starter-deck', x: 300, y: 320 });
    // Pieces dropped into the empty stack land on it, in order.
    next = applyCommand(next, { type: 'dropIntoStack', ids: [cards[0], cards[1]], stackId: 'starter-deck' });
    expect(members(next, 'starter-deck')).toEqual([cards[0], cards[1]]);
    expect(next.instances.find(i => i.id === cards[1])).toMatchObject({ x: 300, y: 320 });
    // Only stackable pieces that fit the stack's filter (spirit cards) go in.
    const die = next.instances.find(i => next.components.find(c => c.id === i.componentId)?.kind === 'dice')!;
    expect(() => applyCommand(next, { type: 'dropIntoStack', ids: [die.id], stackId: 'starter-deck' })).toThrow("can't be stacked");
    expect(() => applyCommand(next, { type: 'dropIntoStack', ids: [tokens[0]], stackId: 'starter-deck' })).toThrow('takes spirit');
    expect(() => validateProject(next)).not.toThrow();
    void token;
  });

  it('turn single pieces into stacks, keep their id when merged, and can be made ordinary again', () => {
    const { p, cards, tokens } = setup();
    let next = applyCommand(p, { type: 'persistStack', ids: [tokens[0]], stackId: 'amber-pile' });
    expect(members(next, 'amber-pile')).toEqual([tokens[0]]);
    expect(record(next, 'amber-pile')!.filter).toEqual({ anyOf: [{ has: ['amber'], lacks: [] }] });
    // Dropping a token on it merges under the persistent stack's id, whatever id the drop asked for.
    next = applyCommand(next, { type: 'dropStack', ids: [tokens[1]], targetId: tokens[0], stackId: 'fresh' });
    expect(members(next, 'amber-pile')).toEqual([tokens[0], tokens[1]]);
    expect(next.instances.some(i => i.stack === 'fresh')).toBe(false);
    // Several loose pieces are stacked first.
    next = applyCommand(next, { type: 'persistStack', ids: [cards[0], cards[1]], stackId: 'pair' });
    expect(members(next, 'pair')).toEqual([cards[0], cards[1]]);
    // Ordinary again: a stack of one stops being a stack, an empty one disappears.
    next = applyCommand(next, { type: 'extractMove', id: cards[1], x: 10, y: 10 });
    next = applyCommand(next, { type: 'unpersistStack', stackId: 'pair' });
    expect(next.instances.find(i => i.id === cards[0])!.stack).toBeNull();
    expect(record(next, 'pair')).toBeUndefined();
  });

  it('keep their filter, which decides who may join, even while empty', () => {
    const { p, tokens, token } = setup();
    const silver = { ...token, id: 'silver', name: 'Silver token', stackTags: ['silver'] };
    let next = applyCommand(p, { type: 'addComponents', components: [silver] });
    next = applyCommand(next, { type: 'spawn', instances: [{ ...next.instances.find(i => i.id === tokens[0])!, id: 'coin', componentId: 'silver', stack: null, group: undefined }] });
    next = applyCommand(next, { type: 'persistStack', ids: [tokens[0]], stackId: 'pile' });
    expect(() => applyCommand(next, { type: 'dropIntoStack', ids: ['coin'], stackId: 'pile' })).toThrow('takes amber');
    next = applyCommand(next, { type: 'extractMove', id: tokens[0], x: 0, y: 0 });
    // Empty, it keeps taking amber only; widening the filter lets silver in.
    expect(() => applyCommand(next, { type: 'dropIntoStack', ids: ['coin'], stackId: 'pile' })).toThrow('takes amber');
    next = applyCommand(next, { type: 'setStackFilter', stackId: 'pile', filter: { anyOf: [{ has: ['amber'], lacks: [] }, { has: ['silver'], lacks: [] }] } });
    next = applyCommand(next, { type: 'dropIntoStack', ids: ['coin', tokens[1]], stackId: 'pile' });
    expect(members(next, 'pile')).toEqual(['coin', tokens[1]]);
    expect(next.instances.filter(i => i.stack === 'pile').every(i => !i.stackFilter)).toBe(true);
  });
});
