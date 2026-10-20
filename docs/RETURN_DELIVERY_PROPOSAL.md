# Return-to-origin result delivery — optional feature proposal

**Status:** proposed, not confirmed as a mandatory V1 feature. 2026-10-20.

## User outcome

A screenshot captured on Windows PC A can be processed by an agent running on PC B. Once the relay records a successful result, the Windows tray client on PC A can download the result and optionally:
- save generated Markdown/text and declared files into an approved local results directory;
- copy result text to the interactive Windows clipboard;
- copy real downloaded files as a Shell file-drop clipboard list, ready to paste into Windows Explorer.

This complements remote push and web task history, not replaces them.

## Trust boundary

```
PC A screenshot -> HTTPS -> VPS relay <- outbound worker on PC B
PC B result/attachments -> HTTPS -> VPS relay
PC A logged-in tray -> outbound HTTPS fetch -> local atomic save
PC A logged-in tray -> interactive clipboard text OR file-drop list
PC A -> HTTPS delivery receipt; web result remains independently available
```

No inbound port or direct worker-to-PC connection is needed. The worker never gains permission to choose a path or execute code on PC A. The VPS cannot write the Windows clipboard. Clipboard operations must run inside the logged-in user's interactive session, not a Session 0 Windows service.

## Recommended user-facing settings

- Result destination: `notification_only`, `save_directory`, `clipboard_text`, `clipboard_files`, or combined save-and-clipboard behavior.
- Safe default: save-to-directory plus a notification with **Copy text**, **Copy file(s)** and **Open folder** actions. Automatic clipboard overwrite is separately opt-in per Profile/device.
- File clipboard means the receiver **downloads and verifies** real files before advertising their local paths as Shell `CF_HDROP` / file-drop data; this is not a clipboard containing remote raw file bytes. Files must not be removed while still needed for paste.
- When a task generates both Markdown and artifacts, the clipboard action must explicitly select text or files. Different receiving programs may prefer different clipboard formats.
- Avoid stealing focus. If the user changed clipboard content while the task ran, do not silently overwrite it; notify for one-click copy instead. Handle multiple near-simultaneous results without repeatedly overwriting clipboard.
- Support reconnection: when PC A is offline/logged out, the relay retains authorized results; the client fetches them on return subject to retention policy.
- Local result root is user-approved; paths, file names, collisions and maximum file sizes are validated locally. Use task-scoped folders, safe names and atomic writes. Never run returned files automatically.
- Separate `agent_execution_status`, `remote_notification_status` and `local_delivery_status`. Clipboard-write acknowledgement **does not** prove the result was pasted/read.

## Integration with existing milestones

- M1 (relay and fake worker): do not expand current scope or acceptance gate. Keep task ownership/recipient linkage extensible.
- M3 (native Windows tray): expose reusable local result storage and clipboard writer abstractions with focused native tests when scheduled.
- M4 (result history/notifications): implement optional authenticated result-ready retrieval, local delivery policy, acknowledgement and end-user UI.
- M5 (VPS hardening): exercise offline/reconnection, corruption, storage quota, long-lived clipboard file references and retention cleanup.

## Verification gates (mostly automatable)

1. Fake worker returns Markdown; capture client downloads and saves exact bytes to an approved directory.
2. Task with multiple file artifacts downloads in correct manifest order; SHA-256 and sizes match; rejected corrupt artifact never reaches clipboard.
3. Results are never delivered to an unauthenticated or wrong device.
4. Server/client restart and duplicate completion events do not create duplicate local files or unnecessary clipboard changes.
5. Clipboard changed by user during execution: preserve newer content; offer an explicit copy action.
6. Offline screenshot PC reconnects and sees pending result exactly once in its local task history (network delivery may be at least once but client application is idempotent).
7. File name collision, path traversal and symlink escape attempts are rejected or safely remapped.
8. **Native Windows manual test:** with a signed-in desktop session, copy text then paste into Notepad; copy downloaded files then paste into Explorer. Confirm focus remains on the user's foreground window. Observe user clipboard changes and app exit, and verify backing files remain available.

Microsoft Windows Shell reference: https://learn.microsoft.com/en-us/windows/win32/shell/clipboard (CF_HDROP transfers paths to existing files).

Open decisions: preferred default auto-save directory, whether clipboard auto-overwrite should be allowed at all, local artifact retention after clipboard use, and number of completion events to batch. These should be resolved before enabling automatic clipboard delivery.
