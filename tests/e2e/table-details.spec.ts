import { expect, test, type Page } from '@playwright/test';

const deckOf = (page: Page) => page.locator('.table-viewport .table-piece').filter({ has: page.locator('.stack-count') }).first();
const center = async (page: Page, selector: string) => { const box = (await page.locator(selector).first().boundingBox())!; return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };

test('stack labels stay upright on the stack\'s screen-bottom edge at a fixed size, shrinking to an icon on small stacks', async ({ page }) => {
  await page.goto('/');
  const deck = deckOf(page);
  const id = await deck.getAttribute('data-piece-id');
  const piece = page.locator(`.table-piece[data-piece-id="${id}"]`);
  await piece.click();
  await page.locator('.action-grid').getByRole('button', { name: /^Focus/ }).click();
  const label = piece.locator('.piece-labels');
  await expect(label).not.toHaveClass(/compact/);
  await expect(label).toContainText('12');
  const size = async () => (await label.boundingBox())!;
  const before = await size();
  // Rotated a quarter turn, the label is still upright (wider than tall) and below the piece's middle.
  await page.locator('.action-grid').getByRole('button', { name: /^Rotate \+90/ }).click();
  await expect.poll(async () => { const box = (await piece.boundingBox())!, at = await size(); return at.y > box.y + box.height / 2 && at.width > at.height; }).toBe(true);
  // Zooming doesn't change its size on screen; zoomed far out, only the icon remains.
  await page.locator('.zoom-control').getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => Math.round((await size()).width)).toBe(Math.round(before.width));
  for (let i = 0; i < 30; i++) await page.locator('.zoom-control').getByRole('button', { name: 'Zoom out' }).click();
  await expect(label).toHaveClass(/compact/);
  // The count stays readable to screen readers.
  await expect(label.locator('.visually-hidden')).toHaveText('12');
});

test('a table hand the pieces can\'t go into shows as blocked, with the reason', async ({ page }) => {
  await page.goto('/');
  const die = page.locator('.table-viewport').getByRole('button', { name: 'Spirit die', exact: true });
  const from = await center(page, '.table-viewport [aria-label="Spirit die"]');
  const to = await center(page, '.seat-marker.active .seat-badge');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y - 10, { steps: 8 });
  await expect(page.locator('.seat-marker.active .other-hand')).toHaveClass(/hand-drop-blocked/);
  const hint = page.locator('.hand-drop-blocked-hint');
  await expect(hint).toContainText("Can't go into");
  await expect(hint).toContainText("Spirit die can't be held in a hand");
  const dieBefore = (await die.boundingBox())!;
  await page.mouse.up();
  await expect(hint).toHaveCount(0);
  // Released over the blocked hand, the die drops where it was released, as if the hand weren't there.
  await expect.poll(async () => { const box = (await die.boundingBox())!; return Math.hypot(box.x + box.width / 2 - to.x, box.y + box.height / 2 - (to.y - 10)); }).toBeLessThan(8);
  expect(Math.round(dieBefore.y)).not.toBe(Math.round(from.y - dieBefore.height / 2));
});

test('the selection grid starts with rotation and shows only the actions a piece has', async ({ page }) => {
  await page.goto('/');
  const grid = page.locator('.action-grid');
  await deckOf(page).click();
  const labels = () => grid.getByRole('button').evaluateAll(buttons => buttons.map(button => button.querySelector('span')!.firstChild!.textContent!.trim()));
  expect((await labels()).slice(0, 2)).toEqual(['Rotate −90°', 'Rotate +90°']);
  expect(await labels()).toEqual(expect.arrayContaining(['Flip', 'Search stack', 'Shuffle', 'Spread stack']));
  await page.keyboard.press('Escape');
  await page.locator('.table-viewport').getByRole('button', { name: 'Spirit die', exact: true }).click();
  const die = await labels();
  expect(die.slice(0, 2)).toEqual(['Rotate −90°', 'Rotate +90°']);
  expect(die).toEqual(expect.arrayContaining(['Previous face', 'Next face', 'Roll die']));
  for (const missing of ['Flip', 'Search stack', 'Shuffle', 'Spread stack', 'Stack selected pieces']) expect(die).not.toContain(missing);
  await expect(page.locator('.page-status')).toContainText(/Face \d of 6/);
});

test('the hover preview stays put while clicking a piece with the hand tool', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Pan table', exact: true }).click();
  const token = page.locator('.table-viewport').getByRole('button', { name: 'Amber token', exact: true }).first();
  await token.hover();
  const preview = page.locator('.hover-preview');
  await expect(preview).toBeVisible();
  // Record every time the preview disappears while pressing and releasing.
  await page.evaluate(() => {
    const w = window as unknown as { hidden: number };
    w.hidden = 0;
    new MutationObserver(() => { if (!document.querySelector('.hover-preview')) w.hidden++; }).observe(document.body, { childList: true, subtree: true });
  });
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await expect(preview).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { hidden: number }).hidden)).toBe(0);
});

