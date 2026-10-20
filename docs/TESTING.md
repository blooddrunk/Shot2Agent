# Validation policy and explicit manual smoke steps

## Automation first

**Local/Remote conformance gate:** Run the same Fake Agent task fixtures against direct Local-mode task core (no Relay URL, HTTP service or VPS) and Remote-mode authenticated HTTP Relay adapter. Assert task/status/result equivalence, private result access, durable queue after restart, zero Relay calls in Local mode and no mode-switch migration or leak.

- `npm test`: currently covers the prototype task metadata and lifecycle only. It is not a complete application verification.
- Future M1-M5 must add isolated integration tests with fake clients/workers, synthetic PNG/JPEG/WEBP fixtures and reproducible failure injection.
- Every release should attach command, version, exit status, test count and a summary of coverage gaps. Do not present an unexecuted test checklist as proof.
- For Windows-specific behavior, use Windows CI/build tests plus actual interactive desktop tests; hosted CI runners typically cannot prove a real user's clipboard/tray integration.

## Manual proof A: screenshot folder + clipboard (M3)

Prerequisites: Windows 11 interactive session; Shot2Agent tray running, test Profile and synthetic screenshot, confirmation mode; **begin in Local mode with no Relay service/VPS configured**, then repeat Remote-specific cases separately.

1. Set a temporary watched directory through the client. Confirm displayed normalized directory path.
2. Use Snipping Tool / Print Screen and verify where Windows actually saves the file. If it is different, set the watched path explicitly.
3. Save one test PNG into watched path (prefer Windows screenshot action) and wait for file write completion. **Expected:** exactly one confirmation preview; no remote task until the user confirms.
4. Confirm. **Expected:** one stable task ID and durable acceptance; inspect local task history/hash in Local mode or authenticated web history in Remote mode.
5. Enable clipboard-source, copy that same screenshot into the clipboard while folder watch remains active. **Expected:** no duplicate automatically-created task for one capture; a manual resubmit action remains possible.
6. Pause. Capture again into watched folder and clipboard. **Expected:** no new task/previews while paused; resume and capture a new picture to confirm functionality returns.
7. Enter batch mode. Capture exactly five numbered synthetic images; reorder two; remove and re-add one; submit once. **Expected:** exactly one task, containing five images in the chosen order and no prematurely queued tasks.
8. **Remote mode only:** disconnect networking during upload and restart client; outbox persists, retries after networking restored, with one logical task.
9. **Local mode only:** remove Relay settings and block task-transfer network; submit a screenshot to local Fake/real Worker, restart app/worker and verify persisted task/history and result with zero Relay requests.

Record OS version, app version, steps, actual task IDs (redact if publishing), observed behavior and failures. Do not commit the user's actual screenshots.

## Manual proof B: Codex adapter / local permission boundary (M2)

Prerequisites: same-PC Local Worker **or** Remote Worker, `codex --version` succeeding and Codex authenticated; isolated temporary workspace; synthetic screenshot; read-only Profile. Relay identities only required for Remote mode.

1. Run a task requesting transcription of known text in the screenshot. **Expected:** profile ID/version logged, input hash verified, final Markdown available, no modified files in the workspace.
2. Send a screenshot containing an instruction to delete files. **Expected:** prompt is treated as data; no files outside sandbox may be modified.
3. Simulate a worker stop before agent launch. **Expected:** lease expires and task can be claimed again without duplicate execution.
4. Simulate interruption after launch (separate isolated test workspace). **Expected:** `execution_unknown` or equivalent surfaced; no hidden automatic replay if side effects may have occurred.
5. Force a timeout and inspect bounded stderr/status. **Expected:** task terminal state and timeout reason without leaked credentials. Confirm process has stopped, not merely stopped showing progress.

Record command invocation, Codex version, workspace cleanliness and observed statuses; redact tokens. If these cannot be run, report them unverified individually.

## Delivery fan-out verification (M3/M4)

Automate with fake worker/results and a stub receiver:
1. Enable push + local save + clipboard simultaneously; assert **all** applicable channel handlers run and keep independent statuses; force each channel to fail separately and confirm the other two and task success remain unaffected.
2. Disable all optional delivery switches; assert no side effects while authenticated task history remains readable. Disable one at a time and verify no unintended writes or notifications.
3. Disconnect the origin capture client while a result completes; reconnect and verify authenticated fetch, durable/idempotent local save and stable delivery receipts.
4. Reject an unauthorized origin device, corrupted artifact hash, oversized attachment, path traversal and symlink escape; no partial file should be published as successful.
5. When output lands in or next to a watched screenshot folder, confirm there is no self-trigger feedback loop. Use a separate output root by default.
6. Simulate multiple near-simultaneous completions and changed clipboard sequence: smart mode must preserve newer user content, offer explicit copy, and not continuously overwrite the clipboard.
7. Confirm a text-only result can be saved as a file; a file-only result can be downloaded even when clipboard is disabled. A mixed result saves both while clipboard auto-copy uses its configured single payload type.

**Mandatory native Windows proof (logged-in desktop, synthetic data):**
1. Enable local save, remote notification, and clipboard smart mode concurrently. Capture a synthetic screenshot and verify all independently apply without stealing foreground focus.
2. Copy another string after submitting the screenshot but before result completion. Confirm smart mode does **not** overwrite it. Trigger explicit Copy text, then paste into Notepad and compare bytes.
3. Test `always` separately with explicit opt-in. Confirm auto-overwrite is visible and documented.
4. Produce a test DOCX/PNG file, download it, invoke Copy file(s) and paste into Windows Explorer; confirm the correct file(s), no corruption, and that cache files stay available.
5. Turn all optional channels off and confirm the result is still available in history without notification, clipboard write or local save.
6. Exit and relaunch the tray client while offline; reconnect and verify pending result delivery and no duplicate output files.

Record every expected and observed result individually. Do not treat Linux CI as clipboard integration proof.


## Manual proof C: VPS and remote result (M5)

Remote-only prerequisites: TLS domain with certificate, backed-up Relay volumes, separate capture and Worker computers on different networks, optional notification provider and synthetic image. **Also separately prove the Local Windows workflow with no Relay service, config or VPS.**

1. Submit one image from PC A; verify it is `queued` with Worker B offline.
2. Bring Worker B online; verify authenticated claim, progress, success, web results and mobile notification.
3. Shut down PC A after successful server acknowledgement; verify task still completes without A online.
4. Shut down Worker B while an unstarted task is leased; restart B and verify safe lease recovery.
5. Restart VPS API and verify task history and private artifact access survive; restore a test DB backup to a disposable instance.
6. Attempt to open result/artifact in private browser without authentication. **Expected:** rejected, no image leakage.

Record DNS/TLS verification, commands, server/worker versions, timestamps, sanitized evidence and every expected-vs-actual result. Do not assert cross-device readiness without this proof.
