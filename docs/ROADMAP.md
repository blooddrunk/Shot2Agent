# Implementation roadmap: thin vertical slices and gates

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

Implement **M1 shared durable Local task core + optional authenticated Remote Relay adapter** first. Keep M2-M5 out of scope except interface stubs and contracts required for M1. Agent should begin by syncing the latest `main`, then inspect this roadmap and `AGENTS.md`; do not rewrite agreed product requirements without evidence.
