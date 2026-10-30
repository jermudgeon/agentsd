const HOUR_MS = 3_600_000;

export interface Sample {
  /** Milliseconds since epoch. */
  t: number;
  fiveHour: number | null;
  sevenDay: number | null;
}

export type Forecast = { kind: "ok" } | { kind: "exhaust"; at: number } | { kind: "unknown" };

/** Least-squares slope of utilization in percent per hour over samples inside the window. */
export function burnRatePerHour(
  samples: Sample[],
  key: "fiveHour" | "sevenDay",
  windowStart: number,
): number | null {
  const pts: [number, number][] = [];
  for (const s of samples) {
    const v = s[key];
    if (s.t >= windowStart && v !== null) pts.push([s.t / HOUR_MS, v]);
  }
  if (pts.length < 2) return null;

  const n = pts.length;
  const meanX = pts.reduce((a, [x]) => a + x, 0) / n;
  const meanY = pts.reduce((a, [, y]) => a + y, 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of pts) {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  }
  return den === 0 ? null : num / den;
}

export function forecast(utilization: number, ratePerHour: number | null, now: number, resetsAt: number): Forecast {
  if (ratePerHour === null) return { kind: "unknown" };
  if (ratePerHour <= 0) return { kind: "ok" };
  const at = now + ((100 - utilization) / ratePerHour) * HOUR_MS;
  return at > resetsAt ? { kind: "ok" } : { kind: "exhaust", at };
}

const MIN_WINDOW_AGE_H = 0.1;

/**
 * Burn rate in percent per hour, damped: the mean of the recent rate (last hour of samples)
 * and the average since the window opened. Null until the window is 6 minutes old.
 */
export function dampedBurnRate(args: {
  samples: Sample[];
  key: "fiveHour" | "sevenDay";
  utilization: number;
  windowStart: number;
  now: number;
}): number | null {
  const elapsedHours = (args.now - args.windowStart) / HOUR_MS;
  if (elapsedHours < MIN_WINDOW_AGE_H) return null;
  const average = args.utilization / elapsedHours;
  const recent = burnRatePerHour(args.samples, args.key, Math.max(args.windowStart, args.now - HOUR_MS));
  return recent === null ? average : (Math.max(recent, 0) + average) / 2;
}
