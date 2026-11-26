import { expect, test } from '@playwright/test';
import { headerItem, openHeaderMenu } from './headerMenus';

test('opening and closing panels keeps the table centred on every frame', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-viewport [aria-label="Forest clearing"]')).toBeVisible();
  for (const toggle of ['Component library', 'Component library', 'Table inspector', 'Table inspector']) {
    // The item is clicked in the open Visibility menu, which doesn't move anything by itself.
    if (!await headerItem(page, toggle).isVisible()) await openHeaderMenu(page, toggle);
    // Record, on every frame, how far the board's centre is from the view's centre.
    await page.evaluate(() => {
      const w = window as unknown as { offsets: number[]; sampling: boolean };
      w.offsets = []; w.sampling = true;
      const sample = () => {
        if (!w.sampling) return;
        const board = document.querySelector('.table-viewport [aria-label="Forest clearing"]')!.getBoundingClientRect();
        const view = document.querySelector('.table-viewport')!.getBoundingClientRect();
        w.offsets.push(Math.round((board.left + board.width / 2) - (view.left + view.width / 2)));
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.waitForTimeout(100);
    await headerItem(page, toggle).click();
    await page.waitForTimeout(400);
    const offsets = await page.evaluate(() => { const w = window as unknown as { offsets: number[]; sampling: boolean }; w.sampling = false; return w.offsets; });
    expect(offsets.length).toBeGreaterThan(10);
    expect(new Set(offsets.map(offset => Math.round(offset / 2))).size, `offsets: ${offsets.join(' ')}`).toBe(1);
  }
});
