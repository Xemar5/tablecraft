import { visibleBack, type Component, type Instance } from './domain';

/** Match table-hand visual privacy; a spectator cannot inspect a face-down table piece's front. */
export function previewPermission(item: Instance, component: Component, actor: string, viewer: boolean) {
  const hidden = !!item.holder && item.holder !== actor && component.hideInHand;
  const back = hidden || visibleBack(item);
  return { back, hidden, canFlip: component.flippable && !hidden && !(viewer && back) };
}

/** The preview's padding and border on each axis, its distance from the table's edges, and its narrowest width (for the shortcuts). */
const PREVIEW_PAD = 18, PREVIEW_MARGIN = 16, PREVIEW_MIN_WIDTH = 180, PREVIEW_MAX_WIDTH = 600;
/**
 * The hover preview's width and the width its art is drawn at. The art fills the preview inside its padding, and shrinks
 * (keeping its aspect ratio) so the whole preview fits the table: `room` is the table's size and `chrome` is the preview's
 * height without the art (padding, name and shortcuts). There is no scrolling.
 */
export function hoverPreviewSize(scale: number, aspect: number, room?: { width: number; height: number }, chrome = 0) {
  let art = Math.min(PREVIEW_MAX_WIDTH - PREVIEW_PAD, 270 * scale);
  if (room && room.width > 0 && room.height > 0) {
    // At most half the table wide (less its margin and a gap), so it can switch sides away from the pointer.
    art = Math.min(art, room.width / 2 - 28 - PREVIEW_PAD, (room.height - PREVIEW_MARGIN * 2 - chrome) / aspect);
  }
  art = Math.max(24, Math.floor(art));
  const width = Math.max(art + PREVIEW_PAD, Math.min(PREVIEW_MIN_WIDTH, room ? room.width / 2 - 28 : PREVIEW_MIN_WIDTH));
  return { width, art };
}
/** The same width is used before and after the thumbnail mounts: 288px at scale 1. */
export const hoverPreviewWidth = (scale: number) => hoverPreviewSize(scale, 1).width;
export function previewOnLeft(clientX: number, left: number, width: number, previewWidth = hoverPreviewWidth(1)) {
  return clientX >= Math.min(left + width * 2 / 3, Math.max(left + width / 2, left + width - 16 - Math.min(previewWidth, width / 2 - 28) - 24));
}

/** The nearest grid point to `value` on a grid of `size` whose points sit at offset + n × size. */
export const snapToGrid = (value: number, size: number, offset = 0) => offset + Math.round((value - offset) / size) * size;
export function snappedPositions(positions: Record<string, { x: number; y: number }>, delta: { x: number; y: number }, grid: number, offset = { x: 0, y: 0 }) {
  return Object.entries(positions).map(([id, point]) => ({
    id,
    x: snapToGrid(point.x + delta.x, grid, offset.x),
    y: snapToGrid(point.y + delta.y, grid, offset.y),
  }));
}
