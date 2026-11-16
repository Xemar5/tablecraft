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
