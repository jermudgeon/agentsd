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
