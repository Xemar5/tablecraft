/**
 * The interface scale zooms the whole page with CSS `zoom` on the root element. Under standard CSS zoom, pointer
 * coordinates and `getBoundingClientRect()` are in viewport pixels while lengths written to styles are in the page's
 * own (unzoomed) CSS pixels, so code that turns pointer positions into style positions divides by `uiScale()`.
 */
export const UI_SCALE_MIN = 50;
export const UI_SCALE_MAX = 200;
export const UI_SCALE_PRESETS = [75, 90, 100, 110, 125, 150];

let scale = 1;

/** Browsers without standard CSS zoom (which reports `currentCSSZoom`) stay at 100%. */
const supported = () => typeof document !== 'undefined' && 'currentCSSZoom' in document.documentElement;

export function clampUiScale(percent: number) {
  return Math.round(Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, Number.isFinite(percent) ? percent : 100)));
}

export function applyUiScale(percent: number) {
  if (!supported()) { scale = 1; return; }
  scale = clampUiScale(percent) / 100;
  const root = document.documentElement.style;
  root.zoom = scale === 1 ? '' : String(scale);
  // Viewport units are zoomed too; styles divide them by this to keep fitting the window.
  if (scale === 1) root.removeProperty('--ui-scale'); else root.setProperty('--ui-scale', String(scale));
}

/** The current interface zoom factor (1 at 100%). */
export const uiScale = () => scale;

/** Converts a viewport length (pointer or bounding-rect pixels) into page CSS pixels. */
export const cssPx = (viewportPixels: number) => viewportPixels / scale;
