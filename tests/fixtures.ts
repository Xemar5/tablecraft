import { makeInstance, uid, type Project } from '../src/domain';
import { amberToken, botanicalArt, forestClearing, spiritCards, spiritDie } from '../src/wildwood';

/**
 * A small, stable table for tests: Wildwood's spirit cards, amber tokens, clearing and die (components in that order,
 * then their art), set out as the sample first was: the locked clearing, a 12-card face-down deck (stack
 * `starter-deck`), three face-up cards, five tokens and a die, with two seats and the legacy square grid. Wildwood itself
 * gains showcase pieces as Tablecraft grows (see src/wildwood.ts), so tests that need a plain table use this instead.
 */
export function starterTable(): Project {
  const art = botanicalArt();
  const card = spiritCards(art.id), token = amberToken(art.id), board = forestClearing(art.id), die = spiritDie();
  return {
    id: uid('project'), name: 'Wildwood', description: 'A little magic. A lot of possibility.',
    components: [card, token, board, die, art],
    instances: [
      { ...makeInstance(board.id, 0, 1050, 430), scale: 0.85, locked: true },
      ...Array.from({ length: 12 }, (_, n) => ({ ...makeInstance(card.id, n % 6, 600, 400), stack: 'starter-deck', order: n, flipped: true, scale: 0.72 })),
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
