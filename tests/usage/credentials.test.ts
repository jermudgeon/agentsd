import { describe, expect, it } from "vitest";
import { readCredential } from "../../src/usage/credentials";

const GOOD = JSON.stringify({
  claudeAiOauth: { accessToken: "t", expiresAt: 1000, subscriptionType: "team" },
});

describe("readCredential", () => {
  it("parses the keychain JSON and passes the service to security", async () => {
    let seen: { cmd: string; args: string[] } | undefined;
    const cred = await readCredential("Claude Code-credentials-aa8500c9", async (cmd, args) => {
      seen = { cmd, args };
      return GOOD;
    });
    expect(cred).toEqual({ accessToken: "t", expiresAt: 1000, subscriptionType: "team" });
    expect(seen).toEqual({
      cmd: "security",
      args: ["find-generic-password", "-s", "Claude Code-credentials-aa8500c9", "-w"],
    });
  });

  it("returns null when the keychain read rejects, without leaking the error", async () => {
    const cred = await readCredential("svc", async () => {
      throw new Error("SECRET-TOKEN-IN-ERROR");
    });
    expect(cred).toBeNull();
  });

  it("returns null when stdout is not JSON", async () => {
    expect(await readCredential("svc", async () => "not json")).toBeNull();
  });

  it("returns null when claudeAiOauth is missing", async () => {
    expect(await readCredential("svc", async () => "{}")).toBeNull();
  });

  it("returns null when accessToken or expiresAt is missing", async () => {
    const bad = JSON.stringify({ claudeAiOauth: { subscriptionType: "pro" } });
    expect(await readCredential("svc", async () => bad)).toBeNull();
  });
});
