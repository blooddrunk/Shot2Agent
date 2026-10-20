# V1 logical protocol / task lifecycle

**Status:** V1 logical contract. M1 serves task upload/history/files and Worker claim/start/heartbeat/complete/fail; cancel/review/retry remain planned. Exact M1 shapes, limits and decisions are documented in [M1](M1.md). **Local mode uses the shared task application service directly, without HTTP Relay/VPS or remote task upload.** See [Deployment modes](DEPLOYMENT_MODES.md).

## Task identity and immutable input

`taskId`: client-generated UUID representing one logical submission. Retries of a network upload reuse this ID. `Idempotency-Key` binds the authenticated client and immutable request digest. Reusing the ID or key with different content returns conflict; it cannot silently overwrite a task.

`profileId` and `profileVersion`: a worker-approved profile reference. The task records the resolved prompt/config fingerprint when execution begins. The web UI must never expose private worker paths or secrets unnecessarily.

`images`: nonempty ordered array of `{ fileName, contentType, byteSize, sha256 }`. Upload bytes are validated independently for MIME, dimensions, size, hash and path safety. Preserve the order and hashes.

`taskInstructions`: optional bounded user-supplied text treated as data, not authorization. Task creation may not set executor paths, shell commands, sandbox flags or API secrets.

## Remote states

```text
queued -> leased -> running -> succeeded
   |       |           |-----> failed
   |       |           |-----> timed_out
   |       |           |-----> canceled (best effort)
   |       |           |-----> execution_unknown
   |       +-> queued (expired before start)
   |       +-> canceled (before start)
   |       +-> execution_unknown (ambiguous launch)
   +-> canceled
```

`queued`, `leased`, `running`, `succeeded`, `failed`, `timed_out`, `canceled`, `execution_unknown` are distinct statuses. All terminal states are immutable. **Retry creates a new execution attempt and preserves previous evidence**; do not mutate old successful/failed attempts as if they had never happened. `execution_unknown` explicitly means side effects may have happened and automatic replay is unsafe.

Capture-side `awaiting_confirmation` and Remote-mode `pending_upload` are local intake/outbox states, not task execution states. Local mode proceeds to durably `queued` once local persistence succeeds. Notification delivery uses separate `pending`, `sent`, `failed` statuses.

## V1 HTTP endpoints (Remote Relay only; cancel/retry deferred beyond M1)

| Audience | Method / route | Behavior |
| --- | --- | --- |
| Capture | `POST /v1/tasks` | Authenticated multipart upload; idempotent, validates image bytes, profile ref and limits; creates queued task |
| User | `GET /v1/tasks?cursor=...` | Cursor-paginated history limited to authorized user |
| User | `GET /v1/tasks/{taskId}` | Metadata/status/result/attempts, only authorized tasks |
| User | `GET /v1/tasks/{taskId}/files/{fileId}` | Authorized input/attachment access (private, time-bounded) |
| User | `POST /v1/tasks/{taskId}/cancel` | Cancel queued task or request best-effort running stop |
| User | `POST /v1/tasks/{taskId}/retry` | Explicit new attempt; requires review for uncertain/writable tasks |
| Worker | `POST /v1/worker/claim` | Atomically claim compatible queued task, issue lease/attempt/fencing token |
| Worker | `POST /v1/worker/tasks/{taskId}/start` | Confirm launch under active lease |
| Worker | `POST /v1/worker/tasks/{taskId}/heartbeat` | Extend valid lease, report bounded progress |
| Worker | `POST /v1/worker/tasks/{taskId}/complete` | Idempotent final result + manifest, guarded by current attempt token |
| Worker | `POST /v1/worker/tasks/{taskId}/fail` | Error classification and bounded diagnostic text, guarded by attempt token |

Server authentication, status and error codes, upload streaming/atomicity, artifact upload transaction and schema details must be specified and tested before service implementation. This document is intentionally a **logical contract**, not a falsely precise implementation-ready OpenAPI spec.

## Recommended result envelope

### Delivery policy vs. task execution (confirmed product contract; API shape deferred)

Execution result/history is always retained under appropriate access control: private local Windows user storage for Local mode or authenticated VPS Relay access for Remote mode. Optional delivery channels are independent switches, **not** a mutually exclusive destination enum:
`remotePush.enabled`, `localSave.enabled` and `clipboard.enabled`; optional desktop notification may be a separate switch. All false is a supported **history-only** policy. Clipboard alone has one policy `smart | always | manual` and one automatic payload preference `text | files`. The Windows recipient determines local paths and never trusts agent-provided destinations.

Remote-mode origin ownership/identity is derived from authenticated task submission and remains distinct from Worker identity. Local mode binds results to the local Windows user/app context, without Relay credentials. Remote push delivery, local file saving, and clipboard write have **separate delivery receipts/statuses**, distinct from `task.status` and each other. A clipboard receipt proves write or conflict suppression, not paste; a file receipt proves verified atomic save, not user access.

For M4, Remote mode fetches pending results using authenticated outbound requests; Local mode reads its own persisted output directly. Both run enabled delivery channels independently. Retries must be idempotent; an offline receiving device retains pending delivery within server retention. Results containing both Markdown and generated files can be saved together, while a **single automatic clipboard action** selects text or downloaded local files. Remote URLs and worker paths must never be published as file-drop clipboard items.

**M1 now includes direct Local dispatch:** build one shared durable task core and optional authenticated HTTP Relay transport; test Fake Worker in both paths. Do not implement push, delivery endpoints or clipboard logic in M1. Preserve private results and origin ownership so M4 can add return delivery. See [Result delivery policy](RESULT_DELIVERY.md).


- `taskId`, `attemptId`, `status`, `summary`, `contentMarkdown`, `artifacts[]`, `errorCode`, `errorDetail`, `startedAt`, `finishedAt`, `profileId`, `profileVersion`, `workerId`, `adapterName`, `adapterVersion`.
- Artifact references are relay-generated, access-controlled IDs. Paths on the worker are never trusted as downloadable URLs.
- Logs and progress are bounded and sanitized. Store enough structured metadata to distinguish transport errors, agent exit code, invalid outputs and interrupted work.

## Compatibility and validation

- Add API version in path and schema version in persistent records.
- Validate request and response at each trust boundary (capture/relay/worker), not only in browser forms.
- Atomically claim; leases expire using server time rather than trusting worker clocks.
- Test idempotency same-input replay, key collision, double claim, stale heartbeat/complete, restart persistence, poisoned file names, and crash-before/after-start.
- See the executable starter in `packages/contracts/src/index.ts`. It validates immutable submission metadata, shared lifecycle and bounded Agent results. The shared core and adapters enforce byte integrity, identity and attempt fencing.
