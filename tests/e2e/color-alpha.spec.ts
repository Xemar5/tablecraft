import { expect, test } from '@playwright/test';

test('designer color controls edit alpha and preserve it when changing RGB', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await page.getByRole('button', { name: 'Add shape', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rectangle', exact: true }).click();
  const fill = page.getByLabel('Fill color value', { exact: true });
  const alpha = page.getByLabel('Fill color alpha', { exact: true });
  await fill.fill('#12345680');
  await expect(alpha).toHaveValue('128');
  await page.getByLabel('Fill color', { exact: true }).fill('#abcdef');
  await expect(fill).toHaveValue('#abcdef80');
  await expect(page.locator('.artboard .node-shape').last().locator('path').first()).toHaveAttribute('fill', '#abcdef80');
  await alpha.focus();
  await alpha.press('Home');
  await expect(fill).toHaveValue('#abcdef00');
  await alpha.press('End');
  await expect(fill).toHaveValue('#abcdef');
  await fill.fill('rgba(10, 20, 30, 0.5)');
  await expect(alpha).toHaveValue('128');
  await page.getByLabel('Stroke color value', { exact: true }).fill('#76543240');
  await expect(page.getByLabel('Stroke color alpha', { exact: true })).toHaveValue('64');
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page.getByLabel('Text color value', { exact: true }).fill('#abcdef80');
  await expect(page.getByLabel('Text color alpha', { exact: true })).toHaveValue('128');
  await expect(page.locator('.artboard .node-text').last()).toHaveCSS('color', 'rgba(171, 205, 239, 0.5)');
  await page.locator('.artboard-label').click();
  await page.getByLabel('Component background value', { exact: true }).fill('transparent');
  const backgroundAlpha = page.getByLabel('Component background alpha', { exact: true });
  await expect(backgroundAlpha).toHaveValue('0');
  await backgroundAlpha.press('End');
  await expect(page.getByLabel('Component background value', { exact: true })).toHaveValue('#000000');
  await page.reload();
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await expect(page.getByLabel('Component background value', { exact: true })).toHaveValue('#000000');
});

test('player colors support alpha and persist on save', async ({ page }) => {
  await page.goto('/');
  // The inspector opens on Selection; players live on their own tab.
  await page.getByRole('button', { name: /^Players \d+$/ }).click();
  await page.getByRole('button', { name: 'Add hotseat player', exact: true }).click();
  await page.getByLabel('Player color value', { exact: true }).fill('#12345680');
  await expect(page.getByLabel('Player color alpha', { exact: true })).toHaveValue('128');
  await page.getByRole('button', { name: 'Save seat', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const archive = JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!);
    return archive.projects[0].players.at(-1).color;
  })).toBe('#12345680');
});
