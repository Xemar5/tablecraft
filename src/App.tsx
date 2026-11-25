import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Armchair, ArrowRight, EyeOff, FolderX, Menu, Redo2, BookOpen, Check, ChevronDown, ChevronRight, Circle, CopyPlus, Database, Dices, Eye, FileCode2, MousePointerClick, GripVertical, HelpCircle, Layers, LayoutGrid, Grid3x3, LayoutList, Leaf, LibraryBig, Link, LoaderCircle, Monitor, Moon, Move, Palette, PencilLine, PanelBottom, PanelLeft, PanelRight, Plus, Printer, Save, Search, Settings, Square, Sun, Table2, Type, Undo2, Upload, Users, Wifi, WifiOff, X, Image as ImageIcon } from 'lucide-react';
import { applyCommand, archiveSchema, assetByName, bind, canStack, hasPages, isAsset, makeInstance, nextSeatPlacement, projectSchema, uid, validateProject, withUniqueAssetNames, type Archive, type Command, type Component, type Player, type Project } from './domain';
import { applyPlaygroundCommand, emptyPlaygroundHistory, redoPlayground, undoPlayground, type PlaygroundHistory } from './playgroundHistory';
import { blankProject, starterProject, templateBundle, type TemplateKind } from './templates';
import { gameProject, type GameProjectId } from './gameProjects';
import { download, loadWorkspace, remapComponentBundle, saveWorkspace } from './storage';
import { addSnapshot, assignLegacySnapshots, baseSnapshot, deleteSession, deleteSnapshot, DRAFT_LIMIT, emptyHistory, findSession, findSnapshot, hasUnsavedChanges, LEGACY_SNAPSHOTS_KEY, latestSnapshot,
  loadHistories, loadOpenProject, makeSnapshot, readHistory, remapHistory, removeHistory, renameItem, restingSnapshot, restoreSnapshot, saveHistory, saveOpenProject, selectHistory, setStatus, startSession,
  type History, type OpenProject, type Snapshot } from './projectHistory';
import { ExportDialog, GameChooser, HistoryManager, UnsavedDialog } from './SnapshotManager';
import { addDraftEdit, clearDesignDraft, loadDesignDraft, recoverDesignDraft, saveDesignDraft, withDraft, type DesignDraft } from './designDraft';
import { createPortableZip, downloadZip, projectZip, readPortableZip } from './portable';
import { FONT_ACCEPT, importAsset, TEXTURE_ACCEPT } from './assets';
import { AssetFonts, AssetInspector } from './AssetInspector';
import { ComponentThumbnail } from './ComponentView';
import { Designer } from './Designer';
import { Playground } from './Playground';
import { PanelSeparator, usePanelLayout } from './panelLayout';
import type { LiveSession } from './multiplayer';
import { ColorField, Field, Modal, Notice, NumberField, ScrollArrows, Toggle, useSmoothHorizontalWheel } from './ui';
import { applyUiScale, clampUiScale, UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_PRESETS } from './uiScale';
import { Home } from './Home';
import { LinkedComponent } from './LinkedComponent';
import { linkComponent, localComponentCopy, refreshProjectLinks } from './projectLinks';
import { LibraryVariants } from './LibraryVariants';
import { PrintDialog } from './PrintProject';
import { startLibraryDrag } from './libraryDrag';
import { FloatingWindow } from './FloatingWindow';
import { HeaderMenu } from './HeaderMenu';
import { createMemoryStore, MemoryBindings } from './memoryBindings';
import { scriptFunctions, scriptsMention } from './scripting';
import { cleanName, DEFAULT_DATABASE, DEFAULT_SERVER, loadSettings, NAME_LIMIT, saveSettings, validName, watchTheme, type UserSettings } from './settings';
import './library.css';

// The code editor is large; it loads the first time the window opens.
const ScriptEditor = lazy(() => import('./ScriptEditor').then(module => ({ default: module.ScriptEditor })));
const MemoryEditor = lazy(() => import('./MemoryEditor').then(module => ({ default: module.MemoryEditor })));
const loadingWindow = <div className="script-empty" role="status">Loading…</div>;

type LibraryView = 'large' | 'small' | 'list';
const LIBRARY_VIEW_KEY = 'tablecraft.libraryView';
const kindIcon = (kind: Component['kind'], size: number) => kind === 'card' ? <Layers size={size} /> : kind === 'token' ? <Circle size={size} /> : kind === 'artwork' ? <Palette size={size} />
  : kind === 'book' ? <BookOpen size={size} /> : kind === 'texture' ? <ImageIcon size={size} /> : kind === 'font' ? <Type size={size} />
  : kind === 'board' ? <LayoutGrid size={size} /> : kind === 'dice' ? <Dices size={size} /> : kind === 'button' ? <MousePointerClick size={size} /> : <Square size={size} />;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
type Boot = {
  archive: Archive; error: string | null; draftNotice?: string; draftStored: boolean;
  histories: Record<string, History>; brokenHistories: string[]; historyError: string | null; open?: OpenProject;
};
function boot(): Boot {
  const draft = loadDesignDraft();
  try {
    // Designer changes still pending when the page closed are applied as if the playground had been opened.
    const { archive: saved, recovered, skipped } = recoverDesignDraft(loadWorkspace(), draft);
    const draftNotice = recovered || skipped ? `Restored ${recovered} unsaved designer change${recovered === 1 ? '' : 's'}${skipped ? `; ${skipped} no longer applied` : ''}.` : undefined;
    let archive = refreshProjectLinks(saved);
    const { histories, errors } = loadHistories(archive.projects.map(project => project.id));
    const brokenHistories = archive.projects.map(project => project.id).filter(id => !histories[id] && readHistory(id) !== null);
    const notices = errors.length ? [`Saved snapshots of ${errors.length} project${errors.length === 1 ? '' : 's'} couldn't be read and have not been overwritten.`] : [];
    try { archive = migrateLegacySnapshots(archive, histories, brokenHistories); }
    catch (error) { notices.push(`Saved snapshots couldn't be moved into their projects and have been kept as they were. ${message(error)}`); }
    let open = loadOpenProject();
    const head = open && archive.projects.find(project => project.id === open!.projectId);
    if (!head) open = undefined;
    else if (!brokenHistories.includes(head.id)) open = rememberLoaded(head, histories, open!);
    return { archive, error: null, draftNotice, draftStored: !!draft, histories, brokenHistories, historyError: notices.join(' ') || null, open };
  }
  catch (error) {
    return { archive: { format: 'tablecraft', version: 1, projects: [starterProject()] }, draftStored: !!draft, histories: {}, brokenHistories: [], historyError: null,
      error: `Your previous save couldn't be read. It has not been overwritten. ${message(error)}` };
  }
}
/**
 * The project loaded when the page closed stays loaded, with any changes since its last snapshot. One loaded before
 * projects kept snapshots (or never saved one) starts from a snapshot of its table, so nothing is lost.
 */
function rememberLoaded(head: Project, histories: Record<string, History>, open: OpenProject): OpenProject {
  let history = histories[head.id] ?? emptyHistory();
  if (open.from && findSnapshot(history, open.from)) return open;
  const session = findSession(history, open.session)?.id;
  const latest = latestSnapshot(history, session);
  if (latest && !hasUnsavedChanges(head, history, { projectId: head.id, session, from: latest.id })) return { projectId: head.id, ...(session ? { session } : {}), from: latest.id };
  try {
    const snapshot = makeSnapshot(head, `${head.name} - ${history.snapshots.length ? 'latest' : 'initial state'}`);
    history = addSnapshot(history, snapshot, session);
    saveHistory(head.id, history);
    histories[head.id] = history;
    return { projectId: head.id, ...(session ? { session } : {}), from: snapshot.id };
  } catch { return { projectId: head.id, ...(session ? { session } : {}) }; }
}
/**
 * Snapshots used to be one list shared by every project (Actions → Save/Load). Each now goes to the project it was saved
 * from, after its existing draft snapshots and before a snapshot of its current table; ones from no remaining project
 * become projects of their own. The old list is removed only once everything is saved.
 */
function migrateLegacySnapshots(archive: Archive, histories: Record<string, History>, broken: string[]): Archive {
  const raw = localStorage.getItem(LEGACY_SNAPSHOTS_KEY);
  if (!raw) return archive;
  const legacy = archiveSchema.extend({ projects: projectSchema.array().max(100) }).parse(JSON.parse(raw)).projects;
  const { byProject, unmatched } = assignLegacySnapshots(archive.projects, legacy);
  if ([...byProject.keys()].some(id => broken.includes(id))) throw new Error('Some projects\' saved snapshots could not be read.');
  if (archive.projects.length + unmatched.length > 100) throw new Error('They would take the workspace past 100 projects.');
  const start = Date.now() - legacy.length;
  const writes: [string, History][] = [];
  for (const [projectId, snapshots] of byProject) {
    const head = archive.projects.find(project => project.id === projectId)!;
    let history = histories[projectId] ?? emptyHistory();
    const moved = snapshots.map(project => ({ id: uid('snapshot'), name: project.name, createdAt: start + legacy.indexOf(project), project: { ...project, id: projectId } }));
    history = { ...history, snapshots: [...history.snapshots, ...moved] };
    // The table as it was autosaved stays the latest version.
    if (hasUnsavedChanges(head, history, { projectId, from: history.snapshots.at(-1)!.id })) history = { ...history, snapshots: [...history.snapshots, makeSnapshot(head, `${head.name} - latest`)] };
    writes.push([projectId, { ...history, snapshots: history.snapshots.slice(-DRAFT_LIMIT) }]);
  }
  const added = unmatched.map(project => ({ ...project, id: uid('project') }));
  for (const project of added) writes.push([project.id, { ...emptyHistory(), snapshots: [makeSnapshot(project, project.name)] }]);
  const previous = writes.map(([id]) => [id, readHistory(id)] as const);
  const next = added.length ? { ...archive, projects: [...archive.projects, ...added] } : archive;
  try {
    for (const [id, history] of writes) saveHistory(id, history);
    if (added.length) saveWorkspace(next);
    localStorage.removeItem(LEGACY_SNAPSHOTS_KEY);
  } catch (error) {
    for (const [id, value] of previous) if (value === null) removeHistory(id); else localStorage.setItem(`tablecraft.history.${id}`, value);
    throw error;
  }
  for (const [id, history] of writes) histories[id] = history;
  return next;
}
/** What the header and Home say the loaded project is: a draft, or a session of a finished project. */
const contextLabel = (open: OpenProject, history: History | undefined) => {
  const session = history && findSession(history, open.session);
  return session ? `Session · ${session.name}` : history?.status === 'finished' ? 'Draft snapshot' : 'Draft';
};

// Dice faces and book pages are rows of one piece, not separately spawnable variants.
const hasVariants = (component: Component) => !hasPages(component) && component.rows.length > 1;

