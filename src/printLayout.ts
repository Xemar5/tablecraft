import { hasPages, type Component, type Project } from './domain';

/**
 * Lays out every physical copy of a project's pieces on printable pages. Sizes are millimetres; components are
 * measured in CSS pixels (96 per inch), times `scale`.
 */
export const PAPER_SIZES = {
  a4: { name: 'A4', width: 210, height: 297 },
  letter: { name: 'US Letter', width: 215.9, height: 279.4 },
  a3: { name: 'A3', width: 297, height: 420 },
} as const;
export type PaperSize = keyof typeof PAPER_SIZES;
export type PrintOptions = {
  paper: PaperSize;
  /** 1 prints a 96 px wide component one inch wide. */
  scale: number;
  /** Space between pieces, in millimetres. */
  gap: number;
  /** Margin around each page, in millimetres. */
  margin: number;
  /** Follow every front page with a page of backs, mirrored for double-sided printing (flipping on the long edge). */
  backs: boolean;
  /** Add one copy of each variant of components that have no pieces in the project. */
  unplaced: boolean;
  /** Print pieces larger than the page at full size in several parts with glue wings, instead of shrinking them. */
  split: boolean;
};
export const DEFAULT_PRINT_OPTIONS: PrintOptions = { paper: 'a4', scale: 1, gap: 2, margin: 10, backs: true, unplaced: false, split: true };
/** Width of the strip a split piece's part overlaps onto its neighbour, for glueing, in millimetres. */
export const GLUE_WING = 10;
export const MM_PER_PX = 25.4 / 96;

export type PrintCopy = { component: Component; row: number };
export type PrintItem = PrintCopy & {
  x: number; y: number; width: number; height: number; back: boolean; shrunk: boolean;
  /** The whole piece's printed size; a split part (`part`) shows the `crop` of it, in millimetres. */
  pieceWidth: number; pieceHeight: number;
  crop?: { x: number; y: number; width: number; height: number };
  /** Glue strips on a part's right and bottom edges, which the next parts are stuck onto. */
  wing?: { right: number; bottom: number };
  part?: { index: number; total: number; row: number; column: number; rows: number; columns: number };
};
/** Pieces too big for one page: split into parts, or shrunk to the given scale. */
export type Oversized = { name: string; parts?: number; shrunkTo?: number };
export type PrintPage = { side: 'front' | 'back'; items: PrintItem[] };

/** Components that are printed as physical pieces (not artwork, textures, fonts or on-screen script buttons). */
const printable = (component: Component) => !['artwork', 'texture', 'font', 'button'].includes(component.kind);
/**
 * Every printed piece gets a back on the reverse of the sheet: its back design, or just its background colour when it
 * has none. Book pages and die faces are printed as separate pieces and have no backs.
 */
export const hasPrintedBack = (component: Component) => !hasPages(component);

/**
 * Every copy to print: one per piece in the project (on the table, in stacks and in hands). A book piece prints all its
 * pages and a die all its faces. With `unplaced`, components with no pieces add one copy of each variant.
 */
export function printCopies(project: Project, unplaced = false): PrintCopy[] {
  const components = new Map(project.components.map(component => [component.id, component]));
  const copies: PrintCopy[] = [];
  const add = (component: Component, row: number) => {
    if (hasPages(component)) for (let page = 0; page < Math.max(1, component.rows.length); page++) copies.push({ component, row: page });
    else copies.push({ component, row });
  };
  for (const item of project.instances) {
    const component = components.get(item.componentId);
    if (component && printable(component)) add(component, item.row);
  }
  if (unplaced) {
    const placed = new Set(project.instances.map(item => item.componentId));
    for (const component of project.components) {
      if (placed.has(component.id) || !printable(component)) continue;
      if (hasPages(component)) add(component, 0);
      else for (let row = 0; row < Math.max(1, component.rows.length); row++) copies.push({ component, row });
    }
  }
  return copies;
}

