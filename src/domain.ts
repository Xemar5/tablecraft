import { z } from 'zod';
import { reorder } from './zOrder';

const id = z.string().min(1).max(100);
const num = z.number().finite();
const color = z.string().max(80);
const MAX_NESTED_RENDER_NODES = 10_000;
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
export const assetSchema = z.object({
  name: z.string().min(1).max(200),
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'font/ttf', 'font/otf', 'font/woff', 'font/woff2']),
  data: z.string().min(4).max(Math.ceil(MAX_ASSET_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/).refine(value => value.length % 4 === 0, 'Invalid base64 asset.'),
});
export const vectorPointSchema = z.object({
  x: num.min(-8000).max(8000), y: num.min(-8000).max(8000),
  inX: num.min(-8000).max(8000).default(0), inY: num.min(-8000).max(8000).default(0),
  outX: num.min(-8000).max(8000).default(0), outY: num.min(-8000).max(8000).default(0),
});
export const nodeSchema = z.object({
  id, parent: id.nullable(), name: z.string().max(100),
  type: z.enum(['frame', 'text', 'image', 'shape', 'compound', 'component']),
  x: num, y: num, width: num.min(1).max(4000), height: num.min(1).max(4000),
  text: z.string().max(10000), fill: color, color, fontSize: num.min(4).max(400),
  font: z.string().max(100), radius: num.min(0).max(2000), rotation: num,
  layout: z.enum(['absolute', 'row', 'column']), gap: num.min(0).max(200),
  padding: num.min(0).max(200),
  /** Text alignment (justify applies to text only) or a frame's cross-axis child alignment. */
  align: z.enum(['start', 'center', 'end', 'justify']),
  widthMode: z.enum(['fixed', 'hug', 'fill']).default('fixed'),
  heightMode: z.enum(['fixed', 'hug', 'fill']).default('fixed'),
  wrap: z.boolean().default(false),
  paddingTop: num.min(0).max(200).optional(), paddingRight: num.min(0).max(200).optional(),
  paddingBottom: num.min(0).max(200).optional(), paddingLeft: num.min(0).max(200).optional(),
  marginTop: num.min(0).max(2000).optional(), marginRight: num.min(0).max(2000).optional(),
  marginBottom: num.min(0).max(2000).optional(), marginLeft: num.min(0).max(2000).optional(),
  opacity: num.min(0).max(1),
  shapeKind: z.enum(['rectangle', 'ellipse', 'polygon', 'star', 'path']).default('rectangle'),
  points: z.array(vectorPointSchema).max(128).default([]),
  pathClosed: z.boolean().default(true),
  sides: z.number().int().min(3).max(100).default(5),
  innerRadius: num.min(0.05).max(0.95).default(0.5),
  stroke: color.default('transparent'), strokeWidth: num.min(0).max(200).default(0),
  compoundOperation: z.enum(['union', 'subtract', 'intersect', 'exclude']).default('union'),
  componentId: id.optional(),
  nestedFit: z.enum(['stretch', 'contain', 'cover']).default('stretch'),
  dataSource: z.enum(['inherit', 'row', 'field']).default('inherit'),
  dataRow: z.number().int().min(0).max(9999).default(0),
  dataField: z.string().max(100).default(''),
  textureId: id.optional(), fontId: id.optional(),
  /** How an image layer places its picture before the optional placement below; defaults to `cover`. */
  imageFit: z.enum(['stretch', 'contain', 'cover', 'original', 'tile']).optional(),
  /** Picture placement inside an image layer (edited by double-clicking it), relative to the fitted picture. */
  imageOffsetX: num.min(-8000).max(8000).optional(), imageOffsetY: num.min(-8000).max(8000).optional(),
  imageScaleX: num.min(.01).max(100).optional(), imageScaleY: num.min(.01).max(100).optional(),
  imageRotation: num.min(-360).max(360).optional(),
  /** Typography for text layers; all optional so older saves stay valid. */
  fontWeight: z.number().int().min(100).max(900).optional(),
  italic: z.boolean().optional(),
  textDecoration: z.enum(['none', 'underline', 'line-through']).optional(),
  textTransform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).optional(),
  /** Extra space between letters, in px. */
  letterSpacing: num.min(-50).max(200).optional(),
  /** Line height as a multiple of the font size. */
  lineHeight: num.min(.5).max(5).optional(),
  /** Where text sits vertically inside its box. */
  verticalAlign: z.enum(['start', 'center', 'end']).optional(),
  textStroke: color.optional(), textStrokeWidth: num.min(0).max(50).optional(),
  textShadow: color.optional(), textShadowX: num.min(-200).max(200).optional(), textShadowY: num.min(-200).max(200).optional(),
  textShadowBlur: num.min(0).max(200).optional(),
  visible: z.boolean().default(true),
  visibilityField: z.string().max(10000).default(''),
  visibilityValue: z.string().max(10000).default(''),
});
export type DesignNode = z.infer<typeof nodeSchema>;
export const componentSchema = z.object({
  id, name: z.string().min(1).max(100), kind: z.enum(['card', 'token', 'board', 'dice', 'book', 'artwork', 'texture', 'font']),
  width: num.min(20).max(2000), height: num.min(20).max(2000), color,
  front: z.array(nodeSchema).max(300), back: z.array(nodeSchema).max(300),
  csv: z.string().max(1_000_000),
  rows: z.array(z.record(z.string(), z.string())).max(10000),
  flippable: z.boolean(), hand: z.boolean(), hideInHand: z.boolean(),
  stackable: z.boolean(), shufflable: z.boolean(), stackTag: z.string().max(100),
  source: z.object({ projectId: id, componentId: id, projectName: z.string().min(1).max(100) }).optional(),
  asset: assetSchema.optional(),
});
export type Component = z.infer<typeof componentSchema>;
export const isAsset = (component: Pick<Component, 'kind'>) => component.kind === 'texture' || component.kind === 'font';
/** Dice faces and book pages are rows of one piece, not separately spawnable variants. */
export const hasPages = (component: Pick<Component, 'kind'>) => component.kind === 'dice' || component.kind === 'book';
export const assetUrl = (component: Component) => component.asset ? `data:${component.asset.mime};base64,${component.asset.data}` : undefined;
export const assetFontFamily = (component: Component) => `tablecraft-${encodeURIComponent(component.id)}`;
const assetKey = (name: string) => name.trim().toLowerCase();
/** The first asset of a kind with this name (names are compared trimmed and case-insensitively). */
export function assetByName(components: Iterable<Component>, kind: 'texture' | 'font', name: string): Component | undefined {
  const key = assetKey(name);
  if (!key) return undefined;
  for (const component of components) if (component.kind === kind && component.asset && assetKey(component.name) === key) return component;
  return undefined;
}
/** Names an imported asset so it doesn't collide with the project's other textures and fonts. */
export function uniqueAssetName(name: string, components: Pick<Component, 'kind' | 'name' | 'id'>[], ignoreId?: string): string {
  const taken = new Set(components.filter(component => isAsset(component) && component.id !== ignoreId).map(component => assetKey(component.name)));
  const base = name.trim().slice(0, 100) || 'Imported asset';
  if (!taken.has(assetKey(base))) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`, candidate = `${base.slice(0, 100 - suffix.length)}${suffix}`;
    if (!taken.has(assetKey(candidate))) return candidate;
  }
}
/**
 * Resolves an image layer's source: an imported texture chosen in the layer, a texture whose name matches the bound text
 * (or the binding key itself, as in `{{texture-name}}`), or a safe image URL.
 */
export function resolveImage(node: Pick<DesignNode, 'textureId' | 'text'>, data: Record<string, string>, catalog: Map<string, Component>): string | undefined {
  const texture = node.textureId ? catalog.get(node.textureId) : undefined;
  if (texture) return assetUrl(texture);
  const bound = bind(node.text, data).trim();
  const url = safeImage(bound);
  if (url) return url;
  const named = assetByName(catalog.values(), 'texture', bound) ?? bindingKeyAsset(node.text, data, catalog, 'texture');
  return named && assetUrl(named);
}
/** Resolves a text layer's font family: a chosen imported font, an imported font named by the (bound) font field, or a Google font. */
export function resolveFontFamily(node: Pick<DesignNode, 'fontId' | 'font'>, data: Record<string, string>, catalog: Map<string, Component>): string {
  const chosen = node.fontId ? catalog.get(node.fontId) : undefined;
  if (chosen) return assetFontFamily(chosen);
  const bound = bind(node.font, data).trim();
  const named = assetByName(catalog.values(), 'font', bound) ?? bindingKeyAsset(node.font, data, catalog, 'font');
  return named ? assetFontFamily(named) : bound || 'DM Sans';
}
/** Imported assets a component's layers pick by name, through literal text or {{bindings}} evaluated against its own rows. */
export function namedAssetReferences(component: Component, catalog: Iterable<Component>): string[] {
  const assets = [...catalog].filter(item => isAsset(item) && item.asset);
  if (!assets.length) return [];
  const rows = component.rows.length ? component.rows : [{}];
  const ids = new Set<string>();
  const add = (kind: 'texture' | 'font', text: string) => {
    if (!text.trim()) return;
    const key = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/.exec(text)?.[1];
    const values = new Set([...(text.includes('{{') ? rows.map(row => bind(text, row).trim()) : [text.trim()]), ...(key ? [key] : [])]);
    for (const value of values) { const asset = assetByName(assets, kind, value); if (asset) ids.add(asset.id); }
  };
  for (const node of [...component.front, ...component.back]) {
    if (node.type === 'image' && !node.textureId) add('texture', node.text);
    if (node.type === 'text' && !node.fontId) add('font', node.font);
  }
  return [...ids];
}
// `{{name}}` where `name` is not a data column but names an asset directly.
function bindingKeyAsset(text: string, data: Record<string, string>, catalog: Map<string, Component>, kind: 'texture' | 'font') {
  const match = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/.exec(text);
  return match && !(match[1] in data) ? assetByName(catalog.values(), kind, match[1]) : undefined;
}
export const instanceSchema = z.object({
  id, componentId: id, row: z.number().int().min(0), x: num, y: num,
  rotation: num, scale: num.min(0.1).max(5), flipped: z.boolean(),
  holder: id.nullable(), stack: id.nullable(), order: num, locked: z.boolean(),
  stackReversed: z.boolean().optional(),
  rolls: z.number().int().min(0).optional(),
  /** The Pieces panel group this table piece belongs to. Stacks share one group; held pieces have none. */
  group: id.optional(),
});
export const pieceGroupSchema = z.object({ id, name: z.string().trim().min(1).max(100), parent: id.nullable() });
export type PieceGroup = z.infer<typeof pieceGroupSchema>;
export type Instance = z.infer<typeof instanceSchema>;
export const playerSchema = z.object({
  id, owner: z.string().max(200), name: z.string().min(1).max(50), color,
  x: num, y: num, rotation: num,
  allowHandInsert: z.boolean().optional(), allowHandTake: z.boolean().optional(),
  handFaceUp: z.boolean().optional(), tableHandHidden: z.boolean().optional(), tableHandUnlocked: z.boolean().optional(),
});
export type Player = z.infer<typeof playerSchema>;
export const projectSchema = z.object({
  id, name: z.string().min(1).max(100), description: z.string().max(1000),
  components: z.array(componentSchema).max(500),
  instances: z.array(instanceSchema).max(10000),
  players: z.array(playerSchema),
  /** Named, nestable groups of table pieces shown in the Pieces panel. */
  groups: z.array(pieceGroupSchema).max(2000).optional(),
  settings: z.object({
    grid: z.boolean(), snap: z.boolean(), gridSize: num.min(5).max(200),
    /** Where the grid's points sit: snap points are offset + n × gridSize on each axis (0 when absent). */
    gridOffsetX: num.min(-2000).max(2000).optional(), gridOffsetY: num.min(-2000).max(2000).optional(),
    hands: z.boolean(), allowOtherHands: z.boolean().optional(),
    allowHandInsert: z.boolean().optional(), allowHandTake: z.boolean().optional(),
    turns: z.boolean(), turn: z.number().int().min(0),
  }),
});
export type Project = z.infer<typeof projectSchema>;
export const handPermissions = (p: Project, playerId: string) => ({
  insert: p.players.find(player => player.id === playerId)?.allowHandInsert ?? p.settings.allowHandInsert ?? p.settings.allowOtherHands ?? true,
  take: p.players.find(player => player.id === playerId)?.allowHandTake ?? p.settings.allowHandTake ?? p.settings.allowOtherHands ?? false,
});
export const archiveSchema = z.object({
  format: z.literal('tablecraft'), version: z.literal(1), projects: z.array(projectSchema).max(100),
});
export type Archive = z.infer<typeof archiveSchema>;
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('component'), component: componentSchema, removedDataRow: z.number().int().min(0).optional() }),
  z.object({ type: z.literal('addComponents'), components: z.array(componentSchema).min(1).max(500) }),
  z.object({ type: z.literal('syncLinkedComponents'), components: z.array(componentSchema).min(1).max(500) }),
  z.object({ type: z.literal('removeComponent'), id }),
  z.object({ type: z.literal('reorderComponent'), id, targetId: id, position: z.enum(['before', 'after']) }),
  z.object({ type: z.literal('spawn'), instances: z.array(instanceSchema).min(1).max(1000) }),
  z.object({ type: z.literal('paste'), instances: z.array(instanceSchema).min(1).max(1000) }),
  z.object({ type: z.literal('duplicate'), copies: z.array(z.object({ sourceId: id, id, stack: id.nullable() })).min(1).max(1000), dx: num, dy: num }),
  z.object({ type: z.literal('front'), ids: z.array(id).min(1) }),
  /** Moves table pieces (whole stacks) to the front or back, or one step past the next overlapping piece. Boards stay underneath. */
  z.object({ type: z.literal('zOrder'), ids: z.array(id).min(1), move: z.enum(['front', 'back', 'forward', 'backward']) }),
  z.object({ type: z.literal('extractMove'), id, x: num, y: num }),
  z.object({ type: z.literal('roll'), ids: z.array(id).min(1), seed: z.number().int() }),
  /** Turns book pages (clamped) or steps dice to their next face (looped) by `delta` rows. */
  z.object({ type: z.literal('cycleVariant'), ids: z.array(id).min(1), delta: z.number().int().min(-10000).max(10000).refine(value => value !== 0, 'Choose a direction.') }),
  /** Creates a group under `parent` holding the given table pieces (with their whole stacks) and existing groups. */
  z.object({ type: z.literal('createGroup'), id, name: pieceGroupSchema.shape.name, parent: id.nullable().default(null),
    ids: z.array(id).max(10000).default([]), groups: z.array(id).max(2000).default([]) }),
  z.object({ type: z.literal('renameGroup'), id, name: pieceGroupSchema.shape.name }),
  /** Removes groups, moving their pieces and subgroups up to each group's parent. */
  z.object({ type: z.literal('ungroup'), ids: z.array(id).min(1).max(2000) }),
  /** Moves table pieces (with their whole stacks) and groups into `parent`, or to the top level when it is null. */
  z.object({ type: z.literal('moveToGroup'), parent: id.nullable(), ids: z.array(id).max(10000).default([]), groups: z.array(id).max(2000).default([]) }),
  /**
   * Moves pieces (with their stacks) and groups (with everything in them) into `parent`, and in render order as one
   * block just above or below the pieces of `target` (a Pieces-panel row). Without target pieces on the table, only
   * the grouping changes.
   */
  z.object({ type: z.literal('arrangePieces'), parent: id.nullable(), ids: z.array(id).max(10000).default([]), groups: z.array(id).max(2000).default([]),
    target: z.array(id).max(10000), position: z.enum(['above', 'below']) }),
  z.object({ type: z.literal('releaseMany'), ids: z.array(id).min(1), x: num, y: num }),
  z.object({ type: z.literal('dropManyFromHand'), ids: z.array(id).min(1), targetId: id, stackId: id }),
  z.object({ type: z.literal('transferToHand'), ids: z.array(id).min(1), playerId: id, faceUp: z.boolean().optional(), index: z.number().int().min(0).optional() }),
  z.object({ type: z.literal('playVisibleHand'), id, x: num, y: num, targetId: id.optional(), stackId: id.optional() }),
  z.object({ type: z.literal('move'), ids: z.array(id), patch: instanceSchema.pick({ x: true, y: true, rotation: true, scale: true, flipped: true, locked: true }).partial() }),
  z.object({ type: z.literal('transform'), ids: z.array(id).min(1), dx: num.optional(), dy: num.optional(),
    positions: z.array(z.object({ id, x: num, y: num })).min(1).max(10000).optional(),
    rotation: num.optional(), scaleFactor: num.positive().optional(), flip: z.boolean().optional() }),
  z.object({ type: z.literal('drawSelection'), ids: z.array(id).min(1), playerId: id, faceUp: z.boolean().optional() }),
  z.object({ type: z.literal('delete'), ids: z.array(id) }),
  z.object({ type: z.literal('stack'), ids: z.array(id), stackId: id }),
  z.object({ type: z.literal('dropStack'), ids: z.array(id).min(1), targetId: id, stackId: id }),
  z.object({ type: z.literal('unstack'), id }),
  z.object({ type: z.literal('reorder'), ids: z.array(id) }),
  z.object({ type: z.literal('shuffle'), id, seed: z.number().int() }),
  z.object({ type: z.literal('draw'), id, playerId: id, faceUp: z.boolean().optional() }),
  z.object({ type: z.literal('drawMany'), id, playerId: id, count: z.number().int().min(1).max(1000), faceUp: z.boolean().optional() }),
  z.object({ type: z.literal('release'), id, x: num, y: num }),
  z.object({ type: z.literal('dropFromHand'), id, targetId: id, stackId: id }),
  z.object({ type: z.literal('reorderHand'), ids: z.array(id), playerId: id }),
  z.object({ type: z.literal('player'), player: playerSchema }),
  z.object({ type: z.literal('removePlayer'), playerId: id }),
  z.object({ type: z.literal('reorderPlayers'), ids: z.array(id).min(1) }),
  z.object({ type: z.literal('endTurn') }),
  z.object({ type: z.literal('handSettings'), playerId: id, patch: playerSchema.pick({ allowHandInsert: true, allowHandTake: true, handFaceUp: true, tableHandHidden: true, tableHandUnlocked: true }) }),
  z.object({ type: z.literal('settings'), patch: projectSchema.shape.settings.partial() }),
  z.object({ type: z.literal('rename'), name: z.string().min(1).max(100) }),
]);
export type Command = z.infer<typeof commandSchema>;

export function uid(prefix = 'id'): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
}

export function bind(text: string, row: Record<string, string> = {}): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => row[key] ?? '');
}

export function safeImage(url: string): string | undefined {
  if (/^https?:\/\//i.test(url) || /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(url)) return url;
  return undefined;
}

// Component arrays that already passed validation. Projects are updated immutably, so a command that keeps the same
// array (every non-design command) only revalidates tabletop state instead of every design.
const validatedComponents = new WeakSet<Component[]>();

function validateComponents(components: Component[]) {
  const componentIds = new Set(components.map(c => c.id));
  let assetBytes = 0;
  for (const c of components) {
    if (isAsset(c)) {
      if (!c.asset || (c.kind === 'texture' ? !c.asset.mime.startsWith('image/') : !c.asset.mime.startsWith('font/'))) throw new Error('Asset component needs a matching texture or font file.');
      if (c.front.length || c.back.length || c.rows.length || c.hand || c.flippable || c.stackable || c.shufflable) throw new Error('Assets cannot contain layers, variants or piece behaviors.');
      const bytes = c.asset.data.length * 3 / 4 - (c.asset.data.endsWith('==') ? 2 : c.asset.data.endsWith('=') ? 1 : 0);
      if (bytes > MAX_ASSET_BYTES) throw new Error('Each imported asset must be at most 5 MiB.');
      assetBytes += bytes;
      if (assetBytes > 20 * 1024 * 1024) throw new Error('Imported assets in one project must total at most 20 MiB.');
    } else if (c.asset) throw new Error('Only texture and font components can own imported assets.');
    for (const face of [c.front, c.back]) {
      const nodes = new Map(face.map(n => [n.id, n]));
      if (nodes.size !== face.length) throw new Error('Duplicate layer identifiers.');
      for (const node of face) {
        if (node.textureId && (node.type !== 'image' || components.find(item => item.id === node.textureId)?.kind !== 'texture')) throw new Error('Image layer references a missing texture.');
        if (node.fontId && (node.type !== 'text' || components.find(item => item.id === node.fontId)?.kind !== 'font')) throw new Error('Text layer references a missing font.');
        if (node.type === 'shape' && node.shapeKind === 'path' && node.points.length < (node.pathClosed ? 3 : 2)) {
          throw new Error(`Path “${node.name}” needs at least ${node.pathClosed ? 3 : 2} points.`);
        }
        // A linked artwork layer may not have chosen its component yet; it renders a placeholder.
        if (node.type === 'component' && node.componentId !== undefined) {
          if (!componentIds.has(node.componentId)) throw new Error(`Nested component “${node.name}” references a missing component.`);
          const nested = components.find(item => item.id === node.componentId)!;
          if (isAsset(nested)) throw new Error('Assets must be used through image or text layers, not nested as pieces.');
          if (node.dataSource === 'row' && node.dataRow >= nested.rows.length) {
            throw new Error(`Nested component “${node.name}” row ${node.dataRow} is out of range.`);
          }
        }
        if (node.type === 'compound' && face.filter(child => child.parent === node.id).length < 2) {
          throw new Error(`Live compound “${node.name}” needs at least two source shapes.`);
        }
        if (node.parent) {
          const parentNode = nodes.get(node.parent);
          if (parentNode?.type === 'compound' && !['shape', 'compound'].includes(node.type)) {
            throw new Error('Live compounds can contain only vector shapes and other compounds.');
          }
        }
        const seen = new Set([node.id]);
        let parent = node.parent;
        while (parent) {
          if (seen.has(parent)) throw new Error('Layer hierarchy contains a cycle.');
          seen.add(parent);
          const ancestor = nodes.get(parent);
          if (!ancestor || !['frame', 'compound'].includes(ancestor.type)) throw new Error('Layer parent must be an existing frame or live compound.');
          parent = ancestor.parent;
        }
      }
    }
  }
  const links = new Map(components.map(component => [component.id, new Set(
    [...component.front, ...component.back].flatMap(node => node.type === 'component' && node.componentId ? [node.componentId] : []),
  )]));
  const references = new Map(components.map(component => [component.id,
    [...component.front, ...component.back].flatMap(node => node.type === 'component' && node.componentId ? [node.componentId] : []),
  ]));
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (componentId: string, depth: number) => {
    if (depth > 32) throw new Error('Nested components cannot be more than 32 levels deep.');
    if (visiting.has(componentId)) throw new Error('Nested component references contain a cycle.');
    if (visited.has(componentId)) return;
    visiting.add(componentId);
    for (const linkedId of links.get(componentId) ?? []) visit(linkedId, depth + 1);
    visiting.delete(componentId); visited.add(componentId);
  };
  for (const component of components) visit(component.id, 0);
  const renderCosts = new Map<string, number>();
  const renderCost = (componentId: string): number => {
    const cached = renderCosts.get(componentId);
    if (cached !== undefined) return cached;
    const component = components.find(item => item.id === componentId)!;
    const ownNodes = Math.max(component.front.length, component.back.length);
    const total = ownNodes + (references.get(componentId) ?? []).reduce((sum, linkedId) => sum + renderCost(linkedId), 0);
    if (total > MAX_NESTED_RENDER_NODES) throw new Error(`Nested component rendering exceeds ${MAX_NESTED_RENDER_NODES} layers.`);
    renderCosts.set(componentId, total);
    return total;
  };
  components.forEach(component => { renderCost(component.id); });
}

export function validateProject(project: Project): Project {
  const trusted = validatedComponents.has(project.components);
  (trusted ? projectSchema.omit({ components: true }) : projectSchema).parse(project);
  const componentIds = new Map(project.components.map(c => [c.id, c]));
  const playerIds = new Set(project.players.map(p => p.id));
  if (componentIds.size !== project.components.length || playerIds.size !== project.players.length ||
    new Set(project.instances.map(i => i.id)).size !== project.instances.length) throw new Error('Duplicate identifiers in project.');
  if (!trusted) validateComponents(project.components);
  for (const i of project.instances) {
    if (!componentIds.has(i.componentId) || (i.holder && !playerIds.has(i.holder))) throw new Error('Broken component or player reference.');
    if (isAsset(componentIds.get(i.componentId)!)) throw new Error('Textures and fonts cannot be placed on the playground.');
    if (i.stack && i.holder) throw new Error('A held component cannot belong to a stack.');
  }
  const groups = new Map<string, Instance[]>();
  for (const i of project.instances) if (i.stack) groups.set(i.stack, [...(groups.get(i.stack) ?? []), i]);
  for (const group of groups.values()) {
    if (!canStack(group.map(i => project.components.find(c => c.id === i.componentId)!))) throw new Error('Incompatible components in stack.');
    if (group.some(i => !!i.stackReversed !== !!group[0].stackReversed)) throw new Error('Inconsistent stack orientation.');
  }
  if (project.instances.some(i => !i.stack && i.stackReversed)) throw new Error('Only stacks can have a stack orientation.');
  validateGroups(project);
  validatedComponents.add(project.components);
  return project;
}

function validateGroups(project: Project) {
  const groups = new Map((project.groups ?? []).map(group => [group.id, group]));
  if (groups.size !== (project.groups ?? []).length) throw new Error('Duplicate piece group identifiers.');
  for (const group of groups.values()) {
    let depth = 0;
    for (let parent = group.parent; parent; parent = groups.get(parent)!.parent) {
      if (!groups.has(parent)) throw new Error('A piece group references a missing parent group.');
      if (parent === group.id || ++depth > 32) throw new Error('Piece groups cannot contain themselves or nest more than 32 levels deep.');
    }
  }
  const stackGroups = new Map<string, string>();
  for (const item of project.instances) {
    if (item.group) {
      if (!groups.has(item.group)) throw new Error('A piece references a missing group.');
      if (item.holder) throw new Error('Held pieces cannot belong to a piece group.');
    }
    if (!item.stack) continue;
    const seen = stackGroups.get(item.stack);
    if (seen !== undefined && seen !== (item.group ?? '')) throw new Error('Every piece in a stack must share its group.');
    stackGroups.set(item.stack, item.group ?? '');
  }
}

/** Group IDs that contain `id` (inclusive), from the group itself up to its top-level ancestor. */
export function groupAncestors(groups: PieceGroup[], id: string | null | undefined): string[] {
  const byId = new Map(groups.map(group => [group.id, group]));
  const chain: string[] = [];
  for (let current = id ? byId.get(id) : undefined; current && !chain.includes(current.id); current = current.parent ? byId.get(current.parent) : undefined) chain.push(current.id);
  return chain;
}

/** Keeps piece groups consistent after a tabletop change: held pieces leave groups, stacks share their bottom piece's group, empty groups disappear. */
function normalizeGroups(p: Project) {
  const groups = p.groups ?? [];
  // A table without groups has no `groups` field, so ungrouped projects keep their original shape.
  if (!groups.length) { p.instances.forEach(item => { delete item.group; }); delete p.groups; return; }
  const known = new Set(groups.map(group => group.id));
  const bottoms = new Map<string, Instance>();
  for (const item of p.instances) {
    if (item.holder || (item.group && !known.has(item.group))) delete item.group;
    if (item.stack && (!bottoms.has(item.stack) || item.order < bottoms.get(item.stack)!.order)) bottoms.set(item.stack, item);
  }
  for (const item of p.instances) if (item.stack) {
    const group = bottoms.get(item.stack)!.group;
    if (group) item.group = group; else delete item.group;
  }
  let remaining = groups;
  for (let previous = -1; previous !== remaining.length;) {
    previous = remaining.length;
    const used = new Set([...p.instances.flatMap(item => item.group ? [item.group] : []), ...remaining.flatMap(group => group.parent ? [group.parent] : [])]);
    remaining = remaining.filter(group => used.has(group.id));
  }
  if (remaining.length) p.groups = remaining; else delete p.groups;
}

/**
 * Table order in which every group's pieces sit next to each other, the way the Pieces panel lists them: each group
 * (and each loose stack or piece) takes the place of its topmost piece, and so does every subgroup inside its parent.
 * Boards and held pieces keep their places first; they don't take part in table order.
 */
export function gatherGroups(p: Project): Instance[] {
  const groups = p.groups ?? [];
  if (!groups.length) return p.instances;
  const kinds = new Map(p.components.map(component => [component.id, component.kind]));
  const position = new Map(p.instances.map((item, index) => [item, index]));
  const rest: Instance[] = [], units = new Map<string, Instance[]>();
  for (const item of p.instances) {
    if (item.holder || kinds.get(item.componentId) === 'board') { rest.push(item); continue; }
    const key = item.stack ?? item.id;
    units.set(key, [...units.get(key) ?? [], item]);
  }
  const known = new Set(groups.map(group => group.id));
  const loose = new Map<string | null, Instance[][]>(), children = new Map<string | null, PieceGroup[]>();
  for (const unit of units.values()) {
    const group = unit[0].group && known.has(unit[0].group) ? unit[0].group : null;
    loose.set(group, [...loose.get(group) ?? [], unit]);
  }
  for (const group of groups) children.set(group.parent, [...children.get(group.parent) ?? [], group]);
  type Entry = { top: number; items: Instance[] };
  const level = (parent: string | null, seen: Set<string>): Entry[] => [
    ...(children.get(parent) ?? []).filter(group => !seen.has(group.id)).map(group => {
      const inner = level(group.id, new Set([...seen, group.id]));
      return { top: Math.max(-1, ...inner.map(entry => entry.top)), items: inner.flatMap(entry => entry.items) };
    }),
    ...(loose.get(parent) ?? []).map(unit => ({ top: Math.max(...unit.map(item => position.get(item)!)), items: unit })),
  ].sort((a, b) => a.top - b.top);
  const ordered = [...rest, ...level(null, new Set()).flatMap(entry => entry.items)];
  return ordered.every((item, index) => item === p.instances[index]) ? p.instances : ordered;
}

/** Reuses previous component objects whose content is unchanged (and the previous array when nothing changed). */
export function shareComponents(previous: Component[], next: Component[]): Component[] {
  const known = new Map(previous.map(component => [component.id, component]));
  const shared = next.map(component => {
    const old = known.get(component.id);
    return old && JSON.stringify(old) === JSON.stringify(component) ? old : component;
  });
  return shared.length === previous.length && shared.every((component, index) => component === previous[index]) ? previous : shared;
}

export function canStack(components: Component[]): boolean {
  if (!components.length || components.some(c => !c.stackable)) return false;
  const first = components[0];
  return components.every(c => first.stackTag ? c.stackTag === first.stackTag : c.id === first.id);
}

export function stackMembers(project: Project, instance: Instance): Instance[] {
  return (instance.stack ? project.instances.filter(i => i.stack === instance.stack) : [instance]).sort((a, b) => a.order - b.order);
}
export function visibleStackMembers(project: Project, instance: Instance): Instance[] {
  const members = stackMembers(project, instance);
  return instance.stack && instance.stackReversed ? members.reverse() : members;
}
export function visibleBack(instance: Instance): boolean {
  return instance.flipped !== !!(instance.stack && instance.stackReversed);
}

const designCommands = new Set<Command['type']>(['component', 'addComponents', 'syncLinkedComponents', 'removeComponent', 'reorderComponent']);

export function applyCommand(source: Project, raw: Command, actor?: string): Project {
  const command = commandSchema.parse(raw);
  // Only design commands change components. Other commands keep the source component objects, so memoized
  // faces skip re-rendering and callers can detect design changes by reference; validateProject still checks them.
  const p = designCommands.has(command.type) ? projectSchema.parse(source)
    : { ...projectSchema.omit({ components: true }).parse(source), components: source.components };
  const get = (key: string) => {
    const item = p.instances.find(i => i.id === key);
    if (!item) throw new Error('Component instance no longer exists.');
    return item;
  };
  const editable = (i: Instance) => {
    if (i.holder && i.holder !== actor) throw new Error("Switch to this player's seat to edit their hand.");
  };
  const component = (i: Instance) => {
    const c = p.components.find(c => c.id === i.componentId);
    if (!c) throw new Error('Component no longer exists.');
    return c;
  };
  // When a stack is dismantled or merged, materialize its visible order/faces.
  const materialize = (items: Instance[]) => {
    if (!items[0]?.stackReversed) return;
    [...items].reverse().forEach((item, order) => {
      item.order = order;
      if (component(item).flippable) item.flipped = !item.flipped;
      item.stackReversed = false;
    });
  };
  // Grouping is organisational: it takes whole table stacks (locked pieces too) and never moves anything on the table.
  const groupedPieces = (ids: string[]) => {
    const pieces = new Set<Instance>();
    for (const item of [...new Set(ids)].map(get)) {
      if (item.holder) throw new Error('Only table pieces can be grouped.');
      stackMembers(p, item).forEach(member => pieces.add(member));
    }
    return [...pieces];
  };
  const existingGroups = (ids: string[]) => [...new Set(ids)].map(key => {
    const group = p.groups?.find(item => item.id === key);
    if (!group) throw new Error('Piece group no longer exists.');
    return group;
  });
  const regroup = (pieces: Instance[], moving: PieceGroup[], parent: string | null) => {
    const ancestors = groupAncestors(p.groups ?? [], parent);
    if (moving.some(group => ancestors.includes(group.id))) throw new Error('A group cannot be moved into itself.');
    pieces.forEach(item => { if (parent) item.group = parent; else delete item.group; });
    moving.forEach(group => { group.parent = parent; });
  };
  // Table render order works on units: a stack or a single piece. Held pieces and boards (always drawn underneath)
  // are not ordered and keep their places at the start of the array.
  const tableUnits = () => {
    const units = new Map<string, Instance[]>(), rest: Instance[] = [];
    for (const item of p.instances) {
      if (item.holder || component(item).kind === 'board') { rest.push(item); continue; }
      const key = item.stack ?? item.id;
      units.set(key, [...units.get(key) ?? [], item]);
    }
    return { rest, units: [...units.values()] };
  };
  const drawOrder = (items: Instance[]) => {
    const seen = new Set<string>();
    return items.flatMap(item => {
      if (!item.stack) return [item];
      if (seen.has(item.stack)) return [];
      seen.add(item.stack);
      return items.filter(other => other.stack === item.stack)
        .sort((a, b) => item.stackReversed ? a.order - b.order : b.order - a.order);
    });
  };
  switch (command.type) {
    case 'component': {
      const index = p.components.findIndex(c => c.id === command.component.id);
      assertComponentEdit(p.components, command.component, command.removedDataRow);
      if (command.removedDataRow !== undefined) {
        const previous = p.components[index];
        const removed = command.removedDataRow;
        const remap = (row: number) => Math.min(row > removed ? row - 1 : row, command.component.rows.length - 1);
        p.instances.filter(item => item.componentId === previous.id).forEach(item => { item.row = remap(item.row); });
        for (const owner of [...p.components.filter(item => item.id !== previous.id), command.component]) {
          for (const node of [...owner.front, ...owner.back]) {
            if (node.type === 'component' && node.componentId === previous.id && node.dataSource === 'row') node.dataRow = remap(node.dataRow);
          }
        }
      }
      if (index < 0) p.components.push(command.component);
      else p.components[index] = command.component;
      for (const i of p.instances.filter(i => i.componentId === command.component.id)) {
        if (!command.component.flippable) i.flipped = false;
        if (!command.component.hand) i.holder = null;
        if (!command.component.stackable || source.components.find(c => c.id === i.componentId)?.stackTag !== command.component.stackTag) i.stack = null;
      }
      break;
    }
    case 'addComponents':
    case 'syncLinkedComponents': {
      const ids = new Set<string>();
      for (const component of command.components) {
        if (ids.has(component.id)) throw new Error('Duplicate component identifier.');
        ids.add(component.id);
        const previous = p.components.find(c => c.id === component.id);
        if (command.type === 'addComponents') {
          if (previous) throw new Error('Component identifier already exists.');
          assertUniqueAssetName(p.components, component);
          p.components.push(component);
        } else {
          if (!component.source || (previous && (!previous.source ||
            component.source.projectId !== previous.source.projectId || component.source.componentId !== previous.source.componentId))) {
            throw new Error('Only matching read-only component links can be refreshed.');
          }
          if (previous) p.components[p.components.indexOf(previous)] = component;
          else p.components.push(component);
        }
      }
      if (command.type === 'syncLinkedComponents') {
        for (const instance of p.instances.filter(item => ids.has(item.componentId))) {
          const component = p.components.find(c => c.id === instance.componentId)!;
          const previous = source.components.find(c => c.id === instance.componentId)!;
          instance.row = Math.min(instance.row, Math.max(0, component.rows.length - 1));
          if (!component.flippable) instance.flipped = false;
          if (!component.hand) instance.holder = null;
          if (!component.stackable || previous.stackTag !== component.stackTag) instance.stack = null;
        }
        for (const component of p.components) for (const node of [...component.front, ...component.back]) {
          if (node.type === 'component' && node.componentId && ids.has(node.componentId) && node.dataSource === 'row') {
            node.dataRow = Math.min(node.dataRow, Math.max(0, p.components.find(c => c.id === node.componentId)!.rows.length - 1));
          }
        }
      }
      break;
    }
    case 'reorderComponent': {
      const moving = p.components.find(c => c.id === command.id);
      if (!moving || !p.components.some(c => c.id === command.targetId)) throw new Error('Component no longer exists.');
      if (command.id === command.targetId) break;
      p.components = p.components.filter(c => c.id !== command.id);
      const index = p.components.findIndex(c => c.id === command.targetId);
      p.components.splice(index + (command.position === 'after' ? 1 : 0), 0, moving);
      break;
    }
    case 'removeComponent': {
      if (!p.components.some(component => component.id === command.id)) throw new Error('Component no longer exists.');
      const referencing = p.components.find(component => [...component.front, ...component.back].some(node => node.type === 'component' && node.componentId === command.id));
      if (referencing) throw new Error(`“${referencing.name}” links this component. Remove or relink that nested instance first.`);
      for (const component of p.components) for (const node of [...component.front, ...component.back]) {
        if (node.textureId === command.id) { delete node.textureId; node.text = ''; }
        if (node.fontId === command.id) { delete node.fontId; node.font = 'DM Sans'; }
      }
      p.components = p.components.filter(c => c.id !== command.id);
      p.instances = p.instances.filter(i => i.componentId !== command.id);
      break;
    }
    case 'spawn':
      for (const item of command.instances) {
        if (p.instances.some(i => i.id === item.id)) throw new Error('Instance identifier already exists.');
        if (item.holder || item.stack) throw new Error('Spawn components onto the table first.');
        component(item);
        p.instances.push(item);
      }
      break;
    case 'paste':
      for (const item of command.instances) {
        if (p.instances.some(i => i.id === item.id)) throw new Error('Instance identifier already exists.');
        if (item.holder || item.locked) throw new Error('Pasted components must be unlocked and on the table.');
        if (item.stack && source.instances.some(existing => existing.stack === item.stack)) throw new Error('Stack identifier already exists.');
        component(item);
        p.instances.push(item);
      }
      break;
    case 'duplicate': {
      const originals = command.copies.map(copy => get(copy.sourceId));
      if (new Set(command.copies.map(copy => copy.sourceId)).size !== originals.length ||
          new Set(command.copies.map(copy => copy.id)).size !== originals.length ||
          command.copies.some(copy => p.instances.some(i => i.id === copy.id))) throw new Error('Duplicate identifiers in copies.');
      originals.forEach(i => {
        editable(i);
        if (i.stack && stackMembers(p, i).some(member => !originals.includes(member))) throw new Error('Copy the entire stack.');
      });
      const groups = new Map<string, string>();
      command.copies.forEach((copy, index) => {
        const original = originals[index];
        if (original.stack) {
          if (!copy.stack || (groups.has(original.stack) && groups.get(original.stack) !== copy.stack)) throw new Error('Copies must preserve their stack.');
          groups.set(original.stack, copy.stack);
        } else if (copy.stack) throw new Error('Cannot add a copy to a stack.');
      });
      if (new Set(groups.values()).size !== groups.size || [...groups.values()].some(stack => p.instances.some(i => i.stack === stack))) throw new Error('Stack identifier already exists.');
      command.copies.forEach((copy, index) => p.instances.push({ ...originals[index], id: copy.id, stack: copy.stack, holder: null, locked: false, x: originals[index].x + command.dx, y: originals[index].y + command.dy }));
      break;
    }
    case 'front': {
      const items = [...new Set(command.ids)].map(get);
      items.forEach(editable);
      p.instances = [...p.instances.filter(i => !items.includes(i)), ...items];
      break;
    }
    case 'zOrder': {
      const ids = new Set(command.ids.map(key => get(key).id));
      const { rest, units } = tableUnits();
      const chosen = new Set(units.filter(members => members.some(item => ids.has(item.id))));
      chosen.forEach(members => members.forEach(editable));
      const box = (members: Instance[]) => {
        const item = members.at(-1)!, c = component(item), turn = item.rotation * Math.PI / 180;
        const cos = Math.abs(Math.cos(turn)), sin = Math.abs(Math.sin(turn));
        const halfWidth = (c.width * cos + c.height * sin) * item.scale / 2, halfHeight = (c.width * sin + c.height * cos) * item.scale / 2;
        return { left: item.x - halfWidth, right: item.x + halfWidth, top: item.y - halfHeight, bottom: item.y + halfHeight };
      };
      const overlaps = (a: Instance[], b: Instance[]) => {
        const first = box(a), second = box(b);
        return first.left < second.right && second.left < first.right && first.top < second.bottom && second.top < first.bottom;
      };
      p.instances = [...rest, ...reorder(units, members => chosen.has(members), command.move, overlaps).flat()];
      break;
    }
    case 'extractMove': {
      const item = get(command.id);
      editable(item);
      if (item.holder || item.locked) throw new Error('Only unlocked tabletop components can be moved.');
      if (item.stackReversed && component(item).flippable) item.flipped = !item.flipped;
      Object.assign(item, { stack: null, stackReversed: false, x: command.x, y: command.y });
      break;
    }
    case 'roll': {
      let seed = command.seed >>> 0;
      for (const key of new Set(command.ids)) {
        const item = get(key), c = component(item);
        editable(item);
        if (item.locked || c.kind !== 'dice') throw new Error('Only unlocked dice can be rolled.');
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        item.row = seed % Math.max(c.rows.length, 1);
        item.rolls = (item.rolls ?? 0) + 1;
      }
      break;
    }
    case 'cycleVariant':
      for (const key of new Set(command.ids)) {
        const item = get(key), c = component(item);
        editable(item);
        if (!hasPages(c)) throw new Error('Only books and dice have pages or faces to turn.');
        if (c.kind === 'dice' && item.locked) throw new Error('Unlock this die first.');
        const count = Math.max(c.rows.length, 1);
        item.row = c.kind === 'dice' ? ((item.row + command.delta) % count + count) % count : Math.max(0, Math.min(count - 1, item.row + command.delta));
      }
      break;
    case 'createGroup': {
      const groups = p.groups ??= [];
      if (groups.some(group => group.id === command.id)) throw new Error('Group identifier already exists.');
      if (command.parent && !groups.some(group => group.id === command.parent)) throw new Error('Parent group no longer exists.');
      const pieces = groupedPieces(command.ids), moving = existingGroups(command.groups);
      if (!pieces.length && !moving.length) throw new Error('Select pieces or groups to group.');
      groups.push({ id: command.id, name: command.name, parent: command.parent });
      regroup(pieces, moving, command.id);
      break;
    }
    case 'renameGroup': existingGroups([command.id])[0].name = command.name; break;
    case 'ungroup':
      for (const group of existingGroups(command.ids)) {
        p.instances.forEach(item => { if (item.group === group.id) { if (group.parent) item.group = group.parent; else delete item.group; } });
        p.groups!.forEach(child => { if (child.parent === group.id) child.parent = group.parent; });
        p.groups = p.groups!.filter(item => item !== group);
      }
      break;
    case 'moveToGroup': {
      const pieces = groupedPieces(command.ids), moving = existingGroups(command.groups);
      if (!pieces.length && !moving.length) throw new Error('Select pieces or groups to move.');
      if (command.parent && !(p.groups ?? []).some(group => group.id === command.parent)) throw new Error('Group no longer exists.');
      regroup(pieces, moving, command.parent);
      break;
    }
    case 'arrangePieces': {
      const pieces = groupedPieces(command.ids), moving = existingGroups(command.groups);
      if (!pieces.length && !moving.length) throw new Error('Select pieces or groups to move.');
      if (command.parent && !(p.groups ?? []).some(group => group.id === command.parent)) throw new Error('Group no longer exists.');
      const target = new Set(command.target.map(key => get(key).id));
      regroup(pieces, moving, command.parent);
      const inMoving = (item: Instance) => pieces.includes(item) ||
        (!!item.group && moving.some(group => groupAncestors(p.groups ?? [], item.group).includes(group.id)));
      const { rest, units } = tableUnits();
      const block = units.filter(members => members.some(inMoving)), others = units.filter(members => !block.includes(members));
      block.flat().forEach(editable);
      const targets = others.flatMap((members, index) => members.some(item => target.has(item.id)) ? [index] : []);
      if (!block.length || !targets.length) break;
      const at = command.position === 'above' ? targets.at(-1)! + 1 : targets[0];
      p.instances = [...rest, ...[...others.slice(0, at), ...block, ...others.slice(at)].flat()];
      break;
    }
    case 'releaseMany': {
      const items = [...new Set(command.ids)].map(get);
      items.forEach(item => {
        editable(item);
        if (!item.holder || item.locked) throw new Error('Only unlocked held components can be released.');
      });
      items.forEach((item, index) => Object.assign(item, { holder: null, x: command.x + index * 24, y: command.y + index * 24 }));
      break;
    }
    case 'dropManyFromHand': {
      const items = command.ids.map(get), target = get(command.targetId);
      if (new Set(command.ids).size !== items.length) throw new Error('Choose each held component once.');
      items.forEach(item => {
        editable(item);
        if (!item.holder || item.locked) throw new Error('Only unlocked held components can be released.');
      });
      const targetItems = stackMembers(p, target);
      if (targetItems.some(i => i.holder || i.locked) || !canStack([...targetItems, ...items].map(component))) throw new Error('Select compatible unlocked tabletop components.');
      if (p.instances.some(i => i.stack === command.stackId && !targetItems.includes(i))) throw new Error('Stack identifier already exists.');
      materialize(targetItems);
      [...stackMembers(p, target), ...items].forEach((item, order) => Object.assign(item, { holder: null, stack: command.stackId, stackReversed: false, order, x: target.x, y: target.y }));
      break;
    }
    case 'transferToHand': {
      if (!p.settings.hands) throw new Error('Enable hands before transferring components.');
      if (!actor || !p.players.some(player => player.id === actor) || !p.players.some(player => player.id === command.playerId)) throw new Error('Choose a valid active player and destination.');
      const items = command.ids.map(get);
      if (command.playerId !== actor && !handPermissions(p, command.playerId).insert && items.some(i => i.holder !== command.playerId)) throw new Error('Inserting into this player’s hand is disabled.');
      if (items.some(i => i.holder && i.holder !== actor && !handPermissions(p, i.holder).take)) throw new Error('Taking from this player’s hand is disabled.');
      if (new Set(command.ids).size !== items.length) throw new Error('Choose each component once.');
      items.forEach(item => {
        if (item.locked || !component(item).hand) throw new Error('Only unlocked components that support hands can be transferred.');
      });
      const remaining = p.instances.filter(i => i.holder === command.playerId && !items.includes(i)).sort((a, b) => a.order - b.order);
      const index = command.index ?? remaining.length;
      if (index > remaining.length) throw new Error('Hand insertion position is out of range.');
      const moving = drawOrder(items);
      moving.forEach(item => {
        if (item.stackReversed && component(item).flippable) item.flipped = !item.flipped;
        if (item.holder !== command.playerId && command.faceUp !== false) item.flipped = false;
        Object.assign(item, { holder: command.playerId, stack: null, stackReversed: false });
      });
      remaining.splice(index, 0, ...moving);
      remaining.forEach((item, order) => { item.order = order; });
      break;
    }
    case 'playVisibleHand': {
      if (!p.settings.hands) throw new Error('Enable hands before playing components.');
      if (!actor || !p.players.some(player => player.id === actor)) throw new Error('Choose a valid active player.');
      const item = get(command.id);
      if (item.holder && item.holder !== actor && !handPermissions(p, item.holder).take) throw new Error('Taking from this player’s hand is disabled.');
      if (!item.holder || item.locked) throw new Error('Only unlocked held components can be released.');
      if (command.targetId) {
        const target = get(command.targetId), members = stackMembers(p, target);
        if (!command.stackId || members.some(i => i.holder || i.locked) || !canStack([...members, item].map(component))) throw new Error('Select compatible unlocked tabletop components.');
        if (p.instances.some(i => i.stack === command.stackId && !members.includes(i))) throw new Error('Stack identifier already exists.');
        materialize(members);
        stackMembers(p, target).forEach((i, order) => Object.assign(i, { stack: command.stackId, stackReversed: false, order, x: target.x, y: target.y }));
        Object.assign(item, { holder: null, stack: command.stackId, stackReversed: false, order: members.length, x: target.x, y: target.y });
      } else Object.assign(item, { holder: null, x: command.x, y: command.y });
      break;
    }
    case 'move':
      for (const key of command.ids) {
        const item = get(key);
        editable(item);
        if (item.locked && command.patch.locked !== false) throw new Error('Unlock this component first.');
        if (command.patch.flipped !== undefined && !component(item).flippable) throw new Error('This component is not flippable.');
        Object.assign(item, command.patch);
      }
      break;
    case 'transform': {
      const selectedIds = new Set(command.ids);
      const positions = command.positions ? new Map(command.positions.map(position => [position.id, position])) : undefined;
      if (positions) {
        if (command.dx !== undefined || command.dy !== undefined) throw new Error('Use absolute positions or relative movement, not both.');
        if (positions.size !== command.positions!.length || positions.size !== selectedIds.size || [...selectedIds].some(key => !positions.has(key))) {
          throw new Error('Provide exactly one destination for each selected piece.');
        }
        const stacks = new Map<string, { x: number; y: number }>();
        for (const key of selectedIds) {
          const item = get(key), destination = positions.get(key)!;
          if (!item.stack) continue;
          if (p.instances.some(member => member.stack === item.stack && !selectedIds.has(member.id))) throw new Error('Select the entire stack.');
          const first = stacks.get(item.stack);
          if (first && (first.x !== destination.x || first.y !== destination.y)) throw new Error('Stack members must move to the same destination.');
          stacks.set(item.stack, destination);
        }
      }
      const flippedStacks = new Set<string>();
      if (command.flip) for (const key of selectedIds) {
        const item = get(key);
        if (item.stack && stackMembers(p, item).some(member => component(member).flippable) && stackMembers(p, item).every(member => selectedIds.has(member.id))) flippedStacks.add(item.stack);
      }
      for (const key of new Set(command.ids)) {
        const item = get(key);
        editable(item);
        if (item.locked) throw new Error('Unlock this component first.');
        item.x = positions?.get(key)?.x ?? item.x + (command.dx ?? 0);
        item.y = positions?.get(key)?.y ?? item.y + (command.dy ?? 0);
        item.rotation = (item.rotation + (command.rotation ?? 0)) % 360;
        // Rounding keeps relative factors such as target / current from drifting below the typed value.
        item.scale = Math.round(item.scale * (command.scaleFactor ?? 1) * 1e9) / 1e9;
        if (command.flip && item.stack && flippedStacks.has(item.stack)) item.stackReversed = !item.stackReversed;
        else if (command.flip && component(item).flippable) item.flipped = !item.flipped;
      }
      break;
    }
    case 'delete':
      for (const key of command.ids) editable(get(key));
      p.instances = p.instances.filter(i => !command.ids.includes(i.id));
      break;
    case 'stack': {
      const items = command.ids.map(get);
      items.forEach(i => { editable(i); if (i.locked || i.holder) throw new Error('Only unlocked tabletop components can be stacked.'); });
      if (items.length < 2 || new Set(command.ids).size !== items.length || !canStack(items.map(component))) throw new Error('Select at least two compatible stackable components.');
      if (items.some(i => i.stack && p.instances.some(other => other.stack === i.stack && !command.ids.includes(other.id)))) throw new Error('Select the entire stack.');
      if (p.instances.some(i => i.stack === command.stackId && !items.includes(i))) throw new Error('Stack identifier already exists.');
      const priorStacks = new Set(items.flatMap(i => i.stack ? [i.stack] : []));
      priorStacks.forEach(stack => materialize(stackMembers(p, items.find(i => i.stack === stack)!)));
      const seenStacks = new Set<string>();
      const ordered = items.flatMap(item => {
        if (!item.stack) return [item];
        if (seenStacks.has(item.stack)) return [];
        seenStacks.add(item.stack);
        return items.filter(other => other.stack === item.stack).sort((a, b) => a.order - b.order);
      });
      ordered.forEach((i, order) => Object.assign(i, { stack: command.stackId, stackReversed: false, order, x: items[0].x, y: items[0].y }));
      break;
    }
    case 'dropStack': {
      const target = get(command.targetId);
      const targetItems = stackMembers(p, target);
      const items = command.ids.map(get);
      if (new Set(command.ids).size !== items.length || items.some(i => targetItems.includes(i))) throw new Error('Choose a different stack.');
      if (items.some(i => i.stack && stackMembers(p, i).some(other => !command.ids.includes(other.id)))) throw new Error('Select the entire stack.');
      const combined = [...targetItems, ...items];
      combined.forEach(i => { editable(i); if (i.locked || i.holder) throw new Error('Only unlocked tabletop components can be stacked.'); });
      if (!canStack(combined.map(component))) throw new Error('Select compatible stackable components.');
      if (p.instances.some(i => i.stack === command.stackId && !combined.includes(i))) throw new Error('Stack identifier already exists.');
      const priorStacks = new Set(combined.flatMap(i => i.stack ? [i.stack] : []));
      priorStacks.forEach(stack => materialize(stackMembers(p, combined.find(i => i.stack === stack)!)));
      const orderedTarget = stackMembers(p, target);
      const seenStacks = new Set<string>();
      const orderedMoving = items.flatMap(item => {
        if (!item.stack) return [item];
        if (seenStacks.has(item.stack)) return [];
        seenStacks.add(item.stack);
        return items.filter(other => other.stack === item.stack).sort((a, b) => a.order - b.order);
      });
      [...orderedTarget, ...orderedMoving].forEach((i, order) => Object.assign(i, { stack: command.stackId, stackReversed: false, order, x: target.x, y: target.y }));
      break;
    }
    case 'unstack': {
      const items = stackMembers(p, get(command.id));
      materialize(items);
      items.forEach((i, n) => { editable(i); if (i.locked) throw new Error('Unlock the stack first.'); Object.assign(i, { stack: null, x: i.x + n * 36, y: i.y + n * 12 }); });
      break;
    }
    case 'shuffle': {
      const items = stackMembers(p, get(command.id));
      if (!items.every(i => component(i).shufflable)) throw new Error('This stack cannot be shuffled.');
      let seed = command.seed >>> 0;
      for (let n = items.length - 1; n > 0; n--) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const j = seed % (n + 1);
        [items[n], items[j]] = [items[j], items[n]];
      }
      items.forEach((i, n) => { editable(i); i.order = n; });
      break;
    }
    case 'reorder': {
      const items = command.ids.map(get);
      if (!items.length || !items[0].stack || items.some(i => i.stack !== items[0].stack) ||
        stackMembers(p, items[0]).length !== items.length || new Set(command.ids).size !== items.length) throw new Error('Reorder must contain every item in one stack.');
      items.forEach((i, order) => { editable(i); i.order = order; });
      break;
    }
    case 'draw':
    case 'drawMany': {
      if (!p.settings.hands) throw new Error('Enable hands before drawing.');
      if (!p.players.some(player => player.id === command.playerId)) throw new Error('Choose a player first.');
      if (actor && command.playerId !== actor) throw new Error('Draw into your active hand.');
      const items = visibleStackMembers(p, get(command.id));
      if (items.some(i => i.holder)) throw new Error('Draw from the table.');
      const drawn = items.slice(-Math.min(command.type === 'drawMany' ? command.count : 1, items.length)).reverse();
      drawn.forEach(item => { editable(item); if (item.locked || !component(item).hand) throw new Error('This component cannot be put in hand.'); });
      let order = Math.max(-1, ...p.instances.filter(i => i.holder === command.playerId).map(i => i.order));
      drawn.forEach(item => {
        if (item.stackReversed && component(item).flippable) item.flipped = !item.flipped;
        if (command.faceUp !== false) item.flipped = false;
        Object.assign(item, { holder: command.playerId, stack: null, stackReversed: false, order: ++order });
      });
      break;
    }
    case 'drawSelection': {
      if (!p.settings.hands) throw new Error('Enable hands before drawing.');
      if (!p.players.some(player => player.id === command.playerId)) throw new Error('Choose a player first.');
      if (actor && command.playerId !== actor) throw new Error('Draw into your active hand.');
      const items = drawOrder([...new Set(command.ids)].map(get));
      let order = Math.max(-1, ...p.instances.filter(i => i.holder === command.playerId).map(i => i.order));
      for (const item of items) {
        editable(item);
        if (item.holder || item.locked || !component(item).hand) throw new Error('Only unlocked tabletop components that support hands can be drawn.');
        if (item.stackReversed && component(item).flippable) item.flipped = !item.flipped;
        if (command.faceUp !== false) item.flipped = false;
        Object.assign(item, { holder: command.playerId, stack: null, stackReversed: false, order: ++order });
      }
      break;
    }
    case 'release':
    case 'dropFromHand': {
      const item = get(command.id);
      editable(item);
      if (!item.holder) throw new Error('This component is not in a hand.');
      if (item.locked) throw new Error('Unlock this component first.');
      if (command.type === 'dropFromHand') {
        const target = get(command.targetId);
        const items = stackMembers(p, target);
        if (!command.stackId || items.some(i => i.holder || i.locked) || !canStack([...items, item].map(component))) throw new Error('Select compatible unlocked tabletop components.');
        if (p.instances.some(i => i.stack === command.stackId && !items.includes(i))) throw new Error('Stack identifier already exists.');
        materialize(items);
        stackMembers(p, target).forEach((i, order) => Object.assign(i, { stack: command.stackId, stackReversed: false, order, x: target.x, y: target.y }));
        Object.assign(item, { holder: null, stack: command.stackId, stackReversed: false, order: items.length, x: target.x, y: target.y });
        break;
      }
      Object.assign(item, { holder: null, x: command.x, y: command.y });
      break;
    }
    case 'reorderHand': {
      if (actor && command.playerId !== actor) throw new Error('Reorder your active hand.');
      const held = p.instances.filter(i => i.holder === command.playerId);
      const items = command.ids.map(get);
      if (!p.players.some(player => player.id === command.playerId) || items.length !== held.length ||
        new Set(command.ids).size !== items.length || items.some(i => i.holder !== command.playerId)) throw new Error('Reorder must contain every item in one hand.');
      items.forEach((i, order) => { editable(i); i.order = order; });
      break;
    }
    case 'handSettings': {
      const player = p.players.find(player => player.id === command.playerId);
      // Seat owners change their own settings; servers additionally let the room host override other seats.
      if (!player) throw new Error('Seat no longer exists.');
      Object.assign(player, command.patch);
      break;
    }
    case 'player': {
      const index = p.players.findIndex(player => player.id === command.player.id);
      if (index < 0) p.players.push(command.player);
      else p.players[index] = command.player;
      break;
    }
    case 'removePlayer': {
      const index = p.players.findIndex(player => player.id === command.playerId);
      if (index < 0) throw new Error('Seat no longer exists.');
      const seat = p.players[index];
      // Lay the hand out in rows centered on the seat, growing toward the table along the seat's facing.
      const held = p.instances.filter(i => i.holder === seat.id).sort((a, b) => a.order - b.order);
      const step = Math.max(0, ...held.map(i => component(i).width * i.scale)) + 16;
      const rowStep = Math.max(0, ...held.map(i => component(i).height * i.scale)) + 16;
      const perRow = 8, angle = seat.rotation * Math.PI / 180;
      const along = { x: Math.cos(angle), y: Math.sin(angle) }, inward = { x: Math.sin(angle), y: -Math.cos(angle) };
      held.forEach((item, n) => {
        const row = Math.floor(n / perRow), columns = Math.min(perRow, held.length - row * perRow);
        const offset = (n % perRow - (columns - 1) / 2) * step, depth = row * rowStep;
        Object.assign(item, { holder: null, stack: null, stackReversed: false, x: Math.round(seat.x + along.x * offset + inward.x * depth), y: Math.round(seat.y + along.y * offset + inward.y * depth) });
      });
      p.players.splice(index, 1);
      if (index < p.settings.turn) p.settings.turn--;
      p.settings.turn = p.players.length ? p.settings.turn % p.players.length : 0;
      break;
    }
    case 'reorderPlayers': {
      const players = command.ids.map(id => p.players.find(player => player.id === id));
      if (new Set(command.ids).size !== p.players.length || players.length !== p.players.length || players.some(player => !player)) throw new Error('Reorder must contain every seat once.');
      const current = p.players[p.settings.turn % p.players.length]?.id;
      p.players = players as Player[];
      p.settings.turn = Math.max(0, p.players.findIndex(player => player.id === current));
      break;
    }
    case 'endTurn':
      if (!p.settings.turns) throw new Error('Turn on the turn tracker first.');
      if (!p.players.length) throw new Error('Add a player first.');
      p.settings.turn = (p.settings.turn + 1) % p.players.length;
      break;
    case 'settings':
      if (command.patch.allowOtherHands !== undefined || command.patch.allowHandInsert !== undefined || command.patch.allowHandTake !== undefined) throw new Error('Change hand permissions using the per-hand settings.');
      Object.assign(p.settings, command.patch);
      if (p.players.length) p.settings.turn %= p.players.length;
      break;
    case 'rename': p.name = command.name; break;
  }
  const counts = new Map<string, number>();
  p.instances.forEach(i => { if (i.stack) counts.set(i.stack, (counts.get(i.stack) ?? 0) + 1); });
  p.instances.forEach(i => {
    if (i.stack && counts.get(i.stack) === 1) i.stack = null;
    if (!i.stack && i.stackReversed) {
      if (component(i).flippable) i.flipped = !i.flipped;
      i.stackReversed = false;
    }
  });
  normalizeGroups(p);
  // Commands that change table order or grouping keep each group's pieces together (see gatherGroups), so raising a
  // grouped piece raises its whole group and the Pieces panel always lists pieces in table order.
  if (['front', 'zOrder', 'arrangePieces', 'createGroup', 'moveToGroup', 'ungroup', 'duplicate', 'paste', 'spawn'].includes(command.type)) p.instances = gatherGroups(p);
  return validateProject(p);
}

/** The checks a `component` command makes on the edited design itself, before it touches table state. */
function assertComponentEdit(components: Component[], component: Component, removedDataRow?: number) {
  const previous = components.find(c => c.id === component.id);
  if (previous?.source || component.source) throw new Error('Linked components are read-only. Make a local copy to edit them.');
  assertUniqueAssetName(components, component);
  if (removedDataRow === undefined) return;
  if (!previous || !hasPages(previous) || previous.kind !== component.kind ||
    previous.rows.length < 2 || removedDataRow >= previous.rows.length ||
    JSON.stringify(previous.rows.filter((_, row) => row !== removedDataRow)) !== JSON.stringify(component.rows)) {
    throw new Error(`Remove exactly one existing ${previous?.kind === 'book' ? 'page' : 'dice variant'} and keep at least one.`);
  }
}

/**
 * Checks one design change against the other components as the `component` command would, without parsing the
 * whole project (imported asset data included) or table state. Returns the components with the change applied.
 * Table fix-ups (unstacking, dropping held pieces, remapping removed pages) still happen when the command runs.
 */
export function validateComponentEdit(components: Component[], raw: Component, removedDataRow?: number): Component[] {
  const component = componentSchema.parse(raw);
  assertComponentEdit(components, component, removedDataRow);
  const index = components.findIndex(c => c.id === component.id);
  const next = index < 0 ? [...components, component] : components.map((c, i) => i === index ? component : c);
  validateComponents(next);
  return next;
}

function assertUniqueAssetName(components: Component[], component: Component) {
  if (!isAsset(component) || component.source) return;
  const clash = components.find(other => other.id !== component.id && isAsset(other) && assetKey(other.name) === assetKey(component.name));
  if (clash) throw new Error(`An asset named “${clash.name}” already exists. Give each texture and font a unique name.`);
}

/** Renames incoming local textures and fonts whose names are already used by the project's (or each other's) assets. */
export function withUniqueAssetNames(incoming: Component[], existing: Component[]): Component[] {
  const known: Pick<Component, 'id' | 'kind' | 'name'>[] = [...existing];
  return incoming.map(component => {
    if (!isAsset(component) || component.source) return component;
    const name = uniqueAssetName(component.name, known, component.id);
    known.push({ id: component.id, kind: component.kind, name });
    return name === component.name ? component : { ...component, name };
  });
}

export function makeInstance(componentId: string, row = 0, x = 700, y = 450): Instance {
  return { id: uid('piece'), componentId, row, x, y, rotation: 0, scale: 1, flipped: false, holder: null, stack: null, order: 0, locked: false };
}

// Seats sit on an ellipse around the table. Angle 0 is the bottom edge, 90 the left, 180 the top and 270 the right;
// a seat's rotation equals its angle, so every seat faces the table centre.
const SEAT_RING = { x: 980, y: 550, rx: 760, ry: 450 };
const SEAT_ANGLES = (() => {
  const angles = [0, 180, 90, 270];
  for (let step = 45; angles.length < 128; step /= 2) {
    for (let angle = step; angle < 360; angle += step * 2) for (const offset of [0, 180]) {
      const candidate = (angle + offset) % 360;
      if (!angles.includes(candidate)) angles.push(candidate);
    }
  }
  return angles;
})();

export function nextSeatPlacement(players: Pick<Player, 'x' | 'y'>[]): Pick<Player, 'x' | 'y' | 'rotation'> {
  const taken = players.map(seat => (Math.atan2(-(seat.x - SEAT_RING.x) / SEAT_RING.rx, (seat.y - SEAT_RING.y) / SEAT_RING.ry) * 180 / Math.PI + 360) % 360);
  const gap = (angle: number) => Math.min(360, ...taken.map(other => { const d = Math.abs(angle - other) % 360; return Math.min(d, 360 - d); }));
  // Take the first spot in "opposite, left, right, then in between" order that is furthest from every existing seat.
  const angle = SEAT_ANGLES.reduce((best, candidate) => gap(candidate) > gap(best) + 0.01 ? candidate : best);
  const radians = angle * Math.PI / 180;
  return { x: Math.round(SEAT_RING.x - SEAT_RING.rx * Math.sin(radians)), y: Math.round(SEAT_RING.y + SEAT_RING.ry * Math.cos(radians)),
    rotation: angle > 180 ? angle - 360 : angle };
}

export function makeNode(type: DesignNode['type'], values: Partial<DesignNode> = {}): DesignNode {
  return {
    id: values.id ?? uid('layer'), parent: null, name: type[0].toUpperCase() + type.slice(1), type,
    x: 16, y: 16, width: 150, height: 40, text: type === 'text' ? 'Your text' : '',
    fill: type === 'text' ? 'transparent' : '#e8b86d', color: '#253d37',
    fontSize: 20, font: 'DM Sans', radius: 0, rotation: 0,
    layout: 'absolute', gap: 8, padding: 0, align: 'start', opacity: 1, ...values,
    shapeKind: values.shapeKind ?? 'rectangle', points: values.points ?? [], pathClosed: values.pathClosed ?? true,
    sides: values.sides ?? 5, innerRadius: values.innerRadius ?? 0.5, stroke: values.stroke ?? 'transparent',
    strokeWidth: values.strokeWidth ?? 0, compoundOperation: values.compoundOperation ?? 'union',
    dataSource: values.dataSource ?? 'inherit', dataRow: values.dataRow ?? 0, dataField: values.dataField ?? '',
    nestedFit: values.nestedFit ?? 'stretch',
    visible: values.visible ?? true,
    visibilityField: values.visibilityField ?? '', visibilityValue: values.visibilityValue ?? '',
    widthMode: values.widthMode ?? 'fixed', heightMode: values.heightMode ?? 'fixed', wrap: values.wrap ?? false,
    paddingTop: values.paddingTop ?? values.padding ?? 0, paddingRight: values.paddingRight ?? values.padding ?? 0,
    paddingBottom: values.paddingBottom ?? values.padding ?? 0, paddingLeft: values.paddingLeft ?? values.padding ?? 0,
  };
}

/** Reparent a layer and place it before a sibling, or last among its new siblings. */
export function moveLayer(nodes: DesignNode[], id: string, parent: string | null, beforeId?: string): DesignNode[] {
  const source = nodes.find(node => node.id === id);
  if (!source) throw new Error('Layer to move does not exist.');
  if (parent && !['frame', 'compound'].includes(nodes.find(node => node.id === parent)?.type ?? '')) throw new Error('Layer parent must be an existing frame or live compound.');
  if (parent && nodes.find(node => node.id === parent)?.type === 'compound' && !['shape', 'compound'].includes(source.type)) {
    throw new Error('Live compounds can contain only vector shapes and other compounds.');
  }
  const descendants = new Set([id]);
  let previousSize = -1;
  while (previousSize !== descendants.size) {
    previousSize = descendants.size;
    nodes.forEach(node => { if (node.parent && descendants.has(node.parent)) descendants.add(node.id); });
  }
  if (parent && descendants.has(parent)) throw new Error('A layer cannot be moved into itself or its descendants.');
  if (beforeId === id) return nodes;
  const withoutSource = nodes.filter(node => node.id !== id);
  const target = beforeId ? withoutSource.find(node => node.id === beforeId) : undefined;
  if (beforeId && (!target || target.parent !== parent)) throw new Error('Layer order target must be a sibling.');
  const siblings = withoutSource.filter(node => node.parent === parent);
  const insertAt = target ? withoutSource.indexOf(target) : siblings.length ? withoutSource.indexOf(siblings[siblings.length - 1]) + 1 : withoutSource.length;
  const result = [...withoutSource];
  result.splice(insertAt, 0, { ...source, parent });
  return result;
}
