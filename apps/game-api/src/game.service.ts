import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { createHash } from 'node:crypto';
import { GameEngine, type SpeechSample } from './engine.js';
import { Store } from './store.js';
import type { ActionResult, AdminCommand, GameInputEvent, GameState, LiveStatus, SpeechLine } from '@di-lam/shared';

@Injectable()
export class GameService {
  private readonly logger = new Logger('Game');
  readonly roomId = process.env.ROOM_ID || 'office-main';
  readonly store = new Store(this.roomId);
  engine = new GameEngine(this.roomId);
  live: LiveStatus = { status: 'offline', username: '', roomId: '', error: '' };
  private published = this.engine.view(this.live, this.store.mode);
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private queue?: Queue<GameInputEvent, ActionResult>;
  private queueEvents?: QueueEvents;
  private worker?: Worker<GameInputEvent, ActionResult>;
  private closing = false;
  async onModuleInit() {
    if (!!process.env.DATABASE_URL !== !!process.env.REDIS_URL) throw new Error('Set BOTH DATABASE_URL and REDIS_URL, or leave both empty.');
    const saved = await this.store.open();
    this.engine = new GameEngine(this.roomId, saved);
    this.published = this.engine.view(this.live, this.store.mode);
    if (process.env.REDIS_URL) {
      const url = new URL(process.env.REDIS_URL);
      if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('Invalid REDIS_URL');
      const connection = { host: url.hostname, port: Number(url.port || 6379), username: url.username ? decodeURIComponent(url.username) : undefined, password: url.password ? decodeURIComponent(url.password) : undefined, db: Number(url.pathname.slice(1) || 0), tls: url.protocol === 'rediss:' ? {} : undefined };
      const name = `office-${createHash('sha256').update(this.roomId).digest('hex').slice(0, 16)}`;
      this.queue = new Queue(name, { connection, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: { age: 600, count: 20000 }, removeOnFail: { age: 3600, count: 1000 } } });
      this.queueEvents = new QueueEvents(name, { connection });
      this.worker = new Worker(name, job => {
        if (Date.now() - job.data.timestamp > 120000) return Promise.resolve({ ok: false, message: 'Sự kiện đã quá hạn 2 phút.' });
        return this.commit(engine => engine.apply(job.data), job.data);
      }, { connection, concurrency: 1 });
      this.worker.on('error', error => this.logger.error(error.message));
      this.queueEvents.on('error', error => this.logger.error(error.message));
      this.queue.on('error', error => this.logger.error(error.message));
      await Promise.all([this.queue.waitUntilReady(), this.queueEvents.waitUntilReady(), this.worker.waitUntilReady()]);
    }
    this.timer = setInterval(() => {
      if (this.ticking || this.closing) return;
      this.ticking = true;
      void this.commit(engine => { engine.tick(); return { ok: true, message: 'tick' }; })
        .catch(error => this.logger.error(`Tick not committed: ${String(error)}`)).finally(() => { this.ticking = false; });
    }, 1000);
    this.logger.log(`${saved ? 'Restored' : 'New'} room ${this.roomId}; storage=${this.store.mode}`);
  }
  snapshot(): GameState { return { ...this.published, live: { ...this.live }, serverTime: Date.now() }; }
  private commit(operation: (engine: GameEngine) => ActionResult, event?: GameInputEvent): Promise<ActionResult> {
    if (this.pending >= 2000 || this.closing) return Promise.reject(new ServiceUnavailableException('Game queue is full or shutting down.'));
    this.pending++;
    // ponytail: one serial writer per room; shard rooms across processes before scaling beyond this MVP.
    const next = this.tail.then(async () => {
      const before = this.store.mode === 'postgres' ? this.engine.export() : undefined;
      try {
        const result = operation(this.engine);
        await this.store.save(this.engine.export(), result.duplicate ? undefined : event);
        this.published = this.engine.view(this.live, this.store.mode);
        return result;
      } catch (error) {
        if (before) this.engine = new GameEngine(this.roomId, before);
        throw error;
      }
    });
    this.tail = next.catch(() => {}).finally(() => { this.pending--; });
    return next;
  }
  async submit(event: GameInputEvent): Promise<ActionResult> {
    if (this.closing) throw new ServiceUnavailableException('Game is shutting down.');
    if (!this.queue || !this.queueEvents) return this.commit(engine => engine.apply(event), event);
    if (await this.queue.getWaitingCount() >= 2000) throw new ServiceUnavailableException('Event queue is full.');
    const jobId = createHash('sha256').update(`${event.source}:${event.eventId}`).digest('hex');
    const job = await this.queue.add('input', event, { jobId });
    return job.waitUntilFinished(this.queueEvents, 15000);
  }
  control(command: AdminCommand) { return this.commit(engine => engine.control(command)); }
  /** Validated, persisted operator settings (rejected patches change nothing). */
  updateSettings(patch: unknown) { return this.commit(engine => engine.updateSettings(patch)); }
  speak(text: string) { return this.commit(engine => engine.speak(text)); }
  speakSample(kind: SpeechSample) { return this.commit(engine => engine.speakSample(kind)); }
  /** A spoken line still in the published snapshot; older lines have expired. */
  speechLine(id: number): SpeechLine | undefined { return this.published.speech.find(line => line.id === id); }
  get settings() { return this.published.settings; }
  async onModuleDestroy() {
    this.closing = true;
    clearInterval(this.timer);
    await this.worker?.close();
    await this.tail;
    await this.queueEvents?.close();
    await this.queue?.close();
    await this.store.close();
  }
}
