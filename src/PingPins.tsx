import { useEffect, useRef, type RefObject } from 'react';
import { cssPx } from './uiScale';

export type PingPin = { key: string; ids: string[]; name: string; color: string };
const EDGE = 30;

/**
 * Pins for pings, at a fixed screen size: the pinging player's avatar and name above what they pinged, or, while it is
 * off screen, at the nearest edge of the table with an arrow pointing to it. Clicking a pin brings the camera to it.
 * Positions follow the pieces every frame (the camera can move meanwhile) and are written straight to the pins.
 */
export function PingPins({ viewport, pins, onFocus }: { viewport: RefObject<HTMLDivElement | null>; pins: PingPin[]; onFocus: (ids: string[]) => void }) {
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pins.length) return;
    let frame = 0;
    const place = () => {
      const view = viewport.current, root = layer.current;
      if (view && root) {
        const bounds = view.getBoundingClientRect();
        for (const element of root.querySelectorAll<HTMLElement>('[data-ping-pin]')) {
          const pin = pins.find(entry => entry.key === element.dataset.pingPin);
          const rects = (pin?.ids ?? []).flatMap(id => [...view.querySelectorAll<HTMLElement>(`.table-piece[data-piece-id="${CSS.escape(id)}"]`)].map(piece => piece.getBoundingClientRect()));
          if (!rects.length) { element.style.visibility = 'hidden'; continue; }
          const left = Math.min(...rects.map(r => r.left)), right = Math.max(...rects.map(r => r.right));
          const top = Math.min(...rects.map(r => r.top)), bottom = Math.max(...rects.map(r => r.bottom));
          // The pin points at the top middle of what was pinged, in page pixels relative to the table view.
          const target = { x: cssPx((left + right) / 2 - bounds.left), y: cssPx(top - bounds.top) };
          const center = { x: cssPx((left + right) / 2 - bounds.left), y: cssPx((top + bottom) / 2 - bounds.top) };
          const width = cssPx(bounds.width), height = cssPx(bounds.height);
          const visible = right > bounds.left && left < bounds.right && bottom > bounds.top && top < bounds.bottom;
          let x = target.x, y = target.y, angle = 90;
          if (!visible || target.y < EDGE * 2) {
            // Off screen (or too close to the top for a pin above it): wait at the edge and point the way.
            x = Math.max(EDGE * 3, Math.min(width - EDGE * 3, center.x));
            y = Math.max(EDGE * 1.6, Math.min(height - EDGE * 1.6, center.y));
            angle = Math.atan2(center.y - y, center.x - x) * 180 / Math.PI;
            if (visible) { x = target.x; y = Math.max(EDGE * 1.6, cssPx(bottom - bounds.top) + EDGE * 1.4); angle = -90; }
          }
          element.style.visibility = '';
          element.style.transform = `translate(${x}px, ${y}px)`;
          element.classList.toggle('pointing-away', angle !== 90);
          element.style.setProperty('--ping-angle', `${angle}deg`);
          // Away from the piece the arrow sits on the edge of the pill, on the side facing the piece.
          const body = element.firstElementChild as HTMLElement | null, turn = angle * Math.PI / 180;
          if (body) element.style.setProperty('--ping-reach', `${Math.hypot(body.offsetWidth / 2 * Math.cos(turn), body.offsetHeight / 2 * Math.sin(turn)) + 3}px`);
        }
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [pins, viewport]);
  return <div ref={layer} className="ping-pins" aria-live="polite">
    {pins.map(pin => <button key={pin.key} type="button" data-ping-pin={pin.key} className="ping-pin" style={{ '--ping-color': pin.color } as React.CSSProperties}
      title={`${pin.name} pinged this. Click to look at it.`} aria-label={`${pin.name} pinged ${pin.ids.length === 1 ? 'a piece' : `${pin.ids.length} pieces`}. Show it`}
      onPointerDown={event => event.stopPropagation()} onClick={() => onFocus(pin.ids)}>
      <span className="ping-pin-body"><span className="ping-pin-avatar">{pin.name[0]?.toUpperCase() ?? '?'}</span><span className="ping-pin-name">{pin.name}</span></span>
      <span className="ping-pin-arrow" aria-hidden="true" />
    </button>)}
  </div>;
}
