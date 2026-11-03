import * as THREE from 'three';
import { Assets, PALETTE, mergeChildren } from './assets';
import { CLIPS, type Clip, type ClipName, evaluateClip, JOINTS, type JointName, POSE_SIZE, poseIndex } from './clips';
import { Spring } from './spring';
import { THEME } from '../theme';
const clipOf = (name: ClipName) => CLIPS[name] as Clip;

export type Archetype = 'boss' | 'manager' | 'intern' | 'drama' | 'lazy' | 'worker' | 'gamer';
export type Expression = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'scared' | 'sleepy' | 'love' | 'smug' | 'pain';
export type PropName = 'mug' | 'phone' | 'papers' | 'clipboard' | 'bouquet' | 'sign' | 'box' | 'money' | 'controller' | 'whistle' | 'can';

/**
 * The six signature office states: one body clip + one face per state, so every employee reads the same way.
 * Director behaviours use these instead of ad-hoc clip/expression pairs.
 */
export const OFFICE_STATES = {
  /** Gõ phím cày cuốc */
  grind: { clip: 'typing', expression: 'neutral' },
  /** Ngủ gật */
  doze: { clip: 'sleepDesk', expression: 'sleepy' },
  /** Sợ sếp */
  fear: { clip: 'cower', expression: 'scared' },
  /** Uống bò húc / cà phê */
  drink: { clip: 'drink', expression: 'happy' },
  /** Nịnh sếp */
  flatter: { clip: 'beg', expression: 'smug' },
  /** Đập bàn */
  slam: { clip: 'slamDesk', expression: 'angry' },
} as const satisfies Record<string, { clip: ClipName; expression: Expression }>;

/** Procedural secondary-motion tuning (units: body-scale fractions and world units). */
export const MOTION = {
  /** Squash per keystroke (negative = shorter/wider). */
  keySquash: -0.9,
  /** Upward hop velocity per unit of jolt (donate reaction). */
  joltHop: 150,
  /** Stretch velocity per unit of jolt. */
  joltStretch: 2.4,
  squashLimits: [-0.16, 0.24] as const,
  /** Drowsy sway amplitude (radians) on spine / head. */
  sway: { spine: 0.07, head: 0.13, speed: 1.15 },
} as const;
type HairStyle = 'short' | 'spiky' | 'side' | 'long' | 'bun' | 'bob' | 'bald' | 'slick' | 'messy' | 'ponytail';
type Accessory = 'tie' | 'glasses' | 'lanyard' | 'earrings' | 'mustache' | 'headphones' | 'hoodie' | 'vest' | 'jacket';

export interface Look { skin: number; hair: number; hairStyle: HairStyle; top: number; bottom: number; shoes: number; accessories: Accessory[]; scale: number; belly: number; skirt: boolean }

const TOPS = [THEME.blue, 0xf1f1ea, 0x7fc2a8, 0xf3a988, 0x9a8fd8, 0xffd27a, 0x6aa9d8, 0xe88aa6, 0x8fbf6a];
const BOTTOMS = [0x2f3a52, 0x4a4f5a, 0x6b5844, 0x283044, 0x3d4b5e];

function rng(seed: number) { let state = seed >>> 0 || 1; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return ((state >>> 0) % 10000) / 10000; }; }
export function hashString(value: string) { let hash = 2166136261; for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return hash >>> 0; }

/** Deterministic look per archetype + seed, so a viewer keeps the same avatar across reconnects. */
export function makeLook(archetype: Archetype, seed: number): Look {
  const random = rng(seed);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length) % items.length]!;
  const female = random() > 0.5;
  const base: Look = {
    skin: pick(PALETTE.skin), hair: pick(PALETTE.hair), hairStyle: female ? pick(['long', 'bun', 'bob', 'ponytail'] as const) : pick(['short', 'spiky', 'side', 'messy'] as const),
    top: pick(TOPS), bottom: pick(BOTTOMS), shoes: 0x2a2626, accessories: [], scale: 0.98 + random() * 0.04, belly: 0, skirt: female && random() > 0.55,
  };
  if (random() > 0.6) base.accessories.push('glasses');
  if (!female && random() > 0.55) base.accessories.push('tie');
  switch (archetype) {
    case 'boss': return { ...base, hair: 0x2b2b30, hairStyle: 'slick', top: PALETTE.navyDeep, bottom: PALETTE.navyDeep, shoes: 0x1a1210, accessories: ['jacket', 'tie', 'mustache'], scale: 1.16, belly: 4, skirt: false };
    case 'manager': return { ...base, hairStyle: 'bald', hair: 0x4a3a30, top: 0xeef2f6, bottom: 0x44505f, accessories: ['vest', 'glasses', 'tie'], scale: 1.04, belly: 2, skirt: false };
    case 'intern': return { ...base, top: 0xbfe3c9, accessories: ['lanyard', 'glasses'], scale: 0.9 };
    case 'drama': return { ...base, hairStyle: 'bun', hair: 0x8e3b2f, top: 0xf58fb0, accessories: ['earrings'], skirt: true };
    case 'lazy': return { ...base, hairStyle: 'messy', top: 0x8d97a8, accessories: ['hoodie'], belly: 2 };
    case 'gamer': return { ...base, hairStyle: 'spiky', top: 0x2f2f45, accessories: ['headphones'] };
    default: return base;
  }
}

