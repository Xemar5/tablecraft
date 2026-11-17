import { randomUUID } from 'node:crypto';
import { link, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { applyCommand, archiveSchema, commandSchema, componentSchema, makeInstance, projectSchema, uid, validateProject, withUniqueAssetNames, type Archive, type Command, type Project } from '../src/domain';
import { groupMembers, nextGroupName } from '../src/pieceGroups';
import { exportComponentBundle, remapComponentBundle } from '../src/storage';
import { createPortableZip, readPortableZip } from '../src/portable';
import { blankProject, starterProject, templateBundle } from '../src/templates';
import { applyPlaygroundCommand, emptyPlaygroundHistory, undoPlayground } from '../src/playgroundHistory';
import { live } from './live';
import { refreshProjectLinks } from '../src/projectLinks';

const help = `Tablecraft CLI — JSON output on stdout; errors on stderr, nonzero exit.
Usage: npm --silent run cli -- <command> [options]

  new --out FILE [--template blank|wildwood] [--name NAME] [--force]
  generate --file FILE --template blank|card|token|board|dice|book|artwork [--name NAME] [--data JSON_FILE]
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
bring their whole stack, and empty groups are removed. Book pages and dice faces
step with {"type":"cycleVariant","ids":[...],"delta":1} in apply.
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
    if (['force', 'help', 'json'].includes(key)) options[key] = true;
    else {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Option ${arg} requires a value.`);
      options[key] = args[++i];
    }
  }
  return { positionals, options };
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
  if (positionals.length > (cmd === 'live' || cmd === 'group' ? 2 : 1)) throw new Error('Unexpected positional argument.');
  let result: unknown;
  if (cmd === 'schema') {
    allowed(o, ['what']);
    const schemas = { project: projectSchema, archive: archiveSchema, component: componentSchema, command: commandSchema };
    const what = option(o, 'what') as keyof typeof schemas;
    if (!(what in schemas)) throw new Error('Unknown schema.');
    result = z.toJSONSchema(schemas[what]);
  } else if (cmd === 'new') {
    allowed(o, ['out', 'template', 'name', 'force']);
    const kind = option(o, 'template', 'blank');
    if (!['blank', 'wildwood'].includes(kind)) throw new Error('Unknown project template.');
    const project = kind === 'blank' ? blankProject() : starterProject();
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
      group: [...common, 'name', 'pieces', 'groups', 'parent', 'group', 'id'],
    };
    if (!(cmd in supported)) throw new Error(`Unknown command ${cmd}. Use --help.`);
    allowed(o, supported[cmd]);
    const file = option(o, 'file');
    const loaded = await load(file, o.project as string | undefined);
    let project = loaded.project;
    let changed = false;
    if (cmd === 'generate') {
      const kind = option(o, 'template') as Parameters<typeof templateBundle>[0];
      if (!['blank', 'card', 'token', 'board', 'dice', 'book', 'artwork'].includes(kind)) throw new Error('Unknown component template.');
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
      if (!['create', 'rename', 'ungroup', 'move'].includes(sub)) throw new Error('Choose group create, rename, ungroup or move.');
      const list = (name: string) => typeof o[name] === 'string' ? option(o, name).split(',').map(value => value.trim()).filter(Boolean) : [];
      const command: Command = sub === 'create'
        ? { type: 'createGroup', id: typeof o.id === 'string' ? option(o, 'id') : uid('group'), name: typeof o.name === 'string' ? option(o, 'name') : nextGroupName(project),
          parent: typeof o.parent === 'string' ? option(o, 'parent') : null, ids: list('pieces'), groups: list('groups') }
        : sub === 'rename' ? { type: 'renameGroup', id: option(o, 'group'), name: option(o, 'name') }
        : sub === 'ungroup' ? { type: 'ungroup', ids: list('group') }
        : { type: 'moveToGroup', parent: option(o, 'parent') === 'root' ? null : option(o, 'parent'), ids: list('pieces'), groups: list('groups') };
      ({ project } = applyPlaygroundCommand(project, emptyPlaygroundHistory(), command));
      changed = true; result = { command, groups: project.groups ?? [] };
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
