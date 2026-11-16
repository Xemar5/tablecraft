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
  project.settings.snap = false;
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

test('wheel zoom follows the cursor inward and the table center outward', async ({ page }) => {
  const { source } = await seedHand(page);
  const piece = page.locator(`[data-piece-id="${source.id}"]`);
  const box = (await piece.boundingBox())!;
  const x = box.x + box.width * .7, y = box.y + box.height * .3;
  const table = (await page.locator('.table-viewport').boundingBox())!;
  const center = { x: table.x + table.width / 2, y: table.y + table.height / 2 };
  await page.mouse.move(x, y);
  for (const delta of [-200, -200, 200, 200]) {
    const previous = (await piece.boundingBox())!;
    const anchor = delta < 0 ? { x, y } : center;
    const relative = { x: (anchor.x - previous.x) / previous.width, y: (anchor.y - previous.y) / previous.height };
    const before = await page.getByRole('button', { name: 'Fit table', exact: true }).innerText();
    await page.mouse.wheel(0, delta);
    await expect(page.getByRole('button', { name: 'Fit table', exact: true })).not.toHaveText(before);
    await expect.poll(async () => {
      const bounds = (await piece.boundingBox())!;
      return Math.hypot(bounds.x + bounds.width * relative.x - anchor.x, bounds.y + bounds.height * relative.y - anchor.y);
    }).toBeLessThan(1);
  }
});

for (const rotated of [false, true]) {
test(`zooming during a tabletop drag preserves the cursor anchor through movement and drop (rotated ${rotated})`, async ({ page }) => {
  const { source } = await seedHand(page);
  if (rotated) await page.getByRole('button', { name: 'Rotate camera right', exact: true }).click();
  const piece = page.locator(`[data-piece-id="${source.id}"]`);
  const box = (await piece.boundingBox())!;
  let x = box.x + box.width * .7 + 40, y = box.y + box.height * .3 + 20;
  await page.mouse.move(box.x + box.width * .7, box.y + box.height * .3);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 5 });
  const ghost = page.locator('.board-drag-preview');
  const table = (await page.locator('.table-viewport').boundingBox())!;
  const center = { x: table.x + table.width / 2, y: table.y + table.height / 2 };
  const badge = page.locator('.seat-marker.active .seat-badge');
  for (const delta of [-200, -200, 200, 200, -200, 200]) {
    const previousBadge = (await badge.boundingBox())!;
    const anchor = delta < 0 ? { x, y } : center;
    const relative = { x: (anchor.x - previousBadge.x) / previousBadge.width, y: (anchor.y - previousBadge.y) / previousBadge.height };
    const before = await page.getByRole('button', { name: 'Fit table', exact: true }).innerText();
    await page.mouse.wheel(0, delta);
    await expect(page.getByRole('button', { name: 'Fit table', exact: true })).not.toHaveText(before);
    const bounds = (await ghost.boundingBox())!;
    expect(Math.abs(bounds.x + bounds.width * .7 - x)).toBeLessThan(1);
    expect(Math.abs(bounds.y + bounds.height * .3 - y)).toBeLessThan(1);
    const nextBadge = (await badge.boundingBox())!;
    expect(Math.hypot(nextBadge.x + nextBadge.width * relative.x - anchor.x, nextBadge.y + nextBadge.height * relative.y - anchor.y)).toBeLessThan(1);
    x += 8; y += 6;
    await page.mouse.move(x, y);
  }
  await page.mouse.up();
  await expect(ghost).toHaveCount(0);
  await expect.poll(async () => {
    const bounds = (await piece.boundingBox())!;
    return Math.hypot(bounds.x + bounds.width * .7 - x, bounds.y + bounds.height * .3 - y);
  }).toBeLessThan(1);
});
}

test('mini-hand source stays faded outside all hands until the drag ends', async ({ page }) => {
  const { held } = await seedHand(page);
  const card = page.locator(`[data-mini-id="${held[0]}"]`);
  const box = (await card.boundingBox())!;
  const table = (await page.locator('.table-viewport').boundingBox())!;
  await page.mouse.move(box.x + 7, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(table.x + 50, table.y + 60, { steps: 8 });
  await expect(page.locator('.hand-drop-target')).toHaveCount(0);
  await expect(card).toHaveCSS('opacity', '0.25');
  await page.mouse.move(10, 10, { steps: 5 });
  await expect(card).toHaveCSS('opacity', '0.25');
  await page.mouse.up();
  await expect(card).toHaveCSS('opacity', '1');
});

for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
  test(`table hand accepts drops 20px beyond its ${edge} edge`, async ({ page }) => {
    const { source, held } = await seedHand(page);
    const mini = page.locator('.seat-marker.active .other-hand');
    const bounds = await mini.evaluate(element => {
      const rects = [element, ...element.querySelectorAll('[data-mini-id]')].map(el => el.getBoundingClientRect());
      return { left: Math.min(...rects.map(r => r.left)), right: Math.max(...rects.map(r => r.right)),
        top: Math.min(...rects.map(r => r.top)), bottom: Math.max(...rects.map(r => r.bottom)) };
    });
    const x = edge === 'left' ? bounds.left - 20 : edge === 'right' ? bounds.right + 20 : (bounds.left + bounds.right) / 2;
    const y = edge === 'top' ? bounds.top - 20 : edge === 'bottom' ? bounds.bottom + 20 : (bounds.top + bounds.bottom) / 2;
    const box = (await page.locator(`[data-piece-id="${source.id}"]`).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 10 });
    await expect(mini).toHaveClass(/hand-drop-target/);
    await expect(mini).toHaveCSS('z-index', '0');
    await expect(page.locator('.seat-marker.active .seat-badge')).toHaveCSS('z-index', '1');
    await page.mouse.up();
    await expect.poll(async () => (await handOrder(page)).length).toBe(held.length + 1);
  });
}

