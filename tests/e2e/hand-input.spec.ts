import { expect, test } from '@playwright/test';

test('hand-entry face toggle controls repeated keyboard draws', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Turn cards face up when entering my hand', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const stack = page.locator('.table-piece').filter({ has: page.locator('.stack-count') });
  await stack.hover();
  await page.keyboard.press('1');
  const faces = () => page.evaluate(() => {
    const archive = JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!);
    return archive.projects[0].instances.filter((i: { holder: string | null }) => i.holder === 'player-1')
      .sort((a: { order: number }, b: { order: number }) => a.order - b.order).map((i: { flipped: boolean }) => i.flipped);
  });
  await expect.poll(faces).toEqual([false]);
  await toggle.click();
  await stack.hover();
  await page.keyboard.press('1');
  await expect.poll(faces).toEqual([false, true]);
});

test('first-focus selection waits for release and numeric dragging does not select text', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await expect(name).toBeVisible();
  const box = (await name.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  expect(await name.evaluate((input: HTMLInputElement) => input.selectionEnd! - input.selectionStart!)).toBeLessThan((await name.inputValue()).length);
  await page.mouse.up();
  await expect.poll(() => name.evaluate((input: HTMLInputElement) => input.selectionEnd! - input.selectionStart!)).toBe((await name.inputValue()).length);
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  const before = Number(await x.inputValue()), pos = (await x.boundingBox())!;
  await page.mouse.move(pos.x + 15, pos.y + pos.height / 2);
  await page.mouse.down();
  await page.mouse.move(pos.x + 15, pos.y + pos.height / 2 - 20, { steps: 5 });
  await page.mouse.up();
  await expect(x).toHaveValue(String(before + 5));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('2');
  await expect(x).not.toHaveValue('2');
});
