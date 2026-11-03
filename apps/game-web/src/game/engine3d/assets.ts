import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { THEME } from '../theme';

/**
 * Office palette: navy + pastel blue workspace, cream/light grey furniture, warm accents, coral for drama, green for positive.
 * Colors shared with the HTML HUD come from `THEME` so 3D and CSS never drift apart.
 */
export const PALETTE = {
  navy: THEME.navy, navyDeep: THEME.ink, pastelBlue: 0xa9c6e8, skyBlue: 0xcfe3f6, cream: 0xf6efe1, creamDark: 0xe6dccb,
  lightGrey: 0xd9dde3, midGrey: 0x9aa3ae, darkGrey: 0x4a505a, warm: THEME.brass, warmDeep: THEME.amber, coral: THEME.coral,
  red: THEME.red, green: THEME.green, greenDeep: THEME.greenDeep, wood: 0xc99566, woodDark: 0x8a5a3b, leather: 0x5a2f22,
  glass: 0xbfe3ff, white: 0xffffff, black: 0x1d1f24, skin: [0xf6d2b4, 0xeebd94, 0xd9a273, 0xb87d55, 0x8d5a3b],
  hair: [0x2b211c, 0x4a3326, 0x7a4f2c, 0xc9a26b, 0x1b1b1f, 0x8e3b2f, 0x5b5f6a],
} as const;

type Draw = (context: CanvasRenderingContext2D, width: number, height: number) => void;

