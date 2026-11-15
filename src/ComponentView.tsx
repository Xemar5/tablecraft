import type { CSSProperties, PointerEvent } from 'react';
import { bind, safeImage, type Component, type DesignNode } from './domain';

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

export function ComponentView({ component: c, row = 0, back = false, hidden = false, onNode, selectedNode }: {
  component: Component; row?: number; back?: boolean; hidden?: boolean; onNode?: (id: string, event: PointerEvent<HTMLDivElement>) => void; selectedNode?: string;
}) {
  const nodes = hidden ? c.back : back && c.flippable ? c.back : c.front;
  const data = c.rows[row] ?? {};
  const render = (node: DesignNode, parent?: DesignNode) => {
    const flow = parent && parent.layout !== 'absolute';
    const text = bind(node.text, data);
    const style: CSSProperties = {
      position: flow ? 'relative' : 'absolute', left: flow ? undefined : node.x, top: flow ? undefined : node.y,
      width: node.width, height: node.height, flexShrink: 0, boxSizing: 'border-box',
      background: node.fill, color: node.color, borderRadius: node.radius,
      fontSize: node.fontSize, fontFamily: `"${node.font}", sans-serif`,
      transform: `rotate(${node.rotation}deg)`, opacity: node.opacity,
      padding: node.padding, gap: node.gap,
      display: node.type === 'frame' ? 'flex' : node.type === 'text' ? 'flex' : 'block',
      flexDirection: node.layout === 'row' ? 'row' : 'column',
      alignItems: node.type === 'text' ? undefined : node.align === 'start' ? 'flex-start' : node.align === 'end' ? 'flex-end' : 'center',
      justifyContent: node.type === 'text' ? 'center' : undefined,
      textAlign: node.align === 'start' ? 'left' : node.align === 'end' ? 'right' : 'center',
      outline: selectedNode === node.id ? '2px solid #c5e497' : undefined,
    };
    return <div key={node.id} style={style} className={`design-node node-${node.type}`}
      onPointerDown={onNode ? e => { e.stopPropagation(); onNode(node.id, e); } : undefined}>
      {node.type === 'text' && text}
      {node.type === 'image' && (safeImage(text) ? <img src={safeImage(text)} alt="" draggable={false} /> : <div className="image-placeholder">Image URL</div>)}
      {node.type === 'shape' && ['fern', 'moon', 'sun'].includes(text) && <Botanical variant={text} color={text === 'sun' ? '#876a32' : '#b5c391'} />}
      {nodes.filter(n => n.parent === node.id).map(child => render(child, node))}
    </div>;
  };
  return <div key={hidden || back ? 'back' : 'front'} className={`component-face component-${c.kind}`} style={{
    width: c.width, height: c.height, background: hidden && !nodes.length ? '#365d46' : c.color,
    borderRadius: c.kind === 'token' ? '50%' : c.kind === 'board' ? 16 : 12,
  }}>{hidden && !nodes.length ? <div className="hidden-face"><Botanical variant="fern" color="#bbcda2" /></div> : nodes.filter(n => !n.parent).map(n => render(n))}</div>;
}

export function ComponentThumbnail({ component, row = 0, back = false, hidden = false, width = 100 }: {
  component: Component; row?: number; back?: boolean; hidden?: boolean; width?: number;
}) {
  const scale = width / component.width;
  return <div className="component-thumbnail" style={{ width, height: component.height * scale }}>
    <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}><ComponentView component={component} row={row} back={back} hidden={hidden} /></div>
  </div>;
}
