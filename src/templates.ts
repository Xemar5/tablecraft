import { bind, makeNode, uid, type Component, type DesignNode, type Project } from './domain';
import { amberToken, botanicalArt, forestClearing, spiritCards, spiritDie, wildwoodProject } from './wildwood';

const bookRows = [
  { page: '1', title: 'Welcome, wanderer', text: 'The forest is older than any map.\nRead on to learn its ways.' },
  { page: '2', title: 'Setting up', text: 'Place the clearing in the middle of the table. Shuffle the spirit deck and deal three cards to each player.' },
  { page: '3', title: 'Taking a turn', text: 'Play a card, gather amber, then pass the turn.\nTurn pages with Shift+Q and Shift+E.' },
];

export type TemplateKind = Exclude<Component['kind'], 'texture' | 'font'> | 'blank';
/** Kinds whose template shows the botanical art (a linked artwork component, see templateBundle). */
const ILLUSTRATED: readonly TemplateKind[] = ['card', 'token', 'board'];
/**
 * A new component of a kind, as **Add component** makes it: the card, token, board and dice templates are Wildwood's
 * own components (see src/wildwood.ts). Illustrated ones link the art component `artId`, or leave an empty linked layer.
 */
export function template(kind: TemplateKind, artId?: string): Component {
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
    return spiritCards(artId);
  } else if (kind === 'token') {
    return amberToken(artId);
  } else if (kind === 'board') {
    return forestClearing(artId);
  } else if (kind === 'button') {
    // Pressing a button on the table calls the script function chosen as its action.
    Object.assign(base, { name: 'Button', width: 170, height: 56, color: '#365d46', flippable: false, hand: false, hideInHand: false, stackable: false, shufflable: false });
    base.front = [makeNode('text', { name: 'Label', x: 0, y: 0, width: 170, height: 56, text: 'Press me', color: '#eef6e2', fontSize: 18, font: 'DM Sans', fontWeight: 600, align: 'center' })];
  } else if (kind === 'book') {
    Object.assign(base, { name: 'Field guide', width: 300, height: 400, color: '#f3eedf', flippable: false, hand: false, hideInHand: false, stackable: false, shufflable: false });
    base.rows = bookRows;
    base.csv = 'page,title,text\n' + bookRows.map(r => [r.page, r.title, `"${r.text}"`].join(',')).join('\n');
    base.front = [
      makeNode('shape', { name: 'Page edge', x: 10, y: 10, width: 280, height: 380, fill: 'transparent', stroke: '#c9bf9f', strokeWidth: 1.5, radius: 6 }),
      makeNode('text', { name: 'Chapter', x: 30, y: 34, width: 240, height: 22, text: 'WILDWOOD FIELD GUIDE', fontSize: 9, color: '#9a9172', align: 'center' }),
      makeNode('text', { name: 'Title', x: 30, y: 64, width: 240, height: 44, text: '{{title}}', fontSize: 26, font: 'Lora', align: 'center' }),
      makeNode('text', { name: 'Body', x: 34, y: 124, width: 232, height: 210, text: '{{text}}', fontSize: 13, color: '#4e5b4f', align: 'center' }),
      makeNode('text', { name: 'Page number', x: 120, y: 350, width: 60, height: 22, text: '{{page}}', fontSize: 11, color: '#9a9172', align: 'center' }),
    ];
  } else {
    return spiritDie();
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

/** A template with the components it links, dependencies first: the illustrated ones come with their own botanical art. */
export function templateBundle(kind: TemplateKind): { root: Component; components: Component[] } {
  if (!ILLUSTRATED.includes(kind)) { const root = template(kind); return { root, components: [root] }; }
  const art = botanicalArt(), root = template(kind, art.id);
  return { root, components: [art, root] };
}

/** The sample project a new workspace starts with (see src/wildwood.ts). */
export const starterProject = (): Project => wildwoodProject();

export function blankProject(name = 'Untitled project', description = '', profile = { name: 'Player 1', color: '#b7cc91' }): Project {
  return {
    id: uid('project'), name, description, components: [], instances: [],
    players: [{ id: uid('player'), owner: 'local', name: profile.name, color: profile.color, x: 980, y: 1000, rotation: 0 }],
    settings: { grid: true, snap: false, gridSize: 25, hands: true, turns: false, turn: 0 },
  };
}
