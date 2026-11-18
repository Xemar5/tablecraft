import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, CaseLower, CaseSensitive, CaseUpper, ChevronDown, ChevronRight, Crop, Database, Download, Eye, EyeOff, FileSpreadsheet, Frame, FolderPlus, ImagePlus, Italic, Layers, Link2, MousePointer2, MoveHorizontal, MoveVertical, PenTool, Redo2, RemoveFormatting, RotateCcw, RotateCw, Spline, Square, Strikethrough, Trash2, Type, Underline, Undo2, Ungroup, Upload } from 'lucide-react';
import Papa from 'papaparse';
import { ComponentView, fittedImageSize, imagePlacement, useNaturalSize } from './ComponentView';
import { hasPages, isAsset, makeNode, moveLayer, resolveImage, type Component, type DesignNode } from './domain';
import { combineLayers, convertToPaths, copySubtrees, groupLayers, pasteSubtrees, selectedRoots, uncombineLayers, ungroupLayers } from './designerOperations';
import { componentZip, downloadZip } from './portable';
import { FontPicker } from './FontPicker';
import { ColorField, Field, HorizontalScroll, IconChoice, Modal, NumberField, ScrollArrows, SectionTitle, Toggle, useSmoothHorizontalWheel } from './ui';
import { closestSegmentParameter, expandPathBounds, fitPathBounds, segmentControls, splitPathSegment } from './vectorGeometry';
import { resizeCenteredBox, resizeNode, rotateNode, snapTo, zoomPrecision } from './designTransform';
import { SearchSelect } from './SearchSelect';
import { parseCsvData, variantLabels } from './csv';
import { PanelSeparator, type usePanelLayout } from './panelLayout';
import { ZoomPresets } from './ZoomPresets';
import { cssPx, uiScale } from './uiScale';

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
type HandleDrag = { id: string; kind: 'resize' | 'rotate'; hx: number; hy: number; pointer: number; clientX: number; clientY: number;
  start: DesignNode; angle: number; centerX: number; centerY: number; pointerAngle: number };
const RESIZE_HANDLES = [[-1, -1, 'top-left corner'], [0, -1, 'top edge'], [1, -1, 'top-right corner'], [1, 0, 'right edge'],
  [1, 1, 'bottom-right corner'], [0, 1, 'bottom edge'], [-1, 1, 'bottom-left corner'], [-1, 0, 'left edge']] as const;
