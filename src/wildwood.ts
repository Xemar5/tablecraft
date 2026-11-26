import { makeInstance, makeNode, uid, type Component, type DesignNode, type Instance, type PieceGroup, type Project } from './domain';
import type { Grid } from './grids';
import { filterFromTags } from './tags';

/**
 * Wildwood, the sample project a new workspace starts with, and the card, token, board and dice templates (**Add
 * component**), which are its components. It is a showcase: when Tablecraft gains a feature, add a small use of it here
 * (see AGENTS.md).
 *
 * Its botanical art is one artwork component with a fern, moon and sun variant (layers shown by the `art` field); the
 * cards, card back, token and board link it with **Fit inside**, so it keeps its shape in every frame.
 */

const ART_ROWS = [{ art: 'fern' }, { art: 'moon' }, { art: 'sun' }];
export const ART_VARIANTS = ART_ROWS.map(row => row.art);
const FOREST = '#294c40';

const cardRows = [
  { id: 'fern', name: 'Forest guardian', type: 'WOODLAND SPIRIT', cost: '3', power: '4', description: 'When played, draw a card.\nThe forest remembers its own.', art: 'fern' },
  { id: 'moon', name: 'Moonlit passage', type: 'ANCIENT MAGIC', cost: '2', power: '2', description: 'Move a spirit to any clearing.\nFollow the light between the trees.', art: 'moon' },
  { id: 'sun', name: 'Golden harvest', type: 'SEASONAL RITUAL', cost: '1', power: '3', description: 'Gain two amber tokens.\nA little sunlight goes a long way.', art: 'sun' },
  { id: 'oak', name: 'The elder oak', type: 'WOODLAND SPIRIT', cost: '5', power: '7', description: 'Protect all adjacent spirits.\nDeep roots. Quiet strength.', art: 'fern' },
  { id: 'seed', name: 'A new beginning', type: 'SEASONAL RITUAL', cost: '1', power: '1', description: 'Return a spirit to your hand.\nEvery story starts with a seed.', art: 'sun' },
  { id: 'night', name: 'Night wanderer', type: 'WOODLAND SPIRIT', cost: '4', power: '5', description: 'Look at the top three cards.\nNot all who wander are lost.', art: 'moon' },
];

const guidePages = [
  { page: '1', title: 'Welcome to Wildwood', text: 'A small sample of what Tablecraft can do. Every piece here is an ordinary component: click a name in the library to open it in the designer.\n\nTurn pages with Shift+Q and Shift+E.' },
  { page: '2', title: 'At the table', text: 'Double-click the spirit deck to draw, or hover it and press 1–9. Hover the deck or the die and press R to shuffle or roll.\n\nThe clearing is locked, so you can box-select over it. Hover it and press L to unlock it.' },
  { page: '3', title: 'Designs', text: 'Spirit cards take their names, costs and art from CSV rows. The botanical art is one linked artwork with three variants, fitted inside cards, tokens and the board.\n\nThe moon is a live boolean shape, and each wanderer a union of two.' },
  { page: '4', title: 'Grids', text: 'The table has a faint square grid. The stepping stones of the Wanderer’s path are a points grid that only takes wanderers, by their grid tag: drop one near a stone and it snaps on.\n\nTurn on the Grids tool (under the select and pan tools) to edit both.' },
  { page: '5', title: 'Scripts and memory', text: 'Gather amber runs a Lua function from Scripting → Scripts. It draws from the amber supply, a stack that keeps its place even when empty, and counts in memory, which the Amber tally shows.\n\nWanderers announce the stone they reach.' },
  { page: '6', title: 'Make it yours', text: 'Change anything, add components from the library, or start a new game from Home.\n\nSave snapshots from Actions → Save/Load, and invite players to play together.' },
];

