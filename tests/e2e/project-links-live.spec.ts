import { expect, test } from '@playwright/test';
import { starterProject } from '../../src/templates';
import { fillServer, pickSeat } from './liveSeat';

test('live project links share readonly snapshots without requiring the source workspace', async ({ browser, storageState }) => {
  const first = await browser.newContext({ storageState }), second = await browser.newContext({ storageState });
  const a = await first.newPage(), b = await second.newPage();
  try {
    const source = { ...starterProject(), id: 'source', name: 'Source artwork' };
    const target = { ...starterProject(), id: 'destination', name: 'Linked game', components: [], instances: [] };
    await a.goto('/');
    await a.evaluate(projects => {
      localStorage.setItem('tablecraft.workspace.v1', JSON.stringify({ format: 'tablecraft', version: 1, projects }));
      localStorage.setItem('tablecraft.last-project', 'destination');
    }, [source, target]);
    await a.reload();
    const code = `LINKS-${Date.now()}`;
    for (const [page, host] of [[a, true], [b, false]] as const) {
      if (!host) await page.goto('/');
      await page.getByRole('button', { name: /Invite players/ }).click();
      await fillServer(page);
      await page.getByLabel('Room code', { exact: true }).fill(code);
      await page.getByRole('button', { name: host ? 'Host this table' : 'Join room', exact: true }).click();
      if (host) await expect(page.locator('.connection-badge')).toHaveText('Live session', { timeout: 20000 });
      else await pickSeat(page);
    }
    await a.getByRole('button', { name: 'Link from another project', exact: true }).click();
    await a.getByRole('button', { name: 'Link Spirit cards from Source artwork', exact: true }).click();
    await b.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
    await expect(b.locator('.linked-component-view')).toContainText('Read-only link from Source artwork');
    await expect(b.locator('.linked-component-view')).toContainText('Source unavailable locally');
    await expect(b.getByRole('button', { name: 'Add text', exact: true })).toHaveCount(0);
    await b.getByRole('button', { name: 'Playground', exact: true }).click();
    await b.getByRole('button', { name: 'Spawn Spirit cards', exact: true }).click();
    await a.getByRole('button', { name: 'Playground', exact: true }).click();
    await expect(a.locator('.table-piece')).toHaveCount(1);
    await a.getByRole('button', { name: 'Undo playground action', exact: true }).click();
    await expect(b.locator('.table-piece')).toHaveCount(0);
    await b.getByRole('button', { name: 'Make local copy of Spirit cards', exact: true }).click();
    await expect(b.getByRole('button', { name: 'Add text', exact: true })).toBeVisible();
    await expect(a.getByRole('button', { name: 'Spawn Spirit cards (copy)', exact: true })).toBeVisible();
  } finally { await first.close(); await second.close(); }
});
