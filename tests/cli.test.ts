import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
