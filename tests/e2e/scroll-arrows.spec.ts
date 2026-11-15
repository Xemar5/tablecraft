import { expect, test } from '@playwright/test';

for (const surface of ['library filters', 'designer toolbar']) {
  test(`${surface} arrows appear on hover and scroll while held`, async ({ page }) => {
    await page.goto('/');
    let strip = page.locator('.library-filters');
    if (surface === 'designer toolbar') {
      await page.setViewportSize({ width: 1000, height: 900 });
      await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
      strip = page.locator('.canvas-toolbar');
    } else {
      await page.getByRole('separator', { name: 'Resize component library', exact: true }).focus();
      await page.keyboard.press('Home');
    }
    const right = page.getByRole('button', { name: `Scroll ${surface} right`, exact: true });
    const left = page.getByRole('button', { name: `Scroll ${surface} left`, exact: true });
    await expect(left).toHaveCount(0);
    await right.hover();
    await expect(right.locator('svg')).toHaveCSS('opacity', '1');
    await page.mouse.down();
    await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBeGreaterThan(20);
    await page.mouse.up();
    const stopped = await strip.evaluate(el => el.scrollLeft);
    // Let multiple frames pass before checking that release stopped the animation.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await strip.evaluate(el => el.scrollLeft)).toBe(stopped);
    if (await right.count()) {
      await right.hover();
      await page.mouse.down();
      await expect(right).toHaveCount(0);
      await page.mouse.up();
    }
    await left.hover();
    await page.mouse.down();
    await expect(left).toHaveCount(0);
    await page.mouse.up();
    await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBe(0);
    await expect(right).toBeVisible();
    await right.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  });
}
