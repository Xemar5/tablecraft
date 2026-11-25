import { expect, test, type Page } from '@playwright/test';
import { savedWorkspace } from './savedWorkspace';

const project = async (page: Page) => (await savedWorkspace(page)).projects[0];
const center = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test('the grid tool adds grid layers and snap points, and pieces snap to the first grid that takes them', async ({ page }) => {
  await page.goto('/');
  // The Table tab sends you to the grid tool; the floating tools have one Grids button instead of grid and snap toggles.
  await expect(page.getByRole('button', { name: 'Toggle grid', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^Table/ }).click();
  await page.getByRole('button', { name: 'Edit grids', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Grid tool', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const panel = page.locator('.grid-editor');
  await expect(panel.getByRole('list', { name: 'Grid layers' }).getByRole('listitem')).toHaveCount(1);

  await panel.getByRole('group', { name: 'Add a grid' }).getByRole('button', { name: /Hex/ }).click();
  await panel.getByRole('group', { name: 'Add a grid' }).getByRole('button', { name: /Points/ }).click();
  await expect.poll(async () => (await project(page)).grids?.map(grid => grid.name)).toEqual(['Grid', 'Hex grid', 'Snap points']);
  await expect(page.locator('.grid-layers .grid-fill-hex')).toHaveCount(1);

  // Clicking the table adds a point to the selected points grid; dragging its handle moves it.
  const viewport = (await page.locator('.table-viewport').boundingBox())!;
  const spot = { x: viewport.x + viewport.width * .2, y: viewport.y + viewport.height * .75 };
  await page.mouse.click(spot.x, spot.y);
  await expect.poll(async () => (await project(page)).grids?.[2].points?.length).toBe(1);
  const handle = page.locator('.grid-handles [data-grid-point]');
  await expect(handle).toHaveCount(1);
  const before = (await project(page)).grids![2].points![0];
  const at = await center(page, '.grid-handles [data-grid-point] .grid-handle-dot');
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 30, at.y + 10, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await project(page)).grids?.[2].points?.[0].x).toBeGreaterThan(before.x);
  // The selected point gets a label and a forced rotation in the panel.
  await panel.getByRole('textbox', { name: 'Label', exact: true }).fill('Start');
  await panel.getByRole('textbox', { name: 'Label', exact: true }).press('Enter');
  await panel.getByRole('checkbox', { name: /^Turn pieces here/ }).check();
  await expect.poll(async () => (await project(page)).grids?.[2].points?.[0]).toMatchObject({ label: 'Start', rotation: 0 });

  // The points grid goes first, so pieces dropped near the point land on it rather than on a hex cell.
  await panel.getByRole('button', { name: 'Move Snap points up', exact: true }).click();
  await panel.getByRole('button', { name: 'Move Snap points up', exact: true }).click();
  await expect.poll(async () => (await project(page)).grids?.map(grid => grid.name)).toEqual(['Snap points', 'Grid', 'Hex grid']);
  const target = await center(page, '.grid-handles [data-grid-point] .grid-handle-dot');
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.grid-handles')).toHaveCount(0);

  const token = page.locator('.table-viewport').getByRole('button', { name: 'Amber token', exact: true }).first();
  const id = (await token.getAttribute('data-piece-id'))!;
  const from = await center(page, `.table-piece[data-piece-id="${id}"]`);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 4, target.y - 3, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const saved = await project(page), point = saved.grids![0].points![0], piece = saved.instances.find(i => i.id === id)!;
    return [piece.x - point.x, piece.y - point.y];
  }).toEqual([0, 0]);

  // Elsewhere the hex grid takes it: it lands on a cell centre.
  const away = { x: viewport.x + viewport.width * .7, y: viewport.y + viewport.height * .3 };
  const now = await center(page, `.table-piece[data-piece-id="${id}"]`);
  await page.mouse.move(now.x, now.y);
  await page.mouse.down();
  await page.mouse.move(away.x, away.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const saved = await project(page), piece = saved.instances.find(i => i.id === id)!;
    const row = 100 * Math.sqrt(3) / 2, r = Math.round(piece.y / row), q = (piece.x / 100) - r / 2;
    return Math.abs(piece.y - r * row) < 0.01 && Math.abs(q - Math.round(q)) < 0.0001;
  }).toBe(true);

  // Delete removes the selected point with the grid tool on.
  await page.getByRole('button', { name: 'Grid tool', exact: true }).click();
  await panel.getByRole('button', { name: 'Snap points', exact: true }).click();
  await page.locator('.grid-handles [data-grid-point]').first().dispatchEvent('pointerdown', { button: 0, pointerId: 1, isPrimary: true });
  await page.locator('.table-viewport').dispatchEvent('pointerup', { button: 0, pointerId: 1, isPrimary: true });
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await project(page)).grids?.[0].points?.length).toBe(0);
});

