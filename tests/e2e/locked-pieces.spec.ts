import { expect, test } from '@playwright/test';
import type { Archive } from '../../src/domain';

test('locked pieces let box selections start over them and are only selectable with Ctrl-click', async ({ page }) => {
  await page.goto('/');
  const project = async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!)) as Archive).projects[0];
  const tokenId = (await page.locator('.table-piece').filter({ has: page.locator('.component-token') }).first().getAttribute('data-piece-id'))!;
  const token = page.locator(`[data-piece-id="${tokenId}"]`);
  await token.click();
  await page.locator('.action-grid').getByRole('button', { name: /^Lock/ }).click();
  await expect(token).toHaveClass(/locked/);
  const before = (await project()).instances.find(i => i.id === tokenId)!;

  await page.locator('.table-viewport').click({ position: { x: 5, y: 5 } });
  await token.click();
  await expect(token).not.toHaveClass(/selected/);

  const box = (await token.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const others = await page.locator('.table-piece:not(.locked)').evaluateAll(elements => elements.map(element => {
    const r = element.getBoundingClientRect();
    return { id: element.getAttribute('data-piece-id')!, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }));
  const target = others.sort((a, b) => Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y))[0];
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + target.x) / 2, (start.y + target.y) / 2, { steps: 4 });
  await expect(page.locator('.selection-marquee')).toBeVisible();
  await page.mouse.move(target.x, target.y, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator(`[data-piece-id="${target.id}"]`)).toHaveClass(/selected/);
  await expect(token).not.toHaveClass(/selected/);
  const after = (await project()).instances.find(i => i.id === tokenId)!;
  expect([after.x, after.y]).toEqual([before.x, before.y]);

  await page.locator('.table-viewport').click({ position: { x: 5, y: 5 } });
  await token.click({ modifiers: ['Control'] });
  await expect(token).toHaveClass(/selected/);

  await page.locator('.table-viewport').click({ position: { x: 5, y: 5 } });
  await token.hover();
  await page.keyboard.press('l');
  await expect(token).not.toHaveClass(/locked/);
  await token.click();
  await expect(token).toHaveClass(/selected/);
});
