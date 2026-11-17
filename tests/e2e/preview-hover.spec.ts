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

test('previews switch sides before they would cover the hovered piece on a narrow table', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/');
  const tokenId = await page.locator('.table-piece').filter({ has: page.locator('.component-token') }).first().getAttribute('data-piece-id');
  const token = page.locator(`[data-piece-id="${tokenId}"]`);
  const preview = page.locator('.hover-preview');
  const viewport = (await page.locator('.table-viewport').boundingBox())!;
  const x = viewport.x + viewport.width * .58;
  const y = await page.evaluate(([x, top, height]) => {
    for (let f = .15; f < .85; f += .05) {
      const y = top + height * f;
      if ([-30, 0, 30].every(dx => [-30, 0, 30].every(dy => !document.elementFromPoint(x + dx, y + dy)?.closest('.table-piece, [data-seat-id], .table-hand')))) return y;
    }
    return top + height * .3;
  }, [x, viewport.y, viewport.height]);
  await token.hover();
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 10 });
  await page.mouse.up();
  await page.mouse.move(viewport.x + 5, viewport.y + 5);
  await expect(preview).toHaveCount(0);
  await page.evaluate(() => {
    const root = document.querySelector('.table-viewport')!;
    const frames: number[] = [];
    (window as unknown as { previewFrames: number[] }).previewFrames = frames;
    const observer = new MutationObserver(() => {
      const element = root.querySelector('.hover-preview');
      if (element) frames.push(element.getBoundingClientRect().x);
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
    setTimeout(() => observer.disconnect(), 2000);
  });
  await token.hover();
  await expect(preview).toBeVisible();
  await page.mouse.move(x + 1, y);
  await expect.poll(async () => Math.abs((await preview.boundingBox())!.x - viewport.x - 16)).toBeLessThan(2);
  const frames = await page.evaluate(() => (window as unknown as { previewFrames: number[] }).previewFrames);
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.every(left => Math.abs(left - viewport.x - 16) < 2)).toBe(true);
});

test('scaled previews have no empty horizontal overflow and locked pieces have no preview', async ({ page }) => {
  await page.goto('/');
  const tokenId = await page.locator('.table-piece').filter({ has: page.locator('.component-token') }).first().getAttribute('data-piece-id');
  const token = page.locator(`[data-piece-id="${tokenId}"]`);
  const preview = page.locator('.hover-preview');
  await token.hover();
  await expect(preview).toBeVisible();
  const shortcuts = preview.getByRole('table', { name: 'Piece shortcuts' });
  await expect(shortcuts.getByRole('row')).toHaveCount(8);
  await expect(shortcuts.getByRole('rowheader')).toHaveText(['Flip', 'Rotate −90° / +90°', 'Shuffle / roll', 'Stack selection', 'Draw cards', 'Lock / unlock', 'Hide preview', 'Fullscreen preview']);
  await expect(shortcuts.getByRole('cell')).toHaveText(['F', 'Q / E', 'R', 'G', '1–0', 'L', 'Alt', 'Z']);
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
  await page.locator('.action-grid').getByRole('button', { name: /^Lock/ }).click();
  await token.hover();
  await expect(preview).toHaveCount(0);
  await token.focus();
  await expect(preview).toHaveCount(0);
  await page.locator('.action-grid').getByRole('button', { name: /^Unlock/ }).click();
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
