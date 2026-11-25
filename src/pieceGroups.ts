import { groupAncestors, uid, type Command, type Instance, type PieceGroup, type Project } from './domain';

export type PieceTreeRow =
  | { kind: 'group'; key: string; group: PieceGroup; depth: number; ids: string[]; count: number; expanded: boolean }
  | { kind: 'piece'; key: string; item: Instance; depth: number; ids: string[]; count: number; expanded: boolean; member?: boolean };

/** Table pieces that represent a stack or a single piece (the visible top of each stack). */
function topPieces(p: Project) {
  const stacks = new Map<string, Instance[]>();
  for (const item of p.instances) if (item.stack && !item.holder) stacks.set(item.stack, [...stacks.get(item.stack) ?? [], item]);
  for (const members of stacks.values()) members.sort((a, b) => a.order - b.order);
  const tops = p.instances.filter(item => !item.holder && (!item.stack || (item.stackReversed ? stacks.get(item.stack)![0] : stacks.get(item.stack)!.at(-1)) === item));
  return { tops, stacks };
}

/** Every table piece in a group, including its subgroups. */
export function groupMembers(p: Project, groupId: string): string[] {
  const groups = p.groups ?? [];
  return p.instances.filter(item => !item.holder && item.group && groupAncestors(groups, item.group).includes(groupId)).map(item => item.id);
}

/**
 * The Pieces panel tree: groups and table pieces, topmost first at every level. Groups sort by their topmost piece;
 * expanded stacks list their members from the top down.
 */
export function pieceTree(p: Project, collapsedGroups: ReadonlySet<string>, expandedStacks: ReadonlySet<string>): PieceTreeRow[] {
  const groups = p.groups ?? [];
  const { tops, stacks } = topPieces(p);
  const kinds = new Map(p.components.map(component => [component.id, component.kind]));
  const index = new Map(p.instances.map((item, position) => [item.id, position]));
  const rank = (item: Instance) => kinds.get(item.componentId) === 'board' ? 0 : index.get(item.id)! + 2;
  const pieces = new Map<string | null, Instance[]>(), children = new Map<string | null, PieceGroup[]>();
  for (const item of tops) pieces.set(item.group ?? null, [...pieces.get(item.group ?? null) ?? [], item]);
  for (const group of groups) children.set(group.parent, [...children.get(group.parent) ?? [], group]);
  const groupRank = new Map<string, number>();
  const rankGroup = (group: PieceGroup, seen = new Set<string>()): number => {
    if (groupRank.has(group.id)) return groupRank.get(group.id)!;
    if (seen.has(group.id)) return -1;
    seen.add(group.id);
    const value = Math.max(-1, ...(pieces.get(group.id) ?? []).map(rank), ...(children.get(group.id) ?? []).map(child => rankGroup(child, seen)));
    groupRank.set(group.id, value);
    return value;
  };
  const rows: PieceTreeRow[] = [];
  const visit = (parent: string | null, depth: number, path: Set<string>) => {
    const entries = [
      ...(children.get(parent) ?? []).map(group => ({ rank: rankGroup(group), group, item: undefined })),
      ...(pieces.get(parent) ?? []).map(item => ({ rank: rank(item), group: undefined, item })),
    ].sort((a, b) => b.rank - a.rank || (a.group ? -1 : 1));
    for (const entry of entries) {
      if (entry.group) {
        if (path.has(entry.group.id)) continue;
        const ids = groupMembers(p, entry.group.id), expanded = !collapsedGroups.has(entry.group.id);
        rows.push({ kind: 'group', key: entry.group.id, group: entry.group, depth, ids, count: ids.length, expanded });
        if (expanded) visit(entry.group.id, depth + 1, new Set([...path, entry.group.id]));
      } else {
        const item = entry.item!, members = item.stack ? stacks.get(item.stack)! : [item];
        const key = item.stack ?? item.id, expanded = members.length > 1 && expandedStacks.has(key);
        rows.push({ kind: 'piece', key, item, depth, ids: members.map(member => member.id), count: members.length, expanded });
        if (expanded) for (const member of [...(item.stackReversed ? members : [...members].reverse())]) {
          rows.push({ kind: 'piece', key: member.id, item: member, depth: depth + 1, ids: [member.id], count: 1, expanded: false, member: true });
        }
      }
    }
  };
  visit(null, 0, new Set());
  return rows;
}