/** Path stones of the Wanderer's path board, from the start (bottom) to the heart of the wood (top), in board pixels. */
const STONES = [
  { name: 'Mossy hollow', x: 70, y: 500 }, { name: 'Fern ford', x: 98, y: 395 }, { name: 'Moon pool', x: 46, y: 290 },
  { name: 'Sun glade', x: 94, y: 185 }, { name: 'Heart of the wood', x: 70, y: 84 },
];
const PATH = { width: 140, height: 580 };

const WANDERERS = [
  { color: 'moss', name: 'Moss wanderer', fill: '#b7cc91', edge: '#4d6b3a' },
  { color: 'ember', name: 'Ember wanderer', fill: '#ce9e7b', edge: '#7a4a2c' },
];

/** The table script: the Gather amber button and the wanderers' announcements. */
export const WILDWOOD_SCRIPT = String.raw`-- Wildwood's table script: a small taste of scripting. Change it and press Save to try it out.
--
-- Gather amber (the button) draws an amber token from the amber supply into the hand of whoever pressed it (or the
-- current player) and counts it in memory.gathered, which the Amber tally card shows. A wanderer that comes to rest on
-- a stone of the Wanderer's path announces where it is.

local SUPPLY = "amber-supply"

function gatherAmber(button, player)
  local supply = game.stackOf(SUPPLY)
  if not supply or supply.count == 0 then
    game.announce("The amber supply is empty. Put some amber back on it.")
    return
  end
  local seat = player or game.currentPlayer() or game.players()[1]
  if not seat then
    game.announce("Add a seat in Players to gather amber.")
    return
  end
  game.draw(SUPPLY, seat, 1, true)
  memory.gathered = (memory.gathered or 0) + 1
  game.announce(seat.name .. " gathers amber.")
end

function onSnap(pieces, player)
  for _, piece in ipairs(pieces) do
    if piece.component == "Wanderer" and piece.snap and piece.snap.grid == "wanderers-path" then
      local stone
      for _, point in ipairs(game.gridPoints("wanderers-path")) do
        if point.point == piece.snap.point then stone = point end
      end
      if stone then game.announce(piece.data.name .. " reaches the " .. stone.label .. ".") end
    end
  end
end
`;

const outline = (points: [number, number][]) => points.map(([x, y]) => ({ x, y, inX: 0, inY: 0, outX: 0, outY: 0 }));
const when = (field: string, value: string): Partial<DesignNode> => ({ visibilityField: field, visibilityValue: value });
const csvCell = (value: string) => /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
const csv = (rows: Record<string, string>[]) => rows.length
  ? [Object.keys(rows[0]), ...rows.map(row => Object.keys(rows[0]).map(field => row[field] ?? ''))].map(line => line.map(csvCell).join(',')).join('\n') : '';

function component(name: string, kind: Component['kind'], width: number, height: number, values: Partial<Component> = {}): Component {
  const item: Component = { id: uid('component'), name, kind, width, height, color: 'transparent', front: [], back: [], csv: '', rows: [],
    flippable: false, hand: false, hideInHand: false, stackable: false, shufflable: false, stackTag: '', ...values };
  return { ...item, csv: csv(item.rows) };
}

/**
 * A layer showing the botanical art, fitted inside its box. Without `art` (a variant), it follows the parent's own `art`
 * field; without an art component it is an empty linked layer to choose one for.
 */
function artLayer(artId: string | undefined, values: Partial<DesignNode>, art?: string): DesignNode {
  return makeNode('component', { name: 'Art', fill: 'transparent', nestedFit: 'contain', ...values, ...artId ? { componentId: artId } : {},
    ...art ? { dataSource: 'row', dataRow: ART_VARIANTS.indexOf(art) } : { dataSource: 'inherit' } });
}

