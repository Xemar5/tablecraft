import { expect, test } from '@playwright/test';
import { expectHeaderEnabled } from './headerMenus';

test('undo notices pop up as dismissible toasts and new notices still appear', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page.getByRole('button', { name: 'Playground', exact: true }).click();
  const notice = page.locator('.undo-toast').filter({ hasText: 'Undo history cleared' }).filter({ hasText: 'Component designs changed.' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expectHeaderEnabled(page, 'Undo', false);
  await page.getByRole('button', { name: 'Component designer', exact: true }).click();
  await page.getByRole('button', { name: 'Playground', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await page.getByRole('button', { name: 'Spawn Amber token', exact: true }).click();
  await expectHeaderEnabled(page, 'Undo', true);
  await page.getByRole('button', { name: 'Component designer', exact: true }).click();
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page.getByRole('button', { name: 'Playground', exact: true }).click();
  await expect(notice).toBeVisible();
  await notice.click();
  await expect(notice).toHaveCount(0);
  await page.getByRole('button', { name: 'Component designer', exact: true }).click();
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page.getByRole('button', { name: 'Playground', exact: true }).click();
  await expect(notice).toHaveCount(0);
});

test('undo toasts hide on their own after a few seconds', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page.getByRole('button', { name: 'Playground', exact: true }).click();
  const notice = page.locator('.undo-toast');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveCount(0, { timeout: 9000 });
});

test('dismissing a storage warning does not permit overwriting the unreadable save', async ({ page }) => {
  await page.goto('/');
  const raw = '{invalid save';
  await page.evaluate(value => localStorage.setItem('tablecraft.workspace.v1', value), raw);
  await page.reload();
  const warning = page.getByRole('alert').filter({ hasText: "Your previous save couldn't be read." });
  await expect(warning.getByRole('button', { name: 'Download recovery & continue', exact: true })).toBeVisible();
  await warning.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await expect(warning).toHaveCount(0);
  await page.getByRole('button', { name: 'Open project Wildwood', exact: true }).click();
  const pieces = await page.locator('.table-piece').count();
  await page.getByRole('button', { name: 'Spawn Amber token', exact: true }).click();
  await expect(page.locator('.table-piece')).toHaveCount(pieces + 1);
  expect(await page.evaluate(() => localStorage.getItem('tablecraft.workspace.v1'))).toBe(raw);
  await page.reload();
  await expect(warning).toBeVisible();
});
