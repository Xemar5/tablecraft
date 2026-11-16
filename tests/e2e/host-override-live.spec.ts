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

    const seatIds = () => guest.locator('.seat-marker').evaluateAll(markers => markers.map(marker => marker.getAttribute('data-seat-id')!));
    const existing = await seatIds();
    await guest.getByRole('button', { name: /^Players/ }).click();
    await guest.getByRole('button', { name: 'Add hotseat player', exact: true }).click();
    await guest.getByRole('dialog').getByRole('button', { name: 'Save seat', exact: true }).click();
    await expect.poll(async () => (await seatIds()).length).toBe(existing.length + 1);
    const hotseatId = (await seatIds()).find(id => !existing.includes(id))!;
    const hotseat = guest.locator(`[data-seat-id="${hotseatId}"]`);
    const hotseatName = (await hotseat.locator('.seat-badge strong').textContent())!;
    await hotseat.click();
    await expect(guest.locator('.seat-inspector .host-override-note')).toContainText('Hotseat override');
    const hotseatTake = guest.getByRole('toolbar', { name: `${hotseatName}'s hand actions`, exact: true }).getByRole('button', { name: `Allow others to take from ${hotseatName}'s hand`, exact: true });
    await expect(hotseatTake).toHaveClass(/host-override/);
    await hotseatTake.click();
    await expect(hotseatTake).toHaveAttribute('aria-pressed', 'true');
    await expect(guest.getByRole('button', { name: 'Allow others to take from my hand', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await guest.keyboard.press('Escape');

    await guest.locator(`[data-seat-id="${hostId}"]`).click();
    await expect(guest.locator('.seat-inspector .host-override-note')).toHaveCount(0);
    await expect(guest.getByLabel('Player name', { exact: true })).toBeDisabled();
    await expect(guest.locator('.seat-inspector').getByRole('button', { name: 'Remove seat', exact: true })).toHaveCount(0);

    await inspector.getByRole('button', { name: 'Remove seat', exact: true }).click();
    const confirm = host.getByRole('dialog');
    await expect(confirm).toContainText('Host override');
    await confirm.getByRole('button', { name: 'Remove seat', exact: true }).click();
    await expect(guest.locator(`[data-seat-id="${guestId}"]`)).toHaveCount(0);
    await expect(guest.locator('.seat-marker.active')).toHaveAttribute('data-seat-id', hotseatId);
  } finally {
    await first.close(); await second.close();
  }
});
