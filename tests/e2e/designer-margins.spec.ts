import { expect, test } from '@playwright/test';

test('hug and fill sizing ignore X/Y, inset layers by margins and use letter axis icons', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Component designer', exact: true }).click();
  await page.locator('.layer-tree-row').nth(1).click();
  const x = page.getByRole('spinbutton', { name: 'X', exact: true }), y = page.getByRole('spinbutton', { name: 'Y', exact: true });
  await expect(x).toBeEnabled();
  await expect(page.locator('.transform-grid .axis-glyph')).toHaveText(['X', 'Y']);
  await expect(page.getByRole('spinbutton', { name: 'Margin left' })).toHaveCount(0);
  await expect(page.locator('.transform-box')).toBeVisible();

  await page.getByLabel('Width sizing').selectOption('fill');
  await expect(x).toBeDisabled();
  await expect(y).toBeEnabled();
  await page.getByRole('spinbutton', { name: 'Margin left' }).fill('20');
  await page.getByRole('spinbutton', { name: 'Margin right' }).fill('30');
  await page.getByRole('spinbutton', { name: 'Margin right' }).blur();
  // The selected layer is marked with a zoom-independent selection shadow.
  const layer = page.locator('.artboard .design-node[style*="box-shadow"]').first();
  const metrics = await layer.evaluate(element => {
    const node = element as HTMLElement, parent = node.offsetParent as HTMLElement;
    return { left: node.offsetLeft, right: parent.clientWidth - node.offsetLeft - node.offsetWidth };
  });
  expect(metrics).toEqual({ left: 20, right: 30 });

  await page.getByLabel('Height sizing').selectOption('hug');
  await expect(y).toBeDisabled();
  await page.getByRole('spinbutton', { name: 'Margin top' }).fill('12');
  await page.getByRole('spinbutton', { name: 'Margin top' }).blur();
  expect(await layer.evaluate(element => (element as HTMLElement).offsetTop)).toBe(12);
  await page.screenshot({ path: `${process.env.TEMP}/zz-margins.png` });
});
