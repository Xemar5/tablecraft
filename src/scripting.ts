/**
 * Table scripts: Lua 5.3 (Fengari, see scripts/vendor-fengari.mjs) run inside the shared command engine.
 *
 * A script run happens inside one command, so it is applied identically wherever the command is: in this browser
 * (offline, or as a live prediction) and on the SpaceTimeDB server, which decides for everyone. Every run starts a fresh
 * Lua state, loads the project's scripts in order and calls one function; nothing but `memory` and the table itself
 * survives between runs, so players joining later see exactly the same game. Runs are deterministic: `math.random`
 * draws from the command's seed, and there is no clock, file or network access.
 *
 * Everything a run does is one command, so a single undo reverts all of it. Changes made between
 * `game.beginNoUndo()` and `game.endNoUndo()` are also applied to the state undo goes back to (see undoBaseOf).
 */
import {
  lauxlib, lua, luaopen_base, luaopen_coroutine, luaopen_math, luaopen_string, luaopen_table, luaopen_utf8, to_jsstring, to_luastring,
  type LuaCFunction, type LuaState,
} from './vendor/fengari.js';
import {
  appendScriptLog, componentTags, memoryAt, memoryPathText, setMemory, stackFilterOf, stackMembers, visibleBack, visibleStackMembers,
  type Command, type Component, type Instance, type Memory, type MemoryPath, type MemoryValue, type Player, type Project, type Script, type ScriptLogEntry,
} from './domain';
import { nearestPlacedPoint, placedGrids, placedPointPosition, snapOf, type PlacedGrid } from './grids';
import { filterTags } from './tags';
import { popupSettingsSchema, type Popup } from './popups';
import { scopeOf, seatsCovered, type AccessKind } from './access';

type Apply = (project: Project, command: Command, actor?: string) => Project;
type LogLine = Omit<ScriptLogEntry, 'seq'>;

/** Instructions one run may execute before it is stopped (a runaway loop), roughly a few tenths of a second. */
export const SCRIPT_STEP_LIMIT = 5_000_000;

/** Functions the app calls by name; they aren't offered as button actions. */
export const SCRIPT_HANDLERS = [
  { name: 'onLoad', args: '()', doc: 'After the scripts are saved or reloaded. Set up memory here.' },
  { name: 'onUnload', args: '()', doc: 'Before the scripts are replaced or reloaded.' },
  { name: 'update', args: '(dt)', doc: 'Every few seconds while players are at the table (Table settings choose how often); dt is the seconds since the last update.' },
  { name: 'onMemoryChanged', args: '(changes, player)', doc: 'A player edited memory. Each change has path (such as "score.red"), keys, value and old.' },
  { name: 'onSpawn', args: '(pieces, player)', doc: 'Pieces were added to the table.' },
  { name: 'onDelete', args: '(pieces, player)', doc: 'Pieces were deleted (as they were just before).' },
  { name: 'onDraw', args: '(hand, pieces, player)', doc: 'Pieces went into a hand; hand is the seat holding them now.' },
  { name: 'onPlay', args: '(hand, pieces, player)', doc: 'Pieces left a hand for the table; hand is the seat that held them.' },
  { name: 'onStack', args: '(stack, pieces, player)', doc: 'Pieces joined a stack.' },
  { name: 'onMove', args: '(pieces, player)', doc: 'Table pieces moved.' },
  { name: 'onRotate', args: '(pieces, player)', doc: 'Table pieces turned.' },
  { name: 'onFlip', args: '(pieces, player)', doc: 'Table pieces turned over.' },
  { name: 'onRoll', args: '(pieces, player)', doc: 'Dice were rolled; piece.row is the face they landed on.' },
  { name: 'onShuffle', args: '(stack, player)', doc: 'A stack was shuffled.' },
  { name: 'onTurnEnd', args: '(previous, next)', doc: 'The turn passed from one seat to the next.' },
  { name: 'onTurnStart', args: '(player)', doc: 'A seat’s turn began.' },
  { name: 'onSnap', args: '(pieces, player)', doc: 'Table pieces snapped to grid points; piece.snap is { grid, point } for each.' },
] as const;
const HANDLER_NAMES = new Set<string>(SCRIPT_HANDLERS.map(handler => handler.name));
type HandlerName = typeof SCRIPT_HANDLERS[number]['name'];

