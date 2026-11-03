/**
 * 2D layout of the office floor (540×720 design units) shared by the 3D world and its tests.
 * `desks` is the number of desks; it is NOT a cap on employees — viewers beyond it work standing.
 */
export const OFFICE = { width: 540, height: 720, desks: 12 } as const;
export const CAMERA_ELEVATION = Math.atan2(1000, 860);

export function officePoint(x: number, y: number) {
  return { x: x - OFFICE.width / 2, y: 0, z: (y - OFFICE.height / 2) / Math.sin(CAMERA_ELEVATION) };
}

export function seatPosition(slot: number) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= OFFICE.desks) throw new RangeError('Invalid office seat');
  return { x: 94 + slot % 3 * 176, y: 364 + Math.floor(slot / 3) * 100 };
}
