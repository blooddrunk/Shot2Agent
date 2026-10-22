> Local 1.0 release: [用户使用手册](USER_GUIDE.md) · [发布验证与操作员验收](M9_VALIDATION.md)。下文保留历史规格和规划，不作为当前用户操作指南。

# Shot2Agent: Local v1.0 is the FIRST product milestone

Decision 2026-10-21. Baseline: merged M6-L PR #11 (c430c5735b7c0dc6f2bd2740bc50f8e94f33f2a4). This is a PLAN, not completed functionality. Remote/VPS is strictly later; the old roadmap's M3-M5 sections describe scope, not sequential release gates.

## Definition of done

A Windows user can unpack/run Shot2Agent, complete first-use onboarding, select/configure Codex or Claude CLI and a GLM compatible gateway including token, set capture/output preferences, run single and multiple screenshots, read/copy/export results, manage history and credentials, and restart safely, all without Shot2Agent CLI commands or JSON edits. Agent CLI installation/account login and online model access may be genuine external prerequisites; Shot2Agent setup and profile changes must be GUI-controlled. Start the EXE successfully even with NO approved profile, showing setup rather than CODEX_SETUP_REQUIRED.

Do not conflate a completed M6 feature slice with this first product milestone. Avoid new artificial security reviews, paid-test gates, attestation rituals, and separate .cmd utilities. Keep necessary OS credential hygiene, executable binding, data integrity, and protection against unintended rerun/deletion; otherwise prioritize iteration speed. Do not create GitHub issues for this plan.

## M7-L (NEXT): GUI setup, Profile and local history management

1. GUI-first onboarding from a fresh root, including CLI discovery/manual executable picker, workspace directory picker, provider selection, prompt and default delivery configuration. Configure Codex/Claude/GLM in the app. For Gateway: endpoint preset (domestic/international), model, masked Token input, Windows Credential Manager create/replace/delete, visible connection status and optional consented synthetic-image test. The user types a token ONCE. No shell Profile approval, credential reference copy, editing settings.json, or external repair CMD. Reuse existing qualified worker/credential code; do not relax true isolation protections. For running work, apply profile changes to FUTURE tasks or schedule a transparent internal worker restart at idle.
2. Make 'remove from selection' distinct from 'permanent clean of unreferenced version'. Hide archived/historical profile versions from normal UI; retain provenance needed by queued/running tasks. Add clean-unused-versions and reference-checked deletion of unused credential targets; never delete a token shared by another version. Keep minimal historical metadata where necessary.
3. Local history: delete one, select/delete many, clear completed history, clear all safely deletable history. Coordinate core tasks/attempts, local captures/provenance/delivery and private screenshot/result blobs. Verify referenced file ownership and prevent orphan/leak on crash. Active running/queued/unknown executions must not be destroyed or silently replayed; provide intelligible action. Never delete user-owned exported Markdown files by default; only offer a separate explicitly confirmed deletion of known app-generated outputs. Keep recent-result hotkeys correct after cleanup.
4. Remove UX dependencies on separate Start Codex.cmd, repair CMD and manual CLI setup. A normal executable opens even without a Profile; onboarding is usable from GUI with clear, actionable Chinese error messages. Preserve existing approved M6 credentials, task provenance and history across migrations. Stop/rotate worker safely in-app; preserve older queued task bindings.
5. Acceptance: entirely via packaged Windows EXE on disposable fresh root, with no Shot2Agent command-line interaction. GUI discover/add Agent, configure GLM Token securely, submit one synthetic screenshot, view/copy/save, remove unused profile versions, delete individual/all completed history, restart and validate persistence. Fake/mock flows must fully automate this; avoid further real paid requests unless user explicitly approves and a changed path requires it.

## M8-L: remaining planned LOCAL feature parity

1. GUI-configurable clipboard image capture and screenshot-folder watching independently; choose real folder, settle writes, skip existing content at startup, dedupe cross-source events and prevent exported output re-ingestion.
2. Minimal manually ordered 2-5 image batch composer (add, reorder, remove, discard, submit as one task) with immutable submitted input.
3. Independent combinable local delivery: Markdown save, text or file clipboard with backed verified files, optional native desktop notification; history-only/off allowed. Smart clipboard conflicts offer explicit manual Copy or opt-in Always; perfect third-party IME compatibility is NOT a release blocker. Remote push is deferred to Remote phase.
4. Explain delivery retry; optional explicit Agent rerun creates a NEW task, never silently re-executes execution_unknown. No agent failover framework for v1.
Acceptance: folder/clipboard/both; same screenshot dedupes, explicit repeat works; five ordered images one task; file payload pastes into Explorer; save/clipboard/notification work independently and all off retains history.

## M9-L: package and v1.0 gate

1. Deliver a Windows x64 portable end-user build with bundled runtime (installer only if necessary), no target-machine Node, pnpm, Git or Shot2Agent CLI requirements.
2. Polish first-run, tray/quit/restart, errors, backups/migrations, version display, redacted diagnostics, and simple usage docs.
3. Automated lint/type/tests/Fake subprocess E2E, mocked secure-store/credential flow, cleanup recovery, folder/batch/output, native Windows build/package/EXE smoke. One focused interactive Windows checklist of only non-automatable native interactions; include precise clicks/expected results and explicit unverified boundaries.
4. Tag Local v1.0 ONLY when all agreed Local features pass. Then plan Remote independently.

## Practical execution rules

Before ANY change: git fetch origin --prune; inspect status, existing branches/PRs and current main, safely integrate latest origin/main without losing edits. This document may itself arrive via a new planning PR.
Prefer one vertical implementation PR per M7/M8/M9, with one short stabilization round if real failures. Prioritize automatic verification, disposable roots, synthetic images, Fake/mock agents and no unintended paid traffic. Avoid extra scaffolding, issue tracking and invented blockers. Real operator history, credentials and saved output are off-limits to test runs.
Preserve minimal technical safety checks only where they prevent real damage: authenticated secrets in OS store, safe executable paths, active-task/unknown-execution protection, referential integrity of data deletion, no automatic model replay. Do not make authorization or diagnostic attestation an unnecessary multistep user workflow.