type MouthName = 'smile' | 'frown' | 'open' | 'o' | 'flat' | 'grit';
interface FaceParts {
  browL: THREE.Mesh; browR: THREE.Mesh; lidL: THREE.Mesh; lidR: THREE.Mesh; pupilL: THREE.Mesh; pupilR: THREE.Mesh;
  mouths: Record<MouthName, THREE.Mesh>; blushL: THREE.Mesh; blushR: THREE.Mesh; sweat: THREE.Mesh;
}
interface ExpressionShape { browY: number; browTilt: number; lid: number; pupil: number; mouth: MouthName; blush: number; red?: boolean; asym?: boolean }
const EXPRESSIONS: Record<Expression, ExpressionShape> = {
  neutral: { browY: 0, browTilt: 0, lid: 0.18, pupil: 1, mouth: 'flat', blush: 0 },
  happy: { browY: 0.6, browTilt: -0.1, lid: 0.3, pupil: 1, mouth: 'smile', blush: 0.4 },
  sad: { browY: 0.4, browTilt: -0.45, lid: 0.4, pupil: 1, mouth: 'frown', blush: 0 },
  angry: { browY: -0.9, browTilt: 0.55, lid: 0.3, pupil: 0.85, mouth: 'grit', blush: 1, red: true },
  surprised: { browY: 1.6, browTilt: 0, lid: 0, pupil: 0.65, mouth: 'o', blush: 0 },
  scared: { browY: 1.2, browTilt: -0.5, lid: 0, pupil: 0.55, mouth: 'open', blush: 0 },
  sleepy: { browY: -0.2, browTilt: -0.1, lid: 0.88, pupil: 1, mouth: 'o', blush: 0 },
  love: { browY: 0.7, browTilt: -0.2, lid: 0.35, pupil: 1.2, mouth: 'smile', blush: 1 },
  smug: { browY: 0.3, browTilt: 0.2, lid: 0.45, pupil: 1, mouth: 'smile', blush: 0, asym: true },
  pain: { browY: -0.3, browTilt: -0.5, lid: 0.95, pupil: 1, mouth: 'open', blush: 0.6, red: true },
};

interface ActiveAction { clip: ClipName; time: number; speed: number; loop: boolean; fired: number; onEvent?: (name: string) => void; done: boolean }

const tmpVector = new THREE.Vector3();
const tmpMatrix = new THREE.Matrix4();

/**
 * Procedural, hierarchical character (joint groups = a lightweight skeleton). The animator layers
 * locomotion (idle/walk/run blended by speed, gait phase driven by distance to avoid foot sliding),
 * a sitting layer, an action clip layer with per-joint masks, crossfades on every state change and
 * additive head/eye look-at.
 */
export class Character {
  readonly root = new THREE.Group();
  readonly joints = {} as Record<JointName, THREE.Group>;
  readonly look: Look;
  readonly face: FaceParts;
  readonly hand = new THREE.Group();
  readonly offHand = new THREE.Group();
  readonly headAnchor = new THREE.Object3D();
  readonly dizzy = new THREE.Group();
  private props = new Map<PropName, THREE.Object3D>();
  private shadow: THREE.Mesh;
  private shadowCasters: THREE.Mesh[] = [];
  private ownedGeometries: THREE.BufferGeometry[] = [];
  private blushPink: THREE.Material;
  private blushRed: THREE.Material;
  // locomotion
  speed = 0;
  private gait = 0;
  heading = 0;
  targetHeading = 0;
  seated = 0;
  seatTarget = 0;
  seatHeight = 16;
  // animation layers
  private action: ActiveAction | null = null;
  private pose = new Float32Array(POSE_SIZE);
  private target = new Float32Array(POSE_SIZE);
  private clipPose = new Float32Array(POSE_SIZE);
  private clipMask = new Float32Array(POSE_SIZE);
  private crossFrom = new Float32Array(POSE_SIZE);
  private crossTime = 1;
  private crossDuration = 0.18;
  // face
  expression: Expression = 'neutral';
  private expressionTimer = 0;
  private baseExpression: Expression = 'neutral';
  private face01 = { browY: 0, browTilt: 0, lid: 0.18, pupil: 1, blush: 0 };
  private blinkTimer = 2 + Math.random() * 3;
  private blink = 0;
  talking = 0;
  // look-at
  lookTarget: THREE.Vector3 | null = null;
  private lookYaw = 0;
  private lookPitch = 0;
  readonly bodyScale: number;
  knockedOut = false;
  // procedural secondary motion (additive, applied after the pose)
  /** Set by the scene from prefers-reduced-motion; disables squash, hops and sway. */
  static reducedMotion = false;
  private body: THREE.Group;
  private squash = new Spring(210, 15);
  private hop = new Spring(140, 11);
  private drowsy = 0;

