/**
 * Single source of the stage color palette. 3D materials (`engine3d/assets.ts` PALETTE) import these
 * values and `style.css` repeats them as `--t-*` custom properties; `tests/theme.test.ts` keeps the CSS in sync.
 */
export const THEME = {
  ink: 0x18243d,
  navy: 0x24365a,
  cream: 0xfff8ec,
  pastel: 0xcfe0f5,
  brass: 0xffc861,
  amber: 0xe7a23b,
  coral: 0xf06d4f,
  red: 0xd9443a,
  green: 0x5dbb7a,
  greenDeep: 0x3d8f5a,
  blue: 0x5b8bd6,
} as const;

export type ThemeToken = keyof typeof THEME;

/** `#rrggbb` form of a token, for CSS. */
export function themeHex(token: ThemeToken) { return `#${THEME[token].toString(16).padStart(6, '0')}`; }
