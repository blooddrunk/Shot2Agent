# M3-L verification — 2026-10-20

Implementation: Windows Local Tauri 2/Vue 3 shell over the existing LocalApp, SQLite, Windows helper and Codex adapter. No HTTP server/Relay. See [Windows run guide](M3_WINDOWS_RUN.md). This record does not supersede M2 operator acceptance or claim M3 native acceptance.

## Executed and pending evidence

- Sync: `git fetch origin --prune` exit 0; origin/main `2e394df4a69336aa0b1b9d568b7466ae2af24dea`. Original working tree clean on `codex/m2-local-mvp`, HEAD `788c13b`. `git merge origin/main` exit 1: AGENTS.md Next goal conflict (expected conflict-free merge; observed M2-vs-M3 wording conflict). Resolved with current main instructions; commit `4a3b60c`. No reset/discard.
- First `corepack pnpm install --frozen-lockfile` exit 1: `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`; expected install, observed existing Windows/WSL modules-layout mismatch. `CI=true corepack pnpm install --frozen-lockfile` exit 0. This recreated generated dependencies only.
- Baseline `npm test`: exit 0, 78 total, 77 passed / 1 Windows-native skip.
- `npm run typecheck && npm run desktop:typecheck && npm run desktop:ui`: exit 0 (TypeScript, Vue, production Vite assets).
- Initial `npm run check`: exit 1, ESLint found one unused test import. Removed import; final rerun recorded below.
- `node --experimental-strip-types --test packages/desktop/test/*.test.mjs`: exit 0, 8 passed. Same production pipe transport and dispatcher, separate synthetic host, no production event injection endpoints. Tests include startup/opt-in/confirm/discard/new-image capture, duplicate/text, Smart/write/conflict/manual fallback, independent Markdown, settings backup/restart, error recovery, failure/unknown no replay, worker exclusion and EOF shutdown. Network/listener APIs throw inside this fixture.
- Windows packaging workflow builds Rust/MSVC and runs actual packaged EXE `--staging --smoke`: Rust-to-Node snapshot, rejected arbitrary command, clean quit; archive includes Node/native dependency runtime. Build evidence is recorded after execution; GUI tray/focus/paste are not inferred from smoke.

## Native operator observations

| Observation | Status | Evidence / next action |
| --- | --- | --- |
| New screenshot automatically queues and completes, confirmation/discard | NOT VERIFIED | Run isolated acceptance shortcut and guide step 1 |
| Notepad keeps foreground while background processing | NOT VERIFIED | Guide step 2 |
| Smart result pastes without Copy | NOT VERIFIED | Guide step 3 |
| Delayed Fake preserves newer text; explicit Copy fallback | NOT VERIFIED | Guide step 4 |
| Markdown + settings/history after GUI restart | NOT VERIFIED | Guide step 5 |
| Windows real Codex via desktop UI | NOT VERIFIED | Existing M2 proof retained; new shell has not been operator-observed |

## Deliberate bounds

Profile status/workspace/version is read-only; existing approved M2 profiles are reused. No task input or UI IPC can choose executable, credentials, workspace or sandbox. Execution-profile changes require stopped-app operator configuration, and old tasks retain original profile references. History displays most recent 50 items; older items remain in SQLite/CLI. Staged confirmation preview is memory-only and is discarded on close/settings/pause, with UI explanation. Source pause does not cancel already durable work. Smart after restart blocks old helper-session baselines. Explicit delivery retry never reruns execution. Worker liveness is conservatively PID-aware (PID reuse may refuse until the unrelated process exits); there is no age-based unsafe lock theft.

Installer/autostart, Remote/VPS, push, watched folders, batch editor and file clipboard remain excluded. Windows runtime requires WebView2 and logged-in session. Unsigned portable developer build is not a signed release installer.
