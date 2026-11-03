import { PHASES } from '@di-lam/shared';
import type { GameState, Player } from '@di-lam/shared';

/** HUD tuning. KPI and "Cột sống" are presentation-only: derived from the snapshot, never sent back. */
export const HUD = {
  /** Room combo that counts as a full KPI contribution. */
  kpiComboTarget: 20,
  /** KPI = day progress × day + combo progress × combo (weights sum to 1). */
  kpiWeights: { day: 0.5, combo: 0.5 },
  /** Names shown per leaderboard. */
  boardSize: 3,
} as const;

/** Maps the 5-minute round onto a 08:00 → 17:30 office day for the on-screen work clock. */
export function workClock(state: GameState | null) {
  if (!state) return { label: '08:00', progress: 0 };
  const phaseIndex = Math.max(0, PHASES.indexOf(state.phase));
  const elapsed = Math.min(300, phaseIndex * 60 + (60 - state.remaining));
  const minutes = 480 + Math.round(elapsed / 300 * 570);
  return { label: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`, progress: elapsed / 300 };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** Room KPI 0–100: half "how far through the workday", half "how hot the combo is". */
export function kpiPercent(state: GameState | null) {
  if (!state) return 0;
  const { day, combo } = HUD.kpiWeights;
  return Math.round(100 * (day * clamp01(workClock(state).progress) + combo * clamp01(state.combo / HUD.kpiComboTarget)));
}

/** "Cột sống" 0–100: average energy of active employees; null when nobody is clocked in. */
export function spinePercent(players: readonly Player[]) {
  const active = players.filter(player => player.active);
  if (!active.length) return null;
  return Math.round(active.reduce((sum, player) => sum + clamp01(player.energy / 100), 0) / active.length * 100);
}

/** Top Sếp: highest role first, then XP. Ties break on id so the board never flickers. */
export function topBosses(players: readonly Player[], size: number = HUD.boardSize) {
  return players.filter(player => player.active).sort((a, b) => b.role - a.role || b.xp - a.xp || a.id.localeCompare(b.id)).slice(0, size);
}

/** Top Nô Lệ Tư Bản: most virtual salary earned (hardest workers), then XP. */
export function topSlaves(players: readonly Player[], size: number = HUD.boardSize) {
  return players.filter(player => player.active).sort((a, b) => b.salary - a.salary || b.xp - a.xp || a.id.localeCompare(b.id)).slice(0, size);
}
