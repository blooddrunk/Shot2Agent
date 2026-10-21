# M6-L Windows Local controls and acceptance (0.6.0)

Use a current CI ZIP, extract fully, and check `BUILD.txt` commit before running. No installer or Relay. Close the old app through **Quit Shot2Agent** before replacing its package. Existing histories and approved Profiles remain; no automatic task rerun. These instructions are prospective until an observation is recorded in M6_VALIDATION.md.

## Global actions with Fake (no model cost)

Prerequisites: Windows 11 interactive desktop, WebView2, current ZIP. Open `Start acceptance.cmd` (Fake, `%LOCALAPPDATA%\Shot2Agent-M3-Acceptance`, independent of formal history). If that staging root already contains operator test history, preserve it; use the packaged `--staging --smoke` for automatic disposable-root checks first. Do not delete formal roots.

1. Expand **全局快捷键与操作**. All bindings initially disabled. Assign **暂停 / 恢复捕获** `Ctrl+Alt+P`, **复制最新成功结果** `Ctrl+Alt+C`, **重试最新失败投递** `Ctrl+Alt+R`, optionally **循环切换已批准 Agent** `Ctrl+Alt+A`, **提交当前剪贴板图片** `Ctrl+Alt+S`. Click **保存快捷键**. `registered` means registered; unavailable keys return `HOTKEY_CONFLICT_OLD_BINDINGS_RETAINED`. Only Ctrl+Alt, Ctrl+Shift or Alt+Shift plus uppercase letter/digit are supported. Clear one field to disable it; **全部停用** disables every binding. Bindings are stored only after native registration succeeds.
2. Select manual clipboard, confirmation capture and apply. In Notepad type `SHOT2AGENT 42`, capture only that text using `Win+Shift+S`. Submit once, wait for succeeded. Keep a newer task queued/running if convenient. Click **隐藏到托盘**, click Notepad and press `Ctrl+Alt+C`. Paste once with `Ctrl+V`. Expected: the latest *completed successful* Markdown, no running/failed result selected, and Notepad remains foreground. Record actual paste and focus; a receipt alone does not prove either.
3. With Notepad foreground press `Ctrl+Alt+P`, inspect tray tooltip or show window: paused. Press again: resumed; the old clipboard image must not create a new task. Optional explicit-submit shortcut may submit the current image even when automatic capture is disabled/paused, exactly like **提交当前剪贴板图片**. This is an explicit action, not watcher resume. Dedupe still applies; status reports `DUPLICATE_IMAGE`/`NO_CURRENT_IMAGE` when applicable.
4. Press retry shortcut when there is no eligible failed delivery: `NO_ELIGIBLE_FAILED_DELIVERY`, no Agent call. For a failed save with a completed Fake result, repair only its output-directory condition then press retry. The failed enabled channel retries; succeeded channels and interrupted/ambiguous/conflict-protected channels are skipped. Task ID and execution attempt count remain unchanged. Full failure injection is automated; do not damage personal output files to produce this case.
5. Close/reopen staging app: configured bindings persist. To check exit cleanup, quit from tray, then register the same bindings in a second staging app: they must become available. Automated native tests additionally register the same binding in two independent threads, check conflict, release it and re-register it. Do not run two Workers against one root.
6. Duplicate two fields to the same chord or enter `Win+L`: save refused, previous configuration remains. For an actual OS conflict, reserve a test binding in another application you control; assigning it here must refuse. Restore the other app afterward. If something fails, use **全部停用**, then tray Quit and reopen; do not reset history/settings files.

Agent cycling needs an already approved registry with >1 Profile. Fake-only staging correctly reports `NO_OTHER_APPROVED_AGENT`. To observe native selection without a model call, use an already approved registry only when its queue is empty and capture is disabled; press the cycle shortcut and inspect the selected provider/version. Do not submit another image for this check. Queued/running binding invariance is covered by automated Mock tests; do not create real queued tasks or enable paid workers to repeat that test without cost authorization.

## Gateway credentials and approval (no model request)

Gateway authentication is separate from personal Pro/Max Claude. Supported pinned URLs are domestic `https://open.bigmodel.cn/api/anthropic` and international `https://api.z.ai/api/anthropic`; keys/regions are not interchangeable. No query strings, URL credentials, arbitrary hosts, ports, HTTP or TLS-disable flags. Model IDs and all three aliases are pinned into the Profile fingerprint. Existing subscription checks remain unchanged.

Prerequisites: stopped app/Worker, existing approved Codex root, approved native Claude 2.1.305/2.1.306, personal operator-controlled gateway account, Windows Credential Manager available. Configuration commands do not request the model. Run PowerShell in the extracted package:

