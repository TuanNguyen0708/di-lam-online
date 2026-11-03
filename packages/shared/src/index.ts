export const COMMANDS = {
  'damsep': { label: 'Đấm sếp', energy: 12, cooldown: 5000 },
  'dapban': { label: 'Đập bàn', energy: 8, cooldown: 3000 },
  'tangluong': { label: 'Xin tăng lương', energy: 15, cooldown: 30000 },
  'nghiviec': { label: 'Nộp đơn nghỉ', energy: 0, cooldown: 0 },
  'bocphot': { label: 'Bóc phốt sếp', energy: 10, cooldown: 12000 },
  'vote': { label: 'Vote đình công / làm tiếp', energy: 0, cooldown: 0 },
  'cafe': { label: 'Pha cà phê', energy: 0, cooldown: 15000 },
  'lamviec': { label: 'Chạy deadline', energy: 5, cooldown: 5000 },
  'cuu': { label: 'Cứu đồng nghiệp', energy: 8, cooldown: 10000 },
  'tat': { label: 'Tát đồng nghiệp', energy: 6, cooldown: 6000 },
  'nem': { label: 'Ném tài liệu', energy: 6, cooldown: 6000 },
  'cai': { label: 'Cãi nhau', energy: 5, cooldown: 8000 },
  'ngu': { label: 'Ngủ gật', energy: 0, cooldown: 20000 },
  'nhay': { label: 'Khiêu vũ', energy: 4, cooldown: 10000 },
  'tanghoa': { label: 'Tặng hoa', energy: 5, cooldown: 10000 },
} as const;
/** Drama Meter points each command adds (negative calms the office). */
export const DRAMA_POINTS: Partial<Record<Command, number>> = { 'damsep': 6, 'dapban': 4, 'bocphot': 8, 'tat': 6, 'nem': 5, 'cai': 7, 'ngu': 2, 'nhay': -6, 'tanghoa': -8, 'tangluong': 2 };
export const DRAMA_THRESHOLDS = [25, 50, 75, 100] as const;
export const DRAMA_LABELS = ['Văn phòng yên bình', 'Nhân viên bắt đầu hóng chuyện', 'Trưởng phòng can thiệp', 'Giám đốc nổi giận', 'VĂN PHÒNG HỖN LOẠN!'] as const;
export type Command = keyof typeof COMMANDS;
export const ROLES = ['Thực tập sinh', 'Nhân viên', 'Trưởng nhóm', 'Trưởng phòng', 'Giám đốc', 'CEO'] as const;
export const ROLE_XP = [0, 100, 350, 800, 1600, 3000] as const;
export const PHASES = ['work', 'incident', 'vote', 'battle', 'results'] as const;
export type Phase = typeof PHASES[number];
export const PHASE_LABELS: Record<Phase, string> = { work: 'Giờ làm việc', incident: 'Sếp gây chuyện', vote: 'Cả phòng quyết định', battle: 'Đại chiến văn phòng', results: 'Chốt sổ cuối ngày' };
export const SCENARIOS = [
  { title: 'SẾP CẮT THƯỞNG TẾT!', detail: 'Lý do: công ty cần tiền mua ghế massage cho sếp.', win: 'Cả phòng giành lại thưởng Tết!', lose: 'Thưởng Tết biến thành một lời cảm ơn.' },
  { title: 'DEADLINE LÚC 17:59', detail: 'Sếp: “Cái này đơn giản, trước khi về làm nốt nhé.”', win: 'Deadline được dời. Máy tính được tắt!', lose: 'Cả phòng nhận thêm một chiếc deadline.' },
  { title: 'HỌP KHẨN KHÔNG CÓ AGENDA', detail: 'Cuộc họp để thống nhất lịch cho cuộc họp tiếp theo.', win: 'Cuộc họp được thay bằng email!', lose: 'Sếp vừa đặt thêm một cuộc họp lúc 7 giờ sáng.' },
  { title: 'AI LẤY HỘP CƠM TRONG TỦ?', detail: 'HR mở điều tra. Sếp vẫn đang nhai.', win: 'Sếp bao cả phòng một bữa trưa!', lose: 'Hộp cơm vẫn mất. HR yêu cầu làm bản tường trình.' },
] as const;
/** `member` = a viewer entered the TikTok LIVE room (no comment yet). */
export interface GameInputEvent {
  eventId: string; roomId: string; source: 'tiktok' | 'simulator'; type: 'comment' | 'like' | 'follow' | 'gift' | 'member';
  user: { platformUserId: string; displayName: string };
  payload: { text?: string; count?: number; giftId?: string }; timestamp: number;
}
export interface Player {
  id: string; name: string; xp: number; salary: number; drama: number; relationships: number;
  energy: number; role: number; active: boolean; joinedAt: number; lastActiveAt: number;
  cooldowns: Partial<Record<Command, number>>;
  /** Came in by joining the LIVE and has not typed a command since (leaves the office after a long idle). */
  auto?: boolean;
}
/** Operator settings for the room (dashboard → server → every stage page). */
export interface RoomSettings {
  /** Shown on the stage header and used in spoken lines. */
  companyName: string;
  /** Ambient NPC coworkers (the boss and the manager always stay: gameplay needs them). */
  npcs: boolean;
  /** The stage page reads lines aloud (server-side Edge TTS). */
  voice: boolean;
  voiceGender: 'female' | 'male';
  /** Speech speed, 0.6–1.4 (1 = normal). */
  voiceRate: number;
  /** Greet each newcomer once per session. */
  greetJoiners: boolean;
  /** Greeting sentence; `{names}` is required, `{company}` optional. */
  greetTemplate: string;
  thankGifts: boolean;
  thankFollows: boolean;
  /** Minutes between "please share the live" reminders; 0 = off. */
  shareReminderMinutes: number;
}
export const DEFAULT_SETTINGS: RoomSettings = {
  companyName: 'Công Ty Bất Ổn', npcs: true,
  voice: true, voiceGender: 'female', voiceRate: 1,
  greetJoiners: true, greetTemplate: 'Xin chào nhân viên {names}, chào mừng đến {company}!',
  thankGifts: true, thankFollows: true, shareReminderMinutes: 10,
};
export const SETTINGS_LIMITS = { companyName: 40, greetTemplate: 160, speech: 300, voiceRate: [0.6, 1.4], shareReminderMinutes: [0, 60] } as const;
/** One sentence for the stage voice. Priority lines (gift thanks, "Đọc ngay") jump the queue. */
export interface SpeechLine { id: number; text: string; priority: boolean }
type SettingsResult = { ok: true; settings: RoomSettings } | { ok: false; message: string };
const SETTING_TOGGLES = ['npcs', 'voice', 'greetJoiners', 'thankGifts', 'thankFollows'] as const;
/**
 * Settings restored from an older snapshot: keys this version no longer knows are dropped and invalid values fall
 * back to the defaults, so a saved room always loads.
 */
