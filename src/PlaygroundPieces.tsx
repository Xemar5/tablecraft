import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { BookOpen, ChevronDown, ChevronRight, Circle, Folder, FolderOpen, Layers, LockKeyhole, Palette, Square } from 'lucide-react';
import { groupAncestors, type Command, type Component, type Project } from './domain';
import { variantLabels } from './csv';
import { groupSelection, pieceTree, type PieceTreeRow } from './pieceGroups';

const kindIcon = (component?: Component) => component?.kind === 'card' ? <Layers size={14} /> : component?.kind === 'token' ? <Circle size={14} />
  : component?.kind === 'artwork' ? <Palette size={14} /> : component?.kind === 'book' ? <BookOpen size={14} /> : <Square size={14} />;
const DRAG_TYPE = 'application/x-tablecraft-pieces';

type DropMode = 'above' | 'below' | 'inside';

/**
 * Lists the pieces on the table, topmost first, inside their (nestable) groups. Stacks expand into their members.
 * Clicking a group selects every piece in it; the standard click / Ctrl-click / Shift-click selection applies to all rows.
 * Groups are renamed by double-clicking them. Dragging a row onto the top or bottom of another row places it above or
 * below that row, in the same group and in render order on the table (a group moves as one block); dropping on the
 * middle of a group puts it inside. Alt+Up/Down moves the focused row past its neighbour.
 */
