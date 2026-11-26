import { expect, test, type Page } from '@playwright/test';

const center = async (page: Page, name: string) => {
  const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const drag = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }, shift = false) => {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
};
const value = (page: Page, label: string) => page.getByLabel(label, { exact: true }).inputValue().then(Number);

test('selected layers resize from edges and corners and rotate from the canvas handles', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  const zoom = Number((await page.locator('.canvas-bottom button').nth(1).textContent())!.replace('%', '')) / 100;
  const element = page.locator('.artboard .design-node').last();
  await expect(page.locator('.transform-box')).toBeVisible();
  const before = { x: await value(page, 'X'), y: await value(page, 'Y'), width: await value(page, 'Width'), height: await value(page, 'Height') };
  const nodeBox = (await element.boundingBox())!;
  const corner = await center(page, 'Resize from bottom-right corner');
  expect(Math.abs(corner.x - (nodeBox.x + nodeBox.width))).toBeLessThan(2);
  expect(Math.abs(corner.y - (nodeBox.y + nodeBox.height))).toBeLessThan(2);

  await drag(page, corner, { x: corner.x + 40 * zoom, y: corner.y + 20 * zoom });
  await expect.poll(() => value(page, 'Width')).toBe(before.width + 40);
  expect(await value(page, 'Height')).toBe(before.height + 20);
  expect(await value(page, 'X')).toBe(before.x);

  const left = await center(page, 'Resize from left edge');
  await drag(page, left, { x: left.x + 30 * zoom, y: left.y + 50 });
  await expect.poll(() => value(page, 'X')).toBe(before.x + 30);
  expect(await value(page, 'Width')).toBe(before.width + 10);
  expect(await value(page, 'Height')).toBe(before.height + 20);

  // The layer turns about its pivot (its top-left corner): a quarter turn of the handle around it is 90°.
  const rotate = await center(page, 'Rotate layer'), pivot = await center(page, 'Move pivot');
  await drag(page, rotate, { x: pivot.x - (rotate.y - pivot.y), y: pivot.y + (rotate.x - pivot.x) + 3 }, true);
  await expect.poll(() => value(page, 'Rotation')).toBe(90);
  const turned = await center(page, 'Move pivot');
  expect(Math.hypot(turned.x - pivot.x, turned.y - pivot.y)).toBeLessThan(1.5);
  const rotated = (await page.locator('.transform-box').boundingBox())!;
  expect(Math.abs(rotated.width - (before.height + 20) * zoom)).toBeLessThan(3);

  await page.getByRole('button', { name: 'Undo design edit', exact: true }).click();
  await expect.poll(() => value(page, 'Rotation')).toBe(0);
  await page.getByRole('button', { name: 'Undo design edit', exact: true }).click();
  await expect.poll(() => value(page, 'X')).toBe(before.x);
  expect(await value(page, 'Width')).toBe(before.width + 40);

  await page.locator('.designer-stage').click({ position: { x: 8, y: 8 } });
  await expect(page.locator('.transform-box')).toHaveCount(0);
});
