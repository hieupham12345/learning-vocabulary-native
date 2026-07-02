// palette.ts
// The app's actual dark-navy palette. Previously these hex values were
// hardcoded (hundreds of times) across every screen. Named tokens here are the
// single source of truth — same values, so swapping literals for tokens is a
// behavior-preserving change.
//
// NOTE: constants/theme.ts holds the Expo starter's light/dark *navigation*
// theme and is unrelated to these app colors.

export const Palette = {
  // Backgrounds (darkest → lightest)
  bg: "#1a1a2e",          // screen root
  card: "#16213e",        // card / header surface
  inset: "#0a1628",       // inset boxes, list rows
  panel: "#0d1b2a",       // secondary panels
  sentence: "#111d30",    // sentence box
  example: "#0a1628",     // example box

  // Interactive / accents
  inputBg: "#0f3460",     // text input background
  primary: "#1a4a7a",     // primary buttons, active borders
  quiz: "#6c3483",        // quiz button
  border: "#1a3a5c",      // subtle borders

  // Brand / semantic
  brand: "#2CC985",       // brand green (active tint)
  accent: "#F1C40F",      // titles, highlighted text
  success: "#2ECC71",     // correct / pass
  danger: "#E74C3C",      // wrong / error / close
  hard: "#E67E22",        // "hard" difficulty, extra tokens
  warn: "#F39C12",        // explanations, in-progress
  info: "#5DADE2",        // labels, blue text

  // Text
  textPrimary: "#fff",
  textSecondary: "#ccc",
  textMuted: "#aaa",
  textFaint: "#888",
  textDim: "#555",
} as const;

/** Difficulty label → color, used by example tags and quiz cards. */
export const DIFFICULTY_COLORS: Record<string, string> = {
  Easy: "#2ECC71",
  Medium: "#F1C40F",
  Hard: "#E67E22",
  "Super Hard": "#E74C3C",
};