const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
type PointDrag = { nodeId: string; pointIndex: number; handle: 'point' | 'in' | 'out'; pointer: number; clientX: number; clientY: number; inverse: DOMMatrix; localX: number; localY: number; point: DesignNode['points'][number] };
type VectorPoint = DesignNode['points'][number];
type PointEdit = { nodeId: string; pointIndex: number; handle: 'point' | 'in' | 'out'; event: PointerEvent<SVGElement>; inverse: DOMMatrix };
/** A pen path being drawn: its points are in component coordinates until it is finished. */
type PenDraft = { node: DesignNode; drag?: { pointer: number; index: number }; hover?: { x: number; y: number } };
const ZOOM_MIN = .05, ZOOM_MAX = 10;
const ZOOM_LEVELS = [.05, .1, .25, .5, 1, 2, 4, 10];
const clampZoom = (value: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
const FONT_WEIGHTS = [[100, 'Thin'], [200, 'Extra light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']] as const;
const TEXT_ALIGNS = [{ value: 'start', label: 'Align left', icon: <AlignLeft size={15} /> }, { value: 'center', label: 'Align center', icon: <AlignCenter size={15} /> },
  { value: 'end', label: 'Align right', icon: <AlignRight size={15} /> }, { value: 'justify', label: 'Justify', icon: <AlignJustify size={15} /> }] as const;
const VERTICAL_ALIGNS = [{ value: 'start', label: 'Align top', icon: <AlignVerticalJustifyStart size={15} /> },
  { value: 'center', label: 'Align middle', icon: <AlignVerticalJustifyCenter size={15} /> }, { value: 'end', label: 'Align bottom', icon: <AlignVerticalJustifyEnd size={15} /> }] as const;
const TEXT_CASES = [{ value: 'none', label: 'As typed', icon: <RemoveFormatting size={15} /> }, { value: 'uppercase', label: 'Uppercase', icon: <CaseUpper size={15} /> },
  { value: 'lowercase', label: 'Lowercase', icon: <CaseLower size={15} /> }, { value: 'capitalize', label: 'Capitalize words', icon: <CaseSensitive size={15} /> }] as const;
const BOOLEAN_OPERATIONS = [{ operation: 'union', label: 'Union' }, { operation: 'subtract', label: 'Subtract' },
  { operation: 'intersect', label: 'Intersect' }, { operation: 'exclude', label: 'Exclude' }] as const;

/**
 * Anchors, Bézier handles and segments of a pen path, drawn over the artboard at a constant on-screen size whatever
 * the zoom. The path's own rendered SVG gives the transform from its points to the screen, so rotation, parent
 * layers, zoom and the interface scale all apply.
 */
function PathOverlay({ artboard, node, selectedPoint, rubberBand, closing = false, onPointDown, onSegmentDown }: {
  artboard: RefObject<HTMLDivElement | null>; node: DesignNode; selectedPoint: number;
  /** While drawing: the pointer, in the path's coordinates, previewing the next segment. */
  rubberBand?: { x: number; y: number }; closing?: boolean;
  onPointDown?: (edit: PointEdit) => void; onSegmentDown?: (index: number, local: DOMPoint) => void;
}) {
  const [frame, setFrame] = useState<{ toOverlay: DOMMatrix; ctm: DOMMatrix }>();
  useLayoutEffect(() => {
    const board = artboard.current;
    const svg = board?.querySelector<SVGSVGElement>(`.design-node[data-node-id="${CSS.escape(node.id)}"] > svg.vector-shape`);
    const ctm = svg?.getScreenCTM();
    if (!board || !ctm) { setFrame(undefined); return; }
    const rect = board.getBoundingClientRect(), scale = uiScale();
    const toOverlay = new DOMMatrix().scaleSelf(1 / scale).translateSelf(-rect.left, -rect.top).multiplySelf(ctm);
    setFrame(previous => previous && previous.toOverlay.toString() === toOverlay.toString() ? previous : { toOverlay, ctm });
  });
  if (!frame || !node.points.length) return null;
  const at = (x: number, y: number) => frame.toOverlay.transformPoint(new DOMPoint(x, y));
  const points = node.points, segments = points.length - (node.pathClosed ? 0 : 1);
  const curve = (from: VectorPoint, to: VectorPoint) => {
    const [p0, p1, p2, p3] = segmentControls(from, to).map(([x, y]) => at(x, y));
    return `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}`;
  };
  const down = (index: number, handle: PointEdit['handle']) => onPointDown && ((event: PointerEvent<SVGElement>) => {
    event.stopPropagation();
    onPointDown({ nodeId: node.id, pointIndex: index, handle, event, inverse: frame.ctm.inverse() });
  });
  const last = points[points.length - 1];
  return <svg className={`path-overlay${onPointDown ? '' : ' passive'}`} aria-label={`${node.name} vector points`}>
    {Array.from({ length: Math.max(0, segments) }, (_, index) => {
      const d = curve(points[index], points[(index + 1) % points.length]);
      return <g key={`segment-${index}`}><path className="vector-outline" d={d} />
        {onSegmentDown && <path className="vector-segment" d={d} onPointerDown={event => {
          event.stopPropagation(); event.preventDefault();
          onSegmentDown(index, new DOMPoint(event.clientX, event.clientY).matrixTransform(frame.ctm.inverse()));
        }} />}</g>;
    })}
    {rubberBand && <path className="pen-rubber-band" d={curve(last, { ...rubberBand, inX: 0, inY: 0, outX: 0, outY: 0 })} />}
    {points.map((point, index) => {
      const anchor = at(point.x, point.y), handleIn = at(point.x + point.inX, point.y + point.inY), handleOut = at(point.x + point.outX, point.y + point.outY);
      return <g key={index}>
        {(point.inX || point.inY) ? <><line x1={anchor.x} y1={anchor.y} x2={handleIn.x} y2={handleIn.y} />
          <circle className="vector-handle" cx={handleIn.x} cy={handleIn.y} r={3.5} onPointerDown={down(index, 'in')} /></> : null}
        {(point.outX || point.outY) ? <><line x1={anchor.x} y1={anchor.y} x2={handleOut.x} y2={handleOut.y} />
          <circle className="vector-handle" cx={handleOut.x} cy={handleOut.y} r={3.5} onPointerDown={down(index, 'out')} /></> : null}
        <circle className={`vector-anchor${selectedPoint === index ? ' selected' : ''}${closing && index === 0 ? ' pen-start' : ''}`} cx={anchor.x} cy={anchor.y} r={4.5}
          onPointerDown={down(index, 'point')} />
      </g>;
    })}
  </svg>;
}
type ImagePlacementPatch = Pick<DesignNode, 'imageOffsetX' | 'imageOffsetY' | 'imageScaleX' | 'imageScaleY' | 'imageRotation'>;
type ImageDrag = { kind: 'move' | 'resize' | 'rotate'; hx: number; hy: number; pointer: number; clientX: number; clientY: number;
  start: ReturnType<typeof imagePlacement>; base: { width: number; height: number }; box: { width: number; height: number }; angle: number;
  centerX: number; centerY: number; pointerAngle: number };
const IMAGE_FITS = [['cover', 'Fill and crop'], ['contain', 'Fit inside'], ['stretch', 'Stretch'], ['original', 'Original size'], ['tile', 'Tile']] as const;
const roundTo = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
/** Clamps a picture placement into the layer schema's limits. */
function placementPatch(placement: ReturnType<typeof imagePlacement>): ImagePlacementPatch {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  return { imageOffsetX: roundTo(clamp(placement.x, -8000, 8000), 2), imageOffsetY: roundTo(clamp(placement.y, -8000, 8000), 2),
    imageScaleX: roundTo(clamp(placement.scaleX, .01, 100), 4), imageScaleY: roundTo(clamp(placement.scaleY, .01, 100), 4),
    imageRotation: roundTo(((placement.rotation + 180) % 360 + 360) % 360 - 180, 1) };
}

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

function usesPosition(node: DesignNode, nodes: DesignNode[], axis: 'x' | 'y') {
  if ((axis === 'x' ? node.widthMode ?? 'fixed' : node.heightMode ?? 'fixed') !== 'fixed') return false;
  return !node.parent || nodes.find(parent => parent.id === node.parent)?.layout === 'absolute';
}

// Centre and total angle of a visible, fixed-size layer whose ancestors all use absolute layout.
function transformBox(node: DesignNode, nodes: DesignNode[]) {
  if ((node.widthMode ?? 'fixed') !== 'fixed' || (node.heightMode ?? 'fixed') !== 'fixed') return undefined;
  const byId = new Map(nodes.map(item => [item.id, item]));
  for (let current: DesignNode | undefined = node; current; current = current.parent ? byId.get(current.parent) : undefined) {
    if (current.visible === false) return undefined;
  }
  const center = worldPosition({ ...node, x: node.x + node.width / 2, y: node.y + node.height / 2 }, nodes);
  return center && { ...center, angle: nodeAngle(node, nodes) + node.rotation * Math.PI / 180 };
}

export function Designer({ component: incoming, components, onChange, onDelete, notify, tab, setTab, panels, layersVisible = true, flushRef }: {
  component: Component; components: Component[]; onChange: (c: Component, removedDataRow?: number) => Promise<boolean>; onDelete: () => void; notify: (message: string, error?: boolean) => void;
  tab: 'design' | 'behavior'; setTab: (tab: 'design' | 'behavior') => void; panels: ReturnType<typeof usePanelLayout>; layersVisible?: boolean;
  /** Set to a function that hands any held edit to `onChange` at once (the app calls it before its own commands). */
  flushRef?: { current: (() => void) | undefined };
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
  const [toolMenu, setToolMenu] = useState<'shape' | null>(null);
  // The pen tool draws a new path point by point; everything else uses the selection tool.
  const [tool, setTool] = useState<'select' | 'pen'>('select');
  const [pen, setPen] = useState<PenDraft>();
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
  const toggleToolMenu = (menu: 'shape', button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    setToolMenuPosition({ left: Math.max(8, Math.min(cssPx(rect.left), cssPx(window.innerWidth) - 180)), top: cssPx(rect.bottom) + 4 });
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
  // Drags and resizes snap to about one screen pixel, so they stay smooth when zoomed in.
  const precision = zoomPrecision(zoom);
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
  const handleDragging = useRef<HandleDrag>(null);
  const [handlePreview, setHandlePreview] = useState<{ id: string; patch: Partial<DesignNode> }>();
  // Double-clicking an image layer edits where its picture sits inside the layer's frame.
  const [imageEdit, setImageEdit] = useState<string>();
  const imageDragging = useRef<ImageDrag>(null);
  const [imagePreview, setImagePreview] = useState<{ id: string; patch: ImagePlacementPatch }>();
  const pointDragging = useRef<PointDrag>(null);
  const pointSelectionNode = useRef<string | undefined>(undefined);
  const lastAnchorDown = useRef<{ nodeId: string; index: number; time: number } | null>(null);
  // Continuous edits from one control (typing, sliders, scrubbing, held nudges) share a single undo entry.
  const editSession = useRef<{ target: unknown; recorded: boolean } | null>(null);
  const beginEdit = (target: unknown) => { if (editSession.current?.target !== target) editSession.current = { target, recorded: false }; };
  const endEdit = (target: unknown) => { if (editSession.current?.target === target) { editSession.current = null; flushLatest.current(); } };
  const isFormControl = (target: EventTarget) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  useEffect(() => {
    const element = designer.current; if (!element) return;
    const change = (event: Event) => endEdit(event.target);
    element.addEventListener('change', change);
    return () => element.removeEventListener('change', change);
  }, []);
  const nodes = component[face];
  const selectedNodes = selected.map(id => nodes.find(item => item.id === id)).filter((item): item is DesignNode => !!item);
  const node = selectedNodes[0];
  // X/Y only place layers with a fixed size on that axis inside an absolute parent; hug, fill and flow layouts use margins instead.
  const positionsX = selectedNodes.some(item => usesPosition(item, nodes, 'x')), positionsY = selectedNodes.some(item => usesPosition(item, nodes, 'y'));
  useEffect(() => {
    if (pointSelectionNode.current !== node?.id) { pointSelectionNode.current = node?.id; setSelectedPoint(-1); return; }
    if (node?.type === 'shape' && node.shapeKind === 'path' && node.points.length) setSelectedPoint(index => Math.min(index, node.points.length - 1));
    else setSelectedPoint(-1);
  }, [node?.id, node?.type === 'shape' ? node.points.length : 0]);
  const send = async (next: Component, removedDataRow?: number) => {
    const success = await onChange(next, removedDataRow);
    pending.current--;
    if (!success && !pending.current) setComponent(latestIncoming.current);
    return success;
  };
  // Continuous edits (color pickers, scrubbing, sliders, typing, held nudges) show on the canvas at once but reach
  // the app only after a short pause or when the edit ends, so the app doesn't re-check and re-render every tick.
  const held = useRef<{ next: Component; done: ((success: boolean) => void)[] } | null>(null);
  const heldTimer = useRef<number>(undefined);
  const flushHeld = () => {
    window.clearTimeout(heldTimer.current); heldTimer.current = undefined;
    const item = held.current;
    if (!item) return;
    held.current = null;
    void send(item.next).then(success => item.done.forEach(resolve => resolve(success)));
  };
  const flushLatest = useRef(flushHeld);
  flushLatest.current = flushHeld;
  useEffect(() => {
    const flush = () => flushLatest.current();
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    if (flushRef) flushRef.current = flush;
    window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', hidden);
      if (flushRef?.current === flush) flushRef.current = undefined;
      flush();
    };
  }, [flushRef]);
  const commit = (next: Component, removedDataRow?: number, defer = false): Promise<boolean> => {
    setComponent(next);
    if (defer && removedDataRow === undefined) {
      if (held.current) held.current.next = next;
      else { pending.current++; held.current = { next, done: [] }; }
      window.clearTimeout(heldTimer.current);
      heldTimer.current = window.setTimeout(() => flushLatest.current(), 200);
      const item = held.current;
      return new Promise(resolve => item.done.push(resolve));
    }
    flushHeld();
    pending.current++;
    return send(next, removedDataRow);
  };
  const update = (patch: Partial<Component>, removedDataRow?: number) => {
    const session = editSession.current?.target === 'nudge' || editSession.current?.target === document.activeElement ? editSession.current : null;
    if (!session?.recorded) setHistory(h => [...h.slice(-39), structuredClone(component)]);
    if (session) session.recorded = true;
    setFuture([]);
    return commit({ ...component, ...patch }, removedDataRow, !!session);
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
  const addNode = (type: DesignNode['type'], shapeKind: DesignNode['shapeKind'] = 'rectangle') => {
    const parentCandidate = selectedNodes.length === 1 ? selectedNodes[0] : undefined;
    const parent = parentCandidate && (parentCandidate.type === 'frame' || (type === 'shape' && parentCandidate.type === 'compound')) ? parentCandidate.id : null;
    const next = makeNode(type, {
      parent, ...(type === 'shape' ? { shapeKind, width: 100, height: 100,
        points: shapeKind === 'path' ? [{ x: 12, y: 12, inX: 0, inY: 0, outX: 0, outY: 0 },
          { x: 88, y: 12, inX: 0, inY: 0, outX: 0, outY: 0 },
          { x: 88, y: 88, inX: 0, inY: 0, outX: 0, outY: 0 },
          { x: 12, y: 88, inX: 0, inY: 0, outX: 0, outY: 0 }] : [] } : {}),
    });
    update({ [face]: [...nodes, next] });
    setSelected([next.id]);
  };
  // Linked artwork starts empty; the component it shows is chosen in the Design panel.
  const addLinkedArtwork = () => {
    const parent = selectedNodes.length === 1 && selectedNodes[0].type === 'frame' ? selectedNodes[0].id : null;
    const nested = makeNode('component', { name: 'Linked artwork', width: 150, height: 150, fill: 'transparent', parent, dataSource: 'inherit' });
    update({ [face]: [...nodes, nested] }); setSelected([nested.id]); setTab('design');
  };
  const convertSelection = () => {
    try { const result = convertToPaths(nodes, selected); update({ [face]: result.nodes }); setSelected(result.selected); setSelectedPoint(-1); }
    catch (error) { notify(error instanceof Error ? error.message : 'Unable to convert to a path.', true); }
  };
  // ---------- pen tool ----------
  const artboardPoint = (clientX: number, clientY: number) => {
    const rect = artboard.current!.getBoundingClientRect();
    return { x: snapTo(cssPx(clientX - rect.left) / zoom, precision), y: snapTo(cssPx(clientY - rect.top) / zoom, precision) };
  };
  const finishPen = (closed = false) => {
    const draft = pen;
    setPen(undefined); setTool('select');
    if (!draft || draft.node.points.length < 2) return;
    try {
      const finished = fitPathBounds({ ...draft.node, pathClosed: closed && draft.node.points.length >= 3 });
      void update({ [face]: [...nodes, finished] }); setSelected([finished.id]); setSelectedPoint(-1);
    } catch (error) { notify(error instanceof Error ? error.message : 'Unable to finish the path.', true); }
  };
  const startPen = () => { setTool('pen'); setPen(undefined); setSelected([]); setImageEdit(undefined); setToolMenu(null); };
  const penDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!artboard.current) return;
    const point = artboardPoint(event.clientX, event.clientY);
    const anchor: VectorPoint = { ...point, inX: 0, inY: 0, outX: 0, outY: 0 };
    if (!pen) {
      if (nodes.length >= 300) { notify('A face cannot contain more than 300 layers.', true); return; }
      // Drawn in component coordinates; finishing fits the layer's box to the points.
      const node = makeNode('shape', { name: 'Path', shapeKind: 'path', x: 0, y: 0, width: component.width, height: component.height,
        fill: 'transparent', stroke: '#253d37', strokeWidth: 2, pathClosed: false, points: [anchor] });
      setPen({ node, drag: { pointer: event.pointerId, index: 0 } });
    } else {
      const points = pen.node.points;
      const near = (other: VectorPoint) => Math.hypot(other.x - point.x, other.y - point.y) * zoom < 8;
      if (points.length >= 3 && near(points[0])) { finishPen(true); return; }
      if (points.length >= 2 && near(points[points.length - 1])) { finishPen(false); return; }
      if (points.length >= 128) { notify('Paths are limited to 128 points.', true); return; }
      setPen({ node: { ...pen.node, points: [...points, anchor] }, drag: { pointer: event.pointerId, index: points.length } });
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const penMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pen || !artboard.current) return;
    const point = artboardPoint(event.clientX, event.clientY);
    if (pen.drag?.pointer !== event.pointerId) { setPen({ ...pen, hover: point }); return; }
    // Dragging out of a new point pulls symmetric Bézier handles; a click keeps a sharp corner.
    const index = pen.drag.index, anchor = pen.node.points[index];
    const outX = point.x - anchor.x, outY = point.y - anchor.y, sharp = Math.hypot(outX, outY) * zoom < 3;
    setPen({ ...pen, hover: undefined, node: { ...pen.node, points: pen.node.points.map((value, i) => i !== index ? value
      : { ...value, outX: sharp ? 0 : outX, outY: sharp ? 0 : outY, inX: sharp ? 0 : -outX, inY: sharp ? 0 : -outY }) } });
  };
  const penUp = (event: PointerEvent<HTMLDivElement>) => { if (pen?.drag?.pointer === event.pointerId) setPen({ ...pen, drag: undefined }); };
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
  // Shapes and boolean groups can be combined, uncombined and converted to pen paths.
  const vectorSelection = selectedNodes.length > 0 && selectedNodes.every(item => item.type === 'shape' || item.type === 'compound');
  const canConvert = vectorSelection && selectedNodes.some(item => !(item.type === 'shape' && item.shapeKind === 'path'));
  const ungroupSelection = () => {
    try { const result = ungroupLayers(nodes, selected); update({ [face]: result.nodes }); setSelected(result.selected); }
    catch (error) { notify(error instanceof Error ? error.message : 'Unable to ungroup layers.', true); }
  };
  const pointDown = ({ nodeId, pointIndex, handle, event, inverse }: PointEdit) => {
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
    const start = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
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
  const segmentDown = (nodeId: string, index: number, point: DOMPoint) => {
    const shape = nodes.find(item => item.id === nodeId);
    if (!shape || shape.points.length >= 128) { notify('Paths are limited to 128 points.', true); return; }
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
    editSession.current = null;
    const previous = history.at(-1); if (!previous) return;
    setHistory(history.slice(0, -1)); setFuture([...future, component]);
    setSelected(current => current.filter(id => previous[face].some(item => item.id === id))); void commit(previous);
  };
  const redo = () => {
    editSession.current = null;
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
      if (tool === 'pen' && !command) {
        if (key === 'enter' || key === 'escape') { event.preventDefault(); finishPen(false); return; }
        if ((key === 'backspace' || key === 'delete') && pen) {
          event.preventDefault();
          if (pen.node.points.length > 1) setPen({ ...pen, drag: undefined, node: { ...pen.node, points: pen.node.points.slice(0, -1) } }); else setPen(undefined);
          return;
        }
      }
      if (!command && !event.shiftKey && !event.altKey && (key === 'p' || key === 'v') && !event.repeat) {
        event.preventDefault();
        if (key === 'p') { if (tool !== 'pen') startPen(); } else if (tool === 'pen') finishPen(false);
        return;
      }
      if (command && key === 'e' && !event.shiftKey && !event.altKey && selected.length) { event.preventDefault(); convertSelection(); return; }
      if ((key === 'escape' || key === 'enter') && imageEdit) { event.preventDefault(); setImageEdit(undefined); return; }
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
          if (event.repeat) beginEdit('nudge'); else editSession.current = { target: 'nudge', recorded: false };
          update({ [face]: nodes.map(item => {
            if (!ids.has(item.id)) return item;
            const angle = nodeAngle(item, nodes);
            return { ...item, x: item.x + dx * Math.cos(angle) + dy * Math.sin(angle), y: item.y - dx * Math.sin(angle) + dy * Math.cos(angle) };
          }) });
        }
      } catch (error) { notify(error instanceof Error ? error.message : 'Unable to edit layers.', true); }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key.startsWith('Arrow')) endEdit('nudge');
      if (event.code === 'Space') { if (spacePanned.current) event.preventDefault(); spacePressed.current = false; spacePanned.current = false; }
    };
    const blur = () => { spacePressed.current = false; spacePanned.current = false; panning.current = null; endEdit('nudge'); };
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
    setPan(current => ({ x: current.x + cssPx(dx), y: current.y + cssPx(dy) }));
  }, [zoom]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      const next = clampZoom(zoom * Math.exp(-delta * .001));
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
  const rowOptions = useMemo(() => rowLabels.map((label, index) => ({ value: String(index), label })), [rowLabels]);
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
    if (!moving.some(item => usesPosition(item, nodes, 'x') || usesPosition(item, nodes, 'y'))) return;
    const positions = Object.fromEntries(moving.map(item => [item.id, { x: item.x, y: item.y }]));
    const angles = Object.fromEntries(moving.map(item => [item.id, nodeAngle(item, nodes)]));
    dragging.current = { ids: activeIds, pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY, positions, angles };
    artboard.current?.setPointerCapture(event.pointerId);
  };
  const shownNodes = (pen ? [...nodes, pen.node] : nodes).map(item => ({
    ...item, ...(dragPreview?.[item.id] ?? {}), ...(handlePreview?.id === item.id ? handlePreview.patch : {}),
    ...(imagePreview?.id === item.id ? imagePreview.patch : {}),
    ...(pointPreview?.nodeId === item.id ? { points: item.points.map((point, index) => index === pointPreview.pointIndex ? pointPreview.point : point) } : {}),
  }));
  const transformTarget = selected.length === 1 ? shownNodes.find(item => item.id === selected[0]) : undefined;
  const box = transformTarget && transformBox(transformTarget, shownNodes);
  const beginHandle = (event: PointerEvent<HTMLButtonElement>, kind: HandleDrag['kind'], hx = 0, hy = 0) => {
    const start = nodes.find(item => item.id === selected[0]);
    const frame = event.currentTarget.parentElement?.getBoundingClientRect();
    if (event.button !== 0 || spacePressed.current || !start || !frame) return;
    event.preventDefault(); event.stopPropagation();
    const centerX = frame.left + frame.width / 2, centerY = frame.top + frame.height / 2;
    handleDragging.current = { id: start.id, kind, hx, hy, pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY, start,
      angle: nodeAngle(start, nodes), centerX, centerY, pointerAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX) };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveHandle = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = handleDragging.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    event.stopPropagation();
    const patch = drag.kind === 'rotate'
      ? { rotation: rotateNode(drag.start, Math.atan2(event.clientY - drag.centerY, event.clientX - drag.centerX) - drag.pointerAngle, event.shiftKey) }
      : resizeNode(drag.start, drag.hx, drag.hy, cssPx(event.clientX - drag.clientX) / zoom, cssPx(event.clientY - drag.clientY) / zoom, drag.angle, event.shiftKey, precision);
    setHandlePreview({ id: drag.id, patch });
  };
  const endHandle = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = handleDragging.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    event.stopPropagation();
    handleDragging.current = null; setHandlePreview(undefined);
    if (handlePreview?.id !== drag.id) return;
    try {
      void update({ [face]: nodes.map(item => item.id === drag.id ? expandPathBounds({ ...item, ...handlePreview.patch }) : item) });
    } catch (error) { notify(error instanceof Error ? error.message : 'Unable to transform layer.', true); }
  };
  const cancelHandle = () => { handleDragging.current = null; setHandlePreview(undefined); };
  const editedImage = imageEdit && selected.length === 1 && selected[0] === imageEdit ? shownNodes.find(item => item.id === imageEdit && item.type === 'image') : undefined;
  useEffect(() => { if (imageEdit && !editedImage) setImageEdit(undefined); }, [imageEdit, editedImage]);
  const catalog = useMemo(() => new Map(components.map(item => [item.id, item])), [components]);
  // Components this one can show as linked artwork: never itself, an asset, or one that already shows this one.
  const linkable = useMemo(() => {
    const reaches = (id: string, seen: Set<string>): boolean => {
      if (id === component.id) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      const item = catalog.get(id);
      return !!item && [...item.front, ...item.back].some(layer => layer.type === 'component' && !!layer.componentId && reaches(layer.componentId, seen));
    };
    return components.filter(item => item.id !== component.id && !isAsset(item) && !reaches(item.id, new Set()));
  }, [components, component.id, catalog]);
  const editedSource = editedImage ? resolveImage(editedImage, component.rows[row] ?? {}, catalog) : undefined;
  const editedNatural = useNaturalSize(editedSource);
  const editedBox = editedImage && transformBox(editedImage, shownNodes);
  const editedFit = editedImage?.imageFit ?? 'cover';
  const editedBase = editedImage && (editedFit === 'original' && !editedNatural ? undefined : fittedImageSize(editedFit, editedNatural, editedImage.width, editedImage.height));
  const startImageEdit = (id: string) => {
    const layer = nodes.find(item => item.id === id);
    if (layer?.type !== 'image') return;
    if (!transformBox(layer, nodes)) { notify('Give the image layer a fixed size in an absolute parent to edit its picture on the canvas, or use the placement fields.', true); return; }
    setSelected([id]); setImageEdit(id);
  };
  const beginImageDrag = (event: PointerEvent<HTMLElement>, kind: ImageDrag['kind'], hx = 0, hy = 0) => {
    if (event.button !== 0 || spacePressed.current || !editedImage || !editedBox || !editedBase) return;
    event.preventDefault(); event.stopPropagation();
    const picture = (event.currentTarget.closest('.image-edit-picture') ?? event.currentTarget).getBoundingClientRect();
    const centerX = picture.left + picture.width / 2, centerY = picture.top + picture.height / 2;
    imageDragging.current = { kind, hx, hy, pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY, start: imagePlacement(editedImage),
      base: editedBase, box: { width: editedImage.width, height: editedImage.height }, angle: editedBox.angle,
      centerX, centerY, pointerAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX) };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveImageDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = imageDragging.current;
    if (!drag || drag.pointer !== event.pointerId || !editedImage) return;
    event.stopPropagation();
    const dx = cssPx(event.clientX - drag.clientX) / zoom, dy = cssPx(event.clientY - drag.clientY) / zoom;
    const next = { ...drag.start };
    if (drag.kind === 'move') {
      next.x += dx * Math.cos(drag.angle) + dy * Math.sin(drag.angle);
      next.y += -dx * Math.sin(drag.angle) + dy * Math.cos(drag.angle);
    } else if (drag.kind === 'rotate') {
      const raw = drag.start.rotation + (Math.atan2(event.clientY - drag.centerY, event.clientX - drag.centerX) - drag.pointerAngle) * 180 / Math.PI;
      next.rotation = event.shiftKey ? Math.round(raw / 15) * 15 : raw;
    } else {
      // Corners keep the picture's proportions unless Shift is held; edges stretch one side.
      const box = resizeCenteredBox({ cx: drag.box.width / 2 + drag.start.x, cy: drag.box.height / 2 + drag.start.y,
        width: drag.base.width * drag.start.scaleX, height: drag.base.height * drag.start.scaleY, rotation: drag.start.rotation },
      drag.hx, drag.hy, dx, dy, drag.angle, !event.shiftKey);
      Object.assign(next, { x: box.cx - drag.box.width / 2, y: box.cy - drag.box.height / 2, scaleX: box.width / drag.base.width, scaleY: box.height / drag.base.height });
    }
    setImagePreview({ id: editedImage.id, patch: placementPatch(next) });
  };
  const endImageDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = imageDragging.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    event.stopPropagation();
    imageDragging.current = null;
    const preview = imagePreview;
    setImagePreview(undefined);
    if (preview) void update({ [face]: nodes.map(item => item.id === preview.id ? { ...item, ...preview.patch } : item) });
  };
  const cancelImageDrag = () => { imageDragging.current = null; setImagePreview(undefined); };
  return <div ref={designer} className="designer-layout"
    onInputCapture={event => { if (isFormControl(event.target)) beginEdit(event.target); }}
    onPointerDownCapture={event => { if (event.target instanceof HTMLInputElement && ['number', 'range'].includes(event.target.type)) beginEdit(event.target); }}
    onPointerUp={event => endEdit(event.target)} onPointerCancel={event => endEdit(event.target)} onBlur={event => endEdit(event.target)}>
    <aside id="designer-layers-panel" className="layers-panel" style={{ width: panels.sizes.layers, minWidth: 0, flex: `0 0 ${panels.sizes.layers}px` }} hidden={!layersVisible}>
      <div className="panel-heading"><span><Layers size={15} /> Layers</span><span className="subtle">{nodes.length}</span></div>
      <HorizontalScroll contentClassName="face-tabs" label="Component faces"><button className={face === 'front' ? 'active' : ''} onClick={() => { setFace('front'); setSelected([]); }}>Front</button>
        <button disabled={!component.flippable} className={face === 'back' ? 'active' : ''} onClick={() => { setFace('back'); setSelected([]); }}>Back</button></HorizontalScroll>
      <div className="layer-list">
        {layers(null)}{!nodes.length && <p className="empty-note">A blank canvas.<br />Add your first layer above.</p>}
      </div>
      <div className="layer-footer"><button onClick={() => { setCsv(component.csv); setDataOpen(true); }}><Database size={16} /><span>Data bindings<small>{component.rows.length} rows connected</small></span><ChevronRight size={14} /></button></div>
    </aside>
    {layersVisible && <PanelSeparator label="Resize designer layers" controls="designer-layers-panel" value={panels.sizes.layers} {...panels.limits.layers} onResize={value => panels.resize('layers', value)} />}
    <section className="designer-canvas">
      <div className={`designer-toolbar-scroll${toolbarEdges.left ? ' overflow-left' : ''}${toolbarEdges.right ? ' overflow-right' : ''}`}>
      <ScrollArrows target={toolbar} {...toolbarEdges} label="designer toolbar" />
      <div className="canvas-toolbar" ref={toolbar}>
        <div className="tool-group">
          <button title="Select and move (V)" aria-label="Select tool" aria-pressed={tool === 'select'} onClick={() => { if (tool === 'pen') finishPen(false); }}><MousePointer2 size={17} /></button>
          <button title="Pen tool (P): click to add points, drag to curve, click the first point to close; Enter or Esc finishes" aria-label="Pen tool" aria-pressed={tool === 'pen'}
            onClick={() => tool === 'pen' ? finishPen(false) : startPen()}><PenTool size={17} /></button>
        </div><span className="toolbar-divider" />
        <div className="tool-group">
          <button title="Add text" aria-label="Add text" onClick={() => addNode('text')}><Type size={19} /></button>
          <div className="designer-tool-menu"><button aria-label="Add shape" title="Add shape" aria-expanded={toolMenu === 'shape'} onClick={event => toggleToolMenu('shape', event.currentTarget)}><Square size={18} /><ChevronDown className="tool-indicator" size={9} /></button>
            {toolMenu === 'shape' && createPortal(<div className="designer-popover designer-toolbar-popover" style={toolMenuPosition} role="menu">{(['rectangle', 'ellipse', 'polygon', 'star'] as const).map(kind => <button role="menuitem" key={kind} onClick={() => { addNode('shape', kind); setToolMenu(null); }}>{kind[0].toUpperCase() + kind.slice(1)}</button>)}</div>, document.body)}</div>
          <button title="Add image" aria-label="Add image" onClick={() => addNode('image')}><ImagePlus size={19} /></button>
          <button title={selected.length ? 'Group selected layers' : 'Create empty group'} aria-label="Create group" onClick={createGroup}><FolderPlus size={17} /></button>
          <button title="Add linked artwork: shows another component; choose which in the Design panel" aria-label="Add linked artwork" onClick={addLinkedArtwork}><Link2 size={17} /></button>
        </div><span className="toolbar-divider" />
        <button title="Delete selected layers" aria-label="Delete selected layers" disabled={!selected.length} onClick={removeNode}><Trash2 size={16} /></button>
        <button title="Undo design edit" aria-label="Undo design edit" disabled={!history.length} onClick={undo}><Undo2 size={17} /></button>
        <button title="Redo design edit" aria-label="Redo design edit" disabled={!future.length} onClick={redo}><Redo2 size={17} /></button>
        <div className="toolbar-preview-row">
          <SearchSelect label="Preview row" hideLabel value={component.rows.length ? String(row) : ''} disabled={!component.rows.length}
            options={component.rows.length ? rowOptions : [{ value: '', label: 'Default' }]} onChange={value => setRow(Number(value))} />
        </div>
      </div></div>
      <div ref={stage} className={`designer-stage${tool === 'pen' ? ' pen-active' : ''}`} tabIndex={-1}
        onPointerDownCapture={event => {
          if (event.button === 0 || event.button === 1) event.currentTarget.focus({ preventScroll: true });
          if (tool === 'pen' && event.button === 0 && !spacePressed.current) { event.preventDefault(); event.stopPropagation(); penDown(event); return; }
          if (event.button !== 1 && !(event.button === 0 && spacePressed.current)) return;
          event.preventDefault(); event.stopPropagation();
          if (event.button === 0) spacePanned.current = true;
          panning.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMoveCapture={event => {
          if (tool === 'pen' && !panning.current) penMove(event);
          const drag = panning.current;
          if (!drag || drag.pointer !== event.pointerId) return;
          event.stopPropagation(); setPan({ x: drag.panX + cssPx(event.clientX - drag.x), y: drag.panY + cssPx(event.clientY - drag.y) });
        }}
        onPointerUpCapture={event => {
          if (tool === 'pen') penUp(event);
          if (panning.current?.pointer !== event.pointerId) return;
          event.stopPropagation(); panning.current = null;
        }}
        onPointerCancelCapture={() => { panning.current = null; }}
        onPointerDown={event => { if (event.button === 0) { setSelected([]); setImageEdit(undefined); } }}>
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
            const dx = cssPx(event.clientX - drag.clientX) / zoom, dy = cssPx(event.clientY - drag.clientY) / zoom;
            const next: Record<string, DragPosition> = {};
            drag.ids.forEach(id => {
              const angle = drag.angles[id], origin = drag.positions[id];
              const layer = nodes.find(item => item.id === id)!;
              next[id] = { x: usesPosition(layer, nodes, 'x') ? snapTo(origin.x + dx * Math.cos(angle) + dy * Math.sin(angle), precision) : origin.x,
                y: usesPosition(layer, nodes, 'y') ? snapTo(origin.y - dx * Math.sin(angle) + dy * Math.cos(angle), precision) : origin.y };
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
            <ComponentView component={{ ...component, [face]: shownNodes }} components={components}
              row={row} back={face === 'back'} selectedNodes={selected} onNode={(id, event) => { if (imageEdit && id !== imageEdit) setImageEdit(undefined); beginCanvasDrag(id, event); }}
              onNodeDoubleClick={startImageEdit} zoom={zoom} />
          </div>
          {editedImage && editedBox && editedBase && (() => {
            const placed = imagePlacement(editedImage);
            return <div className="image-edit-frame" style={{ left: editedBox.x * zoom, top: editedBox.y * zoom, width: editedImage.width * zoom, height: editedImage.height * zoom,
              transform: `translate(-50%, -50%) rotate(${editedBox.angle}rad)` }}>
              <div className={`transform-box image-edit-picture${editedFit === 'tile' ? ' tiled' : ''}`} title="Drag to move the picture"
                style={{ left: '50%', top: '50%', width: editedBase.width * placed.scaleX * zoom, height: editedBase.height * placed.scaleY * zoom,
                  transform: `translate(-50%, -50%) translate(${placed.x * zoom}px, ${placed.y * zoom}px) rotate(${placed.rotation}deg)` }}
                onPointerDown={event => beginImageDrag(event, 'move')} onPointerMove={moveImageDrag} onPointerUp={endImageDrag} onPointerCancel={cancelImageDrag}>
                {editedSource && editedFit !== 'tile' && <img className="image-edit-ghost" src={editedSource} alt="" draggable={false} />}
                <span className="transform-rotate-stem" />
                <button type="button" tabIndex={-1} className="transform-handle transform-rotate" aria-label="Rotate picture" title="Drag to rotate the picture; hold Shift to snap to 15°"
                  onPointerDown={event => beginImageDrag(event, 'rotate')} onPointerMove={moveImageDrag} onPointerUp={endImageDrag} onPointerCancel={cancelImageDrag} />
                {RESIZE_HANDLES.map(([hx, hy, label]) => <button type="button" tabIndex={-1} key={label} className={`transform-handle${hx && hy ? ' corner' : ''}`}
                  aria-label={`Resize picture from ${label}`} title={hx && hy ? 'Drag to scale the picture; hold Shift to stretch' : 'Drag to stretch the picture'}
                  style={{ left: `${(hx + 1) * 50}%`, top: `${(hy + 1) * 50}%`,
                    cursor: RESIZE_CURSORS[Math.round(((Math.atan2(hy, hx) + editedBox.angle + placed.rotation * Math.PI / 180) * 180 / Math.PI % 180 + 180) % 180 / 45) % 4] }}
                  onPointerDown={event => beginImageDrag(event, 'resize', hx, hy)} onPointerMove={moveImageDrag} onPointerUp={endImageDrag} onPointerCancel={cancelImageDrag} />)}
              </div>
              <span className="image-edit-hint">Editing picture · Enter or Esc to finish</span>
            </div>;
          })()}
          {box && transformTarget && !editedImage && <div className="transform-box" style={{ left: box.x * zoom, top: box.y * zoom,
            width: transformTarget.width * zoom, height: transformTarget.height * zoom, transform: `translate(-50%, -50%) rotate(${box.angle}rad)` }}>
            <span className="transform-rotate-stem" />
            <button type="button" tabIndex={-1} className="transform-handle transform-rotate" aria-label="Rotate layer" title="Drag to rotate; hold Shift to snap to 15°"
              onPointerDown={event => beginHandle(event, 'rotate')} onPointerMove={moveHandle} onPointerUp={endHandle} onPointerCancel={cancelHandle} />
            {RESIZE_HANDLES.map(([hx, hy, label]) => <button type="button" tabIndex={-1} key={label} className={`transform-handle${hx && hy ? ' corner' : ''}`}
              aria-label={`Resize from ${label}`} title={hx && hy ? 'Drag to resize; hold Shift to keep proportions' : 'Drag to resize'}
              style={{ left: `${(hx + 1) * 50}%`, top: `${(hy + 1) * 50}%`,
                cursor: RESIZE_CURSORS[Math.round(((Math.atan2(hy, hx) + box.angle) * 180 / Math.PI % 180 + 180) % 180 / 45) % 4] }}
              onPointerDown={event => beginHandle(event, 'resize', hx, hy)} onPointerMove={moveHandle} onPointerUp={endHandle} onPointerCancel={cancelHandle} />)}
          </div>}
          {pen ? <PathOverlay artboard={artboard} node={shownNodes.find(item => item.id === pen.node.id) ?? pen.node} selectedPoint={-1} rubberBand={pen.drag ? undefined : pen.hover}
            closing={pen.node.points.length >= 3} />
            : transformTarget?.type === 'shape' && transformTarget.shapeKind === 'path' && <PathOverlay artboard={artboard} node={transformTarget} selectedPoint={selectedPoint}
              onPointDown={pointDown} onSegmentDown={(index, point) => segmentDown(transformTarget.id, index, point)} />}
        </div>
        <div className="canvas-caption"><span className="live-dot" /> Live component <span>Changes appear on every instance</span></div>
        </div>
      </div>
      <div className="canvas-bottom"><span><Square size={12} /> {component.kind} component</span>
        <div><button title="Zoom out" aria-label="Zoom out" disabled={zoom <= ZOOM_MIN} onClick={() => setZoom(value => clampZoom(value / 1.25))}>-</button><ZoomPresets levels={ZOOM_LEVELS} zoom={zoom} onSelect={setZoom}><button title="Reset zoom" aria-label="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button></ZoomPresets><button title="Zoom in" aria-label="Zoom in" disabled={zoom >= ZOOM_MAX} onClick={() => setZoom(value => clampZoom(value * 1.25))}>+</button></div></div>
    </section>
    <PanelSeparator label="Resize designer inspector" controls="designer-inspector-panel" value={panels.sizes.designerInspector} {...panels.limits.designerInspector} direction={-1} onResize={value => panels.resize('designerInspector', value)} />
    <aside id="designer-inspector-panel" className="inspector" style={{ width: panels.sizes.designerInspector, minWidth: 0, flex: `0 0 ${panels.sizes.designerInspector}px` }}>
      <HorizontalScroll contentClassName="inspector-tabs" label="Designer inspector tabs"><button className={tab === 'design' ? 'active' : ''} onClick={() => setTab('design')}>Design</button><button className={tab === 'behavior' ? 'active' : ''} onClick={() => setTab('behavior')}>Behavior</button></HorizontalScroll>
      <div className="inspector-scroll">
        {tab === 'behavior' ? <>
          <div className="inspector-section"><h3>Component behavior</h3>
            <Field label="Component type"><select value={component.kind} onChange={event => update({ kind: event.target.value as Component['kind'] })}>
              <option value="card">Card</option><option value="token">Token</option><option value="board">Board</option><option value="dice">Dice</option><option value="book">Book</option><option value="artwork">Artwork</option>
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
          {hasPages(component) && <div className="inspector-section"><h3>{component.kind === 'book' ? 'Book pages' : 'Dice variants'}</h3>
            <p className="help-text">{component.kind === 'book'
              ? <>Each CSV row is one page, in order. On the table, Shift+Q and Shift+E turn the pages; pages can't be taken out of the book. Edit fields here, or use Data bindings to add columns.</>
              : <>Each CSV row is one equally likely roll result; Shift+Q and Shift+E step through them on the table. Edit its fields here, or use Data bindings to add columns. Bind text with {'{{value}}'} or another column name.</>}</p>
            {!!component.rows.length && <>
              <SearchSelect label={component.kind === 'book' ? 'Page' : 'Dice variant'} value={String(row)} options={rowOptions} onChange={value => setRow(Number(value))} />
              {variantFields.map(field => <Field key={`${row}-${field}`} label={`${component.kind === 'book' ? 'Page' : 'Variant'} ${field}`}><input maxLength={10000} value={component.rows[row]?.[field] ?? ''} onChange={event => {
                void updateVariants(component.rows.map((variant, index) => index === row ? { ...variant, [field]: event.target.value } : variant));
              }} /></Field>)}
            </>}
            <div className="button-row"><button className="button" disabled={component.rows.length >= 10000} onClick={async () => {
              const next = Object.fromEntries(variantFields.map(field => [field, field === 'value' ? String(component.rows.length + 1) : '']));
              if (await updateVariants([...component.rows, next])) setRow(component.rows.length);
            }}>{component.kind === 'book' ? 'Add page' : 'Add variant'}</button>
              <button className="button danger" disabled={component.rows.length < 2} onClick={async () => {
                if (await updateVariants(component.rows.filter((_, index) => index !== row), row)) setRow(Math.min(row, component.rows.length - 2));
              }}>{component.kind === 'book' ? 'Remove page' : 'Remove variant'}</button></div>
            <p className="help-text">Keep at least one {component.kind === 'book' ? 'page' : 'variant'}. Removing a row shifts later dice and fixed nested-row references down; references to the removed result use the next result, or the last remaining result. Parent-field row bindings keep their CSV values.</p>
          </div>}
          <div className="inspector-section"><h3>Portable by design</h3><p className="help-text">Export the full component, including both faces, behavior and CSV data.</p>
            <button className="button full" onClick={() => {
              try { downloadZip(`${component.name}.component.zip`, componentZip(component, components)); }
              catch (error) { notify(`Export failed: ${String(error)}`, true); }
            }}><Download size={15} /> Export component</button>
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
            {vectorSelection && <div className="boolean-actions" role="toolbar" aria-label="Boolean operations">
              {BOOLEAN_OPERATIONS.map(({ operation, label }) => <button key={operation} className="icon-button" title={`${label} (select two or more shapes)`} aria-label={label}
                disabled={selectedNodes.length < 2} onClick={() => makeCompound(operation)}><BooleanIcon operation={operation} /></button>)}
              <button className="icon-button" title="Uncombine live compound" aria-label="Uncombine live compound"
                disabled={selectedNodes.some(item => item.type !== 'compound')} onClick={uncombine}><Layers size={18} /></button>
              <button className="icon-button" title="Convert to path (Ctrl/Cmd+E): turn shapes and boolean groups into editable pen paths" aria-label="Convert to path"
                disabled={!canConvert} onClick={convertSelection}><Spline size={18} /></button>
            </div>}
          </div>
          <div className="inspector-section design-section transform-section">
            <SectionTitle title="Position and size" />
            <div className="field-grid transform-grid"><NumberField label="X" icon={<span className="axis-glyph">X</span>} value={node.x} onChange={x => updateNode({ x })}
                disabled={!positionsX} title={positionsX ? undefined : 'Ignored: this layer is placed by its sizing mode or parent layout'} />
              <NumberField label="Y" icon={<span className="axis-glyph">Y</span>} value={node.y} onChange={y => updateNode({ y })}
                disabled={!positionsY} title={positionsY ? undefined : 'Ignored: this layer is placed by its sizing mode or parent layout'} />
              <NumberField label="Width" icon={<MoveHorizontal size={14} />} value={node.width} min={1} max={4000} onChange={width => updateNode({ width })} />
              <NumberField label="Height" icon={<MoveVertical size={14} />} value={node.height} min={1} max={4000} onChange={height => updateNode({ height })} />
              <NumberField label="Rotation" icon={<RotateCw size={14} />} value={node.rotation} onChange={rotation => updateNode({ rotation })} />
              {selected.length === 1 && node.type === 'frame' && <NumberField label="Radius" value={node.radius} min={0} max={2000} onChange={radius => updateNode({ radius })} />}</div>
            <div className="field-grid sizing-grid">
              <Field label="Width sizing" hint="Fixed uses the width above. Hug fits the contents; Fill stretches to the parent, inset by the margins."><select value={selectedNodes.every(item => (item.widthMode ?? 'fixed') === (node.widthMode ?? 'fixed')) ? node.widthMode ?? 'fixed' : 'mixed'}
                onChange={event => { if (event.target.value !== 'mixed') updateNode({ widthMode: event.target.value as DesignNode['widthMode'] }); }}>
                {selectedNodes.some(item => (item.widthMode ?? 'fixed') !== (node.widthMode ?? 'fixed')) && <option value="mixed" disabled>Mixed</option>}
                <option value="fixed">Fixed</option><option value="hug">Hug contents</option><option value="fill">Fill parent</option></select></Field>
              <Field label="Height sizing"><select value={selectedNodes.every(item => (item.heightMode ?? 'fixed') === (node.heightMode ?? 'fixed')) ? node.heightMode ?? 'fixed' : 'mixed'}
                onChange={event => { if (event.target.value !== 'mixed') updateNode({ heightMode: event.target.value as DesignNode['heightMode'] }); }}>
                {selectedNodes.some(item => (item.heightMode ?? 'fixed') !== (node.heightMode ?? 'fixed')) && <option value="mixed" disabled>Mixed</option>}
                <option value="fixed">Fixed</option><option value="hug">Hug contents</option><option value="fill">Fill parent</option></select></Field>
            </div>
            {(!positionsX || !positionsY) && <div className="padding-editor margin-editor"><span>Margins per edge</span><div className="field-grid">
              <NumberField label="Margin top" value={node.marginTop ?? 0} min={0} max={2000} onChange={marginTop => updateNode({ marginTop })} />
              <NumberField label="Margin right" value={node.marginRight ?? 0} min={0} max={2000} onChange={marginRight => updateNode({ marginRight })} />
              <NumberField label="Margin bottom" value={node.marginBottom ?? 0} min={0} max={2000} onChange={marginBottom => updateNode({ marginBottom })} />
              <NumberField label="Margin left" value={node.marginLeft ?? 0} min={0} max={2000} onChange={marginLeft => updateNode({ marginLeft })} />
            </div></div>}
          </div>
          {selected.length === 1 && node.type === 'frame' && <div className="inspector-section design-section">
            <SectionTitle title="Layout" hint="Absolute places children by X/Y. Horizontal and vertical stacks arrange them in order with a gap, like auto layout." />
            <Field label="Child layout"><select value={node.layout} onChange={event => updateNode({ layout: event.target.value as DesignNode['layout'] })}><option value="absolute">Absolute</option><option value="row">Horizontal stack</option><option value="column">Vertical stack</option></select></Field>
            <div className="field-grid"><NumberField label="Gap" value={node.gap} min={0} max={200} onChange={gap => updateNode({ gap })} />
              <Field label="Align children"><select value={node.align === 'justify' ? 'start' : node.align} onChange={event => updateNode({ align: event.target.value as DesignNode['align'] })}><option value="start">Start</option><option value="center">Center</option><option value="end">End</option></select></Field></div>
            {node.layout !== 'absolute' && <Toggle label="Wrap children" checked={node.wrap ?? false} onChange={wrap => updateNode({ wrap })} />}
            <div className="padding-editor"><span>Padding per edge</span><div className="field-grid">
              <NumberField label="Top" value={node.paddingTop ?? node.padding} min={0} max={200} onChange={paddingTop => updateNode({ paddingTop })} />
              <NumberField label="Right" value={node.paddingRight ?? node.padding} min={0} max={200} onChange={paddingRight => updateNode({ paddingRight })} />
              <NumberField label="Bottom" value={node.paddingBottom ?? node.padding} min={0} max={200} onChange={paddingBottom => updateNode({ paddingBottom })} />
              <NumberField label="Left" value={node.paddingLeft ?? node.padding} min={0} max={200} onChange={paddingLeft => updateNode({ paddingLeft })} />
            </div></div>
          </div>}
          {selected.length === 1 && node.type === 'text' && <>
            <div className="inspector-section design-section">
              <SectionTitle title="Text" hint="Mix static text with {{column_name}} bindings to the component's CSV data." />
              <Field label="Text / binding"><textarea value={node.text} onChange={event => updateNode({ text: event.target.value })} rows={3} /></Field>
            </div>
            <div className="inspector-section design-section typography-section">
              <SectionTitle title="Typography" hint="Pick a Google font, type an imported font's name, or bind a column such as {{font}}; values that match an imported font's name use it." />
              <SearchSelect label="Imported font" value={node.fontId ?? ''} onChange={value => updateNode({ fontId: value || undefined })}
                options={[{ value: '', label: 'Use Google font or binding' }, ...components.filter(item => item.kind === 'font').map(item => ({ value: item.id, label: item.name }))]} />
              <FontPicker key={node.id} label="Google font / binding" value={node.font} disabled={!!node.fontId} onChange={font => updateNode({ font })} />
              <div className="field-grid">
                <NumberField label="Font size" value={node.fontSize} min={4} max={400} onChange={fontSize => updateNode({ fontSize })} />
                <Field label="Weight"><select value={node.fontWeight ?? 400} onChange={event => updateNode({ fontWeight: Number(event.target.value) })}>
                  {FONT_WEIGHTS.map(([weight, name]) => <option key={weight} value={weight}>{name}</option>)}
                </select></Field>
                <NumberField label="Line height" hint="A multiple of the font size; empty uses the font's normal spacing." value={node.lineHeight ?? 1.2} mixed={node.lineHeight === undefined} placeholder="Auto"
                  min={.5} max={5} step={.05} onChange={lineHeight => updateNode({ lineHeight })} />
                <NumberField label="Letter spacing" value={node.letterSpacing ?? 0} min={-50} max={200} step={.1} onChange={letterSpacing => updateNode({ letterSpacing })} />
              </div>
              <div className="field-grid">
                <div className="field"><span>Style</span><div className="icon-choice" role="group" aria-label="Text style">
                  <button type="button" aria-label="Italic" title="Italic" aria-pressed={!!node.italic} className={node.italic ? 'active' : ''} onClick={() => updateNode({ italic: !node.italic })}><Italic size={15} /></button>
                  <button type="button" aria-label="Underline" title="Underline" aria-pressed={node.textDecoration === 'underline'} className={node.textDecoration === 'underline' ? 'active' : ''}
                    onClick={() => updateNode({ textDecoration: node.textDecoration === 'underline' ? 'none' : 'underline' })}><Underline size={15} /></button>
                  <button type="button" aria-label="Strikethrough" title="Strikethrough" aria-pressed={node.textDecoration === 'line-through'} className={node.textDecoration === 'line-through' ? 'active' : ''}
                    onClick={() => updateNode({ textDecoration: node.textDecoration === 'line-through' ? 'none' : 'line-through' })}><Strikethrough size={15} /></button>
                </div></div>
                <IconChoice label="Case" value={node.textTransform ?? 'none'} options={TEXT_CASES} onChange={textTransform => updateNode({ textTransform })} />
              </div>
              <div className="field-grid">
                <IconChoice label="Alignment" value={node.align} options={TEXT_ALIGNS} onChange={align => updateNode({ align })} />
                <IconChoice label="Vertical alignment" value={node.verticalAlign ?? 'center'} options={VERTICAL_ALIGNS} onChange={verticalAlign => updateNode({ verticalAlign })} />
              </div>
              <ColorField label="Text color" value={node.color} onChange={color => updateNode({ color })} />
            </div>
          </>}
          {selected.length === 1 && node.type === 'image' && <div className="inspector-section design-section">
            <SectionTitle title="Image" hint="Use an HTTPS URL, an imported texture's name, or a CSV binding such as {{art}}. Bound values that match a texture's name use that texture, and {{texture-name}} picks it directly." />
            <SearchSelect label="Imported texture" value={node.textureId ?? ''} onChange={value => updateNode({ textureId: value || undefined })}
              options={[{ value: '', label: 'Use image URL / binding' }, ...components.filter(item => item.kind === 'texture').map(item => ({ value: item.id, label: item.name }))]} />
            <Field label="Image URL / binding"><textarea rows={2} disabled={!!node.textureId} value={node.text} onChange={event => updateNode({ text: event.target.value })} placeholder="https://..., a texture name or {{image}}" /></Field>
            <Field label="Picture fit"><select value={node.imageFit ?? 'cover'} onChange={event => updateNode({ imageFit: event.target.value as DesignNode['imageFit'] })}>
              {IMAGE_FITS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></Field>
            <SectionTitle title="Picture placement" hint="Double-click the image on the canvas to move, rotate and resize the picture inside its frame; the layer crops it. Corners keep proportions (Shift stretches).">
              <button className="icon-button" title={imageEdit === node.id ? 'Finish editing the picture' : 'Edit the picture on the canvas'} aria-label={imageEdit === node.id ? 'Finish editing' : 'Edit picture'} aria-pressed={imageEdit === node.id}
                onClick={() => imageEdit === node.id ? setImageEdit(undefined) : startImageEdit(node.id)}><Crop size={14} /></button>
              <button className="icon-button" title="Reset the picture placement" aria-label="Reset" disabled={!node.imageOffsetX && !node.imageOffsetY && (node.imageScaleX ?? 1) === 1 && (node.imageScaleY ?? 1) === 1 && !node.imageRotation}
                onClick={() => updateNode({ imageOffsetX: undefined, imageOffsetY: undefined, imageScaleX: undefined, imageScaleY: undefined, imageRotation: undefined })}><RotateCcw size={14} /></button>
            </SectionTitle>
            <div className="field-grid image-placement-grid">
              <NumberField label="Picture X" value={roundTo(node.imageOffsetX ?? 0, 2)} min={-8000} max={8000} onChange={imageOffsetX => updateNode({ imageOffsetX })} />
              <NumberField label="Picture Y" value={roundTo(node.imageOffsetY ?? 0, 2)} min={-8000} max={8000} onChange={imageOffsetY => updateNode({ imageOffsetY })} />
              <NumberField label="Scale X %" value={roundTo((node.imageScaleX ?? 1) * 100, 2)} min={1} max={10000} step={5} onChange={value => updateNode({ imageScaleX: value / 100 })} />
              <NumberField label="Scale Y %" value={roundTo((node.imageScaleY ?? 1) * 100, 2)} min={1} max={10000} step={5} onChange={value => updateNode({ imageScaleY: value / 100 })} />
              <NumberField label="Picture rotation" value={roundTo(node.imageRotation ?? 0, 1)} min={-360} max={360} onChange={imageRotation => updateNode({ imageRotation })} />
            </div>
          </div>}
          {selected.length === 1 && node.type === 'shape' && (node.shapeKind === 'path' ? <div className="inspector-section design-section">
            <SectionTitle title="Pen path" hint="Drag anchors and Bézier handles on the canvas. Click a segment to add a point, double-click an anchor to toggle its handles and Alt-click it to delete it.">
              <span className="subtle">{node.points.length} points</span>
            </SectionTitle>
            <Toggle label="Closed path" checked={node.pathClosed} onChange={pathClosed => updateNode({ pathClosed })} />
            <SearchSelect label="Selected point" value={String(selectedPoint)} onChange={value => setSelectedPoint(Number(value))}
              options={[{ value: '-1', label: 'None' }, ...node.points.map((_, index) => ({ value: String(index), label: `Point ${index + 1}` }))]} />
            {node.points[selectedPoint] && <>
              <div className="field-grid"><NumberField label="X" value={node.points[selectedPoint].x} min={-4000} max={4000} step={.5} onChange={x => updateNode({ points: node.points.map((point, index) => index === selectedPoint ? { ...point, x } : point) })} />
                <NumberField label="Y" value={node.points[selectedPoint].y} min={-4000} max={4000} step={.5} onChange={y => updateNode({ points: node.points.map((point, index) => index === selectedPoint ? { ...point, y } : point) })} />
                <NumberField label="In handle X" value={node.points[selectedPoint].inX} min={-4000} max={4000} step={.5} onChange={inX => updateNode({ points: node.points.map((point, index) => index === selectedPoint ? { ...point, inX } : point) })} />
                <NumberField label="In handle Y" value={node.points[selectedPoint].inY} min={-4000} max={4000} step={.5} onChange={inY => updateNode({ points: node.points.map((point, index) => index === selectedPoint ? { ...point, inY } : point) })} />
                <NumberField label="Out handle X" value={node.points[selectedPoint].outX} min={-4000} max={4000} step={.5} onChange={outX => updateNode({ points: node.points.map((point, index) => index === selectedPoint ? { ...point, outX } : point) })} />
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
          </div> : <div className="inspector-section design-section">
            <SectionTitle title="Shape" />
            <Field label="Vector shape"><select value={node.shapeKind} onChange={event => updateNode({ shapeKind: event.target.value as DesignNode['shapeKind'] })}>
              <option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option><option value="polygon">Polygon</option><option value="star">Star</option>
            </select></Field>
            {(node.shapeKind === 'polygon' || node.shapeKind === 'star') && <div className="field-grid">
              <NumberField label={node.shapeKind === 'star' ? 'Points' : 'Sides'} value={node.sides} min={3} max={100} onChange={sides => updateNode({ sides })} />
              {node.shapeKind === 'star' && <NumberField label="Inner radius ratio" value={node.innerRadius} min={.05} max={.95} step={.05} onChange={innerRadius => updateNode({ innerRadius })} />}
            </div>}
            {node.shapeKind === 'rectangle' && <NumberField label="Corner radius" value={node.radius} min={0} max={2000} onChange={radius => updateNode({ radius })} />}
          </div>)}
          {selected.length === 1 && node.type === 'compound' && <div className="inspector-section design-section">
            <SectionTitle title="Boolean group" hint="Source layers stay editable in the layer tree. Edit a source, change the operation, uncombine to separate them, or convert the group to a path." />
            <Field label="Live boolean operation"><select value={node.compoundOperation} onChange={event => updateNode({ compoundOperation: event.target.value as DesignNode['compoundOperation'] })}>
              <option value="union">Union</option><option value="subtract">Subtract</option><option value="intersect">Intersect</option><option value="exclude">Exclude (XOR)</option>
            </select></Field>
            <div className="button-row"><button className="button" onClick={uncombine}>Uncombine source shapes</button>
              <button className="button" onClick={convertSelection}><Spline size={14} /> Convert to path</button></div>
          </div>}
          {selected.length === 1 && node.type === 'component' && <div className="inspector-section design-section">
            <SectionTitle title="Linked artwork" hint="Shows another component, kept in sync with its design. Components that already show this one are left out to avoid loops." />
            <SearchSelect label="Linked component" value={node.componentId} placeholder="Choose a component…"
              options={linkable.map(item => ({ value: item.id, label: item.name, detail: item.kind }))}
              onChange={id => {
                const linked = components.find(item => item.id === id);
                if (linked) updateNode({ componentId: linked.id, name: linked.name, width: linked.width, height: linked.height, dataRow: 0 });
              }} />
            <Field label="Nested fitting" hint="Stretch fills both dimensions. Fit inside shows the whole artwork; Fill / crop covers the box and crops overflow. Both keep the artwork centered.">
              <select value={node.nestedFit ?? 'stretch'} onChange={event => updateNode({ nestedFit: event.target.value as DesignNode['nestedFit'] })}>
                <option value="stretch">Stretch</option><option value="contain">Fit inside</option><option value="cover">Fill / crop (envelope)</option>
              </select></Field>
            <Field label="Nested data"><select value={node.dataSource} onChange={event => updateNode({ dataSource: event.target.value as DesignNode['dataSource'] })}>
              <option value="inherit">Inherit parent row</option><option value="row">Use this component’s row</option><option value="field">Choose row from parent CSV field</option>
            </select></Field>
            {node.dataSource === 'row' && <NumberField label={`Own row (0–${Math.max(0, (components.find(item => item.id === node.componentId)?.rows.length ?? 1) - 1)})`}
              value={node.dataRow} min={0} max={Math.max(0, (components.find(item => item.id === node.componentId)?.rows.length ?? 1) - 1)}
              onChange={dataRow => updateNode({ dataRow })} />}
            {node.dataSource === 'field' && <>
              <Field label="Parent CSV field (zero-based row index)" hint={`The parent row must hold an integer from 0 to ${Math.max(0, (components.find(item => item.id === node.componentId)?.rows.length ?? 1) - 1)}. Invalid or missing values show an error instead of silently choosing another row.`}>
                <input value={node.dataField} list="nested-data-fields" placeholder="e.g. portraitRow" onChange={event => updateNode({ dataField: event.target.value })} /></Field>
              <datalist id="nested-data-fields">{Object.keys(component.rows[row] ?? {}).map(key => <option key={key}>{key}</option>)}</datalist>
            </>}
          </div>}
          <div className="inspector-section design-section appearance-section" key={`appearance-${node.id}`}>
            <SectionTitle title={node.type === 'text' && selected.length === 1 ? 'Background' : 'Fill'} />
            <ColorField label="Fill color" value={node.fill} onChange={fill => updateNode({ fill })} />
            <NumberField label="Opacity" value={node.opacity} min={0} max={1} step={.05} onChange={opacity => updateNode({ opacity })} />
          </div>
          {selected.length === 1 && (node.type === 'shape' || node.type === 'compound') && <div className="inspector-section design-section">
            <SectionTitle title="Stroke" />
            <div className="field-grid">
              <ColorField label="Stroke color" value={node.stroke} onChange={stroke => updateNode({ stroke })} />
              <NumberField label="Stroke weight" value={node.strokeWidth} min={0} max={200} step={.5} onChange={strokeWidth => updateNode({ strokeWidth })} />
            </div>
          </div>}
          {selected.length === 1 && node.type === 'text' && <div className="inspector-section design-section">
            <SectionTitle title="Effects" hint="The outline is drawn around each letter, outside its fill. A transparent color turns an effect off." />
            <div className="field-grid">
              <ColorField label="Outline color" value={node.textStroke ?? 'transparent'} onChange={textStroke => updateNode({ textStroke, textStrokeWidth: node.textStrokeWidth || (textStroke === 'transparent' ? 0 : 1) })} />
              <NumberField label="Outline width" value={node.textStrokeWidth ?? 0} min={0} max={50} step={.5} onChange={textStrokeWidth => updateNode({ textStrokeWidth })} />
              <ColorField label="Shadow color" value={node.textShadow ?? 'transparent'} onChange={textShadow => updateNode({ textShadow })} />
              <NumberField label="Shadow X" value={node.textShadowX ?? 0} min={-200} max={200} onChange={textShadowX => updateNode({ textShadowX })} />
              <NumberField label="Shadow Y" value={node.textShadowY ?? 0} min={-200} max={200} onChange={textShadowY => updateNode({ textShadowY })} />
              <NumberField label="Shadow blur" value={node.textShadowBlur ?? 0} min={0} max={200} onChange={textShadowBlur => updateNode({ textShadowBlur })} />
            </div>
          </div>}
          {selected.length === 1 && <div className="inspector-section design-section visibility-rules">
            <SectionTitle title="Conditional visibility" hint="Show this layer only on data rows where a CSV field equals a value. Leave the field empty to always show it." />
            <Field label="Show when CSV field"><input value={node.visibilityField} placeholder="Always visible" onChange={event => updateNode({ visibilityField: event.target.value })} /></Field>
            {!!node.visibilityField && <Field label="Equals value"><input value={node.visibilityValue} onChange={event => updateNode({ visibilityValue: event.target.value })} /></Field>}
          </div>}
        </> : <>
          <div className="inspector-section design-section">
            <SectionTitle title="Component" hint="Select one or more layers to move, edit, group or delete them. Add transparent groups and responsive frames with the toolbar." />
            <Field label="Name"><input value={component.name} onChange={event => { if (event.target.value) update({ name: event.target.value }); }} /></Field>
            <div className="field-grid"><NumberField label="Width" value={component.width} min={20} max={2000} onChange={width => update({ width })} /><NumberField label="Height" value={component.height} min={20} max={2000} onChange={height => update({ height })} /></div>
            <ColorField label="Component background" value={component.color} onChange={color => update({ color })} />
          </div>
          <div className="inspector-section design-section">
            <SectionTitle title="Data" hint="Use {{name}} in any text or image layer to connect it to a CSV column. Each row becomes a different instance of this component." />
            <button className="button full" onClick={() => { setCsv(component.csv); setDataOpen(true); }}><Database size={14} /> Connect your data <span className="subtle">{component.rows.length} rows</span></button>
          </div>
        </>}
      </div>
    </aside>
    {dataOpen && <Modal title="A little data. A whole deck." subtitle="Each CSV row becomes a different instance of this component." wide onClose={() => setDataOpen(false)}>
      <div className="data-dialog"><div className="data-toolbar"><span><FileSpreadsheet size={16} /> CSV data source</span><label className="button"><Upload size={14} /> Import CSV<input type="file" accept=".csv,text/csv" hidden onChange={async event => {
        try { const file = event.target.files?.[0]; if (file) setCsv(await file.text()); } catch (error) { notify(String(error), true); }
      }} /></label></div>
        {!!component.rows.length && <SearchSelect label="Preview row" value={String(row)} options={rowOptions} onChange={value => setRow(Number(value))} />}
        <textarea className="csv-editor" aria-label="CSV data" value={csv} onChange={event => setCsv(event.target.value)} spellCheck={false} />
        <p className="help-text">Include a header row. Quoted cells, commas and multiline text are supported. Updating data refreshes existing pieces by row index.</p>
        <div className="modal-actions"><button className="button" onClick={() => setDataOpen(false)}>Cancel</button><button className="button primary" onClick={saveCsv}><Database size={15} /> Apply data & refresh instances</button></div>
      </div></Modal>}
    {deleteOpen && <Modal title="Remove this component?" subtitle={`This deletes ${component.name} and every spawned instance, including pieces in hands. Export it first if you want to keep a copy.`} onClose={() => setDeleteOpen(false)}>
      <div className="data-dialog"><div className="modal-actions"><button className="button" onClick={() => setDeleteOpen(false)}>Keep component</button><button className="button danger" onClick={onDelete}><Trash2 size={15} /> Delete component & instances</button></div></div>
    </Modal>}
  </div>;
}
