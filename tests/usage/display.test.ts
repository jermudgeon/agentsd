import { describe, expect, it } from "vitest";
import type { Sample } from "../../src/usage/burn";
import { autoSlot, pickAccount, usageDisplay, usageImage } from "../../src/usage/display";
import type { AccountView } from "../../src/usage/poller";

const H = 3_600_000;
const M = 60_000;
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const TZ = "UTC";
const NEUTRAL = "#30363d";
const AMBER = "#d29922";
const RED = "#da3633";

interface Over {
  five?: number | null;
  fiveResetsAt?: number | null;
  seven?: number;
  sevenResetsAt?: number;
  samples?: Sample[];
  readAt?: number | null;
  label?: string;
  configDir?: string;
}

function account(o: Over = {}): AccountView {
  return {
    configDir: o.configDir ?? "/Users/x/.claude",
    label: o.label ?? "default",
    reading: {
      fiveHour: o.five === null ? null : { utilization: o.five ?? 60, resetsAt: o.fiveResetsAt === undefined ? NOW + 3 * H : o.fiveResetsAt },
      sevenDay: { utilization: o.seven ?? 48, resetsAt: o.sevenResetsAt ?? NOW + 5 * 24 * H },
    },
    readAt: o.readAt === undefined ? NOW : o.readAt,
    samples: o.samples ?? [],
  };
}

const five = (a: AccountView | undefined) => usageDisplay("default", "fiveHour", a, NOW, TZ);
const seven = (a: AccountView | undefined) => usageDisplay("default", "sevenDay", a, NOW, TZ);

describe("usageDisplay: 5-hour", () => {
  it("shows the end time and the projected empty time, red when it runs out first", () => {
    expect(five(account())).toEqual({
      label: "default 5h", big: "60%", ends: "ends 3:00p", empty: "empty 1:20p", color: RED, dimmed: false,
    });
  });

  it("says lasts when the reset comes first, and stays neutral", () => {
    expect(five(account({ five: 30 }))).toMatchObject({ big: "30%", empty: "lasts", color: NEUTRAL });
  });

  it("damps the projection with the recent rate", () => {
    const samples: Sample[] = [
      { t: NOW - 30 * M, fiveHour: 50, sevenDay: null },
      { t: NOW, fiveHour: 60, sevenDay: null },
    ];
    expect(five(account({ samples })).empty).toBe("empty 1:36p");
  });

  it.each([[69, NEUTRAL], [70, AMBER], [89, AMBER], [90, RED]])("colours %i%% as %s when the reset is imminent", (pct, color) => {
    expect(five(account({ five: pct, fiveResetsAt: NOW + 10 * M })).color).toBe(color);
  });

  it("shows -- for the projection in the first minutes of a window", () => {
    expect(five(account({ five: 5, fiveResetsAt: NOW + 5 * H - 3 * M })).empty).toBe("empty --");
  });

  it("shows an inactive window as 0% with no projection", () => {
    expect(five(account({ five: 0, fiveResetsAt: null }))).toMatchObject({ big: "0%", ends: "inactive", empty: "", color: NEUTRAL });
  });

  it("shows resetting when the reset time has passed", () => {
    expect(five(account({ fiveResetsAt: NOW - 5 * M }))).toMatchObject({ ends: "resetting", empty: "" });
  });
});

describe("usageDisplay: 7-day", () => {
  it("shows the weekday for a reset and projection on another day", () => {
    expect(seven(account())).toEqual({
      label: "default 7d", big: "48%", ends: "ends Wed 12:00p", empty: "empty Sun 4:00p", color: RED, dimmed: false,
    });
  });
});

describe("usageDisplay: no data", () => {
  it("shows -- with no account or no reading", () => {
    expect(five(undefined)).toMatchObject({ big: "--", ends: "", empty: "" });
    expect(five({ ...account(), reading: null, readAt: null })).toMatchObject({ big: "--", ends: "", empty: "" });
  });

  it("shows -- for a null window, never NaN", () => {
    const d = five(account({ five: null }));
    expect(d.big).toBe("--");
    expect(JSON.stringify(d)).not.toContain("NaN");
  });
});

describe("usageDisplay: stale", () => {
  it("dims and shows the reading age in place of the end and projection", () => {
    expect(five(account({ readAt: NOW - 21 * H }))).toMatchObject({ big: "60%", ends: "stale 21h", empty: "", dimmed: true });
  });

  it("is not stale within 12 minutes", () => {
    expect(five(account({ readAt: NOW - 12 * M })).dimmed).toBe(false);
    expect(five(account({ readAt: NOW - 12 * M - 1 })).dimmed).toBe(true);
  });
});

describe("autoSlot", () => {
  it("fills default 5h, default 7d, second 5h, second 7d", () => {
    expect([0, 1, 2, 3].map(autoSlot)).toEqual([
      { accountIndex: 0, window: "fiveHour" },
      { accountIndex: 0, window: "sevenDay" },
      { accountIndex: 1, window: "fiveHour" },
      { accountIndex: 1, window: "sevenDay" },
    ]);
  });
});

describe("pickAccount", () => {
  const a = { ...account(), configDir: "/a" };
  const b = { ...account(), configDir: "/b" };

  it("returns the account bound by configDir", () => {
    expect(pickAccount([a, b], "/b", 0)).toBe(b);
  });

  it("lets two keys bind the same account", () => {
    expect(pickAccount([a, b], "/a", 0)).toBe(a);
    expect(pickAccount([a, b], "/a", 1)).toBe(a);
  });

  it("returns undefined for a bound dir that is not an account", () => {
    expect(pickAccount([a, b], "/nope", 0)).toBeUndefined();
  });

  it("matches a typed dir written with ~ or a trailing slash", () => {
    const home = "/Users/x";
    const idealoft = { ...account(), configDir: "/Users/x/.claude-idealoft" };
    expect(pickAccount([a, idealoft], "~/.claude-idealoft", 0, home)).toBe(idealoft);
    expect(pickAccount([a, idealoft], "/Users/x/.claude-idealoft/", 0, home)).toBe(idealoft);
  });

  it("gives unbound keys the accounts in order, and nothing past the last", () => {
    expect(pickAccount([a, b], undefined, 0)).toBe(a);
    expect(pickAccount([a, b], "", 1)).toBe(b);
    expect(pickAccount([a, b], undefined, 2)).toBeUndefined();
  });
});

describe("usageImage", () => {
  const decode = (uri: string) => decodeURIComponent(uri.slice("data:image/svg+xml,".length));
  const d = { label: "a&b 5h", big: "88%", ends: "ends 3:00p", empty: "empty 1:20p", color: RED, dimmed: false };

  it("renders an escaped SVG data URI with every line", () => {
    const svg = decode(usageImage(d));
    for (const part of ["a&amp;b 5h", "88%", "ends 3:00p", "empty 1:20p", RED]) expect(svg).toContain(part);
    expect(svg).not.toContain('opacity="0.5"');
  });

  it("dims with opacity", () => {
    expect(decode(usageImage({ ...d, dimmed: true }))).toContain('opacity="0.5"');
  });
});
