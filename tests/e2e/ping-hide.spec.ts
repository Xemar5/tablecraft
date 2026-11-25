import { expect, test } from '@playwright/test';
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

  // Hide the token from your own seat: it leaves the table until hidden pieces are shown.
  await piece.click();
  const seats = page.getByRole('group', { name: 'Hidden from', exact: true });
  await seats.getByRole('button', { name: /Player 1/ }).click();
  await expect(piece).toHaveCount(0);
  await toggleHeader(page, 'Hidden pieces');
  await expect(piece).toHaveClass(/hidden-from-you/);
  await expect(piece.locator('.hidden-count')).toContainText('Hidden from you');
  // The Selection tab shows the seats it's hidden from, and shows it to everyone again.
  await piece.click();
  await expect(seats.getByRole('button', { name: /Player 1/ })).toHaveAttribute('aria-pressed', 'true');
  await seats.getByRole('button', { name: /Player 1/ }).click();
  await expect(piece.locator('.hidden-count')).toHaveCount(0);
  await expect.poll(async () => (await savedWorkspace(page)).projects[0].instances.find(i => i.id === id)?.hiddenFrom).toBeUndefined();
});
