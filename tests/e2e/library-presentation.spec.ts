import { expect, test } from '@playwright/test';

test('filter wheel scrolling hides the scrollbar and updates overflow shadows', async ({ page }) => {
  await page.goto('/');
  const separator = page.getByRole('separator', { name: 'Resize component library', exact: true });
  await separator.focus();
  await page.keyboard.press('Home');
  const filters = page.locator('.library-filters'), wrapper = page.locator('.library-filter-scroll');
  await expect(filters).toHaveCSS('scrollbar-width', 'none');
  await expect(wrapper).toHaveClass(/overflow-right/);
  await expect(wrapper).not.toHaveClass(/overflow-left/);
  await filters.hover();
  await page.mouse.wheel(0, 1000);
  await expect.poll(() => filters.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await expect(wrapper).toHaveClass(/overflow-left/);
  await expect(wrapper).not.toHaveClass(/overflow-right/);
  await expect.poll(() => wrapper.evaluate(el => getComputedStyle(el, '::before').opacity)).toBe('1');
  await page.mouse.wheel(0, -1000);
  await expect.poll(() => filters.evaluate(el => el.scrollLeft)).toBe(0);
  await expect(wrapper).not.toHaveClass(/overflow-left/);
  await expect(wrapper).toHaveClass(/overflow-right/);
  await separator.focus();
  await page.keyboard.press('End');
  await expect(wrapper).not.toHaveClass(/overflow-left|overflow-right/);
});

test('type filters scroll without bleeding and every multi-variant kind has a preview badge', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.library-item').first()).toBeVisible();
  const filters = page.locator('.library-filters');
  await expect(filters).toHaveCSS('overflow-x', 'auto');
  await filters.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  const artwork = filters.getByRole('button', { name: 'Artwork', exact: true });
  await expect(artwork).toBeInViewport();
  await artwork.click();
  await expect(page.locator('.library-item')).not.toHaveCount(0);
  const artWithVariants = page.locator('.library-item').filter({ has: page.locator('.preview-variants') });
  await expect(artWithVariants.first()).toBeVisible();
  await expect(artWithVariants.first().locator('.preview-ghost')).not.toHaveCount(0);
  await filters.getByRole('button', { name: 'Dice', exact: true }).click();
  const die = page.locator('.library-item').filter({ hasText: 'Spirit die' });
  await expect(die.locator('.preview-variants')).toHaveText('6');
  await expect(die.locator('.preview-ghost')).toHaveCount(2);
});

test('transparent botanical artwork has no synthetic top-edge highlight', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.component-artwork').first()).toBeVisible();
  for (const artwork of await page.locator('.component-artwork').all()) {
    await expect(artwork).toHaveCSS('box-shadow', 'none');
    await expect(artwork).toHaveCSS('border-radius', '0px');
  }
  await expect(page.locator('.component-card').first()).not.toHaveCSS('box-shadow', 'none');
});
