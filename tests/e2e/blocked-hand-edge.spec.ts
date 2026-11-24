import { expect, test } from '@playwright/test';

// The blocked look must not resize the hand: the seat would shift and the pointer leave and re-enter it on every move.
test('dragging a piece across the edge of a hand it can’t go into switches the blocked state once, without flickering', async ({ page }) => {
  await page.goto('/');
  const box = async (s: string) => (await page.locator(s).first().boundingBox())!;
  const die = await box('.table-viewport [aria-label="Spirit die"]'), seat = await box('.seat-marker.active');
  await page.mouse.move(die.x + die.width / 2, die.y + die.height / 2); await page.mouse.down();
  const x = seat.x + seat.width / 2;
  await page.mouse.move(x, seat.y + seat.height / 2, { steps: 8 });
  // Sweep up across the top edge of the seat's drop area one pixel at a time.
  const states: string[] = [];
  for (let y = seat.y + 20; y > seat.y - 60; y -= 1) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(10);
    states.push(await page.locator('.hand-drop-blocked').count() ? 'B' : '.');
  }
  await page.mouse.up();
  const flips = states.filter((state, index) => index && state !== states[index - 1]).length;
  expect(flips, states.join('')).toBeLessThanOrEqual(1);
  expect(states[0]).toBe('B');
});
