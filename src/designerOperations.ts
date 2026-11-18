import { makeNode, uid, type DesignNode } from './domain';
import { compoundRings, expandPathBounds, fitPathBounds, shapeAsPath } from './vectorGeometry';
import { reorder, type OrderMove } from './zOrder';

function bounds(node: DesignNode) {
  const radians = node.rotation * Math.PI / 180;
  const width = Math.abs(node.width * Math.cos(radians)) + Math.abs(node.height * Math.sin(radians));
  const height = Math.abs(node.width * Math.sin(radians)) + Math.abs(node.height * Math.cos(radians));
  return { left: node.x + (node.width - width) / 2, top: node.y + (node.height - height) / 2,
    right: node.x + (node.width + width) / 2, bottom: node.y + (node.height + height) / 2 };
}

export function selectedRoots(nodes: DesignNode[], ids: string[]): DesignNode[] {
  const selected = new Set(ids);
  const byId = new Map(nodes.map(node => [node.id, node]));
  return nodes.filter(node => {
    if (!selected.has(node.id)) return false;
    let parent = node.parent;
    while (parent) {
      if (selected.has(parent)) return false;
      parent = byId.get(parent)?.parent ?? null;
    }
    return true;
  });
}

export function copySubtrees(nodes: DesignNode[], ids: string[]): DesignNode[] {
  const included = new Set(selectedRoots(nodes, ids).map(node => node.id));
  let size = -1;
  while (size !== included.size) {
    size = included.size;
    nodes.forEach(node => { if (node.parent && included.has(node.parent)) included.add(node.id); });
  }
  return structuredClone(nodes.filter(node => included.has(node.id)));
}

export function pasteSubtrees(nodes: DesignNode[], copied: DesignNode[]): { nodes: DesignNode[]; selected: string[] } {
  if (!copied.length) throw new Error('No layers have been copied.');
  if (nodes.length + copied.length > 300) throw new Error('A face cannot contain more than 300 layers.');
  const ids = new Map(copied.map(node => [node.id, uid('node')]));
  const roots = copied.filter(node => !node.parent || !ids.has(node.parent));
  if (roots.some(node => node.parent && !nodes.some(parent => parent.id === node.parent && ['frame', 'compound'].includes(parent.type)))) {
    throw new Error('The copied layers’ original parent no longer exists.');
  }
  const clones = copied.map(node => {
    const root = !node.parent || !ids.has(node.parent);
    const parent = node.parent ? nodes.find(item => item.id === node.parent) : undefined;
    const offset = root && (!parent || parent.layout === 'absolute') ? 16 : 0;
    return { ...node, id: ids.get(node.id)!, parent: node.parent ? ids.get(node.parent) ?? node.parent : null, x: node.x + offset, y: node.y + offset };
  });
  return { nodes: [...nodes, ...clones], selected: roots.map(node => ids.get(node.id)!) };
}

export function groupLayers(nodes: DesignNode[], ids: string[]): { nodes: DesignNode[]; selected: string[] } {
  const roots = selectedRoots(nodes, ids);
  if (!roots.length) throw new Error('Select layers to group.');
  if (nodes.length >= 300) throw new Error('A face cannot contain more than 300 layers.');
  if (roots.some(node => node.parent !== roots[0].parent)) throw new Error('Group layers that share the same parent.');
  const parent = nodes.find(node => node.id === roots[0].parent);
  if (parent?.type === 'compound') throw new Error('Grouping vector sources would change the live compound. Uncombine it first.');
  if (parent && parent.layout !== 'absolute') throw new Error('Grouping flow-layout children cannot preserve their layout.');
  const siblings = nodes.filter(node => node.parent === roots[0].parent);
  const indices = roots.map(node => siblings.indexOf(node));
  if (Math.max(...indices) - Math.min(...indices) + 1 !== roots.length) throw new Error('Group consecutive siblings to preserve layer order.');
  if (roots.some(node => node.widthMode !== 'fixed' || node.heightMode !== 'fixed')) throw new Error('Grouping requires fixed-size layers to preserve their layout.');
  const minX = Math.min(...roots.map(node => bounds(node).left)), minY = Math.min(...roots.map(node => bounds(node).top));
  const maxX = Math.max(...roots.map(node => bounds(node).right)), maxY = Math.max(...roots.map(node => bounds(node).bottom));
  if (maxX - minX > 4000 || maxY - minY > 4000) throw new Error('The group would exceed the maximum frame size.');
  const group = makeNode('frame', { name: 'Group', parent: roots[0].parent, x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY), fill: 'transparent' });
  const chosen = new Set(roots.map(node => node.id));
  const result = nodes.map(node => chosen.has(node.id) ? { ...node, parent: group.id, x: node.x - minX, y: node.y - minY } : node);
  result.splice(nodes.indexOf(roots[0]), 0, group);
  return { nodes: result, selected: [group.id] };
}

