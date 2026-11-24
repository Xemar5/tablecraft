import { expect, test } from '@playwright/test';

// After a shuffle, another action within the animation must not leave the stack marked as shuffling, or a later draw
// (which changes the top piece) replays the animation.
test('a shuffle animation ends even when something else happens during it, and drawing later does not replay it', async ({ page }) => {
  await page.goto('/');
  const deck = page.locator('.table-viewport .table-piece').filter({ has: page.locator('.stack-count') }).first();
  await deck.click();
  await page.locator('.action-grid').getByRole('button', { name: /^Shuffle/ }).click();
  // Another table change straight away.
  await page.locator('.action-grid').getByRole('button', { name: /^Rotate \+90/ }).click();
  await page.waitForTimeout(1200);
  await expect(page.locator('.table-piece.shuffling')).toHaveCount(0);
  await page.evaluate(() => {
    const w = window as unknown as { replays: number };
    w.replays = 0;
    new MutationObserver(() => { if (document.querySelector('.table-piece.shuffling')) w.replays++; }).observe(document.querySelector('.table-world')!, { attributes: true, childList: true, subtree: true, attributeFilter: ['class'] });
  });
  await deck.click();
  await page.locator('.action-grid').getByRole('button', { name: /^Draw one/ }).click();
  await expect(page.locator('.hand-card')).toHaveCount(1);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { replays: number }).replays)).toBe(0);
});
