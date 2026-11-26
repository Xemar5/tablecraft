import { describe, expect, it } from 'vitest';
import { applyCommand, makeInstance, validateProject, type Command, type Project } from '../src/domain';
import { applyPlaygroundCommand, emptyPlaygroundHistory } from '../src/playgroundHistory';
import { POPUP_DEFAULTS, popupBox, popupSettings, popupShownTo } from '../src/popups';
import { template } from '../src/templates';
import { wildwoodProject } from '../src/wildwood';
import { starterTable } from './fixtures';

/** The starter table with a "Notice" popup component and a script. */
function table(source = '', popup: Partial<ReturnType<typeof template>> = {}): Project {
  const p = starterTable();
  p.components = [...p.components, { ...template('popup'), id: 'notice', name: 'Notice', ...popup }];
  return source ? applyCommand(p, { type: 'script', script: { id: 'rules', name: 'Rules', source } }) : p;
}
const call = (p: Project, name: string, actor = 'player-1', extra: Partial<Extract<Command, { type: 'call' }>> = {}) =>
  applyCommand(p, { type: 'call', name, args: [], seed: 7, ...extra }, actor);
const errors = (p: Project) => (p.scriptLog ?? []).filter(line => line.level === 'error').map(line => line.text);

describe('popups', () => {
  it('lay out in the game area: anchored with a margin and fitted, or fixed at their own size', () => {
    const size = { width: 400, height: 200 }, area = { width: 1000, height: 600 };
    const at = (patch: Partial<typeof POPUP_DEFAULTS>) => popupBox(size, area, { ...POPUP_DEFAULTS, ...patch });
    expect(at({})).toEqual({ left: 300, top: 200, width: 400, height: 200, scale: 1 });
    expect(at({ anchor: 'bottom-right', margin: 10, x: -5 })).toEqual({ left: 585, top: 390, width: 400, height: 200, scale: 1 });
    // Shrinking only scales down; filling scales up to the room inside the margins.
    expect(popupBox(size, { width: 248, height: 600 }, { ...POPUP_DEFAULTS })).toMatchObject({ width: 200, height: 100, scale: .5 });
    expect(at({ fit: 'fill', margin: 0 })).toMatchObject({ left: 0, top: 50, width: 1000, height: 500, scale: 2.5 });
    expect(at({ fit: 'none', scale: 2, anchor: 'top-left', margin: 0 })).toMatchObject({ left: 0, top: 0, width: 800, height: 400 });
    expect(at({ layout: 'fixed', x: 30, y: 40, scale: 1.5 })).toEqual({ left: 30, top: 40, width: 600, height: 300, scale: 1.5 });
  });

  it('open from scripts for some seats, with data and settings of their own, and are never placed on the table', () => {
    let p = table(`
      function show(_, player)
        local id = game.popup("Notice", { players = { "Player 2" }, data = { title = "Hello", count = 3 }, blur = true, anchor = "top" })
        memory.id = id
        memory.open = #game.popups()
      end
      function wrong() game.popup("Spirit cards") end
      function bad() game.popup("Notice", { anchor = "middle" }) end
      function nobody() memory.none = game.popup("Notice", { players = {} }) == nil end`);
    p = call(p, 'show');
    const popup = p.popups![0];
    expect(popup).toMatchObject({ id: p.memory!.id, componentId: 'notice', row: 0, to: ['player-2'], data: { title: 'Hello', count: '3' }, settings: { blur: true, anchor: 'top' }, player: 'player-1' });
    expect(p.memory!.open).toBe(1);
    expect(popupShownTo(popup, 'player-2')).toBe(true);
    expect(popupShownTo(popup, 'player-1')).toBe(false);
    expect(popupShownTo(popup, undefined)).toBe(false);
    expect(popupSettings(p.components.find(c => c.id === 'notice')!, popup)).toMatchObject({ blur: true, anchor: 'top', draggable: true, closable: true });
    expect(errors(call(p, 'wrong')).at(-1)).toMatch(/Spirit cards is not a popup component/);
    expect(errors(call(p, 'bad')).at(-1)).toMatch(/game.popup anchor/);
    const none = call(p, 'nobody');
    expect(none.memory!.none).toBe(true);
    expect(none.popups).toHaveLength(1);
    expect(() => applyCommand(p, { type: 'spawn', instances: [{ ...makeInstance('notice'), id: 'piece-x' }] }, 'player-1')).toThrow('Popups are shown on screen');
  });

  it('close for each seat, for everyone at once, or from scripts, and stay out of undo', () => {
    let p = table(`
      function show() game.popup("Notice") end
      function closeFor(_, player) game.closePopup("Notice", player) end
      function closeAll() game.closePopup() end`);
    const opened = applyPlaygroundCommand(p, emptyPlaygroundHistory(), { type: 'call', name: 'show', args: [], seed: 1 }, 'player-1');
    expect(opened.history.entries).toHaveLength(0);
    p = opened.project;
    const id = p.popups![0].id;
    // Each seat closes its own copy; once every seat has, it's gone.
    const closed = applyPlaygroundCommand(p, opened.history, { type: 'closePopup', ids: [id] }, 'player-1');
    expect(closed.history.entries).toHaveLength(0);
    expect(closed.project.popups![0].closed).toEqual(['player-1']);
    expect(popupShownTo(closed.project.popups![0], 'player-1')).toBe(false);
    expect(applyCommand(closed.project, { type: 'closePopup', ids: [id] }, 'player-2').popups).toBeUndefined();
    // Closing one already gone changes nothing.
    expect(applyCommand(closed.project, { type: 'closePopup', ids: ['missing'] }, 'player-2').popups).toHaveLength(1);
    // Scripts close it for a seat, or for everyone.
    expect(call(p, 'closeFor', 'player-2').popups![0].closed).toEqual(['player-2']);
    expect(call(p, 'closeAll').popups).toBeUndefined();
    // With dismiss "all", the first seat to close it closes it for everyone.
    const shared = call(table('function show() game.popup("Notice", { dismiss = "all" }) end'), 'show');
    expect(applyCommand(shared, { type: 'closePopup', ids: [shared.popups![0].id] }, 'player-2').popups).toBeUndefined();
  });

  it('run the popup’s script action with the popup, the player and the clicked layer', () => {
    let p = table(`
      function show() game.popup("Notice", { data = { title = "Pick" } }) end
      function choose(popup, player, layer, path)
        memory.choice = { popup = popup.id, title = popup.data.title, player = player.name, layer = layer, outer = path[1] }
        game.closePopup(popup.id, player)
      end`, { action: 'choose' });
    p = call(p, 'show');
    const id = p.popups![0].id;
    const after = call(p, 'choose', 'player-2', { popup: id, args: ['Title', ['Title']] });
    expect(after.memory!.choice).toEqual({ popup: id, title: 'Pick', player: 'Player 2', layer: 'Title', outer: 'Title' });
    expect(after.popups![0].closed).toEqual(['player-2']);
    expect(errors(call(after, 'choose', 'player-1', { popup: 'gone' })).at(-1)).toMatch(/no longer open/);
  });

  it('follow seats and components: a removed seat leaves them, and a popup component that changes kind closes its popups', () => {
    let p = call(table('function show() game.popup("Notice", { players = { 1, 2 } }) end'), 'show');
    p = applyCommand(p, { type: 'removePlayer', playerId: 'player-2' }, 'player-1');
    expect(p.popups![0].to).toEqual(['player-1']);
    expect(applyCommand(p, { type: 'removePlayer', playerId: 'player-1' }, 'player-1').popups).toBeUndefined();
    const card = { ...p.components.find(c => c.id === 'notice')!, kind: 'card' as const };
    expect(applyCommand(p, { type: 'component', component: card }).popups).toBeUndefined();
    expect(validateProject(p)).toBeTruthy();
  });

  it('let announcements and pings reach only some seats', () => {
    let p = table(`
      function tell() game.announce("Psst", "Player 2") end
      function pingFor() game.ping(game.pieces()[1], { 1 }) end`);
    p = call(p, 'tell');
    expect(p.scriptLog!.at(-1)).toMatchObject({ level: 'announce', text: 'Psst', to: ['player-2'] });
    p = call(p, 'pingFor');
    expect(errors(p)).toEqual([]);
    expect(p.instances.find(item => item.pings)).toMatchObject({ pings: 1, pingedFor: ['player-1'] });
  });

  it('show in Wildwood: every fifth amber gathered opens the milestone for the gatherer, and Share tells everyone', () => {
    let p = wildwoodProject();
    for (let n = 0; n < 5; n++) p = applyCommand(p, { type: 'call', name: 'gatherAmber', args: [], seed: n }, 'player-1');
    expect(errors(p)).toEqual([]);
    expect(p.popups).toHaveLength(1);
    const popup = p.popups![0];
    expect(popup).toMatchObject({ to: ['player-1'], data: { name: 'Player 1', count: '5' } });
    const shared = applyCommand(p, { type: 'call', name: 'amberMilestone', popup: popup.id, args: ['Share', ['Share']], seed: 9 }, 'player-1');
    expect(shared.scriptLog!.at(-1)).toMatchObject({ level: 'announce', text: 'Player 1 has gathered 5 amber!' });
    expect(shared.popups).toBeUndefined();
  });
});
