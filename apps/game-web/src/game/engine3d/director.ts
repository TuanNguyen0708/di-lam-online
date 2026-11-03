import * as THREE from 'three';
import { ROLES } from '@di-lam/shared';
import type { Effect, GameState, Phase, Player } from '@di-lam/shared';
import type { Assets } from './assets';
import type { AudioEngine, SoundName } from './audio';
import { Character, hashString, OFFICE_STATES, type Archetype, type Expression, type PropName } from './character';
import type { ClipName } from './clips';
import { JUICE, JUICE_LIMITS, giftLevel, sparkChance } from './juice';
import type { BubbleTone, CameraRig, LabelLayer, PopStyle } from './presentation';
import type { ParticleKind, Vfx } from './vfx';
import { DEPARTMENT_COLORS, type DeskAnchor, type OfficeWorld, type Seat } from './world';
import { NPC_ROSTER } from '../npc-roster';

/** A behaviour is a generator; each `yield` waits one frame and receives the frame delta (seconds). */
type Task = Generator<unknown, void, number>;
type ActorKind = 'viewer' | 'npc' | 'boss' | 'manager';
interface Pending { make: () => Task; priority: number; label: string }
export interface Actor {
  id: string; name: string; kind: ActorKind; ch: Character; personality: Archetype; slot: number;
  desk: DeskAnchor | null; seat: Seat | null; deskSeated: boolean;
  task: Task | null; priority: number; label: string; pending: Pending[]; executing: boolean;
  leaving: boolean; moving: boolean; stepTimer: number; dustTimer: number; errandTimer: number;
  sleeping: boolean; gaming: boolean; reactionAt: number; plateAnchor: THREE.Vector3; bubbleAnchor: THREE.Vector3;
}
export interface Announcement { text: string; tone: 'drama' | 'action' | 'good' | 'system' }

const LINES = {
  chat: ['Deadline dí quá trời!', 'Trưa nay ăn gì đây?', 'Sếp đang nhìn kìa!', 'Tháng này có thưởng không ta?', 'File final_v3 đâu rồi?', 'Wifi lag quá!', 'Còn 5 phút là tan ca!', 'Cà phê không? Tui bao!', 'Họp xong lại họp…', 'KPI tháng này căng nha!'],
  gossip: ['Nghe gì chưa?', 'Bí mật nha…', 'Thật luôn á?!', 'Trời ơi drama!', 'Kể tiếp đi!', 'Đừng nói ai nha!'],
  boss: ['Ngủ à? Trừ lương!', 'Đang giờ làm việc đó!', 'Báo cáo đâu?!', 'Cái này đơn giản mà!', 'Deadline 5h chiều nhé!', 'Làm việc đi!!!'],
  argue: ['Em làm cả đêm mà!', 'Không phải lỗi của em!', 'Anh nói lại xem!', 'Vô lý thật sự!', 'Ai chả biết!', 'Hứ! Không chơi!'],
  reply: ['Ờ ha!', 'Chuẩn luôn!', 'Thôi làm đi ông ơi', 'Haha đúng rồi', 'Tui cũng vậy…', 'Hả? Nói lại coi'],
  hurt: ['ÁI DA!', 'Đau quá!', 'Sao đánh em?!', 'Ối giời ơi!'],
  flatter: ['Sếp hôm nay phong độ quá!', 'Ý tưởng của sếp đỉnh thật!', 'Em pha cà phê cho sếp nhé?', 'Sếp là nhất công ty!', 'Áo sếp đẹp thế ạ!'],
  flatterBoss: ['Khá lắm, em!', 'Biết điều đấy!', 'Cuối năm xét thưởng!', 'Ừ, anh biết mà.'],
  flatterGossip: ['Nịnh thế!', 'Ghê chưa…', 'Chạy KPI bằng miệng!', 'Lại nữa rồi…'],
};
const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]!;
/**
 * A viewer's own command outranks idle (0), ambient chains (1), reactions (2.5) and drama scenes (3); only leaving (9)
 * beats it. Commands typed while one is still playing queue up (at most COMMAND_QUEUE) instead of being dropped.
 */
const COMMAND_PRIORITY = 3.5;
const COMMAND_QUEUE = 3;
/** Open floor spots for viewers without a desk (spread so a crowd does not stack on one point). */
function standingSpot(index: number) {
  const angle = index * 2.399963; // golden angle
  const radius = 40 + (index % 7) * 18;
  return new THREE.Vector3(Math.cos(angle) * radius * 1.6, 0, -190 + Math.sin(angle) * radius * 0.6);
}
/** Where each roster NPC appears when spawned. */
const NPC_SPOTS = [v3Spot(-150, -160), v3Spot(-40, -200), v3Spot(60, -150), v3Spot(140, -190), v3Spot(-200, -120)];
function v3Spot(x: number, z: number) { return new THREE.Vector3(x, 0, z); }
const VIEWER_PERSONALITIES: Archetype[] = ['worker', 'worker', 'intern', 'drama', 'lazy', 'gamer', 'worker'];
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface DirectorDeps {
  root: THREE.Object3D; assets: Assets; world: OfficeWorld; vfx: Vfx; audio: AudioEngine; camera: CameraRig; labels: LabelLayer;
  announce: (item: Announcement) => void;
  /** Raised when the boss starts hunting employees (red warning flash). */
  alert?: (kind: 'boss') => void;
}

/**
 * Drives every character. Each actor runs one prioritized, interruptible behaviour (generator) at a time:
 *  0 idle routines · 1 ambient chains · 2 viewer actions · 2.5 reactions · 3 drama/phase scenes · 9 leaving.
 * Higher priority interrupts (generator.return() runs `finally` cleanup), lower priority queues (max 2).
 * Scenes are multi-actor generators that assign sub-tasks and wait on them (event chaining).
 */
export class Director {
  readonly actors = new Map<string, Actor>();
  boss!: Actor;
  manager!: Actor;
  private scenes: { task: Task; label: string }[] = [];
  private time = 0;
  private phase: Phase = 'work';
  private bossDefeated = false;
  private ambientTimer = 12;
  private recentAmbient: string[] = [];
  private cooldowns = new Map<string, number>();
  private plane: THREE.Group;
  private planeFlight: { from: THREE.Vector3; to: THREE.Vector3; t: number; duration: number; onHit: () => void } | null = null;
  private votes = { strike: 0, work: 0 };
  private errors = 0;
  private combo = 0;
  private kpiPopAt = -9;
  private likeTextAt = -9;
  heroId: string | null = null;