/** Owns every shared geometry, material and texture so the scene can dispose them in one place (no leaks on remount). */
export class Assets {
  private geometries = new Map<string, THREE.BufferGeometry>();
  private materials = new Map<string, THREE.Material>();
  private textures = new Map<string, THREE.Texture>();
  readonly anisotropy: number;
  constructor(renderer: THREE.WebGLRenderer) { this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); }

  geometry<T extends THREE.BufferGeometry>(key: string, build: () => T): T {
    let geometry = this.geometries.get(key) as T | undefined;
    if (!geometry) { geometry = build(); this.geometries.set(key, geometry); }
    return geometry;
  }
  /** Unit rounded box; scale per mesh. Radius is relative to the unit cube. */
  roundBox(radius = 0.12, segments = 2) { return this.geometry(`rbox:${radius}:${segments}`, () => new RoundedBoxGeometry(1, 1, 1, segments, radius)); }
  box() { return this.geometry('box', () => new THREE.BoxGeometry(1, 1, 1)); }
  sphere(detail = 16) { return this.geometry(`sphere:${detail}`, () => new THREE.SphereGeometry(0.5, detail, Math.max(6, detail * 0.75 | 0))); }
  cylinder(top = 0.5, bottom = 0.5, segments = 16) { return this.geometry(`cyl:${top}:${bottom}:${segments}`, () => new THREE.CylinderGeometry(top, bottom, 1, segments)); }
  capsule() { return this.geometry('capsule', () => new THREE.CapsuleGeometry(0.5, 1, 6, 12)); }
  torus(arc = Math.PI) { return this.geometry(`torus:${arc}`, () => new THREE.TorusGeometry(0.5, 0.14, 8, 18, arc)); }
  plane() { return this.geometry('plane', () => new THREE.PlaneGeometry(1, 1)); }

  material<T extends THREE.Material>(key: string, build: () => T): T {
    let material = this.materials.get(key) as T | undefined;
    if (!material) { material = build(); this.materials.set(key, material); }
    return material;
  }
  /** Cached PBR material. Roughness/metalness tuned for a stylized semi-realistic look. */
  std(color: number, roughness = 0.72, metalness = 0, options: THREE.MeshStandardMaterialParameters = {}) {
    const key = `std:${color}:${roughness}:${metalness}:${options.map ? options.map.uuid : ''}:${options.emissive ?? ''}:${options.emissiveIntensity ?? ''}:${options.transparent ? options.opacity : ''}`;
    return this.material(key, () => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...options }));
  }
  /** Shared vertex-coloured material used by mergeChildren to collapse multi-colour rigid parts. */
  vertexColor() { return this.material('vertex-color', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0 })); }
  basic(color: number, options: THREE.MeshBasicMaterialParameters = {}) {
    return this.material(`basic:${color}:${options.transparent ? options.opacity : ''}:${options.map ? options.map.uuid : ''}`, () => new THREE.MeshBasicMaterial({ color, ...options }));
  }
  canvasTexture(key: string, width: number, height: number, draw: Draw, repeat?: [number, number]) {
    let texture = this.textures.get(key) as THREE.CanvasTexture | undefined;
    if (!texture) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      draw(canvas.getContext('2d')!, width, height);
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = this.anisotropy;
      if (repeat) { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(...repeat); }
      this.textures.set(key, texture);
    }
    return texture;
  }
  /** Register an externally created texture (e.g. live monitor screens) for disposal. */
  track(key: string, texture: THREE.Texture) { this.textures.set(key, texture); return texture; }

  // ---------- procedural textures (no third-party assets, no licensing risk) ----------
  wood(light = '#d7a777', dark = '#b07b4f') {
    return this.canvasTexture(`wood:${light}`, 256, 256, (context, width, height) => {
      context.fillStyle = light; context.fillRect(0, 0, width, height);
      for (let line = 0; line < 46; line++) {
        const y = Math.random() * height;
        context.strokeStyle = dark; context.globalAlpha = 0.08 + Math.random() * 0.16; context.lineWidth = 1 + Math.random() * 2.5;
        context.beginPath(); context.moveTo(0, y);
        for (let x = 0; x <= width; x += 16) context.lineTo(x, y + Math.sin(x / 40 + line) * 3);
        context.stroke();
      }
      context.globalAlpha = 1;
    }, [1, 1]);
  }
  floorTiles() {
    return this.canvasTexture('floor', 512, 512, (context, width) => {
      const size = width / 4;
      for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
        const shade = 236 + ((row + column) % 2) * 6 + Math.random() * 4;
        context.fillStyle = `rgb(${shade - 6},${shade - 2},${shade})`;
        context.fillRect(column * size, row * size, size, size);
        for (let speck = 0; speck < 60; speck++) {
          context.fillStyle = `rgba(120,130,150,${Math.random() * 0.08})`;
          context.fillRect(column * size + Math.random() * size, row * size + Math.random() * size, 2, 2);
        }
      }
      context.strokeStyle = 'rgba(130,140,160,0.35)'; context.lineWidth = 3;
      for (let index = 0; index <= 4; index++) {
        context.beginPath(); context.moveTo(index * size, 0); context.lineTo(index * size, width); context.stroke();
        context.beginPath(); context.moveTo(0, index * size); context.lineTo(width, index * size); context.stroke();
      }
    }, [7, 12]);
  }
  carpet(color: string, key: string, repeat: [number, number]) {
    return this.canvasTexture(`carpet:${key}`, 256, 256, (context, width, height) => {
      context.fillStyle = color; context.fillRect(0, 0, width, height);
      for (let index = 0; index < 5000; index++) {
        context.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
        context.fillRect(Math.random() * width, Math.random() * height, 1.5, 1.5);
      }
    }, repeat);
  }
  wallPaint(color: string, key: string) {
    return this.canvasTexture(`wall:${key}`, 256, 128, (context, width, height) => {
      context.fillStyle = color; context.fillRect(0, 0, width, height);
      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, 'rgba(255,255,255,0.12)'); gradient.addColorStop(1, 'rgba(0,0,0,0.10)');
      context.fillStyle = gradient; context.fillRect(0, 0, width, height);
    });
  }
  /** Soft radial blob used as cheap contact shadow / ambient occlusion under furniture and characters. */
  blob() {
    return this.canvasTexture('blob', 128, 128, (context, width) => {
      const gradient = context.createRadialGradient(width / 2, width / 2, 0, width / 2, width / 2, width / 2);
      gradient.addColorStop(0, 'rgba(20,24,40,0.55)'); gradient.addColorStop(0.55, 'rgba(20,24,40,0.25)'); gradient.addColorStop(1, 'rgba(20,24,40,0)');
      context.fillStyle = gradient; context.fillRect(0, 0, width, width);
    });
  }
  sky() {
    return this.canvasTexture('sky', 64, 256, (context, width, height) => {
      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#7fb7ec'); gradient.addColorStop(0.6, '#cfe6fb'); gradient.addColorStop(1, '#fff1d6');
      context.fillStyle = gradient; context.fillRect(0, 0, width, height);
      context.fillStyle = 'rgba(80,110,150,0.55)';
      for (let index = 0; index < 7; index++) { const towerHeight = 40 + Math.random() * 90; context.fillRect(index * 10, height - towerHeight, 8, towerHeight); }
    });
  }
  label(text: string, background: string, color = '#ffffff', width = 512, height = 128) {
    return this.canvasTexture(`label:${text}:${background}`, width, height, (context) => {
      context.fillStyle = background; context.beginPath(); context.roundRect(4, 4, width - 8, height - 8, 22); context.fill();
      context.fillStyle = color; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.font = `800 ${Math.round(height * 0.42)}px "Be Vietnam Pro", "Segoe UI", sans-serif`;
      context.fillText(text, width / 2, height / 2 + 2, width - 40);
    });
  }

  dispose() {
    this.geometries.forEach(geometry => geometry.dispose());
    this.materials.forEach(material => material.dispose());
    this.textures.forEach(texture => texture.dispose());
    this.geometries.clear(); this.materials.clear(); this.textures.clear();
  }
}

