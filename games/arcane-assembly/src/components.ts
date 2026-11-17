// Component (template) builders. Shared artwork is nested into faction cards so the icon system,
// card art and resource faces are designed once and reused everywhere.
import type { Component } from '../../../src/domain';
import { ART, RARITIES, RESOURCE_ART, rarityOutline, shade, tint, type Rarity } from './art';
import { ALL_RESOURCES, CORE_RULES, GAME, ROUND_REMINDER, factionPages, type Faction, type Motif, type Page, type Resource } from './content';
import {
  Draw, INK, Layers, MUTED, PAPER, TITLE, WHITE, WORDMARK, circlePts, component, flamePts, gearPts, leafPts,
  mix, polyPts, rgba, roundRectPts, spaced, withRows, workerPts,
} from './kit';

const PILL = '#EAE5D9';
export const ID = {
  rarity: 'aa-rarity-icons', res: (key: string) => `aa-resource-${key}`, firstPlayer: 'aa-first-player', coreRules: 'aa-core-rules',
  slot: (field: string) => `aa-slot-${field}`, art: (n: number) => `aa-card-art-${n}`,
  f: (f: Faction, part: string) => `aa-${f.key}-${part}`,
};
export const COST_FIELDS = ['cost1', 'cost2', 'cost3', 'cost4', 'cost5', 'cost6'];
export const PAY_FIELDS = ['pay1', 'pay2'];

// ---------------------------------------------------------------- icon system
const MARKS = ['', 'o', 'A', 'B', 'C', 'D', 'oA', 'oB', 'oC', 'oD'];
export const RARITY_ROWS = RARITIES.flatMap(rarity => MARKS.map(mark => ({
  code: mark ? `${rarity}:${mark}` : rarity, rarity, socket: mark.startsWith('o') ? 'o' : '', letter: mark.replace('o', ''),
})));
export const ALL_CODES = [...RARITY_ROWS.map(r => r.code), ...ALL_RESOURCES.map(r => r.key)];

export function rarityIcons(): Component {
  const L = new Layers('ri'), d = L.draw();
  d.ell(0, 0, 100, 100, WHITE, { name: 'Backing' });
  for (const r of RARITIES) rarityOutline(d, r, INK, 6.5, { visibilityField: '{{rarity}}', visibilityValue: r });
  d.ring(50, 50, 19, INK, 5, { name: 'Socket', visibilityField: '{{socket}}', visibilityValue: 'o' });
  d.text(0, 18, 100, 64, '{{letter}}', { name: 'Letter', size: 40, font: TITLE, align: 'center', visibilityField: '{{socket}}', visibilityValue: '' });
  d.text(25, 30, 50, 40, '{{letter}}', { name: 'Socket letter', size: 22, font: TITLE, align: 'center', visibilityField: '{{socket}}', visibilityValue: 'o' });
  return component(ID.rarity, 'Icons · Rarity costs', 'artwork', 100, 100, { front: L.nodes, ...withRows(['code', 'rarity', 'socket', 'letter'], RARITY_ROWS) });
}

/** Each resource is its own small artwork: tinted disc, rarity outline and picture in the resource colour. */
export function resourceArt(r: Resource): Component {
  const L = new Layers('res'), d = L.draw();
  d.ell(0, 0, 100, 100, tint(r.color), { name: 'Token' });
  rarityOutline(d, r.rarity, r.color);
  RESOURCE_ART[r.key](d, r.color, shade(r.color), tint(r.color));
  return component(ID.res(r.key), `Resource · ${r.name}`, 'artwork', 100, 100, { front: L.nodes });
}

/** One slot per CSV field: shows the icon for whatever code that field holds (or nothing when empty). */
export function costSlot(field: string): Component {
  const L = new Layers('slot'), d = L.draw(), when = `{{${field}}}`;
  RARITY_ROWS.forEach((row, i) => d.nest(0, 0, 100, 100, ID.rarity, { name: row.code, dataSource: 'row', dataRow: i, visibilityField: when, visibilityValue: row.code }));
  ALL_RESOURCES.forEach(r => d.nest(0, 0, 100, 100, ID.res(r.key), { name: r.key, visibilityField: when, visibilityValue: r.key }));
  return component(ID.slot(field), `Icons · Slot ${field}`, 'artwork', 100, 100, { front: L.nodes, ...withRows([field], ALL_CODES.map(code => ({ [field]: code }))) });
}

