import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Armchair, ArrowRight, Check, ChevronDown, ChevronRight, Circle, CopyPlus, Download, Eye, FilePlus2, GripVertical, HelpCircle, Layers, Leaf, LibraryBig, Link, LoaderCircle, Monitor, Moon, Move, Palette, PencilLine, PanelBottom, PanelLeft, PanelRight, Plus, Save, Search, Settings, Square, Sun, Table2, Trash2, Undo2, Users, Wifi, WifiOff, X } from 'lucide-react';
import { applyCommand, archiveSchema, canStack, makeInstance, nextSeatPlacement, projectSchema, uid, validateProject, type Archive, type Command, type Component, type Player, type Project } from './domain';
import { applyPlaygroundCommand, emptyPlaygroundHistory, undoPlayground, type PlaygroundHistory } from './playgroundHistory';
import { starterProject, templateBundle } from './templates';
import { download, exportProject, loadWorkspace, parseArchive, parseComponentBundle, remapComponentBundle, saveWorkspace } from './storage';
import { ComponentThumbnail } from './ComponentView';
import { Designer } from './Designer';
import { Playground } from './Playground';
import { PanelSeparator, usePanelLayout } from './panelLayout';
import type { LiveSession } from './multiplayer';
import { ColorField, Field, Modal, Notice, ScrollArrows, useSmoothHorizontalWheel } from './ui';
import { Home } from './Home';
import { LinkedComponent } from './LinkedComponent';
import { linkComponent, localComponentCopy, refreshProjectLinks } from './projectLinks';
import { LibraryVariants } from './LibraryVariants';
import { startLibraryDrag } from './libraryDrag';
import { cleanName, DEFAULT_DATABASE, DEFAULT_SERVER, loadSettings, NAME_LIMIT, saveSettings, validName, watchTheme, type UserSettings } from './settings';

