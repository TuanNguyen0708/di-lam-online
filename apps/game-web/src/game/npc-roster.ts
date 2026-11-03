import type { Archetype } from './engine3d/character';

/**
 * Ambient NPC coworkers (not viewers). The boss and the manager are separate: gameplay needs them, so they always
 * stay. Kept free of three.js so the HUD can count NPCs without loading the 3D bundle.
 */
export const NPC_ROSTER: readonly { id: string; name: string; archetype: Archetype }[] = [
  { id: 'npc:intern', name: 'Thực tập sinh', archetype: 'intern' },
  { id: 'npc:drama', name: 'Chị Hóng Hớt', archetype: 'drama' },
  { id: 'npc:lazy', name: 'Anh Ngủ Gật', archetype: 'lazy' },
  { id: 'npc:gamer', name: 'IT Game Thủ', archetype: 'gamer' },
  { id: 'npc:worker', name: 'Kế Toán', archetype: 'worker' },
];
