import { expect, test } from '@playwright/test';

test('library header offers linking and adding, the footer is gone, and empty linking offers Home navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.library-footer')).toHaveCount(0);
  const heading = page.locator('.library-heading');
  for (const mode of ['Playground', 'Component designer']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    await expect(heading.getByRole('button', { name: 'Add component', exact: true })).toBeVisible();
    await expect(heading.getByRole('button', { name: 'Link from another project', exact: true })).toBeVisible();
  }
  const link = (await heading.getByRole('button', { name: 'Link from another project', exact: true }).boundingBox())!;
  const add = (await heading.getByRole('button', { name: 'Add component', exact: true }).boundingBox())!;
  expect(link.x).toBeLessThan(add.x);
  expect(Math.abs(link.y + link.height / 2 - add.y - add.height / 2)).toBeLessThan(2);
  await heading.getByRole('button', { name: 'Link from another project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Link from another project', exact: true });
  await expect(dialog.getByRole('heading', { name: 'No other projects yet', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Go to Home', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue project Wildwood', exact: true })).toBeVisible();
});
