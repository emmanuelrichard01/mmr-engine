// Motion tokens, mirrored from the CSS custom properties in app/globals.css.
// UI transitions stay at or under 250ms; reveals at or under 600ms. Every
// consumer checks useReducedMotion() and drops to no movement.

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

export const DURATION = {
  fast: 0.12,
  base: 0.18,
  slow: 0.24,
  reveal: 0.48,
  draw: 0.6,
} as const;

/** Drawers and panes: settles in about 250ms without overshoot. */
export const SPRING_PANEL = { type: 'spring', stiffness: 520, damping: 46, mass: 0.9 } as const;

/** Small elements (tab indicator, toasts). */
export const SPRING_SNAPPY = { type: 'spring', stiffness: 700, damping: 48, mass: 0.6 } as const;

/** Rows revealed on first load: only the first few stagger; the rest appear together. */
export const STAGGER_LIMIT = 12;
export const STAGGER_STEP = 0.022;
