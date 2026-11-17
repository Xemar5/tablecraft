import { describe, expect, it } from 'vitest';
import { starterProject } from '../src/templates';
import { hoverPreviewWidth, previewOnLeft, previewPermission, snappedPositions } from '../src/playgroundPreview';

const project = starterProject();
const component = { ...project.components.find(c => c.kind === 'card')!, flippable: true, hideInHand: true };
const item = { ...project.instances.find(i => i.componentId === component.id)!, stack: null };

describe('isolated preview permissions', () => {
  it('uses the visible face of reversed stacks', () => {
    expect(previewPermission({ ...item, stack: 'stack', stackReversed: true, flipped: false }, component, 'player-1', false).back).toBe(true);
    expect(previewPermission({ ...item, stack: 'stack', stackReversed: true, flipped: true }, component, 'player-1', false).back).toBe(false);
  });
  it('never reveals another hidden hand, including nonflippable pieces', () => {
    for (const viewer of [true, false]) for (const flippable of [true, false]) {
      expect(previewPermission({ ...item, holder: 'player-2', flipped: false }, { ...component, flippable }, 'player-1', viewer))
        .toEqual({ back: true, hidden: true, canFlip: false });
    }
  });
  it('allows your hand and publicly visible hands to be inspected', () => {
    expect(previewPermission({ ...item, holder: 'player-1', flipped: false }, component, 'player-1', false).canFlip).toBe(true);
    expect(previewPermission({ ...item, holder: 'player-2', flipped: false }, { ...component, hideInHand: false }, '', true).canFlip).toBe(true);
  });
  it('restricts spectators to the back of face-down pieces', () => {
    expect(previewPermission({ ...item, holder: null, flipped: true }, component, '', true)).toMatchObject({ back: true, canFlip: false });
    expect(previewPermission({ ...item, holder: null, flipped: false }, component, '', true)).toMatchObject({ back: false, canFlip: true });
  });
});

describe('individual grid snapping', () => {
  it('snaps each final position, not a shared delta', () => {
    expect(snappedPositions({ a: { x: 101, y: 112 }, b: { x: 214, y: 223 } }, { x: 6, y: -4 }, 20))
      .toEqual([{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 220, y: 220 }]);
  });
  it('preserves coincident stack members and handles negative coordinates', () => {
    expect(snappedPositions({ a: { x: -27, y: 41 }, b: { x: -27, y: 41 } }, { x: 3, y: 5 }, 20))
      .toEqual([{ id: 'a', x: -20, y: 40 }, { id: 'b', x: -20, y: 40 }]);
  });
});

it('hover side placement has no dependency on mounted thumbnail geometry', () => {
  expect(previewOnLeft(100, 0, 900)).toBe(false);
  expect(previewOnLeft(800, 0, 900)).toBe(true);
  expect(previewOnLeft(348, 0, 600)).toBe(true);
  expect(hoverPreviewWidth(1)).toBe(240);
  expect(hoverPreviewWidth(3)).toBe(498);
  expect(previewOnLeft(300, 0, 600, hoverPreviewWidth(3))).toBe(true);
});
