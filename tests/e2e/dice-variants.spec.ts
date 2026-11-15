import { expect, test } from '@playwright/test';

test('behavior changes component type and edits dice variants with live CSV updates', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit die', exact: true }).click();
  await page.getByRole('button', { name: 'Behavior', exact: true }).click();
  const type = page.getByLabel('Component type', { exact: true });
  await expect(type).toHaveValue('dice');
  await type.selectOption('token');
  await expect(page.getByRole('heading', { name: 'Dice variants', exact: true })).toHaveCount(0);
  await type.selectOption('dice');
  const variant = page.getByLabel('Dice variant', { exact: true });
  await expect(variant.locator('option')).toHaveCount(6);
  await page.getByRole('button', { name: 'Add variant', exact: true }).click();
  await expect(variant.locator('option')).toHaveCount(7);
  await expect(variant).toHaveValue('6');
  await page.getByLabel('Variant value', { exact: true }).fill('Critical');
  await expect(page.locator('.artboard')).toContainText('Critical');
  await page.getByRole('button', { name: 'Remove variant', exact: true }).click();
  await expect(variant.locator('option')).toHaveCount(6);
  await variant.selectOption('3');
  await page.getByRole('button', { name: 'Remove variant', exact: true }).click();
  await expect(variant.locator('option')).toHaveCount(5);
  await expect(page.getByLabel('Variant value', { exact: true })).toHaveValue('5');
  await page.getByRole('button', { name: /Data bindings/ }).click();
  await expect(page.getByLabel('CSV data', { exact: true })).toHaveValue('value\n1\n2\n3\n5\n6');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  for (let count = 5; count > 1; count--) {
    await page.getByRole('button', { name: 'Remove variant', exact: true }).click();
    await expect(variant.locator('option')).toHaveCount(count - 1);
  }
  await expect(page.getByRole('button', { name: 'Remove variant', exact: true })).toBeDisabled();
});
