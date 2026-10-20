# Shot2Agent

**Capture once. Process anywhere.**

Shot2Agent is a screenshot-driven, asynchronous agent task system. **Local mode** lets one Windows PC capture, process and return screenshots without a Relay/VPS. **Remote mode** optionally uses a personal VPS Relay to coordinate capture PC A and Agent PC B. Both modes use the same task contract, Profile model, Agent adapters and result-delivery settings.

> Status: **early bootstrap**, not a working application. The repository currently contains product/architecture decisions, an implementation roadmap, and an automatically tested protocol-contract starter. Do not expose it as a live service yet.

## Confirmed V1 scope

- Windows screenshot-folder and clipboard-image capture; automatic and confirmation submission modes, plus pause.
- Single-image tasks and explicit manually assembled ordered image batches.
- Preconfigured, versioned profiles (agent, prompt, approved working directory, permissions, result behavior).
- Durable task queue/history in both modes. A personal-VPS HTTPS Relay is **optional** and only required for cross-device Remote mode.
- Codex-first worker adapter, architected for future agents; read-only by default.
- Remote push notifications plus authenticated web task history, Markdown results and artifacts.
- **Local is the default:** capture and Worker run on the same Windows PC, no Relay service or VPS config needed. Remote is opt-in; the VPS does **not** execute agent code.

## Proposed architecture (implementation pending)

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

Local mode never requires a Relay URL, a VPS, or a remote upload/download round trip. The hosted Agent model may still need Internet. See [Deployment modes](docs/DEPLOYMENT_MODES.md) and [Architecture](docs/ARCHITECTURE.md). This describes planned, **not yet implemented**, functionality.

## Read first

1. [Product spec and V1 acceptance criteria](docs/PRODUCT.md)
2. [Deployment modes: Local / Remote](docs/DEPLOYMENT_MODES.md)
3. [Architecture and trust boundaries](docs/ARCHITECTURE.md)
3. [Task protocol and lifecycle](docs/PROTOCOL.md)
4. [Milestone plan and automated test gates](docs/ROADMAP.md)
5. [Windows Native vs WSL development](docs/WINDOWS_DEV.md)
6. [Testing strategy and required manual proof](docs/TESTING.md)
7. [Decisions and assumptions](docs/DECISIONS.md)
8. [Instructions for coding agents](AGENTS.md)

## Bootstrap contract checks

The first dependency-free contract prototype lives in `packages/contracts`. From the repository root, use **Node.js 22.16+**:

```shell
npm test
```

The test script currently uses Node's experimental TypeScript stripping for contract-only checks; it is **not** a production bundling strategy. Once actual services are created, use pinned pnpm dependencies, a proper TypeScript build and a committed lockfile.

## Implementation / deployment status

**No runnable capture app, Local-mode orchestrator, Remote Relay server, Codex worker, VPS deployment or notification integration has been shipped yet.** The roadmap is the source of truth for the next engineering slice.

## Security baseline

Screenshots in the intended usage may transit the user's optional VPS and reach an approved cloud agent. Local mode does not transfer tasks to Relay, although hosted models may still receive image content. Nonetheless, all task and artifact APIs must be authenticated; screenshot content is treated as untrusted data; worker paths and permissions cannot be chosen by arbitrary remote task input. Secrets, screenshots, output artifacts, and local environment files must not be committed.

## License

No license has been chosen yet. The public repository does not imply permission to redistribute its contents; add a deliberate license when ready.
