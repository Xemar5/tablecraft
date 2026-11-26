import { makeInstance, makeNode, uid, type Component, type DesignNode, type Instance, type PieceGroup, type Project } from './domain';
import type { ComponentGrid, Grid } from './grids';
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
  { id: 'oak', name: 'The elder oak of the deep wood', type: 'WOODLAND SPIRIT', cost: '5', power: '10', description: 'Protect all adjacent spirits.\nDeep roots. Quiet strength.', art: 'fern' },
  { id: 'seed', name: 'A new beginning', type: 'SEASONAL RITUAL', cost: '1', power: '1', description: 'Return a spirit to your hand.\nEvery story starts with a seed.', art: 'sun' },
  { id: 'night', name: 'Night wanderer', type: 'WOODLAND SPIRIT', cost: '4', power: '5', description: 'Look at the top three cards.\nNot all who wander are lost.', art: 'moon' },
];

const guidePages = [
  { page: '1', title: 'Welcome to Wildwood', text: 'A small sample of what Tablecraft can do. Every piece here is an ordinary component: click a name in the library to open it in the designer.\n\nTurn pages with Shift+Q and Shift+E.' },
  { page: '2', title: 'At the table', text: 'Double-click the spirit deck to draw, or hover it and press 1–9. Hover the deck or the die and press R to shuffle or roll.\n\nThe clearing is locked, so you can box-select over it. Hover it and press L to unlock it. The Guide and controls group has its order locked, so it keeps its place in the Pieces panel.' },
  { page: '3', title: 'Designs', text: 'Spirit cards take their names, costs and art from CSV rows. The botanical art is one linked artwork with three variants, fitted inside cards, tokens and the board.\n\nThe moon is a live boolean shape, each wanderer a union of two, and this page a vertical stack whose title hugs its text.' },
  { page: '4', title: 'Fitting text', text: 'Card names, rules and these pages use Auto font size: the text shrinks to fit its box, so The elder oak of the deep wood fits on one line.\n\nThe power number has its pivot at its bottom-right corner and hugs its digits, so a 10 grows to the left. Page numbers are pivoted at their bottom middle and stay centred.' },
  { page: '5', title: 'Grids', text: 'The table has a faint square grid (the Grids tool, under the select and pan tools, edits it). The stepping stones are a grid the Wanderer’s path board carries, so they travel with it: unlock and move the board, and they go along. It only takes wanderers, by their grid tag: drop one near a stone and it snaps on.\n\nOpen the path in the designer: its Stepping stones grid sits above its layers in the Layers panel. Select it to list its stones and see how close a wanderer must come to snap to each.' },
  { page: '6', title: 'Scripts and memory', text: 'Gather amber runs a Lua function from Scripting → Scripts. It draws from the amber supply, a stack that keeps its place even when empty, and counts in memory, which the Amber tally shows. Every fifth amber, the Amber milestone popup shows on the gatherer’s screen only (game.popup with players), filled in with data; its buttons run a script action.\n\nWanderers announce the stone they reach.' },
  { page: '7', title: 'Make it yours', text: 'Change anything, add components from the library, or start a new game from Home.\n\nSave snapshots from Actions → Save/Load, and invite players to play together.' },
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
-- current player) and counts it in memory.gathered, which the Amber tally card shows. Every fifth amber, the Amber
-- milestone popup shows on the gatherer's screen alone. A wanderer that comes to rest on a stone of the Wanderer's path
-- announces where it is.

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
  if memory.gathered % 5 == 0 then
    -- A popup only the gatherer sees (players), its {{name}} and {{count}} fields filled in by data.
    game.popup("Amber milestone", { players = seat, data = { name = seat.name, count = memory.gathered } })
  end
end

-- The Amber milestone popup's script action: clicking one of its layers runs it with that layer's name.
function amberMilestone(popup, player, layer)
  if layer == "Share" then
    game.announce(player.name .. " has gathered " .. popup.data.count .. " amber!")
  end
  if layer == "Share" or layer == "Keep gathering" then
    game.closePopup(popup.id, player)
  end
