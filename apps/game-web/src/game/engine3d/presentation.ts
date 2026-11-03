import * as THREE from 'three';
import { Pool } from './pool';
import { ease, quadBezier } from './spring';
import { WORLD } from './world';
import type { FlashColor } from './juice';

export type CameraMode = 'overview' | 'follow';
interface Focus { point: THREE.Vector3; zoom: number; azimuth: number; until: number; priority: number }

/** Front edge (world z) the overview must keep in frame: last desk row + nameplates, not the empty floor beyond. */
const FRAME_FRONT_Z = 440;

/**
 * Perspective "tilted top-down" camera. Overview framing is solved for the current aspect ratio.
 * `fit(width, height, fraction)` frames the office inside the top `fraction` of the canvas (TikTok safe zone)
 * with a view offset, so the lower part of the canvas shows extra floor instead of squashing the image.
 * Focus requests zoom toward action with priorities; all motion is exponential smoothing; shake uses decaying trauma.
 */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(30, 0.75, 40, 7000);
  private elevation = THREE.MathUtils.degToRad(57);
  private overviewTarget = new THREE.Vector3(0, 0, 0);
  private overviewDistance = 1800;
  private target = new THREE.Vector3();
  private distance = 1800;
  private azimuth = 0;
  private focus: Focus | null = null;
  private trauma = 0;
  private time = 0;
  private initialized = false;
  mode: CameraMode = 'overview';
  followPoint: (() => THREE.Vector3 | null) | null = null;
  reducedMotion = false;

  /**
   * @param width canvas width (px)
   * @param height canvas height (px)
   * @param fraction top part of the canvas (0–1] that must contain the whole office
   * @returns the virtual (framed) height in px, used for particle sizing
   */
  fit(width: number, height: number, fraction = 1) {
    const share = THREE.MathUtils.clamp(fraction, 0.2, 1);
    const virtualHeight = height * share;
    const aspect = width / virtualHeight;
    this.camera.aspect = aspect;
    if (share < 1) this.camera.setViewOffset(width, virtualHeight, 0, 0, width, height);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    const points = [
      [WORLD.minX, 0, WORLD.minZ], [WORLD.maxX, 0, WORLD.minZ], [WORLD.minX, 0, FRAME_FRONT_Z], [WORLD.maxX, 0, FRAME_FRONT_Z],
      [WORLD.minX, 110, WORLD.minZ - 4], [WORLD.maxX, 110, WORLD.minZ - 4],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const probe = new THREE.PerspectiveCamera(this.camera.fov, aspect, 10, 10000);
    const projected = new THREE.Vector3();
    const fits = (targetZ: number, distance: number) => {
      this.place(probe, new THREE.Vector3(0, 0, targetZ), distance, 0);
      return points.every(point => { projected.copy(point).project(probe); return Math.abs(projected.x) <= 0.985 && Math.abs(projected.y) <= 0.985; });
    };
    let best = { z: 0, distance: Infinity };
    for (let z = -160; z <= 160; z += 8) {
      let low = 300, high = 8000;
      for (let step = 0; step < 22; step++) { const mid = (low + high) / 2; if (fits(z, mid)) high = mid; else low = mid; }
      if (high < best.distance) best = { z, distance: high };
    }
    this.overviewTarget.set(0, 0, best.z); this.overviewDistance = best.distance;
    if (!this.initialized) { this.target.copy(this.overviewTarget); this.distance = this.overviewDistance; this.initialized = true; }
    return virtualHeight;
  }
  private place(camera: THREE.PerspectiveCamera, target: THREE.Vector3, distance: number, azimuth: number) {
    const horizontal = Math.cos(this.elevation) * distance;
    camera.position.set(target.x + Math.sin(azimuth) * horizontal, target.y + Math.sin(this.elevation) * distance, target.z + Math.cos(azimuth) * horizontal);
    camera.lookAt(target); camera.updateMatrixWorld();
  }
  /** Zoom toward a point; higher priority interrupts, equal priority replaces. Returns false if ignored. */
  request(point: THREE.Vector3, options: { zoom?: number; seconds?: number; priority?: number; azimuth?: number } = {}) {
    const priority = options.priority ?? 1;
    if (this.focus && this.focus.until > this.time && this.focus.priority > priority) return false;
    this.focus = { point: point.clone(), zoom: options.zoom ?? 0.55, azimuth: options.azimuth ?? 0, until: this.time + (options.seconds ?? 3), priority };
    return true;
  }
  release() { this.focus = null; }
  /** Adds camera trauma (0–1). Displacement grows with trauma² and decays on its own. */
  shake(amount: number) { if (!this.reducedMotion && amount > 0) this.trauma = Math.min(1, this.trauma + amount); }
  get focusPoint() { return this.target; }

  update(dt: number) {
    this.time += dt;
    let goalTarget = this.overviewTarget, goalDistance = this.overviewDistance, goalAzimuth = Math.sin(this.time * 0.07) * 0.035;
    const follow = this.mode === 'follow' ? this.followPoint?.() : null;
    if (this.focus && this.focus.until > this.time) {
      goalTarget = this.clampTarget(this.focus.point, this.focus.zoom); goalDistance = this.overviewDistance * this.focus.zoom; goalAzimuth = this.focus.azimuth;
    } else if (follow) {
      goalTarget = this.clampTarget(follow, 0.6); goalDistance = this.overviewDistance * 0.6;
    }
    const k = 1 - Math.exp(-dt * (this.reducedMotion ? 10 : 2.6));
    this.target.lerp(goalTarget, k);
    this.distance += (goalDistance - this.distance) * k;
    this.azimuth += (goalAzimuth - this.azimuth) * k;
    this.place(this.camera, this.target, this.distance, this.azimuth);
    if (this.trauma > 0) {
      const amount = this.trauma * this.trauma, t = this.time * 40;
      this.camera.position.x += (Math.sin(t * 1.1) + Math.sin(t * 2.3) * 0.5) * 9 * amount;
      this.camera.position.y += (Math.sin(t * 1.7) + Math.sin(t * 3.1) * 0.5) * 7 * amount;
      this.camera.rotateZ(Math.sin(t * 1.3) * 0.02 * amount);
      this.camera.updateMatrixWorld();
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
    }
  }
  /** Keep zoomed framing inside the office so we never show the void beyond the walls. */
  private clampTarget(point: THREE.Vector3, zoom: number) {
    const slackX = (1 - zoom) * 240, slackZ = (1 - zoom) * 420;
    return new THREE.Vector3(THREE.MathUtils.clamp(point.x, -slackX, slackX), 0, THREE.MathUtils.clamp(point.z, this.overviewTarget.z - slackZ, this.overviewTarget.z + slackZ));
  }
}

