import { describe, expect, it, vi } from "vitest";
import { focusSessionTerminal, parseTerminalTitles, terminalTitles } from "../../src/util/terminal";

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

describe("parseTerminalTitles", () => {
  it("maps pid to the title with Claude Code's leading status glyph removed", () => {
    const out = "40569|✳ PRS-746: Drop inactive no-traffic services\n28189|◐ Stream Deck Claude status view\n";
    expect(parseTerminalTitles(out)).toEqual(new Map([
      [40569, "PRS-746: Drop inactive no-traffic services"],
      [28189, "Stream Deck Claude status view"],
    ]));
  });

  it("keeps a pipe inside a title", () => {
    expect(parseTerminalTitles("1|✳ a | b").get(1)).toBe("a | b");
  });

  it("skips malformed lines and titles that are empty once cleaned", () => {
    const out = "garbage\nabc|title\n7|✳ \n8|\n9|plain title";
    expect(parseTerminalTitles(out)).toEqual(new Map([[9, "plain title"]]));
  });
});

describe("terminalTitles", () => {
  it("runs one AppleScript that does not launch Ghostty and parses its output", async () => {
    const osascript = vi.fn(async () => "40569|✳ PRS-746\n");
    const titles = await terminalTitles({ ps: async () => "", osascript });
    expect(titles.get(40569)).toBe("PRS-746");
    expect(osascript.mock.calls[0][0]).toContain('application "Ghostty" is running');
  });

  it("returns an empty map when osascript fails", async () => {
    const titles = await terminalTitles({ ps: async () => "", osascript: async () => { throw new Error("x"); } });
    expect(titles.size).toBe(0);
  });
});
