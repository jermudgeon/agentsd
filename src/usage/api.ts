export const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

export interface UsageWindow {
  /** Percent of the window used. */
  utilization: number;
  /** Milliseconds since epoch; null when no window is active (nothing used yet). */
  resetsAt: number | null;
}

export interface UsageReading {
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
}

export class UsageHttpError extends Error {
  constructor(readonly status: number) {
    super(`usage request failed: HTTP ${status}`);
    this.name = "UsageHttpError";
  }
}

function toWindow(w: unknown): UsageWindow | null {
  const o = w as { utilization?: unknown; resets_at?: unknown } | null;
  if (typeof o?.utilization !== "number") return null;
  if (o.resets_at === null || o.resets_at === undefined) return { utilization: o.utilization, resetsAt: null };
  if (typeof o.resets_at !== "string") return null;
  const resetsAt = Date.parse(o.resets_at);
  return Number.isNaN(resetsAt) ? null : { utilization: o.utilization, resetsAt };
}

export async function fetchUsage(accessToken: string, fetchFn: typeof fetch = fetch): Promise<UsageReading> {
  const res = await fetchFn(USAGE_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, "anthropic-beta": "oauth-2025-04-20" },
  });
  if (!res.ok) throw new UsageHttpError(res.status);
  const body = (await res.json()) as { five_hour?: unknown; seven_day?: unknown };
  return { fiveHour: toWindow(body.five_hour), sevenDay: toWindow(body.seven_day) };
}
