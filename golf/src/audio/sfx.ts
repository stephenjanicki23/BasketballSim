/**
 * Sound, synthesised rather than sampled.
 *
 * The game ships as one page with no assets beside it, so every sound here is
 * made out of oscillators and filtered noise at the moment it is played: a
 * driver is a hard crack with a low body under it, an iron is the same crack
 * pitched up and cut shorter, a wedge has turf in it, a putt is a soft click.
 * That keeps the whole thing a couple of kilobytes instead of a couple of
 * megabytes, and it means the strike can be shaded by how well it was struck.
 *
 * Nothing here ever throws: a browser with no Web Audio, a context the autoplay
 * policy will not start, a device with no output — all of them end up silent
 * rather than broken.
 */

export type SfxId =
  | 'drive' | 'wood' | 'iron' | 'wedge' | 'putt'
  | 'holed' | 'splash' | 'sand' | 'rough' | 'bounce' | 'timber'
  | 'cheer' | 'applause' | 'groan';

const STORAGE_KEY = 'golf.sound';

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let on = read();

function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function soundOn(): boolean {
  return on;
}

export function setSoundOn(value: boolean): void {
  on = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');
  } catch {
    // A browser with storage turned off still gets sound for this session.
  }
  if (master && context) master.gain.setTargetAtTime(value ? 0.9 : 0, context.currentTime, 0.02);
}

/** The context, started lazily — the first sound always follows a click or a key. */
function audio(): AudioContext | null {
  if (!on) return null;
  if (context) {
    if (context.state === 'suspended') void context.resume();
    return context;
  }
  const Ctor = typeof window === 'undefined'
    ? undefined
    : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
    master = context.createGain();
    master.gain.value = 0.9;
    master.connect(context.destination);
    const seconds = 2;
    noise = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return context;
  } catch {
    context = null;
    return null;
  }
}

interface NoiseOptions {
  /** 'bandpass' picks out a band, 'lowpass' takes the top off. */
  type?: BiquadFilterType;
  frequency: number;
  /** Sweep the filter to this frequency over the sound's length. */
  sweepTo?: number;
  q?: number;
  gain: number;
  attack?: number;
  decay: number;
  delay?: number;
}

function burst(ctx: AudioContext, options: NoiseOptions): void {
  if (!noise || !master) return;
  const at = ctx.currentTime + (options.delay ?? 0);
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = options.type ?? 'bandpass';
  filter.frequency.setValueAtTime(options.frequency, at);
  if (options.sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, options.sweepTo), at + options.decay);
  filter.Q.value = options.q ?? 1;
  const gain = ctx.createGain();
  const attack = options.attack ?? 0.004;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, options.gain), at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + options.decay);
  source.connect(filter).connect(gain).connect(master);
  source.start(at);
  source.stop(at + attack + options.decay + 0.05);
}

interface ToneOptions {
  type?: OscillatorType;
  from: number;
  to?: number;
  gain: number;
  decay: number;
  delay?: number;
}

function tone(ctx: AudioContext, options: ToneOptions): void {
  if (!master) return;
  const at = ctx.currentTime + (options.delay ?? 0);
  const osc = ctx.createOscillator();
  osc.type = options.type ?? 'sine';
  osc.frequency.setValueAtTime(options.from, at);
  if (options.to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, options.to), at + options.decay);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, options.gain), at + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + options.decay);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + options.decay + 0.05);
}

/**
 * Play a sound. `power` shades a strike from a flush one at 1 to a thin one at
 * 0: quieter, and with the body taken out of it.
 */
export function playSfx(id: SfxId, power = 1): void {
  const ctx = audio();
  if (!ctx) return;
  const p = Math.max(0.25, Math.min(1, power));
  try {
    switch (id) {
      case 'drive':
        burst(ctx, { frequency: 2100, q: 1.1, gain: 0.5 * p, decay: 0.15 });
        tone(ctx, { from: 210, to: 95, gain: 0.34 * p * p, decay: 0.1 });
        break;
      case 'wood':
        burst(ctx, { frequency: 2600, q: 1.3, gain: 0.4 * p, decay: 0.12 });
        tone(ctx, { from: 260, to: 130, gain: 0.24 * p * p, decay: 0.08 });
        break;
      case 'iron':
        burst(ctx, { frequency: 3400, q: 2.1, gain: 0.34 * p, decay: 0.1 });
        tone(ctx, { from: 420, to: 210, gain: 0.16 * p * p, decay: 0.07 });
        break;
      case 'wedge':
        burst(ctx, { frequency: 1900, q: 1.5, gain: 0.26 * p, decay: 0.1 });
        // The divot, a moment after the ball.
        burst(ctx, { type: 'lowpass', frequency: 520, gain: 0.2, decay: 0.16, delay: 0.02 });
        break;
      case 'putt':
        tone(ctx, { from: 560, to: 360, gain: 0.2, decay: 0.05 });
        burst(ctx, { type: 'highpass', frequency: 1800, gain: 0.08, decay: 0.03 });
        break;
      case 'holed':
        // The rattle, then the bottom of the cup.
        tone(ctx, { type: 'triangle', from: 880, gain: 0.16, decay: 0.035 });
        tone(ctx, { type: 'triangle', from: 660, gain: 0.14, decay: 0.035, delay: 0.05 });
        tone(ctx, { type: 'triangle', from: 480, gain: 0.12, decay: 0.05, delay: 0.1 });
        burst(ctx, { type: 'lowpass', frequency: 700, gain: 0.14, decay: 0.2, delay: 0.09 });
        break;
      case 'splash':
        burst(ctx, { type: 'lowpass', frequency: 2400, sweepTo: 260, gain: 0.42, decay: 0.55 });
        tone(ctx, { from: 420, to: 140, gain: 0.12, decay: 0.2 });
        break;
      case 'sand':
        burst(ctx, { frequency: 900, q: 0.7, gain: 0.3, decay: 0.28 });
        tone(ctx, { from: 130, to: 80, gain: 0.1, decay: 0.12 });
        break;
      case 'rough':
        burst(ctx, { frequency: 1500, q: 0.8, gain: 0.18, decay: 0.16 });
        break;
      case 'bounce':
        tone(ctx, { from: 170, to: 110, gain: 0.14, decay: 0.09 });
        burst(ctx, { type: 'lowpass', frequency: 900, gain: 0.1, decay: 0.07 });
        break;
      case 'timber':
        // A ball into a trunk: woody, and it does not ring.
        tone(ctx, { type: 'triangle', from: 300, to: 190, gain: 0.26, decay: 0.09 });
        burst(ctx, { frequency: 1200, q: 2.4, gain: 0.2, decay: 0.07 });
        break;
      case 'cheer':
        burst(ctx, { frequency: 760, q: 0.35, gain: 0.3, attack: 0.16, decay: 1.5 });
        burst(ctx, { frequency: 1900, q: 0.5, gain: 0.14, attack: 0.22, decay: 1.2, delay: 0.04 });
        break;
      case 'applause':
        burst(ctx, { frequency: 1500, q: 0.45, gain: 0.16, attack: 0.1, decay: 0.8 });
        break;
      case 'groan':
        burst(ctx, { frequency: 340, q: 0.5, gain: 0.14, attack: 0.12, decay: 0.7 });
        break;
    }
  } catch {
    // Sound is never worth an exception in the middle of a round.
  }
}
