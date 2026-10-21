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

## Local retry policy: current behavior and proposal

Operator discussion on 2026-10-21 follows the [M3 desktop acceptance](M3_VALIDATION.md#operator-acceptance--2026-10-21). Configurable retry counts are **proposed, not implemented**; no new runtime behavior is authorized by this design note.

Current implementation:

- Native clipboard request exceptions get at most **6 total attempts** (initial + 5 retries), sleeping 30/60/90/120/150 ms between failed attempts. These limits are fixed in `clipboard.ps1`, not UI settings. They are separate from the persisted delivery receipt's `attempts`, which counts channel processing/retry/Copy actions rather than these low-level attempts.
- A Smart sequence mismatch returns `written=false` and `blocked_by_clipboard_change`; it is not an exception and is not retried by that native loop. Explicit delivery retry keeps the original baseline/session, so it cannot bypass a later clipboard change. Manual Copy is the existing deliberate overwrite action.
- The GUI's delivery retry reuses an existing successful result and channel receipts, independently of Agent execution. Successful channels remain idempotent; channel failure does not fail the task or the other channel.
- Agent terminal failures/unknown outcomes are not automatically executed again. Started Codex interruption/nonzero exit may be `execution_unknown`; current GUI has no Agent rerun control. Unstarted expired leases can recover through existing queue rules.

Proposed bounded follow-up (requires implementation and automated verification):

| Situation | Proposed behavior |
| --- | --- |
| Clipboard busy / classified transient delivery failure | Configurable maximum retries, backoff and total time budget; 0 means no retries, counts exclude the initial attempt. Every Smart attempt retains/rechecks the original safety condition. Stop on a mismatch, permanent refusal or ambiguous write outcome. |
| Smart conflict / changed helper session | Keep content untouched by further automatic attempts; show conflict reason and manual Copy. Do not treat unknown clipboard activity as permission to overwrite or silently refresh the baseline. |
| Same content re-published by a sync component | Investigate a race-safe content-equivalence check separately; sequence changes alone cannot identify the writer or prove user intent. This is not solved by increasing retry counts. |
| Transient Markdown save failure | Independent bounded retries; no retry through unsafe paths, conflicting files or permission/policy refusals; successful saves remain idempotent. |
| Recoverable failure proven to occur before Agent launch | Consider opt-in bounded retry after structured classification; do not retry permanent version/profile/auth/configuration refusals automatically. |
| Agent may have started, timed out or has uncertain outcome | Default automatic execution retries remain 0. Offer explicit rerun/review preserving the original record and recording the new execution separately, with pinned profile and possible extra usage shown. `failed` alone is not proof that execution never started. |

Expose retry counts, reasons and terminal outcomes without screenshot/clipboard contents or raw Agent logs. Test transient busy -> success, retry exhaustion, changed clipboard during backoff, delivery-channel independence, restart accounting and no automatic Agent replay. No Relay, Remote expansion or new infrastructure milestone is required for this bounded reliability work.
