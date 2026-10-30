import { EventEmitter } from "node:events";
import { join } from "node:path";
import { accountLabel, keychainService } from "./accounts";
import { UsageHttpError, type UsageReading } from "./api";
import type { Sample } from "./burn";
import type { Credential } from "./credentials";

const POLL_INTERVAL_MS = 300_000;
const HISTORY_MS = 2 * 3_600_000;
const BACKOFF_BASE_MS = 120_000;
const BACKOFF_MAX_MS = 600_000;
const MAX_ACCOUNTS = 2;
const READ_TIMEOUT_MS = 10_000;
const FETCH_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export interface AccountView {
  configDir: string;
  label: string;
  reading: UsageReading | null;
  /** Milliseconds since epoch of the last successful poll. */
  readAt: number | null;
  samples: Sample[];
}

export interface PollerDeps {
  home: string;
  now(): number;
  readCredential(service: string): Promise<Credential | null>;
  fetchUsage(token: string): Promise<UsageReading>;
  loadAccounts(): Promise<string[]>;
  saveAccounts(dirs: string[]): Promise<void>;
  /** Optional diagnostics; receives one line per outcome change, never a credential. */
  log?(message: string): void;
}

interface Entry {
  view: AccountView;
  failures: number;
  retryAt: number;
  lastOutcome: string | null;
}

/** Emits "updated" whenever an account's view or the account list changes. */
export class UsagePoller extends EventEmitter {
  private readonly entries: Entry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(private readonly deps: PollerDeps) {
    super();
    this.add(join(deps.home, ".claude"));
  }

  accounts(): AccountView[] {
    return this.entries.map((e) => e.view);
  }

  noteConfigDir(dir: string): void {
    if (!this.add(dir)) return;
    this.deps.saveAccounts(this.entries.map((e) => e.view.configDir)).catch(() => {});
    this.emit("updated");
  }

  async start(): Promise<void> {
    let saved: string[] = [];
    try {
      saved = (await this.deps.loadAccounts()).filter((d): d is string => typeof d === "string");
    } catch {
      // No saved accounts; discovery starts over from session events.
    }
    // Dirs noted before the saved list arrived rank after it, so a restart cannot displace a saved account.
    const earlier = this.entries.slice(1).map((e) => e.view.configDir);
    this.entries.length = 1;
    for (const dir of [...saved, ...earlier]) this.add(dir);
    if (earlier.some((d) => !saved.includes(d))) {
      this.deps.saveAccounts(this.entries.map((e) => e.view.configDir)).catch(() => {});
    }
    this.stop();
    this.timer = setInterval(() => void this.pollOnce(), POLL_INTERVAL_MS);
    await this.pollOnce();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await Promise.all(
        this.entries.map(async (e) => {
          if (await this.pollAccount(e).catch(() => false)) this.emit("updated");
        }),
      );
    } finally {
      this.polling = false;
    }
  }

  private add(dir: string): boolean {
    if (this.entries.some((e) => e.view.configDir === dir) || this.entries.length >= MAX_ACCOUNTS) return false;
    this.entries.push({
      view: { configDir: dir, label: accountLabel(dir, this.deps.home), reading: null, readAt: null, samples: [] },
      failures: 0,
      retryAt: 0,
      lastOutcome: null,
    });
    return true;
  }

  /** Returns true when the account's view changed. */
  private async pollAccount(entry: Entry): Promise<boolean> {
    const now = this.deps.now();
    if (now < entry.retryAt) return false;

    let cred: Credential | null;
    try {
      cred = await withTimeout(
        this.deps.readCredential(keychainService(entry.view.configDir, this.deps.home)),
        READ_TIMEOUT_MS,
      );
    } catch {
      return this.noCredential(entry, now);
    }
    if (!cred) return this.noCredential(entry, now);
    if (cred.expiresAt <= now) {
      this.note(entry, "credential expired");
      return false;
    }

    try {
      const reading = await withTimeout(this.deps.fetchUsage(cred.accessToken), FETCH_TIMEOUT_MS);
      entry.failures = 0;
      entry.retryAt = 0;
      entry.view.reading = reading;
      entry.view.readAt = now;
      entry.view.samples = [
        ...entry.view.samples.filter((s) => s.t >= now - HISTORY_MS),
        { t: now, fiveHour: reading.fiveHour?.utilization ?? null, sevenDay: reading.sevenDay?.utilization ?? null },
      ];
      this.note(entry, "ok");
      return true;
    } catch (err) {
      if (err instanceof UsageHttpError && (err.status === 429 || err.status === 401)) {
        this.fail(entry, now);
        this.note(entry, `HTTP ${err.status}, retry in ${(entry.retryAt - now) / 1000}s`);
        return false;
      }
      this.note(entry, "request failed");
      return false;
    }
  }

  private noCredential(entry: Entry, now: number): boolean {
    this.fail(entry, now);
    this.note(entry, "no credential (missing or denied)");
    return false;
  }

  private note(entry: Entry, outcome: string): void {
    if (outcome === entry.lastOutcome) return;
    entry.lastOutcome = outcome;
    this.deps.log?.(`usage ${entry.view.label}: ${outcome}`);
  }

  private fail(entry: Entry, now: number): boolean {
    entry.failures += 1;
    entry.retryAt = now + Math.min(BACKOFF_BASE_MS * 2 ** (entry.failures - 1), BACKOFF_MAX_MS);
    return false;
  }
}
