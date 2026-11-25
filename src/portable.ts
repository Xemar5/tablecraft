import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';
import { archiveSchema, assetSchema, componentSchema, memorySchema, projectSchema, scriptSchema, type Archive, type Component, type Project } from './domain';
import { assetMime, base64ToBytes, bytesToBase64 } from './assets';
import { exportComponentBundle, parseArchive, parseComponentBundle, type ComponentBundle } from './storage';
import { historySchema, restoreSnapshot, sessionSchema, snapshotSchema, type History } from './projectHistory';

const portableAsset = assetSchema.omit({ data: true }).extend({ path: z.string().regex(/^assets\/[a-zA-Z0-9_-]+\.[a-z0-9]+$/) });
const portableComponent = componentSchema.extend({ asset: portableAsset.optional() });
// Scripts are saved as .lua files and memory as a JSON file next to the assets, so they can be read and edited outside
// Tablecraft. Saves from before keep them inline in project.json, which still loads.
const SCRIPT_PATH = /^scripts\/[a-zA-Z0-9_-]+\.lua$/, MEMORY_PATH = /^([a-z0-9]+-)*memory\.json$/;
const portableScript = scriptSchema.omit({ source: true }).extend({ path: z.string().regex(SCRIPT_PATH) });
const portableProject = projectSchema.extend({
  components: portableComponent.array().max(500),
  scripts: z.union([scriptSchema, portableScript]).array().max(50).optional(),
  memoryPath: z.string().regex(MEMORY_PATH).optional(),
});
// Project histories (snapshots and sessions, see projectHistory.ts) travel beside the projects, keyed by project id. Their
// snapshots pack assets, scripts and memory like projects do, sharing asset files with identical contents.
const portableSnapshot = snapshotSchema.extend({ project: portableProject });
const portableHistory = z.object({
  status: z.enum(['draft', 'finished']), baseId: z.string().optional(), snapshots: portableSnapshot.array().max(100),
  sessions: sessionSchema.extend({ snapshots: portableSnapshot.array().min(1).max(100) }).array().max(50),
});
const portableArchive = archiveSchema.extend({ projects: portableProject.array().max(100), histories: z.record(z.string(), portableHistory).optional() });
const portableBundle = z.object({
  format: z.literal('tablecraft-component'), version: z.literal(1), rootId: z.string().min(1),
  components: portableComponent.array().max(500),
});
const manifestSchema = z.union([portableArchive, portableBundle]);
const MAX_ZIP_BYTES = 60 * 1024 * 1024, MAX_EXPANDED_BYTES = 80 * 1024 * 1024;
type PortableContent = Archive | ReturnType<typeof exportComponentBundle>;
export type Histories = Record<string, History>;

export function createPortableZip(content: PortableContent, histories?: Histories): Uint8Array {
  // Validate the same boundary as an imported save before writing it.
  if (content.format === 'tablecraft') parseArchive(JSON.stringify(content));
  else parseComponentBundle(JSON.stringify(content));
  if (histories) for (const [projectId, history] of Object.entries(histories)) {
    const head = content.format === 'tablecraft' && content.projects.find(project => project.id === projectId);
    if (!head) throw new Error('A project history must belong to an exported project.');
    historySchema.parse(history);
    for (const snapshot of [...history.snapshots, ...history.sessions.flatMap(session => session.snapshots)]) restoreSnapshot(snapshot, head);
  }
  const files: Record<string, Uint8Array> = {};
  let index = 0;
  // Snapshots repeat their project's assets; each distinct file is stored once.
  const assetPaths = new Map<string, string>();
  const pack = (component: Component) => {
    if (!component.asset) return component;
    const { data, ...asset } = component.asset;
    let path = assetPaths.get(data);
    if (!path) {
      path = `assets/${index++}.${asset.mime.split('/')[1]}`;
      files[path] = base64ToBytes(data);
      assetPaths.set(data, path);
    }
    return { ...component, asset: { ...asset, path } };
  };
  const slug = (name: string) => name.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'script';
  const packScripts = <T extends Pick<Project, 'scripts' | 'memory'>>(project: T, prefix: string) => {
    const { scripts, memory, ...rest } = project;
    const packed: Record<string, unknown> = { ...rest };
    if (scripts?.length) packed.scripts = scripts.map((script, n) => {
      const path = `scripts/${prefix}${n + 1}-${slug(script.name)}.lua`;
      files[path] = strToU8(script.source);
      return { id: script.id, name: script.name, path };
    });
    if (memory) { packed.memoryPath = `${prefix}memory.json`; files[packed.memoryPath as string] = strToU8(JSON.stringify(memory, null, 2)); }
    return packed;
  };
  let snapshots = 0;
  const packSnapshot = <T extends { project: Project }>(snapshot: T) => ({ ...snapshot, project: packScripts({ ...snapshot.project, components: snapshot.project.components.map(pack) }, `s${++snapshots}-`) });
  const packedHistories = histories && Object.keys(histories).length ? Object.fromEntries(Object.entries(histories).map(([projectId, history]) => [projectId, {
    ...history, snapshots: history.snapshots.map(packSnapshot), sessions: history.sessions.map(session => ({ ...session, snapshots: session.snapshots.map(packSnapshot) })),
  }])) : undefined;
  const manifest = content.format === 'tablecraft'
    ? { ...content, projects: content.projects.map((project, n) => packScripts({ ...project, components: project.components.map(pack) }, content.projects.length > 1 ? `${n + 1}-` : '')), ...(packedHistories ? { histories: packedHistories } : {}) }
    : { ...content, components: content.components.map(pack) };
  files['project.json'] = strToU8(JSON.stringify(manifest, null, 2));
  if (Object.keys(files).length > 1500) throw new Error('The ZIP contains too many files. Export projects individually.');
  const expanded = Object.values(files).reduce((sum, file) => sum + file.length, 0);
  if (expanded > MAX_EXPANDED_BYTES) throw new Error('The portable save exceeds the 80 MiB expanded size limit.');
  const zip = zipSync({ ...files, 'project.json': [files['project.json'], { level: 6 }] }, { level: 0 });
  if (zip.length > MAX_ZIP_BYTES) throw new Error('The ZIP save exceeds the 60 MiB size limit. Export projects individually.');
  return zip;
}

