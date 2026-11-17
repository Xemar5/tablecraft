import { describe, expect, it } from 'vitest';
import { applyCommand, makeInstance, makeNode, type Component } from '../src/domain';
import { addDraftEdit, draftComponents, recoverDesignDraft, withDraft, type DraftEdit } from '../src/designDraft';
import { blankProject, starterProject, templateBundle } from '../src/templates';

const card = (id: string, patch: Partial<Component> = {}): Component => ({
  id, name: id, kind: 'card', width: 100, height: 140, color: '#fff', front: [], back: [], csv: '', rows: [],
  flippable: false, hand: true, hideInHand: false, stackable: true, shufflable: true, stackTag: '', ...patch,
});

describe('designer drafts', () => {
  it('keeps one edit per run of changes to a component and compacts earlier runs when they replay cleanly', () => {
    const components = [card('a'), card('b')];
    let edits: DraftEdit[] = [];
    edits = addDraftEdit(components, edits, card('a', { color: '#111' }));
    edits = addDraftEdit(components, edits, card('a', { color: '#222' }));
    expect(edits.map(edit => edit.component.color)).toEqual(['#222']);
    edits = addDraftEdit(components, edits, card('b', { color: '#333' }));
    edits = addDraftEdit(components, edits, card('a', { color: '#444' }));
    expect(edits.map(edit => [edit.component.id, edit.component.color])).toEqual([['b', '#333'], ['a', '#444']]);
    expect(draftComponents(components, edits).map(c => c.color)).toEqual(['#444', '#333']);
    expect(draftComponents(components, [])).toBe(components);
  });

  it('keeps edits in order when a later edit depends on an earlier one', () => {
    const components = [card('a', { rows: [{ name: 'One' }] }), card('b')];
    const threeRows = card('a', { rows: [{ name: 'One' }, { name: 'Two' }, { name: 'Three' }] });
    let edits = addDraftEdit(components, [], threeRows);
    const nested = makeNode('component', { componentId: 'a', dataSource: 'row', dataRow: 2 });
    edits = addDraftEdit(components, edits, card('b', { front: [nested] }));
    edits = addDraftEdit(components, edits, { ...threeRows, color: '#555' });
    // Moving the last change to “a” after “b” would replay “b” against the one-row original, so it stays put.
    expect(edits.map(edit => edit.component.id)).toEqual(['a', 'b', 'a']);
    expect(() => addDraftEdit(components, edits, card('a', { rows: [{ name: 'One' }] }))).toThrow('out of range');
  });

  it('rejects invalid designs immediately, like the component command', () => {
    const linked = card('linked', { source: { projectId: 'other', componentId: 'x', projectName: 'Other' } });
    expect(() => addDraftEdit([linked], [], { ...linked, color: '#000' })).toThrow('read-only');
    const path = makeNode('shape', { shapeKind: 'path', points: [{ x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 }] });
    expect(() => addDraftEdit([card('a')], [], card('a', { front: [path] }))).toThrow(/needs at least [23] points/);
  });

  it('shows the draft only for its own project', () => {
    const project = starterProject(), other = blankProject();
    const component = { ...project.components[0], color: '#abcdef' };
    const draft = { projectId: project.id, edits: [{ component }] };
    expect(withDraft(project, draft).components[0].color).toBe('#abcdef');
    expect(withDraft(other, draft)).toBe(other);
    expect(withDraft(project, undefined)).toBe(project);
  });

  it('replays page removals one at a time and skips edits that no longer apply when recovering', () => {
    const book = templateBundle('book').root;
    const project = applyCommand({ ...blankProject(), components: [book] }, { type: 'spawn', instances: [{ ...makeInstance(book.id, 2), id: 'b' }] });
    let edits = addDraftEdit(project.components, [], { ...book, rows: book.rows.slice(1) }, 0);
    edits = addDraftEdit(project.components, edits, { ...book, rows: book.rows.slice(2) }, 0);
    edits = addDraftEdit(project.components, edits, { ...book, rows: book.rows.slice(2), color: '#123456' });
    expect(edits.map(edit => edit.removedDataRow)).toEqual([0, 0, undefined]);
    const archive = { format: 'tablecraft' as const, version: 1 as const, projects: [project] };
    const linked = card('ghost', { source: { projectId: 'other', componentId: 'x', projectName: 'Other' } });
    const result = recoverDesignDraft(archive, { projectId: project.id, edits: [...edits, { component: linked }] });
    expect(result).toMatchObject({ recovered: 3, skipped: 1 });
    const recovered = result.archive.projects[0];
    expect(recovered.components[0]).toMatchObject({ color: '#123456', rows: book.rows.slice(2) });
    expect(recovered.instances[0].row).toBe(0);
    expect(recoverDesignDraft(archive, { projectId: 'missing', edits })).toEqual({ archive, recovered: 0, skipped: 0 });
  });
});
