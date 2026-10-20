# M2-L executed verification — 2026-10-20

**Current status: M2-L minimum Local functional loop accepted on 2026-10-20, based on operator feedback and delivery receipts.** See [operator acceptance](#operator-acceptance-2026-10-20) for the exact scope. Native Smart conflict/focus/forced-interruption and other detailed edge cases remain individually NOT VERIFIED unless separately evidenced. This is not full V1, installer or Remote release acceptance. Earlier sections retain historical evidence and gaps at the time of each run; they are not the current minimum-loop status.

## Baseline and automatic evidence

- `git fetch origin --prune`: exit **0**. Initial worktree clean on `codex/m1-durable-task-core`; new `codex/m2-local-mvp` branched from `origin/main` `61658f2` without reset/discard.
- `gh pr view 1 --json state,mergedAt,mergeCommit,url`: exit **0**, MERGED at `2026-10-20T12:06:51Z`, merge SHA `2a96212bf15005746f3ee7ef4d170a4c738a88c9`.
- Runtime: Linux/WSL, Node **v24.19.0**, pnpm **10.19.0**. `corepack pnpm install --frozen-lockfile`: exit **0**, lockfile unchanged.
- Baseline `npm test`: exit **0**, **44 pass / 0 fail** before M2-L changes.
- First added suite `node --experimental-strip-types --test packages/local/test/m2.test.mjs`: exit **0**, **22 pass / 0 fail** before adding lossless/native checks.
- `npm run check`: exit **0**, lint + typecheck + **73 pass / 0 fail / 1 native Windows test skipped (74 total)** + build + fresh-directory compiled smoke. Final-commit cross-platform CI is linked in the PR; the final validation below supersedes intermediate counts when tests are added.
- Compiled smoke starts `dist/apps/cli/src/mvp.js` in a newly created directory, initializes private config, queues a real synthetic PNG, processes it with Fake, reads persisted history/Markdown in new processes and finds the atomic output. Fetch, TCP connect, HTTP request and listener creation are replaced with throwing functions, and an unusable Relay URL is supplied. Exit **0**, `PASS compiled fresh-cwd Fake Local smoke ... no network/listener/Relay, helper packaged`.
- Resource command: `/usr/bin/time -v node --experimental-strip-types --test --test-name-pattern='image pixel guard|lossless optimization' packages/local/test/m2.test.mjs`: exit **0**, **5 pass**, peak RSS **366,724 KiB** (~358 MiB), elapsed **5.98 seconds**, no swaps. This is a Linux fixture benchmark, not a Windows guarantee or hard OS memory quota.

Automatic coverage actually executed includes M1 Local/Remote equivalence, private storage/auth/fencing, queue/process restart, crash after launch -> unknown/no replay, storage rollback, idempotency, byte/task limits, full PNG/JPEG/WEBP integrity; plus M2-L confirmation-before-task, duplicate/mixed clipboard events, transient busy retry, self-write filtering, Smart new-content protection, lifecycle mismatch, parallel delivery reservation, explicit delivery-only retry, save/clipboard failure isolation, history-only, atomic path/conflict/symlink refusal, 3840×2160 and 7680×2160 success, 8000×8000 boundary success and 8001×8000 refusal, lossless optimization/provenance, Mock Codex exact arguments/owned image paths/stdin data separation/version/Profile refusal, nonzero exit, invalid/missing/huge output, log overflow, timeout and explicit cancellation.

Initial typecheck/lint found and corrected list pagination/erasable parameter-property issues and a missing timer import; failing intermediate checks were not treated as acceptance. Final command outcomes, including any subsequent CI fixes, are recorded below.

## Real Codex synthetic image: PASS (WSL only)

Prerequisites observed: `codex --version` -> **codex-cli 0.163.0-alpha.10.2**, `codex login status` -> **Logged in using ChatGPT**; both exit **0**. `codex exec --help` verified image, output-last-message, read-only, ignore-user-config/rules and ephemeral flags. Reference: [official CLI](https://developers.openai.com/codex/cli/reference), [non-interactive mode](https://developers.openai.com/codex/noninteractive), [Windows sandbox boundary](https://developers.openai.com/codex/windows).

Used a generated 600×140 white PNG containing only `SHOT2AGENT 42`, outside Git, and a dedicated temporary workspace/root/output directory. Commands (paths normalized for reproducibility):

```sh
node --experimental-strip-types apps/cli/src/mvp.ts init --root /tmp/shot2agent-live-state --adapter codex --workspace /tmp/shot2agent-live-workspace --codex /absolute/path/to/codex --clipboard off --save /tmp/shot2agent-live-output
node --experimental-strip-types apps/cli/src/mvp.ts file /tmp/shot2agent-live-workspace/synthetic.png --root /tmp/shot2agent-live-state
node --experimental-strip-types apps/cli/src/mvp.ts work --root /tmp/shot2agent-live-state
node --experimental-strip-types apps/cli/src/mvp.ts list --root /tmp/shot2agent-live-state
node --experimental-strip-types apps/cli/src/mvp.ts show <returned-UUID> --root /tmp/shot2agent-live-state
node --experimental-strip-types apps/cli/src/mvp.ts delivery <returned-UUID> --root /tmp/shot2agent-live-state
```

All exit **0**. Observed queued -> succeeded, exactly one attempt, Markdown accurately described **SHOT2AGENT 42**, save receipt succeeded, clipboard disabled as configured. Workspace file listing retained only the original synthetic image. Runtime pictures, auth, subprocess logs and full transcripts are not committed. A second synthetic execution after environment filtering also exited 0, reached succeeded, and accurately identified SHOT2AGENT 42; both persisted tasks remained readable. This proves current WSL login/model/image/final-output interoperability; it does not prove that every supported CLI release or Windows sandbox behaves identically.

## Native Windows evidence before operator acceptance (historical)

- Windows PowerShell **5.1.26100.9711** detected, exit **0**.
- `'{"op":"sequence"}'` piped to `powershell.exe -NoProfile -NonInteractive -Sta -File 'D:\code\projects\Shot2Agent\packages\local\src\clipboard.ps1'`: exit **0**, helper compiled, returned a clipboard sequence number. No image read, write, focus activation or private content collection in this check.
- Windows `Get-Command node` / `Get-Command codex` returned no executable in this environment's PATH; `node --version` returned exit **1** (command not found). This is a missing native prerequisite, **not** proof of a product failure.
- CI opts into a synthetic native DIB -> PNG/read validation -> Unicode text write -> stale sequence refusal -> text filtering test. Linux skips it explicitly. A runner test remains distinct from a logged-in user's real Windows screenshot/focus/Codex workflow.

| Acceptance layer | Status in that earlier session | Observation still missing at that time |
| --- | --- | --- |
| Shared durable Core / Fake direct Local E2E | PASS | None for automated layer |
| Codex argv, version/Profile boundary, stop, logs (mock) | PASS | Windows actual sandbox/process behavior separately |
| Real Codex image -> persistent Markdown/save on WSL | PASS | Does not establish native Windows Codex |
| PowerShell helper compilation + sequence read on Windows | PASS | Full actual screenshot capture/write still separate |
| Actual Windows Snipping Tool screenshot submit | NOT VERIFIED | Follow usage checklist with real PNG/DIB screenshot |
| Real Windows Codex image analysis / read-only workspace | NOT VERIFIED | Install native Node/Codex, login, synthetic image round trip |
| User clipboard return / Smart new content / focus | NOT VERIFIED | Paste comparison and foreground observation |
| Windows local save + restart after native Agent interruption | NOT VERIFIED | File/hash, queued recovery, started unknown/no replay |

Exact prerequisites, commands, expected results, evidence fields and failure troubleshooting are in [the Windows acceptance table](LOCAL_MVP_USAGE.md#windows-人工验收记录表). No Relay/VPS or local HTTP is required. One short stabilization pass should fix only observed Windows failures. Full Tauri/tray, folder watch, CF_HDROP, Remote delivery/mobile notifications and installers stay deferred V1 capabilities.

## Cross-platform CI correction

Initial push run [39423017975](https://github.com/blooddrunk/Shot2Agent/actions/runs/39423017975) passed Linux Node 22/24; both Windows jobs identified `ERR_UNSUPPORTED_ESM_URL_SCHEME` in the smoke harness. Corrected injected-module and generated Sharp imports to standard file URLs, matching the existing M1 harness. This was a failing check and was fixed before acceptance; no product safety setting was weakened. Both Windows jobs already passed the native synthetic DIB/Unicode/stale-sequence test, distinct from user Snipping Tool/focus/live Windows Codex acceptance. See PR checks for the final-head rerun.

The corrected-head push matrix passed all four platforms, but its duplicate PR run exposed a pre-existing M1 timer test race on a slower Windows Node 24 runner: the real 500 ms coordinator deadline elapsed during filesystem work, so completion correctly returned STALE_LEASE. The Worker stop-acknowledgement test now uses the existing injected Core clock; separate coordinator deadline/lease-expiry tests retain their explicit clock advancement. No production timeout/fencing logic was relaxed. Both final-head workflows must pass before handoff; PR checks retain the failed-run history.

## Windows stabilization after operator feedback

The operator observed two real failures despite the earlier green matrix: `mock Codex hang` could end with `EPERM` while deleting its still-owned working directory; Fake task submission eventually succeeded but manual `copy` failed. At that point the Windows minimum-loop gate was **NOT VERIFIED**, not complete. The subsequent correction and operator acceptance are recorded below.

Root causes and bounded corrections:

- PowerShell converts `$null` to an empty string when binding a C# `string` parameter. The original helper interpreted this as a conditional write with an empty expected sequence, so manual Copy and unconditional Always refused every write. Confirmed with a pure Windows PowerShell argument-binding probe (`Describe($null)` returned `empty`, no clipboard access). The helper now treats absent/empty expectation as unconditional, while Node validates nonempty sequence tokens and Smart retains its locked sequence gate.
- The generic Worker could persist `execution_unknown` at its result deadline before the adapter's asynchronous Windows tree termination had finished. Tests and temporary-image cleanup could then race remaining process/directory locks. Process results now carry an actual root/tree-killer close barrier; the Codex adapter awaits that barrier before deleting its own files, retries transient removal locks with a finite bound, and exposes a cleanup lifecycle barrier to the Worker. Unknown is persisted before waiting; an additional 10-second unconfirmed cleanup pauses further Local claims. Permissions, execution state transitions and no-replay semantics are unchanged.
- Confirmation now retains one latest observed screenshot in memory. Copying command text after detection no longer loses the pending image. Explicit `current` re-reads the live clipboard; queued/no_image/duplicate/capture_in_progress statuses and safe error codes replace ambiguous null-only/generic failure messages. The original capture sequence is retained, so Smart still preserves newer clipboard text.

Executed on Windows Native Node **v24.20.0** (absolute executable path), without changing installed dependencies, current runtime data, settings, clipboard, or existing `dist`:

1. Native targeted hang/tree/cancellation tests: exit **0**, **3 pass**. A subsequent native regression selection covering hang/tree, staged confirmation, current fallback, stop quarantine and cleanup ordering: exit **0**, **6 pass**.
2. Native `tsc --noEmit`: exit **0**.
3. Full `npm run check` in a temporary source-validation bundle with a junction to the existing Windows `node_modules`: exit **0**; lint, typecheck, **77 pass / 0 fail / 1 native clipboard skip (78 total)**, build and compiled fresh-cwd no-network smoke. `SHOT2AGENT_NATIVE_CLIPBOARD_TEST=0` deliberately protected the operator clipboard. No second Git checkout, system PATH edit, reinstall, task deletion or runtime restart was performed.
4. An initial WSL test invocation could not load Sharp after the user's native Windows dependency installation. It was not treated as product evidence; dependencies were preserved and validation moved to the existing Windows Node. Fresh Linux dependency installation/tests remain covered by CI.

CI's opt-in native test has been expanded beyond Smart: unconditional Unicode Copy/Always writes, a staged native DIB -> Fake Local Core -> manual Copy workflow, receipt success, and exact clipboard text readback. This test would reject the original null-binding behavior. Final-head Windows/Linux Node 22/24 results are recorded in PR #2. At the end of that automated stabilization run, live Windows use and the operator's old-task Copy recheck still awaited feedback. The following acceptance record updates those specific observations without marking unreported edge cases as passed.

## Operator acceptance (2026-10-20)

**Decision: close M2-L minimum Local functional acceptance; keep detailed unobserved cases explicitly open.** Evidence source is the operator's report in the project conversation after stabilization, not an additional agent-run native experiment. No screenshots, result content, raw transcripts, private task IDs, login material or runtime databases are reproduced here.

| Capability | Recorded result | Evidence source / limit |
| --- | --- | --- |
| Windows Fake path, manual Copy and paste verification | PASS — operator verified | Operator explicitly reported Fake Copy and verification succeeded after the fix |
| Real Codex Local path completing with saved/clipboard-delivered result | PASS — operator reported | Operator reported completing the real path and provided the two successful channel receipts below; exact local CLI version/launch command was not supplied and is not invented |
| Markdown local save | PASS — delivery receipt | save=succeeded, attempts=1; opening the saved file and comparing its content was not separately reported |
| Clipboard result write on the real path | PASS — delivery receipt | clipboard=succeeded, attempts=2; a separate real-result paste/content-quality comparison was not explicitly reported |
| Real Windows Smart first automatic return / preserving newer copied text | NOT VERIFIED as a dedicated operator case | A successful clipboard receipt alone does not distinguish automatic Smart from later manual Copy; tests/CI cover the sequence-gate logic |
| Foreground focus, forced-stop recovery, native memory/large screenshot workload and read-only sentinel comparison | NOT VERIFIED as dedicated operator cases | Do not infer these from a happy-path run; retest when related code changes or a release requires it |
| GUI/tray, installer, file clipboard, Remote/mobile notification | NOT DELIVERED in M2-L | Deferred V1 scope remains unchanged |

Sanitized channel evidence supplied by the operator:

```json
{"save":{"status":"succeeded","attempts":1},"clipboard":{"status":"succeeded","attempts":2}}
```

`delivery` is a read-only receipt query. It neither runs Codex nor repeats clipboard/file delivery. `attempts` counts processing of that particular channel (including explicit manual copy/retry), not Agent executions. Therefore clipboard attempts=2 is neither proof of a duplicate Codex run nor proof that Smart succeeded on its first automatic attempt.

Automated stabilization evidence for code head `92c5ec8a587a7893930d68b57341f6b9cacbdbe9`: [push CI](https://github.com/blooddrunk/Shot2Agent/actions/runs/39428425057) and [PR CI](https://github.com/blooddrunk/Shot2Agent/actions/runs/39428435571), 8/8 successful checks, Windows 78/78 tests, Linux 77 pass plus one explicit native skip, lint/typecheck/build/compiled smoke successful. Operator report and automated proof are separate evidence layers.

No further command-heavy checklist is required merely to close this minimum-loop phase. For later relevant changes, use the [trigger-based Windows guide](WINDOWS_ACCEPTANCE.md): the agent prepares the build/configuration and handles fault injection, while the operator only performs the few observations actually needed. The intended product remains a Windows tray/desktop app; the present CLI is a milestone entry point. This record does not start GUI implementation or merge PR #2.

Documentation handoff verification: Markdown-only acceptance/guide updates; native Windows `npm test` exited 0 with 77 pass, 0 fail and 1 deliberate operator-clipboard skip (78 total). Local link/heading validation checked 57 references; Windows PowerShell parsed 8 documented PowerShell snippets without executing them, all successful. No runtime/configuration/clipboard changes or new product functionality were introduced by this documentation handoff.
