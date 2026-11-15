import { expect, test, type Page } from '@playwright/test';

async function size(page: Page, selector: string, dimension: 'width' | 'height') {
  return (await page.locator(selector).boundingBox())![dimension];
}

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
