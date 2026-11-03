/** Grid navigation (A* + line-of-sight smoothing) over the office floor. Pure math, no three.js dependency so it is unit-testable. */
export interface Vec2 { x: number; z: number }
export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

export class NavGrid {
  readonly columns: number;
  readonly rows: number;
  private blocked: Uint8Array;
  private gScore: Float32Array;
  private parent: Int32Array;
  private closed: Uint8Array;
  private stamp: Uint32Array;
  private generation = 0;

  constructor(readonly bounds: Rect, readonly cell = 10) {
    this.columns = Math.ceil((bounds.maxX - bounds.minX) / cell);
    this.rows = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
    const size = this.columns * this.rows;
    this.blocked = new Uint8Array(size); this.gScore = new Float32Array(size);
    this.parent = new Int32Array(size); this.closed = new Uint8Array(size); this.stamp = new Uint32Array(size);
  }
  /** Block a rectangle, inflated by the agent radius. */
  block(rect: Rect, padding = 8) {
    const [c0, r0] = this.cellOf(rect.minX - padding, rect.minZ - padding);
    const [c1, r1] = this.cellOf(rect.maxX + padding - 0.001, rect.maxZ + padding - 0.001);
    for (let row = r0; row <= r1; row++) for (let column = c0; column <= c1; column++) this.blocked[row * this.columns + column] = 1;
  }
  cellOf(x: number, z: number): [number, number] {
    const column = Math.max(0, Math.min(this.columns - 1, Math.floor((x - this.bounds.minX) / this.cell)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor((z - this.bounds.minZ) / this.cell)));
    return [column, row];
  }
  center(index: number): Vec2 {
    return { x: this.bounds.minX + (index % this.columns + 0.5) * this.cell, z: this.bounds.minZ + (Math.floor(index / this.columns) + 0.5) * this.cell };
  }
  isFree(x: number, z: number) { const [column, row] = this.cellOf(x, z); return !this.blocked[row * this.columns + column]; }
  /** Ring search for the closest walkable cell (targets such as chairs sit inside furniture padding). */
  nearestFree(x: number, z: number): number {
    const [column, row] = this.cellOf(x, z);
    const start = row * this.columns + column;
    if (!this.blocked[start]) return start;
    for (let radius = 1; radius < 30; radius++) {
      let best = -1, bestDistance = Infinity;
      for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
        const r = row + dr, c = column + dc;
        if (r < 0 || c < 0 || r >= this.rows || c >= this.columns || this.blocked[r * this.columns + c]) continue;
        const point = this.center(r * this.columns + c);
        const distance = (point.x - x) ** 2 + (point.z - z) ** 2;
        if (distance < bestDistance) { bestDistance = distance; best = r * this.columns + c; }
      }
      if (best >= 0) return best;
    }
    return start;
  }
  /** Line of sight on the grid, used to drop redundant waypoints. */
  clear(a: Vec2, b: Vec2) {
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(distance / (this.cell * 0.45));
    for (let step = 0; step <= steps; step++) {
      const t = steps ? step / steps : 0;
      if (!this.isFree(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }
  /** Returns world-space waypoints ending exactly at `to` (the final hop may enter padded furniture such as a chair). */
  find(from: Vec2, to: Vec2): Vec2[] {
    const start = this.nearestFree(from.x, from.z), goal = this.nearestFree(to.x, to.z);
    if (start === goal) return [to];
    this.generation++;
    const open = new MinHeap();
    const goalPoint = this.center(goal);
    const touch = (index: number) => { if (this.stamp[index] !== this.generation) { this.stamp[index] = this.generation; this.gScore[index] = Infinity; this.closed[index] = 0; this.parent[index] = -1; } };
    touch(start); this.gScore[start] = 0;
    open.push(start, 0);
    let found = false, expanded = 0;
    while (open.size && expanded < 8000) {
      const current = open.pop();
      if (current === goal) { found = true; break; }
      touch(current);
      if (this.closed[current]) continue;
      this.closed[current] = 1; expanded++;
      const column = current % this.columns, row = (current / this.columns) | 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const r = row + dr, c = column + dc;
        if (r < 0 || c < 0 || r >= this.rows || c >= this.columns) continue;
        const next = r * this.columns + c;
        if (this.blocked[next]) continue;
        // No corner cutting through furniture.
        if (dr && dc && (this.blocked[row * this.columns + c] || this.blocked[r * this.columns + column])) continue;
        touch(next);
        const cost = this.gScore[current]! + (dr && dc ? 1.4142 : 1);
        if (cost < this.gScore[next]!) {
          this.gScore[next] = cost; this.parent[next] = current;
          const point = this.center(next);
          const dx = Math.abs(point.x - goalPoint.x) / this.cell, dz = Math.abs(point.z - goalPoint.z) / this.cell;
          open.push(next, cost + Math.max(dx, dz) + 0.4142 * Math.min(dx, dz));
        }
      }
    }
    if (!found) return [to];
    const cells: Vec2[] = [];
    for (let index = goal; index !== -1 && index !== start; index = this.parent[index]!) cells.push(this.center(index));
    cells.reverse();
    // String pulling: keep only waypoints needed to stay in line of sight.
    const smooth: Vec2[] = [];
    let anchor: Vec2 = from;
    for (let index = 0; index < cells.length; index++) {
      const next = cells[index + 1];
      if (next && this.clear(anchor, next)) continue;
      smooth.push(cells[index]!); anchor = cells[index]!;
    }
    smooth.push(to);
    return smooth;
  }
}

class MinHeap {
  private items: number[] = [];
  private priorities: number[] = [];
  get size() { return this.items.length; }
  push(item: number, priority: number) {
    this.items.push(item); this.priorities.push(priority);
    let index = this.items.length - 1;
    while (index > 0) {
      const up = (index - 1) >> 1;
      if (this.priorities[up]! <= priority) break;
      this.swap(index, up); index = up;
    }
  }
  pop(): number {
    const top = this.items[0]!;
    const lastItem = this.items.pop()!, lastPriority = this.priorities.pop()!;
    if (this.items.length) {
      this.items[0] = lastItem; this.priorities[0] = lastPriority;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1, right = left + 1;
        let smallest = index;
        if (left < this.items.length && this.priorities[left]! < this.priorities[smallest]!) smallest = left;
        if (right < this.items.length && this.priorities[right]! < this.priorities[smallest]!) smallest = right;
        if (smallest === index) break;
        this.swap(index, smallest); index = smallest;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.priorities[a], this.priorities[b]] = [this.priorities[b]!, this.priorities[a]!];
  }
}
