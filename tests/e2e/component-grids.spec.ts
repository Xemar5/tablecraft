import { expect, test, type Page } from '@playwright/test';

const field = (page: Page, name: string) => page.getByRole('spinbutton', { name, exact: true });
const centre = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const drag = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
};
const project = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!).projects[0]);

test('a component carries grids whose bounds are set in the designer, and pieces snap to them on its table pieces', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Forest clearing', exact: true }).click();
  await page.getByRole('button', { name: 'Add a grid', exact: true }).click();
  await page.getByRole('group', { name: 'Add a grid' }).getByRole('button', { name: 'Square' }).click();
  // A new grid covers the whole component, its points half a cell in from the corner.
  await expect(field(page, 'Bounds width (px)')).toHaveValue('640');
  await expect(field(page, 'Offset X (px)')).toHaveValue('25');
  const area = page.locator('.artboard .component-grids rect.grid-fill');
  await expect(area).toHaveAttribute('width', '640');

  // Bounds from the fields, and from the dashed frame's handles on the canvas.
  await field(page, 'Bounds X (px)').fill('100');
  await field(page, 'Bounds X (px)').blur();
  await expect(area).toHaveAttribute('x', '100');
  await expect(field(page, 'Bounds width (px)')).toHaveValue('640');
  const zoom = Number((await page.locator('.canvas-bottom button').nth(1).textContent())!.replace('%', '')) / 100;
  const top = await centre(page, '[aria-label="Resize grid bounds from top edge"]');
  await drag(page, top, { x: top.x, y: top.y + 50 * zoom });
  await expect(field(page, 'Bounds Y (px)')).toHaveValue('50');
  await expect(field(page, 'Bounds height (px)')).toHaveValue('370');
  // Dragging the canvas moves the grid's points.
  const middle = await centre(page, '.grid-edit-layer');
  await drag(page, middle, { x: middle.x + 10 * zoom, y: middle.y });
  await expect(field(page, 'Offset X (px)')).toHaveValue('35');
  // Each change is a design edit: undo takes back the move.
  await page.getByRole('button', { name: 'Undo design edit', exact: true }).click();
  await expect(field(page, 'Offset X (px)')).toHaveValue('25');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit grids', exact: true })).toBeVisible();

  // On the table the clearing shows its grid, and a token dropped on it snaps to one of its points inside the bounds.
  await page.getByRole('button', { name: 'Playground', exact: true }).click();
  await expect(page.locator('[data-testid="table-piece"][aria-label="Forest clearing"] .component-grids rect')).toHaveAttribute('y', '50');
  const state = await project(page);
  const clearing = state.components.find((item: { name: string }) => item.name === 'Forest clearing');
  const board = state.instances.find((item: { componentId: string }) => item.componentId === clearing.id);
  const token = page.locator('[data-testid="table-piece"][aria-label="Amber token"]').first();
  const id = await token.getAttribute('data-piece-id');
  const start = state.instances.find((item: { id: string }) => item.id === id);
  const tableZoom = await token.evaluate(el => new DOMMatrix(getComputedStyle(el.closest('.table-world')!).transform).a);
  // Aim at (290, 80) on the clearing, above the cards on it: the nearest point inside the bounds is (275, 75).
  const aim = { x: board.x + (290 - clearing.width / 2) * board.scale, y: board.y + (80 - clearing.height / 2) * board.scale };
  const box = (await token.boundingBox())!;
  await token.hover();
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + (aim.x - start.x) * tableZoom, box.y + box.height / 2 + (aim.y - start.y) * tableZoom, { steps: 6 });
  await page.mouse.up();
  const expected = { x: board.x + (275 - clearing.width / 2) * board.scale, y: board.y + (75 - clearing.height / 2) * board.scale };
  await expect.poll(async () => {
    const item = (await project(page)).instances.find((piece: { id: string }) => piece.id === id);
    return [Math.round(item.x * 100) / 100, Math.round(item.y * 100) / 100];
  }).toEqual([Math.round(expected.x * 100) / 100, Math.round(expected.y * 100) / 100]);
});
