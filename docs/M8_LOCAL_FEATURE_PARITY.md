# M8-L: complete Local feature parity before the first v1.0 milestone

**Status:** M8-L 0.8.0 implementation candidate; native acceptance and final main gates are tracked in [M8_VALIDATION.md](M8_VALIDATION.md). **Baseline:** merged main 005015bce192ba6beffb3330fffc92fc58ed2177 (M7-UX 0.7.2, PRs #14 and #15). Created 2026-10-22. This specification refines, but does not silently replace, the binding Local-first scope in LOCAL_V1_FIRST_MILESTONE.md. M9-L is the packaging/final acceptance gate; Remote/Relay comes only afterward.

## Product outcome and execution order

A non-developer on Windows can configure Local screenshot inputs, combine 2-5 images, receive results through independent local destinations, and manage the whole flow **inside Shot2Agent.exe**. No Shot2Agent CLI, profile JSON, repair script, VPS or extra application is required. Existing users upgrade without losing Agents, Tokens, history, appearance, shortcuts, clipboard consent or exported Markdown.

Aim for **one bounded implementation PR, followed only by a short evidence-driven stabilization fix if needed**. Implement and verify in this order:

1. Independent clipboard/folder sources and shared deduplicated submission.
2. GUI ordered image batches (reuse the existing multi-image core/Agent contracts).
3. File clipboard and optional native notification, retaining independent Markdown/text delivery.
4. Final GUI clarity and focused Windows native acceptance.

Keep current Vue 3/Tauri 2 architecture and Local worker. Do not migrate frameworks or introduce a new server. Keep personal-project checks proportionate: actual data integrity, consent, credential integrity, bounded processes and uncertainty protection matter; additional approval ceremonies and sprawling infrastructure do not.

## P0-A. Independently configurable input sources

- Existing clipboard image capture remains available with confirmation/automatic behavior and pause/resume. Add **Watch screenshot folder** as a separately switchable source, with a native folder picker and a human-readable selected path. Clipboard-only, folder-only, both and neither must all be valid. Neither means paused/history-only ingestion, **not** missing configuration.
- Migrate old M7 settings without changing effective clipboard behavior, existing auto-submit consent or selected Agent. Do not silently enable folder monitoring on upgrade. The user must opt into auto-submission of folder screenshots, with the same explanation that images may be sent to a cloud model. An explicit submission button may still work when watchers are off.
- For the first Local v1 release, watch the selected folder **non-recursively**. Explain this in the UI. Detect PNG/JPEG/WebP regular files, reject symbolic links, unsafe/oversized/unreadable images and temporary/in-progress files with bounded diagnostic status. Do not add recursive directory traversal or a media-import subsystem.
- Establish a startup/recovery baseline: pre-existing files are never sent automatically on first enable, restart, resume or directory switch. A new or replaced file is ingested only after its size/mtime and contents settle across observations. Treat filesystem notifications as hints and use a bounded reconciliation scan to tolerate missed Windows events. No premature read of a partially written screenshot; no busy polling.
- Use a single input/submission pipeline for clipboard, folder and manual composer. Coalesce byte-identical new images arriving from both sources within a documented short dedupe window; one normal event means at most one task. **Explicit manual repeat** must intentionally bypass that dedupe. Preserve original input source in private provenance, not as executable arguments. Never watch an app export/cache/output directory as an input subtree; reject or clearly exclude overlapping paths so output cannot loop back as a new task.
- Keep the existing single-worker queue, immutable chosen Agent/version binding and focus-safe background operation. Watchers must stop cleanly on quit and re-arm without retroactive submissions after configuration changes.

## P0-B. Ordered 2-5 image composer

- GUI actions: Add screenshots from a file picker and/or the current clipboard/preview; show readable thumbnails; move up/down (drag optional), remove, discard, and **Submit N images as one task**. All actions are visible and usable with keyboard, at 1040x760 and 720x560. Provide validation messages in ordinary Chinese.
- The shared contracts already support multi-image submissions (up to 20 overall), and Codex/Claude adapters already iterate their input image lists. Implement one bounded 2-5 item Local GUI flow, not N separate queued tasks. Assign one task ID and submit the ordered image metadata/bytes atomically through the existing core. Preserve ordering through restart, worker claim and immutable input references.
- Reuse per-image verification and optimization. Respect existing <=20 MiB per image and <=60 MiB total wire limits, pixel/dimension limits and Agent input budget; the composer must explain rejected images before creating a partial task. Preview/discard must not create history. While editing, a clipboard or folder watcher may continue operating but cannot mutate the batch or silently switch its selected Agent. Snapshot the selected Agent/version once on Submit.
- Failed submission is atomic and clear; never leave orphan blobs, duplicate history entries or a half-submitted batch. Reordering changes only composition order, not the screenshot bytes.

## P0-C. Truly independent result destinations

- Keep durable history as the always-on fallback. Keep independent Markdown save and existing text clipboard modes **off / manual / Smart / Always** with the original explicit Always overwrite consent and sequence guard.
- Add a clipboard **payload preference: text OR files** for automatic output. These alternatives are exclusive for one automatic write; both **Copy text** and **Copy files** may be offered manually. File clipboard must expose real Windows CF_HDROP/FileDrop paths accepted by Explorer, never paste a path string in place of a file list or steal foreground focus.
- Materialize a verified, app-owned Markdown result as at least one stable file for Copy files. Include only verified supported text artifacts if available; current Agent adapters mostly return Markdown and do not promise arbitrary binary attachments. Never place input screenshots, uncontrolled paths, URLs, raw unverified Worker paths or secrets onto the result file list. Retain generated file paths long enough for Explorer to paste; define bounded cleanup and avoid deleting files still advertised by the clipboard. Do not auto-delete user-exported Markdown.
- File clipboard shares the same native serialized clipboard lock and Smart/Always conflict policy, but is independently selectable from local-save and native notification. A transient delivery failure may be retried within existing explicit bounds; an ambiguous clipboard write/timeout must **not** be automatically repeated. Manual Copy should say whether it copied text or files.
- Add opt-in native Windows **desktop notification** for local task completion, ideally through existing Tauri/Windows APIs. It must not require Relay/push, foreground activation, a Windows installer or a new paid service. If toast registration is unavailable in a portable environment, report an understandable unsupported/failed channel state without failing history, Markdown or clipboard delivery. Do not promise Remote push as part of M8.
- Distinct durable per-channel outcomes (save, clipboard, notification); one channel's failure never prevents other enabled channels. All optional channels off is valid and leaves usable history. Maintain clear separation between **Retry delivery** (retry eligible output channels without calling AI again) and any future **Run AI again** (explicit brand-new task and charges). Do not implement automatic Agent replay, fallback provider orchestration or an unbounded retry framework. The optional explicit rerun control is secondary and may be deferred if it endangers the bounded v1.0 path; record that scope honestly.

## Small M7 usability debt to resolve opportunistically

The GUI calls GLM's synthetic-image **Test connection** optional, yet a newly saved connection currently has vision=not-verified and the worker's assertGatewayVision rejects first actual screenshots until a separate successful test/attestation. This is a de-facto extra paid step, despite Local v1.0's GUI-first/no-unnecessary-gates objective.

Make the policy coherent: keep the known image-capable model allowlist, HTTPS/Token storage and user capture/cloud consent; avoid a mandatory separate paid synthetic test solely to start processing a real explicitly submitted image. **Test connection stays opt-in** and never runs on Save or silently in background. A real request can fail with an actionable explanation rather than an unadvertised qualification ceremony. Carefully migrate existing qualified/queued profiles without changing their immutable task bindings or secrets. If a concrete isolation constraint makes this unsafe, document the specific technical conflict and a minimal alternative rather than adding new modal approval chains. Add deterministic tests for this policy decision; do not send live paid requests as CI.

Do not reopen the M7 visual redesign, rewrite Vue in React, or replace the existing bounded profile/history model simply because it can be refactored.

## Required automated proof (default)

Run frozen install, npm run check (lint, TS/Vue type checks, backend tests, production builds and compiled Fake smoke), npm run desktop:test-ui, Windows desktop packaging, released EXE IPC/quit smoke and existing CI matrix. Extend these tests instead of creating a redundant approval process.

**Source matrix:** clipboard-only/folder-only/both/off; auto/confirm; initial old folder skip; new/partial/replaced/renamed files; restart/pause/re-arm; event duplication/missed event; same-image two-source dedupe and explicit repeat; output-folder feedback prevention; invalid/oversized/symlink refusal. Use temp directories and synthetic PNG/JPEG/WebP; no operator screenshots.

**Batch matrix:** add/reorder/remove/discard; 2 and 5 valid images and 1/6 invalid; ordering verified at fake Worker; one immutable task ID; profile switch during composition; byte/total-size rejection; restart/history preservation; no partial writes or leaked images on validation errors.

**Result matrix:** text/file payload, manual/Smart/Always, explicit overwrite consent, clipboard-changed suppression, success plus busy/timeout/ambiguous write, copied file persists long enough to paste, artifact integrity, Markdown save success/conflict, notification on/off/unsupported, all destinations disabled, separate receipts and retry behavior. Test helper boundaries on Windows with synthetic fixture files. No new execution from delivery retry.

**M7 compatibility:** imported 0.7.2 settings/history/Token references, theme and shortcuts; edited and queued Agent bindings; Agent remove/restore, history delete/cleanup and old credential sharing; first-run without Profile; no live model call on Save. Add real-Vue/controller tests and screenshots at 1040x760, 720x560 and 480x640 with keyboard focus, overflow and readable empty/error states. Windows CI packages a portable ZIP with exact source SHA and checks resource inclusion; tests never use a real Token or paid endpoint.

## Irreducible native acceptance, only after green automation

On a **disposable folder and synthetic images**, using the actual fully extracted Windows ZIP:

1. GUI select a fresh watched folder, leave capture in confirm mode, enable folder-only. Copy an image already there *before* enable (no task expected), then save a new image (exactly one preview expected), confirm and see one Fake task. Briefly test clipboard-only and both to verify source switches; do not use personal screenshot data.
2. Add 2-5 small synthetic images, reorder, submit once, and inspect one task/result and correct order; no model charge in isolated Fake acceptance mode.
3. Produce a Fake Markdown result, choose **Copy files**, paste into Explorer. Expect actual .md file(s), not a text path. Enable native notification if supported; verify notification without focus theft. Verify history-only with all optional delivery channels disabled and a non-destructive restart.

These steps are required **only if** the matching native behavior cannot be exercised automatically. Provide the actual package link, commit, exact clicks, expected result, and explicit unverified boundary. Do not demand manual CLI commands, real GLM Tokens/requests, deleting real history, IME compatibility experiments or broad screenshots of private data. If native Computer Use is unavailable, report that limitation rather than relabeling browser/Fake proof as operator acceptance.

## Exit criteria and next phase

M8-L is ready to close when its agreed functional acceptance is met on merged main with independent green CI and a working Windows portable package. Record any truly native-only observations separately. Proceed immediately to **M9-L: end-user portable packaging, migration/backup ergonomics, final Local v1.0 matrix, simple GUI usage and tag**. Do not insert another infrastructure, security ceremony or Remote/Relay milestone between M8 and the first independent Local release.
