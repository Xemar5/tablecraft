import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpFromLine, ArrowRightLeft, ChevronRight, Copy, Dices, Eye, EyeOff, FlipHorizontal2, Grid2X2, Hand, Layers, LockKeyhole, Maximize, Minus, MousePointer2, Plus, RotateCcw, RotateCw, Search, Settings2, Shuffle, Trash2, UnlockKeyhole, Users, X } from 'lucide-react';
import { ComponentThumbnail, ComponentView } from './ComponentView';
import { canStack, handPermissions, stackMembers, uid, visibleBack, visibleStackMembers, type Command, type Component, type Instance, type Player, type Project } from './domain';
import { LIBRARY_DRAG_TYPE, readLibraryDrag } from './libraryDrag';
import { ColorField, Field, HorizontalScroll, Modal, NumberField, Toggle } from './ui';
import { PanelSeparator, type usePanelLayout } from './panelLayout';

type Props = {
  project: Project; actor: string; owner: string; selected: string[]; setSelected: (ids: string[]) => void;
  dispatch: (command: Command) => Promise<boolean>; onEdit: (id: string) => void;
  onSpawn: (component: Component, rows: number[], point: { x: number; y: number }) => void;
  onSwitch: (player: Player) => void; notify: (message: string, error?: boolean) => void;
  inspectorVisible: boolean; handVisible: boolean;
  onShowInspector: () => void;
  panel: 'selection' | 'table' | 'players'; setPanel: (panel: 'selection' | 'table' | 'players') => void;
  panels: ReturnType<typeof usePanelLayout>;
};
export function Playground({ project: p, actor, owner, selected, setSelected, inspectorVisible, handVisible, onShowInspector, dispatch: dispatchCommand, onSpawn, onEdit, onSwitch, notify, panel, setPanel, panels }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const handScroller = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(.65);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [camera, setCamera] = useState(0);
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  const [preview, setPreview] = useState<Record<string, { x: number; y: number }>>({});
  const [search, setSearch] = useState<string[]>();
  const [query, setQuery] = useState('');
  const [seatEditor, setSeatEditor] = useState<Player>();
  const [hovered, setHovered] = useState<string>();
  const [previewItem, setPreviewItem] = useState<string>();
  const [previewScale, setPreviewScale] = useState(1);
  const [previewOnLeft, setPreviewOnLeft] = useState(false);
  const [seatsUnlocked, setSeatsUnlocked] = useState(false);
  const [seatPosition, setSeatPosition] = useState<{ id: string; x: number; y: number }>();
  const seatGesture = useRef<{ id: string; pointer: number; x: number; y: number; startX: number; startY: number }>(null);
  const seatMoved = useRef(false);
  const pointer = useRef<{ x: number; y: number }>(null);
  const clipboard = useRef<Instance[]>([]);
  const [handHidden, setHandHidden] = useState(false);
  const [faceUpInHand, setFaceUpInHand] = useState(true);
  const dispatch = useCallback((command: Command) => {
    if (command.type === 'draw' || command.type === 'drawMany' || command.type === 'drawSelection' || command.type === 'transferToHand') {
      return dispatchCommand({ ...command, faceUp: faceUpInHand });
    }
    return dispatchCommand(command);
  }, [dispatchCommand, faceUpInHand]);
  const [handDrag, setHandDrag] = useState<{ id: string; x: number; y: number }>();
  const [insertion, setInsertion] = useState<number>();
  const [dropHint, setDropHint] = useState<{ id: string; x: number; y: number }>();
  const [handDrop, setHandDrop] = useState<{ playerId: string; index: number; ids: string[]; x: number; y: number }>();
  const permissions = handPermissions(p, actor);
  const [altDown, setAltDown] = useState(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number }>();
  const marqueeGesture = useRef<{ x: number; y: number; ids: string[] }>(null);
  const handGesture = useRef<{ pointer: number; id: string; x: number; y: number }>(null);
  const handSelectionAnchor = useRef<string>(undefined);
  const handClickSuppressed = useRef(false);
  const tableHandGesture = useRef<{ pointer: number; id: string; x: number; y: number }>(null);
  const gesture = useRef<{ pointer: number; x: number; y: number; startWorld?: { x: number; y: number }; positions: Record<string, { x: number; y: number }>; front?: string[]; pan?: { x: number; y: number } }>(null);
  const piece = p.instances.find(i => i.id === selected.at(-1));
  const c = p.components.find(c => c.id === piece?.componentId);
  const currentPlayer = p.players.find(player => player.id === actor);
  const held = p.instances.filter(i => i.holder === actor).sort((a, b) => a.order - b.order);
  const items = piece ? stackMembers(p, piece) : [];
  const searchedItems = p.instances.filter(i => search?.includes(i.id) && !i.holder).sort((a, b) => a.order - b.order);
  if (searchedItems[0]?.stackReversed) searchedItems.reverse();
  const topPieces = p.instances.filter(i => !i.holder && (!i.stack || visibleStackMembers(p, i).at(-1)?.id === i.id));
  const selectedPieces = p.instances.filter(i => selected.includes(i.id));
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
  useEffect(() => {
    const clear = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-hand-id],[data-mini-id]')) return;
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
    window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', blur); };
  }, []);
  useEffect(() => {
    if (!pointer.current || gesture.current || handGesture.current) return;
    const element = document.elementFromPoint(pointer.current.x, pointer.current.y);
    if (element?.closest('.hover-preview')) return;
    const target = element?.closest<HTMLElement>('[data-piece-id],[data-hand-id]');
    const id = target?.dataset.pieceId ?? target?.dataset.handId;
    setHovered(id); setPreviewItem(id);
  }, [p.instances]);
  const leavePiece = (event: React.PointerEvent) => {
    setHovered(undefined);
    if (!(event.relatedTarget instanceof Element) || !event.relatedTarget.closest('.hover-preview')) setPreviewItem(undefined);
  };
  const positionPreview = (clientX: number) => {
    const rect = viewport.current?.getBoundingClientRect();
    if (rect) setPreviewOnLeft(clientX >= rect.left + rect.width * 2 / 3);
  };
  const enterPiece = (event: React.PointerEvent, id: string) => {
    pointer.current = { x: event.clientX, y: event.clientY };
    positionPreview(event.clientX);
    setHovered(id); setPreviewItem(id);
  };

  const fit = useCallback(() => {
    if (!viewport.current) return;
    const rect = viewport.current.getBoundingClientRect();
    const z = Math.min(rect.width / 1680, rect.height / 1030, 1);
    setCamera(0); setZoom(z); setPan({ x: rect.width / 2 - 950 * z, y: rect.height / 2 - 500 * z });
  }, []);
  useEffect(() => {
    fit();
    let previous = viewport.current?.getBoundingClientRect();
    const observer = new ResizeObserver(() => {
      const next = viewport.current?.getBoundingClientRect();
      if (next && previous) {
        const dx = (next.width - previous.width) / 2, dy = (next.height - previous.height) / 2;
        setPan(value => ({ x: value.x + dx, y: value.y + dy }));
      }
      previous = next;
    });
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [fit]);
  const changeZoom = (next: number, cursor?: { x: number; y: number }) => {
    const z = Math.max(.15, Math.min(2, next));
    const rect = viewport.current?.getBoundingClientRect();
    if (rect) {
      const g = gesture.current;
      const dragging = g && !g.pan && pointer.current;
      const anchor = cursor ? { x: cursor.x - rect.left, y: cursor.y - rect.top } : { x: rect.width / 2, y: rect.height / 2 };
      const nextPan = { x: anchor.x - (anchor.x - pan.x) * z / zoom, y: anchor.y - (anchor.y - pan.y) * z / zoom };
      setPan(nextPan);
      if (g && dragging && g.startWorld) {
        const point = worldPoint(dragging.x, dragging.y, z, nextPan);
        const delta = { x: point.x - g.startWorld.x, y: point.y - g.startWorld.y };
        setPreview(Object.fromEntries(Object.entries(g.positions).map(([id, pos]) => [id, { x: pos.x + delta.x, y: pos.y + delta.y }])));
      }
    }
    setZoom(z);
  };
  const worldDelta = (dx: number, dy: number) => {
    const angle = -camera * Math.PI / 180;
    return { x: (dx * Math.cos(angle) - dy * Math.sin(angle)) / zoom, y: (dx * Math.sin(angle) + dy * Math.cos(angle)) / zoom };
  };
  const worldPoint = (x: number, y: number, scale = zoom, translation = pan) => {
    const rect = viewport.current!.getBoundingClientRect();
    const dx = x - rect.left - translation.x, dy = y - rect.top - translation.y;
    const angle = -camera * Math.PI / 180;
    return { x: (dx * Math.cos(angle) - dy * Math.sin(angle)) / scale, y: (dx * Math.sin(angle) + dy * Math.cos(angle)) / scale };
  };
  const dragDelta = (g: NonNullable<typeof gesture.current>, x: number, y: number) => {
    const point = worldPoint(x, y);
    return g.startWorld ? { x: point.x - g.startWorld.x, y: point.y - g.startWorld.y } : { x: 0, y: 0 };
  };
  const rotateCamera = (degrees: number) => {
    const rect = viewport.current?.getBoundingClientRect();
    if (!rect) return;
    const center = worldPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const angle = (camera + degrees) * Math.PI / 180;
    setPan({ x: rect.width / 2 - zoom * (center.x * Math.cos(angle) - center.y * Math.sin(angle)),
      y: rect.height / 2 - zoom * (center.x * Math.sin(angle) + center.y * Math.cos(angle)) });
    setCamera(camera + degrees);
  };
  const targetAt = (x: number, y: number, excluded: string[]) => {
    const elements = document.elementsFromPoint(x, y);
    for (const element of elements) {
      const id = element.closest<HTMLElement>('[data-piece-id]')?.dataset.pieceId;
      const target = p.instances.find(i => i.id === id);
      if (target && !excluded.includes(target.id) && !target.locked) return target;
    }
    return undefined;
  };
  const seatAt = (x: number, y: number) => {
    const direct = document.elementsFromPoint(x, y)
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
    if (alt || !p.settings.hands || !moving.length || moving.some(i => i.locked || !p.components.find(c => c.id === i.componentId)?.hand)) return undefined;
    const playerId = seatAt(x, y), player = p.players.find(player => player.id === playerId);
    if (!player || (player.id !== actor && !handPermissions(p, player.id).insert && moving.some(i => i.holder !== player.id)) ||
      moving.some(i => i.holder && i.holder !== actor && !handPermissions(p, i.holder).take)) return undefined;
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
    if (!drop) return false;
    void dispatch({ type: 'transferToHand', ids: drop.ids, playerId: drop.playerId, index: drop.index });
    return true;
  };
  const compatible = (target: Instance, moving: Instance[]) =>
    [...stackMembers(p, target), ...moving].every(i => !i.locked) &&
    canStack([...stackMembers(p, target), ...moving].map(i => p.components.find(c => c.id === i.componentId)!));
  const showDropHint = (x: number, y: number, moving: Instance[], alt: boolean) => {
    const hand = tableHandInsertion(x, y, moving, alt);
    setHandDrop(hand);
    const target = targetAt(x, y, moving.map(i => i.id));
    setAltDown(alt);
    setDropHint(!hand && target && moving.length && compatible(target, moving) ? { id: target.id, x, y } : undefined);
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
  const rotate = (rotation: number) => { if (piece) dispatch({ type: 'transform', ids: selected, rotation }); };
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
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select,[role="dialog"]') || document.querySelector('[role="dialog"]')) return;
      if (e.key === 'Escape') setSelected([]);
      const hoveredPiece = p.instances.find(i => i.id === hovered && (!i.holder || i.holder === actor));
      const shortcutIds = hoveredPiece && !selected.includes(hoveredPiece.id) ? stackMembers(p, hoveredPiece).map(i => i.id) : selected;
      const shortcutPiece = hoveredPiece ?? piece;
      const draggedHandPiece = handDrag && p.instances.find(i => i.id === handDrag.id && i.holder === actor);
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'f' && (draggedHandPiece || shortcutPiece)) {
        // A flipped stack can replace its top DOM node. Keep the active drag on the stable viewport.
        if (gesture.current && viewport.current && !gesture.current.pan) viewport.current.setPointerCapture(gesture.current.pointer);
        const ids = draggedHandPiece ? selected.includes(draggedHandPiece.id)
          ? held.filter(i => selected.includes(i.id)).map(i => i.id) : [draggedHandPiece.id] : shortcutIds;
        dispatch({ type: 'transform', ids, flip: true });
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && ['q', 'e'].includes(e.key.toLowerCase()) && shortcutPiece) {
        e.preventDefault();
        dispatch({ type: 'transform', ids: shortcutIds, rotation: e.key.toLowerCase() === 'q' ? -90 : 90 });
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'r' && shortcutPiece) { e.preventDefault(); shuffleOrRoll(shortcutIds); }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'g' && selected.length > 1) { e.preventDefault(); dispatch({ type: 'stack', ids: selected, stackId: uid('stack') }); }
      if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && shortcutPiece && !shortcutPiece.holder) {
        e.preventDefault();
        const count = e.key === '0' ? 10 : Number(e.key);
        dispatch(count === 1 ? { type: 'draw', id: shortcutPiece.id, playerId: actor } : { type: 'drawMany', id: shortcutPiece.id, playerId: actor, count });
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); dispatch({ type: 'delete', ids: shortcutIds }); setSelected([]); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); clone(shortcutIds); }
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
  const startPiece = (e: React.PointerEvent, item: Instance) => {
    if (tool === 'pan' || e.button === 1) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    const extracting = e.shiftKey && !!item.stack;
    const group = extracting ? [item.id] : stackMembers(p, item).map(i => i.id);
    const extending = !extracting && (e.shiftKey || e.ctrlKey || e.metaKey);
    const ids = extracting ? group : extending ? selected.includes(item.id) ? selected.filter(id => !group.includes(id)) : [...new Set([...selected, ...group])] : selected.includes(item.id) ? selected : group;
    setSelected(ids);
    if (!ids.includes(item.id)) return;
    if (item.locked) { void dispatch({ type: 'front', ids: group }); return; }
    const positions = Object.fromEntries(p.instances.filter(i => ids.includes(i.id) && !i.locked && !i.holder).map(i => [i.id, { x: i.x, y: i.y }]));
    const active = { pointer: e.pointerId, x: e.clientX, y: e.clientY, startWorld: worldPoint(e.clientX, e.clientY), positions, front: group };
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
  const endGesture = (e: React.PointerEvent) => {
    setHandDrop(undefined);
    if (marqueeGesture.current) {
      marqueeGesture.current = null; setMarquee(undefined);
    }
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
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
      if (!e.altKey && seatAt(e.clientX, e.clientY) && moving.length) {
        notify('This hand cannot accept the selected components.', true);
        gesture.current = null; setPreview({}); setDropHint(undefined); return;
      }
      if (inside(tray) && moving.length) {
        dispatch({ type: 'drawSelection', ids: moving.map(i => i.id), playerId: actor });
        gesture.current = null; setPreview({}); setDropHint(undefined); return;
      }
      const target = targetAt(e.clientX, e.clientY, Object.keys(g.positions));
      if (!e.altKey && target && moving.length && compatible(target, moving)) {
        void dispatch({ type: 'dropStack', ids: moving.map(i => i.id), targetId: target.id, stackId: uid('stack') })
          .then(ok => { if (ok) setSelected([...stackMembers(p, target), ...moving].map(i => i.id)); });
        gesture.current = null; setPreview({}); setDropHint(undefined); return;
      }
      const delta = dragDelta(g, e.clientX, e.clientY);
      const anchor = Object.values(g.positions)[0];
      let { x: dx, y: dy } = delta;
      if (p.settings.snap && anchor) {
        dx = Math.round((anchor.x + dx) / p.settings.gridSize) * p.settings.gridSize - anchor.x;
        dy = Math.round((anchor.y + dy) / p.settings.gridSize) * p.settings.gridSize - anchor.y;
      }
      if (moving.length) dispatch({ type: 'transform', ids: moving.map(i => i.id), dx, dy });
    }
    gesture.current = null; setPreview({}); setDropHint(undefined);
  };
  return <div className="playground-layout">
    <section className="table-section" onPointerMoveCapture={e => {
      if (e.target instanceof Element && e.target.closest('[data-piece-id],[data-hand-id]')) positionPreview(e.clientX);
    }}>
      <div ref={viewport} className={`table-viewport ${tool === 'pan' ? 'pan-mode' : ''}`}
        onDragOver={e => {
          if (Array.from(e.dataTransfer.types).includes(LIBRARY_DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
        }}
        onDrop={e => {
          if (!Array.from(e.dataTransfer.types).includes(LIBRARY_DRAG_TYPE)) return;
          e.preventDefault();
          const data = readLibraryDrag(e.dataTransfer);
          const component = data?.projectId === p.id ? p.components.find(c => c.id === data.componentId) : undefined;
          if (!data || !component) { notify('Unable to spawn these library variants.', true); return; }
          onSpawn(component, data.rows, worldPoint(e.clientX, e.clientY));
        }}
        onPointerLeave={() => { if (!gesture.current) { pointer.current = null; setHovered(undefined); setPreviewItem(undefined); } }}
        onContextMenu={e => e.preventDefault()}
        onWheel={e => {
          pointer.current = { x: e.clientX, y: e.clientY };
          const item = p.instances.find(i => i.id === hovered && !i.holder);
          if (e.shiftKey && item && p.components.find(c => c.id === item.componentId)?.kind === 'card') {
            e.preventDefault();
            void dispatch({ type: 'transform', ids: stackMembers(p, item).map(i => i.id), rotation: e.deltaY > 0 ? 15 : -15 });
          } else { if (e.ctrlKey) e.preventDefault(); changeZoom(zoom * (e.deltaY > 0 ? .92 : 1.08), e.deltaY > 0 ? undefined : { x: e.clientX, y: e.clientY }); }
        }}
        onPointerDown={e => {
          if (e.button === 1 || tool === 'pan') {
            gesture.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, positions: {}, pan };
            e.currentTarget.setPointerCapture(e.pointerId);
          } else if (e.button === 0) {
            marqueeGesture.current = { x: e.clientX, y: e.clientY, ids: e.shiftKey ? selected : [] };
            if (!e.shiftKey) setSelected([]);
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={e => {
          pointer.current = { x: e.clientX, y: e.clientY };
          const box = marqueeGesture.current;
          if (box) {
            const rect = { x: Math.min(box.x, e.clientX), y: Math.min(box.y, e.clientY), width: Math.abs(e.clientX - box.x), height: Math.abs(e.clientY - box.y) };
            setMarquee(rect);
            if (rect.width > 3 || rect.height > 3) {
              const ids = topPieces.filter(item => {
                const bounds = viewport.current?.querySelector<HTMLElement>(`[data-piece-id="${CSS.escape(item.id)}"]`)?.getBoundingClientRect();
                return bounds && bounds.right >= rect.x && bounds.left <= rect.x + rect.width && bounds.bottom >= rect.y && bounds.top <= rect.y + rect.height;
              }).flatMap(item => stackMembers(p, item).map(i => i.id));
              setSelected([...new Set([...box.ids, ...ids])]);
            }
            return;
          }
          const g = gesture.current;
          if (!g || g.pointer !== e.pointerId) return;
          if (g.pan) setPan({ x: g.pan.x + e.clientX - g.x, y: g.pan.y + e.clientY - g.y });
          else {
            const delta = dragDelta(g, e.clientX, e.clientY);
            setPreview(Object.fromEntries(Object.entries(g.positions).map(([id, pos]) => [id, { x: pos.x + delta.x, y: pos.y + delta.y }])));
            showDropHint(e.clientX, e.clientY, p.instances.filter(i => i.id in g.positions), e.altKey);
          }
        }}
        onPointerUp={endGesture}
        onPointerCancel={() => { gesture.current = null; setHandDrop(undefined); setPreview({}); setDropHint(undefined); marqueeGesture.current = null; setMarquee(undefined); }}>
        <div className={`table-world ${p.settings.grid ? 'show-grid' : ''}`} style={{
          transform: `translate(${pan.x}px, ${pan.y}px) rotate(${camera}deg) scale(${zoom})`,
          backgroundSize: `${p.settings.gridSize}px ${p.settings.gridSize}px`,
        }}>
          <div className="table-watermark"><span>W</span><p>THE WILDWOOD</p><small>A PLACE FOR YOUR NEXT GREAT IDEA</small></div>
          {p.settings.hands && p.players.map(player => {
            const playerHeld = p.instances.filter(i => i.holder === player.id).sort((a, b) => a.order - b.order);
            const remaining = playerHeld.filter(i => !handDrop?.ids.includes(i.id));
            const canTake = player.id === actor || handPermissions(p, player.id).take;
            return <button key={player.id} data-seat-id={player.id} title={seatsUnlocked ? `Drag ${player.name}'s seat` : `Switch to ${player.name}`} className={`seat-marker ${player.id === actor ? 'active' : ''}`}
            onPointerDown={e => {
              e.stopPropagation(); seatMoved.current = false;
              if (!seatsUnlocked || e.button !== 0 || (owner !== 'local' && player.owner !== owner)) return;
              seatGesture.current = { id: player.id, pointer: e.pointerId, x: e.clientX, y: e.clientY, startX: player.x, startY: player.y };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={e => {
              const g = seatGesture.current;
              if (!g || g.id !== player.id || g.pointer !== e.pointerId) return;
              if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 3) seatMoved.current = true;
              const delta = worldDelta(e.clientX - g.x, e.clientY - g.y);
              setSeatPosition({ id: player.id, x: g.startX + delta.x, y: g.startY + delta.y });
            }}
            onPointerUp={e => {
              const g = seatGesture.current;
              if (!g || g.id !== player.id || g.pointer !== e.pointerId) return;
              if (seatMoved.current) {
                const delta = worldDelta(e.clientX - g.x, e.clientY - g.y);
                void dispatch({ type: 'player', player: { ...player, x: g.startX + delta.x, y: g.startY + delta.y } });
              }
              seatGesture.current = null; setSeatPosition(undefined);
            }}
            onPointerCancel={() => { seatGesture.current = null; setSeatPosition(undefined); }}
            onClick={() => { if (!seatMoved.current) onSwitch(player); seatMoved.current = false; }}
            style={{ left: seatPosition?.id === player.id ? seatPosition.x : player.x, top: seatPosition?.id === player.id ? seatPosition.y : player.y, '--player-color': player.color, transform: `translate(-50%, -50%) rotate(${player.rotation}deg)` } as React.CSSProperties}>
            <div className="seat-badge"><span className="seat-avatar">{player.name.slice(0, 1).toUpperCase()}</span><strong>{player.name}</strong>
            <span>{playerHeld.length} cards</span></div>
            <div className={`other-hand ${canTake ? 'interactive-hand' : ''} ${handDrop?.playerId === player.id ? 'hand-drop-target' : ''}`} style={{ outlineOffset: 20 / zoom }} aria-label={`${player.name}'s hand`}>
              {playerHeld.map((i, index) => {
                const comp = p.components.find(c => c.id === i.componentId)!;
                return <div key={i.id} data-mini-id={i.id} data-grabbable={!i.locked && canTake} className={`${player.id === actor && selected.includes(i.id) ? 'hand-selected' : ''} ${handDrop?.playerId === player.id && remaining[handDrop.index]?.id === i.id ? 'mini-insert-before' : ''} ${handDrop?.ids.includes(i.id) || handDrag?.id === i.id ? 'mini-drag-source' : ''}`} style={{ transform: `rotate(${(index - (playerHeld.length - 1) / 2) * 5}deg)` }}
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
                    const targetSeat = seatAt(e.clientX, e.clientY);
                    if (!e.altKey && targetSeat) { notify('Inserting into this hand is disabled.', true); return; }
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
                    const target = targetAt(e.clientX, e.clientY, [i.id]);
                    if (i.holder === actor) {
                      void dispatch(!e.altKey && target && compatible(target, [i])
                        ? { type: 'dropFromHand', id: i.id, targetId: target.id, stackId: uid('stack') }
                        : { type: 'release', id: i.id, ...point });
                    } else {
                      void dispatch({ type: 'playVisibleHand', id: i.id, ...point,
                        ...(!e.altKey && target && compatible(target, [i]) ? { targetId: target.id, stackId: uid('stack') } : {}) });
                    }
                  }}
                  onPointerCancel={() => { tableHandGesture.current = null; setHandDrag(undefined); setDropHint(undefined); setHandDrop(undefined); }}
                  onClick={e => { e.stopPropagation(); if (player.id === actor) selectHandCard(i.id, e); }}>
                  <ComponentThumbnail component={comp} components={p.components} row={i.row} back={i.flipped} hidden={player.id === actor ? handHidden : comp.hideInHand} width={44} />
                  {handDrop?.playerId === player.id && handDrop.index === remaining.length && remaining.at(-1)?.id === i.id && <span className="mini-insert-end" aria-label="Insert at end of table hand" />}
                </div>;
              })}
              {handDrop?.playerId === player.id && !remaining.length && <span className="mini-insert-end" aria-label="Insert at end of table hand" />}
            </div>
          </button>; })}
          {topPieces.map(item => {
            const comp = p.components.find(c => c.id === item.componentId)!;
            const members = stackMembers(p, item);
            const position = preview[item.id] ?? item;
            return <div key={item.id} className={`table-piece ${selected.includes(item.id) ? 'selected' : ''} ${item.locked ? 'locked' : ''} ${preview[item.id] ? `dragging drag-source ${handDrop ? 'mini-drop-source' : ''}` : ''} ${dropHint?.id === item.id && !altDown ? 'stack-drop-target' : ''}`}
              data-testid="table-piece" data-piece-id={item.id}
              style={{ left: position.x, top: position.y, width: comp.width, height: comp.height, zIndex: comp.kind === 'board' ? 0 : p.instances.indexOf(item) + 2,
                transform: `translate(-50%, -50%) rotate(${item.rotation}deg) scale(${item.scale})` }}
              onPointerDown={e => startPiece(e, item)}
              onPointerEnter={e => enterPiece(e, item.id)} onPointerLeave={leavePiece}
              onFocus={() => { setHovered(item.id); setPreviewItem(item.id); }} onBlur={() => { setHovered(undefined); setPreviewItem(undefined); }} tabIndex={0} role="button" aria-label={`${comp.name}${members.length > 1 ? `, stack of ${members.length}` : ''}`}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); const ids = members.map(i => i.id); setSelected(e.shiftKey ? [...new Set([...selected, ...ids])] : ids); } }}
              onDoubleClick={e => { e.stopPropagation(); if (p.settings.hands && comp.hand) void dispatch({ type: 'draw', id: item.id, playerId: actor }); }}>
              {members.length > 1 && <><div className="stack-shadow stack-shadow-2" /><div className="stack-shadow stack-shadow-1" /></>}
              <ComponentView component={comp} components={p.components} row={item.row} back={visibleBack(item)} />
              {members.length > 1 && <span className="stack-count"><Layers size={13} /> {members.length}</span>}
              {item.locked && <span className="piece-lock"><LockKeyhole size={15} /></span>}
              {selected.includes(item.id) && <><i className="selection-corner tl" /><i className="selection-corner tr" /><i className="selection-corner bl" /><i className="selection-corner br" /></>}
            </div>;
          })}
        </div>
        {!topPieces.length && <div className="empty-table"><Layers size={40} /><h2>Your next great game starts here.</h2><p>Click a component in the library to put it on the table.</p></div>}
        <div className="floating-tools" onPointerDown={e => e.stopPropagation()}>
          <button className={tool === 'select' ? 'active' : ''} title="Select & move" aria-label="Select and move" onClick={() => setTool('select')}><MousePointer2 size={19} /></button>
          <button className={tool === 'pan' ? 'active' : ''} title="Pan table" aria-label="Pan table" onClick={() => setTool('pan')}><Hand size={19} /></button>
          <span /><button className={p.settings.grid ? 'active-subtle' : ''} title="Toggle grid" aria-label="Toggle grid" onClick={() => dispatch({ type: 'settings', patch: { grid: !p.settings.grid } })}><Grid2X2 size={18} /></button>
          <button className={p.settings.snap ? 'active-subtle' : ''} title="Toggle snapping" aria-label="Toggle snapping" onClick={() => dispatch({ type: 'settings', patch: { snap: !p.settings.snap } })}><Maximize size={17} /></button>
        </div>
        <div className="zoom-control" onPointerDown={e => e.stopPropagation()}><button aria-label="Rotate camera left" onClick={() => rotateCamera(-90)}>↶</button><button aria-label="Rotate camera right" onClick={() => rotateCamera(90)}>↷</button><button aria-label="Zoom out" onClick={() => changeZoom(zoom - .1)}><Minus size={14} /></button><button title="Fit table" aria-label="Fit table" onClick={fit}><Maximize size={14} />{Math.round(zoom * 100)}%</button><button aria-label="Zoom in" onClick={() => changeZoom(zoom + .1)}><Plus size={14} /></button></div>
        {activePreviewId && !altDown && (() => {
          const item = p.instances.find(i => i.id === activePreviewId && !i.locked && (!i.holder || i.holder === actor));
          const comp = p.components.find(c => c.id === item?.componentId);
          return item && comp ? <div className="hover-preview" style={previewOnLeft ? { left: 16, right: 'auto' } : undefined} aria-label={`Preview ${comp.name}`} onPointerDown={e => e.stopPropagation()}
            onPointerLeave={() => setPreviewItem(undefined)} onWheel={e => {
            if (e.ctrlKey) { e.preventDefault(); e.stopPropagation(); setPreviewScale(scale => Math.max(.5, Math.min(3, scale * (e.deltaY > 0 ? .9 : 1.1)))); }
          }}><ComponentThumbnail component={comp} components={p.components} row={item.row} back={visibleBack(item)} width={160 * previewScale} /><strong>{comp.name}</strong>
            <div className="preview-shortcuts" aria-label="Piece shortcuts">
              <small>F — Flip</small><small>Q / E — Rotate −90° / +90°</small><small>R — Shuffle / roll</small>
              <small>G — Stack selection</small><small>1–0 — Draw cards</small><small>Alt — Hide preview</small>
            </div></div> : null;
        })()}
        <div className="table-hint">Drag to move <span /> Shift + drag to draw from a stack <span /> Double-click to draw</div>
      </div>
      {p.settings.hands && handVisible && <><PanelSeparator label="Resize hand tray" controls="hand-tray-panel" value={panels.sizes.hand} {...panels.limits.hand} orientation="horizontal" direction={-1} onResize={value => panels.resize('hand', value)} /><div id="hand-tray-panel" className="hand-tray" style={{ height: panels.sizes.hand, minHeight: 0, flex: `0 0 ${panels.sizes.hand}px` }} aria-label={`${currentPlayer?.name ?? 'Your'}'s hand tray`}>
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
            if (!e.altKey && seatAt(e.clientX, e.clientY)) { notify('Inserting into this hand is disabled.', true); return; }
            const index = handInsertion(e.clientX, e.clientY, movingIds);
            if (index !== undefined) {
              const ids = held.filter(i => !movingIds.includes(i.id)).map(i => i.id);
              ids.splice(index, 0, ...movingIds);
              dispatch({ type: 'reorderHand', ids, playerId: actor });
            } else {
              const rect = viewport.current?.getBoundingClientRect();
              if (!rect || e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
              let { x, y } = worldPoint(e.clientX, e.clientY);
              if (p.settings.snap) { x = Math.round(x / p.settings.gridSize) * p.settings.gridSize; y = Math.round(y / p.settings.gridSize) * p.settings.gridSize; }
              const target = targetAt(e.clientX, e.clientY, []);
              if (!e.altKey && target && compatible(target, moving)) dispatch({ type: 'dropManyFromHand', ids: movingIds, targetId: target.id, stackId: uid('stack') });
              else dispatch({ type: 'releaseMany', ids: moving.map(i => i.id), x, y });
            }
          }} onDoubleClick={e => { e.stopPropagation(); if (comp.flippable) void dispatch({ type: 'transform', ids: [item.id], flip: true }); }}>
            <ComponentThumbnail component={comp} components={p.components} row={item.row} back={item.flipped} width={66} /><span>Drag to play</span></button>
            <div className="hand-order">
              {[-1, 1].map(offset => <button key={offset} type="button" aria-label={`Move ${comp.name} ${offset < 0 ? 'left' : 'right'} in hand`} disabled={held.indexOf(item) + offset < 0 || held.indexOf(item) + offset >= held.length} onClick={() => {
                const ids = held.map(i => i.id), index = ids.indexOf(item.id);
                [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
                dispatch({ type: 'reorderHand', ids, playerId: actor });
              }}>{offset < 0 ? '←' : '→'}</button>)}
            </div></div>;
        }) : <div className="empty-hand"><Copy size={20} /><span>Drag pieces here to take them into your hand.</span></div>}
        {insertion !== undefined && insertion === held.filter(i => !(handDrag && (selected.includes(handDrag.id) ? selected.includes(i.id) : i.id === handDrag.id))).length && <div className="hand-insert-end" aria-label="Insert at end of hand" />}
        </HorizontalScroll>
      </div><HorizontalScroll contentClassName="hand-toolbar" label="Hand actions">
        <button className="icon-button" aria-label="Turn cards face up when entering a hand" title="Turn cards face up when entering a hand" aria-pressed={faceUpInHand} onClick={() => setFaceUpInHand(!faceUpInHand)}><FlipHorizontal2 size={16} /></button>
        <button className="icon-button" aria-label={handHidden ? 'Show my table hand' : 'Hide my table hand'} title={handHidden ? 'Show my table hand' : 'Hide my table hand'} aria-pressed={handHidden} onClick={() => setHandHidden(!handHidden)}>{handHidden ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        <button className="icon-button" aria-label="Shuffle hand" title="Shuffle hand" disabled={held.length < 2} onClick={shuffleHand}><Shuffle size={16} /></button>
        <button className="icon-button" aria-label="Reverse hand" title="Reverse hand" disabled={held.length < 2} onClick={() => dispatch({ type: 'reorderHand', ids: held.map(i => i.id).reverse(), playerId: actor })}><ArrowRightLeft size={16} /></button>
        <button className="icon-button" aria-label="Allow others to insert into my hand" title="Allow others to insert into my hand" aria-pressed={permissions.insert} onClick={() => dispatch({ type: 'handSettings', playerId: actor, patch: { allowHandInsert: !permissions.insert } })}><ArrowDownToLine size={16} /></button>
        <button className="icon-button" aria-label="Allow others to take from my hand" title="Allow others to take from my hand" aria-pressed={permissions.take} onClick={() => dispatch({ type: 'handSettings', playerId: actor, patch: { allowHandTake: !permissions.take } })}><ArrowUpFromLine size={16} /></button>
        <button className="icon-button" aria-label={seatsUnlocked ? 'Lock table hands' : 'Unlock table hands'} title={seatsUnlocked ? 'Lock table hands' : 'Unlock table hands'} aria-pressed={seatsUnlocked} onClick={() => setSeatsUnlocked(!seatsUnlocked)}>{seatsUnlocked ? <UnlockKeyhole size={16} /> : <LockKeyhole size={16} />}</button>
        <button className="icon-button" aria-label="Switch seat" title="Switch seat" onClick={() => { setPanel('players'); onShowInspector(); }}><Users size={16} /></button>
      </HorizontalScroll></>}
      {handDrag && !handDrop && (() => {
        const item = p.instances.find(i => i.id === handDrag.id);
        const comp = p.components.find(c => c.id === item?.componentId);
        return item && comp ? <div className="hand-drag-preview" style={{ left: handDrag.x, top: handDrag.y }} aria-hidden="true"><ComponentThumbnail component={comp} components={p.components} row={item.row} back={item.flipped} hidden={!!item.holder && item.holder !== actor && comp.hideInHand} width={66} /></div> : null;
      })()}
      <footer className="table-status"><span>{p.instances.length} pieces on the table</span><span>{p.settings.snap ? `Snapping to ${p.settings.gridSize}px` : 'Free movement'}<span className="status-divider">/</span>{p.players.length} players<span className="status-divider">/</span>2D playground</span></footer>
    </section>
    {createPortal(<>
      {handDrop && (() => {
        const item = p.instances.find(i => i.id === handDrop.ids[0])!;
        const comp = p.components.find(c => c.id === item.componentId)!;
        const player = p.players.find(player => player.id === handDrop.playerId)!;
        return <div className="hand-drag-preview mini-drop-preview" aria-hidden="true" style={{ left: handDrop.x, top: handDrop.y, transform: `translate(-50%, -50%) rotate(${camera + player.rotation}deg) scale(${zoom})` }}>
          <ComponentThumbnail component={comp} components={p.components} row={item.row} back={visibleBack(item)} hidden={player.id === actor ? handHidden : comp.hideInHand} width={44} />
          {handDrop.ids.length > 1 && <span className="mini-drop-count">{handDrop.ids.length}</span>}
        </div>;
      })()}
      {topPieces.filter(i => preview[i.id] && !handDrop).map(item => {
        const comp = p.components.find(c => c.id === item.componentId)!;
        const position = preview[item.id], rect = viewport.current!.getBoundingClientRect();
        const angle = camera * Math.PI / 180;
        return <div key={item.stack ?? item.id} className="board-drag-preview" aria-hidden="true" style={{
          left: rect.left + pan.x + zoom * (position.x * Math.cos(angle) - position.y * Math.sin(angle)),
          top: rect.top + pan.y + zoom * (position.x * Math.sin(angle) + position.y * Math.cos(angle)),
          width: comp.width, height: comp.height,
          transform: `translate(-50%, -50%) rotate(${camera + item.rotation}deg) scale(${zoom * item.scale})`,
        }}><ComponentView component={comp} components={p.components} row={item.row} back={visibleBack(item)} /></div>;
      })}
      {marquee && <div className="selection-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
      {handDrop && <div className="stack-drop-hint hand-drop-hint" role="status" style={{ left: Math.min(handDrop.x + 18, window.innerWidth - 285), top: Math.max(12, handDrop.y - 62) }}>
        <strong>Release to insert into hand</strong>
        <span>Position {handDrop.index + 1} · Hold Alt to place on table instead</span>
      </div>}
      {dropHint && <div className={`stack-drop-hint ${altDown ? 'stack-bypassed' : ''}`} role="status" style={{ left: Math.min(dropHint.x + 18, window.innerWidth - 285), top: Math.max(12, dropHint.y - 62) }}>
        <strong>{altDown ? 'Stacking off — release to move' : 'Release to add to stack'}</strong>
        <span>{altDown ? 'Release Alt to stack instead' : 'Hold Alt to move without stacking'}</span>
      </div>}
    </>, document.body)}
    {inspectorVisible && <PanelSeparator label="Resize table inspector" controls="playground-inspector-panel" value={panels.sizes.playgroundInspector} {...panels.limits.playgroundInspector} direction={-1} onResize={value => panels.resize('playgroundInspector', value)} />}
    <aside id="playground-inspector-panel" className="inspector playground-inspector" style={{ width: panels.sizes.playgroundInspector, minWidth: 0, flex: `0 0 ${panels.sizes.playgroundInspector}px` }} hidden={!inspectorVisible}>
      <HorizontalScroll contentClassName="inspector-tabs" label="Table inspector tabs"><button className={panel === 'selection' ? 'active' : ''} onClick={() => setPanel('selection')}><MousePointer2 size={14} /> Selection</button><button className={panel === 'table' ? 'active' : ''} onClick={() => setPanel('table')}><Settings2 size={14} /> Table</button><button className={panel === 'players' ? 'active' : ''} onClick={() => setPanel('players')}><Users size={14} /> Players <span>{p.players.length}</span></button></HorizontalScroll>
      <div className="inspector-scroll">{panel === 'players' ? <>
        <div className="inspector-section"><div className="section-title"><h3>Around the table</h3><span className="pill">Hotseat</span></div>
          <p className="help-text">No fixed player limit. Add seats for everyone sharing this screen.</p>
          <div className="player-list">{p.players.map(player => <div key={player.id} className={`player-row ${actor === player.id ? 'active' : ''}`}>
            <button onClick={() => onSwitch(player)}><span className="mini-avatar" style={{ background: player.color }}>{player.name[0]}</span><span>{player.name}<small>{player.owner === owner || owner === 'local' ? actor === player.id ? 'Active seat' : 'Switch to this seat' : 'Remote player'}</small></span></button>
            {(owner === 'local' || owner === player.owner) && <button className="icon-button" title={`Edit ${player.name}`} onClick={() => setSeatEditor({ ...player })}><Settings2 size={14} /></button>}
          </div>)}</div>
          <button className="button full" onClick={() => setSeatEditor({ id: uid('player'), owner, name: `Player ${p.players.length + 1}`, color: ['#b7cc91', '#ce9e7b', '#93b9ce', '#c4a4d5'][p.players.length % 4], x: 600 + p.players.length * 120, y: 1000, rotation: 0 })}><Plus size={15} /> Add hotseat player</button>
        </div>
      </> : panel === 'selection' ? <>
        {piece && c ? <div className="inspector-section selected-inspector"><div className="section-title"><h3>{items.length > 1 ? 'Stack selected' : `${selected.length > 1 ? selected.length + ' pieces' : 'Component'} selected`}</h3><button className="icon-button" title="Deselect" onClick={() => setSelected([])}><X size={14} /></button></div>
          <div className="selected-component"><ComponentThumbnail component={c} components={p.components} row={piece.row} width={52} /><div><strong>{selected.length > 1 ? `${selected.length} pieces selected` : c.name}</strong><small>{items.length > 1 ? `${items.length} in stack` : c.kind}</small><button className="text-button" onClick={() => onEdit(c.id)}>Edit design <ChevronRight size={12} /></button></div></div>
          <div className="action-grid">
            <button disabled={!selectedPieces.some(i => p.components.find(c => c.id === i.componentId)?.flippable)} onClick={flip}><FlipHorizontal2 size={17} /><span>Flip<kbd>F</kbd></span></button>
            <button onClick={() => rotate(-90)}><RotateCcw size={17} /><span>Rotate −90°<kbd>Q</kbd></span></button>
            <button onClick={() => rotate(90)}><RotateCw size={17} /><span>Rotate +90°<kbd>E</kbd></span></button>
            <button onClick={() => clone()}><Copy size={17} /><span>Clone</span></button>
            <button onClick={() => dispatch({ type: 'drawSelection', ids: selected, playerId: actor })} disabled={!p.settings.hands || selectedPieces.some(i => i.holder || !p.components.find(c => c.id === i.componentId)?.hand)}><Hand size={17} /><span>Draw to hand</span></button>
            <button onClick={() => dispatch({ type: 'move', ids: selected, patch: { locked: !piece.locked } })}>{piece.locked ? <UnlockKeyhole size={17} /> : <LockKeyhole size={17} />}<span>{piece.locked ? 'Unlock' : 'Lock'}</span></button>
            <button className="danger" onClick={() => { dispatch({ type: 'delete', ids: selected }); setSelected([]); }}><Trash2 size={17} /><span>Delete</span></button>
          </div>
          <div className="field-grid"><NumberField label="Rotation" value={piece.rotation} onChange={rotation => dispatch({ type: 'transform', ids: selected, rotation: rotation - piece.rotation })} /><NumberField label="Scale" value={piece.scale} min={.1} max={5} step={.1} onChange={scale => dispatch({ type: 'transform', ids: selected, scaleFactor: scale / piece.scale })} /></div>
          {selected.length > 1 && <button className="button full" onClick={() => dispatch({ type: 'stack', ids: selected, stackId: uid('stack') })}><Layers size={15} /> Stack selected pieces</button>}
          {items.length > 1 && <div className="stack-actions"><button className="button" onClick={() => { setSearch(items.map(i => i.id)); setQuery(''); }}><Search size={14} /> Search stack</button>
            <button className="button" disabled={!items.every(i => p.components.find(c => c.id === i.componentId)?.shufflable)} onClick={() => { void dispatch({ type: 'shuffle', id: piece.id, seed: crypto.getRandomValues(new Uint32Array(1))[0] }).then(success => { if (success) notify('A fresh shuffle. A new possibility.'); }); }}><Shuffle size={14} /> Shuffle</button>
            <button className="button full" onClick={() => dispatch({ type: 'unstack', id: piece.id })}><Layers size={14} /> Spread stack</button></div>}
          {c.kind === 'dice' && <button className="button full" onClick={() => dispatch({ type: 'roll', ids: [piece.id], seed: crypto.getRandomValues(new Uint32Array(1))[0] })}><Dices size={16} /> Roll die</button>}
        </div> : <div className="inspector-section table-intro"><div className="intro-icon"><MousePointer2 size={23} /></div><h3>No component selected</h3><p>Select a component on the table or in your hand to see its settings and actions.</p></div>}
      </> : <>
        <div className="inspector-section"><div className="section-title"><h3>Table settings</h3><Settings2 size={14} /></div>
          <Toggle label="Show grid" checked={p.settings.grid} onChange={grid => dispatch({ type: 'settings', patch: { grid } })} />
          <Toggle label="Snap to grid" checked={p.settings.snap} onChange={snap => dispatch({ type: 'settings', patch: { snap } })} />
          {p.settings.snap && <NumberField label="Grid size (px)" value={p.settings.gridSize} min={5} max={200} onChange={gridSize => dispatch({ type: 'settings', patch: { gridSize } })} />}
          <Toggle label="Player hands" description="Keep a little mystery" checked={p.settings.hands} onChange={hands => dispatch({ type: 'settings', patch: { hands } })} />
          <Toggle label="Turn tracker" checked={p.settings.turns} onChange={turns => dispatch({ type: 'settings', patch: { turns } })} />
          {p.settings.turns && <div className="turn-tracker"><span>UP NEXT</span><strong>{p.players[p.settings.turn % Math.max(p.players.length, 1)]?.name ?? 'Add a player'}</strong><button className="button full primary" onClick={() => dispatch({ type: 'settings', patch: { turn: (p.settings.turn + 1) % Math.max(p.players.length, 1) } })}>End turn <ChevronRight size={15} /></button></div>}
        </div>
        <div className="inspector-section"><div className="section-title"><h3>Around the table</h3><button className="text-button" onClick={() => setPanel('players')}>Manage</button></div>
          <div className="avatar-stack">{p.players.slice(0, 7).map(player => <button key={player.id} title={player.name} onClick={() => onSwitch(player)} style={{ background: player.color }}>{player.name[0]}</button>)}<button className="add-avatar" aria-label="Manage players" onClick={() => setPanel('players')}><Plus size={14} /></button></div>
          <p className="help-text">{p.players.length} players. One shared imagination.</p>
        </div>
        <div className="table-tip"><span>MADE FOR THE MESSY MIDDLE</span><p>Try a rule. Break a rule.<br />Make something worth playing.</p><span className="tip-sparkle">✳</span></div>
      </>}</div>
    </aside>
    {search && <Modal title="Inside the stack" subtitle="Search, draw a specific card, or reorder from bottom to top." wide onClose={() => setSearch(undefined)}>
      <div className="stack-search"><div className="search-input"><Search size={16} /><input placeholder="Find a component..." value={query} onChange={e => setQuery(e.target.value)} /></div>
        <div className="stack-search-list">{!searchedItems.length && <p className="empty-note">Every card has found a hand. This stack is empty.</p>}{searchedItems.map((i, index, all) => {
          const comp = p.components.find(c => c.id === i.componentId)!;
          const name = comp.rows[i.row]?.name ?? comp.name;
          if (!`${name} ${comp.name}`.toLowerCase().includes(query.toLowerCase())) return null;
          const reorder = (offset: number) => { const ids = all.map(i => i.id); [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]]; dispatch({ type: 'reorder', ids: i.stackReversed ? ids.reverse() : ids }); };
          return <div className="stack-search-row" key={i.id}><ComponentThumbnail component={comp} components={p.components} row={i.row} back={visibleBack(i)} width={43} /><div><strong>{name}</strong><small>{index === all.length - 1 ? 'Top of stack' : `Position ${index + 1}`} · {comp.name}</small></div>
            <button className="icon-button" aria-label={`Move ${name} down`} disabled={!index || !i.stack} onClick={() => reorder(-1)}><ArrowDown size={16} /></button><button className="icon-button" aria-label={`Move ${name} up`} disabled={index === all.length - 1 || !i.stack} onClick={() => reorder(1)}><ArrowUp size={16} /></button>
            <button className="button" disabled={!comp.hand || !p.settings.hands} onClick={() => {
              const ids = all.map(item => item.id).filter(id => id !== i.id); ids.push(i.id);
              if (i.stack) void dispatch({ type: 'reorder', ids: i.stackReversed ? ids.reverse() : ids }).then(ok => { if (ok) void dispatch({ type: 'draw', id: i.id, playerId: actor }); });
              else void dispatch({ type: 'draw', id: i.id, playerId: actor });
            }}>Draw</button>
          </div>;
        })}</div></div>
    </Modal>}
    {seatEditor && <Modal title="A seat at the table" subtitle="Your name, your color, your little corner of the world." onClose={() => setSeatEditor(undefined)}>
      <form className="seat-form" onSubmit={e => { e.preventDefault(); dispatch({ type: 'player', player: seatEditor }); setSeatEditor(undefined); }}>
        <Field label="Player name"><input required maxLength={50} value={seatEditor.name} onChange={e => setSeatEditor({ ...seatEditor, name: e.target.value })} /></Field>
        <ColorField label="Player color" value={seatEditor.color} onChange={color => setSeatEditor({ ...seatEditor, color })} />
        <div className="field-grid"><NumberField label="Seat X" value={seatEditor.x} onChange={x => setSeatEditor({ ...seatEditor, x })} /><NumberField label="Seat Y" value={seatEditor.y} onChange={y => setSeatEditor({ ...seatEditor, y })} /></div>
        <NumberField label="Seat rotation" value={seatEditor.rotation} onChange={rotation => setSeatEditor({ ...seatEditor, rotation })} />
        <p className="help-text">Seats and hands persist with the playground. The same SpaceTimeDB identity returns to its saved seats.</p>
        <div className="modal-actions"><button className="button primary" type="submit">Save seat</button></div>
      </form>
    </Modal>}
  </div>;
}
