import type { DesignNode } from './domain';

const STEPS = [1, .5, .25, .1, .05, .02, .01];
/**
 * The design-unit step that is about one screen pixel at this zoom: whole units at 100% and below, finer steps when
 * zoomed in, so dragging moves and resizes smoothly instead of jumping a whole unit at a time.
 */
export function zoomPrecision(zoom: number) {
  return STEPS.find(step => step <= 1 / zoom + 1e-9) ?? .01;
}
/** Rounds to a precision step without floating-point noise such as 10.300000000000001. */
export function snapTo(value: number, precision: number) {
  return Number((Math.round(value / precision) * precision).toFixed(2));
}

export function resizeNode(start: DesignNode, hx: number, hy: number, dx: number, dy: number, parentAngle: number, keepAspect: boolean, precision = 1): Partial<DesignNode> {
  const angle = parentAngle + start.rotation * Math.PI / 180;
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle), localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
  const clamp = (value: number) => Math.max(1, Math.min(4000, snapTo(value, precision)));
  let width = hx ? clamp(start.width + hx * localX) : start.width, height = hy ? clamp(start.height + hy * localY) : start.height;
  if (keepAspect && hx && hy) {
    if (width / start.width > height / start.height) height = clamp(width * start.height / start.width);
    else width = clamp(height * start.width / start.height);
  }
  // Keep the opposite edge or corner fixed while the layer rotates about its centre.
  const shiftX = hx * (width - start.width) / 2, shiftY = hy * (height - start.height) / 2;
  const rotation = start.rotation * Math.PI / 180;
  const centerX = start.x + start.width / 2 + shiftX * Math.cos(rotation) - shiftY * Math.sin(rotation);
  const centerY = start.y + start.height / 2 + shiftX * Math.sin(rotation) + shiftY * Math.cos(rotation);
  const round = (value: number) => Math.round(value * 100) / 100;
  const patch: Partial<DesignNode> = { x: round(centerX - width / 2), y: round(centerY - height / 2), width, height };
  if (start.type === 'shape' && start.shapeKind === 'path') {
    const sx = width / start.width, sy = height / start.height;
    patch.points = start.points.map(point => ({ x: round(point.x * sx), y: round(point.y * sy),
      inX: round(point.inX * sx), inY: round(point.inY * sy), outX: round(point.outX * sx), outY: round(point.outY * sy) }));
  }
  return patch;
}

export type CenteredBox = { cx: number; cy: number; width: number; height: number; rotation: number };
/**
 * Resizes a rotated box from a handle (hx, hy in -1..1) by a pointer movement given in the box's parent space
 * (`parentAngle` in radians), keeping the opposite edge or corner fixed. Unlike layers it isn't rounded or capped,
 * so it suits pictures placed inside an image layer.
 */
export function resizeCenteredBox(start: CenteredBox, hx: number, hy: number, dx: number, dy: number, parentAngle: number, keepAspect: boolean, minimum = 2): CenteredBox {
  const angle = parentAngle + start.rotation * Math.PI / 180;
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle), localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
  let width = hx ? Math.max(minimum, start.width + hx * localX) : start.width, height = hy ? Math.max(minimum, start.height + hy * localY) : start.height;
  if (keepAspect && hx && hy) {
    if (width / start.width > height / start.height) height = width * start.height / start.width;
    else width = height * start.width / start.height;
  }
  const shiftX = hx * (width - start.width) / 2, shiftY = hy * (height - start.height) / 2;
  const rotation = start.rotation * Math.PI / 180;
  return { ...start, width, height,
    cx: start.cx + shiftX * Math.cos(rotation) - shiftY * Math.sin(rotation),
    cy: start.cy + shiftX * Math.sin(rotation) + shiftY * Math.cos(rotation) };
}

export function rotateNode(start: DesignNode, delta: number, snap: boolean, precision = 1) {
  const raw = start.rotation + delta * 180 / Math.PI;
  const rotation = snap ? Math.round(raw / 15) * 15 : snapTo(raw, Math.max(.1, precision));
  return ((rotation + 180) % 360 + 360) % 360 - 180;
}
