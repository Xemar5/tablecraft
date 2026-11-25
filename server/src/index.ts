import { schema, table, t, SenderError, ScheduleAt, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { applyCommand, commandSchema, nextSeatPlacement, projectSchema, validateProject, type Player, type Project } from '../../src/domain';
import { scriptsMention } from '../../src/scripting';
import { applyPlaygroundCommand, emptyPlaygroundHistory, playgroundHistorySchema, redoPlayground, undoPlayground } from '../../src/playgroundHistory';
import { upgradeLegacyArtworkProject } from '../../src/templates';

const migrationNotice = 'Undo history cleared because legacy component artwork was upgraded.';

const room = table({ name: 'room' }, {
  code: t.string().primaryKey(), state: t.string(), revision: t.u32(),
});
const membership = table({ name: 'membership' }, {
  identity: t.identity().primaryKey(), code: t.string(),
});
const playground_history = table({ name: 'playground_history' }, {
  code: t.string().primaryKey(), history: t.string(),
});
// The identity that created each room may override other players' seat settings.
const room_host = table({ name: 'room_host' }, {
  code: t.string().primaryKey(), identity: t.string(),
});
// Open connections per identity, so a seat is released only when its player's last tab or client disconnects.
const live_connection = table({ name: 'live_connection' }, {
  connection: t.string().primaryKey(), identity: t.string(),
});
// Rooms whose scripts define update(dt) get a repeating timer, so the server runs it for everyone (see room_update).
const room_tick = table({ name: 'room_tick' }, {
  scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt(), code: t.string().unique(), interval: t.f64(),
});
const db = schema({ room, membership, playground_history, room_host, live_connection, room_tick });
export default db;
type Ctx = ReducerCtx<InferSchema<typeof db>>;

/** Starts, restarts (when the interval changed) or stops a room's update timer to match its scripts. */
function syncUpdates(ctx: Ctx, code: string, project: Project) {
  const interval = scriptsMention(project.scripts, 'update') ? project.settings.updateInterval ?? 1 : 0;
  const existing = ctx.db.room_tick.code.find(code);
  if (existing?.interval === interval) return;
  if (existing) ctx.db.room_tick.code.delete(code);
  if (interval) ctx.db.room_tick.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(BigInt(Math.round(interval * 1_000_000))), code, interval });
}

// Keep the persisted room schema stable; additive history is a private table.
export const room_state = db.view({ public: true }, t.array(t.object('PlaygroundRoomSnapshot', {
  code: t.string(), state: t.string(), revision: t.u32(), undoCount: t.u32(), undoNotice: t.string(), host: t.string(), redoCount: t.u32(),
})), ctx => {
  const member = ctx.db.membership.identity.find(ctx.sender);
  if (!member) return [];
  const current = ctx.db.room.code.find(member.code);
  if (!current) return [];
  const saved = ctx.db.playground_history.code.find(member.code);
  const history = saved ? playgroundHistorySchema.parse(JSON.parse(saved.history)) : emptyPlaygroundHistory();
  const host = ctx.db.room_host.code.find(member.code)?.identity ?? '';
  return [{ ...current, undoCount: history.entries.length, undoNotice: history.notice, host, redoCount: history.redo?.length ?? 0 }];
});

/** Online seats are owned by at most one identity at a time; an empty owner marks a seat anyone may take. */
function claimSeat(seat: Player, identity: string, name: string) {
  seat.owner = identity;
  if (name.trim()) seat.name = name.trim().slice(0, 50);
}
const releaseSeats = (project: Project, identity: string) => {
  for (const seat of project.players) if (seat.owner === identity) seat.owner = '';
};

const designCommands = new Set(['component', 'addComponents', 'syncLinkedComponents', 'removeComponent', 'reorderComponent', 'rename']);
const seatCommands = new Set(['player', 'removePlayer', 'reorderPlayers', 'handSettings']);
const scriptCommands = new Set(['script', 'removeScript', 'reorderScripts', 'reloadScripts']);

