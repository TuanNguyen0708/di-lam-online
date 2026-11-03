import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../apps/game-api/src/engine.js';
import { TikTokNormalizer } from '../apps/game-api/src/tiktok-normalizer.js';
import type { RawTikTok } from '../apps/game-api/src/tiktok-normalizer.js';
import { LIMITS, parseCommand, validInput } from '../packages/shared/src/index.js';
import type { GameInputEvent } from '../packages/shared/src/index.js';

let sequence = 0;
const NOW = 1800000000000;
function event(text: string, user = 'alice', overrides: Partial<GameInputEvent> = {}): GameInputEvent {
  return { eventId: `test-${++sequence}`, roomId: 'test', source: 'simulator', type: 'comment', user: { platformUserId: user, displayName: user }, payload: { text }, timestamp: NOW, ...overrides };
}
/** The viewer entered the LIVE room (auto check-in; there is no join command). */
function member(user = 'alice', overrides: Partial<GameInputEvent> = {}): GameInputEvent {
  return event('', user, { type: 'member', payload: {}, ...overrides });
}
const offline = { status: 'offline', username: '', roomId: '', error: '' } as const;
function advance(engine: GameEngine, from: number, duration: number) { for (let elapsed = 1000; elapsed <= duration; elapsed += 1000) engine.tick(from + elapsed); }
test('exact command parsing and trust-boundary validation', () => {
  assert.deepEqual(parseCommand('  VOTE   dinhcong '), { command: 'vote', argument: 'dinhcong' });
  // legacy "!" prefix is still accepted
  assert.deepEqual(parseCommand('  !VOTE   dinhcong '), { command: 'vote', argument: 'dinhcong' });
  assert.deepEqual(parseCommand('cafe'), { command: 'cafe', argument: '' });
  assert.deepEqual(parseCommand('!cafe'), { command: 'cafe', argument: '' });
  for (const text of ['!', '!!cafe', 'cafe!']) assert.equal(parseCommand(text), null);
  for (const text of ['!damsepfoo', 'hello join', '__proto__', 'constructor']) assert.equal(parseCommand(text), null);
  assert.equal(validInput(member()), true);
  assert.equal(validInput(member('alice', { payload: { count: -1 } })), false);
  assert.equal(validInput(member('alice', { payload: { text: 'a'.repeat(301) } })), false);
  for (const malformed of [null, {}, { user: null }, { ...member(), eventId: '' }]) assert.equal(validInput(malformed), false);
});
test('join is stable by platform ID; duplicate events do not repeat actions', () => {
  const game = new GameEngine('test', undefined, NOW);
  game.apply(member(), NOW);
  const hit = event('damsep');
  assert.equal(game.apply(hit, NOW).ok, true);
  const before = game.export();
  assert.equal(game.apply(hit, NOW + 10000).duplicate, true);
  assert.deepEqual(game.export(), before);
  game.apply(member('alice', { user: { platformUserId: 'alice', displayName: 'Renamed' } }), NOW);
  assert.equal(Object.keys(game.data.players).length, 1);
});
test('shared engine enforces cooldown, energy and room; there is no join command and no check-in step', () => {
  const game = new GameEngine('test', undefined, NOW);
  assert.equal(game.apply(member('alice', { roomId: 'other' }), NOW).ok, false);
  assert.equal(parseCommand('join'), null);
  assert.equal(game.apply(event('join'), NOW).ok, false, '"join" is plain chat');
  assert.equal(game.data.players['simulator:alice'], undefined, 'plain chat from a stranger does not create a profile');
  // a first real command puts the viewer in the office and is performed at once
  assert.equal(game.apply(event('damsep'), NOW).ok, true);
  assert.equal(game.data.players['simulator:alice']!.active, true);
  assert.equal(game.apply(event('damsep'), NOW + 4999).ok, false);
  assert.equal(game.apply(event('damsep'), NOW + 5000).ok, true);
  game.data.players['simulator:alice']!.energy = 0;
  const hp = game.data.bossHp;
  assert.equal(game.apply(event('damsep'), NOW + 10000).ok, false);
  assert.equal(game.data.bossHp, hp);
  assert.equal(game.apply(event('cafe'), NOW + 10000).ok, true);
  assert.equal(game.data.players['simulator:alice']!.energy, 25);
});
test('one vote per identity; gift has no XP, damage or vote advantage', () => {
  const game = new GameEngine('test', undefined, NOW);
  game.apply(member(), NOW);
  assert.equal(game.apply(event('vote dinhcong'), NOW).ok, false);
  game.control('drama', NOW);
  game.apply(event('vote dinhcong'), NOW);
  game.apply(event('vote dinhcong'), NOW);
  assert.deepEqual(game.view(offline).votes, { strike: 1, work: 0 });
  game.apply(event('vote lamviec'), NOW);
  assert.deepEqual(game.view(offline).votes, { strike: 0, work: 1 });
  const player = structuredClone(game.data.players['simulator:alice']);
  const hp = game.data.bossHp;
  game.apply(event('', 'alice', { type: 'gift', payload: { giftId: '1', count: 9999 } }), NOW);
  assert.deepEqual(game.data.players['simulator:alice'], player);
  assert.equal(game.data.bossHp, hp);
  assert.deepEqual(game.view(offline).votes, { strike: 0, work: 1 });
});
test('five phases loop, pause freezes time, resign preserves stats and cooldowns', () => {
  const game = new GameEngine('test', undefined, NOW);
  game.apply(member(), NOW); game.apply(event('damsep'), NOW);
  game.control('pause', NOW); advance(game, NOW, 10000);
  assert.equal(game.data.elapsed, 0);
  assert.equal(game.apply(event('dapban'), NOW + 10000).ok, false);
  game.control('resume', NOW + 10000);
  advance(game, NOW + 10000, 60000); assert.equal(game.data.phase, 'incident');
  advance(game, NOW + 70000, 60000); assert.equal(game.data.phase, 'vote');
  advance(game, NOW + 130000, 60000); assert.equal(game.data.phase, 'battle');
  advance(game, NOW + 190000, 60000); assert.equal(game.data.phase, 'results');
  advance(game, NOW + 250000, 60000); assert.equal(game.data.phase, 'work'); assert.equal(game.data.day, 2);
  const player = game.data.players['simulator:alice']!;
  const xp = player.xp, cooldowns = structuredClone(player.cooldowns);
  game.apply(event('nghiviec'), NOW + 310000); assert.equal(player.active, false);
  game.apply(member(), NOW + 310001); assert.equal(player.xp, xp); assert.deepEqual(player.cooldowns, cooldowns);
});
test('bounded snapshots and dedupe expire; saved state restores protection', () => {
  const game = new GameEngine('test', undefined, NOW);
  for (let index = 0; index < 100; index++) game.apply(member(`user-${index}`), NOW);
  const snapshot = game.view(offline);
  assert.equal(snapshot.players.length, LIMITS.visible); assert.equal(snapshot.employeeCount, 100);
  assert.ok(snapshot.effects.length <= LIMITS.effects); assert.ok(snapshot.feed.length <= LIMITS.feed);
  const hit = event('damsep', 'user-0'); game.apply(hit, NOW);
  const restored = new GameEngine('test', game.export(), NOW);
  assert.equal(restored.apply(hit, NOW + 1000).duplicate, true);
  assert.equal(restored.apply(hit, NOW + LIMITS.dedupeTtl + 1).duplicate, undefined);
});
test('HR consequence chain and rescue require a teammate', () => {
  const game = new GameEngine('test', undefined, NOW);
  game.apply(member(), NOW);
  assert.equal(game.apply(event('cuu'), NOW).ok, false);
  game.apply(member('bob'), NOW);
  for (let index = 0; index < 5; index++) game.apply(event('dapban'), NOW + index * 3000);
  assert.ok(game.data.feed.some(item => item.text.includes('HR xuất hiện')));
  game.apply(event('cuu'), NOW + 15000);
  assert.equal(game.data.rescued, true);
  assert.equal(game.data.players['simulator:alice']!.relationships, 1);
});
test('boss HP clamps at zero and victory rewards happen once', () => {
  const game = new GameEngine('test', undefined, NOW);
  game.apply(member(), NOW); game.data.bossHp = 1;
  game.apply(event('damsep'), NOW); assert.equal(game.data.bossHp, 0);
  const xp = game.data.players['simulator:alice']!.xp;
  assert.equal(game.apply(event('damsep'), NOW + 6000).ok, false);
  assert.equal(game.data.players['simulator:alice']!.xp, xp);
});
test('TikTok v3 identity, content, cumulative streak and duplicate finals', () => {
  const normalizer = new TikTokNormalizer('test');
  const base: RawTikTok = { user: { id: 42n, nickname: 'Mèo Mun' }, giftId: 1, gift: { type: 1 }, groupId: 'streak-1' };
  const first = normalizer.normalize('gift', { ...base, common: { msgId: 'm1' }, repeatCount: 1, repeatEnd: 0 }, NOW);
  const next = normalizer.normalize('gift', { ...base, common: { msgId: 'm2' }, repeatCount: 3, repeatEnd: 0 }, NOW);
  const final = normalizer.normalize('gift', { ...base, common: { msgId: 'm3' }, repeatCount: 3, repeatEnd: 1 }, NOW);
  assert.equal(first?.payload.count, 1); assert.equal(next?.payload.count, 2); assert.equal(final, null);
  assert.equal(normalizer.normalize('gift', { ...base, common: { msgId: 'm4' }, repeatCount: 3, repeatEnd: 1 }, NOW), null);
  assert.equal(normalizer.normalize('gift', { ...base, groupId: 'streak-2', common: { msgId: 'm5' }, repeatCount: 1, repeatEnd: 0 }, NOW)?.payload.count, 1);
  const chat = { user: { id: 42n, nickname: 'New Name' }, common: { msgId: 'chat-1' }, content: 'join' };
  assert.equal(normalizer.normalize('comment', chat, NOW)?.user.platformUserId, '42');
  assert.equal(normalizer.normalize('comment', chat, NOW), null);
  assert.equal(normalizer.normalize('comment', { content: 'join', nickname: 'no stable id' }, NOW), null);
});
test('every successful command writes a stage feed line', () => {
  const game = new GameEngine('test', undefined, NOW);
  game.apply(member('feeder'), NOW);
  for (const [index, text] of ['damsep', 'dapban', 'cafe', 'lamviec', 'ngu', 'nhay'].entries()) {
    const before = game.data.feed[0]?.id;
    assert.equal(game.apply(event(text, 'feeder'), NOW + (index + 1) * 60000).ok, true, text);
    assert.notEqual(game.data.feed[0]?.id, before, `${text} should add a feed line`);
    assert.ok(game.data.feed.some(item => item.text.includes('feeder')), `${text} feed line names the player`);
  }
});
