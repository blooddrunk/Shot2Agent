# M3-L: Windows Local tray app and configurable automatic capture (next single development round)

Status: **implemented for automated/build validation; native user acceptance pending**. See [current controls and run steps](M3_WINDOWS_RUN.md) and [executed evidence](M3_VALIDATION.md). The implementation provides worker-owned profile/configuration visibility, not a profile editor. Baseline: M2-L merged as PR #2, `a1d1a7c7ccfa6b16e8b7c98ebf9bed419c4b61b0`. M2-L minimum Local loop has scoped operator acceptance; do not claim that all Windows Smart/focus/interruption cases passed. Relevant evidence: [M2 validation](M2_VALIDATION.md), [Windows acceptance](WINDOWS_ACCEPTANCE.md).

## User decision and goal

Users must be able to keep Shot2Agent running unobtrusively and configure **new image copied into Windows clipboard -> Local task -> approved Codex -> result history + optional automatic Smart clipboard return and/or independent Markdown save**, without typing `submit` or `copy` every time. Current M2-L CLI **already supports** `watch --auto` for auto-submit and `delivery.clipboard = smart|always|manual|off` independently. M3-L adds a usable Windows **tray/desktop surface** and persistent, explicit capture preferences; do not rewrite these working pipelines.

### P0: narrowly scoped executable Local UI

1. Windows user-session tray UI (Tauri 2 + Vue 3 if reasonably feasible) with show/hide, clear running/paused/error status, clean quit, and small status/history panel. Existing Node Local coordinator/Win32 clipboard helper/Codex adapter remain authoritative; use a **bounded, local-only, restricted child-process IPC** or other explicitly justified secure bridge; no loopback Relay/HTTP server, public port, arbitrary commands, admin privileges or WSL dependency.
2. Persistent local capture settings: clipboard image source enabled/disabled; submission mode **confirm (default)** or **auto (explicit opt-in)**; one visible **pause/resume** action disabling auto capture/submission (without dropping already persisted tasks); current image preview/confirm/discard; optional explicit `Submit current image`. Preserve pending-image retention rules and deduplication; never begin with an implicit upload of an image that predates user opt-in/app startup.
3. Background watcher lifetime managed by the app. It must not steal keyboard focus after capture; show non-blocking task status, failed/unknown state and actionable retry/copy actions. No auto replay of launched/unknown Codex work. Reject concurrent duplicate workers and document restart behavior.
4. Settings panel for preexisting Local Fake/Codex profile choice/config status, approved workspace shown read-only, and independent result delivery: clipboard `off|manual|smart|always` and safe local save directory on/off; history is always retained. Explain cloud upload on enabling auto and overwrite risk for Always. Smart must preserve newer clipboard content and expose manual Copy on conflicts. Do not mutate persisted, pending tasks' execution profiles via a UI switch. No automatic clipboard *file* payload yet.
5. Preserve current CLI interoperability, user data/SQLite schema and recorded M2-L acceptance. Implement versioned settings migration if necessary, with explicit backup and no silent data deletion. Keep Local completely functional without a Relay URL, running Relay or VPN.
6. Ship an **easy-to-start Windows developer/app build** and exact Windows installation/start/stop steps. Installer or autostart is optional only if core workflow already works and verification stays within the round; do not slip Remote, push notifications, watched-folder source, batch editor, CF_HDROP, plugin ecosystem or production VPS deployment into this slice.

## Important implementation hazards to verify or fix in this round

- M2-L `watch --auto` invokes `observe(true)` on its first iteration and `lastSequence` starts empty. In current code an **existing clipboard image could be submitted on startup**. New M3-L default: establish a safe initial clipboard sequence without submitting anything present before armed startup; later changes are eligible. Add a deliberate explicit Submit Current action. Retain the correct baseline for Smart return.
- The image staging slot in `LocalApp.observe(false)` and eventual confirm must not silently submit replaced/stale content. A paused client must not submit historical clipboard data when resumed by default. State changes must be observable and testable.
- M2-L CLI stores `--auto` on the watcher process rather than persistent settings; UI capture opt-in must survive an intentional app restart without silently turning on for a first-time user; re-arm only after user-session/consent checks. Distinguish launch-on-login from auto-submit.
- Handle unexpected clipboard helper/worker failure without silent stuck-state, unbounded restart loops, duplicate submitted tasks or accidental overwrites. Display explicit failure/recovery states.

