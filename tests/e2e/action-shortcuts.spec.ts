import { expect, test } from '@playwright/test';
import type { Archive } from '../../src/domain';

test('selection actions show their shortcuts and L toggles the lock', async ({ page }) => {
  await page.goto('/');
  const project = async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!)) as Archive).projects[0];
  const initial = await project();
  const single = initial.instances.find(i => !i.holder && !i.stack && initial.components.find(c => c.id === i.componentId)?.hand)!;
  const piece = page.locator(`[data-piece-id="${single.id}"]`);
  await piece.click();
  const grid = page.locator('.action-grid');
  for (const [name, key] of [['Flip', 'F'], ['Rotate −90°', 'Q'], ['Rotate +90°', 'E'], ['Clone', 'Ctrl D'], ['Draw to hand', '1'], ['Lock', 'L'], ['Delete', 'Del']])
    await expect(grid.getByRole('button', { name: new RegExp(`^${name.replace(/[+]/g, '\\$&')}`) }).locator('kbd')).toHaveText(key);
  await page.mouse.move(5, 5);
  await page.keyboard.press('l');
  await expect.poll(async () => (await project()).instances.find(i => i.id === single.id)?.locked).toBe(true);
  await expect(grid.getByRole('button', { name: /^Unlock/ }).locator('kbd')).toHaveText('L');
  await page.keyboard.press('l');
  await expect.poll(async () => (await project()).instances.find(i => i.id === single.id)?.locked).toBe(false);
  await piece.hover();
  await expect(page.locator('.hover-preview').getByRole('row', { name: /Lock \/ unlock/ })).toContainText('L');
  await page.keyboard.press('l');
  await expect.poll(async () => (await project()).instances.find(i => i.id === single.id)?.locked).toBe(true);
});
