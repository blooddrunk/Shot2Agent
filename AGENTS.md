# Coding agent instructions — Shot2Agent

## First: synchronize the actual repository state

1. Run **git fetch origin --prune**. Check git status, current branch, main SHA, open PRs and recent merges before making a change. Integrate the latest origin/main safely; **never reset, overwrite or discard uncommitted user work**. This review may have updated the repository after the previous handoff.
2. Read README.md, docs/LOCAL_V1_FIRST_MILESTONE.md, docs/M9_LOCAL_V1_RELEASE.md, docs/M8_VALIDATION.md, docs/ROADMAP.md, docs/PRODUCT.md, docs/ARCHITECTURE.md, docs/RESULT_DELIVERY.md, docs/TESTING.md and docs/DECISIONS.md. Consult specific older M* evidence only where it is relevant.
3. Report verified baseline, exact selected goal and affected contracts briefly. Do not implement an obsolete milestone merely because an old handoff mentions it.

## Current status and next goal (2026-10-24)

- Stable Local v1.0.2 is published at `5f0f7ab8e8d4f3cd30aa2b7351fa19aa499e11cb`; preserve its Tag/Release and independent Local behavior. Existing accepted Local native observations do not need another unchanged checklist.
- M10-R #25/#26 is merged at `83a88bc2a80c8b4c03cd93bba540dafd57850bc1`; M11-X #27 native monitor capture and manual typing is merged at `3675182e28dbba75c71824a83baa0b15b825c9f5`. Its `1.1.0-dev.5` candidate remains unreleased. Read `docs/M11_X_SCOPE.md`, `docs/M11_X_VALIDATION.md`, `docs/REMOTE_GUIDE.md` and `docs/M10_R_VALIDATION.md`. Do not rerun already accepted unchanged physical A/B/C paths.
- **Next implementation goal: M12-V, a bounded optional Linux VPS Agent Worker**, following `docs/M12_V_PLAN.md`. Keep Relay as transport/storage only, with a separate approved Linux Worker (not Agent execution inside Relay). Reuse task core/Remote outbox/WorkerPort and Linux-specific process, approval and credential adapters. Local and Windows Worker must continue working unchanged. M11-R web history, push and provider failover stay deferred. No formal v1.1.0 release on Fake-only evidence.
- Remote adds GUI configuration/OS-backed device Tokens, immutable target metadata, separate durable outbox, outbound approved Worker using the same Local execution slot, verified origin return and independent existing delivery, and bounded Compose deployment. Never silently execute Remote tasks in Local.
- M11 web history, mobile push, provider failover, React migration and expanded infrastructure remain deferred. Do not publish v1.1.0 based only on Fake/CI. Record exact-SHA tests and the small prepared native/VPS observations separately; no paid model requests without specific user authorization.

## Architecture and engineering boundaries

- Local default is one Windows computer: capture → durable SQLite task core → one bounded Worker → Agent result → independent result destinations and history. It needs **no VPS or Relay**. Remote is optional under the explicitly authorized M10 scope; it must never become a Local dependency.
- Keep the existing contracts, Core and Agent adapters; they already accept ordered multi-image tasks. Agent/profile selection and fingerprints are bound at submission. Queued/running/old tasks retain their exact old version. No automatic replay of uncertain Agent execution or opaque failover.
- Worker-owned executable and credential choices must never come from screenshot text or task request data. Maintain user-origin consent for automatic cloud submission and Always clipboard overwrite; default read-only execution, bounded processes, OS-backed credential storage and safe task/private-file cleanup.
- Prefer **small changes and reuse**. No Vue→React migration, new infrastructure, multiple redundant approval steps, needless security bureaucracy, new issues or ongoing milestone splitting for this personal-use research project. Do not use CLI/profile JSON/repair CMD as an ordinary user's configuration path. A portable Windows EXE and GUI must cover Local usage.
- Result history persists even with all delivery destinations off. Existing delivery **Retry** never re-executes an Agent. Do not regress Smart's sequence/conflict guard. File clipboard must point to real retained, verified local files; do not delete exported user files during app history cleanup.

## Validation and handoff

1. Use frozen dependencies and automate first: **corepack pnpm install --frozen-lockfile; npm run check; npm run desktop:test-ui**. Exercise success, refusal, cancellation, restart, corruption/partial-write and history/provenance cases with Fake/mock Agent and synthetic files. Add narrow regression tests for every changed contract.
2. Verify the Windows CI matrix, Tauri Rust checks, packaged ZIP/build manifest, compiled helper resources, packaged EXE IPC/quit, and true native file clipboard/notification behavior where applicable. Give source SHA, exact passing/failing commands and link to evidence. Do not waive red CI or fabricate native screenshots.
3. Tests run only in isolated disposable roots; **never** expose/use real Tokens, personal screenshots, operator history or outputs; **no real paid AI requests** in automated or manual acceptance unless the operator separately authorizes a specific request.
4. Manual proof is the exception. If unavoidable, use the minimum isolated Windows tray checklist from docs/V1_0_1_LOCAL_UX_POLISH.md: exact preconditions, clicks, expected observable results and unverified boundary. Do not ask the operator to run a giant CLI recipe or report only “evidence missing”.
5. Prefer one focused milestone implementation PR and at most one evidence-driven stabilization follow-up. Do not alter existing Local tags/Releases. Native tray, capture and target-text UI claims require real Windows evidence; browser tests or package builds alone are insufficient. No formal Remote release without applicable Windows/package gates and narrowly scoped outstanding native/VPS acceptance.
