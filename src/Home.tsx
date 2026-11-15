import { useState } from 'react';
import { Download, GripVertical, Link2, Plus, Trash2, Upload } from 'lucide-react';
import { ComponentThumbnail } from './ComponentView';
import { type Project } from './domain';
import { Field, Modal } from './ui';

export function Home({ projects, onLoad, onDelete, onReorder, onCreate, onImport, onExport, onExportAll }: {
  projects: Project[]; onLoad: (id: string) => void; onDelete: (id: string) => void;
  onReorder: (id: string, targetId: string, after: boolean) => void; onCreate: (name: string) => void;
  onImport: () => void; onExport: (project: Project) => void; onExportAll: () => void;
}) {
  const [dragged, setDragged] = useState<string>();
  const [drop, setDrop] = useState<{ id: string; after: boolean }>();
  const [deleting, setDeleting] = useState<Project>();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  return <section className="home-screen" aria-label="Project home">
    <div className="home-heading"><div><p>YOUR WORKSHOP</p><h1>Projects</h1><p>Design, collect, and play.</p></div>
      <div className="button-row"><button className="button" onClick={onImport}><Upload size={16} /> Import projects</button>
        <button className="button" onClick={onExportAll} disabled={!projects.length}><Download size={16} /> Export all projects</button>
        <button className="button primary" onClick={() => { setName(`Untitled project ${projects.length + 1}`); setCreating(true); }}><Plus size={16} /> New project</button></div>
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
        <div><h2>{project.name}</h2><p>{project.components.length} components · {project.instances.length} pieces · {project.players.length} players</p></div>
        <div className="home-project-actions"><button className="button primary" aria-label={`Open project ${project.name}`} onClick={() => onLoad(project.id)}>Open project</button>
          <button className="icon-button" aria-label={`Export project ${project.name}`} onClick={() => onExport(project)}><Download size={17} /></button>
          <button className="icon-button" aria-label={`Delete project ${project.name}`} onClick={() => setDeleting(project)}><Trash2 size={17} /></button></div>
      </div>
      {project.description && <p>{project.description}</p>}
      <details><summary>Components ({project.components.length})</summary><ul className="home-components">
        {project.components.map(component => <li key={component.id}><div className="home-component-image"><ComponentThumbnail component={component} components={project.components} width={44} /></div>
          <span><strong>{component.name}</strong><small>{component.kind} · {Math.max(1, component.rows.length)} variants {component.source && <><Link2 size={11} /> Read-only link</>}</small></span></li>)}
      </ul>{!project.components.length && <p>No components yet.</p>}</details>
    </article>)}</div>
    {deleting && <Modal title={`Delete ${deleting.name}?`} subtitle="This removes the project from this browser. Export it first to keep a backup. Other projects keep their last linked snapshots." onClose={() => setDeleting(undefined)}>
      <div className="modal-actions"><button className="button" onClick={() => setDeleting(undefined)}>Cancel</button><button className="button danger" onClick={() => { onDelete(deleting.id); setDeleting(undefined); }}>Delete project</button></div>
    </Modal>}
    {creating && <Modal title="New project" onClose={() => setCreating(false)}><form onSubmit={event => {
      event.preventDefault(); onCreate(name.trim()); setCreating(false);
    }}><Field label="Project name"><input required pattern={'.*\\S.*'} maxLength={100} value={name} onChange={event => setName(event.target.value)} /></Field>
      <div className="modal-actions"><button className="button primary" type="submit">Create project</button></div></form></Modal>}
  </section>;
}
