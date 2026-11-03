import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const file = new URL('../.env', import.meta.url);
let content = existsSync(file) ? readFileSync(file, 'utf8') : readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
let changed = !existsSync(file);
for (const key of ['ADMIN_TOKEN', 'POSTGRES_PASSWORD']) {
  if (new RegExp(`^${key}=.+$`, 'm').test(content)) continue;
  const line = `${key}=${randomBytes(32).toString('hex')}`;
  content = new RegExp(`^${key}=`, 'm').test(content) ? content.replace(new RegExp(`^${key}=.*$`, 'm'), line) : `${content}\n${line}\n`;
  changed = true;
}
if (changed) {
  writeFileSync(file, content, { mode: 0o600 });
  console.log('Private local credentials are ready in .env. Paste ADMIN_TOKEN into the Game Master panel.');
}
