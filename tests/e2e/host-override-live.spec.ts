import { expect, test } from '@playwright/test';

test('the room host can change other seats with host-override marking while guests cannot', async ({ browser, storageState }) => {
  const first = await browser.newContext({ storageState }), second = await browser.newContext({ storageState });
  const host = await first.newPage(), guest = await second.newPage();
  try {
    const code = `HOST-${Date.now()}`;
    for (const [page, hosting] of [[host, true], [guest, false]] as const) {
      await page.goto('/');
      await page.getByRole('button', { name: /Invite players/ }).click();
      await page.getByLabel('SpaceTimeDB server', { exact: true }).fill(process.env.TABLECRAFT_TEST_SERVER ?? 'http://127.0.0.1:3000');
      await page.getByLabel('Database name', { exact: true }).fill(process.env.TABLECRAFT_TEST_DATABASE ?? 'tablecraft-studio');
      await page.getByLabel('Room code', { exact: true }).fill(code);
      await page.getByRole('button', { name: hosting ? 'Host this table' : 'Join room', exact: true }).click();
      await expect(page.locator('.connection-badge')).toHaveText('Live session', { timeout: 20000 });
    }
    const hostId = (await host.locator('.seat-marker.active').getAttribute('data-seat-id'))!;
    const guestId = (await guest.locator('.seat-marker.active').getAttribute('data-seat-id'))!;
    await expect(host.locator(`[data-seat-id="${guestId}"]`)).toBeVisible();
    const guestName = (await host.locator(`[data-seat-id="${guestId}"] .seat-badge strong`).textContent())!;

    await host.locator(`[data-seat-id="${guestId}"]`).click();
    const inspector = host.locator('.seat-inspector');
    await expect(inspector.locator('.host-override-note')).toBeVisible();
    await expect(inspector.locator('fieldset.seat-fields.host-override')).toBeVisible();
    await expect(host.getByLabel('Player name', { exact: true })).toBeEnabled();
    await expect(inspector.getByRole('button', { name: 'Remove seat', exact: true })).toHaveClass(/host-override/);
    const take = host.getByRole('toolbar', { name: `${guestName}'s hand actions`, exact: true }).getByRole('button', { name: `Allow others to take from ${guestName}'s hand`, exact: true });
    await expect(take).toBeEnabled();
    await expect(take).toHaveClass(/host-override/);
    await take.click();
    await expect(guest.getByRole('button', { name: 'Allow others to take from my hand', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await host.getByLabel('Player name', { exact: true }).fill('Renamed by host');
    await host.getByLabel('Player name', { exact: true }).press('Enter');
    await expect(guest.locator(`[data-seat-id="${guestId}"] .seat-badge strong`)).toHaveText('Renamed by host');

    await guest.locator(`[data-seat-id="${hostId}"]`).click();
    await expect(guest.locator('.seat-inspector .host-override-note')).toHaveCount(0);
    await expect(guest.getByLabel('Player name', { exact: true })).toBeDisabled();
    await expect(guest.locator('.seat-inspector').getByRole('button', { name: 'Remove seat', exact: true })).toHaveCount(0);

    await inspector.getByRole('button', { name: 'Remove seat', exact: true }).click();
    const confirm = host.getByRole('dialog');
    await expect(confirm).toContainText('Host override');
    await confirm.getByRole('button', { name: 'Remove seat', exact: true }).click();
    await expect(guest.locator(`[data-seat-id="${guestId}"]`)).toHaveCount(0);
    await expect(guest.getByText('The host removed your seat.', { exact: false })).toBeVisible();
  } finally {
    await first.close(); await second.close();
  }
});
