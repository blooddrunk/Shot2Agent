---
name: Shot2Agent Local Desktop
description: A restrained Windows utility for local screenshot intake and durable results.
colors:
  accent: "#246348"
  accent-hover: "#174c35"
  surface: "#fff"
  canvas: "#f5f7f5"
  text: "#24332e"
  heading: "#20392c"
  button-text: "#243b2d"
  muted: "#596c61"
  border: "#d3ddd6"
  control-border: "#a5b7ac"
  field-border: "#9bad9f"
  hover: "#edf3ee"
  focus: "#368763"
  empty: "#eaf0eb"
  consent: "#fff5df"
  consent-text: "#654817"
  error: "#fff0ed"
  error-text: "#8e2f27"
  notice: "#e6f1e8"
  notice-text: "#365c42"
  status-idle: "#7b807d"
  status-active: "#287549"
typography:
  title:
    fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "23px"
    fontWeight: 650
    lineHeight: 1.2
  heading:
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.3
  body:
    fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    lineHeight: 1.5
  label:
    fontSize: "12px"
  result:
    fontFamily: "Consolas, monospace"
    fontSize: "13px"
    lineHeight: 1.6
rounded:
  field: "4px"
  button: "5px"
  panel: "6px"
spacing:
  small: "8px"
  medium: "12px"
  panel: "16px"
  compact-inset: "18px"
  page-inset: "28px"
  column-gap: "30px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.button}"
    padding: "7px 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.button-text}"
    rounded: "{rounded.button}"
    padding: "7px 12px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: "8px"
  preview:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "16px"
---

# Design System: Shot2Agent Local Desktop

## Overview

**Creative North Star: "The Windows Utility"**

A familiar Windows operation surface: restrained white and green, compact controls, clear status and readable history. The interface gives screenshot intake and independent result delivery a calm, practical home. This document records the implemented Tauri/Vue surface; `src/style.css` and `src/App.vue` remain its implementation sources.

**Key Characteristics:**
- White surfaces on a softly tinted canvas.
- System typography with Chinese fallbacks.
- Explicit controls, textual feedback and modest density.

## Colors

The primary accent marks the identity, primary actions, checked controls and active capture. Neutral green-gray text and borders structure the surface. Amber indicates consent, red indicates errors, and pale green carries operation notices. These are semantic roles rather than decorative accents.

**The Textual Status Rule.** Pair the capture dot with status text; preserve separate task, clipboard and save receipts so color never carries the complete meaning.

## Typography

Use the body system stack throughout forms and task history. Product identity uses the title role; section headings use the heading role. Supporting explanations and receipts use the label size. Result Markdown is displayed as wrapping monospace text, with its own scroll area. Task identifiers and counts use tabular numerals; paths and long identifiers wrap anywhere.

## Layout

The native window opens at 1040 × 760 with a minimum of 720 × 560. A full-width white header places identity left and window actions right. The main container is centered, capped at 1400px, with page insets and a status row above two columns. The left settings column is 290px, followed by a 30px gap and flexible preview/history workspace. A thin divider separates controls from work.

At viewport widths at or below 800px, page/header insets become 18px, the settings column becomes 250px, the gap becomes 20px and the control divider inset becomes 18px. Section headings may wrap; preview image and actions stack vertically. This remains a two-column desktop interface, not a mobile layout. The page scrolls as content grows; result text has a separate maximum height of 380px.

## Elevation & Depth

There are no shadows, gradients or animated transitions in the implemented stylesheet. White panels, tinted messages, whitespace and thin dividers provide depth. Empty, preview and result areas use restrained tonal separation rather than floating cards.

## Shapes

Fields and notices use small corners, buttons slightly softer corners, and preview/result panels the panel radius. Controls have thin visible borders; history is a flat list divided by horizontal rules. Capture status uses a small circular dot. Checkboxes remain native controls sized to 17px.

## Components

- **Buttons:** Compact sentence-case actions. Primary buttons fill with accent; secondary buttons use a white fill and visible border. Hover darkens primary fill or tints secondary fill and strengthens its border. Keyboard focus uses a 3px green outline with 3px offset on buttons, fields, selects and disclosure summaries. Disabled buttons use half opacity and a wait cursor. No separate pressed animation exists.
- **Fields:** Full-width native selects and text inputs, with labels above, consistent padding, visible borders, accent caret/check states and the shared focus outline. Auto-submit and Always consent controls appear only for their associated choice. Save-directory input appears when Markdown saving is enabled.
- **Settings:** Changes remain visibly unsaved until the operator applies them. Busy state disables applicable actions and changes the apply label. Worker profile metadata is read-only; its local path disclosure uses the browser's native summary control.
- **Status and notices:** Capture status precedes workspace content. Operation notices use status semantics; errors use alert semantics and actionable text. Capture pause/resume stays accessible in the status row.
- **Preview:** A white horizontal image/action panel; the image occupies 45% width and fits within 210px height. At the compact breakpoint it fills the panel width. Submit and discard are explicit; the empty state explains the Windows screenshot shortcut.
- **History and result:** A flat task list displays status and independent delivery receipts. The whole task title opens details. Copy/retry-delivery actions appear for succeeded tasks. Detail text preserves wrapping; it does not introduce a rendered Markdown editor.

**The Explicit Intake Rule.** Keep automatic capture opt-in and consent visible; existing clipboard images are not submitted at startup, resume or applying settings. Manual submission remains an explicit action.

## Do's and Don'ts

### Do:
- **Do** retain visible keyboard focus, readable labels and textual operation feedback.
- **Do** preserve independent clipboard and Markdown controls alongside durable history.
- **Do** check layout at the minimum native window size and with long paths and task errors.

### Don't:
- **Don't** add decorative shadows, motion or a competing accent to this documented surface without revisiting its design direction.
- **Don't** turn read-only Worker metadata into execution configuration controls.
- **Don't** treat browser rendering or build checks as acceptance of Windows tray behavior, focus safety, clipboard paste or actual Codex authentication; those require observed native checks in `../../docs/WINDOWS_ACCEPTANCE.md` and `../../docs/M3_WINDOWS_RUN.md`.
