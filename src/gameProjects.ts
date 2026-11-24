import { makeInstance, makeNode, nextSeatPlacement, uid, type Component, type DesignNode, type Instance, type PieceGroup, type Player, type Project } from './domain';

/**
 * Ready-to-play projects offered under **New project**: four classic public-domain board games and Tidewater Isles,
 * an original hex-island trading game. Everything is built from ordinary components, so every piece stays editable.
 * Each side's or player's pieces sit in a named group in the Pieces panel. Parts that never move during play are
 * locked so pieces can be dragged and box-selected over them: whole groups (each board, the laid-out island) through
 * the group's lock, and single pieces among moving ones (Go's stone bowls, reference cards) through their own.
 */
export type GameProjectId = 'chess' | 'checkers' | 'backgammon' | 'go' | 'tidewater';
export const GAME_PROJECTS: readonly { id: GameProjectId; name: string; summary: string; description: string }[] = [
  { id: 'chess', name: 'Chess', summary: '2 players · board and 32 pieces',
    description: 'The classic game of kings. White moves first; checkmate the opposing king to win.' },
  { id: 'checkers', name: 'Checkers', summary: '2 players · board and 24 checkers',
    description: 'Jump and capture on the dark squares. Flip a checker that reaches the far row to crown it king.' },
  { id: 'backgammon', name: 'Backgammon', summary: '2 players · board, 30 checkers, dice and doubling cube',
    description: 'Race your fifteen checkers around the board and bear them off before your opponent does.' },
  { id: 'go', name: 'Go', summary: '2 players · 19×19 board and stone bowls',
    description: 'Place stones to surround territory. Shift-drag a stone off its bowl to play it.' },
  { id: 'tidewater', name: 'Tidewater Isles', summary: '3–4 players · hex islands, trading and building',
    description: 'Settle a tidal archipelago: roll for resources, trade with your rivals and build huts, lighthouses and boardwalks. First to 10 points wins. Rules are in the book.' },
];

type Row = Record<string, string>;
type Profile = { name: string; color: string };
const CENTER = { x: 980, y: 550 };

function csv(rows: Row[]): string {
  if (!rows.length) return '';
  const fields = Object.keys(rows[0]);
  const cell = (value: string) => /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [fields, ...rows.map(row => fields.map(field => row[field] ?? ''))].map(line => line.map(cell).join(',')).join('\n');
}
function component(name: string, kind: Component['kind'], width: number, height: number, values: Partial<Component> = {}): Component {
  const item: Component = { id: uid('component'), name, kind, width, height, color: 'transparent', front: [], back: [], csv: '', rows: [],
    flippable: false, hand: false, hideInHand: false, stackable: false, shufflable: false, stackTag: '', ...values };
  return { ...item, csv: csv(item.rows) };
}
const shape = (name: string, values: Partial<DesignNode>) => makeNode('shape', { name, ...values });
const label = (name: string, values: Partial<DesignNode>) => makeNode('text', { name, align: 'center', verticalAlign: 'center', ...values });
const when = (field: string, value: string): Partial<DesignNode> => ({ visibilityField: field, visibilityValue: value });
const outline = (points: [number, number][]) => points.map(([x, y]) => ({ x, y, inX: 0, inY: 0, outX: 0, outY: 0 }));
const round = (value: number) => Math.round(value * 100) / 100;

const place = (item: Component, row: number, x: number, y: number, values: Partial<Instance> = {}): Instance =>
  ({ ...makeInstance(item.id, row, round(x), round(y)), ...values });
/** A stack of pieces at one spot; the last row is on top. */
function pile(item: Component, rows: number[], x: number, y: number, values: Partial<Instance> = {}): Instance[] {
  const stack = uid('stack');
  return rows.map((row, order) => ({ ...place(item, row, x, y, values), stack, order }));
}
function seats(profile: Profile, colors: string[]): Player[] {
  const players: Player[] = [];
  colors.forEach((color, index) => players.push({ id: uid('player'), owner: 'local', name: index ? `Player ${index + 1}` : profile.name,
    color: index ? color : profile.color, ...nextSeatPlacement(players) }));
  return players;
}
/**
 * Piece groups for the Pieces panel: `add` creates a group, `into` files pieces (whole stacks) under one. A locked
 * group holds its pieces in place, so unlocking the group in the Pieces panel frees them all.
 */
function grouping() {
  const groups: PieceGroup[] = [];
  const add = (name: string, parent: string | null = null, locked = false) => {
    const id = uid('group'); groups.push({ id, name, parent, ...locked ? { locked } : {} }); return id;
  };
  const into = (group: string, items: Instance[]) => items.map(item => ({ ...item, group }));
  return { groups, add, into };
}
/** A shown, snapping grid of `size` with a point at `at` (a square's centre or a line crossing on the board). */
const boardGrid = (size: number, at: { x: number; y: number }): Partial<Project['settings']> =>
  ({ grid: true, snap: true, gridSize: size, gridOffsetX: ((at.x % size) + size) % size, gridOffsetY: ((at.y % size) + size) % size });
function project(name: string, description: string, components: Component[], instances: Instance[], players: Player[], groups: PieceGroup[], hands = false,
  grid: Partial<Project['settings']> = {}): Project {
  return { id: uid('project'), name, description, components, instances, players, groups,
    settings: { grid: false, snap: false, gridSize: 25, hands, turns: true, turn: 0, ...grid } };
}