export type PlateVariant = 'viewer' | 'npc' | 'boss';
export type BubbleTone = 'talk' | 'angry' | 'whisper' | 'happy' | 'boss';
export type PopStyle = 'comic' | 'score' | 'good' | 'bad' | 'banner';
type Anchor = () => THREE.Vector3 | null;
interface Plate { element: HTMLDivElement; anchor: Anchor }
interface Bubble { element: HTMLDivElement; anchor: Anchor; until: number; owner: string; x: number; y: number }
interface Pop { element: HTMLDivElement; world: THREE.Vector3; start: number; duration: number; rise: number; drift: number; tilt: number; style: PopStyle }

/** Vertical rise (fraction of canvas height) and sideways drift range per pop style. */
const POP_MOTION: Record<PopStyle, { rise: number; drift: number }> = {
  comic: { rise: 0.04, drift: 0.02 }, banner: { rise: 0.03, drift: 0 },
  good: { rise: 0.11, drift: 0.07 }, bad: { rise: 0.1, drift: 0.07 }, score: { rise: 0.12, drift: 0.08 },
};
export const LABEL_LIMITS = { pops: 16, bubbles: 7 } as const;

const projected = new THREE.Vector3();

/**
 * HTML overlay for crisp Vietnamese text: nameplates, speech bubbles and floating pops anchored to 3D points.
 * Bubbles and pops are pooled DOM nodes (fixed count, reused) — spam never creates or removes elements.
 * Pops fly along an eased quadratic Bézier arc driven from JS (compositor-only transform + opacity).
 */