```powershell
$root = Join-Path $env:LOCALAPPDATA 'Shot2Agent-Codex'
$cli = Join-Path $PWD 'runtime\dist\apps\cli\src\mvp.js'
$node = Join-Path $PWD 'runtime\node.exe'
& $node $cli credential-add --root $root
# A hidden prompt collects the token. Copy ONLY the returned Shot2Agent-Gateway-UUID reference.
$ref = 'Shot2Agent-Gateway-REPLACE_WITH_RETURNED_UUID'
$claude = 'C:\Users\YOUR_NAME\.local\bin\claude.exe' # exact discovered path
& $node $cli approve-gateway --root $root --path $claude --endpoint 'https://open.bigmodel.cn/api/anthropic' --model 'glm-4.6v' --credential-ref $ref
```

No token argument/environment assignment is needed. Token is stored by Windows Credential Manager (generic credential, local machine persistence within the current Windows user). Settings/DB keep only a reference, endpoint, model and fingerprint. No plaintext fallback. Existing reference replacement refuses; add a new reference and approve a new immutable Profile to rotate. Old queued Profiles retain the old reference. A stopped-Worker settings backup is retained. Credential deletion affects all Profiles referencing it and requires the explicit command:

```powershell
& $node $cli credential-delete --root $root --credential-ref $ref --confirm-delete
```

Only delete a reference you created for this test after checking queued tasks. Deletion makes affected Profiles refuse; it does not select another Agent. Recover by creating a NEW reference/Profile, never by overwriting history. Re-select the original approved Codex/subscription Profile for future tasks if desired.

UI shows gateway provider/endpoint/model, `bound_os_reference` (binding only; availability is checked at execution), and vision `not-verified`. Default tasks refuse `GATEWAY_VISION_NOT_VERIFIED` **before credential/model launch**. Known non-vision GLM model names refuse `GATEWAY_MODEL_VISION_UNSUPPORTED`; other CLI versions refuse rather than switch Agent. Auth/endpoint/transport failures have safe codes and original gateway provenance; launched uncertainty never auto-replays.

## No-cost native transport probe

```powershell
& $node '.\Verify Gateway transport.mjs' $claude
```

Uses an empty disposable config, synthetic credential, local loopback Mock API and synthetic PNG; it never reads existing authentication. Expected exit 0: `imageSeen`, `modelSeen`, `authSeen`, `transportMarker` true, `calls:1`, `secretOnDisk:false`. It tests native CLI flags, typed image transport, exact model routing and token authentication. The returned marker comes from the fixture, **not OCR**. This loopback probe does not prove real HTTPS endpoint auth, certificate/redirect behavior, model availability or vision.

## Real model gate — NOT VERIFIED until separately authorized and observed

No paid request was authorized in implementation. Do not infer image support from a working text CLI or a Mock. [Official GLM-4.6V documentation](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v) describes vision, but this does not establish availability on a particular Anthropic-compatible endpoint or coding-plan key. [Official Claude configuration](https://docs.bigmodel.cn/cn/coding-plan/tool/claude) documents gateway setup/model aliases; coding defaults must not be assumed image-capable.

Only after the operator confirms their exact endpoint/model/credential supports direct images under these restrictions (including acceptable TLS/redirect behavior), and explicitly authorizes one synthetic paid task, re-run `approve-gateway` with the SAME explicit parameters plus `--attest-vision`. This creates a NEW Profile/version; it records an **operator attestation**, not software verification. No task input or UI can grant it. A trusted operator owns stopped-app Profile configuration. Missing evidence: keep default refusal. Do not enable MCP vision servers or tools to work around it.

Then open the app, choose this new Profile, keep capture disabled/manual clipboard and use a new empty output folder. In Notepad type `SHOT2AGENT 42`, take a screenshot containing only that text, click **提交当前剪贴板图片** once. Expected: one execution attempt, gateway provider + approved Profile version, succeeded, Markdown recognizes the marker. Record safe endpoint host, model/CLI version, status/error code, recognized marker and attempt count; never token, real screenshot or account output. Authentication, noninteractive completion, typed-image transport, model vision capability and marker recognition are **five separate checks**. Actual API request count cannot be inferred from one Worker attempt; CLI-internal HTTP behavior needs provider-side safe usage evidence. Stop on failure/unknown; no automatic rerun/fallback. If direct vision/redirect isolation cannot be qualified, leave the Profile at `not-verified` and retain safe refusal.

Interactive hotkey delivery, hidden-window focus, actual clipboard paste, native tray menu UX and real endpoint/GLM recognition remain NOT VERIFIED until their own observations. Existing Smart conflicts remain unresolved, including after input-method sync was disabled.
