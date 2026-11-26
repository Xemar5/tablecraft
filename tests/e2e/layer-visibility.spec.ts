import { expect, test } from '@playwright/test';
import { savedWorkspace } from './savedWorkspace';
import { toggleHeader } from './headerMenus';

test('layer and group visibility controls preserve the design and support undo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await page.getByLabel('Layer name', { exact: true }).fill('Visibility group');
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page.getByLabel('Layer name', { exact: true }).fill('Visibility child');
  await page.getByLabel('Text / binding', { exact: true }).fill('Unique child text');
  const face = page.locator('.artboard .component-face').first();
  const groupRow = page.locator('.layer-tree-row').filter({ has: page.getByRole('button', { name: 'Visibility group', exact: true }) });
  const childRow = page.locator('.layer-tree-row').filter({ has: page.getByRole('button', { name: 'Visibility child', exact: true }) });
  const stored = async () => {
    const archive = await savedWorkspace(page);
    return archive.projects[0].components[0].front.filter(node => node.name.startsWith('Visibility '));
  };
  await expect(face).toContainText('Unique child text');
  await expect.poll(async () => (await stored()).length).toBe(2);
  // Typing reaches the saved design after a short pause.
  await expect.poll(async () => (await stored()).find(node => node.name === 'Visibility child')?.text).toBe('Unique child text');
  const before = await stored();
  await groupRow.hover();
  await groupRow.getByRole('button', { name: 'Hide Visibility group' }).click();
  await expect(face).not.toContainText('Unique child text');
  await expect(groupRow.getByRole('button', { name: 'Show Visibility group' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Visible', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#designer-inspector-panel .design-section').last()).toHaveClass(/visibility-rules/);
  await expect(page.locator('#designer-inspector-panel .design-section').last().getByLabel('Show when CSV field', { exact: true })).toBeVisible();
  await expect.poll(async () => (await stored()).find(node => node.name === 'Visibility group')?.visible).toBe(false);
  const after = await stored();
  expect(after).toEqual(before.map(node => node.name === 'Visibility group' ? { ...node, visible: false } : node));
  await groupRow.getByRole('button', { name: 'Show Visibility group' }).click();
  await expect(face).toContainText('Unique child text');
  await page.getByRole('button', { name: 'Visible', exact: true }).click();
  await expect(face).not.toContainText('Unique child text');
  await expect(childRow.getByRole('button', { name: 'Show Visibility child' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo design edit' }).click();
  await expect(face).toContainText('Unique child text');
  await childRow.hover();
  await childRow.getByRole('button', { name: 'Hide Visibility child' }).click();
  await expect(face).not.toContainText('Unique child text');
  await expect(page.getByRole('button', { name: 'Visible', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Visible', exact: true }).click();
  await expect(face).toContainText('Unique child text');
});

test('a layer can show only while a memory value equals a value, and follows memory as it changes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Forest clearing', exact: true }).click();
  await page.locator('#designer-layers-panel').getByRole('button', { name: 'Board title', exact: true }).click();
  const rules = page.locator('#designer-inspector-panel .visibility-rules');
  await rules.getByRole('combobox', { name: 'Condition reads', exact: true }).selectOption('memory');
  await rules.getByLabel('Show when memory value', { exact: true }).fill('season');
  await rules.getByLabel('Equals value', { exact: true }).fill('spring');
  await expect.poll(async () => (await savedWorkspace(page)).projects[0].components.find(c => c.name === 'Forest clearing')!.front
    .find(node => node.name === 'Board title')).toMatchObject({ visibilityField: 'memory.season', visibilityValue: 'spring' });
  await page.getByRole('button', { name: 'Playground', exact: true }).click();
  const board = page.locator('[data-testid="table-piece"][aria-label="Forest clearing"]');
  // Memory has no season yet, so the title is hidden; setting it shows the title at once, and changing it hides it again.
  await expect(board).not.toContainText('THE CLEARING');
  await toggleHeader(page, 'Memory');
  const memory = page.getByRole('region', { name: 'Memory', exact: true });
  await memory.getByRole('button', { name: 'Add value', exact: true }).click();
  await page.keyboard.insertText('season');
  await page.keyboard.press('Enter');
  const value = memory.getByRole('textbox', { name: 'Value of season', exact: true });
  await value.fill('spring');
  await value.press('Enter');
  await expect(board).toContainText('THE CLEARING');
  await value.fill('winter');
  await value.press('Enter');
  await expect(board).not.toContainText('THE CLEARING');
});
