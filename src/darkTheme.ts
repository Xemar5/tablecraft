// Build-time PostCSS plugin that derives night mode from the light stylesheets.
// Every rule with color-related declarations is mirrored under `:root[data-theme=dark]`
// with lightness inverted (hue kept), so new styles get a dark variant automatically.
// Mirroring all color-related declarations, not only literal colors, keeps the
// original specificity and source order between rules in dark mode. Rules whose selector
// contains `[data-theme-fixed]` keep their colors in both themes (e.g. theme previews).

export const DARK_SELECTOR = ':root[data-theme=dark]';

type Rgba = { r: number; g: number; b: number; a: number };

const NAMED: Record<string, string> = { white: '#ffffff', black: '#000000' };
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/g;
const HAS_COLOR = new RegExp(COLOR.source);
const PAINT_PROP = /^(?:color|fill|stroke|filter|caret-color|accent-color|background(?:-color|-image)?|(?:border|outline|column-rule|text-decoration)(?:-(?:top|right|bottom|left|block|inline)(?:-start|-end)?)?(?:-color)?|.*shadow.*)$/;

function parse(color: string): Rgba | undefined {
  const value = NAMED[color.toLowerCase()] ?? color;
  if (value.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map(c => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return undefined;
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
  }
  const parts = value.slice(value.indexOf('(') + 1, -1).split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return undefined;
  const channel = (p: string) => p.endsWith('%') ? parseFloat(p) * 2.55 : parseFloat(p);
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  const rgba = { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
  return Object.values(rgba).every(Number.isFinite) ? rgba : undefined;
}

function toHsl({ r, g, b }: Rgba) {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === rr ? ((gg - bb) / d + 6) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return { h: h * 60, s, l };
}

function fromHsl(h: number, s: number, l: number, a: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${hex(r + m)}${hex(g + m)}${hex(b + m)}${a < 1 ? hex(a) : ''}`;
}

/** Maps one light-theme color to its night-mode counterpart. */
export function darkColor(color: string, shadow = false): string {
  const rgba = parse(color);
  if (!rgba) return color;
  const { h, s, l } = toHsl(rgba);
  // Shadows and dimming overlays stay dark (and a little stronger) instead of turning into glows.
  if ((shadow || rgba.a < 1) && l < 0.42) return fromHsl(h, s * 0.5, l * 0.35, Math.min(1, rgba.a * (shadow ? 2 : 1.4)));
  // Light ink becomes a soft gray rather than a bright white.
  const nextL = 0.11 + 0.72 * Math.pow(1 - l, 0.85);
  // Keep chroma rather than HSL saturation, so near-white tinted paper doesn't turn into olive,
  // then mute it: tinted neutrals turn gray while strong accents keep some of their color.
  const chroma = s * (1 - Math.abs(2 * l - 1));
  const t = Math.min(1, Math.max(0, (chroma - 0.08) / 0.32));
  const muted = chroma * (0.12 + 0.68 * t * t * (3 - 2 * t));
  return fromHsl(h, Math.min(1, muted / Math.max(0.01, 1 - Math.abs(2 * nextL - 1))), nextL, rgba.a);
}

export function darkValue(prop: string, value: string): string {
  const shadow = /shadow|filter/.test(prop);
  return value.replace(COLOR, match => darkColor(match, shadow));
}

export function darkSelector(selector: string): string {
  return selector.split(',').map(part => {
    const s = part.trim();
    if (s === ':root' || s === 'html') return DARK_SELECTOR;
    if (s.startsWith(':root') || s.startsWith('html')) return DARK_SELECTOR + s.replace(/^(:root|html)/, '');
    return `${DARK_SELECTOR} ${s}`;
  }).join(',');
}

const mirrors = (prop: string, value: string) => prop.startsWith('--')
  ? HAS_COLOR.test(value)
  : PAINT_PROP.test(prop) && !/-(?:radius|width|style|collapse|spacing)$/.test(prop);

// Minimal structural PostCSS types so the plugin doesn't depend on postcss directly.
type Decl = { type: 'decl'; prop: string; value: string; important?: boolean };
type Node = Decl | { type: string };
type Rule = { selector: string; nodes: Node[]; parent?: { type: string; name?: string }; clone(overrides?: object): Rule; removeAll(): Rule; append(node: object): Rule; after(node: Rule): Rule };
type Root = { walkRules(cb: (rule: Rule) => void): void; append(node: object): void };

export function darkThemePlugin() {
  return {
    postcssPlugin: 'tablecraft-dark-theme',
    Once(rootNode: unknown, helpers: unknown) {
      const root = rootNode as Root, RuleCtor = (helpers as { Rule: new (props: object) => Rule }).Rule;
      const generated = new WeakSet<Rule>();
      root.walkRules(rule => {
        if (generated.has(rule) || rule.selector.includes('[data-theme-fixed]') || (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name ?? ''))) return;
        const decls = rule.nodes.filter((n): n is Decl => n.type === 'decl' && mirrors((n as Decl).prop, (n as Decl).value));
        if (!decls.length) return;
        const dark = rule.clone({ selector: darkSelector(rule.selector) }).removeAll();
        for (const d of decls) dark.append({ prop: d.prop, value: darkValue(d.prop, d.value), important: d.important });
        generated.add(dark);
        rule.after(dark);
      });
      const scheme = new RuleCtor({ selector: DARK_SELECTOR });
      scheme.append({ prop: 'color-scheme', value: 'dark' });
      root.append(scheme);
    },
  };
}
darkThemePlugin.postcss = true;
