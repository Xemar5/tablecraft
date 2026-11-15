import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, ChevronRight, Copy, Dices, Eye, EyeOff, FlipHorizontal2, Grid2X2, Hand, Layers, LockKeyhole, Maximize, Minus, MousePointer2, Plus, RotateCw, Search, Settings2, Shuffle, Trash2, UnlockKeyhole, Users, X } from 'lucide-react';
import { ComponentThumbnail, ComponentView } from './ComponentView';
import { canStack, makeInstance, stackMembers, uid, type Command, type Instance, type Player, type Project } from './domain';
import { Field, Modal, NumberField, Toggle } from './ui';

type Props = {
  project: Project; actor: string; owner: string; selected: string[]; setSelected: (ids: string[]) => void;
  dispatch: (command: Command) => Promise<boolean>; onEdit: (id: string) => void;
  onSwitch: (player: Player) => void; notify: (message: string, error?: boolean) => void;
  inspectorVisible: boolean;
  onShowInspector: () => void;
};
export function Playground({ project: p, actor, owner, selected, setSelected, inspectorVisible, onShowInspector, dispatch, onEdit, onSwitch, notify }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const handScroller = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(.65);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [camera, setCamera] = useState(0);
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  const [preview, setPreview] = useState<Record<string, { x: number; y: number }>>({});
  const [panel, setPanel] = useState<'table' | 'players'>('table');
  const [search, setSearch] = useState<string[]>();
  const [query, setQuery] = useState('');
  const [seatEditor, setSeatEditor] = useState<Player>();
  const [hovered, setHovered] = useState<string>();
  const [handHidden, setHandHidden] = useState(false);
  const [handDrag, setHandDrag] = useState<{ id: string; x: number; y: number }>();
  const [insertion, setInsertion] = useState<number>();
  const [dropHint, setDropHint] = useState<{ id: string; x: number; y: number }>();
  const [altDown, setAltDown] = useState(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number }>();
  const marqueeGesture = useRef<{ x: number; y: number; ids: string[] }>(null);
  const handGesture = useRef<{ pointer: number; id: string; x: number; y: number }>(null);
  const gesture = useRef<{ pointer: number; x: number; y: number; positions: Record<string, { x: number; y: number }>; pan?: { x: number; y: number } }>(null);
  const piece = p.instances.find(i => i.id === selected.at(-1));
  const c = p.components.find(c => c.id === piece?.componentId);
  const currentPlayer = p.players.find(player => player.id === actor);
  const held = p.instances.filter(i => i.holder === actor).sort((a, b) => a.order - b.order);
  const items = piece ? stackMembers(p, piece) : [];
  const searchedItems = p.instances.filter(i => search?.includes(i.id) && !i.holder).sort((a, b) => a.order - b.order);
  const topPieces = p.instances.filter(i => !i.holder && (!i.stack || stackMembers(p, i).at(-1)?.id === i.id));
  const selectedPieces = p.instances.filter(i => selected.includes(i.id));
  useEffect(() => {
    const element = handScroller.current;
    if (!element) return;
    const scroll = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      e.preventDefault();
      element.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    };
    element.addEventListener('wheel', scroll, { passive: false });
    return () => element.removeEventListener('wheel', scroll);
  }, [p.settings.hands]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltDown(e.type === 'keydown'); };
    const blur = () => setAltDown(false);
    window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', blur); };
  }, []);

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
  const changeZoom = (next: number) => {
    const z = Math.max(.15, Math.min(2, next));
    const rect = viewport.current?.getBoundingClientRect();
    if (rect) setPan({ x: rect.width / 2 - (rect.width / 2 - pan.x) * z / zoom, y: rect.height / 2 - (rect.height / 2 - pan.y) * z / zoom });
    setZoom(z);
  };
  const worldDelta = (dx: number, dy: number) => {
    const angle = -camera * Math.PI / 180;
    return { x: (dx * Math.cos(angle) - dy * Math.sin(angle)) / zoom, y: (dx * Math.sin(angle) + dy * Math.cos(angle)) / zoom };
  };
  const worldPoint = (x: number, y: number) => {
    const rect = viewport.current!.getBoundingClientRect();
    return worldDelta(x - rect.left - pan.x, y - rect.top - pan.y);
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
  const compatible = (target: Instance, moving: Instance[]) =>
    [...stackMembers(p, target), ...moving].every(i => !i.locked) &&
    canStack([...stackMembers(p, target), ...moving].map(i => p.components.find(c => c.id === i.componentId)!));
  const showDropHint = (x: number, y: number, moving: Instance[], alt: boolean) => {
    const target = targetAt(x, y, moving.map(i => i.id));
    setAltDown(alt);
    setDropHint(target && moving.length && compatible(target, moving) ? { id: target.id, x, y } : undefined);
  };
  const handInsertion = (x: number, y: number, dragged: string) => {
    const scroller = handScroller.current;
    if (!scroller) return undefined;
    const rect = scroller.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return undefined;
    if (x < rect.left + 28) scroller.scrollLeft -= 18;
    if (x > rect.right - 28) scroller.scrollLeft += 18;
    const cards = [...scroller.querySelectorAll<HTMLElement>('[data-hand-id]')].filter(el => el.dataset.handId !== dragged);
    const index = cards.findIndex(el => { const r = el.getBoundingClientRect(); return x < r.left + r.width / 2; });
    return index < 0 ? cards.length : index;
  };
  const clone = (ids = selected) => {
    if (!ids.length) return;
    const originals = p.instances.filter(i => ids.includes(i.id));
    if (originals.some(i => i.holder && i.holder !== actor)) { notify("You can't clone another player's hand.", true); return; }
    const copies = originals.map(i => ({ ...i, id: uid('piece'), x: i.x + 45, y: i.y + 45, stack: null, holder: null, locked: false }));
    dispatch({ type: 'spawn', instances: copies }); setSelected(copies.map(i => i.id));
  };
  const flip = () => { if (piece) dispatch({ type: 'transform', ids: selected, flip: true }); };
  const rotate = () => { if (piece) dispatch({ type: 'transform', ids: selected, rotation: 90 }); };
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
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'f' && shortcutPiece) dispatch({ type: 'transform', ids: shortcutIds, flip: true });
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'r' && shortcutPiece) dispatch({ type: 'transform', ids: shortcutIds, rotation: 90 });
      if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && shortcutPiece && !shortcutPiece.holder) {
        e.preventDefault();
        const count = e.key === '0' ? 10 : Number(e.key);
        dispatch(count === 1 ? { type: 'draw', id: shortcutPiece.id, playerId: actor } : { type: 'drawMany', id: shortcutPiece.id, playerId: actor, count });
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); dispatch({ type: 'delete', ids: shortcutIds }); setSelected([]); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); clone(shortcutIds); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  const startPiece = (e: React.PointerEvent, item: Instance) => {
    if (tool === 'pan' || e.button === 1) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    const group = stackMembers(p, item).map(i => i.id);
    const extending = e.shiftKey || e.ctrlKey || e.metaKey;
    const ids = extending ? selected.includes(item.id) ? selected.filter(id => !group.includes(id)) : [...new Set([...selected, ...group])] : selected.includes(item.id) ? selected : group;
    setSelected(ids);
    if (!ids.includes(item.id)) return;
    if (item.locked) return;
    const positions = Object.fromEntries(p.instances.filter(i => ids.includes(i.id) && !i.locked && !i.holder).map(i => [i.id, { x: i.x, y: i.y }]));
    gesture.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, positions };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const endGesture = (e: React.PointerEvent) => {
    if (marqueeGesture.current) {
      marqueeGesture.current = null; setMarquee(undefined);
    }
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    if (!g.pan && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 3) {
      const moving = Object.keys(g.positions).map(id => p.instances.find(i => i.id === id)!).sort((a, b) => a.order - b.order);
      const tray = document.querySelector('.hand-tray')?.getBoundingClientRect();
      const seat = document.querySelector(`[data-seat-id="${CSS.escape(actor)}"]`)?.getBoundingClientRect();
      const inside = (r?: DOMRect) => r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if ((inside(tray) || inside(seat)) && moving.length) {
        dispatch({ type: 'drawSelection', ids: moving.map(i => i.id), playerId: actor });
        gesture.current = null; setPreview({}); setDropHint(undefined); return;
      }
      const target = targetAt(e.clientX, e.clientY, Object.keys(g.positions));
      if (!e.altKey && target && moving.length && compatible(target, moving)) {
        void dispatch({ type: 'dropStack', ids: moving.map(i => i.id), targetId: target.id, stackId: uid('stack') })
          .then(ok => { if (ok) setSelected([...stackMembers(p, target), ...moving].map(i => i.id)); });
        gesture.current = null; setPreview({}); setDropHint(undefined); return;
      }
      const delta = worldDelta(e.clientX - g.x, e.clientY - g.y);
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
    <section className="table-section">
      <div ref={viewport} className={`table-viewport ${tool === 'pan' ? 'pan-mode' : ''}`}
        onContextMenu={e => e.preventDefault()}
        onWheel={e => { if (e.ctrlKey) e.preventDefault(); changeZoom(zoom * (e.deltaY > 0 ? .92 : 1.08)); }}
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
            const delta = worldDelta(e.clientX - g.x, e.clientY - g.y);
            setPreview(Object.fromEntries(Object.entries(g.positions).map(([id, pos]) => [id, { x: pos.x + delta.x, y: pos.y + delta.y }])));
            showDropHint(e.clientX, e.clientY, p.instances.filter(i => i.id in g.positions), e.altKey);
          }
        }}
        onPointerUp={endGesture}
        onPointerCancel={() => { gesture.current = null; setPreview({}); setDropHint(undefined); marqueeGesture.current = null; setMarquee(undefined); }}>
        <div className={`table-world ${p.settings.grid ? 'show-grid' : ''}`} style={{
          transform: `translate(${pan.x}px, ${pan.y}px) rotate(${camera}deg) scale(${zoom})`,
          backgroundSize: `${p.settings.gridSize}px ${p.settings.gridSize}px`,
        }}>
          <div className="table-watermark"><span>W</span><p>THE WILDWOOD</p><small>A PLACE FOR YOUR NEXT GREAT IDEA</small></div>
          {p.settings.hands && p.players.map(player => <button key={player.id} data-seat-id={player.id} title={`Switch to ${player.name}`} className={`seat-marker ${player.id === actor ? 'active' : ''}`}
            onPointerDown={e => e.stopPropagation()} onClick={() => onSwitch(player)}
            style={{ left: player.x, top: player.y, '--player-color': player.color, transform: `translate(-50%, -50%) rotate(${player.rotation}deg)` } as React.CSSProperties}>
            <span className="seat-avatar">{player.name.slice(0, 1).toUpperCase()}</span><strong>{player.name}</strong>
            <span>{p.instances.filter(i => i.holder === player.id).length} cards</span>
            <div className="other-hand" aria-label={`${player.name}'s hand`}>
              {p.instances.filter(i => i.holder === player.id).sort((a, b) => a.order - b.order).map((i, index) => {
                const comp = p.components.find(c => c.id === i.componentId)!;
                return <div key={i.id} style={{ transform: `rotate(${(index - (p.instances.filter(i => i.holder === player.id).length - 1) / 2) * 5}deg)` }}>
                  <ComponentThumbnail component={comp} row={i.row} hidden={player.id === actor ? handHidden : comp.hideInHand} width={44} />
                </div>;
              })}
            </div>
          </button>)}
          {topPieces.map(item => {
            const comp = p.components.find(c => c.id === item.componentId)!;
            const members = stackMembers(p, item);
            const position = preview[item.id] ?? item;
            return <div key={item.id} className={`table-piece ${selected.includes(item.id) ? 'selected' : ''} ${item.locked ? 'locked' : ''} ${preview[item.id] ? 'dragging drag-source' : ''} ${dropHint?.id === item.id && !altDown ? 'stack-drop-target' : ''}`}
              data-testid="table-piece" data-piece-id={item.id}
              style={{ left: position.x, top: position.y, width: comp.width, height: comp.height, zIndex: comp.kind === 'board' ? 0 : selected.includes(item.id) ? 100 : 2,
                transform: `translate(-50%, -50%) rotate(${item.rotation}deg) scale(${item.scale})` }}
              onPointerDown={e => startPiece(e, item)}
              onPointerEnter={() => setHovered(item.id)} onPointerLeave={() => setHovered(undefined)}
              onFocus={() => setHovered(item.id)} onBlur={() => setHovered(undefined)} tabIndex={0} role="button" aria-label={`${comp.name}${members.length > 1 ? `, stack of ${members.length}` : ''}`}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); const ids = members.map(i => i.id); setSelected(e.shiftKey ? [...new Set([...selected, ...ids])] : ids); } }}
              onDoubleClick={e => { e.stopPropagation(); if (members.length > 1) dispatch({ type: 'draw', id: item.id, playerId: actor }); else if (comp.flippable) dispatch({ type: 'move', ids: [item.id], patch: { flipped: !item.flipped } }); }}>
              {members.length > 1 && <><div className="stack-shadow stack-shadow-2" /><div className="stack-shadow stack-shadow-1" /></>}
              <ComponentView component={comp} row={item.row} back={item.flipped} />
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
        {hovered && !gesture.current && (() => {
          const item = p.instances.find(i => i.id === hovered && (!i.holder || i.holder === actor));
          const comp = p.components.find(c => c.id === item?.componentId);
          return item && comp ? <div className="hover-preview" aria-label={`Preview ${comp.name}`}><ComponentThumbnail component={comp} row={item.row} back={item.flipped} width={160} /><strong>{comp.name}</strong></div> : null;
        })()}
        <div className="table-hint">Drag to move <span /> Shift + click to select multiple <span /> Double-click to flip or draw</div>
      </div>
      {p.settings.hands && <><div className="hand-tray" aria-label={`${currentPlayer?.name ?? 'Your'}'s hand tray`}>
        <div ref={handScroller} className="hand-cards" aria-label="Hand cards">{held.length ? held.map(item => {
         const comp = p.components.find(c => c.id === item.componentId)!;
          const remaining = held.filter(i => i.id !== handDrag?.id);
          return <div key={item.id} className={`hand-entry ${handDrag?.id === item.id ? 'hand-drag-source' : ''} ${insertion !== undefined && remaining[insertion]?.id === item.id ? 'hand-insert-before' : ''}`}><button data-hand-id={item.id} className={`hand-card ${selected.includes(item.id) ? 'hand-selected' : ''}`} title="Drag onto the table to play or onto another card to reorder" aria-label={`Drag ${comp.name} to the table or reorder it in hand`} onClick={e => {
            if (e.shiftKey || e.ctrlKey || e.metaKey) setSelected(selected.includes(item.id) ? selected.filter(id => id !== item.id) : [...selected, item.id]);
          }} onPointerEnter={() => setHovered(item.id)} onPointerLeave={() => setHovered(undefined)} onFocus={() => setHovered(item.id)} onBlur={() => setHovered(undefined)} onPointerDown={e => {
            if (e.button !== 0) return;
            handGesture.current = { pointer: e.pointerId, id: item.id, x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }} onPointerMove={e => {
            const g = handGesture.current;
            if (g && g.pointer === e.pointerId && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 3) {
              setHandDrag({ id: item.id, x: e.clientX, y: e.clientY });
              setInsertion(handInsertion(e.clientX, e.clientY, item.id));
              showDropHint(e.clientX, e.clientY, [item], e.altKey);
            }
          }} onPointerCancel={() => { handGesture.current = null; setHandDrag(undefined); setInsertion(undefined); setDropHint(undefined); }} onPointerUp={e => {
            const g = handGesture.current;
            if (!g || g.pointer !== e.pointerId) return;
            handGesture.current = null; setHandDrag(undefined); setInsertion(undefined); setDropHint(undefined);
            if (Math.hypot(e.clientX - g.x, e.clientY - g.y) <= 3) return;
            const index = handInsertion(e.clientX, e.clientY, item.id);
            if (index !== undefined) {
              const ids = held.filter(i => i.id !== item.id).map(i => i.id);
              ids.splice(index, 0, item.id);
              dispatch({ type: 'reorderHand', ids, playerId: actor });
            } else {
              const rect = viewport.current?.getBoundingClientRect();
              if (!rect || e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
              let { x, y } = worldPoint(e.clientX, e.clientY);
              if (p.settings.snap) { x = Math.round(x / p.settings.gridSize) * p.settings.gridSize; y = Math.round(y / p.settings.gridSize) * p.settings.gridSize; }
              const target = targetAt(e.clientX, e.clientY, []);
              dispatch(!e.altKey && target && compatible(target, [item]) ? { type: 'dropFromHand', id: item.id, targetId: target.id, stackId: uid('stack') } : { type: 'release', id: item.id, x, y });
            }
          }}>
            <ComponentThumbnail component={comp} row={item.row} width={66} /><span>Drag to play</span></button>
            <div className="hand-order">
              {[-1, 1].map(offset => <button key={offset} type="button" aria-label={`Move ${comp.name} ${offset < 0 ? 'left' : 'right'} in hand`} disabled={held.indexOf(item) + offset < 0 || held.indexOf(item) + offset >= held.length} onClick={() => {
                const ids = held.map(i => i.id), index = ids.indexOf(item.id);
                [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
                dispatch({ type: 'reorderHand', ids, playerId: actor });
              }}>{offset < 0 ? '←' : '→'}</button>)}
            </div></div>;
        }) : <div className="empty-hand"><Copy size={20} /><span>Drag pieces here to take them into your hand.</span></div>}
        {insertion !== undefined && insertion === held.filter(i => i.id !== handDrag?.id).length && <div className="hand-insert-end" aria-label="Insert at end of hand" />}
        </div>
      </div><div className="hand-toolbar" aria-label="Hand actions">
        <button className="icon-button" aria-label={handHidden ? 'Show my table hand' : 'Hide my table hand'} title={handHidden ? 'Show my table hand' : 'Hide my table hand'} aria-pressed={handHidden} onClick={() => setHandHidden(!handHidden)}>{handHidden ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        <button className="icon-button" aria-label="Shuffle hand" title="Shuffle hand" disabled={held.length < 2} onClick={shuffleHand}><Shuffle size={16} /></button>
        <button className="icon-button" aria-label="Reverse hand" title="Reverse hand" disabled={held.length < 2} onClick={() => dispatch({ type: 'reorderHand', ids: held.map(i => i.id).reverse(), playerId: actor })}><FlipHorizontal2 size={16} /></button>
        <button className="icon-button" aria-label="Switch seat" title="Switch seat" onClick={() => { setPanel('players'); onShowInspector(); }}><Users size={16} /></button>
      </div></>}
      {handDrag && (() => {
        const item = held.find(i => i.id === handDrag.id);
        const comp = p.components.find(c => c.id === item?.componentId);
        return item && comp ? <div className="hand-drag-preview" style={{ left: handDrag.x, top: handDrag.y }} aria-hidden="true"><ComponentThumbnail component={comp} row={item.row} width={66} /></div> : null;
      })()}
      <footer className="table-status"><span>{p.instances.length} pieces on the table</span><span>{p.settings.snap ? `Snapping to ${p.settings.gridSize}px` : 'Free movement'}<span className="status-divider">/</span>{p.players.length} players<span className="status-divider">/</span>2D playground</span></footer>
    </section>
    {createPortal(<>
      {topPieces.filter(i => preview[i.id]).map(item => {
        const comp = p.components.find(c => c.id === item.componentId)!;
        const position = preview[item.id], rect = viewport.current!.getBoundingClientRect();
        const angle = camera * Math.PI / 180;
        return <div key={item.id} className="board-drag-preview" aria-hidden="true" style={{
          left: rect.left + pan.x + zoom * (position.x * Math.cos(angle) - position.y * Math.sin(angle)),
          top: rect.top + pan.y + zoom * (position.x * Math.sin(angle) + position.y * Math.cos(angle)),
          width: comp.width, height: comp.height,
          transform: `translate(-50%, -50%) rotate(${camera + item.rotation}deg) scale(${zoom * item.scale})`,
        }}><ComponentView component={comp} row={item.row} back={item.flipped} /></div>;
      })}
      {marquee && <div className="selection-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
      {dropHint && <div className={`stack-drop-hint ${altDown ? 'stack-bypassed' : ''}`} role="status" style={{ left: Math.min(dropHint.x + 18, window.innerWidth - 285), top: Math.max(12, dropHint.y - 62) }}>
        <strong>{altDown ? 'Stacking off — release to move' : 'Release to add to stack'}</strong>
        <span>{altDown ? 'Release Alt to stack instead' : 'Hold Alt to move without stacking'}</span>
      </div>}
    </>, document.body)}
    <aside className="inspector playground-inspector" hidden={!inspectorVisible}>
      <div className="inspector-tabs"><button className={panel === 'table' ? 'active' : ''} onClick={() => setPanel('table')}><Settings2 size={14} /> Table</button><button className={panel === 'players' ? 'active' : ''} onClick={() => setPanel('players')}><Users size={14} /> Players <span>{p.players.length}</span></button></div>
      <div className="inspector-scroll">{panel === 'players' ? <>
        <div className="inspector-section"><div className="section-title"><h3>Around the table</h3><span className="pill">Hotseat</span></div>
          <p className="help-text">No fixed player limit. Add seats for everyone sharing this screen.</p>
          <div className="player-list">{p.players.map(player => <div key={player.id} className={`player-row ${actor === player.id ? 'active' : ''}`}>
            <button onClick={() => onSwitch(player)}><span className="mini-avatar" style={{ background: player.color }}>{player.name[0]}</span><span>{player.name}<small>{player.owner === owner || owner === 'local' ? actor === player.id ? 'Active seat' : 'Switch to this seat' : 'Remote player'}</small></span></button>
            {(owner === 'local' || owner === player.owner) && <button className="icon-button" title={`Edit ${player.name}`} onClick={() => setSeatEditor({ ...player })}><Settings2 size={14} /></button>}
          </div>)}</div>
          <button className="button full" onClick={() => setSeatEditor({ id: uid('player'), owner, name: `Player ${p.players.length + 1}`, color: ['#b7cc91', '#ce9e7b', '#93b9ce', '#c4a4d5'][p.players.length % 4], x: 600 + p.players.length * 120, y: 1000, rotation: 0 })}><Plus size={15} /> Add hotseat player</button>
        </div>
      </> : <>
        {piece && c ? <div className="inspector-section selected-inspector"><div className="section-title"><h3>{items.length > 1 ? 'Stack selected' : `${selected.length > 1 ? selected.length + ' pieces' : 'Component'} selected`}</h3><button className="icon-button" title="Deselect" onClick={() => setSelected([])}><X size={14} /></button></div>
          <div className="selected-component"><ComponentThumbnail component={c} row={piece.row} width={52} /><div><strong>{selected.length > 1 ? `${selected.length} pieces selected` : c.name}</strong><small>{items.length > 1 ? `${items.length} in stack` : c.kind}</small><button className="text-button" onClick={() => onEdit(c.id)}>Edit design <ChevronRight size={12} /></button></div></div>
          <div className="action-grid">
            <button disabled={!selectedPieces.some(i => p.components.find(c => c.id === i.componentId)?.flippable)} onClick={flip}><FlipHorizontal2 size={17} /><span>Flip<kbd>F</kbd></span></button>
            <button onClick={rotate}><RotateCw size={17} /><span>Rotate<kbd>R</kbd></span></button>
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
          {c.kind === 'dice' && <button className="button full" onClick={() => {
            const next = { ...makeInstance(c.id, Math.floor(Math.random() * Math.max(c.rows.length, 1)), piece.x, piece.y), rotation: Math.floor(Math.random() * 4) * 90, scale: piece.scale };
            dispatch({ type: 'spawn', instances: [next] }); dispatch({ type: 'delete', ids: [piece.id] }); setSelected([next.id]);
          }}><Dices size={16} /> Roll die</button>}
        </div> : <div className="inspector-section table-intro"><div className="intro-icon"><MousePointer2 size={23} /></div><h3>A space to play.</h3><p>Select a piece to flip, clone, stack or make it your own.</p></div>}
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
          const reorder = (offset: number) => { const ids = all.map(i => i.id); [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]]; dispatch({ type: 'reorder', ids }); };
          return <div className="stack-search-row" key={i.id}><ComponentThumbnail component={comp} row={i.row} width={43} /><div><strong>{name}</strong><small>{index === all.length - 1 ? 'Top of stack' : `Position ${index + 1}`} · {comp.name}</small></div>
            <button className="icon-button" aria-label={`Move ${name} down`} disabled={!index || !i.stack} onClick={() => reorder(-1)}><ArrowDown size={16} /></button><button className="icon-button" aria-label={`Move ${name} up`} disabled={index === all.length - 1 || !i.stack} onClick={() => reorder(1)}><ArrowUp size={16} /></button>
            <button className="button" disabled={!comp.hand || !p.settings.hands} onClick={() => {
              const ids = all.map(item => item.id).filter(id => id !== i.id); ids.push(i.id);
              if (i.stack) dispatch({ type: 'reorder', ids });
              dispatch({ type: 'draw', id: i.id, playerId: actor });
            }}>Draw</button>
          </div>;
        })}</div></div>
    </Modal>}
    {seatEditor && <Modal title="A seat at the table" subtitle="Your name, your color, your little corner of the world." onClose={() => setSeatEditor(undefined)}>
      <form className="seat-form" onSubmit={e => { e.preventDefault(); dispatch({ type: 'player', player: seatEditor }); setSeatEditor(undefined); }}>
        <Field label="Player name"><input required maxLength={50} value={seatEditor.name} onChange={e => setSeatEditor({ ...seatEditor, name: e.target.value })} /></Field>
        <Field label="Player color"><input type="color" value={seatEditor.color} onChange={e => setSeatEditor({ ...seatEditor, color: e.target.value })} /></Field>
        <div className="field-grid"><NumberField label="Seat X" value={seatEditor.x} onChange={x => setSeatEditor({ ...seatEditor, x })} /><NumberField label="Seat Y" value={seatEditor.y} onChange={y => setSeatEditor({ ...seatEditor, y })} /></div>
        <NumberField label="Seat rotation" value={seatEditor.rotation} onChange={rotation => setSeatEditor({ ...seatEditor, rotation })} />
        <p className="help-text">Seats and hands persist with the playground. The same SpaceTimeDB identity returns to its saved seats.</p>
        <div className="modal-actions"><button className="button primary" type="submit">Save seat</button></div>
      </form>
    </Modal>}
  </div>;
}
