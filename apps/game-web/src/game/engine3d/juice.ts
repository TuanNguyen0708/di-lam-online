/**
 * Visual-juice tuning, one row per TikTok event level. Data only — OfficeScene/Director read it,
 * so feel can be tuned without touching choreography code.
 */
export type JuiceLevel = 'like' | 'comment' | 'gift1' | 'gift2' | 'gift3' | 'boss';
export type FlashColor = 'none' | 'gold' | 'red';

export interface JuiceSpec {
  /** Camera trauma added (0–1, squared internally, decays ~1.6/s). */
  shake: number;
  /** Full-frame color flash. */
  flash: FlashColor;
  /** Floating text over employees' heads ('' = none). */
  text: string;
  /** How many employees get the floating text. */
  textCount: number;
  /** Procedural "jump in the chair" strength applied to every employee (0 = none). */
  jolt: number;
}

export const JUICE: Record<JuiceLevel, JuiceSpec> = {
  like: { shake: 0, flash: 'none', text: '', textCount: 0, jolt: 0 },
  comment: { shake: 0.06, flash: 'none', text: '', textCount: 0, jolt: 0 },
  gift1: { shake: 0.25, flash: 'gold', text: '+LƯƠNG', textCount: 4, jolt: 0.5 },
  gift2: { shake: 0.5, flash: 'gold', text: '+THƯỞNG', textCount: 6, jolt: 0.8 },
  gift3: { shake: 0.8, flash: 'red', text: '+KPI x3', textCount: 8, jolt: 1 },
  boss: { shake: 0.2, flash: 'red', text: '', textCount: 0, jolt: 0.6 },
};

export const JUICE_LIMITS = {
  /** Max hearts per like snapshot (5 Hz), however many likes arrived. */
  likeBurstMax: 12,
  /** Likes in one snapshot needed before a "+N ❤" text appears. */
  likeTextMin: 10,
  /** Room combo at which keyboards start throwing sparks. */
  comboSparkThreshold: 8,
  /** Combo above the threshold at which spark chance reaches its cap. */
  comboSparkRange: 24,
  /** Spark chance per keystroke at the threshold and at the cap. */
  sparkChance: [0.15, 0.7] as const,
  /** Minimum seconds between "+KPI" pops from typing (whole room). */
  kpiPopInterval: 0.7,
  /** Minimum seconds between toast announcements (others queue, max 3). */
  announceInterval: 0.35,
  /** Seconds a red boss alert stays up. */
  bossAlertSeconds: 2.2,
} as const;

/** Hearts to emit for a like delta: logarithmic so 10 000 likes do not cost 10 000 particles. */
export function likeBurst(delta: number) {
  if (!Number.isFinite(delta) || delta <= 0) return 0;
  return Math.min(JUICE_LIMITS.likeBurstMax, 1 + Math.floor(Math.log2(delta)));
}

/** Gift tier (1–3, as sent by the server) → juice level. Out-of-range tiers are clamped. */
export function giftLevel(tier: number): JuiceLevel {
  const clamped = Math.min(3, Math.max(1, Math.round(Number.isFinite(tier) ? tier : 1)));
  return `gift${clamped}` as JuiceLevel;
}

/** Probability that one keystroke throws keyboard sparks at the given room combo (0 below threshold). */
export function sparkChance(combo: number) {
  const { comboSparkThreshold: threshold, comboSparkRange: range, sparkChance: [low, high] } = JUICE_LIMITS;
  if (!(combo >= threshold)) return 0;
  return low + (high - low) * Math.min(1, (combo - threshold) / range);
}
