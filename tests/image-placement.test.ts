import { describe, expect, it } from 'vitest';
import { resizeCenteredBox } from '../src/designTransform';
import { fittedImageSize } from '../src/ComponentView';

describe('picture placement', () => {
  it('fits pictures by mode and resizes a rotated box from a handle keeping the opposite corner', () => {
    expect(fittedImageSize('cover', { width: 200, height: 100 }, 100, 100)).toEqual({ width: 200, height: 100 });
    expect(fittedImageSize('contain', { width: 200, height: 100 }, 100, 100)).toEqual({ width: 100, height: 50 });
    expect(fittedImageSize('original', { width: 30, height: 40 }, 100, 100)).toEqual({ width: 30, height: 40 });
    expect(fittedImageSize('stretch', { width: 30, height: 40 }, 100, 80)).toEqual({ width: 100, height: 80 });
    const box = { cx: 50, cy: 50, width: 100, height: 50, rotation: 0 };
    expect(resizeCenteredBox(box, 1, 1, 20, 0, 0, true)).toEqual({ cx: 60, cy: 55, width: 120, height: 60, rotation: 0 });
    expect(resizeCenteredBox(box, 1, 0, 20, 30, 0, true)).toEqual({ cx: 60, cy: 50, width: 120, height: 50, rotation: 0 });
    const turned = resizeCenteredBox({ ...box, rotation: 90 }, 1, 0, 0, 20, 0, false);
    expect(turned.width).toBeCloseTo(120); expect(turned.cx).toBeCloseTo(50); expect(turned.cy).toBeCloseTo(60);
    expect(resizeCenteredBox(box, -1, 0, 500, 0, 0, false).width).toBe(2);
  });
});
