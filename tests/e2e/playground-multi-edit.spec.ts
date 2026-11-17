import { expect, test, type Page } from '@playwright/test';
import type { Project } from '../../src/domain';

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!).projects[0] as Project);

test('several selected pieces share rotation and scale fields, showing “–” while they differ', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('#playground-pieces-panel');
  const tokens = panel.getByRole('button', { name: 'Amber token', exact: true });
  await tokens.nth(0).click();
  await page.keyboard.press('e');
  await tokens.nth(1).click({ modifiers: ['Control'] });
  const rotation = page.getByLabel('Rotation', { exact: true }), scale = page.getByLabel('Scale', { exact: true });
  await expect(rotation).toHaveValue('');
  await expect(rotation).toHaveAttribute('placeholder', '–');
  await expect(scale).not.toHaveValue('');
  await rotation.fill('45');
  await rotation.press('Enter');
  await expect(rotation).toHaveValue('45');
  await scale.fill('1.5');
  await scale.press('Enter');
  const selected = await page.evaluate(() => [...document.querySelectorAll('.table-piece.selected')].map(el => el.getAttribute('data-piece-id')));
  await expect.poll(async () => (await saved(page)).instances.filter(i => selected.includes(i.id)).map(i => [i.rotation, i.scale])).toEqual([[45, 1.5], [45, 1.5]]);
});

test('hand cards reorder with Alt+arrow keys instead of arrow buttons, and the fullscreen preview shows the stack size', async ({ page }) => {
  await page.goto('/');
  const deck = page.locator('.table-viewport').getByRole('button', { name: /^Spirit cards, stack of/ });
  const count = Number((await deck.getAttribute('aria-label'))!.match(/stack of (\d+)/)![1]);
  await deck.hover();
  await page.keyboard.press('z');
  const dialog = page.getByRole('dialog', { name: /^Fullscreen preview:/ });
  await expect(dialog.getByLabel(`Stack of ${count}`)).toHaveText(String(count));
  await page.keyboard.press('Escape');

  await deck.hover();
  await page.keyboard.press('2');
  const cards = page.locator('.hand-card');
  await expect(cards).toHaveCount(2);
  await expect(page.locator('.hand-order')).toHaveCount(0);
  const before = await cards.evaluateAll(elements => elements.map(element => element.getAttribute('data-hand-id')));
  await cards.first().focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(() => cards.evaluateAll(elements => elements.map(element => element.getAttribute('data-hand-id')))).toEqual([...before].reverse());
});
