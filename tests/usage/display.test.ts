import { describe, expect, it } from "vitest";
import type { Sample } from "../../src/usage/burn";
import { nextMetric, usageDisplay, usageImage } from "../../src/usage/display";
import type { AccountView } from "../../src/usage/poller";

const H = 3_600_000;
const M = 60_000;
const NOW = 100 * H;

function account(over: Partial<AccountView> & { five?: number | null; fiveResetsIn?: number; sevenResetsIn?: number } = {}): AccountView {
  const five = over.five === undefined ? 88 : over.five;
  return {
    configDir: "/Users/x/.claude",
    label: "default",
    reading: {
      fiveHour: five === null ? null : { utilization: five, resetsAt: NOW + (over.fiveResetsIn ?? 2 * H + 20 * M) },
      sevenDay: { utilization: 66, resetsAt: NOW + (over.sevenResetsIn ?? 5 * 24 * H + 7 * H) },
    },
    readAt: NOW,
    samples: [],
    ...over,
  };
}

describe("usageDisplay: 5-hour and 7-day", () => {
  it("shows percent, countdown and amber for 88%", () => {
    expect(usageDisplay("work", "fiveHour", account(), NOW)).toEqual({
      label: "work", big: "88%", sub: "2h 20m", color: "#d29922", dimmed: false,
    });
  });

  it.each([[69, "#30363d"], [70, "#d29922"], [89, "#d29922"], [90, "#da3633"]])(
    "colours %i%% as %s",
    (pct, color) => {
      expect(usageDisplay("a", "fiveHour", account({ five: pct }), NOW).color).toBe(color);
    },
  );

  it("shows the 7-day window with a day countdown", () => {
    const d = usageDisplay("a", "sevenDay", account(), NOW);
    expect(d.big).toBe("66%");
    expect(d.sub).toBe("5d 7h");
  });

  it("shows -- with no account or no reading", () => {
    expect(usageDisplay("a", "fiveHour", undefined, NOW).big).toBe("--");
    expect(usageDisplay("a", "fiveHour", { ...account(), reading: null, readAt: null }, NOW).big).toBe("--");
  });

  it("shows -- for a null window, never NaN", () => {
    const d = usageDisplay("a", "fiveHour", account({ five: null }), NOW);
    expect(d.big).toBe("--");
    expect(JSON.stringify(d)).not.toContain("NaN");
  });

  it("shows 0m when resetsAt is in the past", () => {
    expect(usageDisplay("a", "fiveHour", account({ fiveResetsIn: -5 * M }), NOW).sub).toBe("0m");
  });

  it("dims and shows the reading age when stale", () => {
    const d = usageDisplay("a", "fiveHour", { ...account(), readAt: NOW - 21 * H }, NOW);
    expect(d.big).toBe("88%");
    expect(d.sub).toBe("stale 21h");
    expect(d.dimmed).toBe(true);
  });

  it("is not stale within 3 minutes", () => {
    expect(usageDisplay("a", "fiveHour", { ...account(), readAt: NOW - 3 * M }, NOW).dimmed).toBe(false);
    expect(usageDisplay("a", "fiveHour", { ...account(), readAt: NOW - 3 * M - 1 }, NOW).dimmed).toBe(true);
  });
});

describe("usageDisplay: forecast", () => {
  const rising: Sample[] = [{ t: NOW - 30 * M, fiveHour: 50, sevenDay: null }, { t: NOW, fiveHour: 60, sevenDay: null }];

  it("shows time to exhaustion in red when it comes before the reset", () => {
    const d = usageDisplay("a", "forecast", account({ five: 60, fiveResetsIn: 4 * H, samples: rising }), NOW);
    expect(d).toMatchObject({ big: "2h 0m", sub: "to empty", color: "#da3633" });
  });

  it("shows OK when the reset comes first", () => {
    const d = usageDisplay("a", "forecast", account({ five: 60, fiveResetsIn: H, samples: rising }), NOW);
    expect(d).toMatchObject({ big: "OK", color: "#30363d" });
  });

  it("shows -- when there is too little data", () => {
    expect(usageDisplay("a", "forecast", account({ five: 60 }), NOW).big).toBe("--");
  });
});

describe("nextMetric", () => {
  it("cycles and wraps", () => {
    expect(nextMetric("fiveHour")).toBe("sevenDay");
    expect(nextMetric("sevenDay")).toBe("forecast");
    expect(nextMetric("forecast")).toBe("fiveHour");
  });
});

describe("usageImage", () => {
  const decode = (uri: string) => decodeURIComponent(uri.slice("data:image/svg+xml,".length));

  it("renders an escaped SVG data URI containing the label and value", () => {
    const svg = decode(usageImage({ label: "a&b", big: "88%", sub: "2h", color: "#d29922", dimmed: false }));
    expect(svg).toContain("a&amp;b");
    expect(svg).toContain("88%");
    expect(svg).toContain("#d29922");
    expect(svg).not.toContain('opacity="0.5"');
  });

  it("dims with opacity", () => {
    expect(decode(usageImage({ label: "a", big: "1%", sub: "", color: "#30363d", dimmed: true }))).toContain('opacity="0.5"');
  });
});