export function restoreSettings(saved: unknown): RoomSettings {
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_SETTINGS };
  const known = Object.fromEntries(Object.entries(saved).filter(([key]) => Object.hasOwn(DEFAULT_SETTINGS, key)));
  const merged = mergeSettings(DEFAULT_SETTINGS, known);
  return merged.ok ? merged.settings : { ...DEFAULT_SETTINGS };
}
/** Strips control/format characters, angle brackets and links, and collapses whitespace (operator and viewer text). */
export function cleanText(value: string) {
  return value.replace(/[\p{Cc}\p{Cf}<>]/gu, ' ').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
}
/** Validates an admin settings patch against `base`. Unknown keys and out-of-range values are rejected whole. */
export function mergeSettings(base: RoomSettings, patch: unknown): SettingsResult {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, message: 'Cài đặt không hợp lệ.' };
  const next: RoomSettings = { ...base };
  const invalid = (key: string): SettingsResult => ({ ok: false, message: `Giá trị không hợp lệ cho "${key.slice(0, 40)}".` });
  for (const [key, value] of Object.entries(patch)) {
    if ((SETTING_TOGGLES as readonly string[]).includes(key)) {
      if (typeof value !== 'boolean') return invalid(key);
      next[key as typeof SETTING_TOGGLES[number]] = value;
      continue;
    }
    switch (key) {
      case 'companyName': {
        if (typeof value !== 'string') return invalid(key);
        const name = cleanText(value).slice(0, SETTINGS_LIMITS.companyName);
        if (!name) return { ok: false, message: 'Tên công ty không được để trống.' };
        next.companyName = name; break;
      }
      case 'greetTemplate': {
        if (typeof value !== 'string') return invalid(key);
        const template = cleanText(value).slice(0, SETTINGS_LIMITS.greetTemplate);
        if (!template.includes('{names}')) return { ok: false, message: 'Mẫu câu chào phải chứa {names}.' };
        next.greetTemplate = template; break;
      }
      case 'voiceGender':
        if (value !== 'female' && value !== 'male') return invalid(key);
        next.voiceGender = value; break;
      case 'voiceRate': {
        const [low, high] = SETTINGS_LIMITS.voiceRate;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) return invalid(key);
        next.voiceRate = Math.round(value * 100) / 100; break;
      }
      case 'shareReminderMinutes': {
        const [low, high] = SETTINGS_LIMITS.shareReminderMinutes;
        if (!Number.isInteger(value) || (value as number) < low || (value as number) > high) return invalid(key);
        next.shareReminderMinutes = value as number; break;
      }
      default: return { ok: false, message: `Cài đặt không được hỗ trợ: "${key.slice(0, 40)}".` };
    }
  }
  return { ok: true, settings: next };
}
/** Vietnamese list: "A", "A và B", "A, B và C". */
export function joinNames(names: readonly string[]) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} và ${names.at(-1)}`;
}
export interface Effect { id: number; type: string; playerId?: string; targetId?: string; tier?: number; text: string }
export interface FeedItem { id: number; text: string; kind: 'system' | 'drama' | 'action' | 'gift' }
export interface LiveStatus { status: 'offline' | 'connecting' | 'connected' | 'error'; username: string; roomId: string; error: string }
export interface GameState {
  roomId: string; sessionId: string; day: number; phase: Phase; remaining: number; paused: boolean;
  bossHp: number; bossMaxHp: number; employeeCount: number; likes: number; combo: number;
  /** 0–100 office chaos level; dramaStage is the highest threshold index reached (0–4). */
  dramaMeter: number; dramaStage: number;
  scenario: { title: string; detail: string }; votes: { strike: number; work: number };
  players: Player[]; leaderboard: Player[]; feed: FeedItem[]; effects: Effect[];
  live: LiveStatus; storage: 'memory' | 'postgres'; serverTime: number;
  settings: RoomSettings;
  /** Newest spoken lines (ids grow); stage pages play the ones they have not played yet. */
  speech: SpeechLine[];
}
export type ActionResult = { ok: boolean; message: string; duplicate?: boolean };
export type AdminCommand = 'pause' | 'resume' | 'drama' | 'reset' | 'seed';
export const LIMITS = { visible: 50, players: 2000, effects: 15, feed: 12, dedupe: 20000, dedupeTtl: 600000, roundMs: 300000 } as const;
/** Voice and auto check-in pacing (server side). */
export const AUTOMATION = {
  /** Spoken lines kept in the snapshot. */
  speech: 12,
  /** Names per greeting sentence, and minimum ms between greeting sentences. */
  greetBatch: 3, greetIntervalMs: 4000,
  /** Newcomers waiting to be greeted; in a flood only the newest stay. */
  greetQueue: 30,
  /** Ids remembered as already greeted / thanked this session. */
  remembered: 5000,
  /** One gift thank-you per viewer per window. */
  giftThanksMs: 30000,
  /** Viewers who came in by joining the LIVE and never type a command leave the office after this long. */
  autoCheckoutMs: 15 * 60000,
  /** Names thanked by the share reminder. */
  recentNames: 3,
} as const;
/**
 * Parses a chat comment into a command. Commands are written without a prefix (`cafe`, `vote dinhcong`);
 * the legacy `!cafe` form is still accepted so viewers used to the old syntax are not ignored.
 */
export function parseCommand(text: string): { command: Command; argument: string } | null {
  const [rawHead = '', ...tail] = text.trim().toLowerCase().split(/\s+/);
  const head = rawHead.startsWith('!') ? rawHead.slice(1) : rawHead;
  return Object.hasOwn(COMMANDS, head) ? { command: head as Command, argument: tail.join(' ') } : null;
}
export function safeName(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}<>]/gu, '').replace(/https?:\/\/\S+/gi, '').trim().slice(0, 24) || 'Đồng nghiệp';
}
export function validInput(value: unknown): value is GameInputEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as GameInputEvent;
  return typeof event.eventId === 'string' && event.eventId.length > 0 && event.eventId.length <= 180
    && typeof event.roomId === 'string' && event.roomId.length <= 100
    && ['tiktok', 'simulator'].includes(event.source) && ['comment', 'like', 'follow', 'gift', 'member'].includes(event.type)
    && !!event.user && typeof event.user.platformUserId === 'string' && event.user.platformUserId.length > 0 && event.user.platformUserId.length <= 100
    && typeof event.user.displayName === 'string' && event.user.displayName.length <= 100
    && !!event.payload && typeof event.payload === 'object'
    && (event.payload.text === undefined || (typeof event.payload.text === 'string' && event.payload.text.length <= 300))
    && (event.payload.count === undefined || (Number.isSafeInteger(event.payload.count) && event.payload.count >= 1 && event.payload.count <= 10000))
    && (event.payload.giftId === undefined || (typeof event.payload.giftId === 'string' && event.payload.giftId.length <= 100))
    && Number.isSafeInteger(event.timestamp) && event.timestamp > 0;
}
