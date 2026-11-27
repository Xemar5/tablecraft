/**
 * Locks, order locks and hiding share one model, on pieces and on Pieces-panel groups: a switch for everyone and a list
 * of seats. With the switch off, it applies to the listed seats only; with it on, to everyone but the listed seats, so
 * seats that join later are covered too.
 *
 * - lock (`locked`, `lockPlayers`): the seats it applies to can't move, turn, flip or draw the piece.
 * - order lock (`orderLocked`, `orderLockPlayers`): they can't reorder or regroup it.
 * - hide (`hidden`, `hidePlayers`): they don't see it on the table (visual privacy only, like hidden hands).
 *
 * A piece is affected for a seat by its own setting or that of any group around it. Actions without a seat (scripts,
 * viewers) are affected only by settings switched on for everyone.
 */

export type AccessKind = 'lock' | 'orderLock' | 'hide';
export const ACCESS_KINDS: readonly AccessKind[] = ['lock', 'orderLock', 'hide'];
/** Each kind's switch and seat list fields. */
export const ACCESS_FIELDS = {
  lock: { flag: 'locked', players: 'lockPlayers' },
  orderLock: { flag: 'orderLocked', players: 'orderLockPlayers' },
  hide: { flag: 'hidden', players: 'hidePlayers' },
} as const;

/** Who a setting covers: everyone but `players` (`all`), or only `players`. */
export type Scope = { all: boolean; players: string[] };
export const NO_ONE: Scope = { all: false, players: [] };

/** The fields that hold access settings (a piece or a group). */
export type AccessHolder = {
  locked?: boolean; lockPlayers?: string[]; orderLocked?: boolean; orderLockPlayers?: string[]; hidden?: boolean; hidePlayers?: string[];
  /** Older saves: the seats a piece was hidden from (an include list), read as `hidePlayers` until it's next saved. */
  hiddenFrom?: string[];
};

/** A holder's setting of a kind. */
export function scopeOf(holder: AccessHolder, kind: AccessKind): Scope {
  const { flag, players } = ACCESS_FIELDS[kind];
  const all = !!holder[flag];
  const list = holder[players] ?? (kind === 'hide' && !all ? holder.hiddenFrom : undefined);
  return { all, players: list ?? [] };
}

/** Whether a setting covers a seat (no seat: only a setting for everyone does). */
export const appliesTo = (scope: Scope, seat?: string) => scope.all !== (!!seat && scope.players.includes(seat));
/** Whether a setting covers anyone at all. */
export const scopeActive = (scope: Scope) => scope.all || scope.players.length > 0;
/** The seats, of these, a setting covers. */
export const seatsCovered = (scope: Scope, seats: readonly string[]) => seats.filter(seat => appliesTo(scope, seat));

/** Sets a holder's setting of a kind in place: switch off is left out, and so is an empty list (and an old hiddenFrom). */
export function applyScope(holder: AccessHolder, kind: AccessKind, scope: Scope, keepFlag = false) {
  const { flag, players } = ACCESS_FIELDS[kind];
  if (scope.all || keepFlag) holder[flag] = scope.all; else delete holder[flag];
  const list = [...new Set(scope.players)];
  if (list.length) holder[players] = list; else delete holder[players];
  if (kind === 'hide') delete holder.hiddenFrom;
}

/** The setting after a seat's chip is flipped: whether the seat is covered changes; the switch for everyone stays. */
export function toggleSeat(scope: Scope, seat: string): Scope {
  const listed = scope.players.includes(seat);
  return { all: scope.all, players: listed ? scope.players.filter(id => id !== seat) : [...scope.players, seat] };
}

/** A group and the groups around it, innermost first. */
export function groupChain<G extends { id: string; parent: string | null }>(groups: readonly G[], id: string | null | undefined): G[] {
  const chain: G[] = [], seen = new Set<string>();
  for (let key = id; key && !seen.has(key);) {
    seen.add(key);
    const group = groups.find(item => item.id === key);
    if (!group) break;
    chain.push(group);
    key = group.parent;
  }
  return chain;
}

/** Whether a group's setting of a kind covers a seat: its own or that of a group around it. */
export const groupCovers = (groups: readonly (AccessHolder & { id: string; parent: string | null })[], id: string | null | undefined, kind: AccessKind, seat?: string) =>
  groupChain(groups, id).some(group => appliesTo(scopeOf(group, kind), seat));

/** Whether a piece's setting of a kind covers a seat: its own, or that of a group it's in. */
export const covers = (item: AccessHolder & { group?: string }, groups: readonly (AccessHolder & { id: string; parent: string | null })[], kind: AccessKind, seat?: string) =>
  appliesTo(scopeOf(item, kind), seat) || groupCovers(groups, item.group, kind, seat);
