import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Code2, Database, Download, FileSpreadsheet, Frame, ImagePlus, Layers, Redo2, Square, Trash2, Type, Undo2, Upload } from 'lucide-react';
import Papa from 'papaparse';
import { ComponentView } from './ComponentView';
import { makeNode, type Component, type DesignNode } from './domain';
import { download } from './storage';
import { Field, Modal, NumberField, Toggle } from './ui';

export function Designer({ component: incoming, onChange, onDelete, notify }: {
  component: Component; onChange: (c: Component) => Promise<boolean>; onDelete: () => void; notify: (message: string, error?: boolean) => void;
}) {
  const [component, setComponent] = useState(incoming);
  const pending = useRef(0);
  const latestIncoming = useRef(incoming);
  latestIncoming.current = incoming;
  useEffect(() => { if (!pending.current) setComponent(incoming); }, [incoming]);
  const [face, setFace] = useState<'front' | 'back'>('front');
  const [selected, setSelected] = useState<string>();
  const [tab, setTab] = useState<'design' | 'behavior'>('design');
  const [dataOpen, setDataOpen] = useState(false);
  const [csv, setCsv] = useState(component.csv);
  const [row, setRow] = useState(0);
  const [zoom, setZoom] = useState(1.45);
  const [history, setHistory] = useState<Component[]>([]);
  const [future, setFuture] = useState<Component[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number }>();
  const artboard = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ id: string; pointer: number; clientX: number; clientY: number; x: number; y: number; angle: number }>(null);
  const nodes = component[face];
  const node = nodes.find(n => n.id === selected);
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
  const updateNode = (patch: Partial<DesignNode>) => update({ [face]: nodes.map(n => n.id === selected ? { ...n, ...patch } : n) });
  const addNode = (type: DesignNode['type']) => {
    const next = makeNode(type, { parent: node?.type === 'frame' ? node.id : null });
    update({ [face]: [...nodes, next] }); setSelected(next.id);
  };
  const removeNode = () => {
    const remove = new Set([selected]);
    let previous = 0;
    while (remove.size !== previous) { previous = remove.size; nodes.forEach(n => { if (remove.has(n.parent ?? '')) remove.add(n.id); }); }
    update({ [face]: nodes.filter(n => !remove.has(n.id)) }); setSelected(undefined);
  };
  const descendants = new Set([selected]);
  let count = -1;
  while (count !== descendants.size) { count = descendants.size; nodes.forEach(n => { if (descendants.has(n.parent ?? '')) descendants.add(n.id); }); }
  const layers = (parent: string | null, depth = 0): React.ReactNode => nodes.filter(n => n.parent === parent).map(n =>
    <div key={n.id}><button className={`layer-row ${selected === n.id ? 'active' : ''}`} style={{ paddingLeft: 14 + depth * 15 }}
      onClick={() => setSelected(n.id)}>
      {n.type === 'text' ? <Type size={14} /> : n.type === 'frame' ? <Frame size={14} /> : n.type === 'image' ? <ImagePlus size={14} /> : <Square size={14} />}
      <span>{n.name}</span>{n.type === 'frame' && <ChevronDown size={12} />}
    </button>{layers(n.id, depth + 1)}</div>);
  const saveCsv = async () => {
    const result = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: 'greedy' });
    if (result.errors.length) { notify(result.errors[0].message, true); return; }
    if (!result.meta.fields?.length || result.meta.fields.some(f => !f.trim())) { notify('CSV needs a non-empty header row.', true); return; }
    if (await update({ csv, rows: result.data })) {
      setRow(0); setDataOpen(false);
      notify(`Updated ${result.data.length} data rows. All instances are live.`);
    }
  };
  return <div className="designer-layout">
    <aside className="layers-panel">
      <div className="panel-heading"><span><Layers size={15} /> Layers</span><span className="subtle">{nodes.length}</span></div>
      <div className="face-tabs"><button className={face === 'front' ? 'active' : ''} onClick={() => { setFace('front'); setSelected(undefined); }}>Front</button>
        <button disabled={!component.flippable} className={face === 'back' ? 'active' : ''} onClick={() => { setFace('back'); setSelected(undefined); }}>Back</button></div>
      <div className="layer-list">{layers(null)}{!nodes.length && <p className="empty-note">A blank canvas.<br />Add your first layer above.</p>}</div>
      <div className="layer-footer"><button onClick={() => { setCsv(component.csv); setDataOpen(true); }}><Database size={16} /><span>Data bindings<small>{component.rows.length} rows connected</small></span><ChevronRight size={14} /></button></div>
    </aside>
    <section className="designer-canvas">
      <div className="canvas-toolbar">
        <div className="tool-group">
          <button title="Add text" aria-label="Add text" onClick={() => addNode('text')}><Type size={19} /></button>
          <button title="Add shape" aria-label="Add shape" onClick={() => addNode('shape')}><Square size={18} /></button>
          <button title="Add image" aria-label="Add image" onClick={() => addNode('image')}><ImagePlus size={19} /></button>
          <button title="Add frame" aria-label="Add frame" onClick={() => addNode('frame')}><Frame size={18} /></button>
        </div><span className="toolbar-divider" />
        <button title="Undo design edit" aria-label="Undo design edit" disabled={!history.length} onClick={() => {
          const previous = history.at(-1)!; setHistory(history.slice(0, -1)); setFuture([...future, component]); void commit(previous);
        }}><Undo2 size={17} /></button>
        <button title="Redo design edit" aria-label="Redo design edit" disabled={!future.length} onClick={() => {
          const next = future.at(-1)!; setFuture(future.slice(0, -1)); setHistory([...history, component]); void commit(next);
        }}><Redo2 size={17} /></button>
        <div className="toolbar-end"><select aria-label="Preview data row" value={row} onChange={e => setRow(Number(e.target.value))}>
          {component.rows.length ? component.rows.map((r, i) => <option key={i} value={i}>{r.name ?? `Row ${i + 1}`}</option>) : <option value="0">No data source</option>}
        </select></div>
      </div>
      <div className="designer-stage" onPointerDown={() => setSelected(undefined)}>
        <span className="artboard-label">{component.name} / {face} <span>{component.width} x {component.height}</span></span>
        <div ref={artboard} className="artboard" style={{ width: component.width * zoom, height: component.height * zoom }}
          onPointerMove={event => {
            const drag = dragging.current;
            if (!drag || drag.pointer !== event.pointerId) return;
            const dx = (event.clientX - drag.clientX) / zoom, dy = (event.clientY - drag.clientY) / zoom;
            setDragPreview({ id: drag.id, x: Math.round(drag.x + dx * Math.cos(drag.angle) + dy * Math.sin(drag.angle)), y: Math.round(drag.y - dx * Math.sin(drag.angle) + dy * Math.cos(drag.angle)) });
          }}
          onPointerUp={event => {
            const drag = dragging.current;
            if (drag && dragPreview && drag.pointer === event.pointerId && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) > 2) {
              update({ [face]: nodes.map(n => n.id === drag.id ? { ...n, x: dragPreview.x, y: dragPreview.y } : n) });
            }
            dragging.current = null; setDragPreview(undefined);
          }}
          onPointerCancel={() => { dragging.current = null; setDragPreview(undefined); }}>
          <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
            <ComponentView component={dragPreview ? { ...component, [face]: nodes.map(n => n.id === dragPreview.id ? { ...n, x: dragPreview.x, y: dragPreview.y } : n) } : component}
              row={row} back={face === 'back'} selectedNode={selected} onNode={(id, event) => {
                setSelected(id);
                const layer = nodes.find(n => n.id === id)!;
                let ancestor = nodes.find(n => n.id === layer.parent);
                if (ancestor && ancestor.layout !== 'absolute') return;
                let angle = 0;
                while (ancestor) { angle += ancestor.rotation; ancestor = nodes.find(n => n.id === ancestor!.parent); }
                dragging.current = { id, pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: layer.x, y: layer.y, angle: angle * Math.PI / 180 };
                artboard.current?.setPointerCapture(event.pointerId);
              }} />
          </div>
        </div>
        <div className="canvas-caption"><span className="live-dot" /> Live component <span>Changes appear on every instance</span></div>
      </div>
      <div className="canvas-bottom"><span><Square size={12} /> {component.kind} component</span>
        <div><button onClick={() => setZoom(z => Math.max(.25, z - .25))}>-</button><button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button onClick={() => setZoom(z => Math.min(3, z + .25))}>+</button></div></div>
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
            {component.stackable && <Field label="Stack tag"><input value={component.stackTag} placeholder="e.g. spirit-deck" onChange={e => update({ stackTag: e.target.value })} /></Field>}
            <p className="help-text">Matching tags can stack together. Leave blank to stack only this component's instances.</p>
          </div>
          <div className="inspector-section"><h3>Portable by design</h3><p className="help-text">Export the full component, including both faces, behavior and CSV data.</p>
            <button className="button full" onClick={() => download(`${component.name}.component.json`, JSON.stringify(component, null, 2))}><Download size={15} /> Export component</button>
            <button className="button full danger" style={{ marginTop: 10 }} onClick={() => setDeleteOpen(true)}><Trash2 size={14} /> Delete component</button></div>
        </> : node ? <>
          <div className="inspector-section"><div className="section-title"><h3>{node.type} layer</h3><button className="icon-button danger" title="Delete layer" aria-label="Delete layer" onClick={removeNode}><Trash2 size={14} /></button></div>
            <Field label="Layer name"><input value={node.name} onChange={e => updateNode({ name: e.target.value })} /></Field>
            <Field label="Parent"><select value={node.parent ?? ''} onChange={e => updateNode({ parent: e.target.value || null })}><option value="">Component root</option>
              {nodes.filter(n => n.type === 'frame' && !descendants.has(n.id)).map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select></Field>
            <div className="field-grid"><NumberField label="X" value={node.x} onChange={x => updateNode({ x })} /><NumberField label="Y" value={node.y} onChange={y => updateNode({ y })} />
              <NumberField label="Width" value={node.width} min={1} max={4000} onChange={width => updateNode({ width })} /><NumberField label="Height" value={node.height} min={1} max={4000} onChange={height => updateNode({ height })} />
              <NumberField label="Rotation" value={node.rotation} onChange={rotation => updateNode({ rotation })} /><NumberField label="Radius" value={node.radius} min={0} max={2000} onChange={radius => updateNode({ radius })} /></div>
            <div className="button-row"><button className="button" onClick={() => {
              const index = nodes.findIndex(n => n.id === node.id);
              if (index > 0) { const next = [...nodes]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; update({ [face]: next }); }
            }}><ArrowDown size={14} /> Backward</button><button className="button" onClick={() => {
              const index = nodes.findIndex(n => n.id === node.id);
              if (index < nodes.length - 1) { const next = [...nodes]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; update({ [face]: next }); }
            }}><ArrowUp size={14} /> Forward</button></div>
          </div>
          <div className="inspector-section"><h3>Appearance</h3>
            <Field label="Fill"><div className="color-input"><input aria-label="Fill color" type="color" value={/^#[0-9a-f]{6}$/i.test(node.fill) ? node.fill : '#ffffff'} onChange={e => updateNode({ fill: e.target.value })} /><input value={node.fill} onChange={e => updateNode({ fill: e.target.value })} /></div></Field>
            <NumberField label="Opacity" value={node.opacity} min={0} max={1} step={.05} onChange={opacity => updateNode({ opacity })} />
            {node.type === 'text' && <>
              <Field label="Text / binding"><textarea value={node.text} onChange={e => updateNode({ text: e.target.value })} rows={3} /></Field>
              <p className="help-text">Mix static text with <code>{'{{column_name}}'}</code>.</p>
              <Field label="Google font"><input list="google-fonts" value={node.font} onChange={e => updateNode({ font: e.target.value })} /></Field>
              <datalist id="google-fonts">{['DM Sans', 'Lora', 'Inter', 'Playfair Display', 'Space Grotesk', 'Roboto', 'Cinzel', 'Bebas Neue'].map(f => <option key={f}>{f}</option>)}</datalist>
              <div className="field-grid"><NumberField label="Font size" value={node.fontSize} min={4} max={400} onChange={fontSize => updateNode({ fontSize })} />
                <Field label="Text color"><input type="color" value={node.color} onChange={e => updateNode({ color: e.target.value })} /></Field></div>
              <Field label="Alignment"><select value={node.align} onChange={e => updateNode({ align: e.target.value as DesignNode['align'] })}><option value="start">Left</option><option value="center">Center</option><option value="end">Right</option></select></Field>
            </>}
            {node.type === 'image' && <><Field label="Image URL / binding"><textarea rows={3} value={node.text} onChange={e => updateNode({ text: e.target.value })} placeholder="https://... or {{image}}" /></Field><p className="help-text">HTTPS texture URLs and CSV bindings are supported.</p></>}
            {node.type === 'shape' && <Field label="Botanical motif (optional)"><select value={node.text} onChange={e => updateNode({ text: e.target.value })}><option value="">None</option><option value="fern">Fern</option><option value="moon">Moon</option><option value="sun">Sun</option></select></Field>}
            {node.type === 'frame' && <>
              <Field label="Child layout"><select value={node.layout} onChange={e => updateNode({ layout: e.target.value as DesignNode['layout'] })}><option value="absolute">Absolute</option><option value="row">Flex row</option><option value="column">Flex column</option></select></Field>
              <div className="field-grid"><NumberField label="Gap" value={node.gap} min={0} max={200} onChange={gap => updateNode({ gap })} /><NumberField label="Padding" value={node.padding} min={0} max={200} onChange={padding => updateNode({ padding })} /></div>
              <Field label="Align children"><select value={node.align} onChange={e => updateNode({ align: e.target.value as DesignNode['align'] })}><option value="start">Start</option><option value="center">Center</option><option value="end">End</option></select></Field>
            </>}
          </div>
        </> : <>
          <div className="inspector-section"><h3>Component</h3>
            <Field label="Name"><input value={component.name} onChange={e => { if (e.target.value) update({ name: e.target.value }); }} /></Field>
            <div className="field-grid"><NumberField label="Width" value={component.width} min={20} max={2000} onChange={width => update({ width })} /><NumberField label="Height" value={component.height} min={20} max={2000} onChange={height => update({ height })} /></div>
            <Field label="Background"><div className="color-input"><input type="color" aria-label="Component background" value={component.color} onChange={e => update({ color: e.target.value })} /><input value={component.color} onChange={e => update({ color: e.target.value })} /></div></Field>
          </div>
          <div className="inspector-section"><h3>Make it yours</h3><p className="help-text">Select a layer to style it, or add text, images, shapes and nested frames with the toolbar.</p>
            <div className="tip-card"><Code2 size={20} /><strong>One design. Endless cards.</strong><p>Use {'{{name}}'} in any text or image layer to connect it to your CSV.</p><button className="text-button" onClick={() => { setCsv(component.csv); setDataOpen(true); }}>Connect your data <ChevronRight size={13} /></button></div></div>
        </>}
      </div>
    </aside>
    {dataOpen && <Modal title="A little data. A whole deck." subtitle="Each CSV row becomes a different instance of this component." wide onClose={() => setDataOpen(false)}>
      <div className="data-dialog"><div className="data-toolbar"><span><FileSpreadsheet size={16} /> CSV data source</span><label className="button"><Upload size={14} /> Import CSV<input type="file" accept=".csv,text/csv" hidden onChange={async e => {
        try { const file = e.target.files?.[0]; if (file) setCsv(await file.text()); } catch (error) { notify(String(error), true); }
      }} /></label></div>
        <textarea className="csv-editor" aria-label="CSV data" value={csv} onChange={e => setCsv(e.target.value)} spellCheck={false} />
        <p className="help-text">Include a header row. Quoted cells, commas and multiline text are supported. Updating data refreshes existing pieces by row index.</p>
        <div className="modal-actions"><button className="button" onClick={() => setDataOpen(false)}>Cancel</button><button className="button primary" onClick={saveCsv}><Database size={15} /> Apply data & refresh instances</button></div>
      </div></Modal>}
    {deleteOpen && <Modal title="Remove this component?" subtitle={`This deletes ${component.name} and every spawned instance, including pieces in hands. Export it first if you want to keep a copy.`} onClose={() => setDeleteOpen(false)}>
      <div className="data-dialog"><div className="modal-actions"><button className="button" onClick={() => setDeleteOpen(false)}>Keep component</button><button className="button danger" onClick={onDelete}><Trash2 size={15} /> Delete component & instances</button></div></div>
    </Modal>}
  </div>;
}
