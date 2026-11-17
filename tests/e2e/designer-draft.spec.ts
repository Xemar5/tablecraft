import { expect, test, type Page } from '@playwright/test';

const DRAFT_KEY = 'tablecraft.design-draft.v1';
const savedColor = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!).projects[0].components
  .find((component: { name: string }) => component.name === 'Spirit cards').color as string);
const draft = (page: Page) => page.evaluate(key => localStorage.getItem(key), DRAFT_KEY);

async function setBackground(page: Page, color: string) {
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await page.locator('.artboard-label').click();
  await page.getByLabel('Component background value', { exact: true }).fill(color);
  await expect(page.locator('.artboard .component-face').first()).toHaveCSS('background-color', color === '#123456' ? 'rgb(18, 52, 86)' : 'rgb(101, 67, 33)');
}

test('designer edits reach the table when the playground opens, and a pending draft survives a reload', async ({ page }) => {
  await page.goto('/');
  const original = await savedColor(page);
  await setBackground(page, '#123456');
  // The draft is stored on its own straight away; the project (and table) keeps the committed design.
  await expect.poll(() => draft(page)).toContain('#123456');
  expect(await savedColor(page)).toBe(original);

  await page.reload();
  await expect(page.getByRole('status')).toContainText('Restored 1 unsaved designer change.');
  await expect.poll(() => savedColor(page)).toBe('#123456');
  await expect.poll(() => draft(page)).toBeNull();

  await setBackground(page, '#654321');
  await expect.poll(() => draft(page)).toContain('#654321');
  expect(await savedColor(page)).toBe('#123456');
  await page.getByRole('button', { name: 'Playground', exact: true }).click();
  await expect.poll(() => savedColor(page)).toBe('#654321');
  await expect.poll(() => draft(page)).toBeNull();
  await expect(page.locator('.table-viewport .component-face.component-card').first()).toHaveCSS('background-color', 'rgb(101, 67, 33)');
});

test('other changes made while designing apply after the pending designs', async ({ page }) => {
  await page.goto('/');
  await setBackground(page, '#123456');
  // Creating a component commits the pending design first, in order.
  await page.getByRole('button', { name: 'Add component', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Tokens/ }).click();
  await expect.poll(() => savedColor(page)).toBe('#123456');
  await expect.poll(() => draft(page)).toBeNull();
});
