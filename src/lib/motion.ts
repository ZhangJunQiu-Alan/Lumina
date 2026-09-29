import type { Easing, TargetAndTransition, Transition, Variants } from 'motion/react';

export const duration = {
  fast: 0.15,
  base: 0.24,
  slow: 0.4,
} as const;

export const ease = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
} satisfies Record<string, Easing>;

export const spring = {
  snappy: { type: 'spring', stiffness: 520, damping: 30 },
  gentle: { type: 'spring', stiffness: 260, damping: 26 },
  pop: { type: 'spring', stiffness: 600, damping: 18 },
  sheet: { type: 'spring', stiffness: 320, damping: 34 },
} satisfies Record<string, Transition>;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.out } },
};

export const stagger = (step = 0.04, delayChildren = 0): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren: step, delayChildren } },
});

/** Per-item entrance delay, capped so long lists never make the tail wait. */
export const staggerDelay = (index: number, step = 0.03, max = 0.36) => Math.min(index * step, max);

export const shake = {
  x: [0, -8, 8, -6, 6, -3, 3, 0],
  transition: { duration: 0.42, ease: 'easeInOut' },
} satisfies TargetAndTransition;

export const pulse = {
  scale: [1, 1.035, 1],
  transition: { duration: 0.32, ease: ease.out },
} satisfies TargetAndTransition;

/** Enter offset for a card that slides in from the direction of travel (1 = forward, -1 = back). */
export const slideIn = (direction: 1 | -1, distance = 28) => ({
  initial: { opacity: 0, x: direction * distance },
  animate: { opacity: 1, x: 0 },
  transition: { duration: duration.base, ease: ease.out },
});
