> **M5-L 0.5.0 candidate:** Local Codex/Claude discovery, stopped-Worker explicit approval and immutable new-task Agent selection. Claude native transport qualified only at 2.1.305/2.1.306, personal Pro/Max only; actual model/GUI gates remain separate. See [Windows controls and restrictions](docs/M5_WINDOWS_ACCEPTANCE.md) and [executed validation](docs/M5_VALIDATION.md).

> **Desktop 0.4.1:** `Shot2Agent.exe` / `Start Codex.cmd` opens the existing approved `Shot2Agent-Codex` Profile; missing configuration fails visibly. `Start acceptance.cmd` stays Fake, and `Start legacy Local.cmd` preserves the original Local history. See [Windows startup](docs/M3_WINDOWS_RUN.md) and [verification boundaries](docs/DESKTOP_CODEX_ENTRY_VALIDATION.md).

> **M4-L 0.4.0:** Local delivery now has no-clobber Markdown publication, independently bounded retries and safe failure/IPC diagnostics. Smart retains its original baseline; Agent execution never auto-replays. See [reliability scope](docs/M4_LOCAL_RELIABILITY.md) and [executed Windows/CI evidence](docs/M4_VALIDATION.md).

> **M3-L desktop implementation:** Windows Tauri 2 + Vue 3 Local shell, opt-in automatic new-image submission, confirmation preview, pause/resume, history, independent Smart/manual/Always clipboard and Markdown save. No Relay/listener. See [Windows build/run and five native observations](docs/M3_WINDOWS_RUN.md) and [M3 evidence](docs/M3_VALIDATION.md). M2 acceptance is preserved. The six M3 desktop observations were operator-accepted on 2026-10-21, with a Smart/input-method compatibility caveat; see the evidence record.

# Shot2Agent

**Capture once. Process anywhere.**

Shot2Agent is a screenshot-driven, asynchronous agent task system. **Local mode** lets one Windows PC capture, process and return screenshots without a Relay/VPS. **Remote mode** optionally uses a personal VPS Relay to coordinate capture PC A and Agent PC B. Both modes use the same task contract, Profile model, Agent adapters and result-delivery settings.

> Status: **M2-L Local CLI implemented**: Windows clipboard image → SQLite → Fake/real Codex → Markdown/history → manual/Smart clipboard and independent Markdown save. No Relay/VPS/local HTTP needed. The operator accepted the minimum Windows Local loop after stabilization; detailed native edge cases remain separately unverified. Start with [Windows commands, configuration and acceptance](docs/LOCAL_MVP_USAGE.md); see [verification evidence](docs/M2_VALIDATION.md) and the [plain-language Windows acceptance guide](docs/WINDOWS_ACCEPTANCE.md).

## Confirmed V1 scope

- Windows screenshot-folder and clipboard-image capture; automatic and confirmation submission modes, plus pause.
- Single-image tasks and explicit manually assembled ordered image batches.
- Preconfigured, versioned profiles (agent, prompt, approved working directory, permissions, result behavior).
- Durable task queue/history in both modes. A personal-VPS HTTPS Relay is **optional** and only required for cross-device Remote mode.
- Codex-first worker adapter, architected for future agents; read-only by default.
- Remote push notifications plus authenticated web task history, Markdown results and artifacts.
- **Local is the default:** capture and Worker run on the same Windows PC, no Relay service or VPS config needed. Remote is opt-in; the VPS does **not** execute agent code.

## Architecture (Local desktop/CLI implemented; Remote delivery deferred)

```text
LOCAL (default, no Relay)                   REMOTE (optional Relay)
Windows capture tray                       Windows capture tray (PC A)
         |                                           | HTTPS
         v                                           v
Local durable task core                     VPS Relay (shared task core)
         |                                           ^ outbound
         v                                           |
Same-PC Worker -> Codex CLI                 Worker on PC B -> Codex CLI
         |                                           |
         v                                           v
Local history + optional delivery           Relay result -> history / PC A receiver
```

Local mode never requires a Relay URL, a VPS, or a remote upload/download round trip. The hosted Agent model may still need Internet. See [Deployment modes](docs/DEPLOYMENT_MODES.md) and [Architecture](docs/ARCHITECTURE.md). M2-L adds a Local CLI/coordinator, native clipboard helper, real Codex adapter and independent Local delivery. M3-L adds the bounded Local desktop/tray shell; Remote delivery, watched folders and batch authoring remain planned.

