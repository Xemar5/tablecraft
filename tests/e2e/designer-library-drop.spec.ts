import { expect, test, type Page } from '@playwright/test';
import { savedWorkspace } from './savedWorkspace';

const front = async (page: Page, component: string) => (await savedWorkspace(page)).projects[0].components.find(c => c.name === component)!.front;

test('library components dragged onto the designer become linked component layers where they drop', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  const before = (await front(page, 'Spirit cards')).length;
  const board = (await page.locator('.artboard').boundingBox())!;
  await page.getByRole('button', { name: 'Design Amber token', exact: true }).dragTo(page.locator('.artboard'), { targetPosition: { x: board.width / 2, y: board.height / 2 } });
  await expect(page.getByLabel('Layer name', { exact: true })).toHaveValue('Amber token');
  await expect.poll(async () => (await front(page, 'Spirit cards')).length).toBe(before + 1);
  const token = (await savedWorkspace(page)).projects[0].components.find(c => c.name === 'Amber token')!;
  const layer = (await front(page, 'Spirit cards')).at(-1)!;
  expect(layer).toMatchObject({ type: 'component', componentId: token.id });
  await expect(page.getByRole('button', { name: 'Add linked component', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Linked component' })).toBeVisible();
  // A component can't be dropped into itself.
  await page.getByRole('button', { name: 'Design Spirit cards', exact: true }).dragTo(page.locator('.artboard'));
  await expect(page.getByText('A component can’t contain itself.')).toBeVisible();
});

test('a component that can’t be flipped still has a back to design, used only for printing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Amber token', exact: true }).click();
  const back = page.getByRole('button', { name: 'Back', exact: true });
  await expect(back).toBeEnabled();
  await back.click();
  await expect(page.locator('.artboard-note')).toContainText('only used when printing');
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await expect.poll(async () => (await savedWorkspace(page)).projects[0].components.find(c => c.name === 'Amber token')!.back.length).toBe(1);
  await expect(page.locator('.artboard .design-node').filter({ hasText: 'Your text' })).toBeVisible();
});