  constructor(private assets: Assets, readonly id: string, readonly archetype: Archetype, seed: number) {
    this.look = makeLook(archetype, seed);
    this.bodyScale = this.look.scale;
    this.root.name = `character:${id}`;
    const body = new THREE.Group(); body.scale.setScalar(this.bodyScale); this.root.add(body); this.body = body;
    const group = (name: JointName, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const joint = new THREE.Group(); joint.name = name; joint.position.set(x, y, z); parent.add(joint); this.joints[name] = joint; return joint;
    };
    const look = this.look;
    const hips = group('hips', body, 0, 24, 0);
    const spine = group('spine', hips, 0, 2, 0);
    const chest = group('chest', spine, 0, 7, 0);
    const neck = group('neck', chest, 0, 12.5, 0);
    const head = group('head', neck, 0, 2.5, 0);
    const shL = group('shL', chest, 11.5 + look.belly * 0.3, 9.5, 0), shR = group('shR', chest, -11.5 - look.belly * 0.3, 9.5, 0);
    const elL = group('elL', shL, 0, -9.5, 0), elR = group('elR', shR, 0, -9.5, 0);
    const thL = group('thL', hips, 5, -1, 0), thR = group('thR', hips, -5, -1, 0);
    const knL = group('knL', thL, 0, -11, 0), knR = group('knR', thR, 0, -11, 0);

    const skin = assets.std(look.skin, 0.62), top = assets.std(look.top, 0.82), bottom = assets.std(look.bottom, 0.85);
    const hairMaterial = assets.std(look.hair, 0.55), shoe = assets.std(look.shoes, 0.45, 0.05);
    const jacket = look.accessories.includes('jacket'), hoodie = look.accessories.includes('hoodie'), vest = look.accessories.includes('vest');
    const torsoMaterial = jacket ? assets.std(PALETTE.navyDeep, 0.6) : top;
    const rbox = assets.roundBox(0.3, 3), sphere = assets.sphere(18), capsule = assets.capsule(), cyl = assets.cylinder(0.5, 0.5, 12), box = assets.box();
    const part = this.part.bind(this);

    // pelvis + torso (belly makes the boss rounder)
    part(hips, rbox, look.skirt ? top : bottom, 0, 0, 0, 18 + look.belly, 7, 12 + look.belly * 0.6);
    if (look.skirt) part(hips, assets.cylinder(0.42, 0.56, 14), bottom, 0, -5, 0, 22, 9, 16);
    part(chest, rbox, torsoMaterial, 0, 5, 0, 21 + look.belly, 15, 13 + look.belly);
    part(spine, rbox, torsoMaterial, 0, 2.5, 0.2, 19 + look.belly, 7, 12 + look.belly);
    if (jacket || vest) {
      part(chest, box, assets.std(0xf4f4f0, 0.7), 0, 6.5, 6.6 + look.belly / 2, 5.5, 12, 0.6, false);
      if (vest) part(chest, rbox, assets.std(0x6c7480, 0.85), 0, 4.5, 0.3, 21.5 + look.belly, 13, 13.6 + look.belly);
      if (jacket) for (const side of [-1, 1]) part(chest, box, assets.std(0x2c3e66, 0.5), side * 3.6, 7.5, 6.9 + look.belly / 2, 1.2, 10, 0.5, false);
    }
    if (hoodie) { part(chest, rbox, top, 0, 13.5, -5, 17, 5, 6); part(chest, box, assets.std(0xdedede, 0.8), 0, 9, 7.1, 0.5, 6, 0.4, false); }
    if (look.accessories.includes('tie')) part(chest, box, assets.std(archetype === 'boss' ? PALETTE.red : 0x2d4f8f, 0.5), 0, 6, 6.9 + look.belly / 2, 2.2, 10, 0.8, false);
    if (look.accessories.includes('lanyard')) { part(chest, assets.torus(Math.PI), assets.std(0x3b7ddd, 0.6), 0, 12, 6.6, 10, 10, 2, false).rotation.z = Math.PI; part(chest, box, assets.std(0xffffff, 0.4), 0, 5.5, 7.1, 4, 5, 0.5, false); }
    part(chest, cyl, skin, 0, 12.5, 0, 5.5, 3, 5.5); // neck

    // head
    part(head, rbox, skin, 0, 10, 0.5, 21, 19, 19);
    for (const side of [-1, 1]) part(head, sphere, skin, side * 10.7, 9.5, 0, 3, 5, 3.5, false);
    part(head, sphere, skin, 0, 8.2, 10.4, 3, 2.6, 2.6, false); // nose
    this.buildHair(head, hairMaterial, rbox, sphere);
    if (look.accessories.includes('mustache')) part(head, rbox, hairMaterial, 0, 5.8, 10.3, 8.5, 2.2, 2, false);
    if (look.accessories.includes('glasses')) {
      const frame = assets.std(0x222222, 0.3, 0.4);
      for (const side of [-1, 1]) part(head, assets.torus(Math.PI * 2), frame, side * 4.5, 11.4, 10.9, 6.5, 6.5, 4, false);
      part(head, box, frame, 0, 11.6, 11, 3, 0.6, 0.6, false);
    }
    if (look.accessories.includes('headphones')) {
      const band = assets.std(0xe2453c, 0.4);
      part(head, assets.torus(Math.PI), band, 0, 14, 0, 24, 18, 6, false);
      for (const side of [-1, 1]) part(head, cyl, band, side * 11.5, 10, 0, 6, 3, 6, false).rotation.z = Math.PI / 2;
    }
    if (look.accessories.includes('earrings')) for (const side of [-1, 1]) part(head, sphere, assets.std(PALETTE.warm, 0.2, 0.8), side * 10.8, 6.4, 0.5, 1.6, 1.6, 1.6, false);

    // face
    const white = assets.std(0xffffff, 0.25), dark = assets.std(0x1c1d24, 0.2);
    const browMaterial = assets.std(look.hairStyle === 'bald' ? 0x4a3a30 : look.hair, 0.7);
    for (const side of [-1, 1]) part(head, sphere, white, side * 4.5, 11.2, 9.6, 5.2, 5.6, 2.4, false);
    const pupilL = part(head, sphere, dark, 4.5, 11, 10.7, 2.6, 3, 1.2, false), pupilR = part(head, sphere, dark, -4.5, 11, 10.7, 2.6, 3, 1.2, false);
    const lidL = part(head, box, skin, 4.5, 14, 10.5, 6, 3, 1.4, false), lidR = part(head, box, skin, -4.5, 14, 10.5, 6, 3, 1.4, false);
    const browL = part(head, rbox, browMaterial, 4.6, 15.3, 10.4, 5.5, 1.3, 1.2, false), browR = part(head, rbox, browMaterial, -4.6, 15.3, 10.4, 5.5, 1.3, 1.2, false);
    const mouthMaterial = assets.std(0x6b2630, 0.5);
    const smile = part(head, assets.torus(Math.PI), mouthMaterial, 0, 6, 10.2, 5.5, 4.5, 3, false); smile.rotation.z = Math.PI;
    const frown = part(head, assets.torus(Math.PI), mouthMaterial, 0, 3.8, 10.2, 5, 3.6, 3, false);
    const open = part(head, sphere, mouthMaterial, 0, 4.4, 10, 6, 4.6, 2, false);
    const o = part(head, sphere, mouthMaterial, 0, 4.6, 10.1, 3, 3.4, 2, false);
    const flat = part(head, rbox, mouthMaterial, 0, 4.8, 10.2, 4.5, 0.9, 1, false);
    const grit = part(head, rbox, assets.std(0xffffff, 0.4), 0, 4.6, 10.2, 6.5, 2, 1, false);
    this.blushPink = assets.std(0xff8fa0, 0.8, 0, { transparent: true, opacity: 0.75 });
    this.blushRed = assets.std(0xff3b30, 0.8, 0, { transparent: true, opacity: 0.6 });
    const blushL = part(head, sphere, this.blushPink, 6.8, 7.6, 9.4, 4, 2.2, 1, false);
    const blushR = part(head, sphere, this.blushPink, -6.8, 7.6, 9.4, 4, 2.2, 1, false);
    const sweat = part(head, sphere, assets.std(0x8fd3ff, 0.1, 0, { transparent: true, opacity: 0.85 }), 9.5, 16, 6, 2.2, 3.2, 2.2, false);
    sweat.visible = false;
    this.face = { browL, browR, lidL, lidR, pupilL, pupilR, mouths: { smile, frown, open, o, flat, grit }, blushL, blushR, sweat };
    this.headAnchor.position.set(0, 24, 0); head.add(this.headAnchor);

    // limbs
    for (const [sh, el, hand] of [[shL, elL, this.offHand], [shR, elR, this.hand]] as const) {
      part(sh, capsule, jacket ? torsoMaterial : top, 0, -4.5, 0, 5.6, 5.4, 5.6);
      part(el, capsule, jacket || hoodie ? torsoMaterial : skin, 0, -4, 0, 4.8, 4.6, 4.8);
      if (jacket) part(el, cyl, assets.std(0xf4f4f0, 0.6), 0, -7.6, 0, 4.4, 1.2, 4.4, false);
      part(el, sphere, skin, 0, -9.8, 0.3, 5, 5.4, 5);
      hand.position.set(0, -10.5, 1.5); el.add(hand);
    }
    for (const [th, kn] of [[thL, knL], [thR, knR]] as const) {
      part(th, capsule, look.skirt ? skin : bottom, 0, -5.5, 0, 6.4, 6.5, 6.6);
      part(kn, capsule, look.skirt ? skin : bottom, 0, -5, 0, 5.6, 6, 5.8);
      part(kn, rbox, shoe, 0, -10.5, 2, 6.5, 3.4, 10);
    }

    // dizzy stars ring (hidden until stunned)
    this.dizzy.position.set(0, 26, 0); this.dizzy.visible = false; head.add(this.dizzy);
    const starMaterial = assets.std(PALETTE.warm, 0.3, 0, { emissive: PALETTE.warm, emissiveIntensity: 0.7 });
    const starGeometry = assets.geometry('star', () => {
      const shape = new THREE.Shape();
      for (let index = 0; index < 10; index++) { const radius = index % 2 ? 0.42 : 1; const angle = index / 10 * Math.PI * 2 + Math.PI / 2; const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius; if (index) shape.lineTo(x, y); else shape.moveTo(x, y); }
      return new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false });
    });
    for (let index = 0; index < 5; index++) {
      const star = new THREE.Mesh(starGeometry, starMaterial); const angle = index / 5 * Math.PI * 2;
      star.position.set(Math.cos(angle) * 13, 0, Math.sin(angle) * 13); star.scale.setScalar(3.4); this.dizzy.add(star);
    }

    // contact shadow (cheap AO) always on; real shadow maps on higher quality tiers
    this.shadow = new THREE.Mesh(assets.plane(), assets.basic(0xffffff, { map: assets.blob(), transparent: true, opacity: 1, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.4; this.shadow.scale.set(30 * this.bodyScale, 30 * this.bodyScale, 1); this.shadow.renderOrder = 1;
    this.root.add(this.shadow);
    // merge rigid parts per joint (≈45 meshes → ≈20 draw calls); animated face parts stay separate
    const face = this.face;
    const keep = new Set<THREE.Object3D>([face.browL, face.browR, face.lidL, face.lidR, face.pupilL, face.pupilR, face.blushL, face.blushR, face.sweat, ...Object.values(face.mouths)]);
    for (const joint of Object.values(this.joints)) {
      const merged = mergeChildren(joint, keep, this.ownedGeometries, assets.vertexColor());
      if (merged.length) this.shadowCasters = this.shadowCasters.filter(mesh => mesh.parent).concat(merged.filter(mesh => mesh.castShadow));
    }
    this.updateFace(0, 0);
  }
  dispose() { this.ownedGeometries.forEach(geometry => geometry.dispose()); this.ownedGeometries = []; this.root.removeFromParent(); }

  private part(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, cast = true) {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
    mesh.castShadow = cast; if (cast) this.shadowCasters.push(mesh); parent.add(mesh); return mesh;
  }

  private buildHair(head: THREE.Group, material: THREE.Material, rbox: THREE.BufferGeometry, sphere: THREE.BufferGeometry) {
    const style = this.look.hairStyle, part = this.part.bind(this), cone = this.assets.geometry('cone', () => new THREE.ConeGeometry(0.5, 1, 10));
    if (style === 'bald') { for (const side of [-1, 1]) part(head, rbox, material, side * 10, 11, -2, 3, 8, 14); part(head, rbox, material, 0, 10, -9.5, 20, 7, 3); return; }
    const cap = part(head, rbox, material, 0, 17.5, -0.5, 22.5, 7, 20.5);
    if (style === 'slick') { cap.scale.set(22, 5.5, 20.5); part(head, rbox, material, 0, 12, -9.6, 22, 12, 3); return; }
    part(head, rbox, material, 0, 11, -9.5, 22, 15, 3.5); // back
    if (style === 'spiky') for (let index = -2; index <= 2; index++) { const spike = part(head, cone, material, index * 4.2, 22, 0, 4.2, 7, 4.2); spike.rotation.z = index * 0.18; }
    if (style === 'side') part(head, rbox, material, 3, 17, 7.8, 15, 4, 5).rotation.z = 0.25;
    if (style === 'messy') for (let index = 0; index < 4; index++) part(head, sphere, material, -7 + index * 5, 20.5, -1 + (index % 2) * 4, 8, 6, 8);
    if (style === 'short') part(head, rbox, material, 0, 16.5, 8.2, 20, 3.5, 4);
    if (style === 'long' || style === 'bob' || style === 'bun' || style === 'ponytail') {
      part(head, rbox, material, 0, 17, 8, 21, 4, 4.2);
      for (const side of [-1, 1]) part(head, rbox, material, side * 10.4, style === 'long' ? 5 : 9, -1.5, 3.4, style === 'long' ? 24 : 15, 16);
      if (style === 'long') part(head, rbox, material, 0, 4, -9.5, 21, 22, 4);
      if (style === 'bun') part(head, sphere, material, 0, 23, -6, 10, 10, 10);
      if (style === 'ponytail') { const tail = part(head, cone, material, 0, 9, -13, 7, 16, 7); tail.rotation.x = Math.PI + 0.3; }
    }
  }

  // ---------------- public control API ----------------
  get position() { return this.root.position; }
  setShadowQuality(realShadows: boolean) { this.shadowCasters.forEach(mesh => { mesh.castShadow = realShadows; }); }
  play(clip: ClipName, options: { speed?: number; loop?: boolean; onEvent?: (name: string) => void } = {}) {
    this.beginCrossfade(clipOf(clip).blendIn ?? 0.16);
    this.action = { clip, time: 0, speed: options.speed ?? 1, loop: options.loop ?? clipOf(clip).loop ?? false, fired: 0, onEvent: options.onEvent, done: false };
    return this.action;
  }
  stopAction(fade = 0.22) { if (this.action) { this.beginCrossfade(fade); this.action = null; } }
  get actionDone() { return !this.action || this.action.done; }
  get currentClip() { return this.action?.clip; }
  /** Temporary expression that reverts to the base expression after `seconds`. */
  emote(expression: Expression, seconds = 2) { this.expression = expression; this.expressionTimer = seconds; }
  /** Startled bounce (e.g. a donate): hop up, stretch, land with a squash. `amount` 0–1. */
  jolt(amount = 1) {
    if (amount <= 0 || this.knockedOut) return;
    if (!Character.reducedMotion) { this.hop.impulse(MOTION.joltHop * amount); this.squash.impulse(MOTION.joltStretch * amount); }
    if (this.expressionTimer <= 0 || this.expression === this.baseExpression) this.emote('surprised', 0.9);
  }
  private onClipEvent(name: string) {
    if (name === 'key' && !Character.reducedMotion) this.squash.impulse(MOTION.keySquash * (0.8 + Math.random() * 0.4));
  }
  setBaseExpression(expression: Expression) { this.baseExpression = expression; if (this.expressionTimer <= 0) this.expression = expression; }
  sit(height: number) { this.seatHeight = height; this.seatTarget = 1; }
  stand() { this.seatTarget = 0; }
  holding(prop: PropName | null) {
    if (prop && !this.props.has(prop)) { const object = buildProp(this.assets, prop); this.hand.add(object); this.props.set(prop, object); }
    this.props.forEach((object, name) => { object.visible = name === prop; });
  }
  handWorld(target: THREE.Vector3) { this.root.updateMatrixWorld(); return this.hand.getWorldPosition(target); }
  headWorld(target: THREE.Vector3) { this.root.updateMatrixWorld(); return this.headAnchor.getWorldPosition(target); }
  /** Head position from the last rendered matrices (no matrix recomputation; use after render). */
  headFast(target: THREE.Vector3) { return target.setFromMatrixPosition(this.headAnchor.matrixWorld); }
  faceToward(point: { x: number; z: number }) { this.targetHeading = Math.atan2(point.x - this.root.position.x, point.z - this.root.position.z); }
  get facingError() { const delta = this.targetHeading - this.heading; return Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))); }

  private beginCrossfade(duration = 0.18) { this.crossFrom.set(this.pose); this.crossTime = 0; this.crossDuration = duration; }

  update(dt: number, time: number) {
    let delta = this.targetHeading - this.heading;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    this.heading += delta * Math.min(1, dt * 9);
    this.root.rotation.y = this.heading;
    const previousSeated = this.seated;
    this.seated += (this.seatTarget - this.seated) * Math.min(1, dt * 6);
    if (Math.abs(this.seated - this.seatTarget) < 0.003) this.seated = this.seatTarget;
    if ((previousSeated < 0.5) !== (this.seated < 0.5)) this.beginCrossfade(0.2);
    this.gait += this.speed * dt / (this.speed > 80 ? 58 : 34);

    // 1) locomotion base layer
    const target = this.target; target.fill(0);
    const walkWeight = THREE.MathUtils.smoothstep(this.speed, 2, 30), runWeight = THREE.MathUtils.smoothstep(this.speed, 70, 115);
    locomotion(target, this.gait * Math.PI * 2, walkWeight, runWeight, time);
    // 2) sitting layer
    if (this.seated > 0) {
      const sitting = this.clipPose; sitting.fill(0);
      evaluateClip('sit', 0, sitting, this.clipMask);
      sitting[poseIndex.hy] = -(24 - this.seatHeight - 4);
      sitting[poseIndex.joint('chest')] = sitting[poseIndex.joint('chest')]! + Math.sin(time * 1.7) * 0.015;
      for (let index = 0; index < POSE_SIZE; index++) target[index] = target[index]! + (sitting[index]! - target[index]!) * this.seated;
    }
    // 3) action layer with per-joint mask
    if (this.action) {
      const action = this.action, clip = clipOf(action.clip);
      action.time += dt * action.speed;
      const events = clip.events ?? [];
      while (action.fired < events.length && events[action.fired]![0] <= action.time) { const name = events[action.fired]![1]; this.onClipEvent(name); action.onEvent?.(name); action.fired++; }
      if (action.time >= clip.duration) {
        if (action.loop) { action.time %= clip.duration; action.fired = 0; } else { action.time = clip.duration; action.done = true; }
      }
      this.clipPose.fill(0); this.clipMask.fill(0);
      evaluateClip(action.clip, action.time, this.clipPose, this.clipMask);
      for (let index = 0; index < POSE_SIZE; index++) target[index] = target[index]! + (this.clipPose[index]! - target[index]!) * this.clipMask[index]!;
    }
    // 4) crossfade from the last output on any discontinuity (state change / new clip)
    if (this.crossTime < this.crossDuration) {
      this.crossTime += dt;
      const t = THREE.MathUtils.smootherstep(Math.min(1, this.crossTime / this.crossDuration), 0, 1);
      for (let index = 0; index < POSE_SIZE; index++) this.pose[index] = this.crossFrom[index]! + (target[index]! - this.crossFrom[index]!) * t;
    } else this.pose.set(target);
    this.applyPose(dt);
    this.applySecondaryMotion(dt, time);
    this.updateFace(dt, time);
    if (this.dizzy.visible) this.dizzy.rotation.y += dt * 4;
  }

  private applyPose(dt: number) {
    const pose = this.pose;
    JOINTS.forEach((name, index) => { this.joints[name].rotation.set(pose[index * 3]!, pose[index * 3 + 1]!, pose[index * 3 + 2]!); });
    this.joints.hips.position.y = 24 + pose[poseIndex.hy]!;
    this.joints.hips.position.z = pose[poseIndex.hz]!;
    this.joints.hips.rotation.y += pose[poseIndex.yaw]!;
    let yaw = 0, pitch = 0;
    if (this.lookTarget && !this.knockedOut) {
      this.root.updateMatrixWorld();
      tmpMatrix.copy(this.root.matrixWorld).invert();
      tmpVector.copy(this.lookTarget).applyMatrix4(tmpMatrix).multiplyScalar(1 / this.bodyScale);
      const rawYaw = Math.atan2(tmpVector.x, tmpVector.z);
      yaw = Math.abs(rawYaw) > 2.3 ? 0 : THREE.MathUtils.clamp(rawYaw, -1.2, 1.2);
      pitch = THREE.MathUtils.clamp(-Math.atan2(tmpVector.y - 55, Math.hypot(tmpVector.x, tmpVector.z)) * 0.6, -0.45, 0.5);
    }
    this.lookYaw += (yaw - this.lookYaw) * Math.min(1, dt * 6);
    this.lookPitch += (pitch - this.lookPitch) * Math.min(1, dt * 6);
    this.joints.neck.rotation.y += this.lookYaw * 0.4; this.joints.head.rotation.y += this.lookYaw * 0.6;
    this.joints.head.rotation.x += this.lookPitch;
    const eyeShift = THREE.MathUtils.clamp(this.lookYaw * 1.6, -1, 1);
    this.face.pupilL.position.x = 4.5 + eyeShift; this.face.pupilR.position.x = -4.5 + eyeShift;
  }

  /** Squash & stretch (volume-preserving), donate hop and drowsy sway, layered on top of the animated pose. */
  private applySecondaryMotion(dt: number, time: number) {
    if (Character.reducedMotion) { this.squash.reset(); this.hop.reset(); this.body.scale.setScalar(this.bodyScale); return; }
    const hop = this.hop.update(dt);
    // landing from a hop compresses the body
    if (hop < -0.5 && this.hop.velocity < 0) this.squash.impulse(-0.04);
    const [low, high] = MOTION.squashLimits;
    const stretch = THREE.MathUtils.clamp(this.squash.update(dt), low, high);
    const y = 1 + stretch, xz = 1 / Math.sqrt(y);
    this.body.scale.set(this.bodyScale * xz, this.bodyScale * y, this.bodyScale * xz);
    // hop ≈ 10 units at full jolt (√k ≈ 11.8 rad/s) → ~6 units lift; dip below rest is clamped
    this.joints.hips.position.y += Math.max(-1.5, hop * 0.6);
    const sleepy = this.expression === 'sleepy' || this.currentClip === 'sleepDesk' || this.currentClip === 'yawn';
    this.drowsy += ((sleepy && !this.knockedOut ? 1 : 0) - this.drowsy) * Math.min(1, dt * 2);
    if (this.drowsy > 0.01) {
      const phase = time * MOTION.sway.speed + this.bodyScale * 10;
      this.joints.spine.rotation.z += Math.sin(phase) * MOTION.sway.spine * this.drowsy;
      this.joints.head.rotation.z += Math.sin(phase + 0.6) * MOTION.sway.head * this.drowsy;
      this.joints.head.rotation.x += (0.5 + 0.5 * Math.sin(phase * 0.5)) * 0.12 * this.drowsy;
    }
  }

  private updateFace(dt: number, time: number) {
    if (this.expressionTimer > 0) { this.expressionTimer -= dt; if (this.expressionTimer <= 0) this.expression = this.baseExpression; }
    const shape = EXPRESSIONS[this.knockedOut ? 'pain' : this.expression];
    const k = dt === 0 ? 1 : Math.min(1, dt * 12);
    const face = this.face01;
    face.browY += (shape.browY - face.browY) * k; face.browTilt += (shape.browTilt - face.browTilt) * k;
    face.lid += (shape.lid - face.lid) * k; face.pupil += (shape.pupil - face.pupil) * k; face.blush += (shape.blush - face.blush) * k;
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) { this.blink = 0.13; this.blinkTimer = 2 + Math.random() * 4; }
    if (this.blink > 0) this.blink -= dt;
    const lid = Math.max(face.lid, this.blink > 0 ? 1 : 0);
    const parts = this.face;
    for (const lidMesh of [parts.lidL, parts.lidR]) { lidMesh.scale.y = 0.3 + lid * 5.6; lidMesh.position.y = 14.3 - lid * 2.9; }
    const asym = shape.asym ? 0.8 : 0;
    parts.browL.position.y = 15.3 + face.browY + asym; parts.browR.position.y = 15.3 + face.browY;
    parts.browL.rotation.z = face.browTilt; parts.browR.rotation.z = -face.browTilt;
    parts.pupilL.scale.set(2.6 * face.pupil, 3 * face.pupil, 1.2); parts.pupilR.scale.set(2.6 * face.pupil, 3 * face.pupil, 1.2);
    const talkingOpen = this.talking > 0 && Math.sin(time * 22) > 0;
    const mouthName: MouthName = talkingOpen ? (shape.mouth === 'grit' || shape.mouth === 'open' ? 'open' : 'o') : shape.mouth;
    for (const name of Object.keys(parts.mouths) as MouthName[]) parts.mouths[name].visible = name === mouthName;
    parts.mouths.smile.rotation.set(0, 0, shape.asym ? Math.PI + 0.35 : Math.PI);
    const blushVisible = face.blush > 0.05;
    parts.blushL.visible = parts.blushR.visible = blushVisible;
    if (blushVisible) {
      parts.blushL.material = parts.blushR.material = shape.red ? this.blushRed : this.blushPink;
      parts.blushL.scale.set(4 * face.blush, 2.2 * face.blush, 1); parts.blushR.scale.copy(parts.blushL.scale);
    }
    parts.sweat.visible = this.expression === 'scared' || this.expression === 'pain';
    if (parts.sweat.visible) parts.sweat.position.y = 16 - ((time * 6) % 5);
    if (this.talking > 0) this.talking -= dt;
  }
}

