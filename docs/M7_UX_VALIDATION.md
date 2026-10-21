# M7-UX validation and Windows handoff

M7-UX implements the usability closeout after M7-L PR #13 (`7990eda`) and closeout plan (`77946a6`). This is a bounded Local UI change, not Local v1.0 or M8 feature completion.

## Implemented

- Home / AI assistants / History / Settings navigation. Home contains the current assistant, screenshot preview, capture controls and three recent tasks. Layout follows the operator's reference with a compact dark Windows utility surface.
- Shared control styling, readable textarea/password inputs, wrapped paths, visible focus, error/status feedback, scrollable native editor dialog, Escape/cancel and focus restoration. Codex never exposes Token actions.
- One assistant model: Add, Edit configuration, Set default, Remove, Restore; GLM alone exposes Change Token and Test connection. Advanced cleanup preserves referenced configurations and credentials. Editing a non-default assistant preserves the default.
- Local GLM credential save makes **zero model requests**. Separate Test connection explains potential charges and sends one synthetic image only after confirmation. New Token/model/endpoint resets vision to `not-verified`; unchanged previously qualified connections retain qualification. Testing publishes a new immutable version; queued/running/history bindings remain unchanged. Worker still refuses unqualified vision. No failover or replay.
- Paged history with search across all stored records (50 metadata entries per IPC response), details, Copy, individual/batch deletion and safe clearing, separate delivery receipts and uncertain execution explanation. Exported Markdown remains untouched.

## Reproducible automated checks

```
pnpm install --frozen-lockfile
npm run check
pnpm exec playwright install chromium
npm run desktop:test-ui
```

Browser tests render the actual Vue app. Tauri's invoke transport is replaced only at the browser boundary with an exposed binding to a real isolated DesktopController. Synthetic executable fixtures, in-memory credentials and Fake task execution run in disposable roots. All model requests are mocked; no real GLM, Codex or Claude model/authentication request is made.

Coverage: add Codex/Claude/GLM, prefilled program/workspace/prompt/model/endpoint, no Token readback, cancel without mutation, editor focus/Escape, select/remove/restore, local-only save, optional connection-test cancellation/error/success, old task version binding, Copy/details/search/delete/batch/clear, records older than the newest 50, capture consent/settings, empty and preview states. Backend tests independently cover secure-store failure, wrong Token, qualification reset/preservation and immutable queued tasks.

Screenshots: `build/ui-evidence/` contains Home, assistants, history, settings and editor at **1040×760**, **720×560**, **480×640**, plus first-use, GLM editor and synthetic preview. Layout tests assert no horizontal page/dialog overflow and focused visible editor/textarea. CI uploads screenshots, HTML report, failure traces in **M7-UX-browser-evidence**. The 480px layout is defensive; native window minimum remains 720×560.

Executed locally (Linux / Node 24.19.0, exit 0): frozen install; lint, TypeScript/Vue typechecks, production builds, compiled isolated Fake smoke; **198 backend tests: 173 pass, 25 explicit platform skips, zero failures**; **8 browser interaction/layout tests pass**, including refreshed captures from a newly started Vite server. Final stabilization adds bounded history pagination/search and rejects duplicate assistant names that could otherwise hide a selected configuration. Initial browser ESLint environment errors were corrected; no failing checks are waived. Design detector reported only advisory undocumented color/type/radius values; visual review checked all three widths, populated/empty history, editor, GLM form and synthetic preview. Design documentation was updated in-thread to match implementation.

Windows build/package/EXE smoke runs in the existing Windows workflow. Final run/package identity is provided in PR #14; each ZIP embeds its exact source SHA in BUILD.txt. This repository note does not pre-claim a final Windows run before it completes.

## Windows operator observations (only native differences)

Use the ZIP attached to this PR's successful **Windows desktop package** run; extract the entire ZIP to a writable directory. `BUILD.txt` identifies the exact source SHA; do not mix EXE/runtime files from different ZIPs. WebView2 remains required. No Node/pnpm/Git installation is needed on the target PC.

