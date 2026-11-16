import { expect, test, type Page } from '@playwright/test';
import type { Project } from '../../src/domain';

async function state(page: Page): Promise<Project> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!).projects[0]);
}

test('preview drag uses the rotated and zoomed table coordinates, while click and undo still work', async ({ page }) => {
  await page.goto('/');
  const before = await state(page);
  const preview = page.getByRole('button', { name: 'Spawn Amber token', exact: true });
  await expect(page.getByLabel('Spawn quantity')).toHaveCount(0);
  await page.getByRole('button', { name: 'Rotate camera right' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const viewport = page.locator('.table-viewport');
  const box = (await viewport.boundingBox())!;
  const x = box.width * .55, y = box.height * .45;
  const expected = await viewport.evaluate((el, point) => {
    const world = el.querySelector('.table-world')!;
    const matrix = new DOMMatrix(getComputedStyle(world).transform).inverse();
    const pos = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { x: pos.x, y: pos.y };
  }, { x, y });
  await preview.dragTo(viewport, { targetPosition: { x, y } });
  await expect.poll(async () => (await state(page)).instances.length).toBe(before.instances.length + 1);
  const spawned = (await state(page)).instances.at(-1)!;
  expect(spawned.componentId).toBe(before.components.find(c => c.name === 'Amber token')!.id);
  expect(spawned.row).toBe(0);
  // Playwright's native mouse events round screen positions to whole pixels.
  expect(Math.abs(spawned.x - expected.x)).toBeLessThan(3);
  expect(Math.abs(spawned.y - expected.y)).toBeLessThan(3);
  await page.getByRole('button', { name: 'Undo playground action' }).click();
  await expect.poll(async () => (await state(page)).instances).toEqual(before.instances);
  await preview.click();
  await expect.poll(async () => (await state(page)).instances.length).toBe(before.instances.length + 1);
});

test('variant selection, ranges, and drag spawn an atomic set without reordering the library', async ({ page }) => {
  await page.goto('/');
  const before = await state(page);
  const card = page.locator('.library-item').filter({ has: page.getByRole('button', { name: 'Spawn Spirit cards', exact: true }) });
  await card.getByRole('button', { name: 'Show Spirit cards variants (6)', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Hide Spirit cards variants (6)', exact: true })).toHaveAttribute('aria-expanded', 'true');
  const variants = card.getByRole('group', { name: 'Spirit cards variants' }).getByRole('button');
  await expect(card.locator('.library-item-name small')).toHaveText(/^\d+ × \d+ px$/);
  await expect(variants.first().locator('span')).toHaveText(/^1\. \S/);
  const rowBounds = (await variants.first().boundingBox())!;
  const thumbBounds = (await variants.first().locator('.component-thumbnail').boundingBox())!;
  expect(thumbBounds.x - rowBounds.x).toBeLessThan(8);
  await variants.nth(1).click();
  await variants.nth(3).click({ modifiers: ['Control'] });
  await variants.nth(5).click({ modifiers: ['Shift'] });
  await expect(variants.nth(1)).toHaveAttribute('aria-pressed', 'false');
  for (const index of [3, 4, 5]) await expect(variants.nth(index)).toHaveAttribute('aria-pressed', 'true');
  await variants.nth(1).click({ modifiers: ['Control', 'Shift'] });
  for (const index of [1, 2, 3, 4, 5]) await expect(variants.nth(index)).toHaveAttribute('aria-pressed', 'true');
  await variants.nth(2).click({ modifiers: ['Control'] });
  await expect(variants.nth(2)).toHaveAttribute('aria-pressed', 'false');
  const viewport = page.locator('.table-viewport');
  await variants.nth(3).dragTo(viewport);
  await expect.poll(async () => (await state(page)).instances.length).toBe(before.instances.length + 4);
  const after = await state(page);
  expect(after.instances.slice(-4).map(i => i.row)).toEqual([1, 3, 4, 5]);
  expect(after.instances.slice(-4).every(i => i.componentId === before.components.find(c => c.name === 'Spirit cards')!.id)).toBe(true);
  expect(after.components.map(c => c.id)).toEqual(before.components.map(c => c.id));
  await page.getByRole('button', { name: 'Undo playground action' }).click();
  await expect.poll(async () => (await state(page)).instances).toEqual(before.instances);
  await variants.nth(0).dragTo(viewport);
  await expect.poll(async () => (await state(page)).instances.length).toBe(before.instances.length + 1);
  expect((await state(page)).instances.at(-1)!.row).toBe(0);
});

test('cancelled and invalid drags do not spawn, and all variants can still be clicked into play', async ({ page }) => {
  await page.goto('/');
  const before = await state(page);
  const card = page.locator('.library-item').filter({ has: page.getByRole('button', { name: 'Spawn Spirit cards', exact: true }) });
  await card.getByRole('button', { name: 'Spawn Spirit cards', exact: true }).dragTo(page.locator('.library-footer'));
  expect((await state(page)).instances).toEqual(before.instances);
  const viewport = page.locator('.table-viewport');
  await viewport.evaluate(el => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('application/x-tablecraft-library', JSON.stringify({ projectId: 'other', componentId: 'missing', rows: [0] }));
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX: 500, clientY: 400, dataTransfer }));
  });
  expect((await state(page)).instances).toEqual(before.instances);
  await viewport.evaluate((el, project) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('application/x-tablecraft-library', JSON.stringify({ projectId: project.id, componentId: project.components.find(c => c.name === 'Spirit cards')!.id, rows: [999] }));
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX: 500, clientY: 400, dataTransfer }));
  }, before);
  expect((await state(page)).instances).toEqual(before.instances);
  await expect(page.getByText('Choose up to 1,000 valid variants to spawn at once.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Spawn all variants' })).toHaveCount(0);
  await card.getByRole('button', { name: /^Show .* variants \(/ }).click();
  await card.getByRole('button', { name: 'Spawn all variants' }).click();
  await expect.poll(async () => (await state(page)).instances.length).toBe(before.instances.length + 6);
  expect((await state(page)).instances.slice(-6).map(i => i.row)).toEqual([0, 1, 2, 3, 4, 5]);
  await page.getByRole('button', { name: 'Undo playground action' }).click();
  await expect.poll(async () => (await state(page)).instances).toEqual(before.instances);
});

