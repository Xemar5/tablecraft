import { expect, test, type Page } from '@playwright/test';

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!).projects[0]);
// Bottom-to-top table order of the pieces (boards excluded, stacks once).
const order = async (page: Page) => {
  const p = await saved(page);
  return [...new Set(p.instances.filter((i: { holder: string | null; componentId: string }) => !i.holder && p.components.find((c: { id: string; kind: string }) => c.id === i.componentId).kind !== 'board')
    .map((i: { stack: string | null; id: string }) => i.stack ?? i.id))];
};

test('order locks keep pieces and groups in their places in the hierarchy, separately from the position lock', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('#playground-pieces-panel');
  const tokens = panel.getByRole('button', { name: 'Amber token', exact: true });
  // A piece: Lock order in the Selection tab. It still moves, but Bring forward refuses and picking it up doesn't raise it.
  await tokens.nth(4).click();
  const id = await page.locator('.table-piece.selected').first().getAttribute('data-piece-id');
  await page.getByRole('button', { name: 'Lock order', exact: true }).click();
  await expect.poll(async () => (await saved(page)).instances.find((i: { id: string }) => i.id === id).orderLocked).toBe(true);
  await expect(panel.getByRole('button', { name: 'Amber token, order locked', exact: true })).toHaveCount(1);
  const forward = page.getByRole('button', { name: /^Bring forward/ });
  await expect(forward).toHaveAttribute('aria-disabled', 'true');
  await expect(forward).toHaveAttribute('title', /order is locked/);
  const before = await order(page), startX = (await saved(page)).instances.find((i: { id: string }) => i.id === id).x;
  const piece = page.locator(`.table-piece[data-piece-id="${id}"]`), box = (await piece.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await saved(page)).instances.find((i: { id: string }) => i.id === id).x).not.toBe(startX);
  expect(await order(page)).toEqual(before);
  // Its panel row can't be dragged to another place.
  await expect(panel.getByRole('button', { name: 'Amber token, order locked', exact: true })).not.toHaveAttribute('draggable', 'true');
  await page.getByRole('button', { name: 'Unlock order', exact: true }).click();
  await expect(forward).not.toHaveAttribute('aria-disabled', 'true');

  // A group: its order lock (next to its lock) holds it and its pieces; Move up, Out of group and Ungroup say why.
  await tokens.nth(0).click();
  await tokens.nth(1).click({ modifiers: ['Control'] });
  await panel.hover();
  await page.keyboard.press('g');
  const groupRow = panel.getByRole('button', { name: /^Group .*, 2 pieces/ });
  await expect(groupRow).toHaveCount(1);
  await panel.getByRole('button', { name: /^Lock order of group / }).click();
  await expect(groupRow).toHaveAttribute('aria-label', /, order locked$/);
  await expect.poll(async () => (await saved(page)).groups[0]).toMatchObject({ orderLocked: true });
  expect((await saved(page)).groups[0].locked).toBeUndefined();
  await expect(groupRow).not.toHaveAttribute('draggable', 'true');
  await groupRow.click();
  for (const name of [/^Move up/, /^Ungroup/]) {
    const button = page.locator('.group-inspector').getByRole('button', { name });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveAttribute('title', /order is locked/);
  }
  await page.locator('.group-inspector').getByRole('button', { name: 'Unlock order', exact: true }).click();
  await expect.poll(async () => (await saved(page)).groups[0].orderLocked).toBeUndefined();
  await expect(groupRow).toHaveAttribute('draggable', 'true');
});