export function ungroupLayers(nodes: DesignNode[], ids: string[]): { nodes: DesignNode[]; selected: string[] } {
  const groups = selectedRoots(nodes, ids);
  if (!groups.length || groups.some(node => node.type !== 'frame')) throw new Error('Select one or more frames to ungroup.');
  const groupIds = new Set(groups.map(node => node.id));
  for (const group of groups) {
    const parent = nodes.find(node => node.id === group.parent);
    const children = nodes.filter(node => node.parent === group.id);
    if (group.layout !== 'absolute' || (parent && parent.layout !== 'absolute') ||
        group.widthMode !== 'fixed' || group.heightMode !== 'fixed' ||
        children.some(child => child.widthMode !== 'fixed' || child.heightMode !== 'fixed')) {
      throw new Error('Ungrouping requires fixed-size absolute layouts to preserve placement.');
    }
    if (group.opacity !== 1 || group.fill !== 'transparent') throw new Error('Ungrouping requires a transparent, opaque frame to preserve its appearance.');
  }
  const byId = new Map(groups.map(group => [group.id, group]));
  const children = nodes.filter(node => node.parent && groupIds.has(node.parent));
  const transformed = new Map(children.map(child => {
    const group = byId.get(child.parent!)!;
    const angle = group.rotation * Math.PI / 180;
    const x = child.x + child.width / 2 - group.width / 2, y = child.y + child.height / 2 - group.height / 2;
    return [child.id, { ...child, parent: group.parent, x: group.x + group.width / 2 + x * Math.cos(angle) - y * Math.sin(angle) - child.width / 2,
      y: group.y + group.height / 2 + x * Math.sin(angle) + y * Math.cos(angle) - child.height / 2, rotation: child.rotation + group.rotation }];
  }));
  const result: DesignNode[] = [];
  nodes.forEach(node => {
    if (groupIds.has(node.id)) result.push(...children.filter(child => child.parent === node.id).map(child => transformed.get(child.id)!));
    else if (!transformed.has(node.id)) result.push(node);
  });
  return { nodes: result, selected: children.map(child => child.id) };
}

export function combineLayers(
  nodes: DesignNode[], ids: string[], operation: DesignNode['compoundOperation'],
): { nodes: DesignNode[]; selected: string[] } {
  const roots = selectedRoots(nodes, ids);
  if (roots.length < 2 || roots.some(node => !['shape', 'compound'].includes(node.type))) {
    throw new Error('Select at least two vector shapes or live compounds.');
  }
  if (roots.some(node => node.parent !== roots[0].parent)) throw new Error('Boolean shapes must share the same parent.');
  const parent = nodes.find(node => node.id === roots[0].parent);
  if (parent && parent.layout !== 'absolute') throw new Error('Boolean operations require an absolute-positioned parent.');
  const siblings = nodes.filter(node => node.parent === roots[0].parent);
  const indices = roots.map(node => siblings.indexOf(node));
  if (Math.max(...indices) - Math.min(...indices) + 1 !== roots.length) {
    throw new Error('Boolean shapes must be consecutive siblings to preserve layer order.');
  }
  if (roots.some(node => node.widthMode !== 'fixed' || node.heightMode !== 'fixed')) throw new Error('Boolean operations require fixed-size shapes.');
  if (roots.some(node => node.type === 'shape' && node.shapeKind === 'path' && !node.pathClosed)) {
    throw new Error('Close open paths before using them in a boolean operation.');
  }
  const minX = Math.min(...roots.map(node => bounds(node).left)), minY = Math.min(...roots.map(node => bounds(node).top));
  const maxX = Math.max(...roots.map(node => bounds(node).right)), maxY = Math.max(...roots.map(node => bounds(node).bottom));
  if (maxX - minX > 4000 || maxY - minY > 4000) throw new Error('The live compound would exceed the maximum size.');
  if (nodes.length >= 300) throw new Error('A face cannot contain more than 300 layers.');
  const compound = makeNode('compound', {
    name: operation[0].toUpperCase() + operation.slice(1), parent: roots[0].parent,
    x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY),
    fill: roots[0].fill, stroke: roots[0].stroke, strokeWidth: roots[0].strokeWidth, compoundOperation: operation,
  });
  const selectedIds = new Set(roots.map(node => node.id));
  const result = nodes.map(node => selectedIds.has(node.id)
    ? { ...node, parent: compound.id, x: node.x - minX, y: node.y - minY }
    : node);
  result.splice(Math.min(...roots.map(node => nodes.indexOf(node))), 0, compound);
  return { nodes: result, selected: [compound.id] };
}

