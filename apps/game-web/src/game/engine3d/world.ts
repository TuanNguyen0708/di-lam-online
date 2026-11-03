import * as THREE from 'three';
import { OFFICE, officePoint, seatPosition } from '../office-layout';
import { Assets, PALETTE, StaticBatcher, mergeChildren } from './assets';
import { NavGrid } from './nav';

export const WORLD = { minX: -270, maxX: 270, minZ: -470, maxZ: 470 } as const;
export const DEPARTMENT_COLORS = [0x5b8bd6, 0xe7a23b, 0x5dbb7a] as const;

export type ScreenMode = 'code' | 'sheet' | 'chat' | 'game' | 'off' | 'slides' | 'alert';

/** Live monitor content: a small canvas redrawn a few times per second at most — never every frame. */
export class Screen {
  readonly texture: THREE.CanvasTexture;
  private context: CanvasRenderingContext2D;
  private lines: number[] = [];
  mode: ScreenMode = 'off';
  private nextDraw = 0;
  constructor(readonly width = 128, readonly height = 80, private seed = 0) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    this.context = canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(canvas); this.texture.colorSpace = THREE.SRGBColorSpace;
    for (let index = 0; index < 9; index++) this.lines.push(10 + ((seed * 31 + index * 17) % 70));
    this.draw(0);
  }
  set(mode: ScreenMode, time: number) { if (mode !== this.mode) { this.mode = mode; this.nextDraw = 0; this.update(time); } }
  update(time: number) {
    if (time < this.nextDraw) return;
    this.nextDraw = time + (this.mode === 'game' ? 0.12 : this.mode === 'code' ? 0.35 : 1.2);
    this.draw(time);
  }
  private draw(time: number) {
    const context = this.context, width = this.width, height = this.height;
    const backgrounds: Record<ScreenMode, string> = { code: '#1e2638', sheet: '#f5f8fb', chat: '#eef3fb', game: '#1a1033', off: '#0d1118', slides: '#ffffff', alert: '#b3261e' };
    context.fillStyle = backgrounds[this.mode]; context.fillRect(0, 0, width, height);
    const sx = width / 128, sy = height / 80;
    context.save(); context.scale(sx, sy);
    if (this.mode === 'code') {
      if (Math.random() > 0.3) { this.lines.push(10 + Math.random() * 90); if (this.lines.length > 9) this.lines.shift(); }
      this.lines.forEach((length, index) => { context.fillStyle = ['#7fd1ff', '#ffd27a', '#b8f28b', '#f59bc2'][index % 4]!; context.fillRect(8 + (index % 3) * 6, 6 + index * 8, length * 0.9, 4); });
      if (Math.floor(time * 2) % 2) { context.fillStyle = '#ffffff'; context.fillRect(8, 70, 4, 6); }
    } else if (this.mode === 'sheet') {
      context.strokeStyle = '#c9d4e2';
      for (let x = 0; x < 128; x += 22) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 80); context.stroke(); }
      for (let y = 0; y < 80; y += 10) { context.beginPath(); context.moveTo(0, y); context.lineTo(128, y); context.stroke(); }
      context.fillStyle = '#5dbb7a';
      for (let index = 0; index < 5; index++) { const barHeight = 10 + ((this.seed + index * 13 + Math.floor(time)) % 40); context.fillRect(70 + index * 10, 74 - barHeight, 7, barHeight); }
    } else if (this.mode === 'chat') {
      for (let index = 0; index < 5; index++) { context.fillStyle = index % 2 ? '#5b8bd6' : '#d7dfeb'; context.fillRect(index % 2 ? 50 : 8, 6 + index * 14, 50 + (index * 23 % 20), 10); }
    } else if (this.mode === 'game') {
      context.fillStyle = '#ff5fa2'; context.fillRect(10 + (Math.sin(time * 6) + 1) * 45, 50, 14, 14);
      context.fillStyle = '#ffd25f'; for (let index = 0; index < 6; index++) context.fillRect(((time * 80 + index * 40) % 148) - 10, 20 + (index % 3) * 9, 6, 6);
      context.fillStyle = '#7dffb3'; context.fillRect(0, 66, 128, 14);
    } else if (this.mode === 'slides') {
      context.fillStyle = '#24365a'; context.fillRect(0, 0, 128, 16);
      context.beginPath(); context.moveTo(14, 70); context.lineTo(50, 40); context.lineTo(80, 52); context.lineTo(116, 22); context.lineWidth = 4; context.strokeStyle = '#f06d4f'; context.stroke();
      context.fillStyle = '#ffc861'; context.fillRect(14, 24, 30, 6);
      context.fillStyle = '#5dbb7a'; context.fillRect(96, 4, 24, 8);
    } else if (this.mode === 'alert') {
      context.fillStyle = Math.floor(time * 4) % 2 ? '#ffffff' : '#ffd25f';
      context.font = 'bold 30px sans-serif'; context.textAlign = 'center'; context.fillText('!!!', 64, 52);
    }
    context.restore();
    this.texture.needsUpdate = true;
  }
  dispose() { this.texture.dispose(); }
}

export interface DeskAnchor {
  slot: number; center: THREE.Vector3; seat: THREE.Vector3; top: THREE.Group; chair: THREE.Group; mug: THREE.Group; coffeeLevel: THREE.Mesh;
  papers: THREE.Group; screen: Screen; monitor: THREE.Object3D; shake: number; chairOffset: number; chairSpin: number; phoneRing: number; phone: THREE.Object3D;
}
export interface Seat { position: THREE.Vector3; facing: number; height: number }

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Builds the office: work area (12 desks from office-layout), director office, pantry, meeting room,
 * lounge, copier corner, elevator + time clock. Static decor is merged per material; interactive props stay live meshes.
 */
