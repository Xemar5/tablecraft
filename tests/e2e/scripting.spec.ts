import { expect, test, type Page } from '@playwright/test';
import { savedWorkspace } from './savedWorkspace';
import { choose } from './searchSelect';

const RULES = `function onLoad()
  memory.round = memory.round or 1
end

function nextRound(piece, player)
  memory.round = memory.round + 1
  game.announce(player.name .. " starts round " .. memory.round)
end
`;

/** Replaces the open script's text, as if typed. */
async function writeScript(page: Page, source: string) {
  const editor = page.locator('.script-code .cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(source);
}

test('scripts run from the editor and from button pieces, with memory shown on components and undone in one step', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Toggle scripts window', exact: true }).click();
  const scripts = page.getByRole('region', { name: 'Scripts', exact: true });
  await scripts.getByRole('button', { name: 'Create a script', exact: true }).click();
  await expect(scripts.locator('.script-list li')).toHaveCount(1);
  await writeScript(page, RULES);
  await expect(scripts.getByText('Unsaved changes')).toBeVisible();
  await page.keyboard.press('Control+S');
  await expect(scripts.locator('.script-status')).toContainText('Saved');
  await expect.poll(async () => (await savedWorkspace(page)).projects[0].scripts?.[0].source).toBe(RULES);
  // Saving ran onLoad.
  await expect.poll(async () => (await savedWorkspace(page)).projects[0].memory).toEqual({ round: 1 });

  // Syntax errors are marked while typing.
  await page.locator('.script-code .cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\nfunction broken(\n');
  await expect(scripts.locator('.cm-lint-marker-error')).toBeVisible();
  await scripts.getByRole('button', { name: 'Revert', exact: true }).click();
  await expect(scripts.locator('.cm-lint-marker-error')).toHaveCount(0);

  // Run from the editor: everything shows in the console.
  await scripts.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(scripts.locator('.console-line.announce')).toContainText('starts round 2');
  await page.getByRole('button', { name: 'Close Scripts', exact: true }).click();

  // A button whose label shows memory and whose press runs nextRound.
  await page.getByRole('button', { name: 'Add component', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Buttons Press to run/ }).click();
  await page.locator('.layer-row', { hasText: 'Label' }).first().click();
  await page.getByRole('textbox', { name: 'Text / binding', exact: true }).fill('Round {{memory.round}}');
  await page.locator('.inspector-tabs').getByRole('button', { name: 'Behavior', exact: true }).click();
  await choose(page, page, 'When pressed, run', 'nextRound');
  await page.getByRole('button', { name: 'Playground', exact: true }).click();
  await page.getByRole('button', { name: 'Spawn Button', exact: true }).click();
  const button = page.locator('.table-viewport .table-piece.button-piece');
  await expect(button).toHaveText('Round 2');
  // A new piece starts selected; pressing a button doesn't select it.
  await page.keyboard.press('Escape');
  await button.click();
  await expect(button).toHaveText('Round 3');
  await expect(page.locator('.toast')).toContainText('starts round 3');
  await expect(button).not.toHaveClass(/selected/);

  // One undo reverts the whole function.
  await page.getByRole('button', { name: 'Undo playground action', exact: true }).click();
  await expect(button).toHaveText('Round 2');

  // Memory edits show on the table at once.
  await page.getByRole('button', { name: 'Toggle memory window', exact: true }).click();
  const memory = page.getByRole('region', { name: 'Memory', exact: true });
  const value = memory.getByRole('textbox', { name: 'Value of round', exact: true });
  await value.fill('7');
  await value.press('Enter');
  await expect(button).toHaveText('Round 7');
  await memory.getByRole('button', { name: 'Add value', exact: true }).click();
  await page.keyboard.insertText('names');
  await page.keyboard.press('Enter');
  await memory.getByRole('combobox', { name: 'Type of names', exact: true }).selectOption('list');
  await memory.getByRole('button', { name: 'Add to names', exact: true }).click();
  await page.keyboard.insertText('Ada');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await savedWorkspace(page)).projects[0].memory).toEqual({ round: 7, names: ['Ada'] });
  await expect(memory.getByText('1 item', { exact: true })).toBeVisible();
});

test('a failing function reports its line and changes nothing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Toggle scripts window', exact: true }).click();
  const scripts = page.getByRole('region', { name: 'Scripts', exact: true });
  await scripts.getByRole('button', { name: 'Create a script', exact: true }).click();
  await writeScript(page, 'function crash()\n  game.move("missing", 0, 0)\nend\n');
  await page.keyboard.press('Control+S');
  await expect(scripts.locator('.script-status')).toContainText('Saved');
  await scripts.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Rules:2: There is no piece or stack missing.');
  const error = scripts.locator('.console-line.error');
  await expect(error).toContainText('crash: Rules:2:');
  // The error links to its line.
  await error.getByRole('button').click();
  await expect(scripts.locator('.cm-activeLine')).toContainText('game.move');
  await expect(page.getByRole('button', { name: 'Undo playground action', exact: true })).toBeDisabled();
});
