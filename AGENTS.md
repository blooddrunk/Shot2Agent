# Coding agent instructions — Shot2Agent

## First: synchronize the actual repository state

1. Run **git fetch origin --prune**. Check git status, current branch, main SHA, open PRs and recent merges before making a change. Integrate the latest origin/main safely; **never reset, overwrite or discard uncommitted user work**. This review may have updated the repository after the previous handoff.
2. Read README.md, docs/LOCAL_V1_FIRST_MILESTONE.md, docs/M8_LOCAL_FEATURE_PARITY.md, docs/ROADMAP.md, docs/PRODUCT.md, docs/ARCHITECTURE.md, docs/RESULT_DELIVERY.md, docs/TESTING.md and docs/DECISIONS.md. Consult specific older M* evidence only where it is relevant.
3. Report verified baseline, exact selected goal and affected contracts briefly. Do not implement an obsolete milestone merely because an old handoff mentions it.

## Current status and next goal (2026-10-22)

- **M7-UX 0.7.2 is implemented and merged** in PRs #14/#15. Latest reviewed main: 005015bce192ba6beffb3330fffc92fc58ed2177. The main Linux/Windows Node 22/24 CI, 13 real-Vue/controller browser tests and Windows portable package smoke all passed. The operator reported the previous basic functions working; automated evidence is **not** independent native GUI/focus, all providers or universal IME proof.
- UI: Vue 3/Tauri 2 with Home, AI assistants, History, Settings, light/dark mode, local setup, immutable Agent/profile versions and history deletion. GLM Token save and optional synthetic-image Test connection are separate; portable test-resource packaging was corrected in 0.7.2. Keep M7-UX scope closed unless a reproducible regression appears.
- **Next implementation milestone is M8-L Local feature parity**, specified by docs/M8_LOCAL_FEATURE_PARITY.md: independent folder/clipboard sources, 2-5 ordered-image GUI batch, true Windows file clipboard, optional desktop notification and independently combinable destinations. Then M9-L portable end-user polish/final Local v1.0 gate; **Remote/Relay is deferred**.
- One remaining policy inconsistency to address proportionately: GLM Test connection is labeled optional, but a new saved vision Profile still cannot send its first real screenshot without a separate passed synthetic test/attestation. Review the M8 plan's small product-policy correction. Never silently make a paid request, weaken executable isolation or edit the user's existing Token.

## Architecture and engineering boundaries

- Local default is one Windows computer: capture → durable SQLite task core → one bounded Worker → Agent result → independent result destinations and history. It needs **no VPS or Relay**. Remote service code remains out of M8 scope.
- Keep the existing contracts, Core and Agent adapters; they already accept ordered multi-image tasks. Agent/profile selection and fingerprints are bound at submission. Queued/running/old tasks retain their exact old version. No automatic replay of uncertain Agent execution or opaque failover.
- Worker-owned executable and credential choices must never come from screenshot text or task request data. Maintain user-origin consent for automatic cloud submission and Always clipboard overwrite; default read-only execution, bounded processes, OS-backed credential storage and safe task/private-file cleanup.
- Prefer **small changes and reuse**. No Vue→React migration, new infrastructure, multiple redundant approval steps, needless security bureaucracy, new issues or ongoing milestone splitting for this personal-use research project. Do not use CLI/profile JSON/repair CMD as an ordinary user's configuration path. A portable Windows EXE and GUI must cover Local usage.
- Result history persists even with all delivery destinations off. Existing delivery **Retry** never re-executes an Agent. Do not regress Smart's sequence/conflict guard. File clipboard must point to real retained, verified local files; do not delete exported user files during app history cleanup.

## Validation and handoff

1. Use frozen dependencies and automate first: **corepack pnpm install --frozen-lockfile; npm run check; npm run desktop:test-ui**. Exercise success, refusal, cancellation, restart, corruption/partial-write and history/provenance cases with Fake/mock Agent and synthetic files. Add narrow regression tests for every changed contract.
2. Verify the Windows CI matrix, Tauri Rust checks, packaged ZIP/build manifest, compiled helper resources, packaged EXE IPC/quit, and true native file clipboard/notification behavior where applicable. Give source SHA, exact passing/failing commands and link to evidence. Do not waive red CI or fabricate native screenshots.
3. Tests run only in isolated disposable roots; **never** expose/use real Tokens, personal screenshots, operator history or outputs; **no real paid AI requests** in automated or manual acceptance unless the operator separately authorizes a specific request.
4. Manual proof is the exception. If unavoidable, use the minimum isolated Windows GUI checklist from docs/M8_LOCAL_FEATURE_PARITY.md: exact preconditions, clicks, expected observable results and unverified boundary. Do not ask the operator to run a giant CLI recipe or report only “evidence missing”.
5. Prefer one focused M8 implementation PR and, if necessary, a brief evidence-driven stabilization follow-up. Close or merge only what evidence supports, then move directly to M9-L and the **first Local v1.0 release**. Never label M8 or Local v1.0 complete merely because a browser test or package build succeeded.
