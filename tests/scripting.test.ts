import { describe, expect, it } from 'vitest';
import { applyCommand, setMemory, type Command, type Project } from '../src/domain';
import { applyPlaygroundCommand, emptyPlaygroundHistory, undoPlayground } from '../src/playgroundHistory';
import { checkScriptSyntax, scriptFunctions } from '../src/scripting';
import { starterTable } from './fixtures';

const withScript = (source: string, project = starterTable()): Project => applyCommand(project, { type: 'script', script: { id: 'rules', name: 'Rules', source } });
const call = (name: string, extra: Partial<Extract<Command, { type: 'call' }>> = {}): Command => ({ type: 'call', name, args: [], seed: 7, ...extra });
const errors = (p: Project) => (p.scriptLog ?? []).filter(line => line.level === 'error').map(line => line.text);
const tokens = (p: Project) => p.instances.filter(i => p.components.find(c => c.id === i.componentId)?.kind === 'token');

describe('table scripts', () => {
  it('call functions that act on the table and memory, as one action that a single undo reverts', () => {
    const p = withScript(`
      function gather(piece, player)
        local tokens = game.pieces({ kind = "token" })
        for index, token in ipairs(tokens) do game.move(token, 100 + index * 10, 200) end
        memory.gathered = (memory.gathered or 0) + #tokens
        memory.by = player.name
        print("gathered", #tokens)
      end`);
    let state = { project: p, history: emptyPlaygroundHistory() };
    state = applyPlaygroundCommand(state.project, state.history, call('gather'), 'player-1');
    expect(errors(state.project)).toEqual([]);
    expect(tokens(state.project).map(t => [t.x, t.y])).toEqual([[110, 200], [120, 200], [130, 200], [140, 200], [150, 200]]);
    expect(state.project.memory).toEqual({ gathered: 5, by: 'Player 1' });
    expect(state.project.scriptLog?.at(-1)).toMatchObject({ level: 'info', text: 'gathered\t5', player: 'player-1' });
    expect(state.history.entries).toHaveLength(1);
    const undone = undoPlayground(state.project, state.history);
    expect(tokens(undone.project).map(t => t.x)).toEqual(tokens(p).map(t => t.x));
    expect(undone.project.memory).toBeUndefined();
  });

  it('keep changes between beginNoUndo and endNoUndo when the action is undone', () => {
    const p = withScript(`
      function score()
        local token = game.pieces({ kind = "token" })[1]
        game.move(token, 10, 10)
        game.beginNoUndo()
        memory.rounds = 1
        game.setRotation(token, 45)
        game.endNoUndo()
      end
      function unbalanced() game.beginNoUndo() end`);
    const done = applyPlaygroundCommand(p, emptyPlaygroundHistory(), call('score'));
    const undone = undoPlayground(done.project, done.history).project;
    const token = tokens(undone)[0], original = tokens(p)[0];
    expect([token.x, token.y]).toEqual([original.x, original.y]);
    expect(token.rotation).toBe(45);
    expect(undone.memory).toEqual({ rounds: 1 });
    // A begin without its end is an error, and the action changes nothing.
    const failed = applyCommand(p, call('unbalanced'));
    expect(errors(failed).at(-1)).toMatch(/needs a matching game\.endNoUndo/);
    expect(failed.instances).toEqual(p.instances);
  });

  it('log errors with the script line and leave the table as it was', () => {
    const p = withScript('function broken()\n  game.move("nope", 1, 2)\nend\nfunction loop() while true do end end');
    const broken = applyCommand(p, call('broken'), 'player-2');
    expect(broken.instances).toEqual(p.instances);
    expect(broken.scriptLog?.at(-1)).toMatchObject({ level: 'error', player: 'player-2', text: 'broken: Rules:2: There is no piece or stack nope.' });
    expect(errors(applyCommand(p, call('loop'))).at(-1)).toMatch(/ran too long/);
    expect(errors(applyCommand(p, call('missing'))).at(-1)).toMatch(/no function called missing/);
    // Repeating the same error counts it instead of filling the log.
    const twice = applyCommand(broken, call('broken'), 'player-2');
    expect(twice.scriptLog).toHaveLength(broken.scriptLog!.length);
    expect(twice.scriptLog?.at(-1)?.count).toBe(2);
  });

  it('run the same way everywhere: random numbers and new ids come from the action’s seed', () => {
    const p = withScript(`function deal() memory.roll = math.random(1, 1000); memory.piece = game.spawn("Amber token", { x = 5, y = 6 }) end`);
    const first = applyCommand(p, call('deal', { seed: 42 })), again = applyCommand(p, call('deal', { seed: 42 }));
    expect(first.memory).toEqual(again.memory);
    expect(first.instances.find(i => i.id === first.memory!.piece)).toMatchObject({ x: 5, y: 6 });
    expect(applyCommand(p, call('deal', { seed: 43 })).memory).not.toEqual(first.memory);
  });

  it('pass the pressed piece and the acting seat, and resolve dotted function names', () => {
    const token = starterTable().instances.find(i => i.scale === .65)!;
    const p = withScript(`ui = {} function ui.press(piece, player, bonus) memory.pressed = { piece.id, player.seat, bonus } end`);
    const pressed = applyCommand({ ...p, instances: p.instances.map(i => i.id === token.id ? token : i) }, call('ui.press', { piece: p.instances.find(i => i.scale === .65)!.id, args: [3] }), 'player-2');
    expect(pressed.memory?.pressed).toEqual([p.instances.find(i => i.scale === .65)!.id, 2, 3]);
  });

  it('react to players’ actions through event handlers, in the same undo step', () => {
    let p = withScript(`
      function onLoad() memory.draws = memory.draws or 0 end
      function onDraw(hand, pieces, player) memory.draws = memory.draws + #pieces; memory.last = hand.name end
      function onTurnStart(player) memory.turn = player.name end
      function onMemoryChanged(changes) memory.changed = changes[1].path end`);
    // onLoad runs when scripts are saved, without an undo step.
    expect(p.memory).toEqual({ draws: 0 });
    const deck = p.instances.find(i => i.stack === 'starter-deck')!;
    const drawn = applyPlaygroundCommand(p, emptyPlaygroundHistory(), { type: 'drawMany', id: deck.id, playerId: 'player-1', count: 2 }, 'player-1');
    expect(drawn.project.memory).toMatchObject({ draws: 2, last: 'Player 1' });
    expect(undoPlayground(drawn.project, drawn.history).project.memory).toEqual({ draws: 0 });
    p = applyCommand(applyCommand(p, { type: 'settings', patch: { turns: true } }), { type: 'endTurn' });
    expect(p.memory?.turn).toBe('Player 2');
    p = applyCommand(p, { type: 'memory', changes: [{ path: ['score', 'red'], value: 4 }] });
    expect(p.memory).toMatchObject({ score: { red: 4 }, changed: 'score.red' });
  });

  it('keep a handler’s mistakes from blocking the player’s action', () => {
    const p = withScript('function onMove() error("boom") end');
    const token = tokens(p)[0];
    const moved = applyCommand(p, { type: 'transform', ids: [token.id], dx: 5, dy: 0 });
    expect(tokens(moved)[0].x).toBe(token.x + 5);
    expect(errors(moved).at(-1)).toMatch(/onMove: Rules:1: boom/);
  });

  it('run update(dt) on ticks without adding undo steps', () => {
    const p = withScript('function update(dt) memory.time = (memory.time or 0) + dt end');
    const ticked = applyPlaygroundCommand(p, emptyPlaygroundHistory(), { type: 'tick', dt: 1.5, seed: 1 });
    expect(ticked.project.memory).toEqual({ time: 1.5 });
    expect(ticked.history.entries).toHaveLength(0);
    // Without an update function a tick changes nothing at all.
    expect(applyCommand(starterTable(), { type: 'tick', dt: 1, seed: 1 }).memory).toBeUndefined();
  });

  it('keep lists, empty lists and tables apart in memory', () => {
    const p = withScript(`function shape()
      memory.list = { "a", "b" }; memory.empty = memory.empty; memory.map = { [3] = true }; memory.nested = { x = { 1, 2 } }
    end`, { ...starterTable(), memory: { empty: [] } });
    expect(applyCommand(p, call('shape')).memory).toEqual({ empty: [], list: ['a', 'b'], map: { 3: true }, nested: { x: [1, 2] } });
    const stored = withScript('function bad() memory.f = print end');
    expect(errors(applyCommand(stored, call('bad'))).at(-1)).toMatch(/memory\.f can't hold a function/);
  });

  it('edit memory by path, counting list positions from 1', () => {
    let memory = setMemory(undefined, ['players', 1, 'name'], 'Ada');
    memory = setMemory(memory, ['players', 2], { name: 'Bo' });
    expect(memory).toEqual({ players: [{ name: 'Ada' }, { name: 'Bo' }] });
    expect(() => setMemory(memory, ['players', 4], 1)).toThrow(/skips positions/);
    memory = setMemory(memory, ['players', 1], undefined);
    expect(memory).toEqual({ players: [{ name: 'Bo' }] });
    expect(setMemory(memory, [], undefined)).toBeUndefined();
  });

  it('find the functions buttons can call and report syntax errors with their line', () => {
    expect(scriptFunctions([{ source: 'function rollAll() end\nlocal function hidden() end\nui = {}\nfunction ui.reset() end\nscore = function() end\n-- function commented() end\nfunction onLoad() end' }]))
      .toEqual(['rollAll', 'score', 'ui.reset']);
    expect(checkScriptSyntax('function x()\n  if true then\nend', 'Rules')).toMatchObject({ line: 3 });
    expect(checkScriptSyntax('return 1')).toBeUndefined();
  });

  it('let scripts deal from stacks and turn pieces', () => {
    const p = withScript(`function deal()
      local deck = game.stacks()[1]
      local cards = game.draw(deck.id, "player-2", 3)
      memory.dealt = #cards
      local die = game.pieces({ kind = "dice" })[1]
      game.setRow(die, 6)
      game.shuffle(deck.id)
    end`);
    const dealt = applyCommand(p, call('deal'));
    expect(errors(dealt)).toEqual([]);
    expect(dealt.instances.filter(i => i.holder === 'player-2')).toHaveLength(3);
    expect(dealt.instances.find(i => p.components.find(c => c.id === i.componentId)?.kind === 'dice')?.row).toBe(5);
  });
});
