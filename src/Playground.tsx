import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { ArrowDown, ArrowDownToLine, Ban, CirclePlay, Radar, Pin, PinOff, ArrowUp, ArrowUpFromLine, ArrowRightLeft, BookOpen, BringToFront, ChevronLeft, ChevronRight, Copy, Dices, Eye, EyeOff, FlipHorizontal2, Focus, FolderPlus, Grid2X2, GripVertical, Hand, Layers, LockKeyhole, Maximize, Minus, MousePointer2, Plus, RotateCcw, RotateCw, Search, SendToBack, Settings2, Shapes, Shuffle, Trash2, Undo2, Ungroup, UnlockKeyhole, Users, X } from 'lucide-react';
import { ComponentThumbnail, ComponentView, hasOpenFace } from './ComponentView';
import { componentTags, fitsPersistentStack, handPermissions, stackFilterOf, stackJoinError, hasPages, isAsset, nextSeatPlacement, stackMembers, uid, visibleBack, visibleStackMembers, withGroupLocks, type Command, type PersistentStack, type Component, type Instance, type Player, type Project } from './domain';
import { createGroupCommand, selectedGroups } from './pieceGroups';
import { LIBRARY_DRAG_TYPE, readLibraryDrag } from './libraryDrag';
import { ZoomPresets } from './ZoomPresets';
import { ColorField, Field, HorizontalScroll, InfoTip, Modal, NumberField, Toggle } from './ui';
import { PanelSeparator, type usePanelLayout } from './panelLayout';
import { PlaygroundPieces } from './PlaygroundPieces';
import { stackPlan, stackSlot } from './stackOrder';
import { PiecePreview } from './PiecePreview';
import { hoverPreviewWidth, previewOnLeft as placePreviewOnLeft } from './playgroundPreview';
import { componentGridTags, projectGrids, snapTarget, type Grid } from './grids';
import { gridColor, GridLayers, GridPointHandles } from './GridLayers';
import { GridEditor } from './GridEditor';
import { PointsPanel } from './GridPoints';
import { pointGroupAncestors } from './grids';
import { cssPx } from './uiScale';
import { scriptsMention } from './scripting';
import { PingPins, type PingPin } from './PingPins';
import { TagFilterEditor } from './TagEditors';
import { describeFilter, filterTags, normalizeTags } from './tags';

type Props = {
  project: Project; actor: string; owner: string; host?: boolean; selected: string[]; setSelected: (ids: string[]) => void;
  dispatch: (command: Command) => Promise<boolean>; onEdit: (id: string) => void;
  onSpawn: (component: Component, rows: number[], point: { x: number; y: number }, stacked?: boolean) => void;
  onSwitch: (player: Player) => void; notify: (message: string, error?: boolean) => void;
  /** Ends the turn, given the next player in turn order (a shared screen is passed to them first). */
  onEndTurn?: (next: Player | undefined) => void;
  /** Online without a seat: the table is read-only, but pieces can still be selected and inspected. */
  viewer?: boolean;
  /** Online seat actions: leave your seat to watch, or take a brand-new seat. */
  onWatch?: () => void; onNewSeat?: () => void;
  inspectorVisible: boolean; layersVisible?: boolean; handVisible: boolean;
  /** Your profile defaults, used for the first seat you add. */
  defaultSeat?: { name: string; color: string };
  onShowInspector: () => void;
  panel: 'selection' | 'table' | 'players'; setPanel: (panel: 'selection' | 'table' | 'players') => void;
  panels: ReturnType<typeof usePanelLayout>;
  /** Whether the app's component library is shown; with the other panels it decides the table view's size. */
  libraryVisible?: boolean;
  /** Dragging a stack takes its top piece (Shift moves the whole stack), or the other way round when false. */
  stackDragTakesTop?: boolean;
  /** Show pieces hidden from your seat (faded and labelled), and label every hidden piece. */
  showHidden?: boolean;
  /** A transient table message (such as why undo history was cleared), shown as a dismissible toast. */
  notice?: string; onDismissNotice?: () => void;
};
const ROLL_MS = 650;
const SHUFFLE_MS = 700;
const DRAW_MS = 480;
const MAX_ZOOM = 3;
/** The table's size in table pixels (see .table-world in styles.css); grids are drawn across it. */
const TABLE_WIDTH = 4000, TABLE_HEIGHT = 2600;
const VIEWER_NOTICE = 'You are watching as a viewer. Take a seat in Players to play.';
const CLEARED = 'Undo history cleared because ';
const noticeTitle = (message: string) => message.startsWith(CLEARED) ? 'Undo history cleared' : 'Undo';
const noticeDetail = (message: string) => message.startsWith(CLEARED) ? message.charAt(CLEARED.length).toUpperCase() + message.slice(CLEARED.length + 1) : message;
const SEAT_COMMANDS = new Set<Command['type']>(['player', 'removePlayer', 'reorderPlayers', 'handSettings']);