export const join_room = db.reducer({
  code: t.string(), initialState: t.string(), playerId: t.string(), name: t.string(), color: t.string(),
}, (ctx, args) => {
  try {
    if (!/^[A-Z0-9-]{4,40}$/.test(args.code)) throw new Error('Room codes must contain 4-40 uppercase letters, digits or hyphens.');
    const identity = ctx.sender.toHexString();
    const existing = ctx.db.room.code.find(args.code);
    if (existing && args.initialState) throw new Error('Room code already exists. Join the room or choose a new code.');
    if (!existing && !args.initialState) throw new Error('Room not found. Check the code or host a new room.');
    const parsed = projectSchema.parse(JSON.parse(existing?.state ?? args.initialState));
    const project = validateProject(upgradeLegacyArtworkProject(parsed));
    if (existing && project !== parsed) {
      const historyRow = { code: args.code, history: JSON.stringify({ entries: [], notice: migrationNotice }) };
      if (ctx.db.playground_history.code.find(args.code)) ctx.db.playground_history.code.update(historyRow);
      else ctx.db.playground_history.insert(historyRow);
    }
    // A new room turns every local hotseat into an empty seat; the host keeps the seat they were playing (args.playerId).
    // Joining never creates a seat: guests start as viewers and take an empty seat with take_seat.
    if (!existing) {
      project.players = project.players.map(p => ({ ...p, owner: '' }));
      const seat = project.players.find(p => p.id === args.playerId);
      if (seat) claimSeat(seat, identity, args.name);
    }
    validateProject(project);
    const row = {
      code: args.code, state: JSON.stringify(project), revision: (existing?.revision ?? 0) + 1,
    };
    if (existing) ctx.db.room.code.update(row);
    else {
      ctx.db.room.insert(row);
      const hostRow = { code: args.code, identity };
      if (ctx.db.room_host.code.find(args.code)) ctx.db.room_host.code.update(hostRow); else ctx.db.room_host.insert(hostRow);
    }
    const member = { identity: ctx.sender, code: args.code };
    if (ctx.db.membership.identity.find(ctx.sender)) ctx.db.membership.identity.update(member);
    else ctx.db.membership.insert(member);
    syncUpdates(ctx, args.code, project);
  } catch (error) {
    throw new SenderError(error instanceof Error ? error.message : 'Unable to join room.');
  }
});