// ---------------------------------------------------------------- card art library
const ART_KEYS = Object.keys(ART);
export function artLibrary(): Component[] {
  const chunks: Component[] = [];
  let L = new Layers('art1'), keys: string[] = [];
  const flush = () => {
    const n = chunks.length + 1;
    chunks.push(component(ID.art(n), `Art · Card illustrations ${n}`, 'artwork', 100, 100, { front: L.nodes, ...withRows(['art'], keys.map(art => ({ art }))) }));
    L = new Layers(`art${n + 1}`); keys = [];
  };
  for (const key of ART_KEYS) {
    const probe = new Layers('probe'); ART[key](probe.draw(probe.draw().frame(0, 0, 100, 100).parent));
    if (L.nodes.length + probe.nodes.length + 1 > 290) flush();
    const g = L.draw().frame(0, 0, 100, 100, { name: key, visibilityField: '{{art}}', visibilityValue: key });
    ART[key](g); keys.push(key);
  }
  flush();
  return chunks;
}
let artChunks: Component[] = [];
export function setArtChunks(chunks: Component[]) { artChunks = chunks; }
/** Card art from the row's {{art}} field. */
function art(d: Draw, x: number, y: number, size: number) {
  artChunks.forEach(c => d.nest(x, y, size, size, c.id, { name: 'Art' }));
}
/** A fixed illustration, independent of the row data. */
function fixedArt(d: Draw, key: string, x: number, y: number, size: number, props = {}) {
  const chunk = artChunks.find(c => c.rows.some(r => r.art === key))!;
  d.nest(x, y, size, size, chunk.id, { name: key, dataSource: 'row', dataRow: chunk.rows.findIndex(r => r.art === key), ...props });
}
const slot = (d: Draw, field: string, x: number, y: number, size: number) => d.nest(x, y, size, size, ID.slot(field), { name: field });
const resourceIcon = (d: Draw, key: string, x: number, y: number, size: number) => d.nest(x, y, size, size, ID.res(key), { name: key });
const rarityIcon = (d: Draw, code: string, x: number, y: number, size: number, props = {}) =>
  d.nest(x, y, size, size, ID.rarity, { name: code, dataSource: 'row', dataRow: RARITY_ROWS.findIndex(r => r.code === code), ...props });

// ---------------------------------------------------------------- faction motifs (support edges)
function motifShape(d: Draw, motif: Motif, cx: number, cy: number, color: string, i: number) {
  if (motif === 'cog') d.path(gearPts(cx, cy, 9.5, 7, 8, 0.5), color, { name: 'Cog' });
  else if (motif === 'leaf') d.path(i % 2 ? leafPts(cx - 6, cy + 7, cx + 6, cy - 7, 5) : leafPts(cx + 6, cy + 7, cx - 6, cy - 7, 5), color, { name: 'Leaf' });
  else if (motif === 'flame') d.path(flamePts(cx, cy - 10, 15, 20), color, { name: 'Flame' });
  else d.star(cx - 8, cy - 8, 16, 16, 4, 0.36, color, { name: 'Star' });
}
/** Pattern centred on the seam line x, so an action and its support complete each shape. */
function seam(d: Draw, f: Faction, x: number, height: number) {
  const step = f.motif === 'flame' ? 24 : 26;
  for (let y = 14, i = 0; y < height; y += step, i++) motifShape(d, f.motif, x, y, f.secondary, i);
}

