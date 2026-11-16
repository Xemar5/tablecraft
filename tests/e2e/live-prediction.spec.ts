import { expect, test, type Page } from '@playwright/test';
import { fillServer } from './liveSeat';

const LAG_MS = 2500;

/** Delays every server message by LAG_MS once `slow.on` is set, simulating a distant SpaceTimeDB server. */
async function laggy(page: Page) {
  const slow = { on: false };
  await page.routeWebSocket(/\/subscribe/, socket => {
    const server = socket.connectToServer();
    let open = true;
    server.onMessage(message => { if (slow.on) setTimeout(() => { if (open) socket.send(message); }, LAG_MS); else socket.send(message); });
    socket.onClose((code, reason) => { open = false; server.close({ code, reason }); });
    server.onClose((code, reason) => { open = false; socket.close({ code, reason }); });
  });
  return slow;
}

test('live actions respond before the server confirms them', async ({ browser, storageState }) => {
  const first = await browser.newContext({ storageState }), second = await browser.newContext({ storageState });
  const a = await first.newPage(), b = await second.newPage();
  try {
    const code = `LAG-${Date.now()}`;
    const slowA = await laggy(a), slowB = await laggy(b);
    for (const [page, host] of [[a, true], [b, false]] as const) {
      await page.goto('/');
      await page.getByRole('button', { name: /Invite players/ }).click();
      await fillServer(page);
      await page.getByLabel('Room code', { exact: true }).fill(code);
      await page.getByRole('button', { name: host ? 'Host this table' : 'Join room', exact: true }).click();
      if (host) await expect(page.locator('.connection-badge')).toHaveText('Live session', { timeout: 20000 });
    }
    await expect(b.getByRole('dialog').filter({ hasText: 'Pick your seat' })).toBeVisible({ timeout: 20000 });
    slowA.on = true; slowB.on = true;
    const quick = { timeout: LAG_MS / 2 };

    // Taking a seat shows immediately and closes the picker.
    await b.getByRole('dialog').getByRole('button', { name: "Take Player 2's seat", exact: true }).click();
    await expect(b.locator('.seat-marker.active')).toHaveAttribute('data-seat-id', 'player-2', quick);
    await expect(b.getByRole('dialog')).toHaveCount(0, quick);
    await expect(b.locator('.connection-badge')).toHaveText('Live session', quick);

    // Drawing and spawning show immediately for the acting player.
    await a.locator('.table-piece').filter({ has: a.locator('.stack-count') }).dblclick();
    await expect(a.locator('.hand-card')).toHaveCount(1, quick);
    const before = await a.locator('.table-piece').count();
    await a.getByRole('button', { name: 'Spawn Amber token', exact: true }).click();
    await expect(a.locator('.table-piece')).toHaveCount(before + 1, quick);

    // The other player sees the confirmed result once the server replies, and the prediction does not double-apply.
    await expect(b.locator('.table-piece')).toHaveCount(before + 1, { timeout: LAG_MS * 4 });
    await a.waitForTimeout(LAG_MS);
    await expect(a.locator('.hand-card')).toHaveCount(1);
    await expect(a.locator('.table-piece')).toHaveCount(before + 1);
  } finally {
    await first.close(); await second.close();
  }
});
