import { z } from 'zod';
import { reorder } from './zOrder';
import { runCommand } from './scripting';
import { componentGridSchema, gridSchema, placedGrids, placedPointPosition, projectGrids, snapTarget, validateGrids } from './grids';
import { commonTags, describeFilter, filterFromTags, matchesTags, normalizeTags, sameFilter, tagFilterSchema, tagSchema, type TagFilter } from './tags';
import { withPivot } from './layerGeometry';
import { closePopups, POPUP_LIMIT, popupSchema, popupSettings, popupSettingsSchema, type Popup } from './popups';

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
const nodeFields = z.object({
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
  /**
   * The layer's pivot, as fractions of its size (0,0 top-left, 0.5,0.5 centre): X/Y place it, the layer turns about it
   * and grows around it (see src/layerGeometry.ts). Older saves have none and get the one that keeps them in place.
   */
  pivotX: num.min(0).max(1).optional(), pivotY: num.min(0).max(1).optional(),
  /** A text layer's font shrinks to fit its box, from `fontSize` down to `minFontSize` (8 when absent). */
  autoFontSize: z.boolean().optional(),
  minFontSize: num.min(4).max(400).optional(),
});
export const nodeSchema = nodeFields.transform(node => withPivot(node));
export type DesignNode = z.infer<typeof nodeSchema>;
export const componentSchema = z.object({
  id, name: z.string().min(1).max(100), kind: z.enum(['card', 'token', 'board', 'dice', 'book', 'artwork', 'texture', 'font', 'button', 'popup']),
  width: num.min(20).max(2000), height: num.min(20).max(2000), color,
  front: z.array(nodeSchema).max(300), back: z.array(nodeSchema).max(300),
  csv: z.string().max(1_000_000),
  rows: z.array(z.record(z.string(), z.string())).max(10000),
  flippable: z.boolean(), hand: z.boolean(), hideInHand: z.boolean(),
  stackable: z.boolean(), shufflable: z.boolean(),
  /** Legacy single stack tag, read as one more entry of `stackTags` (new edits leave it empty). */
  stackTag: z.string().max(100),
  /** Stack tags: a stack's filter decides by these which pieces may join it (see src/tags.ts). */
  stackTags: z.array(tagSchema).max(50).optional(),
  /** Show the corner preview when hovering its pieces even while they are locked (locked pieces have none otherwise). */
  previewWhenLocked: z.boolean().optional(),
  /** Grid tags: each grid's filter decides by these whether the component's pieces snap to it (see src/grids.ts). */
  gridTags: z.array(tagSchema).max(50).optional(),
  /** Whether its pieces snap to grids at all (true when absent). */
  snapToGrid: z.boolean().optional(),
  /** Grids its pieces carry on the table, in its own coordinates and inside their bounds (see src/grids.ts). */
  grids: z.array(componentGridSchema).max(20).optional(),
  /** Degrees each Q/E press or rotate button turns its pieces (90 when absent). */
  rotationStep: z.number().int().min(1).max(180).optional(),
  /**
   * The global script function its pieces run: pressing a button piece, or Run on any selected piece. A popup runs it
   * when a player clicks one of its layers, with (popup, layer name, player).
   */
  action: z.string().max(100).optional(),
  /** A popup's placement and behaviour on screen (see src/popups.ts); defaults where absent. */
  popup: popupSettingsSchema.optional(),
  source: z.object({ projectId: id, componentId: id, projectName: z.string().min(1).max(100) }).optional(),
  asset: assetSchema.optional(),
});
export type Component = z.infer<typeof componentSchema>;
export const isAsset = (component: Pick<Component, 'kind'>) => component.kind === 'texture' || component.kind === 'font';
/** Whether its pieces can be on the table: not textures and fonts (used through layers) or popups (shown by scripts). */
export const isPlaceable = (component: Pick<Component, 'kind'>) => !isAsset(component) && component.kind !== 'popup';
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
  /**
   * Keeps the piece in its place in the hierarchy (the Pieces panel): it isn't brought forward, sent back, raised when
   * clicked, dragged to another place or moved into or out of a group. It can still move on the table; see `locked`.
   */
  orderLocked: z.boolean().optional(),
  stackReversed: z.boolean().optional(),
  rolls: z.number().int().min(0).optional(),
  /** Counts shuffles of the stack this piece is in, so every player sees the shuffle animate. */
  shuffles: z.number().int().min(0).optional(),
  /** Counts pings, so every player sees the piece pulse; `pingedBy` is the seat that pinged it last. */
  pings: z.number().int().min(0).optional(),
  pingedBy: id.optional(),
  /** The seats the last ping was for (everyone when absent). */
  pingedFor: z.array(id).max(100).optional(),
  /** Seats this table piece is hidden from (visual privacy only, like hidden hands). Stacks share it. */
  hiddenFrom: z.array(id).max(100).optional(),
  /** The Pieces panel group this table piece belongs to. Stacks share one group; held pieces have none. */
  group: id.optional(),
  /** The filter of the (ordinary) stack this piece is in, shared by every piece in it. Persistent stacks keep theirs on their record. */
  stackFilter: tagFilterSchema.optional(),
});
/** A locked group holds its pieces in place (with its subgroups), whatever each piece's own lock says. */
/**
 * A persistent stack stays on the table with one piece or none (an empty slot players can drop pieces into). Its pieces
 * still carry its id in `stack`; this record keeps where the stack is, the stack tag pieces must have to join (empty:
 * the same component as its pieces, or any stackable piece while it's empty), and the component it last held.
 */
export const persistentStackSchema = z.object({
  id, tag: z.string().max(100), x: num, y: num, rotation: num, scale: num.min(0.1).max(5).optional(), componentId: id.optional(),
  /** Which pieces may join (see src/tags.ts). Records from before filters have a single legacy `tag` instead. */
  filter: tagFilterSchema.optional(),
});
export type PersistentStack = z.infer<typeof persistentStackSchema>;
/**
 * A Pieces-panel group. `locked` holds its pieces in place on the table; `orderLocked` keeps it, its subgroups and its
 * pieces in their places in the hierarchy (see Instance.orderLocked).
 */
