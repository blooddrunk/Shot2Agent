# Coding agent instructions (Shot2Agent)

## Before making changes

1. **Sync latest code first**: `git fetch origin --prune`, inspect status/branch, then integrate `origin/main` into your working branch. Do not reset or discard uncommitted user changes. If already on the target branch, inspect merge-base and fast-forward safely.
2. Read `README.md`, `docs/PRODUCT.md`, `docs/DEPLOYMENT_MODES.md`, `docs/ARCHITECTURE.md`, `docs/PROTOCOL.md`, `docs/ROADMAP.md`, `docs/TESTING.md`, `docs/RESULT_DELIVERY.md` and `docs/DECISIONS.md`.
3. Identify the smallest roadmap milestone in scope. Separate verified facts from assumptions and propose corrections rather than silently changing product constraints.

## Development boundaries

- Monorepo with portable TypeScript contracts, Windows Native capture/Tauri, **same-PC Local task core/Worker by default** and optional VPS Relay for Remote tasks. The M2-L Local CLI has scoped operator acceptance; full GUI/installer and production Remote deployment are not delivered.
- V1: Local mode requires **no VPS/Relay**, Remote mode optionally uses VPS Relay; one Worker at a time, single/batch images, auto/confirm, durable queue, Codex adapter, mode-appropriate durable history and independent output channels.
- Profiles are worker-owned. Never allow remote task input to select a command, arbitrary working directory, credentials, or elevated sandbox.
- Default read-only; use `spawn` with explicit arguments and `shell: false`, and a bounded timeout. Screenshot text is untrusted input.
- No secrets, personal screenshot contents, production blobs, SQL files, live transcripts or `.env` secrets committed. Use synthetic fixtures.
- Never claim completion of Windows tray/clipboard, actual Codex authentication, remote mobile notifications or VPS deployment based only on unit tests.
- Prefer minimal dependencies, typed validated schemas, stable task IDs, idempotent upload, state transitions, safe replays, transactional claims and lease fencing.

## Validation before handoff

1. Run `npm test` now; as code grows, run lint, typecheck, build, isolated server/worker integration tests and Windows-specific jobs as applicable.
2. Exercise success **and** refusal/failure cases; use deterministic fake agent in CI.
3. Report commands executed, passing/failing tests, any missing real-environment prerequisites, and concise next actions.
4. For unavoidable manual verification, give explicit prerequisites, commands/actions, expected observable results, and boundary of what remains unverified. Follow `docs/TESTING.md`.
5. Do not merge code with failing checks or invent evidence. For VPS operations, avoid destructive migration without confirmed backup/restore plan.

## Next goal

**M2-L was reviewed and merged as PR #2** (squash commit `a1d1a7c7ccfa6b16e8b7c98ebf9bed419c4b61b0`). The minimum Local functional loop has scoped operator acceptance; do not mark unobserved Smart/focus/interruption cases verified. The next bounded implementation goal is **M3-L Windows Local tray/desktop shell**, specified in [docs/M3_LOCAL_DESKTOP.md](docs/M3_LOCAL_DESKTOP.md). Main requirements: configurable opt-in auto-submit of **new** clipboard images, safe pause/confirm, independent Smart/manual/Always clipboard return and Markdown auto-save, history/status, focus-safe background watcher, current Local worker reuse, and no Relay dependency. Fix the existing auto-watcher startup-image surprise. Prefer one engineering round plus only a short evidence-driven stabilization pass; defer Remote, push, folder watch, batch editor, file clipboard, and installer unless essential to the actual Local desktop start path.

**Before acting, fetch and integrate the latest origin/main**, because review may have already updated the repository. Follow [docs/WINDOWS_ACCEPTANCE.md](docs/WINDOWS_ACCEPTANCE.md): automate developer checks first, prepare a runnable Windows build, and ask the operator only for specific affected observations with executable steps and expected results. Do not describe tests or manual acceptance as executed unless independently observed.