// ---------------------------------------------------------------- card faces
/** Lighter disc of the primary colour with a thin accent ring, behind card art. */
function backdrop(d: Draw, f: { primary: string; secondary: string }, cx: number, cy: number, r: number, ring: number, square = false) {
  const fill = mix(f.primary, WHITE, 0.13);
  if (square) d.path(roundRectPts(cx - r, cy - r, r * 2, r * 2, r * 0.3), fill, { name: 'Art backdrop', stroke: f.secondary, sw: ring });
  else d.path(circlePts(cx, cy, r), fill, { name: 'Art backdrop', stroke: f.secondary, sw: ring });
}
function header(d: Draw, f: Faction, label: string, x: number, width: number) {
  d.rect(0, 0, 175, 80, f.primary, { name: 'Header' });
  backdrop(d, f, 139, 38, 28, 2);
  art(d, 117, 16, 44);
  d.text(x, 8, width, 46, '{{name}}', { name: 'Name', size: 13.5, font: TITLE, color: WHITE });
  d.text(x, 56, width, 14, spaced(label), { name: 'Type', size: 7, color: f.secondary });
}
function footer(d: Draw, f: Faction, x: number, y: number, width: number) {
  d.text(x, y, width, 12, f.name.toUpperCase(), { name: 'Faction', size: 6.5, color: MUTED });
}

export function actions(f: Faction): Component {
  const L = new Layers('front'), d = L.draw();
  header(d, f, 'Action', 12, 96);
  d.ell(24, 86, 16, 16, f.primary, { name: 'Worker head' });
  d.path(workerPts(12, 99, 40, 34), f.primary, { name: 'Worker body' });
  d.text(12, 110, 40, 24, '{{workers}}', { name: 'Workers', size: 16, font: TITLE, color: WHITE, align: 'center' });
  slot(d, 'pay1', 60, 99, 30); slot(d, 'pay2', 94, 99, 30);
  d.rect(12, 142, 138, 1.5, rgba(INK, 0.12), { name: 'Divider' });
  d.textTop(12, 150, 138, '{{effect}}', { name: 'Effect', size: 10.5 });
  footer(d, f, 12, 232, 138);
  const edge = d.frame(161, 0, 14, 250, { name: 'Support edge', visibilityField: '{{support}}', visibilityValue: 'yes' });
  edge.rect(0, 0, 14, 250, f.primary, { name: 'Edge' });
  seam(edge, f, 14, 250);
  const rows = f.actions.map(a => ({ name: a.name, art: a.art, workers: String(a.workers), pay1: a.pay?.[0] ?? '', pay2: a.pay?.[1] ?? '', effect: a.effect, support: a.support ? 'yes' : '' }));
  return component(ID.f(f, 'actions'), `${f.short} · Actions`, 'card', 175, 250, {
    color: PAPER, front: L.nodes, back: back(f, 175, 250, 'Action'), ...withRows(['name', 'art', 'workers', 'pay1', 'pay2', 'effect', 'support'], rows),
    flippable: true, hand: true, stackable: true, shufflable: true,
  });
}

export function supports(f: Faction): Component {
  const L = new Layers('front'), d = L.draw();
  header(d, f, 'Support', 24, 84);
  d.rect(0, 0, 14, 250, f.primary, { name: 'Support edge' });
  seam(d, f, 0, 250);
  slot(d, 'pay1', 24, 99, 30); slot(d, 'pay2', 58, 99, 30);
  d.text(24, 99, 126, 30, 'No extra cost', { name: 'No cost', size: 9, color: MUTED, visibilityField: '{{pay1}}', visibilityValue: '' });
  d.rect(24, 142, 138, 1.5, rgba(INK, 0.12), { name: 'Divider' });
  d.textTop(24, 150, 138, '{{effect}}', { name: 'Effect', size: 10.5 });
  footer(d, f, 24, 232, 138);
  const rows = f.supports.map(s => ({ name: s.name, art: s.art, pay1: s.pay?.[0] ?? '', pay2: s.pay?.[1] ?? '', effect: s.effect }));
  return component(ID.f(f, 'supports'), `${f.short} · Supports`, 'card', 175, 250, {
    color: PAPER, front: L.nodes, back: back(f, 175, 250, 'Support'), ...withRows(['name', 'art', 'pay1', 'pay2', 'effect'], rows),
    flippable: true, hand: true, hideInHand: true, stackable: true, shufflable: true,
  });
}

