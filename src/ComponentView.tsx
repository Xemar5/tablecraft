import { useState, type CSSProperties, type PointerEvent } from 'react';
import { bind, safeImage, type Component, type DesignNode } from './domain';
import { pathBounds, pathForCompound, pathForShape } from './vectorGeometry';

export type PointEditEvent = { nodeId: string; pointIndex: number; handle: 'point' | 'in' | 'out'; event: PointerEvent<SVGCircleElement> };
type ViewProps = {
  component: Component; components?: Component[]; row?: number; back?: boolean; hidden?: boolean;
  onNode?: (id: string, event: PointerEvent<HTMLDivElement>) => void; selectedNode?: string; selectedNodes?: string[];
  editableVector?: boolean; onPointDown?: (edit: PointEditEvent) => void; selectedPoint?: number | null;
  onSegmentDown?: (nodeId: string, index: number, event: PointerEvent<SVGPathElement>) => void;
  inheritedData?: Record<string, string>;
  nestedPath?: string[];
};

export function ComponentView({ component: c, components = [c], row = 0, back = false, hidden = false, onNode, selectedNode, selectedNodes,
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
    if (node.visibilityField && (node.visibilityField.includes('{{') ? bind(node.visibilityField, contextData) : contextData[node.visibilityField]) !== node.visibilityValue) return null;
    const flow = !!parent && parent.layout !== 'absolute';
    const text = bind(node.text, contextData);
    const widthMode = node.widthMode ?? 'fixed', heightMode = node.heightMode ?? 'fixed';
    const rowFlow = parent?.layout === 'row', columnFlow = parent?.layout === 'column';
    const fillsMainAxis = flow && ((rowFlow && widthMode === 'fill') || (columnFlow && heightMode === 'fill'));
    const style: CSSProperties = {
      position: flow ? 'relative' : 'absolute', left: flow ? undefined : node.x, top: flow ? undefined : node.y,
      width: widthMode === 'hug' ? 'max-content' : widthMode === 'fill' ? flow && rowFlow ? undefined : '100%' : node.width,
      height: heightMode === 'hug' ? 'max-content' : heightMode === 'fill' ? flow && columnFlow ? undefined : '100%' : node.height,
      flex: fillsMainAxis ? '1 1 0' : undefined, flexShrink: widthMode === 'fill' || heightMode === 'fill' ? undefined : 0, boxSizing: 'border-box',
      background: sourceOutline || node.type === 'shape' || node.type === 'compound' ? 'transparent' : node.fill,
      color: node.color, borderRadius: node.type === 'shape' ? 0 : node.radius,
      fontSize: node.fontSize, fontFamily: `"${node.font}", sans-serif`,
      transform: `rotate(${node.rotation}deg)`, opacity: node.opacity,
      paddingTop: node.paddingTop ?? node.padding, paddingRight: node.paddingRight ?? node.padding,
      paddingBottom: node.paddingBottom ?? node.padding, paddingLeft: node.paddingLeft ?? node.padding, gap: node.gap,
      display: node.type === 'frame' || node.type === 'text' ? 'flex' : 'block',
      flexDirection: node.layout === 'row' ? 'row' : 'column',
      flexWrap: node.type === 'frame' && node.wrap ? 'wrap' : 'nowrap',
      alignItems: node.type === 'text' ? undefined : node.align === 'start' ? 'flex-start' : node.align === 'end' ? 'flex-end' : 'center',
      justifyContent: node.type === 'text' ? 'center' : undefined,
      textAlign: node.align === 'start' ? 'left' : node.align === 'end' ? 'right' : 'center',
      outline: selectedIds.includes(node.id) ? '2px solid #c5e497' : undefined,
      overflow: node.type === 'component' ? 'hidden' : node.type === 'shape' && node.shapeKind === 'path' ? 'visible' : undefined,
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
          <div className="nested-component-content" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
            <div style={{ transform: `scale(${node.width / linked.width},${node.height / linked.height})`, transformOrigin: 'top left' }}>
              <ComponentView component={linked} components={components} row={nestedRow} back={false} inheritedData={inherited}
                nestedPath={[...nestedPath, c.id]} />
            </div>
          </div>;
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
      const path = node.type === 'shape' ? pathForShape(node) : pathForCompound(nodes, node);
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
      onPointerDown={onNode ? event => { event.stopPropagation(); onNode(node.id, event); } : undefined}>
      {node.type === 'text' && text}
      {node.type === 'image' && (safeImage(text) ? <img src={safeImage(text)} alt="" draggable={false} /> : <div className="image-placeholder">Image URL</div>)}
      {shape}{nested}{vectorEditor}
      {node.type === 'compound'
        ? (sourceOutline || compoundEditing.has(node.id)) && nodes.filter(child => child.parent === node.id).map(child => render(child, node, contextData, true))
        : nodes.filter(n => n.parent === node.id).map(child => render(child, node, contextData))}
    </div>;
  };
  return <div key={face} className={`component-face component-${c.kind}${reveal.changed ? ' face-flipped' : ''}`} style={{
    width: c.width, height: c.height, background: hidden && !nodes.length ? '#365d46' : c.color,
    borderRadius: c.kind === 'token' ? '50%' : c.kind === 'board' ? 16 : 12,
  }}>{hidden && !nodes.length ? <div className="hidden-face" /> : nodes.filter(n => !n.parent).map(n => render(n))}</div>;
}

export function ComponentThumbnail({ component, components = [component], row = 0, back = false, hidden = false, width = 100 }: {
  component: Component; components?: Component[]; row?: number; back?: boolean; hidden?: boolean; width?: number;
}) {
  const scale = width / component.width;
  return <div className="component-thumbnail" style={{ width, height: component.height * scale }}>
    <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}><ComponentView component={component} components={components} row={row} back={back} hidden={hidden} /></div>
  </div>;
}
