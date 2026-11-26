import { expect, test } from '@playwright/test';
import { chooseHeader } from './headerMenus';

test('New project can start from a ready-to-play game, which fills in its name and description', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Tablecraft home' }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  const start = dialog.getByRole('group', { name: 'Start from' });
  await expect(start.getByRole('radio', { name: /^Blank project/ })).toBeChecked();
  // Wildwood, the sample tour, is offered first; Backgammon isn't offered.
  await expect(start.getByRole('radio')).toHaveCount(6);
  await expect(start.getByRole('radio').nth(1)).toHaveAccessibleName(/^Wildwood/);
  await expect(start.getByRole('radio', { name: /^Backgammon/ })).toHaveCount(0);
  await start.getByRole('radio', { name: /^Tidewater Isles/ }).check();
  await expect(dialog.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue('Tidewater Isles');
  await expect(dialog.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(/tidal archipelago/);
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  // Game projects open straight onto their table, without the component template picker.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.library-panel')).toContainText('Island tile');
  await expect(page.locator('.table-viewport').getByRole('button', { name: /^Island tile/ })).toHaveCount(19);
  await expect(page.locator('.table-viewport').getByRole('button', { name: /^Tide marker/ })).toHaveCount(18);
  // Pieces are filed in groups in the Pieces panel, and the laid-out island is locked.
  const panel = page.locator('#playground-pieces-panel');
  for (const name of ['Island', 'Supply', 'Crimson pieces', 'Azure pieces', 'Ivory pieces', 'Amber pieces']) await expect(panel.getByRole('button', { name: new RegExp(`^Group ${name}, `) })).toBeVisible();
  await expect(page.locator('.table-viewport .table-piece.locked').filter({ has: page.locator('.component-card') })).not.toHaveCount(0);

  await page.getByRole('link', { name: 'Tablecraft home' }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill('Friday chess');
  await start.getByRole('radio', { name: /^Chess/ }).check();
  await expect(dialog.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue('Friday chess');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('.table-viewport').getByRole('button', { name: /^Chess pieces/ })).toHaveCount(32);
  // Its initial state is saved as a snapshot: after a capture, loading it brings every piece back.
  await page.locator('.table-viewport').getByRole('button', { name: /^Chess pieces/ }).first().click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.table-viewport').getByRole('button', { name: /^Chess pieces/ })).toHaveCount(31);
  await chooseHeader(page, 'Load');
  const saved = page.locator('.history-snapshot').filter({ hasText: 'Friday chess - initial state' });
  await expect(saved).toContainText('33 pieces');
  // Loading it puts the table back in place, after asking about the capture that wasn't saved.
  await saved.getByRole('button', { name: 'Load snapshot Friday chess - initial state', exact: true }).click();
  await page.getByRole('dialog', { name: 'Unsaved changes' }).getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.locator('.table-viewport').getByRole('button', { name: /^Chess pieces/ })).toHaveCount(32);
  await page.getByRole('link', { name: 'Tablecraft home' }).click();
  const friday = page.locator('.home-project').filter({ hasText: 'Friday chess' });
  await expect(friday).toHaveCount(1);
  await expect(friday).toContainText('2 components · 33 pieces · 2 players');
  await expect(friday).not.toContainText('Unsaved changes');
});

test('chess snaps pieces to square centres on a grid lined up with the board', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Tablecraft home' }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('radio', { name: /^Chess/ }).check();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('.table-status')).toContainText('Snapping to Grid');
  // The grid's dots sit on the snap points, at the grid's offset plus whole 60px cells.
  const pattern = page.locator('.grid-layers pattern').first();
  await expect(pattern).toHaveAttribute('x', '50');
  await expect(pattern).toHaveAttribute('y', '40');
  await expect(pattern).toHaveAttribute('width', '60');
  const pieces = page.locator('.table-viewport').getByRole('button', { name: /^Chess pieces/ });
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!).projects.find((project: { name: string }) => project.name === 'Chess'));
  const before = await saved();
  // A white pawn (row 5) on e2.
  const pawn = before.instances.find((item: { row: number; x: number }) => item.row === 5 && item.x === 1010);
  const piece = page.locator(`.table-piece[data-piece-id="${pawn.id}"]`);
  const box = (await piece.boundingBox())!, zoom = box.width / 56;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Two squares up, plus a little off-centre.
  await page.mouse.move(box.x + box.width / 2 + 13 * zoom, box.y + box.height / 2 - 133 * zoom, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await saved()).instances.find((item: { id: string }) => item.id === pawn.id)).toMatchObject({ x: pawn.x, y: pawn.y - 120 });
  await expect(pieces).toHaveCount(32);
});

