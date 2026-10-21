# M7-UX: Local desktop usability closeout before M8-L

Status: IMPLEMENTED in PR #14; final automated results and Windows evidence in [M7_UX_VALIDATION.md](M7_UX_VALIDATION.md). 2026-10-22. Baseline: M7-L PR #13 squash-merged into main as `7990eda80d46c378cc7d866fff70889fcd559c33`. This is a **small product-quality closeout** before the previously agreed M8-L features; it does not add another infrastructure/security milestone.

## Why now

The reported 2026-10-22 user screenshot shows one long, cramped Windows desktop page: Agent editing above capture/workspace/history; a tiny unstyled prompt textarea; poor visual hierarchy, duplicated Agent selection and configuration management, backend jargon, dense history controls and tiny actions. Code inspection confirms `apps/desktop/src/App.vue` opens the edit form above the current scroll location without navigating/focusing/scrolling, so an edit click lower down can *appear inert*. `apps/desktop/src/style.css` does not apply shared full-width input styling to `textarea`. These are actionable UX defects, not a need to rewrite the processing core.

## Desired ordinary-user model

1. **Home / Process** (default): screenshot preview/submit, a simple selected Agent name and **Change** control, clear capture pause/status, recent activity and immediate result Copy/Open. Show only 3-5 recent tasks and **View all history**. Never require users to learn Profile versions, worker, approval, attestation or delivery receipts.
2. **Agents** (single management place): list configured Codex, Claude and GLM connections; one clearly marked default Agent; **Add / Edit / Set default / Remove**. Edit opens a visible dialog or route with appropriate title, scroll position and focus. Changing the default affects future tasks only, with that detail in secondary help. Remove normally means hide from selection; explain as **Remove Agent**, preserving existing task history. Hard deletion of unused version/credential belongs under an explicitly named Advanced cleanup control, never the main operation. No duplicate top-level `New task Agent` + `Manage Agent config and Token` sections.
3. **History**: searchable/scrollable list if easy; at minimum readable date, provider, status, summary and Copy/Details/Delete. Batch-select and Clear History in a compact secondary toolbar/menu. Clear options must say precisely what they remove and that exported Markdown is untouched. For uncertain old execution, show an explanatory confirmation and a button only when backend allows; do not silently rerun.
4. **Settings**: human labels for capture (confirm or auto-submit), output options (Copy result / Save Markdown / notify in later M8), hotkeys and executable detection. Collapse technical CLI path, digest, version, gateway endpoint, workspace, retries, credential states and diagnostic details under **Advanced** (still accessible when needed).

## Concrete UX fixes (P0)

- App must use a coherent design system: consistent 8px grid and spacing, aligned labels/forms/buttons, responsive 720x560 and 1040x760, visible primary action, appropriately sized textarea (minimum 100% width), readable hierarchy, compact modern cards, empty/loading/error/success states, accessible keyboard focus and contrast.
- Editor must be **unmissable and functional** for **every** Agent type, including Codex without a token. Use explicit `Edit Agent` and only GLM-specific `Update Token` where applicable; choose dialog or subview rather than append a distant inline form. Start edit prefilled with correct ID/provider/path/prompt/workspace; no unintended regression of immutable versioning. Cancel returns unchanged.
- Use ordinary labels: `使用已检测到的 Codex/Claude` instead of `使用当前已批准的 CLI 安装`; `用于接下来截图的 Agent` or just `当前 Agent` instead of `新任务 Agent`; `移除 Agent` instead of `从新任务列表移除`. Explain CLI path only in Advanced: the program installed on this PC, found automatically, and manually selectable if missing. Do **not** turn internal approvals into a user-facing onboarding ceremony.
- Offer 1-click/one-page guided first run: choose available provider, select login or GLM Token, optional workspace, use sensible prompt/output defaults, finish and start capture with clear confirm/auto semantics. No Shot2Agent CLI/JSON editing or arbitrary model request on save; GLM synthetic paid diagnosis is a separately explained **optional Test connection** control; distinguish local token stored from model-vision confirmation. Preserve real read-only/credential restrictions in backend.
- Fix workflow confusion: selected Agent change and Agent management must be visually one concept; no buttons that appear to do nothing or open outside viewport. Use inline explanatory help only where needed; copy action should show result.
- Prefer improving current Tauri 2 + Vue 3 app: **do not migrate to React merely for aesthetics**. React is an option only with demonstrated functionality/build/test benefit and no schedule regression; avoid a framework rewrite in this bounded round. A compact component split and small reusable UI primitives is encouraged. No unnecessary full UI framework unless it saves work demonstrably.

## Scope boundaries

Keep Local-first architecture, no Relay/VPS, one Worker, screenshots processed via approved Codex or Claude/GLM, historical task/profile bindings, Windows Credential Manager token storage, clipboard consent, independent delivery and delete safety. No fresh policy gate or mandatory real paid-model testing for a cosmetic-only change. Do not regress the M7 functioning user's native GLM setup; no tests may touch their real data/token/history. No auto Agent reruns or silent switching.

M8-L folder watch, batch, clipboard files and desktop notifications follow **after** this focused M7-UX pass; M9-L packaging/v1.0 acceptance stays the first release milestone. If fixes are small, finish in one PR and roll right into M8-L. Avoid issue proliferation.

## Automated checks and operator boundary

1. First sync `origin/main` without discarding changes, inspect status, existing PRs, baseline and latest docs.
2. Run frozen install and `npm run check`. Exercise fake/fixture desktop RPC for Add/Edit/Save/Cancel/Switch/Remove/Restore/Codex/Claude/GLM cases and credential errors. Test old history delete paths and no task/profile/credential mutation from rendering or cancel.
3. Add UI-level tests or scripted browser screenshots at 1040x760, 720x560 and a narrower compact size. Check no horizontal overflow, no cut-off controls, textarea sizing, editor opens visibly at any scroll position, accessible focus, default Agent identity, history empty/populated states, mode settings and feedback for successful/failed operations. Inspect screenshots rather than only trusting snapshot tests. No real GLM network request.
4. Build Windows desktop and packaged ZIP; run existing CI/EXE smoke. Give the operator exact package link/SHA and **only if unavoidable** a short native Windows UI checklist: fresh disposable root with Fake, then non-destructive existing real Agent view. Each step must specify click, expected visible effect and what is not verified. Never request actual Token, paid request or deletion of their history.
5. PR report: source SHA, files changed, tests run with exit codes, screenshots/evidence paths, known limits. Do not mark manual acceptance as completed without the user's report.
