import { expect, test } from '@playwright/test';

test('the selection action grid adapts its column count to the inspector width', async ({ page }) => {
  await page.goto('/');
  await page.locator('.table-piece').filter({ has: page.locator('.stack-count') }).click();
  const grid = page.locator('.action-grid');
  const columns = () => grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  const separator = page.getByRole('separator', { name: 'Resize table inspector' });
  await expect.poll(columns, { timeout: 5000 }).toBe(2);
  await separator.press('End');
  await expect.poll(columns, { timeout: 5000 }).toBeGreaterThanOrEqual(3);
  await separator.press('Home');
  await expect.poll(columns, { timeout: 5000 }).toBe(1);
  const overflow = await grid.locator('button').evaluateAll(buttons => buttons.filter(b => b.scrollWidth > b.clientWidth + 1).length);
  expect(overflow).toBe(0);
});