export function buildCards(f: Faction, kind: 'unit' | 'building'): Component {
  const L = new Layers('front'), d = L.draw();
  d.rect(0, 0, 250, 212, f.primary, { name: 'Art panel' });
  backdrop(d, f, 125, 120, 74, 2.5, kind === 'building');
  art(d, 72, 67, 106);
  d.text(16, 10, 218, 30, '{{name}}', { name: 'Name', size: 18, font: TITLE, color: WHITE });
  d.text(16, 38, 218, 14, spaced(kind), { name: 'Type', size: 7.5, color: f.secondary });
  COST_FIELDS.forEach((field, i) => slot(d, field, 14 + i * 37, 194, 34));
  const also = d.frame(14, 236, 222, 30, { name: 'Also band' });
  also.rect(0, 0, 222, 30, PILL, { name: 'Band', radius: 15 });
  also.text(12, 0, 34, 30, 'ALSO', { name: 'Label', size: 7.5, color: MUTED });
  slot(also, 'pay1', 42, 3, 24); slot(also, 'pay2', 68, 3, 24);
  also.text(98, 0, 116, 30, '{{extra}}', { name: 'Extra', size: 9 });
  also.rect(40, 0, 182, 30, PILL, { name: 'No icons cover', radius: 15, visibilityField: '{{pay1}}', visibilityValue: '' });
  also.text(44, 0, 170, 30, '{{extra}}', { name: 'Extra (no icons)', size: 9, visibilityField: '{{pay1}}', visibilityValue: '' });
  d.textTop(16, 276, 218, '{{effect}}', { name: 'Effect', size: 12.5 });
  d.rect(0, 231, 250, 96, PAPER, { name: 'No-also cover', visibilityField: '{{pay1}}{{extra}}', visibilityValue: '' });
  d.textTop(16, 244, 218, '{{effect}}', { name: 'Effect (no also)', size: 12.5, visibilityField: '{{pay1}}{{extra}}', visibilityValue: '' });
  footer(d, f, 16, 330, 218);
  const cards = kind === 'unit' ? f.units : f.buildings;
  const rows = cards.map(c => ({
    name: c.name, art: c.art, ...Object.fromEntries(COST_FIELDS.map((field, i) => [field, c.cost[i] ?? ''])),
    pay1: c.pay?.[0] ?? '', pay2: c.pay?.[1] ?? '', extra: c.extra ?? '', effect: c.effect,
  }));
  return component(ID.f(f, kind === 'unit' ? 'units' : 'buildings'), `${f.short} · ${kind === 'unit' ? 'Units' : 'Buildings'}`, 'card', 250, 350, {
    color: PAPER, front: L.nodes, back: back(f, 250, 350, kind), ...withRows(['name', 'art', ...COST_FIELDS, 'pay1', 'pay2', 'extra', 'effect'], rows),
    flippable: true, hand: true, stackable: true, shufflable: true,
  });
}

export function achievements(f: Faction): Component {
  const L = new Layers('front'), d = L.draw();
  d.rect(0, 124, 250, 51, PAPER, { name: 'Cost band' });
  backdrop(d, f, 60, 58, 46, 2);
  art(d, 25, 23, 70);
  d.text(116, 12, 122, 54, '{{name}}', { name: 'Name', size: 15, font: TITLE, color: WHITE });
  d.text(116, 68, 122, 14, spaced('Achievement'), { name: 'Type', size: 6.5, color: f.secondary });
  COST_FIELDS.forEach((field, i) => slot(d, field, 14 + i * 37, 106, 34));
  footer(d, f, 16, 155, 218);
  const rows = f.achievements.map(a => ({ name: a.name, art: a.art, ...Object.fromEntries(COST_FIELDS.map((field, i) => [field, a.cost[i] ?? ''])) }));
  return component(ID.f(f, 'achievements'), `${f.short} · Achievements`, 'card', 250, 175, {
    color: f.primary, front: L.nodes, back: back(f, 250, 175, 'Achievement'), ...withRows(['name', 'art', ...COST_FIELDS], rows),
    flippable: true, hand: true, stackable: true, shufflable: true,
  });
}

