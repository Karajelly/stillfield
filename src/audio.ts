import type { Crop } from "./farming";
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
    this.birdTimer = window.setInterval(() => {
      if (this.enabled && context.state === "running" && Math.random() < 0.38) {
        this.playBird();
      }
    }, 2200);
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
    windGain.gain.value = 0.12;
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
