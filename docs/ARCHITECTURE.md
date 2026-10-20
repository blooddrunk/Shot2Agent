# Architecture and trust boundaries

**Status:** proposed architecture, not yet implemented.

## Boundaries

```text
TRUST ZONE A: Windows capture client
  watched folders / clipboard -> normalized local image -> pending outbox
        | user auth + HTTPS; immutable task request
        v
TRUST ZONE B: personal VPS relay
  authenticated API -> private blob store -> persistent task database / leases
       ^                                    |
       | private claim/download + heartbeat  | read-only authorized web results
       |                                    v
TRUST ZONE C: worker (Windows or Linux)
  approved profile -> sandboxed adapter -> Codex CLI -> local workspace
       | final result + declared artifacts
       +-----------------------------------> relay -> notification outbox
```

Capture and worker can colocate on one Windows PC but must not rely on that assumption. Neither endpoint needs an inbound public port; the worker polls/claims tasks via outbound HTTPS.

## Proposed stack (ADR subject to implementation verification)

| Component | Preferred option | Why |
| --- | --- | --- |
| Workspace | pnpm monorepo, TypeScript, Node >=22.16 | Shared interfaces, familiar tooling, separate deployables |
| Windows tray | Tauri 2 + Vue 3 + Vite + Rust plugins | Small runtime footprint and native tray/clipboard integrations |
| Relay API | Node.js/TypeScript + Fastify | Simple typed HTTP surface and testability |
| Durable state | SQLite in WAL mode initially, with migration strategy | Appropriate for one personal VPS and low concurrency |
| Image blobs | Private filesystem volume, configurable future object storage | Simple storage and cleanup, not in database rows |
| Worker | Node.js/TypeScript process with Codex adapter | Can run outside a GUI, test via fake adapter |
| Result web UI | Vue 3 + Vite, minimal read/retry/cancel views | Reuse frontend knowledge; no native mobile app |
| Mobile notifications | One provider adapter (ntfy or Telegram, final selection deferred) | Provider-independent notification outbox |

Rust/Windows SDK features should be developed **on Windows**, not through a Linux-built UI running over WSL. Backend Linux compatibility is verified by CI/containers. Do not scaffold all services before proving the first thin end-to-end path.

## Components

- **Capture app:** source configuration, tray UI, image staging, dedupe, pending outbox, batch authoring and profile selection. Capturing screenshots remains Windows' responsibility.
- **Relay:** role-scoped auth, idempotent upload, durable task state, worker leasing, artifacts and logs, retention, notification outbox and web read endpoints.
- **Worker:** identity and capability registration, poll/claim, heartbeat, local profile lookup, attachment integrity checks, constrained subprocess adapter, result upload.
- **Agent adapter:** `execute(task, resolvedProfile, images, signal) -> finalResult` plus progress/error lifecycle. Initial adapter is Codex CLI; tests use a deterministic fake.
- **Task history UI:** authenticated results, attempt status, thumbnails/attachments, retry/cancel actions, basic worker health.

## Authorization model

- Separate capture/web identity from worker identity; short-lived task leases and per-worker long-lived credentials handled outside the git repository.
- Relay authorizes every task, screenshot, result and artifact read. Task IDs are *not* bearer secrets.
- Task request may reference only an approved `profileId` and `profileVersion`, never worker-side absolute paths, arbitrary command lines, agent credentials, or elevated sandbox flags.
- Worker independently validates profile, resolved workspace and permission boundary; do not trust relay payload alone.
- Sanitize filenames and reject path traversal, symlinks escaping approved roots, malicious mime/content mismatches and oversized uploads.
- Avoid public bucket ACLs and avoid passing credentials into agent prompts. Use parameterized process spawn (no shell) and bounded logs.

## Durability and failure model

- Local outbox is durable until server acceptance, not just until HTTP request returns a partial response.
- Server atomically persists a task with idempotency key and its verified blobs. Orphaned staged blobs may be garbage-collected.
- Worker `claim` returns a lease token/attempt ID. `start` establishes whether side effects may occur. Heartbeats renew only the active lease.
- An expired **unstarted** lease can safely requeue. If the worker disappears **after start**, the system must preserve `execution_unknown` and not automatically repeat write-capable execution.
- A stale worker cannot complete or overwrite a new attempt: completion endpoints validate active attempt and fencing token.
- Execution success/failure differs from notification delivery success/failure; deliver notifications through a separate retryable outbox.

## Architecture decisions to revisit with evidence

1. Tauri clipboard-image event support may require a Windows-specific listener; verify with a real native smoke test before locking design.
2. SQLite write concurrency and backup/restore on the selected VPS must be validated; object storage is optional initially.
3. Codex CLI JSON event output and image options must be tested against an installed version (including the Windows executable and abort behavior).
4. Pin the chosen notification provider only when end-to-end push is proven; do not embed it in the task model.

## Security note

The owner confirmed intended images are allowed to transit a personal VPS and be processed by an approved cloud agent. This removes a mandatory local-only routing feature from V1; it does *not* remove the requirement for authentication, protected secrets, retention, visibility or least privilege.
