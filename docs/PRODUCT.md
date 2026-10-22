> Local 1.0 release: [用户使用手册](USER_GUIDE.md) · [发布验证与操作员验收](M9_VALIDATION.md)。下文保留历史规格和规划，不作为当前用户操作指南。

> M8-L 0.8.0 adds independent Local folder/clipboard intake, ordered 2–5 image GUI tasks, CF_HDROP Markdown output and optional native completion notifications. [Current operation](M8_WINDOWS_RUN.md) and [executed validation / native gaps](M8_VALIDATION.md) supersede historical planned feature labels below. Next release scope is M9-L final Local v1.0, with Remote deferred.

# Product specification - V1 baseline

**Status:** confirmed V1 scope. M1 core/Fake and M2-L Local clipboard/Codex/text delivery are implemented; the minimum Windows Local loop has [operator acceptance](M2_VALIDATION.md#operator-acceptance-2026-10-20). Dedicated native edge cases remain separately unverified. Full tray/UI, folder/batch editor and Remote delivery are still planned. Updated 2026-10-20.

## Product outcome

Take one or several screenshots on Windows without manually assembling inputs. Submit a durable asynchronous task to an approved agent running on the same or another computer. Deliver a useful result locally or remotely and retain durable task history.

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

**Confirmed V1 result-delivery policy (M3/M4 implementation):** task history remains available and durable regardless of optional delivery settings. The following are **independent, combinable channels**, never a mutually exclusive result-destination enum:
1. Remote push notification (when a provider is configured).
2. Automatic save of Markdown and allowed artifacts on the **originating capture device**, in a user-approved local directory.
3. Origin-device Windows clipboard delivery, with `mode = smart | always | manual` and `payload = text | files`. These modes are alternatives **within the clipboard channel**, not alternatives to notifications or local file saving. Manual mode provides actions but does not auto-overwrite the clipboard. A file clipboard payload references actual verified local downloaded files.
4. Optional desktop notification may be configured independently of remote push.

All enabled applicable channels operate independently after a successful result; failure in one does not cancel, block, or change status of another, nor change the completed agent task. Report separate channel delivery statuses, for example `pending/sent/failed/skipped` and `blocked_by_clipboard_change`. Successful local clipboard **write** is not evidence of paste.

**All optional channels may be disabled:** this is a deliberate silent/history-only mode, not a validation error, because durable history always exists (local task UI in Local mode, authenticated Relay web history in Remote mode). The interface should explain this plainly. Suggested setup default: remote notification if configured + save to a user-approved folder; clipboard auto-write off until opted in.

The capture-device's effective delivery configuration uses **device defaults with optional per-Profile overrides** (and explicit task override if supported later). This is distinct from the worker-owned execution Profile: the worker must not control the receiving PC's filesystem path or clipboard. Avoid selecting a local output directory that is also a watched screenshot directory, and suppress self-generated capture events. An authenticated origin-device association must be retained for secure return delivery.

**Smart clipboard mode:** only auto-copy when clipboard activity since the capture/submit baseline and result-download races indicate that it is safe; if the user copied anything newer, leave it intact and offer a one-click copy action. `always` explicitly permits overwrite. Multiple results must not cause uncontrolled successive clipboard overwrites. When the result includes both text and files, automatic clipboard payload has **one selected type**, while manual copy actions can offer both.

See [Result delivery policy](RESULT_DELIVERY.md) for the proposed configuration shape and acceptance details.


- Store the original ordered screenshots, final Markdown content, concise summary, timestamps, attempt history, bounded logs and declared artifacts.
- User can view task status, preview inputs, copy Markdown, download permitted files, retry as a new attempt and cancel queued tasks. Running cancellation is best-effort and cannot roll back writes already made.
- Notify on completion/failure through desktop notification and one optional mobile push provider. Never send raw screenshots or full sensitive outputs in push payloads by default.
- Delivery of notifications is **independent** of execution status. Failure to push must not mark successful agent execution as failed.
- Task history is always accessible: local task UI in Local mode, and authenticated cross-device web history in Remote mode. Native mobile apps are not in scope.

## V1 topology: Relay is optional

| Mode | Capture / Agent location | Queue, history and result source | Requires Relay? |
| --- | --- | --- | --- |
| **Local (default)** | Same Windows PC | Private local files + durable task core + local Worker | **No**. Neither VPS nor Relay service/URL is required. |
| **Remote (opt-in)** | PC A captures; PC B runs Agent (or both intentionally on one PC) | Authenticated personal-VPS Relay, private blobs and durable queue | Yes, only in this mode |

- The two modes share task IDs, state machine, Profile authorization, Agent Adapter contract and independent result-delivery options. The local Worker may be hosted by a tray-owned process or restricted IPC coordinator; a Relay HTTP server is **not required locally**.
- Local mode must not upload screenshots to a Relay, download results back from a Relay or depend on VPS availability. A hosted Codex model may still require Internet for the model itself.
- Local mode keeps history on the same PC; Remote mode provides authenticated web history from other devices. Remote history is not promised when no Relay is configured.
- Switching modes never silently migrates/publishes/loses queued tasks or prior history; task ownership stays associated with its original mode. Migration/sync is not in V1.
- Remote mode: outbound-only Worker connection, separate capture-device authentication and durable offline queue. Local mode: local queue/Worker survives tray/Worker restart. One execution at a time per Worker.
- Remote notification providers may still be independently configured in Local mode without making Relay mandatory.

See [Deployment modes](DEPLOYMENT_MODES.md).

## Failure and trust semantics

- Durable submission acknowledgement: Local mode reports **queued locally** only after local persistence; Remote mode reports **uploaded** only after authenticated Relay persists metadata and images. Retry remote uploads without duplication.
- Both modes use durable attempt records and safe restart recovery; Remote mode additionally uses leases and fencing tokens. Do **not** promise exactly-once Agent side effects.
- Automatically retry transport; if an agent may already have edited files, enter an `execution_unknown` terminal state and require an explicit retry/review decision.
- Never interpret image contents as authority to run OS commands outside an approved sandbox.
- Intended inputs are permitted to transit a personal VPS and approved cloud model **when configured**, but Local mode never requires VPS transfer. Protect secrets, private local files and remote APIs appropriately.

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
| A13 | Remote push + local save + clipboard all enabled | Each applicable channel succeeds independently, with task status unaffected by a channel failure |
| A14 | All optional delivery channels disabled | Task remains accessible in authenticated history; no push/local write/clipboard mutation |
| A15 | Clipboard smart mode and newer user copy | No automatic clipboard overwrite; an explicit copy action remains available |
| A16 | File clipboard enabled | Verified local files can be pasted into Explorer; backing files remain available |
| A17 | Capture device offline at completion | Pending authorized result can be fetched when back online, without duplicate local files |
| A18 | Local save directory overlaps screenshot watch | Self-generated results do not re-enter capture as new tasks |
| A19 | Local mode with no VPS, Relay process or Relay URL | Screenshot → durable local task → Fake/real Agent → local history and result; no Relay network calls |
| A20 | Remote mode with separate capture and Worker computers | Authenticated Relay and outbound Worker perform async task/result transfer and recover from disconnection |
| A21 | Local Worker/tray restarts with queued work | Local queue/history persists, safe retry rules avoid duplicated side effects |
| A22 | User switches modes with existing tasks | No silent migration, lost history or automatic upload of local files |

## Explicit V1 exclusions

- No custom screenshot selection/annotation UI, automatic profile inference, arbitrary remote shell, multiple workers with load balancing, multi-agent orchestration, autonomous cross-task memory, conversational chat history, native mobile client or analytics dashboard.
- No silent permission escalation; no execution of instructions embedded in screenshot data as privileged commands.

Related: [Architecture](ARCHITECTURE.md), [Protocol](PROTOCOL.md), [Roadmap](ROADMAP.md).
