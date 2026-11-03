import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
async function freePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
test('durable mode restores committed state and duplicate protection after process restart', { skip: !process.env.DATABASE_URL || !process.env.REDIS_URL, timeout: 60000 }, async () => {
  const port = await freePort();
  const room = `test-${randomUUID()}`;
  const base = `http://127.0.0.1:${port}`;
  const token = process.env.ADMIN_TOKEN!;
  let child: ChildProcess | undefined;
  let log = '';
  const start = async () => {
    child = spawn(process.execPath, [fileURLToPath(new URL('../../apps/game-api/dist/main.js', import.meta.url))], { env: { ...process.env, PORT: String(port), ROOM_ID: room }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.on('data', data => { log += String(data); }); child.stderr!.on('data', data => { log += String(data); });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`Durable API exited: ${log}`);
      try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error(`Durable API failed to start: ${log}`);
  };
  const stop = async () => {
    if (child && child.exitCode === null) { const closed = once(child, 'close'); child.kill(); await closed; }
  };
  const post = async (eventId: string, text: string) => {
    const response = await fetch(`${base}/api/admin/simulate`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ eventId, type: 'comment', user: { platformUserId: 'durable-user', displayName: 'Nhân viên bền bỉ' }, payload: { text } }) });
    assert.equal(response.status, 200); return response.json();
  };
  try {
    await start();
    assert.equal((await post('persist-join', 'lamviec')).ok, true); // first command clocks the viewer in
    assert.equal((await post('persist-hit', 'damsep')).ok, true);
    const before = await (await fetch(`${base}/api/state`)).json(); assert.equal(before.storage, 'postgres');
    await stop();
    await start();
    const after = await (await fetch(`${base}/api/state`)).json();
    assert.equal(after.sessionId, before.sessionId); assert.equal(after.bossHp, before.bossHp);
    assert.equal(after.employeeCount, 1); assert.ok(after.players[0].xp >= before.players[0].xp);
    assert.equal((await post('persist-hit', 'damsep')).ok, true);
    assert.equal((await (await fetch(`${base}/api/state`)).json()).bossHp, before.bossHp);
  } finally { await stop(); }
});