/** The fern, moon and sun drawings: one artwork component whose `art` field picks the variant. */
export function botanicalArt(): Component {
  const front: DesignNode[] = [];
  const add = (name: string, art: string, values: Partial<DesignNode>) => {
    const node = makeNode('shape', { name, fill: '#b5c391', ...values, ...when('art', art) });
    front.push(node);
    return node;
  };
  add('Stem', 'fern', { x: 98, y: 27, width: 3, height: 148, rotation: 3 });
  for (let i = 0; i < 7; i++) {
    const y = 35 + i * 17, w = 22 + Math.sin(i / 7 * Math.PI) * 27;
    add(`Left leaf ${i + 1}`, 'fern', { shapeKind: 'ellipse', x: 98 - w, y, width: w, height: 13, rotation: 32, opacity: .7 + i * .04 });
    add(`Right leaf ${i + 1}`, 'fern', { shapeKind: 'ellipse', x: 100, y: y - 4, width: w, height: 13, rotation: -32, opacity: .7 + i * .04 });
  }
  [[45, 37], [151, 71], [143, 146]].forEach(([x, y], i) => add(`Star ${i + 1}`, 'fern', { shapeKind: 'ellipse', x, y, width: 4, height: 4, fill: '#e1cf9e' }));
  // A true crescent: the shadow disc is cut out of the moon (a live Subtract compound), so it works on any background.
  const moon = makeNode('compound', { name: 'Moon', x: 64, y: 25, width: 84, height: 81, fill: '#d9d9b2', compoundOperation: 'subtract', ...when('art', 'moon') });
  front.push(moon,
    makeNode('shape', { name: 'Moon disc', parent: moon.id, shapeKind: 'ellipse', x: 0, y: 9, width: 72, height: 72, fill: '#d9d9b2' }),
    makeNode('shape', { name: 'Moon shadow', parent: moon.id, shapeKind: 'ellipse', x: 18, y: 0, width: 66, height: 66, fill: '#d9d9b2' }));
  [30, 60, 135, 162].forEach((x, i) => add(`Tree ${i + 1}`, 'moon', { shapeKind: 'polygon', sides: 3, x, y: 70 + i * 4, width: 12, height: 28, opacity: .45 }));
  add('Sun', 'sun', { shapeKind: 'ellipse', x: 68, y: 50, width: 64, height: 64, fill: '#ead39a' });
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    add(`Sun ray ${i + 1}`, 'sun', { x: 99 + Math.sin(angle) * 60, y: 74 - Math.cos(angle) * 60, width: 2, height: 15, rotation: i * 30, fill: '#ead39a' });
  }
  return component('Botanical artwork', 'artwork', 200, 180, { rows: ART_ROWS, front });
}

export function spiritCards(artId?: string): Component {
  return component('Spirit cards', 'card', 220, 308, {
    color: '#e9e5d7', flippable: true, hand: true, hideInHand: true, stackable: true, shufflable: true, stackTags: ['spirit'], rows: cardRows,
    front: [
      makeNode('shape', { name: 'Card border', x: 6, y: 6, width: 208, height: 296, fill: '#e9e5d7', radius: 10 }),
      makeNode('shape', { name: 'Illustration', x: 14, y: 14, width: 192, height: 168, fill: FOREST, radius: 6 }),
      artLayer(artId, { x: 22, y: 22, width: 176, height: 152 }),
      makeNode('shape', { name: 'Cost badge', x: 24, y: 24, width: 30, height: 30, fill: '#e9dcb6', radius: 30 }),
      makeNode('text', { name: 'Cost', x: 24, y: 26, width: 30, height: 26, text: '{{cost}}', fontSize: 17, align: 'center' }),
      makeNode('text', { name: 'Card name', x: 18, y: 193, width: 186, height: 27, text: '{{name}}', fontSize: 20, font: 'Lora' }),
      makeNode('text', { name: 'Type', x: 18, y: 224, width: 184, height: 18, text: '{{type}}', fontSize: 8, color: '#7d806c' }),
      makeNode('text', { name: 'Rules text', x: 18, y: 247, width: 164, height: 44, text: '{{description}}', fontSize: 10, color: '#666e60' }),
      makeNode('text', { name: 'Power', x: 183, y: 268, width: 23, height: 26, text: '{{power}}', fontSize: 21, font: 'Lora', align: 'center' }),
    ],
    back: [
      makeNode('shape', { name: 'Back field', x: 0, y: 0, width: 220, height: 308, fill: FOREST, radius: 12 }),
      artLayer(artId, { x: 30, y: 46, width: 160, height: 150 }, 'fern'),
      makeNode('text', { name: 'Back title', x: 15, y: 225, width: 190, height: 28, text: 'W I L D W O O D', color: '#e8d8ae', font: 'Lora', fontSize: 16, align: 'center' }),
    ],
  });
}

