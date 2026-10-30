import { describe, expect, it } from "vitest";
import { fetchUsage, UsageHttpError } from "../../src/usage/api";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; headers: Record<string, string>; signal?: AbortSignal | null }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, signal: init?.signal });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fn, calls };
}

describe("fetchUsage", () => {
  it("calls the usage endpoint with bearer token and beta header", async () => {
    const { fn, calls } = fakeFetch(200, {});
    await fetchUsage("tok", fn);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.anthropic.com/api/oauth/usage");
    expect(calls[0].headers.Authorization).toBe("Bearer tok");
    expect(calls[0].headers["anthropic-beta"]).toBe("oauth-2025-04-20");
  });

  it("passes an abort signal so a stalled request cannot hang the poll", async () => {
    const { fn, calls } = fakeFetch(200, {});
    await fetchUsage("tok", fn);
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("maps windows and nulls", async () => {
    const { fn } = fakeFetch(200, {
      five_hour: { utilization: 88.0, resets_at: "2026-10-30T00:29:59.782134+00:00" },
      seven_day: null,
    });
    const r = await fetchUsage("tok", fn);
    expect(r.fiveHour).toEqual({ utilization: 88, resetsAt: Date.parse("2026-10-30T00:29:59.782134+00:00") });
    expect(r.fiveHour!.resetsAt).toBe(Date.UTC(2026, 9, 30, 0, 29, 59, 782));
    expect(r.sevenDay).toBeNull();
  });

  it("keeps a window with utilization but no reset time (inactive window)", async () => {
    const { fn } = fakeFetch(200, { five_hour: { utilization: 0.0, resets_at: null }, seven_day: null });
    expect((await fetchUsage("tok", fn)).fiveHour).toEqual({ utilization: 0, resetsAt: null });
  });

  it("maps a window with null utilization to null", async () => {
    const { fn } = fakeFetch(200, { five_hour: { utilization: null, resets_at: "2026-10-30T00:29:59+00:00" } });
    expect((await fetchUsage("tok", fn)).fiveHour).toBeNull();
  });

  it.each([429, 401])("throws UsageHttpError with status %i", async (status) => {
    const { fn } = fakeFetch(status, { error: "x" });
    await expect(fetchUsage("tok", fn)).rejects.toMatchObject({ name: "UsageHttpError", status });
    await expect(fetchUsage("tok", fn)).rejects.toBeInstanceOf(UsageHttpError);
  });
});
