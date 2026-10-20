# Architecture / product decisions

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
| D011 | Proposed | Shared durable task core: local or VPS SQLite + private files | One model for both modes |
| D012 | Proposed | Read-only worker profile default, worker-owned allowlist | Limit damage from untrusted screenshots |
| D013 | Proposed | At-least-once delivery + leases/fencing, explicit uncertain-execution outcome | Cannot guarantee exactly-once side effects |
| D014 | Proposed | 20 images max, 20 MiB/image, 60 MiB/task | Initial guardrails; verify with real workload |
| D015 | Confirmed | **Local mode** is default; capture and Agent run on one Windows PC **without Relay/VPS** | Minimal setup; no unnecessary upload round trip |
| D016 | Confirmed | **Remote mode** opt-in via personal VPS Relay | Cross-device asynchronous processing |
| D017 | Confirmed | Local and Remote share task states, Profile/Adapter and delivery policies | Avoid two divergent implementations |
| D018 | Proposed | Mode changes do not silently migrate queued tasks or history | Avoid unintentional uploads and lost work |

Deferred: exact notification provider, persistence library, Tauri clipboard monitor implementation, installer target, and deployment hostname. No credentials or machine-specific paths belong in these decisions.