/** A die showing pips. */
function pipDie(name: string, body: string, pip: string, size = 48): Component {
  const spots: Record<string, [number, number][]> = {
    1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]],
    5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
  };
  const dot = size * .18, step = size * .26, start = size / 2 - step - dot / 2;
  return component(name, 'dice', size, size, {
    color: body, rows: [1, 2, 3, 4, 5, 6].map(value => ({ value: String(value) })),
    front: Object.entries(spots).flatMap(([value, cells]) => cells.map(([column, row], index) => shape(`Pip ${value}.${index + 1}`, {
      shapeKind: 'ellipse', x: start + column * step, y: start + row * step, width: dot, height: dot, fill: pip, ...when('value', value),
    }))),
  });
}

/** An 8×8 board with file and rank labels. a1 is a dark square at the bottom left. */
function squareBoard(name: string, colors: { light: string; dark: string; frame: string; ink: string }): Component {
  const size = 60, margin = 40, side = size * 8;
  const front: DesignNode[] = [
    shape('Frame', { x: 0, y: 0, width: side + margin * 2, height: side + margin * 2, fill: colors.frame, radius: 16 }),
    shape('Light squares', { x: margin, y: margin, width: side, height: side, fill: colors.light }),
  ];
  for (let rank = 0; rank < 8; rank++) for (let file = 0; file < 8; file++) {
    if ((rank + file) % 2 === 0) front.push(shape(`${'abcdefgh'[file]}${rank + 1}`, { x: margin + file * size, y: margin + (7 - rank) * size, width: size, height: size, fill: colors.dark }));
  }
  for (let index = 0; index < 8; index++) {
    front.push(label(`File ${'abcdefgh'[index]}`, { x: margin + index * size, y: margin + side + 6, width: size, height: 28, text: 'abcdefgh'[index], fontSize: 14, color: colors.ink }));
    front.push(label(`Rank ${index + 1}`, { x: 6, y: margin + (7 - index) * size, width: 28, height: size, text: String(index + 1), fontSize: 14, color: colors.ink }));
  }
  front.push(shape('Edge', { x: margin - 2, y: margin - 2, width: side + 4, height: side + 4, fill: 'transparent', stroke: colors.ink, strokeWidth: 2 }));
  return component(name, 'board', side + margin * 2, side + margin * 2, { color: colors.frame, front });
}
/** Centre of a board square, with the board centred on the table. */
const square = (file: number, rank: number) => ({ x: CENTER.x - 280 + 70 + file * 60, y: CENTER.y - 280 + 70 + (7 - rank) * 60 });

export function chessProject(name: string, description: string, profile: Profile): Project {
  const board = squareBoard('Chess board', { light: '#eedcbc', dark: '#a17a55', frame: '#4b3424', ink: '#e8d5b0' });
  const kinds = [['King', '♚'], ['Queen', '♛'], ['Rook', '♜'], ['Bishop', '♝'], ['Knight', '♞'], ['Pawn', '♟']];
  const glyph = (side: string, values: Partial<DesignNode>) => label(`${side} piece`, {
    x: 0, y: 0, width: 56, height: 56, text: '{{glyph}}', font: 'Noto Sans Symbols 2', fontSize: 46, lineHeight: 1,
    textShadow: '#00000055', textShadowY: 2, textShadowBlur: 2, ...when('side', side.toLowerCase()), ...values,
  });
  const pieces = component('Chess pieces', 'token', 56, 56, {
    rows: ['White', 'Black'].flatMap(side => kinds.map(([kind, symbol]) => ({ name: `${side} ${kind.toLowerCase()}`, side: side.toLowerCase(), glyph: `${symbol}︎` }))),
    front: [
      glyph('White', { color: '#f7f1e3', textStroke: '#3b2c1e', textStrokeWidth: 1.2 }),
      glyph('Black', { color: '#241c16', textStroke: '#d6c4a0', textStrokeWidth: .8 }),
    ],
  });
  const backRank = [2, 4, 3, 1, 0, 3, 4, 2];
  const { groups, add, into } = grouping();
  const army = (offset: number, back: number, pawns: number) => [
    ...backRank.map((row, file) => place(pieces, row + offset, square(file, back).x, square(file, back).y)),
    ...Array.from({ length: 8 }, (_, file) => place(pieces, 5 + offset, square(file, pawns).x, square(file, pawns).y)),
  ];
  const instances = [
    ...into(add('Board', null, true), [place(board, 0, CENTER.x, CENTER.y)]),
    ...into(add('White pieces'), army(0, 0, 1)), ...into(add('Black pieces'), army(6, 7, 6)),
  ];
  return project(name, description, [board, pieces], instances, seats(profile, ['#f1ead8', '#3a3029']), groups, false, boardGrid(60, square(0, 0)));
}

/** A round checker, with an optional king's star. */
function checkerFaces(size: number, sides: { side: string; fill: string; edge: string }[], crown: boolean): DesignNode[] {
  return sides.flatMap(({ side, fill, edge }) => [
    shape(`${side} disc`, { shapeKind: 'ellipse', x: 2, y: 2, width: size - 4, height: size - 4, fill, stroke: edge, strokeWidth: 2, ...when('side', side) }),
    shape(`${side} ring`, { shapeKind: 'ellipse', x: size * .22, y: size * .22, width: size * .56, height: size * .56, fill: 'transparent', stroke: edge, strokeWidth: 1.5, ...when('side', side) }),
    ...(crown ? [shape(`${side} crown`, { shapeKind: 'star', sides: 5, innerRadius: .45, x: size * .26, y: size * .24, width: size * .48, height: size * .48, fill: '#e2b94e', stroke: edge, strokeWidth: 1, ...when('side', side) })] : []),
  ]);
}

