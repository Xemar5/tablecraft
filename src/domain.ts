import { z } from 'zod';

const id = z.string().min(1).max(100);
const num = z.number().finite();
const color = z.string().max(80);
export const nodeSchema = z.object({
  id, parent: id.nullable(), name: z.string().max(100),
  type: z.enum(['frame', 'text', 'image', 'shape']),
  x: num, y: num, width: num.min(1).max(4000), height: num.min(1).max(4000),
  text: z.string().max(10000), fill: color, color, fontSize: num.min(4).max(400),
  font: z.string().max(100), radius: num.min(0).max(2000), rotation: num,
  layout: z.enum(['absolute', 'row', 'column']), gap: num.min(0).max(200),
  padding: num.min(0).max(200), align: z.enum(['start', 'center', 'end']),
  opacity: num.min(0).max(1),
});
export type DesignNode = z.infer<typeof nodeSchema>;
export const componentSchema = z.object({
  id, name: z.string().min(1).max(100), kind: z.enum(['card', 'token', 'board', 'dice']),
  width: num.min(20).max(2000), height: num.min(20).max(2000), color,
  front: z.array(nodeSchema).max(300), back: z.array(nodeSchema).max(300),
  csv: z.string().max(1_000_000),
  rows: z.array(z.record(z.string(), z.string())).max(10000),
  flippable: z.boolean(), hand: z.boolean(), hideInHand: z.boolean(),
  stackable: z.boolean(), shufflable: z.boolean(), stackTag: z.string().max(100),
});
export type Component = z.infer<typeof componentSchema>;
export const instanceSchema = z.object({
  id, componentId: id, row: z.number().int().min(0), x: num, y: num,
  rotation: num, scale: num.min(0.1).max(5), flipped: z.boolean(),
  holder: id.nullable(), stack: id.nullable(), order: num, locked: z.boolean(),
});
export type Instance = z.infer<typeof instanceSchema>;
export const playerSchema = z.object({
  id, owner: z.string().max(200), name: z.string().min(1).max(50), color,
  x: num, y: num, rotation: num,
});
export type Player = z.infer<typeof playerSchema>;
export const projectSchema = z.object({
  id, name: z.string().min(1).max(100), description: z.string().max(1000),
  components: z.array(componentSchema).max(500),
  instances: z.array(instanceSchema).max(10000),
  players: z.array(playerSchema),
  settings: z.object({
    grid: z.boolean(), snap: z.boolean(), gridSize: num.min(5).max(200),
    hands: z.boolean(), turns: z.boolean(), turn: z.number().int().min(0),
  }),
});
export type Project = z.infer<typeof projectSchema>;
export const archiveSchema = z.object({
  format: z.literal('tablecraft'), version: z.literal(1), projects: z.array(projectSchema).min(1).max(100),
});
export type Archive = z.infer<typeof archiveSchema>;
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('component'), component: componentSchema }),
  z.object({ type: z.literal('removeComponent'), id }),
  z.object({ type: z.literal('spawn'), instances: z.array(instanceSchema).min(1).max(1000) }),
  z.object({ type: z.literal('move'), ids: z.array(id), patch: instanceSchema.pick({ x: true, y: true, rotation: true, scale: true, flipped: true, locked: true }).partial() }),
  z.object({ type: z.literal('transform'), ids: z.array(id).min(1), dx: num.optional(), dy: num.optional(), rotation: num.optional(), scaleFactor: num.positive().optional(), flip: z.boolean().optional() }),
  z.object({ type: z.literal('drawSelection'), ids: z.array(id).min(1), playerId: id }),
  z.object({ type: z.literal('delete'), ids: z.array(id) }),
  z.object({ type: z.literal('stack'), ids: z.array(id), stackId: id }),
  z.object({ type: z.literal('dropStack'), ids: z.array(id).min(1), targetId: id, stackId: id }),
  z.object({ type: z.literal('unstack'), id }),
  z.object({ type: z.literal('reorder'), ids: z.array(id) }),
  z.object({ type: z.literal('shuffle'), id, seed: z.number().int() }),
  z.object({ type: z.literal('draw'), id, playerId: id }),
  z.object({ type: z.literal('drawMany'), id, playerId: id, count: z.number().int().min(1).max(1000) }),
  z.object({ type: z.literal('release'), id, x: num, y: num }),
  z.object({ type: z.literal('dropFromHand'), id, targetId: id, stackId: id }),
  z.object({ type: z.literal('reorderHand'), ids: z.array(id), playerId: id }),
  z.object({ type: z.literal('player'), player: playerSchema }),
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

