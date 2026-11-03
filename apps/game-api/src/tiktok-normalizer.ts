import { randomUUID } from 'node:crypto';
import { LIMITS, safeName } from '@di-lam/shared';
import type { GameInputEvent } from '@di-lam/shared';
export interface RawTikTok {
  common?: { msgId?: string | number | bigint }; msgId?: string | number | bigint;
  user?: { id?: string | number | bigint; userId?: string | number | bigint; displayId?: string; uniqueId?: string; nickname?: string };
  userId?: string | number | bigint; uniqueId?: string; nickname?: string;
  content?: string; comment?: string; giftId?: string | number | bigint;
  groupId?: string | number | bigint; repeatId?: string | number | bigint;
  repeatCount?: number; repeatEnd?: number | boolean; likeCount?: number;
  gift?: { type?: number }; giftType?: number; giftDetails?: { giftType?: number };
}
export class TikTokNormalizer {
  private messages = new Map<string, number>();
  private streaks = new Map<string, { total: number; closed: boolean; time: number }>();
  constructor(private readonly roomId: string) {}
  normalize(type: GameInputEvent['type'], raw: RawTikTok, now = Date.now()): GameInputEvent | null {
    for (const map of [this.messages, this.streaks]) {
      for (const [key, value] of map) {
        const time = typeof value === 'number' ? value : value.time;
        if (now - time < LIMITS.dedupeTtl) break;
        map.delete(key);
      }
      while (map.size >= LIMITS.dedupe) map.delete(map.keys().next().value!);
    }
    const userId = raw.user?.id ?? raw.user?.userId ?? raw.userId;
    if (userId === undefined || String(userId) === '') return null;
    const messageId = String(raw.common?.msgId ?? raw.msgId ?? '');
    const key = `${type}:${messageId}`;
    if (messageId && this.messages.has(key)) return null;
    if (messageId) this.messages.set(key, now);
    let count = Math.max(1, Math.min(10000, Math.floor(Number(type === 'like' ? raw.likeCount : raw.repeatCount) || 1)));
    if (type === 'gift' && (raw.gift?.type ?? raw.giftDetails?.giftType ?? raw.giftType) === 1) {
      const group = raw.groupId ?? raw.repeatId;
      const streakKey = `${userId}:${raw.giftId ?? 0}:${group ?? 'fallback'}`;
      const previous = this.streaks.get(streakKey);
      const ended = raw.repeatEnd === true || raw.repeatEnd === 1;
      const newFallbackStreak = group === undefined && previous?.closed && !ended && count === 1;
      const delta = count - (newFallbackStreak ? 0 : previous?.total ?? 0);
      this.streaks.delete(streakKey);
      this.streaks.set(streakKey, { total: count, closed: ended, time: now });
      if (delta <= 0) return null;
      count = delta;
    }
    return {
      eventId: messageId ? `${type}:${messageId}` : `${type}:${randomUUID()}`, roomId: this.roomId, source: 'tiktok', type,
      user: { platformUserId: String(userId), displayName: safeName(raw.user?.nickname ?? raw.nickname ?? raw.user?.displayId ?? 'Đồng nghiệp') },
      payload: type === 'comment' ? { text: (raw.content ?? raw.comment ?? '').slice(0, 300) } : type === 'gift' ? { count, giftId: String(raw.giftId ?? '0') } : { count },
      timestamp: now,
    };
  }
}
