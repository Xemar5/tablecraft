import { expect, test, type Page } from '@playwright/test';
import type { Player } from '../../src/domain';

const seat = (page: Page, id: string) => page.evaluate(id => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!).projects[0].players.find((p: Player) => p.id === id) as Player, id);

test('clicking a seat selects it and edits its settings in the inspector as single undo steps', async ({ page }) => {
  await page.goto('/');
  const original = await seat(page, 'player-2');
  await page.locator('[data-seat-id="player-2"]').click();
  await expect(page.locator('[data-seat-id="player-2"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Seat selected', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: "I'm Player 2. Let's play.", exact: false })).toHaveCount(0);
  await expect(page.locator('.seat-marker.active')).toHaveAttribute('data-seat-id', 'player-1');
  await expect(page.locator('[data-seat-id="player-1"] .seat-badge strong')).toHaveText('Player 1');
  await expect(page.locator('[data-seat-id="player-1"] .you-tag')).toHaveText('You');
  await expect(page.locator('[data-seat-id="player-2"] .you-tag')).toHaveCount(0);
  await expect(page.locator('.seat-inspector .you-tag')).toHaveCount(0);
  const otherActions = page.getByRole('toolbar', { name: "Player 2's hand actions", exact: true });
  const inactiveTop = (await otherActions.boundingBox())!.y;
  await page.locator('[data-seat-id="player-1"]').click();
  expect((await page.getByRole('toolbar', { name: "Player 1's hand actions", exact: true }).boundingBox())!.y).toBeCloseTo(inactiveTop, 0);
  await expect(page.locator('.hand-toolbar').getByRole('button', { name: 'Allow others to insert into my hand', exact: true })).toBeVisible();
  await page.locator('[data-seat-id="player-2"]').click();
  for (const name of ["Turn cards face up when entering Player 2's hand", "Hide Player 2's table hand", "Shuffle Player 2's hand", "Reverse Player 2's hand", "Allow others to insert into Player 2's hand", "Allow others to take from Player 2's hand", "Unlock Player 2's table hand"])
    await expect(otherActions.getByRole('button', { name, exact: true })).toBeDisabled();
  await expect(otherActions.getByRole('button', { name: 'Switch to this seat', exact: true })).toBeEnabled();

  const name = page.getByLabel('Player name', { exact: true });
  await name.fill('Ada');
  await expect.poll(async () => (await seat(page, 'player-2')).name).toBe(original.name);
  await name.press('Enter');
  await expect.poll(async () => (await seat(page, 'player-2')).name).toBe('Ada');

  const alpha = page.getByLabel('Player color alpha', { exact: true });
  const box = (await alpha.boundingBox())!;
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .7, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width * .5, box.y + box.height / 2, { steps: 4 });
  await expect.poll(async () => (await seat(page, 'player-2')).color).toBe(original.color);
  await page.mouse.up();
  await expect.poll(async () => (await seat(page, 'player-2')).color).not.toBe(original.color);

  const x = page.getByLabel('Seat X', { exact: true });
  await x.fill('321');
  await x.press('Enter');
  await expect.poll(async () => (await seat(page, 'player-2')).x).toBe(321);

  const undo = page.getByRole('button', { name: 'Undo playground action', exact: true });
  await undo.click();
  await expect.poll(async () => (await seat(page, 'player-2')).x).toBe(original.x);
  await undo.click();
  await expect.poll(async () => seat(page, 'player-2')).toMatchObject({ name: 'Ada', color: original.color });
  await undo.click();
  await expect.poll(async () => (await seat(page, 'player-2')).name).toBe(original.name);

  await page.getByRole('button', { name: 'Switch to this seat', exact: true }).click();
  await expect(page.getByRole('button', { name: "I'm Player 2. Let's play.", exact: false })).toBeVisible();
  await page.getByRole('button', { name: "I'm Player 2. Let's play.", exact: false }).click();
  await expect(page.locator('.seat-marker.active')).toHaveAttribute('data-seat-id', 'player-2');
  await expect(page.locator('[data-seat-id="player-2"] .you-tag')).toBeVisible();
  await expect(page.locator('[data-seat-id="player-1"] .you-tag')).toHaveCount(0);
  await expect(page.locator('.seat-inspector .you-tag')).toBeVisible();

  const seatActions = page.getByRole('toolbar', { name: "Player 2's hand actions", exact: true });
  await expect(seatActions.getByRole('button', { name: 'Switch to this seat', exact: true })).toBeDisabled();
  const insert = seatActions.getByRole('button', { name: "Allow others to insert into Player 2's hand", exact: true });
  await expect(insert).toBeEnabled();
  await insert.click();
  await expect(insert).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Allow others to insert into my hand', exact: true })).toHaveAttribute('aria-pressed', 'false');
  for (const [label, key] of [["Turn cards face up when entering Player 2's hand", 'handFaceUp'], ["Hide Player 2's table hand", 'tableHandHidden'], ["Unlock Player 2's table hand", 'tableHandUnlocked']] as const) {
    const toggle = seatActions.getByRole('button', { name: label, exact: true });
    const before = await toggle.getAttribute('aria-pressed');
    await toggle.click();
    await expect.poll(async () => (await seat(page, 'player-2'))[key]).toBe(before !== 'true');
    expect((await seat(page, 'player-1'))[key]).toBeUndefined();
  }
  await expect(page.locator('.hand-toolbar').getByRole('button', { name: 'Turn cards face up when entering my hand', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.hand-toolbar').getByRole('button', { name: 'Show my table hand', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.hand-toolbar').getByRole('button', { name: 'Lock my table hand', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-seat-id="player-2"]')).toHaveAttribute('title', "Drag Player 2's seat");
  await expect(page.locator('[data-seat-id="player-1"]')).toHaveAttribute('title', "Select Player 1's seat");

  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Seat selected', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-seat-id="player-2"]')).toHaveAttribute('aria-pressed', 'false');
});
