import { expect, test } from '@playwright/test';
import type { Archive } from '../../src/domain';

test('a selected stack offers draw one and draw all, and its preview shows the stack size', async ({ page }) => {
  await page.goto('/');
  const project = async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!)) as Archive).projects[0];
  const initial = await project();
  const size = initial.instances.filter(i => i.stack).length;
  const deck = page.locator('.table-piece').filter({ has: page.locator('.stack-count') });
  await deck.hover();
  await expect(page.getByLabel(`Stack of ${size}`, { exact: true })).toBeVisible();
  await expect(page.locator('.hover-preview .preview-stack-count')).toHaveText(String(size));
  await deck.click();
  await expect(page.getByRole('button', { name: 'Draw to hand', exact: true })).toHaveCount(0);
  await page.mouse.move(5, 5);
  await page.getByRole('button', { name: /^Draw one/ }).click();
  await expect(page.locator('.hand-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Stack selected', exact: true })).toBeVisible();
  await expect(page.locator('.selected-component small')).toHaveText(`${size - 1} in stack`);
  await deck.hover();
  await expect(page.locator('.hover-preview .preview-stack-count')).toHaveText(String(size - 1));
  await page.mouse.move(5, 5);
  await page.getByRole('button', { name: 'Draw all', exact: true }).click();
  await expect(page.locator('.hand-card')).toHaveCount(size);
  await expect.poll(async () => (await project()).instances.filter(i => i.holder === 'player-1').length).toBe(size);

  const single = (await project()).instances.find(i => !i.holder && !i.stack && (initial.components.find(c => c.id === i.componentId)?.hand))!;
  await page.locator(`[data-piece-id="${single.id}"]`).click();
  await expect(page.getByRole('button', { name: 'Draw to hand', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Draw all', exact: true })).toHaveCount(0);
  await page.locator(`[data-piece-id="${single.id}"]`).hover();
  await expect(page.locator('.hover-preview .preview-stack-count')).toHaveCount(0);
});