export function uncombineLayers(nodes: DesignNode[], ids: string[]): { nodes: DesignNode[]; selected: string[] } {
  const compounds = selectedRoots(nodes, ids);
  if (!compounds.length || compounds.some(node => node.type !== 'compound')) throw new Error('Select one or more live compounds to uncombine.');
  if (compounds.some(compound => compound.widthMode !== 'fixed' || compound.heightMode !== 'fixed')) {
    throw new Error('Uncombine requires fixed-size compounds.');
  }
  const compoundIds = new Set(compounds.map(node => node.id));
  const children = nodes.filter(node => node.parent && compoundIds.has(node.parent));
  const byId = new Map(compounds.map(compound => [compound.id, compound]));
  const transformed = new Map(children.map(child => {
    const compound = byId.get(child.parent!)!;
    const angle = compound.rotation * Math.PI / 180;
    const x = child.x + child.width / 2 - compound.width / 2;
    const y = child.y + child.height / 2 - compound.height / 2;
    return [child.id, {
      ...child, parent: compound.parent,
      x: compound.x + compound.width / 2 + x * Math.cos(angle) - y * Math.sin(angle) - child.width / 2,
      y: compound.y + compound.height / 2 + x * Math.sin(angle) + y * Math.cos(angle) - child.height / 2,
      rotation: child.rotation + compound.rotation,
    }];
  }));
  const result: DesignNode[] = [];
  nodes.forEach(node => {
    if (compoundIds.has(node.id)) result.push(...children.filter(child => child.parent === node.id).map(child => transformed.get(child.id)!));
    else if (!transformed.has(node.id)) result.push(node);
  });
  return { nodes: result, selected: children.map(child => child.id) };
}

/**
 * Converts shapes and live boolean groups into editable pen paths ("flatten"). Shapes keep their exact outline as
 * points and Bézier handles. A boolean group becomes one path; when its result has several outlines (separate pieces
 * or holes) it stays a group of paths combined with Exclude, which reproduces the holes.
 */
export function convertToPaths(nodes: DesignNode[], ids: string[]): { nodes: DesignNode[]; selected: string[] } {
  const roots = selectedRoots(nodes, ids).filter(node => !(node.type === 'shape' && node.shapeKind === 'path'));
  if (!roots.length || roots.some(node => node.type !== 'shape' && node.type !== 'compound')) throw new Error('Select shapes or boolean groups to convert to paths.');
  let result = nodes;
  for (const root of roots) {
    const descendants = new Set<string>();
    for (let size = -1; size !== descendants.size;) {
      size = descendants.size;
      result.forEach(node => { if (node.parent && (node.parent === root.id || descendants.has(node.parent))) descendants.add(node.id); });
    }
    if (root.type === 'shape') {
      const converted = expandPathBounds({ ...root, shapeKind: 'path', points: shapeAsPath(root).map(point => ({ ...point })), pathClosed: true });
      result = result.map(node => node.id === root.id ? converted : node);
      continue;
    }
    const rings = compoundRings(result, root);
    if (!rings.length) throw new Error(`“${root.name}” has no outline to convert.`);
    const points = (ring: [number, number][]) => ring.map(([x, y]) => ({ x, y, inX: 0, inY: 0, outX: 0, outY: 0 }));
    let replacement: DesignNode[];
    if (rings.length === 1) {
      replacement = [fitPathBounds({ ...root, type: 'shape', shapeKind: 'path', points: points(rings[0]), pathClosed: true, layout: 'absolute' })];
    } else {
      replacement = [{ ...root, compoundOperation: 'exclude' }, ...rings.map((ring, index) => fitPathBounds(makeNode('shape', {
        name: `${root.name} outline ${index + 1}`, parent: root.id, x: 0, y: 0, width: root.width, height: root.height,
        shapeKind: 'path', points: points(ring), pathClosed: true, fill: root.fill, stroke: root.stroke, strokeWidth: root.strokeWidth,
      })))];
    }
    result = result.flatMap(node => node.id === root.id ? replacement : descendants.has(node.id) ? [] : [node]);
  }
  return { nodes: result, selected: roots.map(node => node.id) };
}

/**
 * Moves the selected layers forward, backward, to the front or to the back among their siblings (paint order is
 * array order, so the front is last). Each parent's children are reordered on their own and written back into the
 * same array slots, so other layers keep their places; selected descendants of selected layers move with them.
 */
export function reorderLayers(nodes: DesignNode[], ids: string[], move: OrderMove): DesignNode[] {
  const chosen = new Set(selectedRoots(nodes, ids).map(node => node.id));
  const next = [...nodes];
  for (const parent of new Set(nodes.filter(node => chosen.has(node.id)).map(node => node.parent))) {
    const slots = nodes.flatMap((node, index) => node.parent === parent ? [index] : []);
    const ordered = reorder(slots.map(index => nodes[index]), node => chosen.has(node.id), move);
    slots.forEach((slot, index) => { next[slot] = ordered[index]; });
  }
  return next;
}
