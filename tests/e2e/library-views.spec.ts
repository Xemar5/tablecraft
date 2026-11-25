import { expect, test } from '@playwright/test';
import { savedWorkspace } from './savedWorkspace';

test('the component library is a grid that fits the panel, with small-grid and list views, all reorderable', async ({ page }) => {
  await page.goto('/');
  const library = page.locator('.component-library');
  const items = library.locator('> .library-item');
  const columns = () => library.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  await expect(page.getByRole('radio', { name: 'Large grid', exact: true })).toHaveAttribute('aria-checked', 'true');
  expect(await columns()).toBe(1);
  // Widening the panel adds columns.
  const separator = page.getByRole('separator', { name: 'Resize component library', exact: true });
  const box = (await separator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(columns).toBeGreaterThan(1);

  // The small grid is art only: a third of the size, no labels, many columns.
  await page.getByRole('radio', { name: 'Small grid', exact: true }).click();
  await expect(library).toHaveClass(/library-small/);
  await expect(items.first().locator('.library-item-name')).toBeHidden();
  expect(await columns()).toBeGreaterThan(4);
  const tile = (await items.first().locator('.library-preview').boundingBox())!;
  expect(tile.height).toBeLessThan(60);

  // The list: name and details on the left, a small icon on the right. The choice is remembered.
  await page.getByRole('radio', { name: 'List', exact: true }).click();
  await expect.poll(columns).toBe(1);
  const name = (await items.first().locator('.library-item-name').boundingBox())!;
  const icon = (await items.first().locator('.library-preview').boundingBox())!;
  expect(icon.x).toBeGreaterThan(name.x + name.width - 1);
  expect(icon.height).toBeLessThan(50);
  await expect(items.first()).toContainText('220 × 308 px · card');
  const first = await items.first().locator('.library-item-name strong').innerText();
  await page.getByRole('button', { name: `Reorder ${first}`, exact: true }).press('ArrowDown');
  await expect.poll(async () => (await savedWorkspace(page)).projects[0].components[1].name).toBe(first);
  await page.reload();
  await expect(page.getByRole('radio', { name: 'List', exact: true })).toHaveAttribute('aria-checked', 'true');
  // Grids reorder across with the arrow keys too.
  await page.getByRole('radio', { name: 'Small grid', exact: true }).click();
  await page.getByRole('button', { name: `Reorder ${first}`, exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await savedWorkspace(page)).projects[0].components[0].name).toBe(first);
});

test('new components start from a type, with scripts last and no blank component', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add component', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.template-card').last()).toHaveClass(/template-script/);
  await expect(dialog.getByText('Start from scratch')).toHaveCount(0);
});
