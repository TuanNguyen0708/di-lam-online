/**
 * Procedural Web Audio: every sound effect and the background loop is synthesized at runtime
 * (oscillators + filtered noise), so there are no third-party audio files or licences involved.
 * Volume falls off with distance from the camera focus and pans left/right by world X.
 */
export type SoundName = 'step' | 'key' | 'punch' | 'slap' | 'slam' | 'whoosh' | 'chair' | 'coffee' | 'pour' | 'phone' | 'printer' | 'ding' | 'beep'
  | 'cheer' | 'gasp' | 'grumble' | 'snore' | 'alarm' | 'pop' | 'cash' | 'clap' | 'thud' | 'paper' | 'yawn' | 'ahh' | 'shout' | 'ouch' | 'stomp' | 'sip' | 'whistle' | 'chat' | 'boo' | 'laugh';

const MIN_INTERVAL: Partial<Record<SoundName, number>> = { step: 0.07, key: 0.045, clap: 0.05, chat: 0.12, paper: 0.08, snore: 1.2, pop: 0.05 };

export class AudioEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private sfxBus?: GainNode;
  private musicBus?: GainNode;
  private noise?: AudioBuffer;
  private lastPlayed = new Map<SoundName, number>();
  private voices = 0;
  private musicTimer?: number;
  private nextBeat = 0;
  private beat = 0;
  enabled = false;
  mood: 'calm' | 'drama' = 'calm';
  listener = { x: 0, z: 0 };

  /** Must be called from a user gesture in normal browsers (OBS browser sources usually allow autoplay — not verified here). */
  async enable() {
    if (!this.context) {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return false;
      this.context = new Context();
      this.master = this.context.createGain(); this.master.gain.value = 0.8;
      const compressor = this.context.createDynamicsCompressor(); compressor.threshold.value = -16; compressor.ratio.value = 4;
      this.master.connect(compressor).connect(this.context.destination);
      this.sfxBus = this.context.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
      this.musicBus = this.context.createGain(); this.musicBus.gain.value = 0.32; this.musicBus.connect(this.master);
      this.noise = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
      const data = this.noise.getChannelData(0); for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
    }
    try { await this.context.resume(); } catch { return false; }
    this.enabled = this.context.state === 'running';
    if (this.enabled && !this.musicTimer) { this.nextBeat = this.context.currentTime + 0.1; this.musicTimer = window.setInterval(() => this.scheduleMusic(), 100); }
    return this.enabled;
  }
  disable() {
    this.enabled = false;
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = undefined; }
    void this.context?.suspend();
  }
  dispose() { this.disable(); void this.context?.close(); this.context = undefined; }

  play(name: SoundName, at?: { x: number; z: number }, volume = 1) {
    const context = this.context;
    if (!this.enabled || !context || !this.sfxBus || this.voices > 28) return;
    const now = context.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -1) < (MIN_INTERVAL[name] ?? 0.02)) return;
    this.lastPlayed.set(name, now);
    let gain = volume, pan = 0;
    if (at) {
      gain *= Math.max(0.22, 1 - Math.hypot(at.x - this.listener.x, at.z - this.listener.z) / 1000);
      pan = Math.max(-0.7, Math.min(0.7, at.x / 300));
    }
    const out = context.createGain(); out.gain.value = gain;
    const panner = context.createStereoPanner(); panner.pan.value = pan;
    out.connect(panner).connect(this.sfxBus);
    this.voices++;
    window.setTimeout(() => { this.voices--; out.disconnect(); panner.disconnect(); }, 3500);
    const r = () => 0.92 + Math.random() * 0.16;
    switch (name) {
      case 'step': this.noiseHit(out, now, 0.05, 'bandpass', 900 * r(), 1.2, 0.25); break;
      case 'key': this.noiseHit(out, now, 0.025, 'highpass', 3500 * r(), 0.8, 0.18); this.tone(out, now, 1800 * r(), 0.015, 'square', 0.02); break;
      case 'punch': this.tone(out, now, 160, 0.22, 'sine', 0.9, 45); this.noiseHit(out, now, 0.12, 'lowpass', 1400, 0.7, 0.8); this.tone(out, now + 0.01, 90, 0.18, 'triangle', 0.5, 40); break;
      case 'slap': this.noiseHit(out, now, 0.09, 'highpass', 1800, 0.6, 1.0); this.noiseHit(out, now + 0.005, 0.05, 'bandpass', 3200, 2, 0.6); break;
      case 'slam': this.tone(out, now, 110, 0.3, 'sine', 1, 50); this.noiseHit(out, now, 0.18, 'lowpass', 900, 0.8, 0.9); for (let index = 1; index < 5; index++) this.noiseHit(out, now + index * 0.06, 0.04, 'bandpass', 2600 * r(), 6, 0.25 / index); break;
      case 'thud': this.tone(out, now, 90, 0.35, 'sine', 1, 35); this.noiseHit(out, now, 0.2, 'lowpass', 500, 0.7, 0.7); break;
      case 'stomp': this.tone(out, now, 70, 0.15, 'sine', 0.6, 40); break;
      case 'whoosh': this.noiseSweep(out, now, 0.25, 400, 3000, 0.45); break;
      case 'chair': this.tone(out, now, 520 * r(), 0.22, 'sawtooth', 0.05, 380); this.noiseHit(out, now, 0.18, 'bandpass', 700, 3, 0.2); break;
      case 'coffee': for (let index = 0; index < 10; index++) this.noiseHit(out, now + index * 0.12, 0.1, 'bandpass', 300 + Math.random() * 300, 2, 0.35); this.tone(out, now, 120, 1.3, 'sawtooth', 0.04); break;
      case 'pour': this.noiseSweep(out, now, 1.6, 1500, 700, 0.18, 'bandpass'); break;
      case 'sip': this.noiseHit(out, now, 0.18, 'bandpass', 1200, 4, 0.3); break;
      case 'ahh': this.voice(out, now, 260, 0.45, -0.4); break;
      case 'phone': for (let ring = 0; ring < 2; ring++) for (let index = 0; index < 8; index++) { const t = now + ring * 0.55 + index * 0.05; this.tone(out, t, 1320, 0.045, 'sine', 0.18); this.tone(out, t, 1650, 0.045, 'sine', 0.12); } break;
      case 'printer': for (let index = 0; index < 12; index++) this.noiseHit(out, now + index * 0.09, 0.06, 'bandpass', 1500 + (index % 2) * 500, 3, 0.18); break;
      case 'ding': this.tone(out, now, 1046, 0.9, 'sine', 0.35); this.tone(out, now + 0.25, 784, 1.1, 'sine', 0.3); break;
      case 'beep': this.tone(out, now, 1760, 0.12, 'square', 0.12); this.tone(out, now + 0.15, 2093, 0.12, 'square', 0.12); break;
      case 'cheer': for (let index = 0; index < 6; index++) this.voice(out, now + index * 0.05, 300 + Math.random() * 250, 0.6, 0.5); this.noiseSweep(out, now, 1.0, 1800, 2500, 0.12, 'bandpass'); break;
      case 'laugh': for (let index = 0; index < 5; index++) this.voice(out, now + index * 0.13, 340 - index * 10, 0.1, 0.1); break;
      case 'gasp': this.voice(out, now, 420 * r(), 0.18, 0.6); this.noiseHit(out, now, 0.15, 'bandpass', 2400, 1, 0.2); break;
      case 'ouch': this.voice(out, now, 380 * r(), 0.25, -0.8); break;
      case 'grumble': for (let index = 0; index < 4; index++) this.voice(out, now + index * 0.09, 120 + Math.random() * 30, 0.08, -0.1, 'sawtooth'); break;
      case 'shout': for (let index = 0; index < 3; index++) this.voice(out, now + index * 0.1, 210 * r(), 0.09, 0.2, 'sawtooth'); break;
      case 'chat': for (let index = 0; index < 4; index++) this.voice(out, now + index * 0.07, 300 + Math.random() * 180, 0.055, 0.1); break;
      case 'boo': this.voice(out, now, 180, 0.5, -0.5, 'sawtooth'); break;
      case 'yawn': this.voice(out, now, 330, 0.9, -0.6); break;
      case 'snore': this.noiseSweep(out, now, 0.9, 200, 500, 0.22, 'lowpass'); this.tone(out, now, 70, 0.9, 'sawtooth', 0.05, 60); break;
      case 'alarm': for (let index = 0; index < 6; index++) this.tone(out, now + index * 0.32, index % 2 ? 660 : 880, 0.3, 'square', 0.12); break;
      case 'pop': this.tone(out, now, 600 * r(), 0.08, 'sine', 0.3, 1200); this.noiseHit(out, now, 0.04, 'highpass', 3000, 1, 0.3); break;
      case 'cash': this.tone(out, now, 1568, 0.12, 'square', 0.12); this.tone(out, now + 0.08, 2093, 0.35, 'square', 0.12); this.noiseHit(out, now + 0.08, 0.3, 'highpass', 6000, 1, 0.2); break;
      case 'clap': this.noiseHit(out, now, 0.05, 'bandpass', 1400 * r(), 1.5, 0.5); break;
      case 'paper': this.noiseSweep(out, now, 0.3, 2500, 5000, 0.2, 'highpass'); break;
      case 'whistle': this.tone(out, now, 2600, 0.5, 'sine', 0.25, 2900); this.tone(out, now, 2620, 0.5, 'sine', 0.15); break;
    }
  }

  private tone(out: AudioNode, at: number, frequency: number, duration: number, type: OscillatorType, volume: number, glideTo?: number) {
    const context = this.context!;
    const oscillator = context.createOscillator(); oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, at);
    if (glideTo) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), at + duration);
    const envelope = context.createGain(); envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(volume, at + Math.min(0.012, duration / 4));
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(envelope).connect(out); oscillator.start(at); oscillator.stop(at + duration + 0.02);
  }
  private noiseHit(out: AudioNode, at: number, duration: number, type: BiquadFilterType, frequency: number, q: number, volume: number) {
    const context = this.context!;
    const source = context.createBufferSource(); source.buffer = this.noise!; source.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = context.createBiquadFilter(); filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
    const envelope = context.createGain(); envelope.gain.setValueAtTime(volume, at); envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter).connect(envelope).connect(out); source.start(at, Math.random() * 0.5); source.stop(at + duration + 0.02);
  }
  private noiseSweep(out: AudioNode, at: number, duration: number, from: number, to: number, volume: number, type: BiquadFilterType = 'bandpass') {
    const context = this.context!;
    const source = context.createBufferSource(); source.buffer = this.noise!; source.loop = true;
    const filter = context.createBiquadFilter(); filter.type = type; filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(from, at); filter.frequency.exponentialRampToValueAtTime(to, at + duration);
    const envelope = context.createGain(); envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(volume, at + duration * 0.3); envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter).connect(envelope).connect(out); source.start(at); source.stop(at + duration + 0.05);
  }
  /** Gibberish "voice": formant-filtered oscillator with a pitch contour (bend > 0 rises, < 0 falls). */
  private voice(out: AudioNode, at: number, pitch: number, duration: number, bend: number, type: OscillatorType = 'triangle') {
    const context = this.context!;
    const oscillator = context.createOscillator(); oscillator.type = type;
    oscillator.frequency.setValueAtTime(pitch, at); oscillator.frequency.exponentialRampToValueAtTime(Math.max(60, pitch * (1 + bend)), at + duration);
    const formant = context.createBiquadFilter(); formant.type = 'bandpass'; formant.frequency.value = 900 + Math.random() * 900; formant.Q.value = 3;
    const envelope = context.createGain(); envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(0.5, at + 0.02); envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(formant).connect(envelope).connect(out); oscillator.start(at); oscillator.stop(at + duration + 0.05);
  }

  /** Light office lounge loop (Fmaj7 – Dm7 – Gm7 – C7); "drama" mood speeds up, turns minor and adds toms. */
  private scheduleMusic() {
    const context = this.context;
    if (!context || !this.musicBus || !this.enabled) return;
    const secondsPerBeat = 60 / (this.mood === 'drama' ? 118 : 96);
    const calm = [[174.61, 220, 261.63, 329.63], [146.83, 174.61, 220, 261.63], [196, 233.08, 293.66, 349.23], [130.81, 164.81, 196, 233.08]];
    const drama = [[146.83, 174.61, 220, 293.66], [116.54, 146.83, 174.61, 233.08], [130.81, 164.81, 196, 261.63], [110, 138.59, 164.81, 220]];
    while (this.nextBeat < context.currentTime + 0.35) {
      const t = this.nextBeat, beatInBar = this.beat % 4, bar = Math.floor(this.beat / 4) % 4;
      const chord = (this.mood === 'drama' ? drama : calm)[bar]!;
      if (beatInBar === 0) chord.slice(1).forEach(frequency => this.pad(t, frequency, secondsPerBeat * 1.8, 0.05));
      if (beatInBar === 2) chord.slice(1).forEach(frequency => this.pad(t + secondsPerBeat * 0.5, frequency, secondsPerBeat, 0.035));
      this.pad(t, chord[0]! / 2, secondsPerBeat * 0.9, 0.12, 'triangle');
      this.hat(t, 0.025); this.hat(t + secondsPerBeat / 2, 0.015);
      if (this.mood === 'drama' && beatInBar % 2 === 1) this.tom(t);
      this.nextBeat += secondsPerBeat; this.beat++;
    }
  }
  private pad(at: number, frequency: number, duration: number, volume: number, type: OscillatorType = 'sine') {
    const context = this.context!;
    const oscillator = context.createOscillator(); oscillator.type = type; oscillator.frequency.value = frequency;
    const envelope = context.createGain(); envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(volume, at + 0.02); envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(envelope).connect(this.musicBus!); oscillator.start(at); oscillator.stop(at + duration + 0.05);
  }
  private hat(at: number, volume: number) {
    const context = this.context!;
    const source = context.createBufferSource(); source.buffer = this.noise!;
    const filter = context.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 7000;
    const envelope = context.createGain(); envelope.gain.setValueAtTime(volume, at); envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    source.connect(filter).connect(envelope).connect(this.musicBus!); source.start(at, Math.random() * 0.5); source.stop(at + 0.06);
  }
  private tom(at: number) {
    const context = this.context!;
    const oscillator = context.createOscillator(); oscillator.frequency.setValueAtTime(140, at); oscillator.frequency.exponentialRampToValueAtTime(70, at + 0.2);
    const envelope = context.createGain(); envelope.gain.setValueAtTime(0.18, at); envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
    oscillator.connect(envelope).connect(this.musicBus!); oscillator.start(at); oscillator.stop(at + 0.3);
  }
}