## Automatic verification gate (agent owns it)

- Sync newest `origin/main` before any edits: `git fetch origin --prune`; inspect `git status --short --branch`, head and PR #2 merged state; do not lose uncommitted edits. Branch from current merged main.
- Run `corepack pnpm install --frozen-lockfile`, `npm run check` and packaging/build smoke (all OS dependencies available in CI; add Windows job for tray build). Preserve Linux/Windows Node 22/24 checks or give an evidence-backed reason for changed matrix.
- Deterministic Fake E2E through same UI-to-coordinator interface (not just direct `LocalApp` calls): first-run confirmation, opt-in auto, new-image-only startup, pause/resume, duplicate/nonimage, confirmation/discard, external clipboard content preserved by Smart, Always warning, independent save and history-only, restart/persistent settings, app exit/child cleanup, queued persistence, execution_unknown no replay, conflict/no focus APIs. Assert Local never imports/starts Relay or a network listener; synthetic images only.
- Mock Codex argv/version/read-only isolation, process bound/kill, no blind replay, path ownership and output size limits remain covered.
- Have an agent produce a **single runnable Windows build** and exact commands for the human; do not shift build/debugging/fault injection to the operator. No destructive manipulation of their actual clipboard/profile/tasks during test setup.

## Limited interactive Windows gate (only if CI cannot exercise it)

1. Agent supplies actual build path/version/commit, staging config/root outside users' existing Local roots, launch action and how to quit; operator starts app in a logged-in non-elevated Windows 11 desktop.
2. Confirm-mode test: open Notepad with synthetic text `SHOT2AGENT 42`, copy it using Win+Shift+S; GUI should show one pending screenshot and **no queued task** until clicking Submit; discard another screenshot and verify no task.
3. Auto test: enable clipboard-source + auto after explicit risk notice. With Notepad focused, copy a *fresh* synthetic image; observe exactly one queued and completed Fake task in UI **without any CLI submit**; foreground remains Notepad. Startup with a preexisting clipboard image should create no task.
4. Result test: with Smart configured and no subsequent clipboard action, after task succeeds paste result into a blank Notepad page **without clicking Copy**; verify clipboard receipt. Repeat with distinct newer copied text before processing; it must survive, and UI must show blocked-by-change and a manual Copy action. Agent may make Fake execution artificially slow in a staging build to make this check deterministic; never ask the operator to race.
5. File/save and restart: open GUI configured safe output directory; verify `<task-uuid>.md` has result; close/relaunch, settings/history remain; toggling pause means no new submission.
6. Use an authenticated Windows Codex CLI and known synthetic screenshot **only if Code/Agent path changed or prior proof is insufficient**. Agent checks version/login/read-only workspace first. State PASS, FAIL or NOT VERIFIED per observation. Do not treat CI/mock/WSL as interactive Windows proof.
7. Sanitized evidence only: OS/app/Node/Codex versions if applicable, exact build commit, action, expected vs observed, status/error. Never commit screenshots, tokens, credentials, DBs, or full private model results.

## Completion gate and follow-up

Ship a Windows-runnable Local app that permits capture auto + Smart return + file save simultaneously. No need to type submit/copy in the happy path. It should also support intentionally safer confirm/manual modes. Document remaining deliberate V1 work separately (Remote/VPS, mobile notification, folder watch, batch editor, file clipboard, installer/autostart if deferred); **do not expand this milestone across those features**. Mark incomplete/native-unverified features accurately rather than creating indefinite sub-phases.

Update `README.md`, `AGENTS.md`, `docs/ROADMAP.md`, `docs/WINDOWS_ACCEPTANCE.md` with actual implementation and controls only after feature code exists; this file is the source of the next *planned* scope.
