import { expect, test } from '@playwright/test';

// A layer moved by a compositor animation (or marked will-change) is stretched instead of redrawn when zoomed, which
// looks blurry. Once the view rests, the table and the fullscreen preview fall back to a plain transform.
const resting = (selector: string) => (page: import('@playwright/test').Page) => page.locator(selector).evaluate(element => ({
  animations: element.getAnimations().length, willChange: getComputedStyle(element).willChange, transform: (element as HTMLElement).style.transform,
}));

test('the zoomed table and fullscreen preview are redrawn at their zoom once they stop moving', async ({ page }) => {
  await page.goto('/');
  const zoomIn = page.locator('.zoom-control').getByRole('button', { name: 'Zoom in' });
  for (let i = 0; i < 12; i++) await zoomIn.click();
  await expect.poll(() => resting('.table-world')(page)).toMatchObject({ animations: 0, willChange: 'auto', transform: expect.stringMatching(/scale\((?:[2-9]|1\.[5-9])/) });

  // Panning goes back to the compositor while it moves, then settles again.
  const viewport = (await page.locator('.table-viewport').boundingBox())!;
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => resting('.table-world')(page)).toMatchObject({ animations: 0, willChange: 'auto' });

  await page.locator('.table-viewport').getByRole('button', { name: 'Spirit die', exact: true }).hover();
  await page.keyboard.press('z');
  const art = page.locator('.piece-preview-art');
  await page.mouse.wheel(0, -400);
  await expect.poll(() => resting('.piece-preview-art')(page)).toMatchObject({ animations: 0, transform: expect.stringMatching(/scale\((?!1\))/) });
  await expect(art).toBeVisible();
});
