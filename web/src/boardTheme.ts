// Chegga Web — board color theme (applies to every PlayBoard at once)
//
// Every PlayBoard instance reads its square colors from the CSS custom
// properties `--board-square-light`/`--board-square-dark` at render time
// (see playBoard.ts) rather than a hardcoded hex — so switching the theme
// here is a two-line `style.setProperty` call, not a re-instantiation of
// every board on the page.

const STORAGE_KEY = "chegga-web:board-theme";

export interface BoardTheme {
  id: string;
  label: string;
  light: string;
  dark: string;
}

export const BOARD_THEMES: BoardTheme[] = [
  { id: "tan", label: "Tan (default)", light: "#f0d9b5", dark: "#b58863" },
  { id: "forest", label: "Forest", light: "#5c7a4f", dark: "#3a4f31" },
  { id: "slate", label: "Slate", light: "#252c3a", dark: "#161a22" },
  { id: "midnight", label: "Midnight blue", light: "#33415c", dark: "#1a2233" },
  { id: "mono", label: "Monochrome", light: "#3a3f4a", dark: "#212530" },
];

export function applyBoardTheme(id: string): void {
  const theme = BOARD_THEMES.find((t) => t.id === id) ?? BOARD_THEMES[0];
  document.documentElement.style.setProperty("--board-square-light", theme.light);
  document.documentElement.style.setProperty("--board-square-dark", theme.dark);
  try {
    localStorage.setItem(STORAGE_KEY, theme.id);
  } catch {
    // ignore -- best-effort only
  }
}

/** Returns the theme id it applied (the caller uses this to sync a
 * <select>'s value — loadSavedBoardTheme() only touches CSS custom
 * properties, it doesn't know about any particular picker UI). */
export function loadSavedBoardTheme(): string {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  const id = saved ?? BOARD_THEMES[0].id;
  applyBoardTheme(id);
  return id;
}
