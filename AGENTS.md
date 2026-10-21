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

## M5-L implementation candidate

Worker-owned provider/Profile registry, CLI discovery, explicit stopped-Worker `approve-agent` and new-task-only desktop selection are implemented for 0.5.0. Preserve old Codex/Fake/legacy roots and Profiles. Native Claude 2.1.305/2.1.306 JSONL image transport was probed against a synthetic local API; this is not real Claude model/authentication proof. Personal Pro/Max only; managed policy, API-key/Token/Team/unknown auth and unqualified versions refuse execution. Do not expand this boundary or use bare/permission bypass. Follow docs/M5_WINDOWS_ACCEPTANCE.md and docs/M5_VALIDATION.md; no failover or Agent auto-rerun. Final PR and merged main require independent gates.

## Operator follow-up — Always default and custom GLM

The operator reports other checked items PASS, but Smart still blocks new and historical tasks even after WeChat Input Method clipboard synchronization is disabled. Do not claim a Smart fix or attribute the cause to that input method. Fresh desktop settings preselect Always with capture disabled and overwrite consent unchecked; effective delivery stays manual until consent. Preserve existing modes and sticky Smart receipts. Custom GLM/token authentication is not supported by the current personal Pro/Max Claude adapter; the operator's working standalone CLI configuration is not Shot2Agent image-analysis proof. See docs/M5_VALIDATION.md.
