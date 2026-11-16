import { applyCommand, type Project } from './domain';

export interface StackPlan {
  /** Table units (stack id or lone piece id) in selection order; the first ends up at the bottom of the merged stack. */
  units: string[];
  /** Why the selection cannot be stacked, if it cannot. */
  error?: string;
}

/** Describes how stacking the current tabletop selection would order its pieces, or undefined for fewer than two table units. */
export function stackPlan(project: Project, selected: string[], actor?: string): StackPlan | undefined {
  const units: string[] = [];
  for (const id of selected) {
    const item = project.instances.find(i => i.id === id);
    if (!item || item.holder) return undefined;
    const unit = item.stack ?? item.id;
    if (!units.includes(unit)) units.push(unit);
  }
  if (units.length < 2) return undefined;
  try {
    applyCommand(project, { type: 'stack', ids: selected, stackId: 'stack-order-preview' }, actor);
    return { units };
  } catch (error) {
    return { units, error: error instanceof Error ? error.message : 'These pieces cannot be stacked.' };
  }
}

/** Which hamburger line marks where a unit lands: the first selected at the bottom, the last on top, the rest in between. */
export function stackSlot(index: number, count: number): 'bottom' | 'middle' | 'top' {
  return index === 0 ? 'bottom' : index === count - 1 ? 'top' : 'middle';
}