## M3-L implementation handoff

M3-L now provides `apps/desktop` (Tauri 2/Vue 3), `packages/desktop` (restricted pipe coordinator), persistent capture consent/settings, new-image-only arming, history/status and independent existing delivery. See `docs/M3_WINDOWS_RUN.md` for actual controls/build and `docs/M3_VALIDATION.md` for executed checks. Preserve M2 operator acceptance; never convert M3 CI/build evidence into tray/focus/paste acceptance. No installer/Remote/folder watch/batch editor is added. Configuration status is visible read-only; changing a Worker profile is an operator-owned stopped-app operation.

## Operator acceptance update — 2026-10-21

The operator reported PASS for automatic submit, Notepad focus, actual Smart paste, conflict protection/manual Copy, save/restart persistence and pause/resume. Record the environment caveat: intermittent empty/blocked Smart behavior correlated with WeChat Input Method synchronization; root cause remains unverified. Do not claim universal input-method compatibility, separately unreported confirmation/discard GUI checks, or new real-Codex desktop proof. Configurable retry limits/Agent rerun are discussed proposals, not implemented or a waiver of Smart/no-auto-replay constraints. See `docs/M3_VALIDATION.md` and `docs/RESULT_DELIVERY.md`.

## M4-L reliability handoff

M4-L 0.4.0 adds no-clobber Markdown publication, independent bounded delivery retries and safe phase/error diagnostics. See `docs/M4_LOCAL_RELIABILITY.md` and `docs/M4_VALIDATION.md` for behavior and actual gate evidence. Smart retains original capture session/sequence on every attempt; ambiguous writes and interrupted delivery never auto-replay. Default 0 extra attempts; native writes have no hidden retries. Agent rerun UI is deferred; no possibly launched execution is automatically rerun. Keep the existing M3 operator scope and input-method caveat. New packaged smoke uses a unique disposable root, not operator history. Do not open a larger milestone solely for an unverified non-core desktop interaction.

## Current handoff — M5-L (supersedes earlier M2/M3 next-goal paragraphs)

**Before coding**, fetch and integrate the latest `origin/main` without discarding local changes, including any new documentation PR merges from review. Read [M5-L Local Agent choice and executable discovery](docs/M5_LOCAL_AGENT_CHOICE.md) as the **next bounded engineering goal**, not a claim it is already implemented. M4-L #5 and desktop entry #6 are already merged into main at `aab7d443fee1bd138300d4b20041b4b67f669b76`; recheck the live branch rather than treating this SHA as immutable. The earlier "Next goal: M3-L" above is historical, not a competing instruction.

Prioritize deterministic Windows discovery of Codex and Claude Code (with operator-approved manual override), a read-only Claude image adapter, per-new-task provider choice and immutable profile binding for queued tasks. Existing Worker stores only one active adapter/profile: **route outstanding tasks according to their original approved binding**, not the latest UI selection. Local remains no Relay. Existing Codex, legacy and Fake acceptance roots/history must remain available. Preserve bounded subprocesses, explicit `shell:false`, safe version pinning, honest auth/image capability checks and M4 delivery safety. Provider availability is **not** evidence of successful image analysis or login. Do not enable automatic failover, unknown-execution replay, unsafe tools or arbitrary execution-path IPC. Do not overexpand into Remote/VPS/installer/full profile editor.

Run and report actual source/Windows CI/package smoke (including process and descendant cleanup) before merging. Test both providers' selection, version drift, auth/image failure, crash/abort/timeout, no hidden provider fallback, queued-task routing and preserved history. If real Windows Claude authentication/image compatibility or focus/paste cannot be tested automatically, give a synthetic, non-admin operator script with prerequisites, commands, expected observations and PASS/FAIL/NOT VERIFIED, clearly separate from completed automated gates. One implementation PR plus an evidence-driven short stabilization pass maximum.
