import { expect, test } from '@playwright/test';

test('new projects start with one active seat and added seats spread around the table', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Tablecraft home' }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Seat layout');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.locator('.seat-marker')).toHaveCount(1);
  await expect(page.locator('.seat-marker.active')).toHaveCount(1);
  await page.getByRole('button', { name: /^Players \d+$/ }).click();
  for (let n = 0; n < 3; n++) {
    await page.getByRole('button', { name: /Add hotseat player/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^(Add|Save)/ }).first().click();
    await expect(page.locator('.seat-marker')).toHaveCount(n + 2);
  }
  const stored = await page.evaluate(() => {
    const archive = JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!);
    return archive.projects.find((project: { name: string }) => project.name === 'Seat layout').players
      .map((player: { x: number; y: number; rotation: number }) => [player.x, player.y, player.rotation]);
  });
  expect(stored).toEqual([[980, 1000, 0], [980, 100, 180], [220, 550, 90], [1740, 550, -90]]);
});
