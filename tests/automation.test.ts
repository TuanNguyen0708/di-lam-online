import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, type EngineData } from '../apps/game-api/src/engine.js';
import { TikTokNormalizer } from '../apps/game-api/src/tiktok-normalizer.js';
import { splitTtsText, escapeXml } from '../apps/game-api/src/tts.js';
import { AUTOMATION, DEFAULT_SETTINGS, joinNames, mergeSettings, restoreSettings, validInput } from '../packages/shared/src/index.js';
import type { GameInputEvent, SpeechLine } from '../packages/shared/src/index.js';
import { queueLines } from '../apps/game-web/src/game/voice.ts';

let sequence = 0;
const NOW = 1800000000000;
function input(type: GameInputEvent['type'], user = 'alice', payload: GameInputEvent['payload'] = {}): GameInputEvent {
  return { eventId: `auto-${++sequence}`, roomId: 'test', source: 'simulator', type, user: { platformUserId: user, displayName: user }, payload, timestamp: NOW };
}
const offline = { status: 'offline', username: '', roomId: '', error: '' } as const;
const lines = (game: GameEngine) => game.view(offline, 'memory', NOW).speech.map(line => line.text);

test('a viewer joining the LIVE is in the office at once (no check-in) and greeted once by name', () => {
  // Arrange
  const game = new GameEngine('test', undefined, NOW);
  // Act
  assert.equal(game.apply(input('member', 'An'), NOW).ok, true);
  game.apply(input('member', 'An'), NOW + 1000);
  game.tick(NOW + AUTOMATION.greetIntervalMs);
  game.tick(NOW + AUTOMATION.greetIntervalMs * 3);
  // Assert
  const player = game.data.players['simulator:An']!;
  assert.equal(player.active, true);
  assert.equal(player.auto, true);
  assert.equal(game.data.effects.filter(effect => effect.type === 'join').length, 1);
  assert.deepEqual(lines(game), [DEFAULT_SETTINGS.greetTemplate.replace('{names}', 'An').replace('{company}', DEFAULT_SETTINGS.companyName)]);
});

test('greetings are batched three names per sentence, oldest first, and paced', () => {
  const game = new GameEngine('test', undefined, NOW);
  game.updateSettings({ greetTemplate: 'Xin chào nhân viên {names}!' });
  for (const name of ['A', 'B', 'C', 'D']) game.apply(input('member', name), NOW);
  game.tick(NOW + AUTOMATION.greetIntervalMs);
  game.tick(NOW + AUTOMATION.greetIntervalMs + 1000); // too soon for the next sentence
  assert.deepEqual(lines(game), ['Xin chào nhân viên A, B và C!']);
  game.tick(NOW + AUTOMATION.greetIntervalMs * 2);
  assert.deepEqual(lines(game), ['Xin chào nhân viên A, B và C!', 'Xin chào nhân viên D!']);
});

test('there is no check-in setting; voice off queues nothing; a first command greets too; an idled-out viewer who comments is back', () => {
  const game = new GameEngine('test', undefined, NOW);
  assert.equal(game.updateSettings({ autoCheckIn: false }).ok, false, 'the old check-in toggle no longer exists');

  const mute = new GameEngine('test', undefined, NOW);
  mute.updateSettings({ voice: false });
  mute.apply(input('member', 'Ca'), NOW);
  mute.apply(input('gift', 'Ca', { count: 1 }), NOW);
  mute.tick(NOW + AUTOMATION.greetIntervalMs);
  assert.equal(mute.data.players['simulator:Ca']?.active, true, 'entering does not depend on the voice');
  assert.deepEqual(lines(mute), []);

  const joined = new GameEngine('test', undefined, NOW);
  joined.apply(input('comment', 'Da', { text: 'lamviec' }), NOW);
  joined.tick(NOW + AUTOMATION.greetIntervalMs);
  assert.equal(lines(joined).length, 1);
  assert.equal(joined.data.players['simulator:Da']!.auto, false);

  const back = new GameEngine('test', undefined, NOW);
  back.apply(input('member', 'Ly'), NOW);
  back.tick(NOW + AUTOMATION.autoCheckoutMs + 1000);
  assert.equal(back.data.players['simulator:Ly']!.active, false);
  back.apply(input('comment', 'Ly', { text: 'trưa nay ăn gì?' }), NOW + AUTOMATION.autoCheckoutMs + 2000);
  assert.equal(back.data.players['simulator:Ly']!.active, true, 'still watching = still in the office');
});

test('gift thanks jump the queue and repeat at most once per window per viewer; follows are thanked once', () => {
  const game = new GameEngine('test', undefined, NOW);
  game.apply(input('gift', 'Em', { count: 1 }), NOW);
  game.apply(input('gift', 'Em', { count: 5 }), NOW + 1000);
  game.apply(input('gift', 'Em', { count: 1 }), NOW + AUTOMATION.giftThanksMs + 1);
  const speech = game.view(offline, 'memory', NOW).speech;
  assert.equal(speech.filter(line => line.text.includes('Em đã gửi quà')).length, 2);
  assert.ok(speech.every(line => line.priority));
  game.apply(input('follow', 'Em'), NOW);
  game.apply(input('follow', 'Em'), NOW + 5000);
  assert.equal(lines(game).filter(text => text.includes('theo dõi')).length, 1);
});

