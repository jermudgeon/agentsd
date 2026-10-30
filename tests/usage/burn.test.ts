import { describe, expect, it } from "vitest";
import { burnRatePerHour, dampedBurnRate, forecast, type Sample } from "../../src/usage/burn";

const H = 3_600_000;
const s = (t: number, fiveHour: number | null, sevenDay: number | null = null): Sample => ({ t, fiveHour, sevenDay });

describe("burnRatePerHour", () => {
  it("is the slope in percent per hour", () => {
    expect(burnRatePerHour([s(0, 50), s(H, 60)], "fiveHour", 0)).toBeCloseTo(10);
  });

  it("ignores samples before the window start", () => {
    expect(burnRatePerHour([s(-H, 5), s(0, 50), s(H, 60)], "fiveHour", 0)).toBeCloseTo(10);
  });

  it("ignores samples whose value for the key is null", () => {
    expect(burnRatePerHour([s(0, 50, 1), s(H / 2, null, 2), s(H, 60, 3)], "fiveHour", 0)).toBeCloseTo(10);
    expect(burnRatePerHour([s(0, 50, 1), s(H, 60, 3)], "sevenDay", 0)).toBeCloseTo(2);
  });

  it("is null under two usable samples", () => {
    expect(burnRatePerHour([s(0, 50)], "fiveHour", 0)).toBeNull();
    expect(burnRatePerHour([s(0, null), s(H, null)], "fiveHour", 0)).toBeNull();
    expect(burnRatePerHour([s(0, 50), s(0, 55)], "fiveHour", 0)).toBeNull();
  });
});

describe("forecast", () => {
  const now = 1_000_000;

  it("projects exhaustion when it falls before the reset", () => {
    expect(forecast(60, 10, now, now + 5 * H)).toEqual({ kind: "exhaust", at: now + 4 * H });
  });

  it("is ok when the reset comes first", () => {
    expect(forecast(60, 10, now, now + 2 * H)).toEqual({ kind: "ok" });
  });

  it.each([0, -3])("is ok for rate %i", (rate) => {
    expect(forecast(60, rate, now, now + 5 * H)).toEqual({ kind: "ok" });
  });

  it("is unknown for a null rate", () => {
    expect(forecast(60, null, now, now + 5 * H)).toEqual({ kind: "unknown" });
  });
});

describe("dampedBurnRate", () => {
  const NOW = 100 * H;
  const windowStart = NOW - 2 * H;
  const args = { key: "fiveHour" as const, utilization: 60, windowStart, now: NOW };

  it("is the window average alone when there is no recent rate", () => {
    expect(dampedBurnRate({ ...args, samples: [] })).toBeCloseTo(30);
  });

  it("is the mean of the recent rate and the window average", () => {
    const samples = [s(NOW - H / 2, 50), s(NOW, 60)];
    expect(dampedBurnRate({ ...args, samples })).toBeCloseTo(25);
  });

  it("counts a negative recent rate as zero", () => {
    const samples = [s(NOW - H / 2, 60), s(NOW, 50)];
    expect(dampedBurnRate({ ...args, samples })).toBeCloseTo(15);
  });

  it("ignores samples older than an hour", () => {
    const samples = [s(NOW - 90 * 60_000, 0), s(NOW - 80 * 60_000, 10)];
    expect(dampedBurnRate({ ...args, samples })).toBeCloseTo(30);
  });

  it("is null until 6 minutes after the window opened", () => {
    expect(dampedBurnRate({ ...args, windowStart: NOW - 5 * 60_000, samples: [] })).toBeNull();
    expect(dampedBurnRate({ ...args, windowStart: NOW - 6 * 60_000, samples: [] })).not.toBeNull();
  });
});
