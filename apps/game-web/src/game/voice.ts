import { useEffect, useRef, useState } from 'react';
import type { GameState, SpeechLine } from '@di-lam/shared';

/** Lines waiting to be read; older normal lines are dropped first when the voice falls behind. */
export const VOICE_QUEUE = 6;
/** Pause between two lines (ms). */
const GAP_MS = 250;

/**
 * Plays the server's spoken lines (`/api/tts/:id`) one at a time, priority lines first.
 * Runs only on the stage page (the OBS / LIVE Studio source), so a dashboard tab never doubles the voice.
 * One reused <audio> element; lines already in the snapshot when the page loads are not replayed.
 */
export class VoicePlayer {
  private audio = new Audio();
  private queue: SpeechLine[] = [];
  private session = '';
  private lastId = 0;
  private busy = false;
  private timer: number | undefined;
  enabled = false;
  /** Called with true when the browser blocks autoplay (needs one click), false once audio plays. */
  onBlocked: (blocked: boolean) => void = () => {};

  constructor() {
    this.audio.preload = 'auto';
    this.audio.onended = () => this.done();
    this.audio.onerror = () => this.done();
  }
  /** Feed every snapshot; only lines newer than the last seen id are queued. */
  sync(sessionId: string, lines: readonly SpeechLine[]) {
    if (sessionId !== this.session) { this.session = sessionId; this.lastId = lines.at(-1)?.id ?? 0; this.queue = []; return; }
    const fresh = lines.filter(line => line.id > this.lastId);
    if (!fresh.length) return;
    this.lastId = fresh.at(-1)!.id;
    if (!this.enabled) return;
    this.queue = queueLines(this.queue, fresh);
    this.next();
  }
  /** User gesture: retry after the browser blocked autoplay. */
  unlock() { this.onBlocked(false); this.next(); }
  private next() {
    if (this.busy || !this.enabled) return;
    const line = this.queue.shift();
    if (!line) return;
    this.busy = true;
    this.audio.src = `/api/tts/${line.id}`;
    this.audio.play().then(() => this.onBlocked(false)).catch((error: unknown) => {
      this.busy = false;
      if (error instanceof DOMException && error.name === 'NotAllowedError') { this.queue.unshift(line); this.onBlocked(true); return; }
      this.done();
    });
  }
  private done() {
    this.busy = false;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.next(), GAP_MS);
  }
  dispose() { window.clearTimeout(this.timer); this.queue = []; this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); }
}

/** Priority lines go ahead of normal ones (order kept within each group); the queue is capped, dropping old normal lines. */
export function queueLines(queue: readonly SpeechLine[], fresh: readonly SpeechLine[], cap = VOICE_QUEUE): SpeechLine[] {
  const all = [...queue, ...fresh];
  const ordered = [...all.filter(line => line.priority), ...all.filter(line => !line.priority)];
  while (ordered.length > cap) {
    const lastNormal = ordered.findIndex(line => !line.priority);
    ordered.splice(lastNormal >= 0 ? lastNormal : 0, 1);
  }
  return ordered;
}

/**
 * Stage-page voice. `active` = this page is the live stage (`?view=stage`) and not muted with `&voice=0`;
 * the room setting `voice` can still turn it off for everyone.
 */
export function useVoice(state: GameState | null, active: boolean) {
  const player = useRef<VoicePlayer | null>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!active) return;
    const voice = new VoicePlayer();
    voice.onBlocked = setBlocked;
    player.current = voice;
    return () => { voice.dispose(); player.current = null; };
  }, [active]);
  useEffect(() => {
    const voice = player.current;
    if (!voice || !state) return;
    voice.enabled = state.settings?.voice ?? false;
    voice.sync(state.sessionId, state.speech ?? []);
  }, [state]);
  return { blocked, unlock: () => player.current?.unlock() };
}