end

function onSnap(pieces, player)
  for _, piece in ipairs(pieces) do
    -- The stones are a grid on the path board; each stone's label names it.
    if piece.component == "Wanderer" and piece.snap and piece.snap.label then
      game.announce(piece.data.name .. " reaches the " .. piece.snap.label .. ".")
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

const ART_SIZE = { width: 200, height: 180 };
type Art = 'fern' | 'moon' | 'sun';

/** One botanical drawing's layers, in a 200 × 180 box (a compound's sources are its children). */
function artShapes(art: Art): DesignNode[] {
  const shape = (name: string, values: Partial<DesignNode>) => makeNode('shape', { name, fill: '#b5c391', ...values });
  if (art === 'fern') {
    return [
      shape('Stem', { x: 98, y: 27, width: 3, height: 148, rotation: 3 }),
      ...Array.from({ length: 7 }, (_, i) => {
        const y = 35 + i * 17, w = 22 + Math.sin(i / 7 * Math.PI) * 27;
        return [
          shape(`Left leaf ${i + 1}`, { shapeKind: 'ellipse', x: 98 - w, y, width: w, height: 13, rotation: 32, opacity: .7 + i * .04 }),
          shape(`Right leaf ${i + 1}`, { shapeKind: 'ellipse', x: 100, y: y - 4, width: w, height: 13, rotation: -32, opacity: .7 + i * .04 }),
        ];
      }).flat(),
      ...[[45, 37], [151, 71], [143, 146]].map(([x, y], i) => shape(`Star ${i + 1}`, { shapeKind: 'ellipse', x, y, width: 4, height: 4, fill: '#e1cf9e' })),
    ];
  }
  if (art === 'moon') {
    // A true crescent: the shadow disc is cut out of the moon (a live Subtract compound), so it works on any background.
    const moon = makeNode('compound', { name: 'Moon', x: 64, y: 25, width: 84, height: 81, fill: '#d9d9b2', compoundOperation: 'subtract' });
    return [moon,
      shape('Moon disc', { parent: moon.id, shapeKind: 'ellipse', x: 0, y: 9, width: 72, height: 72, fill: '#d9d9b2' }),
      shape('Moon shadow', { parent: moon.id, shapeKind: 'ellipse', x: 18, y: 0, width: 66, height: 66, fill: '#d9d9b2' }),
      ...[30, 60, 135, 162].map((x, i) => shape(`Tree ${i + 1}`, { shapeKind: 'polygon', sides: 3, x, y: 70 + i * 4, width: 12, height: 28, opacity: .45 })),
    ];
  }
  return [
    shape('Sun', { shapeKind: 'ellipse', x: 68, y: 50, width: 64, height: 64, fill: '#ead39a' }),
    ...Array.from({ length: 12 }, (_, i) => shape(`Sun ray ${i + 1}`,
      { x: 99 + Math.sin(i * Math.PI / 6) * 60, y: 74 - Math.cos(i * Math.PI / 6) * 60, width: 2, height: 15, rotation: i * 30, fill: '#ead39a' })),
  ];
}

/**
 * The botanical art in a box, fitted inside it. With an art component (`artId`), a linked layer: of the `art` variant,
 * or following the parent's own `art` field without one. Without, the drawing itself (`art`, a fern by default) in an
 * `Art` frame, the same for every variant: what **Add component** templates use, so they bring no extra component.
 */
