import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../apps/game-api/src/engine.js';
import type { EngineData } from '../apps/game-api/src/engine.js';
import { NavGrid } from '../apps/game-web/src/game/engine3d/nav.ts';
import { COMMANDS, parseCommand } from '../packages/shared/src/index.js';
import type { GameInputEvent } from '../packages/shared/src/index.js';

let sequence = 0;
const NOW = 1800000000000;
const offline = { status: 'offline', username: '', roomId: '', error: '' } as const;
function event(text: string, user = 'alice', overrides: Partial<GameInputEvent> = {}): GameInputEvent {
  return { eventId: `drama-${++sequence}`, roomId: 'test', source: 'simulator', type: 'comment', user: { platformUserId: user, displayName: user }, payload: { text }, timestamp: NOW, ...overrides };
}
function office(users: string[]) { const game = new GameEngine('test', undefined, NOW); users.forEach(user => game.apply({ ...event('', user), type: 'member' }, NOW)); return game; }

test('new office commands parse and cost energy/cooldown like the original ones', () => {
  for (const command of ['tat', 'nem', 'cai', 'ngu', 'nhay', 'tanghoa']) assert.ok(Object.hasOwn(COMMANDS, command) && parseCommand(command)?.command === command);
  const game = office(['alice', 'bob']);
  assert.equal(game.apply(event('tat'), NOW).ok, true);
  assert.equal(game.apply(event('tat'), NOW + 1000).ok, false);
  assert.equal(game.data.players['simulator:alice']!.energy, 100 - COMMANDS['tat'].energy);
});

test('targeted actions point at the most recently active coworker', () => {
  const game = office(['alice', 'bob', 'carol']);
  game.apply(event('lamviec', 'bob'), NOW + 10);
  game.apply(event('tat', 'alice'), NOW + 20);
  const slap = game.data.effects.at(-1)!;
  assert.equal(slap.type, 'slap'); assert.equal(slap.playerId, 'simulator:alice'); assert.equal(slap.targetId, 'simulator:bob');
  game.apply(event('tanghoa', 'carol'), NOW + 30);
  assert.equal(game.data.effects.at(-1)!.targetId, 'simulator:alice');
});

test('drama meter fires each threshold once, reaches chaos, then cools down and re-arms', () => {
  const users = Array.from({ length: 8 }, (_, index) => `u${index}`);
  const game = office(users);
  const stages: string[] = [];
  const record = () => { for (const effect of game.data.effects.slice(-3)) if (['drama1', 'drama2', 'drama3', 'chaos'].includes(effect.type) && !stages.includes(effect.type)) stages.push(effect.type); };
  users.forEach(user => { game.apply(event('bocphot', user), NOW); record(); game.apply(event('cai', user), NOW); record(); });
  assert.deepEqual(stages, ['drama1', 'drama2', 'drama3', 'chaos']);
  assert.equal(game.view(offline).dramaMeter, 100); assert.equal(game.view(offline).dramaStage, 4);
  for (let second = 1; second <= 25; second++) game.tick(NOW + second * 1000);
  assert.ok(game.data.dramaMeter < 25, `meter cooled to ${game.data.dramaMeter}`);
  assert.equal(game.data.dramaCooling, false);
  assert.ok(game.data.dramaStage <= 1);
});

test('calming actions lower the meter and never go negative', () => {
  const game = office(['alice', 'bob']);
  game.apply(event('nhay'), NOW);
  assert.equal(game.data.dramaMeter, 0);
  game.apply(event('cai'), NOW); game.apply(event('tanghoa', 'bob'), NOW);
  assert.equal(game.data.dramaMeter, 0);
});

test('sleeping restores energy; gifts scale the party tier without touching player stats', () => {
  const game = office(['alice']);
  game.data.players['simulator:alice']!.energy = 50;
  game.apply(event('ngu'), NOW);
  assert.equal(game.data.players['simulator:alice']!.energy, 65);
  const before = structuredClone(game.data.players['simulator:alice']);
  for (const [count, tier] of [[1, 1], [10, 2], [30, 3]] as const) {
    game.apply(event('', 'alice', { type: 'gift', payload: { giftId: 'g', count } }), NOW);
    assert.equal(game.data.effects.at(-1)!.tier, tier);
  }
  assert.deepEqual(game.data.players['simulator:alice'], before);
});

test('chat comments from active players animate a canned line but stay rejected as commands', () => {
  const game = office(['alice', 'bob']);
  const result = game.apply(event('trưa nay ăn gì?'), NOW + 5000);
  assert.equal(result.ok, false);
  assert.equal(game.data.effects.at(-1)!.type, 'chat');
  assert.ok(!JSON.stringify(game.view(offline)).includes('trưa nay ăn gì'), 'raw comment text is never published');
  game.apply(event('again'), NOW + 6000);
  assert.equal(game.data.effects.filter(effect => effect.type === 'chat').length, 1, 'chat is rate limited per player');
});

test('snapshots saved before the drama meter existed still restore', () => {
  const game = office(['alice']);
  const legacy = game.export() as Partial<EngineData>;
  delete legacy.dramaMeter; delete legacy.dramaStage; delete legacy.dramaCooling;
  const restored = new GameEngine('test', legacy as EngineData, NOW);
  assert.equal(restored.view(offline).dramaMeter, 0);
  assert.equal(restored.apply(event('cai'), NOW).ok, true);
  assert.equal(restored.data.dramaMeter, 7);
});

test('navigation grid routes around furniture without cutting corners', () => {
  const grid = new NavGrid({ minX: -100, maxX: 100, minZ: -100, maxZ: 100 }, 10);
  grid.block({ minX: -60, maxX: 60, minZ: -5, maxZ: 5 }, 4);
  const path = grid.find({ x: 0, z: -60 }, { x: 0, z: 60 });
  assert.deepEqual(path.at(-1), { x: 0, z: 60 });
  let previous = { x: 0, z: -60 };
  for (const point of path.slice(0, -1)) { assert.ok(grid.clear(previous, point), 'every hop is walkable'); previous = point; }
  assert.ok(path.length >= 2, 'detour needs waypoints');
  assert.ok(path.some(point => Math.abs(point.x) > 64), 'the route detours past the padded wall end');
  assert.equal(grid.isFree(0, 0), false);
  const inside = grid.find({ x: -90, z: -90 }, { x: 0, z: 0 });
  assert.deepEqual(inside.at(-1), { x: 0, z: 0 }, 'targets inside furniture padding are still reached');
});
