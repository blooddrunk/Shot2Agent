# Shot2Agent

**Capture once. Process anywhere.**

Shot2Agent is a screenshot-driven, asynchronous agent task system. A Windows tray client captures screenshots, a VPS relays and persists tasks, an authenticated worker processes screenshots with Codex (or future adapters), and users receive notifications and inspect results in a web task history.

> Status: **early bootstrap**, not a working application. The repository currently contains product/architecture decisions, an implementation roadmap, and an automatically tested protocol-contract starter. Do not expose it as a live service yet.

## Confirmed V1 scope

- Windows screenshot-folder and clipboard-image capture; automatic and confirmation submission modes, plus pause.
- Single-image tasks and explicit manually assembled ordered image batches.
- Preconfigured, versioned profiles (agent, prompt, approved working directory, permissions, result behavior).
- Authenticated HTTPS relay on a personal VPS; persistent queue, retries, offline recovery and lease-aware workers.
- Codex-first worker adapter, architected for future agents; read-only by default.
- Remote push notifications plus authenticated web task history, Markdown results and artifacts.
- Capture and worker may run on the same Windows PC or different machines. The VPS does **not** execute agent code.

## Proposed architecture (implementation pending)

```text
Windows capture tray (Tauri 2 + Vue 3)
       | HTTPS / upload / status
       v
VPS task API + private blob storage + durable queue (Node.js/TypeScript)
       ^
       | outbound claim / heartbeat / complete
       |
Worker (Node.js/TypeScript) -> Codex CLI -> allowed local workspace
       |
       +-> task result / artifacts -> VPS -> web history + push
```

This is a **proposal**, not a declaration that these components are already implemented. Detailed boundaries and alternatives appear in [Architecture](docs/ARCHITECTURE.md).

## Read first

1. [Product spec and V1 acceptance criteria](docs/PRODUCT.md)
2. [Architecture and trust boundaries](docs/ARCHITECTURE.md)
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

**No runnable capture app, server, Codex worker, VPS deployment or notification integration has been shipped yet.** The roadmap is the source of truth for the next engineering slice.

## Security baseline

Screenshots in the intended usage are authorized to transit the user's VPS and reach an approved cloud agent. Nonetheless, all task and artifact APIs must be authenticated; screenshot content is treated as untrusted data; worker paths and permissions cannot be chosen by arbitrary remote task input. Secrets, screenshots, output artifacts, and local environment files must not be committed.

## License

No license has been chosen yet. The public repository does not imply permission to redistribute its contents; add a deliberate license when ready.
