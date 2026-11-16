import { expect, test, type Page } from '@playwright/test';
import { applyCommand, type Archive } from '../../src/domain';
import { starterProject } from '../../src/templates';

async function seedHand(page: Page, rotation = 0) {
  let project = starterProject();
  const deck = project.instances.find(i => i.stack)!;
  project = applyCommand(project, { type: 'drawMany', id: deck.id, count: 3, playerId: 'player-1' }, 'player-1');
  project.players[0] = { ...project.players[0], x: 1000, y: 600, rotation };
  project.players[1] = { ...project.players[1], x: 1300, y: 700, rotation: 0 };
  const source = project.instances.find(i => i.stack === deck.stack)!;
  Object.assign(source, { stack: null, x: 600, y: 450, rotation: 0 });
  project.instances = project.instances.filter(i => i.holder || i.id === source.id);
  const archive: Archive = { format: 'tablecraft', version: 1, projects: [project] };
  await page.addInitScript(({ archive, id }) => {
    localStorage.setItem('tablecraft.workspace.v1', JSON.stringify(archive));
    localStorage.setItem('tablecraft.last-project', id);
  }, { archive, id: project.id });
  await page.goto('/');
  return { source, held: project.instances.filter(i => i.holder === 'player-1').sort((a, b) => a.order - b.order).map(i => i.id) };
}

async function handOrder(page: Page) {
  return page.evaluate(() => {
    const archive: Archive = JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!);
    return archive.projects[0].instances.filter(i => i.holder === 'player-1').sort((a, b) => a.order - b.order).map(i => i.id);
  });
}

for (const [index, rotation] of [[0, 0], [1, 90], [3, 180]]) {
  test(`table hand previews and inserts at position ${index} with seat rotation ${rotation}`, async ({ page }) => {
    const { source, held } = await seedHand(page, rotation);
    const mini = page.locator('.seat-marker.active .other-hand');
    const cards = mini.locator('[data-mini-id]');
    const centers = await cards.evaluateAll(elements => elements.map(el => {
      const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }));
    const angle = rotation * Math.PI / 180;
    const point = index === 1 ? { x: (centers[0].x + centers[1].x) / 2, y: (centers[0].y + centers[1].y) / 2 }
      : { x: centers[index === 0 ? 0 : 2].x + (index === 0 ? -8 : 8) * Math.cos(angle), y: centers[index === 0 ? 0 : 2].y + (index === 0 ? -8 : 8) * Math.sin(angle) };
    const piece = page.locator(`[data-piece-id="${source.id}"]`);
    const box = (await piece.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(point.x, point.y, { steps: 10 });
    await expect(mini).toHaveClass(/hand-drop-target/);
    await expect(page.locator('.mini-drop-preview .component-thumbnail')).toHaveCSS('width', '44px');
    const ghostWidth = (await page.locator('.mini-drop-preview').boundingBox())!.width;
    expect(ghostWidth).toBeLessThan(box.width / 2);
    await expect(mini.locator(index === 3 ? '.mini-insert-end' : '.mini-insert-before')).toHaveCount(1);
    await page.mouse.up();
    const expected = [...held]; expected.splice(index, 0, source.id);
    await expect.poll(() => handOrder(page)).toEqual(expected);
    await expect(page.locator('.mini-drop-preview')).toHaveCount(0);
  });
}

test('own tray and mini hand reorder in place and hover indicates a grabbable card', async ({ page }) => {
  const { held } = await seedHand(page);
  const first = page.locator(`[data-mini-id="${held[0]}"]`);
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + 7, box.y + box.height / 2);
  await expect(first).toHaveCSS('outline-width', '3px');
  const last = page.locator(`[data-hand-id="${held[2]}"]`);
  const trayBox = (await last.boundingBox())!;
  await page.mouse.move(trayBox.x + trayBox.width / 2, trayBox.y + trayBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 8, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => handOrder(page)).toEqual([held[2], held[0], held[1]]);
  const miniSource = (await page.locator(`[data-mini-id="${held[2]}"]`).boundingBox())!;
  const miniEnd = (await page.locator(`[data-mini-id="${held[1]}"]`).boundingBox())!;
  await page.mouse.move(miniSource.x + 7, miniSource.y + miniSource.height / 2);
  await page.mouse.down();
  await page.mouse.move(miniEnd.x + miniEnd.width / 2 + 8, miniEnd.y + miniEnd.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => handOrder(page)).toEqual(held);
});

test('own mini hand accepts and releases cards with other-player access disabled', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: "Allow taking from other players' hands", exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: "Allow inserting into other players' hands", exact: true }).click();
  const stack = page.locator('.table-piece').filter({ has: page.locator('.stack-count') });
  await stack.dblclick();
  const id = await page.locator('.hand-card').first().getAttribute('data-hand-id');
  const ownSeat = page.locator('.seat-marker.active');
  const mini = ownSeat.locator('.other-hand > div').first();
  await expect(mini).toBeVisible();
  const viewport = (await page.locator('.table-viewport').boundingBox())!;
  const cardBox = (await mini.boundingBox())!;
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(viewport.x + viewport.width * .7, viewport.y + viewport.height * .45, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.hand-card')).toHaveCount(0);
  const piece = page.locator(`[data-piece-id="${id}"]`);
  await expect(piece).toBeVisible();
  const pieceBox = (await piece.boundingBox())!;
  const seatBox = (await ownSeat.boundingBox())!;
  await page.mouse.move(pieceBox.x + pieceBox.width / 2, pieceBox.y + pieceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(seatBox.x + seatBox.width / 2, seatBox.y + seatBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.hand-card')).toHaveCount(1);
  await expect(mini).toBeVisible();
  const otherSeat = page.locator('.seat-marker:not(.active)').first();
  const otherBox = (await otherSeat.boundingBox())!;
  const miniBox = (await mini.boundingBox())!;
  await page.mouse.move(miniBox.x + miniBox.width / 2, miniBox.y + miniBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(otherBox.x + otherBox.width / 2, otherBox.y + otherBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.hand-card')).toHaveCount(1);
  await expect(otherSeat.locator('.other-hand > div')).toHaveCount(0);
});
