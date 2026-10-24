> M11-X adds Rust WGC monitor capture and manual SendInput output over the existing inherited-pipe coordinator. Capture reuses LocalApp ingestion and watcher suppression; typing reads durable results without changing tasks or delivery receipts. Local and Remote remain independent of these optional native actions. See [scope](M11_X_SCOPE.md) and [design-only Linux platform-adapter plan](M12_V_PLAN.md).

> M8-L 0.8.0 adds independent Local folder/clipboard intake, ordered 2–5 image GUI tasks, CF_HDROP Markdown output and optional native completion notifications. [Current operation](M8_WINDOWS_RUN.md) and [executed validation / native gaps](M8_VALIDATION.md) supersede historical planned feature labels below. Next release scope is M9-L final Local v1.0, with Remote deferred.

# Architecture and trust boundaries

M10 development adds the optional desktop Remote path; see [Remote guide](REMOTE_GUIDE.md) and [executed verification](M10_R_VALIDATION.md). `RemoteQueue` stores an isolated bounded outbox/mirror under `remote/`; Local executable tasks remain in the existing Core database. A LocalApp submission port snapshots destination/target at submission, while one existing working/cleanup gate and OS process-owned worker lock serialize Local and Remote execution. No local HTTP server is added. Outbound `RemoteClient` carries capabilities, task leases and verified results; only locally submitted origin IDs feed automatic delivery. The same LocalState capture baseline and independent delivery reservations service both histories. Historical design sections below retain later M11 web/push proposals, not completion claims.

> M3-L desktop update: Tauri 2/Vue 3 uses a restricted anonymous-pipe Node child; no network listener or Relay. Windows Job containment owns descendants; EOF/quit aborts and settles work. Versioned capture settings share M2 settings with backup; SQLite tasks are retained. Worker exclusion is transactional and PID-aware. See [desktop operation](M3_WINDOWS_RUN.md) and [evidence](M3_VALIDATION.md).

> M2-L update (2026-10-20): M2-L now adds a direct Local CLI/coordinator (`apps/cli/src/mvp.ts`), Windows clipboard helper, worker-owned Codex registry and independent Local delivery; no HTTP import/service. Core tasks remain in tasks.sqlite; Local baselines/provenance/channel reservations are in local.sqlite. See [Local operation and boundaries](LOCAL_MVP_USAGE.md). The M3-L Local tray shell now hosts this pipeline; Remote receivers below remain future V1 work.

