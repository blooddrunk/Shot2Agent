---
name: Shot2Agent Local Desktop
description: Compact Windows screenshot processing, following the operator's dark sidebar reference.
colors:
  accent: "#93d6ad"
  accent-hover: "#b1e6c5"
  light-accent: "#246348"
  light-canvas: "#f4f6f4"
  light-text: "#24332b"
  light-surface: "#ffffff"
  light-muted: "#52645a"
  canvas: "#121512"
  surface: "#1c221e"
  sidebar: "#171c18"
  field: "#151a16"
  text: "#ecefec"
  muted: "#aab8ad"
  border: "#343d36"
  field-border: "#526057"
  notice: "#24372b"
  notice-text: "#bfdfc9"
  error: "#452721"
  error-text: "#ffcdc4"
  consent: "#3a3020"
  consent-text: "#f2d39d"
typography:
  body:
    fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    lineHeight: 1.5
  title:
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.3
  heading:
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
  label:
    fontSize: "12px"
  result:
    fontFamily: "Consolas, monospace"
    fontSize: "13px"
    lineHeight: 1.7
rounded:
  field: "5px"
  button: "6px"
  preview: "10px"
  dialog: "12px"
spacing:
  small: "8px"
  medium: "16px"
  section: "24px"
  page: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#102018"
    rounded: "{rounded.button}"
    padding: "7px 12px"
  field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: "8px 10px"
---

# Design System: Shot2Agent Local Desktop

## Overview

A compact Windows utility in Operate mode. The operator's reference establishes a dark sidebar, quiet green accent, central screenshot surface and concise recent results. Product behavior remains grounded in `docs/PRODUCT.md`; this file describes the implemented M7-UX Vue surface.

## Colors

Light and dark appearances share semantic CSS custom properties. Dark stays the default; the operator can switch in Settings or the sidebar and the local appearance preference survives reopening. All surfaces, modal headers, fields, selection, native control color-scheme, focus, feedback and scrollbars switch together. Light uses a pale green canvas, white surfaces and dark green text/actions.

Accent identifies the primary action and active navigation. Dark neutral green surfaces distinguish navigation, work area and fields. Error, consent and success messages use separate readable text/background pairs. **The Textual Status Rule:** always pair status color with words; task state, clipboard and file-save receipts remain independent.

## Typography

Windows system typography with Chinese fallback, compact page titles and short supporting text. Paths wrap anywhere. Results alone use monospace with preserved line breaks. Task dates and identifiers use tabular numerals. No external fonts or decorative imagery are required.

## Layout

Four navigation destinations: Home, AI assistants, History and Settings. A sticky sidebar (176px) accompanies a fluid content area capped at 1100px. At 800px the sidebar becomes 140px and page inset 20px. Below 560px navigation becomes a top row and preview stacks vertically. Native window remains 1040×760 with a 720×560 minimum; 480px rendering is defensive browser coverage. Page content scrolls normally. Home displays at most three recent tasks; full history and destructive controls have their own page.

## Elevation & Depth

Flat surfaces and borders carry normal structure. Native modal backdrop dims the rest of the application for protected configuration editing and results. No decorative animation or gradients. The result dialog alone uses a soft downward shadow.

## Shapes

Small consistent field/button corners, moderately rounded screenshot surface and dialog. Assistant and history entries use dividers rather than nested cards. Native checkboxes retain familiar Windows semantics.

## Components

Quick actions form one wrapping group with an 8px gap. Advanced cleanup has a separate action row with 20px top spacing after version entries. History checkboxes retain task-specific accessible names without visible label duplication. Sidebar capture and processing states are separate, including processing while capture is paused.

- Shared input/select/password/search/textarea styling, visible two-pixel keyboard focus, explicit labels and readable placeholders. Textarea fills its container and has a minimum usable height of 112px.
- Editor uses a native dialog with title focus, modal keyboard containment, Escape/cancel, focus restoration, scrollable content and sticky title. Optional technical configuration is in disclosures.
- Disabled, busy, empty, preview, status, error and success states are explicit. Operation feedback uses live regions. Primary actions are filled green; secondary actions remain quiet.
- **The Explicit Intake Rule:** automatic capture and Always overwrite need distinct consent. Existing clipboard images are skipped on startup/resume.
- **The Independent Save Rule:** local GLM Token save and potentially paid connection testing have separate actions. Connection testing is optional; supported models can process an explicitly requested screenshot without a prior synthetic test. Saving never requests a model.

## Do's and Don'ts

Keep the screenshot workflow prominent; preserve keyboard focus and visible action feedback. Keep provider-specific Token controls exclusive to GLM. Keep advanced cleanup separate from ordinary removal. Never treat browser screenshots or Fake execution as Windows paste, actual provider authentication, live vision or universal IME proof.

M8 adds an inline ordered composer using the existing controls and preview styles. Capture settings expose independent clipboard/folder toggles; file/text payload and notification are independent from Markdown save.
