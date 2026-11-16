import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Database, Download, Eye, EyeOff, FileSpreadsheet, Frame, FolderPlus, ImagePlus, Layers, Link2, MoveHorizontal, MoveVertical, Redo2, RotateCw, Square, Trash2, Type, Undo2, Ungroup, Upload } from 'lucide-react';
import Papa from 'papaparse';
import { ComponentView, type PointEditEvent } from './ComponentView';
import { makeNode, moveLayer, type Component, type DesignNode } from './domain';
import { combineLayers, copySubtrees, groupLayers, pasteSubtrees, selectedRoots, uncombineLayers, ungroupLayers } from './designerOperations';
import { download, exportComponentBundle } from './storage';
import { ColorField, Field, HorizontalScroll, Modal, NumberField, ScrollArrows, Toggle, useSmoothHorizontalWheel } from './ui';
import { closestSegmentParameter, expandPathBounds, segmentControls, splitPathSegment } from './vectorGeometry';
import { parseCsvData, variantLabels } from './csv';
import { PanelSeparator, type usePanelLayout } from './panelLayout';

type Face = 'front' | 'back';
type BooleanOperation = 'union' | 'subtract' | 'intersect' | 'exclude';
function BooleanIcon({ operation }: { operation: BooleanOperation }) {
  const paths: Record<BooleanOperation, string> = {
    union: 'M3 3H14V9H20V20H9V14H3Z',
    subtract: 'M3 3H14V9H9V14H3Z',
    intersect: 'M9 9H14V14H9Z',
    exclude: 'M3 3H14V9H9V14H3Z M14 9H20V20H9V14H14Z',
  };
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d={paths[operation]} fill="currentColor" />
    <rect x="3" y="3" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <rect x="9" y="9" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>;
}
type DragPosition = { x: number; y: number };
type LayerDrag = { ids: string[]; pointer: number; clientX: number; clientY: number; positions: Record<string, DragPosition>; angles: Record<string, number> };
type PointDrag = { nodeId: string; pointIndex: number; handle: 'point' | 'in' | 'out'; pointer: number; clientX: number; clientY: number; inverse: DOMMatrix; localX: number; localY: number; point: DesignNode['points'][number] };

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