export class OfficeWorld {
  readonly root = new THREE.Group();
  readonly nav = new NavGrid(WORLD, 10);
  readonly desks: DeskAnchor[] = [];
  readonly screens: Screen[] = [];
  readonly anchors = {
    center: v(0, 0, -175), party: v(-115, 0, -165),
    coffee: { stand: v(-232, 0, -420), cupSpot: v(-232, 40, -448) },
    fridge: v(-150, 0, -420),
    meetingSeats: [] as Seat[],
    presenter: v(-10, 0, -448), meetingDoor: v(69, 0, -285),
    bossSeat: { position: v(190, 0, -418), facing: 0, height: 18 } as Seat,
    bossDeskFront: v(190, 0, -315), bossDoor: v(135, 0, -255),
    sofaSeats: [] as Seat[], vending: v(-226, 0, -128),
    copier: v(-60, 0, -246), printer: v(-5, 0, -250), trash: v(35, 0, -262),
    elevatorInside: v(296, 0, -200), elevatorDoor: v(244, 0, -200), timeClock: v(246, 0, -132), waterCooler: v(88, 0, -236),
    lounge: v(-190, 0, -215),
  };
  private dynamicMaterials: THREE.Material[] = [];
  private mergedMeshes: THREE.Mesh[] = [];
  private ownedGeometries: THREE.BufferGeometry[] = [];
  private batch = new StaticBatcher();
  private frame = new THREE.Matrix4();
  private tmp = new THREE.Matrix4();
  private plants: THREE.Group[] = [];
  private clockHands: THREE.Group[] = [];
  private elevatorDoors: THREE.Mesh[] = [];
  private elevatorOpen = 0;
  private elevatorTarget = 0;
  private elevatorTimer = 0;
  private alarmLights: THREE.Mesh[] = [];
  private alarmMaterial: THREE.MeshStandardMaterial;
  alarm = 0;
  readonly coffee: { stream: THREE.Mesh; cup: THREE.Group; level: THREE.Mesh; button: THREE.Mesh; led: THREE.MeshStandardMaterial; pouring: number; pressed: number };
  readonly tv: Screen;
  private printerPaper: THREE.Mesh;
  printing = 0;
  private timeLed: THREE.MeshStandardMaterial;
  private timeBlink = 0;
  readonly cake: THREE.Group;
  readonly bossChair: THREE.Group;