/** The `game` library, for the script editor's completions and the README. */
export const SCRIPT_API = [
  { name: 'game.pieces', args: '(filter?)', doc: 'Every piece (table first, in table order, then hands). filter is a table such as { component = "Spirit cards", kind = "card", holder = false, stack = id, row = 2, locked = true } or a function(piece) returning true to keep it.' },
  { name: 'game.piece', args: '(id)', doc: 'One piece, or nil. Pieces are snapshots: read them again after changing them.' },
  { name: 'game.hand', args: '(player)', doc: 'The pieces in a seat’s hand, in order.' },
  { name: 'game.stackOf', args: '(idOrPiece)', doc: 'The stack a piece is in (or a stack by id): { id, pieces (bottom to top), top, count, x, y, persistent, filter }, or nil. filter.anyOf lists rules { has = {...}, lacks = {...} }.' },
  { name: 'game.stacks', args: '()', doc: 'Every stack on the table, including empty persistent ones.' },
  { name: 'game.components', args: '()', doc: 'Every component: { id, name, kind, variants, data, tags } (tags are its stack tags).' },
  { name: 'game.component', args: '(nameOrId)', doc: 'One component, or nil.' },
  { name: 'game.players', args: '()', doc: 'The seats in turn order: { id, name, color, seat, isTurn }.' },
  { name: 'game.player', args: '(idOrNameOrSeat)', doc: 'One seat, or nil.' },
  { name: 'game.currentPlayer', args: '()', doc: 'The seat whose turn it is, or nil.' },
  { name: 'game.actor', args: '()', doc: 'The seat whose action ran this script, or nil (updates, or a player watching).' },
  { name: 'game.settings', args: '()', doc: 'Table settings: { grid, snap, gridSize, hands, turns }.' },
  { name: 'game.move', args: '(pieces, x, y)', doc: 'Moves pieces (with their whole stacks) so the first lands at x, y; the others keep their places around it.' },
  { name: 'game.moveBy', args: '(pieces, dx, dy)', doc: 'Moves pieces (with their whole stacks) by dx, dy.' },
  { name: 'game.rotate', args: '(pieces, degrees)', doc: 'Turns pieces by degrees.' },
  { name: 'game.setRotation', args: '(pieces, degrees)', doc: 'Turns pieces to an angle.' },
  { name: 'game.flip', args: '(pieces)', doc: 'Turns pieces (or whole stacks) over.' },
  { name: 'game.setFaceUp', args: '(pieces, faceUp)', doc: 'Shows the front (true) or the back (false).' },
  { name: 'game.setScale', args: '(pieces, scale)', doc: 'Sizes pieces (0.1 to 5).' },
  { name: 'game.lock', args: '(pieces, locked?, players?)', doc: 'Locks pieces in place for everyone (or with false for no one), and players are the exceptions: with locked, seats that may still move them (seats that join later are locked out); with false, the only seats they’re locked for. Scripts follow locks for everyone: unlock pieces to move them.' },
  { name: 'game.unlock', args: '(pieces)', doc: 'Unlocks pieces for everyone.' },
  { name: 'game.lockOrder', args: '(pieces, locked?, players?)', doc: 'Keeps pieces in their places in the table order and their groups (or lets them go with false), with players as for game.lock; they can still move on the table.' },
  { name: 'game.hide', args: '(pieces, hidden?, players?)', doc: 'Hides table pieces (with their stacks) from everyone (or with false from no one), with players as the exceptions: with hidden, seats that still see them (seats that join later don’t); with false, the only seats they’re hidden from.' },
  { name: 'game.lockGroup', args: '(group, locked?, order?, players?)', doc: 'Locks a Pieces-panel group (by name or id), holding its pieces and subgroups in place, or unlocks it with false; with order true, it locks or unlocks the group’s place in the order instead. players are the exceptions, as for game.lock.' },
  { name: 'game.hideGroup', args: '(group, hidden?, players?)', doc: 'Hides a Pieces-panel group’s pieces (by name or id) from everyone, or with false from no one, with players as the exceptions, as for game.hide.' },
  { name: 'game.setRow', args: '(pieces, row)', doc: 'Shows variant, page or face number row (from 1).' },
  { name: 'game.roll', args: '(dice)', doc: 'Rolls dice and returns them; piece.row is the face rolled.' },
  { name: 'game.stack', args: '(pieces)', doc: 'Stacks pieces (the first at the bottom) and returns the stack id.' },
  { name: 'game.stackOnto', args: '(pieces, stack)', doc: 'Puts pieces on top of a stack or piece (or an empty persistent stack).' },
  { name: 'game.unstack', args: '(stack)', doc: 'Spreads a stack out.' },
  { name: 'game.grids', args: '()', doc: 'The grids, first (highest priority) first: those pieces carry (topmost piece first), then the table’s. { id, name, shape ("square", "hex" or "points"), visible, snap, size, sizeY, offsetX, offsetY, orientation, rotation, radius, tags }; a grid a piece carries also has piece and bounds { x, y, width, height }, its id is "piece id/grid id", and its offsets and bounds are in the component’s own coordinates.' },
  { name: 'game.gridPoint', args: '(grid, point)', doc: 'A grid point { grid, point, x, y, rotation, label } on the table, or nil. point is "col,row" (square), "q,r" (hex) or a point id (points grids); two numbers work too: game.gridPoint(grid, 2, 3).' },
  { name: 'game.gridPoints', args: '(grid)', doc: 'The points of a points grid, on the table (nil for square and hex grids).' },
  { name: 'game.nearestGridPoint', args: '(x, y, grid?)', doc: 'The grid point nearest to x, y: of one grid, or of any grid.' },
  { name: 'game.snapTo', args: '(pieces, grid, point)', doc: 'Puts pieces (with their stacks) on a grid point, turned to its rotation if it has one.' },
  { name: 'game.piecesAt', args: '(grid, point)', doc: 'The table pieces snapped to a grid point.' },
  { name: 'game.setStackFilter', args: '(stack, rules)', doc: 'Sets which pieces may join a stack: a list of rules { has = {"blue", "red"}, lacks = {"white"} }; a piece fits when it matches any rule (an empty list takes any piece).' },
  { name: 'game.shuffle', args: '(stack)', doc: 'Shuffles a stack.' },
  { name: 'game.draw', args: '(stack, player?, count?, faceUp?)', doc: 'Draws count pieces (1) from the top of a stack into a hand (the acting or current seat) and returns them.' },
  { name: 'game.give', args: '(pieces, player, faceUp?)', doc: 'Puts pieces from the table or another hand into a seat’s hand.' },
  { name: 'game.play', args: '(pieces, x, y)', doc: 'Puts held pieces on the table at x, y.' },
  { name: 'game.spawn', args: '(component, options?)', doc: 'Adds a piece and returns its id. options: { x, y, row, rotation, scale, faceUp, locked, count } (count returns a list of ids).' },
  { name: 'game.delete', args: '(pieces)', doc: 'Removes pieces.' },
  { name: 'game.ping', args: '(pieces, players?)', doc: 'Highlights pieces for every player (or only these seats), like pressing P (not an undo step).' },
  { name: 'game.hideFrom', args: '(pieces, players)', doc: 'Hides table pieces (with their stacks) from these seats only, the same as game.hide(pieces, false, players); an empty list {} shows them to everyone. piece.hiddenFrom lists the seats they are hidden from, and piece.hide their setting { everyone, players }.' },
  { name: 'game.toFront', args: '(pieces)', doc: 'Raises pieces above the others.' },
  { name: 'game.toBack', args: '(pieces)', doc: 'Lowers pieces below the others (boards stay underneath).' },
  { name: 'game.endTurn', args: '()', doc: 'Passes the turn to the next seat.' },
  { name: 'game.setTurn', args: '(player)', doc: 'Gives the turn to a seat.' },
  { name: 'game.announce', args: '(text, players?)', doc: 'Shows a message to everyone at the table, or only to these seats (a seat or a list of seats; an empty list reaches no one). The console lists it either way.' },
  { name: 'game.popup', args: '(popup, options?)', doc: 'Shows a popup component on screen and returns its id. options: { players, row, data = { field = "value" }, layout ("layout" or "fixed"), anchor ("center", "top", "top-left", ...), margin, fit ("none", "shrink" or "fill"), x, y, scale, blur, draggable, closable, dismiss ("each" or "all"), duration, closeOnAction }; settings left out come from the popup’s Behavior tab. players limits it to these seats; data fills its {{fields}}. Clicking one of its layers runs its script action with (popup, player, layer name).' },
  { name: 'game.closePopup', args: '(popup?, players?)', doc: 'Closes a popup (by id, or every open popup of a popup component), or all popups when nil: for everyone, or only for these seats.' },
  { name: 'game.popups', args: '()', doc: 'The open popups: { id, component, row, data, players (nil: everyone), closedBy, player (who opened it) }.' },
  { name: 'game.log', args: '(...)', doc: 'Writes to the script console, like print.' },
  { name: 'game.random', args: '(m?, n?)', doc: 'A random number, like math.random. Both draw from the action’s seed, so every device agrees.' },
  { name: 'game.beginNoUndo', args: '()', doc: 'Changes until game.endNoUndo() stay when players undo this action. Every begin needs its end before the function returns.' },
  { name: 'game.endNoUndo', args: '()', doc: 'Ends a game.beginNoUndo() section.' },
  { name: 'json.encode', args: '(value)', doc: 'Turns a value into JSON text.' },
  { name: 'json.decode', args: '(text)', doc: 'Reads JSON text into a value.' },
  { name: 'memory', args: '', doc: 'The shared memory table. Change it like any table; it is saved when the function returns. Lists are tables with keys 1..n.' },
] as const;

/** Global functions the scripts define (by a static reading of their source), for button actions and the editor's Run. */
export function scriptFunctions(scripts: Pick<Script, 'source'>[] | undefined): string[] {
  const names = new Set<string>();
  for (const script of scripts ?? []) {
    const source = stripComments(script.source);
    for (const match of source.matchAll(/^[ \t]*function[ \t]+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)[ \t]*\(/gm)) names.add(match[1]);
    for (const match of source.matchAll(/^[ \t]*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)[ \t]*=[ \t]*function\b/gm)) names.add(match[1]);
  }
  return [...names].filter(name => !HANDLER_NAMES.has(name)).sort((a, b) => a.localeCompare(b));
}

/** Whether the scripts mention a handler at all (a cheap test before starting Lua). */
export function scriptsMention(scripts: Pick<Script, 'source'>[] | undefined, name: string): boolean {
  const pattern = new RegExp(`\\b${name}\\b`);
  return !!scripts?.some(script => pattern.test(script.source));
}

function stripComments(source: string) {
  return source.replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, match => match.replace(/[^\n]/g, ' ')).replace(/--[^\n]*/g, '');
}

/** Compiles one script without running it, for the editor: returns `line: message` errors, or nothing when it parses. */
export function checkScriptSyntax(source: string, name = 'script'): { line: number; message: string } | undefined {
  const L = lauxlib.luaL_newstate();
  if (lauxlib.luaL_loadbufferx(L, to_luastring(source), null, to_luastring(`=${name}`), to_luastring('t')) === lua.LUA_OK) return undefined;
  const text = lua.lua_tojsstring(L, -1);
  const match = /^[^:]*:(\d+): ([\s\S]*)$/.exec(text);
  return match ? { line: Number(match[1]), message: match[2] } : { line: 1, message: text };
}

const undoBases = new WeakMap<Project, Project>();
/**
 * The state undo should restore after `project` was produced by a script run, when the run kept some changes out of
 * undo (game.beginNoUndo) or should not be undone at all (updates, onLoad). Undefined for ordinary commands.
 */
export function undoBaseOf(project: Project): Project | undefined {
  return undoBases.get(project);
}

type Event = { handler: HandlerName; args: unknown[] };

/** Applies a command with the project's scripts around it (see the module comment). */
export function runCommand(source: Project, command: Command, actor: string | undefined, apply: Apply): Project {
  switch (command.type) {
    case 'call':
      return run(source, source, actor, apply, command.seed, { kind: 'call', name: command.name, piece: command.piece, popup: command.popup, args: command.args });
    case 'tick':
      if (!scriptsMention(source.scripts, 'update')) return source;
      return run(source, source, undefined, apply, command.seed, { kind: 'hooks', events: [{ handler: 'update', args: [command.dt] }], keep: true });
    case 'script': case 'removeScript': case 'reorderScripts': case 'reloadScripts': {
      const seed = commandSeed(source, command);
      // The old scripts unload, then the new ones load; neither can stop the scripts from being saved.
      const unloaded = scriptsMention(source.scripts, 'onUnload')
        ? run(source, source, actor, apply, seed, { kind: 'hooks', events: [{ handler: 'onUnload', args: [] }], keep: true }) : source;
      const next = apply(unloaded, command, actor);
      const loaded = scriptsMention(next.scripts, 'onLoad')
        ? run(next, next, actor, apply, seed ^ 0x5bd1e995, { kind: 'hooks', events: [{ handler: 'onLoad', args: [] }], keep: true }) : next;
      undoBases.set(loaded, loaded);
      return loaded;
    }
    default: {
      const next = apply(source, command, actor);
      if (!source.scripts?.length || next === source) return next;
      const events = detectEvents(source, next, command, actor);
      if (!events.length) return next;
      return run(next, source, actor, apply, commandSeed(source, command), { kind: 'hooks', events });
    }
  }
}

