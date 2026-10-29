# Usage Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `Usage` Stream Deck action that shows, per locally logged-in Claude account (max two), 5-hour and 7-day plan utilization and a burn-rate forecast.

**Architecture:** Pure modules under `src/usage/` (account paths, credential read, API client, burn-rate maths, display model) feed a `UsagePoller` that owns per-account history and polling. `UsageButton` renders the poller's state; `SessionManager` announces each config directory it sees so the poller can discover accounts.

**Tech Stack:** TypeScript, `@elgato/streamdeck` ^2.0.4, Node 20, vitest, rollup. npm scripts only.

**Spec:** `docs/superpowers/specs/2026-10-29-usage-keys-design.md`

## Global Constraints

- Endpoint `GET https://api.anthropic.com/api/oauth/usage` with `Authorization: Bearer <token>` and `anthropic-beta: oauth-2025-04-20`; no request to any other host.
- Credential from Keychain service `Claude Code-credentials` (default dir `~/.claude`) or `Claude Code-credentials-<h>`, `<h>` = first 8 hex of SHA-256 of the absolute dir path, no trailing slash. `/Users/jhaustin/.claude-idealoft` -> `aa8500c9`.
- Credential checked every 60 s per account; request only if unexpired; never refreshed, cached beyond the request, logged, or written.
- After HTTP 429/401: wait 2, 4, 8 min ... capped 10 min; reset on success.
- History kept 2 h in memory. At most two accounts. Colours: below 70 neutral, 70-89 amber, 90+ red.
- A usage failure never alters, blocks, or delays hook responses, including PermissionRequest.
- Follow existing style: `@action` decorators, `ManagedAction`-style render-on-event, SVG via `src/util/svg.ts`.

## Review Focus

- `transcript_path` that is relative, empty, or lacks `/projects/`: no account added, no throw.
- Keychain read denied or item missing: treated like a 401 (backoff), not retried every 60 s, key shows `--` or stale.
- API body lacks `seven_day` or has `utilization: null`: that window shows `--`, never `NaN`.
- `resets_at` already in the past (clock skew): countdown shows `0m`, never negative.
- Two keys bound to the same account, and a third account seen: both keys render; the third account is ignored.

---

### Task 1: Account path helpers

**Files:**
- Create: `src/usage/accounts.ts`
- Test: `tests/usage/accounts.test.ts`

**Interfaces:**
- Produces:
  - `configDirFromTranscript(path: string | undefined): string | null`
  - `keychainService(configDir: string, home: string): string`
  - `accountLabel(configDir: string, home: string): string`

- [ ] **Step 1: Write failing tests**
  - `configDirFromTranscript("/Users/jhaustin/.claude-idealoft/projects/-x/abc.jsonl")` is `"/Users/jhaustin/.claude-idealoft"`.
  - Returns `null` for `undefined`, `""`, `"projects/x.jsonl"`, `"/tmp/no-marker.jsonl"`.
  - `keychainService("/Users/jhaustin/.claude", "/Users/jhaustin")` is `"Claude Code-credentials"`; with `.claude-idealoft` it is `"Claude Code-credentials-aa8500c9"`.
  - `accountLabel` gives `"default"` for `~/.claude`, `"idealoft"` for `~/.claude-idealoft`, and the basename for any other dir.
- [ ] **Step 2: Run `npx vitest run tests/usage/accounts.test.ts`; expect FAIL (module missing).**
- [ ] **Step 3: Implement the three functions** with `node:crypto` SHA-256 over the path string.
- [ ] **Step 4: Run the test; expect PASS.**
- [ ] **Step 5: Commit** `feat(usage): account path helpers`.

### Task 2: Credential and API access

**Files:**
- Create: `src/usage/credentials.ts`, `src/usage/api.ts`
- Test: `tests/usage/credentials.test.ts`, `tests/usage/api.test.ts`

**Interfaces:**
- Produces:
  - `interface Credential { accessToken: string; expiresAt: number; subscriptionType: string | null }` (`expiresAt` ms epoch), in `credentials.ts`
  - `readCredential(service: string, run?: (cmd: string, args: string[]) => Promise<string>): Promise<Credential | null>`; default `run` is `execFile("security", ["find-generic-password","-s",service,"-w"])`
  - in `api.ts`: `interface UsageWindow { utilization: number; resetsAt: number }`, `interface UsageReading { fiveHour: UsageWindow | null; sevenDay: UsageWindow | null }`, `class UsageHttpError extends Error { status: number }`, `fetchUsage(accessToken: string, fetchFn?: typeof fetch): Promise<UsageReading>`