/**
 * Merges a group's direct child meshes that share a material (keeping their local transforms) into one mesh,
 * cutting draw calls for rigid sub-assemblies (a character's limb, a chair, a plant). Meshes in `keep`
 * (animated face parts, toggled props) are left alone. Merged geometries are pushed to `owned` for disposal.
 */
export function mergeChildren(parent: THREE.Object3D, keep: Set<THREE.Object3D>, owned: THREE.BufferGeometry[], vertexColors?: THREE.MeshStandardMaterial) {
  const groups = new Map<string, THREE.Mesh[]>();
  // plain opaque colours can share one vertex-coloured material: one draw call per rigid part regardless of colour
  const bakeable = (material: THREE.Material) => !!vertexColors && material instanceof THREE.MeshStandardMaterial && !material.transparent && !material.map && material.emissive.getHex() === 0 && material.metalness < 0.5;
  for (const child of parent.children) {
    if (!(child instanceof THREE.Mesh) || keep.has(child) || child.children.length || !child.visible || Array.isArray(child.material) || child instanceof THREE.InstancedMesh) continue;
    const material = child.material as THREE.Material;
    const key = `${bakeable(material) ? 'vc' : material.uuid}:${child.castShadow}`;
    const list = groups.get(key) ?? []; list.push(child); groups.set(key, list);
  }
  const created: THREE.Mesh[] = [];
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map(mesh => {
      mesh.updateMatrix();
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
      if (!geometry.attributes.uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position!.count * 2), 2));
      const color = (mesh.material as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1);
      const colors = new Float32Array(geometry.attributes.position!.count * 3);
      for (let index = 0; index < colors.length; index += 3) { colors[index] = color.r; colors[index + 1] = color.g; colors[index + 2] = color.b; }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      return geometry.applyMatrix4(mesh.matrix);
    });
    const merged = mergeGeometries(geometries, false);
    geometries.forEach(geometry => geometry.dispose());
    if (!merged) continue;
    const first = meshes[0]!;
    const baked = vertexColors && bakeable(first.material as THREE.Material);
    if (!baked) merged.deleteAttribute('color');
    const mesh = new THREE.Mesh(merged, baked ? vertexColors : first.material);
    mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
    meshes.forEach(item => parent.remove(item));
    parent.add(mesh); owned.push(merged); created.push(mesh);
  }
  return created;
}

/**
 * Collects static furniture pieces and merges them per material into a handful of meshes.
 * A few hundred decorative boxes become ~20 draw calls.
 */
export class StaticBatcher {
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private shadowless = new Set<THREE.Material>();
  add(geometry: THREE.BufferGeometry, material: THREE.Material, matrix: THREE.Matrix4, castShadow = true) {
    const clone = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    // Keep only attributes every source shares, so heterogenous primitives merge cleanly.
    for (const name of Object.keys(clone.attributes)) if (!['position', 'normal', 'uv'].includes(name)) clone.deleteAttribute(name);
    clone.applyMatrix4(matrix);
    const bucket = this.buckets.get(material) ?? [];
    bucket.push(clone); this.buckets.set(material, bucket);
    if (!castShadow) this.shadowless.add(material);
  }
  build(parent: THREE.Object3D) {
    const meshes: THREE.Mesh[] = [];
    for (const [material, geometries] of this.buckets) {
      const merged = mergeGeometries(geometries, false);
      geometries.forEach(geometry => geometry.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = !this.shadowless.has(material) && !(material as THREE.MeshStandardMaterial).transparent;
      mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      parent.add(mesh); meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}
