# Product specification - V1 baseline

**Status:** confirmed scope / implementation pending. Updated 2026-10-20.

## Product outcome

Take one or several screenshots on Windows without manually assembling inputs. Submit a durable asynchronous task to an approved agent running on the same or another computer. Deliver a useful result remotely and retain a searchable history.

The product is neither a screen capture editor nor a multi-agent chat platform. Windows handles screen capture; Shot2Agent handles intake, reliable task execution and results.

## User-visible workflows

### Capture

- Sources: one or more configurable Windows screenshot folders and optionally clipboard **images only** (independently switchable).
- Default directory: discover the actual configured screenshot location if possible; provide folder picker fallback. Never assume OneDrive vs a hardcoded `Pictures/Screenshots` path.
- Modes: **confirmation** (initial default) and **automatic** (explicit opt-in). A persistent **pause** switch prevents both sources from creating tasks.
- In confirmation mode, the user can submit, ignore or add the captured image to an open batch.
- At startup, do not backfill preexisting images without an explicit user command.
- Debounce unfinished file writes; MIME-verify and decode candidate images before submission. Images in the clipboard may originate from apps other than screenshot tools.
- Deduplicate duplicate events from a single capture across sources, but permit explicit re-submission of the same image later.

### Single image / manual batch

- Single mode: one image produces one independent task with the selected profile.
- Batch mode: the user explicitly starts collection, adds ordered images, optionally deletes/reorders them, selects a profile and explicitly submits the batch.
- No heuristic grouping by time in V1. After submission, task inputs are immutable.
- User can abandon an unsubmitted batch without contacting the relay.

### Profiles

An approved **execution-side** profile contains a stable identifier, version, agent adapter, resolved prompt source, approved local workspace, sandbox policy, input mode, output policy, timeout and worker selection. Profiles may include project instructions. A task includes profile ID/version and optional bounded task-specific instructions, but cannot arbitrarily set its worker's executable, shell command, filesystem paths or permissions.

The capture client can select profiles and show public metadata. Worker owns sensitive execution configuration and validates it upon claim. A queued task remains bound to the resolved version / hash of its profile; missing versions should fail visibly, not silently change behavior. Default profile is read-only.

The precedence rule is **constraints before requests**: platform policy and worker sandbox constraints cannot be overridden by profile text, task text, or text in screenshot pixels.

### Results and notifications

- Store the original ordered screenshots, final Markdown content, concise summary, timestamps, attempt history, bounded logs and declared artifacts.
- User can view task status, preview inputs, copy Markdown, download permitted files, retry as a new attempt and cancel queued tasks. Running cancellation is best-effort and cannot roll back writes already made.
- Notify on completion/failure through desktop notification and one optional mobile push provider. Never send raw screenshots or full sensitive outputs in push payloads by default.
- Delivery of notifications is **independent** of execution status. Failure to push must not mark successful agent execution as failed.
- A web task history is accessible with authentication from other devices. Native mobile apps are not in scope.

## V1 topology

- One Windows capture device and one worker are the target test topology. They may be on the same PC; the relay resides on the personal VPS.
- Worker maintains an outbound connection/polling cycle to the relay; no worker inbound port is required.
- The VPS authenticates, stores and transfers tasks; it does not have Codex credentials or execute agent code.
- In V1, one worker runs at most one task concurrently.
- Offline capture device: retain pending uploads locally. Offline worker: keep uploaded tasks queued and resumable.

## Failure and trust semantics

- Durable submission acknowledgement: only show **uploaded** after the relay persists metadata and image blobs. Resume failed uploads without producing duplicate logical tasks.
- At-least-once task delivery, guarded by a lease, execution attempt IDs and fencing tokens. Do **not** promise exactly-once agent side effects.
- Automatically retry transport; if an agent may already have edited files, enter an `execution_unknown` terminal state and require an explicit retry/review decision.
- Never interpret image contents as authority to run OS commands outside an approved sandbox.
- The user has confirmed that intended inputs may leave the capture device, traverse a personal VPS and be processed by the configured cloud agent. Data protection, authentication and access controls are still required.

## Initial operating limits (provisional configuration defaults)

- Accepted content types: PNG, JPEG and WEBP, verified by actual content.
- 1-20 images/task, <=20 MiB per image, <=60 MiB total/task. Reject exceeded limits with actionable error messages.
- Original input retention proposed at 7 days; results 30 days; duration is configurable. Never delete an artifact needed by an active task.
- Concurrency: 1 per worker, configurable later. Avoid unbounded queues and logs; alert before storage exhaustion.

## V1 acceptance scenarios

| ID | Scenario | Expected result |
| --- | --- | --- |
| A01 | New screenshot in watched folder | One preview/confirmation or exactly one auto-submitted logical task |
| A02 | Clipboard and folder both contain the same capture | No duplicate automatic task; explicit manual reprocess still allowed |
| A03 | Capture five related pages as a batch | One task with all five images in correct user-specified order |
| A04 | Network lost before upload completes | Local item remains; later upload uses original logical ID, without duplication |
| A05 | Worker offline after upload | Task remains queued; processes after worker reconnects |
| A06 | Worker crashes before starting work | Expired unstarted lease returns task to queue safely |
| A07 | Worker disappears after starting agent | Mark execution outcome uncertain; do not blindly rerun write-capable task |
| A08 | Codex returns an answer | Task history preserves Markdown, inputs and auditable profile/worker/attempt info |
| A09 | Notification provider fails | Agent result stays successful; notification shows failed or retrying |
| A10 | Unauthorized task references a different workspace | Worker refuses execution; no path or permissions escalation |
| A11 | User cancels running task | Best-effort stop; report any work already performed and no rollback guarantee |
| A12 | Service restarts while queued | Persisted tasks and metadata survive a restart |

## Explicit V1 exclusions

- No custom screenshot selection/annotation UI, automatic profile inference, arbitrary remote shell, multiple workers with load balancing, multi-agent orchestration, autonomous cross-task memory, conversational chat history, native mobile client or analytics dashboard.
- No silent permission escalation; no execution of instructions embedded in screenshot data as privileged commands.

Related: [Architecture](ARCHITECTURE.md), [Protocol](PROTOCOL.md), [Roadmap](ROADMAP.md).
