import { burnRatePerHour, forecast } from "./burn";
import type { AccountView } from "./poller";
import { escapeXml, iconButton } from "../util/svg";

export type Metric = "fiveHour" | "sevenDay" | "forecast";

export interface KeyDisplay {
  label: string;
  big: string;
  sub: string;
  color: string;
  dimmed: boolean;
}

const NEUTRAL = "#30363d";
const AMBER = "#d29922";
const RED = "#da3633";
const STALE_AFTER_MS = 3 * 60_000;
const FIVE_HOUR_MS = 5 * 3_600_000;
const ORDER: Metric[] = ["fiveHour", "sevenDay", "forecast"];

export function nextMetric(m: Metric): Metric {
  return ORDER[(ORDER.indexOf(m) + 1) % ORDER.length];
}

function duration(ms: number): string {
  const mins = Math.floor(Math.max(0, ms) / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function age(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

function utilizationColor(pct: number): string {
  return pct >= 90 ? RED : pct >= 70 ? AMBER : NEUTRAL;
}

export function usageDisplay(label: string, metric: Metric, account: AccountView | undefined, now: number): KeyDisplay {
  const blank: KeyDisplay = { label, big: "--", sub: "", color: NEUTRAL, dimmed: false };
  const reading = account?.reading;
  if (!account || !reading || account.readAt === null) return blank;

  const stale = now - account.readAt > STALE_AFTER_MS;
  const staleSub = stale ? `stale ${age(now - account.readAt)}` : null;
  const window = metric === "sevenDay" ? reading.sevenDay : reading.fiveHour;
  if (!window) return { ...blank, sub: staleSub ?? "", dimmed: stale };

  if (metric === "forecast") {
    const rate = burnRatePerHour(account.samples, "fiveHour", window.resetsAt - FIVE_HOUR_MS);
    const f = forecast(window.utilization, rate, now, window.resetsAt);
    const base = { label, dimmed: stale };
    if (f.kind === "exhaust") return { ...base, big: duration(f.at - now), sub: staleSub ?? "to empty", color: RED };
    if (f.kind === "ok") return { ...base, big: "OK", sub: staleSub ?? duration(window.resetsAt - now), color: NEUTRAL };
    return { ...base, big: "--", sub: staleSub ?? "", color: NEUTRAL };
  }

  return {
    label,
    big: `${Math.round(window.utilization)}%`,
    sub: staleSub ?? duration(window.resetsAt - now),
    color: utilizationColor(window.utilization),
    dimmed: stale,
  };
}

function text(y: number, size: number, weight: string, content: string): string {
  return `<text x="72" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" ` +
    `fill="#ffffff" text-anchor="middle">${escapeXml(content)}</text>`;
}

export function usageImage(d: KeyDisplay): string {
  const body = text(30, 20, "600", d.label) + text(88, 44, "700", d.big) + text(124, 20, "400", d.sub);
  return iconButton(d.color, d.dimmed ? `<g opacity="0.5">${body}</g>` : `<g>${body}</g>`);
}

/** Account a key shows: its bound config dir, else the n-th account for the n-th unbound key. */
export function pickAccount(
  accounts: AccountView[],
  configDir: string | undefined,
  unboundIndex: number,
): AccountView | undefined {
  return configDir ? accounts.find((a) => a.configDir === configDir) : accounts[unboundIndex];
}