- [ ] **Step 1: Write failing tests**
  - `readCredential` with a fake `run` returning `{"claudeAiOauth":{"accessToken":"t","expiresAt":1000,"subscriptionType":"team"}}` yields `{accessToken:"t",expiresAt:1000,subscriptionType:"team"}`.
  - Returns `null` when `run` rejects, when stdout is not JSON, and when `claudeAiOauth` is missing. A rejected error message never contains stdout.
  - `fetchUsage` with a fake fetch asserts URL, both headers, and maps `{"five_hour":{"utilization":88.0,"resets_at":"2026-10-30T00:29:59.782134+00:00"},"seven_day":null}` to `fiveHour:{utilization:88,resetsAt:Date.parse(...)}`, `sevenDay:null`.
  - A window with `utilization: null` maps to `null`. Status 429 and 401 throw `UsageHttpError` with that `status`.
- [ ] **Step 2: Run both tests; expect FAIL.**
- [ ] **Step 3: Implement** both files. `readCredential` must never log or include the token in any thrown value.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** `feat(usage): keychain credential read and usage client`.

### Task 3: Burn-rate maths

**Files:**
- Create: `src/usage/burn.ts`
- Test: `tests/usage/burn.test.ts`

**Interfaces:**
- Produces:
  - `interface Sample { t: number; fiveHour: number | null; sevenDay: number | null }`
  - `burnRatePerHour(samples: Sample[], key: "fiveHour" | "sevenDay", windowStart: number): number | null` (slope in percent/hour over samples with `t >= windowStart` and non-null value; `null` under two such samples)
  - `type Forecast = { kind: "ok" } | { kind: "exhaust"; at: number } | { kind: "unknown" }`
  - `forecast(utilization: number, ratePerHour: number | null, now: number, resetsAt: number): Forecast`

- [ ] **Step 1: Write failing tests**
  - Samples `(t=0h,50)`, `(t=1h,60)` give rate `10`; a sample before `windowStart` is ignored.
  - One sample, or all null, gives `null`.
  - `forecast(60, 10, now, resetsAt = now + 5h)` is `{kind:"exhaust", at: now + 4h}`; with `resetsAt = now + 2h` it is `{kind:"ok"}`.
  - Rate `0` or `-3` gives `{kind:"ok"}`; rate `null` gives `{kind:"unknown"}`.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** with a least-squares slope.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** `feat(usage): burn rate and forecast`.

### Task 4: UsagePoller

**Files:**
- Create: `src/usage/poller.ts`
- Test: `tests/usage/poller.test.ts` (vitest fake timers)

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces:
  - `interface AccountView { configDir: string; label: string; reading: UsageReading | null; readAt: number | null; samples: Sample[] }`
  - `interface PollerDeps { home: string; now(): number; readCredential(service: string): Promise<Credential | null>; fetchUsage(token: string): Promise<UsageReading>; loadAccounts(): Promise<string[]>; saveAccounts(dirs: string[]): Promise<void> }`
  - `class UsagePoller extends EventEmitter` with `constructor(deps: PollerDeps)`, `start(): Promise<void>` (loads saved accounts, polls now, then every 60 s), `stop(): void`, `noteConfigDir(dir: string): void`, `accounts(): AccountView[]`, `pollOnce(): Promise<void>`; emits `"updated"` after any account changes.

- [ ] **Step 1: Write failing tests**
  - Default `<home>/.claude` is always present; `noteConfigDir` adds new dirs in first-seen order, ignores a duplicate, and ignores a third non-default dir (max two accounts).
  - An expired credential makes no `fetchUsage` call and keeps the previous reading.
  - A successful poll stores the reading, sets `readAt`, appends a sample, and drops samples older than 2 h.
  - A 429 or 401 skips that account for 2 min, then 4, 8, 10, 10; a success resets the wait. A `null` credential (denied or missing) follows the same backoff.
  - One account throwing does not stop the other from polling.
  - `noteConfigDir` of a new dir calls `saveAccounts`; `start` restores accounts from `loadAccounts`.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.** No token is held past the request; log only account label and outcome, never the credential.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** `feat(usage): per-account usage poller`.

### Task 5: Key display model and rendering

**Files:**
- Create: `src/usage/display.ts`
- Test: `tests/usage/display.test.ts`

**Interfaces:**
- Consumes: `AccountView`, `forecast`, `burnRatePerHour`.
- Produces:
  - `type Metric = "fiveHour" | "sevenDay" | "forecast"`
  - `interface KeyDisplay { label: string; big: string; sub: string; color: string; dimmed: boolean }`
  - `usageDisplay(label: string, metric: Metric, account: AccountView | undefined, now: number): KeyDisplay`
  - `usageImage(d: KeyDisplay): string` (SVG data URI via `svgDataUri`)
  - `nextMetric(m: Metric): Metric` (fiveHour, sevenDay, forecast, back to fiveHour)

