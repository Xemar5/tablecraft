// Builds the portable ZIP through the CLI and a JSON contact-sheet source.
// Run from the repository root:  npx tsx games/arcane-assembly/build.ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Component } from '../../src/domain';
import { createPortableZip, readPortableZip } from '../../src/portable';
import {
  ID, PAY_FIELDS, COST_FIELDS, achievements, actions, artLibrary, buildCards, coreRulebook, costSlot, factionRulebook, firstPlayer,
  rarityIcons, reminder, resourceArt, resourceTokens, setArtChunks, specialPieces, supports, workers,
} from './src/components';
import { ALL_RESOURCES, CORE_RULES, FACTIONS, GAME, factionPages, type Faction } from './src/content';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const archive = join(here, 'arcane-assembly.tablecraft.zip');
const work = join(tmpdir(), 'arcane-assembly-build');  // per-component JSON handed to the CLI

function cli(...args: string[]): any {
  const stdout = execFileSync(process.execPath, [join(repo, 'node_modules/tsx/dist/cli.mjs'), join(repo, 'scripts/tablecraft.ts'), ...args],
    { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'inherit'] });
  return JSON.parse(stdout);
}

// ---------------------------------------------------------------- components (dependencies first)
const art = artLibrary();
setArtChunks(art);
const shared: Component[] = [rarityIcons(), ...ALL_RESOURCES.map(resourceArt), ...[...COST_FIELDS, ...PAY_FIELDS].map(costSlot), ...art];
const general: Component[] = [coreRulebook(), firstPlayer()];
const perFaction = FACTIONS.map(f => [
  factionRulebook(f), reminder(f), actions(f), supports(f), buildCards(f, 'unit'), buildCards(f, 'building'), achievements(f),
  resourceTokens(f), workers(f), ...specialPieces(f),
]);

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const created = cli('new', '--out', archive, '--template', 'blank', '--name', GAME.name, '--force');
let n = 0;
for (const c of [...shared, ...general, ...perFaction.flat()]) {
  const file = join(work, `${String(++n).padStart(2, '0')}-${c.id}.json`);
  writeFileSync(file, JSON.stringify(c, null, 2));
  cli('generate', '--file', archive, '--template', 'blank', '--data', file);
  console.log(`generated ${c.id} (${c.front.length + c.back.length} layers, ${c.rows.length} rows)`);
}

// ---------------------------------------------------------------- table setup, seats and library order
type Spawn = { id: string; componentId: string; row: number; x: number; y: number; rotation: number; scale: number; flipped: boolean; holder: null; stack: null; order: number; locked: boolean };
const commands: unknown[] = created.project.players.map((player: { id: string }) => ({ type: 'removePlayer', playerId: player.id }));
const spawn: Spawn[] = [];
const stacks: { ids: string[]; stackId: string }[] = [];
const put = (id: string, componentId: string, row: number, x: number, y: number, extra: Partial<Spawn> = {}) => {
  spawn.push({ id, componentId, row, x, y, rotation: 0, scale: 1, flipped: false, holder: null, stack: null, order: 0, locked: false, ...extra });
  return id;
};
const origins: Record<string, [number, number]> = { brass: [0, 0], verdant: [2400, 0], cinder: [0, 1900], star: [2400, 1900] };

function layout(f: Faction) {
  const [ox, oy] = origins[f.key], p = (s: string) => `piece-${f.key}-${s}`;
  f.actions.forEach((_, i) => put(p(`action-${i}`), ID.f(f, 'actions'), i, ox + 87.5 + i * 360, oy + 125));
  stacks.push({ stackId: `stack-${f.key}-supports`, ids: f.supports.map((_, i) => put(p(`support-${i}`), ID.f(f, 'supports'), i, ox + 1887.5, oy + 125, { flipped: true })) });
  f.units.forEach((_, i) => put(p(`unit-${i}`), ID.f(f, 'units'), i, ox + 125 + i * 260, oy + 475));
  f.buildings.forEach((_, i) => put(p(`building-${i}`), ID.f(f, 'buildings'), i, ox + 125 + i * 260, oy + 845));
  f.achievements.forEach((_, i) => put(p(`achievement-${i}`), ID.f(f, 'achievements'), i, ox + 1455, oy + 387.5 + i * 185));
  put(p('reminder'), ID.f(f, 'reminder'), 0, ox + 1745, oy + 475);
  const pages = factionPages(f).map((_, i) => put(p(`rules-${i}`), ID.f(f, 'rules'), i, ox + 1745, oy + 845, { scale: 0.5 }));
  stacks.push({ stackId: `stack-${f.key}-rules`, ids: pages.reverse() });
  f.resources.forEach((_, r) => [0, 1, 2, 3].forEach(j => put(p(`res-${r}-${j}`), ID.f(f, 'resources'), r, ox + 40 + r * 200 + (j % 2) * 86, oy + 1100 + Math.floor(j / 2) * 86)));
  [0, 1, 2, 3, 4, 5].forEach(j => put(p(`worker-${j}`), ID.f(f, 'workers'), 0, ox + 1068 + (j % 3) * 64, oy + 1088 + Math.floor(j / 3) * 80));
  const left = ox + 1620, top = oy + 1060;
  if (f.key === 'brass') {
    put(p('board'), ID.f(f, 'board'), 0, left + 210, top + 80, { locked: true });
    put(p('pressure'), ID.f(f, 'pressure'), 0, left + 44, top + 80);
  } else if (f.key === 'verdant') {
    put(p('board'), ID.f(f, 'board'), 0, left + 220, top + 152, { locked: true });
    for (let j = 0; j < 8; j++) put(p(`seed-${j}`), ID.f(f, 'seeds'), 0, left + 480 + (j % 2) * 52, top + 26 + Math.floor(j / 2) * 52);
  } else if (f.key === 'cinder') {
    put(p('board'), ID.f(f, 'board'), 0, left + 230, top + 81, { locked: true });
    put(p('heat'), ID.f(f, 'heat'), 0, left + 43.5, top + 84);
  } else {
    put(p('orrery'), ID.f(f, 'orrery'), 0, left + 40, top + 40);
    for (let j = 0; j < 6; j++) put(p(`insight-${j}`), ID.f(f, 'insight'), 0, left + 120 + j * 58, top + 40);
  }
  commands.push({ type: 'player', player: { id: `seat-${f.key}`, owner: 'local', name: f.short, color: f.primary, x: ox + 950, y: oy + 1420, rotation: 0 } });
}
FACTIONS.forEach(layout);
stacks.push({ stackId: 'stack-core-rules', ids: CORE_RULES.map((_, i) => put(`piece-core-rules-${i}`, ID.coreRules, i, 2225, 1650, { scale: 0.45 })).reverse() });
put('piece-first-player', ID.firstPlayer, 0, 2225, 1420);

