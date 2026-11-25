import { expect, test } from '@playwright/test';
import { starterProject } from '../../src/templates';
import { linkComponent } from '../../src/projectLinks';
import { createPortableZip } from '../../src/portable';
import type { Archive } from '../../src/domain';
import { chooseHeader, expectHeaderEnabled } from './headerMenus';

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
  await page.getByRole('button', { name: 'Load project Wildwood', exact: true }).click();
  await expect(page.locator('.table-viewport')).toBeVisible();
  await page.reload();
  await expect(page.locator('.table-viewport')).toBeVisible();
  await page.getByRole('link', { name: 'Tablecraft home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  // The loaded project is shown apart from the others, and can't be loaded twice: it continues where it was.
  const open = page.getByRole('region', { name: 'Open project' });
  await expect(open.getByRole('heading', { name: 'Wildwood' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load project Wildwood', exact: true })).toHaveCount(0);
  await open.locator('.home-project summary').click();
  await expect(page.locator('.home-components')).toContainText('Spirit cards');
  await page.getByRole('button', { name: 'Continue project Wildwood', exact: true }).click();
  await page.getByRole('button', { name: 'Spawn Amber token', exact: true }).click();
  await page.getByRole('link', { name: 'Tablecraft home', exact: true }).click();
  await expect(open).toContainText('Unsaved changes');
  await page.getByRole('button', { name: 'Continue project Wildwood', exact: true }).click();
  await expectHeaderEnabled(page, 'Undo', true);
  // Closing asks about the unsaved token; cancelling keeps the project loaded, saving closes it with the token kept.
  await page.getByRole('link', { name: 'Tablecraft home', exact: true }).click();
  await page.getByRole('button', { name: 'Close project Wildwood', exact: true }).click();
  const unsaved = page.getByRole('dialog', { name: 'Unsaved changes' });
  await unsaved.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(open).toBeVisible();
  await page.getByRole('button', { name: 'Close project Wildwood', exact: true }).click();
  await unsaved.getByRole('textbox', { name: 'Snapshot name' }).fill('With a token');
  await unsaved.getByRole('button', { name: 'Save snapshot', exact: true }).click();
  await expect(open).toHaveCount(0);
  await expect(page.locator('.home-project')).toContainText('2 snapshots');
  await expect(page.locator('.home-project')).toContainText('23 pieces');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Project home' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load project Wildwood', exact: true })).toBeVisible();
});

test('a finished project starts new games from its base and saves to its sessions, which go out of date with the base', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load project Wildwood', exact: true }).click();
  await page.getByRole('button', { name: 'Spawn Amber token', exact: true }).click();
  await chooseHeader(page, 'Save/Load');
  await page.getByLabel('Snapshot name').fill('Version two');
  await page.getByRole('button', { name: 'Save snapshot', exact: true }).click();
  await page.getByRole('group', { name: 'Project status' }).getByRole('button', { name: 'Finished' }).click();
  await expect(page.getByRole('region', { name: 'Draft snapshots' }).locator('.history-snapshot').first()).toContainText('Base');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await chooseHeader(page, 'Close project');
  // Loading a finished project offers a new game from the base, or a session to continue.
  await page.getByRole('button', { name: 'Load project Wildwood', exact: true }).click();
  const chooser = page.getByRole('dialog', { name: 'Play Wildwood' });
  await expect(chooser).toContainText('No sessions yet.');
  await chooser.getByRole('textbox', { name: 'Session name' }).fill('Friday');
  await chooser.getByRole('button', { name: 'Start a new game', exact: true }).click();
  await expect(page.locator('.project-heading')).toContainText('Session · Friday');
  const tokens = page.locator('.table-viewport').getByRole('button', { name: 'Amber token', exact: true });
  const count = await tokens.count();
  await page.getByRole('button', { name: 'Spawn Amber token', exact: true }).click();
  await chooseHeader(page, 'Save/Load');
  await expect(page.getByText('Saves to the session Friday.')).toBeVisible();
  await page.getByLabel('Snapshot name').fill('Turn one');
  await page.getByRole('button', { name: 'Save snapshot', exact: true }).click();
  const sessions = page.getByRole('region', { name: 'Sessions' });
  await expect(sessions).toContainText('2 snapshots');
  await expect(sessions).toContainText('Turn one');
  // Back to draft, a new base: the session is outdated and says where it started.
  const status = page.getByRole('group', { name: 'Project status' });
  await status.getByRole('button', { name: 'Draft' }).click();
  await status.getByRole('button', { name: 'Finished' }).click();
  await page.getByRole('region', { name: 'Draft snapshots' }).locator('.history-snapshot').filter({ hasText: 'initial state' }).getByRole('button', { name: 'Make base' }).click();
  await expect(sessions).toContainText('Outdated');
  await expect(sessions).toContainText('from “Version two”');
  // Sessions and snapshots can be renamed.
  await sessions.getByRole('button', { name: 'Rename session Friday', exact: true }).click();
  await sessions.getByRole('textbox', { name: 'New name for session Friday' }).fill('Friday night');
  await page.keyboard.press('Enter');
  await expect(sessions).toContainText('Friday night');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await chooseHeader(page, 'Close project');
  await page.getByRole('button', { name: 'Load project Wildwood', exact: true }).click();
  await chooser.getByRole('button', { name: 'Continue session Friday night', exact: true }).click();
  await expect(tokens).toHaveCount(count + 1);
  // Its first snapshot can't be the session's only one; the session itself can be deleted once it is closed.
  await chooseHeader(page, 'Close project');
  await page.getByRole('button', { name: 'Snapshots and sessions of Wildwood', exact: true }).click();
  await sessions.getByRole('button', { name: 'Delete session Friday night', exact: true }).click();
  await sessions.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(sessions).toContainText('No sessions yet.');
});