for (const origin of ['table', 'tray', 'mini'] as const) {
  test(`Alt bypasses table hands when dragging from ${origin}`, async ({ page }) => {
    const { source, held } = await seedHand(page);
    const locator = origin === 'table' ? page.locator(`[data-piece-id="${source.id}"]`)
      : origin === 'tray' ? page.locator(`[data-hand-id="${held[0]}"]`) : page.locator(`[data-mini-id="${held[0]}"]`);
    const box = (await locator.boundingBox())!;
    const seat = (await page.locator('.seat-marker.active').boundingBox())!;
    await page.mouse.move(box.x + (origin === 'mini' ? 7 : box.width / 2), box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(seat.x + seat.width / 2, seat.y + seat.height / 2, { steps: 10 });
    await expect(page.locator('.mini-drop-preview')).toHaveCount(1);
    await expect(page.locator('.hover-preview')).toBeVisible();
    await expect(page.locator('.hand-drop-hint')).toContainText('Hold Alt to place on table instead');
    await page.keyboard.down('Alt');
    await expect(page.locator('.mini-drop-preview')).toHaveCount(0);
    await expect(page.locator('.hand-drop-hint')).toHaveCount(0);
    await page.mouse.move(seat.x + seat.width / 2 + 1, seat.y + seat.height / 2);
    await expect(page.locator('.hand-drop-target')).toHaveCount(0);
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await expect.poll(async () => (await handOrder(page)).length).toBe(origin === 'table' ? 3 : 2);
    await expect(page.locator(`[data-piece-id="${origin === 'table' ? source.id : held[0]}"]`)).toBeVisible();
  });
}

for (const [index, rotation] of [[0, 0], [1, 90], [3, 0], [3, 90], [3, 180]]) {
  test(`table hand previews and inserts at position ${index} with seat rotation ${rotation}`, async ({ page }) => {
    const { source, held } = await seedHand(page, rotation);
    const mini = page.locator('.seat-marker.active .other-hand');
    const handBounds = (await mini.boundingBox())!;
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
    await expect(page.locator('.hover-preview')).toBeVisible();
    await expect(page.locator('.hand-drop-hint')).toContainText(`Position ${index + 1}`);
    const zoomLabel = await page.getByRole('button', { name: 'Fit table', exact: true }).innerText();
    const zoom = Number(zoomLabel.replace('%', '')) / 100;
    const offset = await mini.evaluate(element => parseFloat(getComputedStyle(element).outlineOffset));
    expect(offset * zoom).toBeGreaterThan(19);
    expect(offset * zoom).toBeLessThan(28);
    await expect(page.locator('.mini-drop-preview .component-thumbnail')).toHaveCSS('width', '44px');
    const ghostWidth = (await page.locator('.mini-drop-preview').boundingBox())!.width;
    expect(ghostWidth).toBeLessThan(box.width / 2);
    await expect(mini.locator(index === 3 ? '.mini-insert-end' : '.mini-insert-before')).toHaveCount(1);
    if (index === 3) {
      const marker = mini.locator('.mini-insert-end');
      const geometry = await marker.evaluate(element => {
        const card = element.parentElement!;
        return { parentId: card.dataset.miniId, left: (element as HTMLElement).offsetLeft,
          width: card.offsetWidth, rotation: new DOMMatrix(getComputedStyle(card).transform).b };
      });
      expect(geometry.parentId).toBe(held.at(-1));
      expect(geometry.left).toBe(geometry.width);
      expect(geometry.rotation).toBeCloseTo(Math.sin(5 * Math.PI / 180), 5);
    }
    const targetBounds = (await mini.boundingBox())!;
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(targetBounds[key]).toBeCloseTo(handBounds[key], 2);
    }
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
  await expect(page.getByRole('button', { name: 'Allow others to take from my hand', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-seat-id="player-2"]').click();
  await page.getByRole('button', { name: 'Switch to this seat', exact: true }).click();
  await page.getByRole('button', { name: "I'm Player 2. Let's play.", exact: false }).click();
  await page.getByRole('button', { name: 'Allow others to insert into my hand', exact: true }).click();
  await page.locator('[data-seat-id="player-1"]').click();
  await page.getByRole('button', { name: 'Switch to this seat', exact: true }).click();
  await page.getByRole('button', { name: "I'm Player 1. Let's play.", exact: false }).click();
  await expect(page.getByRole('button', { name: 'Allow others to insert into my hand', exact: true })).toHaveAttribute('aria-pressed', 'true');
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
