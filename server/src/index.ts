import { schema, table, t, SenderError } from 'spacetimedb/server';
import { commandSchema, projectSchema, validateProject } from '../../src/domain';
import { applyPlaygroundCommand, emptyPlaygroundHistory, playgroundHistorySchema, undoPlayground } from '../../src/playgroundHistory';
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
const db = schema({ room, membership, playground_history });
export default db;

// Keep the persisted room schema stable; additive history is a private table.
export const room_state = db.view({ public: true }, t.array(t.object('PlaygroundRoomSnapshot', {
  code: t.string(), state: t.string(), revision: t.u32(), undoCount: t.u32(), undoNotice: t.string(),
})), ctx => {
  const member = ctx.db.membership.identity.find(ctx.sender);
  if (!member) return [];
  const current = ctx.db.room.code.find(member.code);
  if (!current) return [];
  const saved = ctx.db.playground_history.code.find(member.code);
  const history = saved ? playgroundHistorySchema.parse(JSON.parse(saved.history)) : emptyPlaygroundHistory();
  return [{ ...current, undoCount: history.entries.length, undoNotice: history.notice }];
});

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
    const hasLocalSeats = project.players.some(p => p.owner === 'local');
    if (!existing) project.players = project.players.map(p => ({ ...p, owner: p.owner === 'local' ? identity : p.owner }));
    let player = project.players.find(p => p.owner === identity);
    if (!player) {
      if (project.players.some(p => p.id === args.playerId)) throw new Error('Player identifier is already in use.');
      player = {
        id: args.playerId, owner: identity, name: args.name, color: args.color,
        x: 600 + project.players.length * 120, y: 1000, rotation: 0,
      };
      project.players.push(player);
    }
    if (!existing && hasLocalSeats && args.name.trim()) player.name = args.name.trim();
    validateProject(project);
    const row = {
      code: args.code, state: JSON.stringify(project), revision: (existing?.revision ?? 0) + 1,
    };
    if (existing) ctx.db.room.code.update(row); else ctx.db.room.insert(row);
    const member = { identity: ctx.sender, code: args.code };
    if (ctx.db.membership.identity.find(ctx.sender)) ctx.db.membership.identity.update(member);
    else ctx.db.membership.insert(member);
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
    const actor = project.players.find(p => p.id === args.actor);
    if (!actor || actor.owner !== identity) throw new Error('Choose one of your own hotseat players.');
    const command = commandSchema.parse(JSON.parse(args.command));
    if (command.type === 'player') {
      const target = project.players.find(p => p.id === command.player.id);
      if (command.player.owner !== identity || (target && target.owner !== identity)) throw new Error('You can only edit your own seats.');
    }
    const previous = ctx.db.playground_history.code.find(member.code);
    const history = project !== parsed ? { entries: [], notice: migrationNotice }
      : previous ? playgroundHistorySchema.parse(JSON.parse(previous.history)) : emptyPlaygroundHistory();
    const next = applyPlaygroundCommand(project, history, command, actor.id);
    const historyRow = { code: member.code, history: JSON.stringify(next.history) };
    if (previous) ctx.db.playground_history.code.update(historyRow); else ctx.db.playground_history.insert(historyRow);
    ctx.db.room.code.update({
      ...current, state: JSON.stringify(next.project), revision: current.revision + 1,
    });
  } catch (error) {
    throw new SenderError(error instanceof Error ? error.message : 'Command failed.');
  }
});

// Reducer transactions serialize dispatch and undo against the same authoritative history.
// Any authenticated room member may undo the latest action, including another actor's.
export const undo = db.reducer({ actor: t.string() }, (ctx, args) => {
  try {
    const member = ctx.db.membership.identity.find(ctx.sender);
    if (!member) throw new Error('Join a room first.');
    const current = ctx.db.room.code.find(member.code);
    if (!current) throw new Error('Room no longer exists.');
    const parsed = projectSchema.parse(JSON.parse(current.state));
    const project = validateProject(upgradeLegacyArtworkProject(parsed));
    if (!project.players.some(player => player.id === args.actor && player.owner === ctx.sender.toHexString())) {
      throw new Error('Choose one of your own hotseat players.');
    }
    const previous = ctx.db.playground_history.code.find(member.code);
    const migrated = project !== parsed;
    const history = migrated ? { entries: [], notice: migrationNotice }
      : previous ? playgroundHistorySchema.parse(JSON.parse(previous.history)) : emptyPlaygroundHistory();
    const next = undoPlayground(project, history);
    if (!migrated && !next.undone && !history.entries.length) throw new Error(history.notice || 'Nothing to undo.');
    // An incompatible inverse clears history and publishes its explicit notice atomically.
    const historyRow = { code: member.code, history: JSON.stringify(next.history) };
    if (previous) ctx.db.playground_history.code.update(historyRow); else ctx.db.playground_history.insert(historyRow);
    ctx.db.room.code.update({
      ...current, state: JSON.stringify(next.project), revision: current.revision + 1,
    });
  } catch (error) {
    throw new SenderError(error instanceof Error ? error.message : 'Undo failed.');
  }
});
