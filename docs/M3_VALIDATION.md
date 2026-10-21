# M3-L verification — 2026-10-20

Implementation: Windows Local Tauri 2/Vue 3 shell over the existing LocalApp, SQLite, Windows helper and Codex adapter. No HTTP server/Relay. See [Windows run guide](M3_WINDOWS_RUN.md). M2 operator acceptance is preserved. M3 desktop operator acceptance is recorded on 2026-10-21 below; historical sections retain the verification status at their execution time.

## Executed and pending evidence

- Sync: `git fetch origin --prune` exit 0; origin/main `2e394df4a69336aa0b1b9d568b7466ae2af24dea`. Original working tree clean on `codex/m2-local-mvp`, HEAD `788c13b`. `git merge origin/main` exit 1: AGENTS.md Next goal conflict (expected conflict-free merge; observed M2-vs-M3 wording conflict). Resolved with current main instructions; commit `4a3b60c`. No reset/discard.
- First `corepack pnpm install --frozen-lockfile` exit 1: `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`; expected install, observed existing Windows/WSL modules-layout mismatch. `CI=true corepack pnpm install --frozen-lockfile` exit 0. This recreated generated dependencies only.
- Baseline `npm test`: exit 0, 78 total, 77 passed / 1 Windows-native skip.
- `npm run typecheck && npm run desktop:typecheck && npm run desktop:ui`: exit 0 (TypeScript, Vue, production Vite assets).
- Initial `npm run check`: exit 1, ESLint found one unused test import. Removed import; final rerun recorded below.
- `node --experimental-strip-types --test packages/desktop/test/*.test.mjs`: exit 0, 11 passed after adding mock Codex success/nonzero exit/timeout through the pipe. Same production pipe transport and dispatcher, separate synthetic host, no production event injection endpoints. Tests include startup/opt-in/confirm/discard/new-image capture, duplicate/text, Smart/write/conflict/manual fallback, independent Markdown, settings backup/restart, error recovery, failure/unknown no replay, worker exclusion and EOF shutdown. Network/listener APIs throw inside this fixture.
- Windows packaging workflow builds Rust/MSVC and runs actual packaged EXE `--staging --smoke`: Rust-to-Node snapshot, rejected arbitrary command, clean quit; archive includes Node/native dependency runtime. Build evidence is recorded after execution; GUI tray/focus/paste are not inferred from smoke.

## Operator acceptance — 2026-10-21

**M3-L's six requested desktop observations are operator-reported PASS**, with the Smart/input-method caveat below. This is user observation, not an independently repeated GUI run by the agent. The user followed the preceding desktop guide and did not separately re-report the exact executable hash or active adapter; do not infer a new authenticated real-Codex desktop test from this feedback. Previously delivered build identity is recorded later in this document.

| Observation | Status | Operator evidence |
| --- | --- | --- |
| Fresh screenshot automatically submits without a Submit action | PASS | Item 1 reported PASS |
| Notepad retains foreground focus during capture/processing | PASS | Item 2 reported PASS |
| Smart result actually pastes without Copy | PASS, environment caveat | Item 3 reported PASS; substantially more reliable after switching away from WeChat Input Method |
| Newer text is preserved; manual Copy then returns result | PASS | Item 4 reported PASS |
| Markdown save and settings/history survive GUI restart | PASS | Item 5 reported PASS |
| Pause/resume ignores paused contents and accepts a fresh capture | PASS | Item 6 reported PASS |
| Confirmation/discard GUI observations | NOT VERIFIED | Not separately included in the six reported observations; automated coverage remains |
| Authenticated real Codex through desktop UI | NOT VERIFIED | Active adapter was not separately identified in this feedback; retain the earlier M2 evidence at its own scope |

### Smart / clipboard-sync observation

The operator reported frequent initially empty clipboard contents with `blocked_by_clipboard_change`, occasional success, and a possible association with WeChat Input Method's cross-device clipboard synchronization. After switching away from that input method, behavior was largely reliable. Preserve this as an operator-observed association; neither the external component as root cause nor universal input-method compatibility is established. The initial intermittent behavior is not erased by the overall PASS report.

The current Smart decision uses the Windows clipboard sequence and helper session. Another writer may change that sequence even if the user did not deliberately copy new content. A blocked comparison does not write on that comparison branch, but the receipt alone does not prove who emptied the clipboard or reveal whether an earlier native write attempt failed; no content capture or timing trace was collected. Do not describe this as a confirmed third-party defect or a resolved application defect.