commands.push({ type: 'spawn', instances: spawn });
stacks.forEach(s => commands.push({ type: 'stack', ...s }));
// Library: core pieces, then each faction's components, then shared icon/art templates at the end.
let last = perFaction.flat().at(-1)!.id;
for (const c of shared) { commands.push({ type: 'reorderComponent', id: c.id, targetId: last, position: 'after' }); last = c.id; }
commands.push({ type: 'settings', patch: { turns: true, turn: 0, grid: false } });
const commandFile = join(work, 'table-setup.commands.json');
writeFileSync(commandFile, JSON.stringify(commands, null, 2));
cli('apply', '--file', archive, '--commands', commandFile);

const portable = readPortableZip(readFileSync(archive));
if (portable.kind !== 'archive') throw new Error('Expected the generated project archive.');
const saved = portable.archive;
saved.projects[0].description = `${GAME.tagline} A worker-placement engine builder for 2–4 rival factory factions.`;
writeFileSync(archive, createPortableZip(saved));
writeFileSync(join(here, 'arcane-assembly.tablecraft.json'), JSON.stringify(saved, null, 2) + '\n');
console.log(JSON.stringify(cli('validate', '--file', archive)));
console.log(`components: ${saved.projects[0].components.length}, pieces: ${saved.projects[0].instances.length}, size: ${(JSON.stringify(saved).length / 1e6).toFixed(2)} MB`);

// ---------------------------------------------------------------- printable rulebook
const icon = (code: string) => code;
// Card text uses plain lines; in Markdown, caps lines become bold headings and bullets become list items.
const mdBody = (text: string) => text.split('\n').map(line => line.startsWith('• ') ? `- ${line.slice(2)}`
  : /^[A-Z][A-Z0-9 ·:'’.—–-]+$/.test(line) && line.length < 48 ? `**${line}**` : line).join('  \n');
const md: string[] = [`# ${GAME.name}`, '', `*${GAME.tagline}*`, '', '## Core rules', ''];
for (const p of CORE_RULES) md.push(`### ${p.title}`, '', mdBody(p.body), '');
for (const f of FACTIONS) {
  md.push(`## ${f.name}`, '', `Colours: ${f.colourNames} (\`${f.primary}\`, \`${f.secondary}\`).`, '');
  for (const p of factionPages(f)) md.push(`### ${p.title}`, '', mdBody(p.body), '');
  md.push('### Card list', '', '| Card | Type | Cost | Effect |', '|---|---|---|---|');
  f.actions.forEach(a => md.push(`| ${a.name} | Action${a.support ? ' (support edge)' : ''} | ${a.workers} worker${a.workers > 1 ? 's' : ''}${a.pay ? ' + ' + a.pay.map(icon).join(', ') : ''} | ${a.effect.replace(/\n/g, ' ')} |`));
  f.supports.forEach(s => md.push(`| ${s.name} | Support | ${s.pay ? s.pay.map(icon).join(', ') : '—'} | ${s.effect.replace(/\n/g, ' ')} |`));
  [...f.units.map(u => ['Unit', u] as const), ...f.buildings.map(b => ['Building', b] as const)].forEach(([type, c]) =>
    md.push(`| ${c.name} | ${type} | ${c.cost.join(', ')}${c.pay || c.extra ? ` · also ${[...(c.pay ?? []), c.extra ?? ''].filter(Boolean).join(', ')}` : ''} | ${c.effect.replace(/\n/g, ' ')} |`));
  f.achievements.forEach(a => md.push(`| ${a.name} | Achievement | ${a.cost.join(', ')} | — |`));
  md.push('', `Reminder: ${f.special.reminder.replace(/\n/g, ' ')}`, '');
}
md.push('## Cost codes (for editing card CSVs)', '', 'Cost and pay columns hold one icon code each:', '',
  '- a resource key, e.g. `coal`, `prism` — that exact resource;',
  '- `abundant`, `common`, `uncommon`, `rare` — any resource of that rarity;',
  '- `common:o` — socket (filled during setup);',
  '- `common:A` … `common:D` — lettered;',
  '- `common:oA` … `common:oD` — lettered socket.', '',
  `Resource keys: ${FACTIONS.map(f => f.resources.map(r => `\`${r.key}\``).join(', ')).join(', ')}.`, '');
writeFileSync(join(here, 'RULES.md'), md.join('\n'));
rmSync(work, { recursive: true, force: true });
console.log('wrote RULES.md');