/** The pieces too big for one page, once each: how many parts they're split into, or how far they're shrunk. */
export function oversizedPieces(pages: PrintPage[], scale = 1): Oversized[] {
  const found = new Map<string, Oversized>();
  for (const item of pages.filter(page => page.side === 'front').flatMap(page => page.items)) {
    if (item.part) found.set(item.component.id, { name: item.component.name, parts: item.part.total });
    else if (item.shrunk) found.set(item.component.id, { name: item.component.name, shrunkTo: Math.round(item.width / (item.component.width * MM_PER_PX * scale) * 100) });
  }
  return [...found.values()];
}

/**
 * Packs copies onto pages in rows (largest first, copies of one component together). With backs, every front page is
 * followed by its back page, mirrored left to right so each back lands behind its front; pieces without a printed back
 * leave their place empty.
 */
export function printLayout(project: Project, options: PrintOptions): PrintPage[] {
  const paper = PAPER_SIZES[options.paper];
  const areaWidth = paper.width - options.margin * 2, areaHeight = paper.height - options.margin * 2;
  const order = new Map(project.components.map((component, index) => [component.id, index]));
  const sized = printCopies(project, options.unplaced).flatMap(copy => {
    const full = { width: copy.component.width * MM_PER_PX * options.scale, height: copy.component.height * MM_PER_PX * options.scale };
    if (full.width <= areaWidth + 1e-6 && full.height <= areaHeight + 1e-6) return [{ ...copy, ...full, shrunk: false, pieceWidth: full.width, pieceHeight: full.height }];
    if (!options.split) {
      // Pieces larger than the printable area shrink to fit it.
      const fit = Math.min(areaWidth / full.width, areaHeight / full.height), width = full.width * fit, height = full.height * fit;
      return [{ ...copy, width, height, shrunk: true, pieceWidth: width, pieceHeight: height }];
    }
    // Split into parts that fill the printable area: every part but the last in its row and column carries a glue wing
    // overlapping the next part's first millimetres.
    const step = { x: areaWidth - GLUE_WING, y: areaHeight - GLUE_WING };
    const columns = 1 + Math.max(0, Math.ceil((full.width - areaWidth) / step.x - 1e-9));
    const rows = 1 + Math.max(0, Math.ceil((full.height - areaHeight) / step.y - 1e-9));
    return Array.from({ length: rows * columns }, (_, index) => {
      const row = Math.floor(index / columns), column = index % columns;
      const x = column * step.x, y = row * step.y;
      const right = column < columns - 1 ? GLUE_WING : 0, bottom = row < rows - 1 ? GLUE_WING : 0;
      const width = column < columns - 1 ? step.x + right : full.width - x, height = row < rows - 1 ? step.y + bottom : full.height - y;
      return { ...copy, width, height, shrunk: false, pieceWidth: full.width, pieceHeight: full.height, crop: { x, y, width, height }, wing: { right, bottom },
        part: { index: index + 1, total: rows * columns, row: row + 1, column: column + 1, rows, columns } };
    });
  }).sort((a, b) => b.height - a.height || order.get(a.component.id)! - order.get(b.component.id)! || a.row - b.row);
  const fronts: PrintItem[][] = [];
  let page: PrintItem[] = [], x = 0, y = 0, rowHeight = 0;
  for (const copy of sized) {
    if (x > 0 && x + copy.width > areaWidth + 1e-6) { x = 0; y += rowHeight + options.gap; rowHeight = 0; }
    if (y > 0 && y + copy.height > areaHeight + 1e-6) { fronts.push(page); page = []; x = 0; y = 0; rowHeight = 0; }
    page.push({ ...copy, x: options.margin + x, y: options.margin + y, back: false });
    x += copy.width + options.gap; rowHeight = Math.max(rowHeight, copy.height);
  }
  if (page.length) fronts.push(page);
  return fronts.flatMap(items => {
    const front: PrintPage = { side: 'front', items };
    if (!options.backs) return [front];
    // A part's back is the matching, mirrored region of the piece's back (without glue wings).
    const backs = items.filter(item => hasPrintedBack(item.component)).map(item => ({ ...item, back: true, x: paper.width - item.x - item.width,
      ...(item.crop ? { crop: { ...item.crop, x: item.pieceWidth - item.crop.x - item.crop.width }, wing: { right: 0, bottom: 0 } } : {}) }));
    return [front, { side: 'back' as const, items: backs }];
  });
}
