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

test('the selection ring keeps its on-screen size at any table zoom, with no corner squares', async ({ page }) => {
  await page.goto('/');
  await page.locator('#playground-pieces-panel').getByRole('button', { name: 'Amber token', exact: true }).first().click();
  const piece = page.locator('.table-piece.selected');
  const sizes = () => piece.evaluate(element => {
    const shadow = getComputedStyle(element, '::after').boxShadow;
    const spread = Number(shadow.match(/(-?[\d.]+)px\s*$/)![1]);
    const scale = element.getBoundingClientRect().width / (element as HTMLElement).offsetWidth;
    return { ring: spread * scale, corners: element.querySelectorAll('.selection-corner').length };
  });
  for (const zoom of ['25%', '100%', '300%']) {
    await page.getByRole('button', { name: 'Fit table', exact: true }).hover();
    await page.getByRole('button', { name: `Zoom to ${zoom}`, exact: true }).click();
    await expect.poll(async () => (await sizes()).ring).toBeCloseTo(2, 1);
    expect((await sizes()).corners).toBe(0);
  }
});

test('pieces move to the back or front and step past overlapping pieces with Ctrl/Cmd+[ and ] or the inspector', async ({ page }) => {
  await page.goto('/');
  const project = await saved(page);
  const kind = (componentId: string) => project.components.find(c => c.id === componentId)!.kind;
  const [a, b] = project.instances.filter(i => !i.holder && !i.stack && kind(i.componentId) === 'token').slice(0, 2);
  // Put the second token over the right part of the first, so the first's left edge stays clickable.
  await page.evaluate(([id, x, y]) => {
    const archive = JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!);
    Object.assign(archive.projects[0].instances.find((i: { id: string }) => i.id === id), { x, y });
    localStorage.setItem('tablecraft.workspace.v1', JSON.stringify(archive));
  }, [b.id, a.x + 30, a.y] as const);
  await page.reload();
  // Bottom-to-top table units, as the table draws them (stacks once, boards always underneath).
  const units = async () => {
    const current = await saved(page);
    return [...new Set(current.instances.filter(i => !i.holder && current.components.find(c => c.id === i.componentId)!.kind !== 'board').map(i => i.stack ?? i.id))];
  };
  const order = async () => (await units()).filter(key => key === a.id || key === b.id);
  const first = page.locator(`[data-piece-id="${a.id}"]`);
  const leftEdge = async () => { const box = (await first.boundingBox())!; return { x: 8, y: box.height / 2 }; };
  // Clicking raises the piece; the inspector's Send backward steps it under the token it overlaps.
  await first.click({ position: await leftEdge() });
  await expect.poll(order).toEqual([b.id, a.id]);
  await page.mouse.move(5, 5);
  await page.locator('.action-grid').getByRole('button', { name: /^Send backward/ }).click();
  await expect.poll(order).toEqual([a.id, b.id]);
  await page.keyboard.press('Control+BracketRight');
  await expect.poll(order).toEqual([b.id, a.id]);
  // With Shift, the hovered piece goes all the way to the back or front.
  await first.hover({ position: await leftEdge() });
  await page.keyboard.press('Control+Shift+BracketLeft');
  await expect.poll(async () => (await units())[0]).toBe(a.id);
  await page.keyboard.press('Control+Shift+BracketRight');
  await expect.poll(async () => (await units()).at(-1)).toBe(a.id);
});
