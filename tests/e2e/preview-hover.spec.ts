import { expect, test } from '@playwright/test';

test('previews switch sides when hovering near the right edge of the playground', async ({ page }) => {
  await page.goto('/');
  const tokenId = await page.locator('.table-piece').filter({ has: page.locator('.component-token') }).first().getAttribute('data-piece-id');
  const token = page.locator(`[data-piece-id="${tokenId}"]`);
  const preview = page.locator('.hover-preview');
  const viewport = (await page.locator('.table-viewport').boundingBox())!;
  for (const fraction of [.85, .3, .85]) {
    await token.hover();
    await page.mouse.down();
    await page.mouse.move(viewport.x + viewport.width * fraction, viewport.y + viewport.height * .65, { steps: 10 });
    await page.mouse.up();
    await token.hover();
    await expect(preview).toBeVisible();
    await expect.poll(async () => {
      const bounds = (await preview.boundingBox())!;
      return fraction > 2 / 3
        ? Math.abs(bounds.x - viewport.x - 16)
        : Math.abs(bounds.x + bounds.width - viewport.x - viewport.width + 16);
    }).toBeLessThan(2);
    await page.keyboard.down('Alt');
    await expect(preview).toHaveCount(0);
    await page.keyboard.up('Alt');
    await expect(preview).toBeVisible();
  }
});

test('scaled previews have no empty horizontal overflow and locked pieces have no preview', async ({ page }) => {
  await page.goto('/');
  const tokenId = await page.locator('.table-piece').filter({ has: page.locator('.component-token') }).first().getAttribute('data-piece-id');
  const token = page.locator(`[data-piece-id="${tokenId}"]`);
  const preview = page.locator('.hover-preview');
  await token.hover();
  await expect(preview).toBeVisible();
  const shortcuts = preview.getByRole('table', { name: 'Piece shortcuts' });
  await expect(shortcuts.getByRole('row')).toHaveCount(6);
  await expect(shortcuts.getByRole('rowheader')).toHaveText(['Flip', 'Rotate −90° / +90°', 'Shuffle / roll', 'Stack selection', 'Draw cards', 'Hide preview']);
  await expect(shortcuts.getByRole('cell')).toHaveText(['F', 'Q / E', 'R', 'G', '1–0', 'Alt']);
  const columns = await shortcuts.locator('tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('th,td')].map(cell => cell.getBoundingClientRect().x)));
  expect(columns.every(([description, key]) => description === columns[0][0] && key === columns[0][1] && key > description)).toBe(true);
  await expect.poll(() => preview.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
  const thumbnail = preview.locator('.component-thumbnail');
  const initialWidth = (await thumbnail.boundingBox())!.width;
  await preview.hover();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 100);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await thumbnail.boundingBox())!.width).toBeLessThan(initialWidth);
  await expect.poll(() => preview.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
  await token.click();
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await token.hover();
  await expect(preview).toHaveCount(0);
  await token.focus();
  await expect(preview).toHaveCount(0);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await token.hover();
  await expect(preview).toBeVisible();
});

test('previews follow hover and Alt only temporarily suppresses the hovered piece', async ({ page }) => {
  await page.goto('/');
  const stack = page.locator('.table-piece').filter({ has: page.locator('.stack-count') });
  const preview = page.locator('.hover-preview');
  await stack.hover();
  await expect(preview).toBeVisible();
  await page.keyboard.down('Alt');
  await expect(preview).toHaveCount(0);
  await page.keyboard.up('Alt');
  await expect(preview).toBeVisible();
  const viewport = (await page.locator('.table-viewport').boundingBox())!;
  await page.mouse.move(viewport.x + 12, viewport.y + viewport.height - 70);
  await expect(preview).toHaveCount(0);
  await page.keyboard.press('Alt');
  await expect(preview).toHaveCount(0);
  await stack.hover();
  await page.keyboard.press('1');
  const card = page.locator('.hand-card').first();
  await card.hover();
  await expect(preview).toBeVisible();
  await page.getByRole('button', { name: 'Shuffle hand', exact: true }).hover();
  await expect(preview).toHaveCount(0);
  await stack.hover();
  await preview.hover();
  await expect(preview).toBeVisible();
  await page.mouse.move(viewport.x + 12, viewport.y + viewport.height - 70);
  await expect(preview).toHaveCount(0);
});
