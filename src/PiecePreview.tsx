import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ComponentView } from './ComponentView';
import { type Component, type Instance } from './domain';
import { previewPermission } from './playgroundPreview';
import './playgroundPreview.css';

export function PiecePreview({ item, component, components, actor, viewer, onClose }: {
  item: Instance; component: Component; components: Component[]; actor: string; viewer: boolean; onClose: () => void;
}) {
  const permission = previewPermission(item, component, actor, viewer);
  const [zoom, setZoom] = useState(1);
  const [flipped, setFlipped] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const root = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation>(undefined);
  useLayoutEffect(() => {
    const element = art.current;
    if (!element) return;
    const transform = `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${zoom})`;
    const frames = [{ transform }, { transform }];
    if (animation.current?.playState === 'running' && animation.current.effect instanceof KeyframeEffect) animation.current.effect.setKeyframes(frames);
    else animation.current = element.animate(frames, { duration: 1000, iterations: Infinity });
  }, [pan.x, pan.y, rotation, zoom]);
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
      if (key === 'q' || key === 'e') setRotation(value => value + (key === 'q' ? -90 : 90));
    };
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose, permission.canFlip]);
  // Re-evaluate permissions on every render, including while a remote seat/face changes.
  const back = permission.canFlip ? permission.back !== flipped : permission.back;
  return createPortal(<div ref={root} tabIndex={-1} role="dialog" aria-modal="true" data-theme-fixed aria-label={`Fullscreen preview: ${component.name}`}
    className="piece-preview-fullscreen" onClick={onClose} onPointerDown={event => event.stopPropagation()}
    onPointerMove={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      const turn = rotation * Math.PI / 180;
      const width = (Math.abs(Math.cos(turn)) * component.width + Math.abs(Math.sin(turn)) * component.height) * zoom;
      const height = (Math.abs(Math.sin(turn)) * component.width + Math.abs(Math.cos(turn)) * component.height) * zoom;
      setPan({
        x: (.5 - (event.clientX - rect.left) / rect.width) * Math.max(0, width - rect.width + 100),
        y: (.5 - (event.clientY - rect.top) / rect.height) * Math.max(0, height - rect.height + 160),
      });
    }}>
    <div ref={art} className="piece-preview-art" data-back={back} data-rotation={rotation} style={{
      width: component.width, height: component.height,
    }}><ComponentView component={component} components={components} row={item.row} back={back} hidden={permission.hidden} /></div>
    <div className="piece-preview-title"><strong>{component.name}</strong><span>{Math.round(zoom * 100)}%</span></div>
    <div className="piece-preview-help">
      <span>Wheel · Zoom</span><span>Move pointer · Pan</span>
      {permission.canFlip ? <span>F · Flip</span> : <span>Back only</span>}
      <span>Q / E · Rotate</span><span>Click / Z / Esc · Close</span>
      <small>Preview only · Your table stays unchanged</small>
    </div>
  </div>, document.body);
}