export function checkersProject(name: string, description: string, profile: Profile): Project {
  const board = squareBoard('Checkers board', { light: '#efe4c9', dark: '#4f7a5a', frame: '#2f3d33', ink: '#d9e3c8' });
  const sides = [{ side: 'light', fill: '#f1e6cc', edge: '#9d8a5f' }, { side: 'dark', fill: '#a8382e', edge: '#5f1d17' }];
  const checker = component('Checker', 'token', 50, 50, {
    flippable: true, rows: [{ name: 'Light checker', side: 'light' }, { name: 'Dark checker', side: 'dark' }],
    front: checkerFaces(50, sides, false), back: checkerFaces(50, sides, true),
  });
  const { groups, add, into } = grouping();
  const side = (row: number, ranks: number[]) => ranks.flatMap(rank => Array.from({ length: 8 }, (_, file) => file)
    .filter(file => (rank + file) % 2 === 0).map(file => place(checker, row, square(file, rank).x, square(file, rank).y)));
  const instances = [
    ...into(add('Board', null, true), [place(board, 0, CENTER.x, CENTER.y)]),
    ...into(add('Light checkers'), side(0, [0, 1, 2])), ...into(add('Dark checkers'), side(1, [5, 6, 7])),
  ];
  return project(name, description, [board, checker], instances, seats(profile, ['#f1e6cc', '#a8382e']), groups, false, boardGrid(60, square(0, 0)));
}

// Backgammon points are numbered from the light player's side: 1–6 bottom right (light's home), 7–12 bottom left,
// 13–18 top left and 19–24 top right. Light moves from 24 down to 1; dark the other way.
const POINT_WIDTH = 50, POINT_HEIGHT = 200;
function pointX(point: number) {
  const right = point <= 6 || point >= 19, column = point <= 6 ? 6 - point : point <= 12 ? 12 - point : point <= 18 ? point - 13 : point - 19;
  return (right ? 360 : 20) + POINT_WIDTH / 2 + column * POINT_WIDTH;
}
export function backgammonProject(name: string, description: string, profile: Profile): Project {
  const front: DesignNode[] = [
    shape('Frame', { x: 0, y: 0, width: 760, height: 560, fill: '#5c3a24', radius: 16 }),
    shape('Outer table', { x: 20, y: 30, width: 300, height: 500, fill: '#e9d9b4' }),
    shape('Home table', { x: 360, y: 30, width: 300, height: 500, fill: '#e9d9b4' }),
    shape('Bar', { x: 320, y: 20, width: 40, height: 520, fill: '#4a2f1f', radius: 4 }),
    shape('Bear-off tray', { x: 680, y: 30, width: 60, height: 500, fill: '#3e2717', radius: 6 }),
    label('Tray label', { x: 680, y: 268, width: 60, height: 24, text: 'OFF', fontSize: 11, letterSpacing: 2, color: '#d9c39a' }),
  ];
  for (let point = 1; point <= 24; point++) {
    const top = point >= 13, x = pointX(point) - POINT_WIDTH / 2;
    front.push(shape(`Point ${point}`, { shapeKind: 'path', x, y: top ? 30 : 530 - POINT_HEIGHT, width: POINT_WIDTH, height: POINT_HEIGHT,
      fill: point % 2 ? '#9b3b2e' : '#2e5450', points: outline(top ? [[0, 0], [50, 0], [25, 200]] : [[0, 200], [50, 200], [25, 0]]) }));
    front.push(label(`Point ${point} number`, { x, y: top ? 8 : 534, width: POINT_WIDTH, height: 18, text: String(point), fontSize: 10, color: '#d9c39a' }));
  }
  const board = component('Backgammon board', 'board', 760, 560, { color: '#5c3a24', front });
  const checker = component('Backgammon checker', 'token', 40, 40, {
    rows: [{ name: 'Light checker', side: 'light' }, { name: 'Dark checker', side: 'dark' }],
    front: checkerFaces(40, [{ side: 'light', fill: '#f2e8d0', edge: '#9d8a5f' }, { side: 'dark', fill: '#2d2a28', edge: '#8e8576' }], false),
  });
  const die = pipDie('Die', '#f4efe2', '#2b2622');
  const cube = component('Doubling cube', 'dice', 48, 48, { color: '#efe7d2',
    rows: ['64', '2', '4', '8', '16', '32'].map(value => ({ value })),
    front: [label('Value', { x: 0, y: 0, width: 48, height: 48, text: '{{value}}', fontSize: 20, font: 'Lora', color: '#3b2a1c' })] });
  const left = CENTER.x - 380, top = CENTER.y - 280;
  const stackOn = (point: number, count: number, row: number) => Array.from({ length: count }, (_, index) =>
    place(checker, row, left + pointX(point), point >= 13 ? top + 30 + 20 + index * 40 : top + 530 - 20 - index * 40));
  const { groups, add, into } = grouping();
  const instances = [
    ...into(add('Board', null, true), [place(board, 0, CENTER.x, CENTER.y)]),
    ...into(add('Light checkers'), [...stackOn(24, 2, 0), ...stackOn(13, 5, 0), ...stackOn(8, 3, 0), ...stackOn(6, 5, 0)]),
    ...into(add('Dark checkers'), [...stackOn(1, 2, 1), ...stackOn(12, 5, 1), ...stackOn(17, 3, 1), ...stackOn(19, 5, 1)]),
    ...into(add('Dice and doubling cube'), [place(die, 2, CENTER.x + 440, CENTER.y - 40, { rotation: 8 }), place(die, 4, CENTER.x + 445, CENTER.y + 30, { rotation: -6 }),
      place(cube, 0, left + 340, CENTER.y)]),
  ];
  return project(name, description, [board, checker, die, cube], instances, seats(profile, ['#f2e8d0', '#2d2a28']), groups);
}