The feedback raises a bounded follow-up proposal: configurable retry limits/backoff for eligible transient delivery failures, clearer refusal/failure diagnostics, and explicit Agent rerun controls. See [retry policy proposal](RESULT_DELIVERY.md#local-retry-policy-current-behavior-and-proposal). This acceptance update changes documentation only; it does not add retries, relax Smart protection or rerun user tasks.

## Deliberate bounds

Profile status/workspace/version is read-only; existing approved M2 profiles are reused. No task input or UI IPC can choose executable, credentials, workspace or sandbox. Execution-profile changes require stopped-app operator configuration, and old tasks retain original profile references. History displays most recent 50 items; older items remain in SQLite/CLI. Staged confirmation preview is memory-only and is discarded on close/settings/pause, with UI explanation. Source pause does not cancel already durable work. Smart after restart blocks old helper-session baselines. Explicit delivery retry never reruns execution. Worker liveness is conservatively PID-aware (PID reuse may refuse until the unrelated process exits); there is no age-based unsafe lock theft.

Installer/autostart, Remote/VPS, push, watched folders, batch editor and file clipboard remain excluded. Windows runtime requires WebView2 and logged-in session. Unsigned portable developer build is not a signed release installer.

## Windows CI stabilization

Initial matrix run [39438675745](https://github.com/blooddrunk/Shot2Agent/actions/runs/39438675745): Linux Node 22/24 passed. Windows `npm run check` exit 1, expected 89 passes; observed 87 passed / 2 failed with `snapshot condition timeout` (unknown/restart and EOF tests). Test-only clipboard fixture used non-atomic JSON replacement, allowing a poll during truncation. Fixed fixture publication with atomic rename. Replaced a short elapsed-time Fake running-state assumption with a fixture-controlled release gate; EOF is released by abort. Production capture logic is unchanged by this test correction. Windows synthetic native helper test itself passed. Final rerun recorded below.

Browser preview initially returned `ERR_CONNECTION_REFUSED` because navigation preceded server readiness; retried after Vite reported listening. Preview uses synthetic IPC data and is only rendering evidence.

Windows build initial run [39438675876](https://github.com/blooddrunk/Shot2Agent/actions/runs/39438675876): `npm run desktop:build` exit 1, Rust E0308 (`Result<Value, String>` expected, `Result<_, &str>` observed in pipe parser). Corrected conversion to owned String; rerun required. Runtime dependency packaging was additionally checked against package export restrictions and now resolves manifests via Node module search paths, preserving the frozen-lockfile dependency graph.

Final local `npm run check` after fixture/detail fixes: exit 0, 89 total / 88 passed / 0 failed / 1 native skip, plus lint, TS/Vue, builds and compiled smoke. `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml` exit 0. Fresh independent UI review scored the detail-selection finding resolved; delayed browser request check passed after rebuilt assets were reloaded. Browser screenshots are synthetic render evidence at 1040x760 and 720x560, not native proof.

Pipe startup review also identified that the parent handshake and first JSON request can arrive in one chunk. The shared handshake parser now preserves trailing bytes; process tests use the same gate and a dedicated coalescing/refusal test. Consent booleans now preserve explicit revocation when switching to confirm/manual; pause settings publish only after durable save. These are covered by the final check/CI rerun.

## Final automated gate

- `corepack pnpm install --frozen-lockfile`: exit 0 after dependency layout recreation, lockfile respected.
- `npm run check` (final source, including handshake and consent handling): exit 0, **90 total / 89 passed / 0 failed / 1 native Windows skip** in WSL. Lint, TS/Vue typecheck, core/production frontend builds and compiled fresh-cwd Fake smoke all exit 0.
- `node --experimental-strip-types --test packages/desktop/test/*.test.mjs`: 12 desktop cases in the final full suite; production dispatcher/transport/startup gate reused. Synthetic fixture publication is atomic and delayed Fake completion is explicitly released rather than raced.
- Browser rendering and delayed detail selection use synthetic IPC at 1040x760 and 720x560. A stale-assets browser assertion initially failed before reload (`DETAIL_SELECTION_NOT_DISABLED`); rebuilding/reloading the new script and repeating passed. This was not counted as native evidence. Temporary browser preview server was stopped after checks.
- Native executable smoke now checks natural Node exit and kills the Node child deliberately inside its isolated developer path; a Windows Job query must confirm zero active descendants. No fault-injection command exists in product IPC. Transport failure terminates the whole Job immediately; it does not leave an Agent running until the user quits.

Final source commit for Windows build validation: `0c3bc6ac232ac50c2dafe5f521df9d67a4e369bb`. Documentation may be committed after this source hash without changing executable code. Final CI links/results and downloaded package receipt follow after completion.

## Final Windows CI evidence

- [Four-platform/runtime matrix, source 0c3bc6a](https://github.com/blooddrunk/Shot2Agent/actions/runs/39440674547): **PASS**, Windows/Linux × Node 22/24; `npm run check` exit 0 in all four jobs. Windows Node 24 reports **90/90 pass**, no skips, including native clipboard helper. Linux reports 89 pass / 1 native skip. No live Codex credentials needed.
- [Windows desktop package, source 0c3bc6a](https://github.com/blooddrunk/Shot2Agent/actions/runs/39440674074): `npm run desktop:build` **PASS**, release compile 4m18s; `npm run desktop:package` **PASS**; actual packaged EXE smoke **PASS**, exit 0. Receipt: `PASS packaged IPC, refusal, natural quit, unexpected coordinator death and descendant cleanup`. Artifact upload succeeded.
- Earlier `df2675f` package compiled and packaged successfully but smoke exited 1; that build is not shipped. Its missing first pipe request was corrected by the coalescing-safe handshake in f24ef43, and the final 0c3bc6a EXE passed the expanded smoke. Obsolete duplicate push/PR runs were cancelled; workflow concurrency now keeps only the latest branch run. Cancelled runs are not passes.
- Portable artifact `Shot2Agent-Windows-x64.zip` embeds `BUILD.txt` with source SHA and Node version and `SMOKE.txt` with the native smoke receipt. The validated source is preserved even when this evidence-only documentation receives a later commit. Native user observations in the table remain NOT VERIFIED.

## Downloaded runnable package / this Windows machine

- Download: `gh run download 39440674074 --name Shot2Agent-Windows-x64 --dir build/ci-download`, exit 0; ZIP extracted to `build/Shot2Agent` without executing GUI capture.
- Archive: `build/ci-download/Shot2Agent-Windows-x64.zip`, **47,902,213 bytes**, SHA256 `46120ec65e568806de66664269202d0b7e00499d6ea39cd797784261a03e8619`.
- EXE: `build/Shot2Agent/Shot2Agent.exe`, SHA256 `8aa467710276ccb5f27964eb624d0b845a25c8dfeba9987ded83c36abc1dcdb6`.
- `BUILD.txt` reports Node **v24.21.0**, version **0.3.0**, checkout **ef6b07e2887deefb02ddba80547cd16215ae3c91**. This is GitHub's PR merge snapshot, verified parents: main `2e394df4a69336aa0b1b9d568b7466ae2af24dea` and feature source `0c3bc6ac232ac50c2dafe5f521df9d67a4e369bb`; it is not a merged PR/release claim.
- Local native command (PowerShell): `Start-Process -FilePath 'D:\code\projects\Shot2Agent\build\Shot2Agent\Shot2Agent.exe' -ArgumentList '--staging','--smoke' -PassThru`, followed by bounded 45-second `WaitForExit` and reading `SMOKE.txt`: exit **0**, `PASS packaged IPC, refusal, natural quit, unexpected coordinator death and descendant cleanup`. Observed Windows version **10.0.26300.0**. This does not start/certify GUI capture, focus or paste.
- Exact operator launch: double-click `D:\code\projects\Shot2Agent\build\Shot2Agent\Start acceptance.cmd`. Keep `runtime` adjacent. Quit through **退出** or tray **Quit Shot2Agent**. Follow the five observations in [current run guide](M3_WINDOWS_RUN.md); no build/debugging/SQLite work is requested.
- A final `git fetch origin --prune` exit 0 confirmed main still `2e394df`; it is an ancestor of this branch. No user changes were reset or discarded. PR [#3](https://github.com/blooddrunk/Shot2Agent/pull/3) remains open for review/native acceptance, not merged.

### Interactive UI automation availability

Attempted `mcp__node_repl__js` initialization of bundled `@oai/sky` and `sky.list_windows()` to establish whether the native UI could be inspected without touching the clipboard. Tool invocation failed before JavaScript execution: MCP **-32602**, `codex/sandbox-state-meta: sandboxCwd is not a local file URI: file:///mnt/d/code/projects/Shot2Agent`. No app input, UI launch, screenshot or clipboard action occurred; this is a tool/environment error (no process exit code). The earlier PowerShell EXE smoke still passed, but this interface cannot provide interactive evidence from the current WSL working directory. Operator observations remain NOT VERIFIED, with the ready-to-run staging shortcut and exact five-step guide supplied.

Acceptance documentation update verification (2026-10-21): `git fetch origin --prune` and ancestry inspection exit 0; main `2e394df` is already integrated. `npm test` exit 0, 90 total / 89 pass / 0 fail / 1 Windows-native skip in WSL. `git diff --check` exit 0. Only documentation/instructions changed; no running app settings, input method, clipboard, tasks or Agent execution were modified. The original M3 request authorizes the normal PR review/merge workflow when evidence and permissions permit; final checks must pass before merge. Retry improvements remain proposals for separately scoped work.
