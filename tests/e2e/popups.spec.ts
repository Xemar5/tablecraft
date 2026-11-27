import { expect, test, type Page } from '@playwright/test';
import { wildwoodProject } from '../../src/wildwood';

// The Wildwood sample, whose Gather amber button shows the Amber milestone popup every fifth amber.
const project = wildwoodProject();
test.use({ storageState: { cookies: [], origins: [{ origin: 'http://127.0.0.1:5173', localStorage: [
  { name: 'tablecraft.workspace.v1', value: JSON.stringify({ format: 'tablecraft', version: 1, projects: [project] }) },
  { name: 'tablecraft.last-project', value: project.id },
  { name: 'tablecraft.settings.v1', value: JSON.stringify({ name: 'Player 1', color: '#b7cc91', onboarded: true }) },
] }] } });

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!).projects[0]);

test('scripts show popups on screen: laid out over the table, blurred behind, dragged, clicked and closed', async ({ page }) => {
  await page.goto('/');
  const button = page.locator('[data-testid="table-piece"][aria-label="Gather amber"]');
  // Every fifth amber gathered, Wildwood shows the Amber milestone popup to the gatherer.
  for (let n = 0; n < 5; n++) {
    await button.click();
    await expect.poll(async () => (await saved(page)).memory?.gathered).toBe(n + 1);
  }
  const popup = page.locator('.table-popup[aria-label="Amber milestone"]');
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('Player 1 has gathered 5 amber.');
  await expect(page.locator('.popup-backdrop')).toHaveCount(1);
  // It sits in the middle of the table view.
  const view = (await page.locator('.table-viewport').boundingBox())!;
  const box = (await popup.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - (view.x + view.width / 2))).toBeLessThan(2);
  expect(Math.abs(box.y + box.height / 2 - (view.y + view.height / 2))).toBeLessThan(2);
  await page.screenshot({ path: test.info().outputPath('popup.png') });

  // Dragging it moves it on this screen.
  await page.mouse.move(box.x + 20, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 52, { steps: 5 });
  await page.mouse.up();
  const moved = (await popup.boundingBox())!;
  expect(moved.x - box.x).toBeCloseTo(60, 0);
  expect(moved.y - box.y).toBeCloseTo(40, 0);

  // Its Share button runs its script action, which tells everyone and closes it.
  const scale = moved.width / 320;
  await page.mouse.click(moved.x + 234 * scale, moved.y + 139 * scale);
  await expect(page.getByText('Player 1 has gathered 5 amber!')).toBeVisible();
  await expect(popup).toHaveCount(0);
  await expect(page.locator('.popup-backdrop')).toHaveCount(0);
  expect((await saved(page)).popups).toBeUndefined();

  // While playing, clicking a popup in the library previews it on this screen only; Escape closes it.
  await page.getByRole('button', { name: 'Preview Amber milestone', exact: true }).click();
  await expect(popup).toBeVisible();
  expect((await saved(page)).popups).toBeUndefined();
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
});

test('the Quick rules button opens a fixed, draggable rules panel with a live amber count, and closes it again', async ({ page }) => {
  await page.goto('/');
  const button = page.locator('[data-testid="table-piece"][aria-label="Quick rules button"]');
  await button.click();
  const rules = page.locator('.table-popup[aria-label="Quick rules"]');
  await expect(rules).toContainText('Amber gathered so far: 0');
  // It sits at its fixed place: 84, 18 from the table view's top-left corner (inside its border), at its own size.
  const view = (await page.locator('.popup-layer').boundingBox())!;
  // (Once its opening animation has settled.)
  await expect.poll(async () => { const box = (await rules.boundingBox())!; return [box.x - view.x, box.y - view.y, box.width].map(Math.round); }).toEqual([84, 18, 260]);
  // Its amber count follows memory while it's open.
  await page.locator('[data-testid="table-piece"][aria-label="Gather amber"]').click();
  await expect(rules).toContainText('Amber gathered so far: 1');
  await button.click();
  await expect(rules).toHaveCount(0);
});

test('a popup scripts show only to some seats stays off other screens until it is theirs', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const archive = JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!);
    const project = archive.projects[0];
    const milestone = project.components.find((component: { name: string }) => component.name === 'Amber milestone');
    project.popups = [{ id: 'popup-test', componentId: milestone.id, row: 0, to: [project.players[0].id], data: { name: 'Only you', count: '9' } }];
    localStorage.setItem('tablecraft.workspace.v1', JSON.stringify(archive));
  });
  await page.reload();
  const popup = page.locator('.table-popup[aria-label="Amber milestone"]');
  await expect(popup).toContainText('Only you has gathered 9 amber.');
  // The × closes it for this seat.
  await popup.getByRole('button', { name: 'Close Amber milestone' }).click();
  await expect(popup).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).popups).toBeUndefined();
});
