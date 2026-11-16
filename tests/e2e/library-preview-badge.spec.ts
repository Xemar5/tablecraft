import { expect, test } from '@playwright/test';

test('the preview add badge only appears in the playground and highlights on hover like the spawn-all button', async ({ page }) => {
  await page.goto('/');
  const preview = page.locator('.library-preview').first();
  await expect(preview.locator('.preview-add')).toHaveCount(1);
  await preview.hover();
  const badge = preview.locator('.preview-add');
  const spawnAll = page.locator('.preview-spawn-all').first();
  await badge.hover();
  await expect(badge).toHaveCSS('cursor', 'pointer');
  await expect(badge).toHaveCSS('background-color', 'rgb(244, 248, 236)');
  await spawnAll.hover();
  await expect(spawnAll).toHaveCSS('background-color', 'rgb(244, 248, 236)');
  await page.getByRole('button', { name: 'Component designer', exact: true }).click();
  await expect(preview.locator('.preview-add')).toHaveCount(0);
});
