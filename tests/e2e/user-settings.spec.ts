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
  // The night preview uses the colors night mode actually renders.
  await expect(dialog.locator('.theme-option-dark .theme-swatch')).toHaveCSS('background-color', await background());
  const accent = await page.evaluate(() => { const b = document.body.appendChild(Object.assign(document.createElement('button'), { className: 'button primary' })); const c = getComputedStyle(b).backgroundColor; b.remove(); return c; });
  await expect(dialog.locator('.theme-option-dark .theme-swatch > span').first()).toHaveCSS('background-color', accent);

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
  await dialog.getByLabel('Your name', { exact: true }).fill('Ada');
  await dialog.getByLabel('Default color value', { exact: true }).fill('#336699');
  await dialog.getByLabel('Default color value', { exact: true }).press('Enter');
  await dialog.getByLabel('Default SpaceTimeDB server', { exact: true }).fill('https://maincloud.spacetimedb.com');
  await dialog.getByLabel('Default database', { exact: true }).fill('my-tables');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveText('A');

  await page.reload();
  await page.getByRole('button', { name: 'Invite players' }).click();
  await expect(page.locator('.session-identity')).toContainText('Ada');
  await expect(page.getByLabel('Your name', { exact: true })).toHaveCount(0);
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

test('first launch asks for a name before the settings can close and starts with a random opaque color', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('tablecraft.settings.v1'));
  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Welcome to Tablecraft.' });
  await expect(dialog).toBeVisible();
  const sections = await dialog.locator('.settings-section h3').allTextContents();
  expect(sections.indexOf('Player profile')).toBeLessThan(sections.indexOf('Appearance'));
  const name = dialog.getByLabel('Your name', { exact: true });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('');
  await expect(name).not.toHaveAttribute('placeholder', /.+/);
  const color = await dialog.getByLabel('Default color value', { exact: true }).inputValue();
  expect(color).toMatch(/^#[0-9a-f]{6}$/);
  await expect(dialog.getByLabel('Default color alpha', { exact: true })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveText(/Choose a name to continue/);
  await name.fill('   ');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await dialog.getByRole('button', { name: /Start making/ }).click();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await name.fill('Zoë 🎲 x');
  await expect(name).toHaveValue('Zo  x');
  await name.fill('x'.repeat(40));
  await expect(name).toHaveValue('x'.repeat(32));
  await name.fill('  Ada  ');
  await dialog.getByRole('button', { name: /Start making/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveText('A');

  await page.reload();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Make it yours.' });
  await expect(settings.getByLabel('Your name', { exact: true })).toHaveValue('Ada');
  await expect(settings.getByLabel('Default color value', { exact: true })).toHaveValue(color);
  await settings.getByLabel('Your name', { exact: true }).fill('');
  await page.keyboard.press('Escape');
  await expect(settings).toBeVisible();
  await settings.getByLabel('Your name', { exact: true }).fill('Bea');
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
});

test('color pickers fill the whole swatch button with the current color', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Make it yours.' });
  await dialog.getByLabel('Default color value', { exact: true }).fill('#336699');
  await dialog.getByLabel('Default color value', { exact: true }).press('Enter');
  const swatch = dialog.getByLabel('Default color', { exact: true });
  await expect(swatch).toHaveCSS('background-image', /linear-gradient\(rgb\(51, 102, 153\)/);
  await expect(swatch).toHaveCSS('padding-left', '0px');
  await dialog.getByLabel('Your name', { exact: true }).fill('Ada');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Players/ }).click();
  await page.locator('.seat-marker').first().click();
  await expect(page.getByLabel('Player color', { exact: true }).first()).toHaveCSS('background-image', /linear-gradient\(rgb/);
});