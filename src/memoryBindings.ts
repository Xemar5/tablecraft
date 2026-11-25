import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Component, Memory, MemoryValue } from './domain';

/**
 * Memory values as binding fields for component layers: `{{memory.score.red}}`, with list positions from 1 as in Lua
 * (`{{memory.players.1.name}}`) and `#` for a list's or table's size (`{{memory.players.#}}`). A list of plain values
 * reads as its items joined with commas; other tables read as JSON.
 */
export function flattenMemory(memory: Memory | undefined): Record<string, string> {
  const fields: Record<string, string> = {};
  const visit = (value: MemoryValue, key: string) => {
    if (value && typeof value === 'object') {
      const items = Array.isArray(value) ? value.map((item, index) => [String(index + 1), item] as const) : Object.entries(value);
      fields[key] = Array.isArray(value) && value.every(item => typeof item !== 'object') ? value.join(', ') : JSON.stringify(value);
      fields[`${key}.#`] = String(items.length);
      for (const [name, item] of items) visit(item, `${key}.${name}`);
    } else fields[key] = String(value);
  };
  for (const [key, value] of Object.entries(memory ?? {})) visit(value, `memory.${key}`);
  return fields;
}

/** Whether any layer of a component reads memory, so only those re-render when memory changes. */
const readsMemory = new WeakMap<Component, boolean>();
export function usesMemory(component: Component): boolean {
  let known = readsMemory.get(component);
  if (known === undefined) {
    known = [...component.front, ...component.back].some(node => [node.text, node.font, node.visibilityField, node.visibilityValue].some(text => text.includes('memory.')));
    readsMemory.set(component, known);
  }
  return known;
}

export type MemoryStore = { set(memory: Memory | undefined): void; get(): Record<string, string>; subscribe(listener: () => void): () => void };
export function createMemoryStore(): MemoryStore {
  let source: Memory | undefined, fields: Record<string, string> = {};
  const listeners = new Set<() => void>();
  return {
    set(memory) {
      if (memory === source) return;
      source = memory; fields = flattenMemory(memory);
      listeners.forEach(listener => listener());
    },
    get: () => fields,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

const none: Record<string, string> = {};
const idle = () => () => {};
export const MemoryBindings = createContext<MemoryStore | undefined>(undefined);

/** The memory fields a component's layers can bind to (empty, and never re-rendering, for components that don't). */
export function useMemoryFields(component: Component): Record<string, string> {
  const store = useContext(MemoryBindings);
  const active = !!store && usesMemory(component);
  const snapshot = active ? store.get : () => none;
  return useSyncExternalStore(active ? store.subscribe : idle, snapshot, snapshot);
}
