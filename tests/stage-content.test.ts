import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { COMMANDS } from '../packages/shared/src/index.js';

const requireWeb = createRequire(new URL('../apps/game-web/package.json', import.meta.url));
const { createElement } = requireWeb('react');
const { renderToStaticMarkup } = requireWeb('react-dom/server');

test('stage footer advertises every supported command and both complete vote arguments', async () => {
  const { Stage } = await tsImport('../apps/game-web/src/App.tsx', { parentURL: import.meta.url, tsconfig: fileURLToPath(new URL('../apps/game-web/tsconfig.json', import.meta.url)) });
  const html = renderToStaticMarkup(createElement(Stage, { state: null, connected: false }));
  const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
  const commands = [...footer.matchAll(/data-command="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(commands.sort(), Object.keys(COMMANDS).sort());
  assert.ok(footer.includes('vote dinhcong'));
  assert.ok(footer.includes('vote lamviec'));
  assert.ok(footer.includes('Tất cả lệnh comment'));
  assert.ok(html.indexOf('<footer') > html.indexOf('class="drama-card"'));
  assert.ok(html.includes('MẤT KẾT NỐI'));
});
