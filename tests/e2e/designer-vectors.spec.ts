import { expect, test } from '@playwright/test';

test('creates editable paths, live boolean compounds and linked component data', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  const layers = page.locator('.layer-row');
  const initial = await layers.count();
  await expect(page.getByLabel('Botanical motif (optional)')).toHaveCount(0);

  await page.getByLabel('Shape type to add').selectOption('ellipse');
  await page.getByRole('button', { name: 'Add shape', exact: true }).click();
  await expect(layers).toHaveCount(initial + 1);
  await expect(page.getByLabel('Vector shape')).toHaveValue('ellipse');
  await page.getByLabel('Stroke weight').fill('2');
  await expect(page.getByLabel('Stroke weight')).toHaveValue('2');
  await page.getByLabel('Vector shape').selectOption('path');
  await expect(page.locator('.vector-editor-heading')).toContainText('4 points');

  await page.getByLabel('Shape type to add').selectOption('path');
  await page.getByRole('button', { name: 'Add shape', exact: true }).click();
  await expect(page.locator('.vector-editor-heading')).toContainText('4 points');
  await page.getByRole('button', { name: 'Add point', exact: true }).click();
  await expect(page.locator('.vector-editor-heading')).toContainText('5 points');
  await page.getByRole('button', { name: 'Delete point', exact: true }).click();
  await expect(page.locator('.vector-editor-heading')).toContainText('4 points');
  await page.getByRole('button', { name: 'Smooth handles', exact: true }).click();
  await expect(page.locator('.vector-handle')).toHaveCount(2);
  const handle = page.locator('.vector-handle').first();
  const box = (await handle.boundingBox())!;
  const inHandleX = page.getByLabel('In handle X');
  const oldInHandleX = await inHandleX.inputValue();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 - 12, { steps: 3 });
  await page.mouse.up();
  await expect(inHandleX).not.toHaveValue(oldInHandleX);

  await layers.nth(initial).click();
  await layers.nth(initial + 1).click({ modifiers: ['Control'] });
  await page.getByLabel('Boolean operation').selectOption('intersect');
  await page.getByRole('button', { name: 'Create live compound', exact: true }).click();
  await expect(layers).toHaveCount(initial + 3);
  await expect(page.getByLabel('Live boolean operation')).toHaveValue('intersect');
  await layers.nth(initial + 2).click();
  await expect(page.locator('.artboard .vector-point-editor')).toBeVisible();
  await layers.nth(initial).click();
  await page.getByRole('button', { name: 'Uncombine source shapes', exact: true }).click();
  await expect(layers).toHaveCount(initial + 2);

  await page.getByLabel('Link nested component').selectOption({ label: 'Spirit die' });
  await expect(page.getByLabel('Linked component')).toHaveValue(/.+/);
  await page.getByLabel('Nested data').selectOption('row');
  await page.getByLabel(/Own row/).fill('1');
  await page.getByLabel(/Own row/).blur();
  await expect(page.locator('.nested-component-error')).toHaveCount(0);
  await page.getByLabel('Nested data').selectOption('field');
  await page.getByLabel('Parent CSV field (zero-based row index)').fill('cost');
  await expect(page.locator('.nested-component-error')).toHaveCount(0);
  await expect(page.locator('.artboard .nested-component-content')).toContainText('4');
});
