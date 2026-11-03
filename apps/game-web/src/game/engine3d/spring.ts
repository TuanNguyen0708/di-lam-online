/**
 * Damped spring (rest value 0) for procedural secondary motion: squash & stretch, hops, jolts.
 * Integrated with fixed sub-steps so the result does not depend on frame rate.
 */
export class Spring {
  value = 0;
  velocity = 0;
  /**
   * @param stiffness pull back toward 0 (higher = faster oscillation)
   * @param damping velocity loss (higher = settles sooner, less overshoot)
   */
  constructor(public stiffness = 170, public damping = 16) {}
  /** Adds instantaneous velocity (a kick). */
  impulse(velocity: number) { this.velocity += velocity; }
  /** Advances the spring by `dt` seconds and returns the new value. */
  update(dt: number) {
    if (dt <= 0) return this.value;
    const steps = Math.min(8, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let step = 0; step < steps; step++) {
      this.velocity += (-this.stiffness * this.value - this.damping * this.velocity) * h;
      this.value += this.velocity * h;
    }
    if (Math.abs(this.value) < 1e-4 && Math.abs(this.velocity) < 1e-3) { this.value = 0; this.velocity = 0; }
    return this.value;
  }
  reset() { this.value = 0; this.velocity = 0; }
}

/** Easing curves on t ∈ [0, 1]; every curve maps 0 → 0 and 1 → 1. */
export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  /** Overshoots past 1 then settles: the "pop" in juice. */
  outBack: (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; },
} as const;

/** Point on a quadratic Bézier curve (one axis). */
export function quadBezier(p0: number, p1: number, p2: number, t: number) {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}
