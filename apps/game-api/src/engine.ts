import { randomUUID } from 'node:crypto';
import { AUTOMATION, COMMANDS, DEFAULT_SETTINGS, restoreSettings, DRAMA_LABELS, DRAMA_POINTS, DRAMA_THRESHOLDS, LIMITS, PHASES, ROLE_XP, SCENARIOS, SETTINGS_LIMITS, cleanText, joinNames, mergeSettings, parseCommand, safeName, validInput } from '@di-lam/shared';
import type { ActionResult, AdminCommand, Effect, FeedItem, GameInputEvent, GameState, LiveStatus, Phase, Player, RoomSettings, SpeechLine } from '@di-lam/shared';

export interface EngineData {
  version: 1; roomId: string; sessionId: string; day: number; elapsed: number; paused: boolean;
  bossHp: number; bossMaxHp: number; likes: number; combo: number; unrest: number; rescued: boolean;
  phase: Phase; players: Record<string, Player>; votes: Record<string, 'strike' | 'work'>;
  seen: [string, number][]; feed: FeedItem[]; effects: Effect[]; sequence: number; regen: number;
  /** Added after v1 launch; older snapshots load with defaults. */
  dramaMeter: number; dramaStage: number; dramaCooling: boolean;
  /** Operator settings + voice automation (added 2026-11-03; older snapshots load with defaults). */
  settings: RoomSettings; speech: SpeechLine[];
  /** Ids already greeted / thanked for following this session (bounded). */
  greeted: string[]; thanked: string[];
  /** Newcomer names waiting for the next greeting sentence. */
  joiners: string[];
  /** Last gift thank-you time per viewer id. */
  giftThanks: [string, number][];
  /** Recently active names, thanked by the share reminder. */
  recent: string[];
  greetAt: number; shareAt: number;
}
const DRAMA_DEFAULTS = { dramaMeter: 0, dramaStage: 0, dramaCooling: false } as const;
const automationDefaults = () => ({ settings: { ...DEFAULT_SETTINGS }, speech: [], greeted: [], thanked: [], joiners: [], giftThanks: [], recent: [], greetAt: 0, shareAt: 0 });
/** Minimum ms between two "can't do that now" bubbles for the same viewer. */
const DENY_FEEDBACK_MS = 3000;
/** Sample viewer name for the dashboard's "nghe thử" buttons. */
const SAMPLE_NAME = 'Mèo Mun';
export type SpeechSample = 'greet' | 'gift' | 'follow' | 'share';
export const SPEECH_SAMPLES: readonly SpeechSample[] = ['greet', 'gift', 'follow', 'share'];
export class GameEngine {
  data: EngineData;
  private seen: Map<string, number>;
  private greeted: Set<string>;
  private thanked: Set<string>;
  private lastTick: number;
  constructor(roomId = 'office-main', saved?: EngineData, now = Date.now()) {
    this.data = saved ? { ...DRAMA_DEFAULTS, ...automationDefaults(), ...saved, settings: restoreSettings(saved.settings) } : {
      version: 1, roomId, sessionId: randomUUID(), day: 1, elapsed: 0, paused: false,
      bossHp: 10000, bossMaxHp: 10000, likes: 0, combo: 0, unrest: 0, rescued: false,
      phase: 'work', players: {}, votes: {}, seen: [], feed: [], effects: [], sequence: 0, regen: 0, ...DRAMA_DEFAULTS, ...automationDefaults(),
    };
    this.seen = new Map(this.data.seen);
    this.greeted = new Set(this.data.greeted);
    this.thanked = new Set(this.data.thanked);
    this.lastTick = now;
    if (!saved) this.log('Cửa công ty đã mở. Vào live là vào phòng ngay!', 'system');
  }
  export(): EngineData { return structuredClone({ ...this.data, seen: [...this.seen] }); }
  private log(text: string, kind: FeedItem['kind'] = 'action') {
    this.data.feed.unshift({ id: ++this.data.sequence, text, kind });
    this.data.feed.length = Math.min(this.data.feed.length, LIMITS.feed);
  }
  private effect(type: string, text: string, playerId?: string, extra: Pick<Effect, 'targetId' | 'tier'> = {}) {
    this.data.effects.push({ id: ++this.data.sequence, type, text, playerId, ...extra });
    this.data.effects = this.data.effects.slice(-LIMITS.effects);
  }

