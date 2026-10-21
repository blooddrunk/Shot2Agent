# M5-L: Local Agent selection and executable discovery (planned)

**Status: proposed implementation slice, not implemented.** Reviewed on 2026-10-21 against merged `main` `aab7d443fee1bd138300d4b20041b4b67f669b76` (M4-L #5 + 0.4.1 desktop fix #6). The same main passed [Node 22/24 on Windows/Linux](https://github.com/blooddrunk/Shot2Agent/actions/runs/39540898767) and the [Windows package / real EXE smoke](https://github.com/blooddrunk/Shot2Agent/actions/runs/39540898758). Those checks do **not** verify Claude Code or new GUI interactions.

## Product decision / priority

**Prioritize one bounded M5-L delivery over Remote/VPS, installer, full profile editor and new delivery channels:**

1. Local Windows discovers installed **Codex CLI** and **Claude Code** executables, with **explicit manual path override**; visible diagnostic statuses and version/capability checks.
2. Operator can select either approved provider in the desktop for **new** screenshot tasks, preserving the automatic capture / history / Smart + save delivery already in place. Selection never silently edits a task already queued or running.
3. Implement a read-only, noninteractive **Claude Code image-analysis adapter** with the existing Codex-equivalent integrity, timeout, cleanup, provenance and auth boundaries.
4. Retain existing real Codex entry/root/history, legacy entry, separate Fake acceptance, Local-no-Relay operation and M4-L resilience. Do not add actual auto-failover or Agent auto-rerun in this slice.

The older roadmap section named "M5 - Private VPS release hardening" is deferred full-V1 scope, **not a prerequisite** to this narrowly scoped Local milestone. Avoid a broad infrastructure rewrite.

## Current architectural facts and change points

- `packages/worker/src/codex.ts`: single approved, pinned Codex `program` (`executable` + optional JS entry), `workspace`, version and read-only policy.
- `packages/worker/src/process.ts`: `spawn(..., {shell:false})`, bounded subprocess, environment allowlist, process tree settlement. Claude subscription/key-based auth may need *approved provider-specific* environment inputs; never dump them.
- `packages/worker/src/worker.ts`: a single `AgentAdapter`/profiles collection is used for one claim; `start` records adapter provenance. Route by an approved, immutable profile **after claim and before start**, so the actual adapter name/version are recorded.
- `packages/local/src/app.ts`: one active `adapter` and `profile`; `submit` pins one id/version; `work` claims only that profile. Extend to an execution-side registry supporting all approved outstanding profiles while using a separately selected default for new submissions.
- `packages/desktop/src/settings.ts` + `controller.ts` + `App.vue`: currently `fake|codex`, one read-only profile, IPC cannot select execution parameters. Add a narrowly authorized **provider/profile selection** IPC command that accepts only registered IDs, not raw paths/commands; manual executable changes remain an operator-owned stopped-worker approval operation.
- `apps/cli/src/mvp.ts`: initial Codex setup needs an explicit `--codex` executable; existing npm `.cmd` mapping uses Node + approved JS entry. Keep old config readable and migrate without overwriting approved profiles, task history, queue, consent or delivery receipts.
- `apps/desktop/src-tauri/src/main.rs`: default desktop entry/root is hardcoded to approved Codex configuration; preserve the existing `--staging` Fake and `--legacy` behavior, Windows Job containment and packaged smoke contract. Reuse existing formal Local root for multiple providers rather than moving history silently.

## Acceptance contract

### Discovery and configuration

1. Discover in this deterministic order **per provider**: operator-configured absolute executable/program override; previously approved pinned choice; then known candidate locations + actual Windows `PATH`. Candidate sources include native `*.exe` (Codex/Claude), native user install bins, WinGet links, and npm global shims when present. Do not infer a path solely from a screenshot or task content. Deduplicate canonical targets, never search/untrusted network shares recursively or invoke a login command merely to discover.
2. Windows `.cmd/.bat/.ps1` shim files are **not executed via a shell**. Where an npm shim corresponds to a verified `@openai/codex` or `@anthropic-ai/claude-code` package, resolve the audited Node JS entry (`node.exe` + absolute package entry, based on validated package metadata), or use a native executable. Reject unrecognized wrappers, mismatched packages, symlink escapes, non-files, broken permissions and ambiguous candidates. Keep `shell:false` with an argument array.
3. Inspection must be bounded, sanitized, and side-effect-free: canonical path, `--version` and the needed help/capability check, with timeout/output limits. Distinguish `not_found`, `invalid`, `unsupported`, `version_changed`, `unverified_auth`, `ready_for_execution`. Discovery/CLI version **never proves authenticated model execution**.
4. If more than one candidate is viable, show candidates/version and require an explicit choice instead of silently changing a pinned executable. Manual configuration must remain possible. Preserve profile ID/version/fingerprint (including provider/path/CLI version and read-only constraints); no automatic repin after a CLI upgrade. Never switch from missing Claude to Codex, or from missing Codex to Fake, without user selection.
5. UI selection affects **new** tasks only. At dispatch, persist selected `profileId/profileVersion`; a queued/running task must stay bound to its approved provider/version even if UI selection changes. Existing Codex queued tasks remain executable by the original policy, or fail visibly if that immutable policy is gone; no relabeling or silent migration.

### Claude adapter (Local read-only)

1. Use documented noninteractive `claude -p`, bounded `--input-format stream-json` image input and structured `--output-format json` or `stream-json`; pass the verified PNG/JPEG/WEBP screenshot bytes as typed image blocks in deterministic order with original hashes/limits, not filesystem paths from task input. Prove that the actual Windows CLI version accepts real images; **never silently degrade into text-only analysis**.
2. Refuse execution if read-only constraints cannot be enforced: disable *all* built-in tools (`--tools ""`) and MCP tools (`--disallowedTools "mcp__*"`); use `--safe-mode` or stronger compatible isolation as feature-probed, `--no-session-persistence` where available, and an approved workspace. Do not implicitly enable `--dangerously-skip-permissions`, `--permission-mode bypassPermissions`, shell, hooks, plugins or project MCP. Treat image contents as untrusted.
3. **Do not force `--bare` for subscription-authenticated users.** Anthropic documents that bare mode bypasses subscription OAuth/keychain, requiring a separate API key. Preserve existing interactive Claude Code login in a safe, constrained subprocess, and support explicit API-key configuration only when independently approved. Do not print secrets, prompts, screenshot contents or model output in diagnostics.
4. Parse only the documented structured final response, reject `is_error`, missing/oversized/malformed output, and respect limits, abort and process-tree cleanup. Preserve `execution_unknown` after potentially launched work; never automatically rerun under the same or alternate provider.
5. Single active Worker remains the Local policy; execution attempt records include actual provider/adapter version, approved profile fingerprint and start/finish state. Delivery fan-out/retry/Smart conflict history remain independent and unchanged.

### Failover boundary (future only)

Prepare a small provider registry/health model, but **no automatic failover, fallback or cross-Agent replay** in M5-L. Discovery failure/prelaunch refusal is different from "a model may have run" uncertainty; even provable prelaunch failure should not silently charge a second provider. Future explicit user-approved failover must create auditable new attempt lineage and require affirmative action after uncertain launches. Do not expand to multi-Agent collaboration, live session handoff, Remote relay or autonomous recovery.

## Mandatory automated gate (no paid model required)

- `corepack pnpm install --frozen-lockfile`, `npm run check`, Windows Node 22/24 + Linux Node 22/24, Rust fmt/test, `npm run desktop:build`, `npm run desktop:package`, **actual packaged EXE IPC/startup/refusal/quit/descendant-cleanup smoke**. CI must run on final PR HEAD and again on merged main. Record command exits, full test totals, run links, SHA/build artifacts. Never label Linux/WSL native desktop failure a Windows result.
- Pure mock and Windows-native fixture tests: native PATH candidates; local user bins; npm `.cmd` mapping; manual override; multiple/ambiguous installs; nonexistent/wrong executable; symlink/junction escape; unsupported flags and version drift; limited PATH; unauthorized raw IPC command/path input; selection migration; old Codex settings/history unaffected; queued Codex while selecting Claude; queued Claude while selecting Codex; two separate historical tasks with correct provider fingerprints and adapter names.
- Synthetic image fixture and stub Claude executable: exact content/mime/order, JSONL framing/parsing and bounded stdin/stdout, successful result, structured model error, malformed JSON, missing final output, prelaunch refuse, auth refusal, timeout, cancel, crash after spawn, descendant cleanup and **no automatic alternative execution**. Tests should assert no arbitrary shell spawn, Relay listener, file edits, secret output, unexpected clipboard write, or broken M4 no-clobber/Smart delivery protection.
- Keep existing #6 real-Codex synthetic proof and Fake acceptance; run appropriate pre-existing tests without weakening them. A Claude CLI `--version` test is **not** a real image-model integration test.

## Native Windows operator gate: only when unavailable to automate

Use a non-admin logged-in Windows 11 session, synthetic Notepad image reading `SHOT2AGENT 42`, a separate **disposable** result/save/history root where possible, and the exact packaged ZIP identified by `BUILD.txt`. Never request private screenshots, credentials, existing history files or live transcript evidence.

1. **Installed CLI inventory** (no model billing). In PowerShell execute `Get-Command codex,claude -All -ErrorAction SilentlyContinue | Select-Object Name,Source`, `codex --version` and `claude --version` **only if found**. In the app click **Refresh discovery** and verify provider/version/path. Override one provider manually and check it takes precedence, then restore the approved choice. Expected: no command prompt window, no process execution of untrusted shim, no task created, no clipboard mutation. Record PASS/FAIL and sanitized executable path/version, not auth details.
2. **One opt-in model smoke per chosen provider**. Only if already authenticated and the operator explicitly agrees that model billing may occur: submit exactly one synthetic image per CLI via the production Local controller/adapter with read-only Profile. Expect `succeeded`, one immutable attempt, correct provider label, text identifying the synthetic marker, no file changes; report the actual exit/status and whether image input worked. For Claude, **run a native Windows image-input compatibility probe** before declaring support; if unsupported, report BLOCKED with CLI version and safe reason. No auto retries or alternate-provider fallback.
3. **Desktop selection and return** (can use Fake stubs first): select Codex, submit a new synthetic screenshot; then select Claude and submit another, with auto capture/Smart/save. Expect two task entries with their original provider labels, old queued task not retargeted, correct independent delivery receipts, Notepad focus retained, one actual paste per intended Smart result. During the second run copy `NEWER CLIPBOARD`: expect conflict receipt and preserved text. Test pause/restart with queued tasks; never overwrite operator history.
4. If no Claude binary, login, or eligible model allowance is available, **do not fabricate PASS**. Automated Fake/mock, discovery and package tests can complete the code gate; mark *real authenticated Windows Claude image analysis* and *new GUI paste/focus observations* `NOT VERIFIED` with the exact missing prerequisite and shortest optional verification step.

## Stop condition / delivery

Keep this to one implementation PR and, only if objective failures require it, one short stabilization pass. Finish with changed files, new vs existing behavior, test matrix, run links, exact unresolved native gates, and an immediately runnable portable Windows build. Update `docs/M3_WINDOWS_RUN.md`, usage/architecture/roadmap and `AGENTS.md` with actual behavior only after it is implemented. Do not call M5-L complete merely because this planning document exists.

Official CLI documentation:
- [Claude Code CLI flags](https://code.claude.com/docs/en/cli-reference)
- [Claude Code streaming image inputs](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
- [Claude Code headless and bare-mode OAuth constraint](https://code.claude.com/docs/en/headless)
- [OpenAI Codex CLI install routes](https://github.com/openai/codex/blob/main/README.md)