/** A seed for runs whose command has none, the same on every device: it depends only on the command and the table. */
function commandSeed(project: Project, command: Command): number {
  let hash = 0x811c9dc5;
  const text = `${JSON.stringify(command)}|${project.instances.length}|${project.scriptLog?.at(-1)?.seq ?? 0}|${project.settings.turn}`;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

/** The events a command caused, for the handlers the scripts mention. */
function detectEvents(before: Project, after: Project, command: Command, actor?: string): Event[] {
  const wanted = (name: HandlerName) => scriptsMention(after.scripts, name);
  if (!SCRIPT_HANDLERS.some(handler => handler.name !== 'onLoad' && handler.name !== 'onUnload' && handler.name !== 'update' && wanted(handler.name))) return [];
  const player = actor ? playerInfo(after, actor) : undefined;
  const events: Event[] = [];
  const previous = new Map(before.instances.map(item => [item.id, item]));
  const current = new Map(after.instances.map(item => [item.id, item]));
  const pieces = (items: Instance[], project = after) => items.map(item => pieceInfo(project, item));
  const add = (handler: HandlerName, ...args: unknown[]) => { if (wanted(handler)) events.push({ handler, args }); };
  const spawned = after.instances.filter(item => !previous.has(item.id));
  const deleted = before.instances.filter(item => !current.has(item.id));
  if (spawned.length) add('onSpawn', pieces(spawned), player);
  if (deleted.length) add('onDelete', pieces(deleted, before), player);
  const kept = after.instances.filter(item => previous.has(item.id)).map(item => ({ item, was: previous.get(item.id)! }));
  const byHolder = (list: { item: Instance; was: Instance }[], holder: (entry: { item: Instance; was: Instance }) => string) => {
    const groups = new Map<string, Instance[]>();
    for (const entry of list) groups.set(holder(entry), [...groups.get(holder(entry)) ?? [], entry.item]);
    return groups;
  };
  const drawn = kept.filter(({ item, was }) => item.holder && item.holder !== was.holder);
  for (const [holder, items] of byHolder(drawn, entry => entry.item.holder!)) add('onDraw', playerInfo(after, holder), pieces(items), player);
  const played = kept.filter(({ item, was }) => !item.holder && was.holder);
  for (const [holder, items] of byHolder(played, entry => entry.was.holder!)) add('onPlay', playerInfo(after, holder), pieces(items), player);
  // A piece joined a stack when it wasn't stacked with the stack's bottom piece before.
  const joined = new Set<string>();
  const stacks = new Map<string, Instance[]>();
  for (const item of after.instances) if (item.stack) stacks.set(item.stack, [...stacks.get(item.stack) ?? [], item]);
  for (const [stack, members] of stacks) {
    const bottom = [...members].sort((a, b) => a.order - b.order)[0], wasBottom = previous.get(bottom.id);
    const arrivals = members.filter(item => {
      const was = previous.get(item.id);
      return was && (!was.stack || !wasBottom || item.id !== bottom.id && was.stack !== wasBottom.stack);
    });
    if (arrivals.length) { arrivals.forEach(item => joined.add(item.id)); add('onStack', stackInfo(after, stack), pieces(arrivals), player); }
  }
  const onTable = kept.filter(({ item, was }) => !item.holder && !was.holder);
  const moved = onTable.filter(({ item, was }) => (item.x !== was.x || item.y !== was.y) && !joined.has(item.id)).map(entry => entry.item);
  if (moved.length) add('onMove', pieces(moved), player);
  const turned = onTable.filter(({ item, was }) => item.rotation !== was.rotation).map(entry => entry.item);
  if (turned.length) add('onRotate', pieces(turned), player);
  const flipped = onTable.filter(({ item, was }) => visibleBack(item) !== visibleBack(was)).map(entry => entry.item);
  if (flipped.length) add('onFlip', pieces(flipped), player);
  const rolled = kept.filter(({ item, was }) => (item.rolls ?? 0) > (was.rolls ?? 0)).map(entry => entry.item);
  if (rolled.length) add('onRoll', pieces(rolled), player);
  if (wanted('onSnap')) {
    // Pieces that came to rest on a grid point they weren't on before (moving onto the same point again doesn't count).
    const key = (project: Project, item: Instance) => { const snap = snapOf(project, item, placedOn(project)); return snap ? `${snap.grid}|${snap.point}` : ''; };
    const snapped = after.instances.filter(item => {
      const was = previous.get(item.id), now = key(after, item);
      return now && (!was || (was.x !== item.x || was.y !== item.y || !!was.holder) && key(before, was) !== now);
    });
    if (snapped.length) add('onSnap', pieces(snapped), player);
  }
  const shuffled = new Set(kept.filter(({ item, was }) => item.stack && (item.shuffles ?? 0) > (was.shuffles ?? 0)).map(entry => entry.item.stack!));
  for (const stack of shuffled) add('onShuffle', stackInfo(after, stack), player);
  if (command.type === 'memory') {
    add('onMemoryChanged', command.changes.map(change => ({
      path: memoryPathText(change.path), keys: change.path, value: change.value, old: memoryAt(before.memory, change.path),
    })), player);
  }
  if (after.settings.turns && after.players.length && before.settings.turn !== after.settings.turn) {
    const from = before.players[before.settings.turn % Math.max(before.players.length, 1)];
    const to = after.players[after.settings.turn % after.players.length];
    add('onTurnEnd', from && playerInfo(after, from.id), to && playerInfo(after, to.id));
    if (to) add('onTurnStart', playerInfo(after, to.id));
  }
  return events;
}

type Request =
  | { kind: 'call'; name: string; piece?: string; popup?: string; args: MemoryValue[] }
  /** Calls handlers that exist, in order. `keep` keeps every change out of undo (updates, loading). */
  | { kind: 'hooks'; events: Event[]; keep?: boolean };

class ScriptError extends Error {}

/**
 * Runs Lua against `live`. `base` is what undo would restore (the table before the command); changes made outside undo
 * are applied to it too. A failing run keeps `live` as it was and logs the error.
 */
function run(live: Project, base: Project, actor: string | undefined, apply: Apply, seed: number, request: Request): Project {
  const start = live;
  const lines: LogLine[] = [];
  const failed = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const where = request.kind === 'call' ? `${request.name}` : request.events.map(event => event.handler).join(', ');
    return withLog(start, [...lines, { level: 'error', text: `${where}: ${message}`, ...(actor ? { player: actor } : {}) }]);
  };
  const state = { live, base, noUndo: request.kind === 'hooks' && request.keep ? 1 : 0, changed: false };
  let L: LuaState;
  try {
    L = openState(state, apply, actor, seed, lines);
    for (const script of start.scripts ?? []) {
      if (lauxlib.luaL_loadbufferx(L, to_luastring(script.source), null, to_luastring(`=${script.name}`), to_luastring('t')) !== lua.LUA_OK) throw new ScriptError(lua.lua_tojsstring(L, -1));
      protectedCall(L, 0);
    }
    const before = readMemory(L);
    if (request.kind === 'call') {
      if (!pushGlobal(L, request.name)) throw new ScriptError(`There is no function called ${request.name}.`);
      const piece = request.piece ? state.live.instances.find(item => item.id === request.piece) : undefined;
      if (request.piece && !piece) throw new ScriptError('That piece is no longer on the table.');
      const popup = request.popup ? state.live.popups?.find(item => item.id === request.popup) : undefined;
      if (request.popup && !popup) throw new ScriptError('That popup is no longer open.');
      pushValue(L, popup ? popupInfo(state.live, popup) : piece && pieceInfo(state.live, piece));
      pushValue(L, actor ? playerInfo(state.live, actor) : undefined);
      request.args.forEach(arg => pushValue(L, arg));
      protectedCall(L, 2 + request.args.length);
    } else {
      for (const event of request.events) {
        if (!pushGlobal(L, event.handler)) continue;
        event.args.forEach(arg => pushValue(L, arg));
        protectedCall(L, event.args.length);
      }
    }
    if (state.noUndo !== (request.kind === 'hooks' && request.keep ? 1 : 0)) throw new ScriptError('game.beginNoUndo() needs a matching game.endNoUndo() before the function returns.');
    const memory = readMemory(L);
    if (JSON.stringify(memory) !== JSON.stringify(before)) {
      state.changed = true;
      state.live = { ...state.live, memory };
      if (!memory) delete state.live.memory;
      if (state.noUndo) state.base = withMemoryChanges(state.base, before, memory);
    }
  } catch (error) {
    return failed(error);
  }
  if (!state.changed && !lines.length) return start;
  const result = withLog(state.live, lines);
  // Undo restores the base. When everything was kept, the base is the result, so undo has nothing to do here.
  if (state.noUndo || state.base !== base) undoBases.set(result, state.noUndo ? result : withLog(state.base, lines));
  return result;
}