test('a component can show its hover preview while locked', async ({ page }) => {
  await page.goto('/');
  const id = await page.locator('.table-viewport').getByRole('button', { name: 'Amber token', exact: true }).first().getAttribute('data-piece-id');
  const token = page.locator(`.table-piece[data-piece-id="${id}"]`);
  await token.click();
  await page.locator('.action-grid button', { hasText: 'Lock' }).click();
  await page.keyboard.press('Escape');
  await page.mouse.move(5, 5);
  await token.hover();
  await expect(page.locator('.hover-preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit Amber token', exact: true }).click();
  await page.getByRole('button', { name: 'Behavior', exact: true }).click();
  await page.getByRole('checkbox', { name: /^Preview when locked/ }).check();
  await page.getByRole('button', { name: /Playground/ }).click();
  await token.hover();
  await expect(page.locator('.hover-preview')).toBeVisible();
});

test('shuffling a stack plays the shuffle animation once', async ({ page }) => {
  await page.goto('/');
  const id = await deckOf(page).getAttribute('data-piece-id');
  await deckOf(page).click();
  // Watch the stack's top piece for the animation class (the top piece changes with the shuffle).
  await page.evaluate(() => {
    const w = window as unknown as { shuffled: number };
    w.shuffled = 0;
    new MutationObserver(() => { if (document.querySelector('.table-piece.shuffling .piece-face')) w.shuffled++; })
      .observe(document.querySelector('.table-world')!, { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
  await page.locator('.action-grid').getByRole('button', { name: /^Shuffle/ }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { shuffled: number }).shuffled)).toBeGreaterThan(0);
  await expect(page.locator('.table-piece.shuffling')).toHaveCount(0, { timeout: 3000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!).projects[0].instances);
  expect(saved.filter((item: { stack: string | null; shuffles?: number }) => item.stack === 'starter-deck').every((item: { shuffles?: number }) => item.shuffles === 1)).toBe(true);
  void id;
});

test('the grid and snapping toggles look like the active tool when on', async ({ page }) => {
  await page.goto('/');
  const tools = page.locator('.floating-tools');
  const active = tools.locator('button.active').first();
  const grid = tools.getByRole('button', { name: 'Toggle grid' }), snap = tools.getByRole('button', { name: 'Toggle snapping' });
  if ((await snap.getAttribute('aria-pressed')) !== 'true') await snap.click();
  if ((await grid.getAttribute('aria-pressed')) !== 'true') await grid.click();
  const background = (locator: typeof grid) => locator.evaluate(element => getComputedStyle(element).backgroundColor);
  const tool = await background(active);
  await expect.poll(() => background(grid)).toBe(tool);
  await expect.poll(() => background(snap)).toBe(tool);
  await snap.click();
  await expect.poll(() => background(snap)).not.toBe(tool);
});

test('pieces dropped over a hand they can’t go into still stack onto what lies under it', async ({ page }) => {
  await page.goto('/');
  // Amber tokens can't be held in a hand.
  await page.getByRole('button', { name: 'Edit Amber token', exact: true }).click();
  await page.getByRole('button', { name: 'Behavior', exact: true }).click();
  await page.getByRole('checkbox', { name: /^Can be put in hand/ }).uncheck();
  await page.getByRole('button', { name: /Playground/ }).click();
  const tokens = page.locator('.table-viewport').getByRole('button', { name: 'Amber token', exact: true });
  const seat = await center(page, '.seat-marker.active .seat-badge');
  const dragTo = async (index: number, to: { x: number; y: number }, alt = false) => {
    const box = (await tokens.nth(index).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.move(to.x, to.y, { steps: 8 });
    return async () => { await page.mouse.up(); if (alt) await page.keyboard.up('Alt'); };
  };
  // Put one token under the hand, then drop another one on it there.
  await (await dragTo(0, seat, true))();
  await expect(page.locator('.seat-marker.active .other-hand')).not.toHaveClass(/hand-drop-blocked/);
  const release = await dragTo(1, { x: seat.x + 2, y: seat.y + 2 });
  await expect(page.locator('.seat-marker.active .other-hand')).toHaveClass(/hand-drop-blocked/);
  await expect(page.locator('.stack-drop-hint:not(.hand-drop-hint)')).toContainText('Release to add to stack');
  await expect(page.locator('.hand-drop-blocked-hint')).toHaveCount(0);
  await release();
  await expect(page.locator('.table-viewport').getByRole('button', { name: 'Amber token, stack of 2', exact: true })).toBeVisible();
});

