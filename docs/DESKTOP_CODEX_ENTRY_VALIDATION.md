# Desktop Codex entry 0.4.1 validation

Scope: make the existing approved real Codex Profile the explicit desktop entry. Keep Fake acceptance and old Local history separate. No Profile editor, policy escalation, automatic Agent rerun or history migration.

## Behavior

- Default EXE / `Start Codex.cmd` / `--codex`: fixed `Shot2Agent-Codex` LocalAppData root, existing Codex configuration required, no Fake fallback.
- `Start acceptance.cmd` / `--staging`: fixed `Shot2Agent-M3-Acceptance`, Fake only, 8-second delay.
- `Start legacy Local.cmd` / `--legacy`: original `Shot2Agent` root and history/Profile.
- Window title, tray tooltip and header identify mode; Profile metadata remains read-only. Unknown/conflicting flags are refused. Smoke requires `--staging` and retains a unique disposable root and kill-on-close Job.
- Missing formal settings do not create Fake settings; tests verify refusals and unchanged configuration. No IPC command can select another adapter/workspace/root.

## Developer checks (2026-10-21)

| Command | Exit | Result |
| --- | --- | --- |
| Baseline `npm test` | 0 | 114 tests: 113 PASS, 1 Windows-only SKIP |
| `corepack pnpm install --frozen-lockfile` | 0 | Frozen lockfile unchanged |
| Final `npm run check` | 0 | 118 tests: 116 PASS, 2 Windows-only SKIP; lint/typecheck/build/UI/smoke passed |
| `node --experimental-strip-types --test packages/desktop/test/desktop.test.mjs` | 0 | 17/17 PASS; the later native startup-refusal regression runs in Windows CI |
| `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml` | 0 | Formatted |
| Impeccable mechanical detector | 0 | No findings |
| Playwright synthetic Codex snapshot at 1040x760 and 720x560 | 0 | Mode displayed; 720px document width 720px, no horizontal overflow |

An initial local check failed on a TypeScript parameter property unsupported by strip-only mode; replaced with a declared field and constructor assignment before the successful run. An initial verification helper import targeted an obsolete sharp path and failed before any model launch; changed to the installed package's declared entry.

## Native Windows and release gates

Windows native runtime `node.exe "Verify Codex.mjs" --allow-model-cost <portable-directory>` exited 0 using the existing approved policy: adapter `codex`, CLI `codex-cli 0.163.0`, sandbox `read-only`, task `succeeded`, exactly 1 attempt, synthetic `SHOT2AGENT 42` marker observed. Operator history and Windows clipboard were not accessed. This establishes current real authentication/execution through the production desktop controller/adapter; it does not establish a new GUI capture/focus/paste observation.

A native refusal probe initially failed to exit within 10 seconds: controller construction was refused correctly, but its inherited input pipe remained open. Startup failure now explicitly closes both the clipboard helper and parent input; the corrected native probe exited 1 immediately with CODEX_SETUP_REQUIRED (verification driver exit 0, no settings created). Native initialization failure explicitly closes the clipboard helper if controller construction is refused; a Windows process regression checks bounded exit without creating Fake settings. The four-platform Node gate on implementation commit `eec2e5910488dbe88f87e033ae178706c1dcd5f8` passed: [CI run 39540372684](https://github.com/blooddrunk/Shot2Agent/actions/runs/39540372684). Linux has 116 PASS / 2 native-only SKIP; Windows has 118 PASS / 0 SKIP per Node version. The native startup-refusal regression passed on Node 22 and 24.

Release-gate evidence for the final PR head is attached to [PR #6 checks](https://github.com/blooddrunk/Shot2Agent/pull/6/checks): frozen install, `npm run desktop:build`, release Cargo tests, `npm run desktop:package`, actual packaged EXE smoke and descendant cleanup. Only a completed successful package job establishes that artifact's gate. Download the exact commit artifact and inspect its `BUILD.txt`/`SMOKE.txt`; source tests alone are not that gate. Post-merge main runs and artifact hashes are recorded in the PR delivery receipt. Do not treat synthetic UI/mocks as real authentication, native EXE execution, focus or paste evidence. Existing M3 operator acceptance and the unconfirmed input-method correlation retain their original scope.
