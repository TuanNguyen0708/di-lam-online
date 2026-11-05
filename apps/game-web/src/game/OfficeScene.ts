import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameState, Player } from '@di-lam/shared';
import { Assets, PALETTE } from './engine3d/assets';
import { AudioEngine } from './engine3d/audio';
import { Character } from './engine3d/character';
import { Director, type Announcement } from './engine3d/director';
import { JUICE, JUICE_LIMITS, giftLevel, likeBurst, type JuiceLevel } from './engine3d/juice';
import { CameraRig, LabelLayer, ScreenFlash, type CameraMode } from './engine3d/presentation';
import { Vfx } from './engine3d/vfx';
import { OfficeWorld } from './engine3d/world';
import { SAFE_ZONE, officeFrameFraction } from './safe-zone';

export type Quality = 'auto' | 'high' | 'medium' | 'low';
type Tier = Exclude<Quality, 'auto'>;
export interface SceneStats { fps: number; tier: Tier; drawCalls: number; triangles: number; geometries: number; textures: number; particles: number; actors: number; pops: number }
export interface SceneCallbacks { onStatus: (status: 'ready' | 'error') => void; onAnnounce?: (item: Announcement) => void; onStats?: (stats: SceneStats) => void }

const TIERS: Record<Tier, { pixelRatio: number; shadows: boolean; shadowSize: number; characterShadows: boolean; density: number }> = {
  high: { pixelRatio: 2, shadows: true, shadowSize: 2048, characterShadows: true, density: 1 },
  medium: { pixelRatio: 1.5, shadows: true, shadowSize: 1024, characterShadows: false, density: 0.7 },
  low: { pixelRatio: 1, shadows: false, shadowSize: 512, characterShadows: false, density: 0.4 },
};
/** Toasts waiting to be shown; older ones are dropped under spam. */
const ANNOUNCE_QUEUE = 3;

/**
 * Renders the 3D office and turns server snapshots into choreography. The server stays authoritative:
 * this class only visualizes `GameState` (players, effects, phase, boss HP) and never mutates gameplay.
 * Juice (shake, flashes, like hearts, boss alerts) is derived from snapshot deltas and the JUICE table.
 */
export class OfficeScene {
  private scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private observer: ResizeObserver;
  private assets: Assets;
  private world: OfficeWorld;
  private vfx: Vfx;
  private audio = new AudioEngine();
  private rig = new CameraRig();
  private labels: LabelLayer;
  private flash: ScreenFlash;
  private director: Director;
  private sun: THREE.DirectionalLight;
  private environment: THREE.Texture;
  private apron: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private session = '';
  private lastEffect = 0;
  private lastLikes: number | null = null;
  private lastPhase: GameState['phase'] | null = null;
  private bossAlertAt = -99;
  private announceQueue: Announcement[] = [];
  private announceAt = 0;
  private initialized = false;
  private paused = false;
  private elapsed = 0;
  private lastFrame = 0;
  private quality: Quality = 'auto';
  private tier: Tier = 'high';
  private frameWindow: number[] = [];
  private renderScale: number | null = null;
  /** Fastest 120-frame average seen: the host's frame cap (OBS browser sources default to 30 FPS). */
  private bestAverage = Infinity;
  private tierChangedAt = 0;
  private statsAt = 0;
  private framesThisSecond = 0;
  private size = { width: 1, height: 1 };
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private lost = (event: Event) => { event.preventDefault(); this.callbacks.onStatus('error'); };
  private restored = () => this.callbacks.onStatus('ready');

  constructor(private host: HTMLDivElement, private callbacks: SceneCallbacks) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.renderer.domElement.addEventListener('webglcontextlost', this.lost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.restored);
    host.appendChild(this.renderer.domElement);
    this.assets = new Assets(this.renderer);

