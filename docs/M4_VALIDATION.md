# M4-L reliability validation — 2026-10-21

## Baseline and Windows gate

Started with a clean `codex/m3-local-desktop` checkout. `git status --short --branch`, `git fetch origin --prune`, `git log -5 --oneline origin/main`: exit 0. Main was `077f90af490bd9e384dbe070544b7561257e1d19`. Integrated main without resetting, then created `codex/m4-local-reliability` and merged the existing open planning PR #4 at `97741c65f45ae24d6b9e70faea5e2c93af945db5`. No duplicate planning PR was created.

- [Pre-merge Windows run 39528135264](https://github.com/blooddrunk/Shot2Agent/actions/runs/39528135264): success at `f711aa3f1c18c64d030497ad03cf6383dce9db4d`.
- [Main checks 39528536627](https://github.com/blooddrunk/Shot2Agent/actions/runs/39528536627): success at `077f90a`.
- [Main Windows package 39528536611](https://github.com/blooddrunk/Shot2Agent/actions/runs/39528536611): attempt 1 built/packaged but EXE smoke failed (`COORDINATOR_TIMEOUT_RESTART_APP`, exit 1 after about 20 seconds). Attempt 2, requested by prior review, passed build/package/EXE smoke. This session inspected that outcome before requesting a **full Job rerun** (`gh run rerun 39528536611`, exit 0). Attempt 3 independently re-executed install, build, package and actual EXE smoke, all exit 0; completed 2026-10-21 01:57:53 UTC. This is a fresh complete job on the same main commit/run, not a new run ID. Old logs have no phase evidence to establish root cause; do not attribute the original failure to an input method, scheduling or a fixed product bug.

M4 adds whitelist-only stage diagnostics without increasing the 20-second IPC timeout, and preserves kill-on-close Job cleanup. Smoke uses an isolated per-process temporary root. The current M4 source must pass its own Windows gate before merge.

## Executed development checks

- `corepack pnpm install --frozen-lockfile`: exit 0, lockfile unchanged.
- Baseline `npm test`: exit 0; 90 total / 89 pass / 0 fail / 1 Windows-native skip.
- Initial `node --experimental-strip-types --test packages/local/test/reliability.test.mjs`: exit 0; 15/15 pass. Further independent-save/configuration tests were added afterward; final suite evidence follows.
- First `npm run check`: exit 1 at lint (`queueMicrotask` undeclared global in new test); corrected to `globalThis.queueMicrotask`. No failing check is counted as PASS.
- `npm run desktop:package` in WSL: exit 1, explicit `WINDOWS_BUILD_REQUIRED`; Windows CI is the required executable/package environment.
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml`: exit 0.
- UI mechanical detector: exit 0, three advisory findings for preexisting selection/scrollbar colors; those colors were not changed.

Final checks, PR/merge CI and artifact hashes will be appended only after execution. Local logs are generated outside Git under `/tmp/shot2agent-m4-*.log`. No production task/history, clipboard contents or Codex credentials are committed.

## Test scope and limits

New deterministic tests cover actual simultaneous file publication (8 Worker threads, two competing complete contents), identical replay, conflict, path/junction refusal, busy recovery, zero/two-retry exhaustion, backoff sequence/session change, time budget, ambiguous write/helper death, independent transient/permanent save failures, pending-reservation exclusion, durable failure events and restart without automatic replay. IPC tests validate and persist retry settings. Existing suites exercise no Relay/network/listener dependency, startup image arming, confirmation/discard, pause/resume, Smart/manual return, preflight refusal, launched/unknown execution no replay and process/descendant cleanup. Windows native clipboard coverage adds deliberate lock contention and recovery using synthetic text in the existing isolated CI test. Fake/mock tests do not establish real Codex authentication.

The initial timeout root cause and third-party clipboard synchronization compatibility remain NOT VERIFIED. Existing operator-reported M3 capture/focus/paste/conflict/persistence/pause PASS remains scoped as recorded in M3_VALIDATION; it is not relabeled as an M4 interactive run.

## Optional interactive checks (not a build prerequisite)

Use the portable artifact identified below in a logged-in Windows 11 session with WebView2; extract the entire folder and run `Start acceptance.cmd` (isolated Fake root). Never point acceptance at actual history. Quit using **退出** or tray **Quit Shot2Agent**.

1. In Notepad type `SHOT2AGENT M4 42`. Enable image monitoring, Auto + consent, Smart and a separate local test Markdown directory. Expand **投递失败重试**, set 2 / 100 / 3000 and Apply. Screenshot that synthetic text. Expect one succeeded task, independent save/clipboard receipts; Notepad remains focused. Paste after completion: expect `# Fake result` (actual paste is the observation; receipt alone proves only a write).
2. Take a different synthetic screenshot; during the 8-second Fake run copy `NEWER CLIPBOARD`. Expect `blocked_by_clipboard_change`, conflict code, no automatic overwrite. Paste must retain `NEWER CLIPBOARD`; explicit **复制结果** then pastes the Fake result. Increasing retry count must not bypass conflict.
3. Quit/relaunch. Expect saved retry settings/history, no task for old clipboard content. Pause, take screenshot, resume: no submission until a fresh image. In confirmation mode, Submit creates one task and Discard creates none.
4. Only if desired, repeat 1–2 with the operator's chosen input method/synchronization setting. Record environment and PASS/FAIL/NOT VERIFIED without private content. No root-cause claim follows from correlation.

These optional observations establish native focus/paste/confirmation behavior only for that session/build. They do not prove universal input-method compatibility, a real busy/retry fault (covered by injection/native CI), or real Codex authentication. Real Codex requires a separately approved logged-in Worker profile and sanitized screenshot; no login credentials or real screenshots are requested for this gate. Agent rerun UI remains deferred.
