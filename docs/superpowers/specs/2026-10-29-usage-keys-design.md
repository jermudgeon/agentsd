# Usage keys for agentsd

## Purpose

The Stream Deck shows, for each locally logged-in Claude account (at most two), how much of its 5-hour and 7-day plan limits is used and whether the current burn rate will exhaust the limit before it resets. The keys are visible whenever the deck is showing the Coding profile, independent of which app is frontmost.

## Accounts

- An account is one Claude Code config directory: `~/.claude` (the default) or a directory named by `CLAUDE_CONFIG_DIR`, such as `~/.claude-idealoft`.
- The set of accounts is the default directory plus every config directory seen in the `transcript_path` of a session event, persisted in the plugin's Stream Deck global settings so it survives restarts. (Assumption: this discovery rule; the alternative is an explicit list in plugin settings.)
- A session's config directory is the part of its `transcript_path` before `/projects/`.
- At most two accounts are shown. Each Usage key is bound to one account through the key's settings; unbound keys take the accounts in order of first sight.
- An account's label defaults to the config directory name with the `.claude-` prefix removed (`idealoft`), or `default` for `~/.claude`. The label is editable in the key's settings.

## Credentials

- An account's OAuth credential is read from the macOS Keychain service `Claude Code-credentials` for the default directory, and `Claude Code-credentials-<h>` for any other directory, where `<h>` is the first 8 hex characters of the SHA-256 of the absolute directory path with no trailing slash (verified: `/Users/jhaustin/.claude-idealoft` gives `aa8500c9`).
- The credential is read on every poll, never cached beyond the request, never logged, and never written anywhere.
- The plugin never refreshes a credential. An expired credential is refreshed only by Claude Code itself, when that account is used.

## Data

- Each poll of an account is one `GET https://api.anthropic.com/api/oauth/usage` with the account's access token and `anthropic-beta: oauth-2025-04-20`.
- The fields used are `five_hour` and `seven_day`, each with `utilization` (percent used) and `resets_at` (ISO 8601 UTC), plus the plan type from the credential.
- Every known account's credential is checked every 5 minutes, independent of whether the account has an open session. The usage request is made only when the credential is unexpired, so an idle account's key resumes updating as soon as Claude Code refreshes its credential.
- After an HTTP 429 or 401 an account's next request waits 2, 4, 8 minutes and so on, capped at 10 minutes, and the wait resets on the next success.
- Each successful poll appends `(time, five_hour utilization, seven_day utilization)` to that account's in-memory history, kept for the trailing 2 hours.

## Burn rate

- Burn rate for a window is the slope of utilization over the retained samples inside the current window, in percent per hour. It is undefined with fewer than two samples or when the window has reset since the first sample.
- Projected exhaustion time is `now + (100 − utilization) / burn rate`. The forecast reads `OK` when exhaustion would fall after `resets_at` or the burn rate is zero or negative, shows time until exhaustion otherwise, and reads `--` when the burn rate is undefined.

## Usage key

- Each Usage key shows the account label, one metric as a large percentage, and a one-line subtitle. A press cycles the metric: 5-hour used, 7-day used, burn forecast. Each key holds its own metric, which resets to 5-hour used on restart.
- 5-hour and 7-day views show the countdown to `resets_at` as the subtitle. The forecast view shows `OK` or the time to exhaustion.
- The key's background colour follows the displayed utilization: below 70% neutral, 70% to 89% amber, 90% and above red. In the forecast view red means exhaustion is projected before reset.
- When the last good reading is older than 12 minutes (a poll failed, the credential is expired, or the endpoint is rate-limiting), the key shows the last known values dimmed with the age of that reading (`stale 21h`). With no reading yet it shows `--`.
- The key shows only what the API returned; it never estimates utilization from transcripts.

## Placement

- The plugin provides a `Usage` action in its Claude Code category. The user's own Coding profile on the 5x3 deck holds two Usage keys at (0,1) and (0,2); the plugin ships no profile.

## Invariants

- No credential value appears in any log, any file, or any key.
- No HTTP request is made to any host other than `api.anthropic.com`.
- A plugin or API failure never alters, blocks, or delays Claude Code hook responses, including PermissionRequest.
