import { expect, test } from '@playwright/test';

test('transparent pieces take their shape from their layers, and selection outlines trace that shape', async ({ page }) => {
  await page.goto('/');
  // An opaque card keeps its rounded face.
  const card = page.locator('.table-viewport .table-piece').filter({ has: page.locator('.component-card') }).first();
  await expect(card.locator('.piece-face > .component-face')).toHaveCSS('border-radius', '12px');

  await page.getByRole('link', { name: 'Tablecraft home' }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('radio', { name: /^Tidewater Isles/ }).check();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const tile = page.locator('.table-viewport').getByRole('button', { name: /^Island tile/ }).first();
  const face = tile.locator('.piece-face > .component-face');
  await expect(face).toHaveClass(/open-face/);
  await expect(face).toHaveCSS('border-radius', '0px');
  await expect(face).toHaveCSS('box-shadow', 'none');

  // Huts are drawn as a house outline on a transparent face.
  await page.locator('#playground-pieces-panel').getByRole('button', { name: /^Hut/ }).first().click();
  const hut = page.locator('.table-viewport .table-piece.selected');
  await expect(hut).toHaveCount(1);
  await expect(hut).toHaveAttribute('aria-label', /^Hut/);
  const filter = await hut.locator('.piece-face').evaluate(element => (element as HTMLElement).style.filter);
  const id = /#([^"')]+)/.exec(filter)![1];
  const radii = await page.locator(`filter#${id} feMorphology`).evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('radius'))));
  const zoom = await hut.evaluate(element => Number(getComputedStyle(element).getPropertyValue('--ring-zoom').trim()) || Number(getComputedStyle(element.closest('.table-world')!).getPropertyValue('--table-zoom')));
  // 2px of outline 4px away from the shape, in screen pixels.
  expect(radii[0] * zoom).toBeCloseTo(6, 1);
  expect(radii[1] * zoom).toBeCloseTo(4, 1);
  // The box-shaped ring is not drawn.
  await expect.poll(() => hut.evaluate(element => getComputedStyle(element, '::after').boxShadow)).toMatch(/rgba\(0, 0, 0, 0\)/);
});
