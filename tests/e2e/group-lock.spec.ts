import { expect, test, type Page } from '@playwright/test';

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!).projects[0]);
// Bottom-to-top table order of the pieces (boards excluded, stacks once).
const order = async (page: Page) => {
  const p = await saved(page);
  return [...new Set(p.instances.filter((i: { holder: string | null; componentId: string }) => !i.holder && p.components.find((c: { id: string; kind: string }) => c.id === i.componentId).kind !== 'board')
    .map((i: { stack: string | null; id: string }) => i.stack ?? i.id))];
};

test('a group locks separately from its pieces, and selecting locked pieces never reorders the table', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('#playground-pieces-panel');
  const tokens = panel.getByRole('button', { name: 'Amber token', exact: true });
  await tokens.nth(0).click();
  await tokens.nth(1).click({ modifiers: ['Control'] });
  await panel.hover();
  await page.keyboard.press('g');
  const groupRow = panel.getByRole('button', { name: /^Group .*, 2 pieces/ });
  await expect(groupRow).toHaveCount(1);
  const ids = (await saved(page)).instances.filter((i: { group?: string }) => i.group).map((i: { id: string }) => i.id) as string[];
  expect(ids).toHaveLength(2);

  // The group's locks show only on hover or focus, and take no room while hidden.
  await page.mouse.move(5, 5);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const locks = panel.locator('.piece-group .group-lock');
  await expect(locks).toHaveCount(2);
  for (const lock of await locks.all()) await expect(lock).toBeHidden();
  const name = panel.locator('.piece-group .layer-row'), wide = (await name.boundingBox())!.width;
  await groupRow.hover();
  for (const lock of await locks.all()) await expect(lock).toBeVisible();
  expect(wide - (await name.boundingBox())!.width).toBeGreaterThanOrEqual(48);

  await panel.getByRole('button', { name: /^Lock group / }).click();
  await expect(groupRow).toHaveAttribute('aria-label', /, locked$/);
  // Once the pointer leaves, the order lock (still off) hides again, though the clicked lock button keeps focus.
  await page.mouse.move(5, 5);
  await expect(panel.getByRole('button', { name: /^Lock order of group / })).toHaveCount(0);
  await expect(locks.first()).toBeVisible();
  await expect.poll(async () => (await saved(page)).groups[0].locked).toBe(true);
  // The pieces keep their own (unlocked) flags but can't be dragged.
  expect((await saved(page)).instances.filter((i: { id: string }) => ids.includes(i.id)).map((i: { locked: boolean }) => i.locked)).toEqual([false, false]);
  const piece = page.locator(`.table-piece[data-piece-id="${ids[0]}"]`);
  await expect(piece).toHaveClass(/locked/);
  const before = await order(page), box = (await piece.boundingBox())!;
  const start = (await saved(page)).instances.find((i: { id: string }) => i.id === ids[0]);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  // Ctrl/Cmd-click still selects it, and selecting it doesn't bring it (or its group) to the front.
  await piece.click({ modifiers: ['ControlOrMeta'] });
  await expect(piece).toHaveClass(/selected/);
  await expect(page.getByText('Held in place by its locked group.', { exact: false })).toBeVisible();
  expect(await order(page)).toEqual(before);
  expect((await saved(page)).instances.find((i: { id: string }) => i.id === ids[0])).toMatchObject({ x: start.x, y: start.y });

  // Unlocking the group frees its pieces again.
  await panel.getByRole('button', { name: /^Unlock group / }).click();
  await expect(piece).not.toHaveClass(/locked/);
  await page.keyboard.press('Escape');
  const free = (await piece.boundingBox())!;
  await page.mouse.move(free.x + free.width / 2, free.y + free.height / 2);
  await page.mouse.down();
  await page.mouse.move(free.x + free.width / 2 + 60, free.y + free.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await saved(page)).instances.find((i: { id: string }) => i.id === ids[0]).x).not.toBe(start.x);
});

test('selecting a piece locked on its own leaves the table order alone', async ({ page }) => {
  await page.goto('/');
  const board = page.locator('.table-viewport').getByRole('button', { name: 'Forest clearing', exact: true });
  const id = await page.locator('.table-viewport').getByRole('button', { name: 'Spirit cards', exact: true }).first().getAttribute('data-piece-id');
  const card = page.locator(`.table-piece[data-piece-id="${id}"]`);
  await card.click();
  await page.locator('.action-grid').getByRole('button', { name: /^Lock(?! order)/ }).click();
  await expect(card).toHaveClass(/locked/);
  await page.keyboard.press('Escape');
  const before = await order(page);
  await card.click({ modifiers: ['ControlOrMeta'] });
  await expect(card).toHaveClass(/selected/);
  await page.waitForTimeout(300);
  expect(await order(page)).toEqual(before);
  await expect(board).toBeVisible();
});
