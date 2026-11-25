import { expect, test, type Page } from '@playwright/test';
import { applyCommand, makeNode, type Archive, type Project } from '../../src/domain';
import { starterProject } from '../../src/templates';

async function seed(page: Page, project: Project) {
  const archive: Archive = { format: 'tablecraft', version: 1, projects: [project] };
  await page.addInitScript(({ archive, id }) => {
    localStorage.setItem('tablecraft.workspace.v1', JSON.stringify(archive));
    localStorage.setItem('tablecraft.last-project', id);
  }, { archive, id: project.id });
  await page.goto('/');
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!).projects[0] as Project);

test('fullscreen preview is local, starts at 100%, zooms, rotates, flips and closes without leaking shortcuts', async ({ page }) => {
  await page.goto('/');
  const stack = page.locator('.table-piece').filter({ has: page.locator('.stack-count') }).first();
  await stack.hover();
  const id = await stack.getAttribute('data-piece-id');
  const initialRotation = (await saved(page)).instances.find(i => i.id === id)!.rotation;
  // Give App a real undo entry so Ctrl+Z leakage cannot pass unnoticed.
  await page.keyboard.press('e');
  await expect.poll(async () => (await saved(page)).instances.find(i => i.id === id)!.rotation).toBe((initialRotation + 90) % 360);
  const before = await saved(page);
  await page.keyboard.press('z');
  const dialog = page.getByRole('dialog', { name: /^Fullscreen preview:/ });
  const art = dialog.locator('.piece-preview-art');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('100%');
  const back = await art.getAttribute('data-back');
  await page.keyboard.press('f');
  await expect(art).toHaveAttribute('data-back', back === 'true' ? 'false' : 'true');
  await page.keyboard.press('e');
  await expect(art).toHaveAttribute('data-rotation', '90');
  await page.keyboard.press('q');
  await expect(art).toHaveAttribute('data-rotation', '0');
  await page.mouse.wheel(0, -100);
  await expect(dialog).toContainText('110%');
  for (let n = 0; n < 24; n++) await page.mouse.wheel(0, -100);
  await expect(dialog).toContainText('800%');
  await page.mouse.move(150, 200);
  const leftPan = await art.evaluate(el => getComputedStyle(el).transform);
  await page.mouse.move(1200, 800);
  await expect.poll(() => art.evaluate(el => getComputedStyle(el).transform)).not.toBe(leftPan);
  for (const key of ['Delete', 'r', 'g', '1', 'l', 'Control+d', 'Control+z']) await page.keyboard.press(key);
  expect(await saved(page)).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // The next preview opens at the zoom this one was left at.
  await stack.hover();
  await page.keyboard.press('z');
  await expect(dialog).toContainText('800%');
  await page.keyboard.press('z');
  await expect(dialog).toHaveCount(0);
  await stack.hover();
  await page.keyboard.press('z');
  await dialog.click({ position: { x: 10, y: 10 } });
  await expect(dialog).toHaveCount(0);
});

test('fullscreen preview keeps following the pointer while zooming, rotating and moving', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const stack = page.locator('.table-piece').filter({ has: page.locator('.stack-count') }).first();
  await stack.hover();
  await page.keyboard.press('z');
  const dialog = page.getByRole('dialog', { name: /^Fullscreen preview:/ });
  const art = dialog.locator('.piece-preview-art');
  const box = async () => (await art.boundingBox())!;
  const bars = async () => ({ top: (await dialog.locator('.piece-preview-title').boundingBox())!, help: (await dialog.locator('.piece-preview-help').boundingBox())! });
  // Zoom in without moving the pointer afterwards: the view must already be aimed at the pointer's edge.
  await page.mouse.move(640, 2);
  for (let n = 0; n < 15; n++) await page.mouse.wheel(0, -100);
  await expect(dialog).toContainText('418%');
  const { top, help } = await bars();
  await expect.poll(async () => Math.round((await box()).y - (top.y + top.height))).toBe(24);
  await page.mouse.move(640, 798);
  await expect.poll(async () => Math.round(help.y - ((await box()).y + (await box()).height))).toBe(24);
  // Rotating swaps the sides; the pointer at the bottom-right corner still shows that corner of the turned piece.
  await page.mouse.move(1278, 798);
  await page.keyboard.press('e');
  await expect(art).toHaveAttribute('data-rotation', '90');
  await expect.poll(async () => { const b = await box(); return [Math.round(1280 - (b.x + b.width)), Math.round(help.y - (b.y + b.height))]; }).toEqual([24, 24]);
  await page.mouse.move(2, 400);
  await expect.poll(async () => Math.round((await box()).x)).toBe(24);
  // Zoomed back out to 100%, the next preview (which opens at the last zoom) fits.
  for (let n = 0; n < 15; n++) await page.mouse.wheel(0, 100);
  await page.keyboard.press('Escape');

  // A piece that fits stays centred in the space between the bars, wherever the pointer is.
  await stack.hover();
  await page.keyboard.press('z');
  await expect(dialog).not.toContainText('418%');
  const fitting = await box(), bands = await bars();
  expect(Math.round(fitting.x + fitting.width / 2)).toBe(640);
  expect(Math.abs((fitting.y + fitting.height / 2) - (bands.top.y + bands.top.height + bands.help.y) / 2)).toBeLessThan(1);
});

