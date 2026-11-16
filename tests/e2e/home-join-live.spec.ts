import { expect, test } from '@playwright/test';

test('a table can be joined from the home screen', async ({ browser, storageState }) => {
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
    await expect(guest.locator('.connection-badge')).toHaveText('Live session', { timeout: 20000 });
    await expect(guest.locator('.project-heading h1')).toHaveText(hostedName!);
    await expect(guest.getByRole('button', { name: /Playground/ })).toHaveClass(/active/);
    await expect(guest.locator('.seat-marker')).toHaveCount(3);

    await guest.getByRole('link', { name: 'Tablecraft home' }).click();
    await expect(guest.getByRole('button', { name: `Open project ${hostedName}` }).first()).toBeVisible();
  } finally {
    await first.close(); await second.close();
  }
});