  constructor(private assets: Assets) {
    this.root.name = 'office-world';
    const A = assets;
    const wall = A.std(0xffffff, 0.92, 0, { map: A.wallPaint('#f3ece0', 'cream') });
    const navy = A.std(PALETTE.navy, 0.7), metal = A.std(0xb9c1cb, 0.35, 0.75);
    const glass = A.std(PALETTE.glass, 0.05, 0.1, { transparent: true, opacity: 0.22 });
    const wood = A.std(0xffffff, 0.55, 0, { map: A.wood() }), woodDark = A.std(0xffffff, 0.45, 0.05, { map: A.wood('#8a5a3b', '#5a3a26') });

    // ---------- floors ----------
    this.add(A.box(), A.std(0xffffff, 0.6, 0, { map: A.floorTiles() }), 0, -4, 0, 540, 4, 940, { cast: false });
    this.add(A.box(), A.std(0x2a3550, 0.9), 0, -40, 0, 556, 36, 956, { cast: false });
    const carpet = (x: number, z: number, w: number, d: number, color: string, key: string) => {
      this.add(A.box(), A.std(0xffffff, 0.95, 0, { map: A.carpet(color, key, [w / 120, d / 120]) }), x, 0, z, w, 0.8, d, { cast: false });
    };
    carpet(0, 190, 520, 540, '#c9d8ee', 'work');
    carpet(-8, -385, 196, 162, '#3d5585', 'meeting');
    carpet(188, -372, 158, 190, '#d9c09a', 'boss');
    carpet(-196, -215, 120, 150, '#bcd6b4', 'lounge');
    carpet(-196, -405, 140, 120, '#f1ece2', 'pantry');

    // ---------- outer walls ----------
    this.add(A.box(), wall, 0, 0, -474, 556, 125, 8);
    this.add(A.box(), navy, 0, 0, -469.5, 540, 9, 1.5, { cast: false });
    for (const [side, x] of [[-1, -274], [1, 274]] as const) {
      this.add(A.box(), wall, x, 0, -290, 8, 125, 368);
      this.add(A.box(), wall, x, 0, 180, 8, 52, 580);
      this.add(A.box(), A.std(PALETTE.cream, 0.6), x, 52, 180, 12, 4, 584);
      this.add(A.box(), navy, x - side * 4.5, 0, -100, 1.5, 9, 740, { cast: false });
      this.nav.block({ minX: x - 4, maxX: x + 4, minZ: WORLD.minZ, maxZ: WORLD.maxZ }, 6);
    }
    this.nav.block({ minX: WORLD.minX, maxX: WORLD.maxX, minZ: -478, maxZ: -470 }, 6);
    const skyTexture = A.sky();
    const sky = A.std(0xffffff, 0.2, 0, { map: skyTexture, emissive: 0xffffff, emissiveMap: skyTexture, emissiveIntensity: 0.55 } as THREE.MeshStandardMaterialParameters);
    for (const x of [-200, -45, 35, 190]) {
      this.add(A.box(), A.std(0xffffff, 0.5), x, 52, -470, 66, 52, 3, { cast: false });
      this.add(A.plane(), sky, x, 77, -468.3, 58, 46, 1, { cast: false, plane: true });
      this.add(A.box(), A.std(0xffffff, 0.5), x, 54, -467.5, 3, 46, 2, { cast: false });
      this.add(A.box(), A.std(0xffffff, 0.5), x, 52, -466.5, 66, 3, 6, { cast: false });
    }

    // ---------- 1) work area: 12 desks ----------
    for (let slot = 0; slot < OFFICE.desks; slot++) this.buildDesk(slot, wood, metal);

    // ---------- 2) director office ----------
    this.glassWall(105, -470, 105, -270, glass, metal);
    this.glassWall(105, -270, 118, -270, glass, metal);
    this.glassWall(152, -270, 270, -270, glass, metal);
    this.add(A.box(), A.std(0xffffff, 0.6, 0, { map: A.label('GIÁM ĐỐC', '#24365a', '#ffc861') }), 210, 84, -268, 70, 16, 2, { cast: false });
    this.frameAt(190, -385, 0, () => {
      this.add(A.roundBox(0.06, 2), woodDark, 0, 26, 0, 104, 5, 48);
      this.add(A.box(), woodDark, 0, 0, 20, 100, 26, 4);
      for (const side of [-1, 1]) this.add(A.box(), woodDark, side * 48, 0, 0, 6, 26, 44);
      this.add(A.box(), A.std(PALETTE.warm, 0.3, 0.6), 0, 12, 22.2, 50, 2, 0.6, { cast: false });
      this.add(A.roundBox(0.1, 2), A.std(0x222630, 0.3, 0.3), -20, 31, 4, 30, 18, 3);
      this.add(A.cylinder(0.5, 0.5, 12), A.std(PALETTE.warm, 0.3, 0.8), 30, 31, 6, 4, 8, 4);
      this.add(A.sphere(12), A.std(PALETTE.warm, 0.3, 0.8), 30, 39, 6, 7, 7, 7);
      this.add(A.box(), A.std(0xffffff, 0.8, 0, { map: A.label('KPI 300%', '#ffffff', '#d9443a', 256, 64) }), 6, 31, 12, 22, 0.5, 9, { cast: false });
    });
    this.nav.block({ minX: 138, maxX: 242, minZ: -409, maxZ: -361 }, 7);
    this.bossChair = this.buildChair(190, -418, A.std(PALETTE.leather, 0.45), true);
    for (const x of [165, 215]) { this.buildChair(x, -340, A.std(PALETTE.navy, 0.7), false, Math.PI); this.nav.block({ minX: x - 10, maxX: x + 10, minZ: -350, maxZ: -330 }, 4); }
    this.frameAt(240, -462, 0, () => {
      this.add(A.box(), woodDark, 0, 0, 0, 52, 100, 14);
      for (let row = 0; row < 4; row++) for (let book = 0; book < 7; book++) this.add(A.box(), A.std([0xd9443a, 0x5b8bd6, 0xffc861, 0x5dbb7a, 0xf3ece0][(row + book) % 5]!, 0.8), -21 + book * 6.5, 6 + row * 24, 7.5, 5, 16 + (book % 3) * 2, 2, { cast: false });
    });
    this.nav.block({ minX: 214, maxX: 266, minZ: -470, maxZ: -455 }, 6);
    this.plant(125, -455, 1.2); this.plant(255, -290, 1);

    // ---------- 3) pantry / coffee ----------
    this.frameAt(-196, -457, 0, () => {
      this.add(A.box(), A.std(0xf6efe1, 0.6), 0, 0, 0, 140, 34, 28);
      this.add(A.box(), A.std(0x9aa3ae, 0.3, 0.2), 0, 34, 0, 144, 3, 30);
      for (let index = 0; index < 4; index++) this.add(A.box(), A.std(0xe6dccb, 0.6), -52 + index * 35, 6, 14.2, 30, 22, 0.8, { cast: false });
      this.add(A.box(), A.std(0xf6efe1, 0.6), 0, 66, -6, 140, 30, 16);
      this.add(A.box(), A.std(PALETTE.navy, 0.6), 0, 66, 2.5, 140, 2, 0.8, { cast: false });
      for (let index = 0; index < 5; index++) this.add(A.cylinder(0.5, 0.42, 12), A.std([0xffffff, 0xf06d4f, 0x5b8bd6, 0xffc861, 0x5dbb7a][index]!, 0.35), 18 + index * 9, 37, 5, 6, 8, 6);
    });
    this.nav.block({ minX: -268, maxX: -124, minZ: -472, maxZ: -441 }, 7);
    this.coffee = this.buildCoffeeMachine(-232, -456);
    this.frameAt(-140, -450, 0, () => {
      this.add(A.roundBox(0.05, 2), A.std(0xdfe5ec, 0.25, 0.4), 0, 0, 0, 34, 96, 30);
      this.add(A.box(), A.std(0x9aa3ae, 0.3, 0.6), -13, 40, 15.5, 2, 36, 2);
      this.add(A.box(), A.std(0x9aa3ae, 0.3, 0.6), -13, 76, 15.5, 2, 14, 2);
      this.add(A.box(), A.std(0xffffff, 0.8, 0, { map: A.label('CƠM CỦA SẾP', '#fff6d6', '#d9443a', 256, 64) }), 6, 60, 15.3, 18, 9, 0.4, { cast: false });
    });
    this.nav.block({ minX: -158, maxX: -122, minZ: -468, maxZ: -434 }, 6);
    this.add(A.box(), A.std(0xffffff, 0.6, 0, { map: A.label('PANTRY · CÀ PHÊ', '#3d8f5a') }), -196, 100, -466, 80, 16, 2, { cast: false });

    // ---------- 4) meeting room ----------
    this.glassWall(-110, -470, -110, -300, glass, metal);
    this.glassWall(-110, -300, 52, -300, glass, metal);
    this.glassWall(86, -300, 105, -300, glass, metal);
    this.add(A.box(), A.std(0xffffff, 0.6, 0, { map: A.label('PHÒNG HỌP', '#24365a', '#a9c6e8') }), -20, 84, -298, 64, 16, 2, { cast: false });
    this.frameAt(-8, -385, 0, () => {
      this.add(A.roundBox(0.08, 2), A.std(0xf6efe1, 0.35, 0.05), 0, 24, 0, 136, 4, 52);
      for (const side of [-1, 1]) this.add(A.box(), metal, side * 50, 0, 0, 5, 24, 30);
      for (let index = 0; index < 4; index++) this.add(A.box(), A.std(0xffffff, 0.9), -45 + index * 30, 28.2, (index % 2 ? 8 : -8), 10, 0.4, 13, { cast: false });
    });
    this.nav.block({ minX: -76, maxX: 60, minZ: -411, maxZ: -359 }, 6);
    for (let index = 0; index < 4; index++) {
      const x = -55 + index * 31;
      this.buildChair(x, -428, A.std(0x2c3e66, 0.7), false, 0);
      this.buildChair(x, -342, A.std(0x2c3e66, 0.7), false, Math.PI);
      this.anchors.meetingSeats.push({ position: v(x, 0, -426), facing: 0, height: 16 }, { position: v(x, 0, -344), facing: Math.PI, height: 16 });
    }
    this.tv = new Screen(256, 144, 7); this.tv.set('slides', 0); A.track('tv', this.tv.texture);
    this.add(A.box(), A.std(0x1d1f24, 0.3, 0.3), -10, 46, -469, 112, 64, 3);
    const tvMaterial = new THREE.MeshStandardMaterial({ map: this.tv.texture, emissive: 0xffffff, emissiveMap: this.tv.texture, emissiveIntensity: 0.7, roughness: 0.3 });
    this.dynamicMaterials.push(tvMaterial);
    const tvMesh = new THREE.Mesh(A.plane(), tvMaterial); tvMesh.position.set(-10, 78, -467.3); tvMesh.scale.set(104, 58, 1); this.root.add(tvMesh);
    this.plant(-98, -458, 0.9);

    // ---------- 5) lounge ----------
    this.frameAt(-252, -215, Math.PI / 2, () => {
      const fabric = A.std(0x5f86b8, 0.95);
      this.add(A.roundBox(0.12, 2), A.std(0x41608c, 0.9), 0, 0, 0, 88, 12, 34);
      this.add(A.roundBox(0.2, 2), fabric, -21, 12, 2, 41, 9, 30); this.add(A.roundBox(0.2, 2), fabric, 21, 12, 2, 41, 9, 30);
      this.add(A.roundBox(0.2, 2), fabric, 0, 12, -13, 88, 28, 10);
      for (const side of [-1, 1]) this.add(A.roundBox(0.2, 2), fabric, side * 44, 10, 0, 10, 18, 34);
      this.add(A.roundBox(0.3, 2), A.std(PALETTE.warm, 0.9), -30, 20, -6, 14, 14, 6);
    });
    this.nav.block({ minX: -270, maxX: -235, minZ: -260, maxZ: -170 }, 5);
    this.anchors.sofaSeats.push({ position: v(-244, 0, -236), facing: Math.PI / 2, height: 18 }, { position: v(-244, 0, -194), facing: Math.PI / 2, height: 18 });
    this.frameAt(-200, -215, 0, () => {
      this.add(A.cylinder(0.5, 0.5, 20), wood, 0, 14, 0, 40, 3, 40);
      this.add(A.cylinder(0.25, 0.35, 10), metal, 0, 0, 0, 8, 14, 8);
      this.add(A.cylinder(0.5, 0.45, 12), A.std(0xffffff, 0.3), 8, 17, 4, 5, 6, 5);
      this.add(A.box(), A.std(0xf06d4f, 0.8), -6, 17, -4, 12, 1.5, 16);
    });
    this.nav.block({ minX: -222, maxX: -178, minZ: -237, maxZ: -193 }, 4);
    this.frameAt(-256, -128, Math.PI / 2, () => {
      this.add(A.roundBox(0.04, 2), A.std(PALETTE.coral, 0.4, 0.2), 0, 0, 0, 40, 98, 26);
      this.add(A.box(), A.std(0x1d2a40, 0.1, 0.1, { emissive: 0x9fd8ff, emissiveIntensity: 0.35 }), -5, 30, 13.2, 24, 56, 0.8, { cast: false });
      for (let row = 0; row < 4; row++) for (let column = 0; column < 3; column++) this.add(A.cylinder(0.5, 0.5, 8), A.std([0x5dbb7a, 0xffc861, 0x5b8bd6, 0xffffff][(row + column) % 4]!, 0.4), -13 + column * 8, 36 + row * 12, 9, 5, 9, 5, { cast: false });
      this.add(A.box(), A.std(0x222222, 0.4), 13, 50, 13.2, 7, 22, 0.8, { cast: false });
      this.add(A.box(), A.std(0x111111, 0.4), -5, 8, 13.2, 24, 10, 0.8, { cast: false });
    });
    this.nav.block({ minX: -270, maxX: -242, minZ: -150, maxZ: -106 }, 5);
    this.plant(-258, -300, 1.1); this.plant(-140, -310, 0.9); this.plant(-258, -92, 0.8);

    // ---------- 6) copier, printer, trash ----------
    this.frameAt(-60, -275, 0, () => {
      this.add(A.roundBox(0.05, 2), A.std(0xe9edf2, 0.5, 0.1), 0, 0, 0, 40, 38, 30);
      this.add(A.box(), A.std(0x9aa3ae, 0.4, 0.2), 0, 38, 0, 42, 6, 32);
      this.add(A.box(), A.std(0x4a505a, 0.3, 0.2), -10, 44, -6, 20, 2, 16);
      this.add(A.box(), A.std(0x2b6cd6, 0.2, 0, { emissive: 0x2b6cd6, emissiveIntensity: 0.6 }), 12, 42, 13, 10, 3, 4, { cast: false });
      for (let index = 0; index < 3; index++) this.add(A.box(), A.std(0xc9d1db, 0.5), 0, 6 + index * 9, 15.4, 34, 1.2, 0.6, { cast: false });
    });
    this.nav.block({ minX: -82, maxX: -38, minZ: -292, maxZ: -259 }, 6);
    this.frameAt(-5, -277, 0, () => {
      this.add(A.box(), woodDark, 0, 0, 0, 34, 24, 22);
      this.add(A.roundBox(0.08, 2), A.std(0x3b414b, 0.4, 0.2), 0, 24, -2, 28, 12, 18);
      this.add(A.box(), A.std(0xffffff, 0.9), 0, 33, -6, 18, 1, 10, { cast: false });
    });
    this.printerPaper = this.dyn(this.root, A.box(), A.std(0xffffff, 0.9), -5, 29, -268, 16, 0.5, 12);
    this.nav.block({ minX: -23, maxX: 13, minZ: -289, maxZ: -265 }, 6);
    for (const [x, color] of [[28, 0x5b8bd6], [42, 0x5dbb7a]] as const) this.add(A.cylinder(0.5, 0.42, 14), A.std(color, 0.6), x, 0, -282, 12, 20, 12);
    this.nav.block({ minX: 20, maxX: 50, minZ: -290, maxZ: -274 }, 5);

    // ---------- 7) elevator, entrance, time clock ----------
    this.frameAt(270, -200, -Math.PI / 2, () => {
      this.add(A.box(), A.std(0x9aa3ae, 0.3, 0.6), 0, 0, -2, 70, 104, 6);
      this.add(A.box(), A.std(0x1d1f24, 0.6), 0, 0, 0.5, 58, 92, 1, { cast: false });
      this.add(A.box(), A.std(0xffffff, 0.6, 0, { map: A.label('THANG MÁY', '#24365a', '#ffffff', 256, 64) }), 0, 96, 1.5, 40, 8, 1, { cast: false });
      this.add(A.cylinder(0.5, 0.5, 12), A.std(PALETTE.warm, 0.3, 0, { emissive: PALETTE.warm, emissiveIntensity: 0.8 }), 40, 46, 1.5, 4, 1, 4, { cast: false, rotX: Math.PI / 2 });
    });
    for (const side of [-1, 1]) {
      const door = this.dyn(this.root, A.box(), A.std(0xcfd6de, 0.25, 0.85), 266.5, 0, -200 + side * 14.5, 2, 90, 29);
      door.userData.side = side; this.elevatorDoors.push(door);
    }
    this.frameAt(268, -132, -Math.PI / 2, () => {
      this.add(A.roundBox(0.1, 2), A.std(0x2c3e66, 0.5), 0, 40, 0, 20, 26, 6);
      this.add(A.box(), A.std(0x9fe8b0, 0.2, 0, { emissive: 0x7dffb3, emissiveIntensity: 0.5 }), 0, 54, 3.2, 14, 6, 0.4, { cast: false });
      this.add(A.box(), A.std(0xffffff, 0.6, 0, { map: A.label('NỘI QUY', '#5dbb7a', '#ffffff', 256, 64) }), 0, 72, 1, 30, 8, 1, { cast: false });
    });
    this.timeLed = new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0xff5d5d, emissiveIntensity: 0.25 }); this.dynamicMaterials.push(this.timeLed);
    this.dyn(this.root, A.sphere(10), this.timeLed, 264, 44, -126, 3, 3, 3);
    this.frameAt(268, -60, -Math.PI / 2, () => {
      this.add(A.cylinder(0.5, 0.5, 28), A.std(0xffffff, 0.5), 0, 83, 0, 26, 2.5, 26, { rotX: Math.PI / 2, plane: true });
      this.add(A.torus(Math.PI * 2), A.std(PALETTE.navy, 0.4), 0, 83, 1, 26, 26, 6, { cast: false, plane: true });
    });
    for (const [length, width] of [[7, 1.8], [10.5, 1.1]] as const) {
      const pivot = new THREE.Group(); pivot.position.set(265.5, 83, -60); this.root.add(pivot);
      const hand = new THREE.Mesh(A.box(), A.std(PALETTE.navyDeep, 0.5)); hand.scale.set(width, length, 0.6); hand.position.y = length / 2; pivot.add(hand);
      this.clockHands.push(pivot);
    }
    this.frameAt(88, -258, 0, () => {
      this.add(A.box(), A.std(0xf3f5f7, 0.4), 0, 0, 0, 20, 40, 18);
      this.add(A.cylinder(0.45, 0.5, 16), A.std(0x8fd3ff, 0.05, 0, { transparent: true, opacity: 0.55 }), 0, 40, 0, 18, 22, 18, { cast: false });
    });
    this.nav.block({ minX: 76, maxX: 100, minZ: -269, maxZ: -247 }, 5);
    this.alarmMaterial = new THREE.MeshStandardMaterial({ color: 0x8a1c1c, emissive: 0xff2a1a, emissiveIntensity: 0, roughness: 0.3 });
    this.dynamicMaterials.push(this.alarmMaterial);
    for (const [x, z] of [[266, -250], [-266, -300], [-266, 100], [266, 100]] as const) this.alarmLights.push(this.dyn(this.root, A.sphere(12), this.alarmMaterial, x, 88, z, 7, 7, 7));
    this.plant(-255, 445, 1.1); this.plant(255, 445, 1.1); this.plant(-96, -112, 0.9); this.plant(96, -112, 0.9); this.plant(255, -420, 0.9);

    this.cake = new THREE.Group(); this.cake.visible = false; this.cake.position.copy(this.anchors.party); this.root.add(this.cake);
    this.dyn(this.cake, A.cylinder(0.5, 0.5, 20), wood, 0, 0, 0, 34, 22, 34);
    this.dyn(this.cake, A.cylinder(0.5, 0.5, 20), A.std(0xffe3ef, 0.6), 0, 22, 0, 26, 9, 26);
    this.dyn(this.cake, A.cylinder(0.5, 0.5, 20), A.std(0xff8fb1, 0.6), 0, 31, 0, 18, 7, 18);
    for (let index = 0; index < 5; index++) {
      const angle = index / 5 * Math.PI * 2;
      this.dyn(this.cake, A.cylinder(0.5, 0.5, 6), A.std(0x7fc2ff, 0.5), Math.cos(angle) * 6, 38, Math.sin(angle) * 6, 1.4, 7, 1.4);
      this.dyn(this.cake, A.sphere(8), A.std(0xffc861, 0.3, 0, { emissive: 0xffa53b, emissiveIntensity: 1.2 }), Math.cos(angle) * 6, 45, Math.sin(angle) * 6, 2, 3, 2);
    }
    mergeChildren(this.cake, new Set(), this.ownedGeometries, this.assets.vertexColor());
    this.mergedMeshes = this.batch.build(this.root);
  }

  private frameAt(x: number, z: number, rotation: number, build: () => void) {
    const previous = this.frame.clone();
    this.frame.multiply(new THREE.Matrix4().makeTranslation(x, 0, z)).multiply(new THREE.Matrix4().makeRotationY(rotation));
    build();
    this.frame.copy(previous);
  }
  /** Static piece: (x,y,z) is the bottom-centre in the current frame (centre when `plane`). */
  private add(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, options: { cast?: boolean; plane?: boolean; rotX?: number } = {}) {
    this.tmp.compose(new THREE.Vector3(x, options.plane ? y : y + h / 2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(options.rotX ?? 0, 0, 0)), new THREE.Vector3(w, h, d));
    this.batch.add(geometry, material, this.frame.clone().multiply(this.tmp), options.cast ?? true);
  }
  /** Live mesh (animated / interactive). (x,y,z) is the bottom-centre in parent space. */
  private dyn(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y + h / 2, z); mesh.scale.set(w, h, d);
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  private glassWall(x0: number, z0: number, x1: number, z1: number, glass: THREE.Material, frame: THREE.Material) {
    const length = Math.hypot(x1 - x0, z1 - z0), rotation = Math.abs(x1 - x0) > Math.abs(z1 - z0) ? 0 : Math.PI / 2;
    this.frameAt((x0 + x1) / 2, (z0 + z1) / 2, rotation, () => {
      this.add(this.assets.box(), glass, 0, 0, 0, length, 92, 1.5, { cast: false });
      this.add(this.assets.box(), frame, 0, 0, 0, length, 4, 3);
      this.add(this.assets.box(), frame, 0, 90, 0, length, 3, 3);
      this.add(this.assets.box(), this.assets.std(0xffffff, 0.4, 0, { transparent: true, opacity: 0.55 }), 0, 44, 0, length, 5, 2, { cast: false });
      const posts = Math.max(1, Math.ceil(length / 50));
      for (let index = 0; index <= posts; index++) this.add(this.assets.box(), frame, -length / 2 + index * length / posts, 0, 0, 2.5, 92, 3);
    });
    this.nav.block({ minX: Math.min(x0, x1) - 1.5, maxX: Math.max(x0, x1) + 1.5, minZ: Math.min(z0, z1) - 1.5, maxZ: Math.max(z0, z1) + 1.5 }, 6);
  }
  private plant(x: number, z: number, scale: number) {
    const A = this.assets;
    this.frameAt(x, z, 0, () => {
      this.add(A.cylinder(0.5, 0.38, 16), A.std(0xd98f5f, 0.8), 0, 0, 0, 18 * scale, 18 * scale, 18 * scale);
      this.add(A.cylinder(0.5, 0.5, 16), A.std(0x5a3d2a, 0.95), 0, 17 * scale, 0, 15 * scale, 1, 15 * scale, { cast: false });
    });
    const leaves = new THREE.Group(); leaves.position.set(x, 17 * scale, z); this.root.add(leaves);
    const leafMaterial = A.std(0x4f9a5c, 0.7), light = A.std(0x74bf6e, 0.7);
    for (let index = 0; index < 7; index++) {
      const angle = index / 7 * Math.PI * 2;
      const leaf = new THREE.Mesh(A.sphere(10), index % 2 ? leafMaterial : light);
      leaf.position.set(Math.cos(angle) * 6 * scale, (8 + (index % 3) * 6) * scale, Math.sin(angle) * 6 * scale);
      leaf.scale.set(12 * scale, 18 * scale, 7 * scale); leaf.rotation.set(0.5 * Math.sin(angle), angle, 0.5 * Math.cos(angle));
      leaf.castShadow = true; leaves.add(leaf);
    }
    mergeChildren(leaves, new Set(), this.ownedGeometries, this.assets.vertexColor());
    leaves.userData.phase = Math.random() * 10;
    this.plants.push(leaves);
    this.nav.block({ minX: x - 9 * scale, maxX: x + 9 * scale, minZ: z - 9 * scale, maxZ: z + 9 * scale }, 5);
  }
  private buildChair(x: number, z: number, fabric: THREE.Material, executive: boolean, facing = 0) {
    const A = this.assets;
    const chair = new THREE.Group(); chair.position.set(x, 0, z); chair.rotation.y = facing; this.root.add(chair);
    const base = A.std(0x3b414b, 0.4, 0.6);
    for (let index = 0; index < 5; index++) { const angle = index / 5 * Math.PI * 2; const leg = this.dyn(chair, A.box(), base, Math.sin(angle) * 5, 1, Math.cos(angle) * 5, 2, 2, 11); leg.rotation.y = angle; }
    this.dyn(chair, A.cylinder(0.5, 0.5, 10), base, 0, 2, 0, 3, 11, 3);
    this.dyn(chair, A.roundBox(0.25, 2), fabric, 0, 13, 0, executive ? 26 : 22, 4, executive ? 24 : 20);
    this.dyn(chair, A.roundBox(0.25, 2), fabric, 0, 16, -10, executive ? 26 : 21, executive ? 38 : 24, 4);
    if (executive) for (const side of [-1, 1]) this.dyn(chair, A.roundBox(0.3, 2), fabric, side * 13, 16, 0, 3, 8, 16);
    mergeChildren(chair, new Set(), this.ownedGeometries, this.assets.vertexColor());
    return chair;
  }
  private buildDesk(slot: number, wood: THREE.Material, metal: THREE.Material) {
    const A = this.assets;
    const seat = seatPosition(slot);
    const p = officePoint(seat.x, seat.y - 14);
    const center = v(p.x, 0, p.z);
    const department = DEPARTMENT_COLORS[slot % 3]!;
    this.frameAt(center.x, center.z, 0, () => {
      for (const sx of [-1, 1]) this.add(A.box(), metal, sx * 37, 0, 0, 3, 25, 34);
      this.add(A.box(), A.std(0xf6efe1, 0.7), 0, 4, 18, 74, 19, 2);
      this.add(A.box(), A.std(department, 0.6), 0, 18, 19.2, 74, 3, 0.6, { cast: false });
      this.add(A.cylinder(0.5, 0.42, 12), A.std(0x9aa3ae, 0.5), 36, 0, -26, 9, 11, 9);
    });
    this.nav.block({ minX: center.x - 42, maxX: center.x + 42, minZ: center.z - 21, maxZ: center.z + 21 }, 6);
    const top = new THREE.Group(); top.position.copy(center); this.root.add(top);
    this.dyn(top, A.roundBox(0.06, 2), wood, 0, 25, 0, 84, 3, 42);
    const monitor = new THREE.Group(); monitor.position.set(-6, 28, 8); monitor.rotation.y = Math.PI + (slot % 3 === 0 ? -0.35 : 0.35); top.add(monitor);
    this.dyn(monitor, A.box(), A.std(0x3b414b, 0.4, 0.5), 0, 0, 2, 10, 2, 8);
    this.dyn(monitor, A.box(), A.std(0x3b414b, 0.4, 0.5), 0, 0, 2, 2.5, 10, 2.5);
    this.dyn(monitor, A.roundBox(0.08, 2), A.std(0x23272f, 0.35, 0.3), 0, 8, 0, 32, 20, 2.4);
    const screen = new Screen(128, 80, slot); this.screens.push(screen);
    const screenMaterial = new THREE.MeshStandardMaterial({ map: screen.texture, emissive: 0xffffff, emissiveMap: screen.texture, emissiveIntensity: 0.85, roughness: 0.3 });
    this.dynamicMaterials.push(screenMaterial);
    const screenMesh = new THREE.Mesh(A.plane(), screenMaterial); screenMesh.position.set(0, 18, 1.3); screenMesh.scale.set(29, 17, 1); monitor.add(screenMesh);
    const glow = new THREE.Mesh(A.plane(), A.basic(0x9fd8ff, { transparent: true, opacity: 0.18, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.set(-6, 26.7, -6); glow.scale.set(34, 16, 1); top.add(glow);
    this.dyn(top, A.roundBox(0.2, 2), A.std(0xe9edf2, 0.5), -6, 26.5, -8, 24, 1.6, 8);
    this.dyn(top, A.roundBox(0.3, 2), A.std(0xe9edf2, 0.5), 12, 26.5, -8, 4.5, 1.6, 7);
    const mug = new THREE.Group(); mug.position.set(28, 26.5, -6); top.add(mug);
    this.dyn(mug, A.cylinder(0.5, 0.45, 14), A.std([0xffffff, 0xf06d4f, 0x5b8bd6][slot % 3]!, 0.3), 0, 0, 0, 5.5, 7, 5.5);
    const coffeeLevel = this.dyn(mug, A.cylinder(0.5, 0.5, 14), A.std(0x5a3216, 0.15), 0, 6.2, 0, 4.6, 0.5, 4.6);
    const papers = new THREE.Group(); papers.position.set(-30, 26.5, -2); top.add(papers);
    for (let index = 0; index < 5; index++) { const sheet = this.dyn(papers, A.box(), A.std(index % 2 ? 0xfbfbf6 : 0xf3f0e4, 0.9), (index % 2) * 0.8, index * 0.8, 0, 13, 0.6, 17); sheet.rotation.y = (index - 2) * 0.06; }
    const phone = new THREE.Group(); phone.position.set(28, 26.5, 8); top.add(phone);
    this.dyn(phone, A.roundBox(0.2, 2), A.std(0x2c3e66, 0.5), 0, 0, 0, 9, 3, 7);
    this.dyn(phone, A.roundBox(0.3, 2), A.std(0x1d1f24, 0.5), 0, 3, 0, 9, 2, 3);
    mergeChildren(monitor, new Set([screenMesh]), this.ownedGeometries, this.assets.vertexColor());
    mergeChildren(papers, new Set(), this.ownedGeometries, this.assets.vertexColor());
    mergeChildren(phone, new Set(), this.ownedGeometries, this.assets.vertexColor());
    mergeChildren(top, new Set(), this.ownedGeometries, this.assets.vertexColor());
    const chairZ = center.z - 26;
    const chair = this.buildChair(center.x, chairZ, A.std([0x2c3e66, 0x8a5a3b, 0x3d8f5a][slot % 3]!, 0.75), false, 0);
    this.desks.push({ slot, center, seat: v(center.x, 0, chairZ + 2), top, chair, mug, coffeeLevel, papers, screen, monitor, shake: 0, chairOffset: 0, chairSpin: 0, phoneRing: 0, phone });
  }
  private buildCoffeeMachine(x: number, z: number) {
    const A = this.assets;
    const group = new THREE.Group(); group.position.set(x, 37, z); this.root.add(group);
    this.dyn(group, A.roundBox(0.1, 2), A.std(0x2b2f36, 0.35, 0.6), 0, 0, 0, 26, 32, 20);
    this.dyn(group, A.roundBox(0.1, 2), A.std(0xb9c1cb, 0.25, 0.85), 0, 24, 3, 22, 8, 16);
    this.dyn(group, A.box(), A.std(0x15171b, 0.4), 0, 2, 7, 18, 14, 8);
    this.dyn(group, A.box(), A.std(0x9aa3ae, 0.3, 0.8), 0, 2, 9, 14, 1, 7);
    this.dyn(group, A.cylinder(0.5, 0.5, 10), A.std(0x9aa3ae, 0.3, 0.8), 0, 14, 8, 4, 3, 4);
    const button = this.dyn(group, A.cylinder(0.5, 0.5, 12), A.std(0x5dbb7a, 0.4), 8, 22, 10.5, 3.2, 1.6, 3.2); button.rotation.x = Math.PI / 2;
    const led = new THREE.MeshStandardMaterial({ color: 0x113322, emissive: 0x5dff9a, emissiveIntensity: 0.15 }); this.dynamicMaterials.push(led);
    this.dyn(group, A.sphere(8), led, -8, 22, 10.5, 2, 2, 2);
    const streamMaterial = new THREE.MeshStandardMaterial({ color: 0x4a2a12, roughness: 0.1, transparent: true, opacity: 0.9 }); this.dynamicMaterials.push(streamMaterial);
    const stream = this.dyn(group, A.cylinder(0.5, 0.5, 8), streamMaterial, 0, 6, 8, 1.2, 8, 1.2); stream.visible = false;
    const cup = new THREE.Group(); cup.position.set(0, 3, 8); cup.visible = false; group.add(cup);
    this.dyn(cup, A.cylinder(0.5, 0.42, 14), A.std(0xffffff, 0.25), 0, 0, 0, 6, 7, 6);
    const level = this.dyn(cup, A.cylinder(0.5, 0.5, 14), A.std(0x5a3216, 0.12), 0, 0.5, 0, 5, 0.1, 5);
    mergeChildren(group, new Set([button, stream]), this.ownedGeometries, this.assets.vertexColor());
    this.nav.block({ minX: x - 14, maxX: x + 14, minZ: z - 11, maxZ: z + 11 }, 6);
    return { stream, cup, level, button, led, pouring: 0, pressed: 0 };
  }

  /** Coffee level 0..1: liquid visibly rises inside the cup on the drip tray. */
  setCupLevel(level: number) { this.coffee.level.scale.y = Math.max(0.1, level * 6); this.coffee.level.position.y = 0.5 + this.coffee.level.scale.y / 2; }
  openElevator(seconds = 3) { this.elevatorTarget = 1; this.elevatorTimer = seconds; }
  punchClock() { this.timeBlink = 0.8; }

  update(dt: number, time: number, wallClock: Date) {
    for (const plant of this.plants) { const phase = plant.userData.phase as number; plant.rotation.z = Math.sin(time * 0.9 + phase) * 0.03; plant.rotation.x = Math.cos(time * 0.7 + phase) * 0.02; }
    const minutes = wallClock.getMinutes() + wallClock.getSeconds() / 60, hours = (wallClock.getHours() % 12) + minutes / 60;
    // clock face is on the right wall facing -x; rotate hands around the wall normal
    this.clockHands[0]!.rotation.set(hours / 12 * Math.PI * 2, 0, 0);
    this.clockHands[1]!.rotation.set(minutes / 60 * Math.PI * 2, 0, 0);
    if (this.elevatorTimer > 0) { this.elevatorTimer -= dt; if (this.elevatorTimer <= 0) this.elevatorTarget = 0; }
    this.elevatorOpen += (this.elevatorTarget - this.elevatorOpen) * Math.min(1, dt * 4);
    for (const door of this.elevatorDoors) door.position.z = -200 + (door.userData.side as number) * (14.5 + this.elevatorOpen * 26);
    for (const desk of this.desks) {
      if (desk.shake > 0) {
        desk.shake = Math.max(0, desk.shake - dt * 2.5);
        const amount = desk.shake * desk.shake;
        desk.top.position.set(desk.center.x + Math.sin(time * 70) * 1.6 * amount, Math.abs(Math.sin(time * 55)) * 2.2 * amount, desk.center.z + Math.cos(time * 63) * 1.2 * amount);
        desk.top.rotation.z = Math.sin(time * 48) * 0.03 * amount;
      } else if (desk.top.position.y !== 0 || desk.top.rotation.z !== 0) { desk.top.position.copy(desk.center); desk.top.rotation.z = 0; }
      desk.chair.position.z = desk.center.z - 26 - desk.chairOffset;
      desk.chair.rotation.y += (desk.chairSpin - desk.chair.rotation.y) * Math.min(1, dt * 5);
      if (desk.phoneRing > 0) { desk.phoneRing -= dt; desk.phone.position.y = 26.5 + Math.abs(Math.sin(time * 40)) * 1.2; desk.phone.rotation.y = Math.sin(time * 50) * 0.15; }
      else if (desk.phone.position.y !== 26.5) { desk.phone.position.y = 26.5; desk.phone.rotation.y = 0; }
    }
    const coffee = this.coffee;
    coffee.stream.visible = coffee.pouring > 0;
    if (coffee.pouring > 0) { coffee.pouring -= dt; coffee.stream.scale.x = coffee.stream.scale.z = 1.2 + Math.sin(time * 30) * 0.25; }
    coffee.led.emissiveIntensity = coffee.pouring > 0 ? 0.6 + Math.sin(time * 12) * 0.4 : 0.15;
    if (coffee.pressed > 0) { coffee.pressed -= dt; coffee.button.position.z = 10.5 - 0.9; } else coffee.button.position.z = 10.5;
    if (this.printing > 0) {
      this.printing -= dt; const progress = 1 - (this.printing % 1.5) / 1.5;
      this.printerPaper.position.set(-5, 29.25 - progress * 1.5, -275 + progress * 14); this.printerPaper.visible = true;
    } else this.printerPaper.visible = false;
    if (this.timeBlink > 0) { this.timeBlink -= dt; this.timeLed.emissive.setHex(0x5dff9a); this.timeLed.emissiveIntensity = 1.4; }
    else { this.timeLed.emissive.setHex(0xff5d5d); this.timeLed.emissiveIntensity = 0.25 + Math.sin(time * 3) * 0.1; }
    this.alarm = Math.max(0, this.alarm - dt);
    this.alarmMaterial.emissiveIntensity = this.alarm > 0 ? (Math.sin(time * 14) > 0 ? 2.6 : 0.2) : 0;
    for (const light of this.alarmLights) light.scale.setScalar(this.alarm > 0 ? 7 + Math.sin(time * 14) * 1.5 : 7);
    this.tv.update(time);
  }

  dispose() {
    this.screens.forEach(screen => screen.dispose());
    this.dynamicMaterials.forEach(material => material.dispose());
    this.mergedMeshes.forEach(mesh => mesh.geometry.dispose());
    this.ownedGeometries.forEach(geometry => geometry.dispose());
  }
}
