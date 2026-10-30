import { describe, expect, it, vi } from "vitest";
import { focusSessionTerminal } from "../../src/util/terminal";

describe("focusSessionTerminal", () => {
  it("looks up the pid's tty and focuses the Ghostty terminal with that tty", async () => {
    const osascript = vi.fn(async () => "ok");
    const ps = vi.fn(async () => "ttys003\n");
    expect(await focusSessionTerminal(40569, { ps, osascript })).toBe(true);
    expect(ps).toHaveBeenCalledWith(40569);
    expect(osascript.mock.calls[0][0]).toContain('"/dev/ttys003"');
  });

  it("returns false when no Ghostty terminal has that tty", async () => {
    expect(await focusSessionTerminal(1, { ps: async () => "ttys003", osascript: async () => "none" })).toBe(false);
  });

  it.each(["??", "", "ttys003\" & (do shell script \"x\") & \""])(
    "never runs AppleScript for tty output %j",
    async (out) => {
      const osascript = vi.fn(async () => "ok");
      expect(await focusSessionTerminal(1, { ps: async () => out, osascript })).toBe(false);
      expect(osascript).not.toHaveBeenCalled();
    },
  );

  it("returns false when ps or osascript fails", async () => {
    const boom = async () => { throw new Error("x"); };
    expect(await focusSessionTerminal(1, { ps: boom, osascript: async () => "ok" })).toBe(false);
    expect(await focusSessionTerminal(1, { ps: async () => "ttys003", osascript: boom })).toBe(false);
  });
});
