import { expect, test, type Page } from '@playwright/test';

type Saved = { instances: { id: string; stack: string | null; holder: string | null }[]; stacks?: { id: string; tag: string; filter?: unknown }[] };
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!).projects[0]) as Promise<Saved>;
const grid = (page: Page) => page.locator('.action-grid');

test('a persistent stack stays as an empty slot that takes pieces back', async ({ page }) => {
  await page.goto('/');
  await page.locator('.table-viewport .table-piece').filter({ has: page.locator('.stack-count') }).first().click();
  await grid(page).getByRole('button', { name: 'Make a persistent stack' }).click();
  await expect(page.locator('.stack-count.persistent')).toHaveCount(1);
  await expect.poll(async () => (await saved(page)).stacks?.length).toBe(1);
  // Drawing every piece leaves the stack as an empty slot.
  await grid(page).getByRole('button', { name: /^Draw all/ }).click();
  await expect(page.locator('.hand-card')).toHaveCount(12);
  const slot = page.locator('[data-stack-slot]');
  await expect(slot).toBeVisible();
  await slot.click();
  await expect(page.getByRole('heading', { name: 'Empty persistent stack' })).toBeVisible();
  // Dropping a hand card on the slot puts it back in the stack, which keeps its label with one piece.
  const card = (await page.locator('.hand-card').first().boundingBox())!, target = (await slot.boundingBox())!;
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await expect(slot).toHaveClass(/drop-target/);
  await page.mouse.up();
  await expect(slot).toHaveCount(0);
  const stack = page.locator('.table-viewport .table-piece').filter({ has: page.locator('.stack-count.persistent') });
  await expect(stack.locator('.stack-count.persistent')).toContainText('1');
  const state = await saved(page);
  expect(state.instances.filter(i => i.stack === state.stacks![0].id)).toHaveLength(1);
  // Made ordinary again, a stack of one is just a piece.
  await stack.click();
  await grid(page).getByRole('button', { name: 'Make an ordinary stack' }).click();
  await expect.poll(async () => (await saved(page)).stacks).toBeUndefined();
  await expect(page.locator('.stack-count.persistent')).toHaveCount(0);
});

test('a single piece becomes a persistent stack that keeps its filter, editable in the Selection tab', async ({ page }) => {
  await page.goto('/');
  const id = await page.locator('.table-viewport').getByRole('button', { name: 'Amber token', exact: true }).first().getAttribute('data-piece-id');
  await page.locator(`.table-piece[data-piece-id="${id}"]`).click();
  await grid(page).getByRole('button', { name: 'Make a persistent stack' }).click();
  const filter = page.getByRole('group', { name: 'Stack filter', exact: true });
  await expect(filter.locator('.filter-summary')).toContainText('Takes amber.');
  await filter.getByRole('button', { name: 'Or pieces with…', exact: true }).click();
  await filter.getByRole('textbox', { name: 'Tag pieces must have for rule 2', exact: true }).fill('gold');
  await filter.getByRole('textbox', { name: 'Tag pieces must have for rule 2', exact: true }).press('Enter');
  await expect(filter.locator('.filter-summary')).toContainText('Takes amber or gold.');
  await expect.poll(async () => (await saved(page)).stacks?.[0].filter).toEqual({ anyOf: [{ has: ['amber'], lacks: [] }, { has: ['gold'], lacks: [] }] });
});
