# M9-L — close Local v1.0 as the FIRST usable product release

**Status: RC implemented and operator file-copy retest reported PASS on 2026-10-22. The final 1.0.0 follow-up adds the requested icons and user documentation; exact build/CI identity is recorded in the release evidence.** [Implementation validation and native boundary](M9_VALIDATION.md). Written 2026-10-22 against merged main `1d17690c5bfe488e428f8069a8e05babcd667213`. **Read the current main and open PRs again before starting work.**

## Verified baseline and remaining proof

- M8-L functionality merged in [PR #17](https://github.com/blooddrunk/Shot2Agent/pull/17), followed by Windows clipboard/capture-status stabilization in [PR #18](https://github.com/blooddrunk/Shot2Agent/pull/18) (0.8.1). Both closed/merged; no open PRs/issues at this inspection.
- Exact merged main CI succeeded: [Linux/Windows Node 22/24 and Vue interaction tests](https://github.com/blooddrunk/Shot2Agent/actions/runs/39715940064), [Windows Rust/portable EXE/package](https://github.com/blooddrunk/Shot2Agent/actions/runs/39715940219). This is independently checked **automation**, not a completed interactive desktop acceptance.
- Confirmed source/test coverage: independent clipboard/folder/off, skip-existing and stable nonrecursive folder polling, automatic dedupe, ordered 2–5 image composer as one immutable task, copy text vs native CF_HDROP Markdown file, separate save/clipboard/notification receipts, GLM Token Save without an implicit model request and optional synthetic Test, GUI Profile/history controls.
- The operator previously reported other short M8 native checks PASS but intermittent Explorer **Copy files -> Ctrl+V** failure and stale Home capture text. Home pause/status was reproduced and fixed with Vue regression. 0.8.1 adds a responsive native clipboard owner, Preferred DropEffect=COPY, CF_HDROP readback and replacement detection, with repeat native helper tests. At this original handoff it had not been retested. **Update 2026-10-22:** the operator subsequently reported successful copying on the published M9 RC; see [M9 acceptance record](M9_VALIDATION.md). Do not expand that report into invented trial/focus details. See [M8 validation](M8_VALIDATION.md) and [short Windows use/acceptance guide](M8_WINDOWS_RUN.md).
- CI cannot establish a user's Explorer paste, visible Windows notification or focus behavior, nor actual paid GLM requests. Do not demand a redundant full native checklist when a specific scenario has already been reported PASS and its implementation is unchanged.

## Single release goal

One self-contained Windows x64 **portable** Local GUI ZIP which an ordinary user extracts and starts by double-clicking `Shot2Agent.exe`; first-run setup, Agent discovery/manual path, workspace, prompt, GLM endpoint/model/Token, capture, batch submission, result destinations, history deletion and cache upkeep require **no Shot2Agent CLI, JSON editing, repair scripts, Git, Node or pnpm on the target PC**. An installed/logged-in third-party Agent CLI, hosted model network access and WebView2 may remain genuine external prerequisites. Remote/VPS/Relay are deferred. Deliver v1.0 only after the gates below, not merely because the ZIP builds.

## P0 implementation, in priority order

### A. Close the remaining native file-copy defect first

1. Confirm the exact post-0.8.1 behavior of manual Copy files in an isolated Windows desktop session. Prefer automated end-to-end/native UI proof if an interactive test runner is available. Exercise three successive Markdown file copies and Explorer pastes, Unicode paths, current clipboard replacement, and minimized/background app with no focus theft. Preserve both CF_HDROP and Preferred DropEffect.
2. On failure, capture only sanitized phase code and whether Explorer offered Paste; reproduce with synthetic data, fix **only** the demonstrated cause and add a regression test. Never silently repeat an ambiguous clipboard write, rerun an Agent, defeat Smart/Always consent or expand retry budgets.
3. If truly no interactive automation is available, ask for **one narrow operator retest** after attaching the exact new ZIP/SHA. The instructions below are the maximum manual scope without another observed defect. A green native API readback test is not Explorer UI proof.

### B. Finish packaging and ordinary-user entry

1. Confirm bundled Node/native helpers/resources, launch without any Profile (show GUI onboarding), full GUI configure/edit/select/credential repair, tray hide/reopen/quit, restart persistence, and no unexpected command window or external Shot2Agent setup command. Keep existing historical data roots and compatibility behavior.
2. Make the root readme and packaged Windows instructions lead with **double-click `Shot2Agent.exe`**, NOT the historical M2 CLI/pnpm/bootstrap recipe. Developer-only Fake launchers may remain for disposable acceptance, but should be clearly identified as *testing only*; don't make them ordinary UI workflow steps.
3. Display a consistent user-visible app version and build identity, with source commit in `BUILD.txt`. Produce a portable ZIP and SHA-256 for the eventual release. Prefer no installer unless a demonstrated missing native function requires it. Document external WebView2 and Agent CLI prerequisites in plain language.

### C. Local persistence, upgrade and copy-cache self-service

1. Test upgrading real **synthetic fixtures** representing 0.7.2/0.8.0/0.8.1 settings, SQLite history, deliveries and shared credential references into the next version. Preserve queued/running/unknown execution and immutable Agent bindings; never silently replay an interrupted Agent. Test mid-upgrade failure/restart and rollback against disposable roots. Use existing versioned backups, add the smallest missing migration safeguard; do not build a backup framework without a proven gap.
2. Native file clipboard cache currently persists even after history deletion and app exit, deliberately protecting advertised Markdown file paths, but caps at **1,000 files / 256 MiB**. Add a minimal, comprehensible GUI view of cache usage plus explicit **clean old cache** / open cache folder affordance so a user isn't stranded at quota with no CLI-free recovery. Show scope, retained paths and expected impact before removal; don't delete current clipboard-advertised files, user-exported Markdown, active tasks or the durable history. If native clipboard ownership/retention cannot be established, fail safely and expose a manual explanation rather than silently invalidating Paste.
3. Keep backup/export ergonomics proportional: a discoverable data-directory/backup explanation and optionally one-click **redacted diagnostics** are sufficient for v1 if the upgrade/rollback matrix passes. Never export live Tokens or real screenshots in a diagnostic bundle. Full import/export/restore wizard is not a release prerequisite absent actual demand.

### D. Small v1 UI/readiness finish, not another redesign

Review only first-run empty/error states, long paths, compact Windows display, applied-vs-draft state, the labels for Copy text / Copy files / Retry delivery, folder error recoverability and version display. Keep Vue/Tauri and existing four-page structure; avoid React migration, a new design-system project, Remote UI, Agent failover or new approval ceremonies.

## Automated acceptance — primary evidence

Before code changes: `git fetch origin --prune`, inspect `git status`, main HEAD and PRs, safely integrate newest `origin/main` without discarding user changes, and read `AGENTS.md`, `docs/LOCAL_V1_FIRST_MILESTONE.md`, this plan, `docs/M8_VALIDATION.md`, `docs/M8_WINDOWS_RUN.md` and implementation-specific code. Do not continue a stale M8 implementation goal.

- Frozen install; `npm run check` (lint, TS/Vue typecheck, Node test suite, build, Fake/package-resource smoke); `npm run desktop:test-ui` including keyboard, 1040x760 / 720x560 / 480x640 layout and changed error paths. Log command, source SHA, exit status, test count, skipped-platform boundaries.
- Windows CI: Node 22/24, native clipboard helper OLE/CF_HDROP/DropEffect/sequence/conflict/readback, Credential Manager mock/preflight, Rust fmt and release tests, packaged ZIP resource manifest, bundled Node and `Shot2Agent.exe` pipe/quit/job cleanup. All code tests run on disposable roots and synthetic screenshots with Fake/mocked adapters, **no real paid model requests**.
- Fresh portable ZIP in a new directory with no target-machine Node/Git/pnpm dependency; empty root launches GUI without Profile; GUI configures two Agent kinds and a mocked GLM Token lifecycle; selected Profile remains immutable per task; one/five images submit atomically; folder-only/clipboard-only/both/off work; all output destinations independent; manual copy, failure and retry never rerun Agent; deletion/cleanup/restart/upgrade survive.
- Cache tests: quota accounting, duplicate publication, current clipboard reference protected, explicit confirmed stale-cache cleanup, restart, history deletion preserves export and active clipboard file. Upgrade tests: fixtures, credential reference migration, crash/rollback and redacted diagnostics.
- Prefer running **automated Windows interactive UI tests** for Explorer paste and notification/focus. If unavailable, classify those specific observations `NOT VERIFIED`; CI/helper success cannot substitute for an actual Explorer Ctrl+V.

## Only if interactive desktop verification cannot be automated

Use the **exact final candidate Windows x64 ZIP** and record its commit and build identity. Extract completely in a new directory. Open the packaged developer-only `Start acceptance.cmd` by double click for a disposable Fake root; do not run regular paid Agents, use your personal screenshots, change live Tokens or clear your real history.

**Single required unresolved test (0.8.1 follow-up):** In Fake mode, submit a tiny synthetic PNG; after its success open History and click **复制文件 / Copy files**. Open an empty test folder in Windows Explorer and press **Ctrl+V**. Repeat with a second synthetic task and repeat once more after hiding the app to tray. **PASS:** all three pastes create readable `.md` files; Explorer has Paste; no foreground focus theft; the app shows correct clipboard failure/replacement status if another program changes it. **FAIL:** report the specific attempt, whether Paste was available, any displayed error/phase code, and whether a `.md` file appeared. Do not use Win+V history as evidence for CF_HDROP.

Previously operator-reported folder, batch, pause and notification checks are **not** to be repeated by default unless changed code invalidates their evidence. If M9 actually changes notification/folder/native picker behavior, add **only its changed observation** (exact click, expected outcome, and boundary) to the checklist. If no interactive test machine is available and the operator does not retest, report Explorer as NOT VERIFIED and do not call Local v1.0 fully accepted.

## Release and stop conditions

- Aim for **one focused implementation PR**, with at most one evidence-driven stabilization follow-up; no GitHub issues or additional planning milestones.
- CI and Windows packaged gates green **on the exact final head**; executable starts without special developer commands; no regression in Local no-Relay processing; cache is maintainable from GUI; migrations do not lose operator data.
- Record a short acceptance matrix with PASS/FAIL/NOT VERIFIED and evidence URLs. Previously accepted unchanged native behaviors remain accepted; do not assert real provider vision, all IMEs or arbitrary binary file return without proof. The original Explorer paste regression must be closed with actual evidence before the **fully accepted** v1.0 declaration.
- Only then synchronize application version/manifest/build identity and create `v1.0.0` tag + GitHub release with final Windows x64 ZIP, checksum, two-minute usage guide and known genuine external prerequisites. If a blocking real issue remains, ship a clearly marked release candidate and state the blocker; do not invent extra security gates or endlessly subdivide the milestone.
