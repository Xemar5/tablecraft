import { z } from 'zod';

export type ThemePreference = 'system' | 'light' | 'dark';

const SETTINGS_KEY = 'tablecraft.settings.v1';
export const DEFAULT_SERVER = import.meta.env.VITE_SPACETIMEDB_URI ?? 'http://127.0.0.1:3000';
export const DEFAULT_DATABASE = import.meta.env.VITE_SPACETIMEDB_DATABASE ?? 'tablecraft-studio';
export const DEFAULT_COLOR = '#b7cc91';

// Each field falls back on its own, so one invalid value doesn't reset the rest.
export const userSettingsSchema = z.object({
  name: z.string().max(50).catch(''),
  color: z.string().regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/).catch(DEFAULT_COLOR),
  server: z.string().min(1).max(500).catch(DEFAULT_SERVER),
  database: z.string().min(1).max(100).catch(DEFAULT_DATABASE),
  theme: z.enum(['system', 'light', 'dark']).catch('system'),
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

export function loadSettings(): UserSettings {
  try { return parseSettings(localStorage.getItem(SETTINGS_KEY)); } catch { return defaultSettings(); }
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
