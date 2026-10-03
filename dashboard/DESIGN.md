# MMR console: design system

An operations console for people who reconcile money. The design gets out of
the way of the task: quiet surfaces, high-contrast figures, one accent, and
motion that only ever reports a change of state. Tokens live in
`app/globals.css` (`@theme` plus a dark override); components use semantic
tokens only, never raw values.

## Principles

1. **The figure is the hero.** Amounts and rates are set large in the display
   face with tabular numerals. Labels stay small and quiet beside them.
2. **One accent, used for meaning.** Cobalt marks selection, focus, links, the
   primary chart series and "running". It is never decoration.
3. **Hairlines, not boxes.** Panels have a 1px line and no shadow. Groups inside
   a panel are separated by hairlines or space, never by a nested card. Only
   floating layers (drawers, dialogs, the palette, toasts) cast a shadow.
4. **Every state is real.** Loading skeletons have the final layout's shape;
   empty states say how data arrives; errors say what failed and offer a retry.
   Nothing is invented: demo data exists only behind `NEXT_PUBLIC_DEMO_MODE`.
5. **Keyboard first, pointer friendly.** Every action has a visible control and,
   where it is frequent, a shortcut.

## Colour

| Role | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#f7f7f8` | `#0a0a0c` | Page canvas |
| `bg-subtle` | `#f2f2f4` | `#0e0e11` | Sidebar, mobile bar |
| `panel` | `#ffffff` | `#121215` | Panels, drawers, table headers |
| `inset` | `#f4f4f6` | `#16161a` | Wells inside panels (legs, notes, code) |
| `line` / `line-strong` | `#e7e7ea` / `#d4d4da` | `#232329` / `#33333a` | Hairlines / control borders |
| `fg` | `#0f0f12` | `#ededf0` | Primary text, figures |
| `fg-muted` | `#50505a` | `#a9a9b3` | Body text, labels |
| `fg-subtle` | `#696973` | `#8e8e98` | Captions, meta (still ≥ 4.5:1) |
| `fg-faint` | `#8e8e98` | `#6a6a74` | Icons and decoration only, never text |
| `accent` | `#3355e0` | `#6d84ff` | The one accent |
| `ink` | `#0f0f12` | `#ededf0` | Primary buttons |

Status colours each come as a fill, a soft ground and a text tone, and always
travel with a text label:

| Status | Meaning |
|---|---|
| `critical` (red) | Critical severity, failed runs, overdue, money at risk |
| `high` (orange) | High severity, escalated, pairs with a discrepancy |
| `medium` (amber) | Medium severity, pending settlement, quiet PSP |
| `low` (neutral) | Low severity, cancelled, false positive |
| `positive` (green) | Resolved, settled, matched, completed, live |
| `age-1` to `age-4` | Sequential cobalt ramp for exposure aging, young to old |

Every text token measures at least 4.5:1 against `bg`, `bg-subtle` and `panel`
in both themes (computed, and checked by axe in the e2e suite).

## Type

| Face | Role |
|---|---|
| **Mona Sans** (variable, width 112%, weight 560-620) | Page titles (`.t-display`, 26px) and headline figures (`.t-metric`, 28-36px) |
| **Geist Sans** | Everything else: UI, labels, body (14px base, 12px minimum) |
| **Geist Mono** | References, IDs, idempotency keys, object paths |

Money and counts use `.num` (tabular, lining figures) so columns align and
tickers do not jitter. In headline amounts the naira sign and kobo are set at
62% in the subtle tone so the whole-naira figure leads.

Scale (px): 12 · 12.5 · 13 · 13.5 · 14 · 15 · 17 · 20 · 26, display 28 to 36.

## Space, shape, elevation

- 4px grid. Page gutter 32px (16px under 768px). Panels pad 20 to 24px.
- Radius: 4 (kbd, focus), 6 (badges, small buttons), 8 (buttons, inputs),
  12 (panels), 16 (drawers, dialogs, palette).
- Elevation: none on panels. `--shadow-float` for toasts and tooltips,
  `--shadow-overlay` for drawers, dialogs and the palette.
- Density: `data-density="comfortable"` (44px rows) or `"compact"` (34px),
  a per-viewer preference applied before first paint.

## Motion

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Everything that arrives |
| `--dur-fast` | 120ms | Hover, press, colour |
| `--dur-base` | 180ms | Tabs, panes, dialogs |
| `--dur-slow` | 240ms | Page transition |
| reveal | 480ms | Sections entering the viewport, once |
| draw | 600ms | Chart draw-in, number tickers |
| `SPRING_PANEL` | stiffness 520, damping 46 | Drawers (settles ~250ms, no overshoot) |
| `SPRING_SNAPPY` | stiffness 700, damping 48 | Tab indicator, nav highlight, toasts |

What moves, and why: a page settles in (navigation happened), a drawer slides
from the edge it belongs to (context is preserved), a resolved row slides out
(it left this view), the tab underline and the nav highlight travel (selection
moved), headline figures count to their value (they are new), chart series draw
in once. Only the first twelve rows of a fresh list stagger. Nothing loops
except a live "running" dot.

`MotionConfig reducedMotion="user"` wraps the shell: with the OS preference on,
transform and layout animation stop and only opacity fades remain, while the
CSS fallback zeroes transition and animation durations. Markup is identical in
both modes, so hydration always matches.

Scrolling is native everywhere. `scroll-behavior: smooth` applies only to
in-page jumps, and only without reduced motion.

## Components

- **Panel**: `.panel`. Never nested. Use `inset` wells inside one instead.
- **Buttons**: `.btn-primary` (ink), `.btn-secondary` (outlined),
  `.btn-ghost`, `.btn-accent` (rare), `.icon-btn`. One primary per view.
- **Badge**: `.badge` + tone (`-critical`, `-high`, `-medium`, `-positive`,
  `-accent`, `-outline`). Always text, never colour alone.
- **Severity pip**: an 8px square in the severity colour, beside the label.
- **Dot**: only for live state (readiness, freshness, running).
- **Table**: `.table` with a sticky header, density-driven row height, and a
  `.row-button` in the first cell whose hit area covers the row.
- **Sheet** (drawer), **Dialog**, **Command palette**: portalled, focus-trapped,
  Escape closes, focus returns to the opener.
- **Tabs**: WAI-ARIA tabs with arrow keys and a sliding underline.

## Keyboard

`Ctrl/⌘ K` palette · `?` shortcuts · `G` then `O I T M P A R S` to navigate ·
Inbox: `J`/`K` move, `Enter` open, `X` select, `Shift X` select all, `E`
resolve, `Shift E` false positive, `Esc` clear · Tables: `/` search, `J`/`K`
rows, `Enter` open.
