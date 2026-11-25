import { expect, test } from '@playwright/test';
import { pickSeat } from './liveSeat';
import { chooseHeader } from './headerMenus';

test('live table hands enforce per-hand permissions, indexed transfers and undo', async ({ browser, storageState }) => {
  const first = await browser.newContext({ storageState }), second = await browser.newContext({ storageState });
  const a = await first.newPage(), b = await second.newPage();
  try {
    const code = `HANDS-${Date.now()}`;
    for (const [page, host] of [[a, true], [b, false]] as const) {
      await page.goto('/');
      await page.getByRole('button', { name: /Invite players/ }).click();
      await page.getByLabel('SpaceTimeDB server', { exact: true }).fill(process.env.TABLECRAFT_TEST_SERVER ?? 'http://127.0.0.1:3000');
      await page.getByLabel('Database name', { exact: true }).fill(process.env.TABLECRAFT_TEST_DATABASE ?? 'tablecraft-studio');
      await page.getByLabel('Room code', { exact: true }).fill(code);
      await page.getByRole('button', { name: host ? 'Host this table' : 'Join room', exact: true }).click();
      if (host) await expect(page.locator('.connection-badge')).toHaveText('Live session', { timeout: 20000 });
      else await pickSeat(page, { seat: 'Player 2' });
    }
    const otherId = await b.locator('.seat-marker.active').getAttribute('data-seat-id');
    const otherSeat = a.locator(`[data-seat-id="${otherId}"]`);
    const deck = a.locator('.table-piece').filter({ has: a.locator('.stack-count') });
    await deck.hover(); await a.keyboard.press('3');
    await expect(a.locator('.hand-card')).toHaveCount(3);
    const original = await a.locator('.hand-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-hand-id')));
    const trayCard = (await a.locator('.hand-card').last().boundingBox())!;
    const seat = (await otherSeat.boundingBox())!;
    await a.mouse.move(trayCard.x + trayCard.width / 2, trayCard.y + trayCard.height / 2);
    await a.mouse.down();
    await a.mouse.move(seat.x + seat.width / 2, seat.y + seat.height / 2, { steps: 10 });
    await a.mouse.up();
    await expect(b.locator('.hand-card')).toHaveCount(1);
    await expect(a.locator('.hand-card')).toHaveCount(2);
    const otherCard = otherSeat.locator('[data-mini-id]');
    await expect(otherCard).toHaveAttribute('data-grabbable', 'false');
    await b.getByRole('button', { name: 'Allow others to take from my hand', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Allow others to take from my hand', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(b.getByRole('button', { name: 'Allow others to take from my hand', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(otherCard).toHaveAttribute('data-grabbable', 'true');
    const cards = a.locator('.seat-marker.active [data-mini-id]');
    const centers = await cards.evaluateAll(elements => elements.map(el => {
      const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }));
    const source = (await otherCard.boundingBox())!;
    await a.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await a.mouse.down();
    await a.mouse.move((centers[0].x + centers[1].x) / 2, (centers[0].y + centers[1].y) / 2, { steps: 10 });
    await expect(a.locator('.mini-insert-before')).toHaveCount(1);
    await a.mouse.up();
    await expect(b.locator('.hand-card')).toHaveCount(0);
    await expect.poll(() => a.locator('.hand-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-hand-id')))).toEqual([original[0], original[2], original[1]]);
    await chooseHeader(a, 'Undo');
    await expect(b.locator('.hand-card')).toHaveCount(1);
    await expect(a.locator('.hand-card')).toHaveCount(2);
    await b.getByRole('button', { name: 'Allow others to insert into my hand', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Allow others to insert into my hand', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(b.getByRole('button', { name: 'Allow others to insert into my hand', exact: true })).toHaveAttribute('aria-pressed', 'false');
  } finally { await first.close(); await second.close(); }
});
