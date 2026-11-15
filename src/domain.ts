import { z } from 'zod';

const id = z.string().min(1).max(100);
const num = z.number().finite();
const color = z.string().max(80);
const MAX_NESTED_RENDER_NODES = 10_000;
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
  padding: num.min(0).max(200), align: z.enum(['start', 'center', 'end']),
  widthMode: z.enum(['fixed', 'hug', 'fill']).default('fixed'),
  heightMode: z.enum(['fixed', 'hug', 'fill']).default('fixed'),
  wrap: z.boolean().default(false),
  paddingTop: num.min(0).max(200).optional(), paddingRight: num.min(0).max(200).optional(),
  paddingBottom: num.min(0).max(200).optional(), paddingLeft: num.min(0).max(200).optional(),
  opacity: num.min(0).max(1),
  shapeKind: z.enum(['rectangle', 'ellipse', 'polygon', 'star', 'path']).default('rectangle'),
  points: z.array(vectorPointSchema).max(128).default([]),
  pathClosed: z.boolean().default(true),
  sides: z.number().int().min(3).max(100).default(5),
  innerRadius: num.min(0.05).max(0.95).default(0.5),
  stroke: color.default('transparent'), strokeWidth: num.min(0).max(200).default(0),
  compoundOperation: z.enum(['union', 'subtract', 'intersect', 'exclude']).default('union'),
  componentId: id.optional(),
  dataSource: z.enum(['inherit', 'row', 'field']).default('inherit'),
  dataRow: z.number().int().min(0).max(9999).default(0),
  dataField: z.string().max(100).default(''),
  visibilityField: z.string().max(10000).default(''),
  visibilityValue: z.string().max(10000).default(''),
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
  stackReversed: z.boolean().optional(),
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
    hands: z.boolean(), allowOtherHands: z.boolean().optional(), turns: z.boolean(), turn: z.number().int().min(0),
  }),
});
export type Project = z.infer<typeof projectSchema>;
export const archiveSchema = z.object({
  format: z.literal('tablecraft'), version: z.literal(1), projects: z.array(projectSchema).min(1).max(100),
});
export type Archive = z.infer<typeof archiveSchema>;
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('component'), component: componentSchema, removedDataRow: z.number().int().min(0).optional() }),
  z.object({ type: z.literal('removeComponent'), id }),
  z.object({ type: z.literal('spawn'), instances: z.array(instanceSchema).min(1).max(1000) }),
  z.object({ type: z.literal('paste'), instances: z.array(instanceSchema).min(1).max(1000) }),
  z.object({ type: z.literal('duplicate'), copies: z.array(z.object({ sourceId: id, id, stack: id.nullable() })).min(1).max(1000), dx: num, dy: num }),
  z.object({ type: z.literal('front'), ids: z.array(id).min(1) }),
  z.object({ type: z.literal('extractMove'), id, x: num, y: num }),
  z.object({ type: z.literal('roll'), ids: z.array(id).min(1), seed: z.number().int() }),
  z.object({ type: z.literal('releaseMany'), ids: z.array(id).min(1), x: num, y: num }),
  z.object({ type: z.literal('dropManyFromHand'), ids: z.array(id).min(1), targetId: id, stackId: id }),
  z.object({ type: z.literal('transferToHand'), ids: z.array(id).min(1), playerId: id, faceUp: z.boolean().optional() }),
  z.object({ type: z.literal('playVisibleHand'), id, x: num, y: num, targetId: id.optional(), stackId: id.optional() }),
  z.object({ type: z.literal('move'), ids: z.array(id), patch: instanceSchema.pick({ x: true, y: true, rotation: true, scale: true, flipped: true, locked: true }).partial() }),
  z.object({ type: z.literal('transform'), ids: z.array(id).min(1), dx: num.optional(), dy: num.optional(), rotation: num.optional(), scaleFactor: num.positive().optional(), flip: z.boolean().optional() }),
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
        if (node.type === 'shape' && node.shapeKind === 'path' && node.points.length < (node.pathClosed ? 3 : 2)) {
          throw new Error(`Path “${node.name}” needs at least ${node.pathClosed ? 3 : 2} points.`);
        }
        if (node.type === 'component') {
          if (!node.componentId || !componentIds.has(node.componentId)) throw new Error(`Nested component “${node.name}” references a missing component.`);
          const nested = project.components.find(item => item.id === node.componentId)!;
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
  const links = new Map(project.components.map(component => [component.id, new Set(
    [...component.front, ...component.back].flatMap(node => node.type === 'component' && node.componentId ? [node.componentId] : []),
  )]));
  const references = new Map(project.components.map(component => [component.id,
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
  for (const component of project.components) visit(component.id, 0);
  const renderCosts = new Map<string, number>();
  const renderCost = (componentId: string): number => {
    const cached = renderCosts.get(componentId);
    if (cached !== undefined) return cached;
    const component = project.components.find(item => item.id === componentId)!;
    const ownNodes = Math.max(component.front.length, component.back.length);
    const total = ownNodes + (references.get(componentId) ?? []).reduce((sum, linkedId) => sum + renderCost(linkedId), 0);
    if (total > MAX_NESTED_RENDER_NODES) throw new Error(`Nested component rendering exceeds ${MAX_NESTED_RENDER_NODES} layers.`);
    renderCosts.set(componentId, total);
    return total;
  };
  project.components.forEach(component => { renderCost(component.id); });
  for (const i of project.instances) {
    if (!componentIds.has(i.componentId) || (i.holder && !playerIds.has(i.holder))) throw new Error('Broken component or player reference.');
    if (i.stack && i.holder) throw new Error('A held component cannot belong to a stack.');
  }
  const groups = new Map<string, Instance[]>();
  for (const i of project.instances) if (i.stack) groups.set(i.stack, [...(groups.get(i.stack) ?? []), i]);
  for (const group of groups.values()) {
    if (!canStack(group.map(i => project.components.find(c => c.id === i.componentId)!))) throw new Error('Incompatible components in stack.');
    if (group.some(i => !!i.stackReversed !== !!group[0].stackReversed)) throw new Error('Inconsistent stack orientation.');
  }
  if (project.instances.some(i => !i.stack && i.stackReversed)) throw new Error('Only stacks can have a stack orientation.');
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
export function visibleStackMembers(project: Project, instance: Instance): Instance[] {
  const members = stackMembers(project, instance);
  return instance.stack && instance.stackReversed ? members.reverse() : members;
}
export function visibleBack(instance: Instance): boolean {
  return instance.flipped !== !!(instance.stack && instance.stackReversed);
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
  // When a stack is dismantled or merged, materialize its visible order/faces.
  const materialize = (items: Instance[]) => {
    if (!items[0]?.stackReversed) return;
    [...items].reverse().forEach((item, order) => {
      item.order = order;
      if (component(item).flippable) item.flipped = !item.flipped;
      item.stackReversed = false;
    });
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
      if (command.removedDataRow !== undefined) {
        const previous = p.components[index];
        if (!previous || previous.kind !== 'dice' || command.component.kind !== 'dice' ||
          previous.rows.length < 2 || command.removedDataRow >= previous.rows.length ||
          JSON.stringify(previous.rows.filter((_, row) => row !== command.removedDataRow)) !== JSON.stringify(command.component.rows)) {
          throw new Error('Remove exactly one existing dice variant and keep at least one variant.');
        }
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
    case 'removeComponent': {
      if (!p.components.some(component => component.id === command.id)) throw new Error('Component no longer exists.');
      const referencing = p.components.find(component => [...component.front, ...component.back].some(node => node.type === 'component' && node.componentId === command.id));
      if (referencing) throw new Error(`“${referencing.name}” links this component. Remove or relink that nested instance first.`);
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
      }
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
      if (!p.settings.hands || !p.settings.allowOtherHands) throw new Error('Moving cards between visible hands is disabled.');
      if (!actor || !p.players.some(player => player.id === actor) || !p.players.some(player => player.id === command.playerId)) throw new Error('Choose a valid active player and destination.');
      const items = command.ids.map(get);
      if (new Set(command.ids).size !== items.length) throw new Error('Choose each component once.');
      items.forEach(item => {
        if (item.locked || !component(item).hand) throw new Error('Only unlocked components that support hands can be transferred.');
      });
      let order = Math.max(-1, ...p.instances.filter(i => i.holder === command.playerId && !items.includes(i)).map(i => i.order));
      drawOrder(items).forEach(item => {
        if (item.stackReversed && component(item).flippable) item.flipped = !item.flipped;
        if (command.faceUp !== false) item.flipped = false;
        Object.assign(item, { holder: command.playerId, stack: null, stackReversed: false, order: ++order });
      });
      break;
    }
    case 'playVisibleHand': {
      if (!p.settings.hands || !p.settings.allowOtherHands) throw new Error('Moving cards between visible hands is disabled.');
      if (!actor || !p.players.some(player => player.id === actor)) throw new Error('Choose a valid active player.');
      const item = get(command.id);
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
      const flippedStacks = new Set<string>();
      if (command.flip) for (const key of selectedIds) {
        const item = get(key);
        if (item.stack && stackMembers(p, item).some(member => component(member).flippable) && stackMembers(p, item).every(member => selectedIds.has(member.id))) flippedStacks.add(item.stack);
      }
      for (const key of new Set(command.ids)) {
        const item = get(key);
        editable(item);
        if (item.locked) throw new Error('Unlock this component first.');
        item.x += command.dx ?? 0;
        item.y += command.dy ?? 0;
        item.rotation = (item.rotation + (command.rotation ?? 0)) % 360;
        item.scale *= command.scaleFactor ?? 1;
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
  p.instances.forEach(i => {
    if (i.stack && counts.get(i.stack) === 1) i.stack = null;
    if (!i.stack && i.stackReversed) {
      if (component(i).flippable) i.flipped = !i.flipped;
      i.stackReversed = false;
    }
  });
  return validateProject(p);
}

export function makeInstance(componentId: string, row = 0, x = 700, y = 450): Instance {
  return { id: uid('piece'), componentId, row, x, y, rotation: 0, scale: 1, flipped: false, holder: null, stack: null, order: 0, locked: false };
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
