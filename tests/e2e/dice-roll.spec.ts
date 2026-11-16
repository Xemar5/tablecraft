import { expect, test } from '@playwright/test';
import type { Archive } from '../../src/domain';

test('rolling a die tumbles it and cycles faces briefly, even when it lands on the same face', async ({ page }) => {
  await page.goto('/');
  const project = async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!)) as Archive).projects[0];
  const initial = await project();
  const die = initial.instances.find(i => initial.components.find(c => c.id === i.componentId)?.kind === 'dice')!;
  const piece = page.locator(`[data-piece-id="${die.id}"]`);
  await expect(piece).not.toHaveClass(/\brolling\b/);
  const settled = await piece.locator('.component-face').innerHTML();
  await page.evaluate(() => {
    const faces: string[] = [];
    const face = () => document.querySelector('.table-piece.rolling .component-face')?.innerHTML;
    (window as unknown as { faces: string[] }).faces = faces;
    new MutationObserver(() => { const html = face(); if (html && faces.at(-1) !== html) faces.push(html); }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await piece.hover();
  await page.keyboard.press('r');
  await expect(piece).toHaveClass(/\brolling\b/);
  await expect(piece.locator('.component-face')).toHaveCSS('animation-name', 'die-roll');
  await expect(piece).not.toHaveClass(/\brolling\b/, { timeout: 2000 });
  expect(await page.evaluate(() => new Set((window as unknown as { faces: string[] }).faces).size)).toBeGreaterThan(1);
  const rolled = (await project()).instances.find(i => i.id === die.id)!;
  expect(rolled.rolls).toBe(1);
  if (rolled.row === die.row) expect(await piece.locator('.component-face').innerHTML()).toBe(settled);

  await page.evaluate(() => { crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => { if (array instanceof Uint32Array) array.fill(0); return array; }; });
  for (let n = 0; n < 2; n++) {
    await page.keyboard.press('r');
    await expect(piece).toHaveClass(/\brolling\b/);
    await expect(piece).not.toHaveClass(/\brolling\b/, { timeout: 2000 });
  }
  expect((await project()).instances.find(i => i.id === die.id)?.rolls).toBe(3);
});

test('reduced motion skips the roll animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const piece = page.locator('.table-piece').filter({ has: page.locator('.component-dice') }).first();
  await piece.hover();
  await page.keyboard.press('r');
  await page.waitForTimeout(150);
  await expect(piece).not.toHaveClass(/\brolling\b/);
});
