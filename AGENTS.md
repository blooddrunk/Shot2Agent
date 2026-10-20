# Coding agent instructions (Shot2Agent)

## Before making changes

1. **Sync latest code first**: `git fetch origin --prune`, inspect status/branch, then integrate `origin/main` into your working branch. Do not reset or discard uncommitted user changes. If already on the target branch, inspect merge-base and fast-forward safely.
2. Read `README.md`, `docs/PRODUCT.md`, `docs/DEPLOYMENT_MODES.md`, `docs/ARCHITECTURE.md`, `docs/PROTOCOL.md`, `docs/ROADMAP.md`, `docs/TESTING.md`, `docs/RESULT_DELIVERY.md` and `docs/DECISIONS.md`.
3. Identify the smallest roadmap milestone in scope. Separate verified facts from assumptions and propose corrections rather than silently changing product constraints.

## Development boundaries

- Monorepo with portable TypeScript contracts, Windows Native capture/Tauri, **same-PC Local task core/Worker by default** and optional VPS Relay for Remote tasks. The M2-L Local CLI has scoped operator acceptance; full GUI/installer and production Remote deployment are not delivered.
- V1: Local mode requires **no VPS/Relay**, Remote mode optionally uses VPS Relay; one Worker at a time, single/batch images, auto/confirm, durable queue, Codex adapter, mode-appropriate durable history and independent output channels.
- Profiles are worker-owned. Never allow remote task input to select a command, arbitrary working directory, credentials, or elevated sandbox.
- Default read-only; use `spawn` with explicit arguments and `shell: false`, and a bounded timeout. Screenshot text is untrusted input.
- No secrets, personal screenshot contents, production blobs, SQL files, live transcripts or `.env` secrets committed. Use synthetic fixtures.
- Never claim completion of Windows tray/clipboard, actual Codex authentication, remote mobile notifications or VPS deployment based only on unit tests.
- Prefer minimal dependencies, typed validated schemas, stable task IDs, idempotent upload, state transitions, safe replays, transactional claims and lease fencing.

## Validation before handoff

1. Run `npm test` now; as code grows, run lint, typecheck, build, isolated server/worker integration tests and Windows-specific jobs as applicable.
2. Exercise success **and** refusal/failure cases; use deterministic fake agent in CI.
3. Report commands executed, passing/failing tests, any missing real-environment prerequisites, and concise next actions.
4. For unavoidable manual verification, give explicit prerequisites, commands/actions, expected observable results, and boundary of what remains unverified. Follow `docs/TESTING.md`.
5. Do not merge code with failing checks or invent evidence. For VPS operations, avoid destructive migration without confirmed backup/restore plan.

## Next goal

**M1 was merged as PR #1; M2-L minimum Local functionality has operator acceptance** dated 2026-10-20, scoped by `docs/M2_VALIDATION.md#operator-acceptance-2026-10-20`. Do not describe the minimum loop as wholly unverified or silently mark detailed Smart/focus/interruption observations as passed. The intended product remains a Windows tray/desktop app; a bounded shell reusing the existing core is proposed next when requested, not started by this acceptance record. Follow `docs/WINDOWS_ACCEPTANCE.md`: automate developer checks, prepare the actual runnable build, and ask the operator only for the affected concrete observations. Replace CLI steps with actual GUI actions when that interface exists. Preserve all confirmed V1 capabilities and the Local no-Relay boundary.
