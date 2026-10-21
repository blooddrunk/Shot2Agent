> **M5-L 0.5.0 candidate:** Local Codex/Claude discovery, stopped-Worker explicit approval and immutable new-task Agent selection. Claude native transport qualified only at 2.1.305/2.1.306, personal Pro/Max only; actual model/GUI gates remain separate. See [Windows controls and restrictions](M5_WINDOWS_ACCEPTANCE.md) and [executed validation](M5_VALIDATION.md).

# Windows Local desktop 0.4.1

Portable developer build, Windows 11 x64, logged-in non-elevated session. WebView2 must be installed (included with normal Windows 11). No WSL, Node install, VPS or Relay needed. Keep the whole extracted folder together; the executable needs its adjacent `runtime` directory.

## Start and stop

- Double-click `Shot2Agent.exe` or `Start Codex.cmd` for **real Codex** using the existing approved `%LOCALAPPDATA%\Shot2Agent-Codex` profile/history. Missing or Fake configuration fails closed (`CODEX_SETUP_REQUIRED` / `CODEX_PROFILE_REQUIRED`); it never creates a Fake profile. Codex needs an installed, authenticated Windows CLI and may incur model charges.
- `Start legacy Local.cmd` opens the original `%LOCALAPPDATA%\Shot2Agent` root and its old history/profile. No settings, queued tasks or history are copied between roots. Each window/title identifies its mode; quit any older instance using the same root before reopening.
- For isolated synthetic acceptance, double-click `Start acceptance.cmd`. Data root is `%LOCALAPPDATA%\Shot2Agent-M3-Acceptance`; the worker is a deterministic Fake with an **8-second delay**. Never use this test root for Codex configuration.
- Closing the window or clicking **隐藏到托盘** hides it. Tray menu **Show Shot2Agent** opens it; **Pause capture / Resume capture** change capture only; **Quit Shot2Agent** stops the coordinator and active Agent. UI **退出** also quits. Pausing leaves queued work running.
- First run defaults: source off, confirmation, manual clipboard, no file save. Enable **监听剪贴板中的新图片**, choose settings and click **应用设置**. Automatic capture needs **自动提交** plus explicit cloud consent. Settings survive intentional restart; startup only arms against *future* changes, never submits the existing clipboard.
- **Smart** automatically writes text only if no later clipboard action occurred. Conflict receipt is `blocked_by_clipboard_change`; **复制结果** explicitly copies it. **Always** requires overwrite consent. Markdown saving is independent; enter an absolute local directory. History remains even with all optional channels off.

## Bounded delivery reliability

Open **投递失败重试** to set extra attempts (0 disables), initial backoff and per-channel time budget; click **应用设置**. Defaults preserve zero extra attempts. Each channel shows its own failure code/classification/attempt count/stop reason. `CLIPBOARD_BUSY` may retry; changed session/sequence, ambiguous write, permission and file conflict stop. Smart never resets its original baseline. A helper timeout stops the helper: quit/relaunch if reconnect cannot re-arm. Delivery retry never reruns Codex. Use a normal local NTFS directory; unsupported atomic hard-link publication fails safely. See [M4 reliability](M4_LOCAL_RELIABILITY.md) and [current validation](M4_VALIDATION.md).

## Existing approved Codex profile

The UI shows the active adapter, approved read-only workspace and pinned CLI version. It does not accept executable or workspace changes from task/IPC input. Quit the desktop and its CLI watcher before configuring a profile. Existing M2 `settings.json` remains CLI-readable. First desktop use backs up legacy settings to `settings.m2-backup-<uuid>.json`; existing task/history tables are not rewritten or deleted; Local state adds a compatible Worker-lock table. Legacy Always becomes manual until fresh desktop overwrite consent.

For a new Codex root, initialize once from PowerShell in the extracted `runtime` directory, using your installed Windows Codex `.exe` or npm `.cmd`, authenticated beforehand:

```powershell
.\node.exe .\dist\apps\cli\src\mvp.js init --root "$env:LOCALAPPDATA\Shot2Agent-Codex" --adapter codex --workspace "D:\ApprovedWorkspace" --codex "C:\absolute\path\to\codex.exe" --clipboard manual
.\node.exe .\dist\apps\cli\src\mvp.js doctor --root "$env:LOCALAPPDATA\Shot2Agent-Codex"
```

