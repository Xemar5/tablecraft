import { z } from 'zod';
import { applyCommand, commandSchema, instanceSchema, pieceGroupSchema, projectSchema, validateProject, type Command, type Project } from './domain';

export const PLAYGROUND_HISTORY_LIMIT = 50;
const seatPresentation = z.object({
  id: z.string(), name: z.string(), color: z.string(), x: z.number(), y: z.number(), rotation: z.number(),
});
const entrySchema = z.object({
  instances: z.array(instanceSchema),
  settings: projectSchema.shape.settings,
  /** Pieces panel groups; omitted when the table had none. */
  groups: z.array(pieceGroupSchema).optional(),
  seat: seatPresentation.optional(),
});
export const playgroundHistorySchema = z.object({
  entries: z.array(entrySchema).max(PLAYGROUND_HISTORY_LIMIT),
  notice: z.string().default(''),
});
export type PlaygroundHistory = z.infer<typeof playgroundHistorySchema>;
export const emptyPlaygroundHistory = (): PlaygroundHistory => ({ entries: [], notice: '' });

// Designs are the bulk of a project; skip serializing them when a command kept the same component objects.
const sameProject = (a: Project, b: Project) => (a.components === b.components || JSON.stringify(a.components) === JSON.stringify(b.components)) &&
  JSON.stringify({ ...a, components: [] }) === JSON.stringify({ ...b, components: [] });

/** History contains tabletop state, never designs, seat identities or ownership. */
export function applyPlaygroundCommand(
  project: Project, history: PlaygroundHistory, raw: Command, actor?: string,
): { project: Project; history: PlaygroundHistory } {
  const command = commandSchema.parse(raw);
  const next = applyCommand(project, command, actor);
  if (sameProject(project, next)) return { project: next, history };
  if (command.type === 'component' || command.type === 'removeComponent' || command.type === 'addComponents' || command.type === 'syncLinkedComponents') {
    return { project: next, history: { entries: [], notice: 'Undo history cleared because component designs changed.' } };
  }
  // Seat identities are session infrastructure. Never remove a seat through undo.
  if (command.type === 'player' && !project.players.some(player => player.id === command.player.id)) {
    return { project: next, history: { entries: [], notice: 'Undo history cleared because a seat was added.' } };
  }
  if (command.type === 'removePlayer') return { project: next, history: { entries: [], notice: 'Undo history cleared because a seat was removed.' } };
  if (command.type === 'rename' || command.type === 'reorderComponent' || command.type === 'handSettings' || command.type === 'reorderPlayers') return { project: next, history };
  const player = command.type === 'player' ? project.players.find(player => player.id === command.player.id) : undefined;
  const entry = entrySchema.parse({
    instances: project.instances, settings: project.settings, ...(project.groups?.length ? { groups: project.groups } : {}),
    seat: player && { id: player.id, name: player.name, color: player.color, x: player.x, y: player.y, rotation: player.rotation },
  });
  return {
    project: next,
    history: { entries: [...history.entries, entry].slice(-PLAYGROUND_HISTORY_LIMIT), notice: '' },
  };
}

/** Merge only reversible tabletop state into the CURRENT project, then validate. */
export function undoPlayground(
  project: Project, history: PlaygroundHistory,
): { project: Project; history: PlaygroundHistory; undone: boolean } {
  const entry = history.entries.at(-1);
  if (!entry) return { project, history, undone: false };
  try {
    if (entry.seat && !project.players.some(player => player.id === entry.seat!.id)) throw new Error('Seat no longer exists.');
    // Undo never touches designs, so keep the current component objects (validateProject still checks them).
    // Entries without groups were recorded when the table had none.
    const next = validateProject({ ...projectSchema.omit({ components: true }).parse({
      ...project, instances: entry.instances, settings: entry.settings, groups: entry.groups?.length ? entry.groups : undefined,
      players: project.players.map(player => player.id === entry.seat?.id ? { ...player, ...entry.seat } : player),
    }), components: project.components });
    return { project: next, history: { entries: history.entries.slice(0, -1), notice: '' }, undone: true };
  } catch (error) {
    // Do not repeatedly offer a broken inverse, or partially restore an invalid table.
    const reason = error instanceof Error ? ` ${error.message}` : '';
    return { project, history: { entries: [], notice: `Undo history cleared because the table is no longer compatible.${reason}` }, undone: false };
  }
}
