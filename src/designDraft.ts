import { z } from 'zod';
import { applyCommand, componentSchema, validateComponentEdit, type Archive, type Component, type Project } from './domain';

/**
 * Designer edits are held in a draft and reach the project (and a live room) only when the playground is shown
 * again, so editing never re-validates, re-saves or re-sends the whole project. The draft is saved on its own.
 */
export const DESIGN_DRAFT_KEY = 'tablecraft.design-draft.v1';

/** One pending `component` command. */
export type DraftEdit = { component: Component; removedDataRow?: number };
export type DesignDraft = { projectId: string; edits: DraftEdit[] };

const draftSchema = z.object({
  projectId: z.string().min(1).max(100),
  edits: z.array(z.object({ component: componentSchema, removedDataRow: z.number().int().min(0).optional() })).min(1).max(5000),
});

/** The components as the designer sees them: the project's, with each drafted design in place. */
export function draftComponents(components: Component[], edits: DraftEdit[]): Component[] {
  if (!edits.length) return components;
  const latest = new Map(edits.map(edit => [edit.component.id, edit.component]));
  const next = components.map(component => latest.get(component.id) ?? component);
  for (const [id, component] of latest) if (!components.some(item => item.id === id)) next.push(component);
  return next;
}

/** Applies a draft to its project for the designer's view; other projects are returned unchanged. */
export function withDraft(project: Project, draft: DesignDraft | undefined): Project {
  return draft?.projectId === project.id && draft.edits.length ? { ...project, components: draftComponents(project.components, draft.edits) } : project;
}

/** Checks each pending edit in order, starting from the project's components. Throws on the first invalid one. */
function replay(components: Component[], edits: DraftEdit[]) {
  let current = components;
  for (const edit of edits) current = validateComponentEdit(current, edit.component, edit.removedDataRow);
  return current;
}

/**
 * Adds a designer change to the pending edits after checking it like the `component` command would. Each edit is a
 * state the designer really had, so replaying the edits in order is valid at every step: a change to the component
 * edited last replaces that edit, and a change to another one moves its earlier edit to the end when that still
 * replays cleanly. Page and dice-face removals are kept as their own steps so pieces are remapped once per removal.
 */
export function addDraftEdit(components: Component[], edits: DraftEdit[], component: Component, removedDataRow?: number): DraftEdit[] {
  validateComponentEdit(draftComponents(components, edits), component, removedDataRow);
  const edit: DraftEdit = removedDataRow === undefined ? { component } : { component, removedDataRow };
  if (removedDataRow !== undefined) return [...edits, edit];
  const last = edits.at(-1);
  if (last?.component.id === component.id && last.removedDataRow === undefined) return [...edits.slice(0, -1), edit];
  let previous = edits.length - 1;
  while (previous >= 0 && edits[previous].component.id !== component.id) previous--;
  if (previous < 0 || edits[previous].removedDataRow !== undefined) return [...edits, edit];
  const compacted = [...edits.slice(0, previous), ...edits.slice(previous + 1), edit];
  try { replay(components, compacted); return compacted; }
  catch { return [...edits, edit]; }
}

export function loadDesignDraft(): DesignDraft | undefined {
  try {
    const raw = localStorage.getItem(DESIGN_DRAFT_KEY);
    return raw ? draftSchema.parse(JSON.parse(raw)) : undefined;
  } catch { return undefined; }
}

/** Returns false when the browser refuses to store the draft. */
export function saveDesignDraft(draft: DesignDraft): boolean {
  try { localStorage.setItem(DESIGN_DRAFT_KEY, JSON.stringify(draft)); return true; }
  catch { return false; }
}

export function clearDesignDraft() {
  try { localStorage.removeItem(DESIGN_DRAFT_KEY); } catch { /* Nothing to clear without storage. */ }
}

/**
 * Applies a draft left by a previous visit (the page closed while designing) to its project. Edits that no longer
 * apply are skipped and counted.
 */
export function recoverDesignDraft(archive: Archive, draft = loadDesignDraft()): { archive: Archive; recovered: number; skipped: number } {
  const project = draft && archive.projects.find(item => item.id === draft.projectId);
  if (!draft || !project) return { archive, recovered: 0, skipped: 0 };
  let next = project, recovered = 0, skipped = 0;
  for (const edit of draft.edits) {
    try { next = applyCommand(next, { type: 'component', component: edit.component, ...(edit.removedDataRow === undefined ? {} : { removedDataRow: edit.removedDataRow }) }); recovered++; }
    catch { skipped++; }
  }
  return { archive: { ...archive, projects: archive.projects.map(item => item === project ? next : item) }, recovered, skipped };
}
