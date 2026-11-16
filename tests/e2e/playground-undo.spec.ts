import { expect, test, type Page } from '@playwright/test';
import type { Project } from '../../src/domain';
import { settleJoin } from './liveSeat';

async function state(page: Page): Promise<Project> {
  // Joining appends the remote project alongside this browser's original local workspace.
  return page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!).projects.at(-1));
}
const undoButton = (page: Page) => page.getByRole('button', { name: 'Undo playground action', exact: true });

const server = process.env.TABLECRAFT_TEST_SERVER ?? 'http://127.0.0.1:3000';
const database = process.env.TABLECRAFT_TEST_DATABASE ?? 'tablecraft-studio';

async function connect(page: Page, code: string, host: boolean, name: string, seat: 'new' | { seat: string } = 'new') {
  await page.goto('/');
  if (await page.getByRole('region', { name: 'Project home' }).count()) await page.getByRole('button', { name: 'Open project Wildwood', exact: true }).click();
  await page.getByRole('button', { name: /Invite players/ }).click();
  await page.getByLabel('Your name', { exact: true }).fill(name);
  await page.getByLabel('SpaceTimeDB server', { exact: true }).fill(server);
  await page.getByLabel('Database name', { exact: true }).fill(database);
  await page.getByLabel('Room code', { exact: true }).fill(code);
  await page.getByRole('button', { name: host ? 'Host this table' : 'Join room', exact: true }).click();
  await settleJoin(page, seat);

}

test('offline toolbar and Ctrl/Cmd+Z undo while typing, dialogs and Designer keep their own shortcuts', async ({ page }) => {
  await page.goto('/');
  const before = await state(page);
  await expect(undoButton(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Spawn Amber token', exact: true }).click();
  await expect.poll(async () => (await state(page)).instances.length).toBe(before.instances.length + 1);
  await undoButton(page).click();
  await expect.poll(async () => (await state(page)).instances).toEqual(before.instances);
  await expect(undoButton(page)).toBeDisabled();

  await page.getByRole('button', { name: 'Spawn Amber token', exact: true }).click();
  await page.getByLabel('Search components', { exact: true }).fill('Amber');
  await page.keyboard.press('Control+z');
  expect((await state(page)).instances).toHaveLength(before.instances.length + 1);
  await page.getByLabel('Search components', { exact: true }).fill('');
  // A modal and its input must not route undo to the table.
  await page.getByRole('button', { name: 'Save playground', exact: true }).click();
  await page.getByLabel('Snapshot name').fill('Typing stays local');
  await page.keyboard.press('Control+z');
  expect((await state(page)).instances).toHaveLength(before.instances.length + 1);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Component designer', exact: true }).click();
  await page.keyboard.press('Control+z');
  expect((await state(page)).instances).toHaveLength(before.instances.length + 1);
  await page.getByRole('button', { name: 'Playground', exact: true }).click();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state(page)).instances).toEqual(before.instances);

  await page.getByRole('button', { name: 'Spawn Amber token', exact: true }).click();
  await page.keyboard.press('Meta+z');
  await expect.poll(async () => (await state(page)).instances).toEqual(before.instances);
  await page.locator('.table-piece').filter({ has: page.locator('.stack-count') }).dblclick();
  await expect(page.locator('.hand-card')).toHaveCount(1);
  await undoButton(page).click();
  await expect(page.locator('.hand-card')).toHaveCount(0);
  await page.reload();
  await expect(undoButton(page)).toBeDisabled();
});

test('live undo is global, serialized, preserves joins, and rejects spoofed actors', async ({ browser, storageState }) => {
  const contexts = await Promise.all([browser.newContext({ storageState }), browser.newContext({ storageState }), browser.newContext({ storageState })]);
  const [a, b, c] = await Promise.all(contexts.map(context => context.newPage()));
  try {
    const code = `UNDO-${Date.now()}`;
    await connect(a, code, true, 'Alice');
    await connect(b, code, false, 'Bob');
    // The seat picker closes optimistically; wait until the server has confirmed Bob's seat.
    await expect.poll(async () => (await state(a)).players.some(player => player.name === 'Bob')).toBe(true);
    await expect.poll(async () => (await state(a)).players.length).toBe((await state(b)).players.length);
    const before = await state(a);
    await a.getByRole('button', { name: 'Spawn Amber token', exact: true }).click();
    await expect(undoButton(b)).toBeEnabled();
    await b.reload();
    await connect(b, code, false, 'Bob', { seat: 'Bob' });
    await expect(undoButton(b)).toBeEnabled();
    await expect.poll(async () => (await state(b)).players).toEqual(before.players);
    // A joining player must neither clear undo nor disappear when it is used.
    await connect(c, code, false, 'Carol');
    await expect(a.locator('.seat-marker')).toHaveCount(before.players.length + 1);
    const joined = await state(a);
    await undoButton(b).click();
    for (const page of [a, b, c]) {
      await expect.poll(async () => (await state(page)).instances).toEqual(before.instances);
      expect((await state(page)).players).toEqual(joined.players);
      await expect(undoButton(page)).toBeDisabled();
    }

    await b.locator('.table-piece').filter({ has: b.locator('.stack-count') }).dblclick();
    await expect(b.locator('.hand-card')).toHaveCount(1);
    await expect(undoButton(a)).toBeEnabled();
    await undoButton(a).click();
    await expect(b.locator('.hand-card')).toHaveCount(0);
    await expect.poll(async () => (await state(a)).instances).toEqual((await state(b)).instances);

    await Promise.all([a, b].map(page => page.getByRole('button', { name: 'Spawn Amber token', exact: true }).click()));
    await expect.poll(async () => (await state(c)).instances.length).toBe(before.instances.length + 2);
    await undoButton(c).click();
    await expect.poll(async () => (await state(a)).instances.length).toBe(before.instances.length + 1);
    await undoButton(c).click();
    await expect.poll(async () => (await state(b)).instances.length).toBe(before.instances.length);
    expect((await state(c)).players).toEqual(joined.players);

    await Promise.all([a, b].map(page => page.getByRole('button', { name: 'Spawn Amber token', exact: true }).click()));
    await expect.poll(async () => (await state(c)).instances.length).toBe(before.instances.length + 2);
    await Promise.all([a, b].map(page => undoButton(page).click()));
    await expect.poll(async () => (await state(c)).instances.length).toBe(before.instances.length);

    await a.getByRole('button', { name: 'Spawn Amber token', exact: true }).click();
    await expect(undoButton(b)).toBeEnabled();
    const rejection = await b.evaluate(async ({ code, project, server, database }) => {
      // Use Bob's stored authenticated token, but claim Alice's actor ID.
      const modulePath = '/src/multiplayer.ts';
      const { connectRoom } = await import(/* @vite-ignore */ modulePath);
      const live = await connectRoom({
        uri: server, database, code, host: false,
        project, playerId: 'unused-actor', name: 'Bob', color: '#ffffff',
      }, () => {}, () => {}, () => {});
      try {
        await live.undo(project.players[0].id);
        return 'unexpected success';
      } catch (error) {
        return String(error);
      } finally { live.disconnect(); }
    }, { code, project: await state(b), server, database });
    expect(rejection).toContain('Undo as your own seat');
    await expect.poll(async () => (await state(a)).instances.length).toBe(before.instances.length + 1);
    await undoButton(b).click();
    await expect.poll(async () => (await state(a)).instances.length).toBe(before.instances.length);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