`init` refuses an existing settings file. Keep Fake acceptance and legacy history intact. Initialize the separate Codex root once; do not change adapter or approved Profile of queued tasks. For existing approved policies see `LOCAL_MVP_USAGE.md`. No queue item is silently retargeted. The MVP provides configuration visibility rather than an execution-profile editor.

## Optional real Codex verification (model charges may apply)

With an already authenticated Windows Codex CLI and the approved Codex root configured, run from the portable folder:

```powershell
.\runtime\node.exe '.\Verify Codex.mjs' --allow-model-cost .
```

This performs exactly one synthetic `SHOT2AGENT 42` image task using the production desktop controller/Codex adapter and the unchanged approved read-only Profile. It prints only status, attempt count and marker presence, then removes its disposable history. It never reads/writes the Windows clipboard or processes operator tasks. Expect exit 0, `status: succeeded`, `attempts: 1`, `syntheticMarkerObserved: true`. A failure or `execution_unknown` exits 1 and is never automatically replayed. This proves current Windows authentication/model execution/image analysis through the controller, separately from the packaged EXE pipe/cleanup smoke. It does not prove screenshot capture, focus or paste in a real Codex GUI session.

## Five operator observations (synthetic data only)

1. **Capture:** Start acceptance build. Enable source in confirmation mode and Apply. In Notepad show `SHOT2AGENT 42`, use Win+Shift+S to copy an image. Expect **等待确认**, no history task until **提交图片**; capture another and **丢弃**, no additional task. Switch to Auto, check consent, select Smart, Apply. A fresh screenshot must create exactly one task without typing commands. Existing clipboard at launch/Apply is ignored.
2. **Focus:** Keep Notepad active through capture and completion. Expect Notepad stays foreground. Shot2Agent must not activate itself.
3. **Smart return:** Without any further clipboard action or clicking Copy, wait for succeeded, then paste in Notepad. Expect `# Fake result` and the image hash. Clipboard receipt `succeeded` proves write; this paste is a separate observation.
4. **Conflict:** Copy a fresh, visibly different screenshot. During the displayed Fake running state (8-second delay), copy the text `NEWER CLIPBOARD`. After completion, paste: expect that text preserved; receipt `blocked_by_clipboard_change`. Click **复制结果**, paste again: expect Fake result.
5. **Persistence:** Enable Markdown save with a complete safe test directory, Apply, capture a different synthetic image. Expect save `succeeded` and `<task-uuid>.md` in that directory. Quit via tray; relaunch acceptance build. Expect settings/history remain and no task for the preexisting image. Pause, capture: no new preview/task; Resume skips paused content and accepts the next fresh capture.

Report each PASS / FAIL / NOT VERIFIED with visible status and action, without private images, model transcripts or database uploads. On capture error use **重新连接剪贴板** (no automatic helper restart loop). If helper/service is dead, quit and relaunch. On worker error check/stop any old Agent before restart; `execution_unknown` never auto-replays. Use result **重试结果投递** for save/clipboard failures; it does not rerun Agent execution. Do not delete or edit SQLite.

## Rebuild (developer/CI)

Windows x64 Node 24, pnpm 10.19.0, Rust stable MSVC, Visual Studio C++ Build Tools and Windows SDK:

```powershell
corepack pnpm install --frozen-lockfile
npm run check
npm run desktop:build
npm run desktop:package
```

Output: `build\Shot2Agent\Shot2Agent.exe` with runtime; CI also archives `Shot2Agent-Windows-x64.zip` and runs the packaged executable `--staging --smoke` through the real Rust-to-Node pipe (snapshot, command refusal, natural coordinator exit, unexpected coordinator death and descendant cleanup). CI smoke is not logged-in user tray/focus/paste acceptance. No installer, launch-on-login, Remote, watched folder, batch editor or file clipboard is included in this slice.

## Always default selection — 2026-10-21

New desktop settings preselect Always. Capture remains disabled and overwrite consent remains unchecked. Check **我同意结果自动覆盖剪贴板，包括后来复制的内容** and Apply before enabling it. Until then, even an explicit task submission uses manual clipboard delivery. Existing saved modes and legacy M2 migration remain unchanged. CLI init still defaults to manual.

For an existing installation, select Always, check overwrite consent and Apply. This affects future eligible delivery; existing blocked Smart receipts keep their original guard. Use Copy for those results. Always may replace text copied while the Agent was running; Markdown saving remains independent.
