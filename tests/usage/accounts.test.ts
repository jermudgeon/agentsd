import { describe, expect, it } from "vitest";
import { accountLabel, configDirFromTranscript, keychainService } from "../../src/usage/accounts";

const HOME = "/Users/jhaustin";

describe("configDirFromTranscript", () => {
  it("returns the part before /projects/", () => {
    expect(configDirFromTranscript("/Users/jhaustin/.claude-idealoft/projects/-x/abc.jsonl"))
      .toBe("/Users/jhaustin/.claude-idealoft");
  });

  it("uses the last /projects/ so a config dir path may contain one", () => {
    expect(configDirFromTranscript("/Users/x/projects/claude-cfg/projects/-p/s.jsonl"))
      .toBe("/Users/x/projects/claude-cfg");
  });

  it("returns null for a non-string path instead of throwing", () => {
    expect(configDirFromTranscript(123 as unknown as string)).toBeNull();
  });

  it.each([undefined, "", "projects/x.jsonl", "/tmp/no-marker.jsonl", "relative/.claude/projects/x.jsonl"])(
    "returns null for %j",
    (p) => {
      expect(configDirFromTranscript(p)).toBeNull();
    },
  );
});

describe("keychainService", () => {
  it("is the unsuffixed service for the default dir", () => {
    expect(keychainService("/Users/jhaustin/.claude", HOME)).toBe("Claude Code-credentials");
  });

  it("suffixes with the first 8 hex of sha256 of the path for other dirs", () => {
    expect(keychainService("/Users/jhaustin/.claude-idealoft", HOME)).toBe("Claude Code-credentials-aa8500c9");
  });
});

describe("accountLabel", () => {
  it("is 'default' for ~/.claude", () => {
    expect(accountLabel("/Users/jhaustin/.claude", HOME)).toBe("default");
  });

  it("strips the .claude- prefix", () => {
    expect(accountLabel("/Users/jhaustin/.claude-idealoft", HOME)).toBe("idealoft");
  });

  it("falls back to the basename", () => {
    expect(accountLabel("/opt/work/claude-cfg", HOME)).toBe("claude-cfg");
  });
});