function withLog(project: Project, lines: LogLine[]): Project {
  if (!lines.length) return project;
  return { ...project, scriptLog: appendScriptLog(project.scriptLog, lines) };
}

/** Applies the difference between two memories to a project's memory (for changes kept out of undo). */
function withMemoryChanges(project: Project, from: Memory | undefined, to: Memory | undefined): Project {
  let memory = project.memory;
  const visit = (path: MemoryPath, a: MemoryValue | undefined, b: MemoryValue | undefined) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    const tables = a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b);
    if (tables) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) visit([...path, key], (a as Record<string, MemoryValue>)[key], (b as Record<string, MemoryValue>)[key]);
      return;
    }
    try { memory = setMemory(memory, path, b); } catch { /* the path no longer fits the restored memory */ }
  };
  visit([], from, to);
  return memory === project.memory ? project : memory ? { ...project, memory } : (({ memory: _, ...rest }) => rest)(project);
}

function protectedCall(L: LuaState, args: number) {
  if (lua.lua_pcall(L, args, 0, 0) !== lua.LUA_OK) {
    if (lua.lua_type(L, -1) !== lua.LUA_TSTRING) lauxlib.luaL_tolstring(L, -1);
    throw new ScriptError(lua.lua_tojsstring(L, -1));
  }
}

/** Pushes a global (or a dotted path such as `ui.roll`) and returns whether it is a function; pushes nothing otherwise. */
function pushGlobal(L: LuaState, name: string): boolean {
  const [first, ...rest] = name.split('.');
  lua.lua_getglobal(L, to_luastring(first));
  for (const key of rest) {
    if (lua.lua_type(L, -1) !== lua.LUA_TTABLE) { lua.lua_pop(L, 1); return false; }
    lua.lua_getfield(L, -1, to_luastring(key));
    lua.lua_remove(L, -2);
  }
  if (lua.lua_type(L, -1) === lua.LUA_TFUNCTION) return true;
  lua.lua_pop(L, 1);
  return false;
}

// ---- Values between JavaScript and Lua ----

const ARRAY_KEY = to_luastring('tablecraft.array');

/** Pushes a JSON-like value. Lists become tables marked as lists, so empty ones stay lists in memory. */
function pushValue(L: LuaState, value: unknown, depth = 0): void {
  if (depth > 64) throw new ScriptError('Value nests too deeply.');
  if (value === undefined || value === null) lua.lua_pushnil(L);
  else if (typeof value === 'boolean') lua.lua_pushboolean(L, value);
  else if (typeof value === 'number') {
    // Fengari's integers are 32-bit, so larger whole numbers stay floats.
    if (Number.isInteger(value) && Math.abs(value) <= 0x7fffffff) lua.lua_pushinteger(L, value); else lua.lua_pushnumber(L, value);
  } else if (typeof value === 'string') lua.lua_pushstring(L, to_luastring(value));
  else if (Array.isArray(value)) {
    lua.lua_createtable(L, value.length, 0);
    value.forEach((item, index) => { pushValue(L, item, depth + 1); lua.lua_seti(L, -2, index + 1); });
    lua.lua_getfield(L, lua.LUA_REGISTRYINDEX, ARRAY_KEY);
    lua.lua_setmetatable(L, -2);
  } else if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    lua.lua_createtable(L, 0, entries.length);
    for (const [key, item] of entries) { pushValue(L, item, depth + 1); lua.lua_setfield(L, -2, to_luastring(key)); }
  } else throw new ScriptError(`Unable to pass a ${typeof value} to Lua.`);
}

/**
 * Reads a Lua value as JSON. Tables whose keys are exactly 1..n (or marked as lists) become lists; other tables become
 * objects with text keys. Functions and other Lua-only values can't be read.
 */
function readValue(L: LuaState, index: number, where: string, depth = 0): MemoryValue | undefined {
  const type = lua.lua_type(L, index);
  // Missing arguments have no type at all (LUA_TNONE, -1).
  if (type === lua.LUA_TNIL || type < 0) return undefined;
  if (type === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, index);
  if (type === lua.LUA_TNUMBER) {
    const number = lua.lua_tonumber(L, index);
    if (!Number.isFinite(number)) throw new ScriptError(`${where} is not a finite number.`);
    return number;
  }
  if (type === lua.LUA_TSTRING) return lua.lua_tojsstring(L, index);
  if (type !== lua.LUA_TTABLE) throw new ScriptError(`${where} can't hold a ${to_jsstring(lua.lua_typename(L, type))}.`);
  if (depth > 64) throw new ScriptError(`${where} nests more than 64 levels deep (or contains itself).`);
  const table = lua.lua_absindex(L, index);
  let marked = false;
  if (lua.lua_getmetatable(L, table)) {
    lua.lua_getfield(L, lua.LUA_REGISTRYINDEX, ARRAY_KEY);
    marked = lua.lua_rawequal(L, -1, -2);
    lua.lua_pop(L, 2);
  }
  const entries: [string | number, MemoryValue][] = [];
  lua.lua_pushnil(L);
  while (lua.lua_next(L, table)) {
    const keyType = lua.lua_type(L, -2);
    let key: string | number;
    if (keyType === lua.LUA_TNUMBER) key = lua.lua_tonumber(L, -2);
    else if (keyType === lua.LUA_TSTRING) key = lua.lua_tojsstring(L, -2);
    else { lua.lua_pop(L, 2); throw new ScriptError(`${where} has a key that is neither text nor a number.`); }
    let value: MemoryValue | undefined;
    try { value = readValue(L, -1, typeof key === 'number' ? `${where}[${key}]` : `${where}.${key}`, depth + 1); }
    catch (error) { lua.lua_pop(L, 2); throw error; }
    lua.lua_pop(L, 1);
    if (value !== undefined) entries.push([key, value]);
  }
  const list = entries.every(([key]) => typeof key === 'number' && Number.isInteger(key) && key >= 1 && key <= entries.length);
  if (entries.length ? list : marked) return entries.sort((a, b) => (a[0] as number) - (b[0] as number)).map(([, value]) => value);
  return Object.fromEntries(entries.map(([key, value]) => [String(key), value]));
}

/**
 * An argument that takes one value or a list of them, as a list. An empty Lua table `{}` has no keys to tell a list
 * from named values and reads as an empty table of named values, so it counts as an empty list here.
 */
function asList(value: MemoryValue): MemoryValue[] {
  if (Array.isArray(value)) return value;
  return value && typeof value === 'object' && !Object.keys(value).length ? [] : [value];
}

function readMemory(L: LuaState): Memory | undefined {
  lua.lua_getglobal(L, to_luastring('memory'));
  try {
    const value = readValue(L, -1, 'memory');
    if (value === undefined) return undefined;
    if (typeof value !== 'object' || Array.isArray(value)) {
      if (Array.isArray(value) && !value.length) return undefined;
      throw new ScriptError('memory must stay a table of named values.');
    }
    if (JSON.stringify(value).length > 512 * 1024) throw new ScriptError('memory can hold at most 512 KB of JSON.');
    return Object.keys(value).length ? value : undefined;
  } finally { lua.lua_pop(L, 1); }
}

// ---- What scripts see ----

type PieceInfo = Record<string, MemoryValue | undefined>;
function pieceInfo(project: Project, item: Instance): PieceInfo {
  const component = project.components.find(c => c.id === item.componentId);
  return {
    id: item.id, componentId: item.componentId, component: component?.name, kind: component?.kind,
    row: item.row + 1, data: component?.rows[item.row] ?? {},
    x: item.x, y: item.y, rotation: item.rotation, scale: item.scale,
    faceUp: !visibleBack(item), locked: item.locked, orderLocked: !!item.orderLocked, holder: item.holder ?? undefined, stack: item.stack ?? undefined,
    // Its own settings, each { everyone, players }, and the seats it's hidden from now.
    lock: accessInfo(item, 'lock'), orderLock: accessInfo(item, 'orderLock'), hide: accessInfo(item, 'hide'),
    hiddenFrom: seatsCovered(scopeOf(item, 'hide'), project.players.map(player => player.id)),
    group: item.group, snap: snapInfo(project, item),
  };
}
/** A lock, order lock or hiding as scripts see it: switched on for everyone or not, and its seat list. */
function accessInfo(holder: Parameters<typeof scopeOf>[0], kind: AccessKind): MemoryValue {
  const scope = scopeOf(holder, kind);
  return { everyone: scope.all, players: [...scope.players] };
}
/**
 * The grids on a table (see placedGrids), placed once per table state. A script reads many pieces' snaps (every piece
 * of game.pieces() and of an event), and each would otherwise place every grid the table's pieces carry again. Script
 * runs never change a project in place, so a project object always has the same grids.
 */
