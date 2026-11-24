import { expect, test } from '@playwright/test';

test('pieces can be grouped, nested, renamed, selected and ungrouped while pointing at the Pieces panel', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('#playground-pieces-panel');
  const tokens = panel.getByRole('button', { name: 'Amber token', exact: true });
  await tokens.nth(0).click();
  await tokens.nth(1).click({ modifiers: ['Control'] });
  await panel.hover();
  await page.keyboard.press('g');
  const group = panel.getByRole('button', { name: /^Group Group 1, 2 pieces/ });
  await expect(group).toBeVisible();
  await expect(panel.locator('[role=treeitem][aria-level="2"]')).toHaveCount(2);

  await group.dblclick();
  await panel.getByLabel('Group name', { exact: true }).fill('Amber');
  await page.keyboard.press('Enter');
  const amber = panel.getByRole('button', { name: /^Group Amber, 2 pieces/ });
  await expect(amber).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.table-piece.selected')).toHaveCount(0);
  await amber.click();
  await expect(page.locator('.table-piece.selected')).toHaveCount(2);

  // A whole group plus another piece nests the group in a new one.
  await panel.getByRole('button', { name: /^Spirit die/ }).click({ modifiers: ['Control'] });
  await panel.hover();
  await page.keyboard.press('g');
  await expect(panel.getByRole('button', { name: /^Group Group 1, 3 pieces/ })).toBeVisible();
  await expect(panel.locator('[role=treeitem][aria-level="3"]')).toHaveCount(2);
  await page.keyboard.press('Shift+G');
  await expect(panel.getByRole('button', { name: /^Group Group 1/ })).toHaveCount(0);
  await expect(amber).toBeVisible();

  // Away from the panel, G still stacks the selection; the stack stays in its group.
  await amber.click();
  await page.locator('.table-viewport').hover({ position: { x: 20, y: 20 } });
  await page.keyboard.press('g');
  await expect(panel.getByRole('button', { name: 'Amber token, stack of 2', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Group Amber, 2 pieces/ })).toBeVisible();
});

test('books turn pages and dice step faces with Shift+Q and Shift+E', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add component', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Books Rules, journals/ }).click();
  await page.getByRole('button', { name: /Playground/ }).click();
  await page.getByRole('button', { name: 'Spawn Field guide', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Field guide, page 1 of 3', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Field guide, page 1 of 3', exact: true }).hover();
  await page.keyboard.press('Shift+E');
  await page.keyboard.press('Shift+E');
  await page.keyboard.press('Shift+E');
  await expect(page.getByRole('button', { name: 'Field guide, page 3 of 3', exact: true })).toBeVisible();
  await page.keyboard.press('Shift+Q');
  await expect(page.getByRole('button', { name: 'Field guide, page 2 of 3', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Show Field guide variants/ })).toHaveCount(0);

  await page.locator('#playground-pieces-panel').getByRole('button', { name: /^Spirit die/ }).click();
  const face = async () => (await page.locator('.table-piece.selected').innerText()).trim();
  const start = Number(await face());
  await page.locator('.table-piece.selected').hover();
  await page.keyboard.press('Shift+E');
  await expect.poll(face).toBe(String(start % 6 + 1));
  await page.keyboard.press('Shift+Q');
  await page.keyboard.press('Shift+Q');
  await expect.poll(face).toBe(String((start + 4) % 6 + 1));
});

