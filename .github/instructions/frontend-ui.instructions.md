---
description: "Use when editing the Kyrus ERP frontend UI in kyrus-web. Enforce lightweight, friendly, user-centered screens with strong visual hierarchy and low cognitive load."
applyTo: "kyrus-web/src/**/*.{ts,tsx,js,jsx}"
---

# Frontend UI Rules

These rules apply to every frontend change in `kyrus-web`.

## Core rules

- Keep screens light, simple, and fast to scan.
- Prefer cards, summaries, and progressive disclosure over dense tables and giant forms.
- Show the essential action first, then reveal details only when the user asks for them.
- Use one primary task per screen whenever possible.
- Avoid loading large amounts of content at once if a selection + detail pattern works better.
- Keep labels short, friendly, and direct.
- Use clear empty states, loading states, and success/error feedback.
- Preserve good usability on both desktop and mobile.
- Do not expose technical codes when a human-friendly description exists.
- Prefer avatar, icon, or initial-based fallbacks when images are unavailable.

## Layout guidance

- Use cards for selectable entities such as profiles, users, companies, accounts, and integrations.
- When a list is large, put the list on one side and the editable detail panel on the other.
- Use tabs only when they genuinely reduce complexity.
- Group related inputs into small sections.
- Keep forms visually balanced and easy to finish.
- Make the selected item obvious.

## Visual guidance

- Favor strong hierarchy, breathing room, and readable typography.
- Avoid crowded grids and overly tall tables as the default view.
- Use subtle motion only when it improves comprehension.
- Make the interface feel intentional and calm, not busy.
- If a design starts feeling heavy, simplify it before adding more elements.

## Practical check

Before finalizing any frontend change, ask:

- Does this screen help the user understand the task in a few seconds?
- Can I replace a dense block with cards or a detail panel?
- Am I showing too much at once?
- Is the UI friendly for someone using it every day?

If the answer suggests friction, redesign toward clarity and lightness.
