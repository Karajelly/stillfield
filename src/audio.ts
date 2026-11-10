import type { Crop } from "./farming";
import type { WindVoice } from "./wind";
/** A quiet, entirely synthesized soundscape, started only by a user gesture. */
export class FarmAudio {
  private lastHarvest = -10;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFundamental: OscillatorNode | null = null;
  private engineHarmonic: OscillatorNode | null = null;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly nodes: AudioNode[] = [];
  private readonly birds = new Set<OscillatorNode>();
  private birdTimer: number | null = null;
  private nightTimer: number | null = null;
  private noise: AudioBuffer | null = null;
  private windGain: GainNode | null = null;
  private voices = 0;
  private lastOwl = -60;
  private birdsong = 1;
  private crickets = 0;
  private gust = 0;
  private enabled = false;
  private disposed = false;
  private request = 0;
  private volume = 0.65;
  private speed = 0;

  async setEnabled(enabled: boolean): Promise<void> {
    if (this.disposed) return;
    this.enabled = enabled;
    const request = ++this.request;

    if (!enabled) {
      this.clearNightTimer();
      this.clearBirdTimer();
      this.stopBirds();
      if (this.context && this.context.state !== "closed") {
        await this.context.suspend();
      }
      return;
    }

    // Both construction and resume run in the original gesture's call stack.
    if (!this.context) this.initialize();
    const context = this.context;
    if (!context || context.state === "closed") return;
    await context.resume();
    if (this.disposed || !this.enabled || request !== this.request) return;

    this.updateVolume();
    this.updateEngine();
    this.clearBirdTimer();
    this.clearNightTimer();
    this.birdTimer = window.setInterval(() => {
      if (
        this.enabled &&
        context.state === "running" &&
        Math.random() < 0.38 * this.birdsong
      ) {
        this.playBird();
      }
    }, 2200);
    this.nightTimer = window.setInterval(() => {
      if (!this.enabled || context.state !== "running") return;
      if (Math.random() < 0.7 * this.crickets) this.playCricket();
      // An owl, now and then, once it is properly dark.
      if (
        this.crickets > 0.9 &&
        context.currentTime - this.lastOwl > 25 &&
        Math.random() < 0.02
      )
        this.playOwl();
    }, 520);
  }

  /** Birdsong thins towards dusk; crickets take over after dark. */
  setAmbience(birdsong: number, crickets: number): void {
    this.birdsong = Number.isFinite(birdsong) ? Math.max(0, birdsong) : 1;
    this.crickets = Number.isFinite(crickets)
      ? Math.max(0, Math.min(1, crickets))
      : 0;
  }

  /** A passing gust lifts the wind bed, from 0 (still) to 1 (full). */
  setGust(strength: number): void {
    const gust = Number.isFinite(strength)
      ? Math.max(0, Math.min(1, strength))
      : 0;
    if (gust === this.gust || (gust && Math.abs(gust - this.gust) < 0.02))
      return;
    this.gust = gust;
    if (this.context && this.windGain)
      this.windGain.gain.setTargetAtTime(
        0.12 + gust * 0.11,
        this.context.currentTime,
        0.4,
      );
  }

