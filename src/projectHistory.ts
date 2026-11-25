import { z } from 'zod';
import { projectSchema, uid, validateProject, type Project } from './domain';
import { upgradeLegacyArtworkProject } from './templates';

/**
 * A project's saved history (browser-local, beside the workspace): its draft snapshots and its play sessions.
 *
 * A snapshot is a copy of the whole playground (designs, table, hands, seats, scripts and memory). While a project is a
 * draft, its newest draft snapshot is the latest version. A finished project has one draft snapshot as its base: a new
 * game copies the base into a new session, and saving while in a session adds to that session's snapshots. Sessions
 * remember the snapshot they started from; when the base changes they are outdated.
 *
 * The workspace keeps one working copy of each project (its head). Only one project is loaded at a time; the others'
 * heads rest at their latest draft snapshot (or the base, when finished), which other projects link to.
 */
export const DRAFT_LIMIT = 100, SESSION_LIMIT = 50, SESSION_SNAPSHOT_LIMIT = 100;
const id = z.string().min(1).max(100), name = z.string().trim().min(1).max(100);
// Snapshot projects are checked in full only when they are used (loaded or exported), not on every start.
const storedProject = z.custom<Project>(value => typeof value === 'object' && value !== null && !Array.isArray(value), 'A snapshot must hold a project.');
export const snapshotSchema = z.object({ id, name, createdAt: z.number().finite(), project: storedProject });
export const sessionSchema = z.object({
  id, name, createdAt: z.number().finite(),
  /** The draft snapshot the session started from, and its name then (it may have been renamed or deleted since). */
  baseId: id, baseName: name,
  snapshots: snapshotSchema.array().min(1).max(SESSION_SNAPSHOT_LIMIT),
});
export const historySchema = z.object({
  status: z.enum(['draft', 'finished']),
  /** The base snapshot. A draft keeps the last one, so sessions started from it are not outdated if it is chosen again. */
  baseId: id.optional(),
  snapshots: snapshotSchema.array().max(DRAFT_LIMIT),
  sessions: sessionSchema.array().max(SESSION_LIMIT),
}).superRefine((history, context) => {
  if (history.status === 'finished' && !history.snapshots.some(snapshot => snapshot.id === history.baseId)) context.addIssue({ code: 'custom', message: 'A finished project needs its base snapshot.' });
  const ids = [...history.snapshots, ...history.sessions.flatMap(session => [session, ...session.snapshots])].map(item => item.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Snapshot and session identifiers must be unique.' });
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type History = z.infer<typeof historySchema>;
/** The loaded project: where it was loaded from (a draft snapshot, or a session's), and the session it saves to. */
export type OpenProject = { projectId: string; session?: string; from?: string };

export const emptyHistory = (): History => ({ status: 'draft', snapshots: [], sessions: [] });

export function makeSnapshot(project: Project, label: string, now = Date.now()): Snapshot {
  return { id: uid('snapshot'), name: cleanLabel(label, project.name), createdAt: now, project: structuredClone(project) };
}
const cleanLabel = (label: string, fallback: string) => (label.trim() || fallback).slice(0, 100);

export function findSnapshot(history: History, snapshotId: string): { snapshot: Snapshot; session?: Session } | undefined {
  const draft = history.snapshots.find(snapshot => snapshot.id === snapshotId);
  if (draft) return { snapshot: draft };
  for (const session of history.sessions) {
    const snapshot = session.snapshots.find(item => item.id === snapshotId);
    if (snapshot) return { snapshot, session };
  }
}
export const findSession = (history: History, sessionId?: string) => sessionId ? history.sessions.find(session => session.id === sessionId) : undefined;
export const baseSnapshot = (history: History) => history.status === 'finished' ? history.snapshots.find(snapshot => snapshot.id === history.baseId) : undefined;
/** The newest snapshot of the drafts, or of a session. */
export const latestSnapshot = (history: History, sessionId?: string) => (sessionId ? findSession(history, sessionId)?.snapshots : history.snapshots)?.at(-1);
/** What a project's head rests at while it isn't loaded: its base when finished, otherwise its latest draft. */
export const restingSnapshot = (history: History) => baseSnapshot(history) ?? history.snapshots.at(-1);
/** A session is outdated when it didn't start from the current base (the project's base changed since). */
export const isOutdated = (history: History, session: Session) => session.baseId !== history.baseId;

/** Adds a snapshot to the drafts, or to a session. */
export function addSnapshot(history: History, snapshot: Snapshot, sessionId?: string): History {
  if (!sessionId) {
    if (history.snapshots.length >= DRAFT_LIMIT) throw new Error(`A project keeps at most ${DRAFT_LIMIT} draft snapshots; delete some to save more.`);
    return { ...history, snapshots: [...history.snapshots, snapshot] };
  }
  const session = findSession(history, sessionId);
  if (!session) throw new Error('That session no longer exists.');
  if (session.snapshots.length >= SESSION_SNAPSHOT_LIMIT) throw new Error(`A session keeps at most ${SESSION_SNAPSHOT_LIMIT} snapshots; delete some to save more.`);
  return { ...history, sessions: history.sessions.map(other => other === session ? { ...session, snapshots: [...session.snapshots, snapshot] } : other) };
}

/** Starts a new game of a finished project: a new session whose first snapshot is a copy of the base. */
export function startSession(history: History, label: string, now = Date.now()): { history: History; session: Session } {
  const base = baseSnapshot(history);
  if (!base) throw new Error('Choose a base snapshot and mark the project finished before starting a game.');
  if (history.sessions.length >= SESSION_LIMIT) throw new Error(`A project keeps at most ${SESSION_LIMIT} sessions; delete some to start another.`);
  const session: Session = {
    id: uid('session'), name: cleanLabel(label, nextGameName(history)), createdAt: now, baseId: base.id, baseName: base.name,
    snapshots: [{ id: uid('snapshot'), name: 'Start', createdAt: now, project: structuredClone(base.project) }],
  };
  return { history: { ...history, sessions: [...history.sessions, session] }, session };
}
export function nextGameName(history: History) {
  const taken = new Set(history.sessions.map(session => session.name.toLowerCase()));
  let n = history.sessions.length + 1;
  while (taken.has(`game ${n}`)) n++;
  return `Game ${n}`;
}

/** Marks the project finished from a draft snapshot, or turns it back into a draft (keeping the base for its sessions). */
export function setStatus(history: History, status: History['status'], baseId = history.baseId): History {
  if (status === 'draft') return { ...history, status };
  if (!baseId || !history.snapshots.some(snapshot => snapshot.id === baseId)) throw new Error('Choose one of the draft snapshots as the base.');
  return { ...history, status, baseId };
}

export function renameItem(history: History, itemId: string, label: string): History {
  const clean = label.trim().slice(0, 100);
  if (!clean) throw new Error('Names cannot be empty.');
  const rename = <T extends { id: string; name: string }>(item: T): T => item.id === itemId ? { ...item, name: clean } : item;
  return { ...history, snapshots: history.snapshots.map(rename), sessions: history.sessions.map(session => ({ ...rename(session), snapshots: session.snapshots.map(rename) })) };
}

/** Why a snapshot can't be deleted, if it can't: a finished project's base, or a session's only snapshot. */
export function deleteBlocker(history: History, snapshotId: string, open?: OpenProject): string | undefined {
  const found = findSnapshot(history, snapshotId);
  if (!found) return 'That snapshot no longer exists.';
  if (history.status === 'finished' && history.baseId === snapshotId) return 'This is the base of the finished project. Turn the project back into a draft, or choose another base, to delete it.';
  if (found.session && found.session.snapshots.length === 1) return open?.session === found.session.id ? 'This is the only snapshot of the session you are playing.' : 'This is the session\'s only snapshot; delete the session instead.';
}
export function deleteSnapshot(history: History, snapshotId: string, open?: OpenProject): History {
  const blocker = deleteBlocker(history, snapshotId, open);
  if (blocker) throw new Error(blocker);
  return {
    ...history, snapshots: history.snapshots.filter(snapshot => snapshot.id !== snapshotId),
    sessions: history.sessions.map(session => session.snapshots.some(snapshot => snapshot.id === snapshotId) ? { ...session, snapshots: session.snapshots.filter(snapshot => snapshot.id !== snapshotId) } : session),
  };
}
export function deleteSession(history: History, sessionId: string, open?: OpenProject): History {
  if (open?.session === sessionId) throw new Error('Close the project before deleting the session you are playing.');
  return { ...history, sessions: history.sessions.filter(session => session.id !== sessionId) };
}

/**
 * The project a snapshot holds, checked like any other save, as the working copy of `head`: it keeps the head's
 * identifier, name and description, which belong to the project rather than to a moment of play.
 */
export function restoreSnapshot(snapshot: Pick<Snapshot, 'project'>, head: Pick<Project, 'id' | 'name' | 'description'>): Project {
  const project = upgradeLegacyArtworkProject(projectSchema.parse({ ...snapshot.project, id: head.id, name: head.name, description: head.description }));
  validateProject(project);
  return project;
}

/** JSON with sorted keys, so equal states compare equal however their objects were built. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}
/** Whether the working copy differs from the snapshot it was loaded from or last saved to. */
export function hasUnsavedChanges(project: Project, history: History | undefined, open: OpenProject | undefined): boolean {
  const from = open?.from && history ? findSnapshot(history, open.from)?.snapshot : undefined;
  if (!from) return true;
  try { return stableJson(project) !== stableJson(restoreSnapshot(from, project)); } catch { return true; }
}

/**
 * Part of a history for an export: the chosen snapshots (draft or session ones). Sessions keep only their chosen
 * snapshots and are left out without any; the project stays finished only if its base is included.
 */
export function selectHistory(history: History, chosen: ReadonlySet<string>): History {
  const snapshots = history.snapshots.filter(snapshot => chosen.has(snapshot.id));
  const sessions = history.sessions.map(session => ({ ...session, snapshots: session.snapshots.filter(snapshot => chosen.has(snapshot.id)) })).filter(session => session.snapshots.length);
  const finished = history.status === 'finished' && snapshots.some(snapshot => snapshot.id === history.baseId);
  return { status: finished ? 'finished' : 'draft', ...(snapshots.some(snapshot => snapshot.id === history.baseId) ? { baseId: history.baseId } : {}), snapshots, sessions };
}

/**
 * An imported history for a project given a new identifier: fresh snapshot and session ids (so they never clash with
 * saved ones), and every snapshot's project (and the links between imported projects) using the new project ids.
 */
export function remapHistory(history: History, projectIds: ReadonlyMap<string, string>, projectId: string): History {
  const ids = new Map<string, string>();
  const fresh = (old: string, prefix: string) => { const next = uid(prefix); ids.set(old, next); return next; };
  const project = (snapshot: Snapshot): Project => ({ ...snapshot.project, id: projectId, components: (snapshot.project.components ?? []).map(component => component.source && projectIds.has(component.source.projectId)
    ? { ...component, source: { ...component.source, projectId: projectIds.get(component.source.projectId)! } } : component) });
  const snapshot = (item: Snapshot): Snapshot => ({ ...item, id: fresh(item.id, 'snapshot'), project: project(item) });
  const snapshots = history.snapshots.map(snapshot);
  const sessions = history.sessions.map(session => ({ ...session, id: fresh(session.id, 'session'), baseId: ids.get(session.baseId) ?? uid('snapshot'), snapshots: session.snapshots.map(snapshot) }));
  const baseId = history.baseId && ids.get(history.baseId);
  return { status: history.status === 'finished' && baseId ? 'finished' : 'draft', ...(baseId ? { baseId } : {}), snapshots, sessions };
}

/**
 * Assigns snapshots saved before projects kept their own histories (one shared list of playground copies with new ids)
 * to the projects they were saved from, recognised by the component ids they share. Snapshots that match no project
 * are returned for keeping as projects of their own.
 */
export function assignLegacySnapshots(projects: Project[], legacy: Project[]): { byProject: Map<string, Project[]>; unmatched: Project[] } {
  const byProject = new Map<string, Project[]>(), unmatched: Project[] = [];
  const owners = projects.map(project => ({ id: project.id, components: new Set(project.components.filter(component => !component.source).map(component => component.id)) }));
  for (const snapshot of legacy) {
    let best: { id: string; shared: number } | undefined;
    for (const owner of owners) {
      const shared = snapshot.components.filter(component => owner.components.has(component.id)).length;
      if (shared && (!best || shared > best.shared)) best = { id: owner.id, shared };
    }
    if (best) byProject.set(best.id, [...byProject.get(best.id) ?? [], snapshot]);
    else unmatched.push(snapshot);
  }
  return { byProject, unmatched };
}

const HISTORY_PREFIX = 'tablecraft.history.', OPEN_KEY = 'tablecraft.open-project', LAST_PROJECT_KEY = 'tablecraft.last-project';
export const LEGACY_SNAPSHOTS_KEY = 'tablecraft.snapshots';
/** Reads the saved histories of these projects. A history that can't be read is reported and left untouched. */
export function loadHistories(projectIds: string[]): { histories: Record<string, History>; errors: string[] } {
  const histories: Record<string, History> = {}, errors: string[] = [];
  for (const projectId of projectIds) {
    const raw = localStorage.getItem(HISTORY_PREFIX + projectId);
    if (!raw) continue;
    try { histories[projectId] = historySchema.parse(JSON.parse(raw)); }
    catch (error) { errors.push(`${projectId}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { histories, errors };
}
export function saveHistory(projectId: string, history: History) {
  localStorage.setItem(HISTORY_PREFIX + projectId, JSON.stringify(history));
}
export function removeHistory(projectId: string) {
  localStorage.removeItem(HISTORY_PREFIX + projectId);
}
export function readHistory(projectId: string): string | null {
  return localStorage.getItem(HISTORY_PREFIX + projectId);
}
/** The loaded project, remembered across reloads. Before projects were loaded and closed, the last opened one was. */
export function loadOpenProject(): OpenProject | undefined {
  try {
    const last = localStorage.getItem(LAST_PROJECT_KEY);
    if (!last) return undefined;
    const raw = localStorage.getItem(OPEN_KEY);
    const saved = raw ? JSON.parse(raw) as Partial<OpenProject> : undefined;
    if (saved?.projectId === last) return { projectId: last, ...(typeof saved.session === 'string' ? { session: saved.session } : {}), ...(typeof saved.from === 'string' ? { from: saved.from } : {}) };
    return { projectId: last };
  } catch { return undefined; }
}
export function saveOpenProject(open: OpenProject | undefined) {
  if (open) { localStorage.setItem(LAST_PROJECT_KEY, open.projectId); localStorage.setItem(OPEN_KEY, JSON.stringify(open)); }
  else { localStorage.removeItem(LAST_PROJECT_KEY); localStorage.removeItem(OPEN_KEY); }
}
