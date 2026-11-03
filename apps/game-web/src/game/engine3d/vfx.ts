import * as THREE from 'three';
import type { Assets } from './assets';

/** Atlas cells (4×4) drawn procedurally — no external sprite assets. */
const CELL = { soft: 0, star: 1, heart: 2, anger: 3, note: 4, z: 5, spark: 6, drop: 7, square: 8, money: 9, sweat: 10, puff: 11, flower: 12, exclaim: 13, question: 14, bolt: 15 } as const;
type Curve = 'lerp' | 'pop' | 'flat';
export type ParticleKind = 'dust' | 'steam' | 'spark' | 'star' | 'heart' | 'anger' | 'note' | 'zzz' | 'confetti' | 'coffee' | 'water' | 'money' | 'sweat' | 'smoke' | 'petal' | 'exclaim' | 'question' | 'bolt';

interface Preset { cell: number; colors: number[]; size: [number, number]; life: [number, number]; speed: [number, number]; up: number; spread: number; gravity: number; drag: number; curve: Curve; spin: number; alpha: number; sway?: number }
const PRESETS: Record<ParticleKind, Preset> = {
  dust: { cell: CELL.puff, colors: [0xcfc7b8, 0xe2dccf], size: [6, 16], life: [0.5, 0.8], speed: [8, 22], up: 10, spread: 1, gravity: -6, drag: 2.5, curve: 'lerp', spin: 1, alpha: 0.55 },
  steam: { cell: CELL.puff, colors: [0xffffff, 0xf3f3f3], size: [3, 11], life: [1.2, 1.9], speed: [2, 5], up: 16, spread: 0.3, gravity: 4, drag: 0.6, curve: 'lerp', spin: 0.6, alpha: 0.45, sway: 6 },
  spark: { cell: CELL.spark, colors: [0xffffff, 0xffe38a, 0xffb347], size: [13, 3], life: [0.25, 0.4], speed: [90, 170], up: 20, spread: 1, gravity: -60, drag: 4, curve: 'lerp', spin: 6, alpha: 1 },
  star: { cell: CELL.star, colors: [0xffd25f, 0xfff1a8], size: [10, 6], life: [0.7, 1.1], speed: [40, 80], up: 60, spread: 1, gravity: -160, drag: 1, curve: 'lerp', spin: 5, alpha: 1 },
  heart: { cell: CELL.heart, colors: [0xff5f8f, 0xff8fb1, 0xff3d6e], size: [6, 11], life: [1.2, 1.8], speed: [6, 14], up: 28, spread: 0.6, gravity: 6, drag: 0.8, curve: 'pop', spin: 0.3, alpha: 1, sway: 10 },
  anger: { cell: CELL.anger, colors: [0xff3b30], size: [4, 13], life: [0.7, 0.9], speed: [0, 3], up: 3, spread: 0.2, gravity: 0, drag: 1, curve: 'pop', spin: 0, alpha: 1 },
  note: { cell: CELL.note, colors: [0x5b8bd6, 0xf06d4f, 0x5dbb7a, 0xffc861], size: [7, 10], life: [1.4, 1.8], speed: [6, 12], up: 22, spread: 0.7, gravity: 0, drag: 0.5, curve: 'pop', spin: 0.8, alpha: 1, sway: 12 },
  zzz: { cell: CELL.z, colors: [0x24365a, 0x5b8bd6], size: [5, 12], life: [1.8, 2.3], speed: [3, 6], up: 12, spread: 0.3, gravity: 0, drag: 0.3, curve: 'lerp', spin: 0.4, alpha: 1, sway: 8 },
  confetti: { cell: CELL.square, colors: [0xf06d4f, 0xffc861, 0x5dbb7a, 0x5b8bd6, 0xff8fb1, 0xa98be0], size: [6, 6], life: [2.6, 3.4], speed: [60, 140], up: 140, spread: 1, gravity: -110, drag: 1.6, curve: 'flat', spin: 9, alpha: 1, sway: 18 },
  coffee: { cell: CELL.drop, colors: [0x6b3a1a, 0x4a2a12], size: [5, 4], life: [0.6, 0.9], speed: [40, 90], up: 60, spread: 1, gravity: -380, drag: 0.4, curve: 'flat', spin: 0, alpha: 1 },
  water: { cell: CELL.drop, colors: [0x8fd3ff, 0x5fb8ff], size: [5, 4], life: [0.6, 0.9], speed: [40, 90], up: 60, spread: 1, gravity: -380, drag: 0.4, curve: 'flat', spin: 0, alpha: 1 },
  money: { cell: CELL.money, colors: [0xffffff], size: [10, 10], life: [2.5, 3.2], speed: [30, 80], up: 120, spread: 1, gravity: -70, drag: 1.8, curve: 'flat', spin: 4, alpha: 1, sway: 16 },
  sweat: { cell: CELL.sweat, colors: [0x8fd3ff], size: [6, 5], life: [0.5, 0.7], speed: [20, 40], up: 30, spread: 0.6, gravity: -200, drag: 0.5, curve: 'flat', spin: 0, alpha: 1 },
  smoke: { cell: CELL.puff, colors: [0xffffff, 0xd9d9d9], size: [5, 14], life: [0.8, 1.1], speed: [10, 20], up: 40, spread: 0.4, gravity: 8, drag: 1, curve: 'lerp', spin: 1, alpha: 0.8 },
  petal: { cell: CELL.flower, colors: [0xff8fb1, 0xffd25f, 0xffffff], size: [7, 7], life: [2, 2.6], speed: [30, 70], up: 80, spread: 1, gravity: -60, drag: 1.6, curve: 'flat', spin: 3, alpha: 1, sway: 14 },
  exclaim: { cell: CELL.exclaim, colors: [0xffc861], size: [4, 16], life: [0.9, 1.0], speed: [0, 0], up: 0, spread: 0, gravity: 0, drag: 0, curve: 'pop', spin: 0, alpha: 1 },
  question: { cell: CELL.question, colors: [0x5b8bd6], size: [4, 14], life: [1.1, 1.2], speed: [0, 0], up: 0, spread: 0, gravity: 0, drag: 0, curve: 'pop', spin: 0, alpha: 1 },
  bolt: { cell: CELL.bolt, colors: [0xffd25f], size: [4, 14], life: [0.5, 0.7], speed: [0, 10], up: 0, spread: 1, gravity: 0, drag: 0, curve: 'pop', spin: 0, alpha: 1 },
};
const CURVES: Curve[] = ['lerp', 'pop', 'flat'];

