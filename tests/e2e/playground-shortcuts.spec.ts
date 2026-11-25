import { expect, test } from '@playwright/test';
import type { Archive } from '../../src/domain';

test('Q and E rotate in opposite directions, R shuffles and rolls, and preview hints stack vertically', async ({ page }) => {
  await page.goto('/');
  const project = async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!)) as Archive).projects[0];
  const initial = await project();
  const card = initial.instances.find(i => !i.stack && initial.components.find(c => c.id === i.componentId)?.kind === 'card')!;
  const piece = page.locator(`[data-piece-id="${card.id}"]`);
  await piece.hover();
  await page.keyboard.press('q');
  await expect.poll(async () => (await project()).instances.find(i => i.id === card.id)?.rotation).toBe(card.rotation - 90);
  await page.keyboard.press('e');
  await expect.poll(async () => (await project()).instances.find(i => i.id === card.id)?.rotation).toBe(card.rotation);
  const shortcuts = page.getByLabel('Piece shortcuts', { exact: true });
  const hints = shortcuts.getByRole('row');
  await expect(hints).toHaveCount(9);
  expect(await hints.nth(1).evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(await hints.first().evaluate(el => el.getBoundingClientRect().bottom));
  expect(await shortcuts.evaluate(el => getComputedStyle(el).color)).not.toBe(await shortcuts.evaluate(el => getComputedStyle(el.parentElement!).color));
  const die = initial.instances.find(i => initial.components.find(c => c.id === i.componentId)?.kind === 'dice')!;
  // Leave the card first: its preview covers the die's corner of the table.
  await page.mouse.move(0, 0);
  await expect(page.locator('.hover-preview')).toHaveCount(0);
  await page.locator(`[data-piece-id="${die.id}"]`).hover();
  await page.evaluate(() => { crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => { if (array instanceof Uint32Array) array.fill(0); return array; }; });
  await page.keyboard.press('s');
  expect((await project()).instances.find(i => i.id === die.id)?.row).toBe(die.row);
  await page.keyboard.press('r');
  await expect.poll(async () => (await project()).instances.find(i => i.id === die.id)?.row).toBe(1);
  expect((await project()).instances.find(i => i.id === die.id)?.rotation).toBe(die.rotation);
  const deck = initial.instances.filter(i => i.stack).sort((a, b) => a.order - b.order);
  await page.locator('.table-piece').filter({ has: page.locator('.stack-count') }).hover();
  await page.keyboard.press('r');
  await expect.poll(async () => (await project()).instances.filter(i => i.stack === deck[0].stack).sort((a, b) => a.order - b.order).map(i => i.id)).not.toEqual(deck.map(i => i.id));
});
