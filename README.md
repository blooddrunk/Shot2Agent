> **Latest Local 0.8.1 (merged):** M8-L input/output features and native Windows Copy files / capture-status stabilization shipped in [PR #17](https://github.com/blooddrunk/Shot2Agent/pull/17) and [PR #18](https://github.com/blooddrunk/Shot2Agent/pull/18). Merged-main CI and Windows portable package passed. The operator's post-fix Explorer paste is **not yet independently retested**. [Windows GUI usage](docs/M8_WINDOWS_RUN.md) · [Evidence](docs/M8_VALIDATION.md) · [Next: M9-L Local v1.0 release plan](docs/M9_LOCAL_V1_RELEASE.md).

# Shot2Agent

**Capture once. Process anywhere.**

Shot2Agent is a screenshot-driven, asynchronous agent task system. **Local mode** lets one Windows PC capture, process and return screenshots without a Relay/VPS. **Remote mode** optionally uses a personal VPS Relay to coordinate capture PC A and Agent PC B. Both modes use the same task contract, Profile model, Agent adapters and result-delivery settings.

> **Current Local user entry:** Download the Windows x64 portable ZIP from [GitHub Actions](https://github.com/blooddrunk/Shot2Agent/actions/workflows/desktop.yml), extract the entire ZIP, and double-click **Shot2Agent.exe**. Complete Agent, workspace, GLM Token, capture and result settings in the GUI. No target-machine Node, Git, pnpm, or Shot2Agent CLI required; WebView2 and the selected third-party Agent CLI/login are external prerequisites. For developer-only M2 CLI workflows see [historical instructions](docs/LOCAL_MVP_USAGE.md).

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

Local mode never requires a Relay URL, a VPS, or a remote upload/download round trip. The hosted Agent model may still need Internet. See [Deployment modes](docs/DEPLOYMENT_MODES.md) and [Architecture](docs/ARCHITECTURE.md). M2-L adds a Local CLI/coordinator, native clipboard helper, real Codex adapter and independent Local delivery. M3-L adds the bounded Local desktop/tray shell; Remote delivery remains planned; Local watched folders and batch authoring are implemented.

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

## Windows 11 Local desktop — ordinary user quick start

1. Download the latest **Shot2Agent-Windows-x64** ZIP from [Windows desktop package runs](https://github.com/blooddrunk/Shot2Agent/actions/workflows/desktop.yml) and extract the **entire** archive into a writable folder.
2. Double-click **Shot2Agent.exe**. Set up Codex CLI, Claude Code, or supported Claude-compatible GLM in the GUI; choose your Agent, workspace and optional GLM Token. Saving a Token does not send a model request. Install/login to the chosen external Agent CLI and WebView2 only if your PC needs them.
3. In **设置**, enable clipboard screenshots and/or a screenshot folder, choose confirmation or consented automatic submission, and independently configure text/file clipboard, Markdown save and optional Windows notification. Submit from the Home preview or compose an ordered 2–5-image task. Review/copy results and manage history in the app. Closing the window hides it to the tray; use tray Quit to exit.

No Shot2Agent command line, Git, Node, pnpm, JSON or repair script is part of normal use. `Start acceptance.cmd` is **developer-only**, for isolated Fake tests; it does not represent a real Agent. Native Explorer file paste is still awaiting the operator's narrow post-0.8.1 retest. [Short usage guide](docs/M8_WINDOWS_RUN.md) · [M9-L release plan](docs/M9_LOCAL_V1_RELEASE.md).

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

**M8-L 0.8.0 merged; 0.8.1 stabilization merged; M9-L Local v1.0 release acceptance next.** Local desktop includes independent clipboard/folder capture, ordered 2–5 image tasks, native Markdown file clipboard, optional completion notification, separate result destinations, GUI Agent/GLM Token management and history cleanup. Exact merged-main Windows/Linux checks and portable EXE package passed; the original user's post-0.8.1 Explorer paste remains unverified. [M8 evidence](docs/M8_VALIDATION.md) · [M9-L release gate](docs/M9_LOCAL_V1_RELEASE.md). Remote/VPS remains deferred.

## Security baseline

Screenshots in the intended usage may transit the user's optional VPS and reach an approved cloud agent. Local mode does not transfer tasks to Relay, although hosted models may still receive image content. Nonetheless, all task and artifact APIs must be authenticated; screenshot content is treated as untrusted data; worker paths and permissions cannot be chosen by arbitrary remote task input. Secrets, screenshots, output artifacts, and local environment files must not be committed.

## License

No license has been chosen yet. The public repository does not imply permission to redistribute its contents; add a deliberate license when ready.
