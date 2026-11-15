import { archiveSchema, componentSchema, uid, validateProject, type Archive, type Component, type Project } from './domain';
import { starterProject } from './templates';

const KEY = 'tablecraft.workspace.v1';
export function loadWorkspace(): Archive {
  const raw = localStorage.getItem(KEY);
  if (!raw) return { format: 'tablecraft', version: 1, projects: [starterProject()] };
  return parseArchive(raw);
}
export function parseArchive(raw: string): Archive {
  const archive = archiveSchema.parse(JSON.parse(raw));
  archive.projects.forEach(validateProject);
  return archive;
}
export function saveWorkspace(archive: Archive) {
  localStorage.setItem(KEY, JSON.stringify(archive));
}
export function download(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportProject(project: Project) {
  download(`${project.name}.tablecraft.json`, JSON.stringify({ format: 'tablecraft', version: 1, projects: [project] }, null, 2));
}
export type ComponentBundle = { rootId: string; components: Component[] };
export function remapComponentBundle(bundle: ComponentBundle, createId: (component: Component) => string = () => uid('component')): ComponentBundle {
  const ids = new Map(bundle.components.map(component => [component.id, createId(component)]));
  const rootId = ids.get(bundle.rootId);
  if (!rootId) throw new Error('The component bundle root is missing.');
  return {
    rootId,
    components: bundle.components.map(component => ({
      ...component, id: ids.get(component.id)!,
      front: component.front.map(node => node.type === 'component'
        ? { ...node, componentId: node.componentId ? ids.get(node.componentId) ?? node.componentId : undefined } : node),
      back: component.back.map(node => node.type === 'component'
        ? { ...node, componentId: node.componentId ? ids.get(node.componentId) ?? node.componentId : undefined } : node),
    })),
  };
}
function linkedIds(component: Component) {
  return [...component.front, ...component.back].flatMap(node => node.type === 'component' && node.componentId ? [node.componentId] : []);
}
export function exportComponentBundle(component: Component, catalog: Component[]): { format: 'tablecraft-component'; version: 1 } & ComponentBundle {
  const byId = new Map(catalog.map(item => [item.id, item]));
  const visiting = new Set<string>(), visited = new Set<string>(), ordered: Component[] = [];
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('Nested component references contain a cycle.');
    if (visited.has(id)) return;
    const item = byId.get(id);
    if (!item) throw new Error(`Nested component ${id} is missing from this project.`);
    visiting.add(id);
    linkedIds(item).forEach(visit);
    visiting.delete(id); visited.add(id); ordered.push(item);
  };
  visit(component.id);
  return { format: 'tablecraft-component', version: 1, rootId: component.id, components: ordered };
}
export function parseComponentBundle(raw: string): ComponentBundle {
  const value: unknown = JSON.parse(raw);
  if (typeof value === 'object' && value !== null && 'format' in value && value.format === 'tablecraft-component') {
    const bundle = value as { version?: unknown; rootId?: unknown; components?: unknown };
    if (bundle.version !== 1 || typeof bundle.rootId !== 'string') throw new Error('Unsupported component bundle format.');
    const components = componentSchema.array().max(500).parse(bundle.components);
    validateProject({
      id: 'check', name: 'check', description: '', components, instances: [], players: [],
      settings: { grid: true, snap: false, gridSize: 25, hands: true, turns: false, turn: 0 },
    });
    if (!components.some(item => item.id === bundle.rootId)) throw new Error('The component bundle root is missing.');
    const byId = new Map(components.map(item => [item.id, item]));
    const ordered: Component[] = [], visited = new Set<string>();
    const visit = (id: string) => {
      if (visited.has(id)) return;
      const item = byId.get(id);
      if (!item) throw new Error(`Nested component ${id} is missing from this bundle.`);
      linkedIds(item).forEach(visit);
      visited.add(id); ordered.push(item);
    };
    visit(bundle.rootId);
    return { rootId: bundle.rootId, components: ordered };
  }
  const component = componentSchema.parse(value);
  validateProject({
    id: 'check', name: 'check', description: '', components: [component], instances: [], players: [],
    settings: { grid: true, snap: false, gridSize: 25, hands: true, turns: false, turn: 0 },
  });
  return { rootId: component.id, components: [component] };
}
export function parseComponent(raw: string): Component {
  const component = componentSchema.parse(JSON.parse(raw));
  validateProject({
    id: 'check', name: 'check', description: '', components: [component], instances: [], players: [],
    settings: { grid: true, snap: false, gridSize: 25, hands: true, turns: false, turn: 0 },
  });
  return component;
}
