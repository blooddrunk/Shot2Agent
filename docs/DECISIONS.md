# Architecture / product decisions

> M3-L desktop update: Tauri 2/Vue 3 uses a restricted anonymous-pipe Node child; no network listener or Relay. Windows Job containment owns descendants; EOF/quit aborts and settles work. Versioned capture settings share M2 settings with backup; SQLite tasks are retained. Worker exclusion is transactional and PID-aware. See [desktop operation](M3_WINDOWS_RUN.md) and [evidence](M3_VALIDATION.md).

> M2-L update (2026-10-20): M2-L implementation supersedes the old M1 16 MP resource guard: tested 64 MP, bounded bytes, still images and serial native decode. Local CLI + hidden Win32 helper precede full Tauri UI. Smart checks sequence and writes while holding OpenClipboard; baseline from another helper lifecycle is blocked. Worker pins exact Codex version, read-only permissions, no user config/rules and no shell tool; unknown execution is never replayed. See [Local usage](LOCAL_MVP_USAGE.md).

This is a lightweight decision log. 'Proposed' choices may be revised when tests show concrete problems. 'Confirmed' are user-approved product requirements.

| ID | Status | Decision | Rationale |
| --- | --- | --- | --- |
| D001 | Confirmed | Windows folder + clipboard image capture | Minimal manual input |
| D002 | Confirmed | Automatic and confirmation modes | Balance speed and unintended uploads |
| D003 | Confirmed | Single screenshot + manually assembled image batch | Explicit, predictable multi-image context |
| D004 | Confirmed | Codex-first, extensible agent adapter | Preserve compatibility with other agents |
| D005 | Confirmed | Mobile/remote push and task history | Asynchronous remote results |
| D006 | Confirmed (refined) | Personal VPS Relay is **optional**, enabled in Remote mode | Reliable cross-device queue without imposing VPS setup locally |
| D007 | Confirmed | Lightweight Windows tray + background worker | Low UI overhead and independent execution |
| D008 | Confirmed (refined) | Intended screenshots **may** transit VPS / approved cloud Agent when configured | User permission does not make Relay mandatory for Local mode |
| D009 | Proposed | Main development checkout on Windows Native NTFS | Native tray/clipboard/MSVC integration |
| D010 | Proposed | pnpm + TypeScript monorepo; Tauri 2/Vue 3 capture; Node worker/API | Familiar client stack, focused native shell |
| D011 | Implemented M1 | Shared durable task core: local or VPS SQLite + private files | One model for both modes |
| D012 | Proposed | Read-only worker profile default, worker-owned allowlist | Limit damage from untrusted screenshots |
| D013 | Proposed | At-least-once delivery + leases/fencing, explicit uncertain-execution outcome | Cannot guarantee exactly-once side effects |
| D014 | Proposed | 20 images max, 20 MiB/image, 60 MiB/task | Initial guardrails; verify with real workload |
| D015 | Confirmed | **Local mode** is default; capture and Agent run on one Windows PC **without Relay/VPS** | Minimal setup; no unnecessary upload round trip |
| D016 | Confirmed | **Remote mode** opt-in via personal VPS Relay | Cross-device asynchronous processing |
| D017 | Confirmed | Local and Remote share task states, Profile/Adapter and delivery policies | Avoid two divergent implementations |
| D018 | Proposed | Mode changes do not silently migrate queued tasks or history | Avoid unintentional uploads and lost work |

Deferred: exact notification provider, persistence library, Tauri clipboard monitor implementation, installer target, and deployment hostname. No credentials or machine-specific paths belong in these decisions.

## M1 implementation refinements (2026-10-20)

See [M1](M1.md) for evidence and implementation limits. These are resource/engineering choices, not expanded product promises:

- Built-in Node SQLite (experimental), WAL/FULL and versioned migrations; pnpm 10.19.0 plus strict TypeScript build.
- A store is bound to one mode. Explicit separate roots preserve history without implicit migration.
- M1 decoded input cap is 16 million pixels; animation/multipage images are refused. These supplement provisional byte limits and should be reviewed against real capture fixtures in M3.
- Results accept at most five 1-MiB plain-text artifacts during M1; other generated file types remain future adapter/output policy work.
- Loopback Relay uses an operator-provided role/owner/device registry; TLS deployment and token lifecycle tooling remain M5.
- Cancel/review/retry controls are not implemented in M1. Only safe lease recovery creates a new attempt automatically; terminal/unknown tasks never replay.
- POSIX private permissions are enforced; native Windows ACL isolation and power-loss behavior are not inferred from Linux tests.