export function PlaygroundPieces({ project: p, selected, onSelect, dispatch, readOnly = false }: {
  project: Project; selected: string[]; onSelect: (ids: string[]) => void;
  dispatch: (command: Command) => Promise<boolean>; readOnly?: boolean;
}) {
  const [expandedStacks, setExpandedStacks] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string>();
  const [dragging, setDragging] = useState<{ ids: string[]; groups: string[] }>();
  // null is the list itself (out of every group); otherwise a row and where the drop lands on it.
  const [dropTarget, setDropTarget] = useState<{ key: string; mode: DropMode } | null>();
  const anchor = useRef<string>(undefined);
  const list = useRef<HTMLDivElement>(null);
  const labels = useMemo(() => Object.fromEntries(p.components.map(component => [component.id, component.rows.length > 1 ? variantLabels(component.csv, component.rows) : []])), [p.components]);
  const rows = useMemo(() => pieceTree(p, collapsedGroups, expandedStacks), [p, collapsedGroups, expandedStacks]);
  const components = useMemo(() => new Map(p.components.map(component => [component.id, component])), [p.components]);
  const chosen = useMemo(() => new Set(selected), [selected]);
  const isActive = (row: PieceTreeRow) => row.ids.length > 0 && row.ids.every(id => chosen.has(id));
  useEffect(() => { list.current?.querySelector('.layer-row.active')?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  const select = (row: PieceTreeRow, event: MouseEvent) => {
    const toggle = event.ctrlKey || event.metaKey;
    const from = event.shiftKey ? rows.findIndex(item => item.key === anchor.current) : -1;
    if (from >= 0) {
      const to = rows.indexOf(row);
      const range = rows.slice(Math.min(from, to), Math.max(from, to) + 1).flatMap(item => item.ids);
      onSelect([...new Set([...(toggle ? selected : []), ...range])]);
      return;
    }
    anchor.current = row.key;
    if (toggle) onSelect(isActive(row) ? selected.filter(id => !row.ids.includes(id)) : [...new Set([...selected, ...row.ids])]);
    else onSelect(row.ids);
  };
  const toggle = (set: (update: (current: ReadonlySet<string>) => ReadonlySet<string>) => void, key: string) =>
    set(current => { const next = new Set(current); if (!next.delete(key)) next.add(key); return next; });
  // A selected row drags the whole selection (its fully selected groups and loose pieces); otherwise just that row.
  const dragUnits = (row: PieceTreeRow) => {
    if (isActive(row)) { const plan = groupSelection(p, selected); if (plan) return { ids: plan.ids, groups: plan.groups }; }
    return row.kind === 'group' ? { ids: [], groups: [row.group.id] } : { ids: row.ids, groups: [] };
  };
  const canDrop = (units: { groups: string[] } | undefined, parent: string | null) => !!units && !units.groups.some(id => groupAncestors(p.groups ?? [], parent).includes(id));
  const parentOf = (row: PieceTreeRow) => row.kind === 'group' ? row.group.parent : row.item.group ?? null;
  // Groups take drops in their middle; the outer quarters (or halves, on pieces) place the drop above or below.
  const modeAt = (event: DragEvent, row: PieceTreeRow): DropMode => {
    const box = event.currentTarget.getBoundingClientRect(), at = (event.clientY - box.top) / Math.max(1, box.height);
    return row.kind === 'group' ? at < .28 ? 'above' : at > .72 ? 'below' : 'inside' : at < .5 ? 'above' : 'below';
  };
  const dropParent = (row: PieceTreeRow, mode: DropMode) => mode === 'inside' && row.kind === 'group' ? row.group.id : parentOf(row);
  const place = (units: { ids: string[]; groups: string[] }, row: PieceTreeRow, mode: DropMode) => mode === 'inside' && row.kind === 'group'
    ? dispatch({ type: 'moveToGroup', parent: row.group.id, ids: units.ids, groups: units.groups })
    : dispatch({ type: 'arrangePieces', parent: parentOf(row), ids: units.ids, groups: units.groups, target: row.ids, position: mode === 'below' ? 'below' : 'above' });
  const over = (event: DragEvent, row?: PieceTreeRow) => {
    const mode = row && modeAt(event, row);
    if (!canDrop(dragging, row && mode ? dropParent(row, mode) : null)) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
    setDropTarget(row && mode ? { key: row.key, mode } : null);
  };
  const drop = (event: DragEvent, row?: PieceTreeRow) => {
    const mode = row && modeAt(event, row);
    if (!dragging || !canDrop(dragging, row && mode ? dropParent(row, mode) : null)) return;
    event.preventDefault(); event.stopPropagation();
    void (row && mode ? place(dragging, row, mode) : dispatch({ type: 'moveToGroup', parent: null, ids: dragging.ids, groups: dragging.groups }));
    setDragging(undefined); setDropTarget(undefined);
  };
  // Alt+Up/Down: past the previous or next row at the same level (topmost first, so up is towards the front).
  const nudge = (row: PieceTreeRow, direction: -1 | 1) => {
    const index = rows.indexOf(row);
    let neighbour: PieceTreeRow | undefined;
    for (let at = index + direction; at >= 0 && at < rows.length; at += direction) {
      const candidate = rows[at];
      if (candidate.depth < row.depth) break;
      if (candidate.depth === row.depth && !(candidate.kind === 'piece' && candidate.member)) { neighbour = candidate; break; }
    }
    const units = dragUnits(row);
    if (!neighbour || !canDrop(units, parentOf(neighbour))) return;
    void place(units, neighbour, direction < 0 ? 'above' : 'below').then(ok => {
      if (ok) requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(row.key)}"]`)?.focus());
    });
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, row: PieceTreeRow) => {
    if (readOnly || !event.altKey || event.ctrlKey || event.metaKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    if (row.kind === 'piece' && row.member) return;
    event.preventDefault(); event.stopPropagation();
    nudge(row, event.key === 'ArrowUp' ? -1 : 1);
  };
  return <div ref={list} className={`layer-list piece-tree${dropTarget === null ? ' drop-root' : ''}`} role="tree" aria-label="Table pieces" aria-multiselectable="true"
    onDragOver={event => over(event)} onDrop={event => drop(event)}
    onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(undefined); }}>
    {rows.map(row => {
      const active = isActive(row);
      const target = dropTarget?.key === row.key ? dropTarget.mode : undefined;
      const rowProps = {
        role: 'treeitem', 'aria-level': row.depth + 1, 'aria-selected': active,
        'aria-expanded': row.kind === 'group' || row.count > 1 ? row.expanded : undefined,
        className: `layer-tree-row playground-piece${row.kind === 'group' ? ' piece-group' : ''}${active ? ' active' : ''}${target === 'inside' ? ' group-drop-target' : target ? ` piece-drop-${target}` : ''}`,
        style: { paddingLeft: 8 + row.depth * 14 },
        onDragOver: (event: DragEvent) => over(event, row), onDrop: (event: DragEvent) => drop(event, row),
      };
      const dragProps = readOnly || row.kind === 'piece' && row.member ? {} : {
        draggable: true,
        onDragStart: (event: DragEvent) => { event.dataTransfer.setData(DRAG_TYPE, row.key); event.dataTransfer.effectAllowed = 'move'; setDragging(dragUnits(row)); },
        onDragEnd: () => { setDragging(undefined); setDropTarget(undefined); },
      };
      if (row.kind === 'group') {
        const name = row.group.name;
        return <div key={`group:${row.key}`} {...rowProps}>
          <button className="tree-disclosure" aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${name}`} onClick={() => toggle(setCollapsedGroups, row.group.id)}>
            {row.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {renaming === row.group.id ? <GroupNameEditor name={name} onDone={next => {
            setRenaming(undefined);
            if (next && next !== name) void dispatch({ type: 'renameGroup', id: row.group.id, name: next });
          }} /> : <button className={`layer-row ${active ? 'active' : ''}`} aria-pressed={active} title={`${name} · Double-click to rename`}
            aria-label={`Group ${name}, ${row.count} piece${row.count === 1 ? '' : 's'}`} {...dragProps}
            onClick={event => select(row, event)} onDoubleClick={() => { if (!readOnly) setRenaming(row.group.id); }}
            data-row-key={row.key} onKeyDown={event => { if (event.key === 'F2' && !readOnly) { event.preventDefault(); setRenaming(row.group.id); } else keyDown(event, row); }}>
            {row.expanded ? <FolderOpen size={14} /> : <Folder size={14} />}<span>{name}</span>
            <small className="playground-piece-count">{row.count}</small>
          </button>}
        </div>;
      }
      const component = components.get(row.item.componentId);
      const variant = labels[row.item.componentId]?.[row.item.row];
      const name = `${component?.name ?? 'Missing component'}${row.member || row.count === 1 ? variant ? ` · ${variant}` : '' : ''}`;
      return <div key={row.key} {...rowProps}>
        {row.count > 1 ? <button className="tree-disclosure" aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${component?.name ?? 'stack'} stack`}
          onClick={() => toggle(setExpandedStacks, row.key)}>
          {row.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button> : <span className="tree-disclosure-spacer" aria-hidden="true" />}
        <button className={`layer-row ${active ? 'active' : ''}`} aria-pressed={active} title={name} {...dragProps}
          aria-label={`${name}${row.count > 1 ? `, stack of ${row.count}` : ''}${row.item.locked ? ', locked' : ''}`} onClick={event => select(row, event)}
          data-row-key={row.key} onKeyDown={event => keyDown(event, row)}>
          {kindIcon(component)}<span>{name}</span>
          {row.count > 1 && <small className="playground-piece-count">{row.count}</small>}
          {row.item.locked && <LockKeyhole size={11} className="playground-piece-lock" aria-hidden="true" />}
        </button>
      </div>;
    })}
    {!rows.length && <p className="empty-note">No pieces on the table yet.</p>}
  </div>;
}

function GroupNameEditor({ name, onDone }: { name: string; onDone: (name?: string) => void }) {
  const [value, setValue] = useState(name);
  const finished = useRef(false);
  const finish = (next?: string) => { if (!finished.current) { finished.current = true; onDone(next); } };
  return <input className="group-name-input" aria-label="Group name" autoFocus maxLength={100} value={value}
    onFocus={event => event.currentTarget.select()} onChange={event => setValue(event.target.value)}
    onBlur={() => finish(value.trim())}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(value.trim());
      else if (event.key === 'Escape') finish();
    }} />;
}
