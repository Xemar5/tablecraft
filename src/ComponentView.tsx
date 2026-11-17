import { memo, useEffect, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { assetFontFamily, assetUrl, bind, resolveFontFamily, resolveImage, type Component, type DesignNode } from './domain';
import { pathBounds, pathForCompound, pathForShape } from './vectorGeometry';

export type PointEditEvent = { nodeId: string; pointIndex: number; handle: 'point' | 'in' | 'out'; event: PointerEvent<SVGCircleElement> };
type ViewProps = {
  component: Component; components?: Component[]; row?: number; back?: boolean; hidden?: boolean;
  onNode?: (id: string, event: PointerEvent<HTMLDivElement>) => void; selectedNode?: string; selectedNodes?: string[];
  onNodeDoubleClick?: (id: string, event: MouseEvent<HTMLDivElement>) => void;
  editableVector?: boolean; onPointDown?: (edit: PointEditEvent) => void; selectedPoint?: number | null;
  onSegmentDown?: (nodeId: string, index: number, event: PointerEvent<SVGPathElement>) => void;
  inheritedData?: Record<string, string>;
  nestedPath?: string[];
};

// Memoized: tables render hundreds of faces, and most re-renders (hover, selection, camera) leave their props unchanged.
export const ComponentView = memo(function ComponentView({ component: c, components = [c], row = 0, back = false, hidden = false, onNode, onNodeDoubleClick, selectedNode, selectedNodes,
  editableVector = false, onPointDown, onSegmentDown, selectedPoint, inheritedData, nestedPath = [] }: ViewProps) {
  const selectedIds = selectedNodes ?? (selectedNode ? [selectedNode] : []);
  const face = hidden || (back && c.flippable) ? 'back' : 'front';
  const [reveal, setReveal] = useState({ face, changed: false });
  if (reveal.face !== face) setReveal({ face, changed: true });
  const nodes = hidden ? c.back : back && c.flippable ? c.back : c.front;
  const data = inheritedData ?? c.rows[row] ?? {};
  const catalog = new Map(components.map(item => [item.id, item]));
  const compoundEditing = new Set<string>();
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  selectedIds.forEach(id => {
    let current = nodeMap.get(id);
    while (current?.parent) {
      const parent = nodeMap.get(current.parent);
      if (parent?.type === 'compound') compoundEditing.add(parent.id);
      current = parent;
    }
    if (current?.type === 'compound') compoundEditing.add(current.id);
  });
  const render = (node: DesignNode, parent?: DesignNode, contextData = data, sourceOutline = false): React.ReactNode => {
    if (node.visible === false) return null;
    if (node.visibilityField && (node.visibilityField.includes('{{') ? bind(node.visibilityField, contextData) : contextData[node.visibilityField]) !== node.visibilityValue) return null;
    const flow = !!parent && parent.layout !== 'absolute';
    const text = bind(node.text, contextData);
    const widthMode = node.widthMode ?? 'fixed', heightMode = node.heightMode ?? 'fixed';
    const rowFlow = parent?.layout === 'row', columnFlow = parent?.layout === 'column';
    const fillsMainAxis = flow && ((rowFlow && widthMode === 'fill') || (columnFlow && heightMode === 'fill'));
    const marginTop = node.marginTop ?? 0, marginRight = node.marginRight ?? 0, marginBottom = node.marginBottom ?? 0, marginLeft = node.marginLeft ?? 0;
    // Hug and fill axes ignore x/y: absolute children are inset from the parent's edges by their margins instead.
    const style: CSSProperties = {
      position: flow ? 'relative' : 'absolute',
      left: flow ? undefined : widthMode === 'fixed' ? node.x : marginLeft, right: !flow && widthMode === 'fill' ? marginRight : undefined,
      top: flow ? undefined : heightMode === 'fixed' ? node.y : marginTop, bottom: !flow && heightMode === 'fill' ? marginBottom : undefined,
      marginTop: flow ? marginTop : undefined, marginRight: flow ? marginRight : undefined, marginBottom: flow ? marginBottom : undefined, marginLeft: flow ? marginLeft : undefined,
      width: widthMode === 'hug' ? 'max-content' : widthMode === 'fill' ? flow && !rowFlow ? `calc(100% - ${marginLeft + marginRight}px)` : undefined : node.width,
      height: heightMode === 'hug' ? 'max-content' : heightMode === 'fill' ? flow && !columnFlow ? `calc(100% - ${marginTop + marginBottom}px)` : undefined : node.height,
      flex: fillsMainAxis ? '1 1 0' : undefined, flexShrink: widthMode === 'fill' || heightMode === 'fill' ? undefined : 0, boxSizing: 'border-box',
      background: sourceOutline || node.type === 'shape' || node.type === 'compound' ? 'transparent' : node.fill,
      color: node.color, borderRadius: node.type === 'shape' ? 0 : node.radius,
      fontSize: node.fontSize, fontFamily: `"${node.type === 'text' ? resolveFontFamily(node, contextData, catalog) : node.font}", sans-serif`,
      // An identity rotate still creates a transform node per layer, which makes large tables slow to composite.
      transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined, opacity: node.opacity,
      paddingTop: node.paddingTop ?? node.padding, paddingRight: node.paddingRight ?? node.padding,
      paddingBottom: node.paddingBottom ?? node.padding, paddingLeft: node.paddingLeft ?? node.padding, gap: node.gap,
      display: node.type === 'frame' || node.type === 'text' ? 'flex' : 'block',
      flexDirection: node.layout === 'row' ? 'row' : 'column',
      flexWrap: node.type === 'frame' && node.wrap ? 'wrap' : 'nowrap',
      alignItems: node.type === 'text' ? undefined : node.align === 'start' ? 'flex-start' : node.align === 'end' ? 'flex-end' : 'center',
      justifyContent: node.type === 'text' ? 'center' : undefined,
      textAlign: node.align === 'start' ? 'left' : node.align === 'end' ? 'right' : 'center',
      outline: selectedIds.includes(node.id) ? '2px solid #c5e497' : undefined,
      overflow: node.type === 'component' ? 'hidden' : node.type === 'frame' || (node.type === 'shape' && node.shapeKind === 'path') ? 'visible' : undefined,
      // Image layers measure themselves so the picture can be fitted and placed in container units.
      containerType: node.type === 'image' && widthMode !== 'hug' && heightMode !== 'hug' ? 'size' : undefined,
    };
    let nested: React.ReactNode;
    if (node.type === 'component') {
      const linked = node.componentId ? catalog.get(node.componentId) : undefined;
      if (!linked) nested = <div className="nested-component-error" role="alert">Missing linked component: {node.componentId ?? 'no component selected'}</div>;
      else if (nestedPath.includes(linked.id) || nestedPath.length >= 32) nested = <div className="nested-component-error" role="alert">Nested component cycle or depth limit.</div>;
      else {
        let nestedRow = 0, inherited: Record<string, string> | undefined;
        let dataError = '';
        if (node.dataSource === 'inherit') inherited = contextData;
        else if (node.dataSource === 'row') {
          nestedRow = node.dataRow;
          if (nestedRow >= linked.rows.length) dataError = `Row ${nestedRow} is outside ${linked.name}'s data (zero-based).`;
        } else {
          const value = contextData[node.dataField];
          if (!node.dataField.trim()) dataError = 'Choose a parent CSV field for the nested row index.';
          else if (!/^(0|[1-9]\d*)$/.test(value ?? '')) dataError = `CSV field “${node.dataField}” must contain a zero-based integer row index.`;
          else if (Number(value) >= linked.rows.length) dataError = `Row index ${value} from “${node.dataField}” is outside ${linked.name}'s ${linked.rows.length} rows.`;
          else nestedRow = Number(value);
        }
        nested = dataError ? <div className="nested-component-error" role="alert">{dataError}</div> :
          <svg className="nested-component-content" viewBox={`0 0 ${linked.width} ${linked.height}`}
            preserveAspectRatio={node.nestedFit === 'contain' ? 'xMidYMid meet' : node.nestedFit === 'cover' ? 'xMidYMid slice' : 'none'}
            style={{ display: 'block', width: '100%', height: '100%', overflow: 'hidden' }}>
            <foreignObject width={linked.width} height={linked.height}>
              <ComponentView component={linked} components={components} row={nestedRow} back={false} inheritedData={inherited}
                nestedPath={[...nestedPath, c.id]} />
            </foreignObject>
          </svg>;
      }
    }
    let shape: React.ReactNode;
    const bounds = node.type === 'shape' && node.shapeKind === 'path' && node.points.length ? pathBounds(node) : undefined;
    const left = bounds ? Math.min(0, bounds.minX) : 0, top = bounds ? Math.min(0, bounds.minY) : 0;
    const vectorWidth = bounds ? Math.max(node.width, bounds.maxX) - left : node.width;
    const vectorHeight = bounds ? Math.max(node.height, bounds.maxY) - top : node.height;
    const vectorStyle: CSSProperties = { left: `${left / node.width * 100}%`, top: `${top / node.height * 100}%`,
      width: `${vectorWidth / node.width * 100}%`, height: `${vectorHeight / node.height * 100}%`, right: 'auto', bottom: 'auto' };
    const vectorBox = `${left} ${top} ${vectorWidth} ${vectorHeight}`;
    if (node.type === 'shape' || node.type === 'compound') {
      const path = node.type === 'shape' ? pathForShape(node) : pathForCompound(nodes.filter(item => item.visible !== false), node);
      const openPath = node.type === 'shape' && node.shapeKind === 'path' && !node.pathClosed;
      shape = <svg className="vector-shape" style={vectorStyle} viewBox={vectorBox} preserveAspectRatio="none" aria-hidden="true">
        <path d={path} fill={sourceOutline || openPath ? 'none' : node.fill}
          fillRule={node.type === 'compound' ? 'evenodd' : undefined}
          stroke={sourceOutline ? '#365d46' : node.stroke === 'transparent' ? openPath ? node.fill : undefined : node.stroke}
          strokeWidth={sourceOutline ? Math.max(1.2, node.strokeWidth) : openPath ? Math.max(1, node.strokeWidth) : node.strokeWidth} strokeLinejoin="round" strokeLinecap="round"
          strokeDasharray={sourceOutline ? '4 3' : undefined} />
      </svg>;
    }
    const vectorEditor = editableVector && selectedIds.includes(node.id) && node.type === 'shape' && node.shapeKind === 'path' ?
      <svg className="vector-point-editor" style={vectorStyle} viewBox={vectorBox} preserveAspectRatio="none" aria-label={`${node.name} vector points`}>
        {node.points.slice(0, node.points.length - (node.pathClosed ? 0 : 1)).map((point, index) => {
          const next = node.points[(index + 1) % node.points.length];
          return <path key={`segment-${index}`} className="vector-segment" d={`M ${point.x} ${point.y} C ${point.x + point.outX} ${point.y + point.outY} ${next.x + next.inX} ${next.y + next.inY} ${next.x} ${next.y}`}
            onPointerDown={event => { event.stopPropagation(); onSegmentDown?.(node.id, index, event); }} />;
        })}
        {node.points.map((point, index) => <g key={index}>
          {(point.inX || point.inY) && <><line x1={point.x} y1={point.y} x2={point.x + point.inX} y2={point.y + point.inY} />
            <circle className="vector-handle" cx={point.x + point.inX} cy={point.y + point.inY} r={3.5} onPointerDown={event => { event.stopPropagation(); onPointDown?.({ nodeId: node.id, pointIndex: index, handle: 'in', event }); }} /></>}
          {(point.outX || point.outY) && <><line x1={point.x} y1={point.y} x2={point.x + point.outX} y2={point.y + point.outY} />
            <circle className="vector-handle" cx={point.x + point.outX} cy={point.y + point.outY} r={3.5} onPointerDown={event => { event.stopPropagation(); onPointDown?.({ nodeId: node.id, pointIndex: index, handle: 'out', event }); }} /></>}
          <circle className={`vector-anchor${selectedPoint === index ? ' selected' : ''}`} cx={point.x} cy={point.y} r={4.5} onPointerDown={event => { event.stopPropagation(); onPointDown?.({ nodeId: node.id, pointIndex: index, handle: 'point', event }); }} />
        </g>)}
      </svg> : null;
    return <div key={node.id} style={style} className={`design-node node-${node.type}`}
      onPointerDown={onNode ? event => { event.stopPropagation(); onNode(node.id, event); } : undefined}
      onDoubleClick={onNodeDoubleClick ? event => { event.stopPropagation(); onNodeDoubleClick(node.id, event); } : undefined}>
      {node.type === 'text' && text}
      {node.type === 'image' && (() => {
        const src = resolveImage(node, contextData, catalog);
        return src ? <ImageLayer src={src} node={node} contained={style.containerType === 'size'} /> : <div className="image-placeholder">Image / texture</div>;
      })()}
      {shape}{nested}{vectorEditor}
      {node.type === 'compound'
        ? (sourceOutline || compoundEditing.has(node.id)) && nodes.filter(child => child.parent === node.id).map(child => render(child, node, contextData, true))
        : nodes.filter(n => n.parent === node.id).map(child => render(child, node, contextData))}
    </div>;
  };
  return <div key={face} className={`component-face component-${c.kind}${reveal.changed ? ' face-flipped' : ''}`} style={{
    width: c.width, height: c.height, background: hidden && !nodes.length ? '#365d46' : c.color,
    borderRadius: c.kind === 'artwork' ? 0 : c.kind === 'token' ? '50%' : c.kind === 'board' ? 16 : 12,
    boxShadow: c.kind === 'artwork' ? 'none' : undefined,
  }}>{c.kind === 'texture' ? <img src={assetUrl(c)} alt={c.name} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      : c.kind === 'font' ? <div style={{ fontFamily: `"${assetFontFamily(c)}"`, fontSize: 64, textAlign: 'center', paddingTop: 50 }}>Aa</div>
      : hidden && !nodes.length ? <div className="hidden-face" /> : nodes.filter(n => !n.parent).map(n => render(n))}</div>;
});

export const ComponentThumbnail = memo(function ComponentThumbnail({ component, components = [component], row = 0, back = false, hidden = false, width: fixedWidth = 100, height }: {
  component: Component; components?: Component[]; row?: number; back?: boolean; hidden?: boolean; width?: number;
  /** Fit this height instead of the width, keeping the component's aspect ratio. */
  height?: number;
}) {
  const width = height !== undefined ? height * component.width / component.height : fixedWidth;
  const scale = width / component.width;
  return <div className="component-thumbnail" style={{ width, height: component.height * scale }}>
    <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}><ComponentView component={component} components={components} row={row} back={back} hidden={hidden} /></div>
  </div>;
});