export function amberToken(artId?: string): Component {
  return component('Amber token', 'token', 80, 80, {
    color: '#d39b3a', hand: true, stackable: true, stackTags: ['amber'],
    front: [
      makeNode('shape', { name: 'Token face', shapeKind: 'ellipse', x: 3, y: 3, width: 74, height: 74, fill: '#d39b3a', stroke: '#a8722a', strokeWidth: 2 }),
      artLayer(artId, { x: 10, y: 12, width: 60, height: 54 }, 'sun'),
    ],
  });
}

export function forestClearing(artId?: string): Component {
  return component('Forest clearing', 'board', 640, 420, {
    color: '#263e35',
    front: [
      makeNode('shape', { name: 'Clearing', x: 12, y: 12, width: 616, height: 396, radius: 200, fill: '#304c3e' }),
      artLayer(artId, { x: 170, y: 70, width: 300, height: 300, opacity: .55 }, 'fern'),
      makeNode('text', { name: 'Board title', x: 160, y: 34, width: 320, height: 44, text: 'THE CLEARING', font: 'Lora', fontSize: 25, color: '#d8d6b7', align: 'center' }),
    ],
  });
}

export function spiritDie(): Component {
  const rows = Array.from({ length: 6 }, (_, i) => ({ value: String(i + 1) }));
  return component('Spirit die', 'dice', 70, 70, {
    color: '#e9e5d7', hideInHand: true, shufflable: true, rows,
    front: [makeNode('text', { name: 'Value', x: 0, y: 5, width: 70, height: 60, text: '{{value}}', fontSize: 42, align: 'center' })],
  });
}

/** A walker: a head and a body joined by a live Union, one per seat colour. */
function wanderer(): Component {
  const front = WANDERERS.flatMap(({ color, name, fill, edge }) => {
    const figure = makeNode('compound', { name, x: 2, y: 1, width: 40, height: 52, fill, stroke: edge, strokeWidth: 1.5, compoundOperation: 'union', ...when('color', color) });
    return [figure,
      makeNode('shape', { name: 'Head', parent: figure.id, shapeKind: 'ellipse', x: 11, y: 0, width: 18, height: 18, fill }),
      makeNode('shape', { name: 'Body', parent: figure.id, shapeKind: 'path', x: 0, y: 14, width: 40, height: 38, fill,
        points: outline([[20, 0], [32, 6], [40, 38], [24, 38], [20, 26], [16, 38], [0, 38], [8, 6]]) })];
  });
  return component('Wanderer', 'token', 44, 54, { gridTags: ['wanderer'], rows: WANDERERS.map(({ name, color }) => ({ name, color })), front, back: front.map(node => ({ ...node })) });
}

function wanderersPath(): Component {
  const trail = STONES.map(stone => [stone.x, stone.y] as [number, number]);
  const front: DesignNode[] = [
    makeNode('shape', { name: 'Ground', x: 6, y: 6, width: PATH.width - 12, height: PATH.height - 12, radius: 18, fill: '#304c3e' }),
    makeNode('shape', { name: 'Trail', shapeKind: 'path', pathClosed: false, x: 0, y: 0, width: PATH.width, height: PATH.height, fill: 'transparent', stroke: '#d8c48f66', strokeWidth: 5,
      // A smooth trail: each stone's handles run up and down the board.
      points: trail.map(([x, y], index) => ({ x, y, inX: 0, inY: index ? 40 : 0, outX: 0, outY: index < trail.length - 1 ? -40 : 0 })) }),
    ...STONES.map((stone, index) => makeNode('shape', { name: `Stone ${index + 1}`, shapeKind: 'ellipse', x: stone.x - 20, y: stone.y - 16, width: 40, height: 32, fill: '#566b5c', stroke: '#d8c48f', strokeWidth: 1.5 })),
    makeNode('text', { name: 'Title', x: 10, y: 18, width: PATH.width - 20, height: 30, text: 'THE WANDERER’S\nPATH', font: 'Lora', fontSize: 11, lineHeight: 1.2, letterSpacing: 1, color: '#d8d6b7', align: 'center' }),
  ];
  return component('Wanderer’s path', 'board', PATH.width, PATH.height, { color: '#263e35', front });
}

