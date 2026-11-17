import { expect, test } from '@playwright/test';
import { savedWorkspace } from './savedWorkspace';

test('variant selectors show numbered first-column values rather than name or value fields', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit die', exact: true }).click();
  await page.getByRole('button', { name: /Data bindings/ }).click();
  await page.getByLabel('CSV data', { exact: true }).fill('10,2,name,value\nAlpha,Other,Wrong,1\n,Other,Wrong,2\n"Beta, gamma",Other,Wrong,3');
  await page.getByRole('button', { name: 'Apply data & refresh instances', exact: true }).click();
  const labels = ['1. Alpha', '2. ', '3. Beta, gamma'];
  const toolbar = page.locator('.canvas-toolbar').getByLabel('Preview row', { exact: true });
  await expect(toolbar.locator('option')).toHaveText(labels);
  await page.getByRole('button', { name: 'Behavior', exact: true }).click();
  await expect(page.getByLabel('Dice variant', { exact: true }).locator('option')).toHaveText(labels);
  await page.getByRole('button', { name: /Data bindings/ }).click();
  await expect(page.getByRole('dialog').getByLabel('Preview row', { exact: true }).locator('option')).toHaveText(labels);
});

test('designer toolbar scrolls with the wheel and shows edge shadows without clipping menus', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  const toolbar = page.locator('.canvas-toolbar');
  const wrapper = page.locator('.designer-toolbar-scroll');
  await expect(toolbar).toHaveCSS('scrollbar-width', 'none');
  await expect(wrapper).toHaveClass(/overflow-right/);
  await expect(wrapper).not.toHaveClass(/overflow-left/);
  expect(await toolbar.innerText()).not.toContain('Preview row');
  await toolbar.hover();
  await page.mouse.wheel(0, 1000);
  await expect(wrapper).toHaveClass(/overflow-left/);
  await expect(wrapper).not.toHaveClass(/overflow-right/);
  await expect(toolbar.getByLabel('Preview row', { exact: true })).toBeInViewport();
  await page.mouse.wheel(0, -1000);
  await expect(wrapper).not.toHaveClass(/overflow-left/);
  await expect(wrapper).toHaveClass(/overflow-right/);
  await page.getByRole('button', { name: 'Add shape', exact: true }).click();
  const rectangle = page.getByRole('menuitem', { name: 'Rectangle', exact: true });
  await expect(rectangle).toBeInViewport();
  const layerCount = await page.locator('.layer-row').count();
  await rectangle.click();
  await expect(page.locator('.layer-row')).toHaveCount(layerCount + 1);
});

test('toolbar preview row switches artwork variants and stays synced with data bindings', async ({ page }) => {
  await page.goto('/');
  await page.locator('.library-filters').getByRole('button', { name: 'Artwork', exact: true }).click();
  const artwork = page.locator('.library-item').filter({ has: page.locator('.preview-variants') }).first();
  await artwork.getByRole('button', { name: /^Edit / }).click();
  const toolbarRow = page.locator('.canvas-toolbar').getByLabel('Preview row', { exact: true });
  const face = page.locator('.artboard .component-face').first();
  await expect(toolbarRow).toBeVisible();
  const initial = await face.innerHTML();
  await toolbarRow.selectOption('1');
  await expect.poll(() => face.innerHTML()).not.toBe(initial);
  await page.getByRole('button', { name: /Data bindings/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Preview row', { exact: true })).toHaveValue('1');
  await dialog.getByLabel('Preview row', { exact: true }).selectOption('0');
  await page.keyboard.press('Escape');
  await expect(toolbarRow).toHaveValue('0');
  await expect.poll(() => face.innerHTML()).toBe(initial);
  await page.getByRole('button', { name: 'Behavior', exact: true }).click();
  await expect(toolbarRow).toBeVisible();
});

test('shape menu inserts directly, boolean controls are contextual and parenting uses the tree', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await expect(page.locator('.layer-root-drop')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add frame', exact: true })).toHaveCount(0);
  const union = page.getByRole('button', { name: 'Union', exact: true });
  await expect(union).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add shape', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Add shape', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rectangle', exact: true }).click();
  const layers = page.locator('.layer-row');
  await page.getByRole('button', { name: 'Add empty element', exact: true }).click();
  await page.getByLabel('Layer name', { exact: true }).fill('Container');
  const container = page.getByRole('button', { name: 'Container', exact: true });
  await layers.filter({ hasText: /^Shape$/ }).last().dragTo(container);
  await expect.poll(async () => {
    const nodes = (await savedWorkspace(page)).projects[0].components[0].front;
    const parent = nodes.find(n => n.name === 'Shape')?.parent;
    return !!parent && parent === nodes.find(n => n.name === 'Container')?.id;
  }).toBe(true);
  await layers.filter({ hasText: /^Shape$/ }).last().click();
  await expect(page.getByLabel('Parent', { exact: true })).toHaveCount(0);
  const rootTargetName = (await savedWorkspace(page)).projects[0].components[0].front.find(node => node.parent === null && node.name !== 'Container')?.name;
  expect(rootTargetName).toBeTruthy();
  const rootTarget = page.locator('.layer-list > .layer-tree-item').filter({
    has: page.getByRole('button', { name: rootTargetName!, exact: true }),
  }).locator('.layer-tree-row');
  await layers.filter({ hasText: /^Shape$/ }).last().dragTo(rootTarget, { targetPosition: { x: 12, y: 1 } });
  await expect.poll(async () => {
    const archive = await savedWorkspace(page);
    const nodes = archive.projects[0].components[0].front;
    return nodes.find(n => n.name === 'Shape')?.parent;
  }).toBeNull();
});

test('nested fitting renders stretch, contain and cover and offers Artwork type', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await page.getByRole('button', { name: 'Link nested component', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Spirit die', exact: true }).click();
  await page.getByLabel('Width', { exact: true }).fill('200');
  await page.getByLabel('Height', { exact: true }).fill('100');
  await page.getByLabel('Height', { exact: true }).blur();
  const face = page.locator('.artboard .nested-component-content').last().locator('.component-face').first();
  const ratio = async () => { const box = (await face.boundingBox())!; return box.width / box.height; };
  await expect.poll(ratio).toBeCloseTo(2, 1);
  await page.getByLabel('Nested fitting', { exact: true }).selectOption('contain');
  await expect.poll(ratio).toBeCloseTo(1, 1);
  const contain = (await face.boundingBox())!;
  await page.getByLabel('Nested fitting', { exact: true }).selectOption('cover');
  await expect.poll(async () => (await face.boundingBox())!.width / contain.width).toBeCloseTo(2, 1);
  await page.getByRole('button', { name: 'Behavior', exact: true }).click();
  await page.getByLabel('Component type', { exact: true }).selectOption('artwork');
  await expect(page.locator('.artboard > div > .component-face')).toHaveCSS('border-radius', '0px');
});

test('data bindings accepts edits to single-column dice CSV', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit die', exact: true }).click();
  await page.getByRole('button', { name: /Data bindings/ }).click();
  await page.getByLabel('CSV data', { exact: true }).fill('value\nOne\n"Two, and more"\n"Line one\nLine two"');
  await page.getByRole('button', { name: 'Apply data & refresh instances', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.artboard')).toContainText('One');
  await page.getByRole('button', { name: /Data bindings/ }).click();
  await expect(page.getByLabel('CSV data', { exact: true })).toHaveValue('value\nOne\n"Two, and more"\n"Line one\nLine two"');
});
