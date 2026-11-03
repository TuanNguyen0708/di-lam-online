import { Injectable, Logger } from '@nestjs/common';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import type { RoomSettings } from '@di-lam/shared';

/** Edge neural Vietnamese voices (same engine as the sibling di-chua-online project). */
export const TTS_VOICES: Record<RoomSettings['voiceGender'], string> = { female: 'vi-VN-HoaiMyNeural', male: 'vi-VN-NamMinhNeural' };
const TTS_TIMEOUT_MS = 20000;
const CACHE_SIZE = 100;

/** The text goes inside SSML, so names with & < > must be escaped. */
export const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Splits at sentence / comma / space boundaries into pieces of at most `max` characters (Google TTS limit). */
export function splitTtsText(text: string, max = 190): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
    if (cut < max / 2) cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '));
    if (cut < max / 2) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = max - 1;
    chunks.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * Text-to-speech for the stage voice: Microsoft Edge neural voice, Google Translate TTS as fallback.
 * Both are online services — the spoken text (including viewer names) is sent to them.
 * Results are cached and concurrent requests for the same line share one synthesis.
 */
@Injectable()
export class TtsService {
  private readonly logger = new Logger('TTS');
  private cache = new Map<string, Buffer>();
  private inflight = new Map<string, Promise<Buffer>>();

  synthesize(text: string, gender: RoomSettings['voiceGender'], rate: number): Promise<Buffer> {
    const key = `${gender}|${rate}|${text}`;
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const running = this.inflight.get(key);
    if (running) return running;
    const job = this.edge(text, TTS_VOICES[gender], rate)
      .catch(error => { this.logger.warn(`Edge TTS failed, falling back to Google: ${error instanceof Error ? error.message : String(error)}`); return this.google(text); })
      .then(audio => {
        this.cache.set(key, audio);
        if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
        return audio;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  private async edge(text: string, voice: string, rate: number): Promise<Buffer> {
    const tts = new MsEdgeTTS();
    let timer: NodeJS.Timeout | undefined;
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(escapeXml(text), { rate: `${Math.round((rate - 1) * 100)}%` });
      const chunks: Buffer[] = [];
      const read = (async () => { for await (const chunk of audioStream) chunks.push(chunk as Buffer); })();
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Edge TTS timeout')), TTS_TIMEOUT_MS); });
      await Promise.race([read, timeout]);
      if (!chunks.length) throw new Error('Edge TTS returned no audio');
      return Buffer.concat(chunks);
    } finally { clearTimeout(timer); tts.close(); }
  }

  /** Google Translate TTS caps each request near 200 chars: fetch in chunks and join the MP3s. */
  private async google(text: string): Promise<Buffer> {
    const parts: Buffer[] = [];
    for (const chunk of splitTtsText(text)) {
      const response = await fetch(`https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=${encodeURIComponent(chunk)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', Referer: 'https://translate.google.com/' },
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Google TTS error ${response.status}`);
      parts.push(Buffer.from(await response.arrayBuffer()));
    }
    return Buffer.concat(parts);
  }
}
