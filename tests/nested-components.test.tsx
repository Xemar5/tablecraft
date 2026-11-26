import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComponentView } from '../src/ComponentView';
import { applyCommand, makeNode, nodeSchema, validateProject, type Component, type Project } from '../src/domain';
import { exportComponentBundle, parseArchive, parseComponentBundle, remapComponentBundle } from '../src/storage';
import { template, templateBundle, upgradeLegacyArtworkProject } from '../src/templates';

function component(id: string, name: string, rows: Record<string, string>[] = [], front = [] as Component['front']): Component {
  return { ...template('blank'), id, name, width: 120, height: 80, rows, front };
}
function project(components: Component[]): Project {
  return {
    id: 'project', name: 'Nested test', description: '', components, instances: [], players: [],
    settings: { grid: true, snap: false, gridSize: 25, hands: true, turns: false, turn: 0 },
  };
}

describe('nested linked components', () => {
  it('validates references, finite recursion, and explicit own-row bounds', () => {
    const leaf = component('leaf', 'Leaf', [{ label: 'One' }]);
    const validParent = component('parent', 'Parent', [], [makeNode('component', { componentId: leaf.id, dataSource: 'row', dataRow: 0 })]);
    expect(validateProject(project([validParent, leaf])).components).toHaveLength(2);
    expect(() => validateProject(project([component('parent', 'Parent', [], [makeNode('component', { componentId: 'missing' })])]))).toThrow('missing component');
    const outOfRange = component('parent', 'Parent', [], [makeNode('component', { componentId: leaf.id, dataSource: 'row', dataRow: 1 })]);
    expect(() => validateProject(project([outOfRange, leaf]))).toThrow('out of range');
    const emptyRow = component('parent', 'Parent', [], [makeNode('component', { componentId: 'empty', dataSource: 'row', dataRow: 0 })]);
    expect(() => validateProject(project([emptyRow, component('empty', 'Empty')]))).toThrow('out of range');
    const a = component('a', 'A', [], [makeNode('component', { componentId: 'b' })]);
    const b = component('b', 'B', [], [makeNode('component', { componentId: 'a' })]);
    expect(() => validateProject(project([a, b]))).toThrow('cycle');
    const chain = Array.from({ length: 34 }, (_, index) => component(`c${index}`, `C${index}`,
      [], index < 33 ? [makeNode('component', { componentId: `c${index + 1}` })] : []));
    expect(() => validateProject(project(chain))).toThrow('32 levels');
    const branching = Array.from({ length: 11 }, (_, index) => component(`b${index}`, `B${index}`,
      [], index < 10 ? Array.from({ length: 3 }, () => makeNode('component', { componentId: `b${index + 1}` })) : []));
    expect(() => validateProject(project(branching))).toThrow('rendering exceeds');
  });

  it('renders inherited, explicit own-row and parent-field row data without silent fallback', () => {
    const child = component('child', 'Child', [{ label: 'Own zero' }, { label: 'Own one' }],
      [makeNode('text', { text: '{{label}}' })]);
    const inherited = makeNode('component', { componentId: child.id, dataSource: 'inherit' });
    const ownRow = makeNode('component', { componentId: child.id, dataSource: 'row', dataRow: 1, x: 130 });
    const fieldRow = makeNode('component', { componentId: child.id, dataSource: 'field', dataField: 'childIndex', x: 260 });
    const parent = component('parent', 'Parent', [{ label: 'Parent label', childIndex: '1' }], [inherited, ownRow, fieldRow]);
    const markup = renderToStaticMarkup(<ComponentView component={parent} components={[parent, child]} />);
    expect(markup).toContain('Parent label');
    expect(markup.match(/Own one/g)).toHaveLength(2);

    const invalidParent = { ...parent, rows: [{ label: 'Parent label', childIndex: '1.5' }] };
    const invalidMarkup = renderToStaticMarkup(<ComponentView component={invalidParent} components={[invalidParent, child]} />);
    expect(invalidMarkup).toContain('zero-based integer row index');
    expect(invalidMarkup).not.toContain('Own zero');
    const emptyChild = component('empty', 'Empty');
    const emptyRowMarkup = renderToStaticMarkup(<ComponentView
      component={component('parent', 'Parent', [], [makeNode('component', { componentId: emptyChild.id, dataSource: 'row' })])}
      components={[emptyChild]} />);
    expect(emptyRowMarkup).toMatch(/Row 0 is outside Empty.*s data/);
  });

  it('exports the dependency closure and imports linked components in dependency-first order', () => {
    const leaf = component('leaf', 'Leaf', [{ label: 'Leaf row' }], [makeNode('text', { text: '{{label}}' })]);
    const parent = component('parent', 'Parent', [], [makeNode('component', { componentId: leaf.id })]);
    const exported = exportComponentBundle(parent, [parent, leaf]);
    expect(exported.components.map(item => item.id)).toEqual(['leaf', 'parent']);
    const imported = parseComponentBundle(JSON.stringify(exported));
    expect(imported.rootId).toBe(parent.id);
    expect(imported.components.map(item => item.id)).toEqual(['leaf', 'parent']);
    const remapped = remapComponentBundle(imported, item => `copy-${item.id}`);
    expect(remapped.rootId).toBe('copy-parent');
    expect(remapped.components[1].front[0].componentId).toBe('copy-leaf');
    expect(validateProject(project(remapped.components)).components).toHaveLength(2);
    expect(() => parseComponentBundle(JSON.stringify({ ...exported, components: [parent] }))).toThrow('missing component');
  });

  it('keeps old botanical artwork while removing the motif chooser, and protects linked components from deletion', () => {
    const oldShape = makeNode('shape', { text: 'fern', fill: '#294c40' }) as Record<string, unknown>;
    delete oldShape.shapeKind; delete oldShape.points; delete oldShape.stroke; delete oldShape.strokeWidth;
    const legacyShape = nodeSchema.parse(oldShape);
    const leaf = component('leaf', 'Leaf');
    const parent = component('parent', 'Parent', [], [makeNode('component', { componentId: leaf.id })]);
    const legacy = component('legacy', 'Legacy', [], [legacyShape]);
    const archive = parseArchive(JSON.stringify({ format: 'tablecraft', version: 1, projects: [project([legacy])] }));
    const upgraded = archive.projects[0], root = upgraded.components.find(item => item.id === legacy.id)!;
    const markup = renderToStaticMarkup(<ComponentView component={root} components={upgraded.components} />);
    expect(markup).not.toContain('botanical botanical-fern');
    expect(markup).toContain('node-component');
    expect(markup).toContain('node-shape');
    expect(markup).toContain('#294c40');
    expect(root.front.find(item => item.id === legacyShape.id)?.text).toBe('fern');
    expect(parseArchive(JSON.stringify(archive)).projects[0].components).toHaveLength(upgraded.components.length);
    expect(upgradeLegacyArtworkProject(upgraded)).toBe(upgraded);
    expect(upgradeLegacyArtworkProject(project([legacy]))).toEqual(upgradeLegacyArtworkProject(project([legacy])));
    const linkedProject = project([parent, leaf]);
    expect(() => applyCommand(linkedProject, { type: 'removeComponent', id: leaf.id })).toThrow('links this component');
    expect(applyCommand(linkedProject, { type: 'removeComponent', id: parent.id }).components).toHaveLength(1);
  });

  it('creates linked editable template art and switches it by inherited data', () => {
    const bundle = templateBundle('card');
    validateProject(project(bundle.components));
    const art = bundle.components.find(item => item.name.includes('Botanical artwork') && item.front.some(node => node.visibilityField))!;
    expect(art.front.every(node => node.type === 'shape' || node.type === 'compound')).toBe(true);
    expect(art.rows.map(row => row.art)).toEqual(['fern', 'moon', 'sun']);
    expect(renderToStaticMarkup(<ComponentView component={art} />)).toContain('#b5c391');
    const fern = renderToStaticMarkup(<ComponentView component={bundle.root} components={bundle.components} row={0} />);
    const moon = renderToStaticMarkup(<ComponentView component={bundle.root} components={bundle.components} row={1} />);
    expect(fern).toContain('#b5c391');
    expect(moon).toContain('#d9d9b2');
    expect(moon).not.toContain('botanical-moon');
  });

  it('rejects a legacy upgrade that exceeds layer limits without mutating its input', () => {
    const artwork = makeNode('shape', { text: 'fern' });
    const nodes = [artwork, ...Array.from({ length: 299 }, () => makeNode('shape'))];
    const original = project([component('full', 'Full', [], nodes)]);
    const raw = JSON.stringify({ format: 'tablecraft', version: 1, projects: [original] });
    expect(() => parseArchive(raw)).toThrow();
    expect(original.components[0].front).toHaveLength(300);
    expect(original.components[0].front[0].text).toBe('fern');
  });
});
