import { describe, expect, it } from 'vitest';
import { reorder } from '../src/zOrder';

const list = ['a', 'b', 'c', 'd', 'e'];
const pick = (...ids: string[]) => (item: string) => ids.includes(item);

describe('reorder', () => {
  it('moves the chosen items to the front or back as a block, keeping their order', () => {
    expect(reorder(list, pick('b', 'd'), 'front')).toEqual(['a', 'c', 'e', 'b', 'd']);
    expect(reorder(list, pick('b', 'd'), 'back')).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  it('steps each chosen item past one neighbour', () => {
    expect(reorder(list, pick('b'), 'forward')).toEqual(['a', 'c', 'b', 'd', 'e']);
    expect(reorder(list, pick('b'), 'backward')).toEqual(['b', 'a', 'c', 'd', 'e']);
    expect(reorder(list, pick('b', 'd'), 'forward')).toEqual(['a', 'c', 'b', 'e', 'd']);
    expect(reorder(list, pick('b', 'd'), 'backward')).toEqual(['b', 'a', 'd', 'c', 'e']);
  });

  it('leaves items already at the end, and chosen neighbours, in place', () => {
    expect(reorder(list, pick('e'), 'forward')).toEqual(list);
    expect(reorder(list, pick('a'), 'backward')).toEqual(list);
    expect(reorder(list, pick('d', 'e'), 'forward')).toEqual(list);
    expect(reorder(list, pick('c', 'd'), 'forward')).toEqual(['a', 'b', 'e', 'c', 'd']);
  });

  it('with an overlap test, steps past the next overlapping item and skips ones it does not touch', () => {
    const touches = (a: string, b: string) => [a, b].sort().join('') === 'ad';
    expect(reorder(list, pick('a'), 'forward', touches)).toEqual(['b', 'c', 'd', 'a', 'e']);
    expect(reorder(list, pick('d'), 'backward', touches)).toEqual(['d', 'a', 'b', 'c', 'e']);
    // Nothing above touches it, so it stays.
    expect(reorder(list, pick('b'), 'forward', touches)).toEqual(list);
  });
});
