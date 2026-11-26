import { useState } from 'react';
import { Download, FolderPlus, GripVertical, History as HistoryIcon, LayoutGrid, LayoutList, Link2, Pencil, Play, Plus, Search, Trash2, Upload, Users, X } from 'lucide-react';
import { ComponentThumbnail } from './ComponentView';
import { type Project } from './domain';
import { GAME_PROJECTS, type GameProjectId } from './gameProjects';
import type { History } from './projectHistory';
import './newProject.css';
import './home.css';
import { Field, Modal } from './ui';

/** Where this browser remembers whether Home lists projects or shows them as a grid of tiles. */
const HOME_VIEW_KEY = 'tablecraft.home-view';
type HomeView = 'list' | 'grid';
function storedView(): HomeView {
  try { return localStorage.getItem(HOME_VIEW_KEY) === 'grid' ? 'grid' : 'list'; } catch { return 'list'; }
}
/** Whether a project matches a search: its name, description or one of its components' names contains the words. */
export function projectMatches(project: Pick<Project, 'name' | 'description' | 'components'>, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = [project.name, project.description, ...project.components.map(component => component.name)].join('\n').toLowerCase();
  return words.every(word => text.includes(word));
}

/**
 * The workshop: the loaded project (continue or close it) apart from the projects that can be loaded. Loading another
 * project closes the loaded one. A search box narrows the projects, and they show as a list or a grid of tiles.
 */