- [ ] **Step 1: Write failing tests**
  - 5-hour reading 88 with reset in 2 h 20 m: `big "88%"`, `sub "2h 20m"`, amber; 90 is red; 69 is neutral; 70 is amber.
  - No reading: `big "--"`. A reading whose `readAt` is 21 h old: `sub` contains `"stale 21h"` and `dimmed` is true.
  - Window null: `"--"`, never `NaN`. `resetsAt` in the past: `sub "0m"`.
  - Forecast: `ok` shows `"OK"`; `exhaust` shows time to exhaustion and is red when exhaustion precedes reset; `unknown` shows `"--"`.
  - `nextMetric` cycles all three and wraps.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** the thresholds from Global Constraints.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** `feat(usage): key display model`.

### Task 6: UsageButton, manifest, settings UI, wiring

**Files:**
- Create: `src/actions/usage-button.ts`, `com.paultyng.agentsd.sdPlugin/ui/usage.html`
- Modify: `src/session-manager.ts` (in `handleEvent`, after the session lookup), `src/plugin.ts`, `com.paultyng.agentsd.sdPlugin/manifest.json`
- Test: `tests/session-manager.test.ts` (add cases)

**Interfaces:**
- Consumes: `UsagePoller`, `usageDisplay`, `usageImage`, `nextMetric`, `configDirFromTranscript`.
- Produces:
  - `SessionManager` emits `"configDirSeen"` with the config dir string whenever an event payload's `transcript_path` yields one.
  - `export function setUsagePoller(p: UsagePoller): void` and `class UsageButton extends SingletonAction<{ configDir?: string; label?: string }>` for UUID `com.paultyng.agentsd.usage`.
  - Key behaviour: an unbound key takes `poller.accounts()[n]` where `n` is its order of appearance among unbound keys; a bound key uses its `configDir`; label from settings else `AccountView.label`. Each key holds its own `Metric`, starting `fiveHour`; press calls `nextMetric`. Re-render on poller `"updated"` and once per 30 s so countdowns advance.

- [ ] **Step 1: Write failing tests** in `session-manager.test.ts`: an event with `transcript_path: "/Users/x/.claude-idealoft/projects/p/s.jsonl"` emits `configDirSeen` with `/Users/x/.claude-idealoft`; an event without `transcript_path`, or with a path lacking `/projects/`, emits nothing.
- [ ] **Step 2: Run `npx vitest run tests/session-manager.test.ts`; expect FAIL.**
- [ ] **Step 3: Implement** the emit in `SessionManager.handleEvent`. It must not throw or delay the hook response.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Implement `UsageButton`**, add the manifest action (Keypad, `PropertyInspectorPath: "ui/usage.html"`, same fields as the Status action), and a plain-HTML settings page with two text inputs (`configDir`, `label`) using the SDK settings messages.
- [ ] **Step 6: Wire `plugin.ts`:** construct `UsagePoller` with real deps (`os.homedir()`, `Date.now`, `readCredential`, `fetchUsage`, and `streamDeck.settings.getGlobalSettings()/setGlobalSettings()` under the key `usageAccounts`); forward `sessionManager.on("configDirSeen", d => poller.noteConfigDir(d))`; `await poller.start()` after the hook server starts, and never before `hookServer.start()` resolves; `poller.stop()` in `shutdown`; register `UsageButton`.
- [ ] **Step 7: Run `npm run typecheck && npm test && npm run build`; expect all pass.**
- [ ] **Step 8: Commit** `feat(usage): Usage action and wiring`.

### Task 7: Live check

**Files:** none.

- [ ] **Step 1:** `npm run build`, then `streamdeck restart com.paultyng.agentsd`.
- [ ] **Step 2:** Back up `~/Library/Application Support/com.elgato.StreamDeck/ProfilesV3`, quit the Stream Deck app, add two `com.paultyng.agentsd.usage` actions at (0,1) and (0,2) of the Coding page `F4FD3EB7…`, reopen the app.
- [ ] **Step 3: Verify on the deck:** the Aterlo key matches the live `/api/oauth/usage` numbers at the same minute; the Idealoft key shows `stale` while its credential is expired and updates after a session runs under `~/.claude-idealoft`; a press cycles 5-hour, 7-day, forecast.
- [ ] **Step 4: Verify the invariants:** `grep -r accessToken` over the plugin log directory returns nothing; with the plugin stopped, a `claude -p` run still completes.