export function Designer({ component: incoming, components, onChange, onDelete, notify, tab, setTab, panels }: {
  component: Component; components: Component[]; onChange: (c: Component, removedDataRow?: number) => Promise<boolean>; onDelete: () => void; notify: (message: string, error?: boolean) => void;
  tab: 'design' | 'behavior'; setTab: (tab: 'design' | 'behavior') => void; panels: ReturnType<typeof usePanelLayout>;
}) {
  const [component, setComponent] = useState(incoming);
  const pending = useRef(0);
  const latestIncoming = useRef(incoming);
  latestIncoming.current = incoming;
  useEffect(() => { if (!pending.current) setComponent(incoming); }, [incoming]);
  const [face, setFace] = useState<Face>('front');
  useEffect(() => { if (!component.flippable) setFace('front'); }, [component.flippable]);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedPoint, setSelectedPoint] = useState(-1);
  const [toolMenu, setToolMenu] = useState<'shape' | 'link' | null>(null);
  const [toolMenuPosition, setToolMenuPosition] = useState({ left: 0, top: 0 });
  const toolbar = useRef<HTMLDivElement>(null);
  useSmoothHorizontalWheel(toolbar);
  const [toolbarEdges, setToolbarEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const element = toolbar.current;
    if (!element) return;
    const measure = () => setToolbarEdges({ left: element.scrollLeft > 1, right: element.scrollLeft + element.clientWidth < element.scrollWidth - 1 });
    const scroll = () => { measure(); setToolMenu(null); };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener('scroll', scroll);
    measure();
    return () => { observer.disconnect(); element.removeEventListener('scroll', scroll); };
  }, []);
  const toggleToolMenu = (menu: 'shape' | 'link', button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    setToolMenuPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 180)), top: rect.bottom + 4 });
    setToolMenu(toolMenu === menu ? null : menu);
  };
  useEffect(() => {
    if (!toolMenu) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.designer-tool-menu,.designer-toolbar-popover')) setToolMenu(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [toolMenu]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [draggedLayer, setDraggedLayer] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<{ id: string; mode: 'inside' | 'before' | 'after' }>();
  const [dataOpen, setDataOpen] = useState(false);
  const [csv, setCsv] = useState(component.csv);
  const [row, setRow] = useState(0);
  useEffect(() => { setRow(current => Math.min(current, Math.max(0, component.rows.length - 1))); }, [component.rows.length]);
  const [zoom, setZoom] = useState(1.45);
  const [history, setHistory] = useState<Component[]>([]);
  const [future, setFuture] = useState<Component[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dragPreview, setDragPreview] = useState<Record<string, DragPosition>>();
  const [pointPreview, setPointPreview] = useState<{ nodeId: string; pointIndex: number; point: DesignNode['points'][number] }>();
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
  const pointDragging = useRef<PointDrag>(null);
  const pointSelectionNode = useRef<string | undefined>(undefined);
  const lastAnchorDown = useRef<{ nodeId: string; index: number; time: number } | null>(null);
  const nodes = component[face];
  const selectedNodes = selected.map(id => nodes.find(item => item.id === id)).filter((item): item is DesignNode => !!item);
  const node = selectedNodes[0];
  useEffect(() => {
    if (pointSelectionNode.current !== node?.id) { pointSelectionNode.current = node?.id; setSelectedPoint(-1); return; }
    if (node?.type === 'shape' && node.shapeKind === 'path' && node.points.length) setSelectedPoint(index => Math.min(index, node.points.length - 1));
    else setSelectedPoint(-1);
  }, [node?.id, node?.type === 'shape' ? node.points.length : 0]);
  const commit = async (next: Component, removedDataRow?: number) => {
    pending.current++;
    setComponent(next);
    const success = await onChange(next, removedDataRow);
    pending.current--;
    if (!success && !pending.current) setComponent(latestIncoming.current);
    return success;
  };
  const update = (patch: Partial<Component>, removedDataRow?: number) => {
    setHistory(h => [...h.slice(-39), structuredClone(component)]);
    setFuture([]);
    return commit({ ...component, ...patch }, removedDataRow);
  };
  const updateNode = (patch: Partial<DesignNode>) => {
    try {
      return update({ [face]: nodes.map(item => {
        if (!selected.includes(item.id)) return item;
        const next = { ...item, ...patch };
        const parent = nodes.find(candidate => candidate.id === next.parent);
        return (patch.points || patch.strokeWidth !== undefined || patch.stroke !== undefined || patch.pathClosed !== undefined)
          && (!parent || parent.layout === 'absolute') ? expandPathBounds(next) : next;
      }) });
    } catch (error) { notify(error instanceof Error ? error.message : 'Unable to edit path.', true); return Promise.resolve(false); }
  };
  const toggleLayerVisibility = (item: DesignNode) => {
    void update({ [face]: nodes.map(candidate => candidate.id === item.id ? { ...candidate, visible: item.visible === false } : candidate) });
  };
  const addNode = (type: DesignNode['type'], empty = false, shapeKind: DesignNode['shapeKind'] = 'rectangle') => {
    const parentCandidate = selectedNodes.length === 1 ? selectedNodes[0] : undefined;
    const parent = parentCandidate && (parentCandidate.type === 'frame' || (type === 'shape' && parentCandidate.type === 'compound')) ? parentCandidate.id : null;
    const next = makeNode(type, empty ? { name: 'Empty element', fill: 'transparent', width: 150, height: 100, parent } : {
      parent, ...(type === 'shape' ? { shapeKind, width: 100, height: 100,
        points: shapeKind === 'path' ? [{ x: 12, y: 12, inX: 0, inY: 0, outX: 0, outY: 0 },
          { x: 88, y: 12, inX: 0, inY: 0, outX: 0, outY: 0 },
          { x: 88, y: 88, inX: 0, inY: 0, outX: 0, outY: 0 },
          { x: 12, y: 88, inX: 0, inY: 0, outX: 0, outY: 0 }] : [] } : {}),
    });
    update({ [face]: [...nodes, next] });
    setSelected([next.id]);
  };
  const addNestedComponent = (componentId: string) => {
    const linked = components.find(item => item.id === componentId);
    if (!linked) return;
    const parent = selectedNodes.length === 1 && selectedNodes[0].type === 'frame' ? selectedNodes[0].id : null;
    const nested = makeNode('component', { name: linked.name, componentId, width: linked.width, height: linked.height,
      fill: 'transparent', parent, dataSource: 'inherit' });
    update({ [face]: [...nodes, nested] }); setSelected([nested.id]);
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
    const survivors = nodes.filter(item => !remove.has(item.id));
    if (survivors.some(item => item.type === 'compound' && survivors.filter(child => child.parent === item.id).length < 2)) {
      notify('Live compounds need at least two source shapes. Uncombine or delete the compound instead.', true); return;
    }
    update({ [face]: survivors });
    setSelected([]);
  };
  const makeCompound = (compoundOperation: DesignNode['compoundOperation']) => {
    try { const result = combineLayers(nodes, selected, compoundOperation); update({ [face]: result.nodes }); setSelected(result.selected); }
    catch (error) { notify(error instanceof Error ? error.message : 'Unable to create a live compound.', true); }
  };
  const uncombine = () => {
    try { const result = uncombineLayers(nodes, selected); update({ [face]: result.nodes }); setSelected(result.selected); }
    catch (error) { notify(error instanceof Error ? error.message : 'Unable to uncombine shapes.', true); }
  };
  const canUngroup = selectedNodes.length > 0 && selectedNodes.every(item => item.type === 'frame');
  const ungroupSelection = () => {
    try { const result = ungroupLayers(nodes, selected); update({ [face]: result.nodes }); setSelected(result.selected); }
    catch (error) { notify(error instanceof Error ? error.message : 'Unable to ungroup layers.', true); }
  };
  const pointDown = ({ nodeId, pointIndex, handle, event }: PointEditEvent) => {
    event.preventDefault();
    const selectedNode = nodes.find(item => item.id === nodeId);
    if (!selectedNode) return;
    setSelected([nodeId]); setSelectedPoint(pointIndex);
    if (handle === 'point' && event.altKey) { lastAnchorDown.current = null; deletePoint(pointIndex); return; }
    if (handle === 'point') {
      const previous = lastAnchorDown.current, time = performance.now();
      if (previous?.nodeId === nodeId && previous.index === pointIndex && time - previous.time < 450) {
        lastAnchorDown.current = null; toggleHandles(nodeId, pointIndex); return;
      }
      lastAnchorDown.current = { nodeId, index: pointIndex, time };
    }
    const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM();
    if (!matrix) return;
    const inverse = matrix.inverse(), start = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
    pointDragging.current = { nodeId, pointIndex, handle, pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      inverse, localX: start.x, localY: start.y, point: { ...selectedNode.points[pointIndex] } };
    artboard.current?.setPointerCapture(event.pointerId);
  };
  const appendPoint = () => {
    if (selected.length !== 1 || node?.type !== 'shape' || node.shapeKind !== 'path') return;
    if (node.points.length >= 128) { notify('Paths are limited to 128 points.', true); return; }
    const index = Math.max(0, Math.min(selectedPoint, node.points.length - 1)), from = node.points[index];
    const points = [...node.points];
    const hasNext = index + 1 < points.length || node.pathClosed;
    if (!hasNext) {
      points.push({ x: from.x + Math.min(node.width, node.height) / 6, y: from.y, inX: 0, inY: 0, outX: 0, outY: 0 });
      setSelectedPoint(points.length - 1);
    } else {
      points.splice(0, points.length, ...splitPathSegment(points, index, .5));
      setSelectedPoint(index + 1);
    }
    updateNode({ points }); setSelectedPoint(index + 1);
  };
  const deletePoint = (index = selectedPoint) => {
    if (selected.length !== 1 || node?.type !== 'shape' || node.shapeKind !== 'path') return;
    if (index < 0 || index >= node.points.length) return;
    if (node.points.length <= (node.pathClosed ? 3 : 2)) { notify(`A ${node.pathClosed ? 'closed' : 'open'} path needs at least ${node.pathClosed ? 3 : 2} points.`, true); return; }
    const points = node.points.filter((_, pointIndex) => pointIndex !== index);
    updateNode({ points }); setSelectedPoint(Math.max(0, Math.min(index, points.length - 1)));
  };
  const segmentDown = (nodeId: string, index: number, event: PointerEvent<SVGPathElement>) => {
    event.preventDefault();
    const shape = nodes.find(item => item.id === nodeId);
    if (!shape || shape.points.length >= 128) { notify('Paths are limited to 128 points.', true); return; }
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const t = closestSegmentParameter(segmentControls(shape.points[index], shape.points[(index + 1) % shape.points.length]), [point.x, point.y]);
    if (t <= .001 || t >= .999) return;
    updateNode({ points: splitPathSegment(shape.points, index, t) }); setSelectedPoint(index + 1);
  };
  const toggleHandles = (nodeId: string, index: number) => {
    if (node?.id !== nodeId) return;
    const point = node.points[index], size = Math.min(node.width, node.height) / 6;
    const expanded = !!(point.inX || point.inY || point.outX || point.outY);
    updateNode({ points: node.points.map((value, i) => i !== index ? value : {
      ...value, inX: expanded ? 0 : -size, inY: 0, outX: expanded ? 0 : size, outY: 0,
    }) });
    setSelectedPoint(index);
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
      if (key === 'escape' && toolMenu) { event.preventDefault(); setToolMenu(null); return; }
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
          if (event.shiftKey) {
            const result = selectedNodes.length && selectedNodes.every(item => item.type === 'compound')
              ? uncombineLayers(nodes, selected) : ungroupLayers(nodes, selected);
            update({ [face]: result.nodes }); setSelected(result.selected);
          }
          else if (selected.length && canUngroup) ungroupSelection();
          else if (selected.length) createGroup();
        } else if (!command && (key === 'delete' || key === 'backspace') && selected.length) {
          event.preventDefault(); if (node?.shapeKind === 'path' && node.type === 'shape' && selected.length === 1 && selectedPoint >= 0) deletePoint(); else removeNode();
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
    return (item.type === 'frame' || item.type === 'compound') && relativeY > .28 && relativeY < .72 ? 'inside' : relativeY < .5 ? 'before' : 'after';
  };
  const layerDragOver = (event: DragEvent<HTMLDivElement>, item: DesignNode) => {
    event.preventDefault();
    setDropTarget({ id: item.id, mode: dropModeFor(event, item) });
  };
  const saveCsv = async () => {
    let rows: Component['rows'];
    try { rows = parseCsvData(csv); }
    catch (error) { notify(error instanceof Error ? error.message : 'Unable to parse CSV.', true); return; }
    if (await update({ csv, rows })) {
      setRow(0); setDataOpen(false);
      notify(`Updated ${rows.length} data rows. All instances are live.`);
    }
  };
  const variantFields = [...new Set(component.rows.flatMap(item => Object.keys(item)))];
  const rowLabels = useMemo(() => variantLabels(component.csv, component.rows), [component.csv, component.rows]);
  if (!variantFields.length) variantFields.push('value');
  const updateVariants = (rows: Component['rows'], removedDataRow?: number) => update({ rows, csv: Papa.unparse(rows) }, removedDataRow);
  const layers = (parent: string | null, depth = 0): ReactNode => nodes.filter(item => item.parent === parent).map(item => {
    const hasChildren = (item.type === 'frame' || item.type === 'compound') && nodes.some(child => child.parent === item.id);
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
          {item.type === 'text' ? <Type size={14} /> : item.type === 'frame' ? <Frame size={14} /> : item.type === 'image' ? <ImagePlus size={14} /> : item.type === 'component' ? <Layers size={14} /> : <Square size={14} />}
          <span>{item.name}</span>
        </button>
        <button className={`layer-visibility${item.visible === false ? ' is-hidden' : ''}`}
          aria-label={`${item.visible === false ? 'Show' : 'Hide'} ${item.name}`} title={`${item.visible === false ? 'Show' : 'Hide'} ${item.name}`}
          onClick={() => toggleLayerVisibility(item)}>
          {item.visible === false ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        {hasChildren && <button className="tree-disclosure" aria-label={`${collapsed.has(item.id) ? 'Expand' : 'Collapse'} ${item.name}`}
          onClick={() => setCollapsed(current => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })}>
          {hasChildren && (collapsed.has(item.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />)}
        </button>}
      </div>
      {(item.type === 'frame' || item.type === 'compound') && !collapsed.has(item.id) && layers(item.id, depth + 1)}
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
  return <div ref={designer} className="designer-layout">
    <aside id="designer-layers-panel" className="layers-panel" style={{ width: panels.sizes.layers, minWidth: 0, flex: `0 0 ${panels.sizes.layers}px` }}>
      <div className="panel-heading"><span><Layers size={15} /> Layers</span><span className="subtle">{nodes.length}</span></div>
      <HorizontalScroll contentClassName="face-tabs" label="Component faces"><button className={face === 'front' ? 'active' : ''} onClick={() => { setFace('front'); setSelected([]); }}>Front</button>
        <button disabled={!component.flippable} className={face === 'back' ? 'active' : ''} onClick={() => { setFace('back'); setSelected([]); }}>Back</button></HorizontalScroll>
      <div className="layer-list">
        {layers(null)}{!nodes.length && <p className="empty-note">A blank canvas.<br />Add your first layer above.</p>}
      </div>
      <div className="layer-footer"><button onClick={() => { setCsv(component.csv); setDataOpen(true); }}><Database size={16} /><span>Data bindings<small>{component.rows.length} rows connected</small></span><ChevronRight size={14} /></button></div>
    </aside>
    <PanelSeparator label="Resize designer layers" controls="designer-layers-panel" value={panels.sizes.layers} {...panels.limits.layers} onResize={value => panels.resize('layers', value)} />
    <section className="designer-canvas">
      <div className={`designer-toolbar-scroll${toolbarEdges.left ? ' overflow-left' : ''}${toolbarEdges.right ? ' overflow-right' : ''}`}>
      <ScrollArrows target={toolbar} {...toolbarEdges} label="designer toolbar" />
      <div className="canvas-toolbar" ref={toolbar}>
        <div className="tool-group">
          <button title="Add text" aria-label="Add text" onClick={() => addNode('text')}><Type size={19} /></button>
          <div className="designer-tool-menu"><button aria-label="Add shape" title="Add shape" aria-expanded={toolMenu === 'shape'} onClick={event => toggleToolMenu('shape', event.currentTarget)}><Square size={18} /><ChevronDown className="tool-indicator" size={9} /></button>
            {toolMenu === 'shape' && createPortal(<div className="designer-popover designer-toolbar-popover" style={toolMenuPosition} role="menu">{(['rectangle', 'ellipse', 'polygon', 'star', 'path'] as const).map(kind => <button role="menuitem" key={kind} onClick={() => { addNode('shape', false, kind); setToolMenu(null); }}>{kind === 'path' ? 'Pen path' : kind[0].toUpperCase() + kind.slice(1)}</button>)}</div>, document.body)}</div>
          <button title="Add image" aria-label="Add image" onClick={() => addNode('image')}><ImagePlus size={19} /></button>
          <button title="Add empty element" aria-label="Add empty element" onClick={() => addNode('frame', true)}><Frame size={18} /></button>
          <button title={selected.length ? 'Group selected layers' : 'Create empty group'} aria-label="Create group" onClick={createGroup}><FolderPlus size={17} /></button>
          <div className="designer-tool-menu"><button aria-label="Link nested component" title="Link nested component" aria-expanded={toolMenu === 'link'} onClick={event => toggleToolMenu('link', event.currentTarget)}><Link2 size={17} /><ChevronDown className="tool-indicator" size={9} /></button>
            {toolMenu === 'link' && createPortal(<div className="designer-popover designer-toolbar-popover" style={toolMenuPosition} role="menu">{components.filter(item => item.id !== component.id).map(item => <button role="menuitem" key={item.id} onClick={() => { addNestedComponent(item.id); setToolMenu(null); }}>{item.name}</button>)}</div>, document.body)}</div>
        </div><span className="toolbar-divider" />
        <button title="Delete selected layers" aria-label="Delete selected layers" disabled={!selected.length} onClick={removeNode}><Trash2 size={16} /></button>
        <button title="Undo design edit" aria-label="Undo design edit" disabled={!history.length} onClick={undo}><Undo2 size={17} /></button>
        <button title="Redo design edit" aria-label="Redo design edit" disabled={!future.length} onClick={redo}><Redo2 size={17} /></button>
        <div className="toolbar-preview-row">
          <select aria-label="Preview row" value={component.rows.length ? row : ''} disabled={!component.rows.length} onChange={event => setRow(Number(event.target.value))}>
            {component.rows.length ? rowLabels.map((label, index) => <option key={index} value={index}>{label}</option>) : <option value="">Default</option>}
          </select>
        </div>
      </div></div>
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
            const pointDrag = pointDragging.current;
            if (pointDrag && pointDrag.pointer === event.pointerId) {
              if (Math.hypot(event.clientX - pointDrag.clientX, event.clientY - pointDrag.clientY) > 2) lastAnchorDown.current = null;
              const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(pointDrag.inverse);
              const localX = local.x - pointDrag.localX, localY = local.y - pointDrag.localY;
              const point = { ...pointDrag.point };
              if (pointDrag.handle === 'point') { point.x += localX; point.y += localY; }
              else if (pointDrag.handle === 'in') { point.inX += localX; point.inY += localY; }
              else { point.outX += localX; point.outY += localY; }
              if (event.shiftKey && pointDrag.handle === 'in') { point.outX = -point.inX; point.outY = -point.inY; }
              if (event.shiftKey && pointDrag.handle === 'out') { point.inX = -point.outX; point.inY = -point.outY; }
              const round = (value: number) => Math.round(value * 100) / 100;
              setPointPreview({ nodeId: pointDrag.nodeId, pointIndex: pointDrag.pointIndex,
                point: { x: round(point.x), y: round(point.y), inX: round(point.inX), inY: round(point.inY), outX: round(point.outX), outY: round(point.outY) } });
              return;
            }
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
            const pointDrag = pointDragging.current;
            if (pointDrag && pointDrag.pointer === event.pointerId) {
              const preview = pointPreview;
              if (preview) updateNode({ points: nodes.find(item => item.id === preview.nodeId)!.points.map((point, index) => index === preview.pointIndex ? preview.point : point) });
              pointDragging.current = null; setPointPreview(undefined); return;
            }
            const drag = dragging.current;
            if (drag && drag.pointer === event.pointerId && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) > 2) {
              const positions = dragPreview ?? Object.fromEntries(drag.ids.map(id => [id, drag.positions[id]]));
              update({ [face]: nodes.map(item => positions[item.id] ? { ...item, ...positions[item.id] } : item) });
            }
            dragging.current = null; setDragPreview(undefined);
          }}
          onPointerCancel={() => { dragging.current = null; pointDragging.current = null; setDragPreview(undefined); setPointPreview(undefined); }}>
          <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
            <ComponentView component={{ ...component, [face]: nodes.map(item => ({
              ...item, ...(dragPreview?.[item.id] ?? {}),
              ...(pointPreview?.nodeId === item.id ? { points: item.points.map((point, index) => index === pointPreview.pointIndex ? pointPreview.point : point) } : {}),
            })) }} components={components}
              row={row} back={face === 'back'} selectedNodes={selected} onNode={beginCanvasDrag} editableVector onPointDown={pointDown}
              selectedPoint={selectedPoint} onSegmentDown={segmentDown} />
          </div>
        </div>
        <div className="canvas-caption"><span className="live-dot" /> Live component <span>Changes appear on every instance</span></div>
        </div>
      </div>
      <div className="canvas-bottom"><span><Square size={12} /> {component.kind} component</span>
        <div><button onClick={() => setZoom(value => Math.max(.25, value - .25))}>-</button><button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button onClick={() => setZoom(value => Math.min(3, value + .25))}>+</button></div></div>
    </section>
    <PanelSeparator label="Resize designer inspector" controls="designer-inspector-panel" value={panels.sizes.designerInspector} {...panels.limits.designerInspector} direction={-1} onResize={value => panels.resize('designerInspector', value)} />
    <aside id="designer-inspector-panel" className="inspector" style={{ width: panels.sizes.designerInspector, minWidth: 0, flex: `0 0 ${panels.sizes.designerInspector}px` }}>
      <HorizontalScroll contentClassName="inspector-tabs" label="Designer inspector tabs"><button className={tab === 'design' ? 'active' : ''} onClick={() => setTab('design')}>Design</button><button className={tab === 'behavior' ? 'active' : ''} onClick={() => setTab('behavior')}>Behavior</button></HorizontalScroll>
      <div className="inspector-scroll">
        {tab === 'design' && <div className="inspector-section design-section boolean-section">
          <div className="boolean-actions" aria-label="Boolean operations">
          {([
            { operation: 'union', label: 'Union' },
            { operation: 'subtract', label: 'Subtract' },
            { operation: 'intersect', label: 'Intersect' },
            { operation: 'exclude', label: 'Exclude' },
          ] as const).map(({ operation, label }) => <button key={operation} className="icon-button" title={label} aria-label={label}
            disabled={selectedNodes.length < 2 || selectedNodes.some(item => !['shape', 'compound'].includes(item.type))}
            onClick={() => makeCompound(operation)}><BooleanIcon operation={operation} /></button>)}
          <button className="icon-button" title="Uncombine live compound" aria-label="Uncombine live compound"
            disabled={!selectedNodes.length || selectedNodes.some(item => item.type !== 'compound')} onClick={uncombine}><Layers size={18} /></button>
          </div>
        </div>}
        {tab === 'behavior' ? <>
          <div className="inspector-section"><h3>Component behavior</h3>
            <Field label="Component type"><select value={component.kind} onChange={event => update({ kind: event.target.value as Component['kind'] })}>
              <option value="card">Card</option><option value="token">Token</option><option value="board">Board</option><option value="dice">Dice</option><option value="artwork">Artwork</option>
            </select></Field>
            <p className="help-text">Changing type preserves artwork, dimensions, data and behavior settings.</p>
            <Toggle label="Flippable" description="Design a front and a back" checked={component.flippable} onChange={flippable => { if (!flippable) setFace('front'); update({ flippable }); }} />
            <Toggle label="Can be put in hand" checked={component.hand} onChange={hand => update({ hand })} />
            <Toggle label="Hide front in hand" description="Only the holder sees the front" checked={component.hideInHand} onChange={hideInHand => update({ hideInHand })} disabled={!component.hand} />
            <Toggle label="Can be stacked" checked={component.stackable} onChange={stackable => update({ stackable })} />
            <Toggle label="Shufflable" checked={component.shufflable} onChange={shufflable => update({ shufflable })} disabled={!component.stackable} />
            {component.stackable && <Field label="Stack tag"><input value={component.stackTag} placeholder="e.g. spirit-deck" onChange={event => update({ stackTag: event.target.value })} /></Field>}
            <p className="help-text">Matching tags can stack together. Leave blank to stack only this component's instances.</p>
          </div>
          {component.kind === 'dice' && <div className="inspector-section"><h3>Dice variants</h3>
            <p className="help-text">Each CSV row is one equally likely roll result. Edit its fields here, or use Data bindings to add columns. Bind text with {'{{value}}'} or another column name.</p>
            {!!component.rows.length && <>
              <Field label="Dice variant"><select value={row} onChange={event => setRow(Number(event.target.value))}>
                {rowLabels.map((label, index) => <option key={index} value={index}>{label}</option>)}
              </select></Field>
              {variantFields.map(field => <Field key={`${row}-${field}`} label={`Variant ${field}`}><input maxLength={10000} value={component.rows[row]?.[field] ?? ''} onChange={event => {
                void updateVariants(component.rows.map((variant, index) => index === row ? { ...variant, [field]: event.target.value } : variant));
              }} /></Field>)}
            </>}
            <div className="button-row"><button className="button" disabled={component.rows.length >= 10000} onClick={async () => {
              const next = Object.fromEntries(variantFields.map(field => [field, field === 'value' ? String(component.rows.length + 1) : '']));
              if (await updateVariants([...component.rows, next])) setRow(component.rows.length);
            }}>Add variant</button>
              <button className="button danger" disabled={component.rows.length < 2} onClick={async () => {
                if (await updateVariants(component.rows.filter((_, index) => index !== row), row)) setRow(Math.min(row, component.rows.length - 2));
              }}>Remove variant</button></div>
            <p className="help-text">Keep at least one variant. Removing a row shifts later dice and fixed nested-row references down; references to the removed result use the next result, or the last remaining result. Parent-field row bindings keep their CSV values.</p>
          </div>}
          <div className="inspector-section"><h3>Portable by design</h3><p className="help-text">Export the full component, including both faces, behavior and CSV data.</p>
            <button className="button full" onClick={() => download(`${component.name}.component.json`, JSON.stringify(exportComponentBundle(component, components), null, 2))}><Download size={15} /> Export component</button>
            <button className="button full danger" style={{ marginTop: 10 }} onClick={() => setDeleteOpen(true)}><Trash2 size={14} /> Delete component</button></div>
        </> : node ? <>
          <div className="inspector-section design-section selection-section" key={node.id}>
            <div className="selection-header">
              <Field label="Layer name"><input value={selected.length > 1 ? `${selected.length} layers` : node.name} disabled={selected.length > 1} onChange={event => updateNode({ name: event.target.value })} /></Field>
              <div className="selection-actions">
                {selected.length === 1 && <button className={`icon-button visibility-toggle${node.visible === false ? ' is-hidden' : ''}`} aria-label="Visible" aria-pressed={node.visible !== false}
                  title={node.visible === false ? 'Show layer' : 'Hide layer'} onClick={() => toggleLayerVisibility(node)}>{node.visible === false ? <EyeOff size={14} /> : <Eye size={14} />}</button>}
                {canUngroup && <button className="button compact-action" title="Ungroup selected groups (Ctrl/Cmd+G)" aria-label="Ungroup selected groups (Ctrl/Cmd+G)" onClick={ungroupSelection}><Ungroup size={14} /><span>Ungroup</span></button>}
                <button className="icon-button danger" title="Delete selected layers" aria-label="Delete selected layers" onClick={removeNode}><Trash2 size={14} /></button>
              </div>
            </div>
          </div>
          <div className="inspector-section design-section transform-section">
            <div className="field-grid transform-grid"><NumberField label="X" icon={<MoveHorizontal size={14} />} value={node.x} onChange={x => updateNode({ x })} />
              <NumberField label="Y" icon={<MoveVertical size={14} />} value={node.y} onChange={y => updateNode({ y })} />
              <NumberField label="Width" icon={<MoveHorizontal size={14} />} value={node.width} min={1} max={4000} onChange={width => updateNode({ width })} />
              <NumberField label="Height" icon={<MoveVertical size={14} />} value={node.height} min={1} max={4000} onChange={height => updateNode({ height })} />
              <NumberField label="Rotation" icon={<RotateCw size={14} />} value={node.rotation} onChange={rotation => updateNode({ rotation })} />
              {selected.length === 1 && node.type === 'frame' && <NumberField label="Radius" value={node.radius} min={0} max={2000} onChange={radius => updateNode({ radius })} />}</div>
            <div className="field-grid sizing-grid">
              <Field label="Width sizing"><select value={selectedNodes.every(item => (item.widthMode ?? 'fixed') === (node.widthMode ?? 'fixed')) ? node.widthMode ?? 'fixed' : 'mixed'}
                onChange={event => { if (event.target.value !== 'mixed') updateNode({ widthMode: event.target.value as DesignNode['widthMode'] }); }}>
                {selectedNodes.some(item => (item.widthMode ?? 'fixed') !== (node.widthMode ?? 'fixed')) && <option value="mixed" disabled>Mixed</option>}
                <option value="fixed">Fixed</option><option value="hug">Hug contents</option><option value="fill">Fill parent</option></select></Field>
              <Field label="Height sizing"><select value={selectedNodes.every(item => (item.heightMode ?? 'fixed') === (node.heightMode ?? 'fixed')) ? node.heightMode ?? 'fixed' : 'mixed'}
                onChange={event => { if (event.target.value !== 'mixed') updateNode({ heightMode: event.target.value as DesignNode['heightMode'] }); }}>
                {selectedNodes.some(item => (item.heightMode ?? 'fixed') !== (node.heightMode ?? 'fixed')) && <option value="mixed" disabled>Mixed</option>}
                <option value="fixed">Fixed</option><option value="hug">Hug contents</option><option value="fill">Fill parent</option></select></Field>
            </div>
          </div>
          <div className="inspector-section design-section appearance-section" key={`appearance-${node.id}`}>
            <ColorField label="Fill color" value={node.fill} onChange={fill => updateNode({ fill })} />
            <NumberField label="Opacity" icon={<Eye size={14} />} value={node.opacity} min={0} max={1} step={.05} onChange={opacity => updateNode({ opacity })} />
          </div>
          {selected.length === 1 && <div className="inspector-section design-section content-section">
            {node.type === 'text' && selected.length === 1 && <>
              <Field label="Text / binding"><textarea value={node.text} onChange={event => updateNode({ text: event.target.value })} rows={3} /></Field>
              <p className="help-text">Mix static text with <code>{'{{column_name}}'}</code>.</p>
              <Field label="Google font"><input list="google-fonts" value={node.font} onChange={event => updateNode({ font: event.target.value })} /></Field>
              <datalist id="google-fonts">{['DM Sans', 'Lora', 'Inter', 'Playfair Display', 'Space Grotesk', 'Roboto', 'Cinzel', 'Bebas Neue'].map(font => <option key={font}>{font}</option>)}</datalist>
              <div className="field-grid"><NumberField label="Font size" value={node.fontSize} min={4} max={400} onChange={fontSize => updateNode({ fontSize })} />
                <ColorField label="Text color" value={node.color} onChange={color => updateNode({ color })} /></div>
              <Field label="Alignment"><select value={node.align} onChange={event => updateNode({ align: event.target.value as DesignNode['align'] })}><option value="start">Left</option><option value="center">Center</option><option value="end">Right</option></select></Field>
            </>}
            {node.type === 'image' && selected.length === 1 && <><Field label="Image URL / binding"><textarea rows={3} value={node.text} onChange={event => updateNode({ text: event.target.value })} placeholder="https://... or {{image}}" /></Field><p className="help-text">HTTPS texture URLs and CSV bindings are supported.</p></>}
            {node.type === 'shape' && selected.length === 1 && <>
              <Field label="Vector shape"><select value={node.shapeKind} onChange={event => {
                const nextKind = event.target.value as DesignNode['shapeKind'];
                const points = nextKind === 'path' && node.points.length < 2
                  ? [{ x: 12, y: 12, inX: 0, inY: 0, outX: 0, outY: 0 },
                    { x: node.width - 12, y: 12, inX: 0, inY: 0, outX: 0, outY: 0 },
                    { x: node.width - 12, y: node.height - 12, inX: 0, inY: 0, outX: 0, outY: 0 },
                    { x: 12, y: node.height - 12, inX: 0, inY: 0, outX: 0, outY: 0 }]
                  : node.points;
                updateNode({ shapeKind: nextKind, points });
              }}>
                <option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option><option value="polygon">Polygon</option>
                <option value="star">Star</option><option value="path">Pen path</option>
              </select></Field>
              {(node.shapeKind === 'polygon' || node.shapeKind === 'star') && <>
                <NumberField label="Sides" value={node.sides} min={3} max={100} onChange={sides => updateNode({ sides })} />
                {node.shapeKind === 'star' && <NumberField label="Inner radius ratio" value={node.innerRadius} min={.05} max={.95} step={.05} onChange={innerRadius => updateNode({ innerRadius })} />}
              </>}
              {node.shapeKind === 'rectangle' && <NumberField label="Corner radius" value={node.radius} min={0} max={2000} onChange={radius => updateNode({ radius })} />}
              <div className="field-grid">
                <ColorField label="Stroke color" value={node.stroke} onChange={stroke => updateNode({ stroke })} />
                <NumberField label="Stroke weight" value={node.strokeWidth} min={0} max={200} step={.5} onChange={strokeWidth => updateNode({ strokeWidth })} />
              </div>
              {node.shapeKind === 'path' && <>
                <div className="vector-editor-heading"><strong>Path points</strong><span>{node.points.length} points</span></div>
                <Field label="Selected point"><select value={selectedPoint} onChange={event => setSelectedPoint(Number(event.target.value))}>
                  <option value={-1}>None</option>
                  {node.points.map((_, index) => <option key={index} value={index}>Point {index + 1}</option>)}
                </select></Field>
                {node.points[selectedPoint] && <>
                  <div className="field-grid"><NumberField label="X" value={node.points[selectedPoint].x} min={-4000} max={4000} step={.5} onChange={x => updateNode({ points: node.points.map((point, index) => index === selectedPoint ? { ...point, x } : point) })} />
                    <NumberField label="Y" value={node.points[selectedPoint].y} min={-4000} max={4000} step={.5} onChange={y => updateNode({ points: node.points.map((point, index) => index === selectedPoint ? { ...point, y } : point) })} /></div>
                  <div className="field-grid"><NumberField label="In handle X" value={node.points[selectedPoint].inX} min={-4000} max={4000} step={.5} onChange={inX => updateNode({ points: node.points.map((point, index) => index === selectedPoint ? { ...point, inX } : point) })} />
                    <NumberField label="In handle Y" value={node.points[selectedPoint].inY} min={-4000} max={4000} step={.5} onChange={inY => updateNode({ points: node.points.map((point, index) => index === selectedPoint ? { ...point, inY } : point) })} /></div>
                  <div className="field-grid"><NumberField label="Out handle X" value={node.points[selectedPoint].outX} min={-4000} max={4000} step={.5} onChange={outX => updateNode({ points: node.points.map((point, index) => index === selectedPoint ? { ...point, outX } : point) })} />
                    <NumberField label="Out handle Y" value={node.points[selectedPoint].outY} min={-4000} max={4000} step={.5} onChange={outY => updateNode({ points: node.points.map((point, index) => index === selectedPoint ? { ...point, outY } : point) })} /></div>
                  <div className="button-row">
                    <button className="button" onClick={() => updateNode({ points: node.points.map((point, index) => index === selectedPoint
                      ? { ...point, inX: -Math.min(node.width, node.height) / 6, inY: 0, outX: Math.min(node.width, node.height) / 6, outY: 0 } : point) })}>Smooth handles</button>
                    <button className="button" onClick={() => updateNode({ points: node.points.map((point, index) => index === selectedPoint
                      ? { ...point, inX: 0, inY: 0, outX: 0, outY: 0 } : point) })}>Straight handles</button>
                  </div>
                </>}
                <div className="button-row"><button className="button" onClick={appendPoint}>Add point</button>
                  <button className="button danger" onClick={() => deletePoint()}>Delete point</button></div>
                <Toggle label="Closed path" checked={node.pathClosed} onChange={pathClosed => updateNode({ pathClosed })} />
                <p className="help-text">Drag anchors and Bézier handles on the canvas, or edit their coordinates here.</p>
              </>}
            </>}
            {node.type === 'compound' && selected.length === 1 && <>
              <Field label="Live boolean operation"><select value={node.compoundOperation} onChange={event => updateNode({ compoundOperation: event.target.value as DesignNode['compoundOperation'] })}>
                <option value="union">Union</option><option value="subtract">Subtract</option><option value="intersect">Intersect</option><option value="exclude">Exclude (XOR)</option>
              </select></Field>
              <p className="help-text">Source layers remain editable in the hierarchy. Edit a source, change the operation, or uncombine to separate them again.</p>
              <button className="button full" onClick={uncombine}>Uncombine source shapes</button>
            </>}
            {node.type === 'component' && selected.length === 1 && <>
              <Field label="Nested fitting"><select value={node.nestedFit ?? 'stretch'} onChange={event => updateNode({ nestedFit: event.target.value as DesignNode['nestedFit'] })}>
                <option value="stretch">Stretch</option><option value="contain">Fit inside</option><option value="cover">Fill / crop (envelope)</option>
              </select></Field>
              <p className="help-text">Stretch fills both dimensions. Fit inside preserves the full artwork; envelope fills the box and crops overflow. Aspect-preserving modes are centered.</p>
              <Field label="Linked component"><select value={node.componentId ?? ''} onChange={event => {
                const linked = components.find(item => item.id === event.target.value);
                if (linked) updateNode({ componentId: linked.id, name: linked.name, width: linked.width, height: linked.height, dataRow: 0 });
              }}>
                {components.filter(item => item.id !== component.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select></Field>
              <Field label="Nested data"><select value={node.dataSource} onChange={event => updateNode({ dataSource: event.target.value as DesignNode['dataSource'] })}>
                <option value="inherit">Inherit parent row</option><option value="row">Use this component’s row</option><option value="field">Choose row from parent CSV field</option>
              </select></Field>
              {node.dataSource === 'row' && <NumberField label={`Own row (0–${Math.max(0, (components.find(item => item.id === node.componentId)?.rows.length ?? 1) - 1)})`}
                value={node.dataRow} min={0} max={Math.max(0, (components.find(item => item.id === node.componentId)?.rows.length ?? 1) - 1)}
                onChange={dataRow => updateNode({ dataRow })} />}
              {node.dataSource === 'field' && <>
                <Field label="Parent CSV field (zero-based row index)"><input value={node.dataField} list="nested-data-fields" placeholder="e.g. portraitRow" onChange={event => updateNode({ dataField: event.target.value })} /></Field>
                <datalist id="nested-data-fields">{Object.keys(component.rows[row] ?? {}).map(key => <option key={key}>{key}</option>)}</datalist>
                <p className="help-text">The selected parent row must contain an integer from 0 to {Math.max(0, (components.find(item => item.id === node.componentId)?.rows.length ?? 1) - 1)}. Invalid or missing values show an error instead of silently choosing another row.</p>
              </>}
            </>}
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
          </div>}
          {selected.length === 1 && <div className="inspector-section design-section visibility-rules">
            <Field label="Show when CSV field"><input value={node.visibilityField} placeholder="Always visible" onChange={event => updateNode({ visibilityField: event.target.value })} /></Field>
            {!!node.visibilityField && <Field label="Equals value"><input value={node.visibilityValue} onChange={event => updateNode({ visibilityValue: event.target.value })} /></Field>}
          </div>}
        </> : <>
          <div className="inspector-section design-section">
            <Field label="Name"><input value={component.name} onChange={event => { if (event.target.value) update({ name: event.target.value }); }} /></Field>
            <div className="field-grid"><NumberField label="Width" value={component.width} min={20} max={2000} onChange={width => update({ width })} /><NumberField label="Height" value={component.height} min={20} max={2000} onChange={height => update({ height })} /></div>
            <ColorField label="Component background" value={component.color} onChange={color => update({ color })} />
          </div>
          <div className="inspector-section design-section">
            <p className="help-text">Select one or more layers to move, edit, group or delete them. Add transparent groups and responsive frames with the toolbar.</p>
            <p className="help-text">Use {'{{name}}'} in any text or image layer to connect it to your CSV.</p><button className="text-button" onClick={() => { setCsv(component.csv); setDataOpen(true); }}>Connect your data <ChevronRight size={13} /></button></div>
        </>}
      </div>
    </aside>
    {dataOpen && <Modal title="A little data. A whole deck." subtitle="Each CSV row becomes a different instance of this component." wide onClose={() => setDataOpen(false)}>
      <div className="data-dialog"><div className="data-toolbar"><span><FileSpreadsheet size={16} /> CSV data source</span><label className="button"><Upload size={14} /> Import CSV<input type="file" accept=".csv,text/csv" hidden onChange={async event => {
        try { const file = event.target.files?.[0]; if (file) setCsv(await file.text()); } catch (error) { notify(String(error), true); }
      }} /></label></div>
        {!!component.rows.length && <Field label="Preview row"><select value={row} onChange={event => setRow(Number(event.target.value))}>
          {rowLabels.map((label, index) => <option key={index} value={index}>{label}</option>)}
        </select></Field>}
        <textarea className="csv-editor" aria-label="CSV data" value={csv} onChange={event => setCsv(event.target.value)} spellCheck={false} />
        <p className="help-text">Include a header row. Quoted cells, commas and multiline text are supported. Updating data refreshes existing pieces by row index.</p>
        <div className="modal-actions"><button className="button" onClick={() => setDataOpen(false)}>Cancel</button><button className="button primary" onClick={saveCsv}><Database size={15} /> Apply data & refresh instances</button></div>
      </div></Modal>}
    {deleteOpen && <Modal title="Remove this component?" subtitle={`This deletes ${component.name} and every spawned instance, including pieces in hands. Export it first if you want to keep a copy.`} onClose={() => setDeleteOpen(false)}>
      <div className="data-dialog"><div className="modal-actions"><button className="button" onClick={() => setDeleteOpen(false)}>Keep component</button><button className="button danger" onClick={onDelete}><Trash2 size={15} /> Delete component & instances</button></div></div>
    </Modal>}
  </div>;
}
