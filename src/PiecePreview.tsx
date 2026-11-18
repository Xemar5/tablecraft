import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import { ComponentView } from './ComponentView';
import { type Component, type Instance } from './domain';
import { previewPermission } from './playgroundPreview';
import { cssPx } from './uiScale';
import './playgroundPreview.css';

/** Space kept between a panned piece's edge and the window or the title and help bars, in page CSS pixels. */
const PREVIEW_MARGIN = 24;

/**
 * Where a piece of `size` sits along one axis of the visible band from `start` to `end`. A piece that fits is
 * centred; a larger one pans with the pointer, so the pointer at either end of the band shows that edge of the piece.
 */
function previewCentre(size: number, start: number, end: number, pointer: number | undefined) {
  const room = end - start, centre = (start + end) / 2, overflow = size - room;
  if (overflow <= 0 || room <= 1 || pointer === undefined) return centre;
  return centre + (.5 - Math.max(0, Math.min(1, (pointer - start) / room))) * overflow;
}

export function PiecePreview({ item, component, components, actor, viewer, pointer: openedAt, stackCount = 1, onClose }: {
  item: Instance; component: Component; components: Component[]; actor: string; viewer: boolean;
  /** How many pieces the previewed stack holds, shown as on the table. */
  stackCount?: number;
  /** The pointer position (viewport pixels) when the preview opened. */
  pointer?: { x: number; y: number }; onClose: () => void;
}) {
  const permission = previewPermission(item, component, actor, viewer);
  const [zoom, setZoom] = useState(1);
  const [flipped, setFlipped] = useState(false);
  const [rotation, setRotation] = useState(0);
  // A book's pages turn inside the preview only (from the page shown on the table); hidden content has no pages to read.
  const pages = component.kind === 'book' && !permission.hidden ? Math.max(1, component.rows.length) : 0;
  const [page, setPage] = useState(item.row);
  const turn = useCallback((delta: number) => setPage(value => Math.max(0, Math.min(pages - 1, value + delta))), [pages]);
  const root = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLDivElement>(null);
  const help = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation>(undefined);
  // The pan is derived from the latest pointer position, so zooming, rotating and resizing re-aim the view as well as
  // moving the pointer. It is applied straight to the compositor animation instead of re-rendering on every move.
  const pointer = useRef(openedAt);
  const view = useRef({ zoom, rotation });
  const place = useCallback(() => {
    const element = art.current, frame = root.current;
    if (!element || !frame) return;
    const { zoom, rotation } = view.current;
    const turn = rotation * Math.PI / 180, cos = Math.abs(Math.cos(turn)), sin = Math.abs(Math.sin(turn));
    const width = (cos * component.width + sin * component.height) * zoom;
    const height = (sin * component.width + cos * component.height) * zoom;
    // Layout sizes are page CSS pixels; pointer and bounding-rect positions are viewport pixels.
    const rect = frame.getBoundingClientRect(), frameWidth = frame.clientWidth, frameHeight = frame.clientHeight;
    const at = pointer.current && { x: cssPx(pointer.current.x - rect.left), y: cssPx(pointer.current.y - rect.top) };
    const top = (title.current?.offsetHeight ?? 0) + PREVIEW_MARGIN, bottom = frameHeight - (help.current?.offsetHeight ?? 0) - PREVIEW_MARGIN;
    const x = previewCentre(width, PREVIEW_MARGIN, frameWidth - PREVIEW_MARGIN, at?.x) - frameWidth / 2;
    const y = previewCentre(height, top, bottom, at?.y) - frameHeight / 2;
    const transform = `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${zoom})`;
    const frames = [{ transform }, { transform }];
    const effect = animation.current?.effect;
    if (animation.current?.playState === 'running' && effect instanceof KeyframeEffect) effect.setKeyframes(frames);
    else animation.current = element.animate(frames, { duration: 1000, iterations: Infinity });
  }, [component.width, component.height]);
  useLayoutEffect(() => {
    view.current = { zoom, rotation };
    place();
  }, [place, rotation, zoom]);
  useEffect(() => {
    const observer = new ResizeObserver(() => place());
    for (const element of [root.current, title.current, help.current]) if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [place]);
  useEffect(() => () => animation.current?.cancel(), []);
  useEffect(() => {
    const previous = document.activeElement;
    const element = root.current;
    element?.focus();
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopImmediatePropagation();
      setZoom(value => Math.max(.1, Math.min(8, value * (event.deltaY > 0 ? .9 : 1.1))));
    };
    element?.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element?.removeEventListener('wheel', wheel);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      // Capture before the app's undo and playground command listeners.
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat || event.isComposing) return;
      const key = event.key.toLowerCase();
      if (key === 'escape' || (key === 'z' && !event.ctrlKey && !event.metaKey && !event.altKey)) onClose();
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (key === 'f' && permission.canFlip) setFlipped(value => !value);
      if ((key === 'q' || key === 'e') && event.shiftKey) { if (pages) turn(key === 'q' ? -1 : 1); }
      else if (key === 'q' || key === 'e') setRotation(value => value + (key === 'q' ? -90 : 90));
    };
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose, pages, permission.canFlip, turn]);
  // Re-evaluate permissions on every render, including while a remote seat/face changes.
  const back = permission.canFlip ? permission.back !== flipped : permission.back;
  return createPortal(<div ref={root} tabIndex={-1} role="dialog" aria-modal="true" data-theme-fixed aria-label={`Fullscreen preview: ${component.name}`}
    className="piece-preview-fullscreen" onClick={onClose} onPointerDown={event => event.stopPropagation()}
    onPointerMove={event => { pointer.current = { x: event.clientX, y: event.clientY }; place(); }}>
    <div ref={art} className="piece-preview-art" data-back={back} data-rotation={rotation} style={{
      width: component.width, height: component.height,
    }}><ComponentView component={component} components={components} row={pages ? page : item.row} back={back} hidden={permission.hidden} /></div>
    <div ref={title} className="piece-preview-title"><strong>{component.name}</strong>
      {stackCount > 1 && <span className="piece-preview-stack-count" aria-label={`Stack of ${stackCount}`}><Layers size={13} aria-hidden="true" /> {stackCount}</span>}
      {pages > 0 && <span className="piece-preview-pages" role="group" aria-label="Book pages" onClick={event => event.stopPropagation()}>
        <button type="button" aria-label="Previous page" title="Previous page (Shift+Q)" disabled={page <= 0} onClick={() => turn(-1)}>
          <ChevronLeft size={15} aria-hidden="true" /><kbd>Shift+Q</kbd></button>
        <span aria-live="polite">Page {page + 1} of {pages}</span>
        <button type="button" aria-label="Next page" title="Next page (Shift+E)" disabled={page >= pages - 1} onClick={() => turn(1)}>
          <kbd>Shift+E</kbd><ChevronRight size={15} aria-hidden="true" /></button>
      </span>}
      <span>{Math.round(zoom * 100)}%</span></div>
    <div ref={help} className="piece-preview-help">
      <span>Wheel · Zoom</span><span>Move pointer · Pan</span>
      {permission.canFlip ? <span>F · Flip</span> : <span>Back only</span>}
      <span>Q / E · Rotate</span>{pages > 0 && <span>Shift+Q / Shift+E · Turn page</span>}<span>Click / Z / Esc · Close</span>
      <small>Preview only · Your table stays unchanged</small>
    </div>
  </div>, document.body);
}
