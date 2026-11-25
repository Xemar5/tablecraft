import { expect, test, type Page } from '@playwright/test';
import { makeInstance } from '../../src/domain';
import { starterProject, template } from '../../src/templates';
import { fillServer, pickSeat } from './liveSeat';

const SOURCE = `function onLoad() memory.round = memory.round or 1 end
function nextRound(piece, player) memory.round = memory.round + 1; memory.by = player.name end
function update(dt) memory.ticks = (memory.ticks or 0) + 1 end
`;

/** The starter table with a script and a button that runs nextRound, its label showing memory. */
function scriptedProject() {
  const project = starterProject();
  const button = { ...template('button'), id: 'component-next-round', action: 'nextRound' };
  button.front = button.front.map(node => ({ ...node, text: 'Round {{memory.round}}' }));
  return {
    ...project, id: 'project-scripted', name: 'Scripted table',
    components: [...project.components, button],
    instances: [...project.instances, { ...makeInstance(button.id, 0, 1000, 250), id: 'piece-next-round', locked: true }],
    scripts: [{ id: 'script-rules', name: 'Rules', source: SOURCE }], memory: { round: 1 },
    settings: { ...project.settings, updateInterval: 0.5 },
  };
}

test('scripts run on the server for everyone: button presses, update ticks and the host’s say over editing', async ({ browser, storageState }) => {
  const workspace = JSON.stringify({ format: 'tablecraft', version: 1, projects: [scriptedProject()] });
  const contexts = [await browser.newContext({ storageState }), await browser.newContext({ storageState })];
  await contexts[0].addInitScript(value => { localStorage.setItem('tablecraft.workspace.v1', value); localStorage.setItem('tablecraft.last-project', 'project-scripted'); }, workspace);
  const [host, guest] = await Promise.all(contexts.map(context => context.newPage()));
  try {
    const code = `LUA-${Date.now()}`;
    for (const [page, hosting] of [[host, true], [guest, false]] as [Page, boolean][]) {
      await page.goto('/');
      await page.getByRole('button', { name: /Invite players/ }).click();
      await fillServer(page);
      await page.getByLabel('Room code', { exact: true }).fill(code);
      await page.getByRole('button', { name: hosting ? 'Host this table' : 'Join room', exact: true }).click();
      if (hosting) await expect(page.locator('.connection-badge')).toHaveText('Live session', { timeout: 20000 });
      else await pickSeat(page);
    }
    const button = (page: Page) => page.locator('.table-viewport .table-piece.button-piece');
    await expect(button(guest)).toHaveText('Round 1');
    // The guest presses the (locked) button; the server runs nextRound and both tables show the new memory.
    await button(guest).click();
    await expect(button(guest)).toHaveText('Round 2');
    await expect(button(host)).toHaveText('Round 2');

    // update(dt) runs on the server's timer while players are connected.
    await guest.getByRole('button', { name: 'Toggle memory window', exact: true }).click();
    const ticks = guest.getByRole('region', { name: 'Memory', exact: true }).getByRole('textbox', { name: 'Value of ticks', exact: true });
    await expect.poll(async () => Number(await ticks.inputValue().catch(() => '0')), { timeout: 15000 }).toBeGreaterThan(1);

    // Only the host edits scripts until the host lets players do it.
    await guest.getByRole('button', { name: 'Toggle scripts window', exact: true }).click();
    const guestScripts = guest.getByRole('region', { name: 'Scripts', exact: true });
    await expect(guestScripts.getByText('Only the host can edit scripts in this room.', { exact: false })).toBeVisible();
    await expect(guestScripts.getByRole('button', { name: 'New script', exact: true })).toHaveCount(0);
    await host.getByRole('button', { name: /^Table/ }).click();
    await host.getByRole('checkbox', { name: /^Players can edit scripts/ }).check();
    await expect(guestScripts.getByRole('button', { name: 'New script', exact: true })).toBeVisible();
    await guestScripts.getByRole('button', { name: 'New script', exact: true }).click();
    await expect(host.getByRole('button', { name: 'Toggle scripts window', exact: true })).toBeVisible();
    await host.getByRole('button', { name: 'Toggle scripts window', exact: true }).click();
    await expect(host.getByRole('region', { name: 'Scripts', exact: true }).locator('.script-list li')).toHaveCount(2);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