export function Playground({ project: source, actor, owner, host = false, viewer = false, onWatch, onNewSeat, selected, setSelected, inspectorVisible, layersVisible = true, defaultSeat, handVisible, onShowInspector, dispatch: dispatchCommand, onSpawn, onEdit, onSwitch, onEndTurn, notify, panel, setPanel, panels, libraryVisible, stackDragTakesTop = true, showHidden = false, notice, onDismissNotice }: Props) {
  // Play works from the project with group locks applied, so pieces in a locked group behave as locked everywhere;
  // a piece's own lock (the Lock button and L) still toggles its own flag.
  // Pieces hidden from your seat are left out of the table (visual privacy only), unless Visibility shows them.
  const p = useMemo(() => {
    const locked = withGroupLocks(source);
    if (showHidden || !actor || !locked.instances.some(item => item.hiddenFrom?.includes(actor))) return locked;
    return { ...locked, instances: locked.instances.filter(item => !item.hiddenFrom?.includes(actor)) };
  }, [source, showHidden, actor]);
  const ownLock = (id: string) => source.instances.find(item => item.id === id)?.locked ?? false;
  const viewport = useRef<HTMLDivElement>(null);
  const handScroller = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(.65);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [camera, setCamera] = useState(0);
  const world = useRef<HTMLDivElement>(null);
  // The table settles into a plain transform once zooming and panning stop, so it is redrawn sharp at the new zoom.
  useCompositedTransform(world, `translate(${pan.x}px, ${pan.y}px) rotate(${camera}deg) scale(${zoom})`, 150);
  const [tool, setTool] = useState<'select' | 'pan' | 'grid'>('select');
  // The grid tool: which grid (and snap point) the panel edits, and a grid being dragged on the table before it's saved.
  const [gridId, setGridId] = useState<string>();
  const [gridPoint, setGridPoint] = useState<string>();
  // The Points panel's selected point group: new snap points go into it.
  const [pointGroup, setPointGroup] = useState<string>();
  const [gridDraft, setGridDraft] = useState<Grid>();
  const gridGesture = useRef<{ pointer: number; x: number; y: number; startWorld: { x: number; y: number }; grid: Grid; point?: string; added?: boolean; moved: boolean } | null>(null);
  const [preview, setPreview] = useState<Record<string, { x: number; y: number }>>({});
  const [search, setSearch] = useState<string[]>();
  const [query, setQuery] = useState('');
  const [seatEditor, setSeatEditor] = useState<Player>();
  const [removingSeat, setRemovingSeat] = useState<Player>();
  const [playerDrag, setPlayerDrag] = useState<string>();
  const [playerDrop, setPlayerDrop] = useState<{ id: string; position: 'before' | 'after' }>();
  const grids = useMemo(() => projectGrids(p), [p]);
  const shownGrids = useMemo(() => gridDraft ? grids.map(grid => grid.id === gridDraft.id ? gridDraft : grid) : grids, [grids, gridDraft]);
  const editedGrid = tool === 'grid' ? shownGrids.find(grid => grid.id === gridId) ?? shownGrids[0] : undefined;
  const gridTags = useMemo(() => [...new Set(p.components.flatMap(componentGridTags))].sort((a, b) => a.localeCompare(b)), [p.components]);
  const snappingGrids = grids.filter(grid => grid.snap).length;
  const turnPlayer = p.players.length ? p.players[p.settings.turn % p.players.length] : undefined;
  const nextTurnPlayer = p.players.length ? p.players[(p.settings.turn + 1) % p.players.length] : undefined;
  const endTurn = () => { if (onEndTurn) onEndTurn(nextTurnPlayer); else void dispatch({ type: 'endTurn' }); };
  const movePlayer = (id: string, targetId: string, position: 'before' | 'after') => {
    if (id === targetId) return;
    const ids = p.players.map(player => player.id).filter(other => other !== id);
    ids.splice(ids.indexOf(targetId) + (position === 'after' ? 1 : 0), 0, id);
    void dispatch({ type: 'reorderPlayers', ids });
  };
  const [selectedSeatId, setSelectedSeatId] = useState<string>();
  const selectedSeat = p.players.find(player => player.id === selectedSeatId);
  useEffect(() => { if (selected.length) setSelectedSeatId(undefined); }, [selected]);
  const selectSeat = (player: Player) => { setSelected([]); setSelectedSeatId(player.id); setPanel('selection'); onShowInspector(); };
  const [hovered, setHovered] = useState<string>();
  // Persistent stacks (domain.ts): the empty ones show as slots on the table that can be selected, moved and dropped into.
  const persistentStacks = p.stacks ?? [];
  const persistentIds = new Set(persistentStacks.map(record => record.id));
  const emptySlots = persistentStacks.filter(record => !p.instances.some(i => i.stack === record.id));
  const [selectedSlot, setSelectedSlot] = useState<string>();
  const slotRecord = emptySlots.find(record => record.id === selectedSlot);
  const [slotPreview, setSlotPreview] = useState<{ id: string; x: number; y: number }>();
  const slotDrag = useRef<{ id: string; pointer: number; x: number; y: number; startWorld: { x: number; y: number }; origin: { x: number; y: number } } | null>(null);
  useEffect(() => { if (selected.length) setSelectedSlot(undefined); }, [selected]);
  const [previewItem, setPreviewItem] = useState<string>();
  const [previewScale, setPreviewScale] = useState(1);
  const [previewOnLeft, setPreviewOnLeft] = useState(false);
  // The pointer position at opening lets a large preview start aimed where the pointer already is.
  const [fullscreen, setFullscreen] = useState<{ id: string; pointer?: { x: number; y: number } }>();
  const lastPointer = useRef<{ x: number; y: number }>(undefined);
  const closeFullscreen = useCallback(() => setFullscreen(undefined), []);
  const fullscreenItem = p.instances.find(item => item.id === fullscreen?.id);
  const fullscreenComponent = p.components.find(component => component.id === fullscreenItem?.componentId);
  const [seatPosition, setSeatPosition] = useState<{ id: string; x: number; y: number; rotation: number }>();
  const seatGesture = useRef<{ id: string; pointer: number; x: number; y: number; startX: number; startY: number; startWorld: { x: number; y: number }; rotation: number }>(null);
  const [hoveredSeat, setHoveredSeat] = useState<string>();
  // Pings (from any player or script) show a pin with the pinging player for a few seconds; see PingPins.
  const [pins, setPins] = useState<PingPin[]>([]);
  const seenPings = useRef<Map<string, number>>(null);
  useEffect(() => {
    const first = !seenPings.current;
    const seen = seenPings.current ??= new Map();
    const fresh = new Map<string, string[]>();
    for (const item of p.instances) {
      const pings = item.pings ?? 0, previous = seen.get(item.id);
      seen.set(item.id, pings);
      if (!first && previous !== undefined && pings > previous) fresh.set(item.pingedBy ?? '', [...fresh.get(item.pingedBy ?? '') ?? [], item.id]);
    }
    if (!fresh.size) return;
    const added = [...fresh].map(([by, ids]) => {
      const seat = p.players.find(player => player.id === by);
      return { key: `${by}:${ids.join(',')}:${performance.now()}`, ids, name: seat?.name ?? 'Script', color: seat?.color ?? '#e0a43a' };
    });
    // A new ping from the same player replaces their previous pin.
    setPins(current => [...current.filter(pin => !added.some(entry => entry.name === pin.name)), ...added]);
    const keys = added.map(pin => pin.key);
    window.setTimeout(() => setPins(current => current.filter(pin => !keys.includes(pin.key))), 4000);
  }, [p.instances, p.players]);
  const [rolling, setRolling] = useState<Record<string, number>>({});
  const seenRolls = useRef<Map<string, number>>(null);
  const rollTimers = useRef(new Map<string, number>());
  useEffect(() => {
    const first = !seenRolls.current;
    const seen = seenRolls.current ??= new Map();
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const item of p.instances) {
      const rolls = item.rolls ?? 0, previous = seen.get(item.id);
      seen.set(item.id, rolls);
      const faces = p.components.find(c => c.id === item.componentId)?.rows.length ?? 0;
      // Animate every new roll (local or remote), even when it lands on the same face.
      if (first || previous === undefined || rolls <= previous || faces < 2 || still) continue;
      window.clearInterval(rollTimers.current.get(item.id));
      const started = performance.now();
      let face = item.row;
      const tick = () => {
        if (performance.now() - started >= ROLL_MS) {
          window.clearInterval(rollTimers.current.get(item.id)); rollTimers.current.delete(item.id);
          setRolling(({ [item.id]: _, ...rest }) => rest);
          return;
        }
        face = (face + 1 + Math.floor(Math.random() * (faces - 1))) % faces;
        setRolling(current => ({ ...current, [item.id]: face }));
      };
      tick();
      rollTimers.current.set(item.id, window.setInterval(tick, 70));
    }
  }, [p.instances, p.components]);
  useEffect(() => () => rollTimers.current.forEach(timer => window.clearInterval(timer)), []);
  // Stacks whose shuffle count went up (here or by another player) play the shuffle animation once.
  const [shuffling, setShuffling] = useState<ReadonlySet<string>>(() => new Set());
  const seenShuffles = useRef<Map<string, number>>(null);
  // One timer per stack ends its animation. It must outlive table updates: cancelling it when the next action changes
  // the table left the stack marked as shuffling, and a later draw (a new top piece) replayed the animation.
  const shuffleTimers = useRef(new Map<string, number>());
  useEffect(() => () => shuffleTimers.current.forEach(timer => window.clearTimeout(timer)), []);
  useEffect(() => {
    const first = !seenShuffles.current;
    const seen = seenShuffles.current ??= new Map();
    // Per piece: only a shuffle raises a piece's own count. Comparing whole stacks would also fire when a piece that was
    // shuffled elsewhere joins or leaves a stack.
    const started = new Set<string>();
    for (const item of p.instances) {
      const count = item.shuffles ?? 0, previous = seen.get(item.id);
      seen.set(item.id, count);
      if (!first && previous !== undefined && count > previous && item.stack) started.add(item.stack);
    }
    if (!started.size) return;
    setShuffling(current => new Set([...current, ...started]));
    for (const stack of started) {
      window.clearTimeout(shuffleTimers.current.get(stack));
      shuffleTimers.current.set(stack, window.setTimeout(() => {
        shuffleTimers.current.delete(stack);
        setShuffling(current => new Set([...current].filter(item => item !== stack)));
      }, SHUFFLE_MS));
    }
  }, [p.instances]);
  // Pieces going from the table into a hand (here or by another player) fly from where they were to that player's seat,
  // looking as they did on the table, so every player sees who drew what without seeing hidden fronts.
  const [flights, setFlights] = useState<DrawFlightData[]>([]);
  const seenPlaces = useRef<Map<string, Instance>>(null);
  // Pieces this player just dragged into a hand: they watched them travel already, so they don't fly again here.
  const droppedIntoHand = useRef(new Set<string>());
  const markDroppedIntoHand = (ids: string[]) => {
    ids.forEach(id => droppedIntoHand.current.add(id));
    // A drop the table rejects must not hide a later draw's flight.
    window.setTimeout(() => ids.forEach(id => droppedIntoHand.current.delete(id)), 2000);
  };
  useEffect(() => {
    const first = !seenPlaces.current;
    const seen = seenPlaces.current ??= new Map();
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const started: DrawFlightData[] = [];
    for (const item of p.instances) {
      const previous = seen.get(item.id);
      seen.set(item.id, item);
      if (first || still || !previous || previous.holder || !item.holder) continue;
      if (droppedIntoHand.current.delete(item.id)) continue;
      const seat = p.players.find(player => player.id === item.holder);
      if (seat) started.push({ key: `${item.id}:${item.order}:${performance.now()}`, from: previous, to: seat, delay: started.length * 70 });
    }
    if (started.length) setFlights(current => [...current, ...started]);
  }, [p.instances, p.players]);
  const seatMoved = useRef(false);
  const pointer = useRef<{ x: number; y: number }>(null);
  const clipboard = useRef<Instance[]>([]);
  // Grouping shortcuts (G / Shift+G) apply while the pointer is over the Pieces panel; elsewhere G stacks.
  const piecesHovered = useRef(false);
  useEffect(() => { if (!layersVisible) piecesHovered.current = false; }, [layersVisible]);
  const dispatch = useCallback((command: Command) => {
    if (viewer && !(host && SEAT_COMMANDS.has(command.type))) { notify(VIEWER_NOTICE, true); return Promise.resolve(false); }
    if (command.type === 'draw' || command.type === 'drawMany' || command.type === 'drawSelection' || command.type === 'transferToHand') {
      return dispatchCommand({ ...command, faceUp: p.players.find(player => player.id === command.playerId)?.handFaceUp ?? true });
    }
    return dispatchCommand(command);
  }, [dispatchCommand, p.players, viewer, host, notify]);
  const [handDrag, setHandDrag] = useState<{ id: string; x: number; y: number }>();
  // Hand cards fill the tray's height (keeping their aspect ratio), so resizing the tray resizes the cards.
  const [handCardHeight, setHandCardHeight] = useState(80);
  const handTrayShown = p.settings.hands && handVisible && !viewer && !!p.players.find(player => player.id === actor);
  useLayoutEffect(() => {
    const element = handScroller.current;
    if (!handTrayShown || !element) return;
    const measure = () => { if (element.clientHeight > 0) setHandCardHeight(Math.max(24, element.clientHeight - 22)); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [handTrayShown, panels.sizes.hand]); // Tray resizes re-measure directly; the observer covers other layout changes.
  const [insertion, setInsertion] = useState<number>();
  const [dropHint, setDropHint] = useState<{ id: string; x: number; y: number }>();
  // Over a table hand while dragging: where the pieces would go, or (with `blocked`) why they can't go there.
  const [handDrop, setHandDrop] = useState<{ playerId: string; index: number; ids: string[]; x: number; y: number; blocked?: string }>();
  const handTarget = handDrop && !handDrop.blocked ? handDrop : undefined;
  const permissions = handPermissions(p, actor);
  const [altDown, setAltDown] = useState(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number }>();
  const marqueeGesture = useRef<{ x: number; y: number; ids: string[] }>(null);
  const handMarquee = useRef<{ pointer: number; x: number; y: number; ids: string[] }>(null);
  const handGesture = useRef<{ pointer: number; id: string; x: number; y: number }>(null);
  const handSelectionAnchor = useRef<string>(undefined);
  const handClickSuppressed = useRef(false);
  const tableHandGesture = useRef<{ pointer: number; id: string; x: number; y: number }>(null);
  // `extract`: the top piece to take off its stack once the pointer starts moving (a plain click still selects the stack).
  const gesture = useRef<{ pointer: number; x: number; y: number; startWorld?: { x: number; y: number }; positions: Record<string, { x: number; y: number }>; front?: string[]; pan?: { x: number; y: number }; extract?: string;
    /** A button piece being pressed: releasing without moving calls its script function. */
    press?: string }>(null);
  const [pressed, setPressed] = useState<string>();
  const piece = p.instances.find(i => i.id === selected.at(-1));
  const c = p.components.find(c => c.id === piece?.componentId);
  const currentPlayer = p.players.find(player => player.id === actor);
  const held = currentPlayer ? p.instances.filter(i => i.holder === actor).sort((a, b) => a.order - b.order) : [];
  const items = piece ? stackMembers(p, piece) : [];
  const searchedItems = p.instances.filter(i => search?.includes(i.id) && !i.holder).sort((a, b) => a.order - b.order);
  if (searchedItems[0]?.stackReversed) searchedItems.reverse();
  // Stack lookups are per-piece; index them once per project state rather than scanning every instance per piece.
  const table = useMemo(() => {
    const stacks = new Map<string, Instance[]>();
    for (const i of p.instances) if (i.stack) stacks.set(i.stack, [...stacks.get(i.stack) ?? [], i]);
    for (const members of stacks.values()) members.sort((a, b) => a.order - b.order);
    const top = p.instances.filter(i => {
      if (i.holder) return false;
      const members = i.stack ? stacks.get(i.stack)! : undefined;
      return !members || (i.stackReversed ? members[0] : members.at(-1))?.id === i.id;
    });
    return { stacks, top, order: new Map(p.instances.map((i, index) => [i.id, index])), components: new Map(p.components.map(c => [c.id, c])) };
  }, [p.instances, p.components]);
  const topPieces = table.top;
  const selectedPieces = p.instances.filter(i => selected.includes(i.id));
  const plan = useMemo(() => viewer ? undefined : stackPlan(p, selected, actor || undefined), [p, selected, actor, viewer]);
  const wholeStack = items.length > 1 && selectedPieces.length === items.length && items.every(i => selected.includes(i.id));
  // Persistent stacks: the selected piece's (when the whole selection is in it), and whether the selection can become one.
  const pieceStack = piece?.stack ? persistentStacks.find(record => record.id === piece.stack) : undefined;
  const inPieceStack = !!pieceStack && selectedPieces.every(i => i.stack === pieceStack.id);
  const canPersist = !viewer && !!piece && !pieceStack && selectedPieces.length > 0 &&
    selectedPieces.every(i => !i.holder && !i.locked && !!p.components.find(c => c.id === i.componentId)?.stackable);
  /** Who a piece is hidden from, in words: "Hidden from you", "Hidden from Bob and Ada". */
  const hiddenText = (ids: string[]) => {
    const names = ids.map(id => id === actor ? 'you' : p.players.find(player => player.id === id)?.name ?? 'a removed seat');
    return `Hidden from ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]}`;
  };
  // Table pieces in the selection, and the seats the first of them is hidden from (they're hidden together).
  const tablePieces = selectedPieces.filter(i => !i.holder);
  const hiddenFrom = tablePieces[0]?.hiddenFrom ?? [];
  const toggleHidden = (seat: string) => {
    const players = hiddenFrom.includes(seat) ? hiddenFrom.filter(id => id !== seat) : [...hiddenFrom, seat];
    void dispatch({ type: 'hideFrom', ids: tablePieces.map(i => i.id), players });
  };
  // Tags offered when editing a stack's filter: every component's stack tags and the tags filters already use.
  const stackTags = useMemo(() => normalizeTags([...p.components.flatMap(componentTags), ...(p.stacks ?? []).flatMap(record => filterTags(record.filter)),
    ...p.instances.flatMap(i => filterTags(i.stackFilter))]).sort((a, b) => a.localeCompare(b)), [p.components, p.stacks, p.instances]);
  // The stack the selection is in (all of it), whose filter the inspector shows.
  const selectionStack = piece?.stack && selectedPieces.every(i => i.stack === piece.stack) ? piece.stack : undefined;
  const stackTop = piece && !piece.holder ? visibleStackMembers(p, piece).at(-1) : undefined;
  const canDrawSelection = !!currentPlayer && p.settings.hands && !selectedPieces.some(i => i.holder || !p.components.find(c => c.id === i.componentId)?.hand);
  const selectHandCard = (id: string, event: React.MouseEvent) => {
    if (handClickSuppressed.current) { handClickSuppressed.current = false; return; }
    const anchor = held.findIndex(i => i.id === handSelectionAnchor.current);
    const index = held.findIndex(i => i.id === id);
    if (event.shiftKey && anchor >= 0 && selected.some(id => held.some(i => i.id === id))) {
      const range = held.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map(i => i.id);
      setSelected(event.ctrlKey || event.metaKey ? [...new Set([...selected, ...range])] : range);
    } else {
      handSelectionAnchor.current = id;
      setSelected(event.ctrlKey || event.metaKey
        ? selected.includes(id) ? selected.filter(key => key !== id) : [...selected.filter(key => held.some(i => i.id === key)), id]
        : [id]);
    }
  };
  /** Table-hand cards join the table selection: plain click selects only the card, modifier-click toggles it. */
  const selectMini = (id: string, event: React.MouseEvent) => {
    if (handClickSuppressed.current) { handClickSuppressed.current = false; return; }
    handSelectionAnchor.current = id;
    setSelected(event.ctrlKey || event.metaKey || event.shiftKey ? selected.includes(id) ? selected.filter(key => key !== id) : [...selected, id] : [id]);
  };
  const boxRect = (x: number, y: number, event: React.PointerEvent) => ({ x: Math.min(x, event.clientX), y: Math.min(y, event.clientY), width: Math.abs(event.clientX - x), height: Math.abs(event.clientY - y) });
  const touches = (element: Element | null | undefined, rect: { x: number; y: number; width: number; height: number }) => {
    const bounds = element?.getBoundingClientRect();
    return !!bounds && bounds.right >= rect.x && bounds.left <= rect.x + rect.width && bounds.bottom >= rect.y && bounds.top <= rect.y + rect.height;
  };
  useEffect(() => {
    const clear = (event: PointerEvent) => {
      // The table and the hand tray manage their own selection (including box selection).
      if (event.target instanceof Element && event.target.closest('[data-hand-id],[data-mini-id],.table-viewport,.hand-tray,.piece-preview-fullscreen')) return;
      handSelectionAnchor.current = undefined;
      if (selected.some(id => held.some(i => i.id === id))) setSelected([]);
    };
    document.addEventListener('pointerdown', clear, true);
    return () => document.removeEventListener('pointerdown', clear, true);
  }, [selected, held, setSelected]);
  const activePreviewId = handDrag?.id ?? (gesture.current && !gesture.current.pan ? Object.keys(gesture.current.positions).at(-1) : undefined) ?? previewItem;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        setAltDown(e.type === 'keydown');
        if (e.type === 'keydown') setHandDrop(undefined);
      }
    };
    const blur = () => { setAltDown(false); setHovered(undefined); setPreviewItem(undefined); pointer.current = null; };
    const track = (event: PointerEvent) => { lastPointer.current = { x: event.clientX, y: event.clientY }; };
    window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', blur);
    window.addEventListener('pointermove', track, { capture: true, passive: true });
    return () => {
      window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', blur);
      window.removeEventListener('pointermove', track, { capture: true });
    };
  }, []);
  useEffect(() => {
    if (!pointer.current || gesture.current || handGesture.current) return;
    const element = document.elementFromPoint(pointer.current.x, pointer.current.y);
    if (element?.closest('.hover-preview')) return;
    const target = element?.closest<HTMLElement>('[data-piece-id],[data-hand-id],[data-mini-id]');
    const id = target?.dataset.pieceId ?? target?.dataset.handId ?? target?.dataset.miniId;
    if (id) positionPreview(pointer.current.x);
    setHovered(id); setPreviewItem(id);
  }, [p.instances]);
  // Points the hover (and its preview) at whatever is under (x, y).
  const hoverAt = (x: number, y: number) => {
    const element = document.elementFromPoint(x, y);
    if (element?.closest('.hover-preview')) return;
    const target = element?.closest<HTMLElement>('[data-piece-id],[data-hand-id],[data-mini-id]');
    const id = target?.dataset.pieceId ?? target?.dataset.handId ?? target?.dataset.miniId;
    if (id) positionPreview(x);
    setHovered(id); setPreviewItem(id);
  };
  const leavePiece = (event: React.PointerEvent) => {
    // Pressing to pan captures the pointer, which reports leaving the piece; keep the preview until the pan moves.
    if (gesture.current?.pan) return;
    setHovered(undefined);
    if (!(event.relatedTarget instanceof Element) || !event.relatedTarget.closest('.hover-preview')) setPreviewItem(undefined);
  };
  const positionPreview = (clientX: number) => {
    const rect = viewport.current?.getBoundingClientRect();
    if (!rect) return;
    setPreviewOnLeft(placePreviewOnLeft(cssPx(clientX), cssPx(rect.left), cssPx(rect.width), hoverPreviewWidth(previewScale)));
  };
  const enterPiece = (event: React.PointerEvent, id: string) => {
    pointer.current = { x: event.clientX, y: event.clientY };
    positionPreview(event.clientX);
    setHovered(id); setPreviewItem(id);
  };

  // Whether the camera has been fitted to a viewport with a real size yet (it can mount hidden, with no size).
  const fitted = useRef(false);
  const fit = useCallback(() => {
    if (!viewport.current) return;
    const width = viewport.current.clientWidth, height = viewport.current.clientHeight;
    if (!width || !height) return;
    fitted.current = true;
    const z = Math.max(.15, Math.min(width / 1680, height / 1030, 1));
    setCamera(0); setZoom(z); setPan({ x: width / 2 - 950 * z, y: height / 2 - 500 * z });
  }, []);
  // When the view changes size, the camera shifts by half the change so the table's centre stays put. The shift must
  // land before the browser paints the resized view, or one frame shows the table jumping aside.
  const viewSize = useRef<{ width: number; height: number }>(undefined);
  const followView = useCallback((now: boolean) => {
    const element = viewport.current;
    if (!element) return;
    const next = { width: element.clientWidth, height: element.clientHeight };
    if (!fitted.current) { fit(); viewSize.current = next; return; }
    const previous = viewSize.current;
    viewSize.current = next;
    if (!previous || (previous.width === next.width && previous.height === next.height)) return;
    const shift = () => setPan(value => ({ x: value.x + (next.width - previous.width) / 2, y: value.y + (next.height - previous.height) / 2 }));
    if (now) flushSync(shift); else shift();
  }, [fit]);
  useEffect(() => {
    fit();
    viewSize.current = viewport.current ? { width: viewport.current.clientWidth, height: viewport.current.clientHeight } : undefined;
    // Window resizes: a resize observer runs before paint, and flushSync renders the shift right there.
    const observer = new ResizeObserver(() => followView(true));
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [fit, followView]);
  // Panels opening, closing or resizing change the view in the same commit, so shift the camera in that commit too.
  const panelLayout = `${libraryVisible}|${inspectorVisible}|${layersVisible}|${handVisible}|${JSON.stringify(panels.sizes)}`;
  useLayoutEffect(() => followView(false), [panelLayout, followView]);
  const changeZoom = (next: number, cursor?: { x: number; y: number }) => {
    const z = Math.max(.15, Math.min(MAX_ZOOM, next));
    const rect = viewport.current?.getBoundingClientRect();
    if (rect) {
      const g = gesture.current;
      const dragging = g && !g.pan && pointer.current;
      const anchor = cursor ? { x: cssPx(cursor.x - rect.left), y: cssPx(cursor.y - rect.top) } : { x: cssPx(rect.width) / 2, y: cssPx(rect.height) / 2 };
      const nextPan = { x: anchor.x - (anchor.x - pan.x) * z / zoom, y: anchor.y - (anchor.y - pan.y) * z / zoom };
      setPan(nextPan);
      if (g && dragging && g.startWorld) {
        const point = worldPoint(dragging.x, dragging.y, z, nextPan);
        const delta = { x: point.x - g.startWorld.x, y: point.y - g.startWorld.y };
        setPreview(Object.fromEntries(Object.entries(g.positions).map(([id, pos]) => [id, { x: pos.x + delta.x, y: pos.y + delta.y }])));
      }
      if (seatGesture.current && pointer.current) previewSeat(pointer.current.x, pointer.current.y, z, nextPan);
    }
    setZoom(z);
  };
  /** Centers the camera on the selected table pieces (whole stacks included) and zooms so they fill most of the view. */
  const focusSelection = () => focusOn(selected);
  /** Centres and zooms the camera on these pieces (with their whole stacks). */
  const focusOn = (ids: string[]) => {
    const rect = viewport.current?.getBoundingClientRect();
    const stacks = new Set(p.instances.filter(i => ids.includes(i.id) && i.stack).map(i => i.stack));
    const targets = p.instances.filter(i => !i.holder && (ids.includes(i.id) || (i.stack && stacks.has(i.stack))));
    if (!rect || !targets.length) return false;
    const angle = camera * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const xs: number[] = [], ys: number[] = [];
    for (const item of targets) {
      const comp = p.components.find(c => c.id === item.componentId);
      if (!comp) continue;
      const turn = item.rotation * Math.PI / 180, w = comp.width * item.scale / 2, h = comp.height * item.scale / 2;
      for (const [cx, cy] of [[-w, -h], [w, -h], [w, h], [-w, h]]) {
        const x = item.x + cx * Math.cos(turn) - cy * Math.sin(turn), y = item.y + cx * Math.sin(turn) + cy * Math.cos(turn);
        xs.push(x * cos - y * sin); ys.push(x * sin + y * cos);
      }
    }
    if (!xs.length) return false;
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const width = cssPx(rect.width), height = cssPx(rect.height);
    const z = Math.max(.15, Math.min(MAX_ZOOM, width * .6 / Math.max(1, maxX - minX), height * .6 / Math.max(1, maxY - minY)));
    setZoom(z); setPan({ x: width / 2 - (minX + maxX) / 2 * z, y: height / 2 - (minY + maxY) / 2 * z });
    return true;
  };
  const worldPoint = (x: number, y: number, scale = zoom, translation = pan) => {
    const rect = viewport.current!.getBoundingClientRect();
    const dx = cssPx(x - rect.left) - translation.x, dy = cssPx(y - rect.top) - translation.y;
    const angle = -camera * Math.PI / 180;
    return { x: (dx * Math.cos(angle) - dy * Math.sin(angle)) / scale, y: (dx * Math.sin(angle) + dy * Math.cos(angle)) / scale };
  };
  const dragDelta = (g: NonNullable<typeof gesture.current>, x: number, y: number) => {
    const point = worldPoint(x, y);
    return g.startWorld ? { x: point.x - g.startWorld.x, y: point.y - g.startWorld.y } : { x: 0, y: 0 };
  };
  /** Seat drags anchor to the world point under the pointer, so zooming or rotating mid-drag cannot offset the seat. */
  const previewSeat = (x: number, y: number, scale = zoom, translation = pan) => {
    const g = seatGesture.current;
    if (!g) return;
    const point = worldPoint(x, y, scale, translation);
    setSeatPosition({ id: g.id, x: g.startX + point.x - g.startWorld.x, y: g.startY + point.y - g.startWorld.y, rotation: g.rotation });
  };
  const rotateDraggedSeat = (degrees: number) => {
    const g = seatGesture.current;
    if (!g) return false;
    g.rotation = ((g.rotation + degrees) % 360 + 360) % 360;
    seatMoved.current = true;
    const at = pointer.current ?? { x: g.x, y: g.y };
    previewSeat(at.x, at.y);
    return true;
  };
  // Offline, the active player may edit every hotseat seat on this device. Online, players edit their own seat and empty seats
  // (viewers cannot), and the room host may edit every seat. Changes to a seat someone else plays, or to another hotseat
  // seat, are flagged as overrides in the UI.
  const online = owner !== 'local';
  const hostOverride = (player: Player) => host && online && !!player.owner && player.owner !== owner;
  const canEditSeat = (player: Player) => !online || player.owner === owner || (!player.owner && (!viewer || host)) || hostOverride(player);
  const seatStatus = (player: Player) => !online ? actor === player.id ? 'Active seat' : 'Switch to this seat'
    : player.owner === owner ? 'Your seat' : player.owner ? 'Taken by another player' : 'Empty seat · Click to take it';
  const seatOverride = (player: Player): SeatOverride | undefined => player.id === actor || !canEditSeat(player) ? undefined
    : hostOverride(player) ? 'host' : online ? undefined : 'hotseat';
  const rotateSeat = (player: Player, degrees: number) => {
    if (canEditSeat(player) && player.tableHandUnlocked) void dispatch({ type: 'player', player: { ...player, rotation: ((player.rotation + degrees) % 360 + 360) % 360 } });
  };
  const rotateCamera = (degrees: number) => {
    const rect = viewport.current?.getBoundingClientRect();
    if (!rect) return;
    const center = worldPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const angle = (camera + degrees) * Math.PI / 180;
    setPan({ x: cssPx(rect.width) / 2 - zoom * (center.x * Math.cos(angle) - center.y * Math.sin(angle)),
      y: cssPx(rect.height) / 2 - zoom * (center.x * Math.sin(angle) + center.y * Math.cos(angle)) });
    setCamera(camera + degrees);
  };
  // Hit-testing a large table is costly; drop hints query seats and pieces at the same point within one event.
  const hits = useRef<{ x: number; y: number; elements: Element[] }>(undefined);
  const elementsAt = (x: number, y: number) => {
    if (hits.current?.x === x && hits.current.y === y) return hits.current.elements;
    const elements = document.elementsFromPoint(x, y);
    hits.current = { x, y, elements };
    queueMicrotask(() => { hits.current = undefined; });
    return elements;
  };
  const slotAt = (x: number, y: number) => {
    const id = elementsAt(x, y).map(element => element.closest<HTMLElement>('[data-stack-slot]')?.dataset.stackSlot).find(Boolean);
    return emptySlots.find(record => record.id === id);
  };
  const fitsSlot = (record: PersistentStack, moving: Instance[]) => moving.length > 0 && moving.every(i => !i.locked) &&
    fitsPersistentStack(record, moving.map(i => p.components.find(c => c.id === i.componentId)!));
  const targetAt = (x: number, y: number, excluded: string[]) => {
    const elements = elementsAt(x, y);
    for (const element of elements) {
      const id = element.closest<HTMLElement>('[data-piece-id]')?.dataset.pieceId;
      const target = p.instances.find(i => i.id === id);
      if (target && !excluded.includes(target.id) && !target.locked) return target;
    }
    return undefined;
  };
  const seatAt = (x: number, y: number) => {
    const direct = elementsAt(x, y)
      .map(element => element.closest<HTMLElement>('[data-seat-id]')?.dataset.seatId)
      .find(id => !!id);
    if (direct) return direct;
    const bounds = viewport.current?.getBoundingClientRect();
    if (!bounds || x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return undefined;
    let nearest: { id: string; distance: number } | undefined;
    for (const seat of viewport.current?.querySelectorAll<HTMLElement>('[data-seat-id]') ?? []) {
      for (const element of [seat, ...seat.querySelectorAll<HTMLElement>('.other-hand,[data-mini-id]')]) {
        const rect = element.getBoundingClientRect();
        const dx = Math.max(rect.left - x, 0, x - rect.right);
        const dy = Math.max(rect.top - y, 0, y - rect.bottom);
        const distance = Math.hypot(dx, dy);
        if (dx <= 28 && dy <= 28 && (!nearest || distance < nearest.distance)) nearest = { id: seat.dataset.seatId!, distance };
      }
    }
    return nearest?.id;
  };
  const tableHandInsertion = (x: number, y: number, moving: Instance[], alt = false) => {
    if (alt || !p.settings.hands || !moving.length) return undefined;
    const playerId = seatAt(x, y), player = p.players.find(player => player.id === playerId);
    if (!player) return undefined;
    // Over a hand the pieces can't go into: show the hand as blocked, with the reason.
    const noHand = moving.map(i => p.components.find(c => c.id === i.componentId)).find(c => !c?.hand);
    const from = moving.find(i => i.holder && i.holder !== actor && !handPermissions(p, i.holder).take);
    const blocked = moving.some(i => i.locked) ? 'Locked pieces stay on the table.'
      : noHand ? `${noHand.name} can't be held in a hand (see its Behavior settings).`
      : player.id !== actor && !handPermissions(p, player.id).insert && moving.some(i => i.holder !== player.id) ? `${player.name} doesn't let others put pieces into their hand.`
      : from ? `Taking from ${p.players.find(seat => seat.id === from.holder)?.name ?? 'that'}'s hand is turned off.` : undefined;
    if (blocked) return { playerId: player.id, index: -1, ids: [] as string[], x, y, blocked };
    const ids = moving.map(i => i.id);
    const cards = [...(viewport.current?.querySelectorAll<HTMLElement>(`[data-seat-id="${CSS.escape(player.id)}"] [data-mini-id]`) ?? [])].filter(el => !ids.includes(el.dataset.miniId!));
    const angle = (camera + player.rotation) * Math.PI / 180;
    const index = cards.findIndex(el => {
      const rect = el.getBoundingClientRect();
      return (x - rect.left - rect.width / 2) * Math.cos(angle) + (y - rect.top - rect.height / 2) * Math.sin(angle) < 0;
    });
    return { playerId: player.id, index: index < 0 ? cards.length : index, ids, x, y };
  };
  const insertIntoTableHand = (x: number, y: number, moving: Instance[], alt: boolean) => {
    const drop = tableHandInsertion(x, y, moving, alt);
    if (!drop || drop.blocked) return false;
    markDroppedIntoHand(drop.ids);
    void dispatch({ type: 'transferToHand', ids: drop.ids, playerId: drop.playerId, index: drop.index });
    return true;
  };
  const compatible = (target: Instance, moving: Instance[]) =>
    [...stackMembers(p, target), ...moving].every(i => !i.locked) && !stackJoinError(p, target, moving);
  const showDropHint = (x: number, y: number, moving: Instance[], alt: boolean) => {
    const hand = tableHandInsertion(x, y, moving, alt);
    setHandDrop(hand);
    const target = targetAt(x, y, moving.map(i => i.id));
    setAltDown(alt);
    // A hand the pieces can't go into doesn't get in the way: they can still stack onto what's under it.
    const slot = !target && (!hand || hand.blocked) ? slotAt(x, y) : undefined;
    setDropHint((!hand || hand.blocked) && target && moving.length && compatible(target, moving) ? { id: target.id, x, y }
      : slot && fitsSlot(slot, moving) ? { id: `slot:${slot.id}`, x, y } : undefined);
  };
  const handInsertion = (x: number, y: number, dragged: string[]) => {
    const scroller = handScroller.current;
    if (!scroller) return undefined;
    const rect = scroller.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return undefined;
    if (x < rect.left + 28) scroller.scrollLeft -= 18;
    if (x > rect.right - 28) scroller.scrollLeft += 18;
    const cards = [...scroller.querySelectorAll<HTMLElement>('[data-hand-id]')].filter(el => !dragged.includes(el.dataset.handId ?? ''));
    const index = cards.findIndex(el => { const r = el.getBoundingClientRect(); return x < r.left + r.width / 2; });
    return index < 0 ? cards.length : index;
  };
  const clone = (ids = selected, destination?: { x: number; y: number }) => {
    if (!ids.length) return;
    const originals = p.instances.filter(i => ids.includes(i.id) || (i.stack && p.instances.some(other => ids.includes(other.id) && other.stack === i.stack)));
    if (originals.some(i => i.holder && i.holder !== actor)) { notify("You can't clone another player's hand.", true); return; }
    if (!originals.length) return;
    const stacks = new Map<string, string>();
    const copies = originals.map(i => {
      if (i.stack && !stacks.has(i.stack)) stacks.set(i.stack, uid('stack'));
      return { sourceId: i.id, id: uid('piece'), stack: i.stack ? stacks.get(i.stack)! : null };
    });
    const dx = destination ? destination.x - originals[0].x : 45, dy = destination ? destination.y - originals[0].y : 45;
    void dispatch({ type: 'duplicate', copies, dx, dy }).then(ok => { if (ok) setSelected(copies.map(i => i.id)); });
  };
  const flip = () => { if (piece) dispatch({ type: 'transform', ids: selected, flip: true }); };
  const fullGroups = useMemo(() => selectedGroups(p, selected), [p, selected]);
  const canGroup = selected.some(id => p.instances.some(i => i.id === id && !i.holder));
  const groupSelected = () => {
    const command = createGroupCommand(p, selected);
    if (command) void dispatch(command); else notify('Select pieces on the table to group them.', true);
  };
  const ungroupSelected = () => {
    if (fullGroups.length) void dispatch({ type: 'ungroup', ids: fullGroups.map(group => group.id) });
    else notify('Click a group in the Pieces panel to select it, then ungroup it.', true);
  };
  const turnPages = (delta: number) => {
    const ids = selectedPieces.filter(i => hasPages(table.components.get(i.componentId)!)).map(i => i.id);
    if (ids.length) void dispatch({ type: 'cycleVariant', ids, delta });
  };
  // Rotation goes in steps of each piece's component rotation step (90° by default).
  const rotate = (turns: number) => { if (piece) dispatch({ type: 'transform', ids: selected, turns }); };
  const stepOf = (componentId?: string) => p.components.find(c => c.id === componentId)?.rotationStep ?? 90;
  const selectionStep = (() => { const steps = new Set(selectedPieces.map(i => stepOf(i.componentId))); return steps.size === 1 ? [...steps][0] : undefined; })();
  const shuffleOrRoll = (ids: string[]) => {
    const chosen = p.instances.filter(i => ids.includes(i.id) && !i.holder);
    const dice = chosen.filter(i => p.components.find(c => c.id === i.componentId)?.kind === 'dice');
    if (dice.length) void dispatch({ type: 'roll', ids: dice.map(i => i.id), seed: crypto.getRandomValues(new Uint32Array(1))[0] });
    const seen = new Set<string>();
    for (const item of chosen) {
      const key = item.stack ?? item.id;
      if (seen.has(key) || !stackMembers(p, item).every(i => p.components.find(c => c.id === i.componentId)?.shufflable)) continue;
      seen.add(key);
      if (!dice.includes(item)) void dispatch({ type: 'shuffle', id: item.id, seed: crypto.getRandomValues(new Uint32Array(1))[0] });
    }
  };
  const shuffleHand = () => {
    const ids = held.map(i => i.id);
    for (let n = ids.length - 1; n > 0; n--) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0] % (n + 1);
      [ids[n], ids[j]] = [ids[j], ids[n]];
    }
    void dispatch({ type: 'reorderHand', ids, playerId: actor });
  };
  /** Hand actions for the active seat's toolbar, or for a seat selected in the inspector. Every toggle is that seat's own setting:
   * its active player may change it, and the room host or a hotseat seat's active player may override it (marked as an override). */
  const handActions = (seat?: Player) => {
    const target = seat ?? currentPlayer;
    const own = !seat || seat.id === actor;
    const override = !own && !!seat && !!seatOverride(seat);
    const hand = !seat ? 'my hand' : `${seat.name}'s hand`;
    const tableHand = !seat ? 'my table hand' : `${seat.name}'s table hand`;
    const inactive = own ? undefined : `Switch to ${seat!.name}'s seat to manage this hand`;
    const label = (text: string) => ({ 'aria-label': text, title: inactive ? `${text} (${inactive})` : text });
    const setting = (text: string) => override
      ? { 'aria-label': text, title: `${text} (${seatOverride(seat!) === 'host' ? 'host' : 'hotseat'} override: this is ${seat!.name}'s setting)`, className: 'icon-button host-override' }
      : { ...label(text), className: 'icon-button' };
    const seatPermissions = seat ? handPermissions(p, seat.id) : permissions;
    const seatHeld = seat ? p.instances.filter(i => i.holder === seat.id).length : held.length;
    const faceUp = target?.handFaceUp ?? true, hidden = !!target?.tableHandHidden, unlocked = !!target?.tableHandUnlocked;
    const set = (patch: Extract<Command, { type: 'handSettings' }>['patch']) => dispatch({ type: 'handSettings', playerId: target?.id ?? actor, patch });
    const manage = own || override;
    return <>
      <button {...setting(`Turn cards face up when entering ${hand}`)} aria-pressed={faceUp} disabled={!manage} onClick={() => set({ handFaceUp: !faceUp })}><FlipHorizontal2 size={16} /></button>
      <button {...setting(`${hidden ? 'Show' : 'Hide'} ${tableHand}`)} aria-pressed={hidden} disabled={!manage} onClick={() => set({ tableHandHidden: !hidden })}>{hidden ? <EyeOff size={16} /> : <Eye size={16} />}</button>
      <button className="icon-button" {...label(seat ? `Shuffle ${hand}` : 'Shuffle hand')} disabled={!own || seatHeld < 2} onClick={shuffleHand}><Shuffle size={16} /></button>
      <button className="icon-button" {...label(seat ? `Reverse ${hand}` : 'Reverse hand')} disabled={!own || seatHeld < 2} onClick={() => dispatch({ type: 'reorderHand', ids: held.map(i => i.id).reverse(), playerId: actor })}><ArrowRightLeft size={16} /></button>
      <button {...setting(`Allow others to insert into ${hand}`)} aria-pressed={seatPermissions.insert} disabled={!manage} onClick={() => set({ allowHandInsert: !seatPermissions.insert })}><ArrowDownToLine size={16} /></button>
      <button {...setting(`Allow others to take from ${hand}`)} aria-pressed={seatPermissions.take} disabled={!manage} onClick={() => set({ allowHandTake: !seatPermissions.take })}><ArrowUpFromLine size={16} /></button>
      <button {...setting(`${unlocked ? 'Lock' : 'Unlock'} ${tableHand}`)} aria-pressed={unlocked} disabled={!manage} onClick={() => set({ tableHandUnlocked: !unlocked })}>{unlocked ? <UnlockKeyhole size={16} /> : <LockKeyhole size={16} />}</button>
      {seat ? <button className="icon-button" aria-label="Switch to this seat" title={own ? 'This is your active seat' : `Switch to ${seat.name}'s seat`} disabled={own} onClick={() => onSwitch(seat)}><Users size={16} /></button>
        : <button className="icon-button" aria-label="Switch seat" title="Switch seat" onClick={() => { setPanel('players'); onShowInspector(); }}><Users size={16} /></button>}
    </>;
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || fullscreenItem) return;
      // Keys typed in the script and memory windows stay there.
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="dialog"],.floating-window') || document.querySelector('[role="dialog"],[aria-modal="true"]')) return;
      if (tool === 'grid') {
        if (e.key === 'Escape') { if (gridPoint || pointGroup) { setGridPoint(undefined); setPointGroup(undefined); } else setTool('select'); }
        if ((e.key === 'Delete' || e.key === 'Backspace') && editedGrid?.shape === 'points' && gridPoint && !viewer) {
          e.preventDefault();
          void dispatch({ type: 'grid', grid: { ...editedGrid, points: (editedGrid.points ?? []).filter(point => point.id !== gridPoint) } });
          setGridPoint(undefined);
        }
        return;
      }
      if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'z') {
        const target = p.instances.find(item => item.id === (hovered ?? selected.at(-1)));
        if (target) { e.preventDefault(); setFullscreen({ id: target.id, pointer: lastPointer.current }); setAltDown(false); }
        return;
      }
      if (e.key === 'Escape') { setSelected([]); setSelectedSeatId(undefined); }
      const hoveredPiece = p.instances.find(i => i.id === hovered && (!i.holder || i.holder === actor));
      const shortcutIds = hoveredPiece && !selected.includes(hoveredPiece.id) ? stackMembers(p, hoveredPiece).map(i => i.id) : selected;
      const shortcutPiece = hoveredPiece ?? piece;
      const draggedHandPiece = handDrag && p.instances.find(i => i.id === handDrag.id && i.holder === actor);
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'f') { if (focusSelection()) e.preventDefault(); return; }
      if (viewer) return;
      if (piecesHovered.current && !e.altKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) ungroupSelected(); else groupSelected();
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'f' && (draggedHandPiece || shortcutPiece)) {
        // A flipped stack can replace its top DOM node. Keep the active drag on the stable viewport.
        if (gesture.current && viewport.current && !gesture.current.pan) viewport.current.setPointerCapture(gesture.current.pointer);
        const ids = draggedHandPiece ? selected.includes(draggedHandPiece.id)
          ? held.filter(i => selected.includes(i.id)).map(i => i.id) : [draggedHandPiece.id] : shortcutIds;
        dispatch({ type: 'transform', ids, flip: true });
      }
      const seatTarget = !hoveredPiece ? p.players.find(player => player.id === hoveredSeat) ?? (!piece ? selectedSeat : undefined) : undefined;
      if (!e.ctrlKey && !e.metaKey && !e.altKey && ['q', 'e'].includes(e.key.toLowerCase()) && (seatGesture.current || seatTarget)) {
        e.preventDefault();
        const degrees = e.key.toLowerCase() === 'q' ? -90 : 90;
        if (!rotateDraggedSeat(degrees) && seatTarget) rotateSeat(seatTarget, degrees);
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && ['q', 'e'].includes(e.key.toLowerCase()) && shortcutPiece) {
        e.preventDefault();
        const delta = e.key.toLowerCase() === 'q' ? -1 : 1;
        // Shift turns book pages and steps dice to their next face; other pieces rotate.
        const paged = e.shiftKey ? shortcutIds.filter(id => { const comp = table.components.get(p.instances.find(i => i.id === id)?.componentId ?? ''); return !!comp && hasPages(comp); }) : [];
        if (paged.length) dispatch({ type: 'cycleVariant', ids: paged, delta });
        else dispatch({ type: 'transform', ids: shortcutIds, turns: delta });
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'r' && shortcutPiece) { e.preventDefault(); shuffleOrRoll(shortcutIds); }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'g' && selected.length > 1) { e.preventDefault(); dispatch({ type: 'stack', ids: selected, stackId: uid('stack') }); }
      if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && shortcutPiece && !shortcutPiece.holder && currentPlayer) {
        e.preventDefault();
        const count = e.key === '0' ? 10 : Number(e.key);
        dispatch(count === 1 ? { type: 'draw', id: shortcutPiece.id, playerId: actor } : { type: 'drawMany', id: shortcutPiece.id, playerId: actor, count });
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'p' && shortcutPiece) { e.preventDefault(); void dispatch({ type: 'ping', ids: shortcutIds }); }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'l' && shortcutPiece) { e.preventDefault(); dispatch({ type: 'move', ids: shortcutIds, patch: { locked: !ownLock(shortcutPiece.id) } }); }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); dispatch({ type: 'delete', ids: shortcutIds }); setSelected([]); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); clone(shortcutIds); }
      // Ctrl/Cmd+] and [ step pieces forward or backward past the next piece they overlap; with Shift, to the front or back.
      // The physical bracket keys are matched, since Shift changes the typed character.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'BracketRight' || e.code === 'BracketLeft') && shortcutIds.length) {
        e.preventDefault();
        const up = e.code === 'BracketRight';
        dispatch({ type: 'zOrder', ids: shortcutIds, move: e.shiftKey ? up ? 'front' : 'back' : up ? 'forward' : 'backward' });
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selected.length) {
        e.preventDefault();
        const originals = p.instances.filter(i => selected.includes(i.id) || (i.stack && p.instances.some(other => selected.includes(other.id) && other.stack === i.stack)));
        if (originals.some(i => i.holder && i.holder !== actor)) { notify("You can't copy another player's hand.", true); return; }
        clipboard.current = structuredClone(originals);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && clipboard.current.length && pointer.current && viewport.current) {
        e.preventDefault();
        const point = worldPoint(pointer.current.x, pointer.current.y), originals = clipboard.current;
        const stacks = new Map<string, string>();
        const copies = originals.map(i => {
          if (i.stack && !stacks.has(i.stack)) stacks.set(i.stack, uid('stack'));
          return { ...i, id: uid('piece'), stack: i.stack ? stacks.get(i.stack)! : null, holder: null, locked: false,
            x: i.x + point.x - originals[0].x, y: i.y + point.y - originals[0].y };
        });
        void dispatch({ type: 'paste', instances: copies }).then(ok => { if (ok) setSelected(copies.map(i => i.id)); });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  /** Calls a piece's script function (its component's action) for everyone. */
  const runAction = (item: Instance) => {
    const comp = table.components.get(item.componentId);
    if (!comp?.action) { notify(`Choose a script function for ${comp?.name ?? 'this piece'} in its Behavior tab.`, true); return; }
    void dispatch({ type: 'call', name: comp.action, piece: item.id, args: [], seed: crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff });
  };
  const startPiece = (e: React.PointerEvent, item: Instance) => {
    if (tool === 'pan' || tool === 'grid' || e.button === 1) return;
    if (e.button !== 0) return;
    // A plain click on a button piece presses it (when released without moving). Locked buttons only press;
    // unlocked ones can still be dragged, and Ctrl/Cmd or Shift-click selects them.
    const press = !viewer && !item.holder && !e.ctrlKey && !e.metaKey && !e.shiftKey && table.components.get(item.componentId)?.kind === 'button' ? item.id : undefined;
    if (press) setPressed(press);
    if (press && item.locked) {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, positions: {}, press };
      return;
    }
    // Locked pieces ignore plain clicks so a box selection can start over them; Ctrl/Cmd-click still selects them.
    if (item.locked && !e.ctrlKey && !e.metaKey) return;
    e.stopPropagation();
    // On a stack, Shift swaps between taking its top piece and moving the whole stack (see the stackDragTakesTop setting).
    const takeTop = !viewer && !!item.stack && !e.ctrlKey && !e.metaKey && e.shiftKey !== stackDragTakesTop;
    const extracting = takeTop && e.shiftKey;
    const group = extracting ? [item.id] : stackMembers(p, item).map(i => i.id);
    const extending = !extracting && (e.ctrlKey || e.metaKey || (e.shiftKey && !item.stack));
    const ids = press ? [item.id] : extracting ? group : extending ? selected.includes(item.id) ? selected.filter(id => !group.includes(id)) : [...new Set([...selected, ...group])] : selected.includes(item.id) ? selected : group;
    if (!press) setSelected(ids);
    if (viewer || !ids.includes(item.id)) return;
    // Selecting a locked piece (or one in a locked group) leaves it where it is in the table order.
    if (item.locked) return;
    const positions = Object.fromEntries(p.instances.filter(i => ids.includes(i.id) && !i.locked && !i.holder).map(i => [i.id, { x: i.x, y: i.y }]));
    const active = { pointer: e.pointerId, x: e.clientX, y: e.clientY, startWorld: worldPoint(e.clientX, e.clientY), positions, front: group,
      ...(takeTop && !extracting ? { extract: item.id } : {}), ...(press ? { press } : {}) };
    gesture.current = active;
    if (extracting) {
      viewport.current?.setPointerCapture(e.pointerId);
      void dispatch({ type: 'extractMove', id: item.id, x: item.x, y: item.y }).then(ok => {
        if (!ok && gesture.current === active) {
          gesture.current = null; setPreview({}); setDropHint(undefined); setHandDrop(undefined);
        }
      });
    } else e.currentTarget.setPointerCapture(e.pointerId);
  };
  // Table pieces are memoized; they call the latest handlers through this ref, so camera and drag renders skip them.
  const pieceEvents = useRef<PieceEvents>(null!);
  pieceEvents.current = {
    start: startPiece, enter: enterPiece, leave: leavePiece,
    focus: id => { setHovered(id); setPreviewItem(id); }, blur: () => { setHovered(undefined); setPreviewItem(undefined); },
    select: (item, extend) => {
      // Enter or Space on a button piece presses it.
      if (!extend && !viewer && table.components.get(item.componentId)?.kind === 'button') { runAction(item); return; }
      const ids = stackMembers(p, item).map(i => i.id); setSelected(extend ? [...new Set([...selected, ...ids])] : ids);
    },
    draw: (item, comp) => { if (item.locked || viewer || !currentPlayer) return false; if (p.settings.hands && comp.hand) void dispatch({ type: 'draw', id: item.id, playerId: actor }); return true; },
  };
  const endGesture = (e: React.PointerEvent) => {
    const edit = gridGesture.current;
    if (edit && edit.pointer === e.pointerId) {
      gridGesture.current = null;
      const changed = edit.added || edit.moved ? gridDraft : undefined;
      if (changed) void dispatch({ type: 'grid', grid: changed }).finally(() => setGridDraft(undefined));
      else setGridDraft(undefined);
      return;
    }
    setHandDrop(undefined);
    if (marqueeGesture.current) {
      marqueeGesture.current = null; setMarquee(undefined);
    }
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    setPressed(undefined);
    if (g.press && Math.hypot(e.clientX - g.x, e.clientY - g.y) <= 3) {
      gesture.current = null; setPreview({}); setDropHint(undefined);
      const item = p.instances.find(i => i.id === g.press);
      if (item) runAction(item);
      return;
    }
    const bounds = viewport.current?.getBoundingClientRect();
    if (bounds && (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom)) {
      pointer.current = null; setHovered(undefined); setPreviewItem(undefined);
    }
    if (g.front?.length) void dispatch({ type: 'front', ids: g.front });
    if (!g.pan && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 3) {
      const moving = Object.keys(g.positions).map(id => p.instances.find(i => i.id === id)!).sort((a, b) => a.order - b.order);
      const tray = document.querySelector('.hand-tray')?.getBoundingClientRect();
      const inside = (r?: DOMRect) => r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (insertIntoTableHand(e.clientX, e.clientY, moving, e.altKey)) {
        gesture.current = null; setPreview({}); setDropHint(undefined); return;
      }
      // Over a hand they can't go into, the pieces drop as if the hand weren't there (stacking included).
      const bypass = e.altKey;
      if (inside(tray) && moving.length) {
        markDroppedIntoHand(moving.map(i => i.id));
        dispatch({ type: 'drawSelection', ids: moving.map(i => i.id), playerId: actor });
        gesture.current = null; setPreview({}); setDropHint(undefined); return;
      }
      const slot = !bypass ? slotAt(e.clientX, e.clientY) : undefined;
      if (slot && fitsSlot(slot, moving)) {
        void dispatch({ type: 'dropIntoStack', ids: moving.map(i => i.id), stackId: slot.id });
        gesture.current = null; setPreview({}); setDropHint(undefined); return;
      }
      const target = targetAt(e.clientX, e.clientY, Object.keys(g.positions));
      if (!bypass && target && moving.length && compatible(target, moving)) {
        void dispatch({ type: 'dropStack', ids: moving.map(i => i.id), targetId: target.id, stackId: uid('stack') })
          .then(ok => { if (ok) setSelected([...stackMembers(p, target), ...moving].map(i => i.id)); });
        gesture.current = null; setPreview({}); setDropHint(undefined); return;
      }
      const delta = dragDelta(g, e.clientX, e.clientY);
      if (moving.length) {
        // One atomic command, including all stack members; each piece snaps from its own final position.
        // The shared engine snaps each moved stack or piece to the first grid that takes it.
        void dispatch({ type: 'transform', ids: moving.map(i => i.id), dx: delta.x, dy: delta.y, snap: true });
      }
    }
    gesture.current = null; setPreview({}); setDropHint(undefined);
    // After panning, the preview follows whatever is now under the pointer.
    if (g.pan && pointer.current) hoverAt(e.clientX, e.clientY);
  };
  return <div className="playground-layout">
    {layersVisible && <><aside id="playground-pieces-panel" aria-label={editedGrid?.shape === 'points' ? 'Points' : 'Pieces'} className="layers-panel" style={{ width: panels.sizes.layers, minWidth: 0, flex: `0 0 ${panels.sizes.layers}px` }}
      onPointerEnter={() => { piecesHovered.current = true; }} onPointerLeave={() => { piecesHovered.current = false; }}>
      {/* While the Grids tool edits a points grid, its snap points take the pieces' place. */}
      {editedGrid?.shape === 'points' ? <PointsPanel grid={editedGrid} point={gridPoint} onSelectPoint={setGridPoint} group={pointGroup} onSelectGroup={setPointGroup}
        onChange={grid => dispatch({ type: 'grid', grid })} readOnly={viewer} /> : <>
      <div className="panel-heading"><span><Shapes size={15} /> Pieces</span><span className="panel-heading-actions">
        <button className="icon-button" title="Group selected pieces (G while pointing at this panel)" aria-label="Group selected pieces" disabled={viewer || !canGroup} onClick={groupSelected}><FolderPlus size={14} /></button>
        <button className="icon-button" title="Ungroup selected groups (Shift+G while pointing at this panel)" aria-label="Ungroup selected groups" disabled={viewer || !fullGroups.length} onClick={ungroupSelected}><Ungroup size={14} /></button>
        <span className="subtle">{topPieces.length}</span></span></div>
      <PlaygroundPieces project={source} selected={selected} dispatch={dispatch} readOnly={viewer} onSelect={ids => { setSelected(ids); setSelectedSeatId(undefined); setPanel('selection'); }} />
      </>}
    </aside>
    <PanelSeparator label="Resize pieces panel" controls="playground-pieces-panel" value={panels.sizes.layers} {...panels.limits.layers} onResize={value => panels.resize('layers', value)} /></>}
    <section className="table-section" onPointerMoveCapture={e => {
      if (e.target instanceof Element && e.target.closest('[data-piece-id],[data-hand-id],[data-mini-id]')) positionPreview(e.clientX);
    }}>
      <div ref={viewport} className={`table-viewport ${tool === 'pan' ? 'pan-mode' : tool === 'grid' ? 'grid-mode' : ''}`}
        onDragOver={e => {
          if (Array.from(e.dataTransfer.types).includes(LIBRARY_DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
        }}
        onDrop={e => {
          if (!Array.from(e.dataTransfer.types).includes(LIBRARY_DRAG_TYPE)) return;
          e.preventDefault();
          const data = readLibraryDrag(e.dataTransfer);
          const component = data?.projectId === p.id ? p.components.find(c => c.id === data.componentId) : undefined;
          if (!data || !component || isAsset(component)) { notify('Unable to spawn these library variants.', true); return; }
          onSpawn(component, data.rows, worldPoint(e.clientX, e.clientY), data.stacked);
        }}
        onPointerLeave={() => { if (!gesture.current) { pointer.current = null; setHovered(undefined); setPreviewItem(undefined); } }}
        onContextMenu={e => e.preventDefault()}
        onWheel={e => {
          pointer.current = { x: e.clientX, y: e.clientY };
          const item = p.instances.find(i => i.id === hovered && !i.holder);
          if (seatGesture.current && !e.ctrlKey) rotateDraggedSeat(e.deltaY > 0 ? 15 : -15);
          else if (e.shiftKey && item && p.components.find(c => c.id === item.componentId)?.kind === 'card') {
            e.preventDefault();
            void dispatch({ type: 'transform', ids: stackMembers(p, item).map(i => i.id), rotation: e.deltaY > 0 ? 15 : -15 });
          } else { if (e.ctrlKey) e.preventDefault(); changeZoom(zoom * (e.deltaY > 0 ? .92 : 1.08), e.deltaY > 0 ? undefined : { x: e.clientX, y: e.clientY }); }
        }}
        onPointerDown={e => {
          if (e.button === 1 || tool === 'pan') {
            gesture.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, positions: {}, pan };
            e.currentTarget.setPointerCapture(e.pointerId);
          } else if (tool === 'grid') {
            // The grid tool moves the edited grid, or on a points grid picks, drags and adds snap points.
            if (e.button !== 0 || viewer || !editedGrid) return;
            const startWorld = worldPoint(e.clientX, e.clientY);
            const handle = (e.target as Element).closest<SVGElement>('[data-grid-point]')?.dataset.gridPoint;
            let grid = editedGrid, point: string | undefined, added = false;
            if (grid.shape === 'points') {
              point = handle;
              if (!point) {
                point = uid('point'); added = true;
                const group = grid.pointGroups?.some(item => item.id === pointGroup) ? pointGroup : undefined;
                grid = { ...grid, points: [...grid.points ?? [], { id: point, x: Math.round(startWorld.x), y: Math.round(startWorld.y), ...(group ? { group } : {}) }] };
                setGridDraft(grid);
              }
              setGridPoint(point);
            }
            gridGesture.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, startWorld, grid, point, added, moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          } else if (e.button === 0) {
            marqueeGesture.current = { x: e.clientX, y: e.clientY, ids: e.shiftKey ? selected : [] };
            if (!e.shiftKey) { setSelected([]); setSelectedSeatId(undefined); }
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={e => {
          pointer.current = { x: e.clientX, y: e.clientY };
          const edit = gridGesture.current;
          if (edit && edit.pointer === e.pointerId) {
            if (!edit.moved && Math.hypot(e.clientX - edit.x, e.clientY - edit.y) <= 3) return;
            edit.moved = true;
            const at = worldPoint(e.clientX, e.clientY), dx = Math.round(at.x - edit.startWorld.x), dy = Math.round(at.y - edit.startWorld.y);
            setGridDraft(edit.point
              ? { ...edit.grid, points: (edit.grid.points ?? []).map(point => point.id === edit.point ? { ...point, x: point.x + dx, y: point.y + dy } : point) }
              : { ...edit.grid, offsetX: edit.grid.offsetX + dx, offsetY: edit.grid.offsetY + dy });
            return;
          }
          const box = marqueeGesture.current;
          if (box) {
            const rect = boxRect(box.x, box.y, e);
            setMarquee(rect);
            if (rect.width > 3 || rect.height > 3) {
              const ids = topPieces.filter(item => !item.locked && touches(viewport.current?.querySelector(`[data-piece-id="${CSS.escape(item.id)}"]`), rect))
                .flatMap(item => stackMembers(p, item).map(i => i.id));
              // Cards in your own table hand join the box selection too.
              if (actor && p.settings.hands) ids.push(...held.filter(i => !i.locked && touches(viewport.current?.querySelector(`[data-seat-id="${CSS.escape(actor)}"] [data-mini-id="${CSS.escape(i.id)}"]`), rect)).map(i => i.id));
              // Keep pieces already in the box in the order they were caught, so the stacking order follows the sweep.
              const inBox = new Set(ids);
              setSelected([...new Set([...box.ids, ...selected.filter(id => inBox.has(id)), ...ids])]);
            }
            return;
          }
          const g = gesture.current;
          if (!g || g.pointer !== e.pointerId) return;
          if (g.pan) {
            setPan({ x: g.pan.x + cssPx(e.clientX - g.x), y: g.pan.y + cssPx(e.clientY - g.y) });
            if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 3) { setHovered(undefined); setPreviewItem(undefined); }
          }
          else {
            // Taking the top piece off a stack starts once the pointer moves, so a click still selects the stack.
            if (g.extract && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 3) {
              const top = p.instances.find(i => i.id === g.extract);
              g.extract = undefined;
              if (top) {
                g.positions = { [top.id]: { x: top.x, y: top.y } }; g.front = [top.id];
                setSelected([top.id]);
                void dispatch({ type: 'extractMove', id: top.id, x: top.x, y: top.y }).then(ok => {
                  if (!ok && gesture.current === g) { gesture.current = null; setPreview({}); setDropHint(undefined); setHandDrop(undefined); }
                });
              }
            }
            const delta = dragDelta(g, e.clientX, e.clientY);
            setPreview(Object.fromEntries(Object.entries(g.positions).map(([id, pos]) => [id, { x: pos.x + delta.x, y: pos.y + delta.y }])));
            showDropHint(e.clientX, e.clientY, p.instances.filter(i => i.id in g.positions), e.altKey);
          }
        }}
        onPointerUp={endGesture}
        onPointerCancel={() => { gesture.current = null; gridGesture.current = null; setGridDraft(undefined); setPressed(undefined); setHandDrop(undefined); setPreview({}); setDropHint(undefined); marqueeGesture.current = null; setMarquee(undefined); }}>
        <div ref={world} className="table-world" style={{ '--table-zoom': zoom } as React.CSSProperties}>
          <div className="table-watermark" aria-hidden="true"><span><Layers size={34} strokeWidth={1.4} /></span><p>TABLECRAFT</p><small>MAKE SOMETHING WORTH PLAYING</small></div>
          <GridLayers grids={shownGrids} width={TABLE_WIDTH} height={TABLE_HEIGHT} editing={tool === 'grid'} selected={editedGrid?.id} />
          {p.settings.hands && p.players.map(player => {
            const seatSpot = seatPosition?.id === player.id ? seatPosition : player;
            const playerHeld = p.instances.filter(i => i.holder === player.id).sort((a, b) => a.order - b.order);
            const remaining = playerHeld.filter(i => !handDrop?.ids.includes(i.id));
            const canTake = !viewer && (player.id === actor || handPermissions(p, player.id).take);
            return <button key={player.id} data-seat-id={player.id} aria-pressed={selectedSeatId === player.id} title={player.tableHandUnlocked ? `Drag ${player.name}'s seat` : `Select ${player.name}'s seat`} className={`seat-marker ${player.id === actor ? 'active' : ''} ${selectedSeatId === player.id ? 'seat-selected' : ''}`}
            onPointerDown={e => {
              e.stopPropagation(); seatMoved.current = false;
              if (!player.tableHandUnlocked || e.button !== 0 || !canEditSeat(player)) return;
              seatGesture.current = { id: player.id, pointer: e.pointerId, x: e.clientX, y: e.clientY, startX: player.x, startY: player.y, startWorld: worldPoint(e.clientX, e.clientY), rotation: player.rotation };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={e => {
              const g = seatGesture.current;
              if (!g || g.id !== player.id || g.pointer !== e.pointerId) return;
              if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 3) seatMoved.current = true;
              pointer.current = { x: e.clientX, y: e.clientY };
              previewSeat(e.clientX, e.clientY);
            }}
            onPointerUp={e => {
              const g = seatGesture.current;
              if (!g || g.id !== player.id || g.pointer !== e.pointerId) return;
              if (seatMoved.current) {
                const point = worldPoint(e.clientX, e.clientY);
                const moved = { ...player, x: Math.round(g.startX + point.x - g.startWorld.x), y: Math.round(g.startY + point.y - g.startWorld.y), rotation: g.rotation };
                void dispatch({ type: 'player', player: moved });
              }
              seatGesture.current = null; setSeatPosition(undefined);
            }}
            onPointerCancel={() => { seatGesture.current = null; setSeatPosition(undefined); }}
            onClick={() => { if (!seatMoved.current) selectSeat(player); seatMoved.current = false; }}
            style={{ left: seatSpot.x, top: seatSpot.y, '--player-color': player.color, transform: `translate(-50%, -50%) rotate(${seatSpot.rotation}deg)` } as React.CSSProperties}
            onPointerEnter={() => setHoveredSeat(player.id)} onPointerLeave={() => setHoveredSeat(seat => seat === player.id ? undefined : seat)}>
            <div className="seat-badge"><span className="seat-avatar">{player.name.slice(0, 1).toUpperCase()}</span><strong>{player.name}</strong>{player.id === actor && <YouTag />}
            <span>{playerHeld.length} cards</span></div>
            <div className={`other-hand ${canTake ? 'interactive-hand' : ''} ${handDrop?.playerId === player.id ? handDrop.blocked ? 'hand-drop-blocked' : 'hand-drop-target' : ''}`} style={handDrop?.playerId === player.id ? { outlineOffset: 20 / zoom } : undefined} aria-label={`${player.name}'s hand`}>
              {playerHeld.map((i, index) => {
                const comp = p.components.find(c => c.id === i.componentId)!;
                return <div key={i.id} data-mini-id={i.id} data-grabbable={!i.locked && canTake} className={`${player.id === actor && selected.includes(i.id) ? 'hand-selected' : ''} ${handDrop?.playerId === player.id && remaining[handDrop.index]?.id === i.id ? 'mini-insert-before' : ''} ${handDrop?.ids.includes(i.id) || handDrag?.id === i.id ? 'mini-drag-source' : ''}`} style={{ transform: `rotate(${(index - (playerHeld.length - 1) / 2) * 5}deg)` }}
                  onPointerEnter={e => enterPiece(e, i.id)} onPointerLeave={leavePiece}
                  onPointerDown={e => {
                    e.stopPropagation();
                    if (!canTake || i.locked || e.button !== 0) return;
                    handClickSuppressed.current = false;
                    tableHandGesture.current = { pointer: e.pointerId, id: i.id, x: e.clientX, y: e.clientY };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={e => {
                    const g = tableHandGesture.current;
                    if (!g || g.id !== i.id || g.pointer !== e.pointerId || Math.hypot(e.clientX - g.x, e.clientY - g.y) <= 3) return;
                    e.stopPropagation();
                    handClickSuppressed.current = true;
                    setSelected([i.id]);
                    setHandDrag({ id: i.id, x: e.clientX, y: e.clientY });
                    showDropHint(e.clientX, e.clientY, [i], e.altKey);
                  }}
                  onPointerUp={e => {
                    const g = tableHandGesture.current;
                    if (!g || g.id !== i.id || g.pointer !== e.pointerId) return;
                    e.stopPropagation(); tableHandGesture.current = null; setHandDrag(undefined); setDropHint(undefined); setHandDrop(undefined);
                    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) <= 3) return;
                    if (insertIntoTableHand(e.clientX, e.clientY, [i], e.altKey)) return;
                    const tray = handScroller.current?.getBoundingClientRect();
                    // Over a hand it can't go into, the card drops as if the hand weren't there.
                    const bypass = e.altKey;
                    const destination = tray && e.clientX >= tray.left && e.clientX <= tray.right && e.clientY >= tray.top && e.clientY <= tray.bottom ? actor : undefined;
                    if (destination) {
                      if (destination !== i.holder) {
                        void dispatch({ type: 'transferToHand', ids: [i.id], playerId: destination });
                      }
                      return;
                    }
                    const rect = viewport.current?.getBoundingClientRect();
                    if (!rect || e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
                    const point = worldPoint(e.clientX, e.clientY);
                    const slot = !bypass ? slotAt(e.clientX, e.clientY) : undefined;
                    if (slot && fitsSlot(slot, [i]) && i.holder === actor) {
                      void dispatch({ type: 'dropIntoStack', ids: [i.id], stackId: slot.id }).then(ok => { if (ok) setSelected([...p.instances.filter(other => other.stack === slot.id).map(other => other.id), i.id]); });
                      return;
                    }
                    const target = targetAt(e.clientX, e.clientY, [i.id]);
                    if (i.holder === actor) {
                      const stacking = !bypass && target && compatible(target, [i]);
                      void dispatch(stacking
                        ? { type: 'dropFromHand', id: i.id, targetId: target.id, stackId: uid('stack') }
                        : { type: 'release', id: i.id, ...point, snap: true })
                        .then(ok => { if (ok && stacking) setSelected([...stackMembers(p, target).map(other => other.id), i.id]); });
                    } else {
                      void dispatch({ type: 'playVisibleHand', id: i.id, ...point, snap: true,
                        ...(!bypass && target && compatible(target, [i]) ? { targetId: target.id, stackId: uid('stack') } : {}) });
                    }
                  }}
                  onPointerCancel={() => { tableHandGesture.current = null; setHandDrag(undefined); setDropHint(undefined); setHandDrop(undefined); }}
                  onClick={e => { e.stopPropagation(); if (player.id === actor) selectMini(i.id, e); }}>
                  <ComponentThumbnail component={comp} components={p.components} row={i.row} back={i.flipped} hidden={player.id === actor ? !!player.tableHandHidden : comp.hideInHand} width={44} />
                  {handDrop?.playerId === player.id && handDrop.index === remaining.length && remaining.at(-1)?.id === i.id && <span className="mini-insert-end" aria-label="Insert at end of table hand" />}
                </div>;
              })}
              {handTarget?.playerId === player.id && !remaining.length && <span className="mini-insert-end" aria-label="Insert at end of table hand" />}
              {handDrop?.blocked && handDrop.playerId === player.id && <span className="mini-hand-blocked" aria-hidden="true"><Ban size={18} /></span>}
            </div>
          </button>; })}
          {flights.map(flight => {
            const comp = table.components.get(flight.from.componentId);
            return comp ? <DrawFlight key={flight.key} flight={flight} component={comp} components={p.components}
              onDone={() => setFlights(current => current.filter(item => item.key !== flight.key))} /> : null;
          })}
          {emptySlots.map(record => {
            const comp = p.components.find(c => c.id === record.componentId);
            const at = slotPreview?.id === record.id ? slotPreview : record;
            return <button key={`slot:${record.id}`} type="button" data-stack-slot={record.id} aria-pressed={selectedSlot === record.id}
              aria-label={`Empty persistent stack${stackFilterOf(p, record.id).anyOf.length ? `, takes ${describeFilter(stackFilterOf(p, record.id))}` : ''}`} title="Empty persistent stack: drop pieces here to fill it"
              className={`stack-slot${selectedSlot === record.id ? ' selected' : ''}${dropHint?.id === `slot:${record.id}` ? ' drop-target' : ''}`}
              style={{ left: at.x, top: at.y, width: comp?.width ?? 120, height: comp?.height ?? 168, transform: `translate(-50%, -50%) rotate(${record.rotation}deg) scale(${record.scale ?? 1})` }}
              onPointerDown={e => {
                if (e.button !== 0 || tool === 'pan') return;
                e.stopPropagation();
                setSelected([]); setSelectedSeatId(undefined); setSelectedSlot(record.id); setPanel('selection');
                if (viewer) return;
                slotDrag.current = { id: record.id, pointer: e.pointerId, x: e.clientX, y: e.clientY, startWorld: worldPoint(e.clientX, e.clientY), origin: { x: record.x, y: record.y } };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={e => {
                const drag = slotDrag.current;
                if (!drag || drag.pointer !== e.pointerId) return;
                const point = worldPoint(e.clientX, e.clientY);
                let x = drag.origin.x + point.x - drag.startWorld.x, y = drag.origin.y + point.y - drag.startWorld.y;
                const snapped = snapTarget(p, p.components.find(c => c.id === emptySlots.find(record => record.id === drag.id)?.componentId) ?? {}, x, y);
                if (snapped) ({ x, y } = snapped);
                setSlotPreview({ id: drag.id, x, y });
              }}
              onPointerUp={e => {
                const drag = slotDrag.current;
                if (!drag || drag.pointer !== e.pointerId) return;
                slotDrag.current = null;
                const moved = slotPreview?.id === drag.id && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3 ? slotPreview : undefined;
                setSlotPreview(undefined);
                if (moved) void dispatch({ type: 'moveStack', stackId: drag.id, x: moved.x, y: moved.y });
              }}
              onPointerCancel={() => { slotDrag.current = null; setSlotPreview(undefined); }}>
              <Layers size={20} aria-hidden="true" /><span>{stackFilterOf(p, record.id).anyOf.length ? describeFilter(stackFilterOf(p, record.id)) : 'Empty stack'}</span>
            </button>;
          })}
          {topPieces.map(item => {
            const comp = table.components.get(item.componentId)!;
            const count = item.stack ? table.stacks.get(item.stack)!.length : 1;
            const position = preview[item.id] ?? item;
            const isSelected = selected.includes(item.id);
            // Unlocked pieces under the pointer get a light outline; locked ones aren't interactive.
            const isHovered = hovered === item.id && !item.locked && !preview[item.id];
            const badge = plan && isSelected ? plan.units.indexOf(item.stack ?? item.id) : -1;
            return <TablePiece key={item.id} item={item} component={comp} components={p.components} x={position.x} y={position.y} count={count}
              zIndex={comp.kind === 'board' ? 0 : table.order.get(item.id)! + 2} selected={isSelected} dragging={!!preview[item.id]} miniDropSource={!!preview[item.id] && !!handTarget}
              dropTarget={dropHint?.id === item.id && !altDown} rollingRow={rolling[item.id]} shuffling={!!item.stack && shuffling.has(item.stack)} hovered={isHovered}
              persistent={!!item.stack && persistentIds.has(item.stack)} pressed={pressed === item.id}
              pingColor={item.pingedBy ? p.players.find(player => player.id === item.pingedBy)?.color : undefined}
              hiddenLabel={showHidden && item.hiddenFrom?.length ? hiddenText(item.hiddenFrom) : undefined} hiddenFromYou={!!actor && !!item.hiddenFrom?.includes(actor)}
              {...(count > 1 || comp.kind === 'book' || isSelected || (!!item.stack && persistentIds.has(item.stack)) || (showHidden && item.hiddenFrom?.length) ? { labelAngle: item.rotation + camera, compactLabel: Math.min(comp.width, comp.height) * zoom * item.scale < 56 } : {})} pieceZoom={isSelected || isHovered || dropHint?.id === item.id ? zoom * item.scale : undefined}
              badgeIndex={badge} badgeTotal={plan?.units.length ?? 0} badgeError={plan?.error} events={pieceEvents} />;
          })}
          {editedGrid?.shape === 'points' && <GridPointHandles grid={editedGrid} color={gridColor(editedGrid, shownGrids.indexOf(editedGrid))} selected={gridPoint} width={TABLE_WIDTH} height={TABLE_HEIGHT}
            highlighted={pointGroup ? (editedGrid.points ?? []).filter(point => pointGroupAncestors(editedGrid.pointGroups ?? [], point.group).includes(pointGroup)).map(point => point.id) : undefined} />}
        </div>
        <PingPins viewport={viewport} pins={pins} onFocus={ids => { focusOn(ids); }} />
        <div className="floating-tools" onPointerDown={e => e.stopPropagation()}>
          <button className={tool === 'select' ? 'active' : ''} title="Select & move" aria-label="Select and move" onClick={() => setTool('select')}><MousePointer2 size={19} /></button>
          <button className={tool === 'pan' ? 'active' : ''} title="Pan table" aria-label="Pan table" onClick={() => setTool('pan')}><Hand size={19} /></button>
          <span /><button className={tool === 'grid' ? 'active' : ''} aria-pressed={tool === 'grid'} title="Grids: add and edit grids and snap points" aria-label="Grid tool"
            onClick={() => { if (tool === 'grid') setTool('select'); else { setTool('grid'); onShowInspector(); } }}><Grid2X2 size={18} /></button>
        </div>
        {(plan?.error || notice) && <div className="table-warnings" onPointerDown={e => e.stopPropagation()}>
          {notice && <div className="warning-card undo-toast" role="status" title="Click to dismiss" onClick={onDismissNotice}>
            <Undo2 size={18} /><span><strong>{noticeTitle(notice)}</strong><small>{noticeDetail(notice)}</small></span>
            <button type="button" className="icon-button notice-close" aria-label="Dismiss notification" onClick={e => { e.stopPropagation(); onDismissNotice?.(); }}><X size={14} /></button>
          </div>}
          {plan?.error && <div className="warning-card stack-order-warning" role="status">
            <StackSlotIcon blocked /><span><strong>Pieces can't be stacked</strong><small>{plan.error}</small></span>
          </div>}
        </div>}
        {p.settings.turns && turnPlayer && <div className="turn-pill" role="status" aria-label="Turn" onPointerDown={e => e.stopPropagation()}>
          <span className="turn-pill-avatar" style={{ background: turnPlayer.color }}>{turnPlayer.name.slice(0, 1).toUpperCase()}</span>
          <span className="turn-pill-name"><span className="turn-pill-label"><strong>{turnPlayer.name}</strong>'s turn</span>{turnPlayer.id === actor && <YouTag />}</span>
          <button className="button primary" title={`Pass the turn to ${nextTurnPlayer?.name}`} disabled={viewer} onClick={endTurn}>End turn <ChevronRight size={13} /></button>
        </div>}
        <div className="zoom-control" onPointerDown={e => e.stopPropagation()}><button aria-label="Rotate camera left" onClick={() => rotateCamera(-90)}>↶</button><button aria-label="Rotate camera right" onClick={() => rotateCamera(90)}>↷</button><button aria-label="Zoom out" onClick={() => changeZoom(zoom - .1)}><Minus size={14} /></button><ZoomPresets levels={[.25, .5, .75, 1, 1.5, 2, 3]} zoom={zoom} onSelect={level => changeZoom(level)}><button title="Fit table" aria-label="Fit table" onClick={fit}><Maximize size={14} /><ZoomPercent zoom={zoom} /></button></ZoomPresets><button aria-label="Zoom in" onClick={() => changeZoom(zoom + .1)}><Plus size={14} /></button></div>
        {activePreviewId && !altDown && !fullscreenItem && (() => {
          const item = p.instances.find(i => i.id === activePreviewId && (!i.locked || !!p.components.find(c => c.id === i.componentId)?.previewWhenLocked) && (!i.holder || i.holder === actor));
          const comp = p.components.find(c => c.id === item?.componentId);
          const count = item && !item.holder ? stackMembers(p, item).length : 1;
          return item && comp ? <div className="hover-preview" style={{ width: hoverPreviewWidth(previewScale), ...(previewOnLeft ? { left: 16, right: 'auto' } : {}) }} aria-label={`Preview ${comp.name}`} onPointerDown={e => e.stopPropagation()}
            onPointerLeave={() => setPreviewItem(undefined)} onWheel={e => {
            if (e.ctrlKey) { e.preventDefault(); e.stopPropagation(); setPreviewScale(scale => Math.max(.5, Math.min(3, scale * (e.deltaY > 0 ? .9 : 1.1)))); }
          }}><ComponentThumbnail component={comp} components={p.components} row={item.row} back={visibleBack(item)} width={160 * previewScale} /><strong>{comp.name}{count > 1 && <span className="preview-stack-count" aria-label={`Stack of ${count}`}><Layers size={11} /> {count}</span>}{comp.kind === 'book' && <span className="preview-stack-count" aria-label={`Page ${item.row + 1} of ${Math.max(1, comp.rows.length)}`}><BookOpen size={11} /> {item.row + 1} / {Math.max(1, comp.rows.length)}</span>}</strong>
            <table className="preview-shortcuts" aria-label="Piece shortcuts"><tbody>
              <tr><th scope="row">Flip</th><td><kbd>F</kbd></td></tr>
              <tr><th scope="row">Rotate −{comp.rotationStep ?? 90}° / +{comp.rotationStep ?? 90}°</th><td><kbd>Q / E</kbd></td></tr>
              {hasPages(comp) && <tr><th scope="row">{comp.kind === 'book' ? 'Previous / next page' : 'Previous / next face'}</th><td><kbd>Shift Q / E</kbd></td></tr>}
              <tr><th scope="row">Shuffle / roll</th><td><kbd>R</kbd></td></tr>
              <tr><th scope="row">Stack selection</th><td><kbd>G</kbd></td></tr>
              <tr><th scope="row">Draw cards</th><td><kbd>1–0</kbd></td></tr>
              <tr><th scope="row">Lock / unlock</th><td><kbd>L</kbd></td></tr>
              <tr><th scope="row">Ping for everyone</th><td><kbd>P</kbd></td></tr>
              <tr><th scope="row">Fullscreen preview</th><td><kbd>Z</kbd></td></tr>
              <tr><th scope="row">Hide this preview</th><td><kbd>Alt</kbd></td></tr>
            </tbody></table></div> : null;
        })()}
      </div>
      {p.settings.hands && handVisible && !viewer && currentPlayer && <><PanelSeparator label="Resize hand tray" controls="hand-tray-panel" value={panels.sizes.hand} {...panels.limits.hand} orientation="horizontal" direction={-1} onResize={value => panels.resize('hand', value)} /><div id="hand-tray-panel" className="hand-tray" style={{ height: panels.sizes.hand, minHeight: 0, flex: `0 0 ${panels.sizes.hand}px` }} aria-label={`${currentPlayer.name}'s hand tray`}
        onPointerDown={e => {
          // Box selection in the tray selects hand cards only; Shift/Ctrl/Cmd adds to the current hand selection.
          if (e.button !== 0 || (e.target as Element).closest('button,[data-hand-id]')) return;
          const ids = e.shiftKey || e.ctrlKey || e.metaKey ? selected.filter(id => held.some(i => i.id === id)) : [];
          handMarquee.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, ids };
          handSelectionAnchor.current = undefined;
          setSelected(ids);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={e => {
          const box = handMarquee.current;
          if (!box || box.pointer !== e.pointerId) return;
          const rect = boxRect(box.x, box.y, e);
          setMarquee(rect);
          if (rect.width <= 3 && rect.height <= 3) return;
          const ids = held.filter(i => touches(e.currentTarget.querySelector(`[data-hand-id="${CSS.escape(i.id)}"]`), rect)).map(i => i.id);
          setSelected([...new Set([...box.ids, ...ids])]);
        }}
        onPointerUp={e => { if (handMarquee.current?.pointer === e.pointerId) { handMarquee.current = null; setMarquee(undefined); } }}
        onPointerCancel={() => { handMarquee.current = null; setMarquee(undefined); }}>
        <HorizontalScroll target={handScroller} contentClassName="hand-cards" className="hand-cards-scroll" label="Hand cards">{held.length ? held.map(item => {
         const comp = p.components.find(c => c.id === item.componentId)!;
          const draggingIds = handDrag ? selected.includes(handDrag.id) ? selected : [handDrag.id] : [];
          const remaining = held.filter(i => !draggingIds.includes(i.id));
          return <div key={item.id} className={`hand-entry ${draggingIds.includes(item.id) ? 'hand-drag-source' : ''} ${insertion !== undefined && remaining[insertion]?.id === item.id ? 'hand-insert-before' : ''}`}><button data-hand-id={item.id} aria-pressed={selected.includes(item.id)} className={`hand-card ${selected.includes(item.id) ? 'hand-selected' : ''}`} title="Drag onto the table to play or onto another card to reorder" aria-label={`Drag ${comp.name} to the table or reorder it in hand`} onClick={e => selectHandCard(item.id, e)} onPointerEnter={e => enterPiece(e, item.id)} onPointerLeave={leavePiece} onFocus={() => { setHovered(item.id); setPreviewItem(item.id); }} onBlur={() => { setHovered(undefined); setPreviewItem(undefined); }} onPointerDown={e => {
            if (e.button !== 0) return;
            handClickSuppressed.current = false;
            handGesture.current = { pointer: e.pointerId, id: item.id, x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }} onPointerMove={e => {
            const g = handGesture.current;
            if (g && g.pointer === e.pointerId && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 3) {
              handClickSuppressed.current = true;
              if (!selected.includes(item.id)) { setSelected([item.id]); handSelectionAnchor.current = item.id; }
              setHandDrag({ id: item.id, x: e.clientX, y: e.clientY });
              setInsertion(handInsertion(e.clientX, e.clientY, selected.includes(item.id) ? held.filter(i => selected.includes(i.id)).map(i => i.id) : [item.id]));
              showDropHint(e.clientX, e.clientY, selected.includes(item.id) ? held.filter(i => selected.includes(i.id)) : [item], e.altKey);
            }
          }} onPointerCancel={() => { handGesture.current = null; setHandDrag(undefined); setInsertion(undefined); setDropHint(undefined); setHandDrop(undefined); }} onPointerUp={e => {
            const g = handGesture.current;
            if (!g || g.pointer !== e.pointerId) return;
            handGesture.current = null; setHandDrag(undefined); setInsertion(undefined); setDropHint(undefined); setHandDrop(undefined);
            if (Math.hypot(e.clientX - g.x, e.clientY - g.y) <= 3) return;
            const moving = selected.includes(item.id) ? held.filter(i => selected.includes(i.id)) : [item];
            const movingIds = moving.map(i => i.id);
            if (insertIntoTableHand(e.clientX, e.clientY, moving, e.altKey)) return;
            // Over a hand they can't go into, the cards drop as if the hand weren't there.
            const bypass = e.altKey;
            const index = handInsertion(e.clientX, e.clientY, movingIds);
            if (index !== undefined) {
              const ids = held.filter(i => !movingIds.includes(i.id)).map(i => i.id);
              ids.splice(index, 0, ...movingIds);
              dispatch({ type: 'reorderHand', ids, playerId: actor });
            } else {
              const rect = viewport.current?.getBoundingClientRect();
              if (!rect || e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
              const { x, y } = worldPoint(e.clientX, e.clientY);
              const slot = !bypass ? slotAt(e.clientX, e.clientY) : undefined;
              const target = targetAt(e.clientX, e.clientY, []);
              // Like table drags, dropping onto a stack selects the whole stack it lands in.
              if (slot && fitsSlot(slot, moving)) void dispatch({ type: 'dropIntoStack', ids: movingIds, stackId: slot.id }).then(ok => { if (ok) setSelected([...p.instances.filter(i => i.stack === slot.id).map(i => i.id), ...movingIds]); });
              else if (!bypass && target && compatible(target, moving)) void dispatch({ type: 'dropManyFromHand', ids: movingIds, targetId: target.id, stackId: uid('stack') })
                .then(ok => { if (ok) setSelected([...stackMembers(p, target).map(i => i.id), ...movingIds]); });
              else dispatch({ type: 'releaseMany', ids: moving.map(i => i.id), x, y, snap: true });
            }
          }} onDoubleClick={e => { e.stopPropagation(); if (comp.flippable) void dispatch({ type: 'transform', ids: [item.id], flip: true }); }}
            onKeyDown={e => {
              if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
              const ids = held.map(i => i.id), index = ids.indexOf(item.id), offset = e.key === 'ArrowLeft' ? -1 : 1;
              if (index + offset < 0 || index + offset >= ids.length) return;
              e.preventDefault(); e.stopPropagation();
              [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
              dispatch({ type: 'reorderHand', ids, playerId: actor });
            }}>
            <ComponentThumbnail component={comp} components={p.components} row={item.row} back={item.flipped} height={handCardHeight} /><span>Drag to play</span></button></div>;
        }) : <div className="empty-hand"><Copy size={20} /><span>Drag pieces here to take them into your hand.</span></div>}
        {insertion !== undefined && insertion === held.filter(i => !(handDrag && (selected.includes(handDrag.id) ? selected.includes(i.id) : i.id === handDrag.id))).length && <div className="hand-insert-end" aria-label="Insert at end of hand" />}
        </HorizontalScroll>
      </div><HorizontalScroll contentClassName="hand-toolbar" label="Hand actions">{handActions()}</HorizontalScroll></>}
      {handDrag && !handTarget && (() => {
        const item = p.instances.find(i => i.id === handDrag.id);
        const comp = p.components.find(c => c.id === item?.componentId);
        return item && comp ? <div className="hand-drag-preview" style={{ left: cssPx(handDrag.x), top: cssPx(handDrag.y) }} aria-hidden="true"><ComponentThumbnail component={comp} components={p.components} row={item.row} back={item.flipped} hidden={!!item.holder && item.holder !== actor && comp.hideInHand} height={handCardHeight} /></div> : null;
      })()}
      <footer className="table-status"><span>{p.instances.length} pieces on the table</span><span>{snappingGrids ? `Snapping to ${snappingGrids === 1 ? grids.find(grid => grid.snap)!.name : `${snappingGrids} grids`}` : 'Free movement'}<span className="status-divider">/</span>{p.players.length} players<span className="status-divider">/</span>2D playground</span></footer>
    </section>
    {createPortal(<>
      {handTarget && (() => {
        const handDrop = handTarget;
        const item = p.instances.find(i => i.id === handDrop.ids[0]);
        const comp = p.components.find(c => c.id === item?.componentId);
        const player = p.players.find(player => player.id === handDrop.playerId);
        if (!item || !comp || !player) return null;
        return <div className="hand-drag-preview mini-drop-preview" aria-hidden="true" style={{ left: cssPx(handDrop.x), top: cssPx(handDrop.y), transform: `translate(-50%, -50%) rotate(${camera + player.rotation}deg) scale(${zoom})` }}>
          <ComponentThumbnail component={comp} components={p.components} row={item.row} back={visibleBack(item)} hidden={player.id === actor ? !!player.tableHandHidden : comp.hideInHand} width={44} />
          {handDrop.ids.length > 1 && <span className="mini-drop-count">{handDrop.ids.length}</span>}
        </div>;
      })()}
      {topPieces.filter(i => preview[i.id] && !handTarget).map(item => {
        const comp = table.components.get(item.componentId)!;
        const rect = viewport.current!.getBoundingClientRect();
        const angle = camera * Math.PI / 180;
        // Page CSS pixels: the overlay is portaled into the (possibly interface-scaled) page.
        const screen = (position: { x: number; y: number }) => ({
          x: cssPx(rect.left) + pan.x + zoom * (position.x * Math.cos(angle) - position.y * Math.sin(angle)),
          y: cssPx(rect.top) + pan.y + zoom * (position.x * Math.sin(angle) + position.y * Math.cos(angle)),
        });
        const anchor = screen(item), current = screen(preview[item.id]);
        return <DragOverlay key={item.stack ?? item.id} item={item} component={comp} components={p.components} left={anchor.x} top={anchor.y}
          dx={current.x - anchor.x} dy={current.y - anchor.y} rotation={camera + item.rotation} scale={zoom * item.scale} />;
      })}
      {marquee && <div className="selection-marquee" style={{ left: cssPx(marquee.x), top: cssPx(marquee.y), width: cssPx(marquee.width), height: cssPx(marquee.height) }} />}
      {handDrop && !(handDrop.blocked && dropHint) && <div className={`stack-drop-hint hand-drop-hint${handDrop.blocked ? ' hand-drop-blocked-hint' : ''}`} role="status" style={{ left: Math.min(cssPx(handDrop.x) + 18, cssPx(window.innerWidth) - 285), top: Math.max(12, cssPx(handDrop.y) - 62) }}>
        <strong>{handDrop.blocked ? `Can't go into ${p.players.find(player => player.id === handDrop.playerId)?.name ?? 'this'}'s hand` : 'Release to insert into hand'}</strong>
        <span>{handDrop.blocked ? `${handDrop.blocked} Release to drop it on the table.` : `Position ${handDrop.index + 1} · Hold Alt to place on table instead`}</span>
      </div>}
      {dropHint && <div className={`stack-drop-hint ${altDown ? 'stack-bypassed' : ''}`} role="status" style={{ left: Math.min(cssPx(dropHint.x) + 18, cssPx(window.innerWidth) - 285), top: Math.max(12, cssPx(dropHint.y) - 62) }}>
        <strong>{altDown ? 'Stacking off — release to move' : 'Release to add to stack'}</strong>
        <span>{altDown ? 'Release Alt to stack instead' : 'Hold Alt to move without stacking'}</span>
      </div>}
    </>, document.body)}
    {inspectorVisible && <PanelSeparator label="Resize table inspector" controls="playground-inspector-panel" value={panels.sizes.playgroundInspector} {...panels.limits.playgroundInspector} direction={-1} onResize={value => panels.resize('playgroundInspector', value)} />}
    <aside id="playground-inspector-panel" className="inspector playground-inspector" style={{ width: panels.sizes.playgroundInspector, minWidth: 0, flex: `0 0 ${panels.sizes.playgroundInspector}px` }} hidden={!inspectorVisible}>
      {tool === 'grid' ? <div className="inspector-scroll"><GridEditor grids={shownGrids} selected={editedGrid} onSelect={setGridId} point={gridPoint} onSelectPoint={setGridPoint}
        dispatch={dispatch} disabled={viewer} tags={gridTags} onDone={() => setTool('select')} /></div> : <>
      <HorizontalScroll contentClassName="inspector-tabs" label="Table inspector tabs"><button className={panel === 'selection' ? 'active' : ''} onClick={() => setPanel('selection')}><MousePointer2 size={14} /> Selection</button><button className={panel === 'table' ? 'active' : ''} onClick={() => setPanel('table')}><Settings2 size={14} /> Table</button><button className={panel === 'players' ? 'active' : ''} onClick={() => setPanel('players')}><Users size={14} /> Players <span>{p.players.length}</span></button></HorizontalScroll>
      <div className="inspector-scroll">{panel === 'players' ? <>
        <div className="inspector-section"><div className="section-title"><h3>Around the table</h3><span className="pill">{online ? viewer ? 'Watching' : 'Live' : 'Hotseat'}</span></div>
          <p className="help-text">{online ? viewer ? 'You are watching. Pick an empty seat to start playing.' : 'Switch to any empty seat, or leave yours to watch.' : 'No fixed player limit. Add seats for everyone sharing this screen.'}</p>
          <div className="player-list">{p.players.map((player, index) => <div key={player.id} data-player-row={player.id}
            className={`player-row ${actor === player.id ? 'active' : ''}${playerDrag === player.id ? ' player-dragging' : ''}${playerDrop?.id === player.id ? ` player-drop-${playerDrop.position}` : ''}`}
            onDragOver={e => {
              if (!playerDrag || playerDrag === player.id) return;
              e.preventDefault(); e.dataTransfer.dropEffect = 'move';
              const rect = e.currentTarget.getBoundingClientRect();
              setPlayerDrop({ id: player.id, position: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after' });
            }}
            onDragLeave={e => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setPlayerDrop(undefined); }}
            onDrop={e => {
              if (!playerDrag) return;
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              movePlayer(playerDrag, player.id, e.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
              setPlayerDrag(undefined); setPlayerDrop(undefined);
            }}>
            <button className="icon-button player-reorder" draggable aria-label={`Reorder ${player.name}`} title="Drag to reorder; use Up/Down arrows when focused"
              onDragStart={e => { e.dataTransfer.setData('text/plain', player.id); e.dataTransfer.effectAllowed = 'move'; setPlayerDrag(player.id); }}
              onDragEnd={() => { setPlayerDrag(undefined); setPlayerDrop(undefined); }}
              onKeyDown={e => {
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                e.preventDefault();
                const target = p.players[index + (e.key === 'ArrowUp' ? -1 : 1)];
                if (target) movePlayer(player.id, target.id, e.key === 'ArrowUp' ? 'before' : 'after');
              }}><GripVertical size={14} /></button>
            <button onClick={() => onSwitch(player)}><span className="mini-avatar" style={{ background: player.color }}>{player.name[0]}</span><span><span className="player-row-name">{player.name}{actor === player.id && <YouTag />}</span><small>{p.settings.turns && turnPlayer?.id === player.id ? 'Current turn · ' : ''}{seatStatus(player)}</small></span></button>
            {canEditSeat(player) && <button className={`icon-button${seatOverride(player) ? ' host-override' : ''}`} title={seatOverride(player) ? `Edit ${player.name} (${seatOverride(player)} override)` : `Edit ${player.name}`} aria-label={`Edit ${player.name}`} onClick={() => selectSeat(player)}><Settings2 size={14} /></button>}
          </div>)}</div>
          {(!viewer || host) && <button className="button full" onClick={() => {
            const first = !online && !p.players.length;
            setSeatEditor({ id: uid('player'), owner: online ? '' : owner, name: (first && defaultSeat?.name) || `Player ${p.players.length + 1}`,
              color: first && defaultSeat ? defaultSeat.color : ['#b7cc91', '#ce9e7b', '#93b9ce', '#c4a4d5'][p.players.length % 4], ...nextSeatPlacement(p.players) });
          }}><Plus size={15} /> {online ? 'Add empty seat' : 'Add hotseat player'}</button>}
          {online && (viewer ? onNewSeat && <button className="button full primary" onClick={onNewSeat}><Plus size={15} /> Take a new seat</button>
            : onWatch && <button className="button full" onClick={onWatch}><Eye size={15} /> Leave seat and watch</button>)}
        </div>
      </> : panel === 'selection' ? <>
        {selectedSeat ? <SeatInspector key={selectedSeat.id} player={selectedSeat} active={selectedSeat.id === actor} nameLocked={online && !!selectedSeat.owner} editable={canEditSeat(selectedSeat)} override={seatOverride(selectedSeat)}
          held={p.instances.filter(i => i.holder === selectedSeat.id).length}
          onChange={patch => dispatch({ type: 'player', player: { ...selectedSeat, ...patch } })}
          onClose={() => setSelectedSeatId(undefined)}
          onRemove={() => setRemovingSeat(selectedSeat)}
          actions={<div className="seat-hand-actions" role="toolbar" aria-label={`${selectedSeat.name}'s hand actions`}>{handActions(selectedSeat)}</div>} /> :
        piece && c ? <div className="inspector-section selected-inspector"><div className="section-title"><h3>{items.length > 1 ? 'Stack selected' : `${selected.length > 1 ? selected.length + ' pieces' : 'Component'} selected`}</h3><button className="icon-button" title="Deselect" onClick={() => setSelected([])}><X size={14} /></button></div>
          <div className="selected-component"><ComponentThumbnail component={c} components={p.components} row={piece.row} width={52} /><div><strong>{selected.length > 1 ? `${selected.length} pieces selected` : c.name}</strong><small>{items.length > 1 ? `${items.length} in stack` : c.kind}</small><button className="text-button" onClick={() => onEdit(c.id)}>Edit design <ChevronRight size={12} /></button></div></div>
          {viewer ? <div className="viewer-inspect">
            <p className="viewer-note" role="note"><Eye size={14} /> You are watching. Inspect freely; take a seat in Players to move or change pieces.</p>
            <div className="stack-actions"><button className="button" onClick={focusSelection} disabled={selectedPieces.every(i => i.holder)}><Focus size={14} /> Focus</button>
              {items.length > 1 && <button className="button" onClick={() => { setSearch(items.map(i => i.id)); setQuery(''); }}><Search size={14} /> Search stack</button>}</div>
          </div> : <>
          {hasPages(c) && <p className="page-status" role="status">{c.kind === 'book' ? 'Page' : 'Face'} {piece.row + 1} of {Math.max(1, c.rows.length)}</p>}
          {/* Rotation first, then what this piece or stack can do, then the general actions. Actions that don't apply are left out. */}
          <div className="action-grid">
            <button onClick={() => rotate(-1)}><RotateCcw size={17} /><span>{selectionStep ? `Rotate −${selectionStep}°` : 'Rotate back'}<kbd>Q</kbd></span></button>
            <button onClick={() => rotate(1)}><RotateCw size={17} /><span>{selectionStep ? `Rotate +${selectionStep}°` : 'Rotate on'}<kbd>E</kbd></span></button>
            {c.action && <button title={`Run the script function ${c.action} for everyone`} onClick={() => runAction(piece)}><CirclePlay size={17} /><span>{c.kind === 'button' ? 'Press' : 'Run'} {c.action}</span></button>}
            {selectedPieces.some(i => p.components.find(c => c.id === i.componentId)?.flippable) && <button onClick={flip}><FlipHorizontal2 size={17} /><span>Flip<kbd>F</kbd></span></button>}
            {hasPages(c) && <>
              <button disabled={c.kind === 'book' && piece.row <= 0} onClick={() => turnPages(-1)}><ChevronLeft size={17} /><span>{c.kind === 'book' ? 'Previous page' : 'Previous face'}<kbd>Shift Q</kbd></span></button>
              <button disabled={c.kind === 'book' && piece.row >= c.rows.length - 1} onClick={() => turnPages(1)}><ChevronRight size={17} /><span>{c.kind === 'book' ? 'Next page' : 'Next face'}<kbd>Shift E</kbd></span></button>
            </>}
            {c.kind === 'dice' && <button onClick={() => dispatch({ type: 'roll', ids: [piece.id], seed: crypto.getRandomValues(new Uint32Array(1))[0] })}><Dices size={17} /><span>Roll die<kbd>R</kbd></span></button>}
            {selected.length > 1 && !wholeStack && <button disabled={!!plan?.error} title={plan?.error ? `Can't stack: ${plan.error}` : plan ? 'The first selected piece goes on the bottom, the last on top' : undefined} onClick={() => dispatch({ type: 'stack', ids: selected, stackId: uid('stack') })}><Layers size={17} /><span>Stack selected pieces<kbd>G</kbd></span></button>}
            {items.length > 1 && <>
              <button onClick={() => { setSearch(items.map(i => i.id)); setQuery(''); }}><Search size={17} /><span>Search stack</span></button>
              <button disabled={!items.every(i => p.components.find(c => c.id === i.componentId)?.shufflable)} onClick={() => { void dispatch({ type: 'shuffle', id: piece.id, seed: crypto.getRandomValues(new Uint32Array(1))[0] }).then(success => { if (success) notify('A fresh shuffle. A new possibility.'); }); }}><Shuffle size={17} /><span>Shuffle<kbd>R</kbd></span></button>
              <button onClick={() => dispatch({ type: 'unstack', id: piece.id })}><Layers size={17} /><span>Spread stack</span></button>
            </>}
            {canPersist && <button title="Keep this stack on the table even with one piece or none; players can drop pieces into it" onClick={() => dispatch({ type: 'persistStack', ids: selected, stackId: uid('stack') })}><Pin size={17} /><span>Make a persistent stack</span></button>}
            {pieceStack && inPieceStack && !viewer && <button title="Let this stack go when it's down to one piece" onClick={() => dispatch({ type: 'unpersistStack', stackId: pieceStack.id })}><PinOff size={17} /><span>Make an ordinary stack</span></button>}
            <button onClick={() => clone()}><Copy size={17} /><span>Clone<kbd>Ctrl D</kbd></span></button>
            <button onClick={focusSelection} disabled={selectedPieces.every(i => i.holder)}><Focus size={17} /><span>Focus<kbd>Shift F</kbd></span></button>
            <button title="Highlight these pieces for every player" onClick={() => void dispatch({ type: 'ping', ids: selected })}><Radar size={17} /><span>Ping<kbd>P</kbd></span></button>
            {p.settings.hands && <>
            {wholeStack ? <>
              <button onClick={() => { const rest = items.filter(i => i.id !== stackTop?.id).map(i => i.id); void dispatch({ type: 'draw', id: piece.id, playerId: actor }).then(ok => { if (ok) setSelected(rest); }); }} disabled={!p.settings.hands || !!stackTop?.holder || !p.components.find(c => c.id === stackTop?.componentId)?.hand}><Hand size={17} /><span>Draw one<kbd>1</kbd></span></button>
              <button onClick={() => dispatch({ type: 'drawSelection', ids: selected, playerId: actor })} disabled={!canDrawSelection}><Layers size={17} /><span>Draw all</span></button>
            </> : <button onClick={() => dispatch({ type: 'drawSelection', ids: selected, playerId: actor })} disabled={!canDrawSelection}><Hand size={17} /><span>Draw to hand{selected.length === 1 && <kbd>1</kbd>}</span></button>}
            </>}
            <button onClick={() => dispatch({ type: 'zOrder', ids: selected, move: 'forward' })} disabled={selectedPieces.every(i => i.holder)} title="Bring forward (Ctrl/Cmd+]; with Shift, to the front)"><BringToFront size={17} /><span>Bring forward<kbd>Ctrl ]</kbd></span></button>
            <button onClick={() => dispatch({ type: 'zOrder', ids: selected, move: 'backward' })} disabled={selectedPieces.every(i => i.holder)} title="Send backward (Ctrl/Cmd+[; with Shift, to the back)"><SendToBack size={17} /><span>Send backward<kbd>Ctrl [</kbd></span></button>
            <button onClick={() => dispatch({ type: 'move', ids: selected, patch: { locked: !ownLock(piece.id) } })}>{ownLock(piece.id) ? <UnlockKeyhole size={17} /> : <LockKeyhole size={17} />}<span>{ownLock(piece.id) ? 'Unlock' : 'Lock'}<kbd>L</kbd></span></button>
            <button className="danger" onClick={() => { dispatch({ type: 'delete', ids: selected }); setSelected([]); }}><Trash2 size={17} /><span>Delete<kbd>Del</kbd></span></button>
          </div>
          {piece.locked && !ownLock(piece.id) && <p className="help-text">Held in place by its locked group. Unlock the group in the Pieces panel to move it.</p>}
          {tablePieces.length > 0 && p.players.length > 0 && <div className="field hidden-from" role="group" aria-label="Hidden from">
            <span>Hidden from<InfoTip text="These seats don't see the selected pieces on the table (with their whole stacks). Like hidden hands this is visual privacy: every player's browser still receives the whole table. Show hidden pieces from Visibility in the header." /></span>
            <div className="hidden-from-seats">{p.players.map(player => <button key={player.id} type="button" className={`hidden-seat${hiddenFrom.includes(player.id) ? ' hidden' : ''}`} aria-pressed={hiddenFrom.includes(player.id)} disabled={viewer}
              title={`${hiddenFrom.includes(player.id) ? 'Show to' : 'Hide from'} ${player.name}`} onClick={() => toggleHidden(player.id)}>
              <span className="mini-avatar" style={{ background: player.color }}>{player.name[0]}</span>{player.name}{player.id === actor && ' (you)'}{hiddenFrom.includes(player.id) && <EyeOff size={12} />}</button>)}</div>
          </div>}
          {selectionStack && <TagFilterEditor label="Stack filter" filter={stackFilterOf(p, selectionStack)} suggestions={stackTags} disabled={viewer}
            hint="Which pieces may join this stack, by their components' stack tags (Behavior tab). A new stack takes every tag its pieces share."
            onChange={filter => void dispatch({ type: 'setStackFilter', stackId: selectionStack, filter })} />}
          <div className="field-grid">
            <NumberField deferred label="Rotation" value={piece.rotation} mixed={selectedPieces.some(i => i.rotation !== piece.rotation)}
              onChange={rotation => dispatch({ type: 'move', ids: selectedPieces.map(i => i.id), patch: { rotation: ((rotation % 360) + 360) % 360 } })} />
            <NumberField deferred label="Scale" value={piece.scale} mixed={selectedPieces.some(i => i.scale !== piece.scale)} min={.1} max={5} step={.1}
              onChange={scale => dispatch({ type: 'move', ids: selectedPieces.map(i => i.id), patch: { scale } })} />
          </div>
          </>}
        </div> : slotRecord ? <div className="inspector-section selected-inspector">
          <div className="section-title"><h3>Empty persistent stack</h3><button className="icon-button" aria-label="Clear selection" onClick={() => setSelectedSlot(undefined)}><X size={15} /></button></div>
          <p className="help-text">Drop pieces here to fill it. Drag it to move it.</p>
          <TagFilterEditor label="Stack filter" filter={stackFilterOf(p, slotRecord.id)} suggestions={stackTags} disabled={viewer}
            hint="Which pieces may join this stack, by their components' stack tags (Behavior tab)."
            onChange={filter => void dispatch({ type: 'setStackFilter', stackId: slotRecord.id, filter })} />
          {!viewer && <div className="action-grid"><button className="danger" onClick={() => { void dispatch({ type: 'unpersistStack', stackId: slotRecord.id }); setSelectedSlot(undefined); }}><Trash2 size={17} /><span>Remove stack</span></button></div>}
        </div> : <div className="inspector-section table-intro"><div className="intro-icon"><MousePointer2 size={23} /></div><h3>No component selected</h3><p>Select a component on the table or in your hand to see its settings and actions.</p></div>}
      </> : <>
        <fieldset className="inspector-section table-settings" disabled={viewer}><div className="section-title"><h3>Table settings</h3><Settings2 size={14} /></div>
          <div className="grid-summary"><span>{grids.length ? `${grids.length} ${grids.length === 1 ? 'grid' : 'grids'}: ${grids.map(grid => grid.name).join(', ')}` : 'No grids'}<small>{snappingGrids ? `${snappingGrids} snapping` : 'Pieces move freely'}</small></span>
            <button type="button" className="button" onClick={() => { setTool('grid'); onShowInspector(); }}><Grid2X2 size={14} /> Edit grids</button></div>
          <Toggle label="Player hands" description="Keep a little mystery" checked={p.settings.hands} onChange={hands => dispatch({ type: 'settings', patch: { hands } })} />
          <Toggle label="Turn tracker" checked={p.settings.turns} onChange={turns => dispatch({ type: 'settings', patch: { turns } })} />
          {online && <Toggle label="Players can edit scripts" description={host ? 'Otherwise only you, the host, can change scripts' : 'Only the host can change this'} checked={!!p.settings.scriptEditing} disabled={!host}
            onChange={scriptEditing => dispatch({ type: 'settings', patch: { scriptEditing } })} />}
          {scriptsMention(p.scripts, 'update') && <NumberField deferred label="Script update every (s)" hint="How often the scripts' update(dt) runs while players are at the table." value={p.settings.updateInterval ?? 1} min={.1} max={3600} step={.1}
            onChange={updateInterval => dispatch({ type: 'settings', patch: { updateInterval } })} />}
          {p.settings.turns && <div className="turn-tracker"><span>UP NEXT</span><strong>{turnPlayer?.name ?? 'Add a player'}</strong><button className="button full primary" onClick={endTurn}>End turn <ChevronRight size={15} /></button></div>}
        </fieldset>
        <div className="inspector-section"><div className="section-title"><h3>Around the table</h3><button className="text-button" onClick={() => setPanel('players')}>Manage</button></div>
          <div className="avatar-stack">{p.players.slice(0, 7).map(player => <button key={player.id} title={player.name} onClick={() => onSwitch(player)} style={{ background: player.color }}>{player.name[0]}</button>)}<button className="add-avatar" aria-label="Manage players" onClick={() => setPanel('players')}><Plus size={14} /></button></div>
          <p className="help-text">{p.players.length} players. One shared imagination.</p>
        </div>
        <div className="table-tip"><span>MADE FOR THE MESSY MIDDLE</span><p>Try a rule. Break a rule.<br />Make something worth playing.</p><span className="tip-sparkle">✳</span></div>
      </>}</div></>}
    </aside>
    {search && <Modal title="Inside the stack" subtitle="Search, draw a specific card, or reorder from bottom to top." wide onClose={() => setSearch(undefined)}>
      <div className="stack-search"><div className="search-input"><Search size={16} /><input placeholder="Find a component..." value={query} onChange={e => setQuery(e.target.value)} /></div>
        <div className="stack-search-list">{!searchedItems.length && <p className="empty-note">Every card has found a hand. This stack is empty.</p>}{searchedItems.map((i, index, all) => {
          const comp = p.components.find(c => c.id === i.componentId)!;
          const name = comp.rows[i.row]?.name ?? comp.name;
          if (!`${name} ${comp.name}`.toLowerCase().includes(query.toLowerCase())) return null;
          const reorder = (offset: number) => { const ids = all.map(i => i.id); [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]]; dispatch({ type: 'reorder', ids: i.stackReversed ? ids.reverse() : ids }); };
          return <div className="stack-search-row" key={i.id}><ComponentThumbnail component={comp} components={p.components} row={i.row} back={visibleBack(i)} width={43} /><div><strong>{name}</strong><small>{index === all.length - 1 ? 'Top of stack' : `Position ${index + 1}`} · {comp.name}</small></div>
            <button className="icon-button" aria-label={`Move ${name} down`} disabled={viewer || !index || !i.stack} onClick={() => reorder(-1)}><ArrowDown size={16} /></button><button className="icon-button" aria-label={`Move ${name} up`} disabled={viewer || index === all.length - 1 || !i.stack} onClick={() => reorder(1)}><ArrowUp size={16} /></button>
            <button className="button" disabled={viewer || !currentPlayer || !comp.hand || !p.settings.hands} onClick={() => {
              const ids = all.map(item => item.id).filter(id => id !== i.id); ids.push(i.id);
              if (i.stack) void dispatch({ type: 'reorder', ids: i.stackReversed ? ids.reverse() : ids }).then(ok => { if (ok) void dispatch({ type: 'draw', id: i.id, playerId: actor }); });
              else void dispatch({ type: 'draw', id: i.id, playerId: actor });
            }}>Draw</button>
          </div>;
        })}</div></div>
    </Modal>}
    {removingSeat && <Modal title={`Remove ${removingSeat.name}?`} subtitle={`The seat is removed from the table. ${(() => { const n = p.instances.filter(i => i.holder === removingSeat.id).length; return n ? `Its ${n} held ${n === 1 ? 'piece is' : 'pieces are'} spread on the table where the seat was. ` : ''; })()}${seatOverride(removingSeat) ? `${overrideLabel(seatOverride(removingSeat)!)}: ${overrideNote(seatOverride(removingSeat)!, removingSeat.name)} ` : ''}This also clears undo history.`} onClose={() => setRemovingSeat(undefined)}>
      <div className="modal-actions"><button className="button" onClick={() => setRemovingSeat(undefined)}>Cancel</button><button className="button danger" onClick={() => { const id = removingSeat.id; void dispatch({ type: 'removePlayer', playerId: id }).then(ok => { if (ok) { setSelectedSeatId(seat => seat === id ? undefined : seat); setRemovingSeat(undefined); } }); }}>Remove seat</button></div>
    </Modal>}
    {fullscreenItem && fullscreenComponent && <PiecePreview key={fullscreenItem.id} item={fullscreenItem} component={fullscreenComponent} components={p.components} actor={actor} viewer={viewer} pointer={fullscreen?.pointer} stackCount={fullscreenItem.stack ? stackMembers(p, fullscreenItem).length : 1} onClose={closeFullscreen} />}
    {seatEditor && <Modal title="A seat at the table" subtitle="Your name, your color, your little corner of the world." onClose={() => setSeatEditor(undefined)}>
      <form className="seat-form" onSubmit={e => { e.preventDefault(); dispatch({ type: 'player', player: seatEditor }); setSeatEditor(undefined); }}>
        <Field label="Player name"><input required maxLength={50} value={seatEditor.name} onChange={e => setSeatEditor({ ...seatEditor, name: e.target.value })} /></Field>
        <ColorField label="Player color" value={seatEditor.color} onChange={color => setSeatEditor({ ...seatEditor, color })} />
        <div className="field-grid"><NumberField label="Seat X" value={seatEditor.x} onChange={x => setSeatEditor({ ...seatEditor, x })} /><NumberField label="Seat Y" value={seatEditor.y} onChange={y => setSeatEditor({ ...seatEditor, y })} /></div>
        <NumberField label="Seat rotation" value={seatEditor.rotation} onChange={rotation => setSeatEditor({ ...seatEditor, rotation })} />
        <p className="help-text">Seats and hands persist with the playground. {online ? 'In live rooms a seat is freed when its player leaves; anyone can take an empty seat.' : 'Online players can take these seats when you host the table.'}</p>
        <div className="modal-actions"><button className="button primary" type="submit">Save seat</button></div>
      </form>
    </Modal>}
  </div>;
}

type SeatOverride = 'host' | 'hotseat';
const overrideLabel = (kind: SeatOverride) => kind === 'host' ? 'Host override' : 'Hotseat override';
const overrideNote = (kind: SeatOverride, name: string) => kind === 'host'
  ? `this seat belongs to another player. As the host, only you can change its settings or remove it.`
  : `you are changing ${name}'s seat from your active seat. Switch to ${name} to play with their hand.`;
function SeatInspector({ player, active, nameLocked = false, editable, override, held, actions, onChange, onClose, onRemove }: {
  player: Player; active: boolean; editable: boolean;
  /** Online, a claimed seat shows its player's profile name, which only that player can change (in Settings). */
  nameLocked?: boolean; override?: SeatOverride; held: number; actions: React.ReactNode;
  onChange: (patch: Partial<Player>) => void; onClose: () => void; onRemove: () => void;
}) {
  const [name, setName] = useState(player.name);
  const cancelName = useRef(false);
  useEffect(() => setName(player.name), [player.name]);
  const commitName = () => {
    const next = name.trim();
    if (!nameLocked && !cancelName.current && next && next !== player.name) onChange({ name: next }); else setName(player.name);
    cancelName.current = false;
  };
  return <div className="inspector-section selected-inspector seat-inspector">
    <div className="section-title"><h3>Seat selected</h3><button className="icon-button" title="Deselect" aria-label="Deselect seat" onClick={onClose}><X size={14} /></button></div>
    <div className="selected-component"><span className="mini-avatar seat-avatar" style={{ background: player.color }}>{player.name[0]}</span><div><strong>{player.name}{active && <YouTag />}</strong><small>{active ? 'Active seat' : editable && override !== 'host' ? `${held} in hand` : 'Remote player'}</small></div></div>
        {actions}
    {override && <p className="host-override-note" role="note">{overrideLabel(override)}: {overrideNote(override, player.name)}</p>}
    <fieldset className={`seat-fields${override ? ' host-override' : ''}`} disabled={!editable}>
      <Field label="Player name"><input required maxLength={50} value={name} readOnly={nameLocked} title={nameLocked ? (active ? 'Change your name in Settings.' : 'Each player sets their own name in Settings.') : undefined}
        onChange={e => setName(e.target.value)} onBlur={commitName}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { cancelName.current = true; e.currentTarget.blur(); } }} /></Field>
      {nameLocked && editable && <p className="help-text">{active ? 'Your seat uses your profile name. Change it in Settings.' : "This seat uses its player's profile name."}</p>}
      <ColorField deferred label="Player color" value={player.color} onChange={color => onChange({ color })} />
      <div className="field-grid"><NumberField deferred label="Seat X" value={player.x} onChange={x => onChange({ x })} /><NumberField deferred label="Seat Y" value={player.y} onChange={y => onChange({ y })} /></div>
      <NumberField deferred label="Seat rotation" value={player.rotation} onChange={rotation => onChange({ rotation })} />
    </fieldset>
    {!editable && <p className="help-text">Only this seat's owner can change its settings.</p>}
    {editable && <button className={`button danger full${override ? ' host-override' : ''}`} onClick={onRemove}><Trash2 size={14} /> Remove seat</button>}
  </div>;
}

function YouTag() {
  return <span className="you-tag" title="This is your seat">You</span>;
}

/** A three-line stack glyph highlighting where a piece lands; crossed out when the selection can't be stacked. */
function StackSlotIcon({ slot, blocked = false }: { slot?: 'bottom' | 'middle' | 'top'; blocked?: boolean }) {
  return <svg className="stack-slot-icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" strokeWidth="2" strokeLinecap="round">
    {(['top', 'middle', 'bottom'] as const).map((line, index) => <line key={line} className={slot === line ? 'on' : ''} x1="2.5" x2="11.5" y1={3 + index * 4} y2={3 + index * 4} />)}
    {blocked && <line className="cross" x1="2" y1="12" x2="12" y2="2" />}
  </svg>;
}

/** Shows the zoom level, coalescing rapid wheel zooming: repainting the label re-layerizes the whole table. */
function ZoomPercent({ zoom }: { zoom: number }) {
  const [shown, setShown] = useState(zoom);
  const updatedAt = useRef(0);
  useEffect(() => {
    const show = () => { updatedAt.current = performance.now(); setShown(zoom); };
    const wait = updatedAt.current + 150 - performance.now();
    if (wait <= 0) { show(); return; }
    const timer = setTimeout(show, wait);
    return () => clearTimeout(timer);
  }, [zoom]);
  return <>{Math.round(shown * 100)}%</>;
}

type PieceEvents = {
  start: (event: React.PointerEvent, item: Instance) => void; enter: (event: React.PointerEvent, id: string) => void; leave: (event: React.PointerEvent) => void;
  focus: (id: string) => void; blur: () => void; select: (item: Instance, extend: boolean) => void;
  /** Draws the piece into your hand; returns false when the piece can't be used. */
  draw: (item: Instance, component: Component) => boolean;
};
type TablePieceProps = {
  item: Instance; component: Component; components: Component[]; x: number; y: number; zIndex: number; count: number;
  selected: boolean; hovered: boolean; dragging: boolean; miniDropSource: boolean; dropTarget: boolean; rollingRow?: number; shuffling?: boolean; pressed?: boolean;
  /** The colour of the seat that pinged the piece last (it pulses when pinged). */
  pingColor?: string;
  /** Who the piece is hidden from, when hidden pieces are shown; `hiddenFromYou` fades it. */
  hiddenLabel?: string; hiddenFromYou?: boolean;
  /** In a persistent stack, which keeps its label (with a pin) even with one piece. */
  persistent?: boolean;
  /** The table zoom times the piece's scale; only set for selected, hovered and drop-target pieces, whose order badge
   * and outline keep a constant screen size. */
  pieceZoom?: number;
  /** For stacks, books and selected pieces: the piece's rotation on screen (with the camera's), so its labels and selection
   * badge stay upright, at its screen-bottom edge and screen top-left corner. */
  labelAngle?: number;
  /** For stacks and books too small on screen for a full label: show just the icon. */
  compactLabel?: boolean;
  badgeIndex: number; badgeTotal: number; badgeError?: string; events: React.RefObject<PieceEvents>;
};
const TablePiece = memo(function TablePiece({ item, component: comp, components, x, y, zIndex, count, selected, hovered, dragging, miniDropSource, dropTarget, rollingRow, shuffling, persistent, pressed, pingColor, hiddenLabel, hiddenFromYou, pieceZoom, labelAngle, compactLabel, badgeIndex, badgeTotal, badgeError, events }: TablePieceProps) {
  const slot = badgeIndex >= 0 ? stackSlot(badgeIndex, badgeTotal) : undefined;
  // A book is one piece whose pages are its rows; it looks like a stack but nothing can be taken from it.
  const pages = comp.kind === 'book' ? Math.max(1, comp.rows.length) : 0;
  const element = useRef<HTMLDivElement>(null);
  const transform = `translate(-50%, -50%) rotate(${item.rotation}deg) scale(${item.scale})`;
  const open = hasOpenFace(comp);
  // The selection, hover and stack-drop outlines trace the face's own shape (see ShapeRing).
  const ring = dropTarget ? { color: '#7d9b60', width: 4, offset: 9 } : selected ? { color: '#89a969', width: 2, offset: 4 }
    : hovered ? { color: '#b9cfa0', width: 2, offset: 4 } : undefined;
  const ringId = `piece-ring-${item.id.replace(/[^\w-]/g, '_')}`;
  // Dragging keeps the layout position and moves the piece on the compositor.
  useCompositedTransform(element, dragging ? `translate(${x - item.x}px, ${y - item.y}px) ${transform}` : undefined);
  // While dragging, the piece's transform follows the pointer on the compositor and a rotation would jump; turn its
  // contents from the old angle instead (the table transition does this for pieces at rest).
  const lastRotation = useRef(item.rotation);
  useLayoutEffect(() => {
    const from = lastRotation.current;
    lastRotation.current = item.rotation;
    if (!dragging || from === item.rotation || !element.current || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const part of element.current.querySelectorAll(':scope > .piece-face, :scope > .stack-shadow')) {
      part.animate([{ transform: `rotate(${from - item.rotation}deg)` }, { transform: 'rotate(0deg)' }], { duration: 200, easing: 'cubic-bezier(.2, .8, .2, 1)', composite: 'add' });
    }
  }, [item.rotation, dragging]);
  const wasDragging = useRef(dragging);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node || wasDragging.current === dragging || (wasDragging.current = dragging)) return;
    // The drop moves the layout position to where the compositor already shows the piece, so it must not transition.
    node.style.transition = 'none';
    void getComputedStyle(node).left;
    node.style.transition = '';
  }, [dragging]);
  // A ping (from any player) pulses the piece for a moment; the count was already there when it mounted.
  const pings = useRef(item.pings ?? 0);
  const [pinged, setPinged] = useState(0);
  useEffect(() => {
    const count = item.pings ?? 0;
    if (count > pings.current) setPinged(n => n + 1);
    pings.current = count;
  }, [item.pings]);
  useEffect(() => {
    if (!pinged) return;
    const timer = window.setTimeout(() => setPinged(0), 1800);
    return () => window.clearTimeout(timer);
  }, [pinged]);
  return <div ref={element} className={`table-piece ${hiddenFromYou && hiddenLabel ? 'hidden-from-you ' : ''}${comp.kind === 'button' ? `button-piece${pressed ? ' pressed' : ''} ` : ''}${rollingRow !== undefined ? 'rolling' : ''} ${shuffling ? 'shuffling' : ''} ${selected ? 'selected' : ''} ${item.locked ? 'locked' : ''} ${dragging ? `dragging drag-source ${miniDropSource ? 'mini-drop-source' : ''}` : ''} ${dropTarget ? 'stack-drop-target' : ''}`}
    data-testid="table-piece" data-piece-id={item.id}
    style={{ ...(pieceZoom !== undefined ? { '--piece-zoom': pieceZoom } : {}), '--piece-scale': item.scale, left: dragging ? item.x : x, top: dragging ? item.y : y, width: comp.width, height: comp.height, zIndex, transform } as React.CSSProperties}
    onPointerDown={e => events.current.start(e, item)}
    onPointerEnter={e => events.current.enter(e, item.id)} onPointerLeave={e => events.current.leave(e)}
    onFocus={() => events.current.focus(item.id)} onBlur={() => events.current.blur()} tabIndex={0} role="button" aria-label={`${comp.name}${count > 1 ? `, stack of ${count}` : ''}${pages ? `, page ${item.row + 1} of ${pages}` : ''}`}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); events.current.select(item, e.shiftKey); } }}
    onDoubleClick={e => { if (events.current.draw(item, comp)) e.stopPropagation(); }}>
    {(count > 1 || pages > 1) && (open
      // A shaped (transparent) face shows the pieces underneath as silhouettes of its own shape.
      ? [2, 1].map(depth => <div key={depth} className={`stack-shadow stack-shadow-${depth} open-stack-shadow`}><ComponentView component={comp} components={components} row={item.row} back={visibleBack(item)} /></div>)
      : <><div className="stack-shadow stack-shadow-2" /><div className="stack-shadow stack-shadow-1" /></>)}
    {ring && pieceZoom !== undefined && <ShapeRing id={ringId} {...ring} scale={pieceZoom} boxWidth={comp.width} boxHeight={comp.height} />}
    <div className="piece-face" style={ring && pieceZoom !== undefined ? { filter: `url(#${ringId})` } : undefined}>
      <ComponentView component={comp} components={components} row={rollingRow ?? item.row} back={visibleBack(item)} />
    </div>
    {!!pinged && <span key={pinged} className="ping-pulse" aria-hidden="true" style={{ '--ping-color': pingColor ?? '#e0a43a' } as React.CSSProperties}><i /><i /></span>}
    {(count > 1 || pages > 0 || persistent || hiddenLabel) && (() => {
      // The labels sit on the piece's edge that faces down on screen, upright for the viewer and a fixed screen size.
      const angle = labelAngle ?? item.rotation, turn = angle * Math.PI / 180, dx = Math.sin(turn), dy = Math.cos(turn);
      const reach = Math.min(Math.abs(dx) > 1e-6 ? comp.width / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? comp.height / 2 / Math.abs(dy) : Infinity);
      return <div className={`piece-labels${compactLabel ? ' compact' : ''}`} style={{ left: comp.width / 2 + dx * reach, top: comp.height / 2 + dy * reach, '--label-turn': `${-angle}deg` } as React.CSSProperties}>
        {(count > 1 || persistent) && <span className={`stack-count${persistent ? ' persistent' : ''}`} title={`${persistent ? 'Persistent stack' : 'Stack'} of ${count}`}>{persistent ? <Pin size={13} /> : <Layers size={13} />}{compactLabel ? <span className="visually-hidden">{count}</span> : <> {count}</>}</span>}
        {hiddenLabel && <span className="stack-count hidden-count" title={hiddenLabel}><EyeOff size={13} />{compactLabel ? <span className="visually-hidden">{hiddenLabel}</span> : <> {hiddenLabel}</>}</span>}
        {pages > 0 && <span className="stack-count book-page-count" data-testid="book-page" title={`Page ${item.row + 1} of ${pages}`}><BookOpen size={13} />{compactLabel ? <span className="visually-hidden">{item.row + 1} / {pages}</span> : <> {item.row + 1} / {pages}</>}</span>}
      </div>;
    })()}
    {slot && <span className={`stack-order-badge ${badgeError ? 'blocked' : ''}`} data-testid="stack-order" data-slot={slot} style={orderBadgePlace(comp, labelAngle ?? item.rotation, pieceZoom)}
      title={badgeError ? `Can't stack: ${badgeError}` : `Stacked ${slot === 'bottom' ? 'at the bottom' : slot === 'top' ? 'on top' : 'in the middle'} (${badgeIndex + 1} of ${badgeTotal})`}>
      <b>{badgeIndex + 1}</b><StackSlotIcon slot={slot} blocked={!!badgeError} />
    </span>}
    {selected && <><i className="selection-corner tl" /><i className="selection-corner tr" /><i className="selection-corner bl" /><i className="selection-corner br" /></>}
  </div>;
});

/**
 * Inline transform changes make Chrome re-layerize every painted layer of a large table on each frame. Holding the
 * transform in a persistent animation and replacing its keyframes updates it on the compositor instead. Pass
 * undefined to drop the override and fall back to the element's own style.
 *
 * A layer moved by a compositor animation (or marked `will-change: transform`) keeps the bitmap it was drawn at and
 * is stretched when it scales, so a zoomed table looks blurry. With `settleAfter` (ms), the transform is written as a
 * plain style once it stops changing and the element gets `data-settled`, which drops `will-change`, so the browser
 * redraws it at its real scale; the next change goes back to the animation.
 */
function useCompositedTransform(ref: React.RefObject<HTMLElement | null>, transform: string | undefined, settleAfter?: number) {
  const animation = useRef<Animation>(undefined);
  const settle = useRef<number>(undefined);
  useLayoutEffect(() => {
    const element = ref.current;
    window.clearTimeout(settle.current);
    if (!transform || !element) { animation.current?.cancel(); animation.current = undefined; return; }
    if (typeof element.animate !== 'function') { element.style.transform = transform; return; }
    const frames = [{ transform }, { transform }];
    const effect = animation.current?.effect;
    if (effect instanceof KeyframeEffect && effect.target === element && animation.current?.playState === 'running') effect.setKeyframes(frames);
    else {
      animation.current?.cancel();
      delete element.dataset.settled;
      animation.current = element.animate(frames, { duration: 1000, iterations: Infinity });
    }
    if (settleAfter !== undefined) settle.current = window.setTimeout(() => {
      element.style.transform = transform;
      element.dataset.settled = '';
      animation.current?.cancel(); animation.current = undefined;
    }, settleAfter);
  }, [ref, transform, settleAfter]);
  useEffect(() => () => { window.clearTimeout(settle.current); animation.current?.cancel(); }, []);
}

/**
 * Places the selection order badge upright at the piece corner that is top-left on screen, just outside it (overlapping
 * by 10 screen pixels) and at a fixed screen size. `angle` is the piece's rotation on screen, camera included.
 */
type DrawFlightData = { key: string; from: Instance; to: Pick<Player, 'x' | 'y' | 'rotation'>; delay: number };
/**
 * A copy of a drawn piece flying from its old table place to the seat of the player who took it, shrinking to the size
 * of a table-hand card. It shows the face that was showing on the table.
 */
function DrawFlight({ flight, component, components, onDone }: { flight: DrawFlightData; component: Component; components: Component[]; onDone: () => void }) {
  const element = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useLayoutEffect(() => {
    const { from, to } = flight;
    const place = (x: number, y: number, rotation: number, scale: number) => `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`;
    const animation = element.current?.animate([
      { transform: place(from.x, from.y, from.rotation, from.scale), opacity: 1 },
      { transform: place(from.x + (to.x - from.x) * .25, from.y + (to.y - from.y) * .25 - 40, from.rotation, from.scale * 1.08), opacity: 1, offset: .25 },
      { transform: place(to.x, to.y, to.rotation, 44 / component.width), opacity: .2 },
    ], { duration: DRAW_MS, delay: flight.delay, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'both' });
    if (!animation) { done.current(); return; }
    animation.onfinish = () => done.current();
    return () => animation.cancel();
  }, [flight, component.width]);
  return <div ref={element} className="draw-flight" aria-hidden="true" style={{ width: component.width, height: component.height }}>
    <ComponentView component={component} components={components} row={flight.from.row} back={visibleBack(flight.from)} />
  </div>;
}

function orderBadgePlace(comp: Component, angle: number, zoom = 1): React.CSSProperties {
  const turn = angle * Math.PI / 180, cos = Math.cos(turn), sin = Math.sin(turn);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => ({ sx, sy, x: sx * comp.width / 2, y: sy * comp.height / 2 }));
  // The corner whose screen position has the smallest x + y is the top-left one.
  const corner = corners.reduce((best, at) => (at.x * cos - at.y * sin) + (at.x * sin + at.y * cos) < (best.x * cos - best.y * sin) + (best.x * sin + best.y * cos) ? at : best);
  return { left: comp.width / 2 + corner.x, top: comp.height / 2 + corner.y, right: 'auto', bottom: 'auto', transformOrigin: '0 0',
    transform: `rotate(${-angle}deg) scale(${1 / zoom}) translate(calc(-100% + 10px), calc(-100% + 10px))` };
}

/**
 * An outline that follows the drawn shape of a piece's face, including transparent parts, rather than its box: the
 * face's opaque pixels are grown by `offset` and by `offset + width`, and the band between them is filled with
 * `color`. Sizes are screen pixels; `scale` is the table zoom times the piece's scale.
 */
function ShapeRing({ id, color, width, offset, scale, boxWidth, boxHeight }: {
  id: string; color: string; width: number; offset: number; scale: number; boxWidth: number; boxHeight: number;
}) {
  const outer = (offset + width) / scale, inner = offset / scale, margin = outer + 2 / scale;
  return <svg className="shape-ring-defs" width="0" height="0" aria-hidden="true" focusable="false">
    <filter id={id} filterUnits="userSpaceOnUse" x={-margin} y={-margin} width={boxWidth + margin * 2} height={boxHeight + margin * 2} colorInterpolationFilters="sRGB">
      {/* Count faint pixels (soft shadows, antialiasing) as part of the shape only from about 10% opacity. */}
      <feComponentTransfer in="SourceAlpha" result="solid"><feFuncA type="discrete" tableValues="0 1 1 1 1 1 1 1 1 1" /></feComponentTransfer>
      <feMorphology in="solid" operator="dilate" radius={outer} result="outer" />
      <feMorphology in="solid" operator="dilate" radius={inner} result="inner" />
      <feComposite in="outer" in2="inner" operator="out" result="band" />
      <feFlood floodColor={color} />
      <feComposite in2="band" operator="in" result="ring" />
      <feMerge><feMergeNode in="ring" /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter>
  </svg>;
}

type DragOverlayProps = { item: Instance; component: Component; components: Component[]; left: number; top: number; dx: number; dy: number; rotation: number; scale: number };
/** The dragged piece drawn above the panels. It stays anchored at the piece's table position and moves on the compositor. */
const DragOverlay = memo(function DragOverlay({ item, component, components, left, top, dx, dy, rotation, scale }: DragOverlayProps) {
  const element = useRef<HTMLDivElement>(null);
  const transform = `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`;
  useCompositedTransform(element, `translate(${dx}px, ${dy}px) ${transform}`);
  return <div ref={element} className="board-drag-preview" aria-hidden="true" style={{ left, top, width: component.width, height: component.height, transform }}>
    <ComponentView component={component} components={components} row={item.row} back={visibleBack(item)} />
  </div>;
});
