import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { GameState, Player } from '../packages/shared/src/index.js';
import { HUD, kpiPercent, spinePercent, topBosses, topSlaves, workClock } from '../apps/game-web/src/game/hud-metrics.ts';
import { OFFICE_FRAMING, SAFE_ZONE, STAGE_BANDS, officeFrameFraction, officeSafeFraction } from '../apps/game-web/src/game/safe-zone.ts';
import { THEME, themeHex, type ThemeToken } from '../apps/game-web/src/game/theme.ts';

const player = (id: string, fields: Partial<Player> = {}): Player => ({
  id, name: id, xp: 0, salary: 0, drama: 0, relationships: 0, energy: 100, role: 0, active: true, joinedAt: 0, lastActiveAt: 0, cooldowns: {}, ...fields,
});
const snapshot = (fields: Partial<GameState>) => ({ phase: 'work', remaining: 60, combo: 0, ...fields }) as GameState;

test('KPI blends day progress and combo, clamped to 0–100', () => {
  assert.equal(kpiPercent(null), 0);
  assert.equal(kpiPercent(snapshot({ phase: 'work', remaining: 60, combo: 0 })), 0);
  assert.equal(kpiPercent(snapshot({ phase: 'work', remaining: 60, combo: HUD.kpiComboTarget })), 50);
  assert.equal(kpiPercent(snapshot({ phase: 'results', remaining: 0, combo: HUD.kpiComboTarget * 9 })), 100);
  assert.equal(kpiPercent(snapshot({ phase: 'work', remaining: 60, combo: -4 })), 0);
  assert.equal(workClock(snapshot({ phase: 'work', remaining: 60 })).label, '08:00');
});

test('Cột sống is the average energy of clocked-in employees only', () => {
  assert.equal(spinePercent([]), null);
  assert.equal(spinePercent([player('a', { active: false, energy: 0 })]), null);
  assert.equal(spinePercent([player('a', { energy: 100 }), player('b', { energy: 20 }), player('c', { energy: 0, active: false })]), 60);
  assert.equal(spinePercent([player('a', { energy: 250 })]), 100);
});

test('Top Sếp ranks by role then XP; Top Nô Lệ Tư Bản by salary; both skip inactive and tie-break on id', () => {
  const roster = [
    player('intern-rich', { role: 0, xp: 50, salary: 900 }),
    player('manager', { role: 3, xp: 10, salary: 100 }),
    player('lead-b', { role: 2, xp: 500, salary: 300 }),
    player('lead-a', { role: 2, xp: 500, salary: 300 }),
    player('ceo-gone', { role: 5, xp: 9999, salary: 9999, active: false }),
  ];
  assert.deepEqual(topBosses(roster).map(item => item.id), ['manager', 'lead-a', 'lead-b']);
  assert.deepEqual(topSlaves(roster).map(item => item.id), ['intern-rich', 'lead-a', 'lead-b']);
  assert.equal(topBosses(roster, 1).length, 1);
  assert.deepEqual(topSlaves([]), []);
});

test('office keeps exactly 75% of the stage and the HUD band sits above the comment zone', () => {
  assert.equal(STAGE_BANDS.office, 0.75);
  assert.equal(STAGE_BANDS.top + STAGE_BANDS.office, 1);
  assert.ok(STAGE_BANDS.top <= 1 - SAFE_ZONE.bottom, 'critical HUD band ends above the TikTok comment zone');
  const fraction = officeSafeFraction();
  assert.ok(Math.abs(STAGE_BANDS.top + fraction * STAGE_BANDS.office - (1 - SAFE_ZONE.bottom)) < 1e-9);
  assert.ok(fraction > 0 && fraction < 1);
});

test('office framing fills its whole band by default and can fall back to the comment-safe frame', () => {
  assert.equal(OFFICE_FRAMING.mode, 'fill');
  assert.equal(officeFrameFraction(), 1);
  assert.equal(officeFrameFraction('safe'), officeSafeFraction());
});

test('stage CSS grid gives the office 75 of 100 rows and declares every theme token with the TS value', () => {
  const css = readFileSync(new URL('../apps/game-web/src/style.css', import.meta.url), 'utf8');
  // the six stage rows (header, meta, drama, boards, footer, office) must sum to 100 with the office at exactly 75
  const rows = css.match(/grid-template-rows:((?:minmax\(0,[\d.]+fr\) ?){6});/)?.[1];
  assert.ok(rows, 'stage declares six grid rows');
  const fractions = [...rows.matchAll(/minmax\(0,([\d.]+)fr\)/g)].map(match => Number(match[1]));
  assert.equal(fractions.reduce((sum, value) => sum + value, 0), 100);
  assert.equal(fractions.at(-1), 75);
  assert.equal(fractions.slice(0, -1).reduce((sum, value) => sum + value, 0), STAGE_BANDS.top * 100);
  assert.match(css, /grid-template-areas:"header" "meta" "drama" "boards" "footer" "office"/);
  for (const token of Object.keys(THEME) as ThemeToken[]) assert.ok(css.includes(`--t-${token}:${themeHex(token)}`), `--t-${token} must equal ${themeHex(token)}`);
});