export function validateProject(project: Project): Project {
  projectSchema.parse(project);
  const componentIds = new Set(project.components.map(c => c.id));
  const playerIds = new Set(project.players.map(p => p.id));
  if (componentIds.size !== project.components.length || playerIds.size !== project.players.length ||
    new Set(project.instances.map(i => i.id)).size !== project.instances.length) throw new Error('Duplicate identifiers in project.');
  for (const c of project.components) {
    for (const face of [c.front, c.back]) {
      const nodes = new Map(face.map(n => [n.id, n]));
      if (nodes.size !== face.length) throw new Error('Duplicate layer identifiers.');
      for (const node of face) {
        const seen = new Set([node.id]);
        let parent = node.parent;
        while (parent) {
          if (seen.has(parent)) throw new Error('Layer hierarchy contains a cycle.');
          seen.add(parent);
          const ancestor = nodes.get(parent);
          if (!ancestor || ancestor.type !== 'frame') throw new Error('Layer parent must be an existing frame.');
          parent = ancestor.parent;
        }
      }
    }
  }
  for (const i of project.instances) {
    if (!componentIds.has(i.componentId) || (i.holder && !playerIds.has(i.holder))) throw new Error('Broken component or player reference.');
    if (i.stack && i.holder) throw new Error('A held component cannot belong to a stack.');
  }
  const groups = new Map<string, Instance[]>();
  for (const i of project.instances) if (i.stack) groups.set(i.stack, [...(groups.get(i.stack) ?? []), i]);
  for (const group of groups.values()) {
    if (!canStack(group.map(i => project.components.find(c => c.id === i.componentId)!))) throw new Error('Incompatible components in stack.');
  }
  return project;
}

export function canStack(components: Component[]): boolean {
  if (!components.length || components.some(c => !c.stackable)) return false;
  const first = components[0];
  return components.every(c => first.stackTag ? c.stackTag === first.stackTag : c.id === first.id);
}

export function stackMembers(project: Project, instance: Instance): Instance[] {
  return (instance.stack ? project.instances.filter(i => i.stack === instance.stack) : [instance]).sort((a, b) => a.order - b.order);
}

