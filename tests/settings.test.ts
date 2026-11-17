import { describe, expect, it } from 'vitest';
import { cleanName, DEFAULT_COLOR, DEFAULT_DATABASE, DEFAULT_SERVER, defaultSettings, parseSettings, randomColor, resolveTheme, validName } from '../src/settings';

describe('user settings', () => {
  it('falls back to defaults for missing or malformed storage', () => {
    expect(parseSettings(null)).toEqual(defaultSettings());
    expect(parseSettings('not json')).toEqual(defaultSettings());
    expect(parseSettings('[1]')).toMatchObject({ server: DEFAULT_SERVER, database: DEFAULT_DATABASE, color: DEFAULT_COLOR, theme: 'system', name: '', onboarded: false });
  });

  it('keeps valid fields and replaces only the invalid ones', () => {
    const settings = parseSettings(JSON.stringify({ name: 'Ada', color: 'red', server: 'https://maincloud.spacetimedb.com', database: '', theme: 'neon' }));
    expect(settings).toEqual({ name: 'Ada', color: DEFAULT_COLOR, server: 'https://maincloud.spacetimedb.com', database: DEFAULT_DATABASE, theme: 'system', uiScale: 100, onboarded: false });
    expect(parseSettings(JSON.stringify({ color: '#11223344', theme: 'dark', onboarded: true }))).toMatchObject({ color: '#112233', theme: 'dark', onboarded: true });
  });

  it('keeps the interface scale between 50% and 200%', () => {
    expect(defaultSettings().uiScale).toBe(100);
    expect(parseSettings(JSON.stringify({ uiScale: 125 })).uiScale).toBe(125);
    for (const uiScale of [20, 400, 'big', 99.5]) expect(parseSettings(JSON.stringify({ uiScale })).uiScale).toBe(100);
  });

  it('limits names to 32 printable ASCII characters and requires more than whitespace', () => {
    expect(cleanName('Zoë 🎲 Ada')).toBe('Zo  Ada');
    expect(cleanName('x'.repeat(40))).toHaveLength(32);
    expect(parseSettings(JSON.stringify({ name: 'Åsa'.padEnd(40, 'b') })).name).toBe('sa'.padEnd(32, 'b'));
    expect(validName('   ')).toBe(false);
    expect(validName(' Ada ')).toBe(true);
    expect(validName('🎲')).toBe(false);
  });

  it('picks opaque random colors', () => {
    for (const value of [0, .3, .99]) expect(randomColor(() => value)).toMatch(/^#[0-9a-f]{6}$/);
    expect(randomColor(() => 0)).not.toBe(randomColor(() => .5));
  });

  it('resolves the system theme from the device preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