/** Groups whose every piece is selected, without their selected subgroups (the groups a selection "contains"). */
export function selectedGroups(p: Project, selected: string[]): PieceGroup[] {
  const chosen = new Set(selected), groups = p.groups ?? [];
  const full = groups.filter(group => { const ids = groupMembers(p, group.id); return ids.length > 0 && ids.every(id => chosen.has(id)); });
  const fullIds = new Set(full.map(group => group.id));
  return full.filter(group => !groupAncestors(groups, group.parent).some(id => fullIds.has(id)));
}

/**
 * What grouping the selection would create: the selected groups (picked in the Pieces panel, or with every piece
 * selected) plus the remaining selected table pieces (with their whole stacks), placed in the deepest group that
 * contains all of them.
 */
export function groupSelection(p: Project, selected: string[], pickedGroups: string[] = []): { ids: string[]; groups: string[]; parent: string | null } | undefined {
  const groups = p.groups ?? [];
  const all = [...selectedGroups(p, selected), ...groups.filter(group => pickedGroups.includes(group.id))];
  const allIds = new Set(all.map(group => group.id));
  // A group inside another chosen group moves with it.
  const units = [...new Map(all.map(group => [group.id, group])).values()].filter(group => !groupAncestors(groups, group.parent).some(id => allIds.has(id)));
  const chosen = new Set(selected), covered = new Set(units.flatMap(group => groupMembers(p, group.id)));
  const stacks = new Set(p.instances.filter(item => chosen.has(item.id) && item.stack && !item.holder).map(item => item.stack));
  const pieces = p.instances.filter(item => !item.holder && !covered.has(item.id) && (chosen.has(item.id) || (item.stack && stacks.has(item.stack))));
  if (!units.length && !pieces.length) return undefined;
  const chains = [...units.map(group => groupAncestors(groups, group.parent)), ...pieces.map(item => groupAncestors(groups, item.group))];
  const parent = chains[0].find(id => chains.every(chain => chain.includes(id))) ?? null;
  return { ids: pieces.map(item => item.id), groups: units.map(group => group.id), parent };
}

export function nextGroupName(p: Project) {
  const used = (p.groups ?? []).map(group => /^Group (\d+)$/.exec(group.name)?.[1]).filter(Boolean).map(Number);
  return `Group ${Math.max(0, ...used) + 1}`;
}

/** The createGroup command for the current selection, or undefined when nothing on the table is selected. */
export function createGroupCommand(p: Project, selected: string[], name = nextGroupName(p), pickedGroups: string[] = []): Extract<Command, { type: 'createGroup' }> | undefined {
  const plan = groupSelection(p, selected, pickedGroups);
  return plan && { type: 'createGroup', id: uid('group'), name, ...plan };
}

/**
 * Moves a row of the Pieces panel past the previous (direction -1, towards the front) or next row at its own level, as
 * an arrangePieces command: `units` are the pieces and groups that move with it. Undefined when there is no such row.
 */
export function nudgeCommand(p: Project, rows: PieceTreeRow[], row: PieceTreeRow, units: { ids: string[]; groups: string[] }, direction: -1 | 1): Extract<Command, { type: 'arrangePieces' }> | undefined {
  let neighbour: PieceTreeRow | undefined;
  for (let at = rows.indexOf(row) + direction; at >= 0 && at < rows.length; at += direction) {
    const candidate = rows[at];
    if (candidate.depth < row.depth) break;
    if (candidate.depth === row.depth && !(candidate.kind === 'piece' && candidate.member)) { neighbour = candidate; break; }
  }
  if (!neighbour) return undefined;
  const parent = neighbour.kind === 'group' ? neighbour.group.parent : neighbour.item.group ?? null;
  if (units.groups.some(id => groupAncestors(p.groups ?? [], parent).includes(id))) return undefined;
  return { type: 'arrangePieces', parent, ids: units.ids, groups: units.groups, target: neighbour.ids, position: direction < 0 ? 'above' : 'below' };
}
