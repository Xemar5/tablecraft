import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Code2, Database, Download, FileSpreadsheet, Frame, FolderPlus, ImagePlus, Layers, Redo2, Square, SquareDashed, Trash2, Type, Undo2, Upload } from 'lucide-react';
import Papa from 'papaparse';
import { ComponentView } from './ComponentView';
import { makeNode, moveLayer, type Component, type DesignNode } from './domain';
import { copySubtrees, groupLayers, pasteSubtrees, selectedRoots, ungroupLayers } from './designerOperations';
import { download } from './storage';
import { Field, Modal, NumberField, Toggle } from './ui';

type Face = 'front' | 'back';
type DragPosition = { x: number; y: number };
type LayerDrag = { ids: string[]; pointer: number; clientX: number; clientY: number; positions: Record<string, DragPosition>; angles: Record<string, number> };

function descendantsOf(nodes: DesignNode[], ids: string[]) {
  const descendants = new Set(ids);
  let previousSize = -1;
  while (previousSize !== descendants.size) {
    previousSize = descendants.size;
    nodes.forEach(node => { if (node.parent && descendants.has(node.parent)) descendants.add(node.id); });
  }
  return descendants;
}

function worldPosition(node: DesignNode, nodes: DesignNode[]): DragPosition | undefined {
  const byId = new Map(nodes.map(item => [item.id, item]));
  let point = { x: node.x, y: node.y };
  let parent = node.parent ? byId.get(node.parent) : undefined;
  while (parent) {
    if (parent.layout !== 'absolute') return undefined;
    const radians = parent.rotation * Math.PI / 180;
    const cos = Math.cos(radians), sin = Math.sin(radians);
    const cx = parent.width / 2, cy = parent.height / 2;
    point = {
      x: parent.x + cx + (point.x - cx) * cos - (point.y - cy) * sin,
      y: parent.y + cy + (point.x - cx) * sin + (point.y - cy) * cos,
    };
    parent = parent.parent ? byId.get(parent.parent) : undefined;
  }
  return point;
}

function localPositionWithin(point: DragPosition, parentId: string | null, nodes: DesignNode[]): DragPosition | undefined {
  if (!parentId) return point;
  const byId = new Map(nodes.map(item => [item.id, item]));
  const chain: DesignNode[] = [];
  let parent = byId.get(parentId);
  while (parent) {
    if (parent.layout !== 'absolute') return undefined;
    chain.unshift(parent);
    parent = parent.parent ? byId.get(parent.parent) : undefined;
  }
  let local = point;
  for (const ancestor of chain) {
    const radians = -ancestor.rotation * Math.PI / 180;
    const cos = Math.cos(radians), sin = Math.sin(radians);
    const cx = ancestor.width / 2, cy = ancestor.height / 2;
    const x = local.x - ancestor.x - cx, y = local.y - ancestor.y - cy;
    local = { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos };
  }
  return local;
}

function nodeAngle(node: DesignNode, nodes: DesignNode[]) {
  const byId = new Map(nodes.map(item => [item.id, item]));
  let parent = node.parent ? byId.get(node.parent) : undefined;
  let angle = 0;
  while (parent) { angle += parent.rotation; parent = parent.parent ? byId.get(parent.parent) : undefined; }
  return angle * Math.PI / 180;
}