export const dispatch = db.reducer({ command: t.string(), actor: t.string() }, (ctx, args) => {
  try {
    const member = ctx.db.membership.identity.find(ctx.sender);
    if (!member) throw new Error('Join a room first.');
    const current = ctx.db.room.code.find(member.code);
    if (!current) throw new Error('Room no longer exists.');
    const parsed = projectSchema.parse(JSON.parse(current.state));
    const project = validateProject(upgradeLegacyArtworkProject(parsed));
    const identity = ctx.sender.toHexString();
    const actor = args.actor ? project.players.find(p => p.id === args.actor) : undefined;
    if (args.actor && (!actor || actor.owner !== identity)) throw new Error('Take this seat before acting as it.');
    const command = commandSchema.parse(JSON.parse(args.command));
    const host = ctx.db.room_host.code.find(member.code)?.identity === identity;
    // Viewers (no seat) only inspect the table. They may still edit designs, and the host may still manage seats and scripts.
    if (!actor && !designCommands.has(command.type) && !(host && (seatCommands.has(command.type) || scriptCommands.has(command.type)))) {
      throw new Error('Take a seat to play. Viewers can only inspect the table.');
    }
    // Scripts change for everyone, so the host decides who may edit them; updates come only from the server's timer.
    if (scriptCommands.has(command.type) && !host && !project.settings.scriptEditing) throw new Error('Only the host can change scripts in this room.');
    if (command.type === 'settings' && command.patch.scriptEditing !== undefined && !host) throw new Error('Only the host can choose who may edit scripts.');
    if (command.type === 'tick') throw new Error('In a live room, the server runs update(dt) by itself.');
    // Seats belong to their occupant; empty seats are shared, and the room host may change or remove any seat but never reassign one.
    const manages = (playerId: string) => {
      const owner = project.players.find(p => p.id === playerId)?.owner;
      return owner === identity || owner === '' || (host && owner !== undefined);
    };
    if (command.type === 'player') {
      const target = project.players.find(p => p.id === command.player.id);
      if (target ? !manages(target.id) || command.player.owner !== target.owner : command.player.owner !== '') throw new Error('You can only edit your own seat or empty seats.');
    }
    if (command.type === 'removePlayer' && !manages(command.playerId)) throw new Error('You can only remove your own seat or empty seats.');
    if (command.type === 'handSettings' && !manages(command.playerId)) throw new Error('You can only change your own hand settings.');
    const previous = ctx.db.playground_history.code.find(member.code);
    const history = project !== parsed ? { entries: [], notice: migrationNotice }
      : previous ? playgroundHistorySchema.parse(JSON.parse(previous.history)) : emptyPlaygroundHistory();
    const next = applyPlaygroundCommand(project, history, command, actor?.id);
    const historyRow = { code: member.code, history: JSON.stringify(next.history) };
    if (previous) ctx.db.playground_history.code.update(historyRow); else ctx.db.playground_history.insert(historyRow);
    ctx.db.room.code.update({
      ...current, state: JSON.stringify(next.project), revision: current.revision + 1,
    });
    if (scriptCommands.has(command.type) || command.type === 'settings') syncUpdates(ctx, member.code, next.project);
  } catch (error) {
    throw new SenderError(error instanceof Error ? error.message : 'Command failed.');
  }
});

/** Runs a room's update(dt) on its timer while anyone in the room is connected. */
export const room_update = db.reducer({ onSchedule: room_tick }, { tick: room_tick.rowType }, (ctx, { tick }) => {
  if (!ctx.sender.isEqual(ctx.databaseIdentity)) throw new SenderError('Only the server runs room updates.');
  const current = ctx.db.room.code.find(tick.code);
  if (!current) { ctx.db.room_tick.code.delete(tick.code); return; }
  const online = new Set([...ctx.db.live_connection.iter()].map(connection => connection.identity));
  if (![...ctx.db.membership.iter()].some(member => member.code === tick.code && online.has(member.identity.toHexString()))) return;
  try {
    const project = validateProject(projectSchema.parse(JSON.parse(current.state)));
    if (!scriptsMention(project.scripts, 'update')) { ctx.db.room_tick.code.delete(tick.code); return; }
    const next = applyCommand(project, { type: 'tick', dt: tick.interval, seed: Number(ctx.timestamp.microsSinceUnixEpoch % 2147483647n) });
    if (next !== project) ctx.db.room.code.update({ ...current, state: JSON.stringify(next), revision: current.revision + 1 });
  } catch { /* A room that can't be read (or a failing update, which logs itself) is left as it is. */ }
});

// Reducer transactions serialize dispatch, undo and redo against the same authoritative history.
// Any authenticated room member may undo the latest action, including another actor's, and redo it.
export const undo = db.reducer({ actor: t.string() }, (ctx, args) => historyStep(ctx, args.actor, 'undo'));
export const redo = db.reducer({ actor: t.string() }, (ctx, args) => historyStep(ctx, args.actor, 'redo'));

