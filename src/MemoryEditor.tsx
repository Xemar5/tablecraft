import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Braces, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Download, FileJson, Link2, List, Plus, Search, Trash2, Upload, ArrowUp, ArrowDown } from 'lucide-react';
import { MAX_MEMORY_BYTES, memorySchema, memoryPathText, type Command, type Memory, type MemoryPath, type MemoryValue } from './domain';
import './scripting.css';

type Kind = 'text' | 'number' | 'boolean' | 'table' | 'list';
const kindOf = (value: MemoryValue): Kind => Array.isArray(value) ? 'list' : typeof value === 'object' ? 'table' : typeof value === 'string' ? 'text' : typeof value === 'number' ? 'number' : 'boolean';
const KINDS: { kind: Kind; label: string }[] = [{ kind: 'text', label: 'Text' }, { kind: 'number', label: 'Number' }, { kind: 'boolean', label: 'True/false' }, { kind: 'table', label: 'Table' }, { kind: 'list', label: 'List' }];
const pathKey = (path: MemoryPath) => JSON.stringify(path);
/** The binding a component's text layer uses to show this value. */
const bindingFor = (path: MemoryPath) => `{{memory.${path.join('.')}}}`;

/** Converts a value to another kind, keeping what can be kept. */
function convert(value: MemoryValue, kind: Kind): MemoryValue {
  if (kind === kindOf(value)) return value;
  switch (kind) {
    case 'text': return typeof value === 'object' ? JSON.stringify(value) : String(value);
    case 'number': { const number = Number(value); return typeof value !== 'object' && Number.isFinite(number) ? number : 0; }
    case 'boolean': return value === true || value === 'true' || (typeof value === 'number' && value !== 0);
    case 'table': return Array.isArray(value) ? Object.fromEntries(value.map((item, index) => [String(index + 1), item])) : {};
    case 'list': return value && typeof value === 'object' ? Object.values(value) : [];
  }
}

type Row = { path: MemoryPath; key: string | number; value: MemoryValue; depth: number };

/**
 * The memory window: script memory as an editable tree. Players change, add, rename, reorder and remove values; each
 * edit is a shared command (so it syncs, can be undone and runs onMemoryChanged). JSON import and export, and a raw
 * JSON mode, cover bulk changes.
 */
