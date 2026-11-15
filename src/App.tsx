import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, ChevronRight, Circle, Download, FilePlus2, HelpCircle, Layers, Leaf, Link, LoaderCircle, Palette, PanelBottom, PanelLeft, PanelRight, Plus, Search, Settings2, Sparkles, Square, Table2, Trash2, Undo2, Upload, Users, Wifi, WifiOff, X } from 'lucide-react';
import { archiveSchema, makeInstance, projectSchema, uid, validateProject, type Archive, type Command, type Component, type Player, type Project } from './domain';
import { applyPlaygroundCommand, emptyPlaygroundHistory, undoPlayground, type PlaygroundHistory } from './playgroundHistory';
import { starterProject, templateBundle } from './templates';
import { download, exportProject, loadWorkspace, parseArchive, parseComponentBundle, remapComponentBundle, saveWorkspace } from './storage';
import { ComponentThumbnail } from './ComponentView';
import { Designer } from './Designer';
import { Playground } from './Playground';
import type { LiveSession } from './multiplayer';
import { Field, Modal } from './ui';

function boot(): { archive: Archive; error: string | null } {
  try { return { archive: loadWorkspace(), error: null }; }
  catch (error) { return { archive: { format: 'tablecraft', version: 1, projects: [starterProject()] }, error: `Your previous save couldn't be read. It has not been overwritten. ${error instanceof Error ? error.message : String(error)}` }; }
}
function loadSnapshots(): { projects: Project[]; error: string | null } {
  try {
    const raw = localStorage.getItem('tablecraft.snapshots');
    if (!raw) return { projects: [], error: null };
    const archive = archiveSchema.extend({ projects: projectSchema.array().max(100) }).parse(JSON.parse(raw));
    archive.projects.forEach(validateProject);
    return { projects: archive.projects, error: null };
  } catch (error) {
    return { projects: [], error: `Saved snapshots couldn't be read and have not been overwritten. ${String(error)}` };
  }
}

