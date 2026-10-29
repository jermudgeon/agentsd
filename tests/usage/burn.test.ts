import { describe, expect, it } from "vitest";
import { burnRatePerHour, forecast, type Sample } from "../../src/usage/burn";

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
