# Shot2Agent

**Capture once. Process anywhere.**

Shot2Agent is a screenshot-driven, asynchronous agent task system. **Local mode** lets one Windows PC capture, process and return screenshots without a Relay/VPS. **Remote mode** optionally uses a personal VPS Relay to coordinate capture PC A and Agent PC B. Both modes use the same task contract, Profile model, Agent adapters and result-delivery settings.

> Status: **M1 developer slice**: shared durable SQLite task core, direct Local CLI, optional authenticated loopback Fastify Relay and deterministic Fake Worker. This is not a Windows capture application or production service. See [M1 usage and boundaries](docs/M1.md).

## Confirmed V1 scope

- Windows screenshot-folder and clipboard-image capture; automatic and confirmation submission modes, plus pause.
- Single-image tasks and explicit manually assembled ordered image batches.
- Preconfigured, versioned profiles (agent, prompt, approved working directory, permissions, result behavior).
- Durable task queue/history in both modes. A personal-VPS HTTPS Relay is **optional** and only required for cross-device Remote mode.
- Codex-first worker adapter, architected for future agents; read-only by default.
- Remote push notifications plus authenticated web task history, Markdown results and artifacts.
- **Local is the default:** capture and Worker run on the same Windows PC, no Relay service or VPS config needed. Remote is opt-in; the VPS does **not** execute agent code.

## Architecture (M1 core implemented; capture and real Agent pending)

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

Local mode never requires a Relay URL, a VPS, or a remote upload/download round trip. The hosted Agent model may still need Internet. See [Deployment modes](docs/DEPLOYMENT_MODES.md) and [Architecture](docs/ARCHITECTURE.md). M1 implements the durable core and Fake execution; capture UI, Codex and delivery remain planned.

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

M1 implements shared task/attempt/result persistence, private verified images, idempotent upload, transactional claims/leases and Fake execution in both modes. **Windows capture/tray, real Codex, clipboard, notifications and production VPS deployment remain unimplemented.** The optional Relay entry binds loopback only; it is an integration harness.

## Security baseline

Screenshots in the intended usage may transit the user's optional VPS and reach an approved cloud agent. Local mode does not transfer tasks to Relay, although hosted models may still receive image content. Nonetheless, all task and artifact APIs must be authenticated; screenshot content is treated as untrusted data; worker paths and permissions cannot be chosen by arbitrary remote task input. Secrets, screenshots, output artifacts, and local environment files must not be committed.

## License

No license has been chosen yet. The public repository does not imply permission to redistribute its contents; add a deliberate license when ready.
