import { useState, type CSSProperties, type PointerEvent } from 'react';
import { bind, safeImage, type Component, type DesignNode } from './domain';
import { pathForCompound, pathForShape } from './vectorGeometry';

function Botanical({ variant, color }: { variant: string; color: string }) {
  return <svg viewBox="0 0 200 180" className={`botanical botanical-${variant}`} aria-hidden="true">
    <defs><radialGradient id={`glow-${variant}`}><stop stopColor={color} stopOpacity=".22" /><stop offset="1" stopColor={color} stopOpacity="0" /></radialGradient></defs>
    <circle cx="100" cy="85" r="80" fill={`url(#glow-${variant})`} />
    {variant === 'moon' ? <>
      <circle cx="100" cy="70" r="36" fill="#d9d9b2" /><circle cx="115" cy="58" r="33" fill="#294c40" />
      {[30, 60, 135, 162].map((x, i) => <path key={x} d={`M${x} ${95 + i * 4}l5 -25 5 25z`} fill={color} opacity=".45" />)}
      <path d="M75 175 Q130 125 90 107 Q75 92 110 86" fill="none" stroke="#dacba0" strokeWidth="8" opacity=".5" />
    </> : variant === 'sun' ? <>
      <circle cx="100" cy="82" r="32" fill="#ead39a" />
      {Array.from({ length: 12 }, (_, i) => <path key={i} d="M100 30v-15" stroke="#ead39a" strokeWidth="2" transform={`rotate(${i * 30} 100 82)`} />)}
      <path d="M20 160Q60 115 100 150Q150 110 185 157" stroke={color} fill="none" strokeWidth="2" />
    </> : <>
      <path d="M100 174Q84 98 105 27" stroke={color} strokeWidth="2.5" fill="none" />
      {Array.from({ length: 7 }, (_, i) => {
        const y = 45 + i * 17;
        const w = 17 + Math.sin(i / 7 * Math.PI) * 30;
        return <g key={i}>
          <path d={`M98 ${y + 17}Q${98 - w} ${y + 9} ${96 - w} ${y - 10}Q94 ${y - 8} 98 ${y + 17}`} fill={color} opacity={.65 + i * .04} />
          <path d={`M98 ${y + 10}Q${100 + w} ${y + 3} ${103 + w} ${y - 15}Q103 ${y - 8} 98 ${y + 10}`} fill={color} opacity={.7 + i * .03} />
        </g>;
      })}
      <circle cx="45" cy="37" r="2" fill="#e1cf9e" /><circle cx="151" cy="71" r="1.5" fill="#e1cf9e" />
      <circle cx="143" cy="146" r="2" fill="#e1cf9e" />
    </>}
  </svg>;
}

export type PointEditEvent = { nodeId: string; pointIndex: number; handle: 'point' | 'in' | 'out'; event: PointerEvent<SVGCircleElement> };
type ViewProps = {
  component: Component; components?: Component[]; row?: number; back?: boolean; hidden?: boolean;
  onNode?: (id: string, event: PointerEvent<HTMLDivElement>) => void; selectedNode?: string; selectedNodes?: string[];
  editableVector?: boolean; onPointDown?: (edit: PointEditEvent) => void; inheritedData?: Record<string, string>;
  nestedPath?: string[];
};