export function MemoryEditor({ memory, canEdit, dispatch, notify, projectName }: {
  memory: Memory | undefined; canEdit: boolean; dispatch: (command: Command) => Promise<boolean>; notify: (message: string, error?: boolean) => void; projectName: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [raw, setRaw] = useState<string>();
  const [rawError, setRawError] = useState('');
  const [focusPath, setFocusPath] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);
  const size = useMemo(() => JSON.stringify(memory ?? {}).length, [memory]);
  const change = (changes: { path: MemoryPath; value?: MemoryValue }[]) => dispatch({ type: 'memory', changes });
  const terms = query.trim().toLowerCase();

  const rows = useMemo(() => {
    const list: Row[] = [];
    const matches = (path: MemoryPath, value: MemoryValue): boolean => !terms || memoryPathText(path).toLowerCase().includes(terms)
      || (typeof value === 'object' ? Object.entries(value).some(([key, item]) => matches([...path, Array.isArray(value) ? Number(key) + 1 : key], item)) : String(value).toLowerCase().includes(terms));
    const visit = (value: MemoryValue, path: MemoryPath, key: string | number, depth: number) => {
      if (!matches(path, value)) return;
      list.push({ path, key, value, depth });
      if (typeof value === 'object' && (terms || expanded.has(pathKey(path)))) {
        const entries = Array.isArray(value) ? value.map((item, index) => [index + 1, item] as const) : Object.entries(value);
        for (const [childKey, item] of entries) visit(item, [...path, childKey], childKey, depth + 1);
      }
    };
    for (const [key, value] of Object.entries(memory ?? {})) visit(value, [key], key, 0);
    return list;
  }, [memory, expanded, terms]);

  useEffect(() => {
    if (!focusPath) return;
    const input = document.querySelector<HTMLInputElement>(`[data-memory-path="${CSS.escape(focusPath)}"]`);
    if (input) { input.focus(); input.select(); setFocusPath(undefined); }
  }, [rows, focusPath]);

  const toggle = (path: MemoryPath) => setExpanded(current => {
    const next = new Set(current), key = pathKey(path);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const expandAll = () => {
    const keys = new Set<string>();
    const visit = (value: MemoryValue, path: MemoryPath) => {
      if (typeof value !== 'object') return;
      keys.add(pathKey(path));
      (Array.isArray(value) ? value.map((item, index) => [index + 1, item] as const) : Object.entries(value)).forEach(([key, item]) => visit(item, [...path, key]));
    };
    Object.entries(memory ?? {}).forEach(([key, value]) => visit(value, [key]));
    setExpanded(keys);
  };
  const freeKey = (table: Record<string, MemoryValue>, base = 'value') => {
    if (!(base in table)) return base;
    for (let n = 2; ; n++) if (!(`${base}${n}` in table)) return `${base}${n}`;
  };
  const addChild = async (path: MemoryPath, value: MemoryValue | undefined) => {
    if (Array.isArray(value)) {
      const itemPath = [...path, value.length + 1];
      if (await change([{ path: itemPath, value: '' }])) { setExpanded(current => new Set(current).add(pathKey(path))); setFocusPath(pathKey(itemPath)); }
    } else {
      const key = freeKey((value ?? memory ?? {}) as Record<string, MemoryValue>);
      const keyPath = [...path, key];
      if (await change([{ path: keyPath, value: '' }])) { if (path.length) setExpanded(current => new Set(current).add(pathKey(path))); setFocusPath(`key:${pathKey(keyPath)}`); }
    }
  };
  const rename = async (row: Row, name: string) => {
    const key = name.trim();
    if (!key || key === row.key) return;
    const parentPath = row.path.slice(0, -1);
    const parent = parentPath.reduce<MemoryValue | undefined>((value, part) => value && typeof value === 'object' ? (value as Record<string, MemoryValue>)[String(part)] : undefined, memory as MemoryValue);
    if (parent && typeof parent === 'object' && key in parent) { notify(`There is already a value called ${key} here.`, true); return; }
    await change([{ path: row.path }, { path: [...parentPath, key], value: row.value }]);
  };
  const moveItem = (row: Row, offset: number) => {
    const listPath = row.path.slice(0, -1), index = (row.key as number) - 1;
    const list = rows.find(item => pathKey(item.path) === pathKey(listPath))?.value;
    if (!Array.isArray(list) || index + offset < 0 || index + offset >= list.length) return;
    const next = [...list];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    void change([{ path: listPath, value: next }]);
  };
  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text).then(() => notify(`Copied ${what}: ${text}`), () => notify(`Unable to copy. ${what}: ${text}`, true));
  };
  const replaceAll = async (text: string) => {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch (error) { return `That isn't valid JSON: ${error instanceof Error ? error.message : String(error)}`; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'Memory must be a JSON object of named values, such as { "score": 0 }.';
    const result = memorySchema.safeParse(parsed);
    if (!result.success) return `Memory can hold text, numbers, true/false, lists and tables (no null): ${result.error.issues[0]?.path.join('.') || 'value'} ${result.error.issues[0]?.message ?? ''}`.trim();
    if (JSON.stringify(result.data).length > MAX_MEMORY_BYTES) return 'Memory can hold at most 512 KB of JSON.';
    return await change([{ path: [], value: result.data }]) ? '' : 'Unable to replace memory.';
  };
  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(memory ?? {}, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `${projectName.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'memory'} memory.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <div className="memory-editor">
    <div className="memory-toolbar" role="toolbar" aria-label="Memory actions">
      <div className="search-input memory-search"><Search size={13} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a key or value…" aria-label="Find in memory" /></div>
      <button className="icon-button" aria-label="Expand all" title="Expand all" onClick={expandAll}><ChevronsUpDown size={15} /></button>
      <button className="icon-button" aria-label="Collapse all" title="Collapse all" onClick={() => setExpanded(new Set())}><ChevronsDownUp size={15} /></button>
      <span className="toolbar-gap" />
      <button className="button" disabled={!canEdit || raw !== undefined} onClick={() => void addChild([], undefined)}><Plus size={13} /> Add value</button>
      <button className={`icon-button${raw !== undefined ? ' active' : ''}`} aria-pressed={raw !== undefined} aria-label="Edit as JSON" title="Edit as JSON" onClick={() => { setRaw(raw === undefined ? JSON.stringify(memory ?? {}, null, 2) : undefined); setRawError(''); }}><FileJson size={15} /></button>
      <button className="icon-button" aria-label="Import JSON" title="Import JSON (replaces memory)" disabled={!canEdit} onClick={() => fileInput.current?.click()}><Upload size={15} /></button>
      <button className="icon-button" aria-label="Export JSON" title="Export JSON" onClick={exportJson}><Download size={15} /></button>
      <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        const problem = await replaceAll(await file.text());
        notify(problem || `Imported ${file.name} into memory.`, !!problem);
      }} />
    </div>
    {raw !== undefined ? <div className="memory-raw">
      <textarea value={raw} readOnly={!canEdit} spellCheck={false} aria-label="Memory as JSON" onChange={event => { setRaw(event.target.value); setRawError(''); }} />
      {rawError && <p className="memory-error" role="alert">{rawError}</p>}
      <div className="memory-raw-actions"><button className="button" onClick={() => { setRaw(undefined); setRawError(''); }}>Cancel</button>
        <button className="button primary" disabled={!canEdit} onClick={async () => { const problem = await replaceAll(raw); if (problem) setRawError(problem); else setRaw(undefined); }}>Apply JSON</button></div>
    </div> : <div className="memory-tree" role="tree" aria-label="Memory">
      {!rows.length && <p className="script-empty">{terms ? 'Nothing matches.' : 'Memory is empty. Add a value here, import JSON, or let scripts fill it (memory.score = 0).'}</p>}
      {rows.map(row => {
        const kind = kindOf(row.value), container = kind === 'table' || kind === 'list', open = !!terms || expanded.has(pathKey(row.path));
        const inList = typeof row.key === 'number';
        return <div key={pathKey(row.path)} className={`memory-row kind-${kind}`} role="treeitem" aria-level={row.depth + 1} aria-expanded={container ? open : undefined} style={{ paddingLeft: 6 + row.depth * 16 }}>
          {container ? <button className="icon-button memory-toggle" aria-label={`${open ? 'Collapse' : 'Expand'} ${memoryPathText(row.path)}`} onClick={() => toggle(row.path)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="memory-toggle" />}
          {inList ? <span className="memory-index">[{row.key}]</span>
            : <CommitInput className="memory-key" value={String(row.key)} label={`Name of ${memoryPathText(row.path)}`} disabled={!canEdit} dataPath={`key:${pathKey(row.path)}`} onCommit={name => void rename(row, name)} />}
          <select className="memory-kind" value={kind} disabled={!canEdit} aria-label={`Type of ${memoryPathText(row.path)}`} onChange={event => void change([{ path: row.path, value: convert(row.value, event.target.value as Kind) }])}>
            {KINDS.map(option => <option key={option.kind} value={option.kind}>{option.label}</option>)}
          </select>
          <span className="memory-value">{kind === 'boolean' ? <label className="memory-check"><input type="checkbox" checked={row.value as boolean} disabled={!canEdit} onChange={event => void change([{ path: row.path, value: event.target.checked }])} /><span>{String(row.value)}</span></label>
            : kind === 'text' ? <CommitInput value={row.value as string} label={`Value of ${memoryPathText(row.path)}`} disabled={!canEdit} dataPath={pathKey(row.path)} onCommit={value => void change([{ path: row.path, value }])} />
            : kind === 'number' ? <CommitInput value={String(row.value)} numeric label={`Value of ${memoryPathText(row.path)}`} disabled={!canEdit} dataPath={pathKey(row.path)} onCommit={value => {
              const number = Number(value);
              if (value.trim() === '' || !Number.isFinite(number)) { notify('Enter a number.', true); return; }
              void change([{ path: row.path, value: number }]);
            }} />
            : <button className="memory-summary" onClick={() => toggle(row.path)}>{kind === 'list' ? <List size={12} /> : <Braces size={12} />}{(() => { const count = kind === 'list' ? (row.value as MemoryValue[]).length : Object.keys(row.value as object).length; return `${count} ${kind === 'list' ? count === 1 ? 'item' : 'items' : count === 1 ? 'value' : 'values'}`; })()}</button>}</span>
          <span className="memory-actions">
            {container && canEdit && <button className="icon-button" aria-label={`Add to ${memoryPathText(row.path)}`} title={kind === 'list' ? 'Add an item' : 'Add a value'} onClick={() => void addChild(row.path, row.value)}><Plus size={13} /></button>}
            {inList && canEdit && <><button className="icon-button" aria-label={`Move ${memoryPathText(row.path)} up`} onClick={() => moveItem(row, -1)}><ArrowUp size={12} /></button>
              <button className="icon-button" aria-label={`Move ${memoryPathText(row.path)} down`} onClick={() => moveItem(row, 1)}><ArrowDown size={12} /></button></>}
            <button className="icon-button" aria-label={`Copy Lua path of ${memoryPathText(row.path)}`} title={`Copy memory.${memoryPathText(row.path)}`} onClick={() => copy(`memory.${memoryPathText(row.path)}`.replace('memory.[', 'memory['), 'Lua path')}><Copy size={12} /></button>
            {!container && <button className="icon-button" aria-label={`Copy binding of ${memoryPathText(row.path)}`} title={`Copy ${bindingFor(row.path)} for a component's text layer`} onClick={() => copy(bindingFor(row.path), 'binding')}><Link2 size={12} /></button>}
            {canEdit && <button className="icon-button danger" aria-label={`Remove ${memoryPathText(row.path)}`} title="Remove" onClick={() => void change([{ path: row.path }])}><Trash2 size={12} /></button>}
          </span>
        </div>;
      })}
    </div>}
    <div className="memory-status"><span>{(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB of 512 KB</span><span>Show values on components with text such as {'{{memory.score}}'}</span></div>
  </div>;
}

/** A text field that edits locally and commits on Enter or when it loses focus (Escape cancels). Others' changes show while it isn't being edited. */
function CommitInput({ value, onCommit, label, disabled, numeric, className, dataPath }: {
  value: string; onCommit: (value: string) => void; label: string; disabled?: boolean; numeric?: boolean; className?: string; dataPath?: string;
}): ReactNode {
  const [draft, setDraft] = useState<string>();
  return <input className={className} value={draft ?? value} aria-label={label} disabled={disabled} inputMode={numeric ? 'decimal' : undefined} data-memory-path={dataPath}
    onChange={event => setDraft(event.target.value)}
    onBlur={() => { if (draft !== undefined && draft !== value) onCommit(draft); setDraft(undefined); }}
    onKeyDown={event => {
      if (event.key === 'Enter') event.currentTarget.blur();
      if (event.key === 'Escape') { setDraft(undefined); requestAnimationFrame(() => (event.target as HTMLInputElement).blur()); }
    }} />;
}
