# V1 logical protocol / task lifecycle

**Status:** design contract. HTTP routes below are planned and not yet served.

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

Capture-side `awaiting_confirmation`, `pending_upload` are **local outbox states**, not remote task states. Notification delivery uses separate `pending`, `sent`, `failed` statuses.

## Proposed HTTP endpoints

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

Execution result/history is always retained under authenticated access. Optional delivery channels are independent switches, **not** a mutually exclusive destination enum:
`remotePush.enabled`, `localSave.enabled` and `clipboard.enabled`; optional desktop notification may be a separate switch. All false is a supported **history-only** policy. Clipboard alone has one policy `smart | always | manual` and one automatic payload preference `text | files`. The Windows recipient determines local paths and never trusts agent-provided destinations.

Origin ownership/identity is derived from authenticated task submission and must be preserved independently from worker identity. Remote push delivery, local file saving, and clipboard write have **separate delivery receipts/statuses**, distinct from `task.status` and each other. A clipboard receipt proves write or conflict suppression, not paste; a file receipt proves verified atomic save, not user access.

For M4, the capture client may fetch pending results using outbound authenticated requests and perform each enabled destination without waiting for the others. Retries must be idempotent; an offline receiving device retains pending delivery within server retention. Results containing both Markdown and generated files can be saved together, while a **single automatic clipboard action** selects text or downloaded local files. Remote URLs and worker paths must never be published as file-drop clipboard items.

**M1 protocol scope unchanged:** do not implement delivery endpoints or clipboard logic in M1. Keep task owner/origin identity auditable and result blobs private so the M4 receiver can be added without changing core task semantics. See [Result delivery policy](RESULT_DELIVERY.md).


- `taskId`, `attemptId`, `status`, `summary`, `contentMarkdown`, `artifacts[]`, `errorCode`, `errorDetail`, `startedAt`, `finishedAt`, `profileId`, `profileVersion`, `workerId`, `adapterName`, `adapterVersion`.
- Artifact references are relay-generated, access-controlled IDs. Paths on the worker are never trusted as downloadable URLs.
- Logs and progress are bounded and sanitized. Store enough structured metadata to distinguish transport errors, agent exit code, invalid outputs and interrupted work.

## Compatibility and validation

- Add API version in path and schema version in persistent records.
- Validate request and response at each trust boundary (capture/relay/worker), not only in browser forms.
- Atomically claim; leases expire using server time rather than trusting worker clocks.
- Test idempotency same-input replay, key collision, double claim, stale heartbeat/complete, restart persistence, poisoned file names, and crash-before/after-start.
- See the executable starter in `packages/contracts/src/index.ts`. It currently validates a subset of submission metadata and transition rules, not the full protocol.
