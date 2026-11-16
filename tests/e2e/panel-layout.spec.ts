import { expect, test, type Page } from '@playwright/test';

async function size(page: Page, selector: string, dimension: 'width' | 'height') {
  return (await page.locator(selector).boundingBox())![dimension];
}

test('selected designer properties scroll inside the inspector without scrolling the document', async ({ page }) => {
  await page.setViewportSize({ width: 1135, height: 889 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  const inspector = page.locator('#designer-inspector-panel');
  await expect(inspector.getByLabel('Text / binding', { exact: true })).toBeVisible();
  await expect(inspector.locator('h3')).toHaveCount(0);
  const textColor = await inspector.locator('.color-field').filter({ has: page.getByLabel('Text color alpha', { exact: true }) }).boundingBox();
  const fontSize = await inspector.getByLabel('Font size', { exact: true }).boundingBox();
  expect(textColor!.width).toBeGreaterThan(fontSize!.width * 1.5);
  for (const height of [889, 650]) {
    await page.setViewportSize({ width: 1135, height });
    const scroll = inspector.locator('.inspector-scroll');
    await scroll.evaluate(el => { el.scrollTop = 0; });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBe(0);
    const header = await page.locator('.app-header').boundingBox();
    await scroll.hover();
    await page.mouse.wheel(0, 3000);
    await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await page.mouse.wheel(0, 3000);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    expect(await page.locator('.app-header').boundingBox()).toEqual(header);
    await expect(inspector.getByLabel('Alignment', { exact: true })).toBeInViewport();
  }
});

test('panel dragging works after opening Home and returning to a project', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('tablecraft.last-project'));
  await page.reload();
  await page.getByRole('button', { name: 'Open project Wildwood', exact: true }).click();
  await page.getByRole('link', { name: 'Tablecraft home', exact: true }).click();
  await page.getByRole('button', { name: 'Open project Wildwood', exact: true }).click();
  for (const [label, selector, dimension, dx, dy] of [
    ['Resize component library', '#component-library-panel', 'width', 40, 0],
    ['Resize table inspector', '#playground-inspector-panel', 'width', -40, 0],
    ['Resize hand tray', '#hand-tray-panel', 'height', 0, -40],
  ] as const) {
    const separator = page.getByRole('separator', { name: label, exact: true });
    const initial = await size(page, selector, dimension);
    const box = (await separator.boundingBox())!;
    const horizontal = dimension === 'height';
    await expect(page.locator(selector)).toHaveCSS(horizontal ? 'border-top-width' : dx > 0 ? 'border-right-width' : 'border-left-width', '0px');
    expect(horizontal ? box.height : box.width).toBe(6);
    const line = await separator.evaluate((element, horizontal) => {
      const style = getComputedStyle(element, '::before');
      return horizontal ? style.height : style.width;
    }, horizontal);
    expect(line).toBe('2px');
    await page.mouse.move(box.x + (horizontal ? box.width / 2 : 1), box.y + (horizontal ? 1 : box.height / 2));
    await page.mouse.down();
    await page.mouse.move(box.x + (horizontal ? box.width / 2 : 1) + dx, box.y + (horizontal ? 1 : box.height / 2) + dy, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => size(page, selector, dimension)).toBe(initial + 40);
  }
  await page.getByRole('button', { name: 'Component designer', exact: true }).click();
  for (const [label, selector, dx] of [
    ['Resize designer layers', '#designer-layers-panel', 30],
    ['Resize designer inspector', '#designer-inspector-panel', -30],
  ] as const) {
    await expect(page.locator(selector)).toHaveCSS(dx > 0 ? 'border-right-width' : 'border-left-width', '0px');
    const initial = await size(page, selector, 'width');
    const box = (await page.getByRole('separator', { name: label, exact: true }).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + 100, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => size(page, selector, 'width')).toBe(initial + 30);
  }
});

