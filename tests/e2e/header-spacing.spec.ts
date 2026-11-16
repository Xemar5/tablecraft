import { expect, test } from '@playwright/test';

test('the project name keeps clear space from the Tablecraft logo at every header width', async ({ page }) => {
  for (const [width, minimum] of [[1440, 30], [1100, 18], [800, 10]] as const) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/');
    const brand = (await page.locator('.app-header .brand').boundingBox())!;
    const name = (await page.locator('.compact-project h1').boundingBox())!;
    expect(name.x - brand.x - brand.width).toBeGreaterThanOrEqual(minimum);
  }
});
