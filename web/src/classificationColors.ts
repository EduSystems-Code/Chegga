// Chegga Web — shared move-quality color palette
//
// Default palette reused exactly from Chegga's own frontend (`Chegga/
// frontend/src/lib/classification.ts`) so a color means the same thing
// in both products. Categorical (identity: which quality tier), fixed
// hue order — shared by profileView.ts's move-quality bar and
// openingBoard.ts's move coloring so the two don't drift into two
// different palettes for the same idea.
//
// A second, colorblind-safe palette was added as a direct request: the
// default green→yellow→red ramp is the exact axis deuteranopia/
// protanopia (the common red-green forms) collapse, so a real
// alternative needs a different hue *direction*, not just different
// shades of the same one -- this scale runs blue→orange instead, with
// each step also getting a real hue change (not just a lightness/
// saturation change) so adjacent tiers stay distinguishable without
// relying on the color axis that's actually impaired.

export const CLASSIFICATION_ORDER = ["best", "excellent", "good", "inaccuracy", "mistake", "blunder"];

const CLASS_COLOR_DEFAULT: Record<string, string> = {
  best: "#4caf50",
  excellent: "#8bc34a",
  good: "#cddc39",
  inaccuracy: "#ffb300",
  mistake: "#fb8c00",
  blunder: "#e53935",
};

const CLASS_COLOR_COLORBLIND: Record<string, string> = {
  best: "#1565c0", // deep blue
  excellent: "#4fa8e0", // light blue
  good: "#8ec7e8", // pale blue
  inaccuracy: "#f2c14e", // gold (deliberately between the two hue families, reads as neutral-caution either way)
  mistake: "#e8842c", // orange
  blunder: "#b23a00", // deep burnt orange
};

/** Kept exported for any code that genuinely wants the default palette
 * specifically (none currently does) -- real consumers should call
 * getClassColor() so they follow the viewer's actual setting. */
export const CLASS_COLOR = CLASS_COLOR_DEFAULT;

const STORAGE_KEY = "chegga-web:colorblind-palette";

function loadColorblindSetting(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

let colorblindEnabled = loadColorblindSetting();

export function isColorblindPalette(): boolean {
  return colorblindEnabled;
}

export function setColorblindPalette(enabled: boolean): void {
  colorblindEnabled = enabled;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // best-effort only -- private browsing / blocked storage just means the choice doesn't persist
  }
}

/** The real accessor every consumer should use instead of indexing
 * CLASS_COLOR directly, so a palette toggle actually takes effect
 * everywhere without each call site tracking the setting itself. */
export function getClassColor(key: string): string {
  const palette = colorblindEnabled ? CLASS_COLOR_COLORBLIND : CLASS_COLOR_DEFAULT;
  return palette[key] ?? CLASS_COLOR_DEFAULT[key];
}
