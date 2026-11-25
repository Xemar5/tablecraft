import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { assetMime, bytesToBase64, GOOGLE_FONTS, importAsset } from '../src/assets';
import { ComponentView } from '../src/ComponentView';
import { applyCommand, assetFontFamily, makeInstance, makeNode, MAX_ASSET_BYTES, validateProject, type Archive, type Component } from '../src/domain';
import { componentZip, createPortableZip, projectZip, readPortableZip } from '../src/portable';
import { remapComponentBundle } from '../src/storage';
import { blankProject, template } from '../src/templates';

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'));
// Use the installed test dependency's font rather than copying a font fixture.
const fontBytes = readFileSync('node_modules/playwright-core/lib/vite/traceViewer/codicon.DCmgc-ay.ttf');
function asset(id: string, kind: 'texture' | 'font'): Component {
  return { ...template('artwork'), id, kind, name: id, asset: {
    name: kind === 'texture' ? 'texture.png' : 'custom.ttf',
    mime: kind === 'texture' ? 'image/png' : 'font/ttf',
    data: bytesToBase64(kind === 'texture' ? png : fontBytes),
  } };
}
function example() {
  const texture = asset('my-texture', 'texture'), font = asset('my-font', 'font');
  const card = { ...template('blank'), front: [makeNode('image', { textureId: texture.id }), makeNode('text', { fontId: font.id })],
    back: [makeNode('image', { textureId: texture.id }), makeNode('text', { fontId: font.id })] };
  const project = { ...blankProject('Assets'), components: [card, texture, font], instances: [makeInstance(card.id)] };
  return { project, card, texture, font };
}

