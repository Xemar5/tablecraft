import { expect, test } from '@playwright/test';

test('projects show descriptions that can be set on creation and edited with the name from Home', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Tablecraft home' }).click();
  await expect(page.locator('.home-project-description')).toHaveText(['A little magic. A lot of possibility.']);

  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Desert run');
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Race across the dunes.');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('link', { name: 'Tablecraft home' }).click();
  const card = page.locator('.home-project').filter({ hasText: 'Desert run' });
  await expect(card.locator('.home-project-description')).toHaveText('Race across the dunes.');

  await page.getByRole('button', { name: 'Edit project Desert run', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('Race across the dunes.');
  await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill('Dune racers');
  await dialog.getByRole('textbox', { name: 'Description', exact: true }).fill('');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const renamed = page.locator('.home-project').filter({ hasText: 'Dune racers' });
  await expect(renamed.locator('h2')).toHaveText('Dune racers');
  await expect(renamed.locator('.home-project-description')).toHaveCount(0);

  await page.reload();
  await page.getByRole('link', { name: 'Tablecraft home' }).click();
  await expect(page.locator('.home-project h2').filter({ hasText: 'Dune racers' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Edit project Dune racers', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Description', exact: true }).fill('Back again');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByText('Back again')).toHaveCount(0);
});
