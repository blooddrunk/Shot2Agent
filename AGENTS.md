# Coding agent instructions — Shot2Agent

## First: synchronize the actual repository state

1. Run **git fetch origin --prune**. Check git status, current branch, main SHA, open PRs and recent merges before making a change. Integrate the latest origin/main safely; **never reset, overwrite or discard uncommitted user work**. This review may have updated the repository after the previous handoff.
2. Read README.md, docs/LOCAL_V1_FIRST_MILESTONE.md, docs/M9_LOCAL_V1_RELEASE.md, docs/M8_VALIDATION.md, docs/ROADMAP.md, docs/PRODUCT.md, docs/ARCHITECTURE.md, docs/RESULT_DELIVERY.md, docs/TESTING.md and docs/DECISIONS.md. Consult specific older M* evidence only where it is relevant.
3. Report verified baseline, exact selected goal and affected contracts briefly. Do not implement an obsolete milestone merely because an old handoff mentions it.

## Current status and next goal (2026-10-24)

- **Local v1.0.0 is formally released** at main/tag/Release commit `789c90daaba54301ec1eb54f2ed69939bcc3702a`: [release](https://github.com/blooddrunk/Shot2Agent/releases/tag/v1.0.0). Final main [Node matrix and Vue CI](https://github.com/blooddrunk/Shot2Agent/actions/runs/39737315101) and [Windows Rust/package/extracted EXE CI](https://github.com/blooddrunk/Shot2Agent/actions/runs/39737315089) passed. The 2026-10-22 operator report confirmed Explorer copy for the published RC within its documented scope; do not invent a recorded focus video or additional trials.
- **v1.0.1 Local UX polish is implemented in PR #23** at runtime source `9f7a301a8a6fcb2b4bfb60e650bf12182a1922e4`. Its Node 22/24 Linux/Windows matrix, 26 Vue tests, 8 Windows Rust tests, package/extracted EXE and native tray API smoke passed. On 2026-10-24 the operator reported “验收已经全部通过”; record the necessary native tray checklist as operator-reported PASS. Do not demand another unchanged native tray/file-copy checklist or invent Agent-captured visual evidence / unreported environment combinations.
- **Current follow-up: record acceptance and prepare Local v1.0.1 merge/release.** Check actual PR/main/tag/Release state before acting. Final merged-main CI, ZIP and BUILD/MANIFEST identity still need exact-SHA verification before a formal release. See [v1.0.1 validation](docs/V1_0_1_VALIDATION.md) and [release notes draft](docs/RELEASE_NOTES_1_0_1.md).
- Do not restart v1.0.0 release work. Remote/Relay/VPS, React rewrite, Agent failover and infrastructure expansion remain deferred. Preserve v1.0.0 behavior and refer to [v1.0.0 validation](docs/M9_VALIDATION.md) for previously closed gates.

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
4. Manual proof is the exception. If unavoidable, use the minimum isolated Windows tray checklist from docs/V1_0_1_LOCAL_UX_POLISH.md: exact preconditions, clicks, expected observable results and unverified boundary. Do not ask the operator to run a giant CLI recipe or report only “evidence missing”.
5. Prefer one focused v1.0.1 implementation PR and at most one evidence-driven stabilization follow-up. Do not alter the existing v1.0.0 tag/Release. Native tray UI claims require real Windows visual evidence; browser tests or package builds alone are insufficient. Publish a new v1.0.1 release only after the applicable Windows gates and the narrowly scoped native tray acceptance.