/** Shared card back: faction colours, emblem ring, wordmark and the card type. */
function back(f: Faction, w: number, h: number, label: string) {
  const L = new Layers('back'), d = L.draw(), s = Math.min(w, h);
  d.rect(0, 0, w, h, f.primary, { name: 'Field' });
  d.path(roundRectPts(9, 9, w - 18, h - 18, 8), 'transparent', { name: 'Inset', stroke: rgba(f.secondary, 0.45), sw: 1.5 });
  const cy = h / 2 - s * 0.08, r = s * 0.27;
  d.path(circlePts(w / 2, cy, r), mix(f.primary, WHITE, 0.13), { name: 'Emblem ring', stroke: f.secondary, sw: 3 });
  fixedArt(d, f.emblem, w / 2 - r * 0.62, cy - r * 0.62, r * 1.24);
  d.text(0, cy + r + 8, w, 22, f.name.toUpperCase(), { name: 'Wordmark', size: s > 200 ? 15 : 12, font: WORDMARK, color: f.secondary, align: 'center' });
  d.text(0, cy + r + 30, w, 14, spaced(label), { name: 'Type', size: 7.5, color: WHITE, align: 'center', opacity: 0.8 });
  return L.nodes;
}

export function reminder(f: Faction): Component {
  const L = new Layers('front'), d = L.draw();
  d.rect(0, 0, 250, 62, f.primary, { name: 'Header' });
  fixedArt(d, f.emblem, 200, 12, 36);
  d.text(16, 8, 180, 30, f.name, { name: 'Faction', size: 16, font: TITLE, color: WHITE });
  d.text(16, 38, 180, 14, spaced('Player reminder'), { name: 'Subtitle', size: 7, color: f.secondary });
  const section = (y: number, label: string) => {
    d.text(16, y, 218, 12, spaced(label), { name: label, size: 6.5, color: f.primary });
    d.rect(16, y + 13, 218, 1, rgba(f.primary, 0.25), { name: 'Rule' });
  };
  section(70, 'Resources');
  f.resources.forEach((r, i) => {
    const y = 88 + i * 23;
    resourceIcon(d, r.key, 16, y, 20);
    d.text(42, y, 120, 20, r.name, { name: r.name, size: 10 });
    d.text(150, y, 84, 20, r.rarity, { name: 'Rarity', size: 8.5, color: MUTED, align: 'end' });
  });
  section(206, 'Round');
  d.textTop(16, 222, 218, '{{round}}', { name: 'Round', size: 7.6 });
  section(276, f.special.name);
  d.textTop(16, 292, 218, '{{special}}', { name: 'Special', size: 7.6 });
  return component(ID.f(f, 'reminder'), `${f.short} · Reminder card`, 'card', 250, 350, {
    color: PAPER, front: L.nodes, back: back(f, 250, 350, 'Reminder'), ...withRows(['round', 'special'], [{ round: ROUND_REMINDER, special: f.special.reminder }]),
    flippable: true, hand: true,
  });
}

export function rulebook(id: string, name: string, kicker: string, primary: string, secondary: string, pages: Page[]): Component {
  const L = new Layers('front'), d = L.draw();
  d.rect(0, 0, 480, 100, primary, { name: 'Header' });
  d.text(28, 16, 330, 14, kicker.toUpperCase(), { name: 'Kicker', size: 8.5, color: secondary });
  d.text(28, 34, 340, 50, '{{title}}', { name: 'Title', size: 24, font: TITLE, color: WHITE });
  backdrop(d, { primary, secondary }, 426, 50, 36, 2);
  art(d, 400, 24, 52);
  d.textTop(32, 122, 416, '{{body}}', { name: 'Body', size: 12 });
  d.rect(32, 646, 416, 1, rgba(primary, 0.2), { name: 'Rule' });
  d.text(32, 652, 416, 16, `${GAME.name.toUpperCase()}   ·   {{page}}`, { name: 'Page', size: 8, color: MUTED, align: 'end' });
  const rows = pages.map((p, i) => ({ page: String(i + 1), title: p.title, art: p.art, body: p.body }));
  return component(id, name, 'card', 480, 680, { color: PAPER, front: L.nodes, ...withRows(['page', 'title', 'art', 'body'], rows), hand: true, stackable: true });
}
export const factionRulebook = (f: Faction) => rulebook(ID.f(f, 'rules'), `${f.short} · Rulebook`, `${f.name} · Rulebook`, f.primary, f.secondary, factionPages(f));
export const coreRulebook = () => rulebook(ID.coreRules, 'Core rulebook', `${GAME.name} · Core rules`, GAME.primary, GAME.secondary, CORE_RULES);