export default function App() {
  const [initial] = useState(boot);
  const templatePreviews = useMemo(() => ({
    card: templateBundle('card'), token: templateBundle('token'),
    board: templateBundle('board'), dice: templateBundle('dice'),
  }), []);
  const [workspace, setWorkspace] = useState<{ archive: Archive; histories: Record<string, PlaygroundHistory> }>({ archive: initial.archive, histories: {} });
  const { archive } = workspace;
  // Whole-workspace imports/snapshots and live subscriptions start a fresh offline history.
  const setArchive = useCallback((update: Archive | ((current: Archive) => Archive)) => {
    setWorkspace(current => ({ archive: typeof update === 'function' ? update(current.archive) : update, histories: {} }));
  }, []);
  const [storageError, setStorageError] = useState(initial.error);
  const [projectId, setProjectId] = useState(initial.archive.projects[0].id);
  const [mode, setMode] = useState<'playground' | 'designer'>('playground');
  const [componentId, setComponentId] = useState<string | undefined>(initial.archive.projects[0].components[0]?.id);
  const [selected, setSelected] = useState<string[]>([]);
  const [libraryVisible, setLibraryVisible] = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [handVisible, setHandVisible] = useState(true);
  const [actor, setActor] = useState(initial.archive.projects[0].players[0]?.id ?? '');
  const [curtain, setCurtain] = useState<Player>();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState<'templates' | 'projects' | 'session' | 'help' | 'save'>();
  const [toast, setToast] = useState<{ message: string; error: boolean; id: number }>();
  const [session, setSession] = useState<LiveSession>();
  const [liveUndo, setLiveUndo] = useState({ count: 0, notice: '' });
  const sessionRef = useRef<LiveSession | undefined>(undefined);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [uri, setUri] = useState(import.meta.env.VITE_SPACETIMEDB_URI ?? 'http://127.0.0.1:3000');
  const [database, setDatabase] = useState(import.meta.env.VITE_SPACETIMEDB_DATABASE ?? 'tablecraft-studio');
  const [roomCode, setRoomCode] = useState(() => `PLAY-${crypto.randomUUID().slice(0, 6).toUpperCase()}`);
  const [playerName, setPlayerName] = useState('You');
  const [projectName, setProjectName] = useState('');
  const [spawnCount, setSpawnCount] = useState(1);
  const [saveName, setSaveName] = useState('');
  const [snapshotStore, setSnapshotStore] = useState(loadSnapshots);
  const { projects: snapshots, error: snapshotError } = snapshotStore;
  const fileInput = useRef<HTMLInputElement>(null);
  const project = archive.projects.find(p => p.id === projectId) ?? archive.projects[0];
  const activeComponent = project.components.find(c => c.id === componentId) ?? project.components[0];
  const fontFamilies = [...new Set(project.components.flatMap(c => [...c.front, ...c.back].map(n => n.font)).filter(Boolean))].sort().join('|');
  const notify = useCallback((message: string, error = false) => setToast({ message, error, id: Date.now() }), []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(undefined), toast.error ? 8000 : 4000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (storageError) return;
    try { saveWorkspace(archive); } catch (error) { setStorageError(`Unable to save in this browser: ${String(error)}. Export your project to keep your work.`); }
  }, [archive, storageError]);
  useEffect(() => {
    if (!fontFamilies) return;
    const fonts = fontFamilies.split('|');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${fonts.map(font => `family=${encodeURIComponent(font)}:wght@400;500;600;700`).join('&')}&display=swap`;
    document.head.appendChild(link);
    return () => link.remove();
  }, [fontFamilies]);
  useEffect(() => () => sessionRef.current?.disconnect(), []);
  useEffect(() => {
    let pointer: { id: number; x: number; y: number; moved: boolean; target?: HTMLInputElement | HTMLTextAreaElement } | undefined;
    const pointerDown = (event: PointerEvent) => {
      if (event.button === 0) pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    };
    const selectInput = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLInputElement && ['text', 'number', 'search', 'url'].includes(target.type))) return;
      if (pointer) { pointer.target = target; return; }
      requestAnimationFrame(() => { if (document.activeElement === target) target.select(); });
    };
    const pointerMove = (event: PointerEvent) => {
      if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >= 4) pointer.moved = true;
    };
    const pointerUp = (event: PointerEvent) => {
      if (pointer?.id !== event.pointerId) return;
      const { target, moved } = pointer;
      pointer = undefined;
      if (target && !moved) requestAnimationFrame(() => { if (document.activeElement === target) target.select(); });
    };
    const cancel = () => { pointer = undefined; };
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('pointermove', pointerMove, true);
    document.addEventListener('pointerup', pointerUp, true);
    document.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', cancel);
    document.addEventListener('focusin', selectInput);
    return () => {
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('pointermove', pointerMove, true);
      document.removeEventListener('pointerup', pointerUp, true);
      document.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('focusin', selectInput);
    };
  }, []);
  const setProject = useCallback((next: Project) => {
    setArchive(current => ({
      ...current, projects: current.projects.some(p => p.id === next.id) ? current.projects.map(p => p.id === next.id ? next : p) : [...current.projects, next],
    }));
    setProjectId(next.id);
  }, []);
  const dispatch = useCallback((command: Command): Promise<boolean> => {
    if (sessionRef.current) {
      return sessionRef.current.send(command, actor).then(() => true).catch(error => {
        notify(error instanceof Error ? error.message : String(error), true);
        return false;
      });
    }
    return new Promise(resolve => {
      setWorkspace(current => {
        try {
          const source = current.archive.projects.find(p => p.id === projectId);
          if (!source) throw new Error('Project no longer exists.');
          const result = applyPlaygroundCommand(source, current.histories[projectId] ?? emptyPlaygroundHistory(), command, actor);
          const next = {
            archive: { ...current.archive, projects: current.archive.projects.map(p => p.id === projectId ? result.project : p) },
            histories: { ...current.histories, [projectId]: result.history },
          };
          queueMicrotask(() => resolve(true));
          return next;
        } catch (error) {
          queueMicrotask(() => { notify(error instanceof Error ? error.message : String(error), true); resolve(false); });
          return current;
        }
      });
    });
  }, [actor, projectId, notify]);
  const undoCount = session ? liveUndo.count : workspace.histories[project.id]?.entries.length ?? 0;
  const undoNotice = session ? liveUndo.notice : workspace.histories[project.id]?.notice ?? '';
  const undo = useCallback(() => {
    if (sessionRef.current) {
      void sessionRef.current.undo(actor).catch(error => notify(error instanceof Error ? error.message : String(error), true));
      return;
    }
    setWorkspace(current => {
      const source = current.archive.projects.find(p => p.id === projectId);
      if (!source) return current;
      const result = undoPlayground(source, current.histories[projectId] ?? emptyPlaygroundHistory());
      return {
        archive: { ...current.archive, projects: current.archive.projects.map(p => p.id === projectId ? result.project : p) },
        histories: { ...current.histories, [projectId]: result.history },
      };
    });
  }, [actor, projectId, notify]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (mode !== 'playground' || modal || curtain || event.defaultPrevented || event.isComposing || event.repeat ||
        !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'z') return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"]')) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      event.preventDefault();
      if (undoCount) undo();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [mode, modal, curtain, undoCount, undo]);
  const edit = (id: string) => { setComponentId(id); setMode('designer'); };
  const switchPlayer = (player: Player) => {
    if (session && player.owner !== session.identity) { notify('This seat belongs to another connected player.', true); return; }
    if (player.id !== actor) { setCurtain(player); setSelected([]); }
  };
  const spawn = (component: Component, allRows = false) => {
    const count = allRows ? Math.max(component.rows.length, 1) : spawnCount;
    const instances = Array.from({ length: Math.min(count, 1000) }, (_, i) => ({
      ...makeInstance(component.id, allRows ? i : 0, 820 + (i % 5) * 24, 450 + Math.floor(i / 5) * 24),
      scale: component.kind === 'card' ? .72 : component.kind === 'board' ? .8 : .8,
    }));
    void dispatch({ type: 'spawn', instances }).then(success => {
      if (success) { setSelected(instances.map(i => i.id)); notify(`Added ${instances.length === 1 ? component.name : `${instances.length} pieces`} to the table.`); }
    });
  };
  const addTemplate = async (kind: Component['kind'] | 'blank') => {
    try {
      const { root, components } = templateBundle(kind);
      validateProject({ ...project, components: [...project.components, ...components] });
      let added = 0;
      for (const component of components) {
        if (!await dispatch({ type: 'component', component })) {
          notify(added ? `Template creation stopped after adding ${added} linked component${added === 1 ? '' : 's'}.` : 'Template could not be created.', true);
          return;
        }
        added++;
      }
      setComponentId(root.id); setMode('designer'); setModal(undefined); notify('A fresh canvas, ready for your ideas.');
    } catch (error) {
      notify(`Template creation failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 20_000_000) throw new Error('Import files must be smaller than 20 MB.');
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null && 'format' in parsed && parsed.format === 'tablecraft') {
        if (session) throw new Error('Leave the live session before importing a project. Component JSON can be imported while connected.');
        const incoming = parseArchive(text);
        const projects = incoming.projects.map(p => ({ ...p, id: uid('project') }));
        setArchive(current => ({ ...current, projects: [...current.projects, ...projects] }));
        setProjectId(projects[0].id); setActor(projects[0].players[0]?.id ?? ''); setSelected([]);
        setStorageError(null); notify(`Imported ${projects.length} project${projects.length === 1 ? '' : 's'}.`);
      } else {
        const bundle = parseComponentBundle(text);
        const remapped = remapComponentBundle(bundle);
        validateProject({ ...project, components: [...project.components, ...remapped.components] });
        for (const component of remapped.components) {
          if (!await dispatch({ type: 'component', component })) throw new Error('A linked component could not be imported.');
        }
        edit(remapped.rootId); notify(`Imported ${remapped.components.length} linked component${remapped.components.length === 1 ? '' : 's'}.`);
      }
    } catch (error) { notify(`Import failed: ${error instanceof Error ? error.message : String(error)}`, true); }
  };
  const join = async (host: boolean) => {
    setConnecting(true); setConnectionError('');
    try {
      if (!/^https?:\/\//.test(uri) && !/^wss?:\/\//.test(uri)) throw new Error('Use an http(s) or ws(s) SpaceTimeDB address.');
      if (!/^[A-Z0-9-]{4,40}$/.test(roomCode)) throw new Error('Use 4-40 uppercase letters, digits or hyphens for the room code.');
      const { connectRoom } = await import('./multiplayer');
      const live = await connectRoom({
        uri, database, code: roomCode, host, project, playerId: uid('player'), name: playerName.trim() || 'Player', color: '#b7cc91',
      }, (next, history) => { setProject(next); setLiveUndo(history); }, message => notify(message, true), () => {
        sessionRef.current = undefined; setSession(undefined); notify('Disconnected. Your latest table is saved locally.', true);
      });
      sessionRef.current = live; setSession(live);
      const row = [...live.connection.db.roomState.iter()][0];
      if (row) {
        const liveProject: Project = JSON.parse(row.state);
        const ownPlayer = liveProject.players.find(p => p.owner === live.identity);
        if (ownPlayer) setActor(ownPlayer.id);
      }
      setModal(undefined); notify(`Connected to ${roomCode}. Welcome to the table.`);
    } catch (error) { setConnectionError(error instanceof Error ? error.message : String(error)); }
    finally { setConnecting(false); }
  };
  const leave = () => {
    sessionRef.current?.disconnect(); sessionRef.current = undefined; setSession(undefined); setModal(undefined);
  };
  const visible = project.components.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || c.kind === filter));
  const selectedComponent = mode === 'designer' ? activeComponent : project.components.find(c => c.id === project.instances.find(i => i.id === selected.at(-1))?.componentId);
  return <div className={`app-shell ${mode === 'playground' ? 'playground-shell' : ''}`}>
    <header className="app-header">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setMode('playground'); }}><span className="brand-mark"><Layers size={23} strokeWidth={1.8} /></span>tablecraft<span className="brand-beta">BETA</span></a>
      <div className="project-heading compact-project"><h1>{project.name}</h1><button className="icon-button" aria-label="Project settings" onClick={() => { setProjectName(project.name); setModal('projects'); }}><ChevronDown size={16} /></button></div>
      <nav className="mode-switch" aria-label="Workspace mode"><button className={mode === 'playground' ? 'active' : ''} onClick={() => setMode('playground')}><Table2 size={16} /> Playground</button><button className={mode === 'designer' ? 'active' : ''} onClick={() => { if (!activeComponent) setModal('templates'); else setMode('designer'); }}><Palette size={16} /> Component designer</button></nav>
      {mode === 'playground' && <button className="icon-button" aria-label="Undo playground action" title={undoNotice || `Undo latest playground action for everyone (Ctrl/Cmd+Z) · ${undoCount} available`} disabled={!undoCount || !!modal || !!curtain} onClick={undo}><Undo2 size={18} /></button>}
      <div className="header-actions">{mode === 'playground' && <><button className="icon-button" title="Toggle component library" aria-label="Toggle component library" aria-pressed={libraryVisible} onClick={() => setLibraryVisible(!libraryVisible)}><PanelLeft size={17} /></button><button className="icon-button" title="Toggle hand panel" aria-label="Toggle hand panel" aria-pressed={handVisible} onClick={() => setHandVisible(!handVisible)}><PanelBottom size={17} /></button><button className="icon-button" title="Toggle table inspector" aria-label="Toggle table inspector" aria-pressed={inspectorVisible} onClick={() => setInspectorVisible(!inspectorVisible)}><PanelRight size={17} /></button></>}<button className="button compact-save" aria-label="Save playground" title="Save playground" onClick={() => { setSaveName(`${project.name} - playtest`); setModal('save'); }}><ArrowDownToLine size={15} /></button><button className="button primary compact-invite" onClick={() => setModal('session')}><Users size={15} />{session ? session.code : 'Invite players'}</button><button className="help-button icon-button" title="How to use Tablecraft" aria-label="Help" onClick={() => setModal('help')}><HelpCircle size={19} /></button><span className="header-separator" /><button className="connection-badge" onClick={() => setModal('session')}><span className={`live-dot ${session ? '' : 'offline'}`} />{session ? 'Live session' : 'Local workspace'}</button><button className="profile-button" aria-label="My projects" onClick={() => setModal('projects')}>Y</button></div>
    </header>
    {mode === 'playground' && undoNotice && <div className="error-banner" role="status">{undoNotice}</div>}
    {storageError && <div className="error-banner" role="alert">{storageError}<button onClick={() => {
      const raw = localStorage.getItem('tablecraft.workspace.v1'); if (raw) download('tablecraft-recovery.json', raw);
      setStorageError(null);
    }}>Download recovery & continue</button><button onClick={() => exportProject(project)}>Export current work</button></div>}
    <main className="main-layout">
      <aside className="library-panel" hidden={mode === 'playground' && !libraryVisible}>
        <div className="library-heading"><h2>Components <span>{project.components.length}</span></h2><button className="icon-button" aria-label="Add component" title="Add component" onClick={() => setModal('templates')}><Plus size={18} /></button></div>
        <div className="library-search search-input"><Search size={14} /><input placeholder="Find a component..." value={search} onChange={e => setSearch(e.target.value)} aria-label="Search components" /><kbd>⌕</kbd></div>
        <div className="library-filters">{[{ id: 'all', label: 'All' }, { id: 'card', label: 'Cards' }, { id: 'token', label: 'Tokens' }, { id: 'board', label: 'Boards' }, { id: 'dice', label: 'Dice' }].map(f => <button key={f.id} className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>{f.label}</button>)}</div>
        <div className="library-section-label">PROJECT LIBRARY <span>{visible.length}</span></div>
        <div className="component-library">{visible.map(comp => <div key={comp.id} className={`library-item ${selectedComponent?.id === comp.id ? 'active' : ''}`}>
          <button className={`library-preview library-preview-${comp.kind}`} onClick={() => mode === 'designer' ? setComponentId(comp.id) : spawn(comp)} aria-label={mode === 'designer' ? `Design ${comp.name}` : `Spawn ${comp.name}`} title={mode === 'designer' ? `Design ${comp.name}` : `Spawn ${comp.name}`}>
            <div className="preview-texture" />
            {comp.kind === 'card' && <><div className="preview-ghost ghost-left"><ComponentThumbnail component={comp} components={project.components} row={1} width={66} /></div><div className="preview-ghost ghost-right"><ComponentThumbnail component={comp} components={project.components} row={2} width={66} /></div></>}
            <div className="preview-main"><ComponentThumbnail component={comp} components={project.components} width={comp.kind === 'board' ? 152 : comp.kind === 'token' ? 62 : comp.kind === 'dice' ? 52 : 70} /></div>
            <span className="preview-kind">{comp.kind === 'card' ? <Layers size={10} /> : comp.kind === 'token' ? <Circle size={10} /> : <Square size={10} />}{comp.kind}</span>
            <span className="preview-add"><Plus size={17} /></span>
          </button>
          <div className="library-item-label"><button onClick={() => edit(comp.id)}><strong>{comp.name}</strong><small>{comp.rows.length > 1 ? `${comp.rows.length} variants` : `${comp.width} × ${comp.height} px`}{comp.rows.length > 1 && <span className="data-dot" />}</small></button>
            <button className="icon-button" title={`Edit ${comp.name}`} aria-label={`Edit ${comp.name}`} onClick={() => edit(comp.id)}><Settings2 size={14} /></button></div>
          {mode === 'playground' && <div className="library-item-options"><button onClick={() => spawn(comp, true)}><Plus size={11} /> {comp.rows.length > 1 ? 'Spawn all variants' : 'Spawn piece'}</button></div>}
        </div>)}
          {!visible.length && <div className="empty-note">{search || filter !== 'all' ? 'No components match your search.' : 'Your first component is one click away.'}<button className="text-button" onClick={() => setModal('templates')}>Create a component <Plus size={13} /></button></div>}
          <button className="new-component-button" onClick={() => setModal('templates')}><Plus size={16} /> Create component</button>
        </div>
        <div className="library-footer">{mode === 'playground' && <label className="spawn-quantity">Spawn quantity<input aria-label="Spawn quantity" type="number" min={1} max={1000} value={spawnCount} onChange={e => { if (Number.isFinite(e.target.valueAsNumber)) setSpawnCount(Math.max(1, Math.min(1000, Math.floor(e.target.valueAsNumber)))); }} /></label>}<div className="library-tip"><Sparkles size={16} /><p>{mode === 'playground' ? 'Click a component to spawn it.' : 'Design once. Update everywhere.'}<small>{mode === 'playground' ? 'Your ideas belong on the table.' : 'Every instance stays connected.'}</small></p></div><div className="library-footer-actions"><button onClick={() => fileInput.current?.click()}><Upload size={13} /> Import</button><button onClick={() => exportProject(project)}><Download size={13} /> Export</button></div></div>
      </aside>
      <div className="workspace-content">{mode === 'playground' ? <Playground project={project} actor={actor} owner={session?.identity ?? 'local'} selected={selected} setSelected={setSelected} inspectorVisible={inspectorVisible} handVisible={handVisible} onShowInspector={() => setInspectorVisible(true)} dispatch={dispatch} onEdit={edit} onSwitch={switchPlayer} notify={notify} /> :
        activeComponent ? <Designer key={activeComponent.id} component={activeComponent} components={project.components} onChange={(component, removedDataRow) => dispatch({ type: 'component', component, removedDataRow })} onDelete={async () => {
          if (await dispatch({ type: 'removeComponent', id: activeComponent.id })) { setComponentId(undefined); setSelected([]); }
        }} notify={notify} /> : <div className="no-component"><Palette size={40} /><h2>A blank page is a beautiful thing.</h2><button className="button primary" onClick={() => setModal('templates')}>Create your first component</button></div>}</div>
    </main>
    <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
    {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <WifiOff size={17} /> : <Check size={17} />}<span>{toast.message}</span><button onClick={() => setToast(undefined)} aria-label="Dismiss notification"><X size={14} /></button></div>}
    {modal === 'templates' && <Modal title="What will you make?" subtitle="A starting point, not a limitation. Every detail is yours to change." wide onClose={() => setModal(undefined)}>
      <div className="template-grid">{([
        ['card', 'Cards', 'Characters, spells, a little intrigue.'], ['token', 'Tokens', 'Small pieces. Big possibilities.'],
        ['board', 'Boards', 'Build a world to play in.'], ['dice', 'Dice', 'Leave a little to chance.'],
      ] as const).map(([kind, title, description]) => <button key={kind} className={`template-card template-${kind}`} onClick={() => addTemplate(kind)}><div className="template-art"><ComponentThumbnail component={templatePreviews[kind].root} components={templatePreviews[kind].components} width={kind === 'board' ? 140 : kind === 'card' ? 78 : 64} /></div><strong>{title}<ArrowRight size={15} /></strong><small>{description}</small></button>)}</div>
      <button className="blank-template" onClick={() => addTemplate('blank')}><FilePlus2 size={24} /><span><strong>Start from scratch</strong><small>A blank component for a brand new idea.</small></span><ArrowRight size={17} /></button>
    </Modal>}
    {modal === 'projects' && <Modal title="Your workshop" subtitle="All your worlds, works in progress, and what-ifs." wide onClose={() => setModal(undefined)}>
      <div className="projects-dialog"><div className="projects-list">{archive.projects.map(p => <button key={p.id} disabled={!!session && p.id !== project.id} className={`project-card ${p.id === project.id ? 'active' : ''}`} onClick={() => {
        setProjectId(p.id); setActor(p.players.find(player => !session || player.owner === session.identity)?.id ?? p.players[0]?.id ?? '');
        setComponentId(p.components[0]?.id); setSelected([]); setModal(undefined);
      }}><span className="project-card-icon"><Leaf size={24} /></span><span><strong>{p.name}</strong><small>{p.components.length} components · {p.instances.length} pieces · {p.players.length} players</small></span><ChevronRight size={18} /></button>)}</div>
        <div className="project-tools"><Field label="Project name"><input maxLength={100} value={projectName || project.name} onChange={e => setProjectName(e.target.value)} /></Field><button className="button" onClick={() => { void dispatch({ type: 'rename', name: projectName || project.name }).then(success => { if (success) notify('Project renamed.'); }); }}>Rename</button></div>
        <div className="button-row"><button className="button primary" disabled={!!session} onClick={() => {
          const next = starterProject(); next.name = `Untitled project ${archive.projects.length + 1}`; next.components = []; next.instances = [];
          setProject(next); setActor(next.players[0].id); setModal('templates');
        }}><Plus size={15} /> New project</button><button className="button" disabled={!!session} onClick={() => fileInput.current?.click()}><Upload size={15} /> Import JSON</button><button className="button" onClick={() => download('tablecraft-workspace.json', JSON.stringify(archive, null, 2))}><Download size={15} /> Export all projects</button></div>
      </div>
    </Modal>}
    {modal === 'session' && <Modal title={session ? 'Your table is live.' : 'Good games bring people together.'} subtitle={session ? 'Share this room code with your playtesters.' : 'Play together over SpaceTimeDB, or pass the screen with hotseat.'} onClose={() => { if (!connecting) setModal(undefined); }}>
      <div className="session-dialog">{session ? <>
        <div className="room-code"><span>ROOM CODE</span><strong>{session.code}</strong><button className="button" onClick={() => {
          void navigator.clipboard.writeText(`${session.code}\n${uri}\n${database}`).then(() => notify('Room details copied.')).catch(error => notify(String(error), true));
        }}><CopyIcon /> Copy room details</button></div>
        <p className="help-text">You're connected to {database}. Open the component designer without leaving the session. Everyone sees edits live.</p>
        <button className="button full" onClick={leave}><WifiOff size={15} /> Leave session & keep local copy</button>
      </> : <>
        <div className="session-note"><Users size={22} /><div><strong>Already sharing a screen?</strong><p>Hotseat works offline. Add players in the Players tab and switch seats to keep hands hidden.</p></div></div>
        <Field label="Your name"><input maxLength={50} value={playerName} onChange={e => setPlayerName(e.target.value)} /></Field>
        <Field label="SpaceTimeDB server"><input value={uri} onChange={e => setUri(e.target.value)} placeholder="http://127.0.0.1:3000" /></Field>
        <Field label="Database name"><input value={database} onChange={e => setDatabase(e.target.value)} /></Field>
        <Field label="Room code"><input className="room-code-input" maxLength={40} value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())} /></Field>
        <p className="help-text">Host publishes this playground to the room. Join opens an existing room. A room code grants editing access; use trusted playtesters. Hidden hand faces are a UI feature, not cryptographic privacy.</p>
        {connectionError && <div className="inline-error" role="alert">{connectionError}</div>}
        <div className="button-row"><button className="button full" disabled={connecting} onClick={() => void join(false)}>{connecting ? <LoaderCircle className="spin" size={15} /> : <Link size={15} />} Join room</button><button className="button primary full" disabled={connecting} onClick={() => void join(true)}>{connecting ? <LoaderCircle className="spin" size={15} /> : <Wifi size={15} />} Host this table</button></div>
      </>}</div>
    </Modal>}
    {modal === 'save' && <Modal title="Keep this moment." subtitle="Save a named playground snapshot, including designs, hands and seats." onClose={() => setModal(undefined)}>
      <div className="save-dialog"><Field label="Snapshot name"><input value={saveName} maxLength={100} onChange={e => setSaveName(e.target.value)} /></Field>
        {snapshotError && <div className="inline-error" role="alert">{snapshotError}<button className="button" onClick={() => {
          download('tablecraft-snapshots-recovery.json', localStorage.getItem('tablecraft.snapshots') ?? '');
          setSnapshotStore({ projects: [], error: null });
        }}>Download recovery & reset snapshots</button></div>}
        <div className="button-row"><button className="button primary" disabled={!!snapshotError || snapshots.length >= 100} onClick={() => {
          try {
            const snapshot = { ...structuredClone(project), id: uid('snapshot'), name: saveName.trim() || project.name };
            const next = [...snapshots, snapshot];
            localStorage.setItem('tablecraft.snapshots', JSON.stringify({ format: 'tablecraft', version: 1, projects: next }));
            setSnapshotStore({ projects: next, error: null }); notify('Playground snapshot saved.');
          } catch (error) { notify(`Save failed: ${String(error)}`, true); }
        }}><ArrowDownToLine size={15} /> Save snapshot</button><button className="button" onClick={() => exportProject(project)}><Download size={15} /> Export JSON</button></div>
        <h3 className="saved-heading">Saved playgrounds</h3>{!snapshots.length && <p className="help-text">No snapshots yet. Your workspace is also saved automatically.</p>}
        <div className="snapshot-list">{snapshots.map(snapshot => <div key={snapshot.id}><div><strong>{snapshot.name}</strong><small>{snapshot.instances.length} pieces · {snapshot.players.length} players</small></div><button className="button" disabled={!!session} onClick={() => {
          const next = { ...structuredClone(snapshot), id: uid('project') };
          setProject(next); setActor(next.players[0]?.id ?? ''); setSelected([]); setModal(undefined); notify('Playground restored, including every hand and seat.');
        }}>Load</button><button className="icon-button" aria-label={`Delete ${snapshot.name}`} onClick={() => {
          try {
            const next = snapshots.filter(p => p.id !== snapshot.id);
            localStorage.setItem('tablecraft.snapshots', JSON.stringify({ format: 'tablecraft', version: 1, projects: next }));
            setSnapshotStore({ projects: next, error: null });
          } catch (error) { notify(String(error), true); }
        }}><Trash2 size={14} /></button></div>)}</div>
      </div>
    </Modal>}
    {modal === 'help' && <Modal title="Welcome to your workshop." subtitle="Less setup. More 'what if?'" wide onClose={() => setModal(undefined)}>
      <div className="help-grid"><div><span>01</span><h3>Make your pieces</h3><p>Start from a template or a blank component. Add layers and nested frames, style them, and connect text or images to CSV columns with {'{{bindings}}'}.</p></div><div><span>02</span><h3>Bring them to the table</h3><p>Click a library component to spawn it. Shift-click to select multiple pieces, then stack compatible pieces. Double-click to flip a card or draw from a stack.</p></div><div><span>03</span><h3>Find the fun</h3><p>Add hotseat players, switch seats and play. Connect a SpaceTimeDB room for online play. Design changes stay live for everyone.</p></div></div>
      <div className="keyboard-shortcuts"><span><kbd>F</kbd> Flip</span><span><kbd>R</kbd> Rotate</span><span><kbd>S</kbd> Shuffle / roll</span><span><kbd>G</kbd> Stack</span><span><kbd>Ctrl C/V</kbd> Copy / paste</span><span><kbd>Ctrl D</kbd> Clone</span><span><kbd>Del</kbd> Delete</span><span><kbd>Scroll</kbd> Zoom</span><span><kbd>Middle drag</kbd> Pan</span></div>
      <div className="help-footer"><Leaf size={18} /><p>Your work stays in this browser. Export JSON to back it up or move it to another device. External textures and Google Fonts need internet access.</p></div>
    </Modal>}
    {curtain && <div className="privacy-curtain"><span className="brand-mark"><Layers size={32} /></span><p>PASS THE SCREEN TO</p><h1>{curtain.name}</h1><span className="curtain-avatar" style={{ background: curtain.color }}>{curtain.name[0]}</span><p className="curtain-description">A little privacy for your next big move.</p><button className="button primary" onClick={() => { setActor(curtain.id); setCurtain(undefined); }}>I'm {curtain.name}. Let's play. <ArrowRight size={17} /></button><button className="text-button" onClick={() => setCurtain(undefined)}>Back to the current player</button></div>}
  </div>;
}
function CopyIcon() { return <Square size={14} />; }
