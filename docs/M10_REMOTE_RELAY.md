# M10-R / M11-R: Optional Remote and Relay roadmap

> STATUS: PLAN ONLY, 2026-10-24. This is not an implemented Remote desktop workflow, completed VPS deployment, or native acceptance. Always check current origin/main first. Local v1.0.1 release points to 1ae5bf5; later merged PR #24 is at main 35ce4a0 and is not automatically in that release ZIP.

## Product outcome and boundaries

Windows PC A captures and submits one screenshot or an ordered 2–5-image batch over **outbound HTTPS** to a personal VPS Relay. Windows PC B (or deliberately the same machine) uses a locally approved Codex / Claude Code / GLM Agent and outbound HTTPS to claim and process it. PC A receives the durable result, can view it in history, and can independently use its existing Markdown save, text/file clipboard, or native desktop notification channels.

**Local stays default, independently functional, and zero-Relay.** An unset/failed Remote connection never triggers a Local fallback for a Remote task. Capturing device and Worker are two independent optional roles, not synonyms for processing destination. Remote is an opt-in mode for new submissions; mode changes never silently migrate or re-execute prior tasks.

Reuse M1 existing Fastify Relay, RemoteClient, shared TaskCore / SQLite and lease/fencing plus Fake Worker; reuse the current desktop capture/Agent profile/delivery/UI and Tauri child-process safeguards. Do not rewrite Core or migrate Vue to React.

## Actual code inventory (planning baseline)

**Existing and tested at M1/Fake level:** `services/relay/src/server.ts` authenticated capture/viewer/worker roles; `services/relay/src/client.ts` upload/list/get/claim/start/heartbeat/complete/file; `packages/core/src/core.ts` immutable task IDs, dedupe, durable blobs, lease/start/uncertainty; `packages/worker/src/worker.ts` approved Adapter/WorkerPort; `apps/cli/src/remote.ts` synthetic Fake round-trip.

**Missing for ordinary use:** The entry `services/relay/src/main.ts` is a loopback test service with environment JSON devices, not a production VPS deploy. `packages/desktop/src/controller.ts` presently runs `LocalApp` only; there is no GUI Remote mode/outbox/remote Agent selection, background Worker B, receiver, verified result delivery or Remote history. Current Worker claim matches owner and profile ID/version, not an explicit target machine. Mobile push and web history are not yet implemented.

## Deliver in two bounded implementation phases

### M10-R — Functional cross-device Remote MVP (next coding-agent goal)

Make **PC A GUI -> durable offline Remote outbox -> Relay -> PC B approved Worker -> Relay result -> PC A GUI/history/delivery** work end to end using synthetic Fake tests and a repeatable self-hosted Relay configuration. A formal release is **not** justified by Fake CI alone. Prefer one functional PR and, only if evidence requires, one narrow repair PR.