test('panel separators resize by pointer and keyboard, survive toggles, modes and reload', async ({ page }) => {
  await page.goto('/');
  const library = page.getByRole('separator', { name: 'Resize component library' });
  const initialLibrary = await size(page, '#component-library-panel', 'width');
  const box = (await library.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 100, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => size(page, '#component-library-panel', 'width')).toBeGreaterThan(initialLibrary + 50);
  const libraryWidth = await size(page, '#component-library-panel', 'width');
  const inspector = page.getByRole('separator', { name: 'Resize table inspector' });
  const inspectorWidth = await size(page, '#playground-inspector-panel', 'width');
  await inspector.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => size(page, '#playground-inspector-panel', 'width')).toBe(inspectorWidth + 10);
  const hand = page.getByRole('separator', { name: 'Resize hand tray' });
  const handHeight = await size(page, '#hand-tray-panel', 'height');
  await hand.focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => size(page, '#hand-tray-panel', 'height')).toBe(handHeight + 10);
  await page.getByRole('button', { name: 'Toggle component library' }).click();
  await expect(library).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle component library' }).click();
  await expect.poll(() => size(page, '#component-library-panel', 'width')).toBe(libraryWidth);
  await page.getByRole('button', { name: 'Toggle hand panel' }).click();
  await expect(hand).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle hand panel' }).click();
  await expect.poll(() => size(page, '#hand-tray-panel', 'height')).toBe(handHeight + 10);
  await page.reload();
  await expect.poll(() => size(page, '#component-library-panel', 'width')).toBe(libraryWidth);
  await expect.poll(() => size(page, '#playground-inspector-panel', 'width')).toBe(inspectorWidth + 10);
  await expect.poll(() => size(page, '#hand-tray-panel', 'height')).toBe(handHeight + 10);
});

test('designer sizes and inspector tabs remain active across component and mode changes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Players', exact: false }).last().click();
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await page.getByRole('button', { name: 'Behavior', exact: true }).click();
  const layers = page.getByRole('separator', { name: 'Resize designer layers' });
  const designerInspector = page.getByRole('separator', { name: 'Resize designer inspector' });
  const oldLayers = await size(page, '#designer-layers-panel', 'width');
  const oldInspector = await size(page, '#designer-inspector-panel', 'width');
  await layers.focus(); await page.keyboard.press('ArrowRight');
  await designerInspector.focus(); await page.keyboard.press('ArrowLeft');
  await expect.poll(() => size(page, '#designer-layers-panel', 'width')).toBe(oldLayers + 10);
  await expect.poll(() => size(page, '#designer-inspector-panel', 'width')).toBe(oldInspector + 10);
  await page.getByRole('button', { name: 'Design Spirit die', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Behavior', exact: true })).toHaveClass(/active/);
  await expect.poll(() => size(page, '#designer-layers-panel', 'width')).toBe(oldLayers + 10);
  await page.getByRole('button', { name: 'Playground', exact: true }).click();
  await expect(page.locator('.playground-inspector .inspector-tabs button.active')).toContainText('Players');
  await page.getByRole('button', { name: 'Component designer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Behavior', exact: true })).toHaveClass(/active/);
  await expect.poll(() => size(page, '#designer-inspector-panel', 'width')).toBe(oldInspector + 10);
});

test('small windows keep a usable canvas and boolean icons show distinct results', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 650 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  for (const name of ['Resize component library', 'Resize designer layers', 'Resize designer inspector']) {
    const separator = page.getByRole('separator', { name });
    await separator.focus(); await page.keyboard.press('End');
  }
  await expect.poll(() => size(page, '.designer-canvas', 'width')).toBeGreaterThanOrEqual(195);
  const paths = await Promise.all(['Union', 'Subtract', 'Intersect', 'Exclude'].map(name =>
    page.getByRole('button', { name, exact: true }).locator('svg path').first().getAttribute('d')));
  expect(new Set(paths).size).toBe(4);
  for (const name of ['Union', 'Subtract', 'Intersect', 'Exclude']) {
    await expect(page.getByRole('button', { name, exact: true }).locator('svg rect')).toHaveCount(2);
  }
});

test('invalid saved panel preferences are reported and not overwritten', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tablecraft.panel-sizes.v1', '{invalid'));
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: "Panel sizes couldn't be read" })).toBeVisible();
  await page.getByRole('separator', { name: 'Resize component library' }).focus();
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => localStorage.getItem('tablecraft.panel-sizes.v1'))).toBe('{invalid');
});
