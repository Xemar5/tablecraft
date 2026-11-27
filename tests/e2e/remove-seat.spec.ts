import { expect, test, type Page } from '@playwright/test';
import type { Archive } from '../../src/domain';
import { toggleHeader } from './headerMenus';

const project = async (page: Page) => (await page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!)) as Archive).projects[0];

test('removing a seat spreads its hand where the seat was', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-seat-id="player-1"]').click();
  const remove = page.locator('.seat-inspector').getByRole('button', { name: 'Remove seat', exact: true });
  await expect(remove).toBeEnabled();

  await page.locator('[data-seat-id="player-2"]').click();
  await page.getByRole('button', { name: 'Switch to this seat', exact: true }).click();
  await page.getByRole('button', { name: "I'm Player 2. Let's play.", exact: false }).click();
  await page.locator('.table-piece').filter({ has: page.locator('.stack-count') }).hover();
  await page.keyboard.press('3');
  await expect.poll(async () => (await project(page)).instances.filter(i => i.holder === 'player-2').length).toBe(3);
  const held = (await project(page)).instances.filter(i => i.holder === 'player-2').map(i => i.id);

  await page.locator('[data-seat-id="player-1"]').click();
  await page.getByRole('button', { name: 'Switch to this seat', exact: true }).click();
  await page.getByRole('button', { name: "I'm Player 1. Let's play.", exact: false }).click();
  // Another hotseat seat is removed only in game master mode, as an override.
  await page.locator('[data-seat-id="player-2"]').click();
  await expect(remove).toHaveCount(0);
  await toggleHeader(page, 'Game master mode');
  await expect(remove).toHaveClass(/gm-override/);
  await remove.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Remove Player 2?');
  await expect(dialog).toContainText('Game master override');
  await expect(dialog).toContainText('Its 3 held pieces are spread on the table where the seat was.');
  const [modalBox, actionsBox] = [(await dialog.boundingBox())!, (await dialog.locator('.modal-actions .button').last().boundingBox())!];
  expect(modalBox.x + modalBox.width - (actionsBox.x + actionsBox.width)).toBeGreaterThanOrEqual(20);
  expect(modalBox.y + modalBox.height - (actionsBox.y + actionsBox.height)).toBeGreaterThanOrEqual(20);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('[data-seat-id="player-2"]')).toHaveCount(1);
  await remove.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove seat', exact: true }).click();

  await expect(page.locator('[data-seat-id="player-2"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Seat selected', exact: true })).toHaveCount(0);
  const after = await project(page);
  expect(after.players.map(p => p.id)).toEqual(['player-1']);
  const placed = held.map(id => after.instances.find(i => i.id === id)!);
  expect(placed.every(i => !i.holder && !i.stack)).toBe(true);
  expect(placed.map(i => i.y)).toEqual([100, 100, 100]);
  expect(placed.map(i => i.x).sort((a, b) => a - b)[1]).toBe(980);
  for (const id of held) await expect(page.locator(`[data-piece-id="${id}"]`)).toBeVisible();

  await page.locator('[data-seat-id="player-1"]').click();
  await expect(remove).toBeEnabled();
  await remove.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove seat', exact: true }).click();
  await expect(page.locator('[data-seat-id]')).toHaveCount(0);
  await expect(page.locator('.hand-tray,.hand-toolbar')).toHaveCount(0);
  await expect(page.locator('.table-viewport')).toBeVisible();
  expect((await project(page)).players).toEqual([]);
});