test('dragging a component or using its spawn-all button spawns every variant, stacked when possible; dice spawn one piece', async ({ page }) => {
  await page.goto('/');
  const before = await state(page);
  const viewport = page.locator('.table-viewport');
  const item = (name: string) => page.locator('.library-item').filter({ has: page.getByRole('button', { name: `Spawn ${name}`, exact: true }) }).first();
  const cards = before.components.find(c => c.name === 'Spirit cards')!;

  await item('Spirit cards').getByRole('button', { name: 'Spawn Spirit cards', exact: true }).dragTo(viewport);
  await expect.poll(async () => (await state(page)).instances.length).toBe(before.instances.length + 6);
  let added = (await state(page)).instances.slice(-6);
  expect(added.map(i => i.row)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(new Set(added.map(i => i.stack)).size).toBe(1);
  expect(added[0].stack).toBeTruthy();
  expect(added.map(i => i.order)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(new Set(added.map(i => `${i.x},${i.y}`)).size).toBe(1);
  expect(added.every(i => i.componentId === cards.id)).toBe(true);
  await page.getByRole('button', { name: 'Undo playground action' }).click();
  await expect.poll(async () => (await state(page)).instances).toEqual(before.instances);

  await item('Spirit cards').hover();
  await item('Spirit cards').getByRole('button', { name: 'Spawn all Spirit cards variants', exact: true }).click();
  await expect.poll(async () => (await state(page)).instances.length).toBe(before.instances.length + 6);
  added = (await state(page)).instances.slice(-6);
  expect(new Set(added.map(i => i.stack)).size).toBe(1);
  await page.getByRole('button', { name: 'Undo playground action' }).click();
  await expect.poll(async () => (await state(page)).instances).toEqual(before.instances);

  const fern = item('Botanical artwork (fern)');
  await fern.getByRole('button', { name: 'Spawn all Botanical artwork (fern) variants', exact: true }).click({ force: true });
  await expect.poll(async () => (await state(page)).instances.length).toBe(before.instances.length + 3);
  added = (await state(page)).instances.slice(-3);
  expect(added.map(i => i.row)).toEqual([0, 1, 2]);
  expect(added.every(i => !i.stack)).toBe(true);
  await page.getByRole('button', { name: 'Undo playground action' }).click();
  await expect.poll(async () => (await state(page)).instances).toEqual(before.instances);

  const die = item('Spirit die');
  await expect(die.locator('.library-variants-toggle')).toHaveCount(0);
  await expect(die.getByRole('button', { name: /^Spawn all/ })).toHaveCount(0);
  await expect(die.locator('.preview-variants, .preview-ghost')).toHaveCount(0);
  await die.getByRole('button', { name: 'Spawn Spirit die', exact: true }).dragTo(viewport);
  await expect.poll(async () => (await state(page)).instances.length).toBe(before.instances.length + 1);
  added = (await state(page)).instances.slice(-1);
  expect(added[0]).toMatchObject({ row: 0, stack: null });
});
