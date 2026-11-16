import { useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { ComponentThumbnail } from './ComponentView';
import type { Component } from './domain';
import { startLibraryDrag } from './libraryDrag';

export function LibraryVariants({ component, components, projectId, onSpawnAll }: { component: Component; components: Component[]; projectId: string; onSpawnAll: () => void }) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<number[]>([]);
  const anchor = useRef<number | undefined>(undefined);
  const select = (index: number, event: React.MouseEvent) => {
    const valid = selection.filter(row => row < component.rows.length);
    if (event.shiftKey && anchor.current !== undefined && anchor.current < component.rows.length) {
      const start = Math.min(anchor.current, index), end = Math.max(anchor.current, index);
      const range = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      setSelection(event.ctrlKey || event.metaKey ? [...new Set([...valid, ...range])] : range);
    } else {
      anchor.current = index;
      setSelection(event.ctrlKey || event.metaKey
        ? valid.includes(index) ? valid.filter(row => row !== index) : [...valid, index]
        : [index]);
    }
  };
  return <div className="library-variants">
    <button className="library-variants-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Variants ({component.rows.length})
    </button>
    {open && <div className="library-variant-list" role="group" aria-label={`${component.name} variants`}>
      {component.rows.map((row, index) => {
        const label = row.name || row.id || row.value || Object.values(row).find(Boolean) || `Row ${index + 1}`;
        return <button key={index} className={`library-variant${selection.includes(index) ? ' selected' : ''}`}
          aria-label={`Variant ${index + 1}: ${label}`} aria-pressed={selection.includes(index)}
          draggable onClick={event => select(index, event)}
          onDragStart={event => {
            const rows = selection.includes(index) ? selection.filter(row => row < component.rows.length).sort((a, b) => a - b) : [index];
            startLibraryDrag(event.dataTransfer, projectId, component.id, rows);
          }}>
          <ComponentThumbnail component={component} components={components} row={index} width={34} />
          <span>{index + 1}. {label}</span>
        </button>;
      })}
    </div>}
    {open && <div className="library-item-options"><button onClick={onSpawnAll}><Plus size={11} /> Spawn all variants</button></div>}
  </div>;
}
