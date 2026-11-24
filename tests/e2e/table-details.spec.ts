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
  await page.mouse.up();
  await expect(hint).toHaveCount(0);
  await expect(die).toBeVisible();
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
