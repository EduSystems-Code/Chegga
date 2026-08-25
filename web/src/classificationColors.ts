// Chegga Web — shared move-quality color palette
//
// Reused exactly from Chegga's own frontend (`Chegga/frontend/src/lib/
// classification.ts`) so a color means the same thing in both products.
// Categorical (identity: which quality tier), fixed hue order — shared by
// profileView.ts's move-quality bar and openingBoard.ts's move coloring
// so the two don't drift into two different palettes for the same idea.

export const CLASSIFICATION_ORDER = ["best", "excellent", "good", "inaccuracy", "mistake", "blunder"];

export const CLASS_COLOR: Record<string, string> = {
  best: "#4caf50",
  excellent: "#8bc34a",
  good: "#cddc39",
  inaccuracy: "#ffb300",
  mistake: "#fb8c00",
  blunder: "#e53935",
};
