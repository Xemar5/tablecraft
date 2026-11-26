import { describe, expect, it } from 'vitest';
import { makeNode } from '../src/domain';
import { axisRules, canHug, ignoredBecause, sizingOf, sizingUnavailable } from '../src/layoutRules';

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

  it('says why a sizing isn’t available, so the inspector can gray it out', () => {
    const nodes = [absolute, row];
    const unavailable = (node: ReturnType<typeof makeNode>, axis: 'x' | 'y', mode: 'fixed' | 'hug' | 'fill', all = nodes) => sizingUnavailable(node, [...all, node], axis, mode);
    for (const mode of ['fixed', 'hug', 'fill'] as const) expect(unavailable(makeNode('text'), 'x', mode)).toBeUndefined();
    expect(unavailable(makeNode('shape'), 'x', 'hug')).toMatch(/Only text and stack frames/);
    expect(unavailable(makeNode('frame', { layout: 'absolute' }), 'y', 'hug')).toMatch(/stack layout/);
    expect(unavailable(makeNode('text', { autoFontSize: true }), 'x', 'hug')).toMatch(/Auto font size/);
    expect(sizingOf(makeNode('text', { autoFontSize: true, widthMode: 'hug' }), 'x')).toBe('fixed');
    // A stack that hugs along its direction has no free space for a child to fill, and the reverse.
    const hugging = makeNode('frame', { layout: 'row', widthMode: 'hug' });
    const child = makeNode('text', { parent: hugging.id, widthMode: 'fill' });
    expect(unavailable(makeNode('text', { parent: hugging.id }), 'x', 'fill', [hugging])).toMatch(/hugs its width/);
    expect(unavailable(makeNode('text', { parent: hugging.id }), 'y', 'fill', [hugging])).toBeUndefined();
    expect(sizingUnavailable(row, [row, { ...child, parent: row.id }], 'x', 'hug')).toMatch(/child fills this stack’s width/);
    expect(sizingUnavailable(row, [row, { ...child, parent: row.id }], 'y', 'hug')).toBeUndefined();
    // Boolean groups combine their shapes' fixed outlines.
    const compound = makeNode('compound');
    expect(unavailable(makeNode('shape', { parent: compound.id }), 'x', 'fill', [compound])).toMatch(/boolean group/);
  });

  it('explains why a field is ignored', () => {
    expect(ignoredBecause(axisRules(makeNode('text', { widthMode: 'fill' }), absolute, 'x'), 'position', 'x')).toMatch(/left and right margins/);
    expect(ignoredBecause(axisRules(makeNode('text'), row, 'x'), 'position', 'x')).toMatch(/stack layout/);
    expect(ignoredBecause(axisRules(makeNode('text', { heightMode: 'hug' }), absolute, 'y'), 'size', 'y')).toMatch(/fit what it contains/);
    expect(ignoredBecause(axisRules(makeNode('text'), absolute, 'x'), 'position', 'x')).toBeUndefined();
  });
});