export function applyCommand(source: Project, raw: Command, actor?: string): Project {
  const command = commandSchema.parse(raw);
  const p = projectSchema.parse(source);
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
  switch (command.type) {
    case 'component': {
      const index = p.components.findIndex(c => c.id === command.component.id);
      if (index < 0) p.components.push(command.component);
      else p.components[index] = command.component;
      for (const i of p.instances.filter(i => i.componentId === command.component.id)) {
        if (!command.component.flippable) i.flipped = false;
        if (!command.component.hand) i.holder = null;
        if (!command.component.stackable || source.components.find(c => c.id === i.componentId)?.stackTag !== command.component.stackTag) i.stack = null;
      }
      break;
    }
    case 'removeComponent':
      p.components = p.components.filter(c => c.id !== command.id);
      p.instances = p.instances.filter(i => i.componentId !== command.id);
      break;
    case 'spawn':
      for (const item of command.instances) {
        if (p.instances.some(i => i.id === item.id)) throw new Error('Instance identifier already exists.');
        if (item.holder || item.stack) throw new Error('Spawn components onto the table first.');
        component(item);
        p.instances.push(item);
      }
      break;
    case 'move':
      for (const key of command.ids) {
        const item = get(key);
        editable(item);
        if (item.locked && command.patch.locked !== false) throw new Error('Unlock this component first.');
        if (command.patch.flipped !== undefined && !component(item).flippable) throw new Error('This component is not flippable.');
        Object.assign(item, command.patch);
      }
      break;
    case 'transform':
      for (const key of new Set(command.ids)) {
        const item = get(key);
        editable(item);
        if (item.locked) throw new Error('Unlock this component first.');
        item.x += command.dx ?? 0;
        item.y += command.dy ?? 0;
        item.rotation = (item.rotation + (command.rotation ?? 0)) % 360;
        item.scale *= command.scaleFactor ?? 1;
        if (command.flip && component(item).flippable) item.flipped = !item.flipped;
      }
      break;
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
      items.forEach((i, order) => Object.assign(i, { stack: command.stackId, order, x: items[0].x, y: items[0].y }));
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
      combined.forEach((i, order) => Object.assign(i, { stack: command.stackId, order, x: target.x, y: target.y }));
      break;
    }
    case 'unstack': {
      const items = stackMembers(p, get(command.id));
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
      const items = stackMembers(p, get(command.id));
      if (items.some(i => i.holder)) throw new Error('Draw from the table.');
      const drawn = items.slice(-Math.min(command.type === 'drawMany' ? command.count : 1, items.length)).reverse();
      drawn.forEach(item => { editable(item); if (item.locked || !component(item).hand) throw new Error('This component cannot be put in hand.'); });
      let order = Math.max(-1, ...p.instances.filter(i => i.holder === command.playerId).map(i => i.order));
      drawn.forEach(item => Object.assign(item, { holder: command.playerId, stack: null, order: ++order }));
      break;
    }
    case 'drawSelection': {
      if (!p.settings.hands) throw new Error('Enable hands before drawing.');
      if (!p.players.some(player => player.id === command.playerId)) throw new Error('Choose a player first.');
      if (actor && command.playerId !== actor) throw new Error('Draw into your active hand.');
      const items = [...new Set(command.ids)].map(get);
      let order = Math.max(-1, ...p.instances.filter(i => i.holder === command.playerId).map(i => i.order));
      for (const item of items) {
        editable(item);
        if (item.holder || item.locked || !component(item).hand) throw new Error('Only unlocked tabletop components that support hands can be drawn.');
        Object.assign(item, { holder: command.playerId, stack: null, order: ++order });
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
        items.forEach((i, order) => Object.assign(i, { stack: command.stackId, order, x: target.x, y: target.y }));
        Object.assign(item, { holder: null, stack: command.stackId, order: items.length, x: target.x, y: target.y });
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
    case 'player': {
      const index = p.players.findIndex(player => player.id === command.player.id);
      if (index < 0) p.players.push(command.player);
      else p.players[index] = command.player;
      break;
    }
    case 'settings':
      Object.assign(p.settings, command.patch);
      if (p.players.length) p.settings.turn %= p.players.length;
      break;
    case 'rename': p.name = command.name; break;
  }
  const counts = new Map<string, number>();
  p.instances.forEach(i => { if (i.stack) counts.set(i.stack, (counts.get(i.stack) ?? 0) + 1); });
  p.instances.forEach(i => { if (i.stack && counts.get(i.stack) === 1) i.stack = null; });
  return validateProject(p);
}

export function makeInstance(componentId: string, row = 0, x = 700, y = 450): Instance {
  return { id: uid('piece'), componentId, row, x, y, rotation: 0, scale: 1, flipped: false, holder: null, stack: null, order: 0, locked: false };
}

export function makeNode(type: DesignNode['type'], values: Partial<DesignNode> = {}): DesignNode {
  return {
    id: uid('layer'), parent: null, name: type[0].toUpperCase() + type.slice(1), type,
    x: 16, y: 16, width: 150, height: 40, text: type === 'text' ? 'Your text' : '',
    fill: type === 'text' ? 'transparent' : '#e8b86d', color: '#253d37',
    fontSize: 20, font: 'DM Sans', radius: 0, rotation: 0,
    layout: 'absolute', gap: 8, padding: 0, align: 'start', opacity: 1, ...values,
  };
}