    // soft image-based light for subtle reflections on glass, metal and mugs
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04).texture;
    room.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } });
    pmrem.dispose();
    this.scene.environment = this.environment; this.scene.environmentIntensity = 0.35;
    this.scene.background = new THREE.Color(PALETTE.navyDeep);

    this.scene.add(new THREE.HemisphereLight(0xfff6e8, 0x6f7fa0, 1.5));
    this.sun = new THREE.DirectionalLight(0xffe7c4, 2.6);
    this.sun.position.set(-320, 760, 260); this.sun.target.position.set(0, 0, -20);
    this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, { left: -560, right: 560, top: 560, bottom: -560, near: 100, far: 2200 });
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6; this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight(0xbcd4ff, 0.7); fill.position.set(400, 300, 500); this.scene.add(fill);

    this.world = new OfficeWorld(this.assets); this.scene.add(this.world.root);
    // dark lobby floor in front of the office: fills the TikTok comment zone and keeps white comment text readable
    this.apron = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1400), new THREE.MeshStandardMaterial({ color: PALETTE.navy, roughness: 0.95 }));
    this.apron.rotation.x = -Math.PI / 2; this.apron.position.set(0, -6, 470 + 698); this.apron.receiveShadow = true;
    this.scene.add(this.apron);
    this.vfx = new Vfx(this.assets); this.scene.add(this.vfx.root);
    this.labels = new LabelLayer(host);
    this.labels.safeRight = SAFE_ZONE.right;
    this.flash = new ScreenFlash(host);
    this.director = new Director({
      root: this.scene, assets: this.assets, world: this.world, vfx: this.vfx, audio: this.audio, camera: this.rig, labels: this.labels,
      announce: item => this.enqueueAnnouncement(item),
      alert: () => this.bossAlert(),
    });
    this.rig.followPoint = () => this.director.heroPoint();
    this.applyTier(this.initialTier());
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host); this.resize();
    this.renderer.setAnimationLoop(time => this.render(time));
    this.callbacks.onStatus('ready');
  }

  // ---------------------------------------------------------------- options
  setQuality(quality: Quality) { this.quality = quality; this.applyTier(quality === 'auto' ? this.initialTier() : quality); }
  /** Fixed render scale (URL `&scale=`), overriding the tier's; `null` = tier default. */
  setRenderScale(scale: number | null) { this.renderScale = scale; this.applyTier(this.tier); }
  setCameraMode(mode: CameraMode) { this.rig.mode = mode; }
  async setSound(enabled: boolean) { if (enabled) return this.audio.enable(); this.audio.disable(); return false; }
  private initialTier(): Tier { return window.devicePixelRatio > 2.5 || navigator.hardwareConcurrency <= 4 ? 'medium' : 'high'; }
  private applyTier(tier: Tier) {
    this.tier = tier; this.tierChangedAt = this.elapsed;
    const preset = TIERS[tier];
    // Supersample regardless of devicePixelRatio: OBS / TikTok LIVE Studio browser sources run at DPR 1, so
    // min(DPR, …) rendered the stream at 1x while a 125–150% Windows desktop rendered the same page sharper.
    this.renderer.setPixelRatio(this.renderScale ?? preset.pixelRatio);
    this.renderer.shadowMap.enabled = preset.shadows;
    this.sun.castShadow = preset.shadows;
    if (this.sun.shadow.mapSize.x !== preset.shadowSize) { this.sun.shadow.mapSize.set(preset.shadowSize, preset.shadowSize); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    this.director.actors.forEach(actor => actor.ch.setShadowQuality(preset.characterShadows));
    this.vfx.density = preset.density * (this.reducedMotion.matches ? 0.5 : 1);
    this.scene.traverse(object => { const material = (object as THREE.Mesh).material; if (material && !Array.isArray(material)) material.needsUpdate = true; });
    this.resize();
  }
  /**
   * Drop one tier when frames run clearly slower than the host's own frame cap (and below ~48 FPS).
   * A 30 FPS OBS browser source used to read as "slow" and was dropped to low quality. Never oscillates back up.
   */
  private adapt(frameSeconds: number) {
    if (this.quality !== 'auto' || this.elapsed < 4 || this.paused) return;
    this.frameWindow.push(frameSeconds);
    if (this.frameWindow.length < 120) return;
    const average = this.frameWindow.reduce((sum, value) => sum + value, 0) / this.frameWindow.length;
    this.frameWindow.length = 0;
    this.bestAverage = Math.min(this.bestAverage, average);
    const budget = Math.max(1 / 48, this.bestAverage * 1.3);
    if (average > budget && this.tier !== 'low' && this.elapsed - this.tierChangedAt > 4) this.applyTier(this.tier === 'high' ? 'medium' : 'low');
  }

  // ---------------------------------------------------------------- juice
  /** Toasts are rate-limited (one per announceInterval); under spam only the newest few survive. */
  private enqueueAnnouncement(item: Announcement) {
    this.announceQueue.push(item);
    if (this.announceQueue.length > ANNOUNCE_QUEUE) this.announceQueue.shift();
  }
  private applyJuice(level: JuiceLevel) {
    const spec = JUICE[level];
    this.rig.shake(spec.shake);
    this.flash.flash(spec.flash);
  }
  /** Red "boss incoming" flash + everyone flinches. Throttled so back-to-back triggers read as one alert. */
  private bossAlert() {
    if (this.elapsed - this.bossAlertAt < JUICE_LIMITS.bossAlertSeconds) return;
    this.bossAlertAt = this.elapsed;
    const spec = JUICE.boss;
    this.rig.shake(spec.shake);
    this.flash.flash(spec.flash, '⚠ SẾP ĐẾN!');
    this.director.actors.forEach(actor => { if (actor.kind !== 'boss') actor.ch.jolt(spec.jolt); });
  }

  // ---------------------------------------------------------------- server snapshot → scene
  /** `players` = every viewer to show (the whole snapshot roster; no floors / paging). */
  sync(state: GameState, players: readonly Player[]) {
    const newSession = this.session !== state.sessionId;
    const initial = !this.initialized || newSession;
    if (newSession) {
      this.session = state.sessionId; this.lastEffect = state.effects.at(-1)?.id ?? 0;
      this.vfx.clear(); this.labels.clear(); this.announceQueue.length = 0; this.lastLikes = null;
    }
    this.paused = state.paused;
    // new viewers get their character BEFORE effects, so a first command (auto check-in + damsep) is acted out
    this.director.spawnPlayers(players, false, initial);
    this.director.setVotes(state.votes);
    this.director.setCombo(state.combo);
    this.director.setNpcsEnabled(state.settings?.npcs ?? true);
    this.director.setPhase(state.phase, state, initial);
    if (!initial && !this.paused && state.phase !== this.lastPhase && (state.phase === 'incident' || state.phase === 'battle')) this.bossAlert();
    this.lastPhase = state.phase;
    // effects first, so a resigning player's actor still exists to walk out
    const fresh = state.effects.filter(effect => effect.id > this.lastEffect);
    if (fresh.length) this.lastEffect = fresh.at(-1)!.id;
    if (!initial && !this.paused) {
      let commentShake = false;
      for (const effect of fresh.slice(-8)) {
        this.director.handleEffect(effect, players);
        if (effect.type === 'gift') this.applyJuice(giftLevel(effect.tier ?? 1));
        else if (effect.type === 'drama3' || effect.type === 'chaos') this.bossAlert();
        else if (effect.playerId && effect.type !== 'chat' && effect.type !== 'denied') commentShake = true;
      }
      if (commentShake) this.applyJuice('comment');
    }
    // likes have no per-like effect on the server: diff the counter between snapshots
    if (!initial && !this.paused && this.lastLikes !== null) {
      const delta = state.likes - this.lastLikes;
      if (delta > 0) this.director.likeBurst(likeBurst(delta), delta);
    }
    this.lastLikes = state.likes;
    // departures AFTER effects, so a resigning player's character still exists to walk out with their box
    this.director.retirePlayers(players, initial);
    this.director.setBossDefeated(state.bossHp === 0);
    this.initialized = true;
  }

  private resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.size = { width, height };
    this.renderer.setSize(width, height, false);
    // 'fill' (default): the office fills its band; 'safe': framed above the TikTok comment zone (see safe-zone.ts)
    const framedHeight = this.rig.fit(width, height, officeFrameFraction());
    this.vfx.setViewport(framedHeight * this.renderer.getPixelRatio(), this.rig.camera.fov);
  }
  private render(time: number) {
    const frame = Math.min(0.1, (time - (this.lastFrame || time)) / 1000);
    this.lastFrame = time;
    const dt = this.paused ? 0 : Math.min(0.05, frame);
    this.elapsed += dt;
    const reduced = this.reducedMotion.matches;
    this.rig.reducedMotion = reduced; this.labels.reducedMotion = reduced; this.flash.reducedMotion = reduced; Character.reducedMotion = reduced;
    if (this.announceQueue.length && time - this.announceAt >= JUICE_LIMITS.announceInterval * 1000) {
      this.announceAt = time;
      this.callbacks.onAnnounce?.(this.announceQueue.shift()!);
    }
    if (dt > 0) {
      this.director.update(dt, this.elapsed);
      this.world.update(dt, this.elapsed, new Date());
      this.vfx.update(dt);
      for (const screen of this.world.screens) if (screen.mode === 'code' || screen.mode === 'game') screen.update(this.elapsed);
    }
    this.rig.update(frame);
    this.audio.listener = { x: this.rig.focusPoint.x, z: this.rig.focusPoint.z };
    this.renderer.render(this.scene, this.rig.camera);
    this.labels.update(this.rig.camera, this.size.width, this.size.height, this.elapsed);
    // ignore stalls from background/occluded tabs so they never trigger a quality drop
    if (frame < 0.09 && document.visibilityState === 'visible') this.adapt(frame);
    this.framesThisSecond++;
    if (this.callbacks.onStats && time - this.statsAt > 1000) {
      const info = this.renderer.info;
      const fps = Math.round(this.framesThisSecond * 1000 / (time - this.statsAt)); this.framesThisSecond = 0;
      this.callbacks.onStats({ fps, tier: this.tier, drawCalls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, particles: this.vfx.activeParticles, actors: this.director.actors.size, pops: this.labels.activePops });
      this.statsAt = time;
    }
  }
  dispose() {
    this.renderer.setAnimationLoop(null); this.observer.disconnect();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.lost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.restored);
    this.director.dispose(); this.world.dispose(); this.vfx.dispose(); this.labels.dispose(); this.flash.dispose(); this.audio.dispose();
    this.apron.geometry.dispose(); this.apron.material.dispose();
    this.assets.dispose(); this.environment.dispose(); this.sun.shadow.map?.dispose();
    this.renderer.dispose(); this.renderer.domElement.remove(); this.scene.clear();
  }
}
