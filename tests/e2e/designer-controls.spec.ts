import { expect, test } from '@playwright/test';
import type { Archive } from '../../src/domain';

test('shape menu inserts directly, boolean controls are contextual and parenting uses the tree', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add frame', exact: true })).toHaveCount(0);
  const union = page.getByRole('button', { name: 'Union', exact: true });
  await expect(union).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add shape', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Add shape', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rectangle', exact: true }).click();
  const layers = page.locator('.layer-row');
  await page.getByRole('button', { name: 'Add empty element', exact: true }).click();
  await page.getByLabel('Layer name', { exact: true }).fill('Container');
  const container = page.getByRole('button', { name: 'Container', exact: true });
  await layers.filter({ hasText: /^Shape$/ }).last().dragTo(container);
  await expect.poll(async () => {
    const archive = await page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!)) as Archive;
    const nodes = archive.projects[0].components[0].front;
    return nodes.find(n => n.name === 'Shape')?.parent === nodes.find(n => n.name === 'Container')?.id;
  }).toBe(true);
  await layers.filter({ hasText: /^Shape$/ }).last().click();
  await expect(page.getByLabel('Parent', { exact: true })).toHaveCount(0);
});

test('nested fitting renders stretch, contain and cover and offers Artwork type', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await page.getByRole('button', { name: 'Link nested component', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Spirit die', exact: true }).click();
  await page.getByLabel('Width', { exact: true }).fill('200');
  await page.getByLabel('Height', { exact: true }).fill('100');
  await page.getByLabel('Height', { exact: true }).blur();
  const face = page.locator('.artboard .nested-component-content').last().locator('.component-face').first();
  const ratio = async () => { const box = (await face.boundingBox())!; return box.width / box.height; };
  await expect.poll(ratio).toBeCloseTo(2, 1);
  await page.getByLabel('Nested fitting', { exact: true }).selectOption('contain');
  await expect.poll(ratio).toBeCloseTo(1, 1);
  const contain = (await face.boundingBox())!;
  await page.getByLabel('Nested fitting', { exact: true }).selectOption('cover');
  await expect.poll(async () => (await face.boundingBox())!.width / contain.width).toBeCloseTo(2, 1);
  await page.getByRole('button', { name: 'Behavior', exact: true }).click();
  await page.getByLabel('Component type', { exact: true }).selectOption('artwork');
  await expect(page.locator('.artboard > div > .component-face')).toHaveCSS('border-radius', '0px');
});

test('data bindings accepts edits to single-column dice CSV', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit die', exact: true }).click();
  await page.getByRole('button', { name: /Data bindings/ }).click();
  await page.getByLabel('CSV data', { exact: true }).fill('value\nOne\n"Two, and more"\n"Line one\nLine two"');
  await page.getByRole('button', { name: 'Apply data & refresh instances', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.artboard')).toContainText('One');
  await page.getByRole('button', { name: /Data bindings/ }).click();
  await expect(page.getByLabel('CSV data', { exact: true })).toHaveValue('value\nOne\n"Two, and more"\n"Line one\nLine two"');
});
