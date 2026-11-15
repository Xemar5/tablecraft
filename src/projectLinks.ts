import { applyCommand, componentSchema, uid, validateProject, type Archive, type Component, type Project } from './domain';
import { exportComponentBundle, remapComponentBundle } from './storage';

export function linkComponent(target: Project, source: Project, componentId: string, rootId?: string): { project: Project; rootId: string } {
  if (target.id === source.id) throw new Error('Choose a component from another project.');
  const component = source.components.find(item => item.id === componentId);
  if (!component) throw new Error('The source component no longer exists.');
  const bundle = exportComponentBundle(component, source.components);
  const mapped = remapComponentBundle(bundle, item => item.id === componentId && rootId ? rootId : target.components.find(c =>
    c.source?.projectId === source.id && c.source.componentId === item.id)?.id ?? uid('component'));
  const components = mapped.components.map((c, index) => {
    const original = bundle.components[index];
    return componentSchema.parse({ ...c, source: { projectId: source.id, componentId: original.id, projectName: source.name } });
  });
  const changed = components.filter(c => JSON.stringify(target.components.find(existing => existing.id === c.id)) !== JSON.stringify(c));
  return { rootId: mapped.rootId, project: changed.length ? applyCommand(target, { type: 'syncLinkedComponents', components: changed }) : target };
}

export function localComponentCopy(project: Project, id: string): { components: Component[]; rootId: string } {
  const component = project.components.find(c => c.id === id);
  if (!component) throw new Error('Component no longer exists.');
  const bundle = remapComponentBundle(exportComponentBundle(component, project.components));
  return { ...bundle, components: bundle.components.map(({ source: _source, ...item }) => ({
    ...item, name: item.id === bundle.rootId ? `${item.name.slice(0, 93)} (copy)` : item.name,
  })) };
}

/** Source projects are local; each destination retains a portable, validated snapshot. */
export function refreshProjectLinks(archive: Archive): Archive {
  const projects = new Map(archive.projects.map(project => [project.id, project]));
  if (projects.size !== archive.projects.length) throw new Error('Project identifiers must be unique.');
  const visiting = new Set<string>(), resolved = new Set<string>();
  const resolve = (id: string): Project => {
    const original = projects.get(id)!;
    if (resolved.has(id)) return original;
    if (visiting.has(id)) throw new Error('Cross-project component links contain a cycle.');
    visiting.add(id);
    let project = original;
    // Include new nested dependencies introduced by source edits.
    for (const linked of original.components.filter(c => c.source)) {
      const reference = linked.source!;
      if (!projects.has(reference.projectId)) continue;
      const source = resolve(reference.projectId);
      if (!source.components.some(c => c.id === reference.componentId)) continue;
      const added = linkComponent(project, source, reference.componentId, linked.id).project;
      project = added;
    }
    validateProject(project);
    projects.set(id, project); visiting.delete(id); resolved.add(id);
    return project;
  };
  const next = archive.projects.map(project => resolve(project.id));
  return next.every((project, index) => project === archive.projects[index]) ? archive : { ...archive, projects: next };
}
