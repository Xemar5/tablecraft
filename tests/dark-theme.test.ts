import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { darkColor, darkSelector, darkThemePlugin, darkValue } from '../src/darkTheme';

const lightness = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
};

describe('dark theme colors', () => {
  it('inverts lightness so surfaces turn dark and ink turns light', () => {
    expect(lightness(darkColor('#ffffff'))).toBeLessThan(0.15);
    expect(lightness(darkColor('white'))).toBeLessThan(0.15);
    expect(lightness(darkColor('#293d36'))).toBeGreaterThan(0.7);
    expect(lightness(darkColor('rgb(41, 61, 54)'))).toBeGreaterThan(0.7);
  });

  it('keeps hue and alpha, and keeps shadows and dimming overlays dark', () => {
    const accent = darkColor('#365d46');
    expect(parseInt(accent.slice(3, 5), 16)).toBeGreaterThan(parseInt(accent.slice(1, 3), 16));
    expect(darkColor('#fffffff5')).toMatch(/^#[0-9a-f]{6}f5$/);
    expect(lightness(darkColor('#1a302c60'))).toBeLessThan(0.15);
    expect(darkValue('box-shadow', '0 2px 4px #20362612')).toMatch(/^0 2px 4px #[0-9a-f]{6}24$/);
    expect(lightness(darkValue('filter', 'drop-shadow(0 1px 2px #293d36)').match(/#[0-9a-f]{6}/)![0])).toBeLessThan(0.15);
  });

  it('leaves non-colors alone', () => {
    expect(darkColor('transparent')).toBe('transparent');
    expect(darkValue('background', 'url(a.png) no-repeat')).toBe('url(a.png) no-repeat');
  });

  it('scopes selectors under the dark root', () => {
    expect(darkSelector(':root')).toBe(':root[data-theme=dark]');
    expect(darkSelector('html, .a>.b:hover')).toBe(':root[data-theme=dark],:root[data-theme=dark] .a>.b:hover');
  });
});

describe('dark theme PostCSS plugin', () => {
  const run = async (css: string) => (await postcss([darkThemePlugin()]).process(css, { from: undefined })).css;

  it('mirrors color declarations right after each rule, preserving rule order and media queries', async () => {
    const css = await run('.a{color:#fff;padding:4px}.a.b{background:none}@media(max-width:700px){.c{border-color:#000}}');
    expect(css).toContain(':root[data-theme=dark] .a{color:');
    expect(css).not.toMatch(/dark\] \.a\{[^}]*padding/);
    // Color-free paint declarations are mirrored too, so .a.b still beats .a in night mode.
    expect(css.indexOf(':root[data-theme=dark] .a.b{background:none}')).toBeGreaterThan(css.indexOf(':root[data-theme=dark] .a{'));
    expect(css).toMatch(/@media\(max-width:700px\)\{\.c\{border-color:#000\}\s*:root\[data-theme=dark\] \.c\{border-color:#[0-9a-f]{6}\}/);
    expect(css).toContain(':root[data-theme=dark]{color-scheme:dark}');
  });

  it('skips keyframes, theme-fixed previews and color-free custom properties', async () => {
    const css = await run(':root{--ink:#293d36;--gap:4px}@keyframes k{from{color:#fff}}[data-theme-fixed].s{background:#fff}');
    expect(css).toMatch(/:root\[data-theme=dark\]\{--ink:#[0-9a-f]{6}\}/);
    expect(css).not.toContain('dark] from');
    expect(css).not.toContain('dark] [data-theme-fixed]');
  });
});