export function readPortableZip(bytes: Uint8Array): { kind: 'archive'; archive: Archive; histories: Histories } | { kind: 'component'; bundle: ComponentBundle } {
  if (bytes.length > MAX_ZIP_BYTES) throw new Error('ZIP imports must be at most 60 MiB.');
  if (bytes[0] !== 80 || bytes[1] !== 75) throw new Error('Choose a Tablecraft ZIP save containing project.json. JSON file imports are no longer supported.');
  let expanded = 0, entries = 0;
  const files = unzipSync(bytes, { filter: entry => {
    if (++entries > 1500) throw new Error('The ZIP contains too many files.');
    expanded += entry.originalSize;
    if (expanded > MAX_EXPANDED_BYTES) throw new Error('The ZIP exceeds the 80 MiB expanded size limit.');
    return entry.name === 'project.json' || /^assets\/[a-zA-Z0-9_-]+\.[a-z0-9]+$/.test(entry.name) || SCRIPT_PATH.test(entry.name) || MEMORY_PATH.test(entry.name);
  } });
  if (!files['project.json']) throw new Error('The ZIP must contain project.json at its root.');
  const manifest = manifestSchema.parse(JSON.parse(strFromU8(files['project.json'])));
  const hydrate = (component: z.infer<typeof portableComponent>): Component => {
    if (!component.asset) return componentSchema.parse(component);
    const { path, ...asset } = component.asset;
    const data = files[path];
    if (!data) throw new Error(`Missing imported asset: ${asset.name}.`);
    if (assetMime(data) !== asset.mime) throw new Error(`Asset file type does not match ${asset.name}.`);
    return componentSchema.parse({ ...component, asset: { ...asset, data: bytesToBase64(data) } });
  };
  const text = (path: string, what: string) => {
    const file = files[path];
    if (!file) throw new Error(`Missing ${what}: ${path}.`);
    return strFromU8(file);
  };
  const hydrateScripts = <T extends Pick<z.infer<typeof portableProject>, 'scripts' | 'memoryPath'>>(project: T) => {
    const { memoryPath, scripts, ...rest } = project;
    return {
      ...rest,
      ...(scripts ? { scripts: scripts.map(script => 'path' in script ? { id: script.id, name: script.name, source: text(script.path, `script ${script.name}`) } : script) } : {}),
      ...(memoryPath ? { memory: memorySchema.parse(JSON.parse(text(memoryPath, 'memory'))) } : {}),
    };
  };
  if (manifest.format === 'tablecraft') {
    const { histories: packed, ...rest } = manifest;
    const hydrated = { ...rest, projects: rest.projects.map(project => hydrateScripts({ ...project, components: project.components.map(hydrate) })) };
    const archive = parseArchive(JSON.stringify(hydrated));
    const histories: Histories = {};
    for (const [projectId, history] of Object.entries(packed ?? {})) {
      const head = archive.projects.find(project => project.id === projectId);
      if (!head) throw new Error('A project history in the ZIP belongs to no project in it.');
      // Every snapshot is checked like a saved project, and kept as checked (with legacy artwork upgraded).
      const snapshot = <T extends { project: z.infer<typeof portableProject> }>(item: T) => {
        const project = hydrateScripts({ ...item.project, components: item.project.components.map(hydrate) }) as unknown as Project;
        return { ...item, project: restoreSnapshot({ ...item, project }, project) };
      };
      histories[projectId] = historySchema.parse({ ...history, snapshots: history.snapshots.map(snapshot), sessions: history.sessions.map(session => ({ ...session, snapshots: session.snapshots.map(snapshot) })) });
    }
    return { kind: 'archive', archive, histories };
  }
  return { kind: 'component', bundle: parseComponentBundle(JSON.stringify({ ...manifest, components: manifest.components.map(hydrate) })) };
}
export const projectZip = (project: Project, history?: History) => createPortableZip({ format: 'tablecraft', version: 1, projects: [project] }, history ? { [project.id]: history } : undefined);
export const componentZip = (component: Component, catalog: Component[]) => createPortableZip(exportComponentBundle(component, catalog));

export function downloadZip(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
