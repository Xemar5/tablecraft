import { describe, expect, it } from 'vitest';
import { gameProject } from '../src/gameProjects';
import { DEFAULT_PRINT_OPTIONS, MM_PER_PX, PAPER_SIZES, printCopies, printLayout } from '../src/printLayout';
import { starterProject } from '../src/templates';

const profile = { name: 'Tester', color: '#b7cc91' };

describe('print layout', () => {
  it('prints one copy per piece, every page of a book and every face of a die', () => {
    const project = starterProject();
    const copies = printCopies(project);
    const count = (kind: string) => copies.filter(copy => copy.component.kind === kind).length;
    // 12 cards in the deck and 3 on the table, 5 tokens, 1 board and one six-sided die.
    expect([count('card'), count('token'), count('board'), count('dice')]).toEqual([15, 5, 1, 6]);
    const dice = copies.filter(copy => copy.component.kind === 'dice').map(copy => copy.row);
    expect(dice).toEqual([0, 1, 2, 3, 4, 5]);
    const tidewater = gameProject('tidewater', 'Game', '', profile);
    const book = printCopies(tidewater).filter(copy => copy.component.kind === 'book');
    expect(book.map(copy => copy.row)).toEqual(book.map((_, page) => page));
    // Held pieces are printed too.
    const held = { ...project, instances: project.instances.map((item, index) => index === 3 ? { ...item, holder: project.players[0].id } : item) };
    expect(printCopies(held)).toHaveLength(copies.length);
  });

  it('can add one copy of each variant of components with no pieces', () => {
    const project = starterProject();
    const unused = project.components.find(component => component.kind === 'card')!;
    const without = { ...project, instances: project.instances.filter(item => item.componentId !== unused.id) };
    expect(printCopies(without).some(copy => copy.component.id === unused.id)).toBe(false);
    expect(printCopies(without, true).filter(copy => copy.component.id === unused.id).map(copy => copy.row)).toEqual(unused.rows.map((_, row) => row));
    // Artwork components are drawn inside others and never printed on their own.
    expect(printCopies(without, true).some(copy => copy.component.kind === 'artwork')).toBe(false);
  });

  it('packs pieces inside the margins at print size, followed by mirrored pages of backs', () => {
    const project = starterProject();
    const options = { ...DEFAULT_PRINT_OPTIONS };
    const pages = printLayout(project, options);
    const paper = PAPER_SIZES.a4;
    expect(pages.map(page => page.side)).toEqual(pages.map((_, index) => index % 2 ? 'back' : 'front'));
    const fronts = pages.filter(page => page.side === 'front');
    expect(fronts.flatMap(page => page.items)).toHaveLength(printCopies(project).length);
    for (const page of fronts) for (const item of page.items) {
      expect(item.x).toBeGreaterThanOrEqual(options.margin - 1e-6);
      expect(item.y).toBeGreaterThanOrEqual(options.margin - 1e-6);
      expect(item.x + item.width).toBeLessThanOrEqual(paper.width - options.margin + 1e-6);
      expect(item.y + item.height).toBeLessThanOrEqual(paper.height - options.margin + 1e-6);
      // Pieces on one page never overlap.
      for (const other of page.items) if (other !== item) {
        expect(item.x + item.width <= other.x + 1e-6 || other.x + other.width <= item.x + 1e-6 || item.y + item.height <= other.y + 1e-6 || other.y + other.height <= item.y + 1e-6).toBe(true);
      }
    }
    const card = fronts.flatMap(page => page.items).find(item => item.component.kind === 'card')!;
    expect(card.width).toBeCloseTo(card.component.width * MM_PER_PX, 6);
    // A card's back sits behind it when the sheet is flipped on its long edge; tokens and dice have no printed back.
    const back = pages[pages.indexOf(fronts.find(page => page.items.includes(card))!) + 1];
    const behind = back.items.find(item => item.component === card.component && item.y === card.y && item.back)!;
    expect(behind.x).toBeCloseTo(paper.width - card.x - card.width, 6);
    expect(back.items.some(item => item.component.kind === 'token' || item.component.kind === 'dice')).toBe(false);
    // Without backs only fronts are printed; a bigger scale needs more pages, and oversized pieces shrink to fit.
    expect(printLayout(project, { ...options, backs: false }).every(page => page.side === 'front')).toBe(true);
    const large = printLayout(project, { ...options, backs: false, scale: 4 });
    expect(large.length).toBeGreaterThan(fronts.length);
    expect(large.flatMap(page => page.items).some(item => item.shrunk)).toBe(true);
  });
});