// ---------------------------------------------------------------- tokens
export function resourceTokens(f: Faction): Component {
  const L = new Layers('front'), d = L.draw();
  f.resources.forEach(r => d.nest(0, 0, 80, 80, ID.res(r.key), { name: r.name, visibilityField: '{{key}}', visibilityValue: r.key }));
  return component(ID.f(f, 'resources'), `${f.short} · Resources`, 'token', 80, 80, {
    color: WHITE, front: L.nodes, ...withRows(['key', 'name', 'rarity'], f.resources.map(r => ({ key: r.key, name: r.name, rarity: r.rarity }))),
  });
}
export function workers(f: Faction): Component {
  const L = new Layers('front'), d = L.draw();
  d.ring(28, 28, 24.5, f.secondary, 2.5);
  d.ell(21, 10, 14, 14, f.secondary, { name: 'Head' });
  d.path(workerPts(13, 21, 30, 25), f.secondary, { name: 'Body' });
  return component(ID.f(f, 'workers'), `${f.short} · Worker`, 'token', 56, 56, { color: f.primary, front: L.nodes });
}
function marker(f: Faction, part: string, name: string, size: number, draw: (d: Draw) => void): Component {
  const L = new Layers('front'); draw(L.draw());
  return component(ID.f(f, part), `${f.short} · ${name}`, 'token', size, size, { color: f.secondary, front: L.nodes });
}
export function firstPlayer(): Component {
  const L = new Layers('front'), d = L.draw();
  d.ring(36, 36, 31, GAME.secondary, 2.5);
  fixedArt(d, 'crown', 20, 12, 32);
  d.text(0, 44, 72, 16, 'FIRST', { name: 'Label', size: 9, font: TITLE, color: GAME.secondary, align: 'center' });
  return component(ID.firstPlayer, 'First player', 'token', 72, 72, { color: GAME.primary, front: L.nodes });
}

