import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageHttpError, type UsageReading } from "../../src/usage/api";
import { UsagePoller, type PollerDeps } from "../../src/usage/poller";

const HOME = "/Users/jhaustin";
const DEFAULT_DIR = "/Users/jhaustin/.claude";
const IDEALOFT_DIR = "/Users/jhaustin/.claude-idealoft";
const MIN = 60_000;
const HOUR = 3_600_000;

const READING: UsageReading = {
  fiveHour: { utilization: 88, resetsAt: 5 * HOUR },
  sevenDay: { utilization: 66, resetsAt: 100 * HOUR },
};

function setup(over: Partial<PollerDeps> = {}) {
  let t = 1_000_000;
  const deps: PollerDeps = {
    home: HOME,
    now: () => t,
    readCredential: vi.fn(async (service: string) => ({
      accessToken: service,
      expiresAt: t + HOUR,
      subscriptionType: "pro",
    })),
    fetchUsage: vi.fn(async () => READING),
    loadAccounts: async () => [],
    saveAccounts: vi.fn(async () => {}),
    ...over,
  };
  return { deps, poller: new UsagePoller(deps), advance: (ms: number) => { t += ms; }, time: () => t };
}

describe("accounts", () => {
  it("always has the default dir first, adds new dirs in order, ignores duplicates and a third", () => {
    const { poller } = setup();
    expect(poller.accounts().map((a) => a.configDir)).toEqual([DEFAULT_DIR]);
    poller.noteConfigDir(IDEALOFT_DIR);
    poller.noteConfigDir(IDEALOFT_DIR);
    poller.noteConfigDir("/Users/jhaustin/.claude-third");
    expect(poller.accounts().map((a) => a.configDir)).toEqual([DEFAULT_DIR, IDEALOFT_DIR]);
    expect(poller.accounts().map((a) => a.label)).toEqual(["default", "idealoft"]);
  });

  it("saves when a new dir is noted and restores saved dirs on start", async () => {
    const { deps, poller } = setup();
    poller.noteConfigDir(IDEALOFT_DIR);
    expect(deps.saveAccounts).toHaveBeenCalledWith([DEFAULT_DIR, IDEALOFT_DIR]);

    const restored = setup({ loadAccounts: async () => [IDEALOFT_DIR] });
    await restored.poller.start();
    restored.poller.stop();
    expect(restored.poller.accounts().map((a) => a.configDir)).toEqual([DEFAULT_DIR, IDEALOFT_DIR]);
  });
});

describe("pollOnce", () => {
  it("stores the reading, readAt and a sample, and emits updated", async () => {
    const { poller, time } = setup();
    const updated = vi.fn();
    poller.on("updated", updated);
    await poller.pollOnce();
    const a = poller.accounts()[0];
    expect(a.reading).toEqual(READING);
    expect(a.readAt).toBe(time());
    expect(a.samples).toEqual([{ t: time(), fiveHour: 88, sevenDay: 66 }]);
    expect(updated).toHaveBeenCalled();
  });

  it("drops samples older than 2 hours", async () => {
    const { poller, advance, time } = setup();
    await poller.pollOnce();
    const first = time();
    advance(2 * HOUR + 1);
    await poller.pollOnce();
    expect(poller.accounts()[0].samples.map((s) => s.t)).toEqual([time()]);
    expect(first).not.toBe(time());
  });

  it("does not request usage with an expired credential and keeps the previous reading", async () => {
    let expired = false;
    const { deps, poller, time } = setup();
    deps.readCredential = vi.fn(async (service: string) => ({
      accessToken: service,
      expiresAt: expired ? time() - 1 : time() + HOUR,
      subscriptionType: "pro",
    }));
    await poller.pollOnce();
    expired = true;
    await poller.pollOnce();
    expect(deps.fetchUsage).toHaveBeenCalledTimes(1);
    expect(poller.accounts()[0].reading).toEqual(READING);
  });

  it("keeps polling the other account when one throws", async () => {
    const { deps, poller } = setup();
    deps.fetchUsage = vi.fn(async (token: string) => {
      if (token !== "Claude Code-credentials") throw new Error("boom");
      return READING;
    });
    poller.noteConfigDir(IDEALOFT_DIR);
    await poller.pollOnce();
    const [def, ide] = poller.accounts();
    expect(def.reading).toEqual(READING);
    expect(ide.reading).toBeNull();
  });
});

