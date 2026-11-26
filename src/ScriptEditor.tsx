import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, CirclePlay, FileCode2, Plus, RefreshCw, RotateCcw, Save, Search, Trash2, TriangleAlert, Eraser, Megaphone, Info } from 'lucide-react';
import { Compartment, EditorSelection, EditorState, Prec } from '@codemirror/state';
import { crosshairCursor, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, rectangularSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, snippetCompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { linter, lintGutter, lintKeymap, type Diagnostic } from '@codemirror/lint';
import { classHighlighter } from '@lezer/highlight';
import { uid, type Command, type Project, type Script } from './domain';
import { checkScriptSyntax, SCRIPT_API, SCRIPT_HANDLERS, scriptFunctions } from './scripting';
import { SearchSelect } from './SearchSelect';
import './scripting.css';

const FIRST_SCRIPT = `-- Scripts run on every player's table at once (and on the server in a live room).
-- Functions you define here can be pressed as buttons: pick one in a button's Behavior tab.
-- Open the Reference tab below for the game API and the events you can react to.

function onLoad()
  -- Runs whenever the scripts are saved: set up memory here.
  memory.round = memory.round or 1
end

function nextRound(piece, player)
  memory.round = memory.round + 1
  game.announce((player and player.name or "Someone") .. " starts round " .. memory.round)
end
`;

const LUA_WORDS = ['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while'];
const LUA_LIBRARY = ['assert', 'error', 'ipairs', 'next', 'pairs', 'pcall', 'print', 'rawequal', 'rawget', 'rawlen', 'rawset', 'select', 'setmetatable', 'getmetatable', 'tonumber', 'tostring', 'type', 'xpcall',
  'math.abs', 'math.ceil', 'math.floor', 'math.huge', 'math.max', 'math.min', 'math.pi', 'math.random', 'math.sqrt', 'math.tointeger', 'math.type', 'math.fmod',
  'string.byte', 'string.char', 'string.find', 'string.format', 'string.gmatch', 'string.gsub', 'string.len', 'string.lower', 'string.match', 'string.rep', 'string.reverse', 'string.sub', 'string.upper',
  'table.concat', 'table.insert', 'table.move', 'table.pack', 'table.remove', 'table.sort', 'table.unpack', 'utf8.char', 'utf8.len', 'coroutine.create', 'coroutine.resume', 'coroutine.wrap', 'coroutine.yield'];

/**
 * The script editor window: the project's Lua scripts with a code editor (highlighting, completion, search and
 * replace, folding, multiple cursors, syntax checks as you type), the shared console and the API reference.
 */
export function ScriptEditor({ project, canEdit, canRun, dispatch, notify, focus }: {
  project: Project; canEdit: boolean; canRun: boolean; dispatch: (command: Command) => Promise<boolean>; notify: (message: string, error?: boolean) => void;
  /** A script to show, as asked by the component library (`n` changes with each request). */
  focus?: { id: string; n: number };
}) {
  const scripts = useMemo(() => project.scripts ?? [], [project.scripts]);
  const [selectedId, setSelectedId] = useState(focus?.id ?? scripts[0]?.id);
  useEffect(() => { if (focus) setSelectedId(focus.id); }, [focus]);
  const selected = scripts.find(script => script.id === selectedId) ?? scripts[0];
  const [drafts, setDrafts] = useState<Record<string, true>>({});
  const [conflict, setConflict] = useState<string>();
  const [renaming, setRenaming] = useState<string>();
  const [removing, setRemoving] = useState<string>();
  const [pane, setPane] = useState<'console' | 'reference'>('console');
  const [paneHeight, setPaneHeight] = useState(170);
  const [query, setQuery] = useState('');
  const functions = useMemo(() => scriptFunctions(scripts), [scripts]);
  const [runName, setRunName] = useState<string>();
  const runTarget = runName && functions.includes(runName) ? runName : functions[0];
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(undefined);
  const states = useRef(new Map<string, EditorState>());
  /** The saved source each open script's editor started from, to tell local edits from someone else's save. */
  const bases = useRef(new Map<string, string>());
  const editable = useRef(new Compartment());
  const shown = useRef<string>(undefined);
  const latest = useRef({ save: () => {}, run: () => {}, name: '', functions, memoryKeys: [] as string[] });
  const jump = useRef<number>(undefined);
  const consoleList = useRef<HTMLDivElement>(null);

  const createState = (script: Script) => EditorState.create({
    doc: script.source,
    extensions: [
      lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), foldGutter(), drawSelection(), dropCursor(),
      EditorState.allowMultipleSelections.of(true), indentOnInput(), StreamLanguage.define(lua), syntaxHighlighting(classHighlighter),
      bracketMatching(), closeBrackets(), autocompletion({ override: [complete], icons: false }), rectangularSelection(), crosshairCursor(),
      highlightActiveLine(), highlightSelectionMatches(), search({ top: true }), lintGutter(),
      linter(editor => {
        const problem = checkScriptSyntax(editor.state.doc.toString(), latest.current.name);
        if (!problem) return [];
        const line = editor.state.doc.line(Math.min(Math.max(1, problem.line), editor.state.doc.lines));
        return [{ from: line.from, to: Math.max(line.from, line.to), severity: 'error', message: problem.message } satisfies Diagnostic];
      }, { delay: 350 }),
      Prec.highest(keymap.of([
        { key: 'Mod-s', run: () => { latest.current.save(); return true; }, preventDefault: true },
        { key: 'Mod-Enter', run: () => { latest.current.run(); return true; }, preventDefault: true },
      ])),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
      editable.current.of([EditorState.readOnly.of(!canEdit), EditorView.editable.of(canEdit)]),
      EditorView.updateListener.of(update => {
        if (!update.docChanged || !shown.current) return;
        const id = shown.current, dirty = update.state.doc.toString() !== bases.current.get(id);
        setDrafts(current => dirty === !!current[id] ? current : dirty ? { ...current, [id]: true } : (({ [id]: _, ...rest }) => rest)(current));
      }),
      EditorView.contentAttributes.of({ 'aria-label': `Lua source of ${script.name}` }),
    ],
  });

  // One editor view; each script keeps its own state (text, undo history, selection) while the window is open.
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({ parent: host.current });
    view.current = editor;
    return () => { editor.destroy(); view.current = undefined; shown.current = undefined; };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    if (shown.current && shown.current !== selected?.id) states.current.set(shown.current, editor.state);
    if (!selected) { shown.current = undefined; editor.setState(EditorState.create({ doc: '' })); return; }
    if (shown.current !== selected.id) {
      shown.current = selected.id;
      if (!states.current.has(selected.id)) bases.current.set(selected.id, selected.source);
      editor.setState(states.current.get(selected.id) ?? createState(selected));
    }
    // Someone saved this script: take their version unless there are edits here.
    if (bases.current.get(selected.id) !== selected.source) {
      if (editor.state.doc.toString() === bases.current.get(selected.id)) {
        bases.current.set(selected.id, selected.source);
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: selected.source } });
      } else if (editor.state.doc.toString() === selected.source) bases.current.set(selected.id, selected.source);
      else setConflict(selected.id);
    }
    if (jump.current !== undefined) {
      const line = editor.state.doc.line(Math.min(Math.max(1, jump.current), editor.state.doc.lines));
      jump.current = undefined;
      editor.dispatch({ selection: EditorSelection.cursor(line.from), effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
      editor.focus();
    }
  });
  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(!canEdit), EditorView.editable.of(canEdit)]) });
  }, [canEdit]);
  // Scroll the console itself: scrollIntoView would also scroll the app shell behind the window.
  useEffect(() => { const list = consoleList.current; if (list) list.scrollTop = list.scrollHeight; }, [project.scriptLog, pane]);

  const save = async () => {
    const editor = view.current;
    if (!editor || !selected || !canEdit) return;
    const source = editor.state.doc.toString();
    if (await dispatch({ type: 'script', script: { ...selected, source } })) {
      bases.current.set(selected.id, source);
      setDrafts(current => (({ [selected.id]: _, ...rest }) => rest)(current));
      if (conflict === selected.id) setConflict(undefined);
    }
  };
  const run = () => {
    if (!runTarget) { notify('Define a function in a script first, such as function roll() ... end.', true); return; }
    if (selected && drafts[selected.id]) notify('Running the saved scripts. Save (Ctrl+S) to run your latest edits.');
    void dispatch({ type: 'call', name: runTarget, args: [], seed: crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff });
  };
  const memoryKeys = Object.keys(project.memory ?? {});
  latest.current = { save: () => void save(), run, name: selected?.name ?? 'script', functions, memoryKeys };

  function complete(context: CompletionContext) {
    const word = context.matchBefore(/[A-Za-z_][\w.]*/);
    if (!word && !context.explicit) return null;
    const options: Completion[] = [
      ...SCRIPT_API.map(entry => ({ label: entry.name, detail: entry.args, info: entry.doc, type: entry.name === 'memory' ? 'variable' : 'function', boost: 2 })),
      ...SCRIPT_HANDLERS.map(handler => snippetCompletion(`function ${handler.name}${handler.args.replace(/\?/g, '')}\n\t\${}\nend`, { label: handler.name, detail: `${handler.args} event`, info: handler.doc, type: 'method', boost: 1 })),
      ...latest.current.functions.map(name => ({ label: name, type: 'function', detail: 'your function' })),
      ...latest.current.memoryKeys.map(key => ({ label: `memory.${key}`, type: 'property', detail: 'memory' })),
      ...LUA_LIBRARY.map(name => ({ label: name, type: 'function' })),
      ...LUA_WORDS.map(name => ({ label: name, type: 'keyword' })),
    ];
    return { from: word?.from ?? context.pos, options, validFor: /^[\w.]*$/ };
  }

  const createScript = async () => {
    const taken = new Set(scripts.map(script => script.name.toLowerCase()));
    let name = scripts.length ? 'Script' : 'Rules';
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `Script ${n}`;
    const script = { id: uid('script'), name, source: scripts.length ? `-- ${name}\n` : FIRST_SCRIPT };
    if (await dispatch({ type: 'script', script })) setSelectedId(script.id);
  };
  const rename = async (script: Script, name: string) => {
    setRenaming(undefined);
    const trimmed = name.trim();
    if (trimmed && trimmed !== script.name) await dispatch({ type: 'script', script: { ...script, name: trimmed.slice(0, 100) } });
  };
  const move = (index: number, offset: number) => {
    const ids = scripts.map(script => script.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    void dispatch({ type: 'reorderScripts', ids });
  };
  const goTo = (scriptName: string, line: number) => {
    const target = scripts.find(script => script.name === scriptName);
    if (!target) return;
    jump.current = line;
    setSelectedId(target.id);
    if (target.id === shown.current) setDrafts(current => ({ ...current })); // re-run the sync effect to apply the jump
  };
  const resizePane = (event: React.PointerEvent<HTMLDivElement>) => {
    const startY = event.clientY, start = paneHeight;
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const moved = (e: PointerEvent) => setPaneHeight(Math.max(70, Math.min(600, start - (e.clientY - startY))));
    const done = () => { element.removeEventListener('pointermove', moved); element.removeEventListener('pointerup', done); };
    element.addEventListener('pointermove', moved); element.addEventListener('pointerup', done);
  };
  const playerName = (id?: string) => project.players.find(player => player.id === id)?.name;
  const reference = [...SCRIPT_HANDLERS.map(handler => ({ name: handler.name, args: handler.args, doc: handler.doc, event: true })), ...SCRIPT_API.map(entry => ({ ...entry, event: false }))]
    .filter(entry => `${entry.name} ${entry.doc}`.toLowerCase().includes(query.trim().toLowerCase()));
  const insert = (text: string) => {
    const editor = view.current;
    if (!editor || !canEdit) { void navigator.clipboard?.writeText(text); notify(`Copied ${text}`); return; }
    editor.dispatch(editor.state.replaceSelection(text));
    editor.focus();
  };

  return <div className="script-editor">
    <aside className="script-list" aria-label="Scripts">
      <div className="script-list-heading"><span>Scripts</span>{canEdit && <button className="icon-button" aria-label="New script" title="New script" onClick={() => void createScript()}><Plus size={15} /></button>}</div>
      <ol>{scripts.map((script, index) => <li key={script.id} className={`${script.id === selected?.id ? 'active' : ''}${drafts[script.id] ? ' dirty' : ''}`}>
        {renaming === script.id ? <input autoFocus defaultValue={script.name} aria-label="Script name" maxLength={100}
          onBlur={event => void rename(script, event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setRenaming(undefined); }} />
          : <button className="script-name" onClick={() => setSelectedId(script.id)} onDoubleClick={() => canEdit && setRenaming(script.id)} title={canEdit ? 'Double-click to rename' : undefined}>
            <FileCode2 size={13} /><span>{script.name}</span>{drafts[script.id] && <i className="dirty-dot" aria-label="Unsaved changes" />}</button>}
        {canEdit && renaming !== script.id && <span className="script-item-actions">
          <button className="icon-button" aria-label={`Move ${script.name} up`} disabled={!index} onClick={() => move(index, -1)}><ChevronUp size={13} /></button>
          <button className="icon-button" aria-label={`Move ${script.name} down`} disabled={index === scripts.length - 1} onClick={() => move(index, 1)}><ChevronDown size={13} /></button>
          <button className="icon-button danger" aria-label={`Delete ${script.name}`} onClick={() => setRemoving(script.id)}><Trash2 size={13} /></button>
        </span>}
        {removing === script.id && <div className="script-remove" role="alert">Delete {script.name}?<span><button className="button" onClick={() => setRemoving(undefined)}>Keep</button>
          <button className="button danger" onClick={() => { setRemoving(undefined); void dispatch({ type: 'removeScript', id: script.id }); }}>Delete</button></span></div>}
      </li>)}</ol>
      {!scripts.length && <p className="script-empty">{canEdit ? 'No scripts yet. Scripts make buttons do things, react to players and keep shared memory.' : 'This project has no scripts.'}
        {canEdit && <button className="button primary" onClick={() => void createScript()}><Plus size={14} /> Create a script</button>}</p>}
      <p className="script-order-note">Scripts run in this order and share their globals.</p>
    </aside>
    <div className="script-main">
      <div className="script-toolbar" role="toolbar" aria-label="Script actions">
        <button className="button" disabled={!canEdit || !selected || !drafts[selected.id]} onClick={() => void save()} title="Save for everyone (Ctrl+S)"><Save size={14} /> Save</button>
        <button className="button" disabled={!canEdit || !selected || !drafts[selected.id]} title="Discard unsaved edits" onClick={() => {
          if (!selected || !view.current) return;
          bases.current.set(selected.id, selected.source);
          view.current.dispatch({ changes: { from: 0, to: view.current.state.doc.length, insert: selected.source } });
          setConflict(undefined);
        }}><RotateCcw size={14} /> Revert</button>
        <span className="toolbar-gap" />
        <SearchSelect label="Function to run" hideLabel className="script-run-select" value={runTarget} placeholder="No functions yet" disabled={!functions.length}
          options={functions.map(name => ({ value: name, label: name }))} onChange={setRunName} />
        <button className="button primary" disabled={!canRun || !runTarget} onClick={run} title="Run this function for everyone (Ctrl+Enter)"><CirclePlay size={14} /> Run</button>
        <button className="icon-button" aria-label="Reload scripts" title="Reload scripts: runs onUnload, then onLoad" disabled={!canEdit || !scripts.length} onClick={() => void dispatch({ type: 'reloadScripts' })}><RefreshCw size={15} /></button>
      </div>
      {!canEdit && <p className="script-banner" role="note"><Info size={13} /> {canRun ? 'Only the host can edit scripts in this room. The host can let players edit them in Table settings.' : 'Take a seat to run functions. Only the host can edit scripts in this room.'}</p>}
      {conflict && conflict === selected?.id && <p className="script-banner warning" role="alert"><TriangleAlert size={13} /> Someone else saved a newer version of {selected.name}.
        <button className="text-button" onClick={() => {
          if (!view.current) return;
          bases.current.set(selected.id, selected.source);
          view.current.dispatch({ changes: { from: 0, to: view.current.state.doc.length, insert: selected.source } });
          setConflict(undefined);
        }}>Load theirs</button><button className="text-button" onClick={() => { bases.current.set(selected.id, selected.source); setConflict(undefined); }}>Keep mine</button></p>}
      <div className="script-code" ref={host} hidden={!selected} />
      {!selected && <div className="script-code script-code-empty"><FileCode2 size={30} /><p>{canEdit ? 'Create a script to start.' : 'Nothing to show.'}</p></div>}
      <div className="script-pane-resize" role="separator" aria-orientation="horizontal" aria-label="Resize console" onPointerDown={resizePane} />
      <div className="script-pane" style={{ height: paneHeight }}>
        <div className="script-pane-tabs" role="tablist">
          <button role="tab" aria-selected={pane === 'console'} className={pane === 'console' ? 'active' : ''} onClick={() => setPane('console')}>Console{!!project.scriptLog?.length && <span className="tab-count">{project.scriptLog.length}</span>}</button>
          <button role="tab" aria-selected={pane === 'reference'} className={pane === 'reference' ? 'active' : ''} onClick={() => setPane('reference')}>Reference</button>
          <span className="toolbar-gap" />
          {pane === 'console' ? <button className="icon-button" aria-label="Clear console" title="Clear the console for everyone" disabled={!project.scriptLog?.length || !canRun} onClick={() => void dispatch({ type: 'clearScriptLog' })}><Eraser size={14} /></button>
            : <div className="search-input script-reference-search"><Search size={12} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find in the reference…" aria-label="Find in the reference" /></div>}
        </div>
        {pane === 'console' ? <div className="script-console" role="log" aria-label="Script console" ref={consoleList}>
          {!project.scriptLog?.length && <p className="script-empty">print(), errors and announcements from every player’s actions appear here.</p>}
          {project.scriptLog?.map(line => {
            const place = line.level === 'error' ? /(?:^|: )([^:\n]+):(\d+): /.exec(line.text) : null;
            const linked = place && scripts.some(script => script.name === place[1]);
            return <div key={line.seq} className={`console-line ${line.level}`}>
              {line.level === 'error' ? <TriangleAlert size={12} /> : line.level === 'announce' ? <Megaphone size={12} /> : <span className="console-dot" />}
              {playerName(line.player) && <span className="console-player">{playerName(line.player)}</span>}
              {linked ? <button className="console-text text-button" title={`Go to ${place![1]} line ${place![2]}`} onClick={() => goTo(place![1], Number(place![2]))}>{line.text}</button> : <span className="console-text">{line.text}</span>}
              {line.to && <span className="console-to" title="Only these seats saw it">to {line.to.map(seat => playerName(seat) ?? 'a removed seat').join(', ') || 'no one'}</span>}
              {line.count && <span className="console-count">×{line.count}</span>}
            </div>;
          })}
        </div> : <div className="script-reference">
          {reference.map(entry => <button key={entry.name} className="reference-entry" title={canEdit ? 'Insert at the cursor' : 'Copy'} onClick={() => insert(entry.event ? `function ${entry.name}${entry.args.replace(/\?/g, '')}\n\nend\n` : entry.name)}>
            <code>{entry.event ? `function ${entry.name}${entry.args}` : `${entry.name}${entry.args}`}</code>{entry.event && <span className="reference-tag">event</span>}<span>{entry.doc}</span></button>)}
          {!reference.length && <p className="script-empty">Nothing matches.</p>}
        </div>}
      </div>
      <div className="script-status"><span>Lua 5.3</span><span>{selected ? drafts[selected.id] ? 'Unsaved changes' : 'Saved' : ''}</span><span>Ctrl+S save · Ctrl+Enter run · Ctrl+F find · Ctrl+Space complete · Ctrl+/ comment</span></div>
    </div>
  </div>;
}
