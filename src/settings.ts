import { z } from 'zod';
import { UI_SCALE_MAX, UI_SCALE_MIN } from './uiScale';

export type ThemePreference = 'system' | 'light' | 'dark';

const SETTINGS_KEY = 'tablecraft.settings.v1';
export const DEFAULT_SERVER = import.meta.env.VITE_SPACETIMEDB_URI ?? 'http://127.0.0.1:3000';
export const DEFAULT_DATABASE = import.meta.env.VITE_SPACETIMEDB_DATABASE ?? 'tablecraft-studio';
export const DEFAULT_COLOR = '#b7cc91';

export const NAME_LIMIT = 32;
/** Names are printable ASCII only, up to 32 characters. Whitespace is kept while typing and trimmed before use. */
export const cleanName = (name: string) => name.replace(/[^\x20-\x7E]/g, '').slice(0, NAME_LIMIT);
export const validName = (name: string) => cleanName(name).trim().length > 0;

/** A random, fully opaque player color with enough saturation to stand out on the table. */
export function randomColor(random = Math.random) {
  const h = random() * 360, s = .5 + random() * .25, l = .5 + random() * .12;
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const channel = (n: number) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * 255).toString(16).padStart(2, '0');
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

// Each field falls back on its own, so one invalid value doesn't reset the rest.
export const userSettingsSchema = z.object({
  name: z.string().transform(cleanName).catch(''),
  // The default color is always opaque; older saves with alpha keep their RGB.
  color: z.string().regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/).transform(color => color.slice(0, 7).toLowerCase()).catch(DEFAULT_COLOR),
  server: z.string().min(1).max(500).catch(DEFAULT_SERVER),
  database: z.string().min(1).max(100).catch(DEFAULT_DATABASE),
  theme: z.enum(['system', 'light', 'dark']).catch('system'),
  /** Interface scale in percent (50–200), applied to the whole page. */
  uiScale: z.number().int().min(UI_SCALE_MIN).max(UI_SCALE_MAX).catch(100),
  /** Set once the first-launch profile (a name) is complete. */
  onboarded: z.boolean().catch(false),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

export const defaultSettings = (): UserSettings => userSettingsSchema.parse({});

export function parseSettings(raw: string | null): UserSettings {
  if (!raw) return defaultSettings();
  try {
    const value: unknown = JSON.parse(raw);
    return userSettingsSchema.parse(typeof value === 'object' && value !== null ? value : {});
  } catch { return defaultSettings(); }
}

/** On first launch (nothing saved yet) the profile starts with a random color, saved so it survives a reload. */
export function loadSettings(): UserSettings {
  let raw: string | null = null;
  try { raw = localStorage.getItem(SETTINGS_KEY); } catch { /* storage unavailable: use defaults */ }
  if (raw !== null) return parseSettings(raw);
  const fresh = { ...defaultSettings(), color: randomColor() };
  saveSettings(fresh);
  return fresh;
}

export function saveSettings(settings: UserSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(userSettingsSchema.parse(settings))); return true; } catch { return false; }
}

export function resolveTheme(theme: ThemePreference, prefersDark: boolean): 'light' | 'dark' {
  return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
}

const prefersDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

export function applyTheme(theme: ThemePreference) {
  document.documentElement.dataset.theme = resolveTheme(theme, prefersDark());
}

/** Applies the theme and follows OS changes while the preference is `system`. */
export function watchTheme(theme: ThemePreference) {
  applyTheme(theme);
  if (theme !== 'system' || typeof matchMedia !== 'function') return () => {};
  const query = matchMedia('(prefers-color-scheme: dark)');
  const update = () => applyTheme(theme);
  query.addEventListener('change', update);
  return () => query.removeEventListener('change', update);
}
