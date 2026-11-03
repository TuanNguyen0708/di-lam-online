import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.API_URL || 'http://127.0.0.1:3101';
const token = process.env.ADMIN_TOKEN;
if (!token) throw new Error('Run with node --env-file=.env --import tsx --test tests/integration/api.test.ts');
async function post(path: string, body: unknown, authorized = true) {
  return fetch(`${base}/api/admin/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
}
test('HTTP auth, validation, idempotency and server-owned source', async () => {
  assert.equal((await post('command', { command: 'seed' }, false)).status, 401);
  assert.equal((await post('command', { command: 'hack' })).status, 400);
  assert.equal((await post('simulate', { eventId: 123 })).status, 400);
  const id = `integration-${randomUUID()}`;
  const join = { eventId: randomUUID(), type: 'member', source: 'tiktok', roomId: 'evil-room', user: { platformUserId: id, displayName: '<Test>' }, payload: {} };
  const joined = await post('simulate', join); assert.equal(joined.status, 200); assert.equal((await joined.json()).ok, true);
  const hit = { ...join, type: 'comment', eventId: randomUUID(), payload: { text: 'damsep' } };
  await post('simulate', hit);
  const repeat = await post('simulate', hit); assert.equal((await repeat.json()).ok, true);
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.ok(state.players.some((player: { id: string }) => player.id === `simulator:${id}`));
  assert.ok(state.players.length <= 50); assert.ok(state.effects.length <= 15);
  assert.equal(JSON.stringify(state).includes(token!), false);
  const health = await (await fetch(`${base}/api/health`)).json(); assert.equal(health.ok, true);
});