export function goProject(name: string, description: string, profile: Profile): Project {
  const spacing = 30, first = 30, last = first + spacing * 18;
  const front: DesignNode[] = [];
  for (let line = 0; line < 19; line++) {
    const edge = line === 0 || line === 18, width = edge ? 2 : 1, at = first + line * spacing - width / 2;
    front.push(shape(`Row ${line + 1}`, { x: first, y: at, width: last - first, height: width, fill: '#3b2a17' }));
    front.push(shape(`Column ${line + 1}`, { x: at, y: first, width, height: last - first, fill: '#3b2a17' }));
  }
  for (const row of [3, 9, 15]) for (const column of [3, 9, 15]) {
    front.push(shape(`Star point ${row + 1}-${column + 1}`, { shapeKind: 'ellipse', x: first + column * spacing - 4, y: first + row * spacing - 4, width: 8, height: 8, fill: '#3b2a17' }));
  }
  const board = component('Go board', 'board', 600, 600, { color: '#dcb36b', front });
  const stone = component('Go stone', 'token', 28, 28, {
    stackable: true, rows: [{ name: 'Black stone', side: 'black' }, { name: 'White stone', side: 'white' }],
    front: [
      shape('Black stone', { shapeKind: 'ellipse', x: 0, y: 0, width: 28, height: 28, fill: '#1d1d1f', ...when('side', 'black') }),
      shape('Black shine', { shapeKind: 'ellipse', x: 7, y: 5, width: 8, height: 5, fill: '#ffffff30', rotation: -25, ...when('side', 'black') }),
      shape('White stone', { shapeKind: 'ellipse', x: .5, y: .5, width: 27, height: 27, fill: '#f4f2ec', stroke: '#b9b3a4', strokeWidth: 1, ...when('side', 'white') }),
    ],
  });
  const bowl = component('Stone bowl', 'token', 96, 96, { color: '#6b4a2b',
    front: [shape('Hollow', { shapeKind: 'ellipse', x: 10, y: 10, width: 76, height: 76, fill: '#8a6440', stroke: '#5a3d22', strokeWidth: 2 })] });
  const { groups, add, into } = grouping();
  // Each player's stones sit in their bowl, which is locked so the stones can be dragged off it.
  const stones = (row: number, count: number, x: number, y: number) => [place(bowl, 0, x, y, { locked: true }), ...pile(stone, Array<number>(count).fill(row), x, y)];
  const instances = [
    ...into(add('Board', null, true), [place(board, 0, CENTER.x, CENTER.y)]),
    ...into(add('Black stones'), stones(0, 181, CENTER.x - 390, CENTER.y + 200)),
    ...into(add('White stones'), stones(1, 180, CENTER.x + 390, CENTER.y - 200)),
  ];
  // Stones snap onto the line crossings.
  return project(name, description, [board, stone, bowl], instances, seats(profile, ['#1d1d1f', '#f4f2ec']), groups, false,
    boardGrid(spacing, { x: CENTER.x - 300 + first, y: CENTER.y - 300 + first }));
}

// Tidewater Isles: an original game of settling tidal islands. Pointy-top hex tiles 97 wide and 112 tall tile at
// 97 across and 84 down.
const HEX = { width: 97, height: 112 };
const HEX_OUTLINE = outline([[48.5, 0], [97, 28], [97, 84], [48.5, 112], [0, 84], [0, 28]]);
const TERRAINS = [
  { terrain: 'reed', name: 'Reed marsh', resource: 'Reed', fill: '#7f9d55' },
  { terrain: 'clay', name: 'Clay banks', resource: 'Clay', fill: '#b9704a' },
  { terrain: 'salt', name: 'Salt flats', resource: 'Salt', fill: '#e2ded0' },
  { terrain: 'fish', name: 'Fishing shoals', resource: 'Fish', fill: '#4a92a6' },
  { terrain: 'stone', name: 'Sea cliffs', resource: 'Stone', fill: '#7d7f86' },
  { terrain: 'dunes', name: 'Dunes', resource: 'Nothing grows here', fill: '#d9bf7f' },
];
const PLAYER_COLORS = [
  { color: 'crimson', name: 'Crimson', fill: '#b8483a', edge: '#5e2018' }, { color: 'azure', name: 'Azure', fill: '#3b6fa8', edge: '#1c3657' },
  { color: 'ivory', name: 'Ivory', fill: '#efe8d4', edge: '#7c7259' }, { color: 'amber', name: 'Amber', fill: '#d99a2b', edge: '#6e4c10' },
];