1. **GUI and role model.** Add a small '跨设备处理' section: Local/Remote destination switch (Local default), Relay HTTPS URL, per-device token stored only in Windows Credential Manager, '测试连接', status/last sync, Worker B '在本机接收远程任务' opt-in, and target Worker/approved Agent picker. Show which PC executes tasks and that screenshots transit the user's VPS. No normal-user JSON, internal profile version entry, CLI commands, or multiple approvals. Preserve capture pause, confirmations, batching, history and tray state. Remote capture and Remote Worker roles may coexist on the same machine by explicit choice.
2. **Worker-owned safe capabilities.** Publish only device label/ID, approved profile ID/version/fingerprint/provider and last-seen. Never expose prompt, working directory, executable path, credentials, or full policy. Capture PC selects a remotely available Worker/Agent through GUI, and pins chosen target identity/profile/fingerprint in an immutable submission. Add minimal owner/role checked capability/presence endpoints and a versioned targetWorkerId schema/migration if required; validate target on claim. Worker always rechecks its own immutable approved local Profile before launch. Stale/offline workers appear visibly unavailable; do not silently remap to another Agent.
3. **Origin Remote outbox.** Before network access, durably persist the original UUID/idempotency key, image order/hashes, payload bytes, origin identity and selected target in a *separate bounded private* Remote outbox. Auto-retry transport only with that same ID/key/digest and bounded backoff/jitter. Distinguish pending upload, acknowledged/queued on server, processing and terminal; conflicts (401/403/409/413 and bad TLS) need readable failures rather than phantom success. A lost upload acknowledgement cannot create a second task, and a Remote job never enters the executable Local queue. Preserve image limits and 2–5-image user ordering.
4. **PC B Remote Worker.** Poll/claim/heartbeat/start/complete over authenticated outbound HTTPS; no inbound Windows socket, no mandatory WebSocket, no local HTTP Relay. Keep one *global* actual Agent execution slot across Local and Remote tasks on PC B. Reuse Codex/Claude/GLM local allowlist, immutable Profile, sandbox, worker-owned credentials and bounded stop/cleanup. No remote-supplied executable, prompt authority, arbitrary paths or auto-provider-failover. Lost pre-start leases may requeue; lost after-start/possible side-effects become execution_unknown and never auto-rerun. Completion-ack retry may resend identical result only, never launch Agent again.
5. **PC A Remote receiver.** Poll authenticated owner/origin tasks, persist sync cursor/receipts, download result and artifacts to a private bounded local cache, verify owner/origin, IDs, byte limits, SHA-256 before atomic publication. Reuse current independent save, clipboard (text and CF_HDROP local files) and Windows notification channel logic, with existing Smart/Always/manual rules. Only origin PC A auto-delivers; browsing another same-owner capture device's history cannot overwrite local clipboard. Results stay on VPS during A outage and download idempotently on reconnect; local history remains separate and accessible. All optional delivery channels off still means history-only. Successful task stays successful if one output channel fails.
6. **Minimal VPS deploy.** Add documented repeatable Docker Compose with one Node Relay, internal private network and SQLite/blob persistent volume; front it with Caddy or an existing nginx HTTPS reverse proxy; **no public raw API port**. For a container, listen on an internal interface only; keep the existing loopback dev default. Add health/ready endpoint with no private data, restart policy, bounded disk/upload/logging, and simple single-owner capture/Worker token provisioning using a mode-0600 mounted registry rather than a large production environment JSON. GUI imports per-device token and keeps it out of settings JSON, snapshots, logs and package. Provide token revoke/rotation, backup/restore, TLS/domain and upgrade instructions. Avoid OAuth, cloud SaaS, external secret managers and installer work.
7. **History/settings migration.** Preserve Local database, blobs and queued task semantics; any new schema is versioned/migrated with fresh-old-fixture tests. Never delete exported files or rewrite Local history. Remote task cancel/rerun controls should not be introduced casually: keep result retry distinct from Agent execution and show execution_unknown without automatic replay.

### M11-R — Remote closeout, push and v1.1.0 release gates

After M10's actual loop is demonstrated, add a minimal authenticated read-only web history, if useful for remote devices, and **one** optional mobile push adapter (e.g. ntfy) with bounded safe summary/authenticated link, not raw image/full result by default. Push is independent of origin save/clipboard/toast, and may be enabled concurrently with them or all be disabled. Validate VPS disk pressure, retention, consistent SQLite+blob backup/restore, restart/upgrade, least-privilege logging and service recoverability. Complete two-real-network TLS/VPS and Windows-native verification before labeling a formal Remote release. Release v1.1.0 only when supported; keep v1.0.1 unchanged.

Explicitly defer multiple push providers, agent failover, remote automatic profile repairs, public multiuser SaaS, hole punching/direct P2P, phone app, elaborate pairing UX, installer, automatic Local-to-Remote history migration and further infrastructure scaffolding.

## M10 automated acceptance (must actually run)

Use isolated disposable roots, synthetic images, deterministic Fake/mock, independent capture/worker tokens, no real model API/tokens or personal screenshots. Put executable test names, command, exit code and assertion observations into `docs/M10_R_VALIDATION.md` (create during implementation). NEVER mark an unexecuted gate PASS.

