/**
 * Interactive sound, built on Ethiopian modal practice.
 *
 * Ethiopian melody is organised around the qenet: pentatonic modes whose
 * character comes from their interval spacing rather than from harmony. The
 * four scales below are the commonly cited ones, and every note the site plays
 * is drawn from the active mode, so interaction wanders inside a mode instead
 * of landing on arbitrary pitches.
 *
 * The voice is a drawbar organ: a stack of harmonically related sines whose
 * gains fall off with each partial, lightly detuned and run through a gentle
 * vibrato and a long delay. That is the Ethio-jazz keyboard sound of Hailu
 * Mergia's Walias Band recordings, and the neighbouring West African synth
 * records of Mamman Sani, whose organ lines share its warmth and repetition
 * even though his work is Nigerien rather than Ethiopian.
 *
 * Sound never starts on its own: browsers require a gesture to open an audio
 * context, and unannounced noise is hostile besides.
 */

export type QenetName = "tizita" | "bati" | "ambassel" | "anchihoye";

/** Semitone offsets from the tonic for each mode. */
const QENET: Record<QenetName, number[]> = {
  tizita: [0, 2, 4, 7, 9], // nostalgia; the bright, major-leaning mode
  bati: [0, 4, 5, 7, 11],
  ambassel: [0, 1, 5, 7, 8], // flattened second gives its plaintive colour
  anchihoye: [0, 1, 5, 6, 8],
};

export const QENET_NAMES = Object.keys(QENET) as QenetName[];

/** Drawbar-style partials: harmonic number paired with its share of the level. */
const PARTIALS: [number, number][] = [
  [1, 1],
  [2, 0.5],
  [3, 0.32],
  [4, 0.18],
  [6, 0.08],
];

const TONIC_HZ = 146.83; // D3, comfortable for an organ register

export interface Voice {
  readonly enabled: boolean;
}

let context: AudioContext | null = null;
let master: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let delayFeedback: GainNode | null = null;
let drone: { stop(): void } | null = null;
let mode: QenetName = "tizita";
let amplitudeBuffer: Uint8Array<ArrayBuffer> | null = null;

/**
 * Intent, tracked separately from the context: teardown fades out over several
 * hundred milliseconds, and callers asking whether sound is on need an answer
 * that reflects the switch right now rather than the graph's leftover state.
 */
let wanted = false;

export function currentMode(): QenetName {
  return mode;
}

export function setMode(next: QenetName): void {
  mode = next;
}

export function isEnabled(): boolean {
  return wanted;
}

/** Frequency of a scale degree, where degrees past the mode wrap up an octave. */
function degreeToHz(degree: number): number {
  const scale = QENET[mode];
  const size = scale.length;
  const octave = Math.floor(degree / size);
  const step = scale[((degree % size) + size) % size] ?? 0;
  return TONIC_HZ * Math.pow(2, (step + octave * 12) / 12);
}

/**
 * Starts the audio graph. Must be called from a user gesture, which is both a
 * browser requirement and the only polite way to begin making noise.
 */
export async function enable(): Promise<void> {
  wanted = true;
  if (context) {
    await context.resume();
    return;
  }

  const created = new AudioContext();
  context = created;

  master = created.createGain();
  master.gain.value = 0.0001;
  master.gain.linearRampToValueAtTime(0.22, created.currentTime + 1.2);

  // A long, soft delay stands in for room reverb without a convolution buffer.
  const delay = created.createDelay(1.5);
  delay.delayTime.value = 0.38;
  const feedback = created.createGain();
  feedback.gain.value = 0.34;
  const delayTone = created.createBiquadFilter();
  delayTone.type = "lowpass";
  delayTone.frequency.value = 1800;

  delay.connect(feedback);
  feedback.connect(delayTone);
  delayTone.connect(delay);
  delayFeedback = feedback;

  analyser = created.createAnalyser();
  analyser.fftSize = 1024;
  amplitudeBuffer = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

  master.connect(delay);
  delay.connect(analyser);
  master.connect(analyser);
  analyser.connect(created.destination);

  await created.resume();
  startDrone();
}

