import { makeInstance, makeNode, uid, type Component, type Project } from './domain';

const cardRows = [
  { id: 'fern', name: 'Forest guardian', type: 'WOODLAND SPIRIT', cost: '3', power: '4', description: 'When played, draw a card.\nThe forest remembers its own.', art: 'fern' },
  { id: 'moon', name: 'Moonlit passage', type: 'ANCIENT MAGIC', cost: '2', power: '2', description: 'Move a spirit to any clearing.\nFollow the light between the trees.', art: 'moon' },
  { id: 'sun', name: 'Golden harvest', type: 'SEASONAL RITUAL', cost: '1', power: '3', description: 'Gain two amber tokens.\nA little sunlight goes a long way.', art: 'sun' },
  { id: 'oak', name: 'The elder oak', type: 'WOODLAND SPIRIT', cost: '5', power: '7', description: 'Protect all adjacent spirits.\nDeep roots. Quiet strength.', art: 'fern' },
  { id: 'seed', name: 'A new beginning', type: 'SEASONAL RITUAL', cost: '1', power: '1', description: 'Return a spirit to your hand.\nEvery story starts with a seed.', art: 'sun' },
  { id: 'night', name: 'Night wanderer', type: 'WOODLAND SPIRIT', cost: '4', power: '5', description: 'Look at the top three cards.\nNot all who wander are lost.', art: 'moon' },
];

export function template(kind: Component['kind'] | 'blank'): Component {
  const base: Component = {
    id: uid('component'), name: 'Untitled component', kind: kind === 'blank' ? 'card' : kind,
    width: 220, height: 308, color: '#e9e5d7', front: [], back: [],
    csv: '', rows: [], flippable: true, hand: true, hideInHand: true,
    stackable: true, shufflable: true, stackTag: '',
  };
  if (kind === 'blank') return base;
  if (kind === 'card') {
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

export function starterProject(): Project {
  const card = template('card');
  const token = template('token');
  const board = template('board');
  const die = template('dice');
  const deck = Array.from({ length: 12 }, (_, n) => ({
    ...makeInstance(card.id, n % 6, 600, 400), stack: 'starter-deck', order: n, flipped: true, scale: 0.72,
  }));
  return {
    id: uid('project'), name: 'Wildwood', description: 'A little magic. A lot of possibility.',
    components: [card, token, board, die],
    instances: [
      { ...makeInstance(board.id, 0, 1050, 430), scale: 0.85, locked: true },
      ...deck,
      ...[0, 1, 2].map((row, i) => ({ ...makeInstance(card.id, row, 810 + i * 185, 460 + (i % 2) * 22), scale: 0.72, rotation: (i - 1) * 5 })),
      ...Array.from({ length: 5 }, (_, i) => ({ ...makeInstance(token.id, 0, 790 + i * 62, 740), scale: 0.65 })),
      { ...makeInstance(die.id, 3, 1200, 720), scale: 0.85, rotation: 12 },
    ],
    players: [
      { id: 'player-1', owner: 'local', name: 'You', color: '#b7cc91', x: 980, y: 1000, rotation: 0 },
      { id: 'player-2', owner: 'local', name: 'Player 2', color: '#ce9e7b', x: 980, y: 100, rotation: 180 },
    ],
    settings: { grid: true, snap: false, gridSize: 25, hands: true, turns: false, turn: 0 },
  };
}
