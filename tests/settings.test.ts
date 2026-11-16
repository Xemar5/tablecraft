import { describe, expect, it } from 'vitest';
import { DEFAULT_COLOR, DEFAULT_DATABASE, DEFAULT_SERVER, defaultSettings, parseSettings, resolveTheme } from '../src/settings';

describe('user settings', () => {
  it('falls back to defaults for missing or malformed storage', () => {
    expect(parseSettings(null)).toEqual(defaultSettings());
    expect(parseSettings('not json')).toEqual(defaultSettings());
    expect(parseSettings('[1]')).toMatchObject({ server: DEFAULT_SERVER, database: DEFAULT_DATABASE, color: DEFAULT_COLOR, theme: 'system', name: '' });
  });

  it('keeps valid fields and replaces only the invalid ones', () => {
    const settings = parseSettings(JSON.stringify({ name: 'Ada', color: 'red', server: 'https://maincloud.spacetimedb.com', database: '', theme: 'neon' }));
    expect(settings).toEqual({ name: 'Ada', color: DEFAULT_COLOR, server: 'https://maincloud.spacetimedb.com', database: DEFAULT_DATABASE, theme: 'system' });
    expect(parseSettings(JSON.stringify({ color: '#11223344', theme: 'dark' }))).toMatchObject({ color: '#11223344', theme: 'dark' });
  });

  it('resolves the system theme from the device preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
