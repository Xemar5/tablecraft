import { expect, test } from '@playwright/test';

test('settings are reachable from Home and the workspace, switch to night mode, and persist', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Tablecraft home' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Make it yours.' });
  await expect(dialog.getByRole('radio', { name: /System/ })).toHaveAttribute('aria-checked', 'true');

  const background = () => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  const light = await background();
  await dialog.getByRole('radio', { name: /Night/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(background).not.toBe(light);
  const [r, g, b] = (await background()).match(/\d+/g)!.map(Number);
  expect(Math.max(r, g, b)).toBeLessThan(80);
  // Theme previews keep their own colors in night mode.
  await expect(dialog.locator('.theme-option-light .theme-swatch')).toHaveCSS('background-color', 'rgb(244, 247, 239)');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await dialog.getByRole('radio', { name: /Light/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('profile and server defaults prefill the session form and the first hotseat seat', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Make it yours.' });
  await dialog.getByLabel('Default name', { exact: true }).fill('Ada');
  await dialog.getByLabel('Default color value', { exact: true }).fill('#336699');
  await dialog.getByLabel('Default color value', { exact: true }).press('Enter');
  await dialog.getByLabel('Default SpaceTimeDB server', { exact: true }).fill('https://maincloud.spacetimedb.com');
  await dialog.getByLabel('Default database', { exact: true }).fill('my-tables');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveText('A');

  await page.reload();
  await page.getByRole('button', { name: 'Invite players' }).click();
  await expect(page.getByLabel('Your name', { exact: true })).toHaveValue('Ada');
  await expect(page.getByLabel('SpaceTimeDB server', { exact: true })).toHaveValue('https://maincloud.spacetimedb.com');
  await expect(page.getByLabel('Database name', { exact: true })).toHaveValue('my-tables');
  await page.getByRole('button', { name: 'Close dialog' }).click();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await dialog.getByRole('button', { name: 'Restore default server' }).click();
  await expect(dialog.getByLabel('Default SpaceTimeDB server', { exact: true })).not.toHaveValue('https://maincloud.spacetimedb.com');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();

  // A new project has no seats, so the first hotseat seat uses the profile defaults.
  await page.getByRole('link', { name: 'Tablecraft home' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Players/ }).click();
  await page.getByRole('button', { name: 'Add hotseat player', exact: true }).click();
  await expect(page.getByLabel('Player name', { exact: true })).toHaveValue('Ada');
  await expect(page.getByLabel('Player color value', { exact: true })).toHaveValue('#336699');
});