function historyStep(ctx: Ctx, actor: string, step: 'undo' | 'redo') {
  const args = { actor };
  try {
    const member = ctx.db.membership.identity.find(ctx.sender);
    if (!member) throw new Error('Join a room first.');
    const current = ctx.db.room.code.find(member.code);
    if (!current) throw new Error('Room no longer exists.');
    const parsed = projectSchema.parse(JSON.parse(current.state));
    const project = validateProject(upgradeLegacyArtworkProject(parsed));
    const identity = ctx.sender.toHexString();
    if (!project.players.some(player => player.id === args.actor && player.owner === identity)) {
      throw new Error(project.players.some(player => player.owner === identity) ? `${step === 'undo' ? 'Undo' : 'Redo'} as your own seat.` : `Take a seat to ${step}. Viewers can only inspect the table.`);
    }
    const previous = ctx.db.playground_history.code.find(member.code);
    const migrated = project !== parsed;
    const history = migrated ? { entries: [], notice: migrationNotice }
      : previous ? playgroundHistorySchema.parse(JSON.parse(previous.history)) : emptyPlaygroundHistory();
    const next = step === 'undo' ? undoPlayground(project, history) : redoPlayground(project, history);
    const done = 'undone' in next ? next.undone : next.redone;
    if (!migrated && !done && !(step === 'undo' ? history.entries.length : history.redo?.length)) throw new Error(history.notice || `Nothing to ${step}.`);
    // An incompatible inverse clears history and publishes its explicit notice atomically.
    const historyRow = { code: member.code, history: JSON.stringify(next.history) };
    if (previous) ctx.db.playground_history.code.update(historyRow); else ctx.db.playground_history.insert(historyRow);
    ctx.db.room.code.update({
      ...current, state: JSON.stringify(next.project), revision: current.revision + 1,
    });
  } catch (error) {
    throw new SenderError(error instanceof Error ? error.message : `${step === 'undo' ? 'Undo' : 'Redo'} failed.`);
  }
}

/**
 * Takes an empty seat (or creates one when `playerId` is new) and releases any seat the sender held, so each identity
 * occupies at most one seat. An empty `playerId` leaves the seat and watches as a viewer.
 */
export const take_seat = db.reducer({ playerId: t.string(), name: t.string(), color: t.string() }, (ctx, args) => {
  try {
    const member = ctx.db.membership.identity.find(ctx.sender);
    if (!member) throw new Error('Join a room first.');
    const current = ctx.db.room.code.find(member.code);
    if (!current) throw new Error('Room no longer exists.');
    const project = validateProject(upgradeLegacyArtworkProject(projectSchema.parse(JSON.parse(current.state))));
    const identity = ctx.sender.toHexString();
    const seat = project.players.find(p => p.id === args.playerId);
    if (seat?.owner === identity) return;
    if (seat && seat.owner) throw new Error(`${seat.name}'s seat is taken by another player.`);
    releaseSeats(project, identity);
    if (seat) claimSeat(seat, identity, args.name);
    else if (args.playerId) {
      project.players.push({
        id: args.playerId, owner: identity, name: args.name.trim().slice(0, 50) || `Player ${project.players.length + 1}`, color: args.color,
        ...nextSeatPlacement(project.players),
      });
    }
    validateProject(project);
    ctx.db.room.code.update({ ...current, state: JSON.stringify(project), revision: current.revision + 1 });
  } catch (error) {
    throw new SenderError(error instanceof Error ? error.message : 'Unable to take that seat.');
  }
});

export const on_connect = db.clientConnected(ctx => {
  if (ctx.connectionId) ctx.db.live_connection.insert({ connection: ctx.connectionId.toHexString(), identity: ctx.sender.toHexString() });
});

// Leaving or losing the last connection frees the seat for other players.
export const on_disconnect = db.clientDisconnected(ctx => {
  if (ctx.connectionId) ctx.db.live_connection.connection.delete(ctx.connectionId.toHexString());
  const identity = ctx.sender.toHexString();
  for (const other of ctx.db.live_connection.iter()) if (other.identity === identity) return;
  const member = ctx.db.membership.identity.find(ctx.sender);
  const current = member && ctx.db.room.code.find(member.code);
  if (!current) return;
  try {
    const project = projectSchema.parse(JSON.parse(current.state));
    if (!project.players.some(p => p.owner === identity)) return;
    releaseSeats(project, identity);
    ctx.db.room.code.update({ ...current, state: JSON.stringify(project), revision: current.revision + 1 });
  } catch { /* A room that cannot be parsed is left untouched. */ }
});