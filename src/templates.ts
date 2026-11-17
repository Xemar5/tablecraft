import { bind, makeInstance, makeNode, uid, type Component, type DesignNode, type Project } from './domain';

const cardRows = [
  { id: 'fern', name: 'Forest guardian', type: 'WOODLAND SPIRIT', cost: '3', power: '4', description: 'When played, draw a card.\nThe forest remembers its own.', art: 'fern' },
  { id: 'moon', name: 'Moonlit passage', type: 'ANCIENT MAGIC', cost: '2', power: '2', description: 'Move a spirit to any clearing.\nFollow the light between the trees.', art: 'moon' },
  { id: 'sun', name: 'Golden harvest', type: 'SEASONAL RITUAL', cost: '1', power: '3', description: 'Gain two amber tokens.\nA little sunlight goes a long way.', art: 'sun' },
  { id: 'oak', name: 'The elder oak', type: 'WOODLAND SPIRIT', cost: '5', power: '7', description: 'Protect all adjacent spirits.\nDeep roots. Quiet strength.', art: 'fern' },
  { id: 'seed', name: 'A new beginning', type: 'SEASONAL RITUAL', cost: '1', power: '1', description: 'Return a spirit to your hand.\nEvery story starts with a seed.', art: 'sun' },
  { id: 'night', name: 'Night wanderer', type: 'WOODLAND SPIRIT', cost: '4', power: '5', description: 'Look at the top three cards.\nNot all who wander are lost.', art: 'moon' },
];

export type TemplateKind = Exclude<Component['kind'], 'texture' | 'font'> | 'blank';
export function template(kind: TemplateKind): Component {
  const base: Component = {
    id: uid('component'), name: 'Untitled component', kind: kind === 'blank' ? 'card' : kind,
    width: 220, height: 308, color: '#e9e5d7', front: [], back: [],
    csv: '', rows: [], flippable: true, hand: true, hideInHand: true,
    stackable: true, shufflable: true, stackTag: '',
  };
  if (kind === 'blank') return base;
  if (kind === 'artwork') {
    Object.assign(base, { name: 'Untitled artwork', width: 200, height: 200, color: 'transparent',
      flippable: false, hand: false, hideInHand: false, stackable: false, shufflable: false });
  } else if (kind === 'card') {
    base.name = 'Spirit cards';
    base.rows = cardRows;
    base.csv = 'id,name,type,cost,power,description,art\n' + cardRows.map(r => [r.id, r.name, r.type, r.cost, r.power, `"${r.description}"`, r.art].join(',')).join('\n');
    base.front = [
      makeNode('shape', { name: 'Card border', x: 6, y: 6, width: 208, height: 296, fill: '#e9e5d7', radius: 10 }),
      makeNode('shape', { name: 'Illustration', x: 14, y: 14, width: 192, height: 168, fill: '#294c40', radius: 6, text: '{{art}}' }),
      makeNode('shape', { name: 'Cost badge', x: 24, y: 24, width: 30, height: 30, fill: '#e9dcb6', radius: 30 }),
      makeNode('text', { name: 'Cost', x: 24, y: 26, width: 30, height: 26, text: '{{cost}}', fontSize: 17, align: 'center' }),
      makeNode('text', { name: 'Card name', x: 18, y: 193, width: 186, height: 27, text: '{{name}}', fontSize: 20, font: 'Lora' }),
      makeNode('text', { name: 'Type', x: 18, y: 224, width: 184, height: 18, text: '{{type}}', fontSize: 8, color: '#7d806c' }),
      makeNode('text', { name: 'Rules text', x: 18, y: 247, width: 164, height: 44, text: '{{description}}', fontSize: 10, color: '#666e60' }),
      makeNode('text', { name: 'Power', x: 183, y: 268, width: 23, height: 26, text: '{{power}}', fontSize: 21, font: 'Lora', align: 'center' }),
    ];
    base.back = [
      makeNode('shape', { name: 'Back field', x: 0, y: 0, width: 220, height: 308, fill: '#294c40', radius: 12, text: 'fern' }),
      makeNode('text', { name: 'Back title', x: 15, y: 225, width: 190, height: 28, text: 'W I L D W O O D', color: '#e8d8ae', font: 'Lora', fontSize: 16, align: 'center' }),
    ];
  } else if (kind === 'token') {
    Object.assign(base, { name: 'Amber token', width: 80, height: 80, color: '#dbb66a', flippable: false, hideInHand: false, shufflable: false, stackTag: 'amber' });
    base.front = [
      makeNode('shape', { name: 'Token face', x: 3, y: 3, width: 74, height: 74, radius: 50, fill: '#e6bc6c', text: 'sun' }),
    ];
  } else if (kind === 'board') {
    Object.assign(base, { name: 'Forest clearing', width: 640, height: 420, color: '#263e35', flippable: false, hand: false, hideInHand: false, stackable: false, shufflable: false });
    base.front = [
      makeNode('shape', { name: 'Clearing', x: 12, y: 12, width: 616, height: 396, radius: 200, fill: '#304c3e', text: 'fern' }),
      makeNode('text', { name: 'Board title', x: 160, y: 34, width: 320, height: 44, text: 'THE CLEARING', font: 'Lora', fontSize: 25, color: '#d8d6b7', align: 'center' }),
    ];
  } else {
    Object.assign(base, { name: 'Spirit die', width: 70, height: 70, color: '#e9e5d7', flippable: false, hand: false, stackable: false });
    base.front = [makeNode('text', { name: 'Value', x: 0, y: 5, width: 70, height: 60, text: '{{value}}', fontSize: 42, align: 'center' })];
    base.rows = Array.from({ length: 6 }, (_, i) => ({ value: String(i + 1) }));
    base.csv = 'value\n1\n2\n3\n4\n5\n6';
  }
  return base;
}

// Convert the old shape-text illustration convention into ordinary, editable
// vector components. The original shape and text are retained inside a frame.
function botanicalComponent(variant: string, expression: string, sourceRows: Component['rows'], createId: (prefix: string) => string): Component {
  const artwork: Component = { id: createId('component'), name: `Botanical artwork (${variant})`, kind: 'artwork',
    width: 200, height: 180, color: 'transparent', front: [], back: [], csv: '', rows: [],
    flippable: false, hand: false, hideInHand: false, stackable: false, shufflable: false, stackTag: '' };
  if (expression) {
    const fields = [...new Set(Array.from(expression.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g), match => match[1]))];
    artwork.rows = ['fern', 'moon', 'sun'].flatMap(value => {
      const sample = sourceRows.find(row => bind(expression, row) === value);
      return sample ? [Object.fromEntries(fields.map(field => [field, sample[field] ?? '']))] : [];
    });
    const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    artwork.csv = [fields.map(csvCell).join(','), ...artwork.rows.map(row => fields.map(field => csvCell(row[field])).join(','))].join('\n');
  }
  const add = (name: string, values: Partial<DesignNode>, visible: string) => artwork.front.push(makeNode('shape', {
    id: createId('layer'), name, fill: '#b5c391', ...values, ...(expression ? { visibilityField: expression, visibilityValue: visible } : {}),
  }));
  const variants = expression ? ['fern', 'moon', 'sun'] : [variant];
  if (variants.includes('fern')) {
    add('Stem', { x: 98, y: 27, width: 3, height: 148, rotation: 3 }, 'fern');
    for (let i = 0; i < 7; i++) {
      const y = 35 + i * 17, w = 22 + Math.sin(i / 7 * Math.PI) * 27;
      add(`Left leaf ${i + 1}`, { shapeKind: 'ellipse', x: 98 - w, y, width: w, height: 13, rotation: 32, opacity: .7 + i * .04 }, 'fern');
      add(`Right leaf ${i + 1}`, { shapeKind: 'ellipse', x: 100, y: y - 4, width: w, height: 13, rotation: -32, opacity: .7 + i * .04 }, 'fern');
    }
    [[45, 37], [151, 71], [143, 146]].forEach(([x, y], i) => add(`Star ${i + 1}`, { shapeKind: 'ellipse', x, y, width: 4, height: 4, fill: '#e1cf9e' }, 'fern'));
  }
  if (variants.includes('moon')) {
    add('Moon', { shapeKind: 'ellipse', x: 64, y: 34, width: 72, height: 72, fill: '#d9d9b2' }, 'moon');
    add('Moon shadow', { shapeKind: 'ellipse', x: 82, y: 25, width: 66, height: 66, fill: '#294c40' }, 'moon');
    [30, 60, 135, 162].forEach((x, i) => add(`Tree ${i + 1}`, { shapeKind: 'polygon', sides: 3, x, y: 70 + i * 4, width: 12, height: 28, opacity: .45 }, 'moon'));
  }
  if (variants.includes('sun')) {
    add('Sun', { shapeKind: 'ellipse', x: 68, y: 50, width: 64, height: 64, fill: '#ead39a' }, 'sun');
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      add(`Sun ray ${i + 1}`, { x: 99 + Math.sin(angle) * 60, y: 74 - Math.cos(angle) * 60,
        width: 2, height: 15, rotation: i * 30, fill: '#ead39a' }, 'sun');
    }
  }
  return artwork;
}

