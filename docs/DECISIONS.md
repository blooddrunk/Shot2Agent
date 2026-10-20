# Architecture / product decisions

This is a lightweight decision log. 'Proposed' choices may be revised when tests show concrete problems. 'Confirmed' are user-approved product requirements.

| ID | Status | Decision | Rationale |
| --- | --- | --- | --- |
| D001 | Confirmed | Windows folder + clipboard image capture | Minimal manual input |
| D002 | Confirmed | Automatic and confirmation modes | Balance speed and unintended uploads |
| D003 | Confirmed | Single screenshot + manually assembled image batch | Explicit, predictable multi-image context |
| D004 | Confirmed | Codex-first, extensible agent adapter | Preserve compatibility with other agents |
| D005 | Confirmed | Mobile/remote push and task history | Asynchronous remote results |
| D006 | Confirmed | Personal VPS as relay | Reliable offline queue and device separation |
| D007 | Confirmed | Lightweight Windows tray + background worker | Low UI overhead and independent execution |
| D008 | Confirmed | Intended screenshots may transit personal VPS and approved cloud agent | No mandatory local-only route for V1 |
| D009 | Proposed | Main development checkout on Windows Native NTFS | Native tray/clipboard/MSVC integration |
| D010 | Proposed | pnpm + TypeScript monorepo; Tauri 2/Vue 3 capture; Node worker/API | Familiar client stack, focused native shell |
| D011 | Proposed | SQLite + private filesystem blobs for one personal VPS | Simple durable operations |
| D012 | Proposed | Read-only worker profile default, worker-owned allowlist | Limit damage from untrusted screenshots |
| D013 | Proposed | At-least-once delivery + leases/fencing, explicit uncertain-execution outcome | Cannot guarantee exactly-once side effects |
| D014 | Proposed | 20 images max, 20 MiB/image, 60 MiB/task | Initial guardrails; verify with real workload |

Deferred: exact notification provider, persistence library, Tauri clipboard monitor implementation, installer target, and deployment hostname. No credentials or machine-specific paths belong in these decisions.
