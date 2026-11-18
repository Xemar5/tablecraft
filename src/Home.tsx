import { useState } from 'react';
import { Download, FolderPlus, GripVertical, Link2, Pencil, Plus, Trash2, Upload, Users } from 'lucide-react';
import { ComponentThumbnail } from './ComponentView';
import { type Project } from './domain';
import { GAME_PROJECTS, type GameProjectId } from './gameProjects';
import './newProject.css';
import { Field, Modal } from './ui';

export function Home({ projects, onLoad, onDelete, onReorder, onCreate, onUpdate, onImport, onExport, onExportAll, onJoin }: {
  projects: Project[]; onLoad: (id: string) => void; onDelete: (id: string) => void;
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
  return <section className="home-screen" aria-label="Project home">
    <div className="home-heading"><div><p>YOUR WORKSHOP</p><h1>Projects</h1><p>Design, collect, and play.</p></div>
      <div className="home-actions"><button className="button" onClick={onImport}><Upload size={16} /> Import projects</button>
        <button className="button" onClick={onExportAll} disabled={!projects.length}><Download size={16} /> Export all projects</button>
        <button className="button" onClick={onJoin}><Users size={16} /> Join a table</button>
        <button className="button primary" onClick={() => { setName(blankName); setDescription(''); setStart(''); setTouched({ name: false, description: false }); setCreating(true); }}><Plus size={16} /> New project</button></div>
    </div>
    {!projects.length && <p className="empty-note">No projects yet. Create a project or import a Tablecraft export.</p>}
    <div className="home-projects">{projects.map((project, index) => <article key={project.id}
      className={`home-project${drop?.id === project.id ? drop.after ? ' library-drop-after' : ' library-drop-before' : ''}`}
      onDragOver={event => {
        if (!dragged || dragged === project.id) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        setDrop({ id: project.id, after: event.clientY > rect.top + rect.height / 2 });
      }} onDragLeave={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDrop(undefined);
      }} onDrop={event => {
        event.preventDefault();
        if (dragged && drop?.id === project.id) onReorder(dragged, project.id, drop.after);
        setDragged(undefined); setDrop(undefined);
      }}>
      <div className="home-project-heading">
        <button className="icon-button" aria-label={`Reorder project ${project.name}`} title="Drag to reorder; Up/Down when focused" draggable
          onDragStart={event => { event.dataTransfer.setData('text/plain', project.id); event.dataTransfer.effectAllowed = 'move'; setDragged(project.id); }}
          onDragEnd={() => { setDragged(undefined); setDrop(undefined); }}
          onKeyDown={event => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            const target = projects[index + (event.key === 'ArrowUp' ? -1 : 1)];
            if (target) onReorder(project.id, target.id, event.key === 'ArrowDown');
          }}><GripVertical size={18} /></button>
        <div><h2>{project.name}</h2>{project.description && <p className="home-project-description">{project.description}</p>}<p>{project.components.length} components · {project.instances.length} pieces · {project.players.length} players</p></div>
        <div className="home-project-actions"><button className="button primary" aria-label={`Open project ${project.name}`} onClick={() => onLoad(project.id)}>Open project</button>
          <button className="icon-button" aria-label={`Edit project ${project.name}`} title="Edit name and description" onClick={() => { setName(project.name); setDescription(project.description); setEditing(project); }}><Pencil size={16} /></button>
          <button className="icon-button" aria-label={`Export project ${project.name}`} onClick={() => onExport(project)}><Download size={17} /></button>
          <button className="icon-button" aria-label={`Delete project ${project.name}`} onClick={() => setDeleting(project)}><Trash2 size={17} /></button></div>
      </div>
      <details><summary>Components ({project.components.length})</summary><ul className="home-components">
        {project.components.map(component => <li key={component.id}><div className="home-component-image"><ComponentThumbnail component={component} components={project.components} width={44} /></div>
          <span><strong>{component.name}</strong><small>{component.kind} · {Math.max(1, component.rows.length)} variants {component.source && <><Link2 size={11} /> Read-only link</>}</small></span></li>)}
      </ul>{!project.components.length && <p>No components yet.</p>}</details>
    </article>)}</div>
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