/** Small drawings of each resource, laid out in a box of `size` at (x, y). */
function resourceArt(field: string, x: number, y: number, size: number): DesignNode[] {
  const s = size / 40, at = (dx: number, dy: number) => ({ x: x + dx * s, y: y + dy * s });
  const art = (name: string, value: string, values: Partial<DesignNode>) => shape(name, { ...values, ...when(field, value) });
  return [
    ...[6, 14, 22, 30].map((dx, index) => art(`Reed ${index + 1}`, 'reed', { ...at(dx, 8 + (index % 2) * 4), width: 2.5 * s, height: (28 - (index % 2) * 4) * s, fill: '#3f5a26', rotation: (index - 1.5) * 6 })),
    ...[6, 14, 22, 30].map((dx, index) => art(`Cattail ${index + 1}`, 'reed', { shapeKind: 'ellipse', ...at(dx - 1.5, 4 + (index % 2) * 4), width: 5.5 * s, height: 10 * s, fill: '#6b4a2b' })),
    ...[[2, 22], [20, 22], [11, 12]].map(([dx, dy], index) => art(`Brick ${index + 1}`, 'clay', { ...at(dx, dy), width: 18 * s, height: 9 * s, fill: '#8e4b2e', radius: 1.5 * s, stroke: '#f0c9a8', strokeWidth: .8 })),
    ...[[6, 10, 14], [22, 6, 12], [14, 22, 12]].map(([dx, dy, w], index) => art(`Crystal ${index + 1}`, 'salt', { shapeKind: 'polygon', sides: 4, ...at(dx, dy), width: w * s, height: w * s, fill: '#ffffff', stroke: '#a9a38c', strokeWidth: 1 })),
    ...[[4, 8], [16, 22]].flatMap(([dx, dy], index) => [
      art(`Fish ${index + 1}`, 'fish', { shapeKind: 'ellipse', ...at(dx, dy), width: 16 * s, height: 8 * s, fill: '#e7eef0' }),
      art(`Fish tail ${index + 1}`, 'fish', { shapeKind: 'polygon', sides: 3, ...at(dx + 14, dy), width: 8 * s, height: 8 * s, rotation: 90, fill: '#e7eef0' }),
    ]),
    ...[[2, 14, 20, 6], [18, 6, 18, 5], [12, 20, 22, 6]].map(([dx, dy, w, sides], index) => art(`Rock ${index + 1}`, 'stone', { shapeKind: 'polygon', sides, ...at(dx, dy), width: w * s, height: w * s, fill: index === 1 ? '#a3a5ab' : '#55575e' })),
    ...[[0, 18], [14, 10], [22, 24]].map(([dx, dy], index) => art(`Dune ${index + 1}`, 'dunes', { shapeKind: 'ellipse', ...at(dx, dy), width: 22 * s, height: 9 * s, fill: '#c3a35c' })),
  ];
}

const TIDE_CARDS = [
  { name: 'Harbor guard', count: 14, text: 'Move the squall to another tile and take a random card from a player beside it.' },
  { name: 'Shipwright', count: 2, text: 'Build two boardwalks for free.' },
  { name: 'Good catch', count: 2, text: 'Take any two resource cards from the supply.' },
  { name: 'Market day', count: 2, text: 'Name a resource. Every other player gives you all of theirs.' },
  { name: 'Relic', count: 5, text: 'Worth 1 point. Keep it hidden until it wins you the game.' },
];
const RULES = [
  { page: '1', title: 'Tidewater Isles', text: 'The tide has gone out on an unclaimed archipelago. Settle its islands, trade what the sea gives you and be the first to reach 10 points.\n\nTurn pages with Shift+Q and Shift+E.' },
  { page: '2', title: 'Setting up', text: 'Lay out the island tiles, or stack them face down, shuffle and deal them out. Put a tide marker on every tile except the dunes, and the squall on the dunes.\n\nEach player takes the huts, lighthouses and boardwalks of one colour. In turn order, place a hut and a boardwalk beside it; then, in reverse order, a second pair. Take one resource for each tile touching your second hut.' },
  { page: '3', title: 'Your turn', text: 'Roll both dice. Every hut on a corner of a tile showing that tide marker takes one of its resource; a lighthouse takes two.\n\nThen trade: with other players on any terms, with the supply at 4 for 1, or 3 for 1 and 2 for 1 at harbors you have built beside. Then build.' },
  { page: '4', title: 'Building', text: 'Boardwalk: reed and clay. Lay it on a tile edge joined to your own pieces.\n\nHut: reed, clay, salt and fish. Build on a corner joined to your boardwalks, with no other hut on a neighbouring corner.\n\nLighthouse: two fish and three stone. It replaces one of your huts.\n\nTide card: salt, fish and stone.' },
  { page: '5', title: 'The squall', text: 'A roll of 7 brings the squall. Anyone holding more than 7 cards discards half of them, rounded down. Move the squall to another tile; it produces nothing while the squall is there. Take a random card from a player with a hut or lighthouse beside it.' },
  { page: '6', title: 'Winning', text: 'Huts are worth 1 point, lighthouses 2 and relics 1. The longest unbroken line of 5 or more boardwalks and the most harbor guards played (at least 3) are worth 2 points each, and pass to whoever beats them. Reach 10 points on your turn to win.' },
];

