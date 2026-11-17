import { expect, test } from '@playwright/test';

test('a moved piece stays at its drop position while the live room confirms the move', async ({ browser, storageState }) => {
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  const server = process.env.TABLECRAFT_TEST_SERVER ?? 'http://127.0.0.1:3000';
  const database = process.env.TABLECRAFT_TEST_DATABASE ?? 'tablecraft-studio';
  try {
    await page.goto('/');
    await page.getByRole('button', { name: /Invite players/ }).click();
    await page.getByLabel('SpaceTimeDB server', { exact: true }).fill(server);
    await page.getByLabel('Database name', { exact: true }).fill(database);
    await page.getByLabel('Room code', { exact: true }).fill(`SETTLE-${Date.now()}`);
    await page.getByRole('button', { name: 'Host this table', exact: true }).click();
    await expect(page.locator('.connection-badge')).toHaveText('Live session', { timeout: 20000 });

    const piece = page.locator('.table-piece:not(.locked)').last();
    const id = await piece.getAttribute('data-piece-id');
    const start = await piece.evaluate(element => element.getBoundingClientRect().left);
    const box = (await piece.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 });
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
    const dragged = await piece.evaluate(element => element.getBoundingClientRect().left);
    expect(dragged).toBeGreaterThan(start + 20);
    await page.evaluate(pieceId => {
      const samples: number[] = [];
      (window as unknown as { settleSamples: number[] }).settleSamples = samples;
      const sample = () => {
        const element = document.querySelector<HTMLElement>(`[data-piece-id="${pieceId}"]`);
        if (element) samples.push(element.getBoundingClientRect().left);
        if (samples.length < 90) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, id);
    await page.keyboard.down('Alt');
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await expect.poll(() => page.evaluate(() => (window as unknown as { settleSamples: number[] }).settleSamples.length), { timeout: 10000 }).toBeGreaterThanOrEqual(90);
    const samples = await page.evaluate(() => (window as unknown as { settleSamples: number[] }).settleSamples);
    for (const left of samples) expect(Math.abs(left - dragged)).toBeLessThan(Math.abs(left - start));
    await page.waitForTimeout(3000);
    expect(Math.abs(await piece.evaluate(element => element.getBoundingClientRect().left) - dragged)).toBeLessThan(25);
  } finally {
    await context.close();
  }
});
