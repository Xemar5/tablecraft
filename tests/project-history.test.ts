import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '../src/assets';
import { makeInstance, type Component } from '../src/domain';
import { createPortableZip, projectZip, readPortableZip } from '../src/portable';
import {
  addSnapshot, assignLegacySnapshots, deleteBlocker, deleteSession, deleteSnapshot, emptyHistory, hasUnsavedChanges, historySchema, isOutdated, latestSnapshot,
  makeSnapshot, remapHistory, renameItem, restingSnapshot, restoreSnapshot, selectHistory, setStatus, startSession, type History,
} from '../src/projectHistory';
import { blankProject, template } from '../src/templates';
import { starterTable } from './fixtures';

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'));
const texture: Component = { ...template('artwork'), id: 'texture', kind: 'texture', name: 'texture', asset: { name: 'texture.png', mime: 'image/png', data: bytesToBase64(png) } };

/** A finished project: two drafts (the first is the base), a session from it with one move saved. */
function finishedProject() {
  const starter = starterTable();
  const project = { ...starter, id: 'game', components: [...starter.components, texture], scripts: [{ id: 'rules', name: 'Rules', source: 'function hello() end' }] };
  const first = makeSnapshot(project, 'First draft', 1);
  const second = makeSnapshot({ ...project, instances: [] }, 'Second draft', 2);
  let history = addSnapshot(addSnapshot(emptyHistory(), first), second);
  history = setStatus(history, 'finished', first.id);
  const started = startSession(history, 'Friday', 3);
  history = addSnapshot(started.history, makeSnapshot({ ...project, instances: project.instances.slice(1) }, 'After a move', 4), started.session.id);
  return { project, first, second, history, session: started.session };
}

