import { describe, expect, it } from 'vitest';
import { applyCommand, makeInstance, makeNode, type Archive } from '../src/domain';
import { linkComponent, localComponentCopy, refreshProjectLinks } from '../src/projectLinks';
import { starterProject } from '../src/templates';
import { parseArchive } from '../src/storage';

function setup() {
  const source = starterProject(), target = starterProject();
  source.id = 'source'; target.id = 'target';
  target.components = []; target.instances = [];
  const root = source.components.find(c => c.kind === 'card')!;
  const linked = linkComponent(target, source, root.id);
  const archive: Archive = { format: 'tablecraft', version: 1, projects: [source, linked.project] };
  return { source, target: linked.project, root, linkedId: linked.rootId, archive };
}

describe('cross-project component links', () => {
  it('stores a portable read-only dependency closure with destination-local IDs', () => {
    const { source, target, root, linkedId, archive } = setup();
    const linked = target.components.find(c => c.id === linkedId)!;
    expect(linked.id).not.toBe(root.id);
    expect(linked.source).toEqual({ projectId: source.id, componentId: root.id, projectName: source.name });
    expect(target.components.every(c => c.source?.projectId === source.id)).toBe(true);
    expect(parseArchive(JSON.stringify(archive))).toEqual(archive);
    expect(refreshProjectLinks({ ...archive, projects: [target] }).projects[0]).toEqual(target);
    expect(linkComponent(target, source, root.id).project).toBe(target);
  });

  it('refreshes source content in place without changing instance identities or seat ownership', () => {
    const { source, target, root, linkedId, archive } = setup();
    target.instances = [makeInstance(linkedId, 0)];
    source.components.find(c => c.id === root.id)!.name = 'Updated source';
    const next = refreshProjectLinks(archive).projects[1];
    expect(next.components.find(c => c.id === linkedId)?.name).toBe('Updated source');
    expect(next.instances).toEqual(target.instances);
    expect(next.players).toEqual(target.players);
    expect(target.components.find(c => c.id === linkedId)?.name).not.toBe('Updated source');
  });

  it('refreshes independently imported aliases of the same source component', () => {
    const { source, target, root, linkedId, archive } = setup();
    target.components.push({ ...target.components.find(c => c.id === linkedId)!, id: 'imported-alias' });
    source.components.find(c => c.id === root.id)!.name = 'Both aliases update';
    const next = refreshProjectLinks(archive).projects[1];
    expect(next.components.find(c => c.id === linkedId)?.name).toBe('Both aliases update');
    expect(next.components.find(c => c.id === 'imported-alias')?.name).toBe('Both aliases update');
    expect(refreshProjectLinks({ ...archive, projects: [source, next] }).projects[1]).toBe(next);
  });

  it('refreshes new nested dependencies atomically and clamps rows when a source loses variants', () => {
    const { source, target, root, linkedId, archive } = setup();
    target.instances = [makeInstance(linkedId, 3)];
    const nested = { ...source.components.find(c => c.kind === 'dice')!, id: 'new-die' };
    source.components.push(nested);
    const original = source.components.find(c => c.id === root.id)!;
    original.front.push(makeNode('component', { componentId: nested.id, dataSource: 'row', dataRow: 2 }));
    original.rows = original.rows.slice(0, 1);
    const next = refreshProjectLinks(archive).projects[1];
    const added = next.components.find(c => c.source?.componentId === nested.id)!;
    expect(added).toBeDefined();
    expect(next.components.find(c => c.id === linkedId)!.front.at(-1)?.componentId).toBe(added.id);
    expect(next.instances[0].row).toBe(0);
  });

  it('retains the last snapshot when its source project or component is deleted', () => {
    const { source, target, root, archive } = setup();
    expect(refreshProjectLinks({ ...archive, projects: [target] }).projects[0]).toEqual(target);
    source.components = source.components.filter(c => c.id !== root.id);
    source.instances = source.instances.filter(i => i.componentId !== root.id);
    expect(refreshProjectLinks(archive).projects[1]).toEqual(target);
  });

  it('makes an independent editable local copy of the complete dependency closure', () => {
    const { target, linkedId } = setup();
    const copy = localComponentCopy(target, linkedId);
    expect(copy.components.every(c => !c.source)).toBe(true);
    const next = applyCommand(target, { type: 'addComponents', components: copy.components });
    const root = copy.components.find(c => c.id === copy.rootId)!;
    expect(() => applyCommand(next, { type: 'component', component: { ...root, name: 'Editable' } })).not.toThrow();
    expect(copy.components.every(c => !target.components.some(original => original.id === c.id))).toBe(true);
  });

  it('rejects editing linked content or using refresh to overwrite a local component', () => {
    const { target, linkedId, source } = setup();
    const component = target.components.find(c => c.id === linkedId)!;
    expect(() => applyCommand(target, { type: 'component', component: { ...component, source: undefined } })).toThrow('read-only');
    expect(() => applyCommand(source, { type: 'syncLinkedComponents', components: [{ ...source.components[0], source: component.source }] })).toThrow('matching read-only');
    expect(() => applyCommand(target, { type: 'addComponents', components: [component] })).toThrow('already exists');
  });

  it('rejects cross-project cycles without modifying the input archive', () => {
    const { source, target, root, archive } = setup();
    const back = { ...source.components[0], source: { projectId: target.id, componentId: target.components[0].id, projectName: target.name } };
    source.components[source.components.findIndex(c => c.id === root.id)] = back;
    const before = JSON.stringify(archive);
    expect(() => refreshProjectLinks(archive)).toThrow('cycle');
    expect(JSON.stringify(archive)).toBe(before);
  });

  it('accepts empty workspaces and rejects duplicate project identifiers', () => {
    expect(parseArchive('{"format":"tablecraft","version":1,"projects":[]}').projects).toEqual([]);
    const { source, archive } = setup();
    expect(() => parseArchive(JSON.stringify({ ...archive, projects: [source, source] }))).toThrow('unique');
  });
});
