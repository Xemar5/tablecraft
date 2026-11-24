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
};
export const DEFAULT_PRINT_OPTIONS: PrintOptions = { paper: 'a4', scale: 1, gap: 2, margin: 10, backs: true, unplaced: false };
export const MM_PER_PX = 25.4 / 96;

export type PrintCopy = { component: Component; row: number };
export type PrintItem = PrintCopy & { x: number; y: number; width: number; height: number; back: boolean; shrunk: boolean };
export type PrintPage = { side: 'front' | 'back'; items: PrintItem[] };

/** Components that are printed as physical pieces (not artwork, textures or fonts). */
const printable = (component: Component) => !['artwork', 'texture', 'font'].includes(component.kind);
/** Components whose backs are printed on the reverse of the sheet. */
export const hasPrintedBack = (component: Component) => component.flippable && !hasPages(component);

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

/**
 * Packs copies onto pages in rows (largest first, copies of one component together). With backs, every front page is
 * followed by its back page, mirrored left to right so each back lands behind its front; pieces without a printed back
 * leave their place empty.
 */
export function printLayout(project: Project, options: PrintOptions): PrintPage[] {
  const paper = PAPER_SIZES[options.paper];
  const areaWidth = paper.width - options.margin * 2, areaHeight = paper.height - options.margin * 2;
  const order = new Map(project.components.map((component, index) => [component.id, index]));
  const sized = printCopies(project, options.unplaced).map(copy => {
    let width = copy.component.width * MM_PER_PX * options.scale, height = copy.component.height * MM_PER_PX * options.scale;
    // Pieces larger than the printable area shrink to fit it.
    const fit = Math.min(1, areaWidth / width, areaHeight / height);
    width *= fit; height *= fit;
    return { ...copy, width, height, shrunk: fit < 1 };
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
    const backs = items.filter(item => hasPrintedBack(item.component)).map(item => ({ ...item, back: true, x: paper.width - item.x - item.width }));
    return [front, { side: 'back' as const, items: backs }];
  });
}
