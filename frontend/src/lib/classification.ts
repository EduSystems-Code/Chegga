// Shared between ProfilePage's aggregate "Move quality" bar and the
// per-drill accuracy bar -- one palette, so a color means the same thing
// everywhere it appears rather than each page inventing its own.
export const CLASSIFICATION_ORDER = ["best", "excellent", "good", "inaccuracy", "mistake", "blunder"];

export const CLASS_COLOR: Record<string, string> = {
  best: "#4caf50",
  excellent: "#8bc34a",
  good: "#cddc39",
  inaccuracy: "#ffb300",
  mistake: "#fb8c00",
  blunder: "#e53935",
};
