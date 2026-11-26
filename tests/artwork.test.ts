import { describe, expect, it } from 'vitest';
import { applyCommand, componentSchema, makeNode, validateProject, type Component, type Project } from '../src/domain';
import { exportComponentBundle, parseComponentBundle, remapComponentBundle } from '../src/storage';
import { template, templateBundle } from '../src/templates';
import { starterTable } from './fixtures';

function project(components: Component[]): Project {
  return { ...starterTable(), components, instances: [] };
}

describe('Artwork components', () => {
  it('creates a blank transparent vector canvas without tabletop capabilities', () => {
    const artwork = componentSchema.parse(template('artwork'));
    expect(artwork).toMatchObject({
      kind: 'artwork', width: 200, height: 200, color: 'transparent', front: [], back: [],
      rows: [], csv: '', hand: false, hideInHand: false, flippable: false,
      stackable: false, shufflable: false, stackTag: '',
    });
    const bundle = templateBundle('artwork');
    expect(bundle.components).toEqual([bundle.root]);
    expect(validateProject(project(bundle.components)).components[0].kind).toBe('artwork');
  });

  it('preserves existing blank and tabletop template defaults', () => {
    expect(template('blank')).toMatchObject({ kind: 'card', width: 220, height: 308,
      flippable: true, hand: true, stackable: true, shufflable: true });
    expect(template('card').kind).toBe('card');
    expect(template('token')).toMatchObject({ kind: 'token', flippable: false, hand: true, stackable: true });
    expect(template('board')).toMatchObject({ kind: 'board', hand: false, stackable: false });
    expect(template('dice')).toMatchObject({ kind: 'dice', rows: Array.from({ length: 6 }, (_, i) => ({ value: String(i + 1) })) });
  });

  it('uses artwork for the linked botanical assets without retyping their parents', () => {
    for (const kind of ['card', 'token', 'board'] as const) {
      const bundle = templateBundle(kind);
      expect(bundle.root.kind).toBe(kind);
      const dependencies = bundle.components.filter(item => item.id !== bundle.root.id);
      expect(dependencies.length).toBeGreaterThan(0);
      expect(dependencies.every(item => item.kind === 'artwork' && item.color === 'transparent')).toBe(true);
      expect(dependencies.every(item => item.front.length > 0 && item.front.every(node => node.type === 'shape' || node.type === 'compound'))).toBe(true);
      validateProject(project(bundle.components));
    }
  });

  it('supports command creation, nested references and portable dependency round trips', () => {
    const artwork = template('artwork');
    artwork.front = [makeNode('shape', { shapeKind: 'ellipse', fill: '#ff0000' })];
    const card = template('blank');
    card.front = [makeNode('component', { componentId: artwork.id, fill: 'transparent' })];
    let game = applyCommand(project([]), { type: 'component', component: artwork });
    game = applyCommand(game, { type: 'component', component: card });
    const exported = exportComponentBundle(card, game.components);
    const remapped = remapComponentBundle(parseComponentBundle(JSON.stringify(exported)));
    const importedArt = remapped.components.find(item => item.kind === 'artwork')!;
    const importedCard = remapped.components.find(item => item.id === remapped.rootId)!;
    expect(importedArt.id).not.toBe(artwork.id);
    expect(importedCard.front[0].componentId).toBe(importedArt.id);
    expect(importedArt.front[0].fill).toBe('#ff0000');
    validateProject(project(remapped.components));
  });
});