// ---------------------------------------------------------------- special pieces
function boardTitle(d: Draw, f: Faction, title: string, subtitle: string) {
  d.text(20, 10, 300, 26, title, { name: 'Title', size: 16, font: TITLE, color: WHITE });
  d.text(20, 34, 380, 14, spaced(subtitle), { name: 'Subtitle', size: 7, color: f.secondary });
}
export function specialPieces(f: Faction): Component[] {
  if (f.key === 'brass') {
    const L = new Layers('front'), d = L.draw();
    boardTitle(d, f, 'Boiler Gauge', 'Pressure');
    for (let i = 0; i <= 6; i++) {
      const x = 20 + i * 56;
      d.path(polyPts(x + 24, 80, 26, 6), rgba(WHITE, i % 2 ? 0.06 : 0.12), { name: `Cell ${i}`, stroke: f.secondary, sw: 2 });
      d.text(x, 64, 48, 32, String(i), { name: `Value ${i}`, size: 17, font: TITLE, color: f.secondary, align: 'center' });
    }
    d.text(20, 116, 380, 32, 'VENT  Spend 2 Pressure to supply 1 worker of the action you use (once per action). Max 6.', { name: 'Rule', size: 9, color: rgba(WHITE, 0.85) });
    const board = component(ID.f(f, 'board'), `${f.short} · Boiler Gauge`, 'board', 420, 160, { color: f.primary, front: L.nodes });
    const pressure = marker(f, 'pressure', 'Pressure marker', 44, m => {
      m.ring(22, 22, 13, f.primary, 3.5); m.rect(20, 7, 4, 30, f.primary); m.rect(7, 20, 30, 4, f.primary); m.ell(17, 17, 10, 10, f.primary);
    });
    return [board, pressure];
  }
  if (f.key === 'verdant') {
    const L = new Layers('front'), d = L.draw();
    boardTitle(d, f, 'The Grove', 'Plant · grow · harvest');
    const stages: [string, string[]][] = [['Bloom', ['moonpetal']], ['Bud', ['bark', 'silkvine']], ['Sprout', ['sap']]];
    stages.forEach(([stage, yields], row) => {
      const y = 58 + row * 74;
      d.text(20, y + 6, 100, 18, stage.toUpperCase(), { name: stage, size: 10, font: TITLE, color: WHITE });
      yields.forEach((key, i) => resourceIcon(d, key, 20 + i * 30, y + 30, 26));
      for (let c = 0; c < 4; c++) d.rect(126 + c * 76, y, 66, 66, c === 3 ? rgba(f.secondary, 0.22) : rgba(WHITE, 0.1), { name: `${stage} ${c + 1}`, radius: 14 });
    });
    ['Plot 1', 'Plot 2', 'Plot 3', 'Greenhouse'].forEach((label, c) => d.text(122 + c * 76, 280, 74, 14, label.toUpperCase(), { name: label, size: 6.5, color: c === 3 ? f.secondary : rgba(WHITE, 0.7), align: 'center' }));
    const board = component(ID.f(f, 'board'), `${f.short} · Grove`, 'board', 440, 304, { color: f.primary, front: L.nodes });
    const seed = marker(f, 'seeds', 'Seed', 44, m => {
      m.rect(20.5, 18, 3, 16, f.primary, { radius: 1.5 }); m.path(leafPts(22, 22, 9, 13, 5), f.primary); m.path(leafPts(22, 19, 35, 10, 5), f.primary);
      m.ell(12, 31, 20, 6, f.primary, { opacity: 0.5 });
    });
    return [board, seed];
  }
  if (f.key === 'cinder') {
    const L = new Layers('front'), d = L.draw();
    boardTitle(d, f, 'The Crucible', 'Heat');
    for (let i = 0; i <= 7; i++) {
      const x = 20 + i * 53, fill = i === 7 ? '#E2372B' : i >= 3 ? rgba(f.secondary, 0.45) : rgba(WHITE, 0.1);
      d.rect(x, 56, 47, 56, fill, { name: `Cell ${i}`, radius: 10 });
      d.text(x, 58, 47, 28, String(i), { name: `Value ${i}`, size: 16, font: TITLE, color: i === 7 ? WHITE : f.secondary, align: 'center' });
    }
    d.ell(409.5, 86, 10, 10, WHITE, { name: 'Worker head' }); d.path(workerPts(399.5, 95, 30, 14), WHITE, { name: 'Worker body' });
    [['Cool', 20, 153], ['Hot', 179, 206], ['Overheat', 391, 47]].forEach(([label, x, w]) =>
      d.text(x as number, 116, w as number, 12, String(label).toUpperCase(), { name: String(label), size: 7, color: rgba(WHITE, 0.75), align: 'center' }));
    d.text(20, 134, 420, 20, 'Hot at 3+ · At 7: set Heat to 3, one worker sits out a round · Dawn: −1 Heat', { name: 'Rule', size: 8.5, color: rgba(WHITE, 0.85) });
    const board = component(ID.f(f, 'board'), `${f.short} · Crucible`, 'board', 460, 162, { color: f.primary, front: L.nodes });
    const heat = marker(f, 'heat', 'Heat marker', 44, m => { m.path(flamePts(22, 7, 22, 30), f.primary); m.path(flamePts(22, 21, 9, 14), f.secondary); });
    return [board, heat];
  }
  // Starwright
  const faces = ['abundant', 'abundant', 'common', 'uncommon', 'insight', 'rare'];
  const L = new Layers('front'), d = L.draw();
  d.ring(40, 40, 33, f.secondary, 2, { opacity: 0.6 });
  for (const r of RARITIES) rarityIcon(d, r, 16, 16, 48, { visibilityField: '{{face}}', visibilityValue: r });
  d.star(14, 14, 52, 52, 4, 0.34, f.secondary, { name: 'Insight', visibilityField: '{{face}}', visibilityValue: 'insight' });
  const die = component(ID.f(f, 'orrery'), `${f.short} · Orrery die`, 'dice', 80, 80, { color: f.primary, front: L.nodes, ...withRows(['face'], faces.map(face => ({ face }))) });
  const insight = marker(f, 'insight', 'Insight', 48, m => { m.star(10, 10, 28, 28, 4, 0.34, f.primary); m.star(31, 7, 9, 9, 4, 0.34, f.primary); });
  return [die, insight];
}
