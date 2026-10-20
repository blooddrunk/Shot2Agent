# M3-L verification — 2026-10-20

Implementation: Windows Local Tauri 2/Vue 3 shell over the existing LocalApp, SQLite, Windows helper and Codex adapter. No HTTP server/Relay. See [Windows run guide](M3_WINDOWS_RUN.md). This record does not supersede M2 operator acceptance or claim M3 native acceptance.

## Executed and pending evidence

- Sync: `git fetch origin --prune` exit 0; origin/main `2e394df4a69336aa0b1b9d568b7466ae2af24dea`. Original working tree clean on `codex/m2-local-mvp`, HEAD `788c13b`. `git merge origin/main` exit 1: AGENTS.md Next goal conflict (expected conflict-free merge; observed M2-vs-M3 wording conflict). Resolved with current main instructions; commit `4a3b60c`. No reset/discard.
- First `corepack pnpm install --frozen-lockfile` exit 1: `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`; expected install, observed existing Windows/WSL modules-layout mismatch. `CI=true corepack pnpm install --frozen-lockfile` exit 0. This recreated generated dependencies only.
- Baseline `npm test`: exit 0, 78 total, 77 passed / 1 Windows-native skip.
- `npm run typecheck && npm run desktop:typecheck && npm run desktop:ui`: exit 0 (TypeScript, Vue, production Vite assets).
- Initial `npm run check`: exit 1, ESLint found one unused test import. Removed import; final rerun recorded below.
- `node --experimental-strip-types --test packages/desktop/test/*.test.mjs`: exit 0, 11 passed after adding mock Codex success/nonzero exit/timeout through the pipe. Same production pipe transport and dispatcher, separate synthetic host, no production event injection endpoints. Tests include startup/opt-in/confirm/discard/new-image capture, duplicate/text, Smart/write/conflict/manual fallback, independent Markdown, settings backup/restart, error recovery, failure/unknown no replay, worker exclusion and EOF shutdown. Network/listener APIs throw inside this fixture.
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

## Windows CI stabilization

Initial matrix run [39438675745](https://github.com/blooddrunk/Shot2Agent/actions/runs/39438675745): Linux Node 22/24 passed. Windows `npm run check` exit 1, expected 89 passes; observed 87 passed / 2 failed with `snapshot condition timeout` (unknown/restart and EOF tests). Test-only clipboard fixture used non-atomic JSON replacement, allowing a poll during truncation. Fixed fixture publication with atomic rename. Replaced a short elapsed-time Fake running-state assumption with a fixture-controlled release gate; EOF is released by abort. Production capture logic is unchanged by this test correction. Windows synthetic native helper test itself passed. Final rerun recorded below.

Browser preview initially returned `ERR_CONNECTION_REFUSED` because navigation preceded server readiness; retried after Vite reported listening. Preview uses synthetic IPC data and is only rendering evidence.

Windows build initial run [39438675876](https://github.com/blooddrunk/Shot2Agent/actions/runs/39438675876): `npm run desktop:build` exit 1, Rust E0308 (`Result<Value, String>` expected, `Result<_, &str>` observed in pipe parser). Corrected conversion to owned String; rerun required. Runtime dependency packaging was additionally checked against package export restrictions and now resolves manifests via Node module search paths, preserving the frozen-lockfile dependency graph.

Final local `npm run check` after fixture/detail fixes: exit 0, 89 total / 88 passed / 0 failed / 1 native skip, plus lint, TS/Vue, builds and compiled smoke. `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml` exit 0. Fresh independent UI review scored the detail-selection finding resolved; delayed browser request check passed after rebuilt assets were reloaded. Browser screenshots are synthetic render evidence at 1040x760 and 720x560, not native proof.

Pipe startup review also identified that the parent handshake and first JSON request can arrive in one chunk. The shared handshake parser now preserves trailing bytes; process tests use the same gate and a dedicated coalescing/refusal test. Consent booleans now preserve explicit revocation when switching to confirm/manual; pause settings publish only after durable save. These are covered by the final check/CI rerun.
