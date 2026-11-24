import { expect, test } from '@playwright/test';

test('opening and closing panels keeps the table centred on every frame', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-viewport [aria-label="Forest clearing"]')).toBeVisible();
  for (const toggle of ['Toggle component library', 'Toggle component library', 'Toggle table inspector', 'Toggle table inspector']) {
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
    await page.getByRole('button', { name: toggle, exact: true }).click();
    await page.waitForTimeout(400);
    const offsets = await page.evaluate(() => { const w = window as unknown as { offsets: number[]; sampling: boolean }; w.sampling = false; return w.offsets; });
    expect(offsets.length).toBeGreaterThan(10);
    expect(new Set(offsets.map(offset => Math.round(offset / 2))).size, `offsets: ${offsets.join(' ')}`).toBe(1);
  }
});