function artLayer(artId: string | undefined, values: Partial<DesignNode> & Pick<DesignNode, 'x' | 'y' | 'width' | 'height'>, art?: Art): DesignNode[] {
  if (artId) return [makeNode('component', { name: 'Art', fill: 'transparent', nestedFit: 'contain', ...values, componentId: artId,
    ...art ? { dataSource: 'row', dataRow: ART_VARIANTS.indexOf(art) } : { dataSource: 'inherit' } })];
  const frame = makeNode('frame', { name: 'Art', fill: 'transparent', layout: 'absolute', padding: 0, ...values });
  const scale = Math.min(values.width / ART_SIZE.width, values.height / ART_SIZE.height);
  const left = (values.width - ART_SIZE.width * scale) / 2, top = (values.height - ART_SIZE.height * scale) / 2;
  const round = (value: number) => Math.round(value * 100) / 100;
  return [frame, ...artShapes(art ?? 'fern').map(node => ({ ...node, parent: node.parent ?? frame.id,
    x: round((node.parent ? 0 : left) + node.x * scale), y: round((node.parent ? 0 : top) + node.y * scale),
    // Layers are at least 1 px across (the smallest a layer can be), which only thickens the finest strokes.
    width: Math.max(1, round(node.width * scale)), height: Math.max(1, round(node.height * scale)) }))];
}

/** The fern, moon and sun drawings: one artwork component whose `art` field picks the variant. */
export function botanicalArt(): Component {
  // Each drawing shows for its own variant (a compound's sources go with it).
  const front = ART_VARIANTS.flatMap(art => artShapes(art as Art).map(node => node.parent ? node : { ...node, ...when('art', art) }));
  // The same drawing on the back, so a printed piece of it has one.
  return component('Botanical artwork', 'artwork', ART_SIZE.width, ART_SIZE.height, { rows: ART_ROWS, front, back: front.map(node => ({ ...node })) });
}

export function spiritCards(artId?: string): Component {
  // Without linked art every card shows the same drawing, so the rows need no art field.
  const rows = artId ? cardRows : cardRows.map(({ art: _, ...row }) => row);
  return component('Spirit cards', 'card', 220, 308, {
    color: '#e9e5d7', flippable: true, hand: true, hideInHand: true, stackable: true, shufflable: true, stackTags: ['spirit'], rows,
    front: [
      makeNode('shape', { name: 'Card border', x: 6, y: 6, width: 208, height: 296, fill: '#e9e5d7', radius: 10 }),
      makeNode('shape', { name: 'Illustration', x: 14, y: 14, width: 192, height: 168, fill: FOREST, radius: 6 }),
      ...artLayer(artId, { x: 22, y: 22, width: 176, height: 152 }),
      makeNode('shape', { name: 'Cost badge', x: 24, y: 24, width: 30, height: 30, fill: '#e9dcb6', radius: 30 }),
      makeNode('text', { name: 'Cost', x: 24, y: 26, width: 30, height: 26, text: '{{cost}}', fontSize: 17, align: 'center' }),
      makeNode('text', { name: 'Card name', x: 18, y: 191, width: 186, height: 31, text: '{{name}}', fontSize: 20, font: 'Lora', autoFontSize: true, minFontSize: 11 }),
      makeNode('text', { name: 'Type', x: 18, y: 224, width: 184, height: 18, text: '{{type}}', fontSize: 8, color: '#7d806c' }),
      makeNode('text', { name: 'Rules text', x: 18, y: 247, width: 164, height: 44, text: '{{description}}', fontSize: 10, color: '#666e60', autoFontSize: true, minFontSize: 7 }),
      makeNode('text', { name: 'Power', x: 206, y: 294, width: 23, height: 26, pivotX: 1, pivotY: 1, widthMode: 'hug', heightMode: 'hug', text: '{{power}}', fontSize: 21, font: 'Lora', align: 'end' }),
    ],
    back: [
      makeNode('shape', { name: 'Back field', x: 0, y: 0, width: 220, height: 308, fill: FOREST, radius: 12 }),
      ...artLayer(artId, { x: 30, y: 46, width: 160, height: 150 }, 'fern'),
      makeNode('text', { name: 'Back title', x: 15, y: 225, width: 190, height: 28, text: 'W I L D W O O D', color: '#e8d8ae', font: 'Lora', fontSize: 16, align: 'center' }),
    ],
  });
}

export function amberToken(artId?: string): Component {
  return component('Amber token', 'token', 80, 80, {
    color: '#d39b3a', hand: true, stackable: true, stackTags: ['amber'],
    front: [
      makeNode('shape', { name: 'Token face', shapeKind: 'ellipse', x: 3, y: 3, width: 74, height: 74, fill: '#d39b3a', stroke: '#a8722a', strokeWidth: 2 }),
      ...artLayer(artId, { x: 10, y: 12, width: 60, height: 54 }, 'sun'),
    ],
  });
}

