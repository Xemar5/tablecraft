import { expect, test } from '@playwright/test';
import { pickSeat } from './liveSeat';

test('a table can be joined from the home screen as a viewer who then takes and leaves an empty seat', async ({ browser, storageState }) => {
  const first = await browser.newContext({ storageState }), second = await browser.newContext({ storageState });
  const host = await first.newPage(), guest = await second.newPage();
  const server = process.env.TABLECRAFT_TEST_SERVER ?? 'http://127.0.0.1:3000';
  const database = process.env.TABLECRAFT_TEST_DATABASE ?? 'tablecraft-studio';
  try {
    const code = `HOME-${Date.now()}`;
    await host.goto('/');
    await host.getByRole('button', { name: /Invite players/ }).click();
    await host.getByLabel('SpaceTimeDB server', { exact: true }).fill(server);
    await host.getByLabel('Database name', { exact: true }).fill(database);
    await host.getByLabel('Room code', { exact: true }).fill(code);
    await host.getByRole('button', { name: 'Host this table', exact: true }).click();
    await expect(host.locator('.connection-badge')).toHaveText('Live session', { timeout: 20000 });
    const hostedName = await host.locator('.project-heading h1').textContent();

    await guest.goto('/');
    await guest.getByRole('link', { name: 'Tablecraft home' }).click();
    await guest.getByRole('button', { name: 'Join a table', exact: true }).click();
    const dialog = guest.getByRole('dialog');
    await expect(dialog).toContainText('Join a table.');
    await expect(dialog.getByRole('button', { name: 'Host this table' })).toHaveCount(0);
    await dialog.getByLabel('SpaceTimeDB server', { exact: true }).fill(server);
    await dialog.getByLabel('Database name', { exact: true }).fill(database);
    await dialog.getByLabel('Room code', { exact: true }).fill(code.toLowerCase());
    await dialog.getByRole('button', { name: 'Join room', exact: true }).click();
    // Joining never adds a seat: the host keeps their seat and the remaining hotseats are open.
    const picker = guest.getByRole('dialog').filter({ hasText: 'Pick your seat' });
    await expect(picker).toBeVisible({ timeout: 20000 });
    await expect(picker.locator('.seat-option')).toHaveCount(2);
    await expect(picker.locator('.seat-option.taken')).toHaveCount(1);
    await expect(picker.getByRole('button', { name: "Take Player 2's seat", exact: true })).toBeEnabled();
    await pickSeat(guest, 'watch');
    await expect(guest.locator('.project-heading h1')).toHaveText(hostedName!);
    await expect(guest.getByRole('button', { name: /Playground/ })).toHaveClass(/active/);
    await expect(guest.locator('.seat-marker')).toHaveCount(2);
    await expect(guest.locator('.seat-marker.active')).toHaveCount(0);

    // Viewers inspect but cannot move pieces, spawn, or undo.
    const piece = guest.locator('.table-piece').filter({ has: guest.locator('.stack-count') });
    const before = await piece.boundingBox();
    await piece.click();
    await expect(guest.locator('.viewer-note')).toBeVisible();
    await guest.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
    await guest.mouse.down(); await guest.mouse.move(before!.x + 200, before!.y + 100, { steps: 8 }); await guest.mouse.up();
    expect(await piece.boundingBox()).toEqual(before);
    await expect(guest.getByRole('button', { name: 'Undo playground action', exact: true })).toBeDisabled();
    await expect(guest.locator('.hand-tray')).toHaveCount(0);

    await guest.getByRole('button', { name: /^Players/ }).click();
    await guest.locator('[data-player-row="player-2"]').getByText('Empty seat · Click to take it').click();
    await expect(guest.locator('.connection-badge')).toHaveText('Live session', { timeout: 20000 });
    await expect(guest.locator('.seat-marker.active')).toHaveAttribute('data-seat-id', 'player-2');
    await host.getByRole('button', { name: /^Players/ }).click();
    await expect(host.locator('[data-player-row="player-2"]')).toContainText('Taken by another player');
    await guest.getByRole('button', { name: 'Leave seat and watch', exact: true }).click();
    await expect(guest.locator('.connection-badge')).toHaveText('Live · watching', { timeout: 20000 });
    await expect(host.locator('[data-player-row="player-2"]')).toContainText('Empty seat');

    await guest.getByRole('link', { name: 'Tablecraft home' }).click();
    await expect(guest.getByRole('button', { name: `Open project ${hostedName}` }).first()).toBeVisible();
  } finally {
    await first.close(); await second.close();
  }
});
