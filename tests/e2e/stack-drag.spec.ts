import { expect, test, type Page } from '@playwright/test';

type Saved = { instances: { id: string; stack: string | null; x: number; y: number; rotation: number; componentId: string; shuffles?: number }[] };
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!).projects[0]) as Promise<Saved>;
// The deck is the table's biggest stack (its id changes when pieces join it).
const deckSize = async (page: Page) => {
  const counts = new Map<string, number>();
  for (const item of (await saved(page)).instances) if (item.stack) counts.set(item.stack, (counts.get(item.stack) ?? 0) + 1);
  return Math.max(0, ...counts.values());
};
// The default settings: dragging a stack takes its top piece.
const useDefaultDrag = (page: Page) => page.addInitScript(() => localStorage.setItem('tablecraft.settings.v1', JSON.stringify({ name: 'Player 1', color: '#b7cc91', onboarded: true })));
const deck = (page: Page) => page.locator('.table-viewport .table-piece').filter({ has: page.locator('.stack-count') }).first();
const drag = async (page: Page, from: { x: number; y: number }, by: { x: number; y: number }, shift = false) => {
  await page.mouse.move(from.x, from.y);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 6 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
};
const middle = async (page: Page) => { const box = (await deck(page).boundingBox())!; return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };

test('by default, dragging a stack takes its top piece, Shift-drag moves the whole stack and a click selects it', async ({ page }) => {
  await useDefaultDrag(page);
  await page.goto('/');
  await expect.poll(() => deckSize(page)).toBe(12);
  // A click (no movement) selects the whole stack without splitting it.
  await deck(page).click();
  await expect(page.getByRole('heading', { name: 'Stack selected', exact: true })).toBeVisible();
  expect(await deckSize(page)).toBe(12);
  await drag(page, await middle(page), { x: -170, y: -40 });
  await expect.poll(() => deckSize(page)).toBe(11);
  const state = await saved(page);
  const before = state.instances.find(item => item.stack && state.instances.filter(other => other.stack === item.stack).length === 11)!;
  await drag(page, await middle(page), { x: -60, y: 120 }, true);
  await expect.poll(async () => (await saved(page)).instances.find(item => item.id === before.id)!.x).not.toBe(before.x);
  expect(await deckSize(page)).toBe(11);
});

test('turning the setting off moves whole stacks, and Shift-drag takes the top piece', async ({ page }) => {
  await useDefaultDrag(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const toggle = page.getByRole('checkbox', { name: /^Drag the top piece off stacks/ });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await drag(page, await middle(page), { x: -170, y: -40 });
  await expect.poll(() => deckSize(page)).toBe(12);
  await drag(page, await middle(page), { x: -170, y: -40 }, true);
  await expect.poll(() => deckSize(page)).toBe(11);
});

test('a dragged piece animates when rotated, and only a real shuffle plays the shuffle animation', async ({ page }) => {
  await page.goto('/');
  const token = page.locator('.table-viewport').getByRole('button', { name: 'Amber token', exact: true }).first();
  const box = (await token.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20, { steps: 4 });
  await page.keyboard.press('e');
  const dragged = page.locator('.table-piece.dragging');
  await expect.poll(() => dragged.locator('.piece-face').evaluate(element => element.getAnimations().length)).toBeGreaterThan(0);
  await page.mouse.up();

  // Shuffle the deck, then take its top card off and put it back: neither move is a shuffle.
  await deck(page).click();
  await page.locator('.action-grid').getByRole('button', { name: /^Shuffle/ }).click();
  await expect(page.locator('.table-piece.shuffling')).toHaveCount(0, { timeout: 3000 });
  await page.evaluate(() => {
    const w = window as unknown as { shuffles: number };
    w.shuffles = 0;
    new MutationObserver(() => { if (document.querySelector('.table-piece.shuffling')) w.shuffles++; }).observe(document.querySelector('.table-world')!, { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
  await drag(page, await middle(page), { x: -200, y: 0 }, true);
  await expect.poll(() => deckSize(page)).toBe(11);
  const card = page.locator('.table-piece.selected').first();
  const cardBox = (await card.boundingBox())!, deckBox = (await deck(page).boundingBox())!;
  await drag(page, { x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 }, { x: deckBox.x - cardBox.x, y: deckBox.y - cardBox.y });
  await expect.poll(() => deckSize(page)).toBe(12);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as unknown as { shuffles: number }).shuffles)).toBe(0);
});

test('components set their rotation step, and the selection badge stays upright at the top-left corner on screen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Amber token', exact: true }).click();
  await page.getByRole('button', { name: 'Behavior', exact: true }).click();
  const step = page.getByLabel('Rotation step (°)', { exact: true });
  await step.fill('45');
  await step.press('Enter');
  await page.getByRole('button', { name: /Playground/ }).click();
  const id = await page.locator('.table-viewport').getByRole('button', { name: 'Amber token', exact: true }).first().getAttribute('data-piece-id');
  const token = page.locator(`.table-piece[data-piece-id="${id}"]`);
  await token.click();
  const rotateOn = page.locator('.action-grid').getByRole('button', { name: /^Rotate \+45°/ });
  await expect(rotateOn).toBeVisible();
  await rotateOn.click();
  await expect.poll(async () => (await saved(page)).instances.find(item => item.id === id)!.rotation).toBe(45);
  await token.hover();
  await page.keyboard.press('e');
  await expect.poll(async () => (await saved(page)).instances.find(item => item.id === id)!.rotation).toBe(90);

  // With two pieces selected, the order badge on the rotated token reads upright at its top-left corner on screen.
  await page.locator('.table-viewport').getByRole('button', { name: 'Spirit die', exact: true }).click({ modifiers: ['ControlOrMeta'] });
  const badge = token.locator('.stack-order-badge');
  await expect(badge).toBeVisible();
  expect(await badge.evaluate(element => (element as HTMLElement).style.transform)).toContain('rotate(-90deg)');
  const pieceBox = (await token.boundingBox())!, badgeBox = (await badge.boundingBox())!;
  expect(badgeBox.x + badgeBox.width).toBeLessThan(pieceBox.x + pieceBox.width / 2);
  expect(badgeBox.y + badgeBox.height).toBeLessThan(pieceBox.y + pieceBox.height / 2);
  expect(badgeBox.width).toBeGreaterThan(badgeBox.height);
});

test('taking the top piece off a stack and dropping it is one undo step', async ({ page }) => {
  await useDefaultDrag(page);
  await page.goto('/');
  await expect.poll(() => deckSize(page)).toBe(12);
  const before = (await saved(page)).instances;
  await drag(page, await middle(page), { x: -170, y: -40 });
  await expect.poll(() => deckSize(page)).toBe(11);
  // One undo puts the card straight back on the deck, exactly as it was.
  await page.keyboard.press('Control+z');
  await expect.poll(() => deckSize(page)).toBe(12);
  expect((await saved(page)).instances).toEqual(before);
});
