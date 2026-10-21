> **M5-L 0.5.0 candidate:** Local Codex/Claude discovery, stopped-Worker explicit approval and immutable new-task Agent selection. Claude native transport qualified only at 2.1.305/2.1.306, personal Pro/Max only; actual model/GUI gates remain separate. See [Windows controls and restrictions](M5_WINDOWS_ACCEPTANCE.md) and [executed validation](M5_VALIDATION.md).

# Implementation roadmap: thin vertical slices and gates

M3-L bounded Windows Local desktop is implemented; see [run guide](M3_WINDOWS_RUN.md) and [evidence](M3_VALIDATION.md). The six requested desktop observations are operator-reported PASS on 2026-10-21, with a Smart/input-method caveat; other native claims remain separately scoped. The broader M3–M5 lists below remain deferred V1 scope.

> M2-L update (2026-10-20): M2-L minimum Local functional acceptance was closed on operator feedback dated 2026-10-20; full V1 and dedicated unobserved native cases remain outside that conclusion. See [usage](LOCAL_MVP_USAGE.md) and [executed verification](M2_VALIDATION.md). Keep deferred V1 capabilities below; a single bounded stabilization pass should address observed Windows failures, not restart sequential infrastructure milestones.

**Status:** implementation plan. This is not a completion report. Prioritize automated tests and reproducible evidence. Do not use GitHub issues as a prerequisite for this personal project.

## Guiding constraints

- The contract and trust boundary come before UI polish.
- One capture client and Worker (one active execution at a time); **Local mode without Relay/VPS** is the default, and **Remote mode with optional VPS Relay** adds cross-device capabilities.
- Every slice must include negative-path tests, not just a happy-path demo.
- Synthetic test images by default; never commit real screenshots, credentials, VPS tokens or agent transcripts with secrets.
- Keep untested Windows-native behavior behind an explicit verification gate; Linux CI cannot prove tray, clipboard or installer behavior.
- Local operation must never require VPS setup. Deploy the optional Remote mode only after auth, object access control, persistence and restart tests pass.

## M0 - Bootstrap and contracts (this repository bootstrap)

Deliver: README, product scope, **Local/Remote mode contract**, architecture, protocol lifecycle, dev guide, AGENTS.md, test plan, minimal contracts package and zero-dependency CI contract tests. Updated deployment documentation was added after initial bootstrap.

Automated gate: `npm test` green locally and in CI on Node 22/24; branch clean; docs links exist. This **does not** prove any end-to-end implementation.

## M1 - Shared durable task core + optional Relay adapter + Fake Worker

Implementation: [M1 developer slice and acceptance](M1.md). The following scope is implemented with automated Fake tests; native/production acceptance remains separate.

Deliver one TypeScript **task application core**, not two backends: validated immutable tasks and state transitions, attempt tracking, private blob storage abstraction, SQLite migrations, transactional task/attempt persistence and history reads.

**Local slice (mandatory):** provide an in-process CLI harness that sends one or five synthetic screenshots directly to the task core, dispatches a deterministic Fake Agent/Worker on the **same machine**, and reads the persisted output with **no Relay HTTP server, VPS, URL, API key, or network upload required**. Verify restart persistence, recovery and non-duplication.

**Remote slice (mandatory):** expose the same task core through authenticated Node/Fastify HTTP API, robust/idempotent multipart uploads, atomic claim/lease/fencing/heartbeat/start/complete endpoints and private file reads. A Fake Worker and client CLI must prove remote round trips locally using synthetic data.

Automated gates:
1. Local: `submit -> persist -> dispatch fake agent -> complete -> local history` without any Relay service/configuration; SQLite/images/results survive restart; a repeated process does not blindly re-execute ambiguous side effects.
2. Remote: `upload -> claim -> start -> complete -> authenticated read`, identical upload idempotency, conflicting key refusal, wrong identity denied, double claim fenced, expired lease protected, partial upload rollback, reboot recovery and after-start uncertainty.
3. Cross-mode: both use the **same task state machine and result contract**; shared conformance fixtures cover the same state transitions and artifacts. Prove Local mode issues **zero Relay requests**.
4. No external VPS, paid API, real Codex credentials or real screenshot content required in CI.

Stop condition: do not proceed to live Codex before both the Local core and Remote adapter meet persistence, security and failure-recovery gates. Keep Windows tray, real Codex, clipboard, push and VPS deployment out of M1.

See [Deployment modes](DEPLOYMENT_MODES.md).

## M2 - Worker + Codex adapter

