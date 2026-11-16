import { expect, test, type Page } from '@playwright/test';
import type { Archive } from '../../src/domain';

const project = async (page: Page) => (await page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!)) as Archive).projects[0];
const order = async (page: Page) => (await project(page)).players.map(p => p.name);

test('players can be reordered and End turn passes the turn down the list', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.turn-pill')).toHaveCount(0);
  await page.getByRole('button', { name: /^Players/ }).click();
  await page.getByRole('button', { name: 'Add hotseat player', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save seat', exact: true }).click();
  await expect.poll(() => order(page)).toEqual(['Player 1', 'Player 2', 'Player 3']);
  for (const grip of await page.locator('.player-reorder').all()) expect((await grip.boundingBox())!.width).toBe(18);

  await page.getByRole('button', { name: 'Reorder Player 3', exact: true }).dragTo(page.locator('[data-player-row]').first(), { targetPosition: { x: 20, y: 2 } });
  await expect.poll(() => order(page)).toEqual(['Player 3', 'Player 1', 'Player 2']);
  await expect(page.locator('.player-row-name')).toHaveText(['Player 3', 'Player 1You', 'Player 2']);
  await page.getByRole('button', { name: 'Reorder Player 3', exact: true }).press('ArrowDown');
  await expect.poll(() => order(page)).toEqual(['Player 1', 'Player 3', 'Player 2']);

  await page.getByRole('button', { name: /^Table/ }).click();
  await page.getByLabel('Turn tracker').check({ force: true });
  const pill = page.locator('.turn-pill');
  await expect(pill).toContainText("Player 1's turn");
  await expect(pill.locator('.you-tag')).toBeVisible();
  const end = pill.getByRole('button', { name: /End turn/ });
  await expect(end).toHaveAttribute('title', 'Pass the turn to Player 3');
  await end.click();
  await expect(pill).toContainText("Player 3's turn");
  await expect(pill.locator('.you-tag')).toHaveCount(0);
  await end.click();
  await expect(pill).toContainText("Player 2's turn");
  await end.click();
  await expect(pill).toContainText("Player 1's turn");

  await end.click();
  await page.getByRole('button', { name: /^Players/ }).click();
  await expect(page.locator('[data-player-row]').nth(1)).toContainText('Current turn');
  await page.getByRole('button', { name: 'Reorder Player 3', exact: true }).press('ArrowUp');
  await expect.poll(() => order(page)).toEqual(['Player 3', 'Player 1', 'Player 2']);
  await expect(pill).toContainText("Player 3's turn");
});
