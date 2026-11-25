import { z } from 'zod';

/**
 * Tags and tag filters. Components list stack tags (and grid tags); a stack or a grid has a filter deciding which
 * components it takes. A filter is a list of rules and accepts a component when any rule matches: a rule matches when
 * the component has all of its `has` tags and none of its `lacks` tags. So "(blue and red) or not white" is
 * `{ anyOf: [{ has: ['blue', 'red'], lacks: [] }, { has: [], lacks: ['white'] }] }`. Tags compare without case.
 * Components without tags match every filter, and a filter without rules accepts everything.
 */
export const tagSchema = z.string().trim().min(1).max(60);
export const tagRuleSchema = z.object({ has: z.array(tagSchema).max(20).default([]), lacks: z.array(tagSchema).max(20).default([]) });
export const tagFilterSchema = z.object({ anyOf: z.array(tagRuleSchema).max(20) });
export type TagRule = z.infer<typeof tagRuleSchema>;
export type TagFilter = z.infer<typeof tagFilterSchema>;
export const ANY_TAGS: TagFilter = { anyOf: [] };

export const tagKey = (tag: string) => tag.trim().toLowerCase();

/** Trimmed tags without blanks or repeats (compared without case), in their first spelling. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>(), result: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim(), key = tagKey(trimmed);
    if (!trimmed || seen.has(key)) continue;
    seen.add(key); result.push(trimmed.slice(0, 60));
  }
  return result;
}

/** Whether a component with these tags passes a filter. Untagged components and rule-less filters always pass. */
export function matchesTags(filter: TagFilter | undefined, tags: readonly string[]): boolean {
  if (!tags.length || !filter?.anyOf.length) return true;
  const keys = new Set(tags.map(tagKey));
  return filter.anyOf.some(rule => rule.has.every(tag => keys.has(tagKey(tag))) && !rule.lacks.some(tag => keys.has(tagKey(tag))));
}

/**
 * The tags every tagged list shares (untagged lists don't count). `shared` is false when tagged lists have nothing in
 * common, so they can't go together.
 */
export function commonTags(lists: readonly (readonly string[])[]): { tags: string[]; shared: boolean } {
  const tagged = lists.filter(list => list.length);
  if (!tagged.length) return { tags: [], shared: true };
  const tags = normalizeTags(tagged[0]).filter(tag => tagged.every(list => list.some(other => tagKey(other) === tagKey(tag))));
  return { tags, shared: tags.length > 0 };
}

/** A filter taking components with any of these tags (and, as always, untagged ones). */
export const filterFromTags = (tags: readonly string[]): TagFilter => ({ anyOf: normalizeTags(tags).map(tag => ({ has: [tag], lacks: [] })) });

/** Every tag a filter mentions. */
export const filterTags = (filter: TagFilter | undefined) => normalizeTags((filter?.anyOf ?? []).flatMap(rule => [...rule.has, ...rule.lacks]));

/** A filter as plain words, such as “blue and red, or not white”. */
export function describeFilter(filter: TagFilter | undefined, empty = 'any piece'): string {
  if (!filter?.anyOf.length) return empty;
  const rules = filter.anyOf.map(rule => {
    const parts = [...rule.has, ...rule.lacks.map(tag => `not ${tag}`)];
    return parts.length ? parts.join(' and ') : 'anything';
  });
  return rules.length > 1 ? `${rules.slice(0, -1).join(', ')} or ${rules.at(-1)}` : rules[0];
}

export const sameFilter = (a: TagFilter | undefined, b: TagFilter | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