export function forestClearing(artId?: string): Component {
  return component('Forest clearing', 'board', 640, 420, {
    color: '#263e35',
    front: [
      makeNode('shape', { name: 'Clearing', x: 12, y: 12, width: 616, height: 396, radius: 200, fill: '#304c3e' }),
      ...artLayer(artId, { x: 170, y: 70, width: 300, height: 300, opacity: .55 }, 'fern'),
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
  // The stones are a points grid the board carries, so they travel with it; it only takes wanderers. The board draws
  // the stones, so the grid's own markers stay hidden (selecting the grid in the designer's Layers panel still shows them).
  const stones: ComponentGrid = { id: 'wanderers-path', name: 'Stepping stones', shape: 'points', visible: false, snap: true, size: 50, offsetX: 0, offsetY: 0,
    filter: filterFromTags(['wanderer']), bounds: { x: 0, y: 0, width: PATH.width, height: PATH.height },
    points: STONES.map((stone, index) => ({ id: `stone-${index + 1}`, label: stone.name, x: stone.x, y: stone.y })) };
  return component('Wanderer’s path', 'board', PATH.width, PATH.height, { color: '#263e35', front, grids: [stones] });
}

/**
 * A page is a vertical stack: the chapter line and the title hug their text (a title can take one line or two), the
 * body fills the rest and shrinks its font to fit it, and all three span the page's width. The page number hugs its
 * digits around a bottom-middle pivot, so it stays centred.
 */
function wanderersGuide(): Component {
  const page = makeNode('frame', { name: 'Page', x: 22, y: 22, width: 196, height: 256, fill: 'transparent', layout: 'column', gap: 8, padding: 0, align: 'start' });
  const stacked = (name: string, values: Partial<DesignNode>) => makeNode('text', { name, parent: page.id, widthMode: 'fill', heightMode: 'hug', align: 'center', verticalAlign: 'start', ...values });
  return component('Wanderer’s guide', 'book', 240, 320, {
    color: '#f3eedf', rows: guidePages,
    front: [
      makeNode('shape', { name: 'Page edge', x: 8, y: 8, width: 224, height: 304, fill: 'transparent', stroke: '#c9bf9f', strokeWidth: 1.5, radius: 6 }),
      page,
      stacked('Chapter', { text: 'THE WANDERER’S GUIDE', fontSize: 8, letterSpacing: 1.5, color: '#9a9172' }),
      stacked('Title', { text: '{{title}}', fontSize: 18, lineHeight: 1.15, font: 'Lora', color: '#24413a', marginBottom: 4 }),
      stacked('Body', { text: '{{text}}', heightMode: 'fill', fontSize: 10, minFontSize: 7, autoFontSize: true, lineHeight: 1.45, color: '#4e5b4f', align: 'start' }),
      makeNode('text', { name: 'Page number', x: 120, y: 302, width: 60, height: 18, pivotX: .5, pivotY: 1, widthMode: 'hug', heightMode: 'hug', text: '{{page}}', fontSize: 9, color: '#9a9172', align: 'center' }),
    ],
  });
}

function gatherButton(): Component {
  return component('Gather amber', 'button', 150, 44, {
    color: '#365d46', action: 'gatherAmber',
    front: [makeNode('text', { name: 'Label', x: 0, y: 0, width: 150, height: 44, text: 'Gather amber', color: '#eef6e2', fontSize: 15, font: 'DM Sans', fontWeight: 600, align: 'center', verticalAlign: 'center' })],
  });
}

/**
 * A popup (never on the table): game.popup shows it to the gatherer every fifth amber, filling in {{name}} and
 * {{count}}. It blurs the table behind it and can be dragged; its buttons run the amberMilestone script action.
 */
function amberMilestone(artId: string): Component {
  const button = (name: string, x: number, filled: boolean) => [
    makeNode('shape', { name, x, y: 122, width: 128, height: 34, fill: filled ? '#365d46' : '#fbf8ef', stroke: '#365d46', strokeWidth: filled ? 0 : 1.5, radius: 8 }),
    makeNode('text', { name, x, y: 122, width: 128, height: 34, text: name, color: filled ? '#eef6e2' : '#365d46', fontSize: 13, font: 'DM Sans', fontWeight: 600, align: 'center', verticalAlign: 'center' }),
  ];
  return component('Amber milestone', 'popup', 320, 176, {
    action: 'amberMilestone', rows: [{ name: 'A wanderer', count: '5' }],
    popup: { anchor: 'center', blur: true, draggable: true },
    front: [
      makeNode('shape', { name: 'Card', x: 0, y: 0, width: 320, height: 176, fill: '#f3eedf', stroke: '#c9bf9f', strokeWidth: 1, radius: 14 }),
      makeNode('shape', { name: 'Sun disc', shapeKind: 'ellipse', x: 22, y: 24, width: 56, height: 56, fill: '#d39b3a' }),
      ...artLayer(artId, { x: 27, y: 29, width: 46, height: 46 }, 'sun'),
      makeNode('text', { name: 'Label', x: 94, y: 26, width: 204, height: 14, text: 'AMBER MILESTONE', fontSize: 8, letterSpacing: 1.4, color: '#7d806c', align: 'start' }),
      makeNode('text', { name: 'Message', x: 94, y: 42, width: 204, height: 60, text: '{{name}} has gathered {{count}} amber.', fontSize: 18, font: 'Lora', color: '#24413a', align: 'start', autoFontSize: true, minFontSize: 11 }),
      ...button('Keep gathering', 22, false), ...button('Share', 170, true),
    ],
  });
}

function amberTally(artId: string): Component {
  return component('Amber tally', 'card', 150, 92, {
    color: '#f3eedf', previewWhenLocked: true,
    front: [
      makeNode('shape', { name: 'Sun disc', shapeKind: 'ellipse', x: 12, y: 22, width: 48, height: 48, fill: '#d39b3a' }),
      ...artLayer(artId, { x: 16, y: 26, width: 40, height: 40 }, 'sun'),
      makeNode('text', { name: 'Label', x: 66, y: 18, width: 76, height: 14, text: 'AMBER GATHERED', fontSize: 7, letterSpacing: 1.2, color: '#7d806c', align: 'start' }),
      // Bound to script memory: the number changes as Gather amber counts.
      makeNode('text', { name: 'Count', x: 66, y: 32, width: 76, height: 40, text: '{{memory.gathered}}', fontSize: 30, font: 'Lora', color: '#24413a', align: 'start', verticalAlign: 'center' }),
    ],
  });
}

export const WILDWOOD = { name: 'Wildwood', description: 'A little magic. A lot of possibility.' };

/**
 * The sample, laid out like the ready-to-play games (see src/gameProjects.ts): your profile takes the first seat, every
 * piece is filed in a Pieces-panel group, the boards are held by their groups' locks, and the starting piles (the
 * spirit deck and the amber supply) are persistent stacks that take only their own kind back.
 */
export function wildwoodProject(name = WILDWOOD.name, description = WILDWOOD.description, profile = { name: 'Player 1', color: '#b7cc91' }): Project {
  const art = botanicalArt();
  const card = spiritCards(art.id), token = amberToken(art.id), board = forestClearing(art.id), die = spiritDie();
  const walker = wanderer(), path = wanderersPath(), guide = wanderersGuide(), button = gatherButton(), tally = amberTally(art.id), milestone = amberMilestone(art.id);
  const deck = Array.from({ length: 12 }, (_, n) => ({
    ...makeInstance(card.id, n % 6, 600, 400), stack: 'starter-deck', order: n, flipped: true, scale: 0.72,
  }));
  const supply = { x: 600, y: 640 };
  const groups: PieceGroup[] = [
    // The boards keep their places in the order too, under everything played on them.
    { id: 'group-clearing', name: 'Clearing', parent: null, locked: true, orderLocked: true },
    { id: 'group-spirits', name: 'Spirit cards', parent: null },
    { id: 'group-amber', name: 'Amber and die', parent: null },
    { id: 'group-path', name: 'Wanderer’s path', parent: null, locked: true, orderLocked: true },
    { id: 'group-wanderers', name: 'Wanderers', parent: null },
    // Its order is locked: it keeps its place in the Pieces panel (and the table order) while the game goes on.
    { id: 'group-guide', name: 'Guide and controls', parent: null, orderLocked: true },
  ];
  const pathAt = { x: 1500, y: 440 };
  const instances: Instance[] = [
    { ...makeInstance(board.id, 0, 1050, 430), scale: 0.85, group: 'group-clearing' },
    ...deck.map(item => ({ ...item, group: 'group-spirits' })),
    ...[0, 1, 2].map((row, i) => ({ ...makeInstance(card.id, row, 810 + i * 185, 460 + (i % 2) * 22), scale: 0.72, rotation: (i - 1) * 5, group: 'group-spirits' })),
    ...Array.from({ length: 5 }, (_, i) => ({ ...makeInstance(token.id, 0, 790 + i * 62, 740), scale: 0.65, group: 'group-amber' })),
    { ...makeInstance(die.id, 3, 1200, 720), scale: 0.85, rotation: 12, group: 'group-amber' },
    // The amber supply: a persistent stack that keeps its place (and takes amber back) even when it runs out.
    ...Array.from({ length: 8 }, (_, n) => ({ ...makeInstance(token.id, 0, supply.x, supply.y), scale: 0.65, stack: 'amber-supply', order: n, group: 'group-amber' })),
    { ...makeInstance(path.id, 0, pathAt.x, pathAt.y), group: 'group-path' },
    ...WANDERERS.map((_, row) => ({ ...makeInstance(walker.id, row, pathAt.x - 26 + row * 52, pathAt.y + PATH.height / 2 + 40), group: 'group-wanderers' })),
    { ...makeInstance(guide.id, 0, 330, 420), scale: 0.6, group: 'group-guide' },
    { ...makeInstance(button.id, 0, 330, 590), locked: true, group: 'group-guide' },
    { ...makeInstance(tally.id, 0, 330, 680), locked: true, group: 'group-guide' },
  ];
  // The path board carries its stones' grid (see wanderersPath), which only takes wanderers; everything else carries
  // the "table" grid tag, so it snaps only to the square table grid (when its snapping is turned on).
  const grids: Grid[] = [
    // The table grid keeps the default colour: faint, at 10% alpha.
    { id: 'table-grid', name: 'Table grid', shape: 'square', visible: true, snap: false, size: 25, offsetX: 0, offsetY: 0 },
  ];
  const tableTag = (item: Component) => item.kind === 'artwork' || item.kind === 'popup' || item.gridTags ? item : { ...item, gridTags: ['table'] };
  return {
    id: uid('project'), name, description,
    components: [card, token, board, die, art, walker, path, guide, button, tally, milestone].map(tableTag),
    instances,
    players: [
      { id: 'player-1', owner: 'local', name: profile.name, color: profile.color, x: 980, y: 1000, rotation: 0 },
      { id: 'player-2', owner: 'local', name: 'Player 2', color: '#ce9e7b', x: 980, y: 100, rotation: 180 },
    ],
    groups, grids,
    stacks: [
      { id: 'starter-deck', tag: '', filter: filterFromTags(['spirit']), x: 600, y: 400, rotation: 0, scale: 0.72, componentId: card.id },
      { id: 'amber-supply', tag: '', filter: filterFromTags(['amber']), x: supply.x, y: supply.y, rotation: 0, scale: 0.65, componentId: token.id },
    ],
    settings: { grid: true, snap: false, gridSize: 25, hands: true, turns: false, turn: 0 },
    scripts: [{ id: 'wildwood-script', name: 'Wildwood', source: WILDWOOD_SCRIPT }],
    memory: { gathered: 0 },
  };
}
