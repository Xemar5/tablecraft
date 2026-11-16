import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { ChevronDown, ChevronRight, Circle, Layers, LockKeyhole, Palette, Square } from 'lucide-react';
import { stackMembers, visibleStackMembers, type Component, type Instance, type Project } from './domain';
import { variantLabels } from './csv';

type Row = { key: string; ids: string[]; item: Instance; depth: number; count: number };

const kindIcon = (component?: Component) => component?.kind === 'card' ? <Layers size={14} /> : component?.kind === 'token' ? <Circle size={14} />
  : component?.kind === 'artwork' ? <Palette size={14} /> : <Square size={14} />;

/** Lists the pieces on the table (stacks as expandable groups), topmost first, with the standard click / Ctrl-click / Shift-click selection. */
export function PlaygroundLayers({ project: p, selected, onSelect }: { project: Project; selected: string[]; onSelect: (ids: string[]) => void }) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const anchor = useRef<string>(undefined);
  const list = useRef<HTMLDivElement>(null);
  const labels = useMemo(() => Object.fromEntries(p.components.map(component => [component.id, component.rows.length > 1 ? variantLabels(component.csv, component.rows) : []])), [p.components]);
  const order = (item: Instance) => p.components.find(c => c.id === item.componentId)?.kind === 'board' ? 0 : p.instances.indexOf(item) + 2;
  const rows: Row[] = p.instances.filter(i => !i.holder && (!i.stack || visibleStackMembers(p, i).at(-1)?.id === i.id))
    .sort((a, b) => order(b) - order(a))
    .flatMap(top => {
      const members = stackMembers(p, top);
      const key = top.stack ?? top.id;
      const row: Row = { key, ids: members.map(i => i.id), item: top, depth: 0, count: members.length };
      return members.length > 1 && expanded.includes(key)
        ? [row, ...[...members].reverse().map(item => ({ key: item.id, ids: [item.id], item, depth: 1, count: 1 }))]
        : [row];
    });
  const isActive = (row: Row) => row.ids.every(id => selected.includes(id));
  useEffect(() => { list.current?.querySelector('.layer-row.active')?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  const select = (row: Row, event: MouseEvent) => {
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
  return <div ref={list} className="layer-list" role="list" aria-label="Table pieces">
    {rows.map(row => {
      const component = p.components.find(c => c.id === row.item.componentId);
      const variant = labels[row.item.componentId]?.[row.item.row];
      const name = `${component?.name ?? 'Missing component'}${row.depth || row.count === 1 ? variant ? ` · ${variant}` : '' : ''}`;
      return <div key={row.key} role="listitem" className={`layer-tree-row playground-layer${isActive(row) ? ' active' : ''}`} style={{ paddingLeft: 8 + row.depth * 14 }}>
        <button className={`layer-row ${isActive(row) ? 'active' : ''}`} aria-pressed={isActive(row)} title={name}
          aria-label={`${name}${row.count > 1 ? `, stack of ${row.count}` : ''}${row.item.locked ? ', locked' : ''}`} onClick={event => select(row, event)}>
          {kindIcon(component)}<span>{name}</span>
          {row.count > 1 && <small className="playground-layer-count">{row.count}</small>}
          {row.item.locked && <LockKeyhole size={11} className="playground-layer-lock" aria-hidden="true" />}
        </button>
        {row.count > 1 && <button className="tree-disclosure" aria-label={`${expanded.includes(row.key) ? 'Collapse' : 'Expand'} ${component?.name ?? 'stack'} stack`}
          onClick={() => setExpanded(keys => keys.includes(row.key) ? keys.filter(key => key !== row.key) : [...keys, row.key])}>
          {expanded.includes(row.key) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>}
      </div>;
    })}
    {!rows.length && <p className="empty-note">No pieces on the table yet.</p>}
  </div>;
}