export default function App() {
  const [initial] = useState(boot);
  const [workspace, setWorkspace] = useState<{ archive: Archive; histories: Record<string, PlaygroundHistory> }>({ archive: initial.archive, histories: {} });
  const { archive } = workspace;
  // Whole-workspace imports/snapshots and live subscriptions start a fresh offline history.
  const setArchive = useCallback((update: Archive | ((current: Archive) => Archive)) => {
    setWorkspace(current => ({ archive: typeof update === 'function' ? update(current.archive) : update, histories: {} }));
  }, []);
  const [storageError, setStorageError] = useState(initial.error);
  const [fallbackProject] = useState(starterProject);
  const initialProject = initial.archive.projects.find(p => p.id === initial.open?.projectId) ?? initial.archive.projects[0] ?? fallbackProject;
  const [home, setHome] = useState(!initial.open);
  // Project histories (snapshots and sessions) and the loaded project. Handlers read the refs, which change at once, so
  // a step that runs right after saving a snapshot (closing, loading another project) sees it.
  const [histories, setHistories] = useState(initial.histories);
  const historiesRef = useRef(initial.histories);
  const [brokenHistories, setBrokenHistories] = useState(initial.brokenHistories);
  const [historyError, setHistoryError] = useState(initial.historyError);
  const [open, setOpenState] = useState(initial.open);
  const openRef = useRef(initial.open);
  const setOpen = useCallback((next: OpenProject | undefined) => { openRef.current = next; setOpenState(next); }, []);
  useEffect(() => { try { saveOpenProject(open); } catch { /* the workspace still reopens Home */ } }, [open]);
  // Dialogs: the snapshots of a project (from Home), its export, starting or continuing a finished game, and the
  // unsaved-changes question before leaving the loaded project.
  const [historyFor, setHistoryFor] = useState<string>();
  const [exportFor, setExportFor] = useState<string>();
  const [chooser, setChooser] = useState<string>();
  const [unsaved, setUnsaved] = useState<{ target: string; then: () => void }>();
  const [projectId, setProjectId] = useState(initialProject.id);
  const [mode, setMode] = useState<'playground' | 'designer'>('playground');
  const [componentId, setComponentId] = useState<string | undefined>(initialProject.components[0]?.id);
  const [selected, setSelected] = useState<string[]>([]);
  const [libraryVisible, setLibraryVisible] = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  // The designer's inspector (right panel) is shown and hidden on its own, apart from the table inspector.
  const [designerInspectorVisible, setDesignerInspectorVisible] = useState(true);
  // Shows pieces hidden from your seat (faded, labelled) and labels every hidden piece; local to this browser.
  const [showHidden, setShowHidden] = useState(false);
  const [layersVisible, setLayersVisible] = useState(true);
  const [handVisible, setHandVisible] = useState(true);
  const [actor, setActor] = useState(initialProject.players[0]?.id ?? '');
  // Hotseat seat switches show a privacy curtain first; `endsTurn` when ending the turn passes the screen on.
  const [curtain, setCurtain] = useState<Player & { endsTurn?: boolean }>();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  // How the component library lays out its items; remembered in this browser.
  const [libraryView, setLibraryViewState] = useState<LibraryView>(() => {
    try { const saved = localStorage.getItem(LIBRARY_VIEW_KEY); return saved === 'small' || saved === 'list' ? saved : 'large'; } catch { return 'large'; }
  });
  const setLibraryView = (view: LibraryView) => { setLibraryViewState(view); try { localStorage.setItem(LIBRARY_VIEW_KEY, view); } catch { /* a per-browser convenience only */ } };
  const [libraryDrag, setLibraryDrag] = useState<string>();
  const [openVariants, setOpenVariants] = useState<string[]>([]);
  const [libraryDrop, setLibraryDrop] = useState<{ id: string; position: 'before' | 'after' }>();
  const filterStrip = useRef<HTMLDivElement>(null);
  const [filterEdges, setFilterEdges] = useState({ left: false, right: false });
  useSmoothHorizontalWheel(filterStrip);
  useEffect(() => {
    const element = filterStrip.current;
    if (!element) return;
    const measure = () => setFilterEdges({ left: element.scrollLeft > 1, right: element.scrollLeft + element.clientWidth < element.scrollWidth - 1 });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener('scroll', measure);
    measure();
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', measure);
    };
  }, []);
  const [modal, setModal] = useState<'templates' | 'settings' | 'session' | 'help' | 'save' | 'link' | 'seat' | 'print'>();
  // The script editor and memory windows float over the workspace and stay open while you play.
  const [scriptWindow, setScriptWindow] = useState(false);
  const [memoryWindow, setMemoryWindow] = useState(false);
  const memoryStore = useMemo(createMemoryStore, []);
  // Asks the script editor to show a script (from the component library); `n` makes repeated requests count.
  const [scriptFocus, setScriptFocus] = useState<{ id: string; n: number }>();
  const openScript = (id: string) => { setScriptWindow(true); setScriptFocus({ id, n: Date.now() }); };
  const [removeLink, setRemoveLink] = useState<Component>();
  const [toast, setToast] = useState<{ message: string; error: boolean; id: number } | undefined>(() => initial.draftNotice ? { message: initial.draftNotice, error: false, id: Date.now() } : undefined);
  const [session, setSession] = useState<LiveSession>();
  const [liveUndo, setLiveUndo] = useState({ count: 0, notice: '', redo: 0 });
  const sessionRef = useRef<LiveSession | undefined>(undefined);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [settings, setSettings] = useState(loadSettings);
  const [uri, setUri] = useState(settings.server);
  const [database, setDatabase] = useState(settings.database);
  const [roomCode, setRoomCode] = useState(() => `PLAY-${crypto.randomUUID().slice(0, 6).toUpperCase()}`);
  const [nameRequired, setNameRequired] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textureInput = useRef<HTMLInputElement>(null);
  const fontInput = useRef<HTMLInputElement>(null);
  const confirmed = archive.projects.find(p => p.id === projectId) ?? archive.projects[0] ?? fallbackProject;
  // Live actions are predicted locally until their reducer replies, so the table responds without waiting for the server.
  // The SDK applies the room update before the reducer promise settles, so dropping a prediction then never applies it twice;
  // a rejected action snaps back to the server state, and predictions are rebased onto every newer room update.
  const [predictions, setPredictions] = useState<{ key: number; apply: (p: Project) => Project }[]>([]);
  const predictionKey = useRef(0);
  const predict = useCallback(<T,>(apply: (p: Project) => Project, sent: Promise<T>) => {
    const key = ++predictionKey.current;
    setPredictions(current => [...current, { key, apply }]);
    const drop = () => setPredictions(current => current.filter(entry => entry.key !== key));
    sent.then(drop, drop);
    return sent;
  }, []);
  useEffect(() => { if (!session) setPredictions([]); }, [session]);
  const committed = useMemo(() => predictions.reduce((current, entry) => {
    try { return entry.apply(current); } catch { return current; }
  }, confirmed), [confirmed, predictions]);
  // Designer edits wait in a draft until the playground is shown again (see designDraft.ts). The app shows the
  // project with the draft applied; the table, saves of the workspace and a live room only get committed edits.
  const [draft, setDraftState] = useState<DesignDraft>();
  const draftRef = useRef<DesignDraft | undefined>(undefined);
  const setDraft = useCallback((next: DesignDraft | undefined) => { draftRef.current = next; setDraftState(next); }, []);
  const project = useMemo(() => withDraft(committed, draft), [committed, draft]);
  const activeComponent = project.components.find(c => c.id === componentId) ?? project.components[0];
  // Google fonts used by text layers, resolving {{bindings}} per data row and skipping names of imported fonts.
  const fontFamilies = useMemo(() => {
    const families = new Set<string>();
    for (const c of project.components) for (const n of [...c.front, ...c.back]) {
      if (n.type !== 'text' || n.fontId) continue;
      for (const row of n.font.includes('{{') && c.rows.length ? c.rows.slice(0, 1000) : [{}]) {
        const family = bind(n.font, row).trim();
        if (family && family.length <= 100 && !assetByName(project.components, 'font', family)) families.add(family);
      }
    }
    return [...families].sort().join('|');
  }, [project.components]);
  const fontCatalog = useMemo(() => home
    ? [...new Map(archive.projects.flatMap(project => project.components.filter(component => component.kind === 'font')).map(component => [component.id, component])).values()]
    : project.components, [home, archive.projects, project.components]);
  const notify = useCallback((message: string, error = false) => setToast({ message, error, id: Date.now() }), []);
  const [designerTab, setDesignerTab] = useState<'design' | 'behavior'>('design');
  const [playgroundTab, setPlaygroundTab] = useState<'selection' | 'table' | 'players'>('selection');
  const panels = usePanelLayout(mode, libraryVisible, mode === 'designer' ? designerInspectorVisible : inspectorVisible, layersVisible, notify);
  useEffect(() => watchTheme(settings.theme), [settings.theme]);
  useEffect(() => applyUiScale(settings.uiScale), [settings.uiScale]);
  // Defaults prefill the session form; an open live session keeps the address it connected with.
  useEffect(() => { if (!sessionRef.current) { setUri(settings.server); setDatabase(settings.database); } }, [settings.server, settings.database]);
  const updateSettings = (patch: Partial<UserSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (!saveSettings(next)) notify('Unable to save settings in this browser. They apply until you reload.', true);
  };
  // Settings open by themselves on first launch and only close once the profile has a name.
  const settingsOpen = modal === 'settings' || !settings.onboarded;
  const closeSettings = () => {
    if (!validName(settings.name)) { setNameRequired(true); document.getElementById('settings-name')?.focus(); return; }
    const name = settings.name.trim();
    if (name !== settings.name || !settings.onboarded) updateSettings({ name, onboarded: true });
    setNameRequired(false);
    if (modal === 'settings') setModal(undefined);
  };
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(undefined), toast.error ? 8000 : 4000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!session && actor && !project.players.some(player => player.id === actor)) setActor('');
  }, [session, actor, project.players]);
  // Online, the acting seat is whichever seat this identity occupies; without one the player watches as a viewer.
  useEffect(() => {
    if (!session) return;
    const own = project.players.find(player => player.owner === session.identity)?.id ?? '';
    if (own === actor) return;
    if (actor && !own && !project.players.some(player => player.id === actor)) notify('Your seat was removed. You are now watching as a viewer.', true);
    setActor(own);
  }, [session, actor, project.players, notify]);
  const savedArchive = useRef<Archive>(undefined);
  useEffect(() => {
    if (storageError) return;
    try { saveWorkspace(archive); savedArchive.current = archive; } catch (error) { setStorageError(`Unable to save in this browser: ${String(error)}. Export your project to keep your work.`); }
  }, [archive, storageError]);
  useEffect(() => {
    if (!fontFamilies) return;
    const fonts = fontFamilies.split('|');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${fonts.map(font => `family=${encodeURIComponent(font)}`).join('&')}&display=swap`;
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
    setHome(false);
  }, [setArchive]);
  const send = useCallback((command: Command, target = projectId): Promise<boolean> => {
    if (sessionRef.current && target === projectId) {
      return predict(p => applyCommand(p, command, actor || undefined), sessionRef.current.send(command, actor)).then(() => true).catch(error => {
        notify(error instanceof Error ? error.message : String(error), true);
        return false;
      });
    }
    return new Promise(resolve => {
      setWorkspace(current => {
        try {
          const source = current.archive.projects.find(p => p.id === target);
          if (!source) throw new Error('Project no longer exists.');
          const result = applyPlaygroundCommand(source, current.histories[target] ?? emptyPlaygroundHistory(), command, actor);
          const updated = { ...current.archive, projects: current.archive.projects.map(p => p.id === target ? result.project : p) };
          // Linked snapshots can only change when a command changes designs (it then returns new component objects).
          const refreshed = result.project.components === source.components ? updated : refreshProjectLinks(updated);
          const histories = { ...current.histories, [target]: result.history };
          for (const project of refreshed.projects) if (project !== updated.projects.find(p => p.id === project.id)) {
            histories[project.id] = { entries: [], notice: 'Undo history cleared because linked component designs changed.' };
          }
          const next = { archive: refreshed, histories };
          queueMicrotask(() => resolve(true));
          return next;
        } catch (error) {
          queueMicrotask(() => { notify(error instanceof Error ? error.message : String(error), true); resolve(false); });
          return current;
        }
      });
    });
  }, [actor, projectId, notify, predict]);
  /** Commits pending designer edits to their project (and live room) as ordinary `component` commands. */
  const flushDesign = useCallback(() => {
    const pending = draftRef.current;
    if (!pending) return;
    setDraft(undefined);
    for (const { component, removedDataRow } of pending.edits) {
      void send({ type: 'component', component, ...(removedDataRow === undefined ? {} : { removedDataRow }) }, pending.projectId);
    }
  }, [send, setDraft]);
  // Any other change lands after the pending designs, in the order they were made.
  // The designer holds rapid edits for a moment (see Designer); hand them over before anything else changes.
  const designerFlush = useRef<(() => void) | undefined>(undefined);
  const dispatch = useCallback((command: Command) => { designerFlush.current?.(); flushDesign(); return send(command); }, [flushDesign, send]);
  const editDesign = (component: Component, removedDataRow?: number): Promise<boolean> => {
    if (draftRef.current && draftRef.current.projectId !== committed.id) flushDesign();
    try {
      const edits = addDraftEdit(committed.components, draftRef.current?.edits ?? [], component, removedDataRow);
      setDraft({ projectId: committed.id, edits });
      return Promise.resolve(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), true);
      return Promise.resolve(false);
    }
  };
  // Showing the playground (or the home screen, or another project) commits the designs.
  useEffect(() => { if (draft && (mode !== 'designer' || home || draft.projectId !== committed.id)) flushDesign(); }, [draft, mode, home, committed.id, flushDesign]);
  // The draft is saved on its own right after each change (at most every 300 ms while dragging or typing) and
  // whenever the page is hidden, so closing the page mid-edit keeps it. It holds only the edited components.
  const draftSaveFailed = useRef(false);
  const lastDraftSave = useRef(0);
  const draftStored = useRef(initial.draftStored);
  const draftTimer = useRef<number>(undefined);
  const storeDraft = useCallback(() => {
    window.clearTimeout(draftTimer.current); draftTimer.current = undefined;
    const pending = draftRef.current;
    if (!pending) return;
    const saved = saveDesignDraft(pending);
    lastDraftSave.current = performance.now();
    if (saved) draftStored.current = true;
    else if (!draftSaveFailed.current) notify('Unable to save designer changes in this browser. Open the playground to save them with the project.', true);
    draftSaveFailed.current = !saved;
  }, [notify]);
  useEffect(() => {
    if (!draft || draftTimer.current !== undefined) return;
    const wait = lastDraftSave.current + 300 - performance.now();
    if (wait <= 0) storeDraft(); else draftTimer.current = window.setTimeout(storeDraft, wait);
  }, [draft, storeDraft]);
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') storeDraft(); };
    window.addEventListener('pagehide', storeDraft); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('pagehide', storeDraft); document.removeEventListener('visibilitychange', hidden); window.clearTimeout(draftTimer.current); };
  }, [storeDraft]);
  // Once committed edits are saved with the workspace, the separately stored draft is no longer needed.
  useEffect(() => {
    if (!draft && draftStored.current && savedArchive.current === archive) { clearDesignDraft(); draftStored.current = false; }
  }, [draft, archive]);
  const viewer = !!session && !actor;
  useLayoutEffect(() => memoryStore.set(project.memory), [memoryStore, project.memory]);
  const functions = useMemo(() => scriptFunctions(project.scripts), [project.scripts]);
  // Live rooms leave script editing to the host unless the host lets players edit them.
  const scriptEditor = !session || session.host === session.identity || (!!project.settings.scriptEditing && !viewer);
  const seenLog = useRef<{ project: string; seq: number }>(undefined);
  useEffect(() => {
    const log = project.scriptLog ?? [], latest = log.at(-1)?.seq ?? 0, seen = seenLog.current;
    seenLog.current = { project: project.id, seq: latest };
    if (!seen || seen.project !== project.id || latest <= seen.seq) return;
    const fresh = log.filter(line => line.seq > seen.seq);
    // Errors from your own actions (or, offline, the first of a repeating update error); announcements for everyone.
    const error = fresh.filter(line => line.level === 'error' && (line.player ? line.player === actor : !session && !line.count)).at(-1);
    const announcement = fresh.filter(line => line.level === 'announce').at(-1);
    if (error) notify(`Script error: ${error.text}`, true);
    else if (announcement) notify(announcement.text);
  }, [project.scriptLog, project.id, actor, session, notify]);
  const hasUpdate = useMemo(() => scriptsMention(project.scripts, 'update'), [project.scripts]);
  const updateInterval = project.settings.updateInterval ?? 1;
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    // Live rooms get update ticks from the server; offline, the open table runs them while the page is visible.
    if (session || home || mode !== 'playground' || !hasUpdate) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void sendRef.current({ type: 'tick', dt: updateInterval, seed: crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff });
    }, updateInterval * 1000);
    return () => window.clearInterval(timer);
  }, [session, home, mode, hasUpdate, updateInterval, project.id]);
  const undoCount = session ? liveUndo.count : workspace.histories[project.id]?.entries.length ?? 0;
  const undoNotice = session ? liveUndo.notice : workspace.histories[project.id]?.notice ?? '';
  const redoCount = session ? liveUndo.redo : workspace.histories[project.id]?.redo?.length ?? 0;
  // Each new undo notice pops up once as a toast when the table is visible, then hides after a few seconds or a click.
  const [undoToast, setUndoToast] = useState<string>();
  const shownNotice = useRef('');
  const noticeKey = `${session?.code ?? 'offline'}:${project.id}:${undoNotice}`;
  useEffect(() => {
    if (!undoNotice) { shownNotice.current = ''; setUndoToast(undefined); return; }
    if (home || mode !== 'playground') { setUndoToast(undefined); return; }
    if (shownNotice.current === noticeKey) return;
    shownNotice.current = noticeKey; setUndoToast(undoNotice);
  }, [undoNotice, noticeKey, home, mode]);
  useEffect(() => { if (!undoToast) return; const timer = setTimeout(() => setUndoToast(undefined), 6000); return () => clearTimeout(timer); }, [undoToast]);
  /** Steps the shared playground history back (undo) or forward again (redo), offline or in the live room. */
  const historyStep = useCallback((step: 'undo' | 'redo') => {
    if (sessionRef.current) {
      void sessionRef.current[step](actor).catch(error => notify(error instanceof Error ? error.message : String(error), true));
      return;
    }
    setWorkspace(current => {
      const source = current.archive.projects.find(p => p.id === projectId);
      if (!source) return current;
      const history = current.histories[projectId] ?? emptyPlaygroundHistory();
      const result = step === 'undo' ? undoPlayground(source, history) : redoPlayground(source, history);
      return {
        archive: { ...current.archive, projects: current.archive.projects.map(p => p.id === projectId ? result.project : p) },
        histories: { ...current.histories, [projectId]: result.history },
      };
    });
  }, [actor, projectId, notify]);
  const undo = useCallback(() => historyStep('undo'), [historyStep]);
  const redo = useCallback(() => historyStep('redo'), [historyStep]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      // Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl+Y redo.
      const key = event.key.toLowerCase();
      const redoing = key === 'y' && !event.shiftKey || key === 'z' && event.shiftKey;
      if (home || mode !== 'playground' || modal || curtain || event.defaultPrevented || event.isComposing || event.repeat ||
        !(event.ctrlKey || event.metaKey) || event.altKey || !(key === 'z' || redoing)) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], .floating-window')) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      event.preventDefault();
      if (viewer) return;
      if (redoing) { if (redoCount) redo(); }
      else if (undoCount) undo();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [home, mode, modal, curtain, undoCount, redoCount, undo, redo, viewer]);
  const edit = (id: string) => { setComponentId(id); setMode('designer'); };
  const takeSeat = async (playerId: string) => {
    const live = sessionRef.current;
    if (!live) return false;
    const name = settings.name.trim();
    // Mirrors the take_seat reducer: leave any current seat, then claim the empty (or new) one under this player's name.
    const claim = (p: Project): Project => {
      const seat = p.players.find(player => player.id === playerId);
      if (seat?.owner === live.identity) return p;
      if (seat?.owner) throw new Error('Seat is taken.');
      const players = p.players.map(player => player.owner === live.identity ? { ...player, owner: '' } : player === seat ? { ...player, owner: live.identity, name: name.slice(0, 50) || player.name } : player);
      if (!seat && playerId) players.push({ id: playerId, owner: live.identity, name: name.slice(0, 50) || `Player ${players.length + 1}`, color: settings.color, ...nextSeatPlacement(players) });
      return { ...p, players };
    };
    try { await predict(claim, live.takeSeat(playerId, name, settings.color)); return true; }
    catch (error) { notify(error instanceof Error ? error.message : String(error), true); return false; }
  };
  const switchPlayer = (player: Player) => {
    if (session) {
      if (player.owner === session.identity) return;
      if (player.owner) { notify(`${player.name}'s seat is taken by another player.`, true); return; }
      void takeSeat(player.id).then(ok => { if (ok) { setSelected([]); notify(`You took ${player.name}'s seat.`); } });
      return;
    }
    if (player.id !== actor) { setCurtain(player); setSelected([]); }
  };
  // Ending a turn at a shared screen passes it to the next player in turn order through the usual curtain; the turn only
  // ends when they confirm. Live rooms (and a next player who is already here) just end the turn.
  const endTurn = (next: Player | undefined) => {
    if (session || !next || next.id === actor) { void dispatch({ type: 'endTurn' }); return; }
    setCurtain({ ...next, endsTurn: true }); setSelected([]);
  };
  const watch = () => { void takeSeat('').then(ok => { if (ok) { setSelected([]); notify('You left your seat and are now watching.'); } }); };
  const newSeat = () => { void takeSeat(uid('player')).then(ok => { if (ok) { setSelected([]); notify('You took a new seat at the table.'); } }); };
  const spawn = (component: Component, rows: number[] = [0], point = { x: 820, y: 450 }, stacked = false) => {
    if (isAsset(component)) { edit(component.id); return; }
    if (viewer) { notify('You are watching as a viewer. Take a seat in Players to play.', true); return; }
    if (hasPages(component)) { rows = [0]; stacked = false; }
    if (!rows.length || rows.length > 1000 || rows.some(row => !Number.isSafeInteger(row) || row < 0 || row >= Math.max(component.rows.length, 1))) {
      notify('Choose up to 1,000 valid variants to spawn at once.', true); return;
    }
    const scale = component.kind === 'card' ? .72 : .8;
    if (stacked && rows.length > 1 && canStack([component])) {
      // Spawning never creates stacks, so a new stack is added as one validated paste.
      const stack = uid('stack');
      const instances = rows.map((row, order) => ({ ...makeInstance(component.id, row, point.x, point.y), scale, stack, order }));
      void dispatch({ type: 'paste', instances }).then(success => {
        if (success) { setSelected(instances.map(i => i.id)); notify(`Added a stack of ${instances.length} ${component.name} pieces to the table.`); }
      });
      return;
    }
    const instances = rows.map((row, i) => ({
      ...makeInstance(component.id, row, point.x + (i % 5) * 24, point.y + Math.floor(i / 5) * 24), scale,
    }));
    void dispatch({ type: 'spawn', instances }).then(success => {
      if (success) { setSelected(instances.map(i => i.id)); notify(`Added ${instances.length === 1 ? component.name : `${instances.length} pieces`} to the table.`); }
    });
  };
  const addTemplate = async (kind: TemplateKind) => {
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
      if (file.size > 60 * 1024 * 1024) throw new Error('ZIP imports must be at most 60 MiB.');
      const imported = readPortableZip(new Uint8Array(await file.arrayBuffer()));
      if (imported.kind === 'archive') {
        if (session) throw new Error('Leave the live session before importing a project. Component ZIPs can be imported while connected.');
        const incoming = imported.archive;
        const ids = new Map(incoming.projects.map(p => [p.id, uid('project')]));
        const projects = incoming.projects.map(p => ({ ...p, id: ids.get(p.id)!, components: p.components.map(c => c.source && ids.has(c.source.projectId)
          ? { ...c, source: { ...c.source, projectId: ids.get(c.source.projectId)! } } : c) }));
        if (archive.projects.length + projects.length > 100) throw new Error('A workspace can contain at most 100 projects.');
        if (!projects.length) throw new Error('The imported archive has no projects.');
        // Imported snapshots and sessions come along; a project without draft snapshots starts with one of itself. Each
        // project rests at its latest draft (or base), like every project that isn't loaded.
        const imports = projects.map((project, n) => {
          const old = incoming.projects[n].id, saved = imported.histories[old];
          let history = saved ? remapHistory(saved, ids, project.id) : emptyHistory();
          if (!history.snapshots.length) history = addSnapshot(history, makeSnapshot(project, `${project.name} - initial state`));
          const resting = restingSnapshot(history);
          return { project: resting ? restoreSnapshot(resting, project) : project, history };
        });
        const written: string[] = [];
        try { for (const { project, history } of imports) { saveHistory(project.id, history); written.push(project.id); } }
        catch (error) { written.forEach(removeHistory); throw new Error(`The snapshots couldn't be saved in this browser: ${message(error)}`); }
        historiesRef.current = { ...historiesRef.current, ...Object.fromEntries(imports.map(({ project, history }) => [project.id, history])) };
        setHistories(historiesRef.current);
        setArchive(refreshProjectLinks({ ...archive, projects: [...archive.projects, ...imports.map(item => item.project)] }));
        setStorageError(null);
        const snapshots = imports.reduce((sum, { history }) => sum + history.snapshots.length + history.sessions.reduce((total, session) => total + session.snapshots.length, 0), 0);
        notify(`Imported ${projects.length} project${projects.length === 1 ? '' : 's'} with ${snapshots} snapshot${snapshots === 1 ? '' : 's'}.${home ? '' : ' Load them from Home.'}`);
      } else {
        if (home) throw new Error('Open a project before importing a component.');
        const bundle = remapComponentBundle(imported.bundle);
        const remapped = { ...bundle, components: withUniqueAssetNames(bundle.components, project.components) };
        validateProject({ ...project, components: [...project.components, ...remapped.components] });
        if (!await dispatch({ type: 'addComponents', components: remapped.components })) throw new Error('Components could not be imported.');
        edit(remapped.rootId); notify(`Imported ${remapped.components.length} linked component${remapped.components.length === 1 ? '' : 's'}.`);
      }
    } catch (error) { notify(`Import failed: ${error instanceof Error ? error.message : String(error)}`, true); }
  };
  const importAssets = async (files: FileList | null, kind: 'texture' | 'font') => {
    if (!files?.length) return;
    try {
      const components = withUniqueAssetNames(await Promise.all(Array.from(files, file => importAsset(file, kind))), project.components);
      validateProject({ ...project, components: [...project.components, ...components] });
      if (await dispatch({ type: 'addComponents', components })) {
        edit(components[0].id); setModal(undefined);
        notify(`Imported ${components.length} asset${components.length === 1 ? '' : 's'}.`);
      }
    } catch (error) { notify(`Asset import failed: ${error instanceof Error ? error.message : String(error)}`, true); }
  };
  /** Exports a project with the chosen snapshots (by default all of them) and the sessions they belong to. */
  const exportProject = (project: Project, snapshotIds?: ReadonlySet<string>) => {
    try {
      const history = histories[project.id];
      const chosen = history && (snapshotIds ?? new Set([...history.snapshots, ...history.sessions.flatMap(session => session.snapshots)].map(snapshot => snapshot.id)));
      downloadZip(`${project.name}.tablecraft.zip`, projectZip(project, history && chosen?.size ? selectHistory(history, chosen) : undefined));
      return true;
    } catch (error) { notify(`Export failed: ${message(error)}`, true); return false; }
  };
  const join = async (host: boolean) => {
    const fromHome = home;
    setConnecting(true); setConnectionError('');
    try {
      if (!/^https?:\/\//.test(uri) && !/^wss?:\/\//.test(uri)) throw new Error('Use an http(s) or ws(s) SpaceTimeDB address.');
      if (!/^[A-Z0-9-]{4,40}$/.test(roomCode)) throw new Error('Use 4-40 uppercase letters, digits or hyphens for the room code.');
      const { connectRoom } = await import('./multiplayer');
      const live = await connectRoom({
        uri, database, code: roomCode, host, project, playerId: host ? actor : '', name: settings.name.trim(), color: settings.color,
      }, (next, history) => { setProject(next); setLiveUndo(history); }, message => notify(message, true), () => {
        sessionRef.current = undefined; setSession(undefined); notify('Disconnected. Your latest table is saved locally.', true);
      });
      const row = [...live.connection.db.roomState.iter()][0];
      const room = row ? JSON.parse(row.state) as Project : undefined;
      // Joining another project's table closes the loaded project; the room's project is loaded, starting from a
      // snapshot of the table as it was joined.
      if (room && openRef.current?.projectId !== room.id) {
        unloadProject();
        let history = historiesRef.current[room.id] ?? emptyHistory();
        let from = latestSnapshot(history)?.id;
        if (!from) {
          const snapshot = makeSnapshot(room, `${room.name} - joined`);
          history = addSnapshot(history, snapshot);
          if (commitHistory(room.id, history)) from = snapshot.id;
        }
        setOpen({ projectId: room.id, ...(from ? { from } : {}) });
      }
      sessionRef.current = live; setSession(live);
      const ownPlayer = room?.players.find(p => p.owner === live.identity);
      setActor(ownPlayer?.id ?? '');
      setCurtain(undefined); setSelected([]);
      if (fromHome) setMode('playground');
      if (ownPlayer) { setModal(undefined); notify(`Connected to ${roomCode}. Welcome to the table.`); }
      else { setMode('playground'); setModal('seat'); notify(`Connected to ${roomCode}. Pick a seat or watch.`); }
    } catch (error) { setConnectionError(error instanceof Error ? error.message : String(error)); }
    finally { setConnecting(false); }
  };
  const leave = () => {
    sessionRef.current?.disconnect(); sessionRef.current = undefined; setSession(undefined); setModal(undefined);
  };
  const showHome = () => {
    if (sessionRef.current) { leave(); notify('Left the live session. The latest table is saved locally.'); }
    setHome(true); setModal(undefined); setCurtain(undefined); setSelected([]);
  };
  /** Saves a project's history in this browser, or says why it couldn't (for example, when storage is full). */
  const commitHistory = (projectId: string, next: History) => {
    if (brokenHistories.includes(projectId)) { notify('This project\'s saved snapshots couldn\'t be read. Download them from the notice at the top first.', true); return false; }
    try { saveHistory(projectId, next); }
    catch (error) { notify(`Not saved: ${message(error)}. Delete some snapshots or export them to make room.`, true); return false; }
    historiesRef.current = { ...historiesRef.current, [projectId]: next };
    setHistories(historiesRef.current);
    return true;
  };
  /** Changes a project's history; a project that isn't loaded then rests at its (possibly new) latest draft or base. */
  const updateHistory = (projectId: string, change: (history: History) => History) => {
    let next: History;
    try { next = change(historiesRef.current[projectId] ?? emptyHistory()); } catch (error) { notify(message(error), true); return false; }
    if (!commitHistory(projectId, next)) return false;
    if (openRef.current?.projectId !== projectId) restHead(projectId, next);
    return true;
  };
  /** Puts a project that isn't loaded back at its latest draft snapshot, or its base when finished. */
  const restHead = (projectId: string, history: History) => {
    const resting = restingSnapshot(history);
    if (resting) setWorkspace(current => {
      const head = current.archive.projects.find(p => p.id === projectId);
      if (!head) return current;
      let rested: Project;
      try { rested = restoreSnapshot(resting, head); } catch { return current; }
      const histories = { ...current.histories }; delete histories[projectId];
      let next = { ...current.archive, projects: current.archive.projects.map(p => p === head ? rested : p) };
      try { next = refreshProjectLinks(next); } catch { /* keep the links as they were */ }
      return { archive: next, histories };
    });
  };
  /** The loaded project as it is now, with any designer edits still held or pending. */
  const currentTable = () => { designerFlush.current?.(); return withDraft(committed, draftRef.current); };
  /** Runs `then`, first asking to save the loaded project's changes since its last snapshot (to `target`: why it is left). */
  const leaveProject = (target: string, then: () => void) => {
    const current = openRef.current;
    if (current && current.projectId === committed.id && hasUnsavedChanges(currentTable(), historiesRef.current[current.projectId], current)) setUnsaved({ target, then });
    else then();
  };
  /** Saves the loaded table as a snapshot: to its session when playing one, otherwise to the drafts. */
  const saveSnapshot = (name: string) => {
    const current = openRef.current;
    if (!current) return false;
    try {
      const snapshot = makeSnapshot(currentTable(), name);
      const history = historiesRef.current[current.projectId] ?? emptyHistory();
      if (!commitHistory(current.projectId, addSnapshot(history, snapshot, current.session))) return false;
      setOpen({ ...current, from: snapshot.id });
      const session = findSession(history, current.session);
      notify(session ? `Saved “${snapshot.name}” to ${session.name}.` : `Saved the draft snapshot “${snapshot.name}”.`);
      return true;
    } catch (error) { notify(`Snapshot not saved: ${message(error)}`, true); return false; }
  };
  /** Closes the loaded project: leaves its live room, drops designer edits not yet saved and resets it to where it rests. */
  const unloadProject = () => {
    const previous = openRef.current;
    if (!previous) return;
    if (sessionRef.current) leave();
    setDraft(undefined); setCurtain(undefined); setSelected([]);
    restHead(previous.projectId, historiesRef.current[previous.projectId] ?? emptyHistory());
    setWorkspace(current => { const histories = { ...current.histories }; delete histories[previous.projectId]; return { ...current, histories }; });
    setOpen(undefined);
  };
  /** Loads a snapshot as the working copy of its project (closing the project loaded before), from the drafts or a session. */
  const switchTo = (projectId: string, snapshot: Snapshot, session?: string) => {
    const head = archive.projects.find(p => p.id === projectId);
    if (!head) { notify('That project no longer exists.', true); return false; }
    let loaded: Project;
    try { loaded = restoreSnapshot(snapshot, head); } catch (error) { notify(`Unable to load “${snapshot.name}”: ${message(error)}`, true); return false; }
    unloadProject();
    setWorkspace(current => {
      const histories = { ...current.histories }; delete histories[projectId];
      let next = { ...current.archive, projects: current.archive.projects.map(p => p.id === projectId ? loaded : p) };
      try { next = refreshProjectLinks(next); } catch { /* keep the links as they were */ }
      return { archive: next, histories };
    });
    setOpen({ projectId, ...(session ? { session } : {}), from: snapshot.id });
    setProjectId(projectId); setActor(loaded.players[0]?.id ?? ''); setComponentId(loaded.components[0]?.id);
    setSelected([]); setSearch(''); setFilter('all'); setMode('playground'); setHome(false);
    setModal(undefined); setHistoryFor(undefined); setChooser(undefined);
    return true;
  };
  /** Loads a project from Home: a draft loads its latest snapshot; a finished one asks to start a game or continue one. */
  const loadProject = (id: string) => {
    const head = archive.projects.find(p => p.id === id);
    if (!head) return;
    const history = historiesRef.current[id] ?? emptyHistory();
    if (baseSnapshot(history)) { setChooser(id); return; }
    leaveProject(`load ${head.name}`, () => {
      let current = historiesRef.current[id] ?? emptyHistory(), latest = latestSnapshot(current);
      if (!latest) {
        latest = makeSnapshot(head, `${head.name} - initial state`);
        current = addSnapshot(current, latest);
        if (!commitHistory(id, current)) return;
      }
      if (switchTo(id, latest)) notify(`Loaded ${head.name} from “${latest.name}”.`);
    });
  };
  const startGame = (id: string, name: string) => {
    const head = archive.projects.find(p => p.id === id);
    if (!head) return;
    leaveProject(`start a game of ${head.name}`, () => {
      try {
        const { history, session } = startSession(historiesRef.current[id] ?? emptyHistory(), name);
        if (commitHistory(id, history) && switchTo(id, session.snapshots[0], session.id)) notify(`Started ${session.name} from “${session.baseName}”.`);
      } catch (error) { notify(message(error), true); }
    });
  };
  const continueSession = (id: string, sessionId: string) => {
    const history = historiesRef.current[id], latest = history && latestSnapshot(history, sessionId);
    const session = history && findSession(history, sessionId);
    if (!latest || !session) { notify('That session no longer exists.', true); return; }
    leaveProject(`continue ${session.name}`, () => { if (switchTo(id, latest, sessionId)) notify(`Continuing ${session.name} from “${latest.name}”.`); });
  };
  const loadSnapshot = (id: string, snapshotId: string) => {
    const found = historiesRef.current[id] && findSnapshot(historiesRef.current[id], snapshotId);
    if (!found) { notify('That snapshot no longer exists.', true); return; }
    leaveProject(`load “${found.snapshot.name}”`, () => { if (switchTo(id, found.snapshot, found.session?.id)) notify(`Loaded “${found.snapshot.name}”${found.session ? ` from ${found.session.name}` : ''}.`); });
  };
  const closeProject = () => {
    const current = openRef.current, head = current && archive.projects.find(p => p.id === current.projectId);
    if (!current) return;
    leaveProject(`close ${head?.name ?? 'it'}`, () => { unloadProject(); setHome(true); setModal(undefined); notify(`Closed ${head?.name ?? 'the project'}.`); });
  };
  /** Props shared by the snapshot manager on Home and in Save/Load. */
  const historyProps = (id: string) => ({
    history: histories[id] ?? emptyHistory(), open: open?.projectId === id ? open : undefined,
    onLoad: (snapshotId: string) => loadSnapshot(id, snapshotId), onContinue: (sessionId: string) => continueSession(id, sessionId),
    onStartGame: (name: string) => startGame(id, name),
    onRename: (itemId: string, name: string) => updateHistory(id, history => renameItem(history, itemId, name)),
    onDeleteSnapshot: (snapshotId: string) => updateHistory(id, history => deleteSnapshot(history, snapshotId, openRef.current?.projectId === id ? openRef.current : undefined)),
    onDeleteSession: (sessionId: string) => updateHistory(id, history => deleteSession(history, sessionId, openRef.current?.projectId === id ? openRef.current : undefined)),
    onStatus: (status: History['status'], baseId?: string) => updateHistory(id, history => setStatus(history, status, baseId)),
    onExport: () => setExportFor(id),
  });
  // Home says whether the loaded project has changes since its last snapshot.
  const homeDirty = useMemo(() => home && !!open && open.projectId === committed.id && hasUnsavedChanges(project, histories[open.projectId], open), [home, open, project, committed.id, histories]);
  const createProject = (name: string, description = '', game?: GameProjectId) => {
    if (archive.projects.length >= 100) { notify('A workspace can contain at most 100 projects.', true); return; }
    if (!validName(settings.name)) {
      setNameRequired(true); setModal('settings');
      notify('Choose a player name in Settings before creating a project.', true);
      return;
    }
    const profile = { name: settings.name.trim(), color: settings.color };
    // A new project starts as a draft with a snapshot of its initial table, and is loaded in place of the loaded one.
    leaveProject('create a new project', () => {
      const next = game ? gameProject(game, name, description, profile) : blankProject(name, description, profile);
      const snapshot = makeSnapshot(next, `${next.name} - initial state`);
      unloadProject();
      setProject(next); setActor(next.players[0].id); setComponentId(undefined); setSelected([]);
      setSearch(''); setFilter('all'); setMode('playground'); setModal(game ? undefined : 'templates');
      setOpen({ projectId: next.id, ...(commitHistory(next.id, addSnapshot(emptyHistory(), snapshot)) ? { from: snapshot.id } : {}) });
    });
  };
  const copyLinked = async (component: Component) => {
    try {
      const local = localComponentCopy(project, component.id);
      const copy = { ...local, components: withUniqueAssetNames(local.components, project.components) };
      if (await dispatch({ type: 'addComponents', components: copy.components })) { edit(copy.rootId); notify('Created an editable local copy, including nested artwork.'); }
    } catch (error) { notify(`Unable to copy component: ${String(error)}`, true); }
  };
  const visible = project.components.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || c.kind === filter));
  // Scripts are listed after the components (under All and Scripts), and found by the library search too.
  const visibleScripts = filter === 'all' || filter === 'script' ? (project.scripts ?? []).filter(script => script.name.toLowerCase().includes(search.toLowerCase())) : [];
  // Grids reorder across (the left and right halves of a tile); the list reorders up and down. Components and scripts
  // each reorder among themselves.
  const dropSide = (e: React.DragEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return (libraryView !== 'list' ? e.clientX < rect.left + rect.width / 2 : e.clientY < rect.top + rect.height / 2) ? 'before' as const : 'after' as const;
  };
  const isScript = (id?: string) => !!id && !!project.scripts?.some(script => script.id === id);
  const reorderTarget = (id: string, script: boolean, onDrop: (dragged: string, position: 'before' | 'after') => unknown) => ({
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      if (!libraryDrag || libraryDrag === id || isScript(libraryDrag) !== script) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      setLibraryDrop({ id, position: dropSide(e) });
    },
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
      if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setLibraryDrop(undefined);
    },
    onDrop: (e: React.DragEvent<HTMLDivElement>) => {
      if (!libraryDrag || isScript(libraryDrag) !== script) return;
      e.preventDefault();
      if (libraryDrag !== id) void onDrop(libraryDrag, dropSide(e));
      setLibraryDrag(undefined); setLibraryDrop(undefined);
    },
  });
  const reorderHandle = (id: string, name: string, index: number, ids: string[], move: (id: string, targetId: string, position: 'before' | 'after') => unknown) =>
    <button className="icon-button library-reorder" draggable aria-label={`Reorder ${name}`} title="Drag to reorder; use the arrow keys when focused"
      onDragStart={e => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; setLibraryDrag(id); }}
      onDragEnd={() => { setLibraryDrag(undefined); setLibraryDrop(undefined); }}
      onKeyDown={e => {
        const back = e.key === 'ArrowUp' || e.key === 'ArrowLeft', forward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
        if (!back && !forward) return;
        e.preventDefault();
        const target = ids[index + (back ? -1 : 1)];
        if (target) void move(id, target, back ? 'before' : 'after');
      }}><GripVertical size={14} /></button>;
  const reorderScript = (id: string, targetId: string, position: 'before' | 'after') => {
    const ids = (project.scripts ?? []).map(other => other.id).filter(other => other !== id);
    ids.splice(ids.indexOf(targetId) + (position === 'after' ? 1 : 0), 0, id);
    return dispatch({ type: 'reorderScripts', ids });
  };
  const createScript = async () => {
    const taken = new Set((project.scripts ?? []).map(script => script.name.toLowerCase()));
    let name = project.scripts?.length ? 'Script' : 'Rules';
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `Script ${n}`;
    const script = { id: uid('script'), name, source: `-- ${name}: functions defined here can be pressed as buttons; see the Reference tab for the game API.\n` };
    setModal(undefined);
    if (await dispatch({ type: 'script', script })) openScript(script.id);
  };
  const selectedComponent = mode === 'designer' ? activeComponent : project.components.find(c => c.id === project.instances.find(i => i.id === selected.at(-1))?.componentId);
  const settingsButton = <button className="profile-button" aria-label="Settings" title="Settings" onClick={() => setModal('settings')}>{settings.name.trim() ? settings.name.trim()[0].toUpperCase() : <Settings size={15} />}</button>;
  return <MemoryBindings.Provider value={memoryStore}><div className={`app-shell ${mode === 'playground' ? 'playground-shell' : ''}`}>
    <AssetFonts components={fontCatalog} notify={notify} />
    <header className="app-header">
      <div className="header-start"><a className="brand" href="#" aria-label="Tablecraft home" onClick={e => { e.preventDefault(); showHome(); }}><span className="brand-mark"><Layers size={23} strokeWidth={1.8} /></span>tablecraft<span className="brand-beta">BETA</span></a>
      {!home && <nav className="mode-switch" aria-label="Workspace mode"><button className={mode === 'playground' ? 'active' : ''} onClick={() => setMode('playground')}><Table2 size={16} /> Playground</button><button className={mode === 'designer' ? 'active' : ''} onClick={() => { if (!activeComponent) setModal('templates'); else setMode('designer'); }}><Palette size={16} /> Component designer</button></nav>}</div>
      {!home && <>
      <div className="project-heading compact-project"><h1>{project.name}</h1>{open && <span className="history-badge loaded project-context" title="Saving a snapshot adds it here">{contextLabel(open, histories[open.projectId])}</span>}</div>

      <div className="header-actions"><HeaderMenu label="Actions" title="Undo, redo, save and print" icon={<Menu size={17} />} items={[
        ...mode === 'playground' ? [
          { label: 'Undo', icon: <Undo2 size={16} />, onToggle: undo, shortcut: 'Ctrl Z', disabled: !undoCount || !!modal || !!curtain || viewer,
            hint: undoNotice || `Undo the latest playground action for everyone · ${undoCount} available` },
          { label: 'Redo', icon: <Redo2 size={16} />, onToggle: redo, shortcut: 'Ctrl Y', disabled: !redoCount || !!modal || !!curtain || viewer, divider: true,
            hint: `Redo the latest undone action for everyone · ${redoCount} available` },
        ] : [],
        { label: 'Save/Load', icon: <Save size={16} />, onToggle: () => setModal('save'), hint: 'Save a snapshot of this table, or load one' },
        { label: 'Print to PDF', icon: <Printer size={16} />, onToggle: () => setModal('print'), hint: 'Print every piece, or save them as a PDF', divider: true },
        { label: 'Close project', icon: <FolderX size={16} />, onToggle: closeProject, hint: 'Close it and go Home (asks to save unsaved changes first)' },
      ]} /><HeaderMenu label="Visibility" title="Show or hide panels" icon={<Eye size={17} />} items={[
        { label: 'Component library', icon: <LibraryBig size={16} />, checked: libraryVisible, onToggle: () => setLibraryVisible(!libraryVisible) },
        { label: mode === 'playground' ? 'Pieces panel' : 'Layers panel', icon: <PanelLeft size={16} />, checked: layersVisible, onToggle: () => setLayersVisible(!layersVisible) },
        ...mode === 'playground' ? [{ label: 'Hand panel', icon: <PanelBottom size={16} />, checked: handVisible, onToggle: () => setHandVisible(!handVisible) },
          { label: 'Table inspector', icon: <PanelRight size={16} />, checked: inspectorVisible, onToggle: () => setInspectorVisible(!inspectorVisible) },
          { label: 'Hidden pieces', icon: <EyeOff size={16} />, checked: showHidden, onToggle: () => setShowHidden(!showHidden), hint: 'Show pieces hidden from your seat, and label every hidden piece' }]
          : [{ label: 'Designer inspector', icon: <PanelRight size={16} />, checked: designerInspectorVisible, onToggle: () => setDesignerInspectorVisible(!designerInspectorVisible) }],
      ]} /><HeaderMenu label="Scripting" title="Scripts and memory" icon={<FileCode2 size={17} />} items={[
        { label: 'Scripts', icon: <FileCode2 size={16} />, checked: scriptWindow, onToggle: () => setScriptWindow(!scriptWindow), hint: 'Lua that buttons and events run for everyone' },
        { label: 'Memory', icon: <Database size={16} />, checked: memoryWindow, onToggle: () => setMemoryWindow(!memoryWindow), hint: 'Values shared by scripts and players' },
      ]} /><button className="button primary compact-invite" onClick={() => setModal('session')}><Users size={15} />{session ? session.code : 'Invite players'}</button><button className="help-button icon-button" title="How to use Tablecraft" aria-label="Help" onClick={() => setModal('help')}><HelpCircle size={19} /></button><span className="header-separator" /><button className="connection-badge" onClick={() => setModal('session')}><span className={`live-dot ${session ? '' : 'offline'}`} />{session ? viewer ? 'Live · watching' : 'Live session' : 'Local workspace'}</button>      {settingsButton}</div>
      </>}
            {home && <div className="header-actions">{settingsButton}</div>}
    </header>
    <Notice message={storageError ?? ''}><button onClick={() => {
      const raw = localStorage.getItem('tablecraft.workspace.v1'); if (raw) download('tablecraft-recovery.json', raw);
      setStorageError(null);
    }}>Download recovery & continue</button><button onClick={() => exportProject(project)}>Export current work</button></Notice>
    <Notice message={historyError ?? ''}>{brokenHistories.length > 0 && <button onClick={() => {
      download('tablecraft-snapshots-recovery.json', JSON.stringify(Object.fromEntries(brokenHistories.map(id => [id, readHistory(id)]))));
      brokenHistories.forEach(removeHistory); setBrokenHistories([]); setHistoryError(null);
    }}>Download recovery & reset those snapshots</button>}<button onClick={() => setHistoryError(null)}>Dismiss</button></Notice>
    {home && <Home projects={archive.projects} histories={histories} onLoad={loadProject} onCreate={createProject}
      open={open && { id: open.projectId, context: contextLabel(open, histories[open.projectId]), dirty: homeDirty }}
      onContinue={() => { setHome(false); setModal(undefined); }} onCloseProject={closeProject} onHistory={setHistoryFor}
      onUpdate={(id, patch) => setWorkspace(current => ({ ...current, archive: { ...current.archive, projects: current.archive.projects.map(p => p.id === id ? { ...p, ...patch } : p) } }))}
      onImport={() => fileInput.current?.click()} onExport={item => setExportFor(item.id)} onJoin={() => leaveProject('join a table', () => { setConnectionError(''); setModal('session'); })}
      onExportAll={() => {
        try { downloadZip('tablecraft-workspace.zip', createPortableZip(archive, Object.fromEntries(archive.projects.flatMap(p => histories[p.id] ? [[p.id, histories[p.id]]] : [])))); }
        catch (error) { notify(`Export failed: ${message(error)}`, true); }
      }}
      onDelete={id => {
        try {
          if (openRef.current?.projectId === id) throw new Error('Close the project first.');
          removeHistory(id);
          historiesRef.current = Object.fromEntries(Object.entries(historiesRef.current).filter(([key]) => key !== id));
          setHistories(historiesRef.current);
          setWorkspace(current => {
            const histories = { ...current.histories }; delete histories[id];
            return { archive: { ...current.archive, projects: current.archive.projects.filter(p => p.id !== id) }, histories };
          });
        } catch (error) { notify(`Unable to delete project: ${String(error)}`, true); }
      }}
      onReorder={(id, targetId, after) => setWorkspace(current => {
        const moving = current.archive.projects.find(p => p.id === id);
        if (!moving || id === targetId || !current.archive.projects.some(p => p.id === targetId)) return current;
        const projects = current.archive.projects.filter(p => p.id !== id);
        projects.splice(projects.findIndex(p => p.id === targetId) + (after ? 1 : 0), 0, moving);
        return { ...current, archive: { ...current.archive, projects } };
      })} />}
    <main className="main-layout" ref={panels.container} style={home ? { display: 'none' } : undefined}>
      <aside id="component-library-panel" className="library-panel" style={{ width: panels.sizes.library, minWidth: 0, flex: `0 0 ${panels.sizes.library}px` }} hidden={!libraryVisible}>
        <div className="library-heading"><h2>Components <span>{project.components.length}</span></h2><span className="library-heading-actions"><button className="icon-button" aria-label="Import component ZIP" title="Import component ZIP" onClick={() => fileInput.current?.click()}><Upload size={16} /></button><button className="icon-button" aria-label="Link from another project" title="Link from another project" onClick={() => setModal('link')}><Link size={16} /></button><button className="icon-button" aria-label="Add component" title="Add component" onClick={() => setModal('templates')}><Plus size={18} /></button></span></div>
        <div className="library-search search-input"><Search size={14} /><input placeholder="Find a component..." value={search} onChange={e => setSearch(e.target.value)} aria-label="Search components" /><kbd>⌕</kbd></div>
        <div className={`library-filter-scroll${filterEdges.left ? ' overflow-left' : ''}${filterEdges.right ? ' overflow-right' : ''}`}>
          <ScrollArrows target={filterStrip} {...filterEdges} label="library filters" />
          <div ref={filterStrip} className="library-filters">{[{ id: 'all', label: 'All' }, { id: 'card', label: 'Cards' }, { id: 'token', label: 'Tokens' }, { id: 'board', label: 'Boards' }, { id: 'dice', label: 'Dice' }, { id: 'book', label: 'Books' }, { id: 'artwork', label: 'Artwork' }, { id: 'texture', label: 'Textures' }, { id: 'font', label: 'Fonts' }, { id: 'script', label: 'Scripts' }].map(f => <button key={f.id} className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>{f.label}</button>)}</div>
        </div>
        <div className="library-section-label"><span>PROJECT LIBRARY <span className="library-count">{visible.length + visibleScripts.length}</span></span>
          <span className="library-views" role="radiogroup" aria-label="Library view">{([['large', 'Large grid', LayoutGrid], ['small', 'Small grid', Grid3x3], ['list', 'List', LayoutList]] as const).map(([view, label, Icon]) =>
            <button key={view} type="button" role="radio" aria-checked={libraryView === view} aria-label={label} title={label} className={libraryView === view ? 'active' : ''} onClick={() => setLibraryView(view)}><Icon size={13} /></button>)}</span></div>
        <div className={`component-library library-${libraryView}`} role="list" aria-label="Project library">{visible.map((comp, index) => <div key={comp.id} role="listitem"
          className={`library-item ${selectedComponent?.id === comp.id ? 'active' : ''}${libraryDrag === comp.id ? ' library-dragging' : ''}${libraryDrop?.id === comp.id ? ` library-drop-${libraryDrop.position}` : ''}${openVariants.includes(comp.id) ? ' library-item-open' : ''}`}
          {...reorderTarget(comp.id, false, (id, position) => dispatch({ type: 'reorderComponent', id, targetId: comp.id, position }))}>
          <div className="library-preview-wrap">
          <button className={`library-preview library-preview-${comp.kind}`} draggable={mode === 'designer' || !isAsset(comp)}
            onDragStart={e => startLibraryDrag(e.dataTransfer, project.id, comp.id, hasVariants(comp) ? comp.rows.map((_, i) => i) : [0], hasVariants(comp))}
            onClick={() => mode === 'designer' || isAsset(comp) ? edit(comp.id) : spawn(comp)} aria-label={mode === 'designer' || isAsset(comp) ? `Design ${comp.name}` : `Spawn ${comp.name}`} title={mode === 'designer' || isAsset(comp) ? `Design ${comp.name}` : `Spawn ${comp.name}`}>
            <div className="preview-texture" />
            {libraryView === 'large' && hasVariants(comp) && <><div className="preview-ghost ghost-left"><ComponentThumbnail component={comp} components={project.components} row={1} width={66} /></div>{comp.rows.length > 2 && <div className="preview-ghost ghost-right"><ComponentThumbnail component={comp} components={project.components} row={2} width={66} /></div>}</>}
            <div className="preview-main">{libraryView === 'large'
              ? <ComponentThumbnail component={comp} components={project.components} width={comp.kind === 'board' ? 152 : comp.kind === 'token' ? 62 : comp.kind === 'dice' ? 52 : 70} />
              // Small tiles and list icons fit the art inside their box, whatever its shape.
              : <ComponentThumbnail component={comp} components={project.components} {...(comp.width >= comp.height ? { width: libraryView === 'small' ? 40 : 30 } : { height: libraryView === 'small' ? 34 : 28 })} />}</div>
            <span className="preview-kind">{kindIcon(comp.kind, 10)}{comp.kind}</span>
            {hasVariants(comp) && <span className="preview-variants" aria-label={`${comp.rows.length} variants`}><Layers size={10} />{comp.rows.length}</span>}
            {mode === 'playground' && !isAsset(comp) && <span className="preview-hint" aria-hidden="true"><Move size={10} /> {hasVariants(comp) ? 'Drag all onto table' : 'Drag onto table'}</span>}
            {mode === 'playground' && !isAsset(comp) && <span className="preview-add"><Plus size={17} /></span>}
          </button>
          {mode === 'playground' && hasVariants(comp) && libraryView !== 'small' && <button className="preview-add preview-spawn-all" aria-label={`Spawn all ${comp.name} variants`}
            title={`Spawn all ${comp.rows.length} variants${comp.stackable ? ' as a stack' : ''}`} onClick={() => spawn(comp, comp.rows.map((_, i) => i), undefined, true)}><CopyPlus size={15} /></button>}
          </div>
          <div className="library-item-label">{reorderHandle(comp.id, comp.name, index, visible.map(c => c.id), (id, targetId, position) => dispatch({ type: 'reorderComponent', id, targetId, position }))}
            <button className="library-item-name" aria-label={`Edit ${comp.name}`} title="Click to edit in the designer" onClick={() => edit(comp.id)}>
              <strong>{comp.name}<PencilLine size={10} aria-hidden="true" /></strong><small>{`${comp.width} × ${comp.height} px`}{libraryView === 'list' && <> · {comp.kind}{hasVariants(comp) && ` · ${comp.rows.length} variants`}</>}</small>
              <span className="library-name-hint" aria-hidden="true"><PencilLine size={9} /> Click to edit in the designer</span></button>
            {/* The small grid has no names: a pencil in the tile's corner edits it instead. */}
            {libraryView === 'small' && <button className="icon-button library-edit" aria-label={`Edit ${comp.name}`} title={`Edit ${comp.name} in the designer`} onClick={() => edit(comp.id)}><PencilLine size={12} /></button>}
            {mode === 'playground' && hasVariants(comp) && <button className="icon-button library-variants-toggle" aria-expanded={openVariants.includes(comp.id)}
              aria-label={`${openVariants.includes(comp.id) ? 'Hide' : 'Show'} ${comp.name} variants (${comp.rows.length})`}
              title={`${openVariants.includes(comp.id) ? 'Hide' : 'Show'} ${comp.rows.length} variants`}
              onClick={() => setOpenVariants(ids => ids.includes(comp.id) ? ids.filter(id => id !== comp.id) : [...ids, comp.id])}>
              {openVariants.includes(comp.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>}</div>
          {comp.source && <div className="library-link-note"><small><Link size={11} /> Read-only · {comp.source.projectName}</small><button className="text-button" aria-label={`Make local copy of ${comp.name}`} onClick={() => void copyLinked(comp)}>Make local copy</button></div>}
          {mode === 'playground' && <>
            {hasVariants(comp) && <LibraryVariants key={`${project.id}:${comp.id}`} projectId={project.id} component={comp} components={project.components} open={openVariants.includes(comp.id)} onSpawnAll={() => spawn(comp, comp.rows.map((_, i) => i), undefined, true)} />}
          </>}
        </div>)}
        {/* Scripts sit after the components, as library items of their own kind. */}
        {visibleScripts.map((script, index) => {
          const count = scriptFunctions([script]).length, lines = script.source.replace(/\n$/, '').split('\n').length;
          const info = `${lines} ${lines === 1 ? 'line' : 'lines'} · ${count} ${count === 1 ? 'function' : 'functions'}`;
          return <div key={script.id} role="listitem" className={`library-item library-script-item${libraryDrag === script.id ? ' library-dragging' : ''}${libraryDrop?.id === script.id ? ` library-drop-${libraryDrop.position}` : ''}`}
            {...reorderTarget(script.id, true, (id, position) => reorderScript(id, script.id, position))}>
            <div className="library-preview-wrap">
              <button className="library-preview library-preview-script" aria-label={`Open script ${script.name}`} title={`Open ${script.name} in the Scripts window`} onClick={() => openScript(script.id)}>
                <div className="preview-texture" />
                <div className="preview-main"><span className="library-script-icon" aria-hidden="true"><FileCode2 size={libraryView === 'large' ? 34 : 18} /></span></div>
                <span className="preview-kind"><FileCode2 size={10} />script</span>
              </button>
            </div>
            <div className="library-item-label">{reorderHandle(script.id, script.name, index, visibleScripts.map(other => other.id), reorderScript)}
              <button className="library-item-name" aria-label={`Edit script ${script.name}`} title="Click to open in the Scripts window" onClick={() => openScript(script.id)}>
                <strong>{script.name}<PencilLine size={10} aria-hidden="true" /></strong><small>{info}</small>
                <span className="library-name-hint" aria-hidden="true"><PencilLine size={9} /> Click to open in the Scripts window</span></button>
              {libraryView === 'small' && <button className="icon-button library-edit" aria-label={`Edit script ${script.name}`} title={`Open ${script.name} in the Scripts window`} onClick={() => openScript(script.id)}><PencilLine size={12} /></button>}
            </div>
          </div>;
        })}
          {!visible.length && !visibleScripts.length && <div className="empty-note">{search || filter !== 'all' ? 'No components match your search.' : 'Your first component is one click away.'}<button className="text-button" onClick={() => setModal('templates')}>Create a component <Plus size={13} /></button></div>}
        </div>
      </aside>
      {libraryVisible && <PanelSeparator label="Resize component library" controls="component-library-panel" value={panels.sizes.library} {...panels.limits.library} onResize={value => panels.resize('library', value)} />}
      <div className="workspace-content">{!home && (mode === 'playground' ? <Playground project={project} actor={actor} owner={session?.identity ?? 'local'} host={!!session?.host && session.host === session.identity} viewer={viewer} onWatch={session ? watch : undefined} onNewSeat={session ? newSeat : undefined} selected={selected} setSelected={setSelected} inspectorVisible={inspectorVisible} layersVisible={layersVisible} defaultSeat={{ name: settings.name.trim(), color: settings.color }} handVisible={handVisible} onShowInspector={() => setInspectorVisible(true)} dispatch={dispatch} onSpawn={spawn} onEdit={edit} onSwitch={switchPlayer} onEndTurn={endTurn} notify={notify} panel={playgroundTab} setPanel={setPlaygroundTab} panels={panels} libraryVisible={libraryVisible} stackDragTakesTop={settings.stackDragTakesTop} showHidden={showHidden} notice={undoToast} onDismissNotice={() => setUndoToast(undefined)} /> :
        activeComponent?.source ? <LinkedComponent key={activeComponent.id} component={activeComponent} components={project.components} notify={notify}
          available={archive.projects.some(p => p.id === activeComponent.source?.projectId && p.components.some(c => c.id === activeComponent.source?.componentId))}
          onCopy={() => void copyLinked(activeComponent)} onRemove={() => setRemoveLink(activeComponent)} /> :
        activeComponent && isAsset(activeComponent) ? <AssetInspector key={activeComponent.id} component={activeComponent} components={project.components} notify={notify} onChange={component => dispatch({ type: 'component', component })} onDelete={async () => {
          if (await dispatch({ type: 'removeComponent', id: activeComponent.id })) { setComponentId(undefined); setSelected([]); }
        }} /> :
        activeComponent ? <Designer key={activeComponent.id} flushRef={designerFlush} component={activeComponent} components={project.components} functions={functions} tab={designerTab} setTab={setDesignerTab} panels={panels} layersVisible={layersVisible} inspectorVisible={designerInspectorVisible} onChange={editDesign} onDelete={async () => {
          if (await dispatch({ type: 'removeComponent', id: activeComponent.id })) { setComponentId(undefined); setSelected([]); }
        }} notify={notify} /> : <div className="no-component"><Palette size={40} /><h2>A blank page is a beautiful thing.</h2><button className="button primary" onClick={() => setModal('templates')}>Create your first component</button></div>)}</div>
    </main>
    <input ref={fileInput} type="file" accept=".zip,application/zip" hidden onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
    <input ref={textureInput} type="file" accept={TEXTURE_ACCEPT} multiple hidden onChange={e => { void importAssets(e.target.files, 'texture'); e.target.value = ''; }} />
    <input ref={fontInput} type="file" accept={FONT_ACCEPT} multiple hidden onChange={e => { void importAssets(e.target.files, 'font'); e.target.value = ''; }} />
    {!home && scriptWindow && <FloatingWindow id="scripts" title="Scripts" icon={<FileCode2 size={15} />} onClose={() => setScriptWindow(false)} minWidth={480} minHeight={300}
      initial={page => ({ width: Math.min(820, page.width - 80), height: Math.min(560, page.height - 140), x: Math.max(16, page.width - Math.min(820, page.width - 80) - 300), y: 90 })}>
      <Suspense fallback={loadingWindow}><ScriptEditor project={project} canEdit={scriptEditor} canRun={!viewer} dispatch={dispatch} notify={notify} focus={scriptFocus} /></Suspense>
    </FloatingWindow>}
    {!home && memoryWindow && <FloatingWindow id="memory" title="Memory" icon={<Database size={15} />} onClose={() => setMemoryWindow(false)} minWidth={380} minHeight={220}
      initial={page => ({ width: Math.min(520, page.width - 80), height: Math.min(440, page.height - 160), x: Math.max(16, page.width - Math.min(520, page.width - 80) - 40), y: 130 })}>
      <Suspense fallback={loadingWindow}><MemoryEditor memory={project.memory} canEdit={!viewer} dispatch={dispatch} notify={notify} projectName={project.name} /></Suspense>
    </FloatingWindow>}
    {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <WifiOff size={17} /> : <Check size={17} />}<span>{toast.message}</span><button onClick={() => setToast(undefined)} aria-label="Dismiss notification"><X size={14} /></button></div>}
    {modal === 'seat' && session && <Modal title="Pick your seat" subtitle="Take an empty seat to play, or watch the table as a viewer. You can switch any time from the Players tab." wide onClose={() => setModal(undefined)}>
      <div className="seat-picker">
        <div className="seat-picker-list">{project.players.map(player => {
          const mine = player.owner === session.identity;
          return <div className={`seat-option${mine ? ' mine' : ''}${player.owner && !mine ? ' taken' : ''}`} key={player.id}>
            <span className="mini-avatar" style={{ background: player.color }}>{player.name[0]}</span>
            <span className="seat-option-name"><strong>{player.name}</strong><small>{mine ? 'Your seat' : player.owner ? 'Taken by another player' : 'Empty seat'}</small></span>
            <button className="button seat-option-button" disabled={!!player.owner} aria-label={`Take ${player.name}'s seat`} onClick={() => { setModal(undefined); void takeSeat(player.id).then(ok => { if (ok) notify(`You took ${player.name}'s seat.`); else setModal('seat'); }); }}><Armchair size={13} /> {mine ? 'Seated' : 'Take seat'}</button>
          </div>;
        })}
        {!project.players.length && <p className="link-source-empty">This table has no seats yet. Take a new one to start playing.</p>}</div>
        <div className="seat-picker-actions">
          <button className="button" onClick={() => { setModal(undefined); void takeSeat('').then(ok => { if (!ok) setModal('seat'); }); }}><Eye size={15} /> Watch as viewer</button>
          <button className="button primary" onClick={() => { setModal(undefined); void takeSeat(uid('player')).then(ok => { if (ok) notify('You took a new seat at the table.'); else setModal('seat'); }); }}><Plus size={15} /> Take a new seat</button>
        </div>
      </div>
    </Modal>}
    {modal === 'link' && <Modal title="Link from another project" subtitle="Linked designs are read-only here. Their saved snapshot travels with this project." wide onClose={() => setModal(undefined)}>
      <div className="link-project-list">{archive.projects.filter(p => p.id !== project.id).map(source => <section key={source.id} className="link-source" aria-label={source.name}>
        <header className="link-source-header"><span className="link-source-icon"><Leaf size={18} /></span><span><strong>{source.name}</strong><small>{source.components.length} component{source.components.length === 1 ? '' : 's'}</small></span></header>
        <div className="link-component-list">
        {source.components.map(component => <div className="link-component-option" key={component.id}><span className="link-component-kind" aria-hidden="true">{kindIcon(component.kind, 15)}</span><span className="link-component-name"><strong>{component.name}</strong><small>{component.kind}{component.source ? ' · linked' : ''}</small></span><button className="button link-component-button" title="Link component" aria-label={`Link ${component.name} from ${source.name}`} onClick={async () => {
          try {
            const linked = linkComponent(project, source, component.id);
            const proposed = { ...archive, projects: archive.projects.map(p => p.id === project.id ? linked.project : p) };
            const refreshed = refreshProjectLinks(proposed).projects.find(p => p.id === project.id)!;
            const changes = refreshed.components.filter(c => JSON.stringify(project.components.find(existing => existing.id === c.id)) !== JSON.stringify(c));
            if (changes.length && !await dispatch({ type: 'syncLinkedComponents', components: changes })) return;
            setModal(undefined); edit(linked.rootId); notify('Component linked. Its design is read-only in this project.');
          } catch (error) { notify(`Unable to link component: ${String(error)}`, true); }
        }}><Link size={13} /> Link</button></div>)}</div>
        {!source.components.length && <p className="link-source-empty">No components in this project yet.</p>}
      </section>)}
      {!archive.projects.some(p => p.id !== project.id) && <div className="link-empty-state">
        <span className="link-empty-icon"><Link size={28} /></span>
        <h3>No other projects yet</h3>
        <p>Create or import a project on Home, then return here to link its components.</p>
        <button className="button primary" onClick={showHome}>Go to Home <ArrowRight size={15} /></button>
      </div>}
      </div>
    </Modal>}
    {removeLink && <Modal title={`Remove ${removeLink.name}?`} subtitle="This removes the link and its placed pieces from this project, not the original component." onClose={() => setRemoveLink(undefined)}>
      <div className="modal-actions"><button className="button" onClick={() => setRemoveLink(undefined)}>Cancel</button><button className="button danger" onClick={async () => {
        if (await dispatch({ type: 'removeComponent', id: removeLink.id })) { setRemoveLink(undefined); setComponentId(undefined); }
      }}>Remove link</button></div>
    </Modal>}
    {modal === 'templates' && <Modal title="What will you make?" subtitle="A starting point, not a limitation. Every detail is yours to change." wide onClose={() => setModal(undefined)}>
      <div className="template-grid">{([
        ['card', 'Cards', 'Characters, spells, a little intrigue.'], ['token', 'Tokens', 'Small pieces. Big possibilities.'],
        ['board', 'Boards', 'Build a world to play in.'], ['dice', 'Dice', 'Leave a little to chance.'],
        ['book', 'Books', 'Rules, journals and lore. Turn pages with Shift+Q/E.'], ['artwork', 'Artwork', 'Reusable vector art for nested components.'],
        ['button', 'Buttons', 'Press to run a script for everyone at the table.'],
      ] as const).map(([kind, title, description]) => <button key={kind} className={`template-card template-${kind}`} onClick={() => addTemplate(kind)}><div className="template-art">{kindIcon(kind, 48)}</div><strong>{title}<ArrowRight size={15} /></strong><small>{description}</small></button>)}
        <button className="template-card template-texture" onClick={() => textureInput.current?.click()}><div className="template-art"><ImageIcon size={48} /><Upload size={18} className="template-import-badge" /></div><strong>Textures<ArrowRight size={15} /></strong><small>Import PNG, JPEG, WebP or GIF images. Embedded in your ZIP save.</small></button>
        <button className="template-card template-font" onClick={() => fontInput.current?.click()}><div className="template-art"><Type size={48} /><Upload size={18} className="template-import-badge" /></div><strong>Fonts<ArrowRight size={15} /></strong><small>Import TTF, OTF, WOFF or WOFF2 fonts. Embedded in your ZIP save.</small></button>
        <button className="template-card template-script" disabled={!scriptEditor} title={scriptEditor ? undefined : 'Only the host can add scripts in this room'} onClick={() => void createScript()}><div className="template-art"><FileCode2 size={48} /></div><strong>Scripts<ArrowRight size={15} /></strong><small>Lua that buttons and events run for everyone at the table.</small></button>
      </div>
    </Modal>}
    {settingsOpen && <Modal title={settings.onboarded ? 'Make it yours.' : 'Welcome to Tablecraft.'} subtitle={settings.onboarded ? 'Preferences for you on this device. They stay in this browser and are never shared with other players.' : 'Before you start, tell the table who you are. Everything here stays in this browser, and you can change it any time in Settings.'} wide onClose={closeSettings}>
      <div className="settings-dialog">
        <section className="settings-section" aria-labelledby="settings-profile">
          <header><span className="settings-section-icon"><Users size={18} /></span><div><h3 id="settings-profile">Player profile</h3><p>Your name and color at every table: on your seat when you host or join, and on your first hotseat seat.</p></div></header>
          <div className="field-grid">
            <label className={`field settings-name${nameRequired && !validName(settings.name) ? ' invalid' : ''}`}><span>Your name</span>
              <input id="settings-name" aria-label="Your name" required autoFocus={!settings.onboarded} maxLength={NAME_LIMIT} autoComplete="nickname" spellCheck={false} value={settings.name}
                aria-invalid={nameRequired && !validName(settings.name)} aria-describedby="settings-name-hint"
                onChange={e => updateSettings({ name: cleanName(e.target.value) })} onKeyDown={e => { if (e.key === 'Enter') closeSettings(); }} />
              <small id="settings-name-hint" role={nameRequired && !validName(settings.name) ? 'alert' : undefined}>{nameRequired && !validName(settings.name) ? 'Choose a name to continue.' : 'Required. Up to 32 basic Latin (ASCII) characters.'}<em>{settings.name.length}/{NAME_LIMIT}</em></small>
            </label>
            <ColorField deferred alpha={false} label="Default color" value={settings.color} onChange={color => {
              if (/^#[0-9a-f]{6}$/i.test(color)) updateSettings({ color: color.toLowerCase() }); else notify('Use a hex color such as #b7cc91 for your default color.', true);
            }} />
          </div>
        </section>
        <section className="settings-section" aria-labelledby="settings-appearance">
          <header><span className="settings-section-icon"><Sun size={18} /></span><div><h3 id="settings-appearance">Appearance</h3><p>Choose how Tablecraft looks. System follows your device.</p></div></header>
          <div className="theme-options" role="radiogroup" aria-label="Theme">{([
            ['system', 'System', Monitor, 'Match your device'], ['light', 'Light', Sun, 'Bright paper and ink'], ['dark', 'Night', Moon, 'Easy on the eyes after dark'],
          ] as const).map(([value, label, Icon, hint]) => <button key={value} role="radio" aria-checked={settings.theme === value} className={`theme-option theme-option-${value} ${settings.theme === value ? 'active' : ''}`} onClick={() => updateSettings({ theme: value })}>
            <span className="theme-swatch" data-theme-fixed="" aria-hidden="true"><span /><span /><span /></span><strong><Icon size={14} /> {label}{settings.theme === value && <Check size={14} className="theme-check" />}</strong><small>{hint}</small>
          </button>)}</div>
          <div className="ui-scale-setting">
            <div><strong id="settings-ui-scale">Interface scale</strong><small>Makes every panel, label and control larger or smaller. 100% is the default.</small></div>
            <div className="ui-scale-controls">
              <div className="ui-scale-presets" role="radiogroup" aria-labelledby="settings-ui-scale">{UI_SCALE_PRESETS.map(value => <button key={value} type="button" role="radio" aria-checked={settings.uiScale === value}
                className={settings.uiScale === value ? 'active' : ''} onClick={() => updateSettings({ uiScale: value })}>{value}%</button>)}</div>
              <NumberField deferred label={`Custom scale (${UI_SCALE_MIN}–${UI_SCALE_MAX}%)`} value={settings.uiScale} min={UI_SCALE_MIN} max={UI_SCALE_MAX} step={5} onChange={value => updateSettings({ uiScale: clampUiScale(value) })} />
            </div>
          </div>
        </section>
        <section className="settings-section" aria-labelledby="settings-table">
          <header><span className="settings-section-icon"><Layers size={18} /></span><div><h3 id="settings-table">Table</h3><p>How your pointer handles pieces on the table.</p></div></header>
          <Toggle label="Drag the top piece off stacks" description="Dragging a stack takes its top piece; hold Shift to move the whole stack. Turn off to move whole stacks by default and Shift-drag to take the top piece."
            checked={settings.stackDragTakesTop} onChange={stackDragTakesTop => updateSettings({ stackDragTakesTop })} />
        </section>
        <section className="settings-section" aria-labelledby="settings-multiplayer">
          <header><span className="settings-section-icon"><Wifi size={18} /></span><div><h3 id="settings-multiplayer">Multiplayer</h3><p>Prefilled when you invite players or join a table. You can still change them for a single session.</p></div></header>
          <div className="field-grid">
            <Field label="Default SpaceTimeDB server"><input maxLength={500} placeholder={DEFAULT_SERVER} value={settings.server} onChange={e => updateSettings({ server: e.target.value })} /></Field>
            <Field label="Default database"><input maxLength={100} placeholder={DEFAULT_DATABASE} value={settings.database} onChange={e => updateSettings({ database: e.target.value })} /></Field>
          </div>
          <button className="button settings-reset" disabled={settings.server === DEFAULT_SERVER && settings.database === DEFAULT_DATABASE} onClick={() => updateSettings({ server: DEFAULT_SERVER, database: DEFAULT_DATABASE })}><Undo2 size={14} /> Restore default server</button>
        </section>
        {settings.onboarded ? <p className="settings-footer"><Check size={13} /> Changes are saved automatically.</p> : <div className="settings-start"><button className="button primary" onClick={closeSettings}>Start making <ArrowRight size={15} /></button></div>}
      </div>
    </Modal>}
    {modal === 'session' && <Modal title={session ? 'Your table is live.' : home ? 'Join a table.' : 'Good games bring people together.'} subtitle={session ? 'Share this room code with your playtesters.' : home ? 'Enter the room code your host shared to play along.' : 'Play together over SpaceTimeDB, or pass the screen with hotseat.'} onClose={() => { if (!connecting) setModal(undefined); }}>
      <div className="session-dialog">{session ? <>
        <div className="room-code"><span>ROOM CODE</span><strong>{session.code}</strong><button className="button" onClick={() => {
          void navigator.clipboard.writeText(`${session.code}\n${uri}\n${database}`).then(() => notify('Room details copied.')).catch(error => notify(String(error), true));
        }}><CopyIcon /> Copy room details</button></div>
        <p className="help-text">You're connected to {database}. Open the component designer without leaving the session. Everyone sees edits live.</p>
        <button className="button full" onClick={leave}><WifiOff size={15} /> Leave session & keep local copy</button>
      </> : <>
        {!home && <div className="session-note"><Users size={22} /><div><strong>Already sharing a screen?</strong><p>Hotseat works offline. Add players in the Players tab and switch seats to keep hands hidden.</p></div></div>}
        <div className="session-identity"><span className="mini-avatar" style={{ background: settings.color }}>{settings.name.trim()[0]?.toUpperCase()}</span><div><small>Playing as</small><strong>{settings.name.trim()}</strong></div><span>Change your name in Settings.</span></div>
        <Field label="SpaceTimeDB server"><input value={uri} onChange={e => setUri(e.target.value)} placeholder="http://127.0.0.1:3000" /></Field>
        <Field label="Database name"><input value={database} onChange={e => setDatabase(e.target.value)} /></Field>
        <Field label="Room code"><input className="room-code-input" maxLength={40} value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())} /></Field>
        <p className="help-text">{home ? 'The room opens as a project in your workshop, and you keep a local copy when you leave.' : 'Host publishes this playground to the room. Join opens an existing room.'} A room code grants editing access; use trusted playtesters. Hidden hand faces are a UI feature, not cryptographic privacy.</p>
        <Notice message={connectionError} className="inline-error" />
        <div className="button-row"><button className={`button ${home ? 'primary ' : ''}full`} disabled={connecting} onClick={() => void join(false)}>{connecting ? <LoaderCircle className="spin" size={15} /> : <Link size={15} />} Join room</button>{!home && <button className="button primary full" disabled={connecting} onClick={() => void join(true)}>{connecting ? <LoaderCircle className="spin" size={15} /> : <Wifi size={15} />} Host this table</button>}</div>
      </>}</div>
    </Modal>}
    {modal === 'print' && <PrintDialog project={project} onClose={() => setModal(undefined)} />}
    {modal === 'save' && open && <Modal title="Save & load" subtitle="Snapshots keep the whole playground: designs, table, hands, seats, scripts and memory." wide onClose={() => setModal(undefined)}>
      <HistoryManager project={project} {...historyProps(open.projectId)} onSave={saveSnapshot} readOnly={session ? 'Leave the live table to load snapshots.' : undefined} />
    </Modal>}
    {historyFor && (() => {
      const item = archive.projects.find(p => p.id === historyFor);
      return item && <Modal title={item.name} subtitle="Draft snapshots, the base of a finished project, and play sessions." wide onClose={() => setHistoryFor(undefined)}>
        <HistoryManager project={item} {...historyProps(item.id)} />
      </Modal>;
    })()}
    {exportFor && (() => {
      const item = exportFor === open?.projectId && !home ? project : archive.projects.find(p => p.id === exportFor);
      return item && <ExportDialog project={item} history={histories[item.id] ?? emptyHistory()} open={open?.projectId === item.id ? open : undefined}
        onClose={() => setExportFor(undefined)} onExport={ids => { if (exportProject(item, ids)) setExportFor(undefined); }} />;
    })()}
    {chooser && (() => {
      const item = archive.projects.find(p => p.id === chooser), history = histories[chooser];
      return item && history && <GameChooser project={item} history={history} onClose={() => setChooser(undefined)}
        onStart={name => { setChooser(undefined); startGame(item.id, name); }} onContinue={sessionId => { setChooser(undefined); continueSession(item.id, sessionId); }} />;
    })()}
    {unsaved && open && <UnsavedDialog project={project} target={unsaved.target} onCancel={() => setUnsaved(undefined)}
      onDiscard={() => { const { then } = unsaved; setUnsaved(undefined); then(); }}
      onSave={name => { const { then } = unsaved; if (saveSnapshot(name)) { setUnsaved(undefined); then(); } }} />}
    {modal === 'help' && <Modal title="Welcome to your workshop." subtitle="Less setup. More 'what if?'" wide onClose={() => setModal(undefined)}>
      <div className="help-grid"><div><span>01</span><h3>Make your pieces</h3><p>Start from a template or a blank component. Add layers and nested frames, style them, and connect text or images to CSV columns with {'{{bindings}}'}.</p></div><div><span>02</span><h3>Bring them to the table</h3><p>Click a library component to spawn it. Shift-click to select multiple pieces, then stack compatible pieces. Double-click to flip a card or draw from a stack.</p></div><div><span>03</span><h3>Find the fun</h3><p>Add hotseat players, switch seats and play. Connect a SpaceTimeDB room for online play. Design changes stay live for everyone.</p></div></div>
      <div className="keyboard-shortcuts"><span><kbd>Z</kbd> Fullscreen preview</span><span><kbd>F</kbd> Flip</span><span><kbd>Q/E</kbd> Rotate</span><span><kbd>Shift Q/E</kbd> Turn page / die face</span><span><kbd>G</kbd> Group (over Pieces)</span><span><kbd>R</kbd> Shuffle / roll</span><span><kbd>G</kbd> Stack</span><span><kbd>Ctrl C/V</kbd> Copy / paste</span><span><kbd>Ctrl D</kbd> Clone</span><span><kbd>L</kbd> Lock</span><span><kbd>Del</kbd> Delete</span><span><kbd>Scroll</kbd> Zoom</span><span><kbd>Middle drag</kbd> Pan</span></div>
      <div className="help-footer"><Leaf size={18} /><p>Your work stays in this browser. Export ZIP to back it up or move it to another device. Imported textures and fonts travel with your save; external texture URLs and Google Fonts need internet access.</p></div>
    </Modal>}
    {curtain && <div className="privacy-curtain"><span className="brand-mark"><Layers size={32} /></span><p>PASS THE SCREEN TO</p><h1>{curtain.name}</h1><span className="curtain-avatar" style={{ background: curtain.color }}>{curtain.name[0]}</span><p className="curtain-description">{curtain.endsTurn ? `It's ${curtain.name}'s turn. A little privacy for the next big move.` : 'A little privacy for your next big move.'}</p><button className="button primary" onClick={() => { setActor(curtain.id); if (curtain.endsTurn) void dispatch({ type: 'endTurn' }); setCurtain(undefined); }}>I'm {curtain.name}. Let's play. <ArrowRight size={17} /></button><button className="text-button" onClick={() => setCurtain(undefined)}>{curtain.endsTurn ? 'Back to the current player (keep the turn)' : 'Back to the current player'}</button></div>}
  </div></MemoryBindings.Provider>;
}
function CopyIcon() { return <Square size={14} />; }
