import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
const base = process.env.API_URL || 'http://127.0.0.1:3101';
const token = process.env.ADMIN_TOKEN;
if (!token) throw new Error('Run pnpm run setup first, then pnpm simulate.');
const players = Number(process.argv[2] || 50);
const actions = Number(process.argv[3] || 1000);
if (!Number.isInteger(players) || players < 1 || players > 1000 || !Number.isInteger(actions) || actions < 1 || actions > 50000) throw new Error('Usage: pnpm simulate [players:1..1000] [actions:1..50000]');
let completed = 0, rejected = 0, httpErrors = 0;
const latencies = [];
async function send(index, text, type = 'comment') {
  const start = performance.now();
  const response = await fetch(`${base}/api/admin/simulate`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ eventId: randomUUID(), type, user: { platformUserId: `load-${index}`, displayName: `Nhân viên ${index + 1}` }, payload: { text } }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) { httpErrors++; return; }
  const result = await response.json();
  if (result.ok) completed++; else rejected++;
  latencies.push(performance.now() - start);
}
const start = performance.now();
for (let index = 0; index < players; index++) { await send(index, '', 'member'); await new Promise(resolve => setTimeout(resolve, 20)); }
const commands = ['damsep', 'dapban', 'lamviec', 'cafe', 'bocphot', 'cuu'];
for (let index = 0; index < actions; index++) { await send(index % players, commands[index % commands.length]); await new Promise(resolve => setTimeout(resolve, 20)); }
latencies.sort((left, right) => left - right);
console.log(JSON.stringify({ players, actions, accepted: completed, gameplayRejected: rejected, httpErrors, durationSeconds: Number(((performance.now() - start) / 1000).toFixed(2)), latencyP95Ms: Number((latencies[Math.floor(latencies.length * .95)] || 0).toFixed(2)), note: 'Cooldown/energy rejections are expected. This measures HTTP acknowledgement, not TikTok delivery latency or rendering FPS.' }, null, 2));
if (httpErrors) process.exitCode = 1;