test('a book’s fullscreen preview turns its own pages with Shift+Q/E and buttons, leaving the table unchanged', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add component', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Books Rules, journals/ }).click();
  await page.getByRole('button', { name: /Playground/ }).click();
  await page.getByRole('button', { name: 'Spawn Field guide', exact: true }).click();
  const book = page.getByRole('button', { name: 'Field guide, page 1 of 3', exact: true });
  await book.hover();
  await page.keyboard.press('z');
  const dialog = page.getByRole('dialog', { name: 'Fullscreen preview: Field guide' });
  const pages = dialog.getByRole('group', { name: 'Book pages' });
  await expect(pages).toContainText('Page 1 of 3');
  await expect(pages.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await expect(pages.getByRole('button', { name: 'Next page' })).toContainText('Shift+E');
  await expect(dialog).toContainText('Shift+Q / Shift+E · Turn page');
  await page.keyboard.press('Shift+E');
  await page.keyboard.press('Shift+E');
  await expect(pages).toContainText('Page 3 of 3');
  await expect(pages.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await page.keyboard.press('Shift+Q');
  await expect(pages).toContainText('Page 2 of 3');
  await pages.getByRole('button', { name: 'Previous page' }).click();
  await expect(pages).toContainText('Page 1 of 3');
  await expect(dialog).toBeVisible();
  // Q alone still rotates the preview.
  await page.keyboard.press('e');
  await expect(dialog.locator('.piece-preview-art')).toHaveAttribute('data-rotation', '90');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(book).toBeVisible();
});

test('the interface scale zooms the page without page scrolling, and pieces still follow the pointer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('radio', { name: '125%', exact: true }).click();
  await expect(page.locator('html')).toHaveCSS('zoom', '1.25');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect.poll(() => page.evaluate(() => [document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth])).toEqual([0, 0]);

  const piece = page.locator('.table-viewport').getByRole('button', { name: 'Spirit die', exact: true });
  // The small view at 125% can put the die under the zoom controls; focus the camera on it first.
  await page.locator('#playground-pieces-panel').getByRole('button', { name: /^Spirit die/ }).click();
  await page.locator('.action-grid').getByRole('button', { name: /^Focus/ }).click();
  await page.keyboard.press('Escape');
  const before = (await piece.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 40, before.y + before.height / 2 - 30, { steps: 4 });
  await page.mouse.up();
  const after = (await piece.boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(40, 0);
  expect(after.y - before.y).toBeCloseTo(-30, 0);

  await page.reload();
  await expect(page.locator('html')).toHaveCSS('zoom', '1.25');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('radio', { name: '100%', exact: true }).click();
  await expect(page.locator('html')).toHaveCSS('zoom', '1');
});

test('hand cards fill the tray height and keep their aspect ratio', async ({ page }) => {
  await page.goto('/');
  await page.locator('.table-viewport').getByRole('button', { name: /^Spirit cards, stack of/ }).dblclick();
  const thumbnail = page.locator('.hand-card .component-thumbnail').first();
  // Layout sizes: hand cards are slightly rotated, which would inflate their bounding boxes.
  const size = () => thumbnail.evaluate(element => ({ width: (element as HTMLElement).offsetWidth, height: (element as HTMLElement).offsetHeight }));
  const tray = await page.locator('#hand-tray-panel').evaluate(element => (element as HTMLElement).offsetHeight);
  const first = await size();
  expect(first.height).toBeGreaterThan(tray - 40);
  expect(first.width / first.height).toBeCloseTo(220 / 308, 1);
  await page.getByRole('separator', { name: 'Resize hand tray' }).focus();
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(async () => (await size()).height).toBeGreaterThan(first.height + 40);
  const taller = await size();
  expect(taller.width / taller.height).toBeCloseTo(220 / 308, 1);
});

test('the Google font chooser lists every suggested font under its field', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  const input = page.getByLabel('Google font / binding', { exact: true });
  await page.getByRole('button', { name: 'Show fonts', exact: true }).click();
  const list = page.getByRole('listbox', { name: 'Google font / binding suggestions' });
  await expect(list.getByRole('option')).toHaveCount(42);
  const field = (await input.boundingBox())!, popup = (await list.boundingBox())!;
  expect(Math.abs(popup.x - field.x)).toBeLessThan(2);
  expect(popup.y).toBeGreaterThanOrEqual(field.y + field.height);
  expect(popup.y - (field.y + field.height)).toBeLessThan(10);
  await list.getByRole('option', { name: 'Cinzel', exact: true }).click();
  await expect(input).toHaveValue('Cinzel');
  await expect(page.locator('.designer-canvas .node-text').last()).toHaveCSS('font-family', /Cinzel/);
});
