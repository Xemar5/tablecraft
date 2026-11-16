import { expect, type Page } from '@playwright/test';

/** Joining guests start as viewers with the seat picker open. Take a new seat, an empty seat by name, or keep watching. */
export async function pickSeat(page: Page, choice: 'new' | 'watch' | { seat: string } = 'new') {
  const picker = page.getByRole('dialog').filter({ hasText: 'Pick your seat' });
  await expect(picker).toBeVisible({ timeout: 20000 });
  if (choice === 'new') await picker.getByRole('button', { name: 'Take a new seat', exact: true }).click();
  else if (choice === 'watch') await picker.getByRole('button', { name: 'Watch as viewer', exact: true }).click();
  else await picker.getByRole('button', { name: `Take ${choice.seat}'s seat`, exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.locator('.connection-badge')).toHaveText(choice === 'watch' ? 'Live · watching' : 'Live session', { timeout: 20000 });
}

/** After joining, a returning player whose previous connection is still open keeps their seat; otherwise pick one. */
export async function settleJoin(page: Page, choice: 'new' | { seat: string } = 'new') {
  const picker = page.getByRole('dialog').filter({ hasText: 'Pick your seat' });
  await expect(page.locator('.connection-badge').filter({ hasText: 'Live session' }).or(picker)).toBeVisible({ timeout: 20000 });
  if (await picker.count()) await pickSeat(page, choice);
  await expect(page.locator('.connection-badge')).toHaveText('Live session');
}
/** Point the open session form at the configured test server (defaults to the local SpaceTimeDB). */
export async function fillServer(page: Page) {
  await page.getByLabel('SpaceTimeDB server', { exact: true }).fill(process.env.TABLECRAFT_TEST_SERVER ?? 'http://127.0.0.1:3000');
  await page.getByLabel('Database name', { exact: true }).fill(process.env.TABLECRAFT_TEST_DATABASE ?? 'tablecraft-studio');
}