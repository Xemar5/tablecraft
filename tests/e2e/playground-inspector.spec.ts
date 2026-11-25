import { expect, test } from '@playwright/test';

test('Selection and Table isolate object controls and shared settings', async ({ page }) => {
  await page.goto('/');
  const inspector = page.locator('#playground-inspector-panel');
  const selection = inspector.getByRole('button', { name: 'Selection', exact: true });
  const table = inspector.getByRole('button', { name: 'Table', exact: true });
  const expectConsistentInsets = async () => {
    const insets = await inspector.locator('.inspector-section').evaluateAll(sections => sections.map(section => {
      const style = getComputedStyle(section);
      return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft];
    }));
    expect(insets.length).toBeGreaterThan(0);
    for (const inset of insets) expect(inset).toEqual(['16px', '14px', '16px', '14px']);
  };
  await expect(selection).toHaveClass('active');
  await expectConsistentInsets();
  await expect(inspector.getByRole('heading', { name: 'No component selected' })).toBeVisible();
  await expect(inspector).toContainText('Select a component on the table or in your hand');
  await expect(inspector.getByRole('button', { name: 'Edit grids', exact: true })).toHaveCount(0);

  const stack = page.locator('.table-piece').filter({ has: page.locator('.stack-count') });
  await stack.click();
  await expect(inspector.getByRole('heading', { name: 'Stack selected' })).toBeVisible();
  await expectConsistentInsets();
  await expect(inspector.getByLabel('Rotation', { exact: true })).toBeVisible();
  await expect(inspector.locator('.action-grid').getByRole('button', { name: /^Shuffle/ })).toBeVisible();
  await table.click();
  await expect(inspector.getByRole('heading', { name: 'Table settings' })).toBeVisible();
  await expectConsistentInsets();
  await expect(inspector.getByLabel('Rotation', { exact: true })).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: 'Edit grids', exact: true })).toBeVisible();
  const turns = inspector.getByLabel('Turn tracker', { exact: true });
  const wasChecked = await turns.isChecked();
  await turns.setChecked(!wasChecked);
  await expect(turns).toBeChecked({ checked: !wasChecked });
  await expect(stack).toHaveClass(/selected/);

  await selection.click();
  await expect(inspector.getByRole('heading', { name: 'Stack selected' })).toBeVisible();
  await inspector.getByRole('button', { name: 'Deselect', exact: true }).click();
  await expect(inspector.getByRole('heading', { name: 'No component selected' })).toBeVisible();
  await stack.dblclick();
  await page.locator('.hand-card').click();
  await expect(inspector.getByRole('heading', { name: 'Component selected' })).toBeVisible();
  await expect(inspector.getByLabel('Scale', { exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: /Players/ }).click();
  await expect(inspector.getByRole('button', { name: 'Add hotseat player', exact: true })).toBeVisible();
  await expectConsistentInsets();
});