export type ImageFit = NonNullable<DesignNode['imageFit']>;
/** Where the picture sits inside an image layer, relative to its fitted, centred position. */
export function imagePlacement(node: Pick<DesignNode, 'imageOffsetX' | 'imageOffsetY' | 'imageScaleX' | 'imageScaleY' | 'imageRotation'>) {
  return { x: node.imageOffsetX ?? 0, y: node.imageOffsetY ?? 0, scaleX: node.imageScaleX ?? 1, scaleY: node.imageScaleY ?? 1, rotation: node.imageRotation ?? 0 };
}
/** The fitted picture size inside a layer box, before its placement is applied. Tiles cover the layer. */
export function fittedImageSize(fit: ImageFit, natural: { width: number; height: number } | undefined, width: number, height: number) {
  if (fit === 'stretch' || fit === 'tile' || !natural) return { width, height };
  const scale = fit === 'contain' ? Math.min(width / natural.width, height / natural.height)
    : fit === 'cover' ? Math.max(width / natural.width, height / natural.height) : 1;
  return { width: natural.width * scale, height: natural.height * scale };
}

const naturalSizes = new Map<string, { width: number; height: number }>();
/** The intrinsic size of an image source, loaded once and shared by every layer that shows it. */
export function useNaturalSize(src: string | undefined) {
  const [loaded, setLoaded] = useState<{ src: string; size: { width: number; height: number } }>();
  useEffect(() => {
    if (!src || naturalSizes.has(src)) return;
    let live = true;
    const image = new Image();
    image.onload = () => {
      const size = { width: image.naturalWidth, height: image.naturalHeight };
      if (!size.width || !size.height) return;
      if (naturalSizes.size > 256) naturalSizes.delete(naturalSizes.keys().next().value!);
      naturalSizes.set(src, size);
      if (live) setLoaded({ src, size });
    };
    image.src = src;
    return () => { live = false; };
  }, [src]);
  return src ? naturalSizes.get(src) ?? (loaded?.src === src ? loaded.size : undefined) : undefined;
}