## Read first

1. [Product spec and V1 acceptance criteria](docs/PRODUCT.md)
2. [Deployment modes: Local / Remote](docs/DEPLOYMENT_MODES.md)
3. [Architecture and trust boundaries](docs/ARCHITECTURE.md)
4. [Task protocol and lifecycle](docs/PROTOCOL.md)
5. [Milestone plan and automated test gates](docs/ROADMAP.md)
6. [Windows Native vs WSL development](docs/WINDOWS_DEV.md)
7. [Testing strategy and required manual proof](docs/TESTING.md)
8. [Decisions and assumptions](docs/DECISIONS.md)
9. [Result delivery policy](docs/RESULT_DELIVERY.md)
10. [Instructions for coding agents](AGENTS.md)

## Windows 11 Local MVP quick start

普通用户在 **Windows PowerShell** 运行，先安装 Node 22.16+、Git、pnpm 10.19.0 和已登录的 Codex CLI。完整安装、Fake 离线验证及错误处理见 [Windows 使用指南](docs/LOCAL_MVP_USAGE.md)。在仓库根目录执行：

```powershell
corepack pnpm install --frozen-lockfile
npm run check
codex --version
codex login status
$localRoot = Join-Path $env:LOCALAPPDATA 'Shot2Agent-Codex'
$workspace = Join-Path $env:LOCALAPPDATA 'Shot2Agent-ReadonlyWorkspace'
$output = Join-Path $env:LOCALAPPDATA 'Shot2Agent-Results'
New-Item -ItemType Directory -Force $workspace | Out-Null
$codexPath = (Get-Command codex.cmd -ErrorAction Stop).Source
node .\dist\apps\cli\src\mvp.js init --root $localRoot --adapter codex --workspace $workspace --codex $codexPath --clipboard smart --save $output
node .\dist\apps\cli\src\mvp.js doctor --root $localRoot
node .\dist\apps\cli\src\mvp.js watch --root $localRoot
```

用 `Win+Shift+S` 截图后在控制台输入 `submit` 确认；输入 `list` 查任务、`show UUID` 读取 Markdown、`copy UUID` 手动复制、`delivery UUID` 查两个通道状态、`quit` 退出。Smart 只在提交后没有新的剪切板操作时自动返回。明确希望自动提交时，在启动 `watch` 命令后加 `--auto`，可最小化控制台继续使用；这会将新图片发给配置的 Agent。`init` 不覆盖已有配置；同一个 watcher 内提交才能保留 Smart 生命周期基线。所有可选通道关闭时仍保留历史。

## M1 developer checks and Local demo

Use Node.js **22.16+** and pnpm **10.19.0**:

```shell
corepack pnpm install --frozen-lockfile
npm run check
npm run local -- demo .local/shot2agent 5
npm run local -- list .local/shot2agent
```

Local needs no Relay URL, server or Agent credentials. Tests cover both direct Local and authenticated HTTP Remote Fake execution, including restart, fencing and failure paths. The TypeScript build produces runnable JavaScript under `dist/`. See [M1 commands, wire/storage decisions and verification boundaries](docs/M1.md).

## Implementation / deployment status

M1 provides shared task/attempt/result persistence, private verified images, idempotent upload, transactional claims/leases and Fake execution in both modes. M2-L provides clipboard PNG/DIB intake, confirmation/default or opt-in auto submission, version-pinned read-only Codex execution, persistent history, manual/Smart/explicit Always text return, independent atomic Markdown save and delivery retries. **The minimum Local loop and six M3 desktop observations have scoped operator acceptance. Smart/input-method interactions and unobserved interruption cases retain explicit limits. The Local tray/UI is implemented; folder watch, batch editor, file clipboard, remote notifications and production VPS deployment remain deferred.** The optional Relay is unchanged and not imported by Local MVP.

## Security baseline

Screenshots in the intended usage may transit the user's optional VPS and reach an approved cloud agent. Local mode does not transfer tasks to Relay, although hosted models may still receive image content. Nonetheless, all task and artifact APIs must be authenticated; screenshot content is treated as untrusted data; worker paths and permissions cannot be chosen by arbitrary remote task input. Secrets, screenshots, output artifacts, and local environment files must not be committed.

## License

No license has been chosen yet. The public repository does not imply permission to redistribute its contents; add a deliberate license when ready.
