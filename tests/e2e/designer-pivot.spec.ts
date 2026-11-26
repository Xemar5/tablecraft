import { expect, test, type Page } from '@playwright/test';

const field = (page: Page, name: string) => page.getByRole('spinbutton', { name, exact: true });
const centre = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** The centre of the first match once the canvas has stopped zooming to fit (it settles just after opening). */
const settled = async (page: Page, selector: string) => {
  let last = await centre(page, selector);
  for (;;) {
    await page.waitForTimeout(150);
    const next = await centre(page, selector);
    if (near(next, last) < .01) return next;
    last = next;
  }
};

test('a pivot is placed by X/Y, the layer grows and turns around it, and it moves without moving the layer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Component designer', exact: true }).click();
  await page.getByRole('button', { name: 'Card name', exact: true }).click();
  const layer = '.artboard .design-node[style*="box-shadow"]', marker = page.locator('.transform-pivot');
  const [x, y, width] = ['X', 'Y', 'Width'].map(name => field(page, name));
  const start = { x: Number(await x.inputValue()), y: Number(await y.inputValue()), width: Number(await width.inputValue()), height: Number(await field(page, 'Height').inputValue()) };
  // New layers keep their top-left corner at X/Y.
  await expect(page.getByRole('radio', { name: 'Pivot top left', exact: true })).toHaveAttribute('aria-checked', 'true');
  const middle = await settled(page, layer);

  // Moving the pivot to the centre leaves the layer where it is; X/Y now place its centre.
  await page.getByRole('radio', { name: 'Pivot center', exact: true }).click();
  await expect(x).toHaveValue(String(start.x + start.width / 2));
  await expect(y).toHaveValue(String(start.y + start.height / 2));
  expect(near(await centre(page, layer), middle)).toBeLessThan(1);
  expect(near(await centre(page, '.transform-pivot'), middle)).toBeLessThan(1);

  // A wider layer grows around its pivot, so its centre stays put.
  await width.fill(String(start.width + 40));
  await width.blur();
  await expect.poll(async () => (await page.locator(layer).first().boundingBox())!.width).toBeGreaterThan(start.width);
  expect(near(await centre(page, layer), middle)).toBeLessThan(1);

  // Dragging the pivot marker near a corner snaps it there, and the layer still doesn't move.
  const corner = await centre(page, '[aria-label="Resize from top-left corner"]');
  await marker.hover();
  await page.mouse.down();
  await page.mouse.move(corner.x + 3, corner.y + 2, { steps: 5 });
  await page.mouse.up();
  await expect(field(page, 'Pivot X')).toHaveValue('0');
  await expect(field(page, 'Pivot Y')).toHaveValue('0');
  await expect(page.getByRole('radio', { name: 'Pivot top left', exact: true })).toHaveAttribute('aria-checked', 'true');
  expect(near(await centre(page, layer), middle)).toBeLessThan(1);

  // Rotating with the handle turns the layer about its pivot: the pivot stays where it is.
  const pivot = await centre(page, '.transform-pivot');
  const handle = await centre(page, '[aria-label="Rotate layer"]');
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + 60, handle.y + 40, { steps: 6 });
  await page.mouse.up();
  await expect(field(page, 'Rotation')).not.toHaveValue('0');
  expect(near(await centre(page, '.transform-pivot'), pivot)).toBeLessThan(1.5);
  expect(near(await centre(page, layer), middle)).toBeGreaterThan(5);
});
