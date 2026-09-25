---
name: mcbot-ui
description: UI engineering rules for MCbotv1 Desktop. Use for any renderer, layout, styling, interaction, accessibility, or Dev UI task in MCbotv1. Preserve existing functionality and code structure; do not invent pages, features, data, or visual concepts.
---

# MCbotv1 UI

## Source of truth

The current MCbotv1 repository is the source of truth.

Before changing UI:
1. Read the relevant current files in `src/desktop/renderer/`.
2. Inspect existing DOM IDs, classes, page sections, render functions, event bindings, and CSS tokens.
3. Trace the existing data flow before changing markup.
4. Determine whether the request is visual-only or behavior-changing.

Do not infer missing product requirements from generic UI patterns, screenshots, or design-system defaults.

## Hard constraints

- Do not add new features unless explicitly requested.
- Do not add new pages/navigation items unless explicitly requested.
- Do not invent data, metrics, actions, bot states, settings, or workflows.
- Do not change business logic for a UI-only task.
- Do not silently rename/remove DOM IDs or classes used by JavaScript.
- Do not replace HTML/CSS/JS with React, Vue, Tailwind, component libraries, or another framework.
- Do not add npm dependencies for visual changes unless explicitly requested and justified.
- Do not introduce marketing/landing-page patterns into the desktop operator UI.
- Do not add decorative gradients, glow, excessive shadows, glassmorphism, giant cards, or animation merely to make the UI look "modern".
- Keep the interface Windows 10-like: compact, practical, familiar, readable.
- Prefer existing CSS variables/tokens over new one-off values.
- Keep Vietnamese UI terminology consistent with the existing product.

## Experience direction

MCbotv1 has two experiences:
- User UI: simple and operational.
- Dev UI: information-dense, diagnostic, warning/error friendly.

Dev UI may intentionally show:
- status details
- warnings
- errors
- identifiers
- timestamps
- technical metadata
- actionable recovery information

Do not turn the Dev UI into a visually noisy neon developer dashboard.

## Safe UI change order

1. Preserve DOM/data contracts.
2. Fix hierarchy and spacing.
3. Reuse current colors/tokens.
4. Improve controls and states.
5. Improve accessibility.
6. Only then polish small visual details.

For an existing page, prefer the smallest change that solves the requested problem.

## Interaction states

For interactive elements, verify where applicable:
- default
- hover
- focus
- active
- disabled
- loading/pending
- success
- error

Do not add states that imply backend capabilities the code does not provide.

## Accessibility and robustness

Keep semantic HTML and existing ARIA behavior.
Do not remove focus indicators.
Check keyboard navigation for changed controls.
Handle long labels, empty data, error data, and narrow windows without breaking layout.

## Validation

After UI changes:
1. Run the relevant existing tests.
2. Start the desktop app using the existing project command.
3. Inspect the actual rendered UI.
4. Check browser/renderer console for errors and warnings.
5. When Playwright MCP is available, use it to inspect and exercise the changed UI.
6. Re-check affected DOM IDs, event handlers, and page switching.
7. Do not declare success from static code inspection alone.

## Visual priority

When a design skill conflicts with MCbotv1 product constraints:
MCbotv1 constraints win.

The objective is not to create the most distinctive UI.
The objective is to make the existing MCbotv1 UI clearer, simpler, more usable, and easier to diagnose without changing its product behavior.
