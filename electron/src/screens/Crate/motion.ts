// Single source for crate-digger timing. Mirrors the --ease-*/--dur-*/--spin-rpm
// tokens in theme.css; consumed by framer-motion transitions in the components.
export const EASE_LAZY = [0.2, 0.8, 0.2, 1] as const;   // settle
export const EASE_GLIDE = [0.16, 1, 0.3, 1] as const;   // big moves
export const DUR = { quick: 0.18, base: 0.32, slow: 0.55, open: 0.6 } as const;
export const SPIN_SECONDS = 7;