/** Walk/run cycle with distance-driven phase. Values are radians in joint space (+x on legs/arms = swing back). */
function locomotion(target: Float32Array, phase: number, walk: number, run: number, time: number) {
  const j = poseIndex.joint;
  const amplitude = 0.55 * walk + 0.35 * run;
  const swing = Math.sin(phase), lift = Math.cos(phase);
  target[j('chest')] = Math.sin(time * 2.1) * 0.025 * (1 - walk);
  target[j('hips') + 2] = Math.sin(time * 0.7) * 0.025 * (1 - walk);
  target[j('shL') + 2] = 0.09; target[j('shR') + 2] = -0.09;
  target[j('elL')] = -0.12 - 0.25 * walk - 1.1 * run; target[j('elR')] = target[j('elL')]!;
  if (walk <= 0) return;
  target[j('thL')] = -swing * amplitude; target[j('thR')] = swing * amplitude;
  target[j('knL')] = 0.08 + Math.max(0, lift) * (0.7 * walk + 0.6 * run);
  target[j('knR')] = 0.08 + Math.max(0, -lift) * (0.7 * walk + 0.6 * run);
  target[j('shL')] = swing * amplitude * 0.85; target[j('shR')] = -swing * amplitude * 0.85;
  target[j('spine') + 1] = swing * 0.09 * walk;
  target[j('spine')] = 0.04 * walk + 0.22 * run;
  target[j('head')] = -0.05 * run;
  target[poseIndex.hy] = -Math.abs(lift) * 1.2 * walk + Math.abs(swing) * 1.6 * run - 0.6 * run;
}

