import { expect, test } from '@playwright/test';

test('hand cards use wheel scrolling, edge shadows and hold arrows without a scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto('/');
  await page.locator('.table-piece').filter({ has: page.locator('.stack-count') }).hover();
  await page.keyboard.press('0');
  const content = page.getByLabel('Hand cards', { exact: true });
  const wrapper = page.locator('.hand-cards-scroll');
  await expect(wrapper).toHaveClass(/overflow-right/);
  expect(await wrapper.evaluate(el => getComputedStyle(el, '::after').width)).toBe('12px');
  expect(await wrapper.evaluate(el => getComputedStyle(el, '::after').backgroundImage)).toContain('25%');
  await expect(content).toHaveCSS('scrollbar-width', 'none');
  await content.hover();
  await page.mouse.wheel(0, 100);
  await expect.poll(() => content.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await expect(wrapper).toHaveClass(/overflow-left/);
  await expect.poll(() => wrapper.evaluate(el => getComputedStyle(el, '::before').opacity)).toBe('1');
  const initial = await content.evaluate(el => el.scrollLeft);
  const right = page.getByRole('button', { name: 'Scroll Hand cards right', exact: true });
  await right.hover(); await page.mouse.down();
  await expect.poll(() => content.evaluate(el => el.scrollLeft)).toBeGreaterThan(initial + 30);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Toggle hand panel', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle hand panel', exact: true }).click();
  await expect(wrapper).toHaveClass(/overflow-right/);
});

test('narrow inspector and layer tabs scroll into reach with wheel and keyboard arrows', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('separator', { name: 'Resize table inspector', exact: true }).focus();
  await page.keyboard.press('Home');
  const tableTabs = page.getByLabel('Table inspector tabs', { exact: true });
  await expect(page.getByRole('button', { name: 'Scroll Table inspector tabs right', exact: true })).toBeVisible();
  await tableTabs.hover(); await page.mouse.wheel(0, 200);
  await expect.poll(() => tableTabs.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await page.setViewportSize({ width: 380, height: 800 });
  await expect(page.getByLabel('Designer inspector tabs', { exact: true })).toHaveCSS('scrollbar-width', 'none');
  for (const [separator, label] of [
    ['Resize designer layers', 'Component faces'],
  ]) {
    await page.getByRole('separator', { name: separator, exact: true }).focus();
    await page.keyboard.press('Home');
    const arrow = page.getByRole('button', { name: `Scroll ${label} right`, exact: true });
    await expect(arrow).toBeVisible();
    await arrow.focus(); await page.keyboard.press('Enter');
    await expect.poll(() => page.getByLabel(label, { exact: true }).evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  }
});
