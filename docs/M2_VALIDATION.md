# M2-L executed verification — 2026-10-20

Implementation is reviewable and runnable through the documented CLI. **Full Windows 11 Local MVP acceptance is NOT VERIFIED.** Real Codex image execution below was observed on WSL, not Windows Native. Do not infer Windows authentication, sandbox/termination, actual Snipping Tool format handling or foreground focus from these checks. No production deployment/Remote notification/GUI claims.

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

## Native Windows evidence and remaining gate

- Windows PowerShell **5.1.26100.9711** detected, exit **0**.
- `'{"op":"sequence"}'` piped to `powershell.exe -NoProfile -NonInteractive -Sta -File 'D:\code\projects\Shot2Agent\packages\local\src\clipboard.ps1'`: exit **0**, helper compiled, returned a clipboard sequence number. No image read, write, focus activation or private content collection in this check.
- Windows `Get-Command node` / `Get-Command codex` returned no executable in this environment's PATH; `node --version` returned exit **1** (command not found). This is a missing native prerequisite, **not** proof of a product failure.
- CI opts into a synthetic native DIB -> PNG/read validation -> Unicode text write -> stale sequence refusal -> text filtering test. Linux skips it explicitly. A runner test remains distinct from a logged-in user's real Windows screenshot/focus/Codex workflow.

| Acceptance layer | Status here | Required remaining observation |
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
