import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { readPortableZip } from '../../src/portable';
import { choose } from './searchSelect';
import { chooseHeader } from './headerMenus';

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
const font = readFileSync('node_modules/playwright-core/lib/vite/traceViewer/codicon.DCmgc-ay.ttf');

test('imported textures and fonts render, travel in ZIP saves and are deleted with their components', async ({ page }) => {
  await page.goto('/');
  // Textures and fonts have their own tiles in the component grid; each accepts only its kind.
  const importFrom = async (tile: RegExp, file: { name: string; mimeType: string; buffer: Buffer }) => {
    await page.getByRole('button', { name: 'Add component', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('dialog').getByRole('button', { name: tile }).click();
    const fileChooser = await chooser;
    expect(fileChooser.isMultiple()).toBe(true);
    await fileChooser.setFiles(file);
  };
  await importFrom(/^Textures/, { name: 'Custom texture.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByRole('heading', { name: 'Imported texture', exact: true })).toBeVisible();
  await importFrom(/^Fonts/, { name: 'Custom font.ttf', mimeType: 'font/ttf', buffer: font });
  await expect(page.getByRole('heading', { name: 'Imported font', exact: true })).toBeVisible();
  await expect(page.locator('.library-item').filter({ hasText: 'Custom texture' })).toContainText('texture');
  await expect(page.locator('.library-item').filter({ hasText: 'Custom font' })).toContainText('font');
  await expect(page.getByRole('button', { name: 'Spawn Custom texture', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => [...document.fonts].filter(font => font.family.startsWith('tablecraft-')).every(font => font.status === 'loaded'))).toBe(true);

  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await page.getByRole('button', { name: 'Add image', exact: true }).click();
  await choose(page, page, 'Imported texture', 'Custom texture', 'custom');
  await expect(page.locator('.designer-canvas .node-image img').last()).toHaveAttribute('src', /^data:image\/png;base64,/);
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await choose(page, page, 'Imported font', 'Custom font');
  await expect(page.getByLabel('Google font / binding', { exact: true })).toBeDisabled();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!));
  const current = before.projects[0], importedFont = current.components.find((component: { kind: string }) => component.kind === 'font');
  await expect(page.locator('.designer-canvas .node-text').last()).toHaveCSS('font-family', new RegExp(importedFont.id));

  await chooseHeader(page, 'Save/Load');
  await page.getByRole('button', { name: 'Export…', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export ZIP', exact: true }).click();
  const download = await pending, bytes = readFileSync((await download.path())!);
  expect(download.suggestedFilename()).toBe('Wildwood.tablecraft.zip');
  const files = unzipSync(bytes);
  expect(Object.keys(files)).toEqual(expect.arrayContaining(['project.json', 'assets/0.png', 'assets/1.ttf']));
  expect(strFromU8(files['project.json'])).not.toContain(importedFont.asset.data);
  const parsed = readPortableZip(bytes);
  expect(parsed.kind).toBe('archive');
  if (parsed.kind !== 'archive') throw new Error('Expected project ZIP');
  expect(parsed.archive.projects[0].components.filter(component => component.asset)).toHaveLength(2);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();

  await page.reload();
  await page.getByRole('button', { name: 'Edit Custom texture', exact: true }).click();
  await page.getByRole('button', { name: 'Delete asset', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete asset', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Custom font', exact: true }).click();
  await page.getByRole('button', { name: 'Delete asset', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete asset', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Custom font', exact: true })).toHaveCount(0);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!));
  expect(after.projects[0].components.some((component: { asset?: unknown }) => component.asset)).toBe(false);
  const layers = after.projects[0].components.flatMap((component: { front: unknown[]; back: unknown[] }) => [...component.front, ...component.back]);
  expect(layers.some((node: { fontId?: string; textureId?: string }) => node.fontId || node.textureId)).toBe(false);
  await expect.poll(() => page.evaluate(() => [...document.fonts].filter(font => font.family.startsWith('tablecraft-')).length)).toBe(0);
});

test('JSON project uploads are rejected explicitly', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles({
    name: 'old.tablecraft.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"tablecraft","version":1,"projects":[]}'),
  });
  await expect(page.getByRole('alert')).toContainText('JSON file imports are no longer supported');
});