test('share reminder fires on its interval, thanks recent names, and 0 minutes disables it', () => {
  const game = new GameEngine('test', undefined, NOW);
  game.updateSettings({ shareReminderMinutes: 5 });
  game.apply(input('comment', 'Gia', { text: 'lamviec' }), NOW);
  game.tick(NOW + 1000); // starts the clock
  game.tick(NOW + 4 * 60000);
  assert.ok(!lines(game).some(text => text.includes('chia sẻ')));
  game.tick(NOW + 1000 + 5 * 60000);
  assert.ok(lines(game).some(text => text.includes('chia sẻ') && text.includes('Gia')));

  const off = new GameEngine('test', undefined, NOW);
  off.updateSettings({ shareReminderMinutes: 0 });
  off.tick(NOW + 1000); off.tick(NOW + 61 * 60000);
  assert.ok(!lines(off).some(text => text.includes('chia sẻ')));
});

test('any viewer idle for 5 minutes leaves the office, commenters included; activity resets the clock', () => {
  const game = new GameEngine('test', undefined, NOW);
  game.apply(input('member', 'Lurker'), NOW);
  game.apply(input('member', 'Talker'), NOW);
  game.apply(input('comment', 'Talker', { text: 'lamviec' }), NOW + 60000);
  game.tick(NOW + AUTOMATION.autoCheckoutMs + 1000);
  assert.equal(game.data.players['simulator:Lurker']!.active, false);
  assert.equal(game.data.players['simulator:Talker']!.active, true, 'commented 1 min later: still within 5 min');
  game.tick(NOW + 60000 + AUTOMATION.autoCheckoutMs + 1);
  assert.equal(game.data.players['simulator:Talker']!.active, false, 'TikTok has no leave event: idle commenters walk out');
  assert.ok(!game.view(offline, 'memory', NOW).players.some(player => player.id === 'simulator:Talker'), 'gone from the stage roster');
});

test('likes and gifts keep a viewer in the office', () => {
  const game = new GameEngine('test', undefined, NOW);
  game.apply(input('member', 'Fan'), NOW);
  game.apply(input('like', 'Fan', { count: 3 }), NOW + AUTOMATION.autoCheckoutMs - 1000);
  game.tick(NOW + AUTOMATION.autoCheckoutMs + 1000);
  assert.equal(game.data.players['simulator:Fan']!.active, true);
});

test('settings are validated whole: bad values and unknown keys change nothing', () => {
  for (const patch of [null, [], { voiceRate: 3 }, { voiceRate: '1' }, { shareReminderMinutes: 2.5 }, { greetTemplate: 'Xin chào!' }, { companyName: '   ' }, { voice: 'yes' }, { hacker: true }, { voice: false, voiceRate: 9 }]) {
    assert.equal(mergeSettings(DEFAULT_SETTINGS, patch).ok, false, JSON.stringify(patch));
  }
  const merged = mergeSettings(DEFAULT_SETTINGS, { companyName: '  Công ty <b>ABC</b> https://x.y  ', voiceRate: 1.234, npcs: false });
  assert.ok(merged.ok);
  assert.equal(merged.settings.companyName, 'Công ty b ABC /b');
  assert.equal(merged.settings.voiceRate, 1.23);
  assert.equal(merged.settings.npcs, false);
  const game = new GameEngine('test', undefined, NOW);
  assert.equal(game.updateSettings({ voice: false, voiceRate: 9 }).ok, false);
  assert.equal(game.data.settings.voice, true, 'a rejected patch is not partially applied');
});

test('reset wipes the session but keeps the operator settings; old snapshots load default settings', () => {
  const game = new GameEngine('test', undefined, NOW);
  game.updateSettings({ companyName: 'Công ty Mèo', npcs: false });
  game.apply(input('member', 'Hà'), NOW);
  game.control('reset', NOW + 1000);
  assert.equal(game.data.settings.companyName, 'Công ty Mèo');
  assert.equal(game.data.settings.npcs, false);
  assert.deepEqual(game.data.players, {});
  game.apply(input('member', 'Hà'), NOW + 2000);
  game.tick(NOW + 2000 + AUTOMATION.greetIntervalMs);
  assert.equal(lines(game).length, 1, 'greeted again in the new session');

  const legacy = structuredClone(new GameEngine('test', undefined, NOW).export()) as Partial<EngineData>;
  for (const key of ['settings', 'speech', 'greeted', 'thanked', 'joiners', 'giftThanks', 'recent', 'greetAt', 'shareAt'] as const) delete legacy[key];
  const restored = new GameEngine('test', legacy as EngineData, NOW);
  assert.deepEqual(restored.data.settings, DEFAULT_SETTINGS);
  assert.equal(restored.apply(input('member', 'Cũ'), NOW).ok, true);

  // a room saved while the check-in toggle existed: the obsolete key is dropped, valid values are kept
  const older = structuredClone(new GameEngine('test', undefined, NOW).export());
  (older.settings as unknown as Record<string, unknown>) = { ...DEFAULT_SETTINGS, autoCheckIn: false, companyName: 'Công ty Cũ', voiceRate: 99 };
  const upgraded = new GameEngine('test', older, NOW);
  assert.equal('autoCheckIn' in upgraded.data.settings, false);
  assert.deepEqual(upgraded.data.settings, DEFAULT_SETTINGS, 'one invalid value (voiceRate 99) falls back to defaults rather than half-loading');
  assert.equal(restoreSettings({ ...DEFAULT_SETTINGS, autoCheckIn: false, companyName: 'Công ty Cũ' }).companyName, 'Công ty Cũ');
  assert.deepEqual(restoreSettings(null), DEFAULT_SETTINGS);
});