export const pieceGroupSchema = z.object({ id, name: z.string().trim().min(1).max(100), parent: id.nullable(), locked: z.boolean().optional(), orderLocked: z.boolean().optional() });
export type PieceGroup = z.infer<typeof pieceGroupSchema>;
export type Instance = z.infer<typeof instanceSchema>;
export const playerSchema = z.object({
  id, owner: z.string().max(200), name: z.string().min(1).max(50), color,
  x: num, y: num, rotation: num,
  allowHandInsert: z.boolean().optional(), allowHandTake: z.boolean().optional(),
  handFaceUp: z.boolean().optional(), tableHandHidden: z.boolean().optional(), tableHandUnlocked: z.boolean().optional(),
});
export type Player = z.infer<typeof playerSchema>;
/** A Lua script. A project's scripts run in order, sharing their globals, in every browser and on the server. */
export const scriptSchema = z.object({ id, name: z.string().trim().min(1).max(100), source: z.string().max(200_000) });
export type Script = z.infer<typeof scriptSchema>;
/** Values kept in memory: JSON without null, which Lua tables can't hold. Lists index from 1, as in Lua. */
// Interfaces keep the recursion lazy, so generic types that walk projects (Playwright's evaluate arguments) stay shallow.
export type MemoryValue = string | number | boolean | MemoryList | MemoryTable;
export interface MemoryList extends Array<MemoryValue> {}
export interface MemoryTable { [key: string]: MemoryValue }
export const memoryValueSchema: z.ZodType<MemoryValue> = z.lazy(() => z.union([
  z.string().max(100_000), num, z.boolean(), z.array(memoryValueSchema).max(10_000), z.record(z.string().max(200), memoryValueSchema),
]));
export const memorySchema = z.record(z.string().max(200), memoryValueSchema);
export type Memory = z.infer<typeof memorySchema>;
export const MAX_MEMORY_BYTES = 512 * 1024;
/** A memory path: keys of tables and (from 1) positions in lists. */
export const memoryPathSchema = z.array(z.union([z.string().max(200), z.number().int().min(1).max(100_000)])).max(64);
export type MemoryPath = z.infer<typeof memoryPathSchema>;
/** Lines scripts print, their errors and announcements, shared by everyone at the table. */
export const scriptLogEntrySchema = z.object({
  seq: z.number().int().min(0), level: z.enum(['info', 'error', 'announce']), text: z.string().max(4000),
  /** The seat whose action ran the script. */
  player: id.optional(),
  /** The seats an announcement is for (everyone when absent); the console still lists it for all. */
  to: z.array(id).max(100).optional(),
  /** How many times in a row the same line was logged. */
  count: z.number().int().min(2).optional(),
});
export type ScriptLogEntry = z.infer<typeof scriptLogEntrySchema>;
export const SCRIPT_LOG_LIMIT = 200;
const scriptName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/, 'Use the name of a global function.').max(100);
export const projectSchema = z.object({
  id, name: z.string().min(1).max(100), description: z.string().max(1000),
  components: z.array(componentSchema).max(500),
  instances: z.array(instanceSchema).max(10000),
  players: z.array(playerSchema),
  /** Named, nestable groups of table pieces shown in the Pieces panel. */
  groups: z.array(pieceGroupSchema).max(2000).optional(),
  /** Stacks that stay on the table when they're down to one piece or none. */
  stacks: z.array(persistentStackSchema).max(2000).optional(),
  scripts: z.array(scriptSchema).max(50).optional(),
  /** Grid layers, first = highest priority (see src/grids.ts). Absent in older projects, which have one grid from their settings. */
  grids: z.array(gridSchema).max(50).optional(),
  /** JSON values shared by scripts and players (absent when empty). */
  memory: memorySchema.optional(),
  scriptLog: z.array(scriptLogEntrySchema).max(SCRIPT_LOG_LIMIT).optional(),
  /** Popups open on players' screens, oldest first (absent when none; see src/popups.ts). */
  popups: z.array(popupSchema).max(POPUP_LIMIT).optional(),
  settings: z.object({
    grid: z.boolean(), snap: z.boolean(), gridSize: num.min(5).max(200),
    /** Where the grid's points sit: snap points are offset + n × gridSize on each axis (0 when absent). */
    gridOffsetX: num.min(-2000).max(2000).optional(), gridOffsetY: num.min(-2000).max(2000).optional(),
    hands: z.boolean(), allowOtherHands: z.boolean().optional(),
    allowHandInsert: z.boolean().optional(), allowHandTake: z.boolean().optional(),
    turns: z.boolean(), turn: z.number().int().min(0),
    /** In a live room, whether players other than the host may change scripts. */
    scriptEditing: z.boolean().optional(),
    /** Seconds between calls of the scripts' update(dt) (1 when absent). */
    updateInterval: num.min(0.1).max(3600).optional(),
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
  /** `snap` snaps a moved piece (or stack) to the grids, here and in the other moves that take it. */
  z.object({ type: z.literal('extractMove'), id, x: num, y: num, snap: z.boolean().optional() }),
  z.object({ type: z.literal('roll'), ids: z.array(id).min(1), seed: z.number().int() }),
  /** Turns book pages (clamped) or steps dice to their next face (looped) by `delta` rows. */
  z.object({ type: z.literal('cycleVariant'), ids: z.array(id).min(1), delta: z.number().int().min(-10000).max(10000).refine(value => value !== 0, 'Choose a direction.') }),
  /** Creates a group under `parent` holding the given table pieces (with their whole stacks) and existing groups. */
  z.object({ type: z.literal('createGroup'), id, name: pieceGroupSchema.shape.name, parent: id.nullable().default(null),
    ids: z.array(id).max(10000).default([]), groups: z.array(id).max(2000).default([]) }),
  z.object({ type: z.literal('renameGroup'), id, name: pieceGroupSchema.shape.name }),
  /** Locks or unlocks groups: their pieces' places on the table, or with `order` their places in the hierarchy. */
  z.object({ type: z.literal('lockGroups'), ids: z.array(id).min(1).max(2000), locked: z.boolean(), order: z.boolean().optional() }),
  /** Makes the stack of `ids` persistent, stacking the pieces first (as `stackId`) when they aren't one stack yet. */
  z.object({ type: z.literal('persistStack'), ids: z.array(id).min(1).max(10000), stackId: id }),
  /** Makes a persistent stack ordinary again (an empty one disappears; a single piece is no longer a stack). */
  z.object({ type: z.literal('unpersistStack'), stackId: id }),
  /** Sets which pieces may join a stack (an ordinary or a persistent one). */
  z.object({ type: z.literal('setStackFilter'), stackId: id, filter: tagFilterSchema }),
  /** Moves an empty persistent stack (stacks with pieces move with their pieces). */
  z.object({ type: z.literal('moveStack'), stackId: id, x: num, y: num }),
  /** Puts table pieces (whole stacks) or your own held pieces on top of a persistent stack, including an empty one. */
  z.object({ type: z.literal('dropIntoStack'), ids: z.array(id).min(1).max(10000), stackId: id }),
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
  z.object({ type: z.literal('releaseMany'), ids: z.array(id).min(1), x: num, y: num, snap: z.boolean().optional() }),
  z.object({ type: z.literal('dropManyFromHand'), ids: z.array(id).min(1), targetId: id, stackId: id }),
  z.object({ type: z.literal('transferToHand'), ids: z.array(id).min(1), playerId: id, faceUp: z.boolean().optional(), index: z.number().int().min(0).optional() }),
  z.object({ type: z.literal('playVisibleHand'), id, x: num, y: num, targetId: id.optional(), stackId: id.optional(), snap: z.boolean().optional() }),
  z.object({ type: z.literal('move'), ids: z.array(id), patch: instanceSchema.pick({ x: true, y: true, rotation: true, scale: true, flipped: true, locked: true, orderLocked: true }).partial() }),
  z.object({ type: z.literal('transform'), ids: z.array(id).min(1), dx: num.optional(), dy: num.optional(),
    positions: z.array(z.object({ id, x: num, y: num })).min(1).max(10000).optional(),
    rotation: num.optional(), scaleFactor: num.positive().optional(), flip: z.boolean().optional(),
    /** Rotation steps: each piece turns by this many of its component's rotation step. */
    turns: z.number().int().min(-360).max(360).optional(), snap: z.boolean().optional() }),
  z.object({ type: z.literal('drawSelection'), ids: z.array(id).min(1), playerId: id, faceUp: z.boolean().optional() }),
  z.object({ type: z.literal('delete'), ids: z.array(id) }),
  z.object({ type: z.literal('stack'), ids: z.array(id), stackId: id }),
  z.object({ type: z.literal('dropStack'), ids: z.array(id).min(1), targetId: id, stackId: id }),
  z.object({ type: z.literal('unstack'), id }),
  z.object({ type: z.literal('reorder'), ids: z.array(id) }),
  z.object({ type: z.literal('shuffle'), id, seed: z.number().int() }),
  z.object({ type: z.literal('draw'), id, playerId: id, faceUp: z.boolean().optional() }),
  z.object({ type: z.literal('drawMany'), id, playerId: id, count: z.number().int().min(1).max(1000), faceUp: z.boolean().optional() }),
  z.object({ type: z.literal('release'), id, x: num, y: num, snap: z.boolean().optional() }),
  z.object({ type: z.literal('dropFromHand'), id, targetId: id, stackId: id }),
  z.object({ type: z.literal('reorderHand'), ids: z.array(id), playerId: id }),
  z.object({ type: z.literal('player'), player: playerSchema }),
  z.object({ type: z.literal('removePlayer'), playerId: id }),
  z.object({ type: z.literal('reorderPlayers'), ids: z.array(id).min(1) }),
  z.object({ type: z.literal('endTurn') }),
  z.object({ type: z.literal('handSettings'), playerId: id, patch: playerSchema.pick({ allowHandInsert: true, allowHandTake: true, handFaceUp: true, tableHandHidden: true, tableHandUnlocked: true }) }),
  z.object({ type: z.literal('settings'), patch: projectSchema.shape.settings.partial() }),
  z.object({ type: z.literal('rename'), name: z.string().min(1).max(100) }),
  /** Sets pieces to a variant, page or face (zero-based row). */
  z.object({ type: z.literal('setRow'), ids: z.array(id).min(1), row: z.number().int().min(0) }),
  /** Adds a script, or replaces the one with its id in place. Scripts then reload (onUnload, then onLoad). */
  z.object({ type: z.literal('script'), script: scriptSchema }),
  z.object({ type: z.literal('removeScript'), id }),
  z.object({ type: z.literal('reorderScripts'), ids: z.array(id).max(50) }),
  /** Runs the scripts' onUnload and onLoad again, as if they had just been saved. */
  z.object({ type: z.literal('reloadScripts') }),
  /** Sets values in memory (or removes them, without a value). An empty path replaces all of memory. */
  z.object({ type: z.literal('memory'), changes: z.array(z.object({ path: memoryPathSchema, value: memoryValueSchema.optional() })).min(1).max(1000) }),
  /** Calls a global script function: a button press (with its piece), Run on a piece, or the script editor's Run. */
  /** Runs a script function with (piece or popup, player, ...args): `piece` for a piece's action, `popup` for a click on a popup. */
  z.object({ type: z.literal('call'), name: scriptName, piece: id.optional(), popup: id.optional(), args: z.array(memoryValueSchema).max(20).default([]), seed: z.number().int() }),
  /** Runs the scripts' update(dt). Live rooms get these from the server's timer, offline tables from the app's. */
  z.object({ type: z.literal('tick'), dt: num.min(0).max(3600), seed: z.number().int() }),
  z.object({ type: z.literal('clearScriptLog') }),
  /** Highlights pieces for every player (not an undo step). */
  /** Pulses pieces for every player, or for `players` only. */
  z.object({ type: z.literal('ping'), ids: z.array(id).min(1).max(1000), players: z.array(id).max(100).optional() }),
  /** Shows a popup component on screen, to everyone or the seats in `popup.to` (scripts' game.popup). */
  z.object({ type: z.literal('openPopup'), popup: popupSchema }),
  /**
   * Closes popups: for `players`, or for the acting seat (for everyone when the popup's `dismiss` is 'all'), or with
   * neither (a script) for everyone. Popups already gone are skipped.
   */
  z.object({ type: z.literal('closePopup'), ids: z.array(id).min(1).max(POPUP_LIMIT), players: z.array(id).max(100).optional() }),
  /** Hides table pieces (with their whole stacks) from these seats; an empty list shows them to everyone. */
  z.object({ type: z.literal('hideFrom'), ids: z.array(id).min(1).max(10000), players: z.array(id).max(100) }),
  /** Adds a grid layer, or replaces the one with its id in place. */
  z.object({ type: z.literal('grid'), grid: gridSchema }),
  z.object({ type: z.literal('removeGrid'), id }),
  z.object({ type: z.literal('reorderGrids'), ids: z.array(id).max(50) }),
  /** Puts pieces (with their whole stacks) on a grid point, turning them to its rotation if it has one. */
  z.object({ type: z.literal('snapTo'), ids: z.array(id).min(1), grid: z.string().min(1).max(201), point: z.string().min(1).max(100) }),
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
    if (c.grids?.length && isAsset(c)) throw new Error('Assets cannot carry grids.');
    validateGrids(c.grids);
    for (const face of [c.front, c.back]) {
      const nodes = new Map(face.map(n => [n.id, n]));
      if (nodes.size !== face.length) throw new Error('Duplicate layer identifiers.');
      for (const node of face) {
        if (node.textureId && (node.type !== 'image' || components.find(item => item.id === node.textureId)?.kind !== 'texture')) throw new Error('Image layer references a missing texture.');
        if (node.fontId && (node.type !== 'text' || components.find(item => item.id === node.fontId)?.kind !== 'font')) throw new Error('Text layer references a missing font.');
        if (node.type === 'shape' && node.shapeKind === 'path' && node.points.length < (node.pathClosed ? 3 : 2)) {
          throw new Error(`Path “${node.name}” needs at least ${node.pathClosed ? 3 : 2} points.`);
        }
        // A linked component layer may not have chosen its component yet; it renders a placeholder.
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
  const popups = project.popups ?? [];
  if (new Set(popups.map(popup => popup.id)).size !== popups.length) throw new Error('Duplicate popup identifiers.');
  if (popups.some(popup => componentIds.get(popup.componentId)?.kind !== 'popup')) throw new Error('An open popup shows a component that is not a popup.');
  if (!trusted) validateComponents(project.components);
  for (const i of project.instances) {
    if (!componentIds.has(i.componentId) || (i.holder && !playerIds.has(i.holder))) throw new Error('Broken component or player reference.');
    if (isAsset(componentIds.get(i.componentId)!)) throw new Error('Textures and fonts cannot be placed on the playground.');
    if (componentIds.get(i.componentId)!.kind === 'popup') throw new Error('Popups are shown on screen by scripts (game.popup), not placed on the table.');
    if (i.stack && i.holder) throw new Error('A held component cannot belong to a stack.');
  }
  const groups = new Map<string, Instance[]>();
  for (const i of project.instances) if (i.stack) groups.set(i.stack, [...(groups.get(i.stack) ?? []), i]);
  const persistent = new Map((project.stacks ?? []).map(record => [record.id, record]));
  if (persistent.size !== (project.stacks ?? []).length) throw new Error('Duplicate persistent stack identifiers.');
  for (const [stack, group] of groups) {
    const record = persistent.get(stack);
    if (group.some(i => !componentIds.get(i.componentId)!.stackable)) throw new Error('Incompatible components in stack.');
    if (record ? group.some(i => i.stackFilter) : group.some(i => !sameFilter(i.stackFilter, group[0].stackFilter))) throw new Error('Every piece in a stack must share its stack filter.');
    if (group.some(i => !!i.stackReversed !== !!group[0].stackReversed)) throw new Error('Inconsistent stack orientation.');
  }
  if (project.instances.some(i => !i.stack && i.stackReversed)) throw new Error('Only stacks can have a stack orientation.');
  if (project.instances.some(i => !i.stack && i.stackFilter)) throw new Error('Only stacks can have a stack filter.');
  validateGroups(project);
  validateScripting(project);
  validateGrids(project.grids);
  validatedComponents.add(project.components);
  return project;
}

function validateScripting(project: Project) {
  if (new Set((project.scripts ?? []).map(script => script.id)).size !== (project.scripts ?? []).length) throw new Error('Duplicate script identifiers.');
  if (project.memory) {
    const depth = (value: MemoryValue, level: number): void => {
      if (level > 64) throw new Error('Memory nests more than 64 levels deep.');
      if (value && typeof value === 'object') for (const item of Array.isArray(value) ? value : Object.values(value)) depth(item, level + 1);
    };
    depth(project.memory, 0);
    if (JSON.stringify(project.memory).length > MAX_MEMORY_BYTES) throw new Error('Memory can hold at most 512 KB of JSON.');
  }
}

/** Reads the value at a memory path (lists index from 1). */
export function memoryAt(memory: Memory | undefined, path: MemoryPath): MemoryValue | undefined {
  let current: MemoryValue | undefined = memory;
  for (const key of path) {
    if (current === undefined || typeof current !== 'object') return undefined;
    current = Array.isArray(current) ? typeof key === 'number' ? current[key - 1] : undefined : typeof key === 'string' ? current[key] : current[String(key)];
  }
  return current;
}

/**
 * Sets (or, without a value, removes) the value at a memory path, creating tables on the way. Positions in lists count
 * from 1; setting the position after the last appends, and removing one closes the gap.
 */
export function setMemory(memory: Memory | undefined, path: MemoryPath, value: MemoryValue | undefined): Memory | undefined {
  if (!path.length) {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Memory must be a table of named values.');
    return Object.keys(value).length ? structuredClone(value) as Memory : undefined;
  }
  const root: Memory = structuredClone(memory ?? {});
  let parent: MemoryValue = root;
  for (let index = 0; index < path.length - 1; index++) {
    const key = path[index], next = path[index + 1];
    const container = parent as Record<string, MemoryValue> | MemoryValue[];
    let child: MemoryValue | undefined = Array.isArray(container) ? typeof key === 'number' ? container[key - 1] : undefined : container[String(key)];
    if (child === undefined || typeof child !== 'object') {
      if (value === undefined) return Object.keys(root).length ? root : undefined;
      child = typeof next === 'number' ? [] : {};
      if (Array.isArray(container)) {
        if (typeof key !== 'number' || key > container.length + 1) throw new Error(`Memory path ${memoryPathText(path)} skips positions in a list.`);
        container[key - 1] = child;
      } else container[String(key)] = child;
    }
    parent = child;
  }
  const key = path.at(-1)!;
  if (Array.isArray(parent)) {
    if (typeof key !== 'number') throw new Error(`Memory path ${memoryPathText(path)} names a key in a list.`);
    if (value === undefined) { if (key <= parent.length) parent.splice(key - 1, 1); }
    else if (key > parent.length + 1) throw new Error(`Memory path ${memoryPathText(path)} skips positions in a list.`);
    else parent[key - 1] = structuredClone(value);
  } else if (value === undefined) delete (parent as Record<string, MemoryValue>)[String(key)];
  else (parent as Record<string, MemoryValue>)[String(key)] = structuredClone(value);
  return Object.keys(root).length ? root : undefined;
}

/** A memory path as Lua would write it, such as `score.red` or `log[2]`. */
export function memoryPathText(path: MemoryPath): string {
  return path.map((key, index) => typeof key === 'number' ? `[${key}]` : /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `${index ? '.' : ''}${key}` : `[${JSON.stringify(key)}]`).join('') || 'memory';
}

/** Adds lines to the script log, merging repeats of the last line and keeping the newest entries. */
export function appendScriptLog(log: ScriptLogEntry[] | undefined, entries: Omit<ScriptLogEntry, 'seq'>[]): ScriptLogEntry[] | undefined {
  if (!entries.length) return log;
  const next = [...log ?? []];
  let seq = next.at(-1)?.seq ?? 0;
  for (const entry of entries) {
    const last = next.at(-1), text = entry.text.slice(0, 4000);
    if (last && last.text === text && last.level === entry.level && last.player === entry.player && JSON.stringify(last.to) === JSON.stringify(entry.to)) next[next.length - 1] = { ...last, seq: ++seq, count: (last.count ?? 1) + 1 };
    else next.push({ ...entry, text, seq: ++seq });
  }
  return next.slice(-SCRIPT_LOG_LIMIT);
}

/** A component's stack tags (its legacy single tag included). */
export function componentTags(component: Pick<Component, 'stackTag' | 'stackTags'>): string[] {
  return normalizeTags([...component.stackTags ?? [], ...component.stackTag ? [component.stackTag] : []]);
}

/** The filter a new stack of these components gets: any of the tags they all share (untagged pieces don't count). */
export const newStackFilter = (components: Component[]): TagFilter => filterFromTags(commonTags(components.map(componentTags)).tags);

/** A persistent stack's own filter: its record's, or its legacy single tag. Undefined when it has neither. */
const recordFilter = (record: Pick<PersistentStack, 'tag' | 'filter'>): TagFilter | undefined => record.filter ?? (record.tag ? filterFromTags([record.tag]) : undefined);

/**
 * The filter deciding which pieces may join a stack (by id): a persistent stack's record filter, or the filter its
 * pieces share. Stacks from before filters (and persistent stacks without one) take their pieces' shared tags.
 */
export function stackFilterOf(project: Pick<Project, 'instances' | 'components' | 'stacks'>, stackId: string): TagFilter {
  const record = project.stacks?.find(stack => stack.id === stackId);
  const members = project.instances.filter(i => i.stack === stackId);
  const own = record ? recordFilter(record) : members[0]?.stackFilter;
  if (own) return own;
  return newStackFilter(members.flatMap(i => project.components.filter(c => c.id === i.componentId)));
}

/** Whether pieces of these components may go into an empty persistent stack. */
export function fitsPersistentStack(record: Pick<PersistentStack, 'tag' | 'filter'>, components: Component[]): boolean {
  return components.every(c => c.stackable && matchesTags(recordFilter(record), componentTags(c)));
}

/**
 * Why `moving` can't go onto `target` (a stack, or a loose piece they would form a new stack with), or undefined when
 * they can. Locks and hands are checked by the commands themselves.
 */
export function stackJoinError(project: Pick<Project, 'instances' | 'components' | 'stacks'>, target: Instance, moving: Instance[]): string | undefined {
  const comp = (item: Instance) => project.components.find(c => c.id === item.componentId)!;
  const members = target.stack ? project.instances.filter(i => i.stack === target.stack) : [target];
  const blocked = [...members, ...moving].map(comp).find(c => !c.stackable);
  if (blocked) return `${blocked.name} can't be stacked.`;
  if (target.stack) {
    const filter = stackFilterOf(project, target.stack);
    const outsider = moving.map(comp).find(c => !matchesTags(filter, componentTags(c)));
    return outsider && `${outsider.name} doesn't fit this stack (it takes ${describeFilter(filter)}).`;
  }
  return commonTags([...members, ...moving].map(i => componentTags(comp(i)))).shared ? undefined : 'These pieces have no stack tag in common.';
}

/**
 * Merging stacks gives the merged stack a new id. When the pieces of a persistent stack end up together in such a stack,
 * it takes the persistent stack's id, so the stack stays persistent; where two persistent stacks merged, the one at the
 * bottom keeps the pieces and the other stays behind, empty.
 */
function keepPersistentStacks(source: Project, p: Project) {
  const records = p.stacks ?? [];
  if (!records.length) return;
  const before = new Map(source.instances.map(i => [i.id, i.stack]));
  const ids = new Set(records.map(record => record.id));
  // Persistent stacks that still have pieces under their own id keep them.
  const taken = new Set(p.instances.flatMap(i => i.stack && ids.has(i.stack) ? [i.stack] : []));
  const merged = new Map<string, Instance[]>();
  for (const i of p.instances) if (i.stack && !ids.has(i.stack)) merged.set(i.stack, [...merged.get(i.stack) ?? [], i]);
  for (const members of merged.values()) {
    const bottom = [...members].sort((a, b) => a.order - b.order)[0];
    const owner = records.find(record => !taken.has(record.id) && before.get(bottom.id) === record.id)
      ?? records.find(record => !taken.has(record.id) && members.some(i => before.get(i.id) === record.id));
    if (!owner) continue;
    members.forEach(i => { i.stack = owner.id; });
    taken.add(owner.id);
  }
}

/**
 * Every piece of an ordinary stack shares its bottom piece's filter (so merged stacks keep the filter of the stack they
 * went onto); persistent stacks keep theirs on their record, and pieces outside stacks have none.
 */
function normalizeStackFilters(p: Project) {
  const persistent = new Set((p.stacks ?? []).map(record => record.id));
  const bottoms = new Map<string, Instance>();
  for (const item of p.instances) if (item.stack && (!bottoms.has(item.stack) || item.order < bottoms.get(item.stack)!.order)) bottoms.set(item.stack, item);
  for (const item of p.instances) {
    const filter = item.stack && !persistent.has(item.stack) ? bottoms.get(item.stack)!.stackFilter : undefined;
    if (filter) item.stackFilter = filter; else delete item.stackFilter;
  }
}

/** Persistent stacks with pieces follow their bottom piece; empty ones keep their place. */
function syncPersistentStacks(p: Project) {
  if (!p.stacks?.length) { delete p.stacks; return; }
  for (const record of p.stacks) {
    const bottom = p.instances.filter(i => i.stack === record.id).sort((a, b) => a.order - b.order)[0];
    if (bottom) Object.assign(record, { x: bottom.x, y: bottom.y, rotation: bottom.rotation, scale: bottom.scale, componentId: bottom.componentId });
  }
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

/**
 * The project as play sees it: pieces in a locked group (or in a group inside one) count as locked, and pieces in an
 * order-locked one as order-locked, while their own flags stay as they are in the saved project. Returns `p` itself
 * when no group is locked either way.
 */
export function withGroupLocks(p: Project): Project {
  const groups = p.groups ?? [];
  const locked = new Set(groups.filter(group => group.locked).map(group => group.id)), ordered = new Set(groups.filter(group => group.orderLocked).map(group => group.id));
  if (!locked.size && !ordered.size) return p;
  let changed = false;
  const instances = p.instances.map(item => {
    if (!item.group) return item;
    const around = groupAncestors(groups, item.group);
    const lock = !item.locked && around.some(id => locked.has(id)), order = !item.orderLocked && around.some(id => ordered.has(id));
    if (!lock && !order) return item;
    changed = true;
    return { ...item, ...lock ? { locked: true } : {}, ...order ? { orderLocked: true } : {} };
  });
  return changed ? { ...p, instances } : p;
}

/** Whether a group keeps its place in the hierarchy: its own order lock, or one of a group around it. */
export const groupOrderLocked = (groups: PieceGroup[], id: string | null | undefined) =>
  groupAncestors(groups, id).some(key => groups.find(group => group.id === key)?.orderLocked);

/** Rotations land on tenths of a degree, so steps such as 3 × 0.1 or 360 / 7 don't leave floating-point leftovers. */
export const snapAngle = (degrees: number) => { const snapped = Math.round(degrees * 10) / 10; return snapped === 0 ? 0 : snapped; };

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

/** Whether these components can form a stack: all stackable, with the tagged ones sharing at least one stack tag. */
export function canStack(components: Component[]): boolean {
  if (!components.length || components.some(c => !c.stackable)) return false;
  return commonTags(components.map(componentTags)).shared;
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

/**
 * Applies a command, with the project's scripts: `call`, `tick` and script changes run Lua, and other commands give
 * scripts' event handlers (onDraw, onMove, ...) a chance to react. See src/scripting.ts.
 */
export function applyCommand(source: Project, raw: Command, actor?: string): Project {
  return runCommand(source, commandSchema.parse(raw), actor, applyTableCommand);
}

/** The state undo should go back to after `project`, when a script kept some of its changes out of undo. */
export { undoBaseOf } from './scripting';

/** Applies one command to the table alone, without running scripts. Scripts' own actions go through here. */
export function applyTableCommand(source: Project, raw: Command, actor?: string): Project {
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
  // A piece is held in place by its own lock or by a locked group around it.
  const lockedByGroup = (i: Instance) => !!i.group && groupAncestors(p.groups ?? [], i.group).some(id => p.groups?.find(group => group.id === id)?.locked);
  const isLocked = (i: Instance) => i.locked || lockedByGroup(i);
  // A piece keeps its place in the hierarchy (table order and group) by its own order lock or an order-locked group.
  const isOrderLocked = (i: Instance) => !!i.orderLocked || groupOrderLocked(p.groups ?? [], i.group);
  const ORDER_LOCKED = 'Its place in the order is locked. Unlock its order first.';
  /** Refuses to move pieces or groups (with everything in them as one block) to another place in the hierarchy. */
  const keepOrder = (pieces: Instance[], groups: PieceGroup[] = []) => {
    if (pieces.some(isOrderLocked) || groups.some(group => groupOrderLocked(p.groups ?? [], group.id))) throw new Error(ORDER_LOCKED);
  };
  const component = (i: Instance) => {
    const c = p.components.find(c => c.id === i.componentId);
    if (!c) throw new Error('Component no longer exists.');
    return c;
  };
  // Snaps each moved unit (a stack, or a loose piece) to the grids: the stack's bottom piece decides where it snaps.
  // Units that carry grids snap first, so pieces moved with them land on their grids where they end up; a unit never
  // snaps to its own grids.
  const snapUnits = (items: Instance[]) => {
    const units = new Map<string, Instance[]>();
    for (const item of items) if (!item.holder) units.set(item.stack ?? item.id, item.stack ? stackMembers(p, item) : [item]);
    const carries = (members: Instance[]) => members.some(member => !!component(member).grids?.length);
    for (const members of [...units.values()].sort((a, b) => Number(carries(b)) - Number(carries(a)))) {
      const target = snapTarget(p, component(members[0]), members[0].x, members[0].y, new Set(members.map(member => member.id)));
      if (target) members.forEach(member => Object.assign(member, { x: target.x, y: target.y }, target.rotation === undefined ? {} : { rotation: snapAngle(((target.rotation % 360) + 360) % 360) }));
    }
  };
  // Pieces going onto a target piece or stack must fit its filter (onto a loose piece: share a stack tag with it).
  // A new stack gets the tags its pieces share as its filter; an existing one keeps its own (its bottom piece's).
  const joinFilter = (target: Instance, items: Instance[]) => {
    const problem = stackJoinError(p, target, items);
    if (problem) throw new Error(problem);
    return target.stack ? undefined : newStackFilter([target, ...items].map(component));
  };
  const applyFilter = (stackId: string, filter: TagFilter | undefined) => {
    if (filter) p.instances.filter(i => i.stack === stackId).forEach(i => { i.stackFilter = filter; });
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
        if (!command.component.stackable) i.stack = null;
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
          instance.row = Math.min(instance.row, Math.max(0, component.rows.length - 1));
          if (!component.flippable) instance.flipped = false;
          if (!component.hand) instance.holder = null;
          if (!component.stackable) instance.stack = null;
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
        if (item.holder || isLocked(item)) throw new Error('Pasted components must be unlocked and on the table.');
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
      // Raising is a side effect of picking pieces up, so order-locked pieces simply stay where they are.
      const items = [...new Set(command.ids)].map(get).filter(item => !isOrderLocked(item));
      items.forEach(editable);
      p.instances = [...p.instances.filter(i => !items.includes(i)), ...items];
      break;
    }
    case 'zOrder': {
      const ids = new Set(command.ids.map(key => get(key).id));
      const { rest, units } = tableUnits();
      const chosen = new Set(units.filter(members => members.some(item => ids.has(item.id))));
      chosen.forEach(members => members.forEach(editable));
      keepOrder([...chosen].flat());
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
      if (item.holder || isLocked(item)) throw new Error('Only unlocked tabletop components can be moved.');
      if (item.stackReversed && component(item).flippable) item.flipped = !item.flipped;
      Object.assign(item, { stack: null, stackReversed: false, x: command.x, y: command.y });
      if (command.snap) snapUnits([item]);
      break;
    }
    case 'roll': {
      let seed = command.seed >>> 0;
      for (const key of new Set(command.ids)) {
        const item = get(key), c = component(item);
        editable(item);
        if (isLocked(item) || c.kind !== 'dice') throw new Error('Only unlocked dice can be rolled.');
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
        if (c.kind === 'dice' && isLocked(item)) throw new Error('Unlock this die first.');
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
      keepOrder(pieces, moving);
      groups.push({ id: command.id, name: command.name, parent: command.parent });
      regroup(pieces, moving, command.id);
      break;
    }
    case 'renameGroup': existingGroups([command.id])[0].name = command.name; break;
    case 'persistStack': {
      const records = p.stacks ??= [];
      const items = [...new Set(command.ids)].map(get);
      items.forEach(i => { editable(i); if (isLocked(i) || i.holder) throw new Error('Only unlocked tabletop pieces can form a persistent stack.'); });
      if (!items.every(i => component(i).stackable)) throw new Error('These pieces can\'t be stacked.');
      const stacks = new Set(items.map(i => i.stack));
      let stackId: string;
      if (stacks.size === 1 && items[0].stack && stackMembers(p, items[0]).every(i => items.includes(i))) stackId = items[0].stack;
      else {
        // Stack the pieces first: whole stacks keep their order, the first selected piece goes on the bottom.
        if (items.some(i => i.stack && stackMembers(p, i).some(other => !items.includes(other)))) throw new Error('Select the entire stack.');
        if (!canStack(items.map(component))) throw new Error('These pieces have no stack tag in common.');
        if (p.instances.some(i => i.stack === command.stackId) || records.some(record => record.id === command.stackId)) throw new Error('Stack identifier already exists.');
        items.forEach(i => { i.stackFilter = newStackFilter(items.map(component)); });
        stacks.forEach(stack => { if (stack) materialize(stackMembers(p, items.find(i => i.stack === stack)!)); });
        const seen = new Set<string>();
        const ordered = items.flatMap(item => {
          if (!item.stack) return [item];
          if (seen.has(item.stack)) return [];
          seen.add(item.stack);
          return items.filter(other => other.stack === item.stack).sort((a, b) => a.order - b.order);
        });
        ordered.forEach((i, order) => Object.assign(i, { stack: command.stackId, stackReversed: false, order, x: items[0].x, y: items[0].y }));
        stackId = command.stackId;
      }
      if (records.some(record => record.id === stackId)) throw new Error('This stack is already persistent.');
      const bottom = p.instances.filter(i => i.stack === stackId).sort((a, b) => a.order - b.order)[0];
      records.push({ id: stackId, tag: '', filter: stackFilterOf(p, stackId), x: bottom.x, y: bottom.y, rotation: bottom.rotation, scale: bottom.scale, componentId: bottom.componentId });
      break;
    }
    case 'unpersistStack': {
      if (!(p.stacks ?? []).some(record => record.id === command.stackId)) throw new Error('This stack isn\'t persistent.');
      // Its pieces keep the filter as an ordinary stack.
      const filter = stackFilterOf(p, command.stackId);
      p.instances.filter(i => i.stack === command.stackId).forEach(i => { i.stackFilter = filter; });
      p.stacks = p.stacks!.filter(record => record.id !== command.stackId);
      break;
    }
    case 'setStackFilter': {
      const record = (p.stacks ?? []).find(item => item.id === command.stackId);
      const members = p.instances.filter(i => i.stack === command.stackId);
      if (!record && !members.length) throw new Error('This stack no longer exists.');
      members.forEach(editable);
      if (record) Object.assign(record, { filter: command.filter, tag: '' });
      else members.forEach(i => { i.stackFilter = command.filter; });
      break;
    }
    case 'moveStack': {
      const record = (p.stacks ?? []).find(item => item.id === command.stackId);
      if (!record) throw new Error('This stack isn\'t persistent.');
      if (p.instances.some(i => i.stack === record.id)) throw new Error('Move the stack by its pieces.');
      Object.assign(record, { x: command.x, y: command.y });
      break;
    }
    case 'dropIntoStack': {
      const record = (p.stacks ?? []).find(item => item.id === command.stackId);
      if (!record) throw new Error('This stack no longer exists.');
      const members = p.instances.filter(i => i.stack === record.id).sort((a, b) => a.order - b.order);
      const items = [...new Set(command.ids)].map(get);
      if (items.some(i => members.includes(i))) throw new Error('Choose a different stack.');
      items.forEach(i => {
        editable(i);
        if (isLocked(i)) throw new Error('Unlock these pieces first.');
        if (i.holder && i.holder !== actor) throw new Error("Switch to this player's seat to play from their hand.");
      });
      if (items.some(i => i.stack && stackMembers(p, i).some(other => !items.includes(other)))) throw new Error('Select the entire stack.');
      if (members.some(i => isLocked(i))) throw new Error('Unlock the stack first.');
      const filter = stackFilterOf(p, record.id), outsider = items.map(component).find(c => !c.stackable || !matchesTags(filter, componentTags(c)));
      if (outsider) throw new Error(outsider.stackable ? `${outsider.name} doesn't fit this stack (it takes ${describeFilter(filter)}).` : `${outsider.name} can't be stacked.`);
      materialize(members);
      new Set(items.flatMap(i => i.stack ? [i.stack] : [])).forEach(stack => materialize(stackMembers(p, items.find(i => i.stack === stack)!)));
      const seen = new Set<string>();
      const ordered = items.flatMap(item => {
        if (!item.stack) return [item];
        if (seen.has(item.stack)) return [];
        seen.add(item.stack);
        return items.filter(other => other.stack === item.stack).sort((a, b) => a.order - b.order);
      });
      const at = members[0] ?? record;
      ordered.forEach((i, n) => Object.assign(i, { holder: null, stack: record.id, stackReversed: false, order: members.length + n, x: at.x, y: at.y }));
      break;
    }
    case 'lockGroups': {
      const key = command.order ? 'orderLocked' : 'locked';
      for (const group of existingGroups(command.ids)) { if (command.locked) group[key] = true; else delete group[key]; }
      break;
    }
    case 'ungroup':
      keepOrder([], existingGroups(command.ids));
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
      keepOrder(pieces, moving);
      regroup(pieces, moving, command.parent);
      break;
    }
    case 'arrangePieces': {
      const pieces = groupedPieces(command.ids), moving = existingGroups(command.groups);
      if (!pieces.length && !moving.length) throw new Error('Select pieces or groups to move.');
      if (command.parent && !(p.groups ?? []).some(group => group.id === command.parent)) throw new Error('Group no longer exists.');
      keepOrder(pieces, moving);
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
        if (!item.holder || isLocked(item)) throw new Error('Only unlocked held components can be released.');
      });
      items.forEach((item, index) => Object.assign(item, { holder: null, x: command.x + index * 24, y: command.y + index * 24 }));
      if (command.snap) snapUnits(items);
      break;
    }
    case 'dropManyFromHand': {
      const items = command.ids.map(get), target = get(command.targetId);
      if (new Set(command.ids).size !== items.length) throw new Error('Choose each held component once.');
      items.forEach(item => {
        editable(item);
        if (!item.holder || isLocked(item)) throw new Error('Only unlocked held components can be released.');
      });
      const targetItems = stackMembers(p, target);
      if (targetItems.some(i => i.holder || isLocked(i))) throw new Error('Select compatible unlocked tabletop components.');
      const filter = joinFilter(target, items);
      if (p.instances.some(i => i.stack === command.stackId && !targetItems.includes(i))) throw new Error('Stack identifier already exists.');
      materialize(targetItems);
      [...stackMembers(p, target), ...items].forEach((item, order) => Object.assign(item, { holder: null, stack: command.stackId, stackReversed: false, order, x: target.x, y: target.y }));
      applyFilter(command.stackId, filter);
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
        if (isLocked(item) || !component(item).hand) throw new Error('Only unlocked components that support hands can be transferred.');
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
      if (!item.holder || isLocked(item)) throw new Error('Only unlocked held components can be released.');
      if (command.targetId) {
        const target = get(command.targetId), members = stackMembers(p, target);
        if (!command.stackId || members.some(i => i.holder || isLocked(i))) throw new Error('Select compatible unlocked tabletop components.');
        const filter = joinFilter(target, [item]);
        if (p.instances.some(i => i.stack === command.stackId && !members.includes(i))) throw new Error('Stack identifier already exists.');
        materialize(members);
        stackMembers(p, target).forEach((i, order) => Object.assign(i, { stack: command.stackId, stackReversed: false, order, x: target.x, y: target.y }));
        Object.assign(item, { holder: null, stack: command.stackId, stackReversed: false, order: members.length, x: target.x, y: target.y });
        applyFilter(command.stackId, filter);
      } else {
        Object.assign(item, { holder: null, x: command.x, y: command.y });
        if (command.snap) snapUnits([item]);
      }
      break;
    }
    case 'move':
      for (const key of command.ids) {
        const item = get(key);
        editable(item);
        // Its order lock is separate from its place on the table, so it changes even while the piece is held in place.
        const locksOnly = Object.keys(command.patch).every(key => key === 'orderLocked');
        if (item.locked && command.patch.locked !== false && !locksOnly) throw new Error('Unlock this component first.');
        // A piece in a locked group can only change its own locks.
        if (lockedByGroup(item) && Object.keys(command.patch).some(key => key !== 'locked' && key !== 'orderLocked')) throw new Error('Unlock its group first.');
        if (command.patch.flipped !== undefined && !component(item).flippable) throw new Error('This component is not flippable.');
        Object.assign(item, command.patch);
        if (command.patch.rotation !== undefined) item.rotation = snapAngle(item.rotation);
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
        if (isLocked(item)) throw new Error('Unlock this component first.');
        item.x = positions?.get(key)?.x ?? item.x + (command.dx ?? 0);
        item.y = positions?.get(key)?.y ?? item.y + (command.dy ?? 0);
        item.rotation = snapAngle((item.rotation + (command.rotation ?? 0) + (command.turns ?? 0) * (component(item).rotationStep ?? 90)) % 360);
        // Rounding keeps relative factors such as target / current from drifting below the typed value.
        item.scale = Math.round(item.scale * (command.scaleFactor ?? 1) * 1e9) / 1e9;
        if (command.flip && item.stack && flippedStacks.has(item.stack)) item.stackReversed = !item.stackReversed;
        else if (command.flip && component(item).flippable) item.flipped = !item.flipped;
      }
      if (command.snap) snapUnits([...selectedIds].map(get));
      break;
    }
    case 'delete':
      for (const key of command.ids) editable(get(key));
      p.instances = p.instances.filter(i => !command.ids.includes(i.id));
      break;
    case 'stack': {
      const items = command.ids.map(get);
      items.forEach(i => { editable(i); if (isLocked(i) || i.holder) throw new Error('Only unlocked tabletop components can be stacked.'); });
      if (items.length < 2 || new Set(command.ids).size !== items.length) throw new Error('Select at least two stackable pieces.');
      const blocked = items.map(component).find(c => !c.stackable);
      if (blocked) throw new Error(`${blocked.name} can't be stacked.`);
      if (!canStack(items.map(component))) throw new Error('These pieces have no stack tag in common.');
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
      // A new stack takes every stack tag its pieces share.
      applyFilter(command.stackId, newStackFilter(items.map(component)));
      break;
    }
    case 'dropStack': {
      const target = get(command.targetId);
      const targetItems = stackMembers(p, target);
      const items = command.ids.map(get);
      if (new Set(command.ids).size !== items.length || items.some(i => targetItems.includes(i))) throw new Error('Choose a different stack.');
      if (items.some(i => i.stack && stackMembers(p, i).some(other => !command.ids.includes(other.id)))) throw new Error('Select the entire stack.');
      const combined = [...targetItems, ...items];
      combined.forEach(i => { editable(i); if (isLocked(i) || i.holder) throw new Error('Only unlocked tabletop components can be stacked.'); });
      const filter = joinFilter(target, items);
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
      applyFilter(command.stackId, filter);
      break;
    }
    case 'unstack': {
      const items = stackMembers(p, get(command.id));
      materialize(items);
      items.forEach((i, n) => { editable(i); if (isLocked(i)) throw new Error('Unlock the stack first.'); Object.assign(i, { stack: null, x: i.x + n * 36, y: i.y + n * 12 }); });
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
      items.forEach((i, n) => { editable(i); i.order = n; i.shuffles = (i.shuffles ?? 0) + 1; });
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
      drawn.forEach(item => { editable(item); if (isLocked(item) || !component(item).hand) throw new Error('This component cannot be put in hand.'); });
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
        if (item.holder || isLocked(item) || !component(item).hand) throw new Error('Only unlocked tabletop components that support hands can be drawn.');
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
      if (isLocked(item)) throw new Error('Unlock this component first.');
      if (command.type === 'dropFromHand') {
        const target = get(command.targetId);
        const items = stackMembers(p, target);
        if (!command.stackId || items.some(i => i.holder || isLocked(i))) throw new Error('Select compatible unlocked tabletop components.');
        const filter = joinFilter(target, [item]);
        if (p.instances.some(i => i.stack === command.stackId && !items.includes(i))) throw new Error('Stack identifier already exists.');
        materialize(items);
        stackMembers(p, target).forEach((i, order) => Object.assign(i, { stack: command.stackId, stackReversed: false, order, x: target.x, y: target.y }));
        Object.assign(item, { holder: null, stack: command.stackId, stackReversed: false, order: items.length, x: target.x, y: target.y });
        applyFilter(command.stackId, filter);
        break;
      }
      Object.assign(item, { holder: null, x: command.x, y: command.y });
      if (command.snap) snapUnits([item]);
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
    case 'setRow':
      for (const key of new Set(command.ids)) {
        const item = get(key), c = component(item);
        if (command.row >= Math.max(1, c.rows.length)) throw new Error(`${c.name} has ${Math.max(1, c.rows.length)} variant${c.rows.length === 1 ? '' : 's'}.`);
        item.row = command.row;
      }
      break;
    case 'script': {
      const scripts = p.scripts ?? [];
      const index = scripts.findIndex(script => script.id === command.script.id);
      if (index < 0 && scripts.length >= 50) throw new Error('A project can have at most 50 scripts.');
      if (scripts.some(script => script.id !== command.script.id && script.name.toLowerCase() === command.script.name.toLowerCase())) throw new Error(`There is already a script called ${command.script.name}.`);
      p.scripts = index < 0 ? [...scripts, command.script] : scripts.map(script => script.id === command.script.id ? command.script : script);
      break;
    }
    case 'removeScript':
      if (!p.scripts?.some(script => script.id === command.id)) throw new Error('Script no longer exists.');
      p.scripts = p.scripts.filter(script => script.id !== command.id);
      if (!p.scripts.length) delete p.scripts;
      break;
    case 'reorderScripts': {
      const scripts = command.ids.map(key => p.scripts?.find(script => script.id === key));
      if (scripts.length !== (p.scripts ?? []).length || new Set(command.ids).size !== scripts.length || scripts.some(script => !script)) throw new Error('Reorder must contain every script once.');
      if (scripts.length) p.scripts = scripts as Script[];
      break;
    }
    case 'memory':
      for (const change of command.changes) p.memory = setMemory(p.memory, change.path, change.value);
      if (!p.memory) delete p.memory;
      break;
    case 'clearScriptLog': delete p.scriptLog; break;
    case 'ping':
      for (const key of new Set(command.ids)) {
        const item = get(key);
        item.pings = (item.pings ?? 0) + 1;
        if (actor) item.pingedBy = actor; else delete item.pingedBy;
        if (command.players) item.pingedFor = command.players; else delete item.pingedFor;
      }
      break;
    case 'openPopup': {
      const shown = p.components.find(c => c.id === command.popup.componentId);
      if (!shown || shown.kind !== 'popup') throw new Error('Only popup components can be shown as popups.');
      if (command.popup.to?.some(seat => !p.players.some(player => player.id === seat))) throw new Error('That seat no longer exists.');
      if (command.popup.row >= Math.max(1, shown.rows.length)) throw new Error(`“${shown.name}” has no data row ${command.popup.row + 1}.`);
      if (p.popups?.some(popup => popup.id === command.popup.id)) throw new Error('That popup is already open.');
      const { closed: _closed, ...popup } = command.popup;
      // The oldest popups make room for new ones.
      p.popups = [...p.popups ?? [], { ...popup, ...actor && !popup.player ? { player: actor } : {} }].slice(-POPUP_LIMIT);
      break;
    }
    case 'closePopup': {
      const seats = command.players ?? (actor ? [actor] : undefined);
      const shared = (popup: Popup) => !command.players && popupSettings(p.components.find(c => c.id === popup.componentId) ?? {}, popup).dismiss === 'all';
      const open = closePopups(p.popups ?? [], new Set(command.ids), seats, p.players.map(player => player.id), shared);
      p.popups = open.length ? open : undefined;
      break;
    }
    case 'hideFrom': {
      if (command.players.some(player => !p.players.some(seat => seat.id === player))) throw new Error('That seat no longer exists.');
      const items = new Set(command.ids.map(get).flatMap(item => {
        if (item.holder) throw new Error('Only table pieces can be hidden.');
        return stackMembers(p, item);
      }));
      items.forEach(item => { if (command.players.length) item.hiddenFrom = [...new Set(command.players)]; else delete item.hiddenFrom; });
      break;
    }
    case 'grid': {
      const grids = projectGrids(p);
      const index = grids.findIndex(grid => grid.id === command.grid.id);
      if (index < 0 && grids.length >= 50) throw new Error('A table can have at most 50 grids.');
      if (command.grid.shape !== 'points') { delete command.grid.points; delete command.grid.pointGroups; }
      p.grids = index < 0 ? [...grids, command.grid] : grids.map(grid => grid.id === command.grid.id ? command.grid : grid);
      break;
    }
    case 'removeGrid':
      if (!projectGrids(p).some(grid => grid.id === command.id)) throw new Error('Grid no longer exists.');
      p.grids = projectGrids(p).filter(grid => grid.id !== command.id);
      break;
    case 'reorderGrids': {
      const grids = projectGrids(p), ordered = command.ids.map(key => grids.find(grid => grid.id === key));
      if (ordered.length !== grids.length || new Set(command.ids).size !== grids.length || ordered.some(grid => !grid)) throw new Error('Reorder must contain every grid once.');
      p.grids = ordered as typeof grids;
      break;
    }
    case 'snapTo': {
      // The grid's key: a table grid's id, or "piece id/grid id" for a grid a piece carries.
      const placed = placedGrids(p).find(item => item.key === command.grid);
      if (!placed) throw new Error('Grid no longer exists.');
      const at = placedPointPosition(placed, command.point);
      if (!at) throw new Error(`${placed.grid.name} has no point ${command.point}.`);
      const pieces = new Set([...new Set(command.ids)].flatMap(key => stackMembers(p, get(key))));
      for (const item of pieces) {
        editable(item);
        if (item.id === placed.host) throw new Error('A piece can’t snap to a grid it carries.');
        if (item.holder) throw new Error('Only table pieces can snap to a grid.');
        if (isLocked(item)) throw new Error('Unlock this component first.');
        Object.assign(item, { x: at.x, y: at.y });
        if (at.rotation !== undefined) item.rotation = snapAngle(((at.rotation % 360) + 360) % 360);
      }
      break;
    }
    // Script runs are handled around the table engine (runCommand); on their own they change nothing.
    case 'reloadScripts': case 'call': case 'tick': break;
  }
  keepPersistentStacks(source, p);
  const persistent = new Set((p.stacks ?? []).map(record => record.id));
  const counts = new Map<string, number>();
  p.instances.forEach(i => { if (i.stack) counts.set(i.stack, (counts.get(i.stack) ?? 0) + 1); });
  p.instances.forEach(i => {
    if (i.stack && counts.get(i.stack) === 1 && !persistent.has(i.stack)) i.stack = null;
    if (!i.stack && i.stackReversed) {
      if (component(i).flippable) i.flipped = !i.flipped;
      i.stackReversed = false;
    }
  });
  normalizeStackFilters(p);
  // Held pieces are never hidden on the table, removed seats leave hidden lists, and a stack is hidden as its bottom piece is.
  const seats = new Set(p.players.map(player => player.id));
  const stackBottoms = new Map<string, Instance>();
  for (const item of p.instances) if (item.stack && (!stackBottoms.has(item.stack) || item.order < stackBottoms.get(item.stack)!.order)) stackBottoms.set(item.stack, item);
  const hiddenOf = new Map(p.instances.map(item => [item, (item.stack ? stackBottoms.get(item.stack)! : item).hiddenFrom]));
  for (const item of p.instances) {
    const kept = item.holder ? [] : (hiddenOf.get(item) ?? []).filter(player => seats.has(player));
    if (kept.length) item.hiddenFrom = kept; else delete item.hiddenFrom;
  }
  normalizeGroups(p);
  syncPersistentStacks(p);
  // Commands that change table order or grouping keep each group's pieces together (see gatherGroups), so raising a
  // grouped piece raises its whole group and the Pieces panel always lists pieces in table order.
  if (['front', 'zOrder', 'arrangePieces', 'createGroup', 'moveToGroup', 'ungroup', 'duplicate', 'paste', 'spawn'].includes(command.type)) p.instances = gatherGroups(p);
  if (p.popups && ['component', 'removeComponent', 'removePlayer'].includes(command.type)) keepOpenPopups(p);
  return validateProject(p);
}

/**
 * Drops popups whose component is gone or no longer a popup, and seats that left from who they're for (a popup for
 * no remaining seat closes).
 */
function keepOpenPopups(p: Project) {
  const seats = new Set(p.players.map(player => player.id));
  const open = (p.popups ?? []).flatMap(popup => {
    if (p.components.find(c => c.id === popup.componentId)?.kind !== 'popup') return [];
    const to = popup.to?.filter(seat => seats.has(seat)), closed = popup.closed?.filter(seat => seats.has(seat));
    if (to && !to.length) return [];
    return [{ ...popup, ...to ? { to } : {}, ...closed ? { closed } : {} }];
  });
  p.popups = open.length ? open : undefined;
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

/**
 * A new layer. Without a pivot it is placed by its top-left corner; one given a rotation but no pivot turns about its
 * centre, as layers did before pivots (its X/Y then move to the centre, see `withPivot`).
 */
export function makeNode(type: DesignNode['type'], values: Partial<DesignNode> = {}): DesignNode {
  return withPivot({
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
  });
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
