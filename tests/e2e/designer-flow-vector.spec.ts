import { expect, test } from '@playwright/test';

test('flow-layout rotated paths retain layout while overflow and transformed pointer edits work', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const key = 'tablecraft.workspace.v1', archive = JSON.parse(localStorage.getItem(key)!);
    const card = archive.projects[0].components.find((item: { name: string }) => item.name === 'Spirit cards');
    const path = structuredClone(card.front.find((item: { type: string }) => item.type === 'shape'));
    const frame = structuredClone(path);
    Object.assign(frame, { id: 'test-frame', type: 'frame', fill: 'transparent', parent: null, name: 'Rotated flow', x: 60, y: 80, width: 120, height: 110, rotation: 20, layout: 'row', padding: 0, paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 });
    Object.assign(path, { id: 'test-path', parent: frame.id, name: 'Flow path', x: 0, y: 0, width: 70, height: 70, rotation: 35, widthMode: 'fill', heightMode: 'fixed', shapeKind: 'path', pathClosed: true, stroke: '#111111', strokeWidth: 6,
      points: [{ x: 35, y: 35, inX: 0, inY: 0, outX: -200, outY: 0 }, { x: 60, y: 10, inX: 0, inY: 0, outX: 0, outY: 0 }, { x: 35, y: 60, inX: 0, inY: 0, outX: 0, outY: 0 }] });
    card.front = [frame, path]; localStorage.setItem(key, JSON.stringify(archive));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await page.getByRole('button', { name: 'Flow path', exact: true }).click();
  // Anchors are drawn on a fixed-size overlay; the path's own SVG still maps its points to the screen.
  const editor = page.locator('.artboard .path-overlay'), anchor = editor.locator('.vector-anchor').first();
  const shape = page.locator('.artboard [data-node-id="test-path"] > svg.vector-shape');
  const box = (await anchor.boundingBox())!;
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 200), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(hit).toContain('vector-anchor');
  const initial = await shape.evaluate((svg: SVGSVGElement) => {
    const matrix = svg.getScreenCTM()!.inverse();
    return { a: matrix.a, b: matrix.b, viewBox: svg.getAttribute('viewBox') };
  });
  expect(Number(initial.viewBox!.split(' ')[0])).toBeLessThan(0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
  await expect.poll(async () => Number(await page.getByLabel('X', { exact: true }).last().inputValue())).toBeCloseTo(35 + initial.a * 20, 0);
  await expect.poll(async () => Number(await page.getByLabel('Y', { exact: true }).last().inputValue())).toBeCloseTo(35 + initial.b * 20, 0);
  await page.keyboard.press('Delete');
  await expect(editor.locator('.vector-anchor')).toHaveCount(3);
  await expect(page.getByText('A closed path needs at least 3 points.')).toBeVisible();
  await page.getByLabel('X', { exact: true }).last().focus();
  await page.keyboard.press('Delete');
  await expect(editor.locator('.vector-anchor')).toHaveCount(3);
});