test('importing a workspace remaps internal project links to the imported sources', async ({ page }) => {
  const source = { ...starterProject(), id: 'export-source', name: 'Exported source' };
  const target = { ...starterProject(), id: 'export-target', name: 'Exported target', components: [], instances: [] };
  const linked = linkComponent(target, source, source.components[0].id).project;
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'workspace.zip', mimeType: 'application/zip',
    buffer: Buffer.from(createPortableZip({ format: 'tablecraft', version: 1, projects: [source, linked] })),
  });
  await expect(page.getByRole('button', { name: 'Load project Exported target', exact: true })).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!));
  const importedSource = stored.projects.find((p: { name: string }) => p.name === 'Exported source');
  const importedTarget = stored.projects.find((p: { name: string }) => p.name === 'Exported target');
  expect(importedSource.id).not.toBe(source.id);
  expect(importedTarget.components.every((c: { source: { projectId: string } }) => c.source.projectId === importedSource.id)).toBe(true);
  await page.getByRole('button', { name: 'Load project Exported target', exact: true }).click();
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
  await page.getByRole('button', { name: 'Close project My prototype', exact: true }).click();
  const moving = page.getByRole('button', { name: 'Reorder project My prototype', exact: true });
  const first = page.locator('.home-project').first();
  await moving.dragTo(first, { targetPosition: { x: 100, y: 2 } });
  await expect(page.locator('.home-project h2')).toHaveText(['My prototype', 'Wildwood']);
  await page.getByRole('button', { name: 'Export project My prototype', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Export My prototype' }).getByRole('button', { name: 'Export ZIP', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('My prototype.tablecraft.zip');
  const exported: Archive = { format: 'tablecraft', version: 1, projects: [{ ...starterProject(), id: 'imported', name: 'Imported project' }] };
  await page.locator('input[type=file]').first().setInputFiles({ name: 'import.tablecraft.zip', mimeType: 'application/zip', buffer: Buffer.from(createPortableZip(exported)) });
  await expect(page.getByRole('button', { name: 'Load project Imported project', exact: true })).toBeVisible();
  // New and imported projects start with a snapshot of their initial state.
  for (const name of ['My prototype', 'Imported project']) {
    await page.getByRole('button', { name: `Snapshots and sessions of ${name}`, exact: true }).click();
    await expect(page.getByRole('region', { name: 'Draft snapshots' })).toContainText(`${name} - initial state`);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  }
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
  await page.getByRole('button', { name: 'Load project Target', exact: true }).click();
  await page.getByRole('button', { name: 'Link from another project', exact: true }).click();
  await page.getByRole('button', { name: 'Link Spirit cards from Source', exact: true }).click();
  await expect(page.locator('.linked-component-view')).toContainText('Read-only link from Source');
  await expect(page.getByRole('button', { name: 'Add text', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Playground', exact: true }).click();
  await page.getByRole('button', { name: 'Spawn Spirit cards', exact: true }).click();
  await expect(page.locator('.table-piece')).toHaveCount(1);
  await page.getByRole('link', { name: 'Tablecraft home', exact: true }).click();
  // Loading another project closes Target, saving its changes first.
  const unsaved = page.getByRole('dialog', { name: 'Unsaved changes' });
  await page.getByRole('button', { name: 'Load project Source', exact: true }).click();
  await unsaved.getByRole('button', { name: 'Save snapshot', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Spirit cards', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Updated cards');
  await page.getByRole('link', { name: 'Tablecraft home', exact: true }).click();
  await page.getByRole('button', { name: 'Load project Target', exact: true }).click();
  await unsaved.getByRole('button', { name: 'Save snapshot', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Spawn Updated cards', exact: true })).toBeVisible();
  await expect(page.locator('.table-piece')).toHaveCount(1);
  await page.getByRole('link', { name: 'Tablecraft home', exact: true }).click();
  await page.getByRole('button', { name: 'Delete project Source', exact: true }).click();
  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await page.getByRole('button', { name: 'Continue project Target', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Updated cards', exact: true }).click();
  await expect(page.locator('.linked-component-view')).toContainText('Source unavailable locally');
  await page.locator('.linked-component-view').getByRole('button', { name: 'Make local copy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add text', exact: true })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('My local artwork');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Spawn My local artwork', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Spawn Updated cards', exact: true })).toBeVisible();
});
