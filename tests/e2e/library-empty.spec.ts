import { expect, test } from '@playwright/test';

test('library footer omits file actions and empty linking offers Home navigation', async ({ page }) => {
  await page.goto('/');
  const footer = page.locator('.library-footer');
  await expect(footer.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
  await expect(footer.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0);
  const linkButton = footer.getByRole('button', { name: 'Link from another project', exact: true });
  for (const width of [1280, 800]) {
    await page.setViewportSize({ width, height: 800 });
    const footerBounds = await footer.boundingBox();
    const buttonBounds = await linkButton.boundingBox();
    expect(footerBounds).not.toBeNull();
    expect(buttonBounds).not.toBeNull();
    expect(footerBounds!.y + footerBounds!.height - buttonBounds!.y - buttonBounds!.height).toBeGreaterThanOrEqual(14);
  }
  await footer.getByRole('button', { name: 'Link from another project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Link from another project', exact: true });
  await expect(dialog.getByRole('heading', { name: 'No other projects yet', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Go to Home', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open project Wildwood', exact: true })).toBeVisible();
});
