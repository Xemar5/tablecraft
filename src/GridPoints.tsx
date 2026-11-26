import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, LocateFixed, Ungroup } from 'lucide-react';
import { uid } from './domain';
import { pointGroupAncestors, pointTree, ungroupPoints, type Grid, type GridPoint, type PointTreeRow } from './grids';
import { GroupNameEditor } from './PlaygroundPieces';

const DRAG_TYPE = 'application/x-tablecraft-grid-points';
type DropMode = 'above' | 'below' | 'inside';
type Dragged = { point?: string; group?: string };

/** A point's name in lists: its label, or its place among the grid's points. */
export const pointName = (point: GridPoint, index: number) => point.label || `Point ${index + 1}`;

/**
 * The Points panel: while the Grids tool edits a points grid, it takes the Pieces panel's place and lists the grid's
 * snap points inside their (nestable) point groups. Clicking a point selects it on the table and in the grid panel;
 * clicking a group selects the group (new points added on the table go into it, and its points are highlighted).
 * Groups are renamed by double-clicking (or F2). Dragging a row onto the middle of a group puts it inside; onto the top
 * or bottom of a row places it above or below that row, in that row's group; onto the empty list, at the top level.
 */
export function PointsPanel({ grid, point, onSelectPoint, group, onSelectGroup, onChange, readOnly, surface = 'the table' }: {
  grid: Grid; point?: string; onSelectPoint: (id: string | undefined) => void; group?: string; onSelectGroup: (id: string | undefined) => void;
  onChange: (grid: Grid) => Promise<boolean>; readOnly: boolean;
  /** Where points are added: the table, or (for a component's grid in the designer) the canvas. */
  surface?: string;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string>();
  const [dragging, setDragging] = useState<Dragged>();
  const [dropTarget, setDropTarget] = useState<{ key: string; mode: DropMode } | null>();
  const list = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => pointTree(grid, collapsed), [grid, collapsed]);
  const groups = grid.pointGroups ?? [], points = grid.points ?? [];
  const selectedGroup = groups.find(item => item.id === group);
  useEffect(() => { list.current?.querySelector('.layer-row.active')?.scrollIntoView({ block: 'nearest' }); }, [point, group]);

  const parentOf = (row: PointTreeRow) => row.kind === 'group' ? row.group.parent : row.point.group ?? null;
  const modeAt = (event: DragEvent, row: PointTreeRow): DropMode => {
    const box = event.currentTarget.getBoundingClientRect(), at = (event.clientY - box.top) / Math.max(1, box.height);
    return row.kind === 'group' ? at < .28 ? 'above' : at > .72 ? 'below' : 'inside' : at < .5 ? 'above' : 'below';
  };
  const dropParent = (row: PointTreeRow | undefined, mode: DropMode | undefined) => !row ? null : mode === 'inside' && row.kind === 'group' ? row.group.id : parentOf(row);
  // A group can't go into itself or a group inside it.
  const canDrop = (moving: Dragged | undefined, parent: string | null) => !!moving && !(moving.group && pointGroupAncestors(groups, parent).includes(moving.group));

  /** Moves a point or group into `parent`, placed before or after `target` when that is a row of the same kind. */
  const move = (moving: Dragged, parent: string | null, target?: PointTreeRow, mode?: DropMode) => {
    const after = mode === 'below';
    if (moving.point) {
      const item = points.find(entry => entry.id === moving.point);
      if (!item) return;
      const { group: _, ...rest } = item, placed: GridPoint = parent ? { ...rest, group: parent } : rest;
      const others = points.filter(entry => entry.id !== item.id);
      const at = target?.kind === 'point' && mode !== 'inside' ? others.findIndex(entry => entry.id === target.point.id) + (after ? 1 : 0) : others.length;
      void onChange({ ...grid, points: [...others.slice(0, at), placed, ...others.slice(at)] });
    } else if (moving.group) {
      const item = groups.find(entry => entry.id === moving.group);
      if (!item) return;
      const others = groups.filter(entry => entry.id !== item.id);
      const at = target?.kind === 'group' && mode !== 'inside' ? others.findIndex(entry => entry.id === target.group.id) + (after ? 1 : 0) : others.length;
      void onChange({ ...grid, pointGroups: [...others.slice(0, at), { ...item, parent }, ...others.slice(at)] });
    }
  };
  const over = (event: DragEvent, row?: PointTreeRow) => {
    const mode = row && modeAt(event, row);
    if (!canDrop(dragging, dropParent(row, mode))) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
    setDropTarget(row && mode ? { key: row.key, mode } : null);
  };
  const drop = (event: DragEvent, row?: PointTreeRow) => {
    const mode = row && modeAt(event, row), parent = dropParent(row, mode);
    if (!dragging || !canDrop(dragging, parent)) return;
    event.preventDefault(); event.stopPropagation();
    move(dragging, parent, row, mode);
    setDragging(undefined); setDropTarget(undefined);
  };
  // Alt+Up/Down moves a row past its neighbour of the same kind in its group.
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, row: PointTreeRow) => {
    if (event.key === 'F2' && row.kind === 'group' && !readOnly) { event.preventDefault(); setRenaming(row.group.id); return; }
    if (readOnly || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault(); event.stopPropagation();
    const up = event.key === 'ArrowUp', parent = parentOf(row);
    const siblings = rows.filter(other => other.kind === row.kind && parentOf(other) === parent);
    const neighbour = siblings[siblings.indexOf(row) + (up ? -1 : 1)];
    if (neighbour) move(row.kind === 'group' ? { group: row.group.id } : { point: row.point.id }, parent, neighbour, up ? 'above' : 'below');
  };
  const newGroup = async () => {
    const taken = new Set(groups.map(item => item.name));
    let name = 'Group';
    for (let n = 2; taken.has(name); n++) name = `Group ${n}`;
    const chosen = points.find(item => item.id === point);
    // The new group goes into the selected group (or the selected point's group) and takes the selected point.
    const parent = selectedGroup?.id ?? chosen?.group ?? null, id = uid('points');
    const next: Grid = { ...grid, pointGroups: [...groups, { id, name, parent }],
      points: points.map(item => item.id === chosen?.id && !selectedGroup ? { ...item, group: id } : item) };
    if (await onChange(next)) { onSelectGroup(id); setRenaming(id); }
  };

  return <>
    <div className="panel-heading"><span><LocateFixed size={15} /> Points</span><span className="panel-heading-actions">
      <button className="icon-button" title="New point group (it takes the selected point)" aria-label="New point group" disabled={readOnly} onClick={() => void newGroup()}><FolderPlus size={14} /></button>
      <button className="icon-button" title="Ungroup the selected point group" aria-label="Ungroup point group" disabled={readOnly || !selectedGroup}
        onClick={() => { if (selectedGroup) { void onChange(ungroupPoints(grid, selectedGroup.id)); onSelectGroup(undefined); } }}><Ungroup size={14} /></button>
      <span className="subtle">{points.length}</span></span></div>
    <p className="points-panel-grid">{grid.name}</p>
    <div ref={list} className={`layer-list piece-tree points-tree${dropTarget === null ? ' drop-root' : ''}`} role="tree" aria-label="Snap points"
      onDragOver={event => over(event)} onDrop={event => drop(event)}
      onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(undefined); }}>
      {rows.map(row => {
        const active = row.kind === 'group' ? row.group.id === group : row.point.id === point;
        const inGroup = !!group && row.kind === 'point' && pointGroupAncestors(groups, row.point.group).includes(group);
        const target = dropTarget?.key === row.key ? dropTarget.mode : undefined;
        const rowProps = {
          role: 'treeitem', 'aria-level': row.depth + 1, 'aria-selected': active, 'aria-expanded': row.kind === 'group' ? row.expanded : undefined,
          className: `layer-tree-row playground-piece${row.kind === 'group' ? ' piece-group' : ''}${active ? ' active' : ''}${inGroup ? ' in-selected-group' : ''}${target === 'inside' ? ' group-drop-target' : target ? ` piece-drop-${target}` : ''}`,
          style: { paddingLeft: 8 + row.depth * 14 },
          onDragOver: (event: DragEvent) => over(event, row), onDrop: (event: DragEvent) => drop(event, row),
        };
        const dragProps = readOnly ? {} : {
          draggable: true,
          onDragStart: (event: DragEvent) => {
            event.dataTransfer.setData(DRAG_TYPE, row.key); event.dataTransfer.effectAllowed = 'move';
            setDragging(row.kind === 'group' ? { group: row.group.id } : { point: row.point.id });
          },
          onDragEnd: () => { setDragging(undefined); setDropTarget(undefined); },
        };
        if (row.kind === 'group') {
          const name = row.group.name;
          return <div key={row.key} {...rowProps}>
            <button className="tree-disclosure" aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${name}`}
              onClick={() => setCollapsed(current => { const next = new Set(current); if (!next.delete(row.group.id)) next.add(row.group.id); return next; })}>
              {row.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            {renaming === row.group.id ? <GroupNameEditor name={name} onDone={next => {
              setRenaming(undefined);
              if (next && next !== name) void onChange({ ...grid, pointGroups: groups.map(item => item.id === row.group.id ? { ...item, name: next.slice(0, 60) } : item) });
            }} /> : <button className={`layer-row ${active ? 'active' : ''}`} aria-pressed={active} title={`${name} · Double-click to rename`} {...dragProps}
              aria-label={`Point group ${name}, ${row.points.length} point${row.points.length === 1 ? '' : 's'}`} data-row-key={row.key}
              onClick={() => { onSelectGroup(row.group.id); onSelectPoint(undefined); }} onDoubleClick={() => { if (!readOnly) setRenaming(row.group.id); }}
              onKeyDown={event => keyDown(event, row)}>
              {row.expanded ? <FolderOpen size={14} /> : <Folder size={14} />}<span>{name}</span><small className="playground-piece-count">{row.points.length}</small>
            </button>}
          </div>;
        }
        const name = pointName(row.point, row.index), rotation = row.point.rotation ?? grid.rotation;
        return <div key={row.key} {...rowProps}>
          <span className="tree-disclosure-spacer" aria-hidden="true" />
          <button className={`layer-row ${active ? 'active' : ''}`} aria-pressed={active} title={`${name} at ${Math.round(row.point.x)}, ${Math.round(row.point.y)}`} {...dragProps}
            aria-label={`Point ${name}`} data-row-key={row.key} onClick={() => { onSelectPoint(row.point.id); onSelectGroup(undefined); }} onKeyDown={event => keyDown(event, row)}>
            <LocateFixed size={13} /><span>{name}</span>
            <small className="point-row-detail">{Math.round(row.point.x)}, {Math.round(row.point.y)}{rotation !== undefined ? ` · ${rotation}°` : ''}</small>
          </button>
        </div>;
      })}
      {!rows.length && <p className="empty-note">No snap points yet. Click {surface} to add one.</p>}
    </div>
  </>;
}