  /**
   * One note of the wind crossing the field. Wheat is a soft reed, sunflowers
   * a small bell, pumpkins a low wooden tone, and stubble a brush.
   */
  windNote(
    voice: WindVoice,
    frequency: number,
    level: number,
    pan: number,
  ): void {
    const ctx = this.context;
    if (
      !this.enabled ||
      !ctx ||
      !this.master ||
      ctx.state !== "running" ||
      this.voices >= 18 ||
      !(level > 0)
    )
      return;
    const now = ctx.currentTime + 0.01,
      loud = Math.min(1, level),
      envelope = ctx.createGain(),
      panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    envelope.gain.setValueAtTime(0, now);
    envelope.connect(panner).connect(this.master);
    const sources: AudioScheduledSourceNode[] = [];
    const extras: AudioNode[] = [envelope, panner];
    let end = now + 1;
    if (voice === "stubble") {
      if (!this.noise) return;
      const brush = ctx.createBufferSource();
      brush.buffer = this.noise;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 3200;
      band.Q.value = 0.7;
      brush.connect(band).connect(envelope);
      envelope.gain.linearRampToValueAtTime(0.02 * loud, now + 0.05);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      end = now + 0.36;
      sources.push(brush);
      extras.push(band);
      brush.start(now, Math.random() * 2);
    } else {
      const tone = ctx.createOscillator();
      tone.frequency.value = frequency;
      sources.push(tone);
      if (voice === "wheat") {
        // Slow to speak and slow to fade, so a long row becomes a held line.
        tone.type = "triangle";
        const soften = ctx.createBiquadFilter();
        soften.type = "lowpass";
        soften.frequency.value = 1500;
        tone.connect(soften).connect(envelope);
        extras.push(soften);
        envelope.gain.linearRampToValueAtTime(0.03 * loud, now + 0.14);
        envelope.gain.setTargetAtTime(0, now + 0.3, 0.22);
        end = now + 1.3;
      } else {
        tone.type = "sine";
        tone.connect(envelope);
        const bell = voice === "sunflowers";
        if (bell) {
          const shimmer = ctx.createOscillator(),
            quiet = ctx.createGain();
          shimmer.frequency.value = frequency * 2;
          quiet.gain.value = 0.22;
          shimmer.connect(quiet).connect(envelope);
          sources.push(shimmer);
          extras.push(quiet);
        }
        envelope.gain.linearRampToValueAtTime(
          (bell ? 0.022 : 0.06) * loud,
          now + (bell ? 0.008 : 0.015),
        );
        end = now + (bell ? 1.5 : 1.0);
        envelope.gain.exponentialRampToValueAtTime(0.0001, end - 0.02);
      }
    }
    this.voices++;
    sources[0].onended = () => {
      this.voices--;
      for (const node of [...sources, ...extras]) node.disconnect();
    };
    for (const source of sources) {
      if (voice !== "stubble") source.start(now);
      source.stop(end);
    }
  }

  /** Speed is normalized from 0 (idle) to 1 (full cruising speed). */
  setDriving(speed: number): void {
    this.speed = Number.isFinite(speed) ? Math.min(1, Math.abs(speed)) : 0;
    this.updateEngine();
  }

  setVolume(volume: number): void {
    this.volume = Number.isFinite(volume)
      ? Math.max(0, Math.min(1, volume))
      : 0;
    this.updateVolume();
  }

