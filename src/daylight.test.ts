import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DAY_COPY,
  DAY_HOLDS,
  DAY_SECONDS,
  dayPhase,
  daylightAt,
  holdSeconds,
  wrapDay,
} from "./daylight";

describe("a slow day", () => {
  it("opens on the original morning light", () => {
    const morning = daylightAt(0);
    assert.equal(morning.phase, "morning");
    assert.equal(morning.sunPower, 3.1);
    assert.equal(morning.ambient, 2.5);
    assert.equal(morning.glow, 0);
    assert.deepEqual(
      morning.sky.map((value) => Math.round(value * 255)),
      [0xe8, 0xec, 0xda],
    );
  });

  it("closes into a loop with no jump at the end of the day", () => {
    const first = daylightAt(0),
      last = daylightAt(DAY_SECONDS - 0.001);
    for (const key of ["sunPower", "ambient", "glow", "birds", "exposure"] as const)
      assert.ok(Math.abs(first[key] - last[key]) < 0.001, key);
    assert.deepEqual(daylightAt(DAY_SECONDS), first);
    assert.deepEqual(daylightAt(-DAY_SECONDS), first);
  });

  it("never changes abruptly from one second to the next", () => {
    let before = daylightAt(0);
    for (let second = 1; second <= DAY_SECONDS; second++) {
      const now = daylightAt(second);
      assert.ok(Math.abs(now.sunPower - before.sunPower) < 0.12, `sun at ${second}`);
      assert.ok(Math.abs(now.ambient - before.ambient) < 0.06, `ambient at ${second}`);
      assert.ok(Math.abs(now.glow - before.glow) < 0.06, `glow at ${second}`);
      now.sky.forEach((value, channel) =>
        assert.ok(Math.abs(value - before.sky[channel]) < 0.03, `sky at ${second}`),
      );
      before = now;
    }
  });

  it("keeps the sun or moon above the meadow and every value in range", () => {
    for (let second = 0; second < DAY_SECONDS; second += 3) {
      const now = daylightAt(second);
      assert.ok(now.sunFrom[1] > 0.2, `height at ${second}`);
      assert.ok(Math.abs(Math.hypot(...now.sunFrom) - 1) < 1e-9);
      assert.ok(now.glow >= 0 && now.glow <= 1);
      assert.ok(now.birds >= 0);
      assert.ok(now.shadow > 0 && now.shadow <= 1);
      for (const color of [now.sun, now.sky, now.skyLight, now.groundLight])
        assert.ok(color.every((value) => value >= 0 && value <= 1));
      // A bright night: it is never too dark to see the rows.
      assert.ok(now.ambient >= 1);
    }
  });

  it("passes through every part of the day in order", () => {
    const seen: string[] = [];
    for (let second = 0; second < DAY_SECONDS; second++) {
      const phase = dayPhase(second);
      if (seen[seen.length - 1] !== phase) seen.push(phase);
    }
    assert.deepEqual(seen, [
      "morning",
      "afternoon",
      "golden",
      "dusk",
      "night",
      "dawn",
      "morning",
    ]);
    for (const phase of seen) assert.equal(DAY_COPY[phase as "night"].length, 2);
  });

  it("lights the lamps only after dark and quiets the birds", () => {
    assert.equal(daylightAt(holdSeconds("golden")).glow, 0);
    const night = daylightAt(holdSeconds("night"));
    assert.equal(night.glow, 1);
    assert.equal(night.birds, 0);
    assert.ok(daylightAt(holdSeconds("dusk")).glow > 0.5);
  });

  it("holds each chosen light inside its own part of the day", () => {
    for (const hold of DAY_HOLDS)
      if (hold !== "flow") assert.equal(dayPhase(holdSeconds(hold)), hold);
  });

  it("treats a damaged saved hour as morning", () => {
    assert.equal(wrapDay(Number.NaN), 0);
    assert.equal(wrapDay(Number.POSITIVE_INFINITY), 0);
    assert.equal(wrapDay(DAY_SECONDS + 5), 5);
    assert.equal(wrapDay(-5), DAY_SECONDS - 5);
  });
});
