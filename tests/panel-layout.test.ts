import { describe, expect, it } from 'vitest';
import { clampPanel, resolvePanelSizes } from '../src/panelLayout';

const sizes = { library: 400, layers: 300, designerInspector: 350, playgroundInspector: 300, hand: 300 };

describe('panel sizing', () => {
  it('keeps canvas space while leaving preferred sizes intact', () => {
    const resolved = resolvePanelSizes(sizes, 800, 650, 'designer', true, true);
    expect(resolved.sizes.library + resolved.sizes.layers + resolved.sizes.designerInspector).toBeLessThanOrEqual(800 - 200 - 18);
    expect(sizes.library).toBe(400);
    expect(resolved.sizes.hand).toBe(300);
  });
  it('handles hidden panels and limits hand height', () => {
    const resolved = resolvePanelSizes(sizes, 800, 450, 'playground', false, false);
    expect(resolved.sizes.hand).toBe(180);
    expect(resolved.limits.hand.max).toBe(180);
    expect(clampPanel(900, 90, 180)).toBe(180);
  });
  it('fits the layers panel in both modes only while it is visible', () => {
    expect(resolvePanelSizes(sizes, 1400, 650, 'playground', true, true).limits.layers).toBeDefined();
    expect(resolvePanelSizes(sizes, 1400, 650, 'playground', true, true, false).limits.layers).toBeUndefined();
    expect(resolvePanelSizes(sizes, 1400, 650, 'designer', true, true, false).limits.layers).toBeUndefined();
  });
});
