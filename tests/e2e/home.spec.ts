import { expect, test } from '@playwright/test';
import { starterProject } from '../../src/templates';
import { linkComponent } from '../../src/projectLinks';

// No saved projects, but a completed profile so the first-launch settings stay closed.
test.use({ storageState: { cookies: [], origins: [{ origin: 'http://127.0.0.1:5173', localStorage: [{ name: 'tablecraft.settings.v1', value: JSON.stringify({ name: 'Tester', onboarded: true }) }] }] } });

test('Home actions retain aligned spacing and icons, and New project has a padded form', async ({ page }) => {
  await page.goto('/');
  for (const width of [1280, 800, 620]) {
    await page.setViewportSize({ width, height: 800 });
    const buttons = page.locator('.home-actions > button');
    await expect(buttons).toHaveCount(4);
    const measurements = await buttons.evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      const icon = element.querySelector('svg')!.getBoundingClientRect();
      return { height: bounds.height, left: bounds.left, right: bounds.right, margin: style.margin,
        paddingLeft: style.paddingLeft, paddingRight: style.paddingRight, iconWidth: icon.width };
    }));
    for (const button of measurements) {
      expect(button.margin).toBe('0px');
      expect(button.paddingLeft).toBe(button.paddingRight);
      expect(button.iconWidth).toBe(16);
      expect(button.height).toBe(measurements[0].height);
      expect(button.left).toBeGreaterThanOrEqual(0);
      expect(button.right).toBeLessThanOrEqual(width);
    }
  }
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  const name = dialog.getByRole('textbox', { name: 'Project name', exact: true });
  await expect(name).toBeFocused();
  await expect(dialog.locator('form')).toHaveCSS('padding', '24px 26px');
  await expect(dialog.getByText('You can change the name and description later.', { exact: true })).toBeVisible();
  const bounds = (await dialog.boundingBox())!;
  const input = (await name.boundingBox())!;
  expect(input.x - bounds.x).toBeGreaterThanOrEqual(26);
  expect(bounds.x + bounds.width - input.x - input.width).toBeGreaterThanOrEqual(26);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.home-project')).toHaveCount(1);
});

test('fresh visits start at Home, open projects resume, and the logo returns Home', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Project home' })).toBeVisible();
  await page.getByRole('button', { name: 'Open project Wildwood', exact: true }).click();
  await expect(page.locator('.table-viewport')).toBeVisible();
  await page.reload();
  await expect(page.locator('.table-viewport')).toBeVisible();
  await page.getByRole('link', { name: 'Tablecraft home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await page.locator('.home-project summary').click();
  await expect(page.locator('.home-components')).toContainText('Spirit cards');
  await page.getByRole('button', { name: 'Open project Wildwood', exact: true }).click();
  await page.getByRole('button', { name: 'Spawn Amber token', exact: true }).click();
  await page.getByRole('link', { name: 'Tablecraft home', exact: true }).click();
  await page.getByRole('button', { name: 'Open project Wildwood', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo playground action', exact: true })).toBeEnabled();
});

test('importing a workspace remaps internal project links to the imported sources', async ({ page }) => {
  const source = { ...starterProject(), id: 'export-source', name: 'Exported source' };
  const target = { ...starterProject(), id: 'export-target', name: 'Exported target', components: [], instances: [] };
  const linked = linkComponent(target, source, source.components[0].id).project;
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'workspace.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'tablecraft', version: 1, projects: [source, linked] })),
  });
  await expect(page.getByRole('button', { name: 'Open project Exported target', exact: true })).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!));
  const importedSource = stored.projects.find((p: { name: string }) => p.name === 'Exported source');
  const importedTarget = stored.projects.find((p: { name: string }) => p.name === 'Exported target');
  expect(importedSource.id).not.toBe(source.id);
  expect(importedTarget.components.every((c: { source: { projectId: string } }) => c.source.projectId === importedSource.id)).toBe(true);
  await page.getByRole('button', { name: 'Open project Exported target', exact: true }).click();
  await page.getByRole('button', { name: `Edit ${source.components[0].name}`, exact: true }).click();
  await expect(page.locator('.linked-component-view')).toContainText('Edit the original in its source project');
});

test('Home creates, reorders, exports, imports and deletes projects including the last one', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('My prototype');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('link', { name: 'Tablecraft home', exact: true }).click();
  const moving = page.getByRole('button', { name: 'Reorder project My prototype', exact: true });
  const first = page.locator('.home-project').first();
  await moving.dragTo(first, { targetPosition: { x: 100, y: 2 } });
  await expect(page.locator('.home-project h2')).toHaveText(['My prototype', 'Wildwood']);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export project My prototype', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('My prototype.tablecraft.json');
  const exported = { format: 'tablecraft', version: 1, projects: [{ ...starterProject(), id: 'imported', name: 'Imported project' }] };
  await page.locator('input[type=file]').first().setInputFiles({ name: 'import.tablecraft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await expect(page.getByRole('button', { name: 'Open project Imported project', exact: true })).toBeVisible();
  for (const name of ['My prototype', 'Wildwood', 'Imported project']) {
    await page.getByRole('button', { name: `Delete project ${name}`, exact: true }).click();
    await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  }
  await expect(page.locator('.home-project')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('No projects yet.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('After empty');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('linked components stay read-only, refresh from their source, survive source deletion and allow local copies', async ({ page }) => {
  const source = { ...starterProject(), id: 'source', name: 'Source' };
  const target = { ...starterProject(), id: 'target', name: 'Target', components: [], instances: [] };
  await page.goto('/');
  await page.evaluate(projects => {
    localStorage.setItem('tablecraft.workspace.v1', JSON.stringify({ format: 'tablecraft', version: 1, projects }));
  }, [source, target]);
  await page.reload();
  await page.getByRole('button', { name: 'Open project Target', exact: true }).click();
  await page.getByRole('button', { name: 'Link from another project', exact: true }).click();
  await page.getByRole('button', { name: 'Link Spirit cards from Source', exact: true }).click();
  await expect(page.locator('.linked-component-view')).toContainText('Read-only link from Source');
  await expect(page.getByRole('button', { name: 'Add text', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Playground', exact: true }).click();
  await page.getByRole('button', { name: 'Spawn Spirit cards', exact: true }).click();
  await expect(page.locator('.table-piece')).toHaveCount(1);
  await page.getByRole('link', { name: 'Tablecraft home', exact: true }).click();
  await page.getByRole('button', { name: 'Open project Source', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Updated cards');
  await page.getByRole('link', { name: 'Tablecraft home', exact: true }).click();
  await page.getByRole('button', { name: 'Open project Target', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Spawn Updated cards', exact: true })).toBeVisible();
  await expect(page.locator('.table-piece')).toHaveCount(1);
  await page.getByRole('link', { name: 'Tablecraft home', exact: true }).click();
  await page.getByRole('button', { name: 'Delete project Source', exact: true }).click();
  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await page.getByRole('button', { name: 'Open project Target', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Updated cards', exact: true }).click();
  await expect(page.locator('.linked-component-view')).toContainText('Source unavailable locally');
  await page.locator('.linked-component-view').getByRole('button', { name: 'Make local copy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add text', exact: true })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('My local artwork');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Spawn My local artwork', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Spawn Updated cards', exact: true })).toBeVisible();
});
