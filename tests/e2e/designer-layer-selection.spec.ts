import { expect, test } from '@playwright/test';

test('the layers panel selects like a list: click, Ctrl/Cmd-click, Shift-click ranges and arrow keys', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  const rows = page.locator('.layer-list .layer-row');
  const active = () => rows.evaluateAll(elements => elements.flatMap((element, index) => element.classList.contains('active') ? [index] : []));
  await expect.poll(() => rows.count()).toBeGreaterThan(6);

  await rows.nth(1).click();
  expect(await active()).toEqual([1]);
  // Shift-click selects every row between the last clicked one and this one, in either direction.
  await rows.nth(4).click({ modifiers: ['Shift'] });
  expect(await active()).toEqual([1, 2, 3, 4]);
  await rows.nth(0).click({ modifiers: ['Shift'] });
  expect(await active()).toEqual([0, 1]);
  // Ctrl/Cmd-click toggles one row and becomes the new anchor; Ctrl+Shift adds a range.
  await rows.nth(5).click({ modifiers: ['ControlOrMeta'] });
  expect(await active()).toEqual([0, 1, 5]);
  await rows.nth(6).click({ modifiers: ['ControlOrMeta', 'Shift'] });
  expect(await active()).toEqual([0, 1, 5, 6]);
  await rows.nth(1).click({ modifiers: ['ControlOrMeta'] });
  expect(await active()).toEqual([0, 5, 6]);
  // A plain click selects just that row, even inside the selection.
  await rows.nth(5).click();
  expect(await active()).toEqual([5]);

  // Up/Down move the selection through the list; with Shift they extend it from the anchor.
  await page.keyboard.press('ArrowDown');
  expect(await active()).toEqual([6]);
  await expect(rows.nth(6)).toBeFocused();
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  expect(await active()).toEqual([4, 5, 6]);
  // The arrows moved the selection, not the layers.
  await expect(page.getByLabel('Undo design edit')).toBeDisabled();
});
