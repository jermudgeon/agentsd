import { createHash } from "node:crypto";
import { basename, join } from "node:path";

const PROJECTS_MARKER = "/projects/";
const KEYCHAIN_BASE = "Claude Code-credentials";

/** Config dir of the session that wrote this transcript: the absolute part before `/projects/`. */
export function configDirFromTranscript(path: string | undefined): string | null {
  if (!path || !path.startsWith("/")) return null;
  const idx = path.indexOf(PROJECTS_MARKER);
  return idx > 0 ? path.slice(0, idx) : null;
}

/** Keychain service holding the OAuth credential for a Claude Code config dir. */
export function keychainService(configDir: string, home: string): string {
  if (configDir === join(home, ".claude")) return KEYCHAIN_BASE;
  const hash = createHash("sha256").update(configDir).digest("hex").slice(0, 8);
  return `${KEYCHAIN_BASE}-${hash}`;
}

export function accountLabel(configDir: string, home: string): string {
  if (configDir === join(home, ".claude")) return "default";
  const name = basename(configDir);
  const stripped = name.replace(/^\.claude-/, "");
  return stripped || name;
}
