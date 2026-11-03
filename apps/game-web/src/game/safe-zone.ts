/**
 * TikTok LIVE portrait safe zones, as fractions of the 9:16 stage (1080×1920).
 * [Unverified] TikTok does not publish exact overlay sizes; these are tunable defaults:
 * the comment list covers roughly the bottom third and the like/share column sits on the right edge.
 */
export const SAFE_ZONE = {
  /** Bottom band reserved for TikTok comments — no critical HUD here. */
  bottom: 0.35,
  /** Right band reserved for TikTok's like/share buttons (below the top band). */
  right: 0.14,
} as const;

/** Vertical stage bands. The 3D office keeps exactly 75% of the frame height (layout contract). */
export const STAGE_BANDS = { top: 0.25, office: 0.75 } as const;

/**
 * Fraction of the office canvas height (from its top edge) that stays visible above the comment zone.
 */
export function officeSafeFraction() {
  return (1 - SAFE_ZONE.bottom - STAGE_BANDS.top) / STAGE_BANDS.office;
}

/**
 * How the camera frames the office inside its 75% band.
 * `fill`: the office fills the whole band (operator choice, 2026-11-03) — the front desk rows run under TikTok's
 * comments, but every critical HUD element stays in the top band. `safe`: the office is framed above the comment
 * zone and the lower band shows floor only.
 */
export const OFFICE_FRAMING: { mode: 'fill' | 'safe' } = { mode: 'fill' };

/** Canvas-height fraction the camera fits the office into, per `OFFICE_FRAMING.mode`. */
export function officeFrameFraction(mode: 'fill' | 'safe' = OFFICE_FRAMING.mode) {
  return mode === 'fill' ? 1 : officeSafeFraction();
}
