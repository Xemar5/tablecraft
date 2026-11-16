import type { DesignNode } from './domain';

export function resizeNode(start: DesignNode, hx: number, hy: number, dx: number, dy: number, parentAngle: number, keepAspect: boolean): Partial<DesignNode> {
  const angle = parentAngle + start.rotation * Math.PI / 180;
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle), localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
  const clamp = (value: number) => Math.max(1, Math.min(4000, Math.round(value)));
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

export function rotateNode(start: DesignNode, delta: number, snap: boolean) {
  const raw = start.rotation + delta * 180 / Math.PI;
  const rotation = snap ? Math.round(raw / 15) * 15 : Math.round(raw);
  return ((rotation + 180) % 360 + 360) % 360 - 180;
}