export function upgradeLegacyArtwork(components: Component[]): Component[] {
  const dependencies: Component[] = [];
  const used = new Set(components.flatMap(component => [component.id, ...component.front.map(node => node.id), ...component.back.map(node => node.id)]));
  let changed = false;
  const upgraded = components.map(component => {
    const upgradeFace = (nodes: DesignNode[]) => nodes.flatMap(node => {
      if (node.type !== 'shape' || node.shapeKind !== 'rectangle' || !node.text) return [node];
      if (nodes.some(parent => parent.id === node.parent && parent.type === 'frame' && parent.text === 'tablecraft:legacy-artwork-upgraded')) return [node];
      if (nodes.some(parent => parent.id === node.parent && parent.type === 'compound')) return [node];
      const expression = node.text.includes('{{') ? node.text : '';
      const variants = expression ? component.rows.map(row => bind(node.text, row)) : [node.text];
      if (!variants.some(value => ['fern', 'moon', 'sun'].includes(value))) return [node];
      changed = true;
      // Deterministic and collision-safe in reducers: no randomness, wall clock or browser APIs.
      let hash = 2166136261;
      for (const char of `${component.id}\0${node.id}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
      let sequence = 0;
      const createId = (prefix: string) => {
        let id: string;
        do { id = `${prefix}-legacy-${hash.toString(16)}-${sequence++}`; } while (used.has(id));
        used.add(id); return id;
      };
      const artwork = botanicalComponent(variants.find(value => ['fern', 'moon', 'sun'].includes(value))!, expression, component.rows, createId);
      dependencies.push(artwork);
      const frame = makeNode('frame', { id: createId('layer'), name: `${node.name} artwork`.slice(0, 100), x: node.x, y: node.y, width: node.width, height: node.height,
        parent: node.parent, rotation: node.rotation, opacity: node.opacity, fill: 'transparent', layout: 'absolute',
        widthMode: node.widthMode, heightMode: node.heightMode, padding: 0, text: 'tablecraft:legacy-artwork-upgraded' });
      const original = { ...node, parent: frame.id, x: 0, y: 0, rotation: 0, opacity: 1, widthMode: 'fixed' as const, heightMode: 'fixed' as const };
      const linked = makeNode('component', { id: createId('layer'), name: artwork.name, parent: frame.id, x: 0, y: 0, width: node.width, height: node.height,
        componentId: artwork.id, fill: 'transparent', dataSource: 'inherit' });
      return [frame, original, linked];
    });
    return { ...component, front: upgradeFace(component.front), back: upgradeFace(component.back) };
  });
  return changed ? [...dependencies, ...upgraded] : components;
}

export function upgradeLegacyArtworkProject(project: Project): Project {
  const components = upgradeLegacyArtwork(project.components);
  return components === project.components ? project : { ...project, components };
}

export function templateBundle(kind: TemplateKind): { root: Component; components: Component[] } {
  const initial = template(kind);
  const components = upgradeLegacyArtwork([initial]);
  return { root: components.find(item => item.id === initial.id)!, components };
}

export function starterProject(): Project {
  const bundles = (['card', 'token', 'board', 'dice'] as const).map(templateBundle);
  const [card, token, board, die] = bundles.map(bundle => bundle.root);
  const deck = Array.from({ length: 12 }, (_, n) => ({
    ...makeInstance(card.id, n % 6, 600, 400), stack: 'starter-deck', order: n, flipped: true, scale: 0.72,
  }));
  return {
    id: uid('project'), name: 'Wildwood', description: 'A little magic. A lot of possibility.',
    components: [...bundles.map(bundle => bundle.root), ...bundles.flatMap(bundle => bundle.components.filter(item => item.id !== bundle.root.id))],
    instances: [
      { ...makeInstance(board.id, 0, 1050, 430), scale: 0.85, locked: true },
      ...deck,
      ...[0, 1, 2].map((row, i) => ({ ...makeInstance(card.id, row, 810 + i * 185, 460 + (i % 2) * 22), scale: 0.72, rotation: (i - 1) * 5 })),
      ...Array.from({ length: 5 }, (_, i) => ({ ...makeInstance(token.id, 0, 790 + i * 62, 740), scale: 0.65 })),
      { ...makeInstance(die.id, 3, 1200, 720), scale: 0.85, rotation: 12 },
    ],
    players: [
      { id: 'player-1', owner: 'local', name: 'Player 1', color: '#b7cc91', x: 980, y: 1000, rotation: 0 },
      { id: 'player-2', owner: 'local', name: 'Player 2', color: '#ce9e7b', x: 980, y: 100, rotation: 180 },
    ],
    settings: { grid: true, snap: false, gridSize: 25, hands: true, turns: false, turn: 0 },
  };
}

export function blankProject(name = 'Untitled project', description = '', profile = { name: 'Player 1', color: '#b7cc91' }): Project {
  return {
    id: uid('project'), name, description, components: [], instances: [],
    players: [{ id: uid('player'), owner: 'local', name: profile.name, color: profile.color, x: 980, y: 1000, rotation: 0 }],
    settings: { grid: true, snap: false, gridSize: 25, hands: true, turns: false, turn: 0 },
  };
}