export class LabelLayer {
  readonly root = document.createElement('div');
  private plates = new Map<string, Plate>();
  private bubbleOwners = new Map<string, Bubble>();
  private bubbles: Pool<Bubble>;
  private pops: Pool<Pop>;
  private now = 0;
  /** Right-edge fraction of the canvas kept clear for TikTok's button column. */
  safeRight = 0;
  reducedMotion = false;

  constructor(host: HTMLElement) {
    this.root.className = 'scene-labels'; this.root.setAttribute('aria-hidden', 'true');
    host.appendChild(this.root);
    const hiddenDiv = () => { const element = document.createElement('div'); element.style.visibility = 'hidden'; this.root.appendChild(element); return element; };
    this.bubbles = new Pool<Bubble>(() => ({ element: hiddenDiv(), anchor: () => null, until: 0, owner: '', x: 0, y: 0 }), LABEL_LIMITS.bubbles, bubble => {
      if (this.bubbleOwners.get(bubble.owner) === bubble) this.bubbleOwners.delete(bubble.owner);
      bubble.owner = ''; bubble.element.style.visibility = 'hidden';
    });
    this.pops = new Pool<Pop>(() => ({ element: hiddenDiv(), world: new THREE.Vector3(), start: 0, duration: 1, rise: 0, drift: 0, tilt: 0, style: 'comic' }), LABEL_LIMITS.pops, pop => {
      pop.element.style.visibility = 'hidden'; pop.element.style.opacity = '0';
    });
  }
  setPlate(id: string, text: string, variant: PlateVariant, anchor: Anchor, accent?: string) {
    let plate = this.plates.get(id);
    if (!plate) {
      const element = document.createElement('div'); element.className = `scene-plate ${variant}`;
      this.root.appendChild(element); plate = { element, anchor }; this.plates.set(id, plate);
    }
    plate.anchor = anchor;
    if (plate.element.textContent !== text) plate.element.textContent = text;
    if (accent) plate.element.style.setProperty('--accent', accent);
  }
  removePlate(id: string) {
    const plate = this.plates.get(id);
    if (plate) { plate.element.remove(); this.plates.delete(id); }
    const bubble = this.bubbleOwners.get(id);
    if (bubble) this.bubbles.release(bubble);
  }
  /** One bubble per speaker (a new line replaces the old one); at most 7 on screen (oldest is recycled). */
  bubble(owner: string, anchor: Anchor, text: string, seconds = 2.6, tone: BubbleTone = 'talk') {
    let bubble = this.bubbleOwners.get(owner);
    if (!bubble) { bubble = this.bubbles.acquire(); bubble.owner = owner; this.bubbleOwners.set(owner, bubble); }
    const className = `scene-bubble ${tone}`;
    bubble.element.className = className;
    bubble.element.textContent = text;
    bubble.anchor = anchor; bubble.until = this.now + seconds;
    // restart the entrance animation without re-creating the node
    void bubble.element.offsetWidth; bubble.element.className = `${className} enter`;
  }
  /** Floating text at a 3D point. Uses a pooled node; when all 16 are busy the oldest is reused. */
  pop(world: THREE.Vector3, text: string, style: PopStyle = 'comic', seconds = 1.2) {
    const pop = this.pops.acquire();
    const motion = POP_MOTION[style];
    pop.world.copy(world); pop.start = this.now; pop.duration = Math.max(0.2, seconds); pop.style = style;
    pop.rise = motion.rise; pop.drift = (Math.random() - 0.5) * 2 * motion.drift;
    pop.tilt = style === 'banner' ? 0 : (Math.random() - 0.5) * 16;
    const className = `scene-pop ${style}`;
    if (pop.element.className !== className) pop.element.className = className;
    if (pop.element.textContent !== text) pop.element.textContent = text;
  }
  update(camera: THREE.Camera, width: number, height: number, now: number) {
    this.now = now;
    const toScreen = (world: THREE.Vector3) => {
      projected.copy(world).project(camera);
      if (projected.z > 1 || projected.z < -1) return null;
      return { x: (projected.x + 1) / 2 * width, y: (1 - projected.y) / 2 * height };
    };
    for (const plate of this.plates.values()) {
      const world = plate.anchor(); const screen = world && toScreen(world);
      if (!screen) { plate.element.style.visibility = 'hidden'; continue; }
      plate.element.style.visibility = 'visible';
      plate.element.style.transform = `translate3d(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
    this.bubbles.releaseWhere(bubble => bubble.until <= now);
    const visible: Bubble[] = [];
    this.bubbles.forEachActive(bubble => {
      const world = bubble.anchor(); const screen = world && toScreen(world);
      if (!screen) { bubble.element.style.visibility = 'hidden'; return; }
      bubble.x = screen.x; bubble.y = screen.y; visible.push(bubble);
    });
    // de-overlap: push bubbles upward when they collide with one already placed
    visible.sort((left, right) => right.y - left.y);
    for (let index = 0; index < visible.length; index++) for (let other = 0; other < index; other++) {
      const a = visible[index]!, b = visible[other]!;
      if (Math.abs(a.x - b.x) < width * 0.24 && Math.abs(a.y - b.y) < height * 0.045) a.y = b.y - height * 0.045;
    }
    const maxX = width * (0.86 - this.safeRight);
    for (const bubble of visible) {
      bubble.element.style.visibility = 'visible';
      const x = THREE.MathUtils.clamp(bubble.x, width * 0.15, Math.max(width * 0.15, maxX)), y = Math.max(height * 0.12, bubble.y);
      bubble.element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
    this.pops.releaseWhere(pop => now >= pop.start + pop.duration);
    const popMaxX = width * (0.92 - this.safeRight);
    this.pops.forEachActive(pop => {
      const screen = toScreen(pop.world);
      if (!screen) { pop.element.style.visibility = 'hidden'; return; }
      const t = Math.min(1, (now - pop.start) / pop.duration);
      const travel = this.reducedMotion ? 0 : ease.outCubic(t);
      // eased quadratic Bézier: up-and-over arc (control point slightly higher than the end point)
      const x = THREE.MathUtils.clamp(screen.x + quadBezier(0, pop.drift * 0.15, pop.drift, travel) * width, width * 0.08, Math.max(width * 0.08, popMaxX));
      const y = screen.y - quadBezier(0, pop.rise * 1.25, pop.rise, travel) * height;
      const scale = this.reducedMotion ? 1 : t < 0.2 ? 0.35 + 0.65 * ease.outBack(t / 0.2) : 1 - Math.max(0, (t - 0.8) / 0.2) * 0.12;
      const opacity = t > 0.72 ? 1 - (t - 0.72) / 0.28 : 1;
      pop.element.style.visibility = 'visible';
      pop.element.style.opacity = opacity.toFixed(2);
      pop.element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) rotate(${pop.tilt.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
    });
  }
  get activePops() { return this.pops.activeCount; }
  get pooledNodes() { return this.pops.createdCount + this.bubbles.createdCount; }
  clear() { this.bubbles.clear(); this.pops.clear(); }
  dispose() { this.clear(); this.root.remove(); this.plates.clear(); this.bubbleOwners.clear(); }
}

/**
 * Full-frame color flash (gift = gold, boss = red) with an optional alert label. One reused element;
 * the CSS animation is restarted in place.
 */
export class ScreenFlash {
  private element = document.createElement('div');
  reducedMotion = false;
  constructor(host: HTMLElement) {
    this.element.className = 'scene-flash'; this.element.setAttribute('aria-hidden', 'true');
    host.appendChild(this.element);
  }
  flash(color: FlashColor, label = '') {
    if (color === 'none') return;
    this.element.textContent = label;
    this.element.className = 'scene-flash';
    void this.element.offsetWidth;
    this.element.className = `scene-flash on ${color}${label ? ' alert' : ''}${this.reducedMotion ? ' calm' : ''}`;
  }
  dispose() { this.element.remove(); }
}
