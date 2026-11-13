import type { Crop } from "../../src/farming";
import { windFrequency } from "../../src/wind";

/**
 * The harvest plays the instrument the wind already plays. The game gives each
 * crop a voice and each 2.5 m lane a pitch (src/wind.ts); a gust reads the
 * field west to east in four. Here the cutter reads the row it is on: one soft
 * note for every metre cut, a lower one as each bundle is set down every third
 * metre, and two notes to close the row. A row is a slow three.
 *
 * Voices follow FarmAudio.windNote: wheat a soft reed, sunflowers a small
 * bell, pumpkins a low wooden tone. Levels sit beside the wind's notes, so the
 * harvest is as quiet as the rest of Stillfield and no louder.
 */
export const HARVEST_LEVEL = { master: 0.3, note: 0.055, swish: 0.022, bundle: 0.07, close: 0.05 };

type Out = AudioNode;

function tone(
  ctx: BaseAudioContext, out: Out, at: number, crop: Crop, frequency: number, level: number, length: number, pan = 0,
) {
  const envelope = ctx.createGain(), panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  envelope.gain.setValueAtTime(0, at);
  envelope.connect(panner).connect(out);
  const voice = ctx.createOscillator();
  voice.frequency.value = frequency;
  const sources: OscillatorNode[] = [voice];
  if (crop === "wheat") {
    // Slow to speak, slow to fade: a reed.
    voice.type = "triangle";
    const soften = ctx.createBiquadFilter();
    soften.type = "lowpass";
    soften.frequency.value = 1500;
    voice.connect(soften).connect(envelope);
    envelope.gain.linearRampToValueAtTime(level, at + 0.05);
    envelope.gain.setTargetAtTime(0, at + 0.09, length * 0.22);
  } else {
    voice.type = "sine";
    voice.connect(envelope);
    if (crop === "sunflowers") {
      // A little shimmer an octave up makes it a bell.
      const shimmer = ctx.createOscillator(), quiet = ctx.createGain();
      shimmer.frequency.value = frequency * 2;
      quiet.gain.value = 0.22;
      shimmer.connect(quiet).connect(envelope);
      sources.push(shimmer);
    }
    envelope.gain.linearRampToValueAtTime(level * (crop === "sunflowers" ? 0.8 : 1.5), at + (crop === "sunflowers" ? 0.008 : 0.015));
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + length);
  }
  for (const source of sources) {
    source.start(at);
    source.stop(at + length + 0.4);
  }
  sources[0].onended = () => {
    envelope.disconnect();
    panner.disconnect();
  };
}

function brush(ctx: BaseAudioContext, out: Out, noise: AudioBuffer, at: number, level: number, centre: number, length: number) {
  const source = ctx.createBufferSource(), band = ctx.createBiquadFilter(), envelope = ctx.createGain();
  source.buffer = noise;
  band.type = "bandpass";
  band.frequency.value = centre;
  band.Q.value = 0.8;
  envelope.gain.setValueAtTime(0, at);
  envelope.gain.linearRampToValueAtTime(level, at + length * 0.3);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + length);
  source.connect(band).connect(envelope).connect(out);
  source.start(at, Math.random() * 1.5);
  source.stop(at + length + 0.05);
  source.onended = () => envelope.disconnect();
}

export function makeNoise(ctx: BaseAudioContext) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** One metre of crop meeting the cutter. `beat` counts metres along the row. */
export function scheduleCut(ctx: BaseAudioContext, out: Out, noise: AudioBuffer, at: number, crop: Crop, lane: number, beat: number, night = false) {
  const accent = beat % 3 === 0 ? 1 : 0.62;
  tone(ctx, out, at, crop, windFrequency(crop, lane, night), HARVEST_LEVEL.note * accent, crop === "wheat" ? 0.5 : crop === "sunflowers" ? 0.7 : 0.45);
  // Stalks through the bar: brighter for wheat, softer and lower for leaves.
  brush(ctx, out, noise, at, HARVEST_LEVEL.swish * accent, crop === "wheat" ? 3400 : crop === "sunflowers" ? 2400 : 1500, 0.16);
}

/** A bundle set down behind the cutter: the lane's note an octave lower, with a soft thud. */
export function scheduleBundle(ctx: BaseAudioContext, out: Out, noise: AudioBuffer, at: number, crop: Crop, lane: number, night = false) {
  tone(ctx, out, at, "pumpkins", windFrequency(crop, lane, night) / (crop === "pumpkins" ? 1 : 2), HARVEST_LEVEL.bundle, 0.5);
  brush(ctx, out, noise, at, HARVEST_LEVEL.swish * 1.4, 420, 0.12);
}

/** The row is done: its note, then the fifth above it, left to ring. */
export function scheduleClose(ctx: BaseAudioContext, out: Out, at: number, crop: Crop, lane: number, night = false) {
  const root = windFrequency(crop, lane, night);
  tone(ctx, out, at, crop, root, HARVEST_LEVEL.close, 1.6);
  tone(ctx, out, at + 0.26, crop, root * 1.5, HARVEST_LEVEL.close * 0.8, 2.0);
}

/** A plant coming ripe, heard only as a row finishes ripening in the order it was sown. */
export function scheduleRipen(ctx: BaseAudioContext, out: Out, at: number, crop: Crop, lane: number, night = false) {
  tone(ctx, out, at, crop, windFrequency(crop, lane, night), HARVEST_LEVEL.note * 0.6, crop === "wheat" ? 0.7 : 0.9);
}

/** The live player. Sound starts only from a tap, as in the game. */
export class HarvestSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastRipen = 0;
  enabled = false;
  async setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) return void (await this.ctx?.suspend());
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = HARVEST_LEVEL.master;
      this.master.connect(this.ctx.destination);
      this.noise = makeNoise(this.ctx);
    }
    await this.ctx.resume();
  }
  private get ready() {
    return this.enabled && this.ctx && this.master && this.noise && this.ctx.state === "running" ? this.ctx : null;
  }
  cut(crop: Crop, lane: number, beat: number) {
    const ctx = this.ready;
    if (ctx) scheduleCut(ctx, this.master!, this.noise!, ctx.currentTime + 0.01, crop, lane, beat);
  }
  bundle(crop: Crop, lane: number) {
    const ctx = this.ready;
    if (ctx) scheduleBundle(ctx, this.master!, this.noise!, ctx.currentTime + 0.01, crop, lane);
  }
  close(crop: Crop, lane: number) {
    const ctx = this.ready;
    if (ctx) scheduleClose(ctx, this.master!, ctx.currentTime + 0.05, crop, lane);
  }
  ripen(crop: Crop, lane: number) {
    const ctx = this.ready;
    if (!ctx || ctx.currentTime - this.lastRipen < 0.11) return;
    this.lastRipen = ctx.currentTime;
    scheduleRipen(ctx, this.master!, ctx.currentTime + 0.01, crop, lane);
  }
  dispose() {
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
