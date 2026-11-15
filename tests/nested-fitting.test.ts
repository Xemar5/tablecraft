import { describe, expect, it } from 'vitest';
import { makeNode, nodeSchema } from '../src/domain';
import { exportComponentBundle, parseComponentBundle } from '../src/storage';
import { template } from '../src/templates';

describe('nested fitting', () => {
  it('defaults legacy layers to stretch and validates fitting modes', () => {
    const node = makeNode('component');
    const { nestedFit: _fit, ...legacy } = node;
    expect(nodeSchema.parse(legacy).nestedFit).toBe('stretch');
    for (const nestedFit of ['stretch', 'contain', 'cover'] as const) {
      expect(nodeSchema.parse(makeNode('component', { nestedFit })).nestedFit).toBe(nestedFit);
    }
    expect(() => nodeSchema.parse({ ...node, nestedFit: 'unknown' })).toThrow();
  });
  it('preserves fitting through portable component bundles', () => {
    const art = template('artwork'), parent = template('blank');
    parent.front = [makeNode('component', { componentId: art.id, nestedFit: 'cover' })];
    const bundle = exportComponentBundle(parent, [parent, art]);
    const parsed = parseComponentBundle(JSON.stringify(bundle));
    expect(parsed.components.find(c => c.id === parent.id)?.front[0].nestedFit).toBe('cover');
  });
});
