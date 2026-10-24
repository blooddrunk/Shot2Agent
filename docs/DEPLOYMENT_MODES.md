# Deployment modes: Local and Remote

M10 development implements optional GUI-to-Relay-to-approved-Worker-to-origin return; [guide](REMOTE_GUIDE.md), [Compose](../deploy/relay/README.md), [validation](M10_R_VALIDATION.md). Local remains the default and needs no Relay. Enabling the independent receive role or completing existing Remote tasks can keep Remote polling active while new submissions target Local; that does not transfer Local tasks. M10 shows Remote history locally at its origin; Web history/push below remain M11 proposals. Stable published Local v1.0.2 is unchanged.

> M3-L desktop update: Tauri 2/Vue 3 uses a restricted anonymous-pipe Node child; no network listener or Relay. Windows Job containment owns descendants; EOF/quit aborts and settles work. Versioned capture settings share M2 settings with backup; SQLite tasks are retained. Worker exclusion is transactional and PID-aware. See [desktop operation](M3_WINDOWS_RUN.md) and [evidence](M3_VALIDATION.md).

**Status:** confirmed V1 requirements as of 2026-10-20. M1 core plus M2-L Local clipboard/Codex/delivery and M3-L Local desktop are implemented. M2 minimum-loop operator acceptance is retained; M3 native acceptance is pending. Remote delivery remains planned. See [M3 evidence](M3_VALIDATION.md).

## Operating modes

**Local (default):** The same Windows PC captures images and runs the authorized Agent/Worker. Capture uses a **local, durable task coordinator** (shared task core with private SQLite/files and same-PC Worker) and returns to local history, saved results and/or clipboard. The user needs **no VPS, Relay URL, Relay service, remote device, or network transfer of task data to a Relay**. A hosted Agent/model may independently need Internet.

**Remote (opt-in):** Capture PC A submits to a personal-VPS Relay via authenticated HTTPS; Worker on PC B (or intentionally the same PC) polls/claims via outbound connection. Relay durably stores the queue and private artifacts. Result is retrieved by PC A, shown in authenticated web history, and optionally pushed.

| Aspect | Local | Remote |
| --- | --- | --- |
| Transport | Direct local application-service call or restricted local IPC | Authenticated outbound HTTPS |
| Task persistence | Private local SQLite / files | Private VPS SQLite / files |
| Agent | Same-PC approved Worker | Worker on PC B, optionally PC A |
| Task history | Always available locally | Authenticated web access |
| Relay | **Not required** | Required |
| Delivery | Local files/clipboard/desktop; optional direct provider push | Same independent choices + result receiver |
| Offline behavior | Local queue survives process restart | Queue survives disconnected endpoints / Relay restart |

## Architecture invariants

1. **One task model/state machine and Agent Adapter interface** for both modes, backed by one task domain/service. Use transport and storage adapters rather than copy/paste business logic. Preserve task ID, ordered image hashes, attempts, uncertainty semantics and Profile version.
2. Local mode calls the task service **without VPS and without starting any Relay HTTP server**. Local queue and artifact history survive tray/worker restarts. No implicit external image upload except what the chosen hosted Agent itself requires.
3. Remote mode adds auth/device association, upload idempotency, lease/fencing, private artifact URLs and authorized result retrieval.
4. Default to Local when Relay is not configured. Never silently fall back from a failing Remote session to some other mode or endpoint; explain the configuration error.
5. Existing queued tasks/history remain attached to their original mode when switching. No implicit migration/synchronization or duplicate execution in V1.
6. Delivery channels (remote push, local save, clipboard, desktop toast) remain **independent and combinable** in both modes, with per-channel status. All can be disabled; durable history remains on.
7. Execution Profiles remain Worker-controlled, with sandbox / approved working directory. Local files and IPC honor Windows user OS permissions; Remote mode authenticates every transfer.

## Engineering gates

- **M1 updated:** build one durable task core; prove direct Local-mode CLI + Fake Agent end-to-end with **no Relay process/URL**, plus separate optional Remote HTTP adapter and authenticated fake Worker end-to-end. No real Codex or Tauri during M1.
- **M2:** Agent Adapter works from local dispatch and Remote claim paths.
- **M3:** Windows tray chooses Local/Remote; local history remains usable without VPS. Native clipboard result writer can be integrated independently later.
- **M4:** independent result channels; Local reads local results directly; Remote fetches authorized results through Relay.
- **M5:** validate standalone Windows Local experience and separate VPS Remote deployment.

Automated tests must verify shared state/result contracts, local process restart persistence, zero Relay network calls in Local mode, remote authentication and lease fencing, and no silent task migration. Native Windows tests must separately verify Local screenshot + clipboard + Codex and cross-device Remote workflows.

See [Product](PRODUCT.md), [Architecture](ARCHITECTURE.md), [Roadmap](ROADMAP.md), [Protocol](PROTOCOL.md), and [Result delivery](RESULT_DELIVERY.md).
