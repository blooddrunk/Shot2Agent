> M11-X direct typing is a manually initiated native operation, independent of automatic delivery and its receipts. Latest/history sources read successful durable text without copying it first; manual clipboard mode still permits typing. Typing never writes the clipboard, reruns an Agent, inserts history, retries automatically or falls back to paste. Cancellation/focus loss preserves already entered text; restarting the app never resumes typing. See [operation](USER_GUIDE.md#原生截图与直接输入m11-x-开发候选) and [acceptance](M11_X_VALIDATION.md).

> M8-L 0.8.0 implementation: independent text/file (CF_HDROP Markdown) clipboard payload, Markdown save and opt-in native Windows notification now share durable independent receipts. Prior synthetic Gateway testing is optional. See [operation](M8_WINDOWS_RUN.md) and [validation boundaries](M8_VALIDATION.md). Earlier planned/deferred statements below describe historical milestones. Retry delivery never reruns an Agent.

# Result delivery policy — confirmed V1 behavior

> M3-L desktop update: Tauri 2/Vue 3 uses a restricted anonymous-pipe Node child; no network listener or Relay. Windows Job containment owns descendants; EOF/quit aborts and settles work. Versioned capture settings share M2 settings with backup; SQLite tasks are retained. Worker exclusion is transactional and PID-aware. See [desktop operation](M3_WINDOWS_RUN.md) and [evidence](M3_VALIDATION.md).

> M2-L update (2026-10-20): M2-L implements Local text clipboard (manual/Smart/explicit Always), independent atomic Markdown save, persistent per-channel reservations/outcomes and explicit delivery-only retry. Local history is always retained. Remote push, CF_HDROP/files, toast and Remote receiver remain planned. See [Local operation](LOCAL_MVP_USAGE.md). The older M3/M4 ordering below is superseded only for this Local slice.

**Status:** confirmed V1 behavior as of 2026-10-20. M2-L implements independent Local Markdown save and text clipboard return, with successful [operator-reported receipts](M2_VALIDATION.md#operator-acceptance-2026-10-20). File clipboard, Remote push/receiver and toast remain planned; a successful receipt does not prove actual paste or first-attempt Smart behavior. The M3-M5 sections retain the deferred full V1 scope.

## Outcome

When a task is completed on the same Windows PC (Local mode) or on another Worker PC (Remote mode), its output remains available in durable **local task history** or **authenticated Relay web history**, respectively. Any subset of the following independent destinations may additionally be enabled **at the same time**:

| Destination | Config switch | Behavior |
| --- | --- | --- |
| Remote push | `remotePush.enabled` | Asynchronously notify a configured remote device/provider with safe summary and link |
| Local directory | `localSave.enabled` | Origin PC downloads/validates Markdown and attachments and atomically saves them in a user-approved directory |
| Windows clipboard | `clipboard.enabled` | Origin PC writes selected text or locally downloaded file list to the logged-in user's clipboard |
| Desktop toast (optional separate setting) | `desktopToast.enabled` | Native desktop notification |

The **task history is always available within the selected mode** while retention permits and is not a switchable delivery channel. All optional destinations disabled is valid **history-only / silent mode**; the UI must explain it and never reject the configuration as missing a destination.

**The channels do not compete**: push may succeed while local saving fails; clipboard copying may be suppressed without failing push or save. Each channel has its own outcome and retry state, independent of agent execution status.

## Suggested configuration structure (illustrative, not a locked JSON protocol)

```json
{
  "remotePush": {"enabled": true},
  "localSave": {"enabled": true},
  "clipboard": {
    "enabled": true,
    "mode": "smart",
    "payload": "text"
  },
  "desktopToast": {"enabled": true}
}
```

Clipboard `mode` is an **exclusive** choice between:
- `smart`: before auto-writing, verify newer user clipboard activity has not occurred since capture/submit; if changed, skip auto-write and offer a one-click Copy action. Do not steal focus. Multiple task completions should be serialized and not continually overwrite the clipboard.
- `always`: explicitly opted-in auto-write even if clipboard content changed; explain destructive overwrite.
- `manual`: no automatic clipboard mutation; user may choose Copy text or Copy file(s) on demand.

Clipboard `payload` selects the **single automatic payload kind**: `text` or `files`. Both manual actions may still be offered. A Windows clipboard can advertise multiple data formats, but relying on combined automatic text/file paste semantics across arbitrary apps is not a V1 promise. When no applicable content exists, report `skipped_not_applicable` without failing the task.

## Settings ownership and precedence

- Capture-device defaults apply first; the user may override delivery switches/policies per Profile. A future per-task override may be added, but is not required for V1.
- **Execution Profiles** (agent, prompt, sandbox and working directory) are worker-owned. **Delivery settings** (notification, local output path and clipboard) are user/capture-device owned. Never let worker output force a local destination or change the clipboard policy.
- Remote tasks are bound to authenticated origin-device ownership and result fetches are authenticated. Local task history/files remain private to the local Windows user and use no Relay credentials. Receiver-controlled filesystem paths are never executable instructions supplied by a remote Worker.
- Notify only with bounded summary and authenticated link; do not send raw screenshots or full answers to third-party push platforms by default.
- Suggested starting policy: authenticated history always on; remote push on when configured; local save on once the user selects a directory; clipboard enabled for explicit Copy actions but no automatic clipboard overwrite until opt-in.

## Download, saving and clipboard behavior

```text
LOCAL:  same-PC Worker -> private local durable output
        -> local history + optional local save / clipboard / desktop toast
        -> optional provider remote push (if separately configured)

REMOTE: Worker PC B -> authenticated Relay result/artifacts
        -> origin PC A authenticated fetch + verify to local cache
        -> optional local save / clipboard / desktop toast
        -> Relay / notification adapter optional remote push
        -> authenticated web task history
```

- Local mode uses verified local outputs directly, without first uploading and downloading them through a Relay. Optional push can contact an external provider directly; this does **not** make Relay necessary.
- Remote mode retains results while PC A is offline within configured retention. On reconnect, fetch/verify/save idempotently. A delivery receipt proves saved bytes or successful clipboard write, **not** that content was actually pasted.
- Windows file-drop clipboard requires **existing, retained local files**. In Remote mode download them first; in Local mode use safe verified local result files (or managed local cache). Do not place remote URLs or PC B paths on PC A's clipboard.
- Clipboard operations run in a logged-in Windows interactive session, not a headless service. A tray process restart must not erase local history or claim successful clipboard delivery that never occurred.
- Local results/cache folders must not recursively trigger watched screenshot input. Use safe names, task folders, checksums, atomic writes, disk quotas and retention; never automatically execute downloaded/generated artifacts.
- Keep `task.status`, `remotePush.status`, `localSave.status`, `clipboard.status` and `desktopToast.status` separate and independently retryable. All optional channels may be disabled while mode-specific history stays available.

## Scope and validation

**M1:** shared durable Local task core + optional authenticated Remote Relay HTTP adapter, Fake Worker integration in both modes; no clipboard, remote notification or user-facing result receiver required. The older **Relay-only** M1 goal must be updated to include Local-mode automated tests.

**M3:** Windows native result storage and clipboard primitives can be implemented/tested behind interfaces alongside screenshot/tray work.

**M4:** implement multi-select configuration, per-channel delivery orchestration, notification adapter, client pull/retry/receipts and history/Copy actions. No requirement to configure one channel because history always exists.

**M5:** prove standalone Windows Local operation without Relay, then optional VPS/cross-device and offline reliability.

Acceptance tests must prove (a) all three enabled channels fire independently, (b) each one can fail without blocking others, (c) all optional channels disabled results in history-only mode, (d) newer user clipboard content is preserved in smart mode, (e) copy-files works in Windows Explorer with real downloaded files, and (f) offline origin can resume safely. See [Testing](TESTING.md).

## Local retry policy (M4-L, 0.4.0)

The desktop exposes extra attempts (0–10; default 0), initial backoff (10–1000 ms; default 100) and per-channel budget (100–10000 ms; default 3000) under **投递失败重试**. Backoff doubles up to 1000 ms. Clipboard writes use the remaining transport deadline; synchronous filesystem calls cannot be preempted, so the save budget bounds scheduling rather than OS call duration. Settings are persisted and validated through the restricted IPC boundary. Existing settings without a retry policy preserve zero extra write attempts.

- Save and clipboard reserve/record/retry independently. A successful channel is never automatically repeated. Final failures show a safe code, classification, attempts and stop reason; SQLite preserves up to 100 failure events with timing. No private clipboard data is logged.
- Automatic retries apply only to known pre-write clipboard contention (`CLIPBOARD_BUSY`) and temporary save resource failures (`EBUSY/EAGAIN/EMFILE/ENFILE`). Permission, full disk, unsafe path and unknown errors are permanent; mismatched files are conflicts. Possible post-clear clipboard failure, helper timeout/death and protocol uncertainty are ambiguous and stop without automatic replay.
- Smart retries ALWAYS retain the original capture session and sequence. Native comparison and write share one lock. A changed sequence/session stops with `blocked_by_clipboard_change`; neither copying identical content nor external sync activity grants permission to reset that baseline. Manual **复制结果** remains an explicit overwrite.
- Restart acquires exclusive Worker ownership before converting stale pending delivery to `interrupted`, without replay. **重试结果投递** explicitly retries eligible non-success channels using existing results and the original Smart baseline; it never executes an Agent. Concurrent retry cannot steal a pending reservation.
- Native write exceptions no longer have a hidden 6-attempt loop. Native read contention retains its bounded handling. A timeout kills the helper and requires restart/recovery as indicated; it is not retried as if a write were known absent.
- Markdown publish uses a flushed private temporary file plus no-clobber hard-link creation. An existing identical result is idempotent; different bytes, links/junctions and unsupported filesystems fail closed. Use a canonical operator-owned local directory.

Agent rerun UI is deferred: existing preflight `failed`, launched failures and `execution_unknown` stay terminal with immutable evidence. No possibly launched Codex operation automatically reruns. Existing explicit delivery retry and Copy do not incur new model execution. A future rerun must create independent lineage, pin the approved profile and disclose possible extra model cost.

WeChat Input Method synchronization is an operator-observed correlation. These diagnostics do not establish which component changed/emptied the clipboard or certify input-method compatibility. See [M4 scope](M4_LOCAL_RELIABILITY.md), [validation](M4_VALIDATION.md) and the retained [M3 observations](M3_VALIDATION.md#operator-acceptance--2026-10-21).

Smart protection is sticky in each task delivery receipt: changing current settings to Always cannot bypass an original Smart guard on explicit delivery retry. Legacy failed receipts with an original baseline conservatively keep that guard. Manual **复制结果** remains the explicit overwrite action.

## M5-L Agent binding

Provider selection applies to new submissions only. Execution uses the approved immutable provider/Profile version/fingerprint and stores actual adapter provenance. Existing Smart guards, no-clobber saves and independent delivery retries remain provider-independent; retrying delivery never calls either Agent. Unknown execution never switches providers or automatically reruns. See [M5 Windows acceptance](M5_WINDOWS_ACCEPTANCE.md).

## Default selection follow-up — 2026-10-21

Fresh desktop settings preselect Always, requiring explicit overwrite consent before use; capture starts disabled and unapproved delivery remains manual. Existing installations retain their saved mode. This change follows the operator's report of repeated Smart sequence conflicts. It does not certify a Smart fix or change the sticky guard on existing Smart receipts. CLI initialization remains manual by default.

## M10 Remote return to origin

The development Remote receiver downloads only IDs already durably submitted by this origin. It checks endpoint/owner/device, the immutable normalized request, target Worker/profile provenance, result bounds, artifact filenames/sizes/SHA-256 before caching a terminal result. It never auto-delivers another device's same-owner history. The existing independent Markdown save, text/Markdown-file clipboard and notification reservations then apply, including sticky Smart baselines and history-only. File clipboard materializes the verified Markdown answer on A using the existing retained cache; arbitrary binary attachments and mobile push remain outside M10. Retry of delivery never claims or executes an Agent. See [Remote guide](REMOTE_GUIDE.md) and [verification](M10_R_VALIDATION.md).
