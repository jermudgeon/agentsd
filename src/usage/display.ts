import { dampedBurnRate, forecast } from "./burn";
import type { AccountView } from "./poller";
import { escapeXml, iconButton } from "../util/svg";

export type WindowKey = "fiveHour" | "sevenDay";

export interface KeyDisplay {
  label: string;
  big: string;
  ends: string;
  empty: string;
  color: string;
  dimmed: boolean;
}

const NEUTRAL = "#30363d";
const AMBER = "#d29922";
const RED = "#da3633";
const STALE_AFTER_MS = 12 * 60_000;
const HOUR_MS = 3_600_000;
const WINDOW_MS: Record<WindowKey, number> = { fiveHour: 5 * HOUR_MS, sevenDay: 7 * 24 * HOUR_MS };
const WINDOW_TAG: Record<WindowKey, string> = { fiveHour: "5h", sevenDay: "7d" };

/** Default account and window for the n-th unbound key: default 5h, default 7d, second 5h, second 7d. */
export function autoSlot(unboundIndex: number): { accountIndex: number; window: WindowKey } {
  return { accountIndex: Math.floor(unboundIndex / 2), window: unboundIndex % 2 === 0 ? "fiveHour" : "sevenDay" };
}

function clock(ms: number, now: number, tz?: string): string {
  const day = (t: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true })
    .format(ms)
    .replace(/\s?AM$/, "a")
    .replace(/\s?PM$/, "p");
  if (day(ms) === day(now)) return time;
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(ms);
  return `${weekday} ${time}`;
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

export function usageDisplay(
  label: string,
  key: WindowKey,
  account: AccountView | undefined,
  now: number,
  tz?: string,
): KeyDisplay {
  const tagged = `${label} ${WINDOW_TAG[key]}`;
  const blank: KeyDisplay = { label: tagged, big: "--", ends: "", empty: "", color: NEUTRAL, dimmed: false };
  const reading = account?.reading;
  if (!account || !reading || account.readAt === null) return blank;

  const stale = now - account.readAt > STALE_AFTER_MS;
  const staleText = `stale ${age(now - account.readAt)}`;
  const win = reading[key];
  if (!win) return { ...blank, ends: stale ? staleText : "", dimmed: stale };

  const base = { label: tagged, big: `${Math.round(win.utilization)}%`, empty: "" };
  const color = utilizationColor(win.utilization);
  if (stale) return { ...base, ends: staleText, color, dimmed: true };
  if (win.resetsAt === null) return { ...base, ends: "inactive", color, dimmed: false };
  if (win.resetsAt <= now) return { ...base, ends: "resetting", color, dimmed: false };

  const rate = dampedBurnRate({
    samples: account.samples,
    key,
    utilization: win.utilization,
    windowStart: win.resetsAt - WINDOW_MS[key],
    now,
  });
  const f = forecast(win.utilization, rate, now, win.resetsAt);
  return {
    ...base,
    ends: `ends ${clock(win.resetsAt, now, tz)}`,
    empty: f.kind === "exhaust" ? `empty ${clock(f.at, now, tz)}` : f.kind === "ok" ? "lasts" : "empty --",
    color: f.kind === "exhaust" ? RED : color,
    dimmed: false,
  };
}

function text(y: number, size: number, weight: string, content: string): string {
  return `<text x="72" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" ` +
    `fill="#ffffff" text-anchor="middle">${escapeXml(content)}</text>`;
}

export function usageImage(d: KeyDisplay): string {
  const body = text(24, 17, "600", d.label) + text(68, 40, "700", d.big) + text(100, 16, "400", d.ends) + text(124, 16, "400", d.empty);
  return iconButton(d.color, d.dimmed ? `<g opacity="0.5">${body}</g>` : `<g>${body}</g>`);
}

/** Account a key shows: its bound config dir, else the account at unboundIndex. */
export function pickAccount(
  accounts: AccountView[],
  configDir: string | undefined,
  unboundIndex: number,
  home = "",
): AccountView | undefined {
  if (!configDir) return accounts[unboundIndex];
  const dir = normalizeDir(configDir, home);
  return accounts.find((a) => a.configDir === dir);
}

function normalizeDir(dir: string, home: string): string {
  let d = dir.trim();
  if (home && (d === "~" || d.startsWith("~/"))) d = home + d.slice(1);
  return d.length > 1 ? d.replace(/\/+$/, "") : d;
}
