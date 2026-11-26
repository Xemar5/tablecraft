import { expect, test } from '@playwright/test';

test('X/Y, sizes and margins enable by sizing and parent layout, like auto layout in design tools', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Component designer', exact: true }).click();
  await page.getByRole('button', { name: 'Card name', exact: true }).click();
  const field = (name: string) => page.getByRole('spinbutton', { name, exact: true });
  const sizing = (axis: 'Width' | 'Height', name: string) => page.getByRole('radiogroup', { name: `${axis} sizing`, exact: true }).getByRole('radio', { name, exact: true });
  const [x, y, width, height] = ['X', 'Y', 'Width', 'Height'].map(field);
  await expect(page.locator('.transform-grid .axis-glyph')).toHaveText(['X', 'Y']);
  for (const input of [x, y, width, height]) await expect(input).toBeEnabled();
  await expect(field('Margin left')).toHaveCount(0);
  await expect(page.locator('.transform-box')).toBeVisible();
  // The selected layer is marked with a zoom-independent selection shadow.
  const layer = page.locator('.artboard .design-node[style*="box-shadow"]').first();
  const box = () => layer.evaluate(element => {
    const node = element as HTMLElement, parent = node.offsetParent as HTMLElement;
    return { left: node.offsetLeft, top: node.offsetTop, right: parent.clientWidth - node.offsetLeft - node.offsetWidth, height: node.offsetHeight };
  });

  // Fill in an absolute parent: X and Width give way to the left and right margins.
  await sizing('Width', 'Fill parent').click();
  await expect(sizing('Width', 'Fill parent')).toHaveAttribute('aria-checked', 'true');
  await expect(x).toBeDisabled();
  await expect(width).toBeDisabled();
  await expect(y).toBeEnabled();
  await expect(field('Margin top')).toBeDisabled();
  await field('Margin left').fill('20');
  await field('Margin right').fill('30');
  await field('Margin right').blur();
  await expect.poll(async () => { const { left, right } = await box(); return { left, right }; }).toEqual({ left: 20, right: 30 });
  // The disabled Width shows the measured width.
  await expect(width).toHaveValue(String((await layer.evaluate(element => (element as HTMLElement).offsetWidth))));

  // Hug keeps its Y: only the height comes from the text.
  const top = (await box()).top;
  await sizing('Height', 'Hug contents').click();
  await expect(y).toBeEnabled();
  await expect(height).toBeDisabled();
  expect((await box()).top).toBe(top);
  const hugged = (await box()).height;
  await expect(height).toHaveValue(String(hugged));
  // Back to Fixed, the layer keeps the size it had.
  await sizing('Height', 'Fixed').click();
  await expect(height).toBeEnabled();
  await expect(height).toHaveValue(String(hugged));

  // A shape has no contents to hug: Hug is grayed out, its tooltip says why, and choosing it does nothing.
  await page.getByRole('button', { name: 'Card border', exact: true }).click();
  const hug = sizing('Width', 'Hug contents');
  await expect(hug).toHaveAttribute('aria-disabled', 'true');
  await expect(hug).toHaveAttribute('title', /isn’t available: Only text and stack frames have contents to hug/);
  expect(Number(await hug.evaluate(element => getComputedStyle(element).opacity))).toBeLessThan(.5);
  await hug.click({ force: true });
  await expect(sizing('Width', 'Fixed')).toHaveAttribute('aria-checked', 'true');
  await expect(sizing('Width', 'Fill parent')).not.toHaveAttribute('aria-disabled', 'true');
});