test('Z works for main hands and private table hands without exposing a hidden front', async ({ page }) => {
  let project = starterProject();
  const deck = project.instances.find(i => i.stack)!;
  project = applyCommand(project, { type: 'drawMany', id: deck.id, count: 1, playerId: 'player-1' }, 'player-1');
  project = applyCommand(project, { type: 'drawMany', id: deck.id, count: 1, playerId: 'player-2' }, 'player-2');
  const own = project.instances.find(i => i.holder === 'player-1')!;
  const other = project.instances.find(i => i.holder === 'player-2')!;
  project.instances = project.instances.filter(i => i.holder);
  project.components = project.components.map(c => c.id === other.componentId ? { ...c, hideInHand: true } : c);
  project.players = project.players.map((player, index) => ({ ...player, x: index ? 1000 : 650, y: 500, rotation: 0 }));
  await seed(page, project);
  await page.locator(`[data-hand-id="${own.id}"]`).hover();
  await page.keyboard.press('z');
  const dialog = page.getByRole('dialog', { name: /^Fullscreen preview:/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('F · Flip');
  await page.keyboard.press('Escape');
  await page.locator(`[data-mini-id="${other.id}"]`).hover();
  const before = await saved(page);
  await page.keyboard.press('z');
  await expect(dialog).toContainText('Back only');
  await expect(dialog.locator('.piece-preview-art')).toHaveAttribute('data-back', 'true');
  await page.keyboard.press('f');
  await expect(dialog.locator('.piece-preview-art')).toHaveAttribute('data-back', 'true');
  expect(await saved(page)).toEqual(before);
});

test('open preview immediately enforces changed actor, viewer and hand visibility permissions', async ({ page }) => {
  const project = starterProject();
  const component = {
    ...project.components.find(c => c.kind === 'card')!, flippable: true, hideInHand: true,
    front: [makeNode('text', { text: 'Private front sentinel' })],
    back: [makeNode('text', { text: 'Public back sentinel' })],
  };
  const item = { ...project.instances.find(i => i.componentId === component.id)!, holder: 'player-1', stack: null, flipped: true };
  await page.goto('/');
  // Mount the production viewer directly so props can change as a live room update would,
  // without adding a product-only test API or needing a database.
  await page.evaluate(async ({ item, component, components }) => {
    const reactPath = '/node_modules/.vite/deps/react.js';
    const domPath = '/node_modules/.vite/deps/react-dom_client.js';
    const previewPath = '/src/PiecePreview.tsx';
    const [{ default: React }, { default: ReactDOM }, { PiecePreview }] = await Promise.all([import(reactPath), import(domPath), import(previewPath)]);
    const element = document.createElement('div');
    document.body.append(element);
    const root = ReactDOM.createRoot(element);
    const props = { item, component, components, actor: 'player-1', viewer: false, onClose: () => root.unmount() };
    const update = (patch: { actor?: string; viewer?: boolean; hideInHand?: boolean; flipped?: boolean }) => {
      if (patch.actor !== undefined) props.actor = patch.actor;
      if (patch.viewer !== undefined) props.viewer = patch.viewer;
      if (patch.hideInHand !== undefined) props.component = { ...props.component, hideInHand: patch.hideInHand };
      if (patch.flipped !== undefined) props.item = { ...props.item, flipped: patch.flipped };
      root.render(React.createElement(PiecePreview, { ...props }));
    };
    (window as unknown as { updatePreview: typeof update }).updatePreview = update;
    update({});
  }, { item, component, components: [...project.components.filter(c => c.id !== component.id), component] });
  const dialog = page.getByRole('dialog', { name: /^Fullscreen preview:/ });
  await expect(dialog.getByText('Public back sentinel')).toBeVisible();
  await page.keyboard.press('f');
  await expect(dialog.getByText('Private front sentinel')).toBeVisible();
  const update = async (patch: { actor?: string; viewer?: boolean; hideInHand?: boolean; flipped?: boolean }) => {
    await page.evaluate(patch => (window as unknown as { updatePreview: (patch: object) => void }).updatePreview(patch), patch);
  };
  await update({ actor: 'player-2' });
  await expect(dialog.getByText('Private front sentinel')).toHaveCount(0);
  await expect(dialog.getByText('Public back sentinel')).toBeVisible();
  await page.keyboard.press('f');
  await expect(dialog.getByText('Private front sentinel')).toHaveCount(0);
  await update({ actor: '', viewer: true, hideInHand: false });
  await expect(dialog).toContainText('Back only');
  await page.keyboard.press('f');
  await expect(dialog.getByText('Private front sentinel')).toHaveCount(0);
  await update({ flipped: false });
  await expect(dialog).toContainText('F · Flip');
  await page.keyboard.press('f');
  await expect(dialog.getByText('Private front sentinel')).toBeVisible();
  await update({ hideInHand: true });
  await expect(dialog.getByText('Private front sentinel')).toHaveCount(0);
  await expect(dialog.getByText('Public back sentinel')).toBeVisible();
});

test('selection fallback works and typing/dialog keys do not open preview', async ({ page }) => {
  await page.goto('/');
  const token = page.locator('.table-piece').filter({ has: page.locator('.component-token') }).first();
  await token.click();
  await page.getByRole('button', { name: 'Select and move', exact: true }).hover();
  await page.keyboard.press('z');
  const preview = page.getByRole('dialog', { name: /^Fullscreen preview:/ });
  await expect(preview).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('[data-seat-id="player-1"]').click();
  const name = page.locator('.seat-inspector').getByRole('textbox').first();
  await name.fill('z');
  await expect(preview).toHaveCount(0);
});

test('empty seatless tables have no overlay or active hand controls', async ({ page }) => {
  const project = starterProject();
  project.players = [];
  project.instances = [];
  await seed(page, project);
  await expect(page.locator('.table-viewport')).toBeVisible();
  await expect(page.locator('.empty-table,.table-hint,.hand-tray,.hand-toolbar')).toHaveCount(0);
  await page.keyboard.press('z');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('multi-drag snaps each unit separately while preserving stacks', async ({ page }) => {
  const project = starterProject();
  const component = project.components.find(c => c.kind === 'card')!;
  const base = project.instances.find(i => i.componentId === component.id)!;
  project.players = project.players.map((player, index) => ({ ...player, x: index ? 1500 : 300, y: 100, rotation: 0 }));
  project.instances = [
    { ...base, id: 'snap-a', x: 701, y: 412, stack: null, rotation: 0, holder: null, locked: false },
    { ...base, id: 'snap-b', x: 914, y: 523, stack: 'snap-stack', order: 0, rotation: 0, holder: null, locked: false },
    { ...base, id: 'snap-c', x: 914, y: 523, stack: 'snap-stack', order: 1, rotation: 0, holder: null, locked: false },
  ];
  project.settings.snap = true;
  project.settings.gridSize = 20;
  await seed(page, project);
  const a = page.locator('[data-piece-id="snap-a"]');
  const b = page.locator('[data-piece-id="snap-c"]');
  await a.click();
  await b.click({ modifiers: ['Control'] });
  const box = (await a.boundingBox())!;
  const zoom = await page.locator('.table-piece').first().evaluate(el => {
    const world = el.closest('.table-world')!;
    return new DOMMatrix(getComputedStyle(world).transform).a;
  });
  await a.hover();
  await page.mouse.down();
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x + box.width / 2 + 46 * zoom, box.y + box.height / 2 + 24 * zoom, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect.poll(async () => (await saved(page)).instances.map(i => [i.id, i.x, i.y]).sort())
    .toEqual([['snap-a', 740, 440], ['snap-b', 960, 540], ['snap-c', 960, 540]]);
  expect((await saved(page)).instances.filter(i => i.id !== 'snap-a').map(i => i.stack)).toEqual(['snap-stack', 'snap-stack']);
});

test('the fullscreen preview opens at the zoom the last one was left at', async ({ page }) => {
  await page.goto('/');
  const token = page.locator('.table-viewport').getByRole('button', { name: 'Amber token', exact: true }).first();
  await token.hover();
  await page.keyboard.press('z');
  const dialog = page.getByRole('dialog', { name: /^Fullscreen preview:/ });
  await expect(dialog).toContainText('100%');
  await dialog.hover();
  for (let n = 0; n < 3; n++) await page.mouse.wheel(0, -100);
  await expect(dialog).toContainText('133%');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // Another piece opens at the same zoom.
  await page.locator('.table-viewport').getByRole('button', { name: 'Spirit die', exact: true }).hover();
  await page.keyboard.press('z');
  await expect(dialog).toContainText('133%');
});
