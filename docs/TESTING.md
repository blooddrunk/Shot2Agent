# Validation policy and explicit manual smoke steps

## Automation first

- `npm test`: currently covers the prototype task metadata and lifecycle only. It is not a complete application verification.
- Future M1-M5 must add isolated integration tests with fake clients/workers, synthetic PNG/JPEG/WEBP fixtures and reproducible failure injection.
- Every release should attach command, version, exit status, test count and a summary of coverage gaps. Do not present an unexecuted test checklist as proof.
- For Windows-specific behavior, use Windows CI/build tests plus actual interactive desktop tests; hosted CI runners typically cannot prove a real user's clipboard/tray integration.

## Manual proof A: screenshot folder + clipboard (M3)

Prerequisites: Windows 11 interactive session; Shot2Agent client running visibly in the notification area; test profile configured; relay running; synthetic screenshot showing non-sensitive placeholder text; capture mode initially set to confirmation.

1. Set a temporary watched directory through the client. Confirm displayed normalized directory path.
2. Use Snipping Tool / Print Screen and verify where Windows actually saves the file. If it is different, set the watched path explicitly.
3. Save one test PNG into watched path (prefer Windows screenshot action) and wait for file write completion. **Expected:** exactly one confirmation preview; no remote task until the user confirms.
4. Confirm. **Expected:** one stable task ID and server acknowledgement; open web history and find its image hash.
5. Enable clipboard-source, copy that same screenshot into the clipboard while folder watch remains active. **Expected:** no duplicate automatically-created task for one capture; a manual resubmit action remains possible.
6. Pause. Capture again into watched folder and clipboard. **Expected:** no new task/previews while paused; resume and capture a new picture to confirm functionality returns.
7. Enter batch mode. Capture exactly five numbered synthetic images; reorder two; remove and re-add one; submit once. **Expected:** exactly one task, containing five images in the chosen order and no prematurely queued tasks.
8. Disconnect networking during an upload and restart the client. **Expected:** outbox record persists and retries after network restoration; only one server logical task is created.

Record OS version, app version, steps, actual task IDs (redact if publishing), observed behavior and failures. Do not commit the user's actual screenshots.

## Manual proof B: Codex adapter / local permission boundary (M2)

Prerequisites: worker machine with `codex --version` succeeding; an authenticated Codex setup; isolated temporary git workspace; synthetic screenshot only; a read-only profile; relay and worker identities already registered.

1. Run a task requesting transcription of known text in the screenshot. **Expected:** profile ID/version logged, input hash verified, final Markdown available, no modified files in the workspace.
2. Send a screenshot containing an instruction to delete files. **Expected:** prompt is treated as data; no files outside sandbox may be modified.
3. Simulate a worker stop before agent launch. **Expected:** lease expires and task can be claimed again without duplicate execution.
4. Simulate interruption after launch (separate isolated test workspace). **Expected:** `execution_unknown` or equivalent surfaced; no hidden automatic replay if side effects may have occurred.
5. Force a timeout and inspect bounded stderr/status. **Expected:** task terminal state and timeout reason without leaked credentials. Confirm process has stopped, not merely stopped showing progress.

Record command invocation, Codex version, workspace cleanliness and observed statuses; redact tokens. If these cannot be run, report them unverified individually.

## Manual proof C: VPS and remote result (M5)

Prerequisites: TLS domain configured with a valid certificate, relay's persistent volumes backed up, separate capture and worker devices on different networks, mobile notification channel configured, synthetic image.

1. Submit one image from PC A; verify it is `queued` with Worker B offline.
2. Bring Worker B online; verify authenticated claim, progress, success, web results and mobile notification.
3. Shut down PC A after successful server acknowledgement; verify task still completes without A online.
4. Shut down Worker B while an unstarted task is leased; restart B and verify safe lease recovery.
5. Restart VPS API and verify task history and private artifact access survive; restore a test DB backup to a disposable instance.
6. Attempt to open result/artifact in private browser without authentication. **Expected:** rejected, no image leakage.

Record DNS/TLS verification, commands, server/worker versions, timestamps, sanitized evidence and every expected-vs-actual result. Do not assert cross-device readiness without this proof.