describe("pollOnce resilience", () => {
  it("keeps polling the other account when a credential read throws", async () => {
    const { deps, poller } = setup();
    deps.readCredential = vi.fn(async (service: string) => {
      if (service !== "Claude Code-credentials") throw new Error("keychain exploded");
      return { accessToken: service, expiresAt: Date.now() + HOUR, subscriptionType: "pro" };
    });
    poller.noteConfigDir(IDEALOFT_DIR);
    await expect(poller.pollOnce()).resolves.toBeUndefined();
    expect(poller.accounts()[0].reading).toEqual(READING);
  });
});

describe("backoff", () => {
  it.each([
    ["HTTP 429", () => new UsageHttpError(429)],
    ["HTTP 401", () => new UsageHttpError(401)],
  ])("waits 2, 4, 8, 10, 10 minutes after repeated %s, and resets on success", async (_n, mkErr) => {
    let fail = true;
    const { deps, poller, advance } = setup();
    deps.fetchUsage = vi.fn(async () => {
      if (fail) throw mkErr();
      return READING;
    });
    let calls = 0;
    for (const waitMin of [2, 4, 8, 10, 10]) {
      await poller.pollOnce();
      calls++;
      expect(deps.fetchUsage).toHaveBeenCalledTimes(calls);
      advance(waitMin * MIN - 1);
      await poller.pollOnce();
      expect(deps.fetchUsage).toHaveBeenCalledTimes(calls);
      advance(1);
    }
    fail = false;
    await poller.pollOnce();
    calls++;
    expect(deps.fetchUsage).toHaveBeenCalledTimes(calls);

    fail = true;
    advance(MIN);
    await poller.pollOnce();
    calls++;
    advance(2 * MIN - 1);
    await poller.pollOnce();
    expect(deps.fetchUsage).toHaveBeenCalledTimes(calls);
    advance(1);
    await poller.pollOnce();
    expect(deps.fetchUsage).toHaveBeenCalledTimes(calls + 1);
  });

  it("treats a denied or missing keychain item like a 401", async () => {
    const { deps, poller, advance } = setup({ readCredential: vi.fn(async () => null) });
    await poller.pollOnce();
    advance(2 * MIN - 1);
    await poller.pollOnce();
    expect(deps.readCredential).toHaveBeenCalledTimes(1);
    advance(1);
    await poller.pollOnce();
    expect(deps.readCredential).toHaveBeenCalledTimes(2);
    expect(deps.fetchUsage).not.toHaveBeenCalled();
  });
});

describe("start/stop", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("polls immediately and then every 60 seconds until stopped", async () => {
    const { deps, poller } = setup();
    await poller.start();
    expect(deps.readCredential).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.readCredential).toHaveBeenCalledTimes(2);
    poller.stop();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(deps.readCredential).toHaveBeenCalledTimes(2);
  });
});

describe("stalled dependencies", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("backs off an account whose credential read stalls, without blocking the other account", async () => {
    const { deps, poller, advance } = setup();
    deps.readCredential = vi.fn((service: string) =>
      service === "Claude Code-credentials"
        ? Promise.resolve({ accessToken: service, expiresAt: Date.now() + HOUR, subscriptionType: "pro" })
        : new Promise<never>(() => {}));
    poller.noteConfigDir(IDEALOFT_DIR);
    const updated = vi.fn();
    poller.on("updated", updated);

    const p = poller.pollOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(poller.accounts()[0].reading).toEqual(READING);
    expect(updated).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    expect(poller.accounts()[1].reading).toBeNull();

    advance(2 * MIN - 1);
    await poller.pollOnce();
    expect(deps.readCredential).toHaveBeenCalledTimes(3);
  });

  it("gives up on a stalled usage request after 15 seconds", async () => {
    const { deps, poller } = setup();
    deps.fetchUsage = vi.fn(() => new Promise<never>(() => {}));
    const p = poller.pollOnce();
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(p).resolves.toBeUndefined();
    expect(poller.accounts()[0].reading).toBeNull();
  });
});

describe("start-up race", () => {
  it("keeps saved accounts ahead of a dir noted before the saved list loads, and repairs the saved list", async () => {
    let release!: (dirs: string[]) => void;
    const loaded = new Promise<string[]>((r) => { release = r; });
    const { deps, poller } = setup({ loadAccounts: () => loaded });
    const started = poller.start();
    poller.noteConfigDir("/Users/jhaustin/.claude-other");
    release([IDEALOFT_DIR]);
    await started;
    poller.stop();
    expect(poller.accounts().map((a) => a.configDir)).toEqual([DEFAULT_DIR, IDEALOFT_DIR]);
    expect((deps.saveAccounts as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toEqual([DEFAULT_DIR, IDEALOFT_DIR]);
  });
});