**Status:** M1 core/Fake and M2-L Local clipboard/Codex/text save/return are implemented; minimum Local use has [operator acceptance](M2_VALIDATION.md#operator-acceptance-2026-10-20). M3-L now adds the bounded Windows Local tray/desktop shell; Remote delivery remains planned and detailed unobserved native cases remain unverified.

## Boundaries

**Local (default; no Relay service or task network transfer):**

```text
Windows capture tray -> local task core / SQLite / private input blobs
                     -> approved same-PC Worker -> Codex adapter
                     -> durable local results -> clipboard / local save / history
```

**Remote (opt-in; VPS Relay):**


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

Capture and worker may run on one Windows PC in **Local mode with no VPS/Relay at all**, or across devices in **Remote mode with optional VPS Relay**. Both use one durable task domain. See [Deployment modes](DEPLOYMENT_MODES.md).

## Proposed stack (ADR subject to implementation verification)

| Component | Preferred option | Why |
| --- | --- | --- |
| Workspace | pnpm monorepo, TypeScript, Node >=22.16 | Shared interfaces, familiar tooling, separate deployables |
| Windows tray | Tauri 2 + Vue 3 + Vite + Rust plugins | Small runtime footprint and native tray/clipboard integrations |
| Shared task core | TypeScript + durable task/attempt/storage interfaces | One state machine used by direct local calls and optional Remote HTTP adapter |
| Optional Relay API | Node.js/TypeScript + Fastify | Remote-mode authenticated HTTP transport only; never required locally |
| Durable state | SQLite in WAL mode, local or VPS, with migrations | Persistent queues and history in both modes |
| Image blobs | Private local files (Local), private VPS volume (Remote) | No unnecessary network round trip in Local mode |
| Worker | Node.js/TypeScript process with Codex adapter | Can run outside a GUI, test via fake adapter |
| Result web UI | Vue 3 + Vite, minimal read/retry/cancel views | Reuse frontend knowledge; no native mobile app |
| Mobile notifications | One provider adapter (ntfy or Telegram, final selection deferred) | Provider-independent notification outbox |

Rust/Windows SDK features should be developed **on Windows**, not through a Linux-built UI running over WSL. Backend Linux compatibility is verified by CI/containers. Do not scaffold all services before proving the first thin end-to-end path.

## Components

### Confirmed V1 return-to-origin delivery capability (implemented during M3/M4)

In Remote mode the Windows tray acts as an outbound-only authenticated result receiver, fetching verified artifacts from the VPS. In Local mode, the same delivery handlers use existing durable local results **without uploading/downloading via Relay**. Clipboard, file saving and optional push remain independently configurable in both modes.

These are **parallel delivery destinations**, not a single exclusive destination selector. Capture-device defaults plus optional per-Profile overrides determine the delivery policy. History always exists; all optional destinations may be disabled. A failing notification, filesystem write or clipboard attempt must not change agent execution status or prevent the other destinations.

Windows clipboard `smart/always/manual` is a choice of write policy *within* the clipboard channel. Smart mode protects newer user clipboard activity. Results saved locally must not be recursively re-ingested by watched screenshot folders. The local output root belongs to the originating device and cannot be selected by agent output/remote worker. File clipboard requires already downloaded real local files, retained for pasting; write operations execute in the logged-in user session.

See [Result delivery policy](RESULT_DELIVERY.md) and [Deployment modes](DEPLOYMENT_MODES.md). M1 now provides one shared durable task core and optional Relay transport; channel fan-out is implemented later in M3/M4.


- **Capture app:** source configuration, tray UI, image staging, dedupe, pending outbox, batch authoring and profile selection. Capturing screenshots remains Windows' responsibility.
- **Shared task core:** private durable queue, task state, attempts and results with storage abstractions, testable directly without HTTP.
- **Optional Relay:** Remote-mode role-scoped auth, idempotent upload, authenticated leases, private blobs, artifact and web-read endpoints.
- **Worker:** identity and capability registration, poll/claim, heartbeat, local profile lookup, attachment integrity checks, constrained subprocess adapter, result upload.
- **Agent adapter:** `execute(task, resolvedProfile, images, signal) -> finalResult` plus progress/error lifecycle. Initial adapter is Codex CLI; tests use a deterministic fake.
- **Task history UI:** local task/history view in Local mode; authenticated web history in Remote mode.

## Authorization model

- Remote mode separates authenticated capture/web identity from Worker identity with leases and private credentials. Local mode relies on Windows user access controls, restricted local IPC and Worker-owned Profile permissions.
- Relay authorizes every task, screenshot, result and artifact read. Task IDs are *not* bearer secrets.
- Task request may reference only an approved `profileId` and `profileVersion`, never worker-side absolute paths, arbitrary command lines, agent credentials, or elevated sandbox flags.
- Worker independently validates profile, resolved workspace and permission boundary; do not trust relay payload alone.
- Sanitize filenames and reject path traversal, symlinks escaping approved roots, malicious mime/content mismatches and oversized uploads.
- Avoid public bucket ACLs and avoid passing credentials into agent prompts. Use parameterized process spawn (no shell) and bounded logs.

## Durability and failure model

- Local task submission is durable before it is displayed as queued. Remote-mode upload outbox remains durable until actual authenticated Relay acceptance.
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

The owner confirmed images **may** transit a personal VPS and approved cloud Agent, but VPS transit is not mandatory. Local mode requires no Relay; hosted model access is a separate concern. Both modes still require least privilege, retention and protected secrets.

M2-L Windows stabilization: a Worker waits for adapter-owned process/cleanup settlement after persisting an uncertain result. An unconfirmed stop pauses new Local claims; it does not replay or change the terminal task. Capture confirmation holds one pending image in memory, independent of later command-text copies, while Smart keeps the capture-time sequence baseline. See [verification](M2_VALIDATION.md#windows-stabilization-after-operator-feedback).