Deliver: Node Worker that supports both **same-PC Local dispatch without Relay** and outbound-only Remote Relay claims, approved-version Profile registry, input integrity checks, launch/timeout/cancel, bounded logs, output manifest, `codex exec` adapter and deterministic Fake Agent. Treat screenshots as untrusted data and only allow worker-owned workspace paths.

Automated gate: fake adapter integration exercises normal output, fake crash, timeout, cancellation, failed result upload, corrupt image, path traversal, malicious profile ID, fenced retry and unknown execution result. Use mock child process for exit/status/log parsing. No real Codex credentials required in CI.

Optional manual gate (only if Codex unavailable in CI): On a Windows machine with Codex CLI installed and authenticated, run `codex --version`, then a sandboxed test on a synthetic screenshot with an intentionally harmless prompt. Confirm input attachment, final Markdown, task attribution and timeout/stop behavior. Redact screenshots/tokens in evidence; mark actual Codex behavior as **unverified** until completed.

## M3 - Windows native capture tray

Deliver: Tauri 2/Vue3 tray client, watched-folder source, clipboard-image source, pause, auto/confirm, manual batch, dedupe, durable **Local task submit / Remote upload** outbox, mode selector (Local default; Remote opt-in), Profile selector, local task history and status panel. Local operation must not require Relay configuration. Prefer minimal native permissions. Build MSI/NSIS choice only after smoke testing.

Automated gate: capture event parser, filesystem write-settle logic, image decoder/MIME checks, dedupe window, outbox retry/idempotency, five-image ordered batch creation, pause/ignore behavior, settings persistence, sanitization of local filenames. Run Windows CI build/smoke tests where practical.

Mandatory Windows manual proof: See `TESTING.md` for precise clipboard, Print Screen, tray and installer interaction steps. A green Linux CI cannot substitute for these steps.

M3 may provide Windows-native clipboard and local-result-writer adapters required by M4; do not activate automatic result delivery until the M4 configuration, authorization and conflict-handling tests pass.

## M4 - Web history + notification adapter

Deliver: local task history/Markdown artifacts for Local mode and authenticated web history for Remote mode, retry/cancel controls, independent desktop notification plus optional direct/provider remote push (provider selection remains open).

Automated gate: permissions on every list/detail/artifact endpoint, pagination, XSS-safe Markdown rendering, notification outbox retry, successful task survives notification outage, cancel/race handling and retention cleanup.

Optional provider manual gate: using synthetic content, push to a test device; confirm link opens only after login. No real screenshot content in the push payload.

**Confirmed V1 delivery orchestration (M4 with M3 native integration):** web history is mandatory; remote notifications, local auto-save, and clipboard return are individually configurable and may all be enabled together. Clipboard policy is `smart | always | manual`, orthogonal to the other channels. All optional delivery channels may be off (silent/history-only). Track outcomes and retries per channel so that failure of one cannot fail another or the task itself. Verify multi-channel fan-out, disabled channels, an offline receiving client, file integrity, self-trigger prevention and clipboard conflicts. See [Result delivery policy](RESULT_DELIVERY.md). **M1 scope is revised to require a shared durable Local core as well as an optional Remote adapter.** Preserve authenticated origin/owner associations for later Remote result receivers.

## M5 - Private VPS release hardening

Deliver: release-grade **standalone Windows Local mode without Relay**, plus optional repeatable VPS Remote deployment with TLS, secrets, backups/restore, retention, log sanitization, health checks, resource limits, upgrades/rollback and recovery.

Automated gate: containerized Linux integration test from fresh volumes, DB migration and restart/restore, malformed image attack cases, crash injection and storage exhaustion tests. Prevent unsigned/unreviewed arbitrary commands from reaching the worker.

Mandatory limited manual proof: real VPS DNS/TLS, full cross-device upload, unplug/reconnect one endpoint and push reception; explicit evidence and observed status per scenario. Do not claim production readiness until observed.

## Review checklist for each milestone

1. List changed files and describe what is actually implemented vs documented only.
2. Run the relevant automated tests/typechecks/lints/builds. Capture exact commands, exit codes and meaningful failing output.
3. Test negative paths and preserve short sanitized evidence in PR description or `docs/verification/` as text; do not commit screenshots containing sensitive inputs.
4. For unavoidable manual checks: list prerequisites, exact steps, expected observable outcome, and known unverified boundary. Do not write vague "needs manual verification" with no procedure.
5. No silent fallback to elevated privileges, unsafe sandbox flags, hardcoded secrets or public artifact URLs.

## Suggested next engineering handoff

