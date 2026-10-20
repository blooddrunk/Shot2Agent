# Result delivery policy — confirmed V1 behavior

**Status:** confirmed product behavior as of 2026-10-20. Planned implementation during M3 (Windows-native primitives), M4 (delivery orchestration and UI), M5 (real-device reliability). **Not implemented yet.** M1 handoff is unchanged.

## Outcome

When a task created on screenshot PC A is completed by the worker on PC B, its authenticated result is always readable in durable web history. Any subset of the following independent destinations may additionally be enabled **at the same time**:

| Destination | Config switch | Behavior |
| --- | --- | --- |
| Remote push | `remotePush.enabled` | Asynchronously notify a configured remote device/provider with safe summary and link |
| Local directory | `localSave.enabled` | Origin PC downloads/validates Markdown and attachments and atomically saves them in a user-approved directory |
| Windows clipboard | `clipboard.enabled` | Origin PC writes selected text or locally downloaded file list to the logged-in user's clipboard |
| Desktop toast (optional separate setting) | `desktopToast.enabled` | Native desktop notification |

The **task history is always available** while retention permits and is not a switchable delivery channel. All optional destinations disabled is valid **history-only / silent mode**; the UI must explain it and never reject the configuration as missing a destination.

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
- The submitted task is bound to authenticated origin-device ownership. The receiver must authenticate to fetch that task's private results. Local filesystem paths are stored exclusively by the receiving client, not sent to the worker as executable instructions.
- Notify only with bounded summary and authenticated link; do not send raw screenshots or full answers to third-party push platforms by default.
- Suggested starting policy: authenticated history always on; remote push on when configured; local save on once the user selects a directory; clipboard enabled for explicit Copy actions but no automatic clipboard overwrite until opt-in.

## Download, saving and clipboard behavior

```text
Worker (PC B) -> authenticated relay: result + artifact manifest
Relay -> durable result and pending notifications/delivery
Capture tray (PC A) -> authenticated outbound fetch/download
  +--> optional localSave: validate hash/type/size and atomic save
  +--> optional clipboard: render text or verified local file list
Relay notification adapter --> optional remotePush (independent)
History web UI --> always authorized read
```

- PC A can be offline at completion. Deliver later within server retention without duplicating local output. A server receipt confirms receipt of state; a local receipt confirms actual verified save or clipboard write, **not** a user's eventual paste.
- Clipboard file-drop (e.g. `CF_HDROP`) must reference **already downloaded** real local files; never paste remote URLs or worker paths. If localSave is off, clipboard file mode may still download into a **managed private cache**. Preserve cached files until reasonably safe to remove after paste; do not delete immediately on clipboard write.
- Clipboard is only available in an interactive logged-in Windows session, not via a headless service. If the tray is unavailable, preserve pending delivery; never claim clipboard success.
- The local save root and managed download cache must not be within watched screenshot directories by default; filter self-generated files/events to avoid feedback loops.
- Use safe names, per-task grouping or deterministic collision handling, checksums, atomic writes, storage quotas and retention. Never execute delivered files. Failures in one channel do not block the others.
- Separate `task.status`, `remotePush.status`, `localSave.status`, `clipboard.status`, optionally `desktopToast.status` (e.g. `pending`, `delivered`, `failed`, `skipped`, `blocked_by_clipboard_change`). A successful task can have unsuccessful deliveries.

## Scope and validation

**M1:** retain authenticated task ownership and durable result access; no remote notification, local receiver or clipboard implementation required. The existing M1 coding-agent prompt remains valid.

**M3:** Windows native result storage and clipboard primitives can be implemented/tested behind interfaces alongside screenshot/tray work.

**M4:** implement multi-select configuration, per-channel delivery orchestration, notification adapter, client pull/retry/receipts and history/Copy actions. No requirement to configure one channel because history always exists.

**M5:** real VPS/cross-device and offline reliability checks.

Acceptance tests must prove (a) all three enabled channels fire independently, (b) each one can fail without blocking others, (c) all optional channels disabled results in history-only mode, (d) newer user clipboard content is preserved in smart mode, (e) copy-files works in Windows Explorer with real downloaded files, and (f) offline origin can resume safely. See [Testing](TESTING.md).
