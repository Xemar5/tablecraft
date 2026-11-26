import { describe, expect, it } from 'vitest';
import { makeNode } from '../src/domain';
import { axisRules, canHug, ignoredBecause, sizingOf } from '../src/layoutRules';

describe('layout rules', () => {
  const absolute = makeNode('frame', { layout: 'absolute' }), row = makeNode('frame', { layout: 'row' });

  it('lets only text and stack frames hug, treating other saved Hug layers as Fixed', () => {
    expect([makeNode('text'), row, absolute, makeNode('shape'), makeNode('image'), makeNode('component')].map(canHug))
      .toEqual([true, true, false, false, false, false]);
    expect(sizingOf(makeNode('shape', { widthMode: 'hug' }), 'x')).toBe('fixed');
    expect(sizingOf(makeNode('text', { heightMode: 'hug' }), 'y')).toBe('hug');
  });

  it('places Fixed and Hug layers by X/Y in absolute parents, and Fill layers by their margins', () => {
    const rules = (values: Parameters<typeof makeNode>[1], parent = absolute) => axisRules(makeNode('text', values), parent, 'x');
    expect(rules({ widthMode: 'fixed' })).toMatchObject({ position: true, size: true, margins: false });
    expect(rules({ widthMode: 'hug' })).toMatchObject({ position: true, size: false, margins: false });
    expect(rules({ widthMode: 'fill' })).toMatchObject({ position: false, size: false, margins: true });
    // The top of a face places layers like an absolute frame.
    expect(axisRules(makeNode('text', { widthMode: 'hug' }), undefined, 'x')).toMatchObject({ position: true, size: false });
  });

  it('lets a stack place its children, with margins around them and the size only when Fixed', () => {
    for (const mode of ['fixed', 'hug', 'fill'] as const) {
      expect(axisRules(makeNode('text', { heightMode: mode }), row, 'y')).toMatchObject({ stacked: true, position: false, size: mode === 'fixed', margins: true });
    }
  });

  it('explains why a field is ignored', () => {
    expect(ignoredBecause(axisRules(makeNode('text', { widthMode: 'fill' }), absolute, 'x'), 'position', 'x')).toMatch(/left and right margins/);
    expect(ignoredBecause(axisRules(makeNode('text'), row, 'x'), 'position', 'x')).toMatch(/stack layout/);
    expect(ignoredBecause(axisRules(makeNode('text', { heightMode: 'hug' }), absolute, 'y'), 'size', 'y')).toMatch(/fit what it contains/);
    expect(ignoredBecause(axisRules(makeNode('text'), absolute, 'x'), 'position', 'x')).toBeUndefined();
  });
});
