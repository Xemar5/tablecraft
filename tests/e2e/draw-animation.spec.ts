import { expect, test } from '@playwright/test';

test('drawing from a stack flies the pieces from the stack to the seat, except pieces you dragged into a hand yourself', async ({ page }) => {
  await page.goto('/');
  const deck = page.locator('.table-viewport .table-piece').filter({ has: page.locator('.stack-count') }).first();
  const deckBox = (await deck.boundingBox())!;
  // Count every flight that starts, and where the first one was when it started.
  await page.evaluate(() => {
    const w = window as unknown as { flights: number; start?: { x: number; y: number } };
    w.flights = 0;
    new MutationObserver(list => {
      for (const record of list) for (const node of record.addedNodes) if (node instanceof HTMLElement && node.classList.contains('draw-flight')) {
        w.flights++;
        if (!w.start) { const box = node.getBoundingClientRect(); w.start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }
      }
    }).observe(document.querySelector('.table-world')!, { childList: true });
  });
  await deck.click();
  await page.locator('.action-grid').getByRole('button', { name: /^Draw one/ }).click();
  await expect(page.locator('.hand-card')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { flights: number }).flights)).toBe(1);
  const start = await page.evaluate(() => (window as unknown as { start: { x: number; y: number } }).start);
  expect(Math.hypot(start.x - (deckBox.x + deckBox.width / 2), start.y - (deckBox.y + deckBox.height / 2))).toBeLessThan(20);
  // The flight ends and is removed.
  await expect(page.locator('.draw-flight')).toHaveCount(0, { timeout: 3000 });

  // Drawing three flies three pieces.
  await deck.hover();
  await page.keyboard.press('3');
  await expect(page.locator('.hand-card')).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => (window as unknown as { flights: number }).flights)).toBe(4);
  await expect(page.locator('.draw-flight')).toHaveCount(0, { timeout: 3000 });

  // A card dragged into the hand tray by hand doesn't fly again.
  const card = page.locator('.table-viewport').getByRole('button', { name: 'Spirit cards', exact: true }).first();
  const box = (await card.boundingBox())!, tray = (await page.locator('.hand-tray').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(tray.x + tray.width / 2, tray.y + tray.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.hand-card')).toHaveCount(5);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { flights: number }).flights)).toBe(4);
});
