import { expect, test } from '@playwright/test';

test('continuous inspector edits create one undo entry when the edit finishes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  const undo = page.getByRole('button', { name: 'Undo design edit' });
  const name = page.getByLabel('Layer name', { exact: true });
  const originalName = await name.inputValue();

  await name.click();
  await name.press('End');
  await name.pressSequentially(' renamed');
  await name.press('Tab');
  await expect(name).toHaveValue(`${originalName} renamed`);
  await undo.click();
  await expect(name).toHaveValue(originalName);

  const alpha = page.getByLabel('Text color alpha', { exact: true });
  const alphaOutput = page.locator('.color-field').filter({ has: alpha }).locator('output');
  await expect(alphaOutput).toHaveText('100%');
  await alpha.scrollIntoViewIfNeeded();
  const box = (await alpha.boundingBox())!;
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await page.mouse.down();
  for (const fraction of [.8, .6, .4, .2]) await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2, { steps: 3 });
  await page.mouse.up();
  await expect(alphaOutput).not.toHaveText('100%');
  await undo.click();
  await expect(alphaOutput).toHaveText('100%');

  const x = page.getByLabel('X', { exact: true });
  const originalX = await x.inputValue();
  await x.scrollIntoViewIfNeeded();
  const xBox = (await x.boundingBox())!;
  await page.mouse.move(xBox.x + xBox.width / 2, xBox.y + xBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(xBox.x + xBox.width / 2, xBox.y - 40, { steps: 8 });
  await page.mouse.up();
  await expect(x).not.toHaveValue(originalX);
  await undo.click();
  await expect(x).toHaveValue(originalX);
  await expect(name).toHaveValue(originalName);
});
