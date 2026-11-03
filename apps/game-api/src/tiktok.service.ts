import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ControlEvent, TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';
import type { EventEmitter } from 'node:events';
import { GameService } from './game.service.js';
import { TikTokNormalizer } from './tiktok-normalizer.js';
import type { RawTikTok } from './tiktok-normalizer.js';
import type { GameInputEvent } from '@di-lam/shared';

@Injectable()
export class TikTokService {
  private connection?: TikTokLiveConnection;
  private reconnect?: NodeJS.Timeout;
  private connecting = false;
  private generation = 0;
  private attempt = 0;
  private stopped = true;
  private pending = 0;
  private readonly logger = new Logger('TikTok');
  private normalizer: TikTokNormalizer;
  constructor(private readonly game: GameService) { this.normalizer = new TikTokNormalizer(game.roomId); }
  async connect(username: unknown) {
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_.]{1,24}$/.test(username.replace(/^@/, '').trim())) throw new BadRequestException('Tên TikTok không hợp lệ.');
    if (this.connecting) throw new ConflictException('Đang kết nối, vui lòng chờ.');
    await this.disconnect();
    this.stopped = false; this.attempt = 0;
    return this.open(username.replace(/^@/, '').trim());
  }
  private schedule(username: string) {
    if (this.stopped || this.reconnect || this.attempt >= 5) return;
    const delay = Math.min(60000, 2000 * 2 ** this.attempt++);
    this.reconnect = setTimeout(() => { this.reconnect = undefined; void this.open(username).catch(error => this.logger.error(String(error))); }, delay);
  }
  private async open(username: string) {
    const generation = ++this.generation;
    this.connecting = true;
    this.game.live = { status: 'connecting', username, roomId: '', error: '' };
    const connection = new TikTokLiveConnection(username, { processInitialData: false, enableExtendedGiftInfo: false });
    this.connection = connection;
    const current = () => this.generation === generation && !this.stopped;
    const forward = (type: GameInputEvent['type'], raw: RawTikTok) => {
      if (!current() || this.pending >= 2000) return;
      const event = this.normalizer.normalize(type, raw);
      if (!event) return;
      this.pending++;
      void this.game.submit(event).catch(error => this.logger.error(`Event not committed: ${String(error)}`)).finally(() => { this.pending--; });
    };
    const emitter = connection as unknown as EventEmitter;
    emitter.on(WebcastEvent.CHAT, (data: RawTikTok) => forward('comment', data));
    emitter.on(WebcastEvent.LIKE, (data: RawTikTok) => forward('like', data));
    emitter.on(WebcastEvent.FOLLOW, (data: RawTikTok) => forward('follow', data));
    emitter.on(WebcastEvent.GIFT, (data: RawTikTok) => forward('gift', data));
    // a viewer entered the LIVE room: auto check-in + greeting (operator settings)
    emitter.on(WebcastEvent.MEMBER, (data: RawTikTok) => forward('member', data));
    emitter.on(ControlEvent.ERROR, (error: unknown) => { if (current()) { this.logger.warn(String(error)); this.game.live.error = 'Lỗi nguồn TikTok; xem log server để biết chi tiết.'; } });
    emitter.on(ControlEvent.DISCONNECTED, () => {
      if (!current()) return;
      this.game.live.status = 'offline';
      this.schedule(username);
    });
    emitter.on(WebcastEvent.STREAM_END, () => {
      if (!current()) return;
      this.stopped = true; clearTimeout(this.reconnect); this.reconnect = undefined;
      this.game.live = { status: 'offline', username, roomId: '', error: 'Phiên LIVE đã kết thúc.' };
      void connection.disconnect().catch(error => this.logger.warn(String(error)));
    });
    try {
      const state = await connection.connect();
      if (!current()) { await connection.disconnect(); return { ok: false, message: 'Đã hủy kết nối.' }; }
      this.attempt = 0;
      this.game.live = { status: 'connected', username, roomId: String(state.roomId ?? ''), error: '' };
      return { ok: true, message: `Đã kết nối LIVE @${username}.` };
    } catch (error) {
      this.logger.warn(String(error));
      if (current()) {
        this.game.live = { status: 'error', username, roomId: '', error: 'Không kết nối được. Kiểm tra tài khoản đang LIVE và quyền truy cập của connector.' };
        await connection.disconnect().catch(() => {});
        this.schedule(username);
      }
      return { ok: false, message: 'TikTok chưa sẵn sàng. Simulator vẫn hoạt động.' };
    } finally { if (generation === this.generation) this.connecting = false; }
  }
  async disconnect() {
    this.stopped = true; this.generation++; this.connecting = false;
    clearTimeout(this.reconnect); this.reconnect = undefined;
    const connection = this.connection; this.connection = undefined;
    this.game.live = { status: 'offline', username: '', roomId: '', error: '' };
    if (connection) await connection.disconnect().catch(error => this.logger.warn(String(error)));
    return { ok: true, message: 'Đã ngắt TikTok LIVE.' };
  }
  async onModuleDestroy() { await this.disconnect(); }
}
