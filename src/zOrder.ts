/** How a selection moves in a stacking order, matching design tools: Ctrl/Cmd+] and [ step, with Shift they jump. */
export type OrderMove = 'front' | 'back' | 'forward' | 'backward';

/**
 * Reorders a bottom-to-top list. `front`/`back` move the chosen items to the top/bottom as a block, keeping their
 * relative order. `forward`/`backward` move each chosen item one step past the next unchosen item above/below it;
 * when `overlaps` is given, that item must overlap the moving one, so every step makes a visible change (items that
 * don't touch anything stay put). Chosen items never pass each other.
 */
export function reorder<T>(items: readonly T[], chosen: (item: T) => boolean, move: OrderMove, overlaps?: (a: T, b: T) => boolean): T[] {
  if (move === 'front') return [...items.filter(item => !chosen(item)), ...items.filter(chosen)];
  if (move === 'back') return [...items.filter(chosen), ...items.filter(item => !chosen(item))];
  const list = move === 'forward' ? [...items] : [...items].reverse();
  // Walk from the far end so a moved item never jumps over a chosen item that hasn't moved yet.
  for (let index = list.length - 1; index >= 0; index--) {
    const item = list[index];
    if (!chosen(item)) continue;
    let target = index + 1;
    while (target < list.length && !chosen(list[target]) && overlaps && !overlaps(item, list[target])) target++;
    if (target >= list.length || chosen(list[target])) continue;
    list.splice(index, 1);
    list.splice(target, 0, item);
  }
  return move === 'forward' ? list : list.reverse();
}
