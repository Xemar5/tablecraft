import { expect, test, type Page } from '@playwright/test';

const rows = (page: Page) => page.locator('#playground-pieces-panel').locator('button.layer-row');

test('the playground pieces panel lists table pieces and selects them with click, Ctrl-click and Shift-click', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('#playground-pieces-panel');
  const count = await page.locator('.table-piece').count();
  await expect(rows(page)).toHaveCount(count);
  await expect(panel.locator('.panel-heading')).toContainText(String(count));

  const first = rows(page).nth(0), second = rows(page).nth(1), fourth = rows(page).nth(3);
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /Selection/ }).first()).toHaveClass(/active/);
  await expect(page.locator('.table-piece.selected')).toHaveCount(1);

  await second.click({ modifiers: ['Control'] });
  await expect(page.locator('.table-piece.selected')).toHaveCount(2);
  await second.click({ modifiers: ['Control'] });
  await expect(page.locator('.table-piece.selected')).toHaveCount(1);

  await first.click();
  await fourth.click({ modifiers: ['Shift'] });
  await expect(page.locator('.table-piece.selected')).toHaveCount(4);
  for (const index of [0, 1, 2, 3]) await expect(rows(page).nth(index)).toHaveAttribute('aria-pressed', 'true');

  await page.locator('.table-viewport').click({ position: { x: 5, y: 5 } });
  await expect(rows(page).and(page.locator('.active'))).toHaveCount(0);
  await page.locator('.table-piece:not(.locked)').first().click();
  await expect(rows(page).and(page.locator('.active'))).toHaveCount(1);

  const stack = panel.getByRole('button', { name: /stack of/ }).first();
  const size = Number((await stack.getAttribute('aria-label'))!.match(/stack of (\d+)/)![1]);
  await stack.click();
  await expect(page.locator('.table-piece.selected')).toHaveCount(1);
  const name = (await stack.getAttribute('aria-label'))!.split(',')[0];
  await panel.getByRole('button', { name: `Expand ${name} stack`, exact: true }).click();
  await expect(rows(page)).toHaveCount(count + size);
  const member = stack.locator('xpath=../following-sibling::div[1]').locator('button.layer-row');
  await member.click();
  await expect(member).toHaveAttribute('aria-pressed', 'true');
  await expect(stack).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('heading', { name: /selected/ }).first()).toBeVisible();

  const locked = panel.getByRole('button', { name: /, locked$/ });
  await expect(locked).toHaveCount(1);
  await locked.click();
  await expect(page.locator('.table-piece.locked.selected')).toHaveCount(1);
});

test('dragging rows or Alt+Up/Down rearranges render order, moving a group as one block', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('#playground-pieces-panel');
  type Saved = { instances: { id: string; holder: string | null; stack: string | null; group?: string; componentId: string }[]; components: { id: string; kind: string }[] };
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!).projects[0]) as Promise<Saved>;
  // Bottom-to-top table units (stacks once; boards always render underneath).
  const units = async () => {
    const p = await saved();
    return [...new Set(p.instances.filter(i => !i.holder && p.components.find(c => c.id === i.componentId)!.kind !== 'board').map(i => i.stack ?? i.id))];
  };
  const tokens = panel.getByRole('button', { name: 'Amber token', exact: true });
  await tokens.nth(0).click();
  await tokens.nth(1).click({ modifiers: ['Control'] });
  await panel.hover();
  await page.keyboard.press('g');
  const group = panel.getByRole('button', { name: /^Group Group 1, 2 pieces/ });
  await expect(group).toBeVisible();
  const members = async () => (await saved()).instances.filter(i => i.group).map(i => i.id);
  const grouped = await members();
  const contiguous = async () => {
    const order = await units(), at = grouped.map(id => order.indexOf(id)).sort((a, b) => a - b);
    return at[1] - at[0];
  };

  // Alt+Down moves the group below the next row at its level, as one block.
  const labels = () => panel.locator('[role=treeitem][aria-level="1"] button.layer-row').evaluateAll(buttons => buttons.map(b => b.getAttribute('aria-label')));
  const before = await labels();
  const index = before.findIndex(label => label?.startsWith('Group Group 1'));
  await group.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(async () => (await labels()).findIndex(label => label?.startsWith('Group Group 1'))).toBe(index + 1);
  await expect(group).toBeFocused();
  expect(await contiguous()).toBe(1);
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(labels).toEqual(before);

  // Dropping the die on the top edge of the group row places it just above the whole group, outside it.
  const dieRow = panel.getByRole('button', { name: /^Spirit die/ });
  await dieRow.dragTo(group, { targetPosition: { x: 20, y: 2 } });
  await expect.poll(async () => {
    const order = await units(), p = await saved();
    const dieId = p.instances.find(i => p.components.find(c => c.id === i.componentId)!.kind === 'dice')!.id;
    return order.indexOf(dieId) - Math.max(...grouped.map(id => order.indexOf(id)));
  }).toBe(1);
  // Dropping on the middle of a group still puts the row inside it.
  await dieRow.dragTo(group);
  await expect(panel.getByRole('button', { name: /^Group Group 1, 3 pieces/ })).toBeVisible();
});