function wanderersGuide(): Component {
  return component('Wanderer’s guide', 'book', 240, 320, {
    color: '#f3eedf', rows: guidePages,
    front: [
      makeNode('shape', { name: 'Page edge', x: 8, y: 8, width: 224, height: 304, fill: 'transparent', stroke: '#c9bf9f', strokeWidth: 1.5, radius: 6 }),
      makeNode('text', { name: 'Chapter', x: 20, y: 24, width: 200, height: 16, text: 'THE WANDERER’S GUIDE', fontSize: 8, letterSpacing: 1.5, color: '#9a9172', align: 'center' }),
      makeNode('text', { name: 'Title', x: 20, y: 42, width: 200, height: 46, text: '{{title}}', fontSize: 18, lineHeight: 1.15, font: 'Lora', align: 'center', verticalAlign: 'center', color: '#24413a' }),
      makeNode('text', { name: 'Body', x: 24, y: 96, width: 192, height: 184, text: '{{text}}', fontSize: 10, lineHeight: 1.45, color: '#4e5b4f', align: 'start', verticalAlign: 'start' }),
      makeNode('text', { name: 'Page number', x: 90, y: 284, width: 60, height: 18, text: '{{page}}', fontSize: 9, color: '#9a9172', align: 'center' }),
    ],
  });
}

function gatherButton(): Component {
  return component('Gather amber', 'button', 150, 44, {
    color: '#365d46', action: 'gatherAmber',
    front: [makeNode('text', { name: 'Label', x: 0, y: 0, width: 150, height: 44, text: 'Gather amber', color: '#eef6e2', fontSize: 15, font: 'DM Sans', fontWeight: 600, align: 'center', verticalAlign: 'center' })],
  });
}

function amberTally(artId?: string): Component {
  return component('Amber tally', 'card', 150, 92, {
    color: '#f3eedf', previewWhenLocked: true,
    front: [
      makeNode('shape', { name: 'Sun disc', shapeKind: 'ellipse', x: 12, y: 22, width: 48, height: 48, fill: '#d39b3a' }),
      artLayer(artId, { x: 16, y: 26, width: 40, height: 40 }, 'sun'),
      makeNode('text', { name: 'Label', x: 66, y: 18, width: 76, height: 14, text: 'AMBER GATHERED', fontSize: 7, letterSpacing: 1.2, color: '#7d806c', align: 'start' }),
      // Bound to script memory: the number changes as Gather amber counts.
      makeNode('text', { name: 'Count', x: 66, y: 32, width: 76, height: 40, text: '{{memory.gathered}}', fontSize: 30, font: 'Lora', color: '#24413a', align: 'start', verticalAlign: 'center' }),
    ],
  });
}

