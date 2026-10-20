# Implementation roadmap: thin vertical slices and gates

**Status:** implementation plan. This is not a completion report. Prioritize automated tests and reproducible evidence. Do not use GitHub issues as a prerequisite for this personal project.

## Guiding constraints

- The contract and trust boundary come before UI polish.
- One VPS relay, one capture client, one worker, one notification adapter. One worker executes one task at a time.
- Every slice must include negative-path tests, not just a happy-path demo.
- Synthetic test images by default; never commit real screenshots, credentials, VPS tokens or agent transcripts with secrets.
- Keep untested Windows-native behavior behind an explicit verification gate; Linux CI cannot prove tray, clipboard or installer behavior.
- Deploy only after auth, object access control, persistence and restart tests pass.

## M0 - Bootstrap and contracts (this repository bootstrap)

Deliver: README, product scope, architecture, protocol lifecycle, dev guide, AGENTS.md, test plan, minimal contracts package and zero-dependency CI contract tests.

Automated gate: `npm test` green locally and in CI on Node 22/24; branch clean; docs links exist. This **does not** prove any end-to-end implementation.

## M1 - Durable relay + CLI test fixture (next coding-agent goal)

Deliver: a Node/TypeScript HTTP server with authenticated capture/worker routes, schema-validated upload, private persisted image blobs, durable SQLite task/attempt records, atomic claim/lease/heartbeat/start/complete, read endpoints and a deterministic fake worker/client CLI for end-to-end tests. Document environment variables with placeholder-only `.env.example`. Ensure persistent storage is mounted outside ephemeral application directories.

Automated gate: isolated temporary DB/storage; test `create -> claim -> start -> complete -> read`, duplicate identical upload returns same logical task, mismatched reuse returns conflict, wrong identity cannot read task/artifact, two workers racing cannot claim the same task, stale lease cannot complete, restart preserves queue, incomplete upload leaves no visible queued task. Simulate failure before/after execution start. No external cloud or VPS is required for this gate.

Stop condition: do not proceed to live Codex integration when there is no stable authenticated, idempotent and restart-safe server path.

## M2 - Worker + Codex adapter

Deliver: outbound-only Node worker, approved-version profile registry, image download/integrity checking, launch/timeout/cancel handling, bounded logs, output/attachment manifest, `codex exec` adapter plus deterministic fake adapter. Treat screenshots as untrusted data and only allow worker-owned workspace paths.

Automated gate: fake adapter integration exercises normal output, fake crash, timeout, cancellation, failed result upload, corrupt image, path traversal, malicious profile ID, fenced retry and unknown execution result. Use mock child process for exit/status/log parsing. No real Codex credentials required in CI.

Optional manual gate (only if Codex unavailable in CI): On a Windows machine with Codex CLI installed and authenticated, run `codex --version`, then a sandboxed test on a synthetic screenshot with an intentionally harmless prompt. Confirm input attachment, final Markdown, task attribution and timeout/stop behavior. Redact screenshots/tokens in evidence; mark actual Codex behavior as **unverified** until completed.

## M3 - Windows native capture tray

Deliver: Tauri 2/Vue3 tray client, watched-folder source, clipboard-image source, pause, auto/confirm, manual image batch, dedupe, durable local outbox, profile selector and task status panel. Prefer minimal native permissions. Build MSI/NSIS choice only after smoke testing.

Automated gate: capture event parser, filesystem write-settle logic, image decoder/MIME checks, dedupe window, outbox retry/idempotency, five-image ordered batch creation, pause/ignore behavior, settings persistence, sanitization of local filenames. Run Windows CI build/smoke tests where practical.

Mandatory Windows manual proof: See `TESTING.md` for precise clipboard, Print Screen, tray and installer interaction steps. A green Linux CI cannot substitute for these steps.

## M4 - Web history + notification adapter

Deliver: authenticated task history / result detail with Markdown and artifacts, retry/cancel controls; desktop completion notifications plus one mobile push adapter (provider selection remains open).

Automated gate: permissions on every list/detail/artifact endpoint, pagination, XSS-safe Markdown rendering, notification outbox retry, successful task survives notification outage, cancel/race handling and retention cleanup.

Optional provider manual gate: using synthetic content, push to a test device; confirm link opens only after login. No real screenshot content in the push payload.

**Optional reverse-delivery proposal:** The capture Windows tray may retrieve completed results back to the originating device, save Markdown/artifacts to a locally approved directory, and optionally copy text or downloaded real files to the interactive Windows clipboard. This is an opt-in extension, not a confirmed mandatory V1 criterion and not part of M1's development gate. See [Return-to-origin proposal](RETURN_DELIVERY_PROPOSAL.md) for clipboard safety, delivery receipts and Windows validation.

## M5 - Private VPS release hardening

Deliver: repeatable documented deployment, TLS termination, secrets configuration, backups/restore, retention, log sanitization, health checks, resource limits, upgrade/rollback and recovery instructions.

Automated gate: containerized Linux integration test from fresh volumes, DB migration and restart/restore, malformed image attack cases, crash injection and storage exhaustion tests. Prevent unsigned/unreviewed arbitrary commands from reaching the worker.

Mandatory limited manual proof: real VPS DNS/TLS, full cross-device upload, unplug/reconnect one endpoint and push reception; explicit evidence and observed status per scenario. Do not claim production readiness until observed.

## Review checklist for each milestone

1. List changed files and describe what is actually implemented vs documented only.
2. Run the relevant automated tests/typechecks/lints/builds. Capture exact commands, exit codes and meaningful failing output.
3. Test negative paths and preserve short sanitized evidence in PR description or `docs/verification/` as text; do not commit screenshots containing sensitive inputs.
4. For unavoidable manual checks: list prerequisites, exact steps, expected observable outcome, and known unverified boundary. Do not write vague "needs manual verification" with no procedure.
5. No silent fallback to elevated privileges, unsafe sandbox flags, hardcoded secrets or public artifact URLs.

## Suggested next engineering handoff

Implement **M1 only** first. Keep M2-M5 out of scope except interface stubs and contracts required for M1. Agent should begin by syncing the latest `main`, then inspect this roadmap and `AGENTS.md`; do not rewrite agreed product requirements without evidence.
