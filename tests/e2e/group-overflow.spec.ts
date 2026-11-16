import { expect, test } from '@playwright/test';

test('groups do not clip children that extend beyond their bounds', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await page.getByRole('button', { name: 'Add empty element', exact: true }).click();
  await page.getByLabel('Layer name', { exact: true }).fill('Overflow group');
  await page.getByLabel('Width', { exact: true }).fill('60'); await page.getByLabel('Width', { exact: true }).press('Enter');
  await page.getByLabel('Height', { exact: true }).fill('40'); await page.getByLabel('Height', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page.getByLabel('Text / binding', { exact: true }).fill('Outside text');
  await page.getByLabel('X', { exact: true }).fill('80'); await page.getByLabel('X', { exact: true }).press('Enter');
  const face = page.locator('.artboard .component-face').first();
  const group = face.locator('.node-frame').filter({ has: page.getByText('Outside text', { exact: true }) }).last();
  const child = group.locator('.node-text').filter({ hasText: 'Outside text' });
  await expect(group).toHaveCSS('overflow', 'visible');
  const groupBox = (await group.boundingBox())!, childBox = (await child.boundingBox())!;
  expect(childBox.x).toBeGreaterThan(groupBox.x + groupBox.width);
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.node-text')?.textContent, [childBox.x + childBox.width / 2, childBox.y + childBox.height / 2]);
  expect(hit).toBe('Outside text');
});
