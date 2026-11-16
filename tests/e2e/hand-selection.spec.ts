import { expect, test } from '@playwright/test';

test('table-hand cards join table selection, and the hand tray has its own box selection', async ({ page }) => {
  await page.goto('/');
  const deck = page.locator('.table-piece').filter({ has: page.locator('.stack-count') });
  for (let i = 0; i < 3; i++) await deck.dblclick();
  const cards = page.locator('.hand-card');
  await expect(cards).toHaveCount(3);
  const minis = page.locator('.seat-marker.active [data-mini-id]');
  await expect(minis).toHaveCount(3);

  // Ctrl/Cmd-click adds a table-hand card to a table selection.
  const token = page.locator('.table-piece[aria-label="Amber token"]').last();
  await page.getByRole('button', { name: 'Spawn Amber token', exact: true }).click();
  await token.click();
  await minis.first().click({ modifiers: ['Control'] });
  await expect(token).toHaveClass(/selected/);
  // Table-hand cards fan out and overlap, so the click may land on a neighbour.
  await expect(page.locator('.seat-marker.active .hand-selected')).toHaveCount(1);
  await expect(page.locator('.hand-card.hand-selected')).toHaveCount(1);

  // A table box selection that covers your table hand selects its cards.
  await page.keyboard.press('Escape');
  const hand = (await page.locator('.seat-marker.active .other-hand').boundingBox())!;
  const viewport = (await page.locator('.table-viewport').boundingBox())!;
  const start = { x: Math.max(viewport.x + 4, hand.x - 30), y: Math.max(viewport.y + 4, hand.y - 30) };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(hand.x + hand.width / 2, hand.y + hand.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.seat-marker.active .hand-selected')).not.toHaveCount(0);
  await expect(page.locator('.hand-card.hand-selected')).not.toHaveCount(0);

  // Box selection in the hand tray selects only hand cards and replaces the table selection.
  await token.click();
  await expect(token).toHaveClass(/selected/);
  const first = (await cards.first().boundingBox())!, last = (await cards.last().boundingBox())!;
  const y = first.y + first.height / 2;
  await page.mouse.move(last.x + last.width + 40, y);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width / 2, y, { steps: 6 });
  await expect(page.locator('.selection-marquee')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.hand-card.hand-selected')).toHaveCount(3);
  await expect(token).not.toHaveClass(/selected/);
  await expect(page.locator('.selection-marquee')).toHaveCount(0);

  // Shift adds to the hand selection; a plain click on empty tray space clears it.
  await page.mouse.click(last.x + last.width + 40, y);
  await expect(page.locator('.hand-card.hand-selected')).toHaveCount(0);
  await cards.first().click();
  await page.keyboard.down('Shift');
  await page.mouse.move(last.x + last.width + 40, y);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width / 2, y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.locator('.hand-card.hand-selected')).toHaveCount(2);
});
