import { expect, test, type Page } from '@playwright/test';
import { wildwoodProject } from '../../src/wildwood';
import { headerItem, toggleHeader } from './headerMenus';

// Wildwood, which has a spirit card hidden from everyone.
const project = wildwoodProject();
const hiddenCard = project.instances.find(item => item.hidden)!;
test.use({ storageState: { cookies: [], origins: [{ origin: 'http://127.0.0.1:5173', localStorage: [
  { name: 'tablecraft.workspace.v1', value: JSON.stringify({ format: 'tablecraft', version: 1, projects: [project] }) },
  { name: 'tablecraft.last-project', value: project.id },
  { name: 'tablecraft.settings.v1', value: JSON.stringify({ name: 'Player 1', color: '#b7cc91', onboarded: true }) },
] }] } });

const openMenu = (page: Page) => page.getByRole('button', { name: 'Actions', exact: true }).click();

test('game master mode shows hidden pieces and is marked on the table; offline it is always available', async ({ page }) => {
  await page.goto('/');
  const card = page.locator(`.table-piece[data-piece-id="${hiddenCard.id}"]`);
  await expect(page.locator('.table-piece').first()).toBeVisible();
  await expect(card).toHaveCount(0);
  // Offline, you're the host of your own table, so the mode is there to switch on.
  await openMenu(page);
  await expect(headerItem(page, 'Game master mode')).not.toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await toggleHeader(page, 'Game master mode');
  await expect(page.locator('.gm-pill')).toContainText('Game master mode');
  await expect(card).toHaveClass(/hidden-from-you/);
  await expect(card.locator('.hidden-count')).toContainText('Hidden from you and Player 2');
  // The old Hidden pieces item is gone from Visibility.
  await openMenu(page);
  await page.getByRole('menuitem', { name: 'Visibility', exact: true }).click();
  await expect(headerItem(page, 'Hidden pieces')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await toggleHeader(page, 'Game master mode');
  await expect(card).toHaveCount(0);
  await expect(page.locator('.gm-pill')).toHaveCount(0);
});