test('editing a points grid swaps the Pieces panel for a Points panel with point groups', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Grid tool', exact: true }).click();
  const editor = page.locator('.grid-editor');
  await editor.getByRole('group', { name: 'Add a grid' }).getByRole('button', { name: /Points/ }).click();
  const panel = page.locator('#playground-pieces-panel');
  await expect(panel).toHaveAttribute('aria-label', 'Points');
  const tree = panel.getByRole('tree', { name: 'Snap points' });
  await expect(tree).toContainText('No snap points yet');

  const viewport = (await page.locator('.table-viewport').boundingBox())!;
  const click = (x: number, y: number) => page.mouse.click(viewport.x + viewport.width * x, viewport.y + viewport.height * y);
  await click(.2, .8);
  await click(.3, .8);
  await expect(tree.getByRole('button', { name: /^Point Point \d$/ })).toHaveCount(2);
  // Selecting a row selects the point on the table and in the grid panel.
  await tree.getByRole('button', { name: 'Point Point 1', exact: true }).click();
  await expect(page.locator('.grid-handles .grid-handle.selected')).toHaveCount(1);
  await expect(editor.getByRole('group', { name: 'Selected point' })).toBeVisible();

  // A new group takes the selected point, and is named right away.
  await tree.getByRole('button', { name: 'Point Point 2', exact: true }).click();
  await panel.getByRole('button', { name: 'New point group', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Group name', exact: true }).fill('Start area');
  await panel.getByRole('textbox', { name: 'Group name', exact: true }).press('Enter');
  const group = tree.getByRole('button', { name: /^Point group Start area/ });
  await expect(group).toHaveAccessibleName('Point group Start area, 1 point');
  // With the group selected, new points go into it and its points are highlighted on the table.
  await group.click();
  await click(.4, .8);
  await expect(group).toHaveAccessibleName('Point group Start area, 2 points');
  await expect(page.locator('.grid-handles .grid-handle.highlighted')).toHaveCount(2);
  // Dragging a row onto the group moves it inside.
  const box = (await group.boundingBox())!;
  await tree.getByRole('button', { name: 'Point Point 1', exact: true }).dragTo(group, { targetPosition: { x: box.width / 2, y: box.height / 2 } });
  await expect(group).toHaveAccessibleName('Point group Start area, 3 points');
  const saved = (await savedWorkspace(page)).projects[0].grids!.find(grid => grid.shape === 'points')!;
  expect(saved.pointGroups).toEqual([expect.objectContaining({ name: 'Start area', parent: null })]);
  expect(saved.points!.every(point => point.group === saved.pointGroups![0].id)).toBe(true);

  // Other grids, and leaving the tool, bring the pieces back.
  await editor.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(panel).toHaveAttribute('aria-label', 'Pieces');
  await editor.getByRole('button', { name: 'Snap points', exact: true }).click();
  await expect(panel).toHaveAttribute('aria-label', 'Points');
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(panel).toHaveAttribute('aria-label', 'Pieces');
});
