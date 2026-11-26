import { expect, test } from '@playwright/test';
import { expectHeaderChecked, headerItem, toggleHeader, openHeaderMenu, closeHeaderMenu } from './headerMenus';

test('dragging a filtered library item preserves hidden components and their relative order', async ({ page }) => {
  await page.goto('/');
  const names = page.locator('.library-item-label strong');
  const initial = await names.allTextContents();
  await page.getByRole('textbox', { name: 'Search components', exact: true }).fill('Spirit');
  const filtered = await names.allTextContents();
  expect(filtered.length).toBeGreaterThan(1);
  const moving = filtered.at(-1)!;
  const targetName = filtered[0];
  const target = page.locator('.library-item').filter({ has: page.getByRole('button', { name: `Reorder ${targetName}`, exact: true }) });
  const bounds = (await target.boundingBox())!;
  await page.getByRole('button', { name: `Reorder ${moving}`, exact: true }).dragTo(target, {
    targetPosition: { x: bounds.width / 2, y: 2 },
  });
  await expect(names).toHaveText([moving, ...filtered.slice(0, -1)]);
  await page.getByRole('textbox', { name: 'Search components', exact: true }).fill('');
  const expected = initial.filter(name => name !== moving);
  expected.splice(expected.indexOf(targetName), 0, moving);
  await expect(names).toHaveText(expected);
  await expect(page.locator('.library-dragging,.library-drop-before,.library-drop-after')).toHaveCount(0);
});

test('library drag ordering persists across modes, filters and reloads without spawning pieces', async ({ page }) => {
  await page.goto('/');
  const entries = page.locator('.library-item');
  const names = page.locator('.library-item-label strong');
  const initial = await names.allTextContents();
  const pieceCount = await page.locator('.table-piece').count();
  const source = page.getByRole('button', { name: `Reorder ${initial[0]}`, exact: true });
  const firstRow = entries.filter({ has: source }).locator('.library-item-label');
  await expect(firstRow.getByRole('button').first()).toHaveAccessibleName(`Reorder ${initial[0]}`);
  const handleBounds = await source.boundingBox();
  const nameBounds = await firstRow.locator('.library-item-name').boundingBox();
  expect(handleBounds!.x).toBeLessThan(nameBounds!.x);
  expect(nameBounds!.x - handleBounds!.x - handleBounds!.width).toBeLessThanOrEqual(7);
  const titleBounds = (await firstRow.locator('strong').boundingBox())!;
  const metadataBounds = (await firstRow.locator('small').boundingBox())!;
  expect(Math.abs(titleBounds.x - nameBounds!.x)).toBeLessThan(1);
  expect(Math.abs(metadataBounds.x - nameBounds!.x)).toBeLessThan(1);
  await expect(firstRow.getByRole('button', { name: `Edit ${initial[0]}`, exact: true })).toHaveClass(/library-item-name/);
  const rowBounds = (await firstRow.boundingBox())!;
  const variants = firstRow.locator('.library-variants-toggle');
  const toggleBounds = (await variants.boundingBox())!;
  expect(Math.abs(toggleBounds.x + toggleBounds.width - rowBounds.x - rowBounds.width)).toBeLessThan(2);
  await expect(entries.locator('.library-item-label .icon-button[aria-label^="Edit "]')).toHaveCount(0);
  const target = entries.filter({ has: page.getByRole('button', { name: `Reorder ${initial[1]}`, exact: true }) });
  const bounds = (await target.boundingBox())!;
  // The library is a grid: the right half of a tile drops after it.
  await source.dragTo(target, { targetPosition: { x: bounds.width - 4, y: bounds.height / 2 } });
  const reordered = [initial[1], initial[0], ...initial.slice(2)];
  await expect(names).toHaveText(reordered);
  await expect(page.locator('.table-piece')).toHaveCount(pieceCount);
  await page.getByRole('button', { name: 'Component designer', exact: true }).click();
  await expect(names).toHaveText(reordered);
  const search = page.getByRole('textbox', { name: 'Search components', exact: true });
  await search.fill(initial[0]);
  await expect(names).toHaveText([initial[0]]);
  await search.fill('');
  await expect(names).toHaveText(reordered);
  await source.focus();
  await page.keyboard.press('ArrowUp');
  await expect(names).toHaveText(initial);
  const first = entries.filter({ has: source });
  const firstBounds = (await first.boundingBox())!;
  await page.getByRole('button', { name: `Reorder ${initial[1]}`, exact: true }).dragTo(first, {
    targetPosition: { x: firstBounds.width / 2, y: 2 },
  });
  await expect(names).toHaveText(reordered);
  await page.reload();
  await expect(names).toHaveText(reordered);
});

