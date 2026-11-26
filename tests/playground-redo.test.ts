import { describe, expect, it } from 'vitest';
import { applyPlaygroundCommand, emptyPlaygroundHistory, redoPlayground, undoPlayground } from '../src/playgroundHistory';
import { starterTable } from './fixtures';

const token = (p: ReturnType<typeof starterTable>) => p.instances.find(i => p.components.find(c => c.id === i.componentId)?.kind === 'token')!;

describe('playground redo', () => {
  it('returns to what undo went back from, one step at a time, and undoes it again', () => {
    const start = starterTable();
    const id = token(start).id;
    let state = { project: start, history: emptyPlaygroundHistory() };
    state = applyPlaygroundCommand(state.project, state.history, { type: 'transform', ids: [id], dx: 10, dy: 0 });
    state = applyPlaygroundCommand(state.project, state.history, { type: 'transform', ids: [id], dx: 5, dy: 0 });
    const x = (project: typeof start) => project.instances.find(i => i.id === id)!.x;
    const at = x(start);
    let step = undoPlayground(state.project, state.history);
    step = undoPlayground(step.project, step.history);
    expect(x(step.project)).toBe(at);
    expect(step.history.redo).toHaveLength(2);
    let again = redoPlayground(step.project, step.history);
    expect(again.redone).toBe(true);
    expect(x(again.project)).toBe(at + 10);
    again = redoPlayground(again.project, again.history);
    expect(x(again.project)).toBe(at + 15);
    expect(redoPlayground(again.project, again.history).redone).toBe(false);
    // Redone actions can be undone again.
    expect(again.history.entries).toHaveLength(2);
    expect(x(undoPlayground(again.project, again.history).project)).toBe(at + 10);
  });

  it('forgets what could be redone once something new happens', () => {
    const start = starterTable();
    const id = token(start).id;
    let state = applyPlaygroundCommand(start, emptyPlaygroundHistory(), { type: 'transform', ids: [id], dx: 10, dy: 0 });
    const undone = undoPlayground(state.project, state.history);
    expect(undone.history.redo).toHaveLength(1);
    state = applyPlaygroundCommand(undone.project, undone.history, { type: 'transform', ids: [id], dx: 0, dy: 7 });
    expect(state.history.redo ?? []).toHaveLength(0);
    // Renaming the project isn't a table action, so it keeps redo.
    const renamed = applyPlaygroundCommand(undone.project, undone.history, { type: 'rename', name: 'Elsewhere' });
    expect(renamed.history.redo).toHaveLength(1);
  });
});
