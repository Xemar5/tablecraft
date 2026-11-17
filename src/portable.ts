import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';
import { archiveSchema, assetSchema, componentSchema, projectSchema, type Archive, type Component, type Project } from './domain';
import { assetMime, base64ToBytes, bytesToBase64 } from './assets';
import { exportComponentBundle, parseArchive, parseComponentBundle, type ComponentBundle } from './storage';

const portableAsset = assetSchema.omit({ data: true }).extend({ path: z.string().regex(/^assets\/[a-zA-Z0-9_-]+\.[a-z0-9]+$/) });
const portableComponent = componentSchema.extend({ asset: portableAsset.optional() });
const portableProject = projectSchema.extend({ components: portableComponent.array().max(500) });
const portableArchive = archiveSchema.extend({ projects: portableProject.array().max(100) });
const portableBundle = z.object({
  format: z.literal('tablecraft-component'), version: z.literal(1), rootId: z.string().min(1),
  components: portableComponent.array().max(500),
});
const manifestSchema = z.union([portableArchive, portableBundle]);
const MAX_ZIP_BYTES = 60 * 1024 * 1024, MAX_EXPANDED_BYTES = 80 * 1024 * 1024;
type PortableContent = Archive | ReturnType<typeof exportComponentBundle>;

export function createPortableZip(content: PortableContent): Uint8Array {
  // Validate the same boundary as an imported save before writing it.
  if (content.format === 'tablecraft') parseArchive(JSON.stringify(content));
  else parseComponentBundle(JSON.stringify(content));
  const files: Record<string, Uint8Array> = {};
  let index = 0;
  const pack = (component: Component) => {
    if (!component.asset) return component;
    const { data, ...asset } = component.asset;
    const extension = asset.mime.split('/')[1];
    const path = `assets/${index++}.${extension}`;
    files[path] = base64ToBytes(data);
    return { ...component, asset: { ...asset, path } };
  };
  const manifest = content.format === 'tablecraft'
    ? { ...content, projects: content.projects.map(project => ({ ...project, components: project.components.map(pack) })) }
    : { ...content, components: content.components.map(pack) };
  files['project.json'] = strToU8(JSON.stringify(manifest, null, 2));
  if (Object.keys(files).length > 1500) throw new Error('The ZIP contains too many files. Export projects individually.');
  const expanded = Object.values(files).reduce((sum, file) => sum + file.length, 0);
  if (expanded > MAX_EXPANDED_BYTES) throw new Error('The portable save exceeds the 80 MiB expanded size limit.');
  const zip = zipSync({ ...files, 'project.json': [files['project.json'], { level: 6 }] }, { level: 0 });
  if (zip.length > MAX_ZIP_BYTES) throw new Error('The ZIP save exceeds the 60 MiB size limit. Export projects individually.');
  return zip;
}

export function readPortableZip(bytes: Uint8Array): { kind: 'archive'; archive: Archive } | { kind: 'component'; bundle: ComponentBundle } {
  if (bytes.length > MAX_ZIP_BYTES) throw new Error('ZIP imports must be at most 60 MiB.');
  if (bytes[0] !== 80 || bytes[1] !== 75) throw new Error('Choose a Tablecraft ZIP save containing project.json. JSON file imports are no longer supported.');
  let expanded = 0, entries = 0;
  const files = unzipSync(bytes, { filter: entry => {
    if (++entries > 1500) throw new Error('The ZIP contains too many files.');
    expanded += entry.originalSize;
    if (expanded > MAX_EXPANDED_BYTES) throw new Error('The ZIP exceeds the 80 MiB expanded size limit.');
    return entry.name === 'project.json' || /^assets\/[a-zA-Z0-9_-]+\.[a-z0-9]+$/.test(entry.name);
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
  if (manifest.format === 'tablecraft') {
    const hydrated = { ...manifest, projects: manifest.projects.map(project => ({ ...project, components: project.components.map(hydrate) })) };
    return { kind: 'archive', archive: parseArchive(JSON.stringify(hydrated)) };
  }
  return { kind: 'component', bundle: parseComponentBundle(JSON.stringify({ ...manifest, components: manifest.components.map(hydrate) })) };
}
export const projectZip = (project: Project) => createPortableZip({ format: 'tablecraft', version: 1, projects: [project] });
export const componentZip = (component: Component, catalog: Component[]) => createPortableZip(exportComponentBundle(component, catalog));

export function downloadZip(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