export function Designer({ component: incoming, onChange, onDelete, notify }: {
  component: Component; onChange: (c: Component) => Promise<boolean>; onDelete: () => void; notify: (message: string, error?: boolean) => void;
}) {
  const [component, setComponent] = useState(incoming);
  const pending = useRef(0);
  const latestIncoming = useRef(incoming);
  latestIncoming.current = incoming;
  useEffect(() => { if (!pending.current) setComponent(incoming); }, [incoming]);
  const [face, setFace] = useState<Face>('front');
  const [selected, setSelected] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [draggedLayer, setDraggedLayer] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<{ id: string; mode: 'inside' | 'before' | 'after' }>();
  const [tab, setTab] = useState<'design' | 'behavior'>('design');
  const [dataOpen, setDataOpen] = useState(false);
  const [csv, setCsv] = useState(component.csv);
  const [row, setRow] = useState(0);
  const [zoom, setZoom] = useState(1.45);
  const [history, setHistory] = useState<Component[]>([]);
  const [future, setFuture] = useState<Component[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dragPreview, setDragPreview] = useState<Record<string, DragPosition>>();
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const designer = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const spacePressed = useRef(false);
  const spacePanned = useRef(false);
  const panning = useRef<{ pointer: number; x: number; y: number; panX: number; panY: number }>(null);
  const zoomAnchor = useRef<{ x: number; y: number; relativeX: number; relativeY: number }>(null);
  const clipboard = useRef<{ componentId: string; face: Face; nodes: DesignNode[] }>(null);
  const artboard = useRef<HTMLDivElement>(null);
  const dragging = useRef<LayerDrag>(null);
  const nodes = component[face];
  const selectedNodes = selected.map(id => nodes.find(item => item.id === id)).filter((item): item is DesignNode => !!item);
  const node = selectedNodes[0];
  const commit = async (next: Component) => {
    pending.current++;
    setComponent(next);
    const success = await onChange(next);
    pending.current--;
    if (!success && !pending.current) setComponent(latestIncoming.current);
    return success;
  };
  const update = (patch: Partial<Component>) => {
    setHistory(h => [...h.slice(-39), structuredClone(component)]);
    setFuture([]);
    return commit({ ...component, ...patch });
  };
  const updateNode = (patch: Partial<DesignNode>) => update({
    [face]: nodes.map(item => selected.includes(item.id) ? { ...item, ...patch } : item),
  });
  const addNode = (type: DesignNode['type'], empty = false) => {
    const parent = selectedNodes.length === 1 && selectedNodes[0].type === 'frame' ? selectedNodes[0].id : null;
    const next = makeNode(type, empty ? { name: 'Empty element', fill: 'transparent', width: 150, height: 100, parent } : { parent });
    update({ [face]: [...nodes, next] });
    setSelected([next.id]);
  };
  const createGroup = () => {
    if (!selectedNodes.length) {
      const empty = makeNode('frame', { name: 'Group', fill: 'transparent', width: 180, height: 120 });
      if (nodes.length >= 300) { notify('A face cannot contain more than 300 layers.', true); return; }
      update({ [face]: [...nodes, empty] }); setSelected([empty.id]); return;
    }
    try { const result = groupLayers(nodes, selected); update({ [face]: result.nodes }); setSelected(result.selected); }
    catch (error) { notify(error instanceof Error ? error.message : 'Unable to group layers.', true); }
  };
  const removeNode = () => {
    if (!selected.length) return;
    const remove = descendantsOf(nodes, selected);
    update({ [face]: nodes.filter(item => !remove.has(item.id)) });
    setSelected([]);
  };
  const undo = () => {
    const previous = history.at(-1); if (!previous) return;
    setHistory(history.slice(0, -1)); setFuture([...future, component]);
    setSelected(current => current.filter(id => previous[face].some(item => item.id === id))); void commit(previous);
  };
  const redo = () => {
    const next = future.at(-1); if (!next) return;
    setFuture(future.slice(0, -1)); setHistory([...history, component]);
    setSelected(current => current.filter(id => next[face].some(item => item.id === id))); void commit(next);
  };
  useEffect(() => {
    const isBlocked = (target: EventTarget | null) => {
      const element = target instanceof Element ? target : null;
      return !!document.querySelector('[role="dialog"], [aria-modal="true"]') ||
        !!element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') ||
        !!(element && element !== document.body && !designer.current?.contains(element));
    };
    const keydown = (event: KeyboardEvent) => {
      if (isBlocked(event.target)) return;
      if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        spacePressed.current = true;
        if (!(event.target instanceof Element && event.target.closest('button, a'))) event.preventDefault();
        return;
      }
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (event.altKey) return;
      try {
        if (command && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
        else if (command && key === 'y' && !event.shiftKey) { event.preventDefault(); redo(); }
        else if (command && key === 'a' && !event.shiftKey) { event.preventDefault(); setSelected(nodes.filter(item => !item.parent).map(item => item.id)); }
        else if (command && (key === 'c' || key === 'x') && !event.shiftKey && selected.length) {
          event.preventDefault(); clipboard.current = { componentId: component.id, face, nodes: copySubtrees(nodes, selected) };
          if (key === 'x') removeNode();
        } else if (command && (key === 'v' || key === 'd') && !event.shiftKey) {
          if (key === 'v' && !clipboard.current) return;
          event.preventDefault();
          const copied = key === 'd' ? copySubtrees(nodes, selected) : clipboard.current!.nodes;
          if (key === 'v' && (clipboard.current!.componentId !== component.id || clipboard.current!.face !== face)) throw new Error('Paste layers into their original component face.');
          const result = pasteSubtrees(nodes, copied); update({ [face]: result.nodes }); setSelected(result.selected);
        } else if (command && key === 'g') {
          event.preventDefault();
          if (event.shiftKey) { const result = ungroupLayers(nodes, selected); update({ [face]: result.nodes }); setSelected(result.selected); }
          else if (selected.length) createGroup();
        } else if (!command && (key === 'delete' || key === 'backspace') && selected.length) {
          event.preventDefault(); removeNode();
        } else if (!command && key === 'escape') { event.preventDefault(); setSelected([]); }
        else if (!command && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key) && selected.length) {
          event.preventDefault();
          const roots = selectedRoots(nodes, selected);
          if (roots.some(item => item.parent && nodes.find(parent => parent.id === item.parent)?.layout !== 'absolute')) throw new Error('Flow-layout children cannot be nudged.');
          const distance = event.shiftKey ? 10 : 1;
          const dx = key === 'arrowright' ? distance : key === 'arrowleft' ? -distance : 0;
          const dy = key === 'arrowdown' ? distance : key === 'arrowup' ? -distance : 0;
          const ids = new Set(roots.map(item => item.id));
          update({ [face]: nodes.map(item => {
            if (!ids.has(item.id)) return item;
            const angle = nodeAngle(item, nodes);
            return { ...item, x: item.x + dx * Math.cos(angle) + dy * Math.sin(angle), y: item.y - dx * Math.sin(angle) + dy * Math.cos(angle) };
          }) });
        }
      } catch (error) { notify(error instanceof Error ? error.message : 'Unable to edit layers.', true); }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'Space') { if (spacePanned.current) event.preventDefault(); spacePressed.current = false; spacePanned.current = false; }
    };
    const blur = () => { spacePressed.current = false; spacePanned.current = false; panning.current = null; };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); };
  });
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    const bounds = artboard.current?.getBoundingClientRect();
    if (!anchor || !bounds) return;
    zoomAnchor.current = null;
    const dx = anchor.x - (bounds.left + bounds.width * anchor.relativeX);
    const dy = anchor.y - (bounds.top + bounds.height * anchor.relativeY);
    setPan(current => ({ x: current.x + dx, y: current.y + dy }));
  }, [zoom]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      const next = Math.max(.25, Math.min(3, zoom * Math.exp(-delta * .001)));
      const bounds = artboard.current?.getBoundingClientRect();
      if (bounds && next !== zoom) zoomAnchor.current = { x: event.clientX, y: event.clientY,
        relativeX: (event.clientX - bounds.left) / bounds.width, relativeY: (event.clientY - bounds.top) / bounds.height };
      setZoom(next);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [zoom]);
  const selectFromTree = (id: string, event: MouseEvent<HTMLButtonElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    } else setSelected(current => current.length > 1 && current.includes(id) ? current : [id]);
  };
  const movePreservingPosition = (sourceId: string, parentId: string | null, beforeId?: string, currentNodes = nodes) => {
    const source = currentNodes.find(item => item.id === sourceId);
    let moved = moveLayer(currentNodes, sourceId, parentId, beforeId);
    if (source && source.parent !== parentId) {
      const world = worldPosition(source, currentNodes);
      const local = world && localPositionWithin(world, parentId, currentNodes);
      if (local) moved = moved.map(item => item.id === sourceId ? { ...item, ...local } : item);
    }
    return moved;
  };
  const dropLayers = (sourceIds: string[], targetId: string, mode: 'inside' | 'before' | 'after') => {
    if (!sourceIds.length || sourceIds.includes(targetId)) return;
    const target = nodes.find(item => item.id === targetId);
    if (!target) return;
    const selectedIds = new Set(sourceIds);
    const sources = nodes.filter(item => selectedIds.has(item.id) && !nodes.some(other =>
      selectedIds.has(other.id) && other.id !== item.id && descendantsOf(nodes, [other.id]).has(item.id)));
    let next = nodes;
    try {
      if (mode === 'inside') {
        sources.forEach(source => { next = movePreservingPosition(source.id, target.id, undefined, next); });
      } else {
        const remainingSiblings = nodes.filter(item => item.parent === target.parent && !selectedIds.has(item.id));
        const targetIndex = remainingSiblings.findIndex(item => item.id === target.id);
        const anchor = mode === 'before' ? target.id : remainingSiblings[targetIndex + 1]?.id;
        sources.forEach(source => { next = movePreservingPosition(source.id, target.parent, anchor, next); });
      }
      update({ [face]: next });
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to move layer.', true);
    }
  };
  const dropModeFor = (event: DragEvent<HTMLDivElement>, item: DesignNode): 'inside' | 'before' | 'after' => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const relativeY = (event.clientY - bounds.top) / Math.max(1, bounds.height);
    return item.type === 'frame' && relativeY > .28 && relativeY < .72 ? 'inside' : relativeY < .5 ? 'before' : 'after';
  };
  const dropAtRoot = (sourceIds: string[]) => {
    const selectedIds = new Set(sourceIds);
    const sources = nodes.filter(item => selectedIds.has(item.id) && !nodes.some(other =>
      selectedIds.has(other.id) && other.id !== item.id && descendantsOf(nodes, [other.id]).has(item.id)));
    const firstRoot = nodes.find(item => item.parent === null && !selectedIds.has(item.id));
    let next = nodes;
    try {
      sources.forEach(source => { next = movePreservingPosition(source.id, null, firstRoot?.id, next); });
      update({ [face]: next });
    } catch (error) { notify(error instanceof Error ? error.message : 'Unable to move layer.', true); }
  };
  const layerDragOver = (event: DragEvent<HTMLDivElement>, item: DesignNode) => {
    event.preventDefault();
    setDropTarget({ id: item.id, mode: dropModeFor(event, item) });
  };
  const saveCsv = async () => {
    const result = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: 'greedy' });
    if (result.errors.length) { notify(result.errors[0].message, true); return; }
    if (!result.meta.fields?.length || result.meta.fields.some(f => !f.trim())) { notify('CSV needs a non-empty header row.', true); return; }
    if (await update({ csv, rows: result.data })) {
      setRow(0); setDataOpen(false);
      notify(`Updated ${result.data.length} data rows. All instances are live.`);
    }
  };
  const layers = (parent: string | null, depth = 0): ReactNode => nodes.filter(item => item.parent === parent).map(item => {
    const hasChildren = item.type === 'frame' && nodes.some(child => child.parent === item.id);
    const dragClass = dropTarget?.id === item.id ? ` drop-${dropTarget.mode}` : '';
    return <div className={`layer-tree-item${dragClass}`} key={item.id}>
      <div className="layer-tree-row" style={{ paddingLeft: 8 + depth * 14 }}
        onDragOver={event => layerDragOver(event, item)}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(undefined); }}
        onDrop={event => { event.preventDefault(); event.stopPropagation(); if (draggedLayer.length) dropLayers(draggedLayer, item.id, dropModeFor(event, item)); setDraggedLayer([]); setDropTarget(undefined); }}>
        <button className={`layer-row ${selected.includes(item.id) ? 'active' : ''}`} draggable
          onClick={event => selectFromTree(item.id, event)}
          onDragStart={event => {
            event.dataTransfer.effectAllowed = 'move';
            const moving = selected.includes(item.id) ? selected : [item.id];
            event.dataTransfer.setData('text/plain', moving.join(','));
            setDraggedLayer(moving);
          }}
          onDragEnd={() => { setDraggedLayer([]); setDropTarget(undefined); }}>
          {item.type === 'text' ? <Type size={14} /> : item.type === 'frame' ? <Frame size={14} /> : item.type === 'image' ? <ImagePlus size={14} /> : <Square size={14} />}
          <span>{item.name}</span>
        </button>
        {hasChildren && <button className="tree-disclosure" aria-label={`${collapsed.has(item.id) ? 'Expand' : 'Collapse'} ${item.name}`}
          onClick={() => setCollapsed(current => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })}>
          {hasChildren && (collapsed.has(item.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />)}
        </button>}
      </div>
      {item.type === 'frame' && !collapsed.has(item.id) && layers(item.id, depth + 1)}
    </div>;
  });
  const beginCanvasDrag = (id: string, event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || spacePressed.current) return;
    const layer = nodes.find(item => item.id === id);
    if (!layer) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
      return;
    }
    const activeIds = selected.includes(id) ? selected : [id];
    setSelected(activeIds);
    const moving = nodes.filter(item => activeIds.includes(item.id));
    if (moving.some(item => item.parent && nodes.find(parent => parent.id === item.parent)?.layout !== 'absolute')) return;
    const positions = Object.fromEntries(moving.map(item => [item.id, { x: item.x, y: item.y }]));
    const angles = Object.fromEntries(moving.map(item => [item.id, nodeAngle(item, nodes)]));
    dragging.current = { ids: activeIds, pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY, positions, angles };
    artboard.current?.setPointerCapture(event.pointerId);
  };
  const rootIds = nodes.filter(item => item.parent === null).map(item => item.id);
  return <div ref={designer} className="designer-layout">
    <aside className="layers-panel">
      <div className="panel-heading"><span><Layers size={15} /> Layers</span><span className="subtle">{nodes.length}</span></div>
      <div className="face-tabs"><button className={face === 'front' ? 'active' : ''} onClick={() => { setFace('front'); setSelected([]); }}>Front</button>
        <button disabled={!component.flippable} className={face === 'back' ? 'active' : ''} onClick={() => { setFace('back'); setSelected([]); }}>Back</button></div>
      <div className="layer-list">
        <div className={`layer-root-drop${dropTarget?.id === '__root' ? ' active' : ''}`} onDragOver={event => { event.preventDefault(); setDropTarget({ id: '__root', mode: 'inside' }); }}
          onDrop={event => { event.preventDefault(); if (draggedLayer.length) dropAtRoot(draggedLayer); setDraggedLayer([]); setDropTarget(undefined); }}>
          <ChevronRight size={12} /> Component root <span>{rootIds.length}</span>
        </div>
        {layers(null)}{!nodes.length && <p className="empty-note">A blank canvas.<br />Add your first layer above.</p>}
      </div>
      <div className="layer-footer"><button onClick={() => { setCsv(component.csv); setDataOpen(true); }}><Database size={16} /><span>Data bindings<small>{component.rows.length} rows connected</small></span><ChevronRight size={14} /></button></div>
    </aside>
    <section className="designer-canvas">
      <div className="canvas-toolbar">
        <div className="tool-group">
          <button title="Add text" aria-label="Add text" onClick={() => addNode('text')}><Type size={19} /></button>
          <button title="Add shape" aria-label="Add shape" onClick={() => addNode('shape')}><Square size={18} /></button>
          <button title="Add image" aria-label="Add image" onClick={() => addNode('image')}><ImagePlus size={19} /></button>
          <button title="Add frame" aria-label="Add frame" onClick={() => addNode('frame')}><Frame size={18} /></button>
          <button title="Add empty element" aria-label="Add empty element" onClick={() => addNode('frame', true)}><SquareDashed size={17} /></button>
          <button title={selected.length ? 'Group selected layers' : 'Create empty group'} aria-label="Create group" onClick={createGroup}><FolderPlus size={17} /></button>
        </div><span className="toolbar-divider" />
        <button title="Delete selected layers" aria-label="Delete selected layers" disabled={!selected.length} onClick={removeNode}><Trash2 size={16} /></button>
        <button title="Undo design edit" aria-label="Undo design edit" disabled={!history.length} onClick={undo}><Undo2 size={17} /></button>
        <button title="Redo design edit" aria-label="Redo design edit" disabled={!future.length} onClick={redo}><Redo2 size={17} /></button>
        <div className="toolbar-end"><select aria-label="Preview data row" value={row} onChange={event => setRow(Number(event.target.value))}>
          {component.rows.length ? component.rows.map((dataRow, index) => <option key={index} value={index}>{dataRow.name ?? `Row ${index + 1}`}</option>) : <option value="0">No data source</option>}
        </select></div>
      </div>
      <div ref={stage} className="designer-stage" tabIndex={-1}
        onPointerDownCapture={event => {
          if (event.button === 0 || event.button === 1) event.currentTarget.focus({ preventScroll: true });
          if (event.button !== 1 && !(event.button === 0 && spacePressed.current)) return;
          event.preventDefault(); event.stopPropagation();
          if (event.button === 0) spacePanned.current = true;
          panning.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMoveCapture={event => {
          const drag = panning.current;
          if (!drag || drag.pointer !== event.pointerId) return;
          event.stopPropagation(); setPan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y });
        }}
        onPointerUpCapture={event => {
          if (panning.current?.pointer !== event.pointerId) return;
          event.stopPropagation(); panning.current = null;
        }}
        onPointerCancelCapture={() => { panning.current = null; }}
        onPointerDown={event => { if (event.button === 0) setSelected([]); }}>
        <div className="designer-stage-content" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
        <span className="artboard-label">{component.name} / {face} <span>{component.width} x {component.height}</span></span>
        <div ref={artboard} className="artboard" style={{ width: component.width * zoom, height: component.height * zoom }}
          onPointerMove={event => {
            const drag = dragging.current;
            if (!drag || drag.pointer !== event.pointerId) return;
            const dx = (event.clientX - drag.clientX) / zoom, dy = (event.clientY - drag.clientY) / zoom;
            const next: Record<string, DragPosition> = {};
            drag.ids.forEach(id => {
              const angle = drag.angles[id], origin = drag.positions[id];
              next[id] = { x: Math.round(origin.x + dx * Math.cos(angle) + dy * Math.sin(angle)), y: Math.round(origin.y - dx * Math.sin(angle) + dy * Math.cos(angle)) };
            });
            setDragPreview(next);
          }}
          onPointerUp={event => {
            const drag = dragging.current;
            if (drag && drag.pointer === event.pointerId && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) > 2) {
              const positions = dragPreview ?? Object.fromEntries(drag.ids.map(id => [id, drag.positions[id]]));
              update({ [face]: nodes.map(item => positions[item.id] ? { ...item, ...positions[item.id] } : item) });
            }
            dragging.current = null; setDragPreview(undefined);
          }}
          onPointerCancel={() => { dragging.current = null; setDragPreview(undefined); }}>
          <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
            <ComponentView component={dragPreview ? { ...component, [face]: nodes.map(item => dragPreview[item.id] ? { ...item, ...dragPreview[item.id] } : item) } : component}
              row={row} back={face === 'back'} selectedNodes={selected} onNode={beginCanvasDrag} />
          </div>
        </div>
        <div className="canvas-caption"><span className="live-dot" /> Live component <span>Changes appear on every instance</span></div>
        </div>
      </div>
      <div className="canvas-bottom"><span><Square size={12} /> {component.kind} component</span>
        <div><button onClick={() => setZoom(value => Math.max(.25, value - .25))}>-</button><button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button onClick={() => setZoom(value => Math.min(3, value + .25))}>+</button></div></div>
    </section>
    <aside className="inspector">
      <div className="inspector-tabs"><button className={tab === 'design' ? 'active' : ''} onClick={() => setTab('design')}>Design</button><button className={tab === 'behavior' ? 'active' : ''} onClick={() => setTab('behavior')}>Behavior</button></div>
      <div className="inspector-scroll">
        {tab === 'behavior' ? <>
          <div className="inspector-section"><h3>Component behavior</h3>
            <Toggle label="Flippable" description="Design a front and a back" checked={component.flippable} onChange={flippable => { if (!flippable) setFace('front'); update({ flippable }); }} />
            <Toggle label="Can be put in hand" checked={component.hand} onChange={hand => update({ hand })} />
            <Toggle label="Hide front in hand" description="Only the holder sees the front" checked={component.hideInHand} onChange={hideInHand => update({ hideInHand })} disabled={!component.hand} />
            <Toggle label="Can be stacked" checked={component.stackable} onChange={stackable => update({ stackable })} />
            <Toggle label="Shufflable" checked={component.shufflable} onChange={shufflable => update({ shufflable })} disabled={!component.stackable} />
            {component.stackable && <Field label="Stack tag"><input value={component.stackTag} placeholder="e.g. spirit-deck" onChange={event => update({ stackTag: event.target.value })} /></Field>}
            <p className="help-text">Matching tags can stack together. Leave blank to stack only this component's instances.</p>
          </div>
          <div className="inspector-section"><h3>Portable by design</h3><p className="help-text">Export the full component, including both faces, behavior and CSV data.</p>
            <button className="button full" onClick={() => download(`${component.name}.component.json`, JSON.stringify(component, null, 2))}><Download size={15} /> Export component</button>
            <button className="button full danger" style={{ marginTop: 10 }} onClick={() => setDeleteOpen(true)}><Trash2 size={14} /> Delete component</button></div>
        </> : node ? <>
          <div className="inspector-section" key={node.id}><div className="section-title"><h3>{selected.length > 1 ? `${selected.length} selected layers` : `${node.type} layer`}</h3><button className="icon-button danger" title="Delete selected layers" aria-label="Delete selected layers" onClick={removeNode}><Trash2 size={14} /></button></div>
            <Field label="Layer name"><input value={selected.length > 1 ? `${selected.length} layers` : node.name} disabled={selected.length > 1} onChange={event => updateNode({ name: event.target.value })} /></Field>
            <div className="field-grid"><NumberField label="X" value={node.x} onChange={x => updateNode({ x })} />
              <NumberField label="Y" value={node.y} onChange={y => updateNode({ y })} />
              <NumberField label="Width" value={node.width} min={1} max={4000} onChange={width => updateNode({ width })} />
              <NumberField label="Height" value={node.height} min={1} max={4000} onChange={height => updateNode({ height })} />
              <NumberField label="Rotation" value={node.rotation} onChange={rotation => updateNode({ rotation })} />
              {selected.length === 1 && <NumberField label="Radius" value={node.radius} min={0} max={2000} onChange={radius => updateNode({ radius })} />}</div>
            {selected.length === 1 && <Field label="Parent"><select value={node.parent ?? ''} onChange={event => {
              const parentId = event.target.value || null;
              try { update({ [face]: movePreservingPosition(node.id, parentId) }); }
              catch (error) { notify(error instanceof Error ? error.message : 'Unable to move layer.', true); }
            }}><option value="">Component root</option>
              {nodes.filter(item => item.type === 'frame' && !descendantsOf(nodes, selected).has(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></Field>}
            <Field label="Width sizing"><select value={selectedNodes.every(item => (item.widthMode ?? 'fixed') === (node.widthMode ?? 'fixed')) ? node.widthMode ?? 'fixed' : 'mixed'}
              onChange={event => { if (event.target.value !== 'mixed') updateNode({ widthMode: event.target.value as DesignNode['widthMode'] }); }}>
              {selectedNodes.some(item => (item.widthMode ?? 'fixed') !== (node.widthMode ?? 'fixed')) && <option value="mixed" disabled>Mixed</option>}
              <option value="fixed">Fixed</option><option value="hug">Hug contents</option><option value="fill">Fill parent</option></select></Field>
            <Field label="Height sizing"><select value={selectedNodes.every(item => (item.heightMode ?? 'fixed') === (node.heightMode ?? 'fixed')) ? node.heightMode ?? 'fixed' : 'mixed'}
              onChange={event => { if (event.target.value !== 'mixed') updateNode({ heightMode: event.target.value as DesignNode['heightMode'] }); }}>
              {selectedNodes.some(item => (item.heightMode ?? 'fixed') !== (node.heightMode ?? 'fixed')) && <option value="mixed" disabled>Mixed</option>}
              <option value="fixed">Fixed</option><option value="hug">Hug contents</option><option value="fill">Fill parent</option></select></Field>
          </div>
          <div className="inspector-section" key={`appearance-${node.id}`}><h3>Appearance</h3>
            <Field label="Fill"><div className="color-input"><input aria-label="Fill color" type="color" value={/^#[0-9a-f]{6}$/i.test(node.fill) ? node.fill : '#ffffff'} onChange={event => updateNode({ fill: event.target.value })} /><input value={node.fill} onChange={event => updateNode({ fill: event.target.value })} /></div></Field>
            <NumberField label="Opacity" value={node.opacity} min={0} max={1} step={.05} onChange={opacity => updateNode({ opacity })} />
            {node.type === 'text' && selected.length === 1 && <>
              <Field label="Text / binding"><textarea value={node.text} onChange={event => updateNode({ text: event.target.value })} rows={3} /></Field>
              <p className="help-text">Mix static text with <code>{'{{column_name}}'}</code>.</p>
              <Field label="Google font"><input list="google-fonts" value={node.font} onChange={event => updateNode({ font: event.target.value })} /></Field>
              <datalist id="google-fonts">{['DM Sans', 'Lora', 'Inter', 'Playfair Display', 'Space Grotesk', 'Roboto', 'Cinzel', 'Bebas Neue'].map(font => <option key={font}>{font}</option>)}</datalist>
              <div className="field-grid"><NumberField label="Font size" value={node.fontSize} min={4} max={400} onChange={fontSize => updateNode({ fontSize })} />
                <Field label="Text color"><input type="color" value={node.color} onChange={event => updateNode({ color: event.target.value })} /></Field></div>
              <Field label="Alignment"><select value={node.align} onChange={event => updateNode({ align: event.target.value as DesignNode['align'] })}><option value="start">Left</option><option value="center">Center</option><option value="end">Right</option></select></Field>
            </>}
            {node.type === 'image' && selected.length === 1 && <><Field label="Image URL / binding"><textarea rows={3} value={node.text} onChange={event => updateNode({ text: event.target.value })} placeholder="https://... or {{image}}" /></Field><p className="help-text">HTTPS texture URLs and CSV bindings are supported.</p></>}
            {node.type === 'shape' && selected.length === 1 && <Field label="Botanical motif (optional)"><select value={node.text} onChange={event => updateNode({ text: event.target.value })}><option value="">None</option><option value="fern">Fern</option><option value="moon">Moon</option><option value="sun">Sun</option></select></Field>}
            {selected.length === 1 && node.type === 'frame' && <>
              <Field label="Child layout"><select value={node.layout} onChange={event => updateNode({ layout: event.target.value as DesignNode['layout'] })}><option value="absolute">Absolute</option><option value="row">Horizontal stack</option><option value="column">Vertical stack</option></select></Field>
              <div className="field-grid"><NumberField label="Gap" value={node.gap} min={0} max={200} onChange={gap => updateNode({ gap })} />
                <Field label="Align children"><select value={node.align} onChange={event => updateNode({ align: event.target.value as DesignNode['align'] })}><option value="start">Start</option><option value="center">Center</option><option value="end">End</option></select></Field></div>
              {node.layout !== 'absolute' && <Toggle label="Wrap children" checked={node.wrap ?? false} onChange={wrap => updateNode({ wrap })} />}
              <div className="padding-editor"><span>Padding per edge</span><div className="field-grid">
                <NumberField label="Top" value={node.paddingTop ?? node.padding} min={0} max={200} onChange={paddingTop => updateNode({ paddingTop })} />
                <NumberField label="Right" value={node.paddingRight ?? node.padding} min={0} max={200} onChange={paddingRight => updateNode({ paddingRight })} />
                <NumberField label="Bottom" value={node.paddingBottom ?? node.padding} min={0} max={200} onChange={paddingBottom => updateNode({ paddingBottom })} />
                <NumberField label="Left" value={node.paddingLeft ?? node.padding} min={0} max={200} onChange={paddingLeft => updateNode({ paddingLeft })} />
              </div></div>
            </>}
          </div>
        </> : <>
          <div className="inspector-section"><h3>Component</h3>
            <Field label="Name"><input value={component.name} onChange={event => { if (event.target.value) update({ name: event.target.value }); }} /></Field>
            <div className="field-grid"><NumberField label="Width" value={component.width} min={20} max={2000} onChange={width => update({ width })} /><NumberField label="Height" value={component.height} min={20} max={2000} onChange={height => update({ height })} /></div>
            <Field label="Background"><div className="color-input"><input type="color" aria-label="Component background" value={component.color} onChange={event => update({ color: event.target.value })} /><input value={component.color} onChange={event => update({ color: event.target.value })} /></div></Field>
          </div>
          <div className="inspector-section"><h3>Make it yours</h3><p className="help-text">Select one or more layers to move, edit, group or delete them. Add transparent groups and responsive frames with the toolbar.</p>
            <div className="tip-card"><Code2 size={20} /><strong>One design. Endless cards.</strong><p>Use {'{{name}}'} in any text or image layer to connect it to your CSV.</p><button className="text-button" onClick={() => { setCsv(component.csv); setDataOpen(true); }}>Connect your data <ChevronRight size={13} /></button></div></div>
        </>}
      </div>
    </aside>
    {dataOpen && <Modal title="A little data. A whole deck." subtitle="Each CSV row becomes a different instance of this component." wide onClose={() => setDataOpen(false)}>
      <div className="data-dialog"><div className="data-toolbar"><span><FileSpreadsheet size={16} /> CSV data source</span><label className="button"><Upload size={14} /> Import CSV<input type="file" accept=".csv,text/csv" hidden onChange={async event => {
        try { const file = event.target.files?.[0]; if (file) setCsv(await file.text()); } catch (error) { notify(String(error), true); }
      }} /></label></div>
        <textarea className="csv-editor" aria-label="CSV data" value={csv} onChange={event => setCsv(event.target.value)} spellCheck={false} />
        <p className="help-text">Include a header row. Quoted cells, commas and multiline text are supported. Updating data refreshes existing pieces by row index.</p>
        <div className="modal-actions"><button className="button" onClick={() => setDataOpen(false)}>Cancel</button><button className="button primary" onClick={saveCsv}><Database size={15} /> Apply data & refresh instances</button></div>
      </div></Modal>}
    {deleteOpen && <Modal title="Remove this component?" subtitle={`This deletes ${component.name} and every spawned instance, including pieces in hands. Export it first if you want to keep a copy.`} onClose={() => setDeleteOpen(false)}>
      <div className="data-dialog"><div className="modal-actions"><button className="button" onClick={() => setDeleteOpen(false)}>Keep component</button><button className="button danger" onClick={onDelete}><Trash2 size={15} /> Delete component & instances</button></div></div>
    </Modal>}
  </div>;
}
