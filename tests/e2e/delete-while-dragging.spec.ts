import { expect, test, type Page } from '@playwright/test';

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!).projects[0]);
const piece = async (page: Page, id: string | null) => (await saved(page)).instances.find((item: { id: string }) => item.id === id);

test('a piece deleted while it is dragged comes back where it was last placed on undo, not under the pointer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const token = page.locator('[data-testid="table-piece"][aria-label="Amber token"]').first();
  const id = await token.getAttribute('data-piece-id');
  const start = await piece(page, id);
  const box = (await token.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 60, { steps: 6 });
  await page.keyboard.press('Delete');
  await expect.poll(() => piece(page, id)).toBeUndefined();
  // Undone while the mouse is still down, it's back in its old place, and letting go elsewhere doesn't move it.
  await page.keyboard.press('Control+z');
  await expect.poll(() => piece(page, id)).toBeDefined();
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 - 100, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await piece(page, id)).toMatchObject({ x: start.x, y: start.y, holder: null });
  expect(errors).toEqual([]);

  // A card dragged out of the hand and deleted goes back to the hand on undo, with no drag left showing.
  await page.locator('[data-testid="table-piece"][aria-label^="Spirit cards"]').first().hover();
  await page.keyboard.press('2');
  const cards = page.locator('.hand-tray [data-hand-id]');
  await expect(cards).toHaveCount(2);
  const card = await cards.first().getAttribute('data-hand-id');
  const at = (await cards.first().boundingBox())!;
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width / 2, at.y - 250, { steps: 8 });
  await expect(page.locator('.hand-drag-preview')).toHaveCount(1);
  await page.keyboard.press('Delete');
  await expect(page.locator('.hand-drag-preview')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await piece(page, card))?.holder).toBe('player-1');
  await page.mouse.move(at.x + at.width / 2 + 100, at.y - 300, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect((await piece(page, card)).holder).toBe('player-1');
  await expect(page.locator('.hand-drag-preview')).toHaveCount(0);
  expect(errors).toEqual([]);
});
