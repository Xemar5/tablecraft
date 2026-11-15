import { archiveSchema, componentSchema, validateProject, type Archive, type Component, type Project } from './domain';
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
export function parseComponent(raw: string): Component {
  const component = componentSchema.parse(JSON.parse(raw));
  validateProject({
    id: 'check', name: 'check', description: '', components: [component], instances: [], players: [],
    settings: { grid: true, snap: false, gridSize: 25, hands: true, turns: false, turn: 0 },
  });
  return component;
}