function buildProp(assets: Assets, prop: PropName): THREE.Object3D {
  const group = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.castShadow = true; group.add(mesh); return mesh;
  };
  const rbox = assets.roundBox(0.2, 2);
  switch (prop) {
    case 'mug': add(assets.cylinder(0.5, 0.45, 14), assets.std(0xffffff, 0.3), 0, 1, 2, 5, 6, 5); add(assets.cylinder(0.5, 0.5, 14), assets.std(0x5a3216, 0.2), 0, 3.9, 2, 4.4, 0.4, 4.4); add(assets.torus(Math.PI * 2), assets.std(0xffffff, 0.3), 2.8, 1, 2, 3, 3, 3).rotation.y = Math.PI / 2; break;
    case 'phone': add(rbox, assets.std(0x222630, 0.3, 0.3), 0, 0, 2, 4.5, 8, 0.9); add(assets.plane(), assets.std(0x6fc3ff, 0.2, 0, { emissive: 0x6fc3ff, emissiveIntensity: 0.9 }), 0, 0, 2.5, 3.8, 7, 1); break;
    case 'papers': for (let index = 0; index < 4; index++) add(assets.box(), assets.std(0xfbfbf6, 0.9), index * 0.3, index * 0.5, 3, 11, 0.4, 14).rotation.y = index * 0.05; group.rotation.x = Math.PI / 2; break;
    case 'clipboard': add(rbox, assets.std(0x9b6b3d, 0.7), 0, 0, 3, 11, 15, 1); add(assets.box(), assets.std(0xfbfbf6, 0.9), 0, -0.5, 3.6, 9, 12, 0.2); add(rbox, assets.std(0xb0b6bd, 0.3, 0.7), 0, 7, 3.7, 5, 2, 1); break;
    case 'bouquet': add(assets.cylinder(0.25, 0.5, 10), assets.std(0x8ad1b5, 0.8), 0, 0, 3, 7, 10, 7); for (let index = 0; index < 6; index++) { const angle = index / 6 * Math.PI * 2; add(assets.sphere(10), assets.std([0xff6b8a, 0xffd25f, 0xff9fd0][index % 3]!, 0.6), Math.cos(angle) * 3, 7 + (index % 2), 3 + Math.sin(angle) * 3, 4.5, 4.5, 4.5); } break;
    case 'sign': add(assets.box(), assets.std(0x9b6b3d, 0.8), 0, 10, 3, 1.4, 34, 1.4); add(assets.box(), assets.std(0xffffff, 0.8, 0, { map: assets.label('ĐÌNH CÔNG!', '#f06d4f') }), 0, 28, 3, 26, 9, 1); break;
    case 'box': add(rbox, assets.std(0xc89a62, 0.9), 0, 2, 7, 20, 12, 14); add(assets.sphere(10), assets.std(0x5dbb7a, 0.7), 4, 10, 7, 6, 6, 6); break;
    case 'money': for (let index = 0; index < 3; index++) add(assets.box(), assets.std(0x7dcf8a, 0.8), index, index * 0.8, 3, 12, 0.4, 6); break;
    case 'controller': add(rbox, assets.std(0x2e2e3a, 0.4), 0, 0, 3, 11, 3, 6); break;
    case 'whistle': add(rbox, assets.std(0xd8d8df, 0.2, 0.9), 0, 0, 2, 3, 3, 5); break;
    case 'can': // energy-drink can ("bò húc"): blue/silver body, red band, gold top
      add(assets.cylinder(0.5, 0.5, 14), assets.std(0x2f5fb3, 0.3, 0.6), 0, 1.5, 2, 4.4, 8, 4.4);
      add(assets.cylinder(0.5, 0.5, 14), assets.std(THEME.red, 0.3, 0.4), 0, 1.5, 2, 4.6, 2.2, 4.6);
      add(assets.cylinder(0.5, 0.5, 14), assets.std(THEME.brass, 0.25, 0.8), 0, 5.8, 2, 4.2, 0.6, 4.2);
      break;
  }
  return group;
}
