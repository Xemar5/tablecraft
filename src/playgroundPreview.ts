import { visibleBack, type Component, type Instance } from './domain';

/** Match table-hand visual privacy; a spectator cannot inspect a face-down table piece's front. */
export function previewPermission(item: Instance, component: Component, actor: string, viewer: boolean) {
  const hidden = !!item.holder && item.holder !== actor && component.hideInHand;
  const back = hidden || visibleBack(item);
  return { back, hidden, canFlip: component.flippable && !hidden && !(viewer && back) };
}

/** The same fixed width is used before and after the thumbnail mounts. */
export function hoverPreviewWidth(scale: number) {
  return Math.min(500, Math.max(240, 160 * scale + 18));
}
export function previewOnLeft(clientX: number, left: number, width: number, previewWidth = hoverPreviewWidth(1)) {
  return clientX >= Math.min(left + width * 2 / 3, Math.max(left + width / 2, left + width - 16 - Math.min(previewWidth, width / 2 - 28) - 24));
}

export function snappedPositions(positions: Record<string, { x: number; y: number }>, delta: { x: number; y: number }, grid: number) {
  return Object.entries(positions).map(([id, point]) => ({
    id,
    x: Math.round((point.x + delta.x) / grid) * grid,
    y: Math.round((point.y + delta.y) / grid) * grid,
  }));
}
