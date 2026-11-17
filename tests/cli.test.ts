import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { starterProject } from '../src/templates';
import { linkComponent } from '../src/projectLinks';
import { createPortableZip } from '../src/portable';

let dir: string;
const runner = resolve('node_modules/tsx/dist/cli.mjs');
const cli = resolve('scripts/tablecraft.ts');
function run(...args: string[]) {
  return JSON.parse(execFileSync(process.execPath, [runner, cli, ...args], { encoding: 'utf8' }));
}
function fail(...args: string[]) {
  const result = spawnSync(process.execPath, [runner, cli, ...args], { encoding: 'utf8' });
  expect(result.status).not.toBe(0);
  return JSON.parse(result.stderr).error as string;
}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'tablecraft-cli-test-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('agent CLI', () => {
  it('imports portable readonly links and refreshes source edits across an archive', () => {
    const source = { ...starterProject(), id: 'source' };
    const empty = { ...starterProject(), id: 'target', components: [], instances: [] };
    const linked = linkComponent(empty, source, source.components[0].id);
    const file = join(dir, 'workspace.json'), batch = join(dir, 'commands.json'), bundle = join(dir, 'linked.json'), imported = join(dir, 'imported.json');
    writeFileSync(file, createPortableZip({ format: 'tablecraft', version: 1, projects: [source, linked.project] }));
    writeFileSync(batch, JSON.stringify({ type: 'component', component: { ...source.components[0], name: 'Refreshed by CLI' } }));
    run('apply', '--file', file, '--project', source.id, '--commands', batch);
    const target = run('inspect', '--file', file, '--project', 'target');
    expect(target.components.find((c: { id: string }) => c.id === linked.rootId).name).toBe('Refreshed by CLI');
    run('export', '--file', file, '--project', 'target', '--component', linked.rootId, '--out', bundle);
    run('new', '--out', imported);
    run('import', '--file', imported, '--bundle', bundle);
    expect(run('inspect', '--file', imported).components.every((c: { source?: unknown }) => !!c.source)).toBe(true);
  }, 30000);

  it('generates artwork and exposes its kind in help and the component schema', () => {
    const help = execFileSync(process.execPath, [runner, cli, '--help'], { encoding: 'utf8' });
    expect(help).toContain('blank|card|token|board|dice|artwork');
    expect(run('schema', '--what', 'component').properties.kind.enum).toContain('artwork');
    const file = join(dir, 'game.json'), data = join(dir, 'artwork.json');
    run('new', '--out', file);
    const artwork = run('generate', '--file', file, '--template', 'artwork', '--name', 'Leaf').component;
    expect(artwork).toMatchObject({ kind: 'artwork', name: 'Leaf', color: 'transparent',
      front: [], back: [], hand: false, flippable: false, stackable: false, shufflable: false });
    writeFileSync(data, JSON.stringify({ width: 320, height: 180 }));
    const custom = run('generate', '--file', file, '--template', 'artwork', '--data', data).component;
    expect(custom).toMatchObject({ kind: 'artwork', width: 320, height: 180 });
    expect(run('validate', '--file', file).valid).toBe(true);
    expect(run('list', '--file', file, '--what', 'components').every((item: { kind: string }) => item.kind === 'artwork')).toBe(true);
  }, 30000);

  it('creates, generates linked templates, spawns, exports and imports bundles', () => {
    const file = join(dir, 'game.json'), other = join(dir, 'other.json'), bundle = join(dir, 'card.json');
    run('new', '--out', file, '--template', 'blank');
    expect(fail('new', '--out', file)).toMatch(/exist/i);
    const component = run('generate', '--file', file, '--template', 'card').component;
    const project = run('inspect', '--file', file);
    expect(project.components.length).toBeGreaterThan(1);
    run('spawn', '--file', file, '--component', component.id, '--count', '2');
    expect(run('list', '--file', file, '--what', 'instances')).toHaveLength(2);
    run('export', '--file', file, '--component', component.id, '--out', bundle);
    run('new', '--out', other);
    const imported = run('import', '--file', other, '--bundle', bundle);
    expect(imported.rootId).not.toBe(component.id);
    expect(run('validate', '--file', other).valid).toBe(true);
    expect(run('inspect', '--file', other).components).toHaveLength(imported.components.length);
  }, 30000);

  it('applies batches atomically and supports undo within a batch', () => {
    const file = join(dir, 'game.json'), batch = join(dir, 'commands.json');
    run('new', '--out', file);
    const before = readFileSync(file, 'utf8');
    writeFileSync(batch, JSON.stringify([{ type: 'rename', name: 'changed' }, { type: 'removeComponent', id: 'missing' }]));
    expect(fail('apply', '--file', file, '--commands', batch)).toMatch(/no longer exists/i);
    expect(readFileSync(file, 'utf8')).toBe(before);
    writeFileSync(batch, JSON.stringify([{ type: 'settings', patch: { snap: true } }, { type: 'undo' }]));
    run('apply', '--file', file, '--commands', batch);
    expect(run('inspect', '--file', file).settings.snap).toBe(false);
    writeFileSync(batch, JSON.stringify({ type: 'undo' }));
    expect(fail('apply', '--file', file, '--commands', batch)).toMatch(/nothing to undo/i);
  }, 30000);

  it('exposes schemas and rejects invalid flags or untrusted live URLs', () => {
    expect(run('schema', '--what', 'command').oneOf.length).toBeGreaterThan(1);
    expect(fail('schema', '--what', 'command', '--typo', 'x')).toMatch(/unknown option/i);
    expect(fail('live', 'join', '--code', 'TEST', '--uri', 'http://example.com:3000')).toMatch(/require HTTPS/i);
    expect(fail('live', 'join', '--code', 'TEST', '--uri', 'https://user:pass@example.com')).toMatch(/without credentials/i);
  }, 30000);
});