export function disable(): void {
  wanted = false;
  if (!context || !master) return;
  const ctx = context;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25);

  drone?.stop();
  drone = null;

  window.setTimeout(() => {
    void ctx.close();
    if (context === ctx) {
      context = null;
      master = null;
      analyser = null;
      delayFeedback = null;
      amplitudeBuffer = null;
    }
  }, 700);
}

/** A sustained tonic and fifth, the bed these records tend to sit on. */
function startDrone(): void {
  if (!context || !master) return;
  const ctx = context;
  const bus = ctx.createGain();
  bus.gain.value = 0.0001;
  bus.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 3);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 620;

  const oscillators = [TONIC_HZ / 2, (TONIC_HZ / 2) * Math.pow(2, 7 / 12)].map((hz) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = hz;
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    osc.connect(gain);
    gain.connect(filter);
    osc.start();
    return osc;
  });

  // Slow drift keeps the drone from sounding like a held test tone.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 90;
  lfo.connect(lfoDepth);
  lfoDepth.connect(filter.frequency);
  lfo.start();

  filter.connect(bus);
  bus.connect(master);

  drone = {
    stop() {
      bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
      window.setTimeout(() => {
        for (const osc of oscillators) osc.stop();
        lfo.stop();
      }, 900);
    },
  };
}

export interface NoteOptions {
  /** Scale degree within the active mode; may exceed the mode to reach octaves. */
  degree: number;
  duration?: number;
  level?: number;
}

export function playNote({ degree, duration = 1.6, level = 0.5 }: NoteOptions): void {
  if (!wanted || !context || !master) return;
  const ctx = context;
  const now = ctx.currentTime;
  const hz = degreeToHz(degree);

  const voice = ctx.createGain();
  voice.gain.value = 0.0001;

  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 2600;
  tone.Q.value = 0.6;

  // Vibrato shared by every partial, as a real drawbar organ would have.
  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 5.2;
  const vibratoDepth = ctx.createGain();
  vibratoDepth.gain.value = hz * 0.004;
  vibrato.connect(vibratoDepth);
  vibrato.start(now);

  const oscillators = PARTIALS.map(([harmonic, share], index) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = hz * harmonic;
    // Alternating small detune thickens the stack without sounding out of tune.
    osc.detune.value = index % 2 === 0 ? 3 : -3;
    const gain = ctx.createGain();
    gain.gain.value = share;
    vibratoDepth.connect(osc.frequency);
    osc.connect(gain);
    gain.connect(tone);
    osc.start(now);
    return osc;
  });

  tone.connect(voice);
  voice.connect(master);

  const peak = 0.16 * level;
  voice.gain.linearRampToValueAtTime(peak, now + 0.04);
  voice.gain.exponentialRampToValueAtTime(peak * 0.55, now + 0.35);
  voice.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  const stopAt = now + duration + 0.1;
  for (const osc of oscillators) osc.stop(stopAt);
  vibrato.stop(stopAt);
}

/** Plays an ascending figure through the mode, used when a view opens. */
export function playPhrase(root = 0, count = 4): void {
  if (!wanted || !context) return;
  for (let i = 0; i < count; i += 1) {
    window.setTimeout(() => playNote({ degree: root + i, level: 0.42, duration: 1.8 }), i * 140);
  }
}

/** Current output level, 0..1, for driving the visuals. */
export function amplitude(): number {
  if (!analyser || !amplitudeBuffer) return 0;
  analyser.getByteTimeDomainData(amplitudeBuffer);

  let sum = 0;
  for (const sample of amplitudeBuffer) {
    const centred = (sample - 128) / 128;
    sum += centred * centred;
  }
  return Math.min(1, Math.sqrt(sum / amplitudeBuffer.length) * 4);
}

export function setFeedback(amount: number): void {
  if (delayFeedback) delayFeedback.gain.value = Math.min(0.6, Math.max(0, amount));
}