| ID | Acceptance with assertions |
| --- | --- |
| R01 | Local-only screenshot -> Fake -> results remains fully functional with Relay unconfigured and **zero Relay requests**; no Local database rewrite |
| R02 | Desktop/controller A GUI submission of single + ordered batch -> authenticated Relay -> independently running Fake Worker B -> A result/historical record + verified Markdown save, copy and notification mocks |
| R03 | Offline A before upload, truncated upload, server accepts then acknowledgement lost, restart A: **one task ID**, one logical server task, no duplicate Agent execution |
| R04 | Worker B offline then online; relay process restart; A offline at result completion then reconnect: task and verified result persist and delivery receipt remains idempotent |
| R05 | Unstarted lease expiry requeues; after-start disconnect preserves execution_unknown; stale/mismatched attempt completion denied, no secret/result leak or hidden Agent rerun |
| R06 | Wrong/missing/rotated token, role/owner mismatch, forged target, unapproved profile/fingerprint, oversized image, malformed result, hash mismatch, path traversal and symlink rejected |
| R07 | Save fails while clipboard/notification succeed independently; all channels off history-only; Smart avoids changed clipboard; file clipboard contains retained local .md files, never remote URLs |
| R08 | Local -> Remote -> Local affects new tasks only; A and B can be the same PC in opt-in Remote; no auto-mode fallback; Worker serializes Local and Remote jobs; no credentials in snapshots/config/log |
| R09 | `corepack pnpm install --frozen-lockfile`, `npm run check`, `npm run desktop:test-ui`, Windows Rust/Tauri package and extracted-EXE smoke, Node 22/24 Win/Linux CI; identify which prove only mock and which prove native |
| R10 | Container fresh-volume boot, authenticated upload/claim/download, persistence/restart/restore and unauthorized denial; no raw public HTTP listener and no real paid provider call |

## Minimal operator acceptance only when it cannot be automated

Prepare a packaged test build, synthetic fixtures, initialized Relay and explicit steps before asking a human; do not dump a developer CLI recipe on the operator. Record each case PASS/FAIL/NOT VERIFIED with observed output and applicable SHA, not an unqualified 'missing evidence' conclusion.

1. **Two Windows clients or isolated user sessions:** B opens packaged app and enables Remote Worker with Fake-approved test agent; A opens app, selects Remote, pastes HTTPS URL/device token in GUI, clicks Test, chooses B and approved Agent; submit synthetic single and reordered 2–5-image task. Observe one result per task, ordered inputs, understandable queued/offline/running/completed statuses and Local history unchanged.
2. **Native return:** on A enable save + clipboard manual + notification. Confirm Markdown file saved, text pastes into Notepad, '复制文件' pastes into Explorer and opens; no foreground-focus theft. Separately in Smart mode copy newer text before completion: it is not overwritten. Confirm Local submission still works without Relay.
3. **Actual separate-network VPS/TLS:** deploy Compose behind valid TLS with persistent volume; connect A/B from different networks, submit with B offline then bring it online; close A while B finishes and reconnect A to retrieve result; restart Relay to confirm persistence. Plain HTTP outside loopback is refused. Save only redacted observations.
4. **Failure/recovery:** revoke a disposable device token and observe clear disconnected/unauthorized status without fallback. Kill Fake Worker after start (automate this when possible), inspect visible execution_unknown and absence of automatic rerun.

If no access to a real VPS/domain/two interactive Windows machines, document exactly which external proof is NOT VERIFIED and do not claim production remote readiness. Developer must automate all mock, fault, protocol and Docker cases without user intervention.

## Coding-agent instructions

First `git fetch origin --prune`, inspect status/current branch/latest `origin/main`, PRs, tags and CI, then safely integrate latest main **without discarding local changes**. This planning file may have been merged since handoff. Read `AGENTS.md`, `docs/DEPLOYMENT_MODES.md`, `docs/PROTOCOL.md`, `docs/RESULT_DELIVERY.md` and the relevant M1/M9/1.0.1 validation. Make one focused M10 functional PR and no unnecessary preliminary issues. A passing M1 Fake test is not a passing cross-device desktop test. Prefer automated verification, bounded security practices appropriate to a personal project, and a small explicit human test only for truly native/real-network observations. Final report: changed files/commit SHA, exact executed tests with status/count, CI URLs, done vs deferred features, manual steps and genuinely unverified boundaries.