const VERTEX = /* glsl */`
attribute float size; attribute float alpha; attribute float cell; attribute float angle; attribute vec3 tint;
uniform float uScale;
varying float vAlpha; varying float vCell; varying float vAngle; varying vec3 vTint;
void main() {
  vAlpha = alpha; vCell = cell; vAngle = angle; vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAGMENT = /* glsl */`
uniform sampler2D uAtlas;
varying float vAlpha; varying float vCell; varying float vAngle; varying vec3 vTint;
void main() {
  if (vAlpha < 0.01) discard;
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vAngle), s = sin(vAngle);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) discard;
  vec2 cellUv = (vec2(mod(vCell, 4.0), floor(vCell / 4.0)) + p) / 4.0;
  vec4 texel = texture2D(uAtlas, vec2(cellUv.x, 1.0 - cellUv.y));
  gl_FragColor = vec4(texel.rgb * vTint, texel.a * vAlpha);
  #include <colorspace_fragment>
}`;

function drawAtlas(context: CanvasRenderingContext2D, size: number) {
  const cell = size / 4;
  const at = (index: number, draw: (cx: number, cy: number, r: number) => void) => { context.save(); draw((index % 4) * cell + cell / 2, Math.floor(index / 4) * cell + cell / 2, cell * 0.42); context.restore(); };
  const star = (cx: number, cy: number, r: number, points: number, inner: number) => { context.beginPath(); for (let i = 0; i < points * 2; i++) { const radius = i % 2 ? r * inner : r; const a = i / (points * 2) * Math.PI * 2 - Math.PI / 2; context.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius); } context.closePath(); };
  context.lineJoin = 'round';
  at(CELL.soft, (x, y, r) => { const g = context.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)'); context.fillStyle = g; context.fillRect(x - r, y - r, r * 2, r * 2); });
  at(CELL.star, (x, y, r) => { star(x, y, r, 5, 0.45); context.fillStyle = '#fff'; context.fill(); context.lineWidth = r * 0.12; context.strokeStyle = '#c98a1a'; context.stroke(); });
  at(CELL.heart, (x, y, r) => { context.beginPath(); context.moveTo(x, y + r * 0.8); context.bezierCurveTo(x - r * 1.3, y - r * 0.1, x - r * 0.5, y - r * 1.1, x, y - r * 0.35); context.bezierCurveTo(x + r * 0.5, y - r * 1.1, x + r * 1.3, y - r * 0.1, x, y + r * 0.8); context.fillStyle = '#fff'; context.fill(); });
  at(CELL.anger, (x, y, r) => { context.strokeStyle = '#fff'; context.lineWidth = r * 0.3; context.lineCap = 'round'; for (let q = 0; q < 4; q++) { const a = q * Math.PI / 2 + Math.PI / 4; const cx = x + Math.cos(a) * r * 0.5, cy = y + Math.sin(a) * r * 0.5; context.beginPath(); context.arc(cx, cy, r * 0.42, a + Math.PI * 0.75, a + Math.PI * 1.25); context.stroke(); } });
  at(CELL.note, (x, y, r) => { context.fillStyle = '#fff'; context.beginPath(); context.ellipse(x - r * 0.3, y + r * 0.5, r * 0.38, r * 0.28, -0.4, 0, Math.PI * 2); context.fill(); context.fillRect(x, y - r * 0.8, r * 0.16, r * 1.3); context.beginPath(); context.moveTo(x, y - r * 0.8); context.quadraticCurveTo(x + r * 0.8, y - r * 0.5, x + r * 0.5, y); context.lineWidth = r * 0.16; context.strokeStyle = '#fff'; context.stroke(); });
  at(CELL.z, (x, y, r) => { context.fillStyle = '#fff'; context.font = `900 ${r * 1.8}px sans-serif`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('Z', x, y); });
  at(CELL.spark, (x, y, r) => { star(x, y, r, 4, 0.18); context.fillStyle = '#fff'; context.fill(); });
  at(CELL.drop, (x, y, r) => { context.beginPath(); context.moveTo(x, y - r); context.quadraticCurveTo(x + r * 0.8, y + r * 0.1, x, y + r * 0.7); context.quadraticCurveTo(x - r * 0.8, y + r * 0.1, x, y - r); context.fillStyle = '#fff'; context.fill(); });
  at(CELL.square, (x, y, r) => { context.fillStyle = '#fff'; context.fillRect(x - r * 0.5, y - r * 0.8, r, r * 1.6); });
  at(CELL.money, (x, y, r) => { context.fillStyle = '#7dcf8a'; context.fillRect(x - r, y - r * 0.5, r * 2, r); context.strokeStyle = '#2f7a3f'; context.lineWidth = r * 0.1; context.strokeRect(x - r * 0.9, y - r * 0.42, r * 1.8, r * 0.84); context.fillStyle = '#2f7a3f'; context.font = `900 ${r * 0.8}px sans-serif`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('₫', x, y); });
  at(CELL.sweat, (x, y, r) => { context.beginPath(); context.moveTo(x, y - r); context.quadraticCurveTo(x + r * 0.7, y + r * 0.2, x, y + r * 0.6); context.quadraticCurveTo(x - r * 0.7, y + r * 0.2, x, y - r); context.fillStyle = '#fff'; context.fill(); });
  at(CELL.puff, (x, y, r) => { for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; const px = x + Math.cos(a) * r * 0.35, py = y + Math.sin(a) * r * 0.35; const g = context.createRadialGradient(px, py, 0, px, py, r * 0.6); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); context.fillStyle = g; context.fillRect(x - r, y - r, r * 2, r * 2); } });
  at(CELL.flower, (x, y, r) => { context.fillStyle = '#fff'; for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; context.beginPath(); context.arc(x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.45, r * 0.4, 0, Math.PI * 2); context.fill(); } context.fillStyle = '#ffd25f'; context.beginPath(); context.arc(x, y, r * 0.28, 0, Math.PI * 2); context.fill(); });
  at(CELL.exclaim, (x, y, r) => { context.fillStyle = '#fff'; context.strokeStyle = '#7a4a00'; context.lineWidth = r * 0.12; context.beginPath(); context.roundRect(x - r * 0.22, y - r, r * 0.44, r * 1.2, r * 0.2); context.fill(); context.stroke(); context.beginPath(); context.arc(x, y + r * 0.62, r * 0.24, 0, Math.PI * 2); context.fill(); context.stroke(); });
  at(CELL.question, (x, y, r) => { context.fillStyle = '#fff'; context.font = `900 ${r * 2}px sans-serif`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('?', x, y); });
  at(CELL.bolt, (x, y, r) => { context.beginPath(); context.moveTo(x + r * 0.2, y - r); context.lineTo(x - r * 0.5, y + r * 0.1); context.lineTo(x, y + r * 0.1); context.lineTo(x - r * 0.2, y + r); context.lineTo(x + r * 0.5, y - r * 0.15); context.lineTo(x, y - r * 0.15); context.closePath(); context.fillStyle = '#fff'; context.fill(); });
}

const tmpColor = new THREE.Color();
const tmpVec = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpScale = new THREE.Vector3();
const tmpMatrix = new THREE.Matrix4();

/**
 * One draw call for every billboard particle (Points + atlas shader) and one InstancedMesh for paper debris.
 * All buffers are preallocated: emitting never allocates three.js objects at runtime (object pooling).
 */
export class Vfx {
  readonly root = new THREE.Group();
  private capacity = 900;
  private count = 0;
  private pos = new Float32Array(this.capacity * 3);
  private vel = new Float32Array(this.capacity * 3);
  private life = new Float32Array(this.capacity);
  private maxLife = new Float32Array(this.capacity);
  private size0 = new Float32Array(this.capacity);
  private size1 = new Float32Array(this.capacity);
  private gravity = new Float32Array(this.capacity);
  private drag = new Float32Array(this.capacity);
  private spin = new Float32Array(this.capacity);
  private sway = new Float32Array(this.capacity);
  private baseAlpha = new Float32Array(this.capacity);
  private curve = new Uint8Array(this.capacity);
  private geometry = new THREE.BufferGeometry();
  private attributes: Record<'position' | 'size' | 'alpha' | 'cell' | 'angle' | 'tint', THREE.BufferAttribute>;
  private material: THREE.ShaderMaterial;
  private atlas: THREE.CanvasTexture;
  /** 0..1 particle count multiplier (adaptive quality). */
  density = 1;
  private paperCapacity = 160;
  private papers: THREE.InstancedMesh;
  private paperState: { active: boolean; pos: THREE.Vector3; vel: THREE.Vector3; rot: THREE.Euler; spin: THREE.Vector3; age: number; resting: boolean; scale: number }[] = [];
  private nextPaper = 0;
  private puddles: { mesh: THREE.Mesh; age: number }[] = [];

  constructor(assets: Assets) {
    this.root.name = 'vfx';
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    drawAtlas(canvas.getContext('2d')!, 512);
    this.atlas = new THREE.CanvasTexture(canvas); this.atlas.colorSpace = THREE.SRGBColorSpace;
    const attribute = (size: number) => { const value = new THREE.BufferAttribute(new Float32Array(this.capacity * size), size); value.setUsage(THREE.DynamicDrawUsage); return value; };
    this.attributes = { position: attribute(3), size: attribute(1), alpha: attribute(1), cell: attribute(1), angle: attribute(1), tint: attribute(3) };
    for (const [name, value] of Object.entries(this.attributes)) this.geometry.setAttribute(name, value);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4000);
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({ uniforms: { uAtlas: { value: this.atlas }, uScale: { value: 800 } }, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false });
    const points = new THREE.Points(this.geometry, this.material); points.frustumCulled = false; points.renderOrder = 10;
    this.root.add(points);

    this.papers = new THREE.InstancedMesh(assets.box(), assets.std(0xfbfbf6, 0.85), this.paperCapacity);
    this.papers.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.papers.castShadow = true; this.papers.frustumCulled = false;
    for (let index = 0; index < this.paperCapacity; index++) {
      this.paperState.push({ active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), age: 0, resting: false, scale: 1 });
      this.papers.setMatrixAt(index, tmpMatrix.makeScale(0, 0, 0));
    }
    this.root.add(this.papers);
    const puddleMaterial = assets.basic(0x5a3216, { transparent: true, opacity: 0.75, depthWrite: false });
    const puddleGeometry = assets.geometry('puddle', () => new THREE.CircleGeometry(0.5, 20));
    for (let index = 0; index < 6; index++) {
      const mesh = new THREE.Mesh(puddleGeometry, puddleMaterial);
      mesh.rotation.x = -Math.PI / 2; mesh.visible = false; mesh.renderOrder = 2; this.root.add(mesh);
      this.puddles.push({ mesh, age: 99 });
    }
  }
  /** Pixel scale for point sizes: viewport height / (2·tan(fov/2)). */
  setViewport(heightPixels: number, fovDegrees: number) { this.material.uniforms.uScale!.value = heightPixels / (2 * Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2)); }

  emit(kind: ParticleKind, origin: THREE.Vector3, count = 8, options: { direction?: THREE.Vector3; color?: number; scale?: number; spread?: number } = {}) {
    const preset = PRESETS[kind];
    const essential = kind === 'exclaim' || kind === 'question' || kind === 'anger' || kind === 'bolt';
    const total = Math.max(1, Math.round(count * (essential ? 1 : this.density)));
    for (let n = 0; n < total; n++) {
      if (this.count >= this.capacity) return;
      const index = this.count++;
      const speed = preset.speed[0] + Math.random() * (preset.speed[1] - preset.speed[0]);
      const theta = Math.random() * Math.PI * 2, spread = options.spread ?? preset.spread;
      let vx = Math.cos(theta) * speed * spread, vz = Math.sin(theta) * speed * spread, vy = preset.up * (0.6 + Math.random() * 0.6);
      if (options.direction) { vx += options.direction.x; vy += options.direction.y; vz += options.direction.z; }
      this.pos.set([origin.x + (Math.random() - 0.5) * 4, origin.y, origin.z + (Math.random() - 0.5) * 4], index * 3);
      this.vel.set([vx, vy, vz], index * 3);
      const scale = options.scale ?? 1;
      this.life[index] = 0; this.maxLife[index] = preset.life[0] + Math.random() * (preset.life[1] - preset.life[0]);
      this.size0[index] = preset.size[0] * scale; this.size1[index] = preset.size[1] * scale;
      this.gravity[index] = preset.gravity; this.drag[index] = preset.drag; this.spin[index] = (Math.random() - 0.5) * 2 * preset.spin;
      this.sway[index] = preset.sway ?? 0; this.baseAlpha[index] = preset.alpha; this.curve[index] = CURVES.indexOf(preset.curve);
      this.attributes.cell.setX(index, preset.cell);
      this.attributes.angle.setX(index, preset.spin ? Math.random() * Math.PI * 2 : 0);
      tmpColor.setHex(options.color ?? preset.colors[Math.floor(Math.random() * preset.colors.length)]!);
      this.attributes.tint.setXYZ(index, tmpColor.r, tmpColor.g, tmpColor.b);
    }
  }
  /** Sheets of paper with tumbling, air-dragged flight; they land and stay on the floor for ~25 s. */
  throwPapers(origin: THREE.Vector3, velocity: THREE.Vector3, count = 10, spread = 40) {
    for (let n = 0; n < Math.round(count * Math.max(0.5, this.density)); n++) {
      const state = this.paperState[this.nextPaper]!;
      this.nextPaper = (this.nextPaper + 1) % this.paperCapacity;
      state.active = true; state.resting = false; state.age = 0; state.scale = 1;
      state.pos.copy(origin).add(tmpVec.set((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6));
      state.vel.copy(velocity).add(tmpVec.set((Math.random() - 0.5) * spread, Math.random() * spread * 0.6, (Math.random() - 0.5) * spread));
      state.rot.set(Math.random() * 3, Math.random() * 6, Math.random() * 3);
      state.spin.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 12);
    }
  }
  spill(at: THREE.Vector3, size = 22) {
    const puddle = this.puddles.reduce((oldest, item) => item.age > oldest.age ? item : oldest);
    puddle.age = 0; puddle.mesh.visible = true; puddle.mesh.position.set(at.x, 0.6, at.z); puddle.mesh.scale.set(size, size * (0.7 + Math.random() * 0.3), 1);
    this.emit('coffee', tmpVec.set(at.x, 20, at.z), 14);
  }

  update(dt: number) {
    let index = 0;
    const { position, size, alpha, angle } = this.attributes;
    while (index < this.count) {
      this.life[index] = this.life[index]! + dt;
      if (this.life[index]! >= this.maxLife[index]!) { this.swapRemove(index); continue; }
      const t = this.life[index]! / this.maxLife[index]!;
      const damping = Math.exp(-this.drag[index]! * dt);
      const i3 = index * 3;
      this.vel[i3] = this.vel[i3]! * damping; this.vel[i3 + 2] = this.vel[i3 + 2]! * damping;
      this.vel[i3 + 1] = this.vel[i3 + 1]! * damping + this.gravity[index]! * dt;
      const sway = this.sway[index]! ? Math.sin(this.life[index]! * 4 + index) * this.sway[index]! * dt : 0;
      this.pos[i3] = this.pos[i3]! + this.vel[i3]! * dt + sway;
      this.pos[i3 + 1] = Math.max(0.5, this.pos[i3 + 1]! + this.vel[i3 + 1]! * dt);
      this.pos[i3 + 2] = this.pos[i3 + 2]! + this.vel[i3 + 2]! * dt;
      position.setXYZ(index, this.pos[i3]!, this.pos[i3 + 1]!, this.pos[i3 + 2]!);
      const curve = CURVES[this.curve[index]!];
      const from = this.size0[index]!, to = this.size1[index]!;
      const scale = curve === 'lerp' ? from + (to - from) * t : curve === 'pop' ? to * (t < 0.15 ? THREE.MathUtils.smootherstep(t / 0.15, 0, 1) * 1.15 : t > 0.8 ? 1 - (t - 0.8) / 0.2 * 0.6 : 1) : from;
      size.setX(index, scale);
      alpha.setX(index, this.baseAlpha[index]! * (t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1));
      angle.setX(index, angle.getX(index) + this.spin[index]! * dt);
      index++;
    }
    this.geometry.setDrawRange(0, this.count);
    for (const attribute of Object.values(this.attributes)) { attribute.clearUpdateRanges(); attribute.addUpdateRange(0, Math.max(1, this.count) * attribute.itemSize); attribute.needsUpdate = true; }

    let dirty = false;
    this.paperState.forEach((paper, paperIndex) => {
      if (!paper.active) return;
      paper.age += dt; dirty = true;
      if (!paper.resting) {
        paper.vel.multiplyScalar(Math.exp(-1.6 * dt));
        paper.vel.y = Math.max(-55, paper.vel.y - 260 * dt);
        paper.pos.addScaledVector(paper.vel, dt);
        paper.pos.x += Math.sin(paper.age * 7 + paperIndex) * 18 * dt;
        paper.rot.x += paper.spin.x * dt; paper.rot.y += paper.spin.y * dt; paper.rot.z += paper.spin.z * dt;
        if (paper.pos.y <= 0.8) { paper.pos.y = 0.6 + (paperIndex % 5) * 0.12; paper.resting = true; paper.rot.x = 0; paper.rot.z = 0; }
        paper.pos.x = THREE.MathUtils.clamp(paper.pos.x, -262, 262); paper.pos.z = THREE.MathUtils.clamp(paper.pos.z, -462, 462);
      }
      if (paper.age > 24) paper.scale = Math.max(0, 1 - (paper.age - 24));
      if (paper.scale <= 0) { paper.active = false; this.papers.setMatrixAt(paperIndex, tmpMatrix.makeScale(0, 0, 0)); return; }
      tmpQuat.setFromEuler(tmpEuler.copy(paper.rot));
      this.papers.setMatrixAt(paperIndex, tmpMatrix.compose(paper.pos, tmpQuat, tmpScale.set(11 * paper.scale, 0.4, 14 * paper.scale)));
    });
    if (dirty) this.papers.instanceMatrix.needsUpdate = true;
    for (const puddle of this.puddles) {
      if (!puddle.mesh.visible) continue;
      puddle.age += dt;
      if (puddle.age > 18) puddle.mesh.visible = false;
      else if (puddle.age > 15) puddle.mesh.scale.multiplyScalar(1 - dt * 0.6);
    }
  }
  private swapRemove(index: number) {
    const last = --this.count;
    if (index === last) return;
    for (const array of [this.pos, this.vel]) { array[index * 3] = array[last * 3]!; array[index * 3 + 1] = array[last * 3 + 1]!; array[index * 3 + 2] = array[last * 3 + 2]!; }
    for (const array of [this.life, this.maxLife, this.size0, this.size1, this.gravity, this.drag, this.spin, this.sway, this.baseAlpha]) array[index] = array[last]!;
    this.curve[index] = this.curve[last]!;
    this.attributes.cell.setX(index, this.attributes.cell.getX(last));
    this.attributes.angle.setX(index, this.attributes.angle.getX(last));
    this.attributes.tint.setXYZ(index, this.attributes.tint.getX(last), this.attributes.tint.getY(last), this.attributes.tint.getZ(last));
  }
  get activeParticles() { return this.count; }
  clear() {
    this.count = 0;
    this.paperState.forEach((paper, index) => { paper.active = false; this.papers.setMatrixAt(index, tmpMatrix.makeScale(0, 0, 0)); });
    this.papers.instanceMatrix.needsUpdate = true;
    this.puddles.forEach(puddle => { puddle.mesh.visible = false; });
  }
  dispose() { this.geometry.dispose(); this.material.dispose(); this.atlas.dispose(); this.papers.dispose(); }
}
