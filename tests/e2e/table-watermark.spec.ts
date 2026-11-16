import { expect, test } from '@playwright/test';

test('the table watermark shows the Tablecraft brand centered on the fitted table', async ({ page }) => {
  await page.goto('/');
  const mark = page.locator('.table-watermark');
  await expect(mark).toContainText('TABLECRAFT');
  await expect(mark).toContainText('MAKE SOMETHING WORTH PLAYING');
  await expect(mark).not.toContainText('WILDWOOD');
  await expect(mark.locator('svg')).toHaveCount(1);
  await page.getByRole('button', { name: 'Fit table', exact: true }).click();
  const box = (await mark.boundingBox())!, view = (await page.locator('.table-world').locator('..').boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - (view.x + view.width / 2))).toBeLessThan(2);
  expect(Math.abs(box.y + box.height / 2 - (view.y + view.height / 2))).toBeLessThan(2);
});