  // ---------------------------------------------------------------- voice automation
  /** Queues one sentence for the stage voice (ignored while the voice is off). */
  private say(text: string, priority = false) {
    if (!this.data.settings.voice) return;
    const line = text.slice(0, SETTINGS_LIMITS.speech).trim();
    if (!line) return;
    this.data.speech.push({ id: ++this.data.sequence, text: line, priority });
    this.data.speech = this.data.speech.slice(-AUTOMATION.speech);
  }
  /** Adds an id to a bounded "already done this session" set mirrored in `data`. */
  private remember(set: Set<string>, list: string[], id: string) {
    set.add(id); list.push(id);
    while (list.length > AUTOMATION.remembered) set.delete(list.shift()!);
  }
  private noteRecent(name: string) {
    this.data.recent = [name, ...this.data.recent.filter(other => other !== name)].slice(0, AUTOMATION.recentNames);
  }
  /** Newcomers are greeted once per session, a few names per sentence (see `flushGreetings`). */
  private queueGreeting(id: string, name: string) {
    const { voice, greetJoiners } = this.data.settings;
    if (!voice || !greetJoiners || this.greeted.has(id)) return;
    this.remember(this.greeted, this.data.greeted, id);
    this.data.joiners = [...this.data.joiners, name].slice(-AUTOMATION.greetQueue);
  }
  private greeting(names: readonly string[]) {
    const { greetTemplate, companyName } = this.data.settings;
    return greetTemplate.split('{names}').join(joinNames(names)).split('{company}').join(companyName);
  }
  private giftLine(name: string) { return `${this.data.settings.companyName} cảm ơn ${name} đã gửi quà! Cả phòng được thưởng nóng!`; }
  private followLine(name: string) { return `Cảm ơn ${name} đã theo dõi ${this.data.settings.companyName}! Gõ lệnh để quậy văn phòng nhé.`; }
  private shareLine(names: readonly string[]) {
    const company = this.data.settings.companyName;
    return names.length
      ? `${company} cảm ơn ${joinNames(names)} đã ghé chơi! Mọi người nhớ bấm chia sẻ live để rủ thêm đồng nghiệp vào làm nhé.`
      : `Mọi người nhớ bấm chia sẻ live để rủ thêm đồng nghiệp vào ${company} nhé! Vào live là vào phòng ngay.`;
  }
  private thankGift(id: string, name: string, now: number) {
    if (!this.data.settings.thankGifts) return;
    const last = this.data.giftThanks.find(([key]) => key === id)?.[1] ?? -Infinity;
    if (now - last < AUTOMATION.giftThanksMs) return;
    this.data.giftThanks = [...this.data.giftThanks.filter(([key, time]) => key !== id && now - time < AUTOMATION.giftThanksMs), [id, now]];
    this.say(this.giftLine(name), true);
  }
  private flushGreetings(now: number) {
    if (!this.data.joiners.length || now - this.data.greetAt < AUTOMATION.greetIntervalMs) return;
    this.data.greetAt = now;
    this.say(this.greeting(this.data.joiners.splice(0, AUTOMATION.greetBatch)));
  }
  private shareReminder(now: number) {
    const minutes = this.data.settings.shareReminderMinutes;
    if (!minutes || !this.data.settings.voice) { this.data.shareAt = 0; return; }
    if (!this.data.shareAt) { this.data.shareAt = now; return; }
    if (now - this.data.shareAt < minutes * 60000) return;
    this.data.shareAt = now;
    this.say(this.shareLine(this.data.recent));
    this.data.recent = [];
  }
  /** TikTok has no "left the LIVE" event: viewers who never type a command leave the office after a long idle, so counts stay honest. */
  private autoCheckout(now: number) {
    let left = 0;
    for (const player of this.active()) if (player.auto && now - player.lastActiveAt > AUTOMATION.autoCheckoutMs) { player.active = false; left++; }
    if (left) this.log(`${left} nhân viên đã rời phòng vì lâu không tương tác.`, 'system');
  }
  private deniedAt = new Map<string, number>();
  /**
   * A command that was typed correctly but cannot run now (cooldown, energy…): the viewer's character says why
   * (`denied` effect), at most once per `DENY_FEEDBACK_MS` per viewer so spam cannot flood the stage.
   */
  private deny(id: string, now: number, bubble: string, message: string): ActionResult {
    if (now - (this.deniedAt.get(id) ?? -Infinity) >= DENY_FEEDBACK_MS) {
      this.deniedAt.set(id, now);
      if (this.deniedAt.size > AUTOMATION.remembered) this.deniedAt.delete(this.deniedAt.keys().next().value!);
      this.effect('denied', bubble, id);
    }
    return { ok: false, message };
  }
  /** Puts a viewer in the office: on joining the LIVE (`viaLive`) or with their first command. */
  private enterOffice(id: string, displayName: string, now: number, viaLive: boolean): ActionResult {
    let player = this.data.players[id];
    if (!player) {
      if (Object.keys(this.data.players).length >= LIMITS.players) return { ok: false, message: 'Phòng đã đủ 2.000 hồ sơ. Chờ phiên mới.' };
      player = { id, name: safeName(displayName), xp: 0, salary: 0, drama: 0, relationships: 0, energy: 100, role: 0, active: false, joinedAt: now, lastActiveAt: now, cooldowns: {}, auto: viaLive };
      this.data.players[id] = player;
    }
    if (player.active) { if (!viaLive) { player.auto = false; player.lastActiveAt = now; } return { ok: true, message: 'Bạn đã ở trong phòng rồi!' }; }
    player.name = safeName(displayName);
    player.active = true;
    player.auto = viaLive;
    player.lastActiveAt = now;
    this.log(`${player.name} vừa vào phòng. Lại thêm một chiếc deadline!`, 'system');
    this.effect('join', 'NHÂN SỰ MỚI!', id);
    return { ok: true, message: 'Chào mừng đến công sở bất ổn!' };
  }

