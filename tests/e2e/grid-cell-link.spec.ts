import { expect, test } from '@playwright/test';
import { savedWorkspace } from './savedWorkspace';

test('square grid cells link their width and height until the link is turned off', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.getByRole('button', { name: 'Edit grids', exact: true }).click();
  const grid = async () => (await savedWorkspace(page)).projects[0].grids?.[0];
  const width = page.getByLabel('Cell width (px)', { exact: true }), height = page.getByLabel('Cell height (px)', { exact: true });
  const link = page.getByRole('checkbox', { name: /Link width and height/ });
  // Linked by default: editing either size changes both.
  await expect(link).toBeChecked();
  await width.fill('40'); await width.press('Enter');
  await expect(height).toHaveValue('40');
  await height.fill('60'); await height.press('Enter');
  await expect(width).toHaveValue('60');
  await expect.poll(async () => { const saved = await grid(); return saved && [saved.size, saved.sizeY]; }).toEqual([60, undefined]);
  // Unlinked, the sizes change on their own.
  await link.uncheck({ force: true });
  await expect.poll(async () => (await grid())?.sizeY).toBe(60);
  await height.fill('30'); await height.press('Enter');
  await expect.poll(async () => { const saved = await grid(); return saved && [saved.size, saved.sizeY]; }).toEqual([60, 30]);
  // Linking again makes the cells square at their width.
  await link.check({ force: true });
  await expect(height).toHaveValue('60');
  await expect.poll(async () => (await grid())?.sizeY).toBeUndefined();
});