1. Open **Start acceptance.cmd** from the extracted ZIP (isolated Fake data; does not use real history). Click **AI 助手**, **设置**, **历史记录**, **首页**. Expect the selected navigation item and page to change; no cut-off controls at 720×560.
2. In Settings choose confirmation capture, manual clipboard return, enable new-image capture and apply. Take a disposable screenshot with **Win+Shift+S**. Expect preview on Home; Discard removes it without a task; take another and Submit creates one Fake task. Expect a result; Copy then paste into Notepad. This checks native WebView focus/clipboard interaction only, not real AI.
3. Open the normal **Shot2Agent.exe**, inspect the existing assistant, click Edit configuration. Expect a visible titled dialog, existing values, empty masked Token field for GLM, no Token control for Codex. Press Escape. Expect unchanged configuration. Do not replace Token, click Test connection, delete real history or submit personal screenshots for this observation.

Browser/controller evidence is not Windows tray/focus/paste proof, actual CLI authentication, live GLM vision, universal IME compatibility or paid endpoint availability. Existing operator evidence remains scoped; Smart conflicts are not claimed fixed.

## Next bounded milestone

M8-L remains a separate implementation: independently configurable folder/clipboard capture with startup skipping and dedupe; a small ordered 2–5 image composer; independent file clipboard/Markdown/desktop notification delivery; explicit new-task rerun semantics. Do not start those features as part of this PR. M9 packaging/v1 acceptance and Remote remain later.


## Operator acceptance and UI follow-up — 2026-10-22

The operator reports **all basic functions PASS** for the M7-UX delivery, and requests only five UI refinements: quick-action button spacing, no redundant history checkbox text, live sidebar capture/Worker status, understandable/spaced old-configuration cleanup, and a persisted light/dark appearance switch. This is an operator report, not an inference that every provider/authentication, Smart/IME or interruption scenario was independently retested.

Version 0.7.2 implements these five refinements. Appearance is a validated local WebView preference, applied before Vue mounts and independent from Worker settings, task history or credentials. Existing dark appearance stays the default. Storage refusal leaves the theme usable with visible persistence feedback. Runtime activity counts come from all stored tasks, so a filtered/paged history view cannot falsely indicate an idle Worker. Paused capture and ongoing processing are shown separately.

Added browser coverage exercises theme changes/reload/storage failure without Worker reconfiguration, actual queued/running/paused Fake states, checkbox accessible names, measured action/cleanup spacing, and dark/light settings/editor/history at 1040×760, 720×560 and 480×640. Follow-up execution results and final Windows package are recorded in the follow-up PR. No new native or live-model claim is made from browser tests.

### GLM optional connection-test packaging fix

The operator reports that a working Claude Code / glm-5.3-flash assistant fails almost immediately on optional Test connection. Offline reproduction against the prior 0.7.1 Windows ZIP confirms `ENOENT` loading the default synthetic image, **before the supplied mock sender was called (0 requests)**. The compiled helper resolves `dist/scripts/fixtures/glm-vision.png`, but the build copied only PowerShell helpers, omitting that image. The generic error hid the local preparation failure. This reproduces the package defect; it is not a retrospective network receipt for the operator's individual click.

Build now copies the resource to the module-relative compiled path. Missing/unreadable images report `GATEWAY_SYNTHETIC_IMAGE_UNAVAILABLE` with an explicit no-request explanation. The selected working configuration is preserved on failure. `scripts/gateway-test-smoke.mjs` exercises the actual compiled or packaged module with an injected mock sender, verifies the PNG/image block and marker, then tests a disposable broken-layout copy for zero-send refusal. It runs in `npm run smoke` and the Windows packaged workflow; no real Token or endpoint request is used. Live endpoint availability remains separate.
