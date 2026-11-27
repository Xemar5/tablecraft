import { expect, test } from '@playwright/test';
import { openBlock } from './blocks';
import { savedWorkspace } from './savedWorkspace';
import { toggleHeader } from './headerMenus';

test('P pings the hovered piece, and pieces hidden from a seat come back labelled with Visibility → Hidden pieces', async ({ page }) => {
  await page.goto('/');
  const token = page.locator('.table-viewport').getByRole('button', { name: 'Amber token', exact: true }).first();
  const id = (await token.getAttribute('data-piece-id'))!;
  const piece = page.locator(`.table-piece[data-piece-id="${id}"]`);
  await piece.hover();
  await page.keyboard.press('p');
  await expect(piece.locator('.ping-pulse')).toBeVisible();
  await expect.poll(async () => (await savedWorkspace(page)).projects[0].instances.find(i => i.id === id)?.pings).toBe(1);
  await expect(piece.locator('.ping-pulse')).toHaveCount(0, { timeout: 4000 });
  // A pin with the pinging player marks it, at a fixed size; off screen it waits at the edge and points the way.
  const pin = page.locator('.ping-pin');
  await expect(pin).toHaveCount(0, { timeout: 4000 });
  await piece.hover();
  await page.keyboard.press('p');
  await expect(pin).toContainText('Player 1');
  await expect(pin).not.toHaveClass(/pointing-away/);
  await page.keyboard.press('Escape');
  await piece.click();
  const view = (await page.locator('.table-viewport').boundingBox())!;
  for (let n = 0; n < 25; n++) await page.mouse.move(view.x + view.width - 30, view.y + view.height - 30), await page.mouse.wheel(0, -120);
  await expect(piece).not.toBeInViewport();
  await page.locator('.action-grid').getByRole('button', { name: /^Ping/ }).click();
  await expect(pin).toHaveClass(/pointing-away/);
  await expect(pin).toBeInViewport();
  await pin.locator('.ping-pin-body').click();
  await expect(piece).toBeInViewport();
  await page.keyboard.press('Escape');

  // Hide the token from your own seat: it stays, faded, while it's selected, and leaves the table once it isn't, until
  // hidden pieces are shown.
  await piece.click();
  await openBlock(page, 'Hidden from');
  const seats = page.getByRole('group', { name: 'Hidden from', exact: true });
  await seats.getByRole('button', { name: /Player 1/ }).click();
  await expect(piece).toHaveClass(/hidden-from-you/);
  await page.mouse.click(view.x + 60, view.y + view.height - 40);
  await expect(piece).toHaveCount(0);
  // Game master mode shows hidden pieces.
  await toggleHeader(page, 'Game master mode');
  await expect(piece).toHaveClass(/hidden-from-you/);
  await expect(piece.locator('.hidden-count')).toContainText('Hidden from you');
  // The Selection tab shows the seats it's hidden from, and shows it to everyone again.
  await piece.click();
  await expect(seats.getByRole('button', { name: /Player 1/ })).toHaveAttribute('aria-pressed', 'true');
  await seats.getByRole('button', { name: /Player 1/ }).click();
  await expect(piece.locator('.hidden-count')).toHaveCount(0);
  await expect.poll(async () => (await savedWorkspace(page)).projects[0].instances.find(i => i.id === id)?.hidePlayers).toBeUndefined();
});