  constructor(private deps: DirectorDeps) {
    const { assets } = deps;
    this.boss = this.spawn('boss', 'SẾP TỔNG', 'boss', 'boss', -1);
    this.manager = this.spawn('manager', 'TRƯỞNG PHÒNG', 'manager', 'manager', -1);
    this.spawnNpcs();
    this.place(this.boss, deps.world.anchors.bossSeat.position);
    this.seatInstant(this.boss, deps.world.anchors.bossSeat);
    this.manager.ch.position.set(10, 0, -230);
    this.manager.ch.holding('clipboard');
    // reusable paper airplane
    this.plane = new THREE.Group(); this.plane.visible = false;
    const wing = new THREE.Mesh(assets.geometry('plane-wing', () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 7, -5, 0, -5, 0, 1.5, -4, 0, 0, 7, 0, 1.5, -4, 5, 0, -5], 3)); g.computeVertexNormals(); return g; }), assets.std(0xffffff, 0.8, 0, { side: THREE.DoubleSide }));
    wing.castShadow = true; this.plane.add(wing); deps.root.add(this.plane);
  }

  // ------------------------------------------------------------------ actors
  private npcsEnabled = true;
  private spawnNpcs() {
    NPC_ROSTER.forEach((npc, index) => {
      if (this.actors.has(npc.id)) return;
      const actor = this.spawn(npc.id, npc.name, 'npc', npc.archetype, -1);
      actor.ch.position.copy(NPC_SPOTS[index % NPC_SPOTS.length]!);
    });
  }
  /** Operator setting: show or remove the ambient NPC coworkers (boss and manager always stay). */
  setNpcsEnabled(enabled: boolean) {
    if (enabled === this.npcsEnabled) return;
    this.npcsEnabled = enabled;
    if (enabled) this.spawnNpcs();
    else for (const actor of this.npcs()) this.despawn(actor);
  }
  private spawn(id: string, name: string, kind: ActorKind, archetype: Archetype, slot: number): Actor {
    const ch = new Character(this.deps.assets, id, archetype, hashString(id));
    this.deps.root.add(ch.root);
    const actor: Actor = { id, name, kind, ch, personality: archetype, slot, desk: null, seat: null, deskSeated: false, task: null, priority: -1, label: '', pending: [], executing: false, leaving: false, moving: false, stepTimer: 0, dustTimer: 0, errandTimer: 4 + Math.random() * 10, sleeping: false, gaming: false, reactionAt: -9, plateAnchor: new THREE.Vector3(), bubbleAnchor: new THREE.Vector3() };
    this.actors.set(id, actor);
    const variant = kind === 'viewer' ? 'viewer' : kind === 'boss' ? 'boss' : 'npc';
    this.deps.labels.setPlate(id, name, variant, () => ch.headFast(actor.plateAnchor).setY(actor.plateAnchor.y + 13 * ch.bodyScale), kind === 'viewer' ? `#${DEPARTMENT_COLORS[0].toString(16)}` : undefined);
    return actor;
  }
  private despawn(actor: Actor) {
    if (actor.task) { try { actor.task.return(); } catch { /* cleanup only */ } }
    actor.task = null;
    if (actor.desk) this.releaseDesk(actor);
    this.deps.labels.removePlate(actor.id);
    actor.ch.dispose();
    this.actors.delete(actor.id);
  }
  private place(actor: Actor, point: THREE.Vector3) { actor.ch.position.set(point.x, 0, point.z); }
  private seatInstant(actor: Actor, seat: Seat) {
    this.place(actor, seat.position); actor.ch.heading = actor.ch.targetHeading = seat.facing; actor.ch.sit(seat.height); actor.ch.seated = 1; actor.seat = seat;
  }
  private bubbleAnchor(actor: Actor) { return () => actor.ch.headFast(actor.bubbleAnchor).setY(actor.bubbleAnchor.y + 30 * actor.ch.bodyScale); }
  private viewers() { return [...this.actors.values()].filter(actor => actor.kind === 'viewer' && !actor.leaving); }
  private npcs() { return [...this.actors.values()].filter(actor => actor.kind === 'npc'); }
  private everyone() { return [...this.actors.values()].filter(actor => !actor.leaving); }
  private near(point: THREE.Vector3, radius: number, exclude: Actor[] = []) { return this.everyone().filter(actor => !exclude.includes(actor) && actor.ch.position.distanceTo(point) < radius); }

  // ------------------------------------------------------------------ desks
  private deskOwner(desk: DeskAnchor) { return [...this.actors.values()].find(actor => actor.desk === desk); }
  private releaseDesk(actor: Actor) { if (actor.desk) { actor.desk.screen.set('off', this.time); actor.desk.chairSpin = 0; } actor.desk = null; actor.deskSeated = false; }
  /** Viewers always get a desk; NPCs only borrow free ones and are evicted (politely) when a viewer needs it. */
  private claimDesk(actor: Actor, preferred: number) {
    const desks = this.deps.world.desks;
    const free = (desk: DeskAnchor) => !this.deskOwner(desk);
    let desk = desks[preferred] && free(desks[preferred]!) ? desks[preferred]! : desks.find(free);
    if (!desk && actor.kind === 'viewer') {
      const npc = [...this.actors.values()].find(other => other.kind === 'npc' && other.desk);
      if (npc) { desk = npc.desk!; this.evict(npc); }
    }
    if (desk) { actor.desk = desk; actor.slot = desk.slot; this.deps.labels.setPlate(actor.id, actor.name, actor.kind === 'viewer' ? 'viewer' : 'npc', () => actor.ch.headFast(actor.plateAnchor).setY(actor.plateAnchor.y + 13 * actor.ch.bodyScale), `#${DEPARTMENT_COLORS[desk.slot % 3]!.toString(16).padStart(6, '0')}`); }
    return desk;
  }
  private evict(npc: Actor) {
    const wasSeated = npc.deskSeated;
    this.releaseDesk(npc);
    if (wasSeated) this.assign(npc, 'evicted', 1.8, () => this.evicted(npc));
  }
  private *evicted(npc: Actor): Task {
    yield* this.standUp(npc);
    this.say(npc, 'Ơ… nhường chỗ ạ!', 'talk');
    yield* this.walkTo(npc, v3(-60 + Math.random() * 120, 0, -150 - Math.random() * 60));
  }

  // ------------------------------------------------------------------ sync from server snapshot
  /** Full roster sync (spawn new viewers, retire missing ones). */
  syncPlayers(players: readonly Player[], cut: boolean, initial: boolean) {
    this.retirePlayers(players, cut || initial);
    this.spawnPlayers(players, cut, initial);
  }
  /** Viewers no longer in the snapshot walk out (or vanish on a session change / first load). */
  retirePlayers(players: readonly Player[], instant: boolean) {
    const ids = new Set(players.map(player => player.id));
    for (const actor of [...this.actors.values()]) {
      if (actor.kind !== 'viewer' || ids.has(actor.id) || actor.leaving) continue;
      if (instant) this.despawn(actor);
      else { actor.leaving = true; this.assign(actor, 'leave', 9, () => this.leave(actor, false)); }
    }
  }
  /**
   * Every visible viewer gets a character. The first 12 sit at desks (NPCs give theirs up); everyone after that
   * works standing — coffee runs, water cooler, sofa — and claims a desk when one frees up.
   */
  spawnPlayers(players: readonly Player[], cut: boolean, initial: boolean) {
    players.forEach((player, index) => {
      let actor = this.actors.get(player.id);
      if (actor) {
        const label = `${player.name}`;
        if (actor.name !== label) { actor.name = label; this.deps.labels.setPlate(actor.id, label, 'viewer', () => actor!.ch.headFast(actor!.plateAnchor).setY(actor!.plateAnchor.y + 13 * actor!.ch.bodyScale)); }
        return;
      }
      const personality = VIEWER_PERSONALITIES[hashString(player.id) % VIEWER_PERSONALITIES.length]!;
      actor = this.spawn(player.id, player.name, 'viewer', personality, index);
      // joining the LIVE = already in the office: appear straight at the desk (or a standing spot), no walk-in
      const desk = this.claimDesk(actor, index);
      if (desk) { this.seatInstant(actor, { position: desk.seat, facing: 0, height: 16 }); actor.deskSeated = true; actor.seat = null; }
      else this.place(actor, standingSpot(index));
      if (!cut && !initial) this.assign(actor, 'arrive', 2, () => this.arrive(actor!));
    });
    if (cut) { this.deps.vfx.clear(); this.deps.labels.clear(); }
  }
  setVotes(votes: { strike: number; work: number }) { this.votes = votes; }
  /** Room combo from the snapshot; above the threshold keyboards throw sparks. */
  setCombo(combo: number) { this.combo = combo; }
  /** Like juice: a logarithmic heart burst over random employees, plus "+N ❤" for big batches. */
  likeBurst(hearts: number, delta: number) {
    const crowd = this.viewers().length ? this.viewers() : this.npcs();
    if (!crowd.length) return;
    for (let index = 0; index < hearts; index++) this.emit('heart', this.head(pick(crowd)).add(tmp2.set(0, 12, 0)), 1);
    if (delta >= JUICE_LIMITS.likeTextMin && this.time - this.likeTextAt > 0.6) {
      this.likeTextAt = this.time;
      this.pop(this.head(pick(crowd)).add(tmp2.set(0, 30, 0)), `+${delta.toLocaleString('vi-VN')} ❤`, 'score', 1.2);
    }
  }
  setBossDefeated(defeated: boolean) {
    if (defeated === this.bossDefeated) return;
    this.bossDefeated = defeated;
    if (!defeated) { this.boss.ch.knockedOut = false; this.boss.ch.dizzy.visible = false; this.restartIdle(this.boss); }
  }
  setPhase(phase: Phase, state: GameState, initial: boolean) {
    if (phase === this.phase) return;
    this.phase = phase;
    this.deps.audio.mood = phase === 'battle' || phase === 'incident' ? 'drama' : 'calm';
    if (initial) return;
    if (phase === 'incident') this.runScene('incident', this.sceneIncident(state.scenario.title));
    if (phase === 'vote') this.runScene('meeting', this.sceneMeeting());
    if (phase === 'battle') this.runScene('battle', this.sceneBattle());
    if (phase === 'results' && !this.bossDefeated) this.runScene('results', this.sceneResults());
    if (phase === 'work') { this.deps.world.tv.set('slides', this.time); [...this.actors.values()].forEach(actor => { if (actor.priority <= 1) this.restartIdle(actor); }); }
  }

  // ------------------------------------------------------------------ server effects → choreography
  handleEffect(effect: Effect, players: readonly Player[]) {
    const actor = effect.playerId ? this.actors.get(effect.playerId) : undefined;
    const target = effect.targetId ? this.actors.get(effect.targetId) : undefined;
    const name = actor?.name ?? players.find(player => player.id === effect.playerId)?.name ?? '';
    const say = (text: string, tone: Announcement['tone'] = 'action') => this.deps.announce({ text: name ? `${name}: ${text}` : text, tone });
    // a viewer's command is always acted out by their own character (see COMMAND_PRIORITY)
    const act = (label: string, make: (self: Actor) => Task) => { if (!actor || !this.command(actor, label, () => make(actor))) return false; this.heroId = actor.id; return true; };
    switch (effect.type) {
      case 'join': say('vừa vào phòng!', 'system'); if (actor) this.heroId = actor.id; break;
      case 'denied': if (actor) { this.say(actor, effect.text, 'talk', 1.8); actor.ch.emote('sad', 1.8); } break;
      case 'hit':
        say(`ĐẤM SẾP ${effect.text}`, 'drama');
        if (!act('punch', self => this.punchBoss(self, effect.text))) this.remoteHit(effect.text);
        break;
      case 'slam': say(effect.text, 'drama'); act('slam', self => this.slamDesk(self)); break;
      case 'raise': say(effect.text, effect.text.startsWith('+') ? 'good' : 'action'); act('raise', self => this.askRaise(self, effect.text.startsWith('+'))); break;
      case 'resign': say('nộp đơn nghỉ việc!', 'system'); if (actor) { actor.leaving = true; this.assign(actor, 'leave', 9, () => this.leave(actor, true)); } break;
      case 'report': say(effect.text, 'drama'); act('report', self => this.exposeBoss(self)); break;
      case 'coffee':
        // every third order is an energy drink ("bò húc") gulped at the desk instead of a trip to the machine
        if (actor && effect.id % 3 === 0) { say('tu một lon bò húc ⚡', 'good'); act('can', self => this.chugEnergyDrink(self)); }
        else if (actor) { say('đi pha cà phê ☕', 'good'); act('coffee', self => this.makeCoffee(self, true)); }
        else { this.deps.announce({ text: effect.text, tone: 'good' }); this.coffeeForAll(); }
        break;
      case 'work': say(`chạy deadline ${effect.text}`, 'good'); act('work', self => this.workBurst(self)); break;
      case 'rescue': say(effect.text, 'good'); act('rescue', self => this.rescue(self)); break;
      case 'slap': say(`tát ${target?.name ?? 'đồng nghiệp'}!`, 'drama'); act('slap', self => this.slap(self, target ?? this.randomOther(self))); break;
      case 'throw': say(effect.text, 'drama'); act('throw', self => this.throwDocs(self)); break;
      case 'argue': say(`cãi nhau với ${target?.name ?? 'đồng nghiệp'}!`, 'drama'); act('argue', self => this.argue(self, target ?? this.randomOther(self))); break;
      case 'sleep': say('ngủ gật trong giờ làm…', 'action'); act('sleep', self => this.sleepAtDesk(self, 9, true)); break;
      case 'dance': say('nhảy giữa văn phòng! 💃', 'good'); act('dance', self => this.dance(self)); break;
      case 'flower': say(`tặng hoa cho ${target?.name ?? 'đồng nghiệp'} 💐`, 'good'); act('flower', self => this.giveFlower(self, target ?? this.randomOther(self))); break;
      case 'chat': if (actor) this.assign(actor, 'chat', 1.5, () => this.chat(actor, target ?? this.randomOther(actor)), { queue: false }); break;
      case 'gift': this.deps.announce({ text: effect.text, tone: 'good' }); this.gift(effect.tier ?? 1); break;
      case 'follow': this.deps.announce({ text: effect.text, tone: 'system' }); this.welcome(); break;
      case 'battle': this.deps.announce({ text: effect.text, tone: 'drama' }); break;
      case 'victory': this.deps.announce({ text: effect.text, tone: 'good' }); this.runScene('victory', this.sceneVictory()); break;
      case 'drama1': this.deps.announce({ text: `DRAMA 25% · ${effect.text}`, tone: 'drama' }); this.runScene('drama1', this.sceneGossipCrowd(4)); break;
      case 'drama2': this.deps.announce({ text: `DRAMA 50% · ${effect.text}`, tone: 'drama' }); this.runScene('drama2', this.sceneManagerIntervenes()); break;
      case 'drama3': this.deps.announce({ text: `DRAMA 75% · ${effect.text}`, tone: 'drama' }); this.runScene('drama3', this.sceneBossRage()); break;
      case 'chaos': this.deps.announce({ text: `DRAMA 100% · ${effect.text}`, tone: 'drama' }); this.runScene('chaos', this.sceneChaos(false)); break;
    }
  }

  // ------------------------------------------------------------------ scheduling
  /** Start or queue a behaviour. Returns true when it starts now. */
  assign(actor: Actor, label: string, priority: number, make: () => Task, options: { queue?: boolean } = {}) {
    if (!this.actors.has(actor.id) || (actor.leaving && priority < 9)) return false;
    const canStart = !actor.task || priority > actor.priority || (priority >= 2 && priority === actor.priority && actor.label === label);
    if (canStart && !actor.executing) { this.start(actor, make(), priority, label); return true; }
    if (options.queue !== false && actor.pending.length < 2) actor.pending.push({ make, priority, label });
    return false;
  }
  /**
   * A viewer's own command: preempts anything below COMMAND_PRIORITY right away; while an earlier command is still
   * playing it waits in line (max COMMAND_QUEUE). Returns false only when it could not be placed at all.
   */
  private command(actor: Actor, label: string, make: () => Task) {
    if (!this.actors.has(actor.id) || actor.leaving) return false;
    if (actor.executing || (actor.task && actor.priority >= COMMAND_PRIORITY)) {
      if (actor.pending.filter(item => item.priority >= COMMAND_PRIORITY).length >= COMMAND_QUEUE) return false;
      // commands go ahead of queued scene/ambient work, after earlier commands
      const at = actor.pending.findIndex(item => item.priority < COMMAND_PRIORITY);
      actor.pending.splice(at < 0 ? actor.pending.length : at, 0, { make, priority: COMMAND_PRIORITY, label });
      return true;
    }
    this.start(actor, make(), COMMAND_PRIORITY, label);
    return true;
  }
  private start(actor: Actor, task: Task, priority: number, label: string) {
    if (actor.task) { try { actor.task.return(); } catch { /* finally blocks only */ } }
    actor.task = task; actor.priority = priority; actor.label = label;
  }
  private restartIdle(actor: Actor) { if (!actor.leaving && !actor.executing) this.start(actor, this.idle(actor), 0, 'idle'); }
  private runScene(label: string, task: Task) {
    const until = this.cooldowns.get(label) ?? 0;
    if (until > this.time || this.scenes.length >= 4) return;
    this.cooldowns.set(label, this.time + 6);
    this.scenes.push({ task, label });
  }
  private busyCount() { return [...this.actors.values()].filter(actor => actor.priority >= 2).length; }

  update(dt: number, time: number) {
    this.time = time;
    for (const actor of [...this.actors.values()]) {
      if (!actor.task) {
        const next = actor.pending.shift();
        if (next) this.start(actor, next.make(), next.priority, next.label);
        else this.start(actor, this.idle(actor), 0, 'idle');
      }
      const task = actor.task!;
      actor.moving = false;
      actor.executing = true;
      try { const result = task.next(dt); if (result.done && actor.task === task) { actor.task = null; actor.priority = -1; } }
      catch (error) { if (this.errors++ < 5) console.error('[director] behaviour failed', actor.label, error); actor.task = null; actor.priority = -1; }
      actor.executing = false;
      if (!this.actors.has(actor.id)) continue;
      if (!actor.moving) actor.ch.speed *= Math.exp(-dt * 10);
      if (actor.deskSeated && actor.desk) { actor.ch.position.x = actor.desk.seat.x; actor.ch.position.z = actor.desk.seat.z - actor.desk.chairOffset; }
      actor.ch.update(dt, time);
    }
    this.separate(dt);
    this.scenes = this.scenes.filter(scene => {
      try { return !scene.task.next(dt).done; } catch (error) { if (this.errors++ < 5) console.error('[director] scene failed', scene.label, error); return false; }
    });
    // chairs glide back to the desk when nobody is sitting
    for (const desk of this.deps.world.desks) { const owner = this.deskOwner(desk); if (!owner?.deskSeated && !owner?.moving && desk.chairOffset > 0 && !(owner && owner.priority >= 0 && owner.label === 'sit')) desk.chairOffset = Math.max(0, desk.chairOffset - dt * 20); }
    this.updatePlane(dt);
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) { this.ambientTimer = 16 + Math.random() * 18; if (this.busyCount() < 3 && this.phase === 'work') this.startAmbient(); }
  }
  /** Soft separation so walkers do not overlap; only applied to standing actors and only into walkable cells. */
  private separate(dt: number) {
    const list = [...this.actors.values()].filter(actor => !actor.deskSeated && actor.ch.seated < 0.5 && !actor.ch.knockedOut);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!.ch.position, b = list[j]!.ch.position;
      const dx = a.x - b.x, dz = a.z - b.z, distance = Math.hypot(dx, dz);
      if (distance > 0.01 && distance < 20) {
        const push = (20 - distance) * Math.min(1, dt * 5) * 0.5, nx = dx / distance * push, nz = dz / distance * push;
        if (list[i]!.moving || !list[j]!.moving) if (this.deps.world.nav.isFree(a.x + nx, a.z + nz)) { a.x += nx; a.z += nz; }
        if (list[j]!.moving || !list[i]!.moving) if (this.deps.world.nav.isFree(b.x - nx, b.z - nz)) { b.x -= nx; b.z -= nz; }
      }
    }
  }

  // ------------------------------------------------------------------ primitive behaviours
  private *wait(seconds: number): Task { let elapsed = 0; while (elapsed < seconds) elapsed += yield; }
  private *waitFor(condition: () => boolean, timeout = 15): Task { let elapsed = 0; while (!condition() && elapsed < timeout) elapsed += yield; }
  /** Path-follow with acceleration, turning, footstep sounds and running dust. */
  private *walkTo(actor: Actor, target: THREE.Vector3, options: { run?: boolean; radius?: number; timeout?: number } = {}): Task {
    if (actor.ch.seated > 0.05) yield* this.standUp(actor);
    const { ch } = actor, nav = this.deps.world.nav;
    const path = nav.find({ x: ch.position.x, z: ch.position.z }, { x: target.x, z: target.z });
    const maxSpeed = options.run ? 120 : 56, radius = options.radius ?? 3;
    let index = 0, elapsed = 0;
    while (index < path.length && elapsed < (options.timeout ?? 25)) {
      const dt = yield; elapsed += dt;
      const point = path[index]!, last = index === path.length - 1;
      const dx = point.x - ch.position.x, dz = point.z - ch.position.z, distance = Math.hypot(dx, dz);
      if (distance < (last ? radius : 10)) { index++; continue; }
      const desired = last ? Math.min(maxSpeed, distance * 3 + 12) : maxSpeed;
      ch.speed += (desired - ch.speed) * Math.min(1, dt * 5);
      const step = Math.min(distance, ch.speed * dt);
      ch.position.x += dx / distance * step; ch.position.z += dz / distance * step;
      ch.targetHeading = Math.atan2(dx, dz);
      actor.moving = true;
      actor.stepTimer -= step;
      if (actor.stepTimer <= 0) { actor.stepTimer = options.run ? 29 : 17; this.sound('step', ch.position, options.run ? 0.6 : 0.35); }
      if (options.run) { actor.dustTimer -= dt; if (actor.dustTimer <= 0) { actor.dustTimer = 0.12; this.deps.vfx.emit('dust', tmp.set(ch.position.x, 2, ch.position.z), 2); } }
    }
  }
  /** Re-path toward a (possibly moving) actor until within `distance`. */
  private *approach(actor: Actor, other: Actor, distance: number, run = false): Task {
    let elapsed = 0;
    while (actor.ch.position.distanceTo(other.ch.position) > distance + 2 && elapsed < 14) {
      const goal = tmp2.copy(other.ch.position).sub(actor.ch.position).setY(0);
      const length = goal.length();
      const stop = other.ch.position.clone().addScaledVector(goal.normalize(), -Math.min(length, distance));
      const walker = this.walkTo(actor, stop, { run, radius: 3, timeout: 0.6 });
      for (let result = walker.next(0); !result.done; result = walker.next(yield)) { /* drive sub-walk */ }
      elapsed += 0.6;
    }
    actor.ch.faceToward(other.ch.position);
  }
  private *face(actor: Actor, point: { x: number; z: number }): Task { actor.ch.faceToward(point); let elapsed = 0; while (actor.ch.facingError > 0.12 && elapsed < 0.7) elapsed += yield; }
  private *faceHeading(actor: Actor, heading: number): Task { actor.ch.targetHeading = heading; let elapsed = 0; while (actor.ch.facingError > 0.12 && elapsed < 0.7) elapsed += yield; }
  /** One-shot clip (or looped for `seconds`); clip events drive sounds/VFX at the exact animation frame. */
  private *play(actor: Actor, clip: ClipName, options: { seconds?: number; speed?: number; onEvent?: (name: string) => void } = {}): Task {
    actor.ch.play(clip, { loop: options.seconds !== undefined, speed: options.speed, onEvent: name => { this.clipEvent(actor, name); options.onEvent?.(name); } });
    try {
      if (options.seconds !== undefined) yield* this.wait(options.seconds);
      else while (!actor.ch.actionDone) yield;
    } finally { if (actor.ch.currentClip === clip) actor.ch.stopAction(0.2); }
  }
  private clipEvent(actor: Actor, name: string) {
    const position = actor.ch.position;
    const sounds: Record<string, SoundName> = { key: 'key', whoosh: 'whoosh', ouch: 'ouch', thud: 'thud', gasp: 'gasp', clap: 'clap', shout: 'shout', snore: 'snore', yawn: 'yawn', sip: 'sip', ahh: 'ahh', stomp: 'stomp', land: 'stomp' };
    if (sounds[name]) this.sound(sounds[name], position, name === 'key' ? 0.5 : 1);
    if (name === 'key' && actor.deskSeated && actor.kind !== 'boss') {
      const chance = sparkChance(this.combo);
      if (chance > 0 && Math.random() < chance) {
        this.deps.vfx.emit('spark', actor.ch.handWorld(tmp), 3, { scale: 0.55 });
        if (this.time - this.kpiPopAt > JUICE_LIMITS.kpiPopInterval && Math.random() < 0.35) {
          this.kpiPopAt = this.time;
          this.pop(this.head(actor).add(tmp2.set(0, 22, 0)), '+KPI', 'score', 1.1);
        }
      }
    }
    if (name === 'snore') this.deps.vfx.emit('zzz', actor.ch.headWorld(tmp).add(tmp2.set(4, 6, 0)), 1);
    if (name === 'thud') { this.deps.vfx.emit('dust', tmp.set(position.x, 2, position.z), 10); this.deps.camera.shake(0.35); }
  }
  private *standUp(actor: Actor): Task {
    const desk = actor.deskSeated ? actor.desk : null;
    if (desk) { desk.chairOffset = 0; this.sound('chair', actor.ch.position, 0.5); }
    actor.ch.stand();
    let elapsed = 0;
    while (elapsed < 0.4) { const dt = yield; elapsed += dt; if (desk) desk.chairOffset = Math.min(12, desk.chairOffset + dt * 40); }
    if (desk) { actor.deskSeated = false; actor.ch.position.z = desk.seat.z - 12; }
    actor.seat = null;
  }
  private *sitAtDesk(actor: Actor): Task {
    const desk = actor.desk;
    if (!desk) return;
    if (actor.deskSeated) return;
    desk.chairOffset = 12;
    yield* this.walkTo(actor, tmp.copy(desk.seat).setZ(desk.seat.z - 12), { radius: 2 });
    yield* this.faceHeading(actor, 0);
    actor.ch.position.set(desk.seat.x, 0, desk.seat.z - 12);
    actor.ch.sit(16); actor.deskSeated = true;
    this.sound('chair', actor.ch.position, 0.45);
    let elapsed = 0;
    while (elapsed < 0.5) { const dt = yield; elapsed += dt; if (elapsed > 0.2) desk.chairOffset = Math.max(0, desk.chairOffset - dt * 40); }
    desk.chairOffset = 0;
  }
  private *sitOn(actor: Actor, seat: Seat): Task {
    yield* this.walkTo(actor, seat.position, { radius: 2 });
    yield* this.faceHeading(actor, seat.facing);
    actor.ch.position.set(seat.position.x, 0, seat.position.z);
    actor.ch.sit(seat.height); actor.seat = seat; this.sound('chair', seat.position, 0.3);
    yield* this.wait(0.4);
  }
  private say(actor: Actor, text: string, tone: BubbleTone = 'talk', seconds = 2.6) {
    this.deps.labels.bubble(actor.id, this.bubbleAnchor(actor), text, seconds, tone);
    actor.ch.talking = Math.min(seconds, 1.4);
    this.sound(tone === 'angry' || tone === 'boss' ? 'shout' : 'chat', actor.ch.position, 0.7);
  }
  private pop(at: THREE.Vector3, text: string, style: PopStyle = 'comic', seconds = 1.3) { this.deps.labels.pop(at, text, style, seconds); }
  private sound(name: SoundName, at?: { x: number; z: number }, volume = 1) { this.deps.audio.play(name, at, volume); }
  private emit(kind: ParticleKind, at: THREE.Vector3, count = 8, options?: Parameters<Vfx['emit']>[3]) { this.deps.vfx.emit(kind, at, count, options); }
  private focus(point: THREE.Vector3, zoom = 0.55, seconds = 3, priority = 1) { this.deps.camera.request(point, { zoom, seconds, priority }); }
  private head(actor: Actor) { return actor.ch.headWorld(new THREE.Vector3()); }
  /** Bystanders turn to look; a few walk over to watch (hóng chuyện) depending on personality. */
  private onlookers(point: THREE.Vector3, exclude: Actor[], radius = 260, gather = 2) {
    const nearby = this.near(point, radius, exclude).filter(actor => actor.priority < 2 && !actor.ch.knockedOut);
    nearby.forEach(actor => this.react(actor, 'look', point));
    nearby.filter(actor => actor.personality === 'drama' || actor.kind === 'npc' || Math.random() < 0.3).slice(0, gather)
      .forEach(actor => this.assign(actor, 'watch', 1.6, () => this.watch(actor, point)));
  }
  private *watch(actor: Actor, point: THREE.Vector3): Task {
    const angle = Math.random() * Math.PI * 2;
    yield* this.walkTo(actor, tmp.copy(point).add(tmp2.set(Math.cos(angle) * 70, 0, Math.sin(angle) * 55)), { radius: 8, timeout: 8 });
    yield* this.face(actor, point);
    actor.ch.lookTarget = point.clone().setY(50);
    try {
      actor.ch.emote(Math.random() > 0.5 ? 'surprised' : 'smug', 4);
      if (Math.random() > 0.5) this.say(actor, pick(LINES.gossip), 'whisper', 2.2);
      yield* this.play(actor, Math.random() > 0.5 ? 'gossip' : 'crossArms', { seconds: 3.5 });
    } finally { actor.ch.lookTarget = null; }
  }
  /** Short reaction that interrupts low-priority work (never another action in progress). */
  react(actor: Actor, kind: 'look' | 'startle' | 'stagger' | 'hit' | 'cheer' | 'cower' | 'clap' | 'laugh' | 'wave', point?: THREE.Vector3) {
    if (actor.priority >= 2.5 || actor.leaving) return;
    if (kind === 'look') { if (point) { actor.ch.lookTarget = point.clone().setY(45); actor.ch.emote('surprised', 1.6); window.setTimeout(() => { if (actor.ch.lookTarget?.equals(point.clone().setY(45))) actor.ch.lookTarget = null; }, 2500); } return; }
    this.assign(actor, `react:${kind}`, 2.5, () => this.reaction(actor, kind, point), { queue: false });
  }
  private *reaction(actor: Actor, kind: string, point?: THREE.Vector3): Task {
    actor.reactionAt = this.time;
    if (point) actor.ch.faceToward(point);
    switch (kind) {
      case 'startle': actor.ch.emote('surprised', 1.5); this.emit('exclaim', this.head(actor).add(tmp2.set(0, 18, 0)), 1); yield* this.play(actor, 'startled'); break;
      case 'stagger': actor.ch.emote('pain', 1.8); yield* this.play(actor, actor.ch.seated > 0.5 ? 'hitReact' : 'stagger'); break;
      case 'hit': actor.ch.emote('pain', 1.4); yield* this.play(actor, 'hitReact'); break;
      case 'cheer': actor.ch.emote('happy', 2.5); if (actor.ch.seated < 0.5) yield* this.play(actor, 'cheer', { seconds: 2.4 }); else yield* this.play(actor, 'clap', { seconds: 2 }); break;
      case 'clap': actor.ch.emote('happy', 2.5); yield* this.play(actor, 'clap', { seconds: 2.2 }); break;
      case 'cower': actor.ch.emote('scared', 2.5); if (actor.ch.seated < 0.5) yield* this.play(actor, 'cower', { seconds: 2 }); else yield* this.play(actor, 'startled'); break;
      case 'laugh': actor.ch.emote('happy', 2); this.sound('laugh', actor.ch.position, 0.6); yield* this.play(actor, 'nod'); break;
      case 'wave': actor.ch.emote('happy', 2.5); actor.ch.targetHeading = 0; yield* this.play(actor, 'wave', { seconds: 2 }); break;
    }
  }
  private randomOther(actor: Actor) { const others = this.everyone().filter(other => other !== actor && other.kind !== 'boss'); return pick(others.length ? others : [this.manager]); }

  // ------------------------------------------------------------------ idle routines (priority 0)
  private *idle(actor: Actor): Task {
    actor.sleeping = false; actor.gaming = false;
    if (actor.kind === 'boss') return yield* this.idleBoss(actor);
    if (actor.kind === 'manager') return yield* this.idleManager(actor);
    if (actor.kind === 'viewer' && this.phase === 'battle') return yield* this.rally(actor);
    if (actor.kind === 'npc' && !actor.desk && Math.random() < 0.55) this.claimDesk(actor, Math.floor(Math.random() * 12));
    if (actor.desk) return yield* this.deskRoutine(actor);
    return yield* this.npcRoutine(actor);
  }
  private *deskRoutine(actor: Actor): Task {
    yield* this.sitAtDesk(actor);
    const desk = actor.desk!;
    try {
      for (;;) {
        const roll = Math.random(), lazy = actor.personality === 'lazy', gamer = actor.personality === 'gamer';
        if (actor.kind === 'npc' && roll < 0.12) { yield* this.standUp(actor); this.releaseDesk(actor); return; }
        if (roll < (lazy ? 0.18 : 0.05)) { yield* this.sleepAtDesk(actor, 7 + Math.random() * 6, false); continue; }
        if (roll < (gamer ? 0.32 : 0.1)) { yield* this.gameAtDesk(actor, 6 + Math.random() * 6); continue; }
        if (roll < 0.42) { desk.screen.set(Math.random() > 0.5 ? 'code' : 'sheet', this.time); yield* this.play(actor, 'typing', { seconds: 5 + Math.random() * 8, onEvent: () => desk.screen.update(this.time) }); continue; }
        if (roll < 0.52) { yield* this.sipAtDesk(actor); continue; }
        if (roll < 0.58) { yield* this.play(actor, 'yawn'); continue; }
        if (roll < 0.64) { yield* this.play(actor, 'stretch'); continue; }
        if (roll < 0.7) { actor.ch.lookTarget = v3(268, 83, -60); yield* this.wait(1.6); actor.ch.lookTarget = null; continue; }
        if (roll < 0.78) { desk.screen.set('chat', this.time); actor.ch.holding('phone'); yield* this.play(actor, 'sitPhone', { seconds: 4 + Math.random() * 4 }); actor.ch.holding(null); continue; }
        if (roll < 0.83) { desk.phoneRing = 1.6; this.sound('phone', desk.center, 0.6); yield* this.wait(1.2); actor.ch.holding('phone'); this.say(actor, pick(['Alo? Dạ em nghe!', 'Dạ, em gửi ngay ạ!', 'Ai vậy ta…']), 'talk'); yield* this.play(actor, 'phone', { seconds: 3 }); actor.ch.holding(null); continue; }
        // errands: coffee, copier, water cooler, chat
        const errand = Math.random();
        if (errand < 0.4) yield* this.makeCoffee(actor, false);
        else if (errand < 0.65) yield* this.copierRun(actor);
        else if (errand < 0.85) yield* this.waterCooler(actor);
        else { const neighbour = this.viewers().find(other => other !== actor && other.deskSeated && Math.abs(other.ch.position.x - actor.ch.position.x) < 200); if (neighbour) yield* this.chatVisit(actor, neighbour); }
        yield* this.sitAtDesk(actor);
      }
    } finally { actor.ch.holding(null); desk.screen.set('off', this.time); actor.ch.lookTarget = null; actor.sleeping = false; actor.gaming = false; }
  }
  private *npcRoutine(actor: Actor): Task {
    for (;;) {
      const roll = Math.random();
      if (roll < 0.22) yield* this.makeCoffee(actor, false);
      else if (roll < 0.36) yield* this.copierRun(actor);
      else if (roll < 0.5) yield* this.waterCooler(actor);
      else if (roll < 0.66) yield* this.sofaBreak(actor);
      else if (roll < 0.76) yield* this.vending(actor);
      else if (roll < 0.9) { const partner = this.npcs().find(other => other !== actor && other.priority <= 0 && !other.desk); if (partner) yield* this.chatVisit(actor, partner); else yield* this.wander(actor); }
      else yield* this.wander(actor);
      if (Math.random() < 0.4 && !actor.desk && this.claimDesk(actor, Math.floor(Math.random() * 12))) return yield* this.deskRoutine(actor);
    }
  }
  private *wander(actor: Actor): Task {
    yield* this.walkTo(actor, v3(-200 + Math.random() * 400, 0, -240 + Math.random() * 120));
    yield* this.play(actor, 'lookAround');
  }
  private *idleBoss(boss: Actor): Task {
    if (this.bossDefeated) {
      boss.ch.knockedOut = true; boss.ch.dizzy.visible = true; boss.ch.stand();
      yield* this.play(boss, 'lieDown', { seconds: 9999 });
      return;
    }
    if (this.phase === 'battle' || this.phase === 'incident') {
      yield* this.walkTo(boss, this.deps.world.anchors.center);
      yield* this.faceHeading(boss, 0);
      boss.ch.setBaseExpression('angry');
      try { for (;;) { yield* this.play(boss, Math.random() > 0.5 ? 'stomp' : 'crossArms', { seconds: 2.4 }); if (Math.random() > 0.6) this.say(boss, pick(['Ai dám?!', 'Lên hết đây!', 'Trừ lương hết!']), 'boss'); } }
      finally { boss.ch.setBaseExpression('neutral'); }
    }
    const seat = this.deps.world.anchors.bossSeat;
    if (!boss.seat) yield* this.sitOn(boss, seat);
    let patrolIn = 18 + Math.random() * 20;
    for (;;) {
      if (Math.random() > 0.5) { boss.ch.holding('phone'); this.say(boss, pick(['Alo, golf chiều nay nhé!', 'Ừ, KPI tăng gấp đôi!', 'Mua thêm ghế massage!']), 'boss', 2.4); yield* this.play(boss, 'phone', { seconds: 4 }); boss.ch.holding(null); }
      else yield* this.play(boss, 'typing', { seconds: 4 + Math.random() * 3 });
      patrolIn -= 5;
      if (patrolIn <= 0 && this.phase === 'work') { yield* this.bossPatrol(boss); return; }
    }
  }
  /** Sếp dí deadline: walk to a desk; sleeping/gaming employees get caught → scolding → maybe an argument → onlookers (event chain). */
  private *bossPatrol(boss: Actor): Task {
    const seated = this.everyone().filter(actor => actor.deskSeated && actor.desk && actor.priority < 2);
    if (!seated.length) return;
    const victim = seated.find(actor => actor.sleeping || actor.gaming) ?? pick(seated);
    const desk = victim.desk!;
    // the boss is on the move: red warning, and anyone idle at a desk looks scared for a moment
    this.deps.alert?.('boss');
    this.idleSeated(actor => actor !== victim && !actor.sleeping).forEach(actor => actor.ch.emote(OFFICE_STATES.fear.expression, 2.2));
    const side = desk.center.x > 1 ? -1 : 1;
    yield* this.walkTo(boss, v3(desk.center.x + side * 56, 0, desk.seat.z));
    if (!victim.desk || victim.desk !== desk) return;
    yield* this.face(boss, victim.ch.position);
    const caught = victim.sleeping ? 'sleep' : victim.gaming ? 'game' : 'deadline';
    this.assign(victim, 'caught', 2.2, () => this.caught(victim, boss, caught));
    boss.ch.setBaseExpression('angry');
    try {
      if (caught !== 'deadline') { this.sound('whistle', boss.ch.position); this.deps.announce({ text: `Sếp bắt quả tang ${victim.name} ${caught === 'sleep' ? 'ngủ gật' : 'chơi game'}!`, tone: 'drama' }); this.focus(desk.center, 0.5, 4, 1); }
      yield* this.wait(0.6);
      this.say(boss, caught === 'sleep' ? 'NGỦ À? TRỪ LƯƠNG!' : caught === 'game' ? 'ĐANG CHƠI GAME À?!' : pick(LINES.boss), 'boss', 2.6);
      if (caught !== 'deadline') this.emit('anger', this.head(boss).add(tmp2.set(10, 10, 0)), 1);
      yield* this.play(boss, 'scold', { seconds: 2.6 });
      if (caught !== 'deadline' && (victim.personality === 'drama' || Math.random() < 0.35)) {
        yield* this.waitFor(() => victim.label !== 'caught', 4);
        this.assign(victim, 'argue-back', 2.2, () => this.argueBack(victim, boss));
        this.onlookers(victim.ch.position, [victim, boss], 300, 2);
        yield* this.play(boss, 'argue', { seconds: 3.2 });
        this.say(boss, 'Lên phòng gặp tôi!', 'boss');
      }
    } finally { boss.ch.setBaseExpression('neutral'); }
    yield* this.walkTo(boss, this.deps.world.anchors.bossDoor);
  }
  private *caught(victim: Actor, boss: Actor, kind: 'sleep' | 'game' | 'deadline'): Task {
    const desk = victim.desk;
    victim.sleeping = false; victim.gaming = false;
    victim.ch.lookTarget = boss.ch.position.clone().setY(60);
    try {
      if (kind === 'sleep') { victim.ch.emote('scared', 3); this.emit('exclaim', this.head(victim).add(tmp2.set(0, 16, 0)), 1); yield* this.play(victim, 'startled'); }
      if (kind === 'game') { desk?.screen.set('sheet', this.time); victim.ch.emote('scared', 3); this.emit('sweat', this.head(victim), 4); yield* this.play(victim, 'startled'); }
      if (kind === 'deadline') { victim.ch.emote('sad', 3); yield* this.play(victim, 'nod'); }
      this.say(victim, kind === 'deadline' ? 'Dạ… em làm liền!' : 'Em… em xin lỗi sếp!', 'talk', 2);
      desk?.screen.set('code', this.time);
      yield* this.play(victim, 'typing', { seconds: 2.5, speed: 1.8 });
    } finally { victim.ch.lookTarget = null; }
  }
  private *argueBack(victim: Actor, boss: Actor): Task {
    yield* this.standUp(victim);
    yield* this.face(victim, boss.ch.position);
    victim.ch.setBaseExpression('angry');
    try {
      this.say(victim, pick(LINES.argue), 'angry', 2.4);
      this.emit('anger', this.head(victim).add(tmp2.set(-8, 10, 0)), 1);
      yield* this.play(victim, 'argue', { seconds: 3 });
      this.say(victim, 'Hứ!', 'angry', 1.2);
      yield* this.play(victim, 'crossArms', { seconds: 1.4 });
    } finally { victim.ch.setBaseExpression('neutral'); }
  }
  private *idleManager(manager: Actor): Task {
    manager.ch.holding('clipboard');
    for (;;) {
      const desks = this.deps.world.desks.filter(desk => this.deskOwner(desk)?.deskSeated);
      const roll = Math.random();
      if (roll < 0.55 && desks.length) {
        const desk = pick(desks), owner = this.deskOwner(desk)!;
        const side = desk.center.x > 1 ? -1 : 1;
        yield* this.walkTo(manager, v3(desk.center.x + side * 54, 0, desk.seat.z));
        yield* this.face(manager, desk.seat);
        manager.ch.lookTarget = owner.ch.position.clone().setY(40);
        if (Math.random() > 0.5) { this.say(manager, pick(['Báo cáo xong chưa em?', 'Nhanh tay lên nhé!', 'Tốt lắm, tiếp tục!', 'Chiều nay họp 3h nha!']), 'talk'); yield* this.play(manager, 'scold', { seconds: 1.8 }); }
        else yield* this.play(manager, 'nod');
        manager.ch.lookTarget = null;
      } else if (roll < 0.75) yield* this.copierRun(manager);
      else if (roll < 0.9) yield* this.waterCooler(manager);
      else yield* this.wander(manager);
      manager.ch.holding('clipboard');
      yield* this.wait(1 + Math.random() * 2);
    }
  }
  /** Battle idle for viewers: gather around the boss and keep the pressure on. */
  private *rally(actor: Actor): Task {
    const angle = (hashString(actor.id) % 360) / 180 * Math.PI;
    const boss = this.boss.ch.position;
    yield* this.walkTo(actor, v3(boss.x + Math.cos(angle) * 75, 0, boss.z + Math.abs(Math.sin(angle)) * 65 + 20), { run: true, radius: 8 });
    actor.ch.faceToward(boss);
    actor.ch.setBaseExpression('angry');
    try { for (;;) { yield* this.play(actor, Math.random() > 0.5 ? 'cheer' : 'stomp', { seconds: 2 + Math.random() * 2 }); if (Math.random() > 0.7) this.say(actor, pick(['Trả lương đây!', 'Đình công!', 'Sếp ơi xuống đây!', 'Tăng lương!!']), 'angry', 1.8); } }
    finally { actor.ch.setBaseExpression('neutral'); }
  }

  // ------------------------------------------------------------------ office activities
  /** Full coffee sequence: walk, grab cup, place it, press button, liquid stream + rising level + steam, pick up, drink, react. */
  private *makeCoffee(actor: Actor, fromCommand: boolean): Task {
    const world = this.deps.world, coffee = world.coffee, anchors = world.anchors;
    // only one person at the machine at a time; others wait their turn nearby
    yield* this.waitFor(() => !this.coffeeUser || this.coffeeUser === actor || !this.actors.has(this.coffeeUser.id), 12);
    this.coffeeUser = actor;
    try {
      yield* this.walkTo(actor, anchors.coffee.stand, { radius: 2, run: fromCommand });
      yield* this.faceHeading(actor, Math.PI);
      actor.ch.lookTarget = anchors.coffee.cupSpot;
      yield* this.play(actor, 'reach', { onEvent: name => { if (name === 'grab') actor.ch.holding('mug'); } });
      yield* this.play(actor, 'reach', { onEvent: name => { if (name === 'grab') { actor.ch.holding(null); coffee.cup.visible = true; world.setCupLevel(0); this.sound('paper', anchors.coffee.cupSpot, 0.3); } } });
      yield* this.play(actor, 'pressButton', { onEvent: name => { if (name === 'press') { coffee.pressed = 0.25; this.sound('beep', anchors.coffee.cupSpot); } } });
      coffee.pouring = 2.8; this.sound('coffee', anchors.coffee.cupSpot); this.sound('pour', anchors.coffee.cupSpot, 0.8);
      let elapsed = 0, steam = 0;
      actor.ch.emote('happy', 3);
      while (elapsed < 2.8) {
        const dt = yield; elapsed += dt; steam -= dt;
        world.setCupLevel(Math.min(1, elapsed / 2.6));
        if (steam <= 0) { steam = 0.18; this.emit('steam', tmp.copy(anchors.coffee.cupSpot).setY(anchors.coffee.cupSpot.y + 4), 2); }
      }
      yield* this.play(actor, 'reach', { onEvent: name => { if (name === 'grab') { coffee.cup.visible = false; actor.ch.holding('mug'); } } });
    } finally { if (this.coffeeUser === actor) this.coffeeUser = null; coffee.cup.visible = false; actor.ch.lookTarget = null; }
    try {
      yield* this.faceHeading(actor, 0);
      yield* this.play(actor, 'drink', { onEvent: name => {
        if (name === 'sip') this.emit('steam', actor.ch.handWorld(tmp).add(tmp2.set(0, 8, 0)), 4);
        if (name === 'ahh') { actor.ch.emote('happy', 2.5); if (fromCommand) this.pop(this.head(actor).add(tmp2.set(0, 26, 0)), '+25 NĂNG LƯỢNG', 'good'); this.emit('heart', this.head(actor).add(tmp2.set(0, 14, 0)), 2); }
      } });
      if (actor.desk) { yield* this.sitAtDesk(actor); actor.desk.coffeeLevel.scale.y = 0.5; }
    } finally { actor.ch.holding(null); }
  }
  private coffeeUser: Actor | null = null;
  /** Energy drink: grab a can, chug it (drink state), lightning sparks + a hyper hop. */
  private *chugEnergyDrink(actor: Actor): Task {
    const state = OFFICE_STATES.drink;
    if (actor.desk && !actor.deskSeated) yield* this.sitAtDesk(actor);
    actor.ch.holding('can');
    this.sound('pop', actor.ch.position, 0.6);
    try {
      yield* this.play(actor, state.clip, { onEvent: name => {
        if (name === 'sip') this.emit('bolt', actor.ch.handWorld(tmp).add(tmp2.set(0, 10, 0)), 2);
        if (name === 'ahh') {
          actor.ch.emote(state.expression, 2.5); actor.ch.jolt(0.7);
          this.emit('bolt', this.head(actor).add(tmp2.set(0, 14, 0)), 3); this.emit('spark', this.head(actor), 6, { scale: 0.7 });
          this.pop(this.head(actor).add(tmp2.set(0, 26, 0)), '+25 NĂNG LƯỢNG ⚡', 'good');
        }
      } });
    } finally { actor.ch.holding(null); }
    if (actor.desk) yield* this.play(actor, OFFICE_STATES.grind.clip, { seconds: 2, speed: 2.4, onEvent: () => actor.desk?.screen.update(this.time) });
  }
  private *sipAtDesk(actor: Actor): Task {
    const desk = actor.desk!;
    desk.mug.visible = false; actor.ch.holding('mug');
    try { yield* this.play(actor, 'drink', { onEvent: name => { if (name === 'sip') { this.emit('steam', actor.ch.handWorld(tmp).add(tmp2.set(0, 6, 0)), 2); desk.coffeeLevel.scale.y = Math.max(0.1, desk.coffeeLevel.scale.y - 0.15); } } }); }
    finally { desk.mug.visible = true; actor.ch.holding(null); }
  }
  private *sleepAtDesk(actor: Actor, seconds: number, fromCommand: boolean): Task {
    if (actor.desk) yield* this.sitAtDesk(actor);
    else {
      // no desk: nap on a free sofa seat if there is one, otherwise doze off standing
      const taken = new Set([...this.actors.values()].map(other => other.seat));
      const sofa = this.deps.world.anchors.sofaSeats.find(seat => !taken.has(seat));
      if (sofa) yield* this.sitOn(actor, sofa);
    }
    actor.sleeping = true; actor.ch.setBaseExpression(OFFICE_STATES.doze.expression);
    if (fromCommand) this.focus(actor.ch.position, 0.6, 3, 1);
    try {
      let elapsed = 0, z = 0;
      actor.ch.play(OFFICE_STATES.doze.clip, { loop: true, onEvent: name => this.clipEvent(actor, name) });
      while (elapsed < seconds) { const dt = yield; elapsed += dt; z -= dt; if (z <= 0) { z = 0.9; this.emit('zzz', this.head(actor).add(tmp2.set(6, 4, 0)), 1); } }
      actor.ch.stopAction(0.4);
      if (fromCommand) this.pop(this.head(actor).add(tmp2.set(0, 24, 0)), '+15 NĂNG LƯỢNG', 'good');
      yield* this.play(actor, 'stretch');
    } finally { actor.sleeping = false; actor.ch.setBaseExpression('neutral'); }
  }
  private *gameAtDesk(actor: Actor, seconds: number): Task {
    const desk = actor.desk!;
    actor.gaming = true; desk.screen.set('game', this.time); actor.ch.setBaseExpression('happy');
    try { yield* this.play(actor, 'gaming', { seconds, onEvent: () => desk.screen.update(this.time) }); }
    finally { actor.gaming = false; desk.screen.set('code', this.time); actor.ch.setBaseExpression('neutral'); }
  }
  private *copierRun(actor: Actor): Task {
    const world = this.deps.world;
    actor.ch.holding('papers');
    yield* this.walkTo(actor, world.anchors.copier, { radius: 3 });
    yield* this.faceHeading(actor, Math.PI);
    yield* this.play(actor, 'pressButton', { onEvent: name => { if (name === 'press') { world.printing = 3; this.sound('printer', world.anchors.copier); } } });
    actor.ch.holding(null);
    if (Math.random() < 0.18) { // printer jam comedy
      yield* this.wait(1.2);
      this.deps.vfx.throwPapers(v3(-5, 34, -262), v3(0, 70, 40), 10, 50); this.sound('paper', world.anchors.printer);
      actor.ch.emote('surprised', 2); this.say(actor, 'Ơ kìa! Kẹt giấy rồi!', 'talk');
      yield* this.play(actor, 'facepalm');
    } else yield* this.play(actor, 'lookAround');
    actor.ch.holding('papers');
    yield* this.wait(0.3);
    actor.ch.holding(null);
  }
  private *waterCooler(actor: Actor): Task {
    const world = this.deps.world;
    yield* this.walkTo(actor, world.anchors.waterCooler, { radius: 3 });
    yield* this.faceHeading(actor, Math.PI);
    yield* this.play(actor, 'reach', { onEvent: name => { if (name === 'grab') { actor.ch.holding('mug'); this.emit('water', v3(88, 40, -248), 3); } } });
    yield* this.faceHeading(actor, 0);
    yield* this.play(actor, 'drink');
    actor.ch.holding(null);
  }
  private *sofaBreak(actor: Actor): Task {
    const seats = this.deps.world.anchors.sofaSeats;
    const seat = seats.find(item => ![...this.actors.values()].some(other => other.seat === item));
    if (!seat) return yield* this.wander(actor);
    yield* this.sitOn(actor, seat);
    try {
      if (actor.personality === 'lazy') { actor.ch.setBaseExpression('sleepy'); yield* this.play(actor, 'sleepDesk', { seconds: 6 }); }
      else { actor.ch.holding('phone'); yield* this.play(actor, 'sitPhone', { seconds: 5 + Math.random() * 4 }); }
    } finally { actor.ch.holding(null); actor.ch.setBaseExpression('neutral'); }
    yield* this.standUp(actor);
  }
  private *vending(actor: Actor): Task {
    const anchors = this.deps.world.anchors;
    yield* this.walkTo(actor, anchors.vending, { radius: 3 });
    yield* this.faceHeading(actor, -Math.PI / 2);
    yield* this.play(actor, 'pressButton', { onEvent: name => { if (name === 'press') this.sound('beep', anchors.vending, 0.6); } });
    yield* this.wait(0.5); this.sound('thud', anchors.vending, 0.4);
    if (Math.random() < 0.3) { actor.ch.emote('angry', 2); this.say(actor, 'Nuốt tiền rồi!!', 'angry'); yield* this.play(actor, 'stomp', { seconds: 1.6 }); }
    else { yield* this.play(actor, 'reach', { onEvent: name => { if (name === 'grab') actor.ch.holding('mug'); } }); actor.ch.emote('happy', 1.5); yield* this.wait(0.6); actor.ch.holding(null); }
  }
  private *chatVisit(actor: Actor, partner: Actor): Task {
    yield* this.approach(actor, partner, 30);
    this.assign(partner, 'chat-reply', 1.4, () => this.chatReply(partner, actor), { queue: false });
    actor.ch.lookTarget = partner.ch.position.clone().setY(50);
    try {
      this.say(actor, pick(LINES.chat), 'talk', 2.6);
      yield* this.play(actor, 'talk', { seconds: 2.8 });
      if (Math.random() > 0.5) { this.say(actor, pick(LINES.gossip), 'whisper', 2.2); yield* this.play(actor, 'gossip', { seconds: 2 }); }
      actor.ch.emote('happy', 1.5); this.sound('laugh', actor.ch.position, 0.5);
    } finally { actor.ch.lookTarget = null; }
  }
  private *chatReply(partner: Actor, speaker: Actor): Task {
    partner.ch.lookTarget = speaker.ch.position.clone().setY(50);
    if (partner.ch.seated < 0.5) partner.ch.faceToward(speaker.ch.position);
    try { yield* this.wait(1.6); this.say(partner, pick(LINES.reply), 'talk', 2.2); yield* this.play(partner, partner.ch.seated > 0.5 ? 'nod' : 'talk', partner.ch.seated > 0.5 ? {} : { seconds: 2 }); }
    finally { partner.ch.lookTarget = null; }
  }

  // ------------------------------------------------------------------ viewer action choreographies (priority 2)
  /** A viewer just joined the LIVE: they pop in where they stand (sparkle + "XIN CHÀO!") and wave hello. */
  private *arrive(actor: Actor): Task {
    this.emit('star', actor.ch.position.clone().setY(30), 8, { scale: 0.8 });
    this.emit('dust', actor.ch.position.clone().setY(2), 6);
    this.sound('pop', actor.ch.position, 0.5);
    this.pop(this.head(actor).add(tmp2.set(0, 24, 0)), 'XIN CHÀO!', 'good');
    actor.ch.emote('happy', 2.5);
    actor.ch.jolt(0.5);
    yield* this.play(actor, 'wave', { seconds: 1.2 });
  }
  private *leave(actor: Actor, resign: boolean): Task {
    const world = this.deps.world;
    if (resign) {
      yield* this.standUp(actor);
      actor.ch.emote('happy', 4); this.say(actor, 'Em xin phép nghỉ ạ!', 'happy', 2.4);
      actor.ch.holding('box'); actor.ch.play('carry', { loop: true });
      this.focus(actor.ch.position, 0.6, 3, 1);
    }
    this.releaseDesk(actor);
    yield* this.walkTo(actor, world.anchors.elevatorDoor, { radius: 6 });
    world.openElevator(3); this.sound('ding', world.anchors.elevatorDoor);
    yield* this.faceHeading(actor, 0);
    if (resign) { actor.ch.stopAction(); yield* this.play(actor, 'wave', { seconds: 1.2 }); }
    yield* this.walkTo(actor, world.anchors.elevatorInside, { radius: 4 });
    this.despawn(actor);
  }
  private *punchBoss(actor: Actor, damage: string): Task {
    const boss = this.boss;
    actor.ch.setBaseExpression('angry');
    try {
      this.focus(boss.ch.position, 0.5, 3.5, 2);
      yield* this.approach(actor, boss, 30, true);
      yield* this.face(actor, boss.ch.position);
      let landed = false;
      yield* this.play(actor, 'punch', { onEvent: name => {
        if (name !== 'impact') return;
        landed = actor.ch.position.distanceTo(boss.ch.position) < 60;
        const contact = actor.ch.handWorld(new THREE.Vector3());
        this.impact(contact, 'BỐP!', 0.55);
        this.pop(this.head(boss).add(tmp2.set(0, 30, 0)), damage, 'bad', 1.2);
        if (landed) this.bossHurt(actor.ch.position);
      } });
      actor.ch.emote('smug', 2);
      if (this.phase !== 'battle') { this.say(actor, pick(['Cho chừa!', 'Trả lương đây!', 'Hết chịu nổi!']), 'angry', 1.8); yield* this.wait(0.5); }
    } finally { actor.ch.setBaseExpression('neutral'); }
  }
  /** Hit that could not be choreographed (actor busy or off-floor): still show impact on the boss. */
  private remoteHit(damage: string) {
    const head = this.head(this.boss);
    this.impact(head.clone().add(tmp2.set((Math.random() - 0.5) * 20, -10, 10)), pick(['BỐP!', 'BỤP!', 'CHÁT!']), 0.3);
    this.pop(head.add(tmp2.set(0, 30, 0)), damage, 'bad', 1.1);
    this.bossHurt();
  }
  private bossHurt(from?: THREE.Vector3) {
    const boss = this.boss;
    if (this.bossDefeated) return;
    this.sound('ouch', boss.ch.position);
    if (this.time - boss.reactionAt < 0.8) { this.emit('star', this.head(boss), 3); return; }
    boss.ch.dizzy.visible = true;
    window.setTimeout(() => { if (!this.bossDefeated) boss.ch.dizzy.visible = false; }, 2600);
    if (Math.random() < 0.4) this.say(boss, pick(['Ối giời!', 'Ai đánh tôi?!', 'Trừ lương hết!', 'ÁI!']), 'boss', 1.6);
    this.assign(boss, 'hurt', 2.5, () => this.bossStagger(boss, from), { queue: false });
  }
  private *bossStagger(boss: Actor, from?: THREE.Vector3): Task {
    boss.reactionAt = this.time;
    if (boss.ch.seated > 0.5) { boss.ch.stand(); boss.seat = null; }
    if (from) boss.ch.faceToward(from);
    yield* this.play(boss, Math.random() < 0.18 ? 'knockdown' : 'stagger');
  }
  private impact(at: THREE.Vector3, text: string, shake: number) {
    this.emit('spark', at, 10); this.emit('star', at, 5);
    this.sound(text === 'CHÁT!' ? 'slap' : 'punch', at);
    this.pop(at.clone().add(tmp2.set(0, 12, 0)), text, 'comic', 1);
    this.deps.camera.shake(shake);
    this.onlookers(at, [], 230, 0);
  }
  private *slamDesk(actor: Actor): Task {
    const desk = actor.desk;
    if (desk) {
      if (actor.deskSeated) yield* this.standUp(actor);
      else yield* this.walkTo(actor, tmp.copy(desk.seat).setZ(desk.seat.z - 12), { radius: 2 });
      yield* this.faceHeading(actor, 0);
    } else if (actor.ch.seated > 0.5) yield* this.standUp(actor);
    actor.ch.setBaseExpression(OFFICE_STATES.slam.expression);
    this.focus(actor.ch.position, 0.55, 2.5, 1);
    try {
      this.emit('anger', this.head(actor).add(tmp2.set(10, 8, 0)), 1);
      yield* this.play(actor, OFFICE_STATES.slam.clip, { onEvent: name => {
        if (name !== 'impact') return;
        const at = desk ? desk.center.clone().setY(30) : actor.ch.position.clone().setY(20);
        this.sound('slam', at); this.deps.camera.shake(0.45);
        this.emit('spark', at, 6); this.emit('dust', at, 6);
        this.pop(at.clone().add(tmp2.set(0, 30, 0)), 'RẦM!', 'comic');
        if (desk) {
          desk.shake = 1;
          this.deps.vfx.throwPapers(desk.papers.getWorldPosition(new THREE.Vector3()).setY(32), v3(0, 60, 25), 4, 40);
          if (desk.coffeeLevel.scale.y > 0.3) this.emit('coffee', desk.mug.getWorldPosition(new THREE.Vector3()).setY(34), 6);
        }
        // nearby coworkers jump
        this.near(at, 230, [actor]).forEach(other => this.react(other, 'startle', at));
      } });
      this.say(actor, pick(['Hết chịu nổi rồi!', 'KPI cái gì nữa?!', 'Tăng lương điiii!']), 'angry', 2);
      yield* this.play(actor, 'crossArms', { seconds: 1.2 });
    } finally { actor.ch.setBaseExpression('neutral'); }
  }
  private *askRaise(actor: Actor, approved: boolean): Task {
    const boss = this.boss;
    yield* this.approach(actor, boss, 40);
    this.focus(boss.ch.position, 0.5, 5, 1);
    actor.ch.emote('love', 3);
    this.say(actor, 'Sếp ơi… tăng lương cho em nha?', 'talk', 2.6);
    yield* this.play(actor, 'beg', { seconds: 2.4 });
    if (this.bossDefeated) return;
    if (approved) {
      this.assign(boss, 'grant', 2.4, () => this.bossGrant(boss, actor), { queue: false });
      yield* this.wait(1.4);
      actor.ch.emote('happy', 3); this.sound('cheer', actor.ch.position, 0.6);
      this.pop(this.head(actor).add(tmp2.set(0, 26, 0)), '+150 LƯƠNG ẢO', 'good');
      yield* this.play(actor, 'celebrate');
    } else {
      this.assign(boss, 'refuse', 2.4, () => this.bossRefuse(boss, actor), { queue: false });
      yield* this.wait(1.8);
      actor.ch.emote('sad', 4); this.say(actor, 'Huhu…', 'talk', 1.6);
      yield* this.play(actor, 'facepalm');
    }
  }
  private *bossGrant(boss: Actor, actor: Actor): Task {
    if (boss.ch.seated > 0.5) yield* this.standUp(boss);
    yield* this.face(boss, actor.ch.position);
    boss.ch.emote('smug', 3); this.say(boss, 'Được! Làm tốt lắm!', 'boss', 2);
    boss.ch.holding('money');
    yield* this.play(boss, 'give', { onEvent: name => { if (name === 'give') { this.emit('money', actor.ch.handWorld(new THREE.Vector3()).setY(50), 8); this.sound('cash', actor.ch.position); } } });
    boss.ch.holding(null);
  }
  private *bossRefuse(boss: Actor, actor: Actor): Task {
    if (boss.ch.seated < 0.5) yield* this.face(boss, actor.ch.position);
    boss.ch.emote('smug', 3); this.say(boss, pick(['Để anh xem…', 'Công ty khó khăn em ạ!', 'Năm sau nhé!']), 'boss', 2.4);
    yield* this.play(boss, 'shakeHead');
  }
  private *exposeBoss(actor: Actor): Task {
    const center = this.deps.world.anchors.center;
    yield* this.walkTo(actor, center.clone().add(v3(0, 0, 30)), { run: true });
    yield* this.faceHeading(actor, 0);
    actor.ch.holding('phone');
    this.focus(center, 0.5, 5, 1);
    try {
      this.say(actor, 'BẰNG CHỨNG ĐÂY! Sếp ăn vụng!', 'angry', 3);
      this.onlookers(center, [actor], 400, 3);
      yield* this.play(actor, 'holdUp', { seconds: 3 });
      if (!this.bossDefeated) { this.boss.ch.emote('scared', 4); this.emit('sweat', this.head(this.boss), 6); this.say(this.boss, 'Hiểu lầm… hiểu lầm thôi!', 'boss', 2.4); }
      this.sound('gasp', center);
      yield* this.wait(1);
    } finally { actor.ch.holding(null); }
  }
  private *workBurst(actor: Actor): Task {
    if (!actor.desk) {
      // no desk free: works standing — reads the report aloud with papers in hand
      actor.ch.holding('papers'); actor.ch.emote('happy', 4);
      this.pop(this.head(actor).add(tmp2.set(0, 26, 0)), '+30 LƯƠNG ẢO', 'good');
      try { yield* this.play(actor, 'present', { seconds: 3 }); } finally { actor.ch.holding(null); }
      this.emit('spark', this.head(actor).add(tmp2.set(0, 10, 0)), 3, { scale: 0.6 });
      return;
    }
    yield* this.sitAtDesk(actor);
    const desk = actor.desk;
    desk.screen.set('code', this.time);
    actor.ch.emote('happy', 4);
    this.pop(this.head(actor).add(tmp2.set(0, 26, 0)), '+30 LƯƠNG ẢO', 'good');
    yield* this.play(actor, 'typing', { seconds: 3.5, speed: 2.2, onEvent: () => desk.screen.update(this.time) });
    this.emit('spark', this.head(actor).add(tmp2.set(0, 10, 0)), 3, { scale: 0.6 });
  }
  private *rescue(actor: Actor): Task {
    const target = this.viewers().filter(other => other !== actor).sort((a, b) => a.ch.position.distanceTo(actor.ch.position) - b.ch.position.distanceTo(actor.ch.position))[0] ?? this.randomOther(actor);
    actor.ch.holding('mug');
    yield* this.approach(actor, target, 32);
    try {
      this.focus(target.ch.position, 0.6, 3, 1);
      this.say(actor, 'Cố lên! Đồng nghiệp là gia đình!', 'happy');
      yield* this.play(actor, 'give', { onEvent: name => { if (name === 'give') { this.emit('heart', this.head(target), 6); this.sound('pop', target.ch.position); } } });
      target.ch.emote('love', 3);
      this.react(target, 'cheer');
    } finally { actor.ch.holding(null); }
  }
  private *slap(actor: Actor, victim: Actor): Task {
    actor.ch.setBaseExpression('angry');
    try {
      yield* this.approach(actor, victim, 26, true);
      if (victim.ch.seated > 0.5 && victim.priority < 2.5) this.assign(victim, 'stand-for-slap', 2.6, () => this.standUp(victim), { queue: false });
      yield* this.wait(0.4);
      yield* this.face(actor, victim.ch.position);
      this.focus(victim.ch.position, 0.48, 3, 2);
      yield* this.play(actor, 'slap', { onEvent: name => {
        if (name !== 'impact') return;
        this.impact(this.head(victim).add(tmp2.set(0, -6, 6)), 'CHÁT!', 0.35);
        this.assign(victim, 'slapped', 2.6, () => this.slapped(victim, actor), { queue: false });
      } });
      this.onlookers(victim.ch.position, [actor, victim], 320, 3);
      yield* this.play(actor, 'crossArms', { seconds: 1.4 });
    } finally { actor.ch.setBaseExpression('neutral'); }
  }
  private *slapped(victim: Actor, by: Actor): Task {
    victim.ch.faceToward(by.ch.position);
    victim.ch.emote('pain', 2);
    yield* this.play(victim, 'hitReact');
    yield* this.play(victim, 'stagger', { speed: 1.4 });
    victim.ch.emote('angry', 3); this.say(victim, pick(LINES.hurt), 'angry', 1.8);
    yield* this.play(victim, 'shakeHead');
  }
  private *throwDocs(actor: Actor): Task {
    const boss = this.boss;
    actor.ch.holding('papers'); actor.ch.setBaseExpression('angry');
    try {
      yield* this.approach(actor, boss, 120);
      yield* this.face(actor, boss.ch.position);
      this.focus(boss.ch.position.clone().lerp(actor.ch.position, 0.5), 0.55, 3, 1);
      this.say(actor, 'Báo cáo của sếp đây!!', 'angry', 1.8);
      yield* this.play(actor, 'throwOver', { onEvent: name => {
        if (name !== 'release') return;
        actor.ch.holding(null);
        const from = actor.ch.handWorld(new THREE.Vector3());
        const velocity = boss.ch.position.clone().sub(from).setY(0).multiplyScalar(1.1).setY(110);
        this.deps.vfx.throwPapers(from, velocity, 14, 35); this.sound('paper', from); this.sound('whoosh', from);
        window.setTimeout(() => { if (!this.bossDefeated) { this.boss.ch.emote('surprised', 2); this.react(this.boss, 'hit'); this.say(this.boss, 'Ối! Giấy tờ!', 'boss', 1.5); } }, 700);
      } });
      this.onlookers(actor.ch.position, [actor], 260, 1);
    } finally { actor.ch.holding(null); actor.ch.setBaseExpression('neutral'); }
  }
  private *argue(actor: Actor, other: Actor): Task {
    yield* this.approach(actor, other, 36);
    this.assign(other, 'argued', 2.4, () => this.argueSide(other, actor, false), { queue: false });
    yield* this.argueSide(actor, other, true);
  }
  private *argueSide(actor: Actor, other: Actor, starter: boolean): Task {
    if (actor.ch.seated > 0.5) yield* this.standUp(actor);
    yield* this.face(actor, other.ch.position);
    actor.ch.setBaseExpression('angry');
    actor.ch.lookTarget = other.ch.position.clone().setY(55);
    if (starter) { this.focus(actor.ch.position.clone().lerp(other.ch.position, 0.5), 0.5, 7, 2); this.onlookers(actor.ch.position, [actor, other], 320, 3); }
    try {
      for (let round = 0; round < 3; round++) {
        if ((round % 2 === 0) === starter) { this.say(actor, pick(LINES.argue), 'angry', 1.8); this.emit('anger', this.head(actor).add(tmp2.set(8, 10, 0)), 1); yield* this.play(actor, 'argue', { seconds: 1.8 }); }
        else yield* this.play(actor, Math.random() > 0.5 ? 'crossArms' : 'shakeHead', Math.random() > 0.5 ? { seconds: 1.8 } : {});
      }
      this.say(actor, 'Hứ!', 'angry', 1.2);
      yield* this.faceHeading(actor, actor.ch.heading + Math.PI);
      yield* this.play(actor, 'crossArms', { seconds: 1 });
    } finally { actor.ch.setBaseExpression('neutral'); actor.ch.lookTarget = null; }
  }
  private *dance(actor: Actor): Task {
    const center = this.deps.world.anchors.center;
    yield* this.walkTo(actor, center.clone().add(v3((Math.random() - 0.5) * 80, 0, 20)));
    yield* this.faceHeading(actor, 0);
    this.focus(actor.ch.position, 0.5, 5, 1);
    this.near(actor.ch.position, 300, [actor]).slice(0, 4).forEach(other => this.react(other, 'clap', actor.ch.position));
    actor.ch.emote('happy', 7);
    let notes = 0, elapsed = 0;
    actor.ch.play('dance', { loop: true });
    try { while (elapsed < 6) { const dt = yield; elapsed += dt; notes -= dt; if (notes <= 0) { notes = 0.5; this.emit('note', this.head(actor).add(tmp2.set(0, 8, 0)), 2); } } }
    finally { actor.ch.stopAction(); }
    yield* this.play(actor, 'celebrate');
  }
  private *giveFlower(actor: Actor, other: Actor): Task {
    actor.ch.holding('bouquet');
    try {
      yield* this.approach(actor, other, 30);
      this.focus(other.ch.position, 0.55, 3.5, 1);
      actor.ch.emote('love', 3);
      this.say(actor, 'Tặng bạn nè! 💐', 'happy');
      yield* this.play(actor, 'give', { onEvent: name => { if (name === 'give') { this.emit('heart', this.head(other), 8); this.emit('petal', this.head(other), 6); this.sound('pop', other.ch.position); } } });
      other.ch.emote('love', 4);
      this.say(other, 'Ôi dễ thương quá!', 'happy', 2);
      this.near(other.ch.position, 220, [actor, other]).slice(0, 3).forEach(friend => this.react(friend, 'clap'));
    } finally { actor.ch.holding(null); }
  }
  private *chat(actor: Actor, other: Actor): Task {
    actor.ch.lookTarget = other.ch.position.clone().setY(50);
    try {
      if (actor.ch.seated < 0.5) yield* this.face(actor, other.ch.position);
      this.say(actor, pick(LINES.chat), 'talk', 2.6);
      this.assign(other, 'chat-reply', 1.4, () => this.chatReply(other, actor), { queue: false });
      yield* this.play(actor, actor.ch.seated > 0.5 ? 'nod' : 'talk', actor.ch.seated > 0.5 ? {} : { seconds: 2 });
    } finally { actor.ch.lookTarget = null; }
  }
  private coffeeForAll() {
    for (const actor of this.viewers()) if (actor.desk) { actor.desk.coffeeLevel.scale.y = 0.5; this.emit('steam', actor.desk.mug.getWorldPosition(new THREE.Vector3()).setY(36), 3); this.emit('heart', this.head(actor), 1); }
    this.pop(v3(0, 80, 60), '500 TIM · CÀ PHÊ CẢ PHÒNG!', 'banner', 2.2);
    this.sound('cheer');
  }
  private gift(tier: number) {
    // donate juice: everyone jumps in their chair, a few heads get floating "+LƯƠNG" text (shake/flash: OfficeScene)
    const spec = JUICE[giftLevel(tier)];
    this.everyone().forEach(actor => actor.ch.jolt(spec.jolt));
    if (spec.text) this.viewers().slice(0, spec.textCount).forEach((actor, index) => this.pop(this.head(actor).add(tmp2.set(0, 26 + index * 2, 0)), spec.text, 'good', 1.5));
    if (tier >= 3) this.runScene('chaos', this.sceneChaos(true));
    else if (tier === 2) this.runScene('party', this.sceneParty());
    else {
      this.emit('confetti', v3(0, 120, 60), 60); this.emit('petal', v3(0, 120, 60), 20); this.sound('pop'); this.sound('cheer', undefined, 0.6);
      const [giver, receiver] = [pick(this.npcs()), pick(this.everyone().filter(actor => actor.kind !== 'boss'))];
      if (giver && receiver && giver !== receiver) this.assign(giver, 'flower', 2, () => this.giveFlower(giver, receiver));
    }
  }
  private welcome() {
    this.deps.world.openElevator(2.5); this.sound('ding', this.deps.world.anchors.elevatorDoor);
    this.everyone().filter(actor => actor.priority < 2 && actor.kind !== 'boss').slice(0, 5).forEach(actor => this.react(actor, 'wave'));
    this.emit('heart', v3(240, 80, -200), 10);
  }

  // ------------------------------------------------------------------ multi-actor scenes (priority 3) & event chains
  private *sceneIncident(title: string): Task {
    const boss = this.boss;
    if (this.bossDefeated) return;
    this.focus(this.deps.world.anchors.center, 0.5, 6, 2);
    this.assign(boss, 'incident', 3, () => this.bossAnnounce(boss, title));
    yield* this.wait(3.5);
    this.everyone().filter(actor => actor.kind !== 'boss' && actor.priority < 2).forEach(actor => { actor.ch.emote('sad', 3); if (Math.random() > 0.6) this.say(actor, pick(['Lại nữa à…', 'Trời ơi…', 'Sao kỳ vậy sếp?!']), 'talk', 1.8); });
  }
  private *bossAnnounce(boss: Actor, title: string): Task {
    yield* this.walkTo(boss, this.deps.world.anchors.center, { run: true });
    yield* this.faceHeading(boss, 0);
    boss.ch.emote('angry', 5);
    this.say(boss, title, 'boss', 4);
    yield* this.play(boss, 'scold', { seconds: 3.6 });
  }
  private *sceneMeeting(): Task {
    const world = this.deps.world, seats = world.anchors.meetingSeats;
    world.tv.set('slides', this.time);
    const attendees = this.npcs().filter(actor => actor.priority < 2).slice(0, seats.length);
    attendees.forEach((actor, index) => { if (actor.desk) this.releaseDesk(actor); this.assign(actor, 'meeting', 1.8, () => this.attendMeeting(actor, seats[index]!)); });
    this.assign(this.manager, 'present', 1.8, () => this.present(this.manager));
    this.deps.announce({ text: 'Cả phòng đi họp! Vote: vote dinhcong / vote lamviec', tone: 'system' });
    yield* this.wait(4);
    this.focus(v3(-10, 0, -390), 0.5, 5, 1);
  }
  private *attendMeeting(actor: Actor, seat: Seat): Task {
    yield* this.walkTo(actor, this.deps.world.anchors.meetingDoor);
    yield* this.sitOn(actor, seat);
    actor.ch.lookTarget = v3(-10, 70, -466);
    try {
      while (this.phase === 'vote') {
        const roll = Math.random();
        if (roll < 0.25 && actor.personality !== 'worker') { actor.ch.setBaseExpression('sleepy'); yield* this.play(actor, 'sleepDesk', { seconds: 5 }); actor.ch.setBaseExpression('neutral'); }
        else if (roll < 0.5) { actor.ch.holding('phone'); yield* this.play(actor, 'sitPhone', { seconds: 4 }); actor.ch.holding(null); }
        else if (roll < 0.7) yield* this.play(actor, 'clap', { seconds: 1.5 });
        else yield* this.play(actor, 'nod');
        yield* this.wait(0.5);
      }
    } finally { actor.ch.lookTarget = null; actor.ch.holding(null); actor.ch.setBaseExpression('neutral'); }
    yield* this.standUp(actor);
  }
  private *present(manager: Actor): Task {
    yield* this.walkTo(manager, this.deps.world.anchors.meetingDoor);
    yield* this.walkTo(manager, this.deps.world.anchors.presenter, { radius: 3 });
    yield* this.faceHeading(manager, 0);
    manager.ch.holding(null);
    try {
      while (this.phase === 'vote') {
        this.say(manager, pick(['Slide tiếp theo nhé!', 'KPI quý này là…', 'Ai đồng ý giơ tay!', 'Chúng ta cần synergy!']), 'talk', 2.6);
        yield* this.play(manager, 'present', { seconds: 4.8 });
      }
    } finally { manager.ch.holding('clipboard'); }
  }
  private *sceneBattle(): Task {
    this.deps.camera.shake(0.3);
    this.focus(this.deps.world.anchors.center, 0.7, 4, 2);
    if (!this.bossDefeated) this.restartIdle(this.boss);
    this.viewers().forEach(actor => { if (actor.priority < 2) this.restartIdle(actor); });
    if (this.votes.strike > this.votes.work) this.npcs().forEach((actor, index) => this.assign(actor, 'protest', 1.9, () => this.protest(actor, index)));
    this.sound('cheer');
    yield* this.wait(1);
  }
  private *protest(actor: Actor, index: number): Task {
    if (actor.desk) this.releaseDesk(actor);
    actor.ch.holding('sign'); actor.ch.setBaseExpression('angry');
    const loop = [v3(-160, 0, -130), v3(160, 0, -130), v3(160, 0, -230), v3(-160, 0, -230)];
    try {
      let step = index % loop.length;
      actor.ch.play('holdUp', { loop: true });
      while (this.phase === 'battle') {
        yield* this.walkTo(actor, loop[step]!, { radius: 10 });
        step = (step + 1) % loop.length;
        if (Math.random() > 0.5) this.say(actor, pick(['ĐÌNH CÔNG!', 'Tăng lương!', 'Không OT!', 'Trả thưởng Tết!']), 'angry', 1.6);
      }
    } finally { actor.ch.stopAction(); actor.ch.holding(null); actor.ch.setBaseExpression('neutral'); }
  }
  private *sceneResults(): Task {
    const boss = this.boss;
    this.assign(boss, 'results', 3, function* (this: Director): Task {
      boss.ch.emote('smug', 4);
      this.say(boss, 'Mai làm tiếp nhé các em!', 'boss', 3);
      yield* this.play(boss, 'crossArms', { seconds: 3 });
    }.bind(this));
    this.everyone().filter(actor => actor.kind !== 'boss' && actor.priority < 2).forEach(actor => actor.ch.emote('sad', 4));
    yield* this.wait(0.5);
  }
  private *sceneVictory(): Task {
    const boss = this.boss;
    this.bossDefeated = true;
    this.focus(boss.ch.position, 0.45, 6, 3);
    this.assign(boss, 'defeated', 3, function* (this: Director): Task {
      if (boss.ch.seated > 0.5) yield* this.standUp(boss);
      boss.ch.emote('pain', 4); this.say(boss, 'Sếp… xin lỗi cả phòng…', 'boss', 3);
      yield* this.play(boss, 'knockdown', { speed: 1.4 });
      this.restartIdle(boss);
    }.bind(this));
    this.deps.camera.shake(0.6);
    yield* this.wait(0.7);
    for (let burst = 0; burst < 3; burst++) {
      this.emit('confetti', v3((Math.random() - 0.5) * 300, 140, -100 + Math.random() * 300), 50);
      this.emit('money', v3((Math.random() - 0.5) * 300, 160, -100 + Math.random() * 300), 16);
      this.sound('pop'); this.sound('cash');
      yield* this.wait(0.5);
    }
    this.sound('cheer');
    this.everyone().filter(actor => actor.kind !== 'boss').forEach(actor => { actor.ch.emote('happy', 5); this.react(actor, 'cheer'); });
    this.pop(v3(0, 90, -150), 'SẾP ĐẦU HÀNG! PHÁT THƯỞNG!', 'banner', 3);
  }
  private *sceneGossipCrowd(size: number): Task {
    const center = this.deps.world.anchors.center;
    const crowd = this.npcs().filter(actor => actor.priority < 2).slice(0, size);
    crowd.forEach((actor, index) => this.assign(actor, 'gossip', 3, () => this.gossipAt(actor, center, index, crowd.length)));
    this.focus(center, 0.55, 5, 1);
    yield* this.wait(1);
  }
  private *gossipAt(actor: Actor, center: THREE.Vector3, index: number, total: number): Task {
    if (actor.desk) { this.releaseDesk(actor); }
    const angle = index / Math.max(1, total) * Math.PI * 2;
    yield* this.walkTo(actor, center.clone().add(v3(Math.cos(angle) * 34, 0, Math.sin(angle) * 30)), { radius: 4 });
    yield* this.face(actor, center);
    actor.ch.emote('smug', 6);
    this.emit('question', this.head(actor).add(tmp2.set(0, 16, 0)), 1);
    for (let round = 0; round < 2; round++) { if ((round + index) % 2 === 0) this.say(actor, pick(LINES.gossip), 'whisper', 2); yield* this.play(actor, 'gossip', { seconds: 2.4 }); }
  }
  private *sceneManagerIntervenes(): Task {
    const manager = this.manager, center = this.deps.world.anchors.center;
    this.assign(manager, 'intervene', 3, function* (this: Director): Task {
      yield* this.walkTo(manager, center.clone().add(v3(0, 0, 40)), { run: true });
      yield* this.faceHeading(manager, Math.PI);
      manager.ch.holding('whistle'); this.sound('whistle', center);
      manager.ch.emote('angry', 4);
      this.say(manager, 'TRẬT TỰ! Về chỗ làm việc ngay!', 'angry', 3);
      yield* this.play(manager, 'scold', { seconds: 3 });
      manager.ch.holding('clipboard');
    }.bind(this));
    this.focus(center, 0.55, 5, 2);
    yield* this.wait(1.8);
    this.near(center, 260, [manager]).forEach(actor => { if (actor.priority < 3) { this.react(actor, 'startle', center); } });
    yield* this.wait(1.5);
    this.near(center, 260, [manager]).forEach(actor => { if (actor.priority <= 3 && actor.label === 'gossip') this.restartIdle(actor); });
  }
  private *sceneBossRage(): Task {
    const boss = this.boss, center = this.deps.world.anchors.center;
    if (this.bossDefeated) return;
    this.assign(boss, 'rage', 3, function* (this: Director): Task {
      yield* this.walkTo(boss, center, { run: true });
      yield* this.faceHeading(boss, 0);
      boss.ch.setBaseExpression('angry');
      try {
        this.say(boss, 'AI LÀM LOẠN Ở ĐÂY?!', 'boss', 3);
        let elapsed = 0, smoke = 0;
        boss.ch.play('stomp', { loop: true, onEvent: name => { if (name === 'stomp') { this.sound('stomp', center); this.deps.camera.shake(0.15); } } });
        while (elapsed < 3.5) { const dt = yield; elapsed += dt; smoke -= dt; if (smoke <= 0) { smoke = 0.25; this.emit('smoke', this.head(boss).add(tmp2.set(0, 12, 0)), 2); this.emit('anger', this.head(boss).add(tmp2.set(10, 10, 0)), 1); } }
        boss.ch.stopAction();
        this.say(boss, 'TRỪ LƯƠNG HẾT!!!', 'boss', 2.4);
        yield* this.play(boss, 'slamDesk', { onEvent: name => { if (name === 'impact') { this.sound('slam', center); this.deps.camera.shake(0.6); this.emit('dust', center, 12); } } });
      } finally { boss.ch.setBaseExpression('neutral'); }
    }.bind(this));
    this.focus(center, 0.5, 6, 2);
    yield* this.wait(1.5);
    this.everyone().filter(actor => actor.kind !== 'boss' && actor.priority < 3).forEach(actor => this.react(actor, 'cower', center));
  }
  /** 100% drama or the biggest gift: alarm, panic running, flying papers, then everyone drifts back. */
  private *sceneChaos(fireDrill: boolean): Task {
    const world = this.deps.world;
    world.alarm = 7; this.sound('alarm'); this.deps.audio.mood = 'drama';
    this.focus(v3(0, 0, -20), 0.95, 7, 3);
    world.desks.forEach(desk => desk.screen.set('alert', this.time));
    this.pop(v3(0, 90, -100), fireDrill ? 'DIỄN TẬP BÁO CHÁY!' : 'VĂN PHÒNG HỖN LOẠN!', 'banner', 3);
    this.everyone().filter(actor => !actor.ch.knockedOut).forEach(actor => this.assign(actor, 'panic', 3, () => this.panic(actor)));
    for (let index = 0; index < 6; index++) {
      const desk = pick(world.desks);
      this.deps.vfx.throwPapers(desk.center.clone().setY(32), v3((Math.random() - 0.5) * 80, 90, (Math.random() - 0.5) * 80), 6, 50);
      if (index % 2 === 0) this.sound('alarm', undefined, 0.6);
      this.deps.camera.shake(0.2);
      yield* this.wait(1);
    }
    world.desks.forEach(desk => { if (desk.screen.mode === 'alert') desk.screen.set('off', this.time); });
    this.deps.audio.mood = this.phase === 'battle' ? 'drama' : 'calm';
  }
  private *panic(actor: Actor): Task {
    if (actor.ch.seated > 0.5) yield* this.standUp(actor);
    actor.ch.setBaseExpression('scared');
    actor.ch.play('panic', { loop: true });
    try {
      for (let hop = 0; hop < 3; hop++) {
        if (Math.random() > 0.5) this.say(actor, pick(['Cứu với!!', 'Chạy điii!', 'Ối giời ơi!', 'Lưu file chưa?!']), 'angry', 1.4);
        yield* this.walkTo(actor, v3(-220 + Math.random() * 440, 0, -240 + Math.random() * 600), { run: true, timeout: 2.6 });
      }
    } finally { actor.ch.stopAction(); actor.ch.setBaseExpression('neutral'); }
  }
  private *sceneParty(): Task {
    const world = this.deps.world, center = world.anchors.party;
    world.cake.visible = true; this.sound('pop');
    this.focus(center, 0.5, 9, 2);
    this.pop(v3(0, 90, -120), 'TIỆC SINH NHẬT BẤT NGỜ! 🎂', 'banner', 3);
    const guests = this.everyone().filter(actor => actor.kind !== 'boss' && actor.priority < 3).slice(0, 9);
    guests.forEach((actor, index) => this.assign(actor, 'party', 3, () => this.partyGuest(actor, center, index, guests.length)));
    for (let burst = 0; burst < 4; burst++) { yield* this.wait(1.6); this.emit('confetti', center.clone().setY(110), 40); this.sound('pop'); }
    this.sound('cheer');
    yield* this.wait(3);
    world.cake.visible = false;
  }
  private *partyGuest(actor: Actor, center: THREE.Vector3, index: number, total: number): Task {
    if (actor.desk) this.releaseDesk(actor);
    const angle = index / Math.max(1, total) * Math.PI * 2;
    yield* this.walkTo(actor, center.clone().add(v3(Math.cos(angle) * 55, 0, Math.sin(angle) * 45)), { radius: 6, run: true });
    yield* this.face(actor, center);
    actor.ch.emote('happy', 8);
    if (index % 3 === 0) this.say(actor, pick(['Chúc mừng sinh nhật!', 'Happy birthday!', 'Cắt bánh điii!']), 'happy', 2.4);
    yield* this.play(actor, 'clap', { seconds: 3 });
    yield* this.play(actor, index % 2 ? 'dance' : 'cheer', { seconds: 3 });
  }

  // ------------------------------------------------------------------ ambient event chains (priority 1)
  private startAmbient() {
    const options: [string, () => Task | null][] = [
      ['sleepCaught', () => this.chainSleepCaught()], ['gamerCaught', () => this.chainGamerCaught()], ['stealCoffee', () => this.chainStealCoffee()],
      ['spill', () => this.chainSpill()], ['phoneSnatch', () => this.chainPhoneSnatch()], ['paperPlane', () => this.chainPaperPlane()],
      ['chairGrab', () => this.chainChairGrab()], ['runFromBoss', () => this.chainRunFromBoss()], ['gossip', () => this.sceneGossipCrowd(3)], ['danceBreak', () => this.chainDanceBreak()],
      ['flatter', () => this.chainFlatter()],
    ];
    const available = options.filter(([name]) => !this.recentAmbient.includes(name));
    const [name, make] = pick(available);
    const task = make();
    if (!task) return;
    this.recentAmbient.push(name); if (this.recentAmbient.length > 4) this.recentAmbient.shift();
    this.scenes.push({ task, label: `ambient:${name}` });
  }
  /** Nịnh sếp: someone leaves their desk to butter up the boss; coworkers whisper behind their back. */
  private *chainFlatter(): Task {
    if (this.bossDefeated) return;
    const flatterer = pick(this.everyone().filter(actor => (actor.kind === 'viewer' || actor.kind === 'npc') && actor.priority <= 0));
    if (!flatterer) return;
    this.assign(flatterer, 'flatter', 1, () => this.flatterBoss(flatterer));
    yield* this.wait(0.1);
  }
  private *flatterBoss(actor: Actor): Task {
    const boss = this.boss, state = OFFICE_STATES.flatter;
    if (actor.ch.seated > 0.5) yield* this.standUp(actor);
    yield* this.approach(actor, boss, 40);
    yield* this.face(actor, boss.ch.position);
    actor.ch.setBaseExpression(state.expression);
    try {
      this.say(actor, pick(LINES.flatter), 'happy', 2.4);
      yield* this.play(actor, state.clip, { seconds: 2.4 });
      if (!this.bossDefeated) { boss.ch.emote('smug', 3); this.say(boss, pick(LINES.flatterBoss), 'boss', 2); }
      this.near(actor.ch.position, 260, [actor, boss]).slice(0, 2).forEach(other => { other.ch.emote('smug', 2); this.say(other, pick(LINES.flatterGossip), 'whisper', 1.8); });
      yield* this.wait(0.8);
    } finally { actor.ch.setBaseExpression('neutral'); }
  }
  private idleSeated(filter: (actor: Actor) => boolean = () => true) { return this.everyone().filter(actor => actor.deskSeated && actor.priority <= 0 && actor.kind !== 'boss' && filter(actor)); }
  private *chainSleepCaught(): Task {
    const sleeper = pick(this.idleSeated(actor => actor.personality === 'lazy').concat(this.idleSeated()).slice(0, 3));
    if (!sleeper || this.bossDefeated) return;
    this.assign(sleeper, 'doze', 1, () => this.sleepAtDesk(sleeper, 14, false));
    yield* this.wait(4);
    if (this.boss.priority <= 0 && sleeper.sleeping) this.assign(this.boss, 'patrol', 1, () => this.bossPatrol(this.boss));
  }
  private *chainGamerCaught(): Task {
    const gamer = pick(this.idleSeated(actor => actor.personality === 'gamer').concat(this.idleSeated()).slice(0, 3));
    if (!gamer || this.bossDefeated) return;
    this.assign(gamer, 'gaming', 1, () => this.gameAtDesk(gamer, 12));
    yield* this.wait(3.5);
    if (this.boss.priority <= 0 && gamer.gaming) this.assign(this.boss, 'patrol', 1, () => this.bossPatrol(this.boss));
  }
  private *chainStealCoffee(): Task {
    const [owner, thief] = this.npcs().filter(actor => actor.priority <= 0).sort(() => Math.random() - 0.5);
    if (!owner || !thief) return;
    this.assign(owner, 'coffee', 1, () => this.makeCoffee(owner, false));
    yield* this.waitFor(() => owner.label !== 'coffee' || this.coffeeUser === owner, 15);
    yield* this.waitFor(() => owner.label !== 'coffee' || !this.deps.world.coffee.cup.visible && owner.ch.currentClip === 'drink', 15);
    if (owner.label !== 'coffee') return;
    this.assign(thief, 'steal', 1.5, function* (this: Director): Task {
      yield* this.approach(thief, owner, 24, true);
      this.say(thief, 'Cảm ơn nha! Hehe', 'happy', 1.6);
      owner.ch.holding(null); thief.ch.holding('mug');
      this.assign(owner, 'chase', 1.6, () => this.chase(owner, thief, 'Trả cà phê đây!!!'));
      yield* this.walkTo(thief, v3(-220 + Math.random() * 200, 0, -150), { run: true });
      thief.ch.faceToward(owner.ch.position);
      yield* this.play(thief, 'drink');
      thief.ch.holding(null);
    }.bind(this));
    this.focus(this.deps.world.anchors.coffee.stand, 0.6, 4, 1);
  }
  private *chase(chaser: Actor, runner: Actor, line: string): Task {
    chaser.ch.setBaseExpression('angry');
    this.say(chaser, line, 'angry', 2.2);
    try { yield* this.approach(chaser, runner, 26, true); this.say(chaser, 'Đứng lại!!', 'angry', 1.4); yield* this.play(chaser, 'stomp', { seconds: 1.6 }); }
    finally { chaser.ch.setBaseExpression('neutral'); }
  }
  private *chainSpill(): Task {
    const walker = pick(this.npcs().filter(actor => actor.priority <= 0));
    if (!walker) return;
    this.assign(walker, 'spill', 1, function* (this: Director): Task {
      walker.ch.holding('mug');
      yield* this.walkTo(walker, v3(-40 + Math.random() * 80, 0, -200));
      walker.ch.emote('surprised', 2);
      this.say(walker, 'Ối ối ối!', 'talk', 1.6);
      walker.ch.holding(null);
      this.deps.vfx.spill(walker.ch.position.clone().add(v3(0, 0, 18)));
      this.sound('sip', walker.ch.position); this.focus(walker.ch.position, 0.6, 3, 1);
      yield* this.play(walker, 'stagger');
      walker.ch.emote('sad', 2); yield* this.play(walker, 'facepalm');
      this.near(walker.ch.position, 250, [walker]).slice(0, 2).forEach(other => this.react(other, 'laugh'));
    }.bind(this));
    yield* this.wait(0.5);
  }
  private *chainPhoneSnatch(): Task {
    const [victim, snatcher] = this.npcs().filter(actor => actor.priority <= 0 && !actor.desk).sort(() => Math.random() - 0.5);
    if (!victim || !snatcher) return;
    this.assign(victim, 'phone', 1, function* (this: Director): Task {
      victim.ch.holding('phone');
      yield* this.walkTo(victim, v3(-150, 0, -170));
      yield* this.play(victim, 'phone', { seconds: 9 });
    }.bind(this));
    yield* this.wait(3);
    this.assign(snatcher, 'snatch', 1.5, function* (this: Director): Task {
      yield* this.approach(snatcher, victim, 24, true);
      yield* this.play(snatcher, 'reach', { onEvent: name => { if (name === 'grab') { victim.ch.holding(null); snatcher.ch.holding('phone'); this.emit('exclaim', this.head(victim).add(tmp2.set(0, 16, 0)), 1); } } });
      this.say(snatcher, 'Để xem chat với ai nè!', 'happy', 2);
      this.assign(victim, 'chase', 1.6, () => this.chase(victim, snatcher, 'Trả điện thoại đây!!'));
      yield* this.walkTo(snatcher, v3(150, 0, -150), { run: true });
      snatcher.ch.holding(null);
    }.bind(this));
    this.focus(v3(-150, 0, -170), 0.6, 4, 1);
  }
  private *chainPaperPlane(): Task {
    const seated = this.idleSeated();
    if (seated.length < 2) return;
    const thrower = pick(seated), target = pick(seated.filter(actor => actor !== thrower));
    this.assign(thrower, 'plane', 1, function* (this: Director): Task {
      yield* this.face(thrower, target.ch.position);
      thrower.ch.emote('smug', 3);
      yield* this.play(thrower, 'throwOver', { onEvent: name => {
        if (name !== 'release') return;
        this.sound('whoosh', thrower.ch.position, 0.6);
        this.launchPlane(thrower.ch.handWorld(new THREE.Vector3()), this.head(target), () => {
          this.emit('star', this.head(target), 4); this.sound('pop', target.ch.position);
          this.react(target, 'hit');
          window.setTimeout(() => this.say(target, 'Ai ném đấy?!', 'angry', 1.8), 500);
        });
      } });
      thrower.ch.faceToward({ x: thrower.ch.position.x, z: thrower.ch.position.z + 10 });
      yield* this.play(thrower, 'typing', { seconds: 2 });
    }.bind(this));
    this.focus(thrower.ch.position.clone().lerp(target.ch.position, 0.5), 0.65, 3, 1);
    yield* this.wait(0.2);
  }
  private launchPlane(from: THREE.Vector3, to: THREE.Vector3, onHit: () => void) { this.planeFlight = { from, to, t: 0, duration: 1.3, onHit }; this.plane.visible = true; }
  private updatePlane(dt: number) {
    const flight = this.planeFlight;
    if (!flight) return;
    flight.t += dt / flight.duration;
    const t = Math.min(1, flight.t);
    const position = tmp.copy(flight.from).lerp(flight.to, t); position.y += Math.sin(t * Math.PI) * 60;
    const ahead = tmp2.copy(flight.from).lerp(flight.to, Math.min(1, t + 0.02)); ahead.y += Math.sin(Math.min(1, t + 0.02) * Math.PI) * 60;
    this.plane.position.copy(position); this.plane.lookAt(ahead); this.plane.rotateZ(Math.sin(t * 12) * 0.4);
    if (t >= 1) { this.plane.visible = false; this.planeFlight = null; flight.onHit(); this.deps.vfx.throwPapers(flight.to, v3(0, 10, 0), 1, 10); }
  }
  private *chainChairGrab(): Task {
    const intern = this.actors.get('npc:intern');
    if (!intern || intern.priority > 0 || this.boss.seat) return;
    const seat = this.deps.world.anchors.bossSeat;
    this.assign(intern, 'chairGrab', 1, function* (this: Director): Task {
      if (intern.desk) this.releaseDesk(intern);
      yield* this.walkTo(intern, this.deps.world.anchors.bossDoor);
      yield* this.sitOn(intern, seat);
      intern.ch.emote('smug', 6);
      this.say(intern, 'Giờ tôi là giám đốc! 😎', 'happy', 2.8);
      this.focus(seat.position, 0.55, 4, 1);
      let elapsed = 0;
      while (elapsed < 5) { const dt = yield; elapsed += dt; this.deps.world.bossChair.rotation.y = Math.sin(elapsed * 3) * 0.6; intern.ch.targetHeading = this.deps.world.bossChair.rotation.y; }
      this.deps.world.bossChair.rotation.y = 0;
      if (!this.bossDefeated) {
        this.say(this.boss, 'ĐỨNG DẬY NGAY!', 'boss', 2);
        intern.ch.emote('scared', 3); this.emit('exclaim', this.head(intern).add(tmp2.set(0, 16, 0)), 1);
        yield* this.play(intern, 'startled');
      }
      yield* this.standUp(intern);
      yield* this.walkTo(intern, v3(40, 0, -200), { run: true });
    }.bind(this));
    yield* this.wait(0.2);
  }
  private *chainRunFromBoss(): Task {
    const runner = pick(this.npcs().filter(actor => actor.priority <= 0 && (actor.personality === 'lazy' || actor.personality === 'gamer')));
    if (!runner || this.bossDefeated || this.boss.priority > 0) return;
    this.assign(this.boss, 'chase', 1.5, () => this.chase(this.boss, runner, 'Đứng lại! Báo cáo đâu?!'));
    this.assign(runner, 'flee', 1.5, function* (this: Director): Task {
      if (runner.desk) this.releaseDesk(runner);
      runner.ch.setBaseExpression('scared'); runner.ch.play('panic', { loop: true });
      this.say(runner, 'Chạy thôiii!', 'angry', 1.6);
      try { for (const point of [v3(-180, 0, -140), v3(180, 0, -150), v3(150, 0, 440), v3(-200, 0, 440)]) yield* this.walkTo(runner, point, { run: true, timeout: 5 }); }
      finally { runner.ch.stopAction(); runner.ch.setBaseExpression('neutral'); }
    }.bind(this));
    this.deps.announce({ text: 'Sếp đuổi theo nhân viên trốn việc!', tone: 'drama' });
    yield* this.wait(0.2);
  }
  private *chainDanceBreak(): Task {
    const dancer = pick(this.npcs().filter(actor => actor.priority <= 0));
    if (!dancer) return;
    this.assign(dancer, 'dance', 1, () => this.dance(dancer));
    yield* this.wait(0.2);
  }

  /** Used for camera follow mode: the most recently active viewer, else the boss. */
  heroPoint(): THREE.Vector3 | null {
    const hero = (this.heroId && this.actors.get(this.heroId)) || this.boss;
    return hero.ch.position;
  }
  roleOf(player: Player) { return ROLES[player.role] ?? ''; }
  dispose() { for (const actor of [...this.actors.values()]) this.despawn(actor); this.plane.removeFromParent(); }
  get debug() { return { actors: this.actors.size, scenes: this.scenes.length, busy: this.busyCount() }; }
  emoteAll(expression: Expression) { this.everyone().forEach(actor => actor.ch.emote(expression, 2)); }
  propFor(actor: Actor, prop: PropName | null) { actor.ch.holding(prop); }
}
