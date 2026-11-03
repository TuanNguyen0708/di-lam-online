import assert from 'node:assert/strict';
import test from 'node:test';
import { CAMERA_ELEVATION, OFFICE, officePoint, seatPosition } from '../apps/game-web/src/game/office-layout.ts';

test('twelve readable seats reserve separate sprite and two-line name areas', () => {
  const names = Array.from({ length: OFFICE.desks }, (_, slot) => {
    const seat = seatPosition(slot);
    assert.ok(seat.x - 79 >= 0 && seat.x + 79 <= OFFICE.width);
    assert.ok(seat.y - 51 >= 310 && seat.y + 39 <= 706);
    return { x: seat.x - 79, y: seat.y + 4, width: 158, height: 35 };
  });
  names.forEach((name, index) => names.slice(index + 1).forEach(other => {
    assert.ok(name.x + name.width <= other.x || other.x + other.width <= name.x || name.y + name.height <= other.y || other.y + other.height <= name.y);
  }));
  for (const invalid of [-1, OFFICE.desks, 1.5, NaN]) assert.throws(() => seatPosition(invalid), RangeError);
});

test('3D ground coordinates project to the same HTML nameplate anchors', () => {
  for (let slot = 0; slot < OFFICE.desks; slot++) {
    const seat = seatPosition(slot), point = officePoint(seat.x, seat.y);
    assert.equal(point.x + OFFICE.width / 2, seat.x);
    assert.ok(Math.abs(point.z * Math.sin(CAMERA_ELEVATION) + OFFICE.height / 2 - seat.y) < 1e-9);
    assert.equal(point.y, 0);
  }
});
