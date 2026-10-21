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
- `npm run desktop:build` in WSL: exit 1, missing Linux D-Bus development library (`libdbus-1-dev`); this is not Windows build evidence.
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml`: exit 0.
- UI mechanical detector: exit 0, three advisory findings for preexisting selection/scrollbar colors; those colors were not changed.

- `playwright-cli` synthetic IPC preview: exit 0, retry controls and safe failure diagnostics visible at 1040×760 and 720×560, no horizontal overflow. Screenshots `/tmp/shot2agent-m4-ui-1040.png` and `/tmp/shot2agent-m4-ui-720.png` inspected; console had only an unrelated favicon 404. This is rendering evidence only; browser/server stopped afterward.
- Rust diagnostic unit test rejects private/arbitrary stderr and accepts only known phases; Windows package workflow executes it in release mode after assets are built. No raw stderr is promoted into receipts.

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

## First complete M4 automated gate (source 1ca5163)

- Local `npm run check`: exit 0; 108 total / 107 pass / 0 fail / 1 native skip; lint, TypeScript/Vue, core/UI builds and compiled fresh-cwd smoke passed. Further small stabilization changes listed below are verified by their own final CI.
- `node --experimental-strip-types --test packages/local/test/reliability.test.mjs` after independent-save additions: exit 0, 17/17 pass.
- [Windows/Linux Node 22/24 matrix 39531318912](https://github.com/blooddrunk/Shot2Agent/actions/runs/39531318912): all four jobs PASS, `npm run check` exit 0. Windows: 108/108, Linux: 107 pass / 1 native skip, zero failures. Native Windows lock contention/recovery passed in both Node jobs.
- [Windows portable package 39531318925](https://github.com/blooddrunk/Shot2Agent/actions/runs/39531318925): install/build/package/actual EXE smoke/upload PASS, exit 0. Job cleanup smoke passed. Superseded push runs cancelled by workflow concurrency are not counted as passes.
- Final stabilization preserves specific pre-write refusal codes, checks Smart sequence before allocation as well as under the lock, adds Rust phase-sanitization testing and prevents manual Copy from replacing a pending delivery receipt. Targeted `node --experimental-strip-types --test --test-name-pattern='manual Copy refuses' packages/local/test/m2.test.mjs`: exit 0, 1/1 pass. A new full CI is required for this final source.

## Final implementation gate (source 0652119)

- Final local `npm run check`: exit 0, **109 total / 108 pass / 0 fail / 1 Windows-native skip**, including lint, TS/Vue typecheck, builds and compiled fresh-cwd smoke. `git diff --check`: exit 0. Manual Copy retains previous retry failure events after success/failure.
- [Final Windows/Linux Node 22/24 matrix 39531777810](https://github.com/blooddrunk/Shot2Agent/actions/runs/39531777810): all four jobs PASS, `npm run check` exit 0. Windows **109/109**, Linux **108 pass / 1 native skip**, zero failures.
- [Final Windows package 39531777914](https://github.com/blooddrunk/Shot2Agent/actions/runs/39531777914): `corepack pnpm install --frozen-lockfile`, `npm run desktop:build`, `cargo test --release --features tauri/custom-protocol --manifest-path apps/desktop/src-tauri/Cargo.toml` (**1/1 Rust test**), `npm run desktop:package`, actual packaged EXE `--staging --smoke` and artifact upload all PASS, exit 0. Receipt: `PASS packaged IPC, refusal, natural quit, unexpected coordinator death and descendant cleanup`.
- `gh run download 39531777914 --name Shot2Agent-Windows-x64 --dir build/m4-candidate-download`: exit 0; extracted to `build/m4-candidate/Shot2Agent` without replacing any existing operator package. Version **0.4.0**, Node **v24.21.0**. `BUILD.txt` SHA `b33b821f546576e7f8bfc7769c6567aaeb93d292` is GitHub's PR merge snapshot with parents main `077f90af490bd9e384dbe070544b7561257e1d19` and implementation `06521190e7000b1f7e7dd77d241178c01588805f`, not a claim that the PR was already merged.
- Candidate ZIP SHA256: `2a10134011531d758bdac68fd027ea484bb1480741593f000da0920edcba87ac`; candidate EXE SHA256: `365071e3d4f572bd8c2f338dda2bfe06dff024506226fb7363e1eb001e9d9e19` (`sha256sum`, exit 0).
- Local Windows command: `powershell.exe -NoProfile -NonInteractive -File D:\code\projects\Shot2Agent\build\m4-native-smoke.ps1 -PackageDir D:\code\projects\Shot2Agent\build\m4-candidate\Shot2Agent`, exit **0** on Windows **10.0.26300.0**. The script launches only the packaged EXE `--staging --smoke`, waits at most 45 seconds, requires a real exit code, reads the safe receipt and cleans up its owned process on timeout. Observed the same PASS receipt. Unique smoke temporary root; no real tasks, real Codex, GUI launch, clipboard write or private screenshot capture.

PR [#5](https://github.com/blooddrunk/Shot2Agent/pull/5) incorporates planning PR #4. All executable source is validated at 0652119; subsequent evidence-only documentation does not change that source. Merge requires green checks at its final head and a fresh main ancestry/conflict check. The final merged main SHA/package receipt is reported with delivery after the main workflow completes; do not reinterpret a candidate snapshot as that final build.

For optional interactive observations above, the runnable candidate is `D:\code\projects\Shot2Agent\build\m4-candidate\Shot2Agent\Start acceptance.cmd` with the exact hashes above. Record each numbered observation **PASS / FAIL / NOT VERIFIED**, plus the visible clipboard/save code and actual pasted text (synthetic only). No new human action is required to establish the automated reliability gate; unreported confirmation/input-method/real-Codex observations remain NOT VERIFIED and do not justify another large milestone. Local daily use remains scoped to the approved Profile and already accepted desktop environment.

Final review identified that explicit delivery retry could otherwise inherit newly changed Always settings for an originally Smart task. The follow-up persists a sticky Smart guard, conservatively protects legacy failed receipts with baselines, and adds two deterministic tests. The 0652119 candidate evidence above remains valid at that scope; this follow-up requires its own green CI before merge.

## Final Smart-guard follow-up gate (source e04ffa2)

This section supersedes the earlier candidate's test totals for current executable source. Original Smart protection now persists across explicit delivery retries even after changing settings to Always; legacy failed receipts with a baseline fail closed. Manual Copy is still explicit and preserves retry history.

- `node --experimental-strip-types --test packages/local/test/reliability.test.mjs`: exit 0, **19/19** pass, including both sticky-guard cases.
- Final local `npm run check`: exit 0, **111 total / 110 pass / 0 fail / 1 Windows-native skip**, plus lint/typechecks/core+UI builds/compiled smoke all passed.
- [Current-source Windows/Linux × Node 22/24 checks 39532408594](https://github.com/blooddrunk/Shot2Agent/actions/runs/39532408594): all four jobs PASS, exit 0. Windows **111/111**, Linux **110 pass / 1 native skip**, no failures.
- [Current-source Windows package 39532408648](https://github.com/blooddrunk/Shot2Agent/actions/runs/39532408648): frozen install, desktop build, Rust diagnostic **1/1**, package and actual EXE smoke all PASS, exit 0, with descendant cleanup; artifact uploaded. No timeout extension or automatic process/Agent replay was introduced.

All executable changes end at `e04ffa2d9b56971460b0cc6da42df5a32aa658ca`. The following commit only records this evidence. Final-head CI and post-merge main Windows build remain required by the handoff workflow; final delivery reports those live results and the merged package SHA256 separately. Candidate artifact hashes above identify only their stated candidate snapshot. No new operator input-method, focus/paste or authenticated Codex desktop acceptance is claimed.
