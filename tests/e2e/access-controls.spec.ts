import { expect, test, type Page } from '@playwright/test';

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!).projects[0]);
const instance = async (page: Page, id: string | null) => (await saved(page)).instances.find((item: { id: string }) => item.id === id);

test('hiding, locks and order locks share one control: an Everyone switch and seat chips for who it covers', async ({ page }) => {
  await page.goto('/');
  const id = await page.locator('.table-viewport').getByRole('button', { name: 'Amber token', exact: true }).first().getAttribute('data-piece-id');
  // The piece itself (clicking raises it, so it doesn't stay the first token).
  const token = page.locator(`.table-piece[data-piece-id="${id}"]`);
  await token.click();
  const inspector = page.locator('.playground-inspector');
  const lock = inspector.getByRole('group', { name: 'Locked for', exact: true });
  // Locked for Player 2 only: their chip is on, and nobody else's.
  await lock.getByRole('button', { name: 'Lock for Player 2', exact: true }).click();
  await expect.poll(async () => instance(page, id)).toMatchObject({ locked: false, lockPlayers: ['player-2'] });
  await expect(lock).toContainText('Only Player 2');
  // Everyone starts afresh: every seat, seats that join later too. Then Player 1 is left out.
  await lock.getByRole('switch', { name: /Everyone/ }).click();
  await expect.poll(async () => instance(page, id)).toMatchObject({ locked: true });
  await expect(lock.getByRole('button', { name: 'Unlock for Player 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await lock.getByRole('button', { name: 'Unlock for Player 1', exact: true }).click();
  await expect.poll(async () => instance(page, id)).toMatchObject({ locked: true, lockPlayers: ['player-1'] });
  await expect(lock).toContainText('Everyone but Player 1, and seats that join later');
  // Player 1 is left out of the lock, so they can still move it.
  const start = await instance(page, id), box = (await token.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await instance(page, id)).x).not.toBe(start.x);
  // Hidden from everyone but Player 1: it stays on Player 1's table.
  const hide = inspector.getByRole('group', { name: 'Hidden from', exact: true });
  await hide.getByRole('switch', { name: /Everyone/ }).click();
  // Hidden from you too, it stays on the table, faded, while it's selected.
  await expect(token).toHaveClass(/hidden-from-you/);
  await hide.getByRole('button', { name: 'Show to Player 1', exact: true }).click();
  await expect(token).not.toHaveClass(/hidden-from-you/);
  await expect.poll(async () => instance(page, id)).toMatchObject({ hidden: true, hidePlayers: ['player-1'] });
  await expect(page.locator(`.table-piece[data-piece-id="${id}"]`)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('access.png') });
  // The Lock button switches the lock for everyone off again, list and all.
  await inspector.locator('.action-grid').getByRole('button', { name: /^Unlock/ }).click();
  await expect.poll(async () => (await instance(page, id)).lockPlayers).toBeUndefined();
  expect((await instance(page, id)).locked).toBe(false);
});

test('groups take the same controls: an order lock for one seat keeps the group in place for them only', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('#playground-pieces-panel');
  const tokens = panel.getByRole('button', { name: 'Amber token', exact: true });
  await tokens.nth(0).click();
  await tokens.nth(1).click({ modifiers: ['Control'] });
  await panel.hover();
  await page.keyboard.press('g');
  const groupRow = panel.getByRole('button', { name: /^Group .*, 2 pieces/ });
  await groupRow.click();
  const order = page.locator('.group-inspector').getByRole('group', { name: 'Order locked for', exact: true });
  await order.getByRole('button', { name: 'Lock order for Player 2', exact: true }).click();
  await expect.poll(async () => (await saved(page)).groups[0]).toMatchObject({ orderLockPlayers: ['player-2'] });
  // Not for Player 1, who's playing: the group can still move up and down.
  await expect(page.locator('.group-inspector').getByRole('button', { name: /^Ungroup/ })).not.toHaveAttribute('aria-disabled', 'true');
  // Its order-lock button on the row stays shown, as it's set for some seats.
  await page.mouse.move(5, 5);
  await expect(panel.locator('.group-order-lock')).toBeVisible();
});
