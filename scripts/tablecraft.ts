import { randomUUID } from 'node:crypto';
import { link, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { applyCommand, archiveSchema, commandSchema, componentSchema, makeInstance, memoryAt, memoryValueSchema, projectSchema, uid, validateProject, withUniqueAssetNames, type Archive, type Command, type MemoryPath, type Project } from '../src/domain';
import { scriptFunctions } from '../src/scripting';
import { gridSchema, projectGrids, type Grid } from '../src/grids';
import { groupMembers, nextGroupName } from '../src/pieceGroups';
import { exportComponentBundle, remapComponentBundle } from '../src/storage';
import { createPortableZip, readPortableZip } from '../src/portable';
import { blankProject, starterProject, templateBundle } from '../src/templates';
import { GAME_PROJECTS, gameProject, type GameProjectId } from '../src/gameProjects';
import { applyPlaygroundCommand, emptyPlaygroundHistory, undoPlayground } from '../src/playgroundHistory';
import { live } from './live';
import { refreshProjectLinks } from '../src/projectLinks';
import { scopeOf, type Scope } from '../src/access';

const help = `Tablecraft CLI — JSON output on stdout; errors on stderr, nonzero exit.
Usage: npm --silent run cli -- <command> [options]

  new --out FILE [--template blank|wildwood|chess|checkers|go|tidewater] [--name NAME] [--force]
  generate --file FILE --template blank|card|token|board|dice|book|artwork|button [--name NAME] [--data JSON_FILE]
  import --file FILE --bundle COMPONENT_ZIP
  list --file FILE [--what components|instances|players|groups]
  inspect --file FILE [--component ID]
  schema --what project|archive|component|command
  apply --file FILE --commands JSON_FILE [--actor PLAYER_ID]
  spawn --file FILE --component ID [--count N] [--row N] [--x N] [--y N] [--actor PLAYER_ID]
  group create --file FILE [--name NAME] [--pieces IDS] [--groups IDS] [--parent GROUP_ID] [--id GROUP_ID]
  group rename --file FILE --group GROUP_ID --name NAME
  group ungroup --file FILE --group GROUP_IDS
  group move --file FILE [--pieces IDS] [--groups IDS] --parent GROUP_ID|root
  group lock|unlock --file FILE --group GROUP_IDS [--order | --hide] [--only SEATS | --except SEATS]
  lock|unlock --file FILE [--pieces IDS] [--groups IDS] [--order | --hide] [--only SEATS | --except SEATS] [--actor PLAYER_ID]
  grid [list] --file FILE [--show on|off] [--snap on|off] [--size N] [--offset-x N] [--offset-y N]
  grid add --file FILE --shape square|hex|points [grid options]
  grid set --file FILE --grid GRID_ID [grid options]
  grid remove --file FILE --grid GRID_ID
  grid point --file FILE --grid GRID_ID --x N --y N [--rotation DEG] [--label TEXT] [--id POINT_ID]
  script list --file FILE
  script set --file FILE --name NAME --source LUA_FILE
  script remove --file FILE --name NAME
  call --file FILE --function NAME [--piece ID] [--args JSON] [--actor PLAYER_ID]
  memory --file FILE [--path KEY.KEY.N] [--set JSON | --remove]
  validate --file FILE
  export --file FILE --out FILE [--component ID] [--force]
  live host --file FILE --code CODE [live options]
  live join|state --code CODE [live options]
  live dispatch --code CODE --commands JSON_FILE [--actor PLAYER_ID] [live options]
  live undo --code CODE [--actor PLAYER_ID] [live options]

Live options: --uri URL (default http://127.0.0.1:3000), --database NAME
  (default tablecraft-studio), --name NAME, --color COLOR, --timeout MS.
Project and component files are ZIP saves containing project.json and assets.
Groups organise table pieces in the Pieces panel; IDS are comma-separated, pieces
bring their whole stack, and empty groups are removed. group lock/unlock lock the
groups themselves: their pieces (and subgroups) stay put while each piece keeps its
own lock. lock/unlock act on pieces (with their whole stacks) and every piece in the given groups; locked pieces stay
put and can be dragged and box-selected over. --order locks places in the order instead, and --hide hides pieces from
seats (lock) or shows them again (unlock). lock covers everyone (seats that join later too), or with --except SEATS
everyone but those seats, or with --only SEATS just those; unlock clears it for everyone. grid prints the table's grid layers (the first one
wins where several take a piece); without a subcommand its options change the first grid. Grid
options: --name, --show on|off, --snap on|off, --size N (square cell width, hex distance
between cells), --size-y N (square cell height), --offset-x/--offset-y N, --orientation
pointy|flat (hex), --rotation DEG (pieces snapped to it turn to it; "none" clears it), --radius
N (points grids' snap distance), --tags A,B (it takes pieces with any of these grid tags;
"none" takes every piece). grid point adds a snap point to a points grid. The wildwood, chess, checkers, go
and tidewater templates are ready-to-play games with grouped, partly locked pieces. Book pages and dice faces
step with {"type":"cycleVariant","ids":[...],"delta":1} in apply.
Scripts are Lua 5.3, run in order by the shared command engine (onLoad runs when they
change). script set adds a script or replaces the one with that name. call runs a global
function as the active seat (--actor) and prints memory and the new console lines. memory
prints memory (or the value at --path; numbers index lists from 1) and --set/--remove change it.
For archives with multiple projects use --project PROJECT_ID. Offline mutations
replace --file atomically after the full batch succeeds. Offline apply supports
{"type":"undo"} within the current batch only. Live batches commit one command
at a time; errors report confirmed count. --help shows this help.
`;
type Options = Record<string, string | boolean>;
function parseArgs(args: string[]) {
  const positionals: string[] = [], options: Options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) { positionals.push(arg); continue; }
    const key = arg.slice(2);
    if (!key || key in options) throw new Error(`Invalid or repeated option ${arg}.`);
    if (['force', 'help', 'json', 'remove', 'order', 'hide'].includes(key)) options[key] = true;
    else {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Option ${arg} requires a value.`);
      options[key] = args[++i];
    }
  }
  return { positionals, options };
}
/** Who lock covers: everyone, everyone but --except SEATS, or only --only SEATS (seat ids or names). */
function lockScope(o: Options, project: Project): Scope {
  if (typeof o.only === 'string' && typeof o.except === 'string') throw new Error('Choose --only or --except, not both.');
  const list = typeof o.only === 'string' ? o.only : typeof o.except === 'string' ? o.except : '';
  const players = list.split(',').map(value => value.trim()).filter(Boolean).map(name => {
    const seat = project.players.find(player => player.id === name) ?? project.players.find(player => player.name === name);
    if (!seat) throw new Error(`There is no seat ${name}.`);
    return seat.id;
  });
  return { all: typeof o.only !== 'string', players };
}

function option(o: Options, name: string, fallback?: string): string {
  const value = o[name] ?? fallback;
  if (typeof value !== 'string' || !value) throw new Error(`--${name} is required.`);
  return value;
}
function numberOption(o: Options, name: string, fallback: number, min: number, max: number, integer = false) {
  const raw = o[name];
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error(`Invalid --${name}.`);
  return n;
}
async function jsonFile(path: string): Promise<unknown> { return JSON.parse(await readFile(path, 'utf8')); }
async function atomicZip(path: string, value: Parameters<typeof createPortableZip>[0], overwrite: boolean) {
  const dest = resolve(path);
  const temp = join(dirname(dest), `.${basename(dest)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, createPortableZip(value), { flag: 'wx', mode: 0o600 });
    if (overwrite) await rename(temp, dest);
    else await link(temp, dest);
  } finally { await rm(temp, { force: true }); }
}
async function load(path: string, projectId?: string): Promise<{ archive: Archive; project: Project; index: number }> {
  const imported = readPortableZip(await readFile(path));
  if (imported.kind !== 'archive') throw new Error('Choose a project ZIP, not a component bundle.');
  const archive = refreshProjectLinks(imported.archive);
  if (!projectId && archive.projects.length !== 1) throw new Error('Select a project with --project.');
  const index = projectId ? archive.projects.findIndex(p => p.id === projectId) : 0;
  if (index < 0 || !archive.projects[index]) throw new Error('Project not found.');
  return { archive, project: archive.projects[index], index };
}
async function commands(path: string, allowUndo = false) {
  const raw = await jsonFile(path);
  const schema = allowUndo ? z.union([commandSchema, z.object({ type: z.literal('undo') }).strict()]) : commandSchema;
  return z.array(schema).min(1).parse(Array.isArray(raw) ? raw : [raw]);
}
function allowed(o: Options, keys: string[]) {
  for (const key of Object.keys(o)) if (!['help', 'json', ...keys].includes(key)) throw new Error(`Unknown option --${key}.`);
}
async function main(args: string[]) {
  const { positionals, options: o } = parseArgs(args);
  const [cmd, sub] = positionals;
  if (o.help || !cmd) { console.log(help); return; }
  if (positionals.length > (cmd === 'live' || cmd === 'group' || cmd === 'script' || cmd === 'grid' ? 2 : 1)) throw new Error('Unexpected positional argument.');
  let result: unknown;
  if (cmd === 'schema') {
    allowed(o, ['what']);
    const schemas = { project: projectSchema, archive: archiveSchema, component: componentSchema, command: commandSchema };
    const what = option(o, 'what') as keyof typeof schemas;
    if (!(what in schemas)) throw new Error('Unknown schema.');
    // What a file may contain (as parsed): fields with defaults are optional, and layers' pivot upgrade isn't part of it.
    result = z.toJSONSchema(schemas[what], { io: 'input' });
  } else if (cmd === 'new') {
    allowed(o, ['out', 'template', 'name', 'force']);
    const kind = option(o, 'template', 'blank');
    const game = GAME_PROJECTS.find(item => item.id === kind);
    if (!['blank', 'wildwood'].includes(kind) && !game) throw new Error('Unknown project template.');
    const project = game ? gameProject(game.id as GameProjectId, game.name, game.description, { name: 'Player 1', color: '#b7cc91' })
      : kind === 'blank' ? blankProject() : starterProject();
    if (o.name) project.name = option(o, 'name');
    const archive = archiveSchema.parse({ format: 'tablecraft', version: 1, projects: [project] });
    validateProject(archive.projects[0]);
    await atomicZip(option(o, 'out'), archive, !!o.force);
    result = { project: archive.projects[0], file: option(o, 'out') };
  } else if (cmd === 'live') {
    allowed(o, ['file', 'project', 'code', 'uri', 'database', 'name', 'color', 'timeout', 'commands', 'actor']);
    if (!['host', 'join', 'state', 'dispatch', 'undo'].includes(sub)) throw new Error('Choose live host, join, state, dispatch or undo.');
    if (sub !== 'host' && (o.file || o.project)) throw new Error('--file and --project are only valid for live host.');
    if (sub !== 'dispatch' && o.commands) throw new Error('--commands is only valid for live dispatch.');
    if (!['dispatch', 'undo'].includes(sub) && o.actor) throw new Error('--actor is only valid for live dispatch or undo.');
    const initial = sub === 'host' ? (await load(option(o, 'file'), o.project as string | undefined)).project : undefined;
    result = await live({
      uri: option(o, 'uri', 'http://127.0.0.1:3000'), database: option(o, 'database', 'tablecraft-studio'),
      code: option(o, 'code'), name: option(o, 'name', 'CLI player'), color: option(o, 'color', '#b7cc91'),
      timeout: numberOption(o, 'timeout', 12000, 100, 120000, true), initial,
    }, sub === 'dispatch' ? await commands(option(o, 'commands')) as z.infer<typeof commandSchema>[] : [], o.actor as string | undefined, sub === 'undo');
  } else {
    const common = ['file', 'project'];
    const supported: Record<string, string[]> = {
      generate: [...common, 'template', 'name', 'data'], import: [...common, 'bundle'],
      list: [...common, 'what'], inspect: [...common, 'component'], validate: [...common],
      apply: [...common, 'commands', 'actor'], spawn: [...common, 'component', 'count', 'row', 'x', 'y', 'actor'],
      export: [...common, 'out', 'component', 'force'],
      group: [...common, 'name', 'pieces', 'groups', 'parent', 'group', 'id', 'order', 'hide', 'only', 'except'],
      lock: [...common, 'pieces', 'groups', 'actor', 'order', 'hide', 'only', 'except'], unlock: [...common, 'pieces', 'groups', 'actor', 'order', 'hide'],
      grid: [...common, 'show', 'snap', 'size', 'size-y', 'offset-x', 'offset-y', 'shape', 'name', 'orientation', 'rotation', 'radius', 'tags', 'grid', 'x', 'y', 'label', 'id'],
      script: [...common, 'name', 'source'], call: [...common, 'function', 'piece', 'args', 'actor'], memory: [...common, 'path', 'set', 'remove'],
    };
    if (!(cmd in supported)) throw new Error(`Unknown command ${cmd}. Use --help.`);
    allowed(o, supported[cmd]);
    const file = option(o, 'file');
    const loaded = await load(file, o.project as string | undefined);
    let project = loaded.project;
    let changed = false;
    if (cmd === 'generate') {
      const kind = option(o, 'template') as Parameters<typeof templateBundle>[0];
      if (!['blank', 'card', 'token', 'board', 'dice', 'book', 'artwork', 'button'].includes(kind)) throw new Error('Unknown component template.');
      const data = o.data ? await jsonFile(option(o, 'data')) : {};
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Component data must be a JSON object.');
      const bundle = templateBundle(kind);
      const component = componentSchema.parse({ ...bundle.root, ...data, ...(o.name ? { name: option(o, 'name') } : {}) });
      if (project.components.some(c => c.id === component.id)) throw new Error('Component ID already exists.');
      for (const dependency of bundle.components.filter(c => c.id !== bundle.root.id)) {
        project = applyCommand(project, { type: 'component', component: dependency });
      }
      project = applyCommand(project, { type: 'component', component });
      changed = true; result = { component };
    } else if (cmd === 'import') {
      const imported = readPortableZip(await readFile(option(o, 'bundle')));
      if (imported.kind !== 'component') throw new Error('Choose a component ZIP, not a project archive.');
      const remapped = remapComponentBundle(imported.bundle);
      const bundle = { ...remapped, components: withUniqueAssetNames(remapped.components, project.components) };
      project = applyCommand(project, { type: 'addComponents', components: bundle.components });
      changed = true; result = bundle;
    } else if (cmd === 'apply' || cmd === 'spawn') {
      const batch = cmd === 'apply' ? await commands(option(o, 'commands'), true) : [{
        type: 'spawn' as const,
        instances: Array.from({ length: numberOption(o, 'count', 1, 1, 1000, true) }, () =>
          makeInstance(option(o, 'component'), numberOption(o, 'row', 0, 0, 9999, true), numberOption(o, 'x', 700, -1000000, 1000000), numberOption(o, 'y', 450, -1000000, 1000000))),
      }];
      let history = emptyPlaygroundHistory();
      for (const command of batch) {
        if (command.type === 'undo') {
          const undone = undoPlayground(project, history);
          if (!undone.undone) throw new Error(undone.history.notice || 'Nothing to undo in this batch.');
          ({ project, history } = undone);
        } else ({ project, history } = applyPlaygroundCommand(project, history, command, o.actor as string | undefined));
      }
      changed = true; result = { commandsApplied: batch.length, project };
    } else if (cmd === 'group') {
      if (!['create', 'rename', 'ungroup', 'move', 'lock', 'unlock'].includes(sub)) throw new Error('Choose group create, rename, ungroup, move, lock or unlock.');
      const list = (name: string) => typeof o[name] === 'string' ? option(o, name).split(',').map(value => value.trim()).filter(Boolean) : [];
      const command: Command = sub === 'create'
        ? { type: 'createGroup', id: typeof o.id === 'string' ? option(o, 'id') : uid('group'), name: typeof o.name === 'string' ? option(o, 'name') : nextGroupName(project),
          parent: typeof o.parent === 'string' ? option(o, 'parent') : null, ids: list('pieces'), groups: list('groups') }
        : sub === 'rename' ? { type: 'renameGroup', id: option(o, 'group'), name: option(o, 'name') }
        : sub === 'ungroup' ? { type: 'ungroup', ids: list('group') }
        : sub === 'lock' || sub === 'unlock' ? (() => {
          const scope = sub === 'lock' ? lockScope(o, project) : { all: false, players: [] };
          return { type: 'lockGroups' as const, ids: list('group'), locked: scope.all, players: scope.players, ...o.order ? { order: true } : o.hide ? { hide: true } : {} };
        })()
        : { type: 'moveToGroup', parent: option(o, 'parent') === 'root' ? null : option(o, 'parent'), ids: list('pieces'), groups: list('groups') };
      ({ project } = applyPlaygroundCommand(project, emptyPlaygroundHistory(), command));
      changed = true; result = { command, groups: project.groups ?? [] };
    } else if (cmd === 'lock' || cmd === 'unlock') {
      const list = (name: string) => typeof o[name] === 'string' ? option(o, name).split(',').map(value => value.trim()).filter(Boolean) : [];
      const pieces = list('pieces'), groups = list('groups');
      if (!pieces.length && !groups.length) throw new Error('Choose --pieces or --groups.');
      for (const group of groups) if (!(project.groups ?? []).some(item => item.id === group)) throw new Error(`Group ${group} does not exist.`);
      const chosen = new Set([...pieces, ...groups.flatMap(group => groupMembers(project, group))]);
      for (const id of pieces) if (!project.instances.some(item => item.id === id)) throw new Error(`Piece ${id} does not exist.`);
      const stacks = new Set(project.instances.filter(item => chosen.has(item.id) && item.stack).map(item => item.stack));
      const lock = cmd === 'lock', kind = o.order ? 'orderLock' : o.hide ? 'hide' : 'lock';
      if (o.order && o.hide) throw new Error('Choose --order or --hide, not both.');
      const scope = lock ? lockScope(o, project) : { all: false, players: [] };
      // Pieces already set so are left as they are (held pieces can't be hidden). --order locks their place in the order
      // instead, and --hide hides them.
      const same = (item: typeof project.instances[number]) => JSON.stringify(scopeOf(item, kind)) === JSON.stringify(scope);
      const ids = project.instances.filter(item => (chosen.has(item.id) || (item.stack && stacks.has(item.stack))) && !same(item) && !(kind === 'hide' && item.holder)).map(item => item.id);
      const command: Command = kind === 'hide' ? { type: 'hide', ids, hidden: scope.all, players: scope.players }
        : { type: 'move', ids, patch: kind === 'orderLock' ? { orderLocked: scope.all, orderLockPlayers: scope.players } : { locked: scope.all, lockPlayers: scope.players } };
      if (ids.length) ({ project } = applyPlaygroundCommand(project, emptyPlaygroundHistory(), command, o.actor as string | undefined));
      changed = ids.length > 0; result = { [lock ? kind === 'hide' ? 'hidden' : 'locked' : kind === 'hide' ? 'shown' : 'unlocked']: ids, ...o.order ? { order: true } : {}, ...o.hide ? { hide: true } : {} };
    } else if (cmd === 'grid') {
      if (sub && !['list', 'add', 'set', 'remove', 'point'].includes(sub)) throw new Error('Choose grid list, add, set, remove or point.');
      const toggle = (name: string) => {
        if (o[name] === undefined) return undefined;
        if (o[name] !== 'on' && o[name] !== 'off') throw new Error(`--${name} must be on or off.`);
        return o[name] === 'on';
      };
      const grids = projectGrids(project);
      const find = () => { const grid = grids.find(item => item.id === option(o, 'grid')); if (!grid) throw new Error(`Grid ${option(o, 'grid')} does not exist.`); return grid; };
      // The options shared by add, set and the old flag-only form.
      const patch = (): Partial<Grid> => {
        const changes: Partial<Grid> = {};
        const show = toggle('show'), snap = toggle('snap');
        if (show !== undefined) changes.visible = show;
        if (snap !== undefined) changes.snap = snap;
        if (o.name !== undefined) changes.name = option(o, 'name');
        if (o.shape !== undefined) changes.shape = gridSchema.shape.shape.parse(option(o, 'shape'));
        if (o.size !== undefined) changes.size = numberOption(o, 'size', 50, 5, 2000);
        if (o['size-y'] !== undefined) changes.sizeY = numberOption(o, 'size-y', 50, 5, 2000);
        if (o['offset-x'] !== undefined) changes.offsetX = numberOption(o, 'offset-x', 0, -100000, 100000);
        if (o['offset-y'] !== undefined) changes.offsetY = numberOption(o, 'offset-y', 0, -100000, 100000);
        if (o.orientation !== undefined) changes.orientation = z.enum(['pointy', 'flat']).parse(option(o, 'orientation'));
        if (o.rotation !== undefined) changes.rotation = o.rotation === 'none' ? undefined : numberOption(o, 'rotation', 0, -360, 360);
        if (o.radius !== undefined) changes.radius = numberOption(o, 'radius', 50, 1, 2000);
        if (o.tags !== undefined) changes.filter = o.tags === 'none' ? undefined : { anyOf: option(o, 'tags').split(',').map(tag => tag.trim()).filter(Boolean).map(tag => ({ has: [tag], lacks: [] })) };
        return changes;
      };
      let command: Command | undefined;
      if (sub === 'add') {
        const shape = gridSchema.shape.shape.parse(option(o, 'shape'));
        command = { type: 'grid', grid: gridSchema.parse({ id: typeof o.id === 'string' ? option(o, 'id') : uid('grid'), name: shape === 'hex' ? 'Hex grid' : shape === 'points' ? 'Snap points' : 'Square grid',
          shape, visible: true, snap: true, size: shape === 'hex' ? 100 : 50, offsetX: 0, offsetY: 0, ...(shape === 'points' ? { points: [] } : {}), ...patch() }) };
      } else if (sub === 'set') command = { type: 'grid', grid: gridSchema.parse({ ...find(), ...patch() }) };
      else if (sub === 'remove') command = { type: 'removeGrid', id: find().id };
      else if (sub === 'point') {
        const grid = find();
        if (grid.shape !== 'points') throw new Error(`${grid.name} is a ${grid.shape} grid; snap points go on points grids.`);
        const point = { id: typeof o.id === 'string' ? option(o, 'id') : uid('point'), x: numberOption(o, 'x', 0, -100000, 100000), y: numberOption(o, 'y', 0, -100000, 100000),
          ...(o.rotation !== undefined ? { rotation: numberOption(o, 'rotation', 0, -360, 360) } : {}), ...(o.label !== undefined ? { label: option(o, 'label') } : {}) };
        command = { type: 'grid', grid: { ...grid, points: [...(grid.points ?? []).filter(item => item.id !== point.id), point] } };
      } else if (sub !== 'list' && Object.keys(patch()).length) {
        // The flag-only form of older versions changes the first grid.
        if (!grids.length) throw new Error('The table has no grids. Use grid add.');
        command = { type: 'grid', grid: gridSchema.parse({ ...grids[0], ...patch() }) };
      }
      if (command) ({ project } = applyPlaygroundCommand(project, emptyPlaygroundHistory(), command));
      changed = !!command;
      result = { grids: projectGrids(project) };
    } else if (cmd === 'script') {
      if (!['list', 'set', 'remove'].includes(sub)) throw new Error('Choose script list, set or remove.');
      const named = () => (project.scripts ?? []).find(script => script.name.toLowerCase() === option(o, 'name').toLowerCase());
      if (sub === 'set') {
        const source = await readFile(option(o, 'source'), 'utf8');
        const script = { id: named()?.id ?? uid('script'), name: option(o, 'name'), source };
        ({ project } = applyPlaygroundCommand(project, emptyPlaygroundHistory(), { type: 'script', script }));
        changed = true;
      } else if (sub === 'remove') {
        const script = named();
        if (!script) throw new Error(`There is no script called ${option(o, 'name')}.`);
        ({ project } = applyPlaygroundCommand(project, emptyPlaygroundHistory(), { type: 'removeScript', id: script.id }));
        changed = true;
      }
      result = { scripts: (project.scripts ?? []).map(script => ({ id: script.id, name: script.name, lines: script.source.split('\n').length })),
        functions: scriptFunctions(project.scripts), memory: project.memory ?? {}, log: project.scriptLog?.slice(-20) ?? [] };
    } else if (cmd === 'call') {
      const args = o.args ? z.array(memoryValueSchema).max(20).parse(JSON.parse(option(o, 'args'))) : [];
      const before = project.scriptLog?.at(-1)?.seq ?? 0;
      ({ project } = applyPlaygroundCommand(project, emptyPlaygroundHistory(), {
        type: 'call', name: option(o, 'function'), args, seed: Math.floor(Math.random() * 0x7fffffff), ...(o.piece ? { piece: option(o, 'piece') } : {}),
      }, o.actor as string | undefined));
      const lines = (project.scriptLog ?? []).filter(line => line.seq > before);
      const failure = lines.find(line => line.level === 'error');
      if (failure) throw new Error(failure.text);
      changed = true; result = { memory: project.memory ?? {}, log: lines };
    } else if (cmd === 'memory') {
      const path: MemoryPath = typeof o.path === 'string' ? option(o, 'path').split('.').map(key => /^[1-9]\d*$/.test(key) ? Number(key) : key) : [];
      if (o.set !== undefined && o.remove) throw new Error('Choose --set or --remove, not both.');
      if (o.set !== undefined || o.remove) {
        const value = o.remove ? undefined : memoryValueSchema.parse(JSON.parse(option(o, 'set')));
        ({ project } = applyPlaygroundCommand(project, emptyPlaygroundHistory(), { type: 'memory', changes: [{ path, ...(value === undefined ? {} : { value }) }] }));
        changed = true;
      }
      result = path.length ? { path, value: memoryAt(project.memory, path) ?? null } : project.memory ?? {};
    } else if (cmd === 'list') {
      const what = option(o, 'what', 'components');
      if (!['components', 'instances', 'players', 'groups'].includes(what)) throw new Error('Unknown list type.');
      result = what === 'groups' ? (project.groups ?? []).map(group => ({ ...group, pieces: groupMembers(project, group.id) }))
        : project[what as 'components' | 'instances' | 'players'];
    } else if (cmd === 'inspect') {
      result = o.component ? project.components.find(c => c.id === o.component) : project;
      if (!result) throw new Error('Component not found.');
    } else if (cmd === 'validate') result = { valid: true, projectId: project.id };
    else if (cmd === 'export') {
      let output: Parameters<typeof createPortableZip>[0] = { format: 'tablecraft', version: 1, projects: [project] };
      if (o.component) {
        const component = project.components.find(c => c.id === o.component);
        if (!component) throw new Error('Component not found.');
        output = exportComponentBundle(component, project.components);
      }
      if (resolve(option(o, 'out')) === resolve(file)) throw new Error('Export destination must differ from the source.');
      await atomicZip(option(o, 'out'), output, !!o.force);
      result = { file: option(o, 'out') };
    }
    if (changed) {
      validateProject(project);
      loaded.archive.projects[loaded.index] = project;
      await atomicZip(file, archiveSchema.parse(refreshProjectLinks(loaded.archive)), true);
    }
  }
  console.log(JSON.stringify(result, null, 2));
}

main(process.argv.slice(2)).catch(error => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