const kindIcon = (kind: Component['kind'], size: number) => kind === 'card' ? <Layers size={size} /> : kind === 'token' ? <Circle size={size} /> : kind === 'artwork' ? <Palette size={size} /> : <Square size={size} />;
const LAST_PROJECT_KEY = 'tablecraft.last-project';
function boot(): { archive: Archive; error: string | null; lastProjectId: string | null } {
  try { return { archive: refreshProjectLinks(loadWorkspace()), lastProjectId: localStorage.getItem(LAST_PROJECT_KEY), error: null }; }
  catch (error) { return { archive: { format: 'tablecraft', version: 1, projects: [starterProject()] }, lastProjectId: null, error: `Your previous save couldn't be read. It has not been overwritten. ${error instanceof Error ? error.message : String(error)}` }; }
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

// Dice rows are faces of one die, not separately spawnable variants.
const hasVariants = (component: Component) => component.kind !== 'dice' && component.rows.length > 1;

export default function App() {
  const [initial] = useState(boot);
  const templatePreviews = useMemo(() => ({
    card: templateBundle('card'), token: templateBundle('token'),
    board: templateBundle('board'), dice: templateBundle('dice'), artwork: templateBundle('artwork'),
  }), []);
  const [workspace, setWorkspace] = useState<{ archive: Archive; histories: Record<string, PlaygroundHistory> }>({ archive: initial.archive, histories: {} });
  const { archive } = workspace;
  // Whole-workspace imports/snapshots and live subscriptions start a fresh offline history.
  const setArchive = useCallback((update: Archive | ((current: Archive) => Archive)) => {
    setWorkspace(current => ({ archive: typeof update === 'function' ? update(current.archive) : update, histories: {} }));
  }, []);
  const [storageError, setStorageError] = useState(initial.error);
  const [fallbackProject] = useState(starterProject);
  const initialProject = initial.archive.projects.find(p => p.id === initial.lastProjectId) ?? initial.archive.projects[0] ?? fallbackProject;
  const [home, setHome] = useState(!initial.archive.projects.some(p => p.id === initial.lastProjectId));
  const [projectId, setProjectId] = useState(initialProject.id);
  const [mode, setMode] = useState<'playground' | 'designer'>('playground');
  const [componentId, setComponentId] = useState<string | undefined>(initialProject.components[0]?.id);
  const [selected, setSelected] = useState<string[]>([]);
  const [libraryVisible, setLibraryVisible] = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [layersVisible, setLayersVisible] = useState(true);
  const [handVisible, setHandVisible] = useState(true);
  const [actor, setActor] = useState(initialProject.players[0]?.id ?? '');
  const [curtain, setCurtain] = useState<Player>();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
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
  const [modal, setModal] = useState<'templates' | 'settings' | 'session' | 'help' | 'save' | 'link' | 'seat'>();
  const [removeLink, setRemoveLink] = useState<Component>();
  const [toast, setToast] = useState<{ message: string; error: boolean; id: number }>();
  const [session, setSession] = useState<LiveSession>();
  const [liveUndo, setLiveUndo] = useState({ count: 0, notice: '' });
  const sessionRef = useRef<LiveSession | undefined>(undefined);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [settings, setSettings] = useState(loadSettings);
  const [uri, setUri] = useState(settings.server);
  const [database, setDatabase] = useState(settings.database);
  const [roomCode, setRoomCode] = useState(() => `PLAY-${crypto.randomUUID().slice(0, 6).toUpperCase()}`);
  const [nameRequired, setNameRequired] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [snapshotStore, setSnapshotStore] = useState(loadSnapshots);
  const { projects: snapshots, error: snapshotError } = snapshotStore;
  const fileInput = useRef<HTMLInputElement>(null);
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
  const project = useMemo(() => predictions.reduce((current, entry) => {
    try { return entry.apply(current); } catch { return current; }
  }, confirmed), [confirmed, predictions]);
  const activeComponent = project.components.find(c => c.id === componentId) ?? project.components[0];
  const fontFamilies = [...new Set(project.components.flatMap(c => [...c.front, ...c.back].map(n => n.font)).filter(Boolean))].sort().join('|');
  const notify = useCallback((message: string, error = false) => setToast({ message, error, id: Date.now() }), []);
  const openProject = (id: string) => {
    try {
      const refreshed = refreshProjectLinks(archive);
      const next = refreshed.projects.find(p => p.id === id);
      if (!next) throw new Error('Project no longer exists.');
      localStorage.setItem(LAST_PROJECT_KEY, id);
      if (refreshed !== archive) setWorkspace(current => {
        const histories = { ...current.histories };
        for (const project of refreshed.projects) if (project !== archive.projects.find(p => p.id === project.id)) {
          histories[project.id] = { entries: [], notice: 'Undo history cleared because linked component designs changed.' };
        }
        return { archive: refreshed, histories };
      });
      setProjectId(id); setActor(next.players[0]?.id ?? '');
      setComponentId(next.components[0]?.id); setSelected([]); setSearch(''); setFilter('all');
      setMode('playground'); setHome(false); setModal(undefined);
    } catch (error) { notify(`Unable to open project: ${String(error)}`, true); }
  };
  const [designerTab, setDesignerTab] = useState<'design' | 'behavior'>('design');
  const [playgroundTab, setPlaygroundTab] = useState<'selection' | 'table' | 'players'>('selection');
  const panels = usePanelLayout(mode, libraryVisible, inspectorVisible, layersVisible, notify);
  useEffect(() => watchTheme(settings.theme), [settings.theme]);
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
  // Online, the acting seat is whichever seat this identity occupies; without one the player watches as a viewer.
  useEffect(() => {
    if (!session) return;
    const own = project.players.find(player => player.owner === session.identity)?.id ?? '';
    if (own === actor) return;
    if (actor && !own && !project.players.some(player => player.id === actor)) notify('Your seat was removed. You are now watching as a viewer.', true);
    setActor(own);
  }, [session, actor, project.players, notify]);
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
    setHome(false);
    try { localStorage.setItem(LAST_PROJECT_KEY, next.id); }
    catch (error) { notify(`Unable to remember the last project: ${String(error)}`, true); }
  }, [notify]);
  const dispatch = useCallback((command: Command): Promise<boolean> => {
    if (sessionRef.current) {
      return predict(p => applyCommand(p, command, actor || undefined), sessionRef.current.send(command, actor)).then(() => true).catch(error => {
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
          const updated = { ...current.archive, projects: current.archive.projects.map(p => p.id === projectId ? result.project : p) };
          const refreshed = refreshProjectLinks(updated);
          const histories = { ...current.histories, [projectId]: result.history };
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
  const viewer = !!session && !actor;
  const undoCount = session ? liveUndo.count : workspace.histories[project.id]?.entries.length ?? 0;
  const undoNotice = session ? liveUndo.notice : workspace.histories[project.id]?.notice ?? '';
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
      if (home || mode !== 'playground' || modal || curtain || event.defaultPrevented || event.isComposing || event.repeat ||
        !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'z') return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"]')) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      event.preventDefault();
      if (undoCount && !viewer) undo();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [home, mode, modal, curtain, undoCount, undo, viewer]);
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
  const watch = () => { void takeSeat('').then(ok => { if (ok) { setSelected([]); notify('You left your seat and are now watching.'); } }); };
  const newSeat = () => { void takeSeat(uid('player')).then(ok => { if (ok) { setSelected([]); notify('You took a new seat at the table.'); } }); };
  const spawn = (component: Component, rows: number[] = [0], point = { x: 820, y: 450 }, stacked = false) => {
    if (viewer) { notify('You are watching as a viewer. Take a seat in Players to play.', true); return; }
    if (component.kind === 'dice') { rows = [0]; stacked = false; }
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
        const ids = new Map(incoming.projects.map(p => [p.id, uid('project')]));
        const projects = incoming.projects.map(p => ({ ...p, id: ids.get(p.id)!, components: p.components.map(c => c.source && ids.has(c.source.projectId)
          ? { ...c, source: { ...c.source, projectId: ids.get(c.source.projectId)! } } : c) }));
        if (archive.projects.length + projects.length > 100) throw new Error('A workspace can contain at most 100 projects.');
        if (!projects.length) throw new Error('The imported archive has no projects.');
        setArchive(refreshProjectLinks({ ...archive, projects: [...archive.projects, ...projects] }));
        setProjectId(projects[0].id); setActor(projects[0].players[0]?.id ?? ''); setSelected([]);
        setComponentId(projects[0].components[0]?.id); setMode('playground');
        if (!home) localStorage.setItem(LAST_PROJECT_KEY, projects[0].id);
        setStorageError(null); notify(`Imported ${projects.length} project${projects.length === 1 ? '' : 's'}.`);
      } else {
        if (home) throw new Error('Open a project before importing a component.');
        const bundle = parseComponentBundle(text);
        const remapped = remapComponentBundle(bundle);
        validateProject({ ...project, components: [...project.components, ...remapped.components] });
        if (!await dispatch({ type: 'addComponents', components: remapped.components })) throw new Error('Components could not be imported.');
        edit(remapped.rootId); notify(`Imported ${remapped.components.length} linked component${remapped.components.length === 1 ? '' : 's'}.`);
      }
    } catch (error) { notify(`Import failed: ${error instanceof Error ? error.message : String(error)}`, true); }
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
      sessionRef.current = live; setSession(live);
      const row = [...live.connection.db.roomState.iter()][0];
      const ownPlayer = row ? (JSON.parse(row.state) as Project).players.find(p => p.owner === live.identity) : undefined;
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
  const createProject = (name: string, description = '') => {
    if (archive.projects.length >= 100) { notify('A workspace can contain at most 100 projects.', true); return; }
    const next: Project = { ...starterProject(), name, description, components: [], instances: [], players: [] };
    setProject(next); setActor(''); setComponentId(undefined); setSelected([]);
    setSearch(''); setFilter('all'); setMode('playground'); setModal('templates');
  };
  const copyLinked = async (component: Component) => {
    try {
      const copy = localComponentCopy(project, component.id);
      if (await dispatch({ type: 'addComponents', components: copy.components })) { edit(copy.rootId); notify('Created an editable local copy, including nested artwork.'); }
    } catch (error) { notify(`Unable to copy component: ${String(error)}`, true); }
  };
  const visible = project.components.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || c.kind === filter));
  const selectedComponent = mode === 'designer' ? activeComponent : project.components.find(c => c.id === project.instances.find(i => i.id === selected.at(-1))?.componentId);
  const settingsButton = <button className="profile-button" aria-label="Settings" title="Settings" onClick={() => setModal('settings')}>{settings.name.trim() ? settings.name.trim()[0].toUpperCase() : <Settings size={15} />}</button>;
  return <div className={`app-shell ${mode === 'playground' ? 'playground-shell' : ''}`}>
    <header className="app-header">
      <a className="brand" href="#" aria-label="Tablecraft home" onClick={e => { e.preventDefault(); showHome(); }}><span className="brand-mark"><Layers size={23} strokeWidth={1.8} /></span>tablecraft<span className="brand-beta">BETA</span></a>
      {!home && <>
      <div className="project-heading compact-project"><h1>{project.name}</h1></div>
      <nav className="mode-switch" aria-label="Workspace mode"><button className={mode === 'playground' ? 'active' : ''} onClick={() => setMode('playground')}><Table2 size={16} /> Playground</button><button className={mode === 'designer' ? 'active' : ''} onClick={() => { if (!activeComponent) setModal('templates'); else setMode('designer'); }}><Palette size={16} /> Component designer</button></nav>
      {mode === 'playground' && <button className="icon-button" aria-label="Undo playground action" title={undoNotice || `Undo latest playground action for everyone (Ctrl/Cmd+Z) · ${undoCount} available`} disabled={!undoCount || !!modal || !!curtain || viewer} onClick={undo}><Undo2 size={18} /></button>}
      <div className="header-actions"><button className="icon-button" title="Toggle component library" aria-label="Toggle component library" aria-pressed={libraryVisible} onClick={() => setLibraryVisible(!libraryVisible)}><LibraryBig size={17} /></button><button className="icon-button" title={mode === 'playground' ? 'Toggle pieces panel' : 'Toggle layers panel'} aria-label={mode === 'playground' ? 'Toggle pieces panel' : 'Toggle layers panel'} aria-pressed={layersVisible} onClick={() => setLayersVisible(!layersVisible)}><PanelLeft size={17} /></button>{mode === 'playground' && <><button className="icon-button" title="Toggle hand panel" aria-label="Toggle hand panel" aria-pressed={handVisible} onClick={() => setHandVisible(!handVisible)}><PanelBottom size={17} /></button><button className="icon-button" title="Toggle table inspector" aria-label="Toggle table inspector" aria-pressed={inspectorVisible} onClick={() => setInspectorVisible(!inspectorVisible)}><PanelRight size={17} /></button></>}<button className="button compact-save" aria-label="Save playground" title="Save playground" onClick={() => { setSaveName(`${project.name} - playtest`); setModal('save'); }}><Save size={15} /></button><button className="button primary compact-invite" onClick={() => setModal('session')}><Users size={15} />{session ? session.code : 'Invite players'}</button><button className="help-button icon-button" title="How to use Tablecraft" aria-label="Help" onClick={() => setModal('help')}><HelpCircle size={19} /></button><span className="header-separator" /><button className="connection-badge" onClick={() => setModal('session')}><span className={`live-dot ${session ? '' : 'offline'}`} />{session ? viewer ? 'Live · watching' : 'Live session' : 'Local workspace'}</button>      {settingsButton}</div>
      </>}
            {home && <div className="header-actions">{settingsButton}</div>}
    </header>
    <Notice message={storageError ?? ''}><button onClick={() => {
      const raw = localStorage.getItem('tablecraft.workspace.v1'); if (raw) download('tablecraft-recovery.json', raw);
      setStorageError(null);
    }}>Download recovery & continue</button><button onClick={() => exportProject(project)}>Export current work</button></Notice>
    {home && <Home projects={archive.projects} onLoad={openProject} onCreate={createProject}
      onUpdate={(id, patch) => setWorkspace(current => ({ ...current, archive: { ...current.archive, projects: current.archive.projects.map(p => p.id === id ? { ...p, ...patch } : p) } }))}
      onImport={() => fileInput.current?.click()} onExport={exportProject} onJoin={() => { setConnectionError(''); setModal('session'); }}
      onExportAll={() => download('tablecraft-workspace.json', JSON.stringify(archive, null, 2))}
      onDelete={id => {
        try {
          if (localStorage.getItem(LAST_PROJECT_KEY) === id) localStorage.removeItem(LAST_PROJECT_KEY);
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
        <div className="library-heading"><h2>Components <span>{project.components.length}</span></h2><span className="library-heading-actions"><button className="icon-button" aria-label="Link from another project" title="Link from another project" onClick={() => setModal('link')}><Link size={16} /></button><button className="icon-button" aria-label="Add component" title="Add component" onClick={() => setModal('templates')}><Plus size={18} /></button></span></div>
        <div className="library-search search-input"><Search size={14} /><input placeholder="Find a component..." value={search} onChange={e => setSearch(e.target.value)} aria-label="Search components" /><kbd>⌕</kbd></div>
        <div className={`library-filter-scroll${filterEdges.left ? ' overflow-left' : ''}${filterEdges.right ? ' overflow-right' : ''}`}>
          <ScrollArrows target={filterStrip} {...filterEdges} label="library filters" />
          <div ref={filterStrip} className="library-filters">{[{ id: 'all', label: 'All' }, { id: 'card', label: 'Cards' }, { id: 'token', label: 'Tokens' }, { id: 'board', label: 'Boards' }, { id: 'dice', label: 'Dice' }, { id: 'artwork', label: 'Artwork' }].map(f => <button key={f.id} className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>{f.label}</button>)}</div>
        </div>
        <div className="library-section-label">PROJECT LIBRARY <span>{visible.length}</span></div>
        <div className="component-library">{visible.map((comp, index) => <div key={comp.id}
          className={`library-item ${selectedComponent?.id === comp.id ? 'active' : ''}${libraryDrag === comp.id ? ' library-dragging' : ''}${libraryDrop?.id === comp.id ? ` library-drop-${libraryDrop.position}` : ''}`}
          onDragOver={e => {
            if (!libraryDrag || libraryDrag === comp.id) return;
            e.preventDefault(); e.dataTransfer.dropEffect = 'move';
            const rect = e.currentTarget.getBoundingClientRect();
            setLibraryDrop({ id: comp.id, position: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after' });
          }}
          onDragLeave={e => {
            if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setLibraryDrop(undefined);
          }}
          onDrop={e => {
            if (!libraryDrag) return;
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            if (libraryDrag !== comp.id) void dispatch({ type: 'reorderComponent', id: libraryDrag, targetId: comp.id, position: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after' });
            setLibraryDrag(undefined); setLibraryDrop(undefined);
          }}>
          <div className="library-preview-wrap">
          <button className={`library-preview library-preview-${comp.kind}`} draggable={mode === 'playground'}
            onDragStart={e => startLibraryDrag(e.dataTransfer, project.id, comp.id, hasVariants(comp) ? comp.rows.map((_, i) => i) : [0], hasVariants(comp))}
            onClick={() => mode === 'designer' ? setComponentId(comp.id) : spawn(comp)} aria-label={mode === 'designer' ? `Design ${comp.name}` : `Spawn ${comp.name}`} title={mode === 'designer' ? `Design ${comp.name}` : `Spawn ${comp.name}`}>
            <div className="preview-texture" />
            {hasVariants(comp) && <><div className="preview-ghost ghost-left"><ComponentThumbnail component={comp} components={project.components} row={1} width={66} /></div>{comp.rows.length > 2 && <div className="preview-ghost ghost-right"><ComponentThumbnail component={comp} components={project.components} row={2} width={66} /></div>}</>}
            <div className="preview-main"><ComponentThumbnail component={comp} components={project.components} width={comp.kind === 'board' ? 152 : comp.kind === 'token' ? 62 : comp.kind === 'dice' ? 52 : 70} /></div>
            <span className="preview-kind">{kindIcon(comp.kind, 10)}{comp.kind}</span>
            {hasVariants(comp) && <span className="preview-variants" aria-label={`${comp.rows.length} variants`}><Layers size={10} />{comp.rows.length}</span>}
            {mode === 'playground' && <span className="preview-hint" aria-hidden="true"><Move size={10} /> {hasVariants(comp) ? 'Drag all onto table' : 'Drag onto table'}</span>}
            {mode === 'playground' && <span className="preview-add"><Plus size={17} /></span>}
          </button>
          {mode === 'playground' && hasVariants(comp) && <button className="preview-add preview-spawn-all" aria-label={`Spawn all ${comp.name} variants`}
            title={`Spawn all ${comp.rows.length} variants${comp.stackable ? ' as a stack' : ''}`} onClick={() => spawn(comp, comp.rows.map((_, i) => i), undefined, true)}><CopyPlus size={15} /></button>}
          </div>
          <div className="library-item-label"><button className="icon-button library-reorder" draggable aria-label={`Reorder ${comp.name}`} title="Drag to reorder; use Up/Down arrows when focused"
              onDragStart={e => { e.dataTransfer.setData('text/plain', comp.id); e.dataTransfer.effectAllowed = 'move'; setLibraryDrag(comp.id); }}
              onDragEnd={() => { setLibraryDrag(undefined); setLibraryDrop(undefined); }}
              onKeyDown={e => {
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                e.preventDefault();
                const target = visible[index + (e.key === 'ArrowUp' ? -1 : 1)];
                if (target) void dispatch({ type: 'reorderComponent', id: comp.id, targetId: target.id, position: e.key === 'ArrowUp' ? 'before' : 'after' });
              }}><GripVertical size={14} /></button>
            <button className="library-item-name" aria-label={`Edit ${comp.name}`} title="Click to edit in the designer" onClick={() => edit(comp.id)}>
              <strong>{comp.name}<PencilLine size={10} aria-hidden="true" /></strong><small>{`${comp.width} × ${comp.height} px`}</small>
              <span className="library-name-hint" aria-hidden="true"><PencilLine size={9} /> Click to edit in the designer</span></button>
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
          {!visible.length && <div className="empty-note">{search || filter !== 'all' ? 'No components match your search.' : 'Your first component is one click away.'}<button className="text-button" onClick={() => setModal('templates')}>Create a component <Plus size={13} /></button></div>}
        </div>
      </aside>
      {libraryVisible && <PanelSeparator label="Resize component library" controls="component-library-panel" value={panels.sizes.library} {...panels.limits.library} onResize={value => panels.resize('library', value)} />}
      <div className="workspace-content">{!home && (mode === 'playground' ? <Playground project={project} actor={actor} owner={session?.identity ?? 'local'} host={!!session?.host && session.host === session.identity} viewer={viewer} onWatch={session ? watch : undefined} onNewSeat={session ? newSeat : undefined} selected={selected} setSelected={setSelected} inspectorVisible={inspectorVisible} layersVisible={layersVisible} defaultSeat={{ name: settings.name.trim(), color: settings.color }} handVisible={handVisible} onShowInspector={() => setInspectorVisible(true)} dispatch={dispatch} onSpawn={spawn} onEdit={edit} onSwitch={switchPlayer} notify={notify} panel={playgroundTab} setPanel={setPlaygroundTab} panels={panels} notice={undoToast} onDismissNotice={() => setUndoToast(undefined)} /> :
        activeComponent?.source ? <LinkedComponent key={activeComponent.id} component={activeComponent} components={project.components}
          available={archive.projects.some(p => p.id === activeComponent.source?.projectId && p.components.some(c => c.id === activeComponent.source?.componentId))}
          onCopy={() => void copyLinked(activeComponent)} onRemove={() => setRemoveLink(activeComponent)} /> :
        activeComponent ? <Designer key={activeComponent.id} component={activeComponent} components={project.components} tab={designerTab} setTab={setDesignerTab} panels={panels} layersVisible={layersVisible} onChange={(component, removedDataRow) => dispatch({ type: 'component', component, removedDataRow })} onDelete={async () => {
          if (await dispatch({ type: 'removeComponent', id: activeComponent.id })) { setComponentId(undefined); setSelected([]); }
        }} notify={notify} /> : <div className="no-component"><Palette size={40} /><h2>A blank page is a beautiful thing.</h2><button className="button primary" onClick={() => setModal('templates')}>Create your first component</button></div>)}</div>
    </main>
    <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
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
        ['artwork', 'Artwork', 'Reusable vector art for nested components.'],
      ] as const).map(([kind, title, description]) => <button key={kind} className={`template-card template-${kind}`} onClick={() => addTemplate(kind)}><div className="template-art">{kind === 'artwork' ? <Palette size={48} /> : <ComponentThumbnail component={templatePreviews[kind].root} components={templatePreviews[kind].components} width={kind === 'board' ? 140 : kind === 'card' ? 78 : 64} />}</div><strong>{title}<ArrowRight size={15} /></strong><small>{description}</small></button>)}</div>
      <button className="blank-template" onClick={() => addTemplate('blank')}><FilePlus2 size={24} /><span><strong>Start from scratch</strong><small>A blank component for a brand new idea.</small></span><ArrowRight size={17} /></button>
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
    {modal === 'save' && <Modal title="Keep this moment." subtitle="Save a named playground snapshot, including designs, hands and seats." onClose={() => setModal(undefined)}>
      <div className="save-dialog"><Field label="Snapshot name"><input value={saveName} maxLength={100} onChange={e => setSaveName(e.target.value)} /></Field>
        <Notice message={snapshotError ?? ''} className="inline-error"><button className="button" onClick={() => {
          download('tablecraft-snapshots-recovery.json', localStorage.getItem('tablecraft.snapshots') ?? '');
          setSnapshotStore({ projects: [], error: null });
        }}>Download recovery & reset snapshots</button></Notice>
        <div className="button-row"><button className="button primary" disabled={!!snapshotError || snapshots.length >= 100} onClick={() => {
          try {
            const snapshot = { ...structuredClone(project), id: uid('snapshot'), name: saveName.trim() || project.name };
            const next = [...snapshots, snapshot];
            localStorage.setItem('tablecraft.snapshots', JSON.stringify({ format: 'tablecraft', version: 1, projects: next }));
            setSnapshotStore({ projects: next, error: null }); notify('Playground snapshot saved.');
          } catch (error) { notify(`Save failed: ${String(error)}`, true); }
        }}><Save size={15} /> Save snapshot</button><button className="button" onClick={() => exportProject(project)}><Download size={15} /> Export JSON</button></div>
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
      <div className="keyboard-shortcuts"><span><kbd>F</kbd> Flip</span><span><kbd>R</kbd> Rotate</span><span><kbd>S</kbd> Shuffle / roll</span><span><kbd>G</kbd> Stack</span><span><kbd>Ctrl C/V</kbd> Copy / paste</span><span><kbd>Ctrl D</kbd> Clone</span><span><kbd>L</kbd> Lock</span><span><kbd>Del</kbd> Delete</span><span><kbd>Scroll</kbd> Zoom</span><span><kbd>Middle drag</kbd> Pan</span></div>
      <div className="help-footer"><Leaf size={18} /><p>Your work stays in this browser. Export JSON to back it up or move it to another device. External textures and Google Fonts need internet access.</p></div>
    </Modal>}
    {curtain && <div className="privacy-curtain"><span className="brand-mark"><Layers size={32} /></span><p>PASS THE SCREEN TO</p><h1>{curtain.name}</h1><span className="curtain-avatar" style={{ background: curtain.color }}>{curtain.name[0]}</span><p className="curtain-description">A little privacy for your next big move.</p><button className="button primary" onClick={() => { setActor(curtain.id); setCurtain(undefined); }}>I'm {curtain.name}. Let's play. <ArrowRight size={17} /></button><button className="text-button" onClick={() => setCurtain(undefined)}>Back to the current player</button></div>}
  </div>;
}
function CopyIcon() { return <Square size={14} />; }
