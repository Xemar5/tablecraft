import { expect, test } from '@playwright/test';
import { savedWorkspace } from './savedWorkspace';

test('layers move forward, backward, to the front and back with Ctrl/Cmd+[ and ] or the layer buttons', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  // Root layers in paint order: the first is at the back, the last in front.
  const roots = async () => (await savedWorkspace(page)).projects[0].components[0].front.filter(node => node.parent === null).map(node => node.name);
  const start = await roots();
  const [name, second] = start;
  await page.locator('.layer-list').getByRole('button', { name, exact: true }).click();
  await page.keyboard.press('Control+BracketRight');
  await expect.poll(roots).toEqual([second, name, ...start.slice(2)]);
  await page.keyboard.press('Control+Shift+BracketRight');
  await expect.poll(roots).toEqual([...start.slice(1), name]);
  await page.getByRole('button', { name: 'Send backward', exact: true }).click();
  await expect.poll(async () => (await roots()).at(-2)).toBe(name);
  await page.keyboard.press('Control+Shift+BracketLeft');
  await expect.poll(roots).toEqual(start);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await roots()).at(-2)).toBe(name);
});