**M1 completed and merged in PR #1. M2-L minimum Local loop is implemented and operator-accepted**, as recorded in [M2 validation](M2_VALIDATION.md#operator-acceptance-2026-10-20): Windows clipboard screenshot -> durable Local core -> real Codex -> Markdown/history -> clipboard copy and local save, plus Fake CI. The intended user-facing form remains a Windows tray/desktop app. M3-L now implements the requested bounded desktop shell over this core; its native acceptance is tracked separately in [M3 evidence](M3_VALIDATION.md). The numbered M2-M5 sections above describe deferred full V1 work, **not mandatory sequential prerequisites** for this Local MVP. Keep Relay/VPS, remote push, full tray UI and installer outside M2-L. Begin by syncing latest `main`; do not discard local changes. M2-L revises the M1 16-million-pixel decoder guard (4K dual monitor requires >16 MP).

## Proposed bounded Local reliability follow-up

The operator's 2026-10-21 feedback requests discussion of configurable retries for delivery and Agent generation. Existing fixed native retries and explicit delivery-only retry remain implemented; configurable limits/backoff and explicit Agent rerun controls remain proposed. See [classification and boundaries](RESULT_DELIVERY.md#local-retry-policy-current-behavior-and-proposal). Preserve Smart conflict protection, durable independent channels and `execution_unknown` no-auto-replay. This is a bounded reliability proposal, not a new Remote/infrastructure milestone or an implemented feature.

## M4-L Local reliability / Windows release gate

The bounded 0.4.0 slice implements no-clobber Markdown publication, independent bounded delivery retries, safe clipboard/IPC diagnostics and restart receipts. Agent rerun UI is deferred; no possibly launched execution replays automatically. No installer/Remote expansion. See [scope](M4_LOCAL_RELIABILITY.md) and [executed validation](M4_VALIDATION.md); CI/native observations remain separate.

Desktop 0.4.1 is a bounded M4 closeout: explicit real Codex entry using the existing approved Profile, separate Fake/legacy history and mode labels. It does not begin another milestone or add a Profile editor/Agent rerun. See [entry validation](DESKTOP_CODEX_ENTRY_VALIDATION.md).

## M6-L Local global actions and Gateway Profiles (0.6.0 implemented; operator accepted)

- PR #9 shared effective delivery consent fixed and merged; post-merge gates are independent.
- Native Windows RegisterHotKey thread: individually configurable bindings (all disabled initially), transactional conflict rollback, exit cleanup, tray/UI actions and bounded feedback.
- Latest successful durable result ordering; delivery-only retry skips succeeded, conflict and ambiguous/interrupted channels; immutable approved Agent cycling.
- Distinct Claude-compatible endpoint Profiles, two explicitly pinned HTTPS endpoints, model mappings, OS-backed immutable credential references, isolated child environment and unchanged policy/tools/MCP checks.
- Mock and actual native-CLI-to-Mock transport are separate from paid model vision. Default vision is NOT VERIFIED and refuses execution. No fallback. Operator attestation requires separate endpoint/model evidence; not an automated qualification.
- Global-action acceptance steps 1–6 are operator-reported PASS on 2026-10-21, including hidden-window copy/focus/paste, pause/resume, delivery retry, persistence/cleanup and configuration refusal. Optional branches are not separately attested. See [M6 validation](M6_VALIDATION.md). The operator also reports real Claude Code + `glm-5.3-flash` testing PASS on 2026-10-21. Acceptance is scoped to that local configuration; exact HTTP counts, independent TLS/redirect evidence and other configurations are not inferred.
- Profile list management supports confirmed removal/restoration without deleting immutable execution bindings or shared credentials. A separate one-request direct-image diagnostic has an explicit launch entry and durable repeat protection; Claude CLI live qualification remains separate.
- Close this bounded M6-L round after the display-only stabilization gates pass; no further paid-model acceptance is requested. Unapproved Profiles still default to refusal. PR merge and post-merge main checks remain separate. If product work resumes later, prioritize graphical Profile/credential configuration over more infrastructure. Remote/VPS, installer, folder watching and Agent rerun remain deferred.

## Product milestone decision (2026-10-21): Local v1.0 FIRST

M6-L PR #11 has been merged. **M6 functionality is not Local v1.0 completion.** Next work is GUI-first setup, Token/Profile management and local history deletion/cleanup (**M7-L**), then outstanding Local watched-folder, manual batch, file clipboard and notification behavior (**M8-L**), then standalone Windows packaging and full Local acceptance (**M9-L**). Remote/VPS is deferred until Local v1.0 ships. See [the binding Local-first plan](LOCAL_V1_FIRST_MILESTONE.md). No ordinary user should need to run Shot2Agent CLI commands, edit profiles.json/settings.json or launch separate credential-repair scripts to use Local v1.0. Older roadmap milestones are architectural inventories, not additional compulsory gates. Keep essential data/credential safety without new process-heavy reviews for this personal research app.