const placedCache = new WeakMap<Project, PlacedGrid[]>();
function placedOn(project: Project): PlacedGrid[] {
  let placed = placedCache.get(project);
  if (!placed) placedCache.set(project, placed = placedGrids(project));
  return placed;
}
/** The grid point a piece rests on: its grid's key, point id and label (points grids), and the piece carrying the grid. */
function snapInfo(project: Project, item: Instance): MemoryValue | undefined {
  const snap = snapOf(project, item, placedOn(project));
  const host = snap?.grid.includes('/') ? snap.grid.slice(0, snap.grid.indexOf('/')) : undefined;
  return snap && { grid: snap.grid, point: snap.point, ...(snap.label ? { label: snap.label } : {}), ...(host ? { piece: host } : {}) };
}
function gridInfo({ key, grid, host, bounds }: PlacedGrid): PieceInfo {
  const { name, shape, visible, snap, size, sizeY, offsetX, offsetY, orientation, rotation, radius } = grid;
  return { id: key, name, shape, visible, snap, size, sizeY: shape === 'square' ? sizeY ?? size : undefined, offsetX, offsetY,
    orientation: shape === 'hex' ? orientation ?? 'pointy' : undefined, rotation, radius: shape === 'points' ? radius ?? 50 : undefined, tags: filterTags(grid.filter),
    ...(host && bounds ? { piece: host, bounds: { ...bounds } } : {}) };
}
/** An open popup as scripts see it. */
function popupInfo(project: Project, popup: Popup): PieceInfo {
  return {
    id: popup.id, component: project.components.find(c => c.id === popup.componentId)?.name, row: popup.row + 1, data: { ...popup.data ?? {} },
    players: popup.to && [...popup.to], closedBy: [...popup.closed ?? []], player: popup.player,
  };
}
function playerInfo(project: Project, id: string): PieceInfo | undefined {
  const index = project.players.findIndex(player => player.id === id);
  if (index < 0) return undefined;
  const player = project.players[index];
  return { id: player.id, name: player.name, color: player.color, seat: index + 1, isTurn: project.settings.turns && project.settings.turn % project.players.length === index };
}
function stackInfo(project: Project, id: string): PieceInfo | undefined {
  const record = project.stacks?.find(stack => stack.id === id);
  const first = project.instances.find(item => item.stack === id);
  if (!first && !record) return undefined;
  const pieces = first ? visibleStackMembers(project, first).map(item => pieceInfo(project, item)) : [];
  return {
    id, pieces: pieces as MemoryValue[], top: pieces.at(-1) as MemoryValue | undefined, count: pieces.length,
    x: first?.x ?? record!.x, y: first?.y ?? record!.y, persistent: !!record, filter: stackFilterOf(project, id) as unknown as MemoryValue,
  };
}
function componentInfo(component: Component): PieceInfo {
  return { id: component.id, name: component.name, kind: component.kind, variants: Math.max(1, component.rows.length), data: component.rows as MemoryValue, tags: componentTags(component) };
}

// ---- The Lua state ----

type RunState = { live: Project; base: Project; noUndo: number; changed: boolean };

