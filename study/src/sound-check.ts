import type { Crop } from "../../src/farming";
import { windFrequency } from "../../src/wind";
import { HARVEST_LEVEL, makeNoise, scheduleBundle, scheduleClose, scheduleCut } from "./harvest-sound";

/**
 * A check by measurement, for anyone without speakers to hand (a build
 * machine, for one). It renders ten metres of harvest for each crop offline
 * and reports peak and average level, next to today's harvest note rendered
 * the way FarmAudio.harvest plays it at the game's default volume.
 */
const RATE = 44100;
const db = (value: number) => (value > 0 ? Math.round(200 * Math.log10(value)) / 10 : -Infinity);
function levels(buffer: AudioBuffer) {
  let peak = 0, sum = 0, count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      peak = Math.max(peak, Math.abs(data[i]));
      sum += data[i] * data[i];
      count++;
    }
  }
  return { peakDb: db(peak), averageDb: db(Math.sqrt(sum / count)) };
}

async function proposed(crop: Crop, lane: number) {
  const ctx = new OfflineAudioContext(2, RATE * 5, RATE), master = ctx.createGain(), noise = makeNoise(ctx);
  master.gain.value = HARVEST_LEVEL.master;
  master.connect(ctx.destination);
  // Ten metres at 3 m/s: a note a metre, a bundle every third, then the row closes.
  for (let metre = 0; metre < 10; metre++) {
    const at = 0.05 + metre / 3;
    scheduleCut(ctx, master, noise, at, crop, lane, metre);
    if (metre % 3 === 2) scheduleBundle(ctx, master, noise, at + 0.04, crop, lane);
  }
  scheduleClose(ctx, master, 0.05 + 10 / 3, crop, lane);
  return levels(await ctx.startRendering());
}

/** FarmAudio.harvest, copied note for note, through the game's master gain at its default volume. */
async function today(crop: Crop) {
  const ctx = new OfflineAudioContext(2, RATE * 5, RATE), master = ctx.createGain();
  master.gain.value = 0.45 * 0.5;
  master.connect(ctx.destination);
  // The game allows one harvest note every 1.2 s, so ten metres of row holds three.
  for (const at of [0.05, 1.25, 2.45]) {
    const note = ctx.createOscillator(), gain = ctx.createGain();
    note.type = "sine";
    note.frequency.value = crop === "sunflowers" ? 620 : crop === "wheat" ? 420 : 220;
    note.connect(gain).connect(master);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.025, at + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
    note.start(at);
    note.stop(at + 0.6);
  }
  return levels(await ctx.startRendering());
}

const report: Record<string, unknown> = {};
for (const crop of ["wheat", "sunflowers", "pumpkins"] as const)
  report[crop] = { today: await today(crop), proposed: await proposed(crop, 4), pitchHz: Math.round(windFrequency(crop, 4) * 10) / 10 };
Object.assign(window, { __levels: report });
console.log(JSON.stringify(report, null, 2));
