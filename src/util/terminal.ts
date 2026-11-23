import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 5_000;

export interface TerminalDeps {
  ps(pid: number): Promise<string>;
  osascript(script: string): Promise<string>;
}

const defaultDeps: TerminalDeps = {
  ps: async (pid) => (await execFileAsync("ps", ["-o", "tty=", "-p", String(pid)], { timeout: TIMEOUT_MS })).stdout,
  osascript: async (script) => (await execFileAsync("osascript", ["-e", script], { timeout: TIMEOUT_MS })).stdout,
};

function focusScript(tty: string): string {
  return `
    tell application "Ghostty"
      activate
      repeat with t in terminals
        if (tty of t) is "/dev/${tty}" then
          focus t
          return "ok"
        end if
      end repeat
      return "none"
    end tell
  `;
}

/** Raise the Ghostty terminal that owns the given process. False when it cannot be found. */
export async function focusSessionTerminal(pid: number, deps: TerminalDeps = defaultDeps): Promise<boolean> {
  try {
    const tty = (await deps.ps(pid)).trim();
    if (!/^ttys\d+$/.test(tty)) return false;
    return (await deps.osascript(focusScript(tty))).trim() === "ok";
  } catch {
    return false;
  }
}

// Claude Code prefixes the terminal title with a status glyph and a space, such as "✳ " or "◐ ".
const TITLE_GLYPH = /^[^\p{L}\p{N}\s]+\s+/u;

/** Parse "<pid>|<title>" lines into pid -> title, dropping the status glyph. */
export function parseTerminalTitles(out: string): Map<number, string> {
  const titles = new Map<number, string>();
  for (const line of out.split("\n")) {
    const bar = line.indexOf("|");
    if (bar < 0) continue;
    const pid = Number(line.slice(0, bar));
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const title = line.slice(bar + 1).replace(TITLE_GLYPH, "").trim();
    if (title) titles.set(pid, title);
  }
  return titles;
}

// Checks that Ghostty is running first, so asking for titles never launches it.
const TITLES_SCRIPT = `
  if application "Ghostty" is running then
    tell application "Ghostty"
      set out to ""
      repeat with t in terminals
        set out to out & (pid of t) & "|" & (name of t) & linefeed
      end repeat
      return out
    end tell
  end if
  return ""
`;

/** Titles of all Ghostty terminals by the pid of their foreground process. Empty on any failure. */
export async function terminalTitles(deps: TerminalDeps = defaultDeps): Promise<Map<number, string>> {
  try {
    return parseTerminalTitles(await deps.osascript(TITLES_SCRIPT));
  } catch {
    return new Map();
  }
}