export function wildwoodProject(): Project {
  const art = botanicalArt();
  const card = spiritCards(art.id), token = amberToken(art.id), board = forestClearing(art.id), die = spiritDie();
  const walker = wanderer(), path = wanderersPath(), guide = wanderersGuide(), button = gatherButton(), tally = amberTally(art.id);
  const deck = Array.from({ length: 12 }, (_, n) => ({
    ...makeInstance(card.id, n % 6, 600, 400), stack: 'starter-deck', order: n, flipped: true, scale: 0.72,
  }));
  const supply = { x: 600, y: 640 };
  const groups: PieceGroup[] = [
    { id: 'group-path', name: 'Wanderer’s path', parent: null, locked: true },
    { id: 'group-wanderers', name: 'Wanderers', parent: null },
    { id: 'group-guide', name: 'Guide and controls', parent: null },
  ];
  const pathAt = { x: 1500, y: 440 };
  const instances: Instance[] = [
    { ...makeInstance(board.id, 0, 1050, 430), scale: 0.85, locked: true },
    ...deck,
    ...[0, 1, 2].map((row, i) => ({ ...makeInstance(card.id, row, 810 + i * 185, 460 + (i % 2) * 22), scale: 0.72, rotation: (i - 1) * 5 })),
    ...Array.from({ length: 5 }, (_, i) => ({ ...makeInstance(token.id, 0, 790 + i * 62, 740), scale: 0.65 })),
    { ...makeInstance(die.id, 3, 1200, 720), scale: 0.85, rotation: 12 },
    // The amber supply: a persistent stack that keeps its place (and takes amber back) even when it runs out.
    ...Array.from({ length: 8 }, (_, n) => ({ ...makeInstance(token.id, 0, supply.x, supply.y), scale: 0.65, stack: 'amber-supply', order: n })),
    { ...makeInstance(path.id, 0, pathAt.x, pathAt.y), group: 'group-path' },
    ...WANDERERS.map((_, row) => ({ ...makeInstance(walker.id, row, pathAt.x - 26 + row * 52, pathAt.y + PATH.height / 2 + 40), group: 'group-wanderers' })),
    { ...makeInstance(guide.id, 0, 330, 420), scale: 0.6, group: 'group-guide' },
    { ...makeInstance(button.id, 0, 330, 590), locked: true, group: 'group-guide' },
    { ...makeInstance(tally.id, 0, 330, 680), locked: true, group: 'group-guide' },
  ];
  // The path's stones are a points grid that only takes wanderers; everything else carries the "table" grid tag, so
  // it snaps only to the square table grid (when its snapping is turned on). The stones are drawn on the path board,
  // which would cover the grid's own markers, so the grid is hidden (the Grids tool still shows it).
  const grids: Grid[] = [
    { id: 'wanderers-path', name: 'Wanderer’s path', shape: 'points', visible: false, snap: true, size: 50, offsetX: 0, offsetY: 0,
      filter: filterFromTags(['wanderer']),
      points: STONES.map((stone, index) => ({ id: `stone-${index + 1}`, label: stone.name,
        x: pathAt.x - PATH.width / 2 + stone.x, y: pathAt.y - PATH.height / 2 + stone.y })) },
    { id: 'table-grid', name: 'Table grid', shape: 'square', visible: true, snap: false, size: 25, offsetX: 0, offsetY: 0, color: '#7d9b6040' },
  ];
  const tableTag = (item: Component) => item.kind === 'artwork' || item.gridTags ? item : { ...item, gridTags: ['table'] };
  return {
    id: uid('project'), name: 'Wildwood', description: 'A little magic. A lot of possibility.',
    components: [card, token, board, die, art, walker, path, guide, button, tally].map(tableTag),
    instances,
    players: [
      { id: 'player-1', owner: 'local', name: 'Player 1', color: '#b7cc91', x: 980, y: 1000, rotation: 0 },
      { id: 'player-2', owner: 'local', name: 'Player 2', color: '#ce9e7b', x: 980, y: 100, rotation: 180 },
    ],
    groups, grids,
    stacks: [{ id: 'amber-supply', tag: '', filter: filterFromTags(['amber']), x: supply.x, y: supply.y, rotation: 0, scale: 0.65, componentId: token.id }],
    settings: { grid: true, snap: false, gridSize: 25, hands: true, turns: false, turn: 0 },
    scripts: [{ id: 'wildwood-script', name: 'Wildwood', source: WILDWOOD_SCRIPT }],
    memory: { gathered: 0 },
  };
}