  // ---------------------------------------------------------------- operator settings
  /** Validated settings patch from the dashboard. */
  updateSettings(patch: unknown): ActionResult {
    const result = mergeSettings(this.data.settings, patch);
    if (!result.ok) return result;
    this.data.settings = result.settings;
    if (!result.settings.voice || !result.settings.greetJoiners) this.data.joiners = [];
    return { ok: true, message: 'Đã lưu cài đặt.' };
  }
  /** "Đọc ngay": the operator's own sentence, read next. */
  speak(text: string): ActionResult {
    const line = cleanText(text).slice(0, SETTINGS_LIMITS.speech);
    if (!line) return { ok: false, message: 'Chưa nhập nội dung cần đọc.' };
    if (!this.data.settings.voice) return { ok: false, message: 'Giọng đọc đang tắt. Bật "Tự đọc trên sân khấu" trước.' };
    this.say(line, true);
    return { ok: true, message: 'Đã gửi câu đọc tới sân khấu.' };
  }
  /** "Nghe thử": reads one automated line with a sample name, using the current settings. */
  speakSample(kind: SpeechSample): ActionResult {
    const lines: Record<SpeechSample, string> = {
      greet: this.greeting([SAMPLE_NAME]), gift: this.giftLine(SAMPLE_NAME), follow: this.followLine(SAMPLE_NAME), share: this.shareLine([SAMPLE_NAME]),
    };
    return this.speak(lines[kind]);
  }
  /** Raise or lower the Drama Meter; crossing 25/50/75/100 fires one escalation effect per stage. */
  private addDrama(amount: number) {
    this.data.dramaMeter = Math.max(0, Math.min(100, this.data.dramaMeter + amount));
    while (this.data.dramaStage < DRAMA_THRESHOLDS.length && this.data.dramaMeter >= DRAMA_THRESHOLDS[this.data.dramaStage]!) {
      this.data.dramaStage++;
      const label = DRAMA_LABELS[this.data.dramaStage]!;
      this.effect(this.data.dramaStage === 4 ? 'chaos' : `drama${this.data.dramaStage}`, label, undefined, { tier: this.data.dramaStage });
      this.log(`DRAMA ${DRAMA_THRESHOLDS[this.data.dramaStage - 1]}%: ${label}`, 'drama');
      if (this.data.dramaStage === 4) this.data.dramaCooling = true;
    }
  }
  /** Most recently active coworker, so targeted actions hit someone viewers just saw. */
  private target(id: string) {
    return this.active().filter(other => other.id !== id).sort((left, right) => right.lastActiveAt - left.lastActiveAt || left.id.localeCompare(right.id))[0];
  }
  private reward(player: Player, xp: number, salary = 0) {
    const oldRole = player.role;
    player.xp += xp;
    player.salary += salary;
    player.role = ROLE_XP.reduce<number>((rank, threshold, index) => player.xp >= threshold ? index : rank, 0);
    if (player.role > oldRole) this.log(`${player.name} vừa thăng chức nhờ thành tích!`, 'system');
  }
  private active() { return Object.values(this.data.players).filter(player => player.active); }
  private damage(amount: number, playerId?: string) {
    if (this.data.bossHp <= 0 || this.data.phase === 'results') return;
    this.data.bossHp = Math.max(0, this.data.bossHp - amount);
    this.effect('hit', `-${amount} HP`, playerId);
    if (this.data.bossHp === 0) {
      this.log('SẾP ĐẦU HÀNG! Cả phòng được thưởng. Không ai bị trừ lương.', 'drama');
      this.effect('victory', 'SẾP XIN LỖI CẢ PHÒNG!');
      this.active().forEach(player => this.reward(player, 40, 200));
    }
  }
  apply(input: GameInputEvent, now = Date.now()): ActionResult {
    if (!validInput(input) || input.roomId !== this.data.roomId) return { ok: false, message: 'Sự kiện không hợp lệ hoặc sai phòng.' };
    if (this.data.paused) return { ok: false, message: 'Công ty đang tạm nghỉ.' };
    for (const [key, time] of this.seen) {
      if (now - time < LIMITS.dedupeTtl) break;
      this.seen.delete(key);
    }
    const eventKey = `${input.source}:${input.eventId}`;
    if (this.seen.has(eventKey)) return { ok: true, message: 'Sự kiện đã xử lý.', duplicate: true };
    this.seen.set(eventKey, now);
    if (this.seen.size > LIMITS.dedupe) this.seen.delete(this.seen.keys().next().value!);
    const id = `${input.source}:${input.user.platformUserId}`;
    const count = Math.min(input.payload.count ?? 1, 10000);
    if (input.type === 'like') {
      const before = Math.floor(this.data.likes / 500);
      this.data.likes += count;
      if (Math.floor(this.data.likes / 500) > before) {
        this.active().forEach(player => { player.energy = Math.min(100, player.energy + 10); });
        this.effect('coffee', '500 TIM! CÀ PHÊ CHO CẢ PHÒNG');
        this.log('Cả phòng được tiếp 10 năng lượng nhờ lượt thích.', 'system');
      }
      return { ok: true, message: 'Đã nhận lượt thích.' };
    }
    const viewerName = safeName(input.user.displayName);
    if (input.type === 'member') {
      const entered = this.enterOffice(id, viewerName, now, true);
      if (!entered.ok) return entered;
      this.queueGreeting(id, viewerName);
      return { ok: true, message: 'Đã nhận người vào phòng.' };
    }
    if (input.type === 'gift') {
      const tier = count >= 30 ? 3 : count >= 10 ? 2 : 1;
      this.effect('gift', ['TẶNG HOA CẢ PHÒNG!', 'TIỆC SINH NHẬT BẤT NGỜ!', 'DIỄN TẬP BÁO CHÁY!'][tier - 1]!, undefined, { tier });
      this.log(`${viewerName} mở tiệc giấy màu x${Math.min(count, 50)}!`, 'gift');
      this.thankGift(id, viewerName, now);
      this.noteRecent(viewerName);
      return { ok: true, message: 'Quà chỉ tạo hiệu ứng, không cộng XP hoặc phiếu bầu.' };
    }
    if (input.type === 'follow') {
      this.log(`${viewerName} vừa theo dõi công ty. HR rất vui.`, 'system');
      this.effect('follow', `CHÀO ${viewerName.toUpperCase()}!`);
      if (this.data.settings.thankFollows && !this.thanked.has(id)) { this.remember(this.thanked, this.data.thanked, id); this.say(this.followLine(viewerName)); }
      this.noteRecent(viewerName);
      return { ok: true, message: 'Đã nhận follow.' };
    }
    const parsed = parseCommand(input.payload.text ?? '');
    if (!parsed) {
      // Raw comments are never displayed (no Vietnamese profanity filter yet): the stage shows a canned line instead.
      // someone still watching (they just commented) is back in the office if they had idled out
      if (this.data.players[id] && !this.data.players[id]!.active) this.enterOffice(id, viewerName, now, true);
      const speaker = this.data.players[id];
      if (speaker?.active && now - speaker.lastActiveAt >= 4000) { speaker.lastActiveAt = now; this.effect('chat', 'Buôn chuyện', id, { targetId: this.target(id)?.id }); }
      return { ok: false, message: 'Lệnh chưa hỗ trợ. Thử damsep hoặc lamviec.' };
    }
    const { command, argument } = parsed;
    // a viewer not yet in the office (e.g. idle-left, or a comment before the join event) enters with their first command,
    // which their character then performs
    if (!this.data.players[id]?.active) {
      const joined = this.enterOffice(id, viewerName, now, false);
      if (!joined.ok) return joined;
      this.queueGreeting(id, viewerName);
    }
    const player = this.data.players[id]!;
    if (command === 'vote') {
      if (this.data.phase !== 'vote') return { ok: false, message: 'Chưa đến giờ bình chọn.' };
      const choice = ['dinhcong', 'strike', '1'].includes(argument) ? 'strike' : ['lamviec', 'work', '2'].includes(argument) ? 'work' : null;
      if (!choice) return { ok: false, message: 'Dùng vote dinhcong hoặc vote lamviec.' };
      this.data.votes[id] = choice;
      return { ok: true, message: 'Đã ghi nhận: mỗi người đúng một phiếu, có thể đổi ý.' };
    }
    const rule = COMMANDS[command];
    const readyAt = player.cooldowns[command] ?? 0;
    if (now < readyAt) return this.deny(id, now, `Đợi ${Math.ceil((readyAt - now) / 1000)}s nữa!`, `Đợi ${Math.ceil((readyAt - now) / 1000)} giây trước khi dùng lại.`);
    if (player.energy < rule.energy) return this.deny(id, now, 'Hết năng lượng! Gõ cafe', 'Hết năng lượng! Dùng cafe hoặc nghỉ một chút.');
    if (command === 'damsep' && (this.data.bossHp === 0 || this.data.phase === 'results')) return this.deny(id, now, 'Sếp về rồi!', 'Sếp đã về. Đợi vòng tiếp theo nhé.');
    const teammate = this.active().filter(other => other.id !== id).sort((left, right) => left.energy - right.energy)[0];
    if (command === 'cuu' && !teammate) return this.deny(id, now, 'Chưa có ai để cứu!', 'Chưa có đồng nghiệp để giải cứu.');
    player.energy -= rule.energy;
    if (rule.cooldown) player.cooldowns[command] = now + rule.cooldown;
    const victim = this.target(id);
    player.lastActiveAt = now;
    player.auto = false;
    this.noteRecent(player.name);
    this.addDrama(DRAMA_POINTS[command] ?? 0);
    switch (command) {
      case 'damsep': {
        const votes = this.voteCounts();
        const damage = this.data.phase === 'battle' ? 180 + (votes.strike > votes.work ? 60 : 0) : 40;
        this.damage(damage, id); player.drama += 8; this.reward(player, 10); break;
      }
      case 'dapban':
        this.data.combo++; this.data.unrest++; player.drama += 5; this.reward(player, 6);
        this.effect('slam', `${this.data.combo} COMBO ĐẬP BÀN!`, id);
        if (this.data.unrest === 5) this.log('5 BÀN CÙNG RUNG → HR xuất hiện! Dùng cuu để cứu đồng nghiệp.', 'drama');
        break;
      case 'tangluong': {
        const approved = player.xp >= 80;
        this.reward(player, 8, approved ? 150 : 0);
        this.effect('raise', approved ? '+150 LƯƠNG ẢO' : 'SẾP: ĐỂ ANH XEM…', id);
        this.log(approved ? `${player.name} xin được tăng lương!` : `${player.name} xin tăng lương. Sếp giả vờ mất mạng.`); break;
      }
      case 'nghiviec': player.active = false; this.effect('resign', 'EM XIN PHÉP VỀ!', id); this.log(`${player.name} nộp đơn nghỉ. Hồ sơ và XP vẫn được giữ.`); break;
      case 'bocphot': player.drama += 15; this.reward(player, 8); this.effect('report', 'BẰNG CHỨNG ĐÂY RỒI!', id); this.log(`${player.name} tung bằng chứng sếp ăn vụng trong pantry.`, 'drama'); break;
      case 'cafe': player.energy = Math.min(100, player.energy + 25); this.reward(player, 3); this.effect('coffee', '+25 NĂNG LƯỢNG', id); break;
      case 'lamviec': this.reward(player, 12, 30); this.effect('work', '+30 LƯƠNG ẢO', id); break;
      case 'cuu':
        teammate!.energy = Math.min(100, teammate!.energy + 20); player.relationships += 1; this.reward(player, 10);
        this.effect('rescue', 'ĐỒNG NGHIỆP LÀ GIA ĐÌNH!', id);
        if (this.data.unrest >= 5 && !this.data.rescued) { this.data.rescued = true; this.log('Đồng nghiệp giải cứu thành công → Sếp nổi giận, cả phòng đòi đình công!', 'drama'); }
        break;
      case 'tat': player.drama += 6; this.reward(player, 6); this.effect('slap', 'BỐP! TÁT CHO TỈNH', id, { targetId: victim?.id }); this.log(`${player.name} tát ${victim?.name ?? 'đồng nghiệp'} cho tỉnh ngủ.`, 'drama'); break;
      case 'nem': player.drama += 5; this.reward(player, 5); this.effect('throw', 'TÀI LIỆU BAY KHẮP PHÒNG!', id); this.log(`${player.name} ném cả tập báo cáo về phía sếp.`, 'drama'); break;
      case 'cai': player.drama += 7; this.reward(player, 6); this.effect('argue', 'CÃI NHAU TO!', id, { targetId: victim?.id }); this.log(`${player.name} cãi tay đôi với ${victim?.name ?? 'trưởng phòng'}.`, 'drama'); break;
      case 'ngu': player.energy = Math.min(100, player.energy + 15); this.reward(player, 1); this.effect('sleep', 'Zzz… NGỦ GẬT', id); break;
      case 'nhay': player.relationships += 1; this.reward(player, 4); this.effect('dance', 'NHẢY GIỮA VĂN PHÒNG!', id); break;
      case 'tanghoa': player.relationships += 1; this.reward(player, 6); if (victim) victim.energy = Math.min(100, victim.energy + 5); this.effect('flower', 'TẶNG HOA ĐỒNG NGHIỆP', id, { targetId: victim?.id }); this.log(`${player.name} tặng hoa cho ${victim?.name ?? 'cả phòng'}.`); break;
    }
    return { ok: true, message: `${player.name}: ${rule.label}!` };
  }
  private voteCounts() {
    const votes = Object.values(this.data.votes);
    return { strike: votes.filter(vote => vote === 'strike').length, work: votes.filter(vote => vote === 'work').length };
  }
  tick(now = Date.now()) {
    const delta = Math.max(0, Math.min(now - this.lastTick, 5000));
    this.lastTick = now;
    if (this.data.paused) return;
    this.flushGreetings(now);
    this.shareReminder(now);
    this.autoCheckout(now);
    this.data.elapsed += delta; this.data.regen += delta;
    // Meter cools ~0.6/s, and 4/s after full chaos until it is back under 25; stages re-arm 10 points below each threshold.
    if (this.data.dramaMeter > 0) {
      this.data.dramaMeter = Math.max(0, this.data.dramaMeter - delta / 1000 * (this.data.dramaCooling ? 4 : 0.6));
      if (this.data.dramaMeter < 25) this.data.dramaCooling = false;
      while (this.data.dramaStage > 0 && this.data.dramaMeter < DRAMA_THRESHOLDS[this.data.dramaStage - 1]! - 10) this.data.dramaStage--;
    }
    if (this.data.elapsed >= LIMITS.roundMs) {
      this.data.day++; this.data.elapsed %= LIMITS.roundMs; this.data.bossHp = this.data.bossMaxHp;
      this.data.votes = {}; this.data.unrest = 0; this.data.rescued = false; this.data.combo = 0;
      this.log(`NGÀY ${this.data.day}: HR đã xóa bảng cảnh cáo. Deadline thì chưa.`, 'system');
    }
    const phase = PHASES[Math.min(4, Math.floor(this.data.elapsed / 60000))]!;
    if (phase !== this.data.phase) {
      this.data.phase = phase;
      const scenario = SCENARIOS[(this.data.day - 1) % SCENARIOS.length]!;
      if (phase === 'incident') this.log(scenario.title, 'drama');
      if (phase === 'vote') this.log('BỎ PHIẾU: vote dinhcong hoặc vote lamviec. Không thể mua phiếu.', 'drama');
      if (phase === 'battle') { this.log(this.voteCounts().strike > this.voteCounts().work ? 'ĐÌNH CÔNG THẮNG! Sát thương cả phòng được tăng.' : 'VẪN PHẢI ĐI LÀM! Nhưng sếp vẫn có thể ăn đấm.', 'drama'); this.effect('battle', 'ĐẠI CHIẾN VĂN PHÒNG!'); }
      if (phase === 'results') { this.log(this.data.bossHp === 0 ? scenario.win : scenario.lose, 'drama'); this.active().forEach(player => this.reward(player, 20, 100)); }
    }
    if (this.data.regen >= 5000) {
      const periods = Math.floor(this.data.regen / 5000); this.data.regen %= 5000;
      this.active().forEach(player => { player.energy = Math.min(100, player.energy + 4 * periods); this.reward(player, periods, 5 * periods); });
      if (phase === 'battle' && this.voteCounts().strike > this.voteCounts().work) this.damage(Math.min(50, this.active().length) * 15);
    }
  }
  control(command: AdminCommand, now = Date.now()): ActionResult {
    if (command === 'pause') this.data.paused = true;
    if (command === 'resume') { this.data.paused = false; this.lastTick = now; }
    if (command === 'drama') {
      this.data.elapsed = 120000; this.data.phase = 'incident'; this.data.votes = {};
      this.tick(now); this.log('Sếp vừa ra thông báo. Cả phòng có 60 giây bỏ phiếu!', 'drama');
    }
    if (command === 'reset') {
      // a reset wipes the session (players, XP, greetings) but keeps the operator's settings
      const settings = this.data.settings;
      const fresh = new GameEngine(this.data.roomId, undefined, now);
      this.data = { ...fresh.data, settings }; this.seen = new Map(); this.greeted = new Set(); this.thanked = new Set(); this.lastTick = now;
    }
    if (command === 'seed') {
      const names = ['Mèo Mun', 'Deadline dí', 'Chị Kế Toán', 'Dev hết pin', 'HR biết hết', 'Sếp nhỏ', 'Cá Mắm', 'Bé chạy KPI', 'Anh IT', 'Cà phê sữa'];
      // demo staff walk straight in, as if they had joined the LIVE
      names.forEach((name, index) => { const id = `simulator:demo-${index}`; if (this.enterOffice(id, name, now, false).ok) this.queueGreeting(id, safeName(name)); });
    }
    return { ok: true, message: 'Đã cập nhật công ty.' };
  }
  view(live: LiveStatus, storage: 'memory' | 'postgres' = 'memory', now = Date.now()): GameState {
    const active = this.active().sort((left, right) => right.lastActiveAt - left.lastActiveAt || left.id.localeCompare(right.id));
    return structuredClone({
      roomId: this.data.roomId, sessionId: this.data.sessionId, day: this.data.day, phase: this.data.phase,
      remaining: Math.ceil((60000 - this.data.elapsed % 60000) / 1000), paused: this.data.paused,
      bossHp: this.data.bossHp, bossMaxHp: this.data.bossMaxHp, employeeCount: active.length,
      dramaMeter: Math.round(this.data.dramaMeter), dramaStage: this.data.dramaStage,
      likes: this.data.likes, combo: this.data.combo, scenario: SCENARIOS[(this.data.day - 1) % SCENARIOS.length]!,
      votes: this.voteCounts(), players: active.slice(0, LIMITS.visible),
      leaderboard: active.slice().sort((left, right) => right.drama - left.drama || right.xp - left.xp).slice(0, 5),
      feed: this.data.feed, effects: this.data.effects, live, storage, serverTime: now,
      settings: this.data.settings, speech: this.data.speech,
    });
  }
}
