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

  it('ignores x/y on hug and fill axes in absolute parents and insets them by margins', () => {
    const fill = makeNode('text', { text: 'Filled', x: 40, y: 50, widthMode: 'fill', marginLeft: 10, marginRight: 20 });
    const hug = makeNode('text', { text: 'Hugged', x: 40, y: 50, heightMode: 'hug', marginTop: 7 });
    const fixed = makeNode('text', { text: 'Fixed', x: 40, y: 50, marginLeft: 99 });
    const markup = renderToStaticMarkup(<ComponentView component={{ ...starterTable().components[0], front: [fill, hug, fixed] }} />);
    expect(styleOf(markup, 'Filled')).toMatch(/left:10px;right:20px;top:50px/);
    expect(styleOf(markup, 'Filled')).not.toMatch(/(^|;)width:/);
    expect(styleOf(markup, 'Hugged')).toMatch(/left:40px;top:7px/);
    expect(styleOf(markup, 'Hugged')).toContain('height:max-content');
    expect(styleOf(markup, 'Fixed')).toMatch(/left:40px;top:50px/);
  });

  it('applies margins as spacing between flow children', () => {
    const row = makeNode('frame', { layout: 'row', width: 300 });
    const child = makeNode('text', { parent: row.id, text: 'Spaced', widthMode: 'fill', heightMode: 'fill', marginTop: 4, marginBottom: 6, marginLeft: 8 });
    const markup = renderToStaticMarkup(<ComponentView component={{ ...starterTable().components[0], front: [row, child] }} />);
    expect(styleOf(markup, 'Spaced')).toContain('margin-top:4px;margin-right:0;margin-bottom:6px;margin-left:8px');
    expect(styleOf(markup, 'Spaced')).toContain('height:calc(100% - 10px)');
  });
});
