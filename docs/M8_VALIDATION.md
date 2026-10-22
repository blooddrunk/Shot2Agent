# M8-L 0.8.0 validation

Implementation candidate. Baseline `b2c32b04` (PR #16), safely merged into `codex/m8-local-feature-parity`; original checkout was clean. No operator history, Token or paid model request used.

## Evidence boundaries

- Baseline frozen install exit 0; original Node tests exit 0: 198 total, 173 passed, 25 platform skipped.
- New deterministic M8 controller/core regression exit 0: 12 passed, 0 failed. Covers four input combinations, startup/partial/replaced/renamed files, rearm/pause, dedupe/repeat, 2/5-image order, immutable profile, atomic invalid/oversize refusal, composer editing, independent file/save/notification delivery, history-only, conflict/busy/ambiguous retries and no Agent rerun.
- Local `npm run check` exit 0: lint, TS/Vue type checks, 210 Node tests (185 passed / 25 platform skipped / 0 failed), production builds and compiled fresh-cwd Fake / bundled Gateway-resource smoke passed. `npm run desktop:test-ui` exit 0: 17/17 passed, including real Vue composer at 1040x760, 720x560 and 480x640, source/output controls and all retained M7 workflows.
- Visual composer screenshots inspected at compact width; no horizontal clipping found. Mechanical design check exit 0, four advisory findings in pre-existing style lines; no design-system rewrite.
- Windows CI, Rust, native helper and packaged EXE evidence remain pending until linked below.
- Native Computer Use initialization attempted; tool rejected the WSL cwd with `sandboxCwd is not a local file URI: file:///mnt/d/code/projects/Shot2Agent`. No native GUI action was performed. Explorer actual paste, native folder-picker interaction and visible/non-focus-stealing notification remain NOT VERIFIED unless separately observed.
- Windows native helper tests verify CF_HDROP readback, existing file contents, Smart sequence rejection, clipboard-lock contention and native notification API acceptance. API acceptance is not visible-notification proof. Windows package smoke verifies restricted IPC/start/shutdown, not GUI acceptance.

## Acceptance mapping

| Requirement | Implementation and automated proof | Native boundary |
| --- | --- | --- |
| Independent clipboard/folder/both/off | Separate persisted opt-in source; bounded nonrecursive reconciliation, startup baseline, stable attributes and bytes, original 5-second dedupe, manual repeat; m8.test | Native picker/folder clicks pending |
| Consent, pause, migration | Existing consent and effective delivery retained; folder defaults off; rearm skips history; old Agent and hotkeys preserved | Existing M3 observations remain scoped |
| Ordered 2–5 composer | File/clipboard/preview add, thumbnails, reorder/remove/discard; all validation before Core atomic submit; one task and pinned Agent; m8.test + real Vue tests | Actual native file picker pending |
| Independent outputs | Stable verified Markdown CF_HDROP, text modes, explicit copy actions; separate save/clipboard/notification receipts; history-only; m8.test | Explorer paste and visible notification pending |
| Delivery retry | Existing bounded failure semantics, original Smart baseline; existing result only | No new paid requests |
| GLM usability | Supported models no longer gated on prior synthetic/attested status; save remains local; mock real-task transport + M7 save tests | Real GLM unchanged and not called |
| M7 preservation | Existing GUI credential/history/theme/shortcut tests retained; appended M8 controls | No claim of new real-Codex or IME proof |

## Deliberate limits / M9

No installer, Remote/Relay work, recursive media import, arbitrary binary result attachments or automatic Agent rerun. File clipboard materializes the verified Markdown answer only. Cache is retained across history deletion/exit, bounded to 1000 files / 256 MiB with refusal at quota; no background eviction can invalidate an advertised clipboard file. M9 owns end-user cache/backup ergonomics, final portable/upgrade matrix, native acceptance gaps, simple GUI docs and Local v1.0 tagging after agreed gates pass.
