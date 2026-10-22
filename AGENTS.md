# Coding agent instructions — Shot2Agent

## First: synchronize the actual repository state

1. Run **git fetch origin --prune**. Check git status, current branch, main SHA, open PRs and recent merges before making a change. Integrate the latest origin/main safely; **never reset, overwrite or discard uncommitted user work**. This review may have updated the repository after the previous handoff.
2. Read README.md, docs/LOCAL_V1_FIRST_MILESTONE.md, docs/M9_LOCAL_V1_RELEASE.md, docs/M8_VALIDATION.md, docs/ROADMAP.md, docs/PRODUCT.md, docs/ARCHITECTURE.md, docs/RESULT_DELIVERY.md, docs/TESTING.md and docs/DECISIONS.md. Consult specific older M* evidence only where it is relevant.
3. Report verified baseline, exact selected goal and affected contracts briefly. Do not implement an obsolete milestone merely because an old handoff mentions it.

## Current status and next goal (2026-10-22)

- **M8-L Local functionality 0.8.0 is merged** as PR #17; **0.8.1 native file clipboard and Home capture-status stabilization is merged** as PR #18. Exact last reviewed main: `1d17690c5bfe488e428f8069a8e05babcd667213`. Merged main [Node 22/24 Linux/Windows + Vue CI](https://github.com/blooddrunk/Shot2Agent/actions/runs/39715940064) and [Windows package/Rust/EXE smoke](https://github.com/blooddrunk/Shot2Agent/actions/runs/39715940219) succeeded.
- M8 shipped independent clipboard/folder capture, 2–5-image ordered GUI tasks, native Windows Markdown file clipboard, optional native completion notification, independent persistent output results, GUI profile/history and GLM Token save without mandatory paid synthetic connection test. Preserve these; do not redo M8.
- **M9-L 1.0.0-rc.1 is merged in PR #20** at `573cae0e671c5360198d492078b09d16f1802a52`; final main matrix/Vue and Windows Rust/package/extracted-EXE gates passed. On 2026-10-22 the operator reported “验证成功，可以完成复制。” for the published RC. Record this as operator file-copy PASS; do not invent detailed trial/focus evidence or demand another unchanged native checklist.
- **Current authorized follow-up:** finish Lucide icons and ordinary-user README, quick start and full configuration manual, then ship formal Local v1.0 after exact final CI/package gates. Keep the existing four-page Vue structure. Preserve native clipboard/Core/adapters; this follow-up changes presentation/docs/version only. [Evidence](docs/M9_VALIDATION.md). Remote/VPS/Relay remains deferred.

## Architecture and engineering boundaries

- Local default is one Windows computer: capture → durable SQLite task core → one bounded Worker → Agent result → independent result destinations and history. It needs **no VPS or Relay**. Remote service code remains out of M9 scope.
- Keep the existing contracts, Core and Agent adapters; they already accept ordered multi-image tasks. Agent/profile selection and fingerprints are bound at submission. Queued/running/old tasks retain their exact old version. No automatic replay of uncertain Agent execution or opaque failover.
- Worker-owned executable and credential choices must never come from screenshot text or task request data. Maintain user-origin consent for automatic cloud submission and Always clipboard overwrite; default read-only execution, bounded processes, OS-backed credential storage and safe task/private-file cleanup.
- Prefer **small changes and reuse**. No Vue→React migration, new infrastructure, multiple redundant approval steps, needless security bureaucracy, new issues or ongoing milestone splitting for this personal-use research project. Do not use CLI/profile JSON/repair CMD as an ordinary user's configuration path. A portable Windows EXE and GUI must cover Local usage.
- Result history persists even with all delivery destinations off. Existing delivery **Retry** never re-executes an Agent. Do not regress Smart's sequence/conflict guard. File clipboard must point to real retained, verified local files; do not delete exported user files during app history cleanup.

## Validation and handoff

1. Use frozen dependencies and automate first: **corepack pnpm install --frozen-lockfile; npm run check; npm run desktop:test-ui**. Exercise success, refusal, cancellation, restart, corruption/partial-write and history/provenance cases with Fake/mock Agent and synthetic files. Add narrow regression tests for every changed contract.
2. Verify the Windows CI matrix, Tauri Rust checks, packaged ZIP/build manifest, compiled helper resources, packaged EXE IPC/quit, and true native file clipboard/notification behavior where applicable. Give source SHA, exact passing/failing commands and link to evidence. Do not waive red CI or fabricate native screenshots.
3. Tests run only in isolated disposable roots; **never** expose/use real Tokens, personal screenshots, operator history or outputs; **no real paid AI requests** in automated or manual acceptance unless the operator separately authorizes a specific request.
4. Manual proof is the exception. If unavoidable, use the minimum isolated Windows GUI checklist from docs/M9_LOCAL_V1_RELEASE.md: exact preconditions, clicks, expected observable results and unverified boundary. Do not ask the operator to run a giant CLI recipe or report only “evidence missing”.
5. Prefer one focused M9 implementation PR and at most one brief evidence-driven stabilization follow-up. Do not tag Local v1.0 while the original Explorer clipboard paste failure remains unverified. Preserve existing scoped operator PASS items and move to the **first Local v1.0 release** only after the final gates; a browser test or package build alone is insufficient.