  harvest(crop: Crop): void {
    const ctx = this.context;
    if (
      !this.enabled ||
      !ctx ||
      !this.master ||
      ctx.state !== "running" ||
      ctx.currentTime - this.lastHarvest < 1.2
    )
      return;
    this.lastHarvest = ctx.currentTime;
    const note = ctx.createOscillator(),
      gain = ctx.createGain();
    note.type = "sine";
    note.frequency.value =
      crop === "sunflowers" ? 620 : crop === "wheat" ? 420 : 220;
    note.connect(gain).connect(this.master);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.025, ctx.currentTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55);
    note.onended = () => {
      note.disconnect();
      gain.disconnect();
    };
    note.start();
    note.stop(ctx.currentTime + 0.6);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    ++this.request;
    this.clearNightTimer();
    this.clearBirdTimer();
    this.stopBirds();
    for (const source of this.sources) {
      source.stop();
      source.disconnect();
    }
    for (const node of this.nodes) node.disconnect();
    this.sources.length = 0;
    this.nodes.length = 0;
    const context = this.context;
    this.context = null;
    this.master = null;
    this.engineGain = null;
    this.engineFundamental = null;
    this.engineHarmonic = null;
    this.windGain = null;
    this.noise = null;
    if (context && context.state !== "closed")
      void context.close().catch(() => {});
  }

  private initialize(): void {
    const AudioContextClass =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    this.context = context;
    const master = context.createGain();
    master.gain.value = this.volume * 0.5;
    master.connect(context.destination);
    this.master = master;
    this.nodes.push(master);

    // A short looping noise buffer uses very little CPU; slow modulation gives
    // the filtered wind its soft rise and fall without repeated timers.
    const noiseBuffer = context.createBuffer(
      1,
      context.sampleRate * 3,
      context.sampleRate,
    );
    const samples = noiseBuffer.getChannelData(0);
    for (let index = 0; index < samples.length; index++) {
      samples[index] = Math.random() * 2 - 1;
    }
    this.noise = noiseBuffer;
    const wind = context.createBufferSource();
    wind.buffer = noiseBuffer;
    wind.loop = true;
    const windHighPass = context.createBiquadFilter();
    windHighPass.type = "highpass";
    windHighPass.frequency.value = 110;
    windHighPass.Q.value = 0.5;
    const windLowPass = context.createBiquadFilter();
    windLowPass.type = "lowpass";
    windLowPass.frequency.value = 720;
    windLowPass.Q.value = 0.5;
    const windGain = context.createGain();
    windGain.gain.value = 0.12 + this.gust * 0.11;
    this.windGain = windGain;
    wind
      .connect(windHighPass)
      .connect(windLowPass)
      .connect(windGain)
      .connect(master);

    const windSwell = context.createOscillator();
    windSwell.frequency.value = 0.075;
    const swellDepth = context.createGain();
    swellDepth.gain.value = 0.035;
    windSwell.connect(swellDepth).connect(windGain.gain);

    const engineGain = context.createGain();
    engineGain.gain.value = 0.009;
    const engineFilter = context.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 250;
    engineFilter.Q.value = 0.5;
    engineGain.connect(engineFilter).connect(master);
    this.engineGain = engineGain;

    const fundamental = context.createOscillator();
    fundamental.type = "sine";
    fundamental.frequency.value = 53;
    fundamental.connect(engineGain);
    this.engineFundamental = fundamental;

    const harmonic = context.createOscillator();
    harmonic.type = "triangle";
    harmonic.frequency.value = 106;
    const harmonicGain = context.createGain();
    harmonicGain.gain.value = 0.3;
    harmonic.connect(harmonicGain).connect(engineGain);
    this.engineHarmonic = harmonic;

    const enginePulse = context.createOscillator();
    enginePulse.frequency.value = 8;
    const pulseDepth = context.createGain();
    pulseDepth.gain.value = 0.002;
    enginePulse.connect(pulseDepth).connect(engineGain.gain);

    this.nodes.push(
      windHighPass,
      windLowPass,
      windGain,
      swellDepth,
      engineGain,
      engineFilter,
      harmonicGain,
      pulseDepth,
    );
    this.sources.push(wind, windSwell, fundamental, harmonic, enginePulse);
    for (const source of this.sources) source.start();
    this.updateEngine();
  }

  private updateVolume(): void {
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(
      this.volume * 0.5,
      this.context.currentTime,
      0.12,
    );
  }

  private updateEngine(): void {
    const context = this.context;
    if (
      !context ||
      !this.engineGain ||
      !this.engineFundamental ||
      !this.engineHarmonic
    )
      return;
    const time = context.currentTime;
    this.engineGain.gain.setTargetAtTime(0.009 + this.speed * 0.035, time, 0.3);
    this.engineFundamental.frequency.setTargetAtTime(
      53 + this.speed * 22,
      time,
      0.3,
    );
    this.engineHarmonic.frequency.setTargetAtTime(
      106 + this.speed * 44,
      time,
      0.3,
    );
  }

  private playBird(): void {
    const context = this.context;
    if (!context || !this.master || this.birds.size > 1) return;
    const bird = context.createOscillator();
    bird.type = "sine";
    const envelope = context.createGain();
    const pan = context.createStereoPanner();
    pan.pan.value = Math.random() * 1.4 - 0.7;
    bird.connect(envelope).connect(pan).connect(this.master);

    const start = context.currentTime + 0.02;
    const pitch = 1700 + Math.random() * 650;
    const notes = Math.random() < 0.5 ? 2 : 3;
    envelope.gain.value = 0;
    for (let note = 0; note < notes; note++) {
      const time = start + note * 0.22;
      const frequency = pitch + note * 120;
      bird.frequency.setValueAtTime(frequency, time);
      bird.frequency.exponentialRampToValueAtTime(
        frequency * 1.19,
        time + 0.055,
      );
      bird.frequency.exponentialRampToValueAtTime(
        frequency * 0.92,
        time + 0.16,
      );
      envelope.gain.setValueAtTime(0, time);
      envelope.gain.linearRampToValueAtTime(0.018, time + 0.025);
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.15);
      envelope.gain.setValueAtTime(0, time + 0.17);
    }
    this.birds.add(bird);
    bird.onended = () => {
      this.birds.delete(bird);
      bird.disconnect();
      envelope.disconnect();
      pan.disconnect();
    };
    bird.start(start);
    bird.stop(start + notes * 0.22);
  }

  /** A cricket is a few very short, very high pulses. Two or three share the dark. */
  private playCricket(): void {
    const context = this.context;
    if (!context || !this.master || this.voices >= 18) return;
    const chirp = context.createOscillator(),
      envelope = context.createGain(),
      pan = context.createStereoPanner();
    const singer = Math.floor(Math.random() * 3);
    chirp.type = "sine";
    chirp.frequency.value = 3900 + singer * 260 + Math.random() * 40;
    pan.pan.value = [-0.65, 0.5, 0.1][singer];
    chirp.connect(envelope).connect(pan).connect(this.master);
    const start = context.currentTime + 0.02,
      pulses = 3 + (singer % 2);
    envelope.gain.setValueAtTime(0, start);
    for (let pulse = 0; pulse < pulses; pulse++) {
      const time = start + pulse * 0.058;
      envelope.gain.setValueAtTime(0, time);
      envelope.gain.linearRampToValueAtTime(
        0.0075 * this.crickets,
        time + 0.012,
      );
      envelope.gain.linearRampToValueAtTime(0, time + 0.04);
    }
    this.voices++;
    chirp.onended = () => {
      this.voices--;
      chirp.disconnect();
      envelope.disconnect();
      pan.disconnect();
    };
    chirp.start(start);
    chirp.stop(start + pulses * 0.058 + 0.02);
  }

  /** Two soft, falling hoots from somewhere past the barn. */
  private playOwl(): void {
    const context = this.context;
    if (!context || !this.master) return;
    this.lastOwl = context.currentTime;
    const owl = context.createOscillator(),
      envelope = context.createGain(),
      pan = context.createStereoPanner();
    owl.type = "sine";
    pan.pan.value = -0.55;
    owl.connect(envelope).connect(pan).connect(this.master);
    const start = context.currentTime + 0.05;
    envelope.gain.setValueAtTime(0, start);
    for (const [offset, length] of [
      [0, 0.34],
      [0.52, 0.2],
      [0.78, 0.5],
    ]) {
      const time = start + offset;
      owl.frequency.setValueAtTime(352, time);
      owl.frequency.linearRampToValueAtTime(318, time + length);
      envelope.gain.setValueAtTime(0, time);
      envelope.gain.linearRampToValueAtTime(0.03, time + 0.07);
      envelope.gain.linearRampToValueAtTime(0, time + length);
    }
    owl.onended = () => {
      owl.disconnect();
      envelope.disconnect();
      pan.disconnect();
    };
    owl.start(start);
    owl.stop(start + 1.4);
  }

  private clearNightTimer(): void {
    if (this.nightTimer === null) return;
    window.clearInterval(this.nightTimer);
    this.nightTimer = null;
  }

  private clearBirdTimer(): void {
    if (this.birdTimer === null) return;
    window.clearInterval(this.birdTimer);
    this.birdTimer = null;
  }

  private stopBirds(): void {
    for (const bird of this.birds) bird.stop();
    this.birds.clear();
  }
}
