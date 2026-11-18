import { expect, test } from '@playwright/test';

test('New project can start from a ready-to-play game, which fills in its name and description', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Tablecraft home' }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  const start = dialog.getByRole('group', { name: 'Start from' });
  await expect(start.getByRole('radio', { name: /^Blank project/ })).toBeChecked();
  await start.getByRole('radio', { name: /^Tidewater Isles/ }).check();
  await expect(dialog.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue('Tidewater Isles');
  await expect(dialog.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(/tidal archipelago/);
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  // Game projects open straight onto their table, without the component template picker.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.library-panel')).toContainText('Island tile');
  await expect(page.locator('.table-viewport').getByRole('button', { name: /^Island tile/ })).toHaveCount(19);
  await expect(page.locator('.table-viewport').getByRole('button', { name: /^Tide marker/ })).toHaveCount(18);

  await page.getByRole('link', { name: 'Tablecraft home' }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill('Friday chess');
  await start.getByRole('radio', { name: /^Chess/ }).check();
  await expect(dialog.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue('Friday chess');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('.table-viewport').getByRole('button', { name: /^Chess pieces/ })).toHaveCount(32);
  await page.getByRole('link', { name: 'Tablecraft home' }).click();
  await expect(page.locator('.home-project').filter({ hasText: 'Friday chess' })).toContainText('2 components · 33 pieces · 2 players');
});
