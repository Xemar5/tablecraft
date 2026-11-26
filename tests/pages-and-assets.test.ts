import { describe, expect, it } from 'vitest';
import { applyCommand, assetFontFamily, assetUrl, makeInstance, makeNode, namedAssetReferences, resolveFontFamily, resolveImage, uniqueAssetName, withUniqueAssetNames, type Component } from '../src/domain';
import { exportComponentBundle, remapComponentBundle } from '../src/storage';
import { blankProject, templateBundle } from '../src/templates';
import { starterTable } from './fixtures';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const asset = (id: string, name: string, kind: 'texture' | 'font' = 'texture'): Component => ({
  id, name, kind, width: 200, height: 200, color: 'transparent', front: [], back: [], csv: '', rows: [],
  flippable: false, hand: false, hideInHand: false, stackable: false, shufflable: false, stackTag: '',
  asset: kind === 'texture' ? { name: `${name}.png`, mime: 'image/png', data: PNG } : { name: `${name}.ttf`, mime: 'font/ttf', data: 'AAEAAAAKAIAAAwAg' },
});

describe('books and dice pages', () => {
  it('turns book pages within the book and steps dice faces around, as shared undoable commands', () => {
    const book = templateBundle('book').root;
    expect(book).toMatchObject({ kind: 'book', stackable: false, hand: false });
    expect(book.rows.length).toBe(3);
    const p = starterTable();
    const die = p.instances.find(i => p.components.find(c => c.id === i.componentId)?.kind === 'dice')!;
    let next = applyCommand({ ...p, components: [...p.components, book] }, { type: 'spawn', instances: [{ ...makeInstance(book.id), id: 'book' }] });
    next = applyCommand(next, { type: 'cycleVariant', ids: ['book'], delta: -1 });
    expect(next.instances.find(i => i.id === 'book')!.row).toBe(0);
    next = applyCommand(next, { type: 'cycleVariant', ids: ['book'], delta: 1 });
    next = applyCommand(next, { type: 'cycleVariant', ids: ['book'], delta: 5 });
    expect(next.instances.find(i => i.id === 'book')!.row).toBe(2);
    next = applyCommand(next, { type: 'cycleVariant', ids: [die.id], delta: 3 });
    expect(next.instances.find(i => i.id === die.id)!.row).toBe(0);
    next = applyCommand(next, { type: 'cycleVariant', ids: [die.id], delta: -1 });
    expect(next.instances.find(i => i.id === die.id)!.row).toBe(5);
    const card = p.instances.find(i => !i.stack && p.components.find(c => c.id === i.componentId)?.kind === 'card')!;
    expect(() => applyCommand(next, { type: 'cycleVariant', ids: [card.id], delta: 1 })).toThrow('Only books and dice');
    expect(() => applyCommand(next, { type: 'move', ids: [die.id], patch: { locked: true } })).not.toThrow();
    const locked = applyCommand(next, { type: 'move', ids: [die.id], patch: { locked: true } });
    expect(() => applyCommand(locked, { type: 'cycleVariant', ids: [die.id], delta: 1 })).toThrow('Unlock');
  });

  it('removes book pages like dice variants, remapping placed books', () => {
    const book = templateBundle('book').root;
    let p = applyCommand({ ...blankProject(), components: [book] }, { type: 'spawn', instances: [{ ...makeInstance(book.id, 2), id: 'b' }] });
    p = applyCommand(p, { type: 'component', component: { ...book, rows: book.rows.slice(0, 2) }, removedDataRow: 2 });
    expect(p.instances[0].row).toBe(1);
  });
});

describe('asset names and bindings', () => {
  it('keeps imported texture and font names unique', () => {
    const p = { ...blankProject(), components: [asset('wood', 'Wood'), asset('serif', 'Serif', 'font')] };
    expect(uniqueAssetName('wood', p.components)).toBe('wood 2');
    expect(uniqueAssetName('Serif', [...p.components, asset('x', 'Serif 2')])).toBe('Serif 3');
    expect(uniqueAssetName('Stone', p.components)).toBe('Stone');
    expect(() => applyCommand(p, { type: 'addComponents', components: [asset('wood-2', ' WOOD ')] })).toThrow('unique name');
    expect(() => applyCommand(p, { type: 'component', component: { ...p.components[1], name: 'wood' } })).toThrow('unique name');
    const renamed = withUniqueAssetNames([asset('a', 'Wood'), asset('b', 'Wood'), makeCard()], p.components);
    expect(renamed.map(c => c.name)).toEqual(['Wood 2', 'Wood 3', 'Card']);
    expect(applyCommand(p, { type: 'addComponents', components: renamed }).components).toHaveLength(5);
  });

  it('picks textures and fonts by name, through bindings or {{asset-name}}', () => {
    const wood = asset('wood', 'Wood'), stone = asset('stone', 'Stone'), serif = asset('serif', 'Fancy Serif', 'font');
    const catalog = new Map([wood, stone, serif].map(c => [c.id, c]));
    const image = makeNode('image', { text: '{{art}}' });
    expect(resolveImage(image, { art: 'stone' }, catalog)).toBe(assetUrl(stone));
    expect(resolveImage(image, { art: 'https://example.com/a.png' }, catalog)).toBe('https://example.com/a.png');
    expect(resolveImage(image, { art: 'missing' }, catalog)).toBeUndefined();
    expect(resolveImage(makeNode('image', { text: '{{Wood}}' }), {}, catalog)).toBe(assetUrl(wood));
    expect(resolveImage(makeNode('image', { text: 'Wood' }), {}, catalog)).toBe(assetUrl(wood));
    expect(resolveImage(makeNode('image', { text: '{{art}}', textureId: 'wood' }), { art: 'stone' }, catalog)).toBe(assetUrl(wood));
    const text = makeNode('text', { font: '{{font}}' });
    expect(resolveFontFamily(text, { font: 'fancy serif' }, catalog)).toBe(assetFontFamily(serif));
    expect(resolveFontFamily(text, { font: 'Lora' }, catalog)).toBe('Lora');
    expect(resolveFontFamily(makeNode('text', { font: '{{Fancy Serif}}' }), {}, catalog)).toBe(assetFontFamily(serif));
    expect(resolveFontFamily(text, {}, catalog)).toBe('DM Sans');
  });

  it('exports textures a component picks by name with its bundle', () => {
    const wood = asset('wood', 'Wood'), stone = asset('stone', 'Stone'), unused = asset('unused', 'Unused');
    const card = { ...makeCard(), rows: [{ art: 'Wood' }, { art: 'Stone' }], front: [makeNode('image', { text: '{{art}}' })] };
    expect(namedAssetReferences(card, [wood, stone, unused]).sort()).toEqual(['stone', 'wood']);
    const bundle = exportComponentBundle(card, [wood, stone, unused, card]);
    expect(bundle.components.map(c => c.id)).toEqual(['wood', 'stone', 'card']);
    const remapped = remapComponentBundle(bundle);
    expect(remapped.components.map(c => c.name)).toEqual(['Wood', 'Stone', 'Card']);
  });
});

function makeCard(): Component {
  return { id: 'card', name: 'Card', kind: 'card', width: 100, height: 140, color: '#fff', front: [], back: [], csv: '', rows: [],
    flippable: false, hand: true, hideInHand: false, stackable: true, shufflable: true, stackTag: '' };
}
