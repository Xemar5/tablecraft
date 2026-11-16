import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComponentView } from '../src/ComponentView';
import { applyCommand, makeNode, nodeSchema } from '../src/domain';
import { starterProject } from '../src/templates';

describe('layer visibility', () => {
  it('defaults legacy layers to visible and persists toggles through shared component commands', () => {
    const node = makeNode('text', { text: 'Visible text', x: 25 });
    const { visible: _visible, ...legacy } = node;
    expect(nodeSchema.parse(legacy).visible).toBe(true);
    expect(() => nodeSchema.parse({ ...node, visible: 'false' })).toThrow();
    const project = starterProject();
    const component = { ...project.components[0], front: [node] };
    const withNode = applyCommand(project, { type: 'component', component });
    const hidden = { ...component, front: [{ ...node, visible: false }] };
    const result = applyCommand(withNode, { type: 'component', component: hidden });
    expect(result.components[0].front[0]).toEqual({ ...node, visible: false });
    expect(renderToStaticMarkup(<ComponentView component={result.components[0]} />)).not.toContain('Visible text');
    const restored = applyCommand(result, { type: 'component', component });
    expect(renderToStaticMarkup(<ComponentView component={restored.components[0]} />)).toContain('Visible text');
  });

  it('hides a group subtree without changing child visibility and respects CSV conditions', () => {
    const group = makeNode('frame', { visible: false, layout: 'row', width: 300 });
    const child = makeNode('text', { parent: group.id, text: 'Group child' });
    const hiddenChild = makeNode('text', { parent: group.id, text: 'Hidden child', visible: false });
    const conditional = makeNode('text', { text: 'Conditional', visibilityField: 'show', visibilityValue: 'yes' });
    const component = { ...starterProject().components[0], front: [group, child, hiddenChild, conditional], rows: [{ show: 'no' }, { show: 'yes' }] };
    const original = structuredClone(component);
    expect(renderToStaticMarkup(<ComponentView component={component} row={1} />)).not.toContain('Group child');
    const shown = { ...component, front: [{ ...group, visible: true }, child, hiddenChild, conditional] };
    const markup = renderToStaticMarkup(<ComponentView component={shown} row={0} />);
    expect(markup).toContain('Group child');
    expect(markup).not.toContain('Hidden child');
    expect(markup).not.toContain('Conditional');
    expect(renderToStaticMarkup(<ComponentView component={shown} row={1} />)).toContain('Conditional');
    expect(component).toEqual(original);
  });

  it('omits hidden compound sources, including nested compounds, from rendered geometry', () => {
    const compound = makeNode('compound', { id: 'compound', width: 200, height: 100 });
    const nested = makeNode('compound', { id: 'nested', parent: compound.id, width: 100, height: 100 });
    const first = makeNode('shape', { parent: nested.id, x: 0, y: 0, width: 100, height: 100 });
    const second = makeNode('shape', { parent: compound.id, x: 100, y: 0, width: 100, height: 100 });
    const component = { ...starterProject().components[0], front: [compound, nested, first, second] };
    const path = (front: typeof component.front) => {
      const markup = renderToStaticMarkup(<ComponentView component={{ ...component, front }} />);
      return markup.match(/<path d="([^"]*)"/)?.[1];
    };
    expect(path(component.front)).not.toEqual(path([compound, { ...nested, visible: false }, first, second]));
    const hiddenNestedChild = path([compound, nested, { ...first, visible: false }, second]);
    expect(hiddenNestedChild).toContain('M 100 0');
    expect(hiddenNestedChild).not.toContain('M 0 0');
    expect(path([{ ...compound, visible: false }, nested, first, second])).toBeUndefined();
  });
});