function openState(state: RunState, apply: Apply, actor: string | undefined, seed: number, lines: LogLine[]): LuaState {
  const L = lauxlib.luaL_newstate();
  const library = (name: string, open: LuaCFunction) => { lauxlib.luaL_requiref(L, to_luastring(name), open, 1); lua.lua_pop(L, 1); };
  library('_G', luaopen_base); library('table', luaopen_table); library('string', luaopen_string);
  library('math', luaopen_math); library('utf8', luaopen_utf8); library('coroutine', luaopen_coroutine);
  // JavaScript errors inside game functions become ordinary Lua errors that pcall can catch.
  lua.lua_atnativeerror(L, L => {
    const error = lua.lua_touserdata(L, -1);
    lua.lua_pushstring(L, to_luastring(error instanceof Error ? error.message : String(error)));
    return 1;
  });
  let steps = 0;
  lua.lua_sethook(L, () => {
    steps += 1000;
    if (steps > SCRIPT_STEP_LIMIT) throw new ScriptError('The script ran too long (an endless loop?) and was stopped.');
  }, lua.LUA_MASKCOUNT, 1000);
  lua.lua_createtable(L, 0, 1);
  lua.lua_setfield(L, lua.LUA_REGISTRYINDEX, ARRAY_KEY);
  for (const name of ['dofile', 'loadfile', 'load', 'loadstring', 'collectgarbage', 'require']) { lua.lua_pushnil(L); lua.lua_setglobal(L, to_luastring(name)); }

  // A small deterministic generator (mulberry32) seeded by the command.
  let rngState = seed >>> 0;
  const random = () => {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const newId = (prefix: string) => {
    for (;;) {
      const id = `${prefix}-${Math.floor(random() * 0x1000000).toString(16).padStart(6, '0')}${Math.floor(random() * 0x1000000).toString(16).padStart(6, '0')}`;
      if (!state.live.instances.some(item => item.id === id || item.stack === id) && !state.live.stacks?.some(stack => stack.id === id)) return id;
    }
  };

  const say = (level: LogLine['level'], text: string, to?: string[]) => lines.push({ level, text, ...(actor ? { player: actor } : {}), ...(to ? { to } : {}) });
  const act = (command: Command, as?: string) => {
    state.live = apply(state.live, command, as);
    state.changed = true;
    if (state.noUndo) {
      try { state.base = apply(state.base, command, as); }
      catch { /* it changes something this run created; undo removes that anyway */ }
    }
  };

  // Arguments: pieces by id, piece table, stack id or stack table, or lists of them.
  const arg = (L: LuaState, index: number, name: string) => readValue(L, index, name);
  const text = (value: MemoryValue | undefined, name: string) => {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.id === 'string') return value.id;
    throw new ScriptError(`${name} should be an id or a piece, stack or player table.`);
  };
  const number = (value: MemoryValue | undefined, name: string, fallback?: number) => {
    if (value === undefined && fallback !== undefined) return fallback;
    if (typeof value !== 'number') throw new ScriptError(`${name} should be a number.`);
    return value;
  };
  const pieces = (value: MemoryValue | undefined, name = 'pieces'): Instance[] => {
    const list = value === undefined ? [value] : asList(value);
    const found = new Map<string, Instance>();
    for (const entry of list) {
      const key = text(entry, name);
      const item = state.live.instances.find(i => i.id === key);
      const members = item ? [item] : state.live.instances.filter(i => i.stack === key);
      if (!members.length && !state.live.stacks?.some(stack => stack.id === key)) throw new ScriptError(`There is no piece or stack ${key}.`);
      members.forEach(member => found.set(member.id, member));
    }
    return [...found.values()];
  };
  const withStacks = (items: Instance[]) => [...new Map(items.flatMap(item => stackMembers(state.live, item)).map(item => [item.id, item])).values()];
  const stackPiece = (value: MemoryValue | undefined) => {
    const key = text(value, 'stack');
    const item = state.live.instances.find(i => i.id === key) ?? state.live.instances.find(i => i.stack === key);
    if (!item) throw new ScriptError(state.live.stacks?.some(stack => stack.id === key) ? 'That stack is empty.' : `There is no piece or stack ${key}.`);
    return item;
  };
  const player = (value: MemoryValue | undefined, name = 'player'): Player => {
    const players = state.live.players;
    const found = typeof value === 'number' ? players[value - 1]
      : players.find(p => p.id === (typeof value === 'string' ? value : text(value, name))) ?? (typeof value === 'string' ? players.find(p => p.name === value) : undefined);
    if (!found) throw new ScriptError(`There is no seat ${typeof value === 'object' ? text(value, name) : String(value)}.`);
    return found;
  };
  /** Seats from a seat or a list of them (ids, names, seat numbers or player tables); undefined (everyone) when absent. */
  const seats = (value: MemoryValue | undefined, name = 'players') => value === undefined ? undefined : [...new Set(asList(value).map(entry => player(entry, name).id))];
  /** A Pieces-panel group by id or name. */
  const groupArg = (value: MemoryValue | undefined) => {
    const key = text(value, 'group'), groups = state.live.groups ?? [];
    const group = groups.find(item => item.id === key) ?? groups.find(item => item.name === key);
    if (!group) throw new ScriptError(`There is no group ${key}.`);
    return group;
  };
  const component = (value: MemoryValue | undefined) => {
    const key = text(value, 'component');
    const found = state.live.components.find(c => c.id === key) ?? state.live.components.find(c => c.name === key);
    if (!found) throw new ScriptError(`There is no component ${key}.`);
    return found;
  };
  /** Groups pieces by who holds them, since only a hand's own seat may act on it. */
  const byHolder = (items: Instance[], each: (ids: string[], holder?: string) => void) => {
    const groups = new Map<string, Instance[]>();
    for (const item of items) groups.set(item.holder ?? '', [...groups.get(item.holder ?? '') ?? [], item]);
    for (const [holder, list] of groups) each(list.map(item => item.id), holder || undefined);
  };
  let noUndoMemory: Memory | undefined;
  // A grid by its key (a table grid's id, or "piece id/grid id"), a table grid's name, or "piece id/grid name".
  const findGrid = (value: MemoryValue | undefined) => {
    const key = text(value, 'grid'), grids = placedOn(state.live);
    const found = grids.find(grid => grid.key === key) ?? grids.find(grid => !grid.host && grid.grid.name === key)
      ?? grids.find(grid => grid.host && `${grid.host}/${grid.grid.name}` === key);
    if (!found) throw new ScriptError(`There is no grid ${key}.`);
    return found;
  };
  // A grid point: "2,3", a point id, a table such as { col = 2, row = 3 } / { q = 1, r = -2 } / a point table, or two numbers.
  const pointArg = (L: LuaState, index: number) => {
    const value = arg(L, index, 'point'), next = arg(L, index + 1, 'point');
    if (typeof value === 'number' && typeof next === 'number') return `${Math.round(value)},${Math.round(next)}`;
    if (typeof value === 'string') return value.replace(/\s+/g, '');
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (typeof value.point === 'string') return value.point;
      const a = value.col ?? value.q, b = value.row ?? value.r;
      if (typeof a === 'number' && typeof b === 'number') return `${Math.round(a)},${Math.round(b)}`;
    }
    throw new ScriptError('point should be "col,row", a point id, or a table such as { col = 2, row = 3 }.');
  };
  const turnPlayer = () => state.live.settings.turns && state.live.players.length ? state.live.players[state.live.settings.turn % state.live.players.length] : undefined;

  const functions: Record<string, (L: LuaState) => number> = {
    pieces: L => {
      const type = lua.lua_type(L, 1);
      const order = [...state.live.instances.filter(i => !i.holder), ...state.live.instances.filter(i => i.holder).sort((a, b) => a.order - b.order)];
      let list = order.map(item => pieceInfo(state.live, item));
      if (type === lua.LUA_TTABLE) {
        const filter = arg(L, 1, 'filter') as Record<string, MemoryValue>;
        list = list.filter(piece => Object.entries(filter).every(([key, wanted]) => {
          if (key === 'component') return piece.component === wanted || piece.componentId === wanted;
          if (key === 'holder' && typeof wanted === 'boolean') return !!piece.holder === wanted;
          if (key === 'holder' && wanted && typeof wanted === 'object') return piece.holder === text(wanted, 'holder');
          return piece[key] === wanted;
        }));
      } else if (type === lua.LUA_TFUNCTION) {
        list = list.filter(piece => {
          lua.lua_pushvalue(L, 1); pushValue(L, piece); lua.lua_call(L, 1, 1);
          const keep = lua.lua_toboolean(L, -1); lua.lua_pop(L, 1);
          return keep;
        });
      } else if (type !== lua.LUA_TNIL && type >= 0) throw new ScriptError('game.pieces takes a filter table or function.');
      pushValue(L, list);
      return 1;
    },
    piece: L => { const key = text(arg(L, 1, 'id'), 'id'); const item = state.live.instances.find(i => i.id === key); pushValue(L, item && pieceInfo(state.live, item)); return 1; },
    hand: L => {
      const seat = player(arg(L, 1, 'player'));
      pushValue(L, state.live.instances.filter(i => i.holder === seat.id).sort((a, b) => a.order - b.order).map(item => pieceInfo(state.live, item)));
      return 1;
    },
    stackOf: L => {
      const key = text(arg(L, 1, 'piece'), 'piece');
      const item = state.live.instances.find(i => i.id === key);
      pushValue(L, item ? item.stack ? stackInfo(state.live, item.stack) : undefined : stackInfo(state.live, key));
      return 1;
    },
    stacks: L => {
      const ids = new Set([...state.live.instances.flatMap(i => i.stack ? [i.stack] : []), ...(state.live.stacks ?? []).map(stack => stack.id)]);
      pushValue(L, [...ids].map(id => stackInfo(state.live, id)));
      return 1;
    },
    components: L => { pushValue(L, state.live.components.filter(c => c.kind !== 'texture' && c.kind !== 'font').map(componentInfo)); return 1; },
    component: L => {
      const key = text(arg(L, 1, 'component'), 'component');
      const found = state.live.components.find(c => c.id === key) ?? state.live.components.find(c => c.name === key);
      pushValue(L, found && componentInfo(found));
      return 1;
    },
    players: L => { pushValue(L, state.live.players.map(p => playerInfo(state.live, p.id))); return 1; },
    player: L => {
      const value = arg(L, 1, 'player');
      const players = state.live.players;
      const found = typeof value === 'number' ? players[value - 1] : players.find(p => p.id === value || p.name === value || (value && typeof value === 'object' && !Array.isArray(value) && p.id === value.id));
      pushValue(L, found && playerInfo(state.live, found.id));
      return 1;
    },
    currentPlayer: L => { const seat = turnPlayer(); pushValue(L, seat && playerInfo(state.live, seat.id)); return 1; },
    actor: L => { pushValue(L, actor ? playerInfo(state.live, actor) : undefined); return 1; },
    settings: L => {
      const { grid, snap, gridSize, hands, turns } = state.live.settings;
      pushValue(L, { grid, snap, gridSize, hands, turns });
      return 1;
    },
    move: L => {
      const items = withStacks(pieces(arg(L, 1, 'pieces'))), x = number(arg(L, 2, 'x'), 'x'), y = number(arg(L, 3, 'y'), 'y');
      if (!items.length) return 0;
      const anchor = pieces(arg(L, 1, 'pieces'))[0];
      act({ type: 'transform', ids: items.map(i => i.id), positions: items.map(i => ({ id: i.id, x: i.x + x - anchor.x, y: i.y + y - anchor.y })) });
      return 0;
    },
    moveBy: L => {
      const items = withStacks(pieces(arg(L, 1, 'pieces')));
      if (items.length) act({ type: 'transform', ids: items.map(i => i.id), dx: number(arg(L, 2, 'dx'), 'dx'), dy: number(arg(L, 3, 'dy'), 'dy') });
      return 0;
    },
    rotate: L => {
      const items = withStacks(pieces(arg(L, 1, 'pieces')));
      if (items.length) act({ type: 'transform', ids: items.map(i => i.id), rotation: number(arg(L, 2, 'degrees'), 'degrees') });
      return 0;
    },
    setRotation: L => {
      const items = withStacks(pieces(arg(L, 1, 'pieces'))), degrees = number(arg(L, 2, 'degrees'), 'degrees');
      if (items.length) act({ type: 'move', ids: items.map(i => i.id), patch: { rotation: ((degrees % 360) + 360) % 360 } });
      return 0;
    },
    flip: L => {
      const items = withStacks(pieces(arg(L, 1, 'pieces')));
      if (items.length) act({ type: 'transform', ids: items.map(i => i.id), flip: true });
      return 0;
    },
    setFaceUp: L => {
      const up = arg(L, 2, 'faceUp') !== false;
      const items = pieces(arg(L, 1, 'pieces')).filter(i => visibleBack(i) === up);
      // A piece in a reversed stack shows its back when it isn't flipped.
      for (const flipped of [true, false]) {
        const ids = items.filter(i => (!!(i.stack && i.stackReversed) ? up : !up) === flipped).map(i => i.id);
        if (ids.length) act({ type: 'move', ids, patch: { flipped } });
      }
      return 0;
    },
    setScale: L => {
      const items = pieces(arg(L, 1, 'pieces'));
      if (items.length) act({ type: 'move', ids: items.map(i => i.id), patch: { scale: number(arg(L, 2, 'scale'), 'scale') } });
      return 0;
    },
    lock: L => {
      const items = pieces(arg(L, 1, 'pieces')), players = seats(arg(L, 3, 'players')) ?? [];
      if (items.length) act({ type: 'move', ids: items.map(i => i.id), patch: { locked: arg(L, 2, 'locked') !== false, lockPlayers: players } });
      return 0;
    },
    unlock: L => {
      const items = pieces(arg(L, 1, 'pieces'));
      if (items.length) act({ type: 'move', ids: items.map(i => i.id), patch: { locked: false, lockPlayers: [] } });
      return 0;
    },
    lockOrder: L => {
      const items = pieces(arg(L, 1, 'pieces')), players = seats(arg(L, 3, 'players')) ?? [];
      if (items.length) act({ type: 'move', ids: items.map(i => i.id), patch: { orderLocked: arg(L, 2, 'locked') !== false, orderLockPlayers: players } });
      return 0;
    },
    hide: L => {
      const items = pieces(arg(L, 1, 'pieces')).filter(i => !i.holder), players = seats(arg(L, 3, 'players')) ?? [];
      if (items.length) act({ type: 'hide', ids: items.map(i => i.id), hidden: arg(L, 2, 'hidden') !== false, players });
      return 0;
    },
    lockGroup: L => {
      const group = groupArg(arg(L, 1, 'group'));
      act({ type: 'lockGroups', ids: [group.id], locked: arg(L, 2, 'locked') !== false, ...arg(L, 3, 'order') === true ? { order: true } : {}, players: seats(arg(L, 4, 'players')) ?? [] });
      return 0;
    },
    hideGroup: L => {
      const group = groupArg(arg(L, 1, 'group'));
      act({ type: 'lockGroups', ids: [group.id], locked: arg(L, 2, 'hidden') !== false, hide: true, players: seats(arg(L, 3, 'players')) ?? [] });
      return 0;
    },
    setRow: L => {
      const items = pieces(arg(L, 1, 'pieces')), row = number(arg(L, 2, 'row'), 'row');
      if (!Number.isInteger(row) || row < 1) throw new ScriptError('row counts from 1.');
      if (items.length) act({ type: 'setRow', ids: items.map(i => i.id), row: row - 1 });
      return 0;
    },
    roll: L => {
      const items = pieces(arg(L, 1, 'dice'));
      if (items.length) act({ type: 'roll', ids: items.map(i => i.id), seed: Math.floor(random() * 0x7fffffff) });
      pushValue(L, items.map(item => pieceInfo(state.live, state.live.instances.find(i => i.id === item.id)!)));
      return 1;
    },
    stack: L => {
      const items = withStacks(pieces(arg(L, 1, 'pieces'))), stackId = newId('stack');
      act({ type: 'stack', ids: items.map(i => i.id), stackId });
      pushValue(L, state.live.instances.find(i => i.id === items[0].id)?.stack ?? stackId);
      return 1;
    },
    stackOnto: L => {
      const items = withStacks(pieces(arg(L, 1, 'pieces'))), target = text(arg(L, 2, 'stack'), 'stack');
      if (!items.length) return 0;
      if (state.live.stacks?.some(stack => stack.id === target)) act({ type: 'dropIntoStack', ids: items.map(i => i.id), stackId: target });
      else act({ type: 'dropStack', ids: items.map(i => i.id), targetId: stackPiece(target).id, stackId: newId('stack') });
      return 0;
    },
    unstack: L => { act({ type: 'unstack', id: stackPiece(arg(L, 1, 'stack')).id }); return 0; },
    grids: L => { pushValue(L, placedOn(state.live).map(gridInfo)); return 1; },
    gridPoint: L => {
      const placed = findGrid(arg(L, 1, 'grid')), point = pointArg(L, 2);
      const at = placedPointPosition(placed, point);
      pushValue(L, at && { grid: placed.key, point, ...at, label: placed.grid.points?.find(item => item.id === point)?.label });
      return 1;
    },
    gridPoints: L => {
      const placed = findGrid(arg(L, 1, 'grid')), { grid } = placed;
      pushValue(L, grid.shape === 'points' ? (grid.points ?? []).flatMap(point => {
        const at = placedPointPosition(placed, point.id);
        return at ? [{ grid: placed.key, point: point.id, ...at, label: point.label }] : [];
      }) : undefined);
      return 1;
    },
    nearestGridPoint: L => {
      const x = number(arg(L, 1, 'x'), 'x'), y = number(arg(L, 2, 'y'), 'y'), only = arg(L, 3, 'grid');
      const candidates = (only === undefined ? placedOn(state.live) : [findGrid(only)]).map(grid => nearestPlacedPoint(grid, x, y)).filter(found => !!found);
      const best = candidates.sort((a, b) => a!.distance - b!.distance)[0];
      pushValue(L, best && { grid: best.grid, point: best.point, x: best.x, y: best.y, rotation: best.rotation, distance: best.distance });
      return 1;
    },
    snapTo: L => {
      const items = pieces(arg(L, 1, 'pieces')), grid = findGrid(arg(L, 2, 'grid')), point = pointArg(L, 3);
      if (items.length) act({ type: 'snapTo', ids: items.map(i => i.id), grid: grid.key, point });
      return 0;
    },
    piecesAt: L => {
      const grid = findGrid(arg(L, 1, 'grid')), point = pointArg(L, 2), placed = placedOn(state.live);
      pushValue(L, state.live.instances.filter(item => { const snap = snapOf(state.live, item, placed); return snap?.grid === grid.key && snap.point === point; }).map(item => pieceInfo(state.live, item)));
      return 1;
    },
    setStackFilter: L => {
      const value = arg(L, 1, 'stack'), key = text(value, 'stack');
      const stackId = state.live.stacks?.some(stack => stack.id === key) || state.live.instances.some(i => i.stack === key) ? key : stackPiece(value).stack;
      if (!stackId) throw new ScriptError('That piece is not in a stack.');
      const given = arg(L, 2, 'rules') ?? [], rules = asList(given);
      if (!Array.isArray(given) && rules.length) throw new ScriptError('game.setStackFilter takes a list of rules such as { { has = { "blue" } } }.');
      const list = (rule: MemoryValue, key: string) => asList((rule as Record<string, MemoryValue>)[key] ?? []).map(String);
      act({ type: 'setStackFilter', stackId, filter: { anyOf: rules.map(rule => ({ has: list(rule, 'has'), lacks: list(rule, 'lacks') })) } });
      return 0;
    },
    shuffle: L => { act({ type: 'shuffle', id: stackPiece(arg(L, 1, 'stack')).id, seed: Math.floor(random() * 0x7fffffff) }); return 0; },
    draw: L => {
      const from = stackPiece(arg(L, 1, 'stack')), target = arg(L, 2, 'player');
      const seat = target === undefined ? state.live.players.find(p => p.id === actor) ?? turnPlayer() : player(target);
      if (!seat) throw new ScriptError('Choose a seat to draw for.');
      const count = number(arg(L, 3, 'count'), 'count', 1), faceUp = arg(L, 4, 'faceUp');
      const before = new Set(state.live.instances.filter(i => i.holder === seat.id).map(i => i.id));
      act({ type: 'drawMany', id: from.id, playerId: seat.id, count: Math.max(1, Math.floor(count)), ...(faceUp === false ? { faceUp: false } : {}) });
      pushValue(L, state.live.instances.filter(i => i.holder === seat.id && !before.has(i.id)).sort((a, b) => a.order - b.order).map(item => pieceInfo(state.live, item)));
      return 1;
    },
    give: L => {
      const items = pieces(arg(L, 1, 'pieces')), seat = player(arg(L, 2, 'player')), faceUp = arg(L, 3, 'faceUp');
      if (items.length) act({ type: 'transferToHand', ids: items.map(i => i.id), playerId: seat.id, ...(faceUp === false ? { faceUp: false } : {}) }, seat.id);
      return 0;
    },
    play: L => {
      const items = pieces(arg(L, 1, 'pieces')), x = number(arg(L, 2, 'x'), 'x'), y = number(arg(L, 3, 'y'), 'y');
      byHolder(items, (ids, holder) => {
        if (!holder) throw new ScriptError('game.play puts held pieces on the table; use game.move for table pieces.');
        act({ type: 'releaseMany', ids, x, y }, holder);
      });
      return 0;
    },
    spawn: L => {
      const comp = component(arg(L, 1, 'component'));
      const options = (arg(L, 2, 'options') ?? {}) as Record<string, MemoryValue>;
      if (typeof options !== 'object' || Array.isArray(options)) throw new ScriptError('game.spawn options should be a table.');
      const count = Math.max(1, Math.min(1000, Math.floor(number(options.count, 'count', 1))));
      const row = number(options.row, 'row', 1) - 1;
      if (!Number.isInteger(row) || row < 0 || row >= Math.max(1, comp.rows.length)) throw new ScriptError(`${comp.name} has no variant ${row + 1}.`);
      const ids = Array.from({ length: count }, () => newId('piece'));
      act({ type: 'spawn', instances: ids.map(id => ({
        id, componentId: comp.id, row, x: number(options.x, 'x', 700), y: number(options.y, 'y', 450),
        rotation: number(options.rotation, 'rotation', 0), scale: number(options.scale, 'scale', 1),
        flipped: options.faceUp === false && comp.flippable, holder: null, stack: null, order: 0, locked: options.locked === true,
      })) });
      pushValue(L, count === 1 && options.count === undefined ? ids[0] : ids);
      return 1;
    },
    delete: L => {
      byHolder(pieces(arg(L, 1, 'pieces')), (ids, holder) => act({ type: 'delete', ids }, holder));
      return 0;
    },
    ping: L => {
      const items = pieces(arg(L, 1, 'pieces')), to = seats(arg(L, 2, 'players'));
      if (items.length && to?.length !== 0) act({ type: 'ping', ids: items.map(i => i.id), ...to ? { players: to } : {} }, actor);
      return 0;
    },
    hideFrom: L => {
      const items = pieces(arg(L, 1, 'pieces')).filter(i => !i.holder), players = seats(arg(L, 2, 'players')) ?? [];
      if (items.length) act({ type: 'hide', ids: items.map(i => i.id), hidden: false, players });
      return 0;
    },
    toFront: L => { const items = pieces(arg(L, 1, 'pieces')).filter(i => !i.holder); if (items.length) act({ type: 'zOrder', ids: items.map(i => i.id), move: 'front' }); return 0; },
    toBack: L => { const items = pieces(arg(L, 1, 'pieces')).filter(i => !i.holder); if (items.length) act({ type: 'zOrder', ids: items.map(i => i.id), move: 'back' }); return 0; },
    endTurn: () => { act({ type: 'endTurn' }); return 0; },
    setTurn: L => {
      const seat = player(arg(L, 1, 'player'));
      act({ type: 'settings', patch: { turn: state.live.players.indexOf(seat) } });
      return 0;
    },
    announce: L => { say('announce', String(arg(L, 1, 'text') ?? ''), seats(arg(L, 2, 'players'))); state.changed = true; return 0; },
    popup: L => {
      const comp = component(arg(L, 1, 'popup'));
      if (comp.kind !== 'popup') throw new ScriptError(`${comp.name} is not a popup component (its type is ${comp.kind}).`);
      const options = (arg(L, 2, 'options') ?? {}) as Record<string, MemoryValue>;
      if (typeof options !== 'object' || Array.isArray(options)) throw new ScriptError('game.popup options should be a table.');
      const to = seats(options.players);
      // An empty list of players shows it to no one.
      if (to && !to.length) { pushValue(L, undefined); return 1; }
      const row = number(options.row, 'row', 1) - 1;
      if (!Number.isInteger(row) || row < 0 || row >= Math.max(1, comp.rows.length)) throw new ScriptError(`${comp.name} has no data row ${row + 1}.`);
      const fields = options.data ?? {};
      if (typeof fields !== 'object' || Array.isArray(fields)) throw new ScriptError('game.popup data should be a table of field values.');
      const data = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)]));
      const picked = Object.fromEntries(Object.keys(popupSettingsSchema.shape).filter(key => options[key] !== undefined).map(key => [key, options[key]]));
      const parsed = popupSettingsSchema.safeParse(picked);
      if (!parsed.success) throw new ScriptError(`game.popup ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
      let id = newId('popup');
      while (state.live.popups?.some(popup => popup.id === id)) id = newId('popup');
      act({ type: 'openPopup', popup: { id, componentId: comp.id, row, ...Object.keys(data).length ? { data } : {}, ...to ? { to } : {},
        ...Object.keys(parsed.data).length ? { settings: parsed.data } : {}, ...actor ? { player: actor } : {} } });
      pushValue(L, id);
      return 1;
    },
    closePopup: L => {
      const target = arg(L, 1, 'popup'), to = seats(arg(L, 2, 'players')), open = state.live.popups ?? [];
      // A popup's id, or a popup component (by id or name) for all of its open popups.
      const ids = target === undefined ? open.map(popup => popup.id) : [...new Set(asList(target).flatMap(entry => {
        const key = text(entry, 'popup');
        if (open.some(popup => popup.id === key)) return [key];
        const comp = state.live.components.find(c => c.id === key) ?? state.live.components.find(c => c.name === key);
        return comp ? open.filter(popup => popup.componentId === comp.id).map(popup => popup.id) : [];
      }))];
      if (ids.length && to?.length !== 0) act({ type: 'closePopup', ids, ...to ? { players: to } : {} });
      return 0;
    },
    popups: L => { pushValue(L, (state.live.popups ?? []).map(popup => popupInfo(state.live, popup))); return 1; },
    log: L => { say('info', joinArguments(L)); return 0; },
    random: L => pushRandom(L, random),
    beginNoUndo: L => {
      if (!state.noUndo) noUndoMemory = readMemory(L);
      state.noUndo++;
      return 0;
    },
    endNoUndo: L => {
      if (!state.noUndo) throw new ScriptError('game.endNoUndo() without game.beginNoUndo().');
      state.noUndo--;
      if (!state.noUndo) {
        const now = readMemory(L);
        state.base = withMemoryChanges(state.base, noUndoMemory, now);
      }
      return 0;
    },
  };

  const register = (table: string, entries: Record<string, (L: LuaState) => number>) => {
    lua.lua_createtable(L, 0, Object.keys(entries).length);
    for (const [name, fn] of Object.entries(entries)) { lua.lua_pushcfunction(L, guard(fn)); lua.lua_setfield(L, -2, to_luastring(name)); }
    lua.lua_setglobal(L, to_luastring(table));
  };
  register('game', functions);
  register('json', {
    encode: L => { pushValue(L, JSON.stringify(readValue(L, 1, 'value') ?? null)); return 1; },
    decode: L => {
      let value: unknown;
      try { value = JSON.parse(String(readValue(L, 1, 'text') ?? '')); } catch (error) { throw new ScriptError(`json.decode: ${error instanceof Error ? error.message : String(error)}`); }
      pushValue(L, value);
      return 1;
    },
  });
  lua.lua_pushcfunction(L, guard(L => { say('info', joinArguments(L)); return 0; }));
  lua.lua_setglobal(L, to_luastring('print'));
  // math.random draws from the seed too; randomseed would make devices disagree, so it does nothing.
  lua.lua_getglobal(L, to_luastring('math'));
  lua.lua_pushcfunction(L, guard(L => pushRandom(L, random)));
  lua.lua_setfield(L, -2, to_luastring('random'));
  lua.lua_pushcfunction(L, () => 0);
  lua.lua_setfield(L, -2, to_luastring('randomseed'));
  lua.lua_pop(L, 1);
  pushValue(L, state.live.memory ?? {});
  lua.lua_setglobal(L, to_luastring('memory'));
  // Huge strings would exhaust memory long before the step limit.
  const prelude = 'local rep = string.rep; string.rep = function(s, n, sep) if #tostring(s) * (tonumber(n) or 0) > 1000000 then error("string.rep result is too long", 2) end return rep(s, n, sep) end';
  lauxlib.luaL_loadbufferx(L, to_luastring(prelude), null, to_luastring('=prelude'), to_luastring('t'));
  protectedCall(L, 0);
  return L;
}

/** Wraps a game function so its JavaScript errors become Lua errors at the calling line. */
function guard(fn: (L: LuaState) => number): LuaCFunction {
  return L => {
    let message: string;
    try { return fn(L); } catch (error) {
      if (!(error instanceof Error)) throw error; // A Lua error from a callback: let Lua unwind it.
      message = error.message;
    }
    lauxlib.luaL_where(L, 1);
    lua.lua_pushstring(L, to_luastring(message));
    lua.lua_concat(L, 2);
    return lua.lua_error(L);
  };
}

function pushRandom(L: LuaState, random: () => number): number {
  const count = lua.lua_gettop(L);
  if (!count) { lua.lua_pushnumber(L, random()); return 1; }
  const low = count >= 2 ? lua.lua_tonumber(L, 1) : 1, high = lua.lua_tonumber(L, count >= 2 ? 2 : 1);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) throw new ScriptError('random: the interval is empty.');
  lua.lua_pushinteger(L, Math.floor(low) + Math.floor(random() * (Math.floor(high) - Math.floor(low) + 1)));
  return 1;
}

function joinArguments(L: LuaState): string {
  const parts: string[] = [];
  for (let index = 1; index <= lua.lua_gettop(L); index++) {
    lauxlib.luaL_tolstring(L, index);
    parts.push(lua.lua_tojsstring(L, -1));
    lua.lua_pop(L, 1);
  }
  return parts.join('\t');
}
