import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from '../apps/game-web/src/game/engine3d/pool.ts';
import { Spring, ease, quadBezier } from '../apps/game-web/src/game/engine3d/spring.ts';
import { JUICE, JUICE_LIMITS, giftLevel, likeBurst, sparkChance } from '../apps/game-web/src/game/engine3d/juice.ts';

test('pool never creates more than its capacity and recycles the oldest active item under spam', () => {
  // Arrange
  let created = 0;
  const resets: number[] = [];
  const pool = new Pool(() => ({ id: ++created }), 4, item => resets.push(item.id));
  // Act: 1000 acquisitions without a single release (event spam)
  const handed = Array.from({ length: 1000 }, () => pool.acquire());
  // Assert
  assert.equal(pool.createdCount, 4);
  assert.equal(pool.activeCount, 4);
  assert.equal(new Set(handed.map(item => item.id)).size, 4);
  assert.equal(handed[4]!.id, 1, 'fifth acquisition recycles the oldest (first) item');
  assert.equal(resets.length, 996, 'every recycle resets the item');
});

test('pool release and releaseWhere return items for reuse without allocating', () => {
  const pool = new Pool(() => ({ done: false }), 3);
  const [first, second, third] = [pool.acquire(), pool.acquire(), pool.acquire()];
  second.done = true; third.done = true;
  pool.releaseWhere(item => item.done);
  assert.equal(pool.activeCount, 1);
  pool.release(first); pool.release(first); // double release is a no-op
  assert.equal(pool.activeCount, 0);
  pool.acquire(); pool.acquire(); pool.acquire();
  assert.equal(pool.createdCount, 3);
  pool.clear();
  assert.equal(pool.activeCount, 0);
  assert.throws(() => new Pool(() => 1, 0), RangeError);
});

test('spring kicked by an impulse moves, then settles back to exactly zero', () => {
  const spring = new Spring(210, 15);
  spring.impulse(2.4);
  spring.update(1 / 60);
  assert.ok(spring.value > 0);
  let peak = 0;
  for (let frame = 0; frame < 240; frame++) peak = Math.max(peak, spring.update(1 / 60));
  assert.ok(peak > 0.05 && peak < 0.3, `peak stretch ${peak} stays in a readable range`);
  assert.equal(spring.value, 0);
  assert.equal(spring.velocity, 0);
});

test('spring result does not depend on frame rate', () => {
  const at60 = new Spring(140, 11), at144 = new Spring(140, 11);
  at60.impulse(150); at144.impulse(150);
  for (let frame = 0; frame < 15; frame++) at60.update(1 / 60);
  for (let frame = 0; frame < 36; frame++) at144.update(1 / 144);
  assert.ok(Math.abs(at60.value - at144.value) < 0.5, `${at60.value} vs ${at144.value}`);
});

test('easing curves start at 0, end at 1; outBack overshoots; bezier hits its end points', () => {
  for (const curve of Object.values(ease)) { assert.ok(Math.abs(curve(0)) < 1e-9); assert.ok(Math.abs(curve(1) - 1) < 1e-9); }
  assert.ok(Math.max(...Array.from({ length: 50 }, (_, index) => ease.outBack(index / 49))) > 1.05);
  assert.equal(quadBezier(2, 9, 5, 0), 2);
  assert.equal(quadBezier(2, 9, 5, 1), 5);
});

test('like bursts grow logarithmically and are capped', () => {
  assert.equal(likeBurst(0), 0);
  assert.equal(likeBurst(-5), 0);
  assert.equal(likeBurst(Number.NaN), 0);
  assert.equal(likeBurst(1), 1);
  assert.equal(likeBurst(8), 4);
  assert.equal(likeBurst(10_000_000), JUICE_LIMITS.likeBurstMax);
});

test('gift tiers map to escalating juice and clamp out-of-range tiers', () => {
  assert.equal(giftLevel(1), 'gift1');
  assert.equal(giftLevel(3), 'gift3');
  assert.equal(giftLevel(0), 'gift1');
  assert.equal(giftLevel(99), 'gift3');
  assert.equal(giftLevel(Number.NaN), 'gift1');
  assert.ok(JUICE.gift1.shake < JUICE.gift2.shake && JUICE.gift2.shake < JUICE.gift3.shake);
  assert.ok(JUICE.like.shake === 0, 'a like never shakes the camera');
  for (const spec of Object.values(JUICE)) assert.ok(spec.shake >= 0 && spec.shake <= 1 && spec.jolt >= 0 && spec.jolt <= 1);
});

test('keyboard sparks start at the combo threshold and cap at the configured chance', () => {
  const { comboSparkThreshold: threshold, comboSparkRange: range, sparkChance: [low, high] } = JUICE_LIMITS;
  assert.equal(sparkChance(threshold - 1), 0);
  assert.equal(sparkChance(Number.NaN), 0);
  assert.equal(sparkChance(threshold), low);
  assert.equal(sparkChance(threshold + range), high);
  assert.equal(sparkChance(threshold + range * 10), high);
});
