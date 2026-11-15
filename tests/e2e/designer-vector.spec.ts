import { expect, test } from '@playwright/test';

test('designer menus, curve editing, point deletion and undo work with real pointers', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await expect(page.getByLabel('Preview data row')).toHaveCount(0);
  const chooser = page.getByRole('button', { name: 'Add shape', exact: true });
  await chooser.click();
  const menu = page.getByRole('menu');
  const buttonBox = (await chooser.boundingBox())!, menuBox = (await menu.boundingBox())!;
  expect(menuBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height - 1);
  await menu.getByRole('menuitem', { name: 'Pen path' }).click();
  const editor = page.locator('.vector-point-editor');
  const anchors = editor.locator('.vector-anchor');
  await expect(anchors).toHaveCount(4);
  await anchors.first().dblclick();
  await expect(editor.locator('.vector-handle')).toHaveCount(2);
  await expect(anchors.first()).toHaveClass(/selected/);
  const handle = editor.locator('.vector-handle').last();
  const handleBox = (await handle.boundingBox())!;
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.keyboard.down('Shift'); await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 25, handleBox.y + handleBox.height / 2 + 15, { steps: 4 });
  await page.mouse.up(); await page.keyboard.up('Shift');
  await expect.poll(async () => Number(await page.getByLabel('In handle X').inputValue()) +
    Number(await page.getByLabel('Out handle X').inputValue())).toBeCloseTo(0, 2);
  const segment = editor.locator('.vector-segment').nth(1);
  const segmentPoint = await segment.evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(path.getTotalLength() * .5).matrixTransform(path.getScreenCTM()!);
    return { x: point.x, y: point.y };
  });

  await page.mouse.click(segmentPoint.x, segmentPoint.y);
  await expect(anchors).toHaveCount(5);
  await expect(anchors.nth(2)).toHaveClass(/selected/);
  await page.keyboard.press('Delete');
  await expect(anchors).toHaveCount(4);
  await page.keyboard.press('Control+z');
  await expect(anchors).toHaveCount(5);
  await anchors.nth(2).click({ modifiers: ['Alt'] });
  await expect(anchors).toHaveCount(4);
  await page.getByRole('button', { name: /Data bindings/ }).click();
  await expect(page.getByRole('dialog').getByLabel('Preview row')).toBeVisible();
});
