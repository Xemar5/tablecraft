import { schema, table, t, SenderError } from 'spacetimedb/server';
import { applyCommand, commandSchema, projectSchema, validateProject } from '../../src/domain';

const room = table({ name: 'room' }, {
  code: t.string().primaryKey(), state: t.string(), revision: t.u32(),
});
const membership = table({ name: 'membership' }, {
  identity: t.identity().primaryKey(), code: t.string(),
});
const db = schema({ room, membership });
export default db;

export const room_state = db.view({ public: true }, t.array(room.rowType), ctx => {
  const member = ctx.db.membership.identity.find(ctx.sender);
  if (!member) return [];
  const current = ctx.db.room.code.find(member.code);
  return current ? [current] : [];
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
    const project = validateProject(projectSchema.parse(JSON.parse(existing?.state ?? args.initialState)));
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
    const row = { code: args.code, state: JSON.stringify(project), revision: (existing?.revision ?? 0) + 1 };
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
    const project = projectSchema.parse(JSON.parse(current.state));
    const identity = ctx.sender.toHexString();
    const actor = project.players.find(p => p.id === args.actor);
    if (!actor || actor.owner !== identity) throw new Error('Choose one of your own hotseat players.');
    const command = commandSchema.parse(JSON.parse(args.command));
    if (command.type === 'player') {
      const target = project.players.find(p => p.id === command.player.id);
      if (command.player.owner !== identity || (target && target.owner !== identity)) throw new Error('You can only edit your own seats.');
    }
    const next = applyCommand(project, command, actor.id);
    ctx.db.room.code.update({ ...current, state: JSON.stringify(next), revision: current.revision + 1 });
  } catch (error) {
    throw new SenderError(error instanceof Error ? error.message : 'Command failed.');
  }
});
