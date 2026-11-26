import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComponentView } from '../src/ComponentView';
import { makeNode, nodeSchema } from '../src/domain';
import { starterTable } from './fixtures';

const styleOf = (markup: string, text: string) => {
  const match = markup.match(new RegExp(`<div style="([^"]*)" class="design-node node-text"[^>]*>(?:(?!</div>).)*${text}`));
  if (!match) throw new Error(`No layer with ${text}`);
  return match[1];
};

describe('layer margins', () => {
  it('accepts optional nonnegative margins on saved layers', () => {
    const node = makeNode('frame');
    expect(nodeSchema.parse(node).marginTop).toBeUndefined();
    expect(nodeSchema.parse({ ...node, marginLeft: 24 }).marginLeft).toBe(24);
    expect(() => nodeSchema.parse({ ...node, marginRight: -1 })).toThrow();
  });

  it('places fixed and hug axes by x/y in absolute parents, and insets fill axes by their margins', () => {
    const fill = makeNode('text', { text: 'Filled', x: 40, y: 50, widthMode: 'fill', marginLeft: 10, marginRight: 20 });
    const hug = makeNode('text', { text: 'Hugged', x: 40, y: 50, heightMode: 'hug', marginTop: 7 });
    const fixed = makeNode('text', { text: 'Fixed', x: 40, y: 50, marginLeft: 99 });
    const markup = renderToStaticMarkup(<ComponentView component={{ ...starterTable().components[0], front: [fill, hug, fixed] }} />);
    expect(styleOf(markup, 'Filled')).toMatch(/left:10px;right:20px;top:50px/);
    expect(styleOf(markup, 'Filled')).not.toMatch(/(^|;)width:/);
    // Hug keeps its place: only its size comes from its contents, and margins don't move it.
    expect(styleOf(markup, 'Hugged')).toMatch(/left:40px;top:50px/);
    expect(styleOf(markup, 'Hugged')).toContain('height:max-content');
    expect(styleOf(markup, 'Fixed')).toMatch(/left:40px;top:50px/);
  });

  it('renders a saved hug on a layer without contents to hug as fixed', () => {
    const frame = makeNode('frame', { text: '', x: 30, y: 20, width: 90, height: 60, widthMode: 'hug', layout: 'absolute' });
    const label = makeNode('text', { parent: frame.id, text: 'Inside' });
    const markup = renderToStaticMarkup(<ComponentView component={{ ...starterTable().components[0], front: [frame, label] }} />);
    expect(markup).toMatch(/left:30px;top:20px;[^"]*width:90px/);
  });

  it('applies margins as spacing between flow children', () => {
    const row = makeNode('frame', { layout: 'row', width: 300 });
    const child = makeNode('text', { parent: row.id, text: 'Spaced', widthMode: 'fill', heightMode: 'fill', marginTop: 4, marginBottom: 6, marginLeft: 8 });
    const markup = renderToStaticMarkup(<ComponentView component={{ ...starterTable().components[0], front: [row, child] }} />);
    expect(styleOf(markup, 'Spaced')).toContain('margin-top:4px;margin-right:0;margin-bottom:6px;margin-left:8px');
    expect(styleOf(markup, 'Spaced')).toContain('height:calc(100% - 10px)');
  });
});
