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

test('the Selection tab shows the ids of selected pieces and their stack, ready to copy for scripts', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const stack = page.locator('.table-piece').filter({ has: page.locator('.stack-count') }).first();
  await stack.click();
  // The ids sit in a Debug section at the bottom of the Selection tab, closed at first.
  const ids = page.locator('.piece-ids');
  await expect(ids).toBeHidden();
  await page.locator('.debug-info summary').click();
  await expect(ids.locator('.piece-id-row')).toHaveText([/^Piece ids12 pieces$/, /^Stack idstarter-deck$/]);
  await ids.getByRole('button', { name: 'Copy stack id', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Copied the stack id.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('starter-deck');
  const id = (await page.locator('.table-viewport').getByRole('button', { name: 'Amber token', exact: true }).first().getAttribute('data-piece-id'))!;
  await page.locator(`.table-piece[data-piece-id="${id}"]`).click();
  await expect(ids.locator('code')).toHaveText(id);
});