describe('project histories', () => {
  it('keeps the newest draft as the latest version, and a finished project at its base', () => {
    const { first, second, history, session } = finishedProject();
    expect(latestSnapshot(history)?.id).toBe(second.id);
    expect(restingSnapshot(history)?.id).toBe(first.id);
    expect(restingSnapshot(setStatus(history, 'draft'))?.id).toBe(second.id);
    // A new game copies the base into a session, which records where it started; saves go to the session.
    expect(session.snapshots[0]).toMatchObject({ name: 'Start', project: first.project });
    expect(session).toMatchObject({ baseId: first.id, baseName: 'First draft', name: 'Friday' });
    expect(latestSnapshot(history, session.id)?.name).toBe('After a move');
    expect(historySchema.parse(history)).toEqual(history);
  });

  it('marks sessions outdated once the base changes, even after going back to draft and finishing again', () => {
    const { second, history, session } = finishedProject();
    const draft = setStatus(history, 'draft');
    expect(isOutdated(draft, draft.sessions[0])).toBe(false);
    const rebased = setStatus(draft, 'finished', second.id);
    expect(isOutdated(rebased, rebased.sessions[0])).toBe(true);
    expect(rebased.sessions[0].baseId).toBe(session.baseId);
    expect(() => setStatus(emptyHistory(), 'finished', 'missing')).toThrow(/base/);
    expect(() => startSession(draft, 'Game')).toThrow(/finished/);
  });

  it('renames and deletes snapshots and sessions, but keeps the base and a session\'s only snapshot', () => {
    const { first, second, history, session } = finishedProject();
    const renamed = renameItem(renameItem(history, session.id, 'Saturday'), second.id, 'Two');
    expect(renamed.sessions[0].name).toBe('Saturday');
    expect(renamed.snapshots[1].name).toBe('Two');
    expect(() => renameItem(history, first.id, '  ')).toThrow(/empty/);
    expect(deleteBlocker(history, first.id)).toMatch(/base/);
    expect(deleteBlocker(history, second.id)).toBeUndefined();
    const fewer = deleteSnapshot(history, session.snapshots[0].id);
    expect(fewer.sessions[0].snapshots.map(snapshot => snapshot.name)).toEqual(['After a move']);
    expect(deleteBlocker(fewer, fewer.sessions[0].snapshots[0].id)).toMatch(/only snapshot/);
    expect(() => deleteSession(history, session.id, { projectId: 'game', session: session.id })).toThrow(/Close the project/);
    expect(deleteSession(history, session.id).sessions).toEqual([]);
  });

  it('notices changes since the snapshot a table was loaded from, but not the project\'s name or key order', () => {
    const { project, first, history } = finishedProject();
    const loaded = restoreSnapshot(first, { ...project, name: 'Renamed', description: 'Now described' });
    expect(loaded).toMatchObject({ id: 'game', name: 'Renamed', description: 'Now described' });
    const open = { projectId: 'game', from: first.id };
    expect(hasUnsavedChanges(loaded, history, open)).toBe(false);
    expect(hasUnsavedChanges(Object.fromEntries(Object.entries(loaded).reverse()) as typeof loaded, history, open)).toBe(false);
    expect(hasUnsavedChanges({ ...loaded, instances: [...loaded.instances, makeInstance(loaded.components[0].id)] }, history, open)).toBe(true);
    expect(hasUnsavedChanges(loaded, history, { projectId: 'game' })).toBe(true);
  });

  it('selects part of a history to export, finished only with its base', () => {
    const { first, second, history, session } = finishedProject();
    const base = selectHistory(history, new Set([first.id]));
    expect(base).toMatchObject({ status: 'finished', baseId: first.id, sessions: [] });
    const later = session.snapshots.at(-1)!;
    const sessionOnly = selectHistory(history, new Set([later.id]));
    expect(sessionOnly.status).toBe('draft');
    expect(sessionOnly.snapshots).toEqual([]);
    expect(sessionOnly.sessions[0].snapshots.map(snapshot => snapshot.id)).toEqual([later.id]);
    expect(selectHistory(history, new Set([second.id])).status).toBe('draft');
  });

  it('round-trips histories through a ZIP, storing each asset and script once per snapshot', () => {
    const { project, history, first, session } = finishedProject();
    const zip = projectZip(project, history);
    const files = unzipSync(zip);
    // The project and its four snapshots share one texture file.
    expect(Object.keys(files).filter(name => name.startsWith('assets/'))).toHaveLength(1);
    expect(Object.keys(files).filter(name => name.endsWith('.lua'))).toHaveLength(5);
    expect(JSON.parse(strFromU8(files['project.json'])).histories.game.baseId).toBe(first.id);
    const imported = readPortableZip(zip);
    if (imported.kind !== 'archive') throw new Error('Expected a project archive.');
    const restored = imported.histories.game;
    expect(restored.status).toBe('finished');
    expect(restored.sessions[0].snapshots.map(snapshot => snapshot.name)).toEqual(['Start', 'After a move']);
    expect(restored.sessions[0].snapshots[0].project.components.find(component => component.id === 'texture')?.asset?.data).toBe(texture.asset!.data);
    expect(restored.snapshots[0].project.scripts?.[0].source).toBe('function hello() end');
    expect(restored.sessions[0].id).toBe(session.id);
    // Old saves without histories still load, and histories must belong to an exported project.
    const plain = readPortableZip(projectZip(project));
    expect(plain.kind === 'archive' && plain.histories).toEqual({});
    expect(() => createPortableZip({ format: 'tablecraft', version: 1, projects: [project] }, { other: history })).toThrow(/belong/);
  });

  it('gives imported histories fresh ids and points their snapshots at the new project ids', () => {
    const { history, first } = finishedProject();
    const linked: History = addSnapshot(history, makeSnapshot({ ...blankProject('Linked'), id: 'game', components: [{ ...template('blank'), source: { projectId: 'source', componentId: 'card', projectName: 'Source' } }] }, 'Linked'));
    const remapped = remapHistory(linked, new Map([['game', 'new-game'], ['source', 'new-source']]), 'new-game');
    expect(remapped.status).toBe('finished');
    expect(remapped.baseId).not.toBe(first.id);
    expect(remapped.snapshots[0].id).toBe(remapped.baseId);
    expect(remapped.sessions[0].baseId).toBe(remapped.baseId);
    expect(remapped.snapshots.every(snapshot => snapshot.project.id === 'new-game')).toBe(true);
    expect(remapped.snapshots.at(-1)!.project.components[0].source?.projectId).toBe('new-source');
    expect(historySchema.parse(remapped)).toEqual(remapped);
  });

  it('assigns snapshots saved before histories to the projects whose components they share', () => {
    const a = { ...starterTable(), id: 'a' }, b = { ...blankProject('B'), id: 'b', components: [{ ...template('blank'), id: 'b-card' }] };
    const fromA = { ...a, id: 'snapshot-1', name: 'A playtest' }, fromB = { ...b, id: 'snapshot-2', name: 'B playtest' };
    const orphan = { ...blankProject('Gone'), id: 'snapshot-3', components: [{ ...template('blank'), id: 'gone-card' }] };
    const { byProject, unmatched } = assignLegacySnapshots([a, b], [fromA, orphan, fromB]);
    expect(byProject.get('a')?.map(project => project.name)).toEqual(['A playtest']);
    expect(byProject.get('b')?.map(project => project.name)).toEqual(['B playtest']);
    expect(unmatched.map(project => project.name)).toEqual(['Gone']);
  });
});
