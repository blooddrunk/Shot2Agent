# M8-L 0.8.0 validation

Implementation candidate. Baseline `b2c32b04` (PR #16), safely merged into `codex/m8-local-feature-parity`; original checkout was clean. No operator history, Token or paid model request used.

## Evidence boundaries

- Baseline frozen install exit 0; original Node tests exit 0: 198 total, 173 passed, 25 platform skipped.
- New deterministic M8 controller/core regression exit 0: 12 passed, 0 failed. Covers four input combinations, startup/partial/replaced/renamed files, rearm/pause, dedupe/repeat, 2/5-image order, immutable profile, atomic invalid/oversize refusal, composer editing, independent file/save/notification delivery, history-only, conflict/busy/ambiguous retries and no Agent rerun.
- Local `npm run check` exit 0: lint, TS/Vue type checks, 210 Node tests (185 passed / 25 platform skipped / 0 failed), production builds and compiled fresh-cwd Fake / bundled Gateway-resource smoke passed. `npm run desktop:test-ui` exit 0: 17/17 passed, including real Vue composer at 1040x760, 720x560 and 480x640, source/output controls and all retained M7 workflows.
- Visual composer screenshots inspected at compact width; no horizontal clipping found. Mechanical design check exit 0, four advisory findings in pre-existing style lines; no design-system rewrite.
- PR source `9709d81178259768475dc144e9873d91a654b576`: [CI 39707230956](https://github.com/blooddrunk/Shot2Agent/actions/runs/39707230956) passed Linux/Windows Node 22/24 and 17 Vue tests. Windows Node 24 recorded 210 total / 208 passed / 2 skipped / 0 failed, including native clipboard helper coverage. All workflow commands completed successfully.
- [Windows package 39707230916](https://github.com/blooddrunk/Shot2Agent/actions/runs/39707230916) passed frozen install, release build, Rust fmt and 4 release Rust tests, packaging, downloaded policy helper, synthetic Credential Manager lifecycle, bundled Gateway fixture and packaged EXE IPC/refusal/quit/death/descendant-cleanup smoke. Package downloaded and manifest/resource inclusion independently inspected.
- PR artifact `Shot2Agent-Windows-x64` id `12396130131`, ZIP SHA-256 `8659910c722060107a194e2aa3f7d8167345293565d8f4ce38d44e7c4468938f`; BUILD.txt says M8-L 0.8.0 / Node v24.21.0. PR workflows check out a synthetic merge ref: this artifact records `9c896364649e638140adca51cedeff6961a98cea`, rather than branch HEAD. A merged-main build must use main's exact SHA; use BUILD.txt and final handoff links for its identity.
- Final labels distinguish **复制文本** from **复制文件** and show a Chinese explanation for unavailable native notifications. Final local Vue typecheck exit 0 and 17/17 UI tests passed after these labels; the PR/main checks remain the independent final gate.
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

## Changed implementation surfaces

| Files | Decision |
| --- | --- |
| packages/desktop/src/folder.ts, controller.ts, settings.ts | Bounded nonrecursive source baseline and reconciliation, existing opt-in migration, composer IPC with file paths rather than large image IPC payloads |
| packages/local/src/app.ts | Shared capture/manual/folder submission, full image verification, Core atomic ordered batches and immutable selected Profile |
| packages/local/src/clipboard.ts, clipboard.ps1 | Serialized native CF_HDROP lock/sequence/deadline; optional Windows balloon notification without installer |
| packages/local/src/delivery.ts, state.ts, desktop/actions.ts | Independent durable channels/payload receipts, stable verified Markdown cache, notification upgrade baseline and existing retry guards |
| apps/desktop/src/App.vue, style.css | Existing four-page GUI extended with folder picker, composer, independent outputs and specific manual copy actions |
| packages/worker/src/gateway.ts | Known image-capable model check retained; historical vision qualification is diagnostic rather than a paid execution gate |
| desktop/local tests, portable manifest and M8 docs | Synthetic regression and native helper proof; 0.8.0 package identity and explicit acceptance boundaries |


## Operator follow-up and 0.8.1 stabilization — 2026-10-22

The operator reports the shortest native checklist PASS except two defects: repeated Copy files usually left Explorer without Paste/Ctrl+V capability (only one observed success), and Home's capture summary appeared static. Win+V visibility is not used as file clipboard evidence. This is scoped operator evidence for the other checklist items, not a new independent real-provider or universal IME qualification.

Home's pause defect was reproduced by a real-Vue regression before the fix. The summary now derives from the saved snapshot, includes pause/off and clipboard/folder sources, and is tested after GUI Apply, pause/resume and externally changed settings.

File publication now includes Shell Preferred DropEffect=COPY in the same native clipboard lock, pumps the owning HWND's STA messages while waiting for pipe input, and verifies retained CF_HDROP paths/copy effect/sequence after a bounded responsive interval (up to 150ms, within the existing deadline). A known replacement reports CLIPBOARD_REPLACED_AFTER_WRITE (conflict); verification uncertainty remains ambiguous. Neither condition silently re-writes the clipboard or reruns AI. Manual Copy retains the native failure phase rather than replacing all errors with COPY_FAILED.

This corrects identified native integration gaps and prevents false success within the verification interval; the exact cause of the operator's intermittent failure is not yet proven. No attribution to an input method or claim of immunity to later external clipboard changes is made. Windows regression expands native OLE readback to 12 alternating one/two-file copies with Unicode paths, idle/status reads, COPY effect and an injected external replacement. Local/CI execution results will be recorded at delivery; the affected original-machine Copy files behavior still needs the operator's narrow retest.

Shell format reference: https://learn.microsoft.com/en-us/windows/win32/shell/clipboard . Preferred DropEffect communicates copy intent; the format alone is not proof of successful Explorer paste.

0.8.1 local gates: frozen install exit 0; npm run check exit 0 (211 total, 186 passed, 25 platform skipped, 0 failed); final real-Vue suite exit 0 (19/19); design detector exit 0 (no findings). Local native compile-only and three idle sequence/EOF requests passed; no image read or operator clipboard write occurred. Windows native repeated/OLE/replacement tests and package gates are independently tracked in the stabilization PR checks.
