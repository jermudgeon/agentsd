import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface Credential {
  accessToken: string;
  /** Milliseconds since epoch. */
  expiresAt: number;
  subscriptionType: string | null;
}

export type Run = (cmd: string, args: string[]) => Promise<string>;

const KEYCHAIN_TIMEOUT_MS = 10_000;

const defaultRun: Run = async (cmd, args) => (await execFileAsync(cmd, args, { timeout: KEYCHAIN_TIMEOUT_MS })).stdout;

/**
 * Read a Claude Code OAuth credential from the macOS Keychain.
 * Returns null on any failure; neither stdout nor error text is surfaced, so no token can leak.
 */
export async function readCredential(service: string, run: Run = defaultRun): Promise<Credential | null> {
  let stdout: string;
  try {
    stdout = await run("security", ["find-generic-password", "-s", service, "-w"]);
  } catch {
    return null;
  }
  try {
    const oauth = JSON.parse(stdout)?.claudeAiOauth;
    if (typeof oauth?.accessToken !== "string" || typeof oauth?.expiresAt !== "number") return null;
    return {
      accessToken: oauth.accessToken,
      expiresAt: oauth.expiresAt,
      subscriptionType: typeof oauth.subscriptionType === "string" ? oauth.subscriptionType : null,
    };
  } catch {
    return null;
  }
}
