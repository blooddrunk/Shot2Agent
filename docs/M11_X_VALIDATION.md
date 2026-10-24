# M11-X validation and limited native acceptance

Baseline `83a88bc2a80c8b4c03cd93bba540dafd57850bc1`; implementation branch `codex/m11-native-capture-typing`. No release/tag changes, no operator history or Tokens, no paid model requests. Exact committed SHA and CI artifacts are recorded in PR handoff after execution.

## Executed development checks

- `corepack pnpm install --frozen-lockfile` (`CI=true`): exit 0, pnpm 10.19.0, lockfile unchanged.
- First full `npm run check`: exit 0; 271 tests, 268 PASS, 3 SKIPPED, 0 FAIL. Includes 9 new controller/publication tests; TS/Vue, lint, build and compiled Local/Gateway synthetic smoke pass. Later edits require final rerun.
- Isolated native-module probe, `cargo check --target x86_64-pc-windows-gnu`: exit 0 for capture/typing against the same windows 0.62 dependency. This is type-check evidence, not a Windows execution/build claim.
- Isolated Linux native-module `cargo test`: exit 0, 3/3 PNG/Unicode/order/focus/cancel/failure tests. Full Windows Rust tests/package gates remain pending until CI runs.
- First targeted Vue run: 3 FAIL; the native test fixture dropped its ephemeral state on refresh, and the locator assumed a region role while the progress UI uses status. Corrected fixture persistence/locator; final rerun pending.

Windows/Linux Node matrix, full Vue, Windows Rust fmt/tests/build, complete ZIP/manifest and extracted EXE IPC/quit/helper checks, and Linux Docker Relay regression must all run on the final source. An unexecuted gate is NOT VERIFIED. CI is linked in the PR, and hosted clipboard/API checks are not physical paste/typing evidence.

## Small physical Windows procedure — currently NOT VERIFIED

Use only the complete candidate ZIP from successful Windows CI, verify its BUILD/MANIFEST SHA. Full extraction, then `Start acceptance.cmd` opens a fresh disposable Fake root; never add a real Agent. Use a new empty temporary PNG output directory. Fake does not call models. The staging app initially contains one unrelated synthetic preview; discard it before A. Clipboard result delivery = manual; save/notifications off. All data below is synthetic.

### A. Monitor screenshot / file-only / one task

1. Put synthetic content on the chosen monitor (e.g. Notepad displaying `M11 capture 中文 123`); copy `M11 clipboard sentinel` to clipboard. Settings → 原生截图与直接输入: refresh displays, select the intended one, choose temporary directory, enable only PNG save. Save settings. Under shortcuts set 截取所选显示器 to an unused Ctrl+Alt+S, save, hide window.
2. Press shortcut once. Inspect one complete PNG in Explorer and open it. PASS: correct monitor/content, actual monitor pixel dimensions including a 4K or mixed-DPI monitor if available, no partial PNG; paste sentinel into a second Notepad and confirm unchanged. Record display layout/scaling, filename/dimensions, observed text and candidate SHA. Clipboard byte/sequence preservation additionally uses the automated native API gate where available; visual paste alone does not prove all formats.
3. In settings enable watching that same screenshot directory, leave submission in confirmation mode, enable “同时交给所选 Agent”. Capture: PASS = one preview and zero task before clicking 提交图片; after click one task/result. Repeat with explicit auto-consent/auto mode: PASS = one task per new synthetic screen, no second watched-file task. Paused capture must refuse. Repeat shortcut while capture busy must not overlap. Do not interpret byte-identical screenshots inside the existing dedupe window as separate tasks.
4. Record missing monitor/DPI/permission cases as NOT VERIFIED. Restore manual/confirm and pause as needed; exit from tray and remove only the disposable root/output directory. Exported files are not removed by app history cleanup.

### B. Direct typing without copy

1. With the same Fake root and manual clipboard delivery, submit a synthetic PNG and wait for its Fake result. Fake output must contain synthetic mixed text; the packaged staging fixture includes Chinese, ASCII, symbols, multiline Markdown, code fences and supplementary-plane characters. Copy sentinel to clipboard using Notepad, then leave target Notepad open and unelevated.
2. From history click 输入此结果 and, within the configured preparation interval, switch to Notepad and click its empty text area. PASS: expected mixed text/line breaks, no extra Agent attempt/history row, sentinel still pastes in another empty document. Test 输入最新结果 via configured shortcut while Notepad already has focus: no app activation, correct latest result. These are physical target-text observations; status “已发送” alone does not prove rendering.
3. At low speed start again; press Esc partway. Then start again and change focus to another window. PASS: remaining characters stop, already entered text is retained, second target does not receive continued output. “停止输入” and tray exit also terminate. Injection failure must show an error, never replay/paste or claim verified text. No privilege elevation; administrator/protected targets and applications ignoring Unicode remain limitations.
4. Record final text, stop behavior, clipboard sentinel, task/attempt count, SHA and any failures. Clear synthetic documents, exit staging app, remove its disposable data only. Other target apps/IME combinations remain NOT VERIFIED unless actually observed.

### C. Remote regression, only the remaining M10 physical gaps

The prior [M10 minimal three-row checklist](REMOTE_GUIDE.md#最小真实设备验收) remains the bounded procedure for actual A/B Windows + VPS/HTTPS, outbox restart and Explorer file return. Repeat only previously unverified or changed paths, using temporary device Tokens and Fake. This milestone does not qualify actual cross-network operation merely by preserving passing Relay regression tests. Unchanged already accepted Local checks are not repeated.

## Release assessment

Development candidate only. No formal v1.1.0 publication from these automated results. Physical A/B and remaining M10 C observations are NOT VERIFIED until an operator actually records them. Region selection overlay and M12-V Linux Worker are deferred; [bounded next plan](M12_V_PLAN.md).
