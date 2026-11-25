import { expect, test } from '@playwright/test';
import { chooseHeader, expectHeaderChecked, expectHeaderEnabled, headerItem, toggleHeader } from './headerMenus';

test('the header groups panel and scripting toggles into Visibility and Scripting menus', async ({ page }) => {
  await page.goto('/');
  const visibility = page.getByRole('button', { name: 'Visibility', exact: true });
  await visibility.click();
  await expect(page.getByRole('menu', { name: 'Visibility' }).getByRole('menuitemcheckbox')).toHaveText(['Component library', 'Pieces panel', 'Hand panel', 'Table inspector']);
  // Items toggle without closing the menu; a click elsewhere closes it.
  await headerItem(page, 'Hand panel').click();
  await expect(headerItem(page, 'Hand panel')).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.hand-tray')).toHaveCount(0);
  await headerItem(page, 'Hand panel').click();
  await page.locator('.table-viewport').click({ position: { x: 20, y: 20 } });
  await expect(visibility).toHaveAttribute('aria-expanded', 'false');

  // Keyboard: arrows open and move through the menu, Space toggles, Escape closes and returns focus.
  const scripting = page.getByRole('button', { name: 'Scripting', exact: true });
  await scripting.focus();
  await page.keyboard.press('ArrowDown');
  await expect(headerItem(page, 'Scripts')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(headerItem(page, 'Memory')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('region', { name: 'Memory', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(scripting).toHaveAttribute('aria-expanded', 'false');
  await expect(scripting).toBeFocused();
  await expect(scripting).toHaveClass(/has-active/);
});

test('the designer inspector can be hidden from the Visibility menu, separately from the table inspector', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  const inspector = page.locator('#designer-inspector-panel');
  const canvas = page.locator('.artboard');
  await expect(inspector).toBeVisible();
  const before = (await page.locator('.canvas-bottom').boundingBox())!.width;
  await toggleHeader(page, 'Designer inspector');
  await expect(inspector).toBeHidden();
  await expect(page.getByRole('separator', { name: 'Resize designer inspector', exact: true })).toHaveCount(0);
  await expect(canvas).toBeVisible();
  await expect.poll(async () => (await page.locator('.canvas-bottom').boundingBox())!.width).toBeGreaterThan(before);
  // The table inspector keeps its own setting.
  await page.getByRole('button', { name: 'Playground', exact: true }).click();
  await expect(page.locator('.playground-inspector')).toBeVisible();
  await expectHeaderChecked(page, 'Table inspector', true);
  await page.getByRole('button', { name: 'Component designer', exact: true }).click();
  await expect(inspector).toBeHidden();
  await toggleHeader(page, 'Designer inspector');
  await expect(inspector).toBeVisible();
});

test('the Actions menu undoes and redoes table actions, also with Ctrl+Z and Ctrl+Y, and saves and prints', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem')).toHaveText(['UndoCtrl Z', 'RedoCtrl Y', 'Save playground', 'Print to PDF']);
  await page.keyboard.press('Escape');
  await expectHeaderEnabled(page, 'Undo', false);
  await expectHeaderEnabled(page, 'Redo', false);
  const token = page.locator('.table-viewport').getByRole('button', { name: 'Amber token', exact: true }).first();
  const id = await token.getAttribute('data-piece-id');
  const piece = page.locator(`.table-piece[data-piece-id="${id}"]`);
  await piece.click();
  await page.locator('.action-grid').getByRole('button', { name: /^Lock/ }).click();
  await expect(piece).toHaveClass(/locked/);
  await chooseHeader(page, 'Undo');
  await expect(piece).not.toHaveClass(/locked/);
  await expectHeaderEnabled(page, 'Redo', true);
  await chooseHeader(page, 'Redo');
  await expect(piece).toHaveClass(/locked/);
  await page.locator('.table-viewport').click({ position: { x: 30, y: 30 } });
  await page.keyboard.press('Control+z');
  await expect(piece).not.toHaveClass(/locked/);
  await page.keyboard.press('Control+y');
  await expect(piece).toHaveClass(/locked/);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');
  await expect(piece).toHaveClass(/locked/);
  await expectHeaderEnabled(page, 'Redo', false);
  await chooseHeader(page, 'Print to PDF');
  await expect(page.getByRole('dialog', { name: 'Print to PDF' })).toBeVisible();
});
