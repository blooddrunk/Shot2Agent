# M4-L: bounded Local reliability gate (proposed next slice)

Status: **planned, not implemented**. Baseline M3-L PR #3 merged into `main` at `077f90af490bd9e384dbe070544b7561257e1d19` on 2026-10-21. Sync the latest `origin/main` again before acting; this document does not supersede live CI or newer fixes.

## Gate 0 — restore main-branch packaged Windows smoke

At review time, [main Windows package run 39528536611](https://github.com/blooddrunk/Shot2Agent/actions/runs/39528536611) built successfully but failed the **actual packaged executable** smoke: `FAIL COORDINATOR_TIMEOUT_RESTART_APP` after roughly 20 seconds. The preceding [PR run 39528135264](https://github.com/blooddrunk/Shot2Agent/actions/runs/39528135264) passed the same packaged smoke. The independent Node 22/24 Windows/Linux [main check run 39528536627](https://github.com/blooddrunk/Shot2Agent/actions/runs/39528536627) passed. A failed-job rerun was requested during review. **Do not call latest main green until the rerun result and a repeatable main package build have actually passed.**

1. Check current run/rerun conclusion; if successful, preserve attempt number and log evidence and run another fresh main build when feasible. Distinguish intermittent CI/environment conditions from product defects. If still failing, retain the exact failing smoke phase, coordinator stdout/stderr diagnostic codes **without sensitive content**, process/Job cleanup evidence and elapsed time.
2. Make smoke deterministic: bounded startup/readiness diagnostics and phase-specific errors, inspect parent gate/pipe lock/thread lifecycle and helper startup, avoid arbitrary timeout inflation or hiding the failure. No production debug command injection.
3. Windows release package and real EXE smoke must pass at current HEAD, alongside `npm run check` and Linux/Windows Node 22/24. Never replace a real EXE test with only unit tests.

## P1 — fix evidenced Local reliability holes with minimal changes

- **Atomic file saving:** `packages/local/src/delivery.ts` performs existence/read validation before `renameSync(temp,target)`. This is a check-then-rename race; a concurrent writer can install a different target between the check and rename, and the rename can replace it on Windows. Use a safe publish-if-absent approach (or transactional coordination + no-clobber primitive) that preserves existing mismatched files. Test conflicting concurrent writers, identical retry, symlink/reparse boundary and save failure while clipboard succeeds. Do not overwrite an operator-owned file.
- **Delivery vs execution:** keep retry receipts independently durable for clipboard and Markdown. Transient `CLIPBOARD_BUSY`/temporary save errors may get bounded, user-configured retry count/backoff/time budget; 0 = no extra attempts. Classify permanent refusal separately. Smart must recheck the **original** baseline for every attempt and stop on changed sequence/session. `blocked_by_clipboard_change` is never retried automatically; manual Copy stays explicit. Avoid timer storms, hidden background replay, or unbounded retries on restart.
- **Agent rerun:** no automatic replay for launched/unknown Codex work (`execution_unknown` or other ambiguous failures). A new explicit rerun UI is optional **only after** it can create a new durable task/attempt lineage without mutating original evidence, pin the approved profile, show extra model cost risk and avoid race with active workers. Otherwise defer rerun, explain the boundary, and deliver the reliability gate without it.
- **Clipboard diagnostics:** distinguish native contention from refusal/conflict and unknown write outcome without collecting contents. WeChat Input Method cross-device clipboard sync is only an operator-observed correlation, **not established cause**. Do not bypass Smart checks with sequence resets, content equivalence assumptions or Always overwrite.

## Automated acceptance (agent-owned)

Run frozen install, `npm run check`, desktop package and packaged EXE smoke on Windows; retain Node 22/24 Windows/Linux CI. Add deterministic fault-injected tests for busy -> eventual success, exhaustion, baseline change during backoff, ambiguous write, duplicate retry / crash recovery, save conflict races, channel independence, no duplicate execution and safe stop. Use synthetic data and a staging root, and record exact command, exit code and evidence. Retain the existing no-Relay/listener, worker containment, consent, startup new-image-only and operator-accepted M3 behavior. Do not silently change execution Profile permissions or touch actual user tasks.

## Human verification boundary (only if unavoidable)

Provide a single built Windows portable artifact with commit/build hash and isolated Fake test data root; operator should never build, debug, edit SQLite, or expose private screenshots. If native clipboard contention or input-method compatibility remains uncertain: give explicit Windows 11 session prerequisites, exact GUI actions with synthetic screenshots and Notepad, expected clipboard/paste and receipt outcome, instructions to switch/repeat with WeChat Input Method sync enabled/disabled **only if operator chooses**, and PASS/FAIL/NOT VERIFIED recording. Keep real authenticated Codex desktop verification separate from Fake acceptance and require explicit user consent and a sanitized test screenshot.

## Stop / completion criteria

Finish within one focused implementation round plus at most a short evidence-driven stabilization pass. Report proven fixes vs unresolved environment issues, rerun attempt/CI URLs and executable artifact checksum. Do not expand into installer, startup registration, Remote/VPS, push, folder watch, file clipboard or batch UI. If Gate 0 remains red, finish only the minimal root-cause fix before feature changes.