describe('portable ZIP saves and imported assets', () => {
  it('creates new blank projects with one seated player', () => {
    const project = blankProject('A game', '', { name: 'Tester', color: '#123456' });
    expect(project.players).toHaveLength(1);
    expect(project.players[0]).toMatchObject({ name: 'Tester', color: '#123456', owner: 'local' });
    expect(project.components).toEqual([]);
    validateProject(project);
  });

  it('round-trips a complete project with binary asset files beside project.json', () => {
    const { project } = example();
    const zip = projectZip(project), files = unzipSync(zip);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['project.json', 'assets/0.png', 'assets/1.ttf']));
    const manifest = strFromU8(files['project.json']);
    expect(manifest).not.toContain('base64');
    expect(manifest).toContain('"path": "assets/0.png"');
    expect(files['assets/0.png']).toEqual(png);
    const imported = readPortableZip(zip);
    expect(imported.kind).toBe('archive');
    if (imported.kind !== 'archive') throw new Error('Expected project archive');
    expect(imported.archive.projects[0]).toEqual(project);
  });

  it('exports and remaps a component with its texture/font dependency closure', () => {
    const { card, project } = example();
    const imported = readPortableZip(componentZip(card, project.components));
    if (imported.kind !== 'component') throw new Error('Expected component bundle');
    const remapped = remapComponentBundle(imported.bundle, component => `copy-${component.id}`);
    const root = remapped.components.find(component => component.id === remapped.rootId)!;
    expect(remapped.components).toHaveLength(3);
    expect(root.front[0].textureId).toBe('copy-my-texture');
    expect(root.front[1].fontId).toBe('copy-my-font');
    expect(root.back[0].textureId).toBe('copy-my-texture');
    validateProject({ ...blankProject(), components: remapped.components });
  });

  it('deletes files with their asset components and safely clears both faces of all consumers', () => {
    const { project, texture, font, card } = example();
    let updated = applyCommand(project, { type: 'removeComponent', id: texture.id });
    updated = applyCommand(updated, { type: 'removeComponent', id: font.id });
    expect(updated.components).toHaveLength(1);
    for (const face of [updated.components[0].front, updated.components[0].back]) {
      expect(face[0].textureId).toBeUndefined();
      expect(face[0].text).toBe('');
      expect(face[1].fontId).toBeUndefined();
      expect(face[1].font).toBe('DM Sans');
    }
    expect(Object.keys(unzipSync(projectZip(updated)))).toEqual(['project.json']);
    expect(card.front[0].textureId).toBe(texture.id);
  });

  it('renders texture sources and project-specific font families', () => {
    const { project, card, font } = example();
    const html = renderToStaticMarkup(<ComponentView component={card} components={project.components} />);
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain(assetFontFamily(font));
    expect(GOOGLE_FONTS).toHaveLength(new Set(GOOGLE_FONTS).size);
    expect(GOOGLE_FONTS.length).toBeGreaterThan(35);
  });

  it('rejects broken references, wrong asset kinds and spawning assets', () => {
    const { project, texture, card } = example();
    expect(() => validateProject({ ...project, components: project.components.filter(component => component.id !== texture.id) })).toThrow('missing texture');
    expect(() => validateProject({ ...project, instances: [makeInstance(texture.id)] })).toThrow('cannot be placed');
    const nested = { ...card, front: [makeNode('component', { componentId: texture.id })] };
    expect(() => validateProject({ ...project, components: [nested, ...project.components.slice(1)] })).toThrow('not nested');
    expect(() => validateProject({ ...project, components: [{ ...texture, asset: undefined }] })).toThrow('matching texture');
  });

  it('imports detected image/font types, regardless of misleading file extensions', async () => {
    expect((await importAsset(new File([png], 'misleading.ttf'))).kind).toBe('texture');
    expect((await importAsset(new File([fontBytes], 'custom.ttf'))).kind).toBe('font');
    expect(assetMime(fontBytes)).toBe('font/ttf');
    await expect(importAsset(new File(['<svg/>'], 'vector.svg'))).rejects.toThrow('Unsupported asset');
    await expect(importAsset(new File([new Uint8Array(MAX_ASSET_BYTES + 1)], 'huge.png'))).rejects.toThrow('5 MiB');
  });

  it('enforces exact per-file and project-wide asset size limits', () => {
    const data = (size: number) => {
      const bytes = new Uint8Array(size); bytes.set(png);
      return bytesToBase64(bytes);
    };
    const texture = asset('limit', 'texture'), project = blankProject();
    const atLimit = { ...texture, asset: { ...texture.asset!, data: data(MAX_ASSET_BYTES) } };
    expect(() => validateProject({ ...project, components: [atLimit] })).not.toThrow();
    const aboveLimit = { ...texture, asset: { ...texture.asset!, data: data(MAX_ASSET_BYTES + 1) } };
    expect(() => validateProject({ ...project, components: [aboveLimit] })).toThrow();
    const four = Array.from({ length: 4 }, (_, index) => ({ ...atLimit, id: `limit-${index}` }));
    expect(() => validateProject({ ...project, components: four })).not.toThrow();
    expect(() => validateProject({ ...project, components: [...four, texture] })).toThrow('20 MiB');
  });

  it('rejects JSON imports, missing files, MIME mismatches, and oversized expanded archives', () => {
    expect(() => readPortableZip(strToU8('{"format":"tablecraft"}'))).toThrow('ZIP');
    expect(() => readPortableZip(zipSync({ 'other.json': strToU8('{}') }))).toThrow('project.json');
    const files = unzipSync(projectZip(example().project));
    const without = { ...files }; delete without['assets/0.png'];
    expect(() => readPortableZip(zipSync(without))).toThrow('Missing imported asset');
    expect(() => readPortableZip(zipSync({ ...files, 'assets/0.png': fontBytes }))).toThrow('does not match');
    // The central-directory size is checked before decompression.
    const oversized = zipSync({ 'project.json': strToU8('{}') });
    const central = oversized.findIndex((byte, index) => byte === 80 && oversized[index + 1] === 75 && oversized[index + 2] === 1 && oversized[index + 3] === 2);
    new DataView(oversized.buffer).setUint32(central + 24, 81 * 1024 * 1024, true);
    expect(() => readPortableZip(oversized)).toThrow('expanded size');
  });

  it('preserves multiple projects in workspace exports', () => {
    const archive: Archive = { format: 'tablecraft', version: 1, projects: [blankProject('One'), blankProject('Two')] };
    expect(readPortableZip(createPortableZip(archive))).toEqual({ kind: 'archive', archive, histories: {} });
  });
});