export function Home({ projects, open, histories, onLoad, onContinue, onCloseProject, onHistory, onDelete, onReorder, onCreate, onUpdate, onImport, onExport, onExportAll, onJoin }: {
  projects: Project[]; open?: { id: string; context: string; dirty: boolean }; histories: Record<string, History>;
  onLoad: (id: string) => void; onContinue: () => void; onCloseProject: () => void; onHistory: (id: string) => void; onDelete: (id: string) => void;
  onReorder: (id: string, targetId: string, after: boolean) => void; onCreate: (name: string, description: string, game?: GameProjectId) => void;
  onUpdate: (id: string, patch: Pick<Project, 'name' | 'description'>) => void;
  onImport: () => void; onExport: (project: Project) => void; onExportAll: () => void; onJoin: () => void;
}) {
  const [dragged, setDragged] = useState<string>();
  const [drop, setDrop] = useState<{ id: string; after: boolean }>();
  const [deleting, setDeleting] = useState<Project>();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  // New projects start blank or from a ready-to-play game; picking a game fills in its name and description until edited.
  const [start, setStart] = useState<GameProjectId | ''>('');
  const [touched, setTouched] = useState({ name: false, description: false });
  const blankName = `Untitled project ${projects.length + 1}`;
  const choose = (id: GameProjectId | '') => {
    const game = GAME_PROJECTS.find(item => item.id === id);
    setStart(id);
    if (!touched.name) setName(game?.name ?? blankName);
    if (!touched.description) setDescription(game?.description ?? '');
  };
  const [editing, setEditing] = useState<Project>();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<HomeView>(storedView);
  const chooseView = (next: HomeView) => { setView(next); try { localStorage.setItem(HOME_VIEW_KEY, next); } catch { /* the choice just isn't remembered */ } };
  const searching = !!query.trim();
  const loaded = open && projects.find(project => project.id === open.id);
  const others = projects.filter(project => project !== loaded);
  const shownLoaded = loaded && projectMatches(loaded, query) ? loaded : undefined;
  const shownOthers = others.filter(project => projectMatches(project, query));
  const grid = view === 'grid';
  const status = (id: string) => {
    const history = histories[id];
    const snapshots = history?.snapshots.length ?? 0, sessions = history?.sessions.length ?? 0;
    return <><span className={`history-badge${history?.status === 'finished' ? ' base' : ''}`}>{history?.status === 'finished' ? 'Finished' : 'Draft'}</span>
      <small>{snapshots} snapshot{snapshots === 1 ? '' : 's'}{sessions ? ` · ${sessions} session${sessions === 1 ? '' : 's'}` : ''}</small></>;
  };
  const heading = <div className="home-heading"><div><p>YOUR WORKSHOP</p><h1>Projects</h1><p>Design, collect, and play.</p></div>
      <div className="home-actions"><button className="button" onClick={onImport}><Upload size={16} /> Import projects</button>
        <button className="button" onClick={onExportAll} disabled={!projects.length}><Download size={16} /> Export all projects</button>
        <button className="button" onClick={onJoin}><Users size={16} /> Join a table</button>
        <button className="button primary" onClick={() => { setName(blankName); setDescription(''); setStart(''); setTouched({ name: false, description: false }); setCreating(true); }}><Plus size={16} /> New project</button></div>
    </div>;
  const card = (project: Project, index: number) => {
    const isOpen = project === loaded;
    return <article key={project.id}
      className={`home-project${isOpen ? ' home-project-open' : ''}${drop?.id === project.id ? drop.after ? ' library-drop-after' : ' library-drop-before' : ''}`}
      onDragOver={event => {
        if (!dragged || dragged === project.id || isOpen) return;
        event.preventDefault();
        // Tiles in a grid drop beside each other, list rows above or below.
        const rect = event.currentTarget.getBoundingClientRect();
        setDrop({ id: project.id, after: grid ? event.clientX > rect.left + rect.width / 2 : event.clientY > rect.top + rect.height / 2 });
      }} onDragLeave={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDrop(undefined);
      }} onDrop={event => {
        event.preventDefault();
        if (dragged && drop?.id === project.id) onReorder(dragged, project.id, drop.after);
        setDragged(undefined); setDrop(undefined);
      }}>
      <div className="home-project-heading">
        {grid && <div className="home-project-previews" aria-hidden="true">
          {project.components.filter(component => component.kind !== 'texture' && component.kind !== 'font').slice(0, 4).map(component =>
            <div key={component.id} className="home-component-image"><ComponentThumbnail component={component} components={project.components} width={56} /></div>)}
        </div>}
        {/* The order is the whole list's, so it can't be changed while a search hides some projects. */}
        {!isOpen && !searching && <button className="icon-button home-project-grip" aria-label={`Reorder project ${project.name}`} title={grid ? 'Drag to reorder; arrow keys when focused' : 'Drag to reorder; Up/Down when focused'} draggable
          onDragStart={event => { event.dataTransfer.setData('text/plain', project.id); event.dataTransfer.effectAllowed = 'move'; setDragged(project.id); }}
          onDragEnd={() => { setDragged(undefined); setDrop(undefined); }}
          onKeyDown={event => {
            const back = event.key === 'ArrowUp' || (grid && event.key === 'ArrowLeft'), forward = event.key === 'ArrowDown' || (grid && event.key === 'ArrowRight');
            if (!back && !forward) return;
            event.preventDefault();
            const target = others[index + (back ? -1 : 1)];
            if (target) onReorder(project.id, target.id, forward);
          }}><GripVertical size={18} /></button>}
        <div><h2>{project.name}</h2>{project.description && <p className="home-project-description">{project.description}</p>}
          <p className="home-project-status">{status(project.id)}{isOpen && open!.context !== 'Draft' && <span className="history-badge loaded">{open!.context}</span>}{isOpen && open!.dirty && <span className="home-unsaved">Unsaved changes</span>}</p>
          <p>{project.components.length} components · {project.instances.length} pieces · {project.players.length} players</p></div>
        <div className="home-project-actions">{isOpen
          ? <><button className="button primary" aria-label={`Continue project ${project.name}`} onClick={onContinue}><Play size={15} /> Continue</button>
            <button className="button" aria-label={`Close project ${project.name}`} title={open!.dirty ? 'Close it (asks to save the unsaved changes first)' : 'Close it'} onClick={onCloseProject}><X size={15} /> Close</button></>
          : <button className="button primary" aria-label={`Load project ${project.name}`} title={loaded ? `Load it (closes ${loaded.name})` : undefined} onClick={() => onLoad(project.id)}>Load</button>}
          <button className="icon-button" aria-label={`Snapshots and sessions of ${project.name}`} title="Snapshots and sessions" onClick={() => onHistory(project.id)}><HistoryIcon size={17} /></button>
          <button className="icon-button" aria-label={`Edit project ${project.name}`} title="Edit name and description" onClick={() => { setName(project.name); setDescription(project.description); setEditing(project); }}><Pencil size={16} /></button>
          <button className="icon-button" aria-label={`Export project ${project.name}`} title="Export…" onClick={() => onExport(project)}><Download size={17} /></button>
          {!isOpen && <button className="icon-button" aria-label={`Delete project ${project.name}`} onClick={() => setDeleting(project)}><Trash2 size={17} /></button>}</div>
      </div>
      {!grid && <details><summary>Components ({project.components.length})</summary><ul className="home-components">
        {project.components.map(component => <li key={component.id}><div className="home-component-image"><ComponentThumbnail component={component} components={project.components} width={44} /></div>
          <span><strong>{component.name}</strong><small>{component.kind} · {Math.max(1, component.rows.length)} variants {component.source && <><Link2 size={11} /> Read-only link</>}</small></span></li>)}
      </ul>{!project.components.length && <p>No components yet.</p>}</details>}
    </article>;
  };
  const listClass = `home-projects${grid ? ' home-grid' : ''}`;
  return <section className="home-screen" aria-label="Project home">
    {heading}
    {projects.length > 0 && <div className="home-toolbar">
      <label className="home-search"><Search size={15} aria-hidden="true" />
        <input type="search" aria-label="Search projects" placeholder="Search projects by name, description or component" value={query}
          onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); setQuery(''); } }} />
        {query && <button type="button" className="icon-button" aria-label="Clear search" title="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}
      </label>
      <span className="library-views home-views" role="radiogroup" aria-label="Project view">{([['list', 'List view', LayoutList], ['grid', 'Grid view', LayoutGrid]] as const).map(([value, label, Icon]) =>
        <button key={value} type="button" role="radio" aria-checked={view === value} aria-label={label} title={label} className={view === value ? 'active' : ''} onClick={() => chooseView(value)}><Icon size={16} /></button>)}</span>
    </div>}
    {shownLoaded && <section className="home-open" aria-label="Open project"><h2 className="home-section-title">Open project</h2><div className={listClass}>{card(shownLoaded, -1)}</div></section>}
    {shownLoaded && (shownOthers.length > 0 || !searching) && <h2 className="home-section-title">Other projects</h2>}
    {!projects.length && <p className="empty-note">No projects yet. Create a project or import a Tablecraft export.</p>}
    {searching && !shownLoaded && !shownOthers.length && <p className="empty-note">No projects match “{query.trim()}”.</p>}
    {loaded && !others.length && !searching && <p className="empty-note">No other projects. Create a project or import a Tablecraft export.</p>}
    <div className={listClass} aria-label={searching ? 'Matching projects' : undefined}>{shownOthers.map((project, index) => card(project, index))}</div>
    {deleting && <Modal title={`Delete ${deleting.name}?`} subtitle="This removes the project from this browser. Export it first to keep a backup. Other projects keep their last linked snapshots." onClose={() => setDeleting(undefined)}>
      <div className="modal-actions"><button className="button" onClick={() => setDeleting(undefined)}>Cancel</button><button className="button danger" onClick={() => { onDelete(deleting.id); setDeleting(undefined); }}>Delete project</button></div>
    </Modal>}
    {creating && <Modal title="New project" subtitle="Give your next game a place to grow." onClose={() => setCreating(false)}><form className="new-project-form" onSubmit={event => {
      event.preventDefault(); onCreate(name.trim(), description.trim(), start || undefined); setCreating(false);
    }}>
      <div className="new-project-intro"><span className="new-project-icon"><FolderPlus size={25} /></span><div><h3>One idea. Endless possibilities.</h3><p>Keep your components, table and playtests together.</p></div></div>
      <Field label="Project name"><input autoFocus required pattern={'.*\\S.*'} maxLength={100} value={name} onFocus={event => event.currentTarget.select()} onChange={event => { setName(event.target.value); setTouched(value => ({ ...value, name: true })); }} /></Field>
      <DescriptionField value={description} onChange={value => { setDescription(value); setTouched(current => ({ ...current, description: true })); }} />
      <fieldset className="new-project-start"><legend>Start from</legend>
        {[{ id: '' as const, name: 'Blank project', summary: 'An empty table for a brand new idea' }, ...GAME_PROJECTS].map(option =>
          <label key={option.id || 'blank'} className={`new-project-option${start === option.id ? ' active' : ''}`}>
            <input type="radio" name="new-project-start" value={option.id} checked={start === option.id} onChange={() => choose(option.id)} />
            <span><strong>{option.name}</strong><small>{option.summary}</small></span>
          </label>)}
      </fieldset>
      <p className="new-project-hint">You can change the name and description later.</p>
      <div className="modal-actions"><button className="button" type="button" onClick={() => setCreating(false)}>Cancel</button><button className="button primary" type="submit"><Plus size={16} /> Create project</button></div></form></Modal>}
    {editing && <Modal title={`Edit ${editing.name}`} subtitle="Rename the project or describe what it is about." onClose={() => setEditing(undefined)}><form className="new-project-form" onSubmit={event => {
      event.preventDefault(); onUpdate(editing.id, { name: name.trim(), description: description.trim() }); setEditing(undefined);
    }}>
      <Field label="Project name"><input autoFocus required pattern={'.*\\S.*'} maxLength={100} value={name} onChange={event => setName(event.target.value)} /></Field>
      <DescriptionField value={description} onChange={setDescription} />
      <div className="modal-actions"><button className="button" type="button" onClick={() => setEditing(undefined)}>Cancel</button><button className="button primary" type="submit">Save changes</button></div></form></Modal>}
  </section>;
}

function DescriptionField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Field label="Description"><textarea className="project-description-input" maxLength={1000} rows={3} placeholder="Optional: what is this game about?" value={value} onChange={event => onChange(event.target.value)} /></Field>;
}