test('"Đọc ngay" and samples need the voice on and are priority lines', () => {
  const game = new GameEngine('test', undefined, NOW);
  assert.equal(game.speak('   ').ok, false);
  assert.equal(game.speak('Cảm ơn cả nhà <3').ok, true);
  assert.equal(game.speakSample('greet').ok, true);
  const speech = game.view(offline, 'memory', NOW).speech;
  assert.equal(speech[0]!.text, 'Cảm ơn cả nhà 3');
  assert.ok(speech.every(line => line.priority));
  game.updateSettings({ voice: false });
  assert.equal(game.speak('xin chào').ok, false);
  for (let index = 0; index < AUTOMATION.speech + 5; index++) { game.updateSettings({ voice: true }); game.speak(`câu ${index}`); }
  assert.equal(game.view(offline, 'memory', NOW).speech.length, AUTOMATION.speech);
});

test('TikTok member events normalize and validate; helpers format names and TTS chunks', () => {
  const normalizer = new TikTokNormalizer('test');
  const member = normalizer.normalize('member', { msgId: 'm1', user: { userId: '42', nickname: 'Linh' } }, NOW);
  assert.equal(member?.type, 'member');
  assert.equal(member?.user.displayName, 'Linh');
  assert.equal(validInput(member), true);
  assert.equal(normalizer.normalize('member', { msgId: 'm1', user: { userId: '42' } }, NOW), null, 'duplicate message ids are dropped');
  assert.equal(joinNames([]), '');
  assert.equal(joinNames(['A']), 'A');
  assert.equal(joinNames(['A', 'B']), 'A và B');
  assert.equal(joinNames(['A', 'B', 'C']), 'A, B và C');
  assert.equal(escapeXml('A & <B>'), 'A &amp; &lt;B&gt;');
  const chunks = splitTtsText(`${'xin chào, '.repeat(40)}hết.`);
  assert.ok(chunks.length > 1 && chunks.every(chunk => chunk.length <= 190));
});

test('a correct command from a viewer who has not joined clocks them in, then the command runs for their character', () => {
  // Arrange
  const game = new GameEngine('test', undefined, NOW);
  const hp = game.data.bossHp;
  // Act
  const result = game.apply(input('comment', 'Tú', { text: 'damsep' }), NOW);
  // Assert: join effect first (character spawns), then the hit effect for the same player
  assert.equal(result.ok, true);
  assert.ok(game.data.bossHp < hp);
  const mine = game.data.effects.filter(effect => effect.playerId === 'simulator:Tú').map(effect => effect.type);
  assert.deepEqual(mine, ['join', 'hit']);
  assert.equal(game.data.players['simulator:Tú']!.auto, false, 'a commenter is engaged, never idled out');
});

test('a correct command that cannot run now makes the character say why, at most once per 3 s', () => {
  const game = new GameEngine('test', undefined, NOW);
  game.apply(input('comment', 'Vy', { text: 'damsep' }), NOW);
  game.apply(input('comment', 'Vy', { text: 'damsep' }), NOW + 1000); // cooldown
  game.apply(input('comment', 'Vy', { text: 'damsep' }), NOW + 1500); // still cooldown, throttled
  const denied = game.data.effects.filter(effect => effect.type === 'denied');
  assert.equal(denied.length, 1);
  assert.equal(denied[0]!.playerId, 'simulator:Vy');
  assert.match(denied[0]!.text, /Đợi \ds nữa!/);
  game.data.players['simulator:Vy']!.energy = 0;
  game.apply(input('comment', 'Vy', { text: 'nem' }), NOW + 4100);
  assert.equal(game.data.effects.filter(effect => effect.type === 'denied').at(-1)!.text, 'Hết năng lượng! Gõ cafe');
});

test('stage voice queue plays priority lines first and drops the oldest normal lines when full', () => {
  const line = (id: number, priority = false): SpeechLine => ({ id, text: `#${id}`, priority });
  const queued = queueLines([line(1), line(2)], [line(3, true), line(4)], 3);
  assert.deepEqual(queued.map(item => item.id), [3, 2, 4]);
  const allPriority = queueLines([], [line(1, true), line(2, true), line(3, true)], 2);
  assert.deepEqual(allPriority.map(item => item.id), [2, 3]);
});