test('pieces and layers panels toggle in both modes with their own icon, separate from the library toggle', async ({ page }) => {
  await page.goto('/');
  for (const [mode, id, label, heading] of [['Playground', '#playground-pieces-panel', 'Pieces panel', 'Pieces'], ['Component designer', '#designer-layers-panel', 'Layers panel', 'Layers']] as const) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    // The panels have their own icons in the Visibility menu.
    await openHeaderMenu(page, label);
    expect(await headerItem(page, 'Component library').locator('svg').first().getAttribute('class')).not.toEqual(await headerItem(page, label).locator('svg').first().getAttribute('class'));
    await headerItem(page, label).focus();
    await closeHeaderMenu(page);
    await expect(page.locator(id).locator('.panel-heading')).toContainText(heading);
    const panel = page.locator(id);
    await expect(panel).toBeVisible();
    const library = (await page.locator('#component-library-panel').boundingBox())!;
    expect((await panel.boundingBox())!.x).toBeGreaterThan(library.x + library.width - 1);
    await toggleHeader(page, label);
    await expectHeaderChecked(page, label, false);
    await expect(panel).toBeHidden();
    await expect(page.locator('#component-library-panel')).toBeVisible();
    await toggleHeader(page, label);
    await expect(panel).toBeVisible();
  }
});

test('component library can be toggled in the designer and stays hidden across modes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  const library = page.locator('#component-library-panel');
  const separator = page.getByRole('separator', { name: 'Resize component library', exact: true });
  await expectHeaderChecked(page, 'Component library', true);
  const width = await library.evaluate(el => el.getBoundingClientRect().width);
  await toggleHeader(page, 'Component library');
  await expect(library).toBeHidden();
  await expect(separator).toHaveCount(0);
  await expectHeaderChecked(page, 'Component library', false);
  await expect(page.getByRole('button', { name: 'Add text', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Playground', exact: true }).click();
  await expect(library).toBeHidden();
  await page.getByRole('button', { name: 'Component designer', exact: true }).click();
  await expect(library).toBeHidden();
  await toggleHeader(page, 'Component library');
  await expect(library).toBeVisible();
  await expect(separator).toBeVisible();
  await expectHeaderChecked(page, 'Component library', true);
  await expect.poll(() => library.evaluate(el => el.getBoundingClientRect().width)).toBe(width);
});

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

test('type filters scroll without bleeding and multi-variant kinds other than dice have a preview badge', async ({ page }) => {
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
  await expect(die).toBeVisible();
  await expect(die.locator('.preview-variants')).toHaveCount(0);
  await expect(die.locator('.preview-ghost')).toHaveCount(0);
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

test('hovering a library name or preview explains editing and dragging', async ({ page }) => {
  await page.goto('/');
  const row = page.locator('.library-item').filter({ has: page.getByRole('button', { name: 'Edit Spirit cards', exact: true }) });
  const name = row.getByRole('button', { name: 'Edit Spirit cards', exact: true });
  const hint = row.locator('.library-name-hint');
  const dims = row.locator('.library-item-name small');
  await expect(hint).toBeHidden();
  const nameHeight = (await name.boundingBox())!.height;
  await name.hover();
  await expect(hint).toBeVisible();
  expect((await name.boundingBox())!.height).toBeCloseTo(nameHeight, 0);
  const [hintBox, dimsBox] = await Promise.all([hint, dims].map(el => el.evaluate(e => e.getBoundingClientRect().toJSON())));
  expect(hintBox.y).toBeCloseTo(dimsBox.y, 0);
  expect(hintBox.height).toBeCloseTo(dimsBox.height, 0);
  await expect(hint).toHaveCSS('font-size', await dims.evaluate(el => getComputedStyle(el).fontSize));
  await expect(hint).toHaveText('Click to edit in the designer');
  await expect(row.locator('.library-item-name small')).toBeHidden();
  await expect(name.locator('strong svg')).toHaveCSS('opacity', '1');
  const preview = row.locator('.library-preview');
  await expect(preview.locator('.preview-hint')).toHaveCSS('opacity', '0');
  await preview.hover();
  await expect(preview.locator('.preview-hint')).toHaveCSS('opacity', '1');
  await expect(preview.locator('.preview-hint')).toHaveText('Drag all onto table');
  await name.click();
  await expect(page.getByRole('button', { name: 'Component designer', exact: true })).toHaveClass(/active/);
});
