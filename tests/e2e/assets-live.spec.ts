import { expect, test } from '@playwright/test';
import { fillServer, pickSeat } from './liveSeat';

test('imported assets and their references synchronize through authoritative live commands', async ({ browser, storageState }) => {
  const first = await browser.newContext({ storageState }), second = await browser.newContext({ storageState });
  const host = await first.newPage(), guest = await second.newPage();
  try {
    const code = `ASSET-${Date.now()}`;
    for (const [page, hosting] of [[host, true], [guest, false]] as const) {
      await page.goto('/');
      await page.getByRole('button', { name: /Invite players/ }).click();
      await fillServer(page);
      await page.getByLabel('Room code', { exact: true }).fill(code);
      await page.getByRole('button', { name: hosting ? 'Host this table' : 'Join room', exact: true }).click();
      if (hosting) await expect(page.locator('.connection-badge')).toHaveText('Live session', { timeout: 20000 });
    }
    await pickSeat(guest, 'watch');
    await host.getByRole('button', { name: 'Add component', exact: true }).click();
    const chooser = host.waitForEvent('filechooser');
    await host.getByRole('dialog').getByRole('button', { name: /^Textures/ }).click();
    await (await chooser).setFiles({
      name: 'Live texture.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'),
    });
    await expect(guest.getByRole('button', { name: 'Edit Live texture', exact: true })).toBeVisible({ timeout: 20000 });
    await host.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
    await host.getByRole('button', { name: 'Add image', exact: true }).click();
    await host.getByLabel('Imported texture', { exact: true }).selectOption({ label: 'Live texture' });
    await expect(guest.locator('.table-piece .node-image img').first()).toHaveAttribute('src', /^data:image\/png;base64,/, { timeout: 20000 });
    await host.getByRole('button', { name: 'Edit Live texture', exact: true }).click();
    await host.getByRole('button', { name: 'Delete asset', exact: true }).click();
    await host.getByRole('dialog').getByRole('button', { name: 'Delete asset', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Edit Live texture', exact: true })).toHaveCount(0, { timeout: 20000 });
    await expect(guest.locator('.table-piece .node-image img')).toHaveCount(0);
    await expect(guest.locator('.connection-badge')).toHaveText('Live · watching');
  } finally { await first.close(); await second.close(); }
});