export function tidewaterProject(name: string, description: string, profile: Profile): Project {
  const terrainRows = TERRAINS.map(({ terrain, name, resource }) => ({ name, terrain, resource }));
  const tile = component('Island tile', 'card', HEX.width, HEX.height, {
    flippable: true, stackable: true, shufflable: true, rows: terrainRows,
    front: [
      ...TERRAINS.map(({ terrain, name, fill }) => shape(name, { shapeKind: 'path', x: 0, y: 0, ...HEX, points: HEX_OUTLINE, fill, stroke: '#1f2b2633', strokeWidth: 1.5, ...when('terrain', terrain) })),
      ...resourceArt('terrain', 28.5, 26, 40),
      label('Resource', { x: 14, y: 74, width: 69, height: 14, text: '{{resource}}', fontSize: 7, textTransform: 'uppercase', letterSpacing: 1, color: '#1f2b26cc' }),
    ],
    back: [
      shape('Sea', { shapeKind: 'path', x: 0, y: 0, ...HEX, points: HEX_OUTLINE, fill: '#2d6f86', stroke: '#1f4c5c', strokeWidth: 1.5 }),
      ...[38, 52, 66].map((y, index) => shape(`Wave ${index + 1}`, { x: 22 + (index % 2) * 10, y, width: 44, height: 3, radius: 2, fill: '#ffffff40' })),
    ],
  });
  const numbers = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
  const marker = component('Tide marker', 'token', 38, 38, {
    color: '#efe3c4', stackable: true, shufflable: true,
    rows: numbers.map(number => ({ number: String(number), pips: '•'.repeat(6 - Math.abs(7 - number)), hot: number === 6 || number === 8 ? 'yes' : 'no' })),
    front: [
      label('Number', { x: 0, y: 4, width: 38, height: 20, text: '{{number}}', font: 'Lora', fontSize: 17, fontWeight: 700, color: '#2c2a24', ...when('hot', 'no') }),
      label('Hot number', { x: 0, y: 4, width: 38, height: 20, text: '{{number}}', font: 'Lora', fontSize: 17, fontWeight: 700, color: '#b23a2c', ...when('hot', 'yes') }),
      label('Pips', { x: 0, y: 22, width: 38, height: 10, text: '{{pips}}', fontSize: 8, letterSpacing: -1, color: '#6d6450' }),
    ],
  });
  const sea = component('Open sea', 'board', 720, 620, {
    color: '#2a6a80',
    front: [
      shape('Shore', { shapeKind: 'polygon', sides: 6, x: 60, y: 10, width: 600, height: 600, rotation: 30, fill: '#d8c48f' }),
      ...[[40, 90], [610, 120], [70, 520], [600, 540], [330, 590]].map(([x, y], index) => shape(`Swell ${index + 1}`, { x, y, width: 50, height: 4, radius: 2, fill: '#ffffff26' })),
      label('Title', { x: 18, y: 14, width: 240, height: 22, text: 'TIDEWATER ISLES', font: 'Lora', fontSize: 15, letterSpacing: 2, align: 'start', color: '#d7ecef' }),
    ],
  });
  const harbors = [{ good: 'Any', ratio: '3:1' }, ...TERRAINS.slice(0, 5).map(({ resource }) => ({ good: resource, ratio: '2:1' }))];
  const harbor = component('Harbor', 'token', 42, 42, {
    color: '#f1e7cf', rows: harbors.map(({ good, ratio }) => ({ name: `${good} ${ratio}`, ratio, good })),
    front: [
      label('Ratio', { x: 0, y: 7, width: 42, height: 16, text: '{{ratio}}', fontSize: 13, fontWeight: 700, color: '#2c4650' }),
      label('Good', { x: 0, y: 23, width: 42, height: 11, text: '{{good}}', fontSize: 7, textTransform: 'uppercase', letterSpacing: .5, color: '#55707a' }),
    ],
  });
  const colorRows = PLAYER_COLORS.map(({ color, name }) => ({ name, color }));
  const colored = (part: string, values: (fill: string, edge: string) => Partial<DesignNode>) =>
    PLAYER_COLORS.map(({ color, name, fill, edge }) => shape(`${name} ${part}`, { ...values(fill, edge), ...when('color', color) }));
  const hut = component('Hut', 'card', 26, 26, { stackable: true, rows: colorRows,
    front: colored('hut', (fill, edge) => ({ shapeKind: 'path', x: 0, y: 0, width: 26, height: 26, points: outline([[13, 1], [25, 11], [25, 25], [1, 25], [1, 11]]), fill, stroke: edge, strokeWidth: 1.5 })) });
  const lighthouse = component('Lighthouse', 'card', 26, 38, { stackable: true, rows: colorRows,
    front: [
      shape('Lamp', { x: 8, y: 1, width: 10, height: 9, radius: 2, fill: '#f6dc84', stroke: '#6d5a1f', strokeWidth: 1 }),
      ...colored('tower', (fill, edge) => ({ shapeKind: 'path', x: 0, y: 0, width: 26, height: 38, points: outline([[6, 10], [20, 10], [24, 37], [2, 37]]), fill, stroke: edge, strokeWidth: 1.5 })),
      shape('Band', { x: 5, y: 22, width: 16, height: 3, fill: '#00000033' }),
    ] });
  const boardwalk = component('Boardwalk', 'card', 44, 20, { stackable: true, rows: colorRows,
    front: [
      ...colored('boardwalk', (fill, edge) => ({ x: 0, y: 5, width: 44, height: 10, radius: 2, fill, stroke: edge, strokeWidth: 1.2 })),
      ...[11, 22, 33].map((x, index) => shape(`Plank gap ${index + 1}`, { x, y: 6, width: 1.2, height: 8, fill: '#00000040' })),
    ] });
  const resource = component('Resource', 'card', 64, 90, {
    color: '#f4ecd8', flippable: true, hand: true, hideInHand: true, stackable: true, shufflable: true,
    rows: TERRAINS.slice(0, 5).map(({ terrain, resource }) => ({ name: resource, terrain })),
    front: [
      ...TERRAINS.slice(0, 5).map(({ terrain, fill }) => shape(`${terrain} panel`, { x: 5, y: 5, width: 54, height: 58, radius: 6, fill, ...when('terrain', terrain) })),
      ...resourceArt('terrain', 12, 14, 40),
      label('Name', { x: 0, y: 66, width: 64, height: 18, text: '{{name}}', font: 'Lora', fontSize: 11, color: '#2c3a33' }),
    ],
    back: [
      shape('Back', { x: 0, y: 0, width: 64, height: 90, radius: 8, fill: '#2d6f86' }),
      label('Back title', { x: 0, y: 30, width: 64, height: 30, text: 'TIDE\nWATER', font: 'Lora', fontSize: 10, letterSpacing: 2, color: '#d7ecef' }),
    ],
  });
  const tideCard = component('Tide card', 'card', 80, 112, {
    color: '#f2ead6', flippable: true, hand: true, hideInHand: true, stackable: true, shufflable: true,
    rows: TIDE_CARDS.map(({ name, text }) => ({ name, text })),
    front: [
      shape('Header', { x: 0, y: 0, width: 80, height: 30, fill: '#2d6f86' }),
      label('Title', { x: 4, y: 0, width: 72, height: 30, text: '{{name}}', font: 'Lora', fontSize: 10, color: '#f2ead6' }),
      label('Rules', { x: 7, y: 36, width: 66, height: 68, text: '{{text}}', fontSize: 7, lineHeight: 1.35, verticalAlign: 'start', color: '#3a4741' }),
    ],
    back: [
      shape('Back', { x: 0, y: 0, width: 80, height: 112, radius: 8, fill: '#1f4f60' }),
      shape('Swirl', { shapeKind: 'ellipse', x: 22, y: 38, width: 36, height: 36, fill: 'transparent', stroke: '#d7ecef80', strokeWidth: 2 }),
      label('Back title', { x: 0, y: 80, width: 80, height: 18, text: 'TIDE CARD', fontSize: 8, letterSpacing: 2, color: '#d7ecef' }),
    ],
  });
  const award = component('Award', 'card', 100, 64, {
    color: '#e9dcb6', flippable: false,
    rows: [{ name: 'Longest boardwalk', text: '2 points · an unbroken line of 5 or more boardwalks' }, { name: 'Strongest guard', text: '2 points · 3 or more harbor guards played' }],
    front: [
      label('Title', { x: 4, y: 6, width: 92, height: 18, text: '{{name}}', font: 'Lora', fontSize: 10, color: '#3b3424' }),
      label('Rule', { x: 6, y: 26, width: 88, height: 32, text: '{{text}}', fontSize: 6.5, lineHeight: 1.3, color: '#5d5540' }),
    ],
  });
  const costs = component('Building costs', 'card', 130, 86, {
    color: '#f4ecd8',
    front: [
      label('Title', { x: 0, y: 4, width: 130, height: 16, text: 'BUILDING COSTS', fontSize: 7.5, letterSpacing: 1.5, color: '#2d6f86' }),
      label('Costs', { x: 8, y: 22, width: 114, height: 58, align: 'start', verticalAlign: 'start', fontSize: 7, lineHeight: 1.55, color: '#33403a',
        text: 'Boardwalk — reed, clay\nHut — reed, clay, salt, fish\nLighthouse — 2 fish, 3 stone\nTide card — salt, fish, stone' }),
    ],
  });
  const squall = component('Squall', 'token', 46, 46, {
    color: '#4b5560',
    front: [
      shape('Cloud left', { shapeKind: 'ellipse', x: 7, y: 16, width: 18, height: 14, fill: '#d6dde3' }),
      shape('Cloud top', { shapeKind: 'ellipse', x: 14, y: 10, width: 20, height: 18, fill: '#e7ecf0' }),
      shape('Cloud right', { shapeKind: 'ellipse', x: 23, y: 16, width: 16, height: 13, fill: '#d6dde3' }),
      shape('Bolt', { shapeKind: 'path', x: 18, y: 26, width: 10, height: 14, points: outline([[6, 0], [0, 8], [4, 8], [2, 14], [10, 5], [6, 5]]), fill: '#f2cf4a' }),
    ],
  });
  const book = component('Tidewater rules', 'book', 240, 320, {
    color: '#f3eedf', rows: RULES,
    front: [
      shape('Page edge', { x: 8, y: 8, width: 224, height: 304, fill: 'transparent', stroke: '#c9bf9f', strokeWidth: 1.5, radius: 6 }),
      label('Title', { x: 20, y: 24, width: 200, height: 34, text: '{{title}}', font: 'Lora', fontSize: 19, color: '#24414b' }),
      label('Body', { x: 24, y: 68, width: 192, height: 210, text: '{{text}}', fontSize: 9.5, lineHeight: 1.45, align: 'start', verticalAlign: 'start', color: '#4e5b4f' }),
      label('Page number', { x: 90, y: 282, width: 60, height: 18, text: '{{page}}', fontSize: 9, color: '#9a9172' }),
    ],
  });
  const die = pipDie('Die', '#f4efe2', '#2b2622', 44);

  // A balanced island: rows of 3, 4, 5, 4 and 3 tiles, with no 6 and 8 markers next to each other.
  const layout = [
    ['stone', 'reed', 'fish'], ['clay', 'salt', 'fish', 'reed'], ['salt', 'stone', 'dunes', 'reed', 'clay'], ['reed', 'fish', 'clay', 'salt'], ['fish', 'salt', 'stone'],
  ];
  const markers = [[10, 2, 9], [12, 6, 4, 10], [9, 11, 0, 3, 8], [8, 3, 4, 5], [5, 6, 11]];
  // The island is laid out in locked groups: the sea, tiles, tide markers and harbors stay put while huts, boardwalks
  // and the squall are placed on them. Unlock a group in the Pieces panel to rearrange it, for example to deal a
  // random island.
  const { groups, add, into } = grouping();
  const island = add('Island'), tiles: Instance[] = [], tides: Instance[] = [], harborPieces: Instance[] = [];
  let storm: Instance | undefined;
  layout.forEach((row, rowIndex) => row.forEach((terrain, column) => {
    const x = CENTER.x + (column - (row.length - 1) / 2) * HEX.width, y = CENTER.y + (rowIndex - 2) * 84;
    tiles.push(place(tile, TERRAINS.findIndex(item => item.terrain === terrain), x, y));
    const number = markers[rowIndex][column];
    if (number) tides.push(place(marker, numbers.indexOf(number), x, y + 4));
    else storm = place(squall, 0, x, y);
  }));
  [0, 1, 0, 2, 3, 0, 4, 0, 5].forEach((row, index) => {
    const angle = (20 + index * 40) * Math.PI / 180;
    harborPieces.push(place(harbor, row, CENTER.x + Math.cos(angle) * 332, CENTER.y - Math.sin(angle) * 287));
  });
  const instances: Instance[] = [
    ...into(add('Open sea', island, true), [place(sea, 0, CENTER.x, CENTER.y)]),
    ...into(add('Island tiles', island, true), tiles), ...into(add('Tide markers', island, true), tides),
    ...into(add('Harbors', island, true), harborPieces), ...into(island, [storm!]),
  ];
  const supply = add('Supply');
  instances.push(...into(add('Resources', supply), TERRAINS.slice(0, 5).flatMap((_, row) => pile(resource, Array<number>(19).fill(row), 1450, 330 + row * 100))));
  const deck = TIDE_CARDS.flatMap(({ count }, row) => Array<number>(count).fill(row));
  for (let index = deck.length - 1; index > 0; index--) { const swap = Math.floor(Math.random() * (index + 1)); [deck[index], deck[swap]] = [deck[swap], deck[index]]; }
  instances.push(...into(supply, [
    ...pile(tideCard, deck, 520, 330, { flipped: true }),
    place(award, 0, 520, 470), place(award, 1, 520, 550),
    place(die, 2, 495, 650, { rotation: 8 }), place(die, 4, 550, 655, { rotation: -6 }),
    place(book, 0, 520, 810, { scale: .55 }),
  ]));

  const players = seats(profile, PLAYER_COLORS.map(item => item.fill));
  players.forEach((seat, index) => {
    const dx = CENTER.x - seat.x, dy = CENTER.y - seat.y, length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
    const reach = Math.abs(ux) > Math.abs(uy) ? 150 : 105, baseX = seat.x + ux * reach, baseY = seat.y + uy * reach;
    const at = (offset: number) => ({ x: baseX - uy * offset, y: baseY + ux * offset });
    const spot = [at(-72), at(-24), at(24)], costSpot = at(110);
    instances.push(...into(add(`${PLAYER_COLORS[index].name} pieces`), [
      ...pile(hut, Array<number>(5).fill(index), spot[0].x, spot[0].y, { rotation: seat.rotation }),
      ...pile(lighthouse, Array<number>(4).fill(index), spot[1].x, spot[1].y, { rotation: seat.rotation }),
      ...pile(boardwalk, Array<number>(15).fill(index), spot[2].x, spot[2].y, { rotation: seat.rotation + 90 }),
      // The building costs card is a reference, so it is locked in front of its player.
      place(costs, 0, costSpot.x, costSpot.y, { rotation: seat.rotation, locked: true }),
    ]));
  });
  return project(name, description, [sea, tile, marker, squall, harbor, hut, lighthouse, boardwalk, resource, tideCard, award, costs, die, book], instances, players, groups, true);
}

export function gameProject(id: GameProjectId, name: string, description: string, profile: Profile): Project {
  const build = { chess: chessProject, checkers: checkersProject, backgammon: backgammonProject, go: goProject, tidewater: tidewaterProject }[id];
  return build(name, description, profile);
}