export function ComponentView({ component: c, components = [c], row = 0, back = false, hidden = false, onNode, selectedNode, selectedNodes,
  editableVector = false, onPointDown, inheritedData, nestedPath = [] }: ViewProps) {
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
    const flow = !!parent && parent.layout !== 'absolute';
    const text = bind(node.text, contextData);
    const widthMode = node.widthMode ?? 'fixed', heightMode = node.heightMode ?? 'fixed';
    const rowFlow = parent?.layout === 'row', columnFlow = parent?.layout === 'column';
    const fillsMainAxis = flow && ((rowFlow && widthMode === 'fill') || (columnFlow && heightMode === 'fill'));
    const legacyShape = !sourceOutline && node.type === 'shape' && node.shapeKind === 'rectangle' && ['fern', 'moon', 'sun'].includes(text);
    const style: CSSProperties = {
      position: flow ? 'relative' : 'absolute', left: flow ? undefined : node.x, top: flow ? undefined : node.y,
      width: widthMode === 'hug' ? 'max-content' : widthMode === 'fill' ? flow && rowFlow ? undefined : '100%' : node.width,
      height: heightMode === 'hug' ? 'max-content' : heightMode === 'fill' ? flow && columnFlow ? undefined : '100%' : node.height,
      flex: fillsMainAxis ? '1 1 0' : undefined, flexShrink: widthMode === 'fill' || heightMode === 'fill' ? undefined : 0, boxSizing: 'border-box',
      background: sourceOutline || node.type === 'shape' || node.type === 'compound' ? legacyShape ? node.fill : 'transparent' : node.fill,
      color: node.color, borderRadius: node.type === 'shape' ? legacyShape ? node.radius : 0 : node.radius,
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
      overflow: node.type === 'component' ? 'hidden' : undefined,
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
    const svgShape = legacyShape;
    let shape: React.ReactNode;
    if (node.type === 'shape' && svgShape) shape = <Botanical variant={text} color={text === 'sun' ? '#876a32' : '#b5c391'} />;
    else if (node.type === 'shape' || node.type === 'compound') {
      const path = node.type === 'shape' ? pathForShape(node) : pathForCompound(nodes, node);
      const openPath = node.type === 'shape' && node.shapeKind === 'path' && !node.pathClosed;
      shape = <svg className="vector-shape" width="100%" height="100%" viewBox={`0 0 ${node.width} ${node.height}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={path} fill={sourceOutline || openPath ? 'none' : node.fill}
          fillRule={node.type === 'compound' ? 'evenodd' : undefined}
          stroke={sourceOutline ? '#365d46' : node.stroke === 'transparent' ? openPath ? node.fill : undefined : node.stroke}
          strokeWidth={sourceOutline ? Math.max(1.2, node.strokeWidth) : openPath ? Math.max(1, node.strokeWidth) : node.strokeWidth}
          strokeDasharray={sourceOutline ? '4 3' : undefined} />
      </svg>;
    }
    const vectorEditor = editableVector && selectedIds.includes(node.id) && node.type === 'shape' && node.shapeKind === 'path' ?
      <svg className="vector-point-editor" viewBox={`0 0 ${node.width} ${node.height}`} aria-label={`${node.name} vector points`}>
        {node.points.map((point, index) => <g key={index}>
          {(point.inX || point.inY) && <><line x1={point.x} y1={point.y} x2={point.x + point.inX} y2={point.y + point.inY} />
            <circle className="vector-handle" cx={point.x + point.inX} cy={point.y + point.inY} r={3.5} onPointerDown={event => { event.stopPropagation(); onPointDown?.({ nodeId: node.id, pointIndex: index, handle: 'in', event }); }} /></>}
          {(point.outX || point.outY) && <><line x1={point.x} y1={point.y} x2={point.x + point.outX} y2={point.y + point.outY} />
            <circle className="vector-handle" cx={point.x + point.outX} cy={point.y + point.outY} r={3.5} onPointerDown={event => { event.stopPropagation(); onPointDown?.({ nodeId: node.id, pointIndex: index, handle: 'out', event }); }} /></>}
          <circle className="vector-anchor" cx={point.x} cy={point.y} r={4.5} onPointerDown={event => { event.stopPropagation(); onPointDown?.({ nodeId: node.id, pointIndex: index, handle: 'point', event }); }} />
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
  }}>{hidden && !nodes.length ? <div className="hidden-face"><Botanical variant="fern" color="#bbcda2" /></div> : nodes.filter(n => !n.parent).map(n => render(n))}</div>;
}

export function ComponentThumbnail({ component, components = [component], row = 0, back = false, hidden = false, width = 100 }: {
  component: Component; components?: Component[]; row?: number; back?: boolean; hidden?: boolean; width?: number;
}) {
  const scale = width / component.width;
  return <div className="component-thumbnail" style={{ width, height: component.height * scale }}>
    <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}><ComponentView component={component} components={components} row={row} back={back} hidden={hidden} /></div>
  </div>;
}