/** An image layer's picture: fitted (stretch, contain, cover, original size or tiled), then moved, rotated and scaled; the layer crops it. */
function ImageLayer({ src, node, contained }: { src: string; node: DesignNode; contained: boolean }) {
  const fit: ImageFit = node.imageFit ?? 'cover';
  const natural = useNaturalSize(fit === 'contain' || fit === 'cover' ? src : undefined);
  const placed = imagePlacement(node);
  const moved = placed.x || placed.y || placed.rotation || placed.scaleX !== 1 || placed.scaleY !== 1;
  const transform = `translate(-50%, -50%)${moved ? ` translate(${placed.x}px, ${placed.y}px) rotate(${placed.rotation}deg) scale(${placed.scaleX}, ${placed.scaleY})` : ''}`;
  // Hug-sized layers can't be measured: keep the original fill-and-crop picture.
  if (!contained) return <img src={src} alt="" draggable={false} style={{ objectFit: fit === 'stretch' ? 'fill' : fit === 'original' ? 'none' : fit === 'tile' ? 'cover' : fit }} />;
  if (fit === 'tile') {
    const reach = Math.min(40000, (node.width + node.height) * 3 / Math.max(.05, Math.min(placed.scaleX, placed.scaleY)));
    return <div className="image-tiles" aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', width: reach, height: reach, transform,
      backgroundImage: `url("${src}")`, backgroundRepeat: 'repeat', backgroundPosition: 'center' }} />;
  }
  const ratio = natural ? natural.width / natural.height : undefined;
  const size: CSSProperties = fit === 'original' ? { width: 'auto', height: 'auto' }
    : fit === 'stretch' || !ratio ? { width: '100%', height: '100%', objectFit: fit === 'stretch' ? 'fill' : fit }
    : fit === 'contain' ? { width: `min(100cqw, ${100 * ratio}cqh)`, height: `min(100cqh, ${100 / ratio}cqw)` }
    : { width: `max(100cqw, ${100 * ratio}cqh)`, height: `max(100cqh, ${100 / ratio}cqw)` };
  return <img src={src} alt="" draggable={false} style={{ position: 'absolute', left: '50%', top: '50%', maxWidth: 'none', maxHeight: 'none', ...size, transform }} />;
}
