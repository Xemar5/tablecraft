import { expect, test } from '@playwright/test';

test('hovering the zoom percentage offers preset levels in the playground and designer', async ({ page }) => {
  await page.goto('/');
  const fit = page.getByRole('button', { name: 'Fit table', exact: true });
  const preset = page.getByRole('button', { name: 'Zoom to 75%', exact: true });
  await expect(preset).toBeHidden();
  await fit.hover();
  await preset.click();
  await expect(fit).toHaveText('75%');
  await fit.hover();
  await expect(preset).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Component designer' }).click();
  const reset = page.getByRole('button', { name: 'Reset zoom', exact: true });
  await reset.hover();
  await page.getByRole('button', { name: 'Zoom to 200%', exact: true }).click();
  await expect(reset).toHaveText('200%');
});

test('Shift+F and the Focus action center the camera on the selection', async ({ page }) => {
  await page.goto('/');
  const fit = page.getByRole('button', { name: 'Fit table', exact: true });
  const zoomBefore = await fit.textContent();
  const pieces = page.locator('#playground-pieces-panel');
  await pieces.getByRole('button', { name: /^Spirit die/ }).click();
  await page.keyboard.press('Shift+F');
  await expect(fit).not.toHaveText(zoomBefore!);
  const viewport = (await page.locator('.table-viewport').boundingBox())!;
  const die = (await page.locator('[data-testid=table-piece].selected').boundingBox())!;
  expect(Math.abs(die.x + die.width / 2 - (viewport.x + viewport.width / 2))).toBeLessThan(4);
  expect(Math.abs(die.y + die.height / 2 - (viewport.y + viewport.height / 2))).toBeLessThan(4);

  await fit.click();
  await expect(fit).toHaveText(zoomBefore!);
  await page.getByRole('button', { name: /Focus/ }).click();
  await expect(fit).not.toHaveText(zoomBefore!);
});
