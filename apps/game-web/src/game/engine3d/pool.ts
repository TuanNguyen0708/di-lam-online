/**
 * Bounded object pool. At most `capacity` items are ever created; when every item is in use, `acquire()`
 * recycles the oldest active one instead of allocating. This keeps memory flat under event spam
 * (hundreds of TikTok events per second) — nothing is created or garbage-collected after warm-up.
 */
export class Pool<T> {
  private free: T[] = [];
  private active: T[] = [];
  private created = 0;

  /**
   * @param create factory for a new item (called at most `capacity` times)
   * @param capacity hard upper bound on items ever created
   * @param reset called whenever an item leaves the active set (release, recycle or clear)
   */
  constructor(private create: () => T, readonly capacity: number, private reset: (item: T) => void = () => {}) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Pool capacity must be a positive integer');
  }

  /** Returns a ready item: a free one, a new one while under capacity, or the oldest active one (recycled). */
  acquire(): T {
    let item = this.free.pop();
    if (item === undefined) {
      if (this.created < this.capacity) { item = this.create(); this.created++; }
      else { item = this.active.shift()!; this.reset(item); }
    }
    this.active.push(item);
    return item;
  }

  /** Returns an item to the pool. Releasing an item that is not active is a no-op. */
  release(item: T) {
    const index = this.active.indexOf(item);
    if (index < 0) return;
    this.active.splice(index, 1);
    this.reset(item);
    this.free.push(item);
  }

  /** Releases every active item for which `done` returns true (iteration-safe). */
  releaseWhere(done: (item: T) => boolean) {
    for (let index = this.active.length - 1; index >= 0; index--) {
      const item = this.active[index]!;
      if (done(item)) { this.active.splice(index, 1); this.reset(item); this.free.push(item); }
    }
  }

  /** Visits active items oldest-first. */
  forEachActive(visit: (item: T) => void) { for (const item of this.active) visit(item); }
  /** Releases all active items. */
  clear() { for (const item of this.active) { this.reset(item); this.free.push(item); } this.active.length = 0; }
  get activeCount() { return this.active.length; }
  get createdCount() { return this.created; }
}
