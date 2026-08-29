// Chegga Web — bundled Lichess CC0 puzzle subset
//
// The full lichess_db_puzzle.csv (~6M puzzles, ~1GB) is far past this
// project's "just visit a URL" size bar -- the same reason Phase 0 took
// the 7MB lite Stockfish over the 113MB full build. So a curated ~100k
// subset (stratified across rating bands x themes, quality-filtered on
// popularity/plays/rating-deviation) is bundled as a static asset in
// public/curated-puzzles.json and loaded into the `curatedPuzzles`
// IndexedDB store on first use of the themed-puzzle mode. Data is CC0
// (public domain) -- no attribution required, but credited in the UI
// anyway.

import {
  bulkPutCuratedPuzzles,
  countCuratedPuzzles,
  getCuratedPuzzlesByTheme,
  getCuratedPuzzlesByOpening,
  type CuratedPuzzleRecord,
} from "./db";

interface BundleShape {
  v: number;
  source: string;
  fields: string[];
  rows: (string | number)[][];
}

const BUNDLE_URL = `${import.meta.env.BASE_URL}curated-puzzles.json`;

/** Populates the `curatedPuzzles` store from the bundled JSON the first
 * time it's needed; a no-op once the store already has rows, so it's
 * cheap to call before every themed-puzzle session. onProgress reports
 * 0..1 during the initial load only. */
export async function ensureCuratedPuzzlesLoaded(
  db: IDBDatabase,
  onProgress?: (fraction: number, note: string) => void,
): Promise<void> {
  if ((await countCuratedPuzzles(db)) > 0) return;

  onProgress?.(0, "Downloading the puzzle set (one-time)…");
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) throw new Error(`Couldn't load the puzzle set (${res.status}).`);
  const bundle = (await res.json()) as BundleShape;

  const idx = Object.fromEntries(bundle.fields.map((f, i) => [f, i]));
  const total = bundle.rows.length;
  const CHUNK = 20_000;
  for (let start = 0; start < total; start += CHUNK) {
    const slice = bundle.rows.slice(start, start + CHUNK);
    const records: CuratedPuzzleRecord[] = slice.map((r) => {
      const themes = String(r[idx.themes] ?? "");
      const openingTags = String(r[idx.openingTags] ?? "");
      return {
        id: String(r[idx.id]),
        fen: String(r[idx.fen]),
        moves: String(r[idx.moves]),
        rating: Number(r[idx.rating]),
        ratingDeviation: Number(r[idx.ratingDeviation]),
        popularity: Number(r[idx.popularity]),
        themes,
        themeList: themes ? themes.split(" ") : [],
        openingTags,
        openingList: openingTags ? openingTags.split(" ") : [],
      };
    });
    await bulkPutCuratedPuzzles(db, records);
    onProgress?.(Math.min(1, (start + CHUNK) / total), `Loading puzzles… ${Math.min(start + CHUNK, total).toLocaleString()}/${total.toLocaleString()}`);
  }
  onProgress?.(1, "Puzzle set ready.");
}

// --- Theme catalog (the Lichess motif themes worth exposing; the meta
// ones like `short`/`oneMove`/`master`/`crushing` are deliberately left
// out of the picker) ---

export interface ThemeOption {
  id: string; // Lichess theme id, matches the multiEntry index key
  label: string;
  group: "Tactics" | "Mating patterns" | "Endgame" | "Game phase & attack";
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: "fork", label: "Fork", group: "Tactics" },
  { id: "pin", label: "Pin", group: "Tactics" },
  { id: "skewer", label: "Skewer", group: "Tactics" },
  { id: "discoveredAttack", label: "Discovered attack", group: "Tactics" },
  { id: "doubleCheck", label: "Double check", group: "Tactics" },
  { id: "sacrifice", label: "Sacrifice", group: "Tactics" },
  { id: "deflection", label: "Deflection", group: "Tactics" },
  { id: "attraction", label: "Attraction", group: "Tactics" },
  { id: "clearance", label: "Clearance", group: "Tactics" },
  { id: "interference", label: "Interference", group: "Tactics" },
  { id: "xRayAttack", label: "X-ray attack", group: "Tactics" },
  { id: "zwischenzug", label: "Zwischenzug (in-between move)", group: "Tactics" },
  { id: "quietMove", label: "Quiet move", group: "Tactics" },
  { id: "hangingPiece", label: "Hanging piece", group: "Tactics" },
  { id: "trappedPiece", label: "Trapped piece", group: "Tactics" },
  { id: "capturingDefender", label: "Capture the defender", group: "Tactics" },
  { id: "defensiveMove", label: "Defensive move", group: "Tactics" },
  { id: "intermezzo", label: "Intermezzo", group: "Tactics" },

  { id: "mateIn1", label: "Mate in 1", group: "Mating patterns" },
  { id: "mateIn2", label: "Mate in 2", group: "Mating patterns" },
  { id: "mateIn3", label: "Mate in 3", group: "Mating patterns" },
  { id: "mateIn4", label: "Mate in 4+", group: "Mating patterns" },
  { id: "backRankMate", label: "Back-rank mate", group: "Mating patterns" },
  { id: "smotheredMate", label: "Smothered mate", group: "Mating patterns" },
  { id: "anastasiaMate", label: "Anastasia's mate", group: "Mating patterns" },
  { id: "arabianMate", label: "Arabian mate", group: "Mating patterns" },
  { id: "bodenMate", label: "Boden's mate", group: "Mating patterns" },
  { id: "hookMate", label: "Hook mate", group: "Mating patterns" },
  { id: "dovetailMate", label: "Dovetail mate", group: "Mating patterns" },
  { id: "doubleBishopMate", label: "Double bishop mate", group: "Mating patterns" },

  { id: "endgame", label: "Endgame (any)", group: "Endgame" },
  { id: "rookEndgame", label: "Rook endgame", group: "Endgame" },
  { id: "queenEndgame", label: "Queen endgame", group: "Endgame" },
  { id: "bishopEndgame", label: "Bishop endgame", group: "Endgame" },
  { id: "knightEndgame", label: "Knight endgame", group: "Endgame" },
  { id: "pawnEndgame", label: "Pawn endgame", group: "Endgame" },
  { id: "queenRookEndgame", label: "Queen & rook endgame", group: "Endgame" },
  { id: "promotion", label: "Promotion", group: "Endgame" },
  { id: "underPromotion", label: "Underpromotion", group: "Endgame" },
  { id: "advancedPawn", label: "Advanced pawn", group: "Endgame" },
  { id: "enPassant", label: "En passant", group: "Endgame" },

  { id: "opening", label: "Opening", group: "Game phase & attack" },
  { id: "middlegame", label: "Middlegame", group: "Game phase & attack" },
  { id: "kingsideAttack", label: "Kingside attack", group: "Game phase & attack" },
  { id: "queensideAttack", label: "Queenside attack", group: "Game phase & attack" },
  { id: "attackingF2F7", label: "Attack on f2 / f7", group: "Game phase & attack" },
  { id: "exposedKing", label: "Exposed king", group: "Game phase & attack" },
  { id: "castling", label: "Castling", group: "Game phase & attack" },
];

const THEME_LABELS: Record<string, string> = Object.fromEntries(THEME_OPTIONS.map((t) => [t.id, t.label]));

/** Human-readable comma list of a puzzle's motif themes -- this is the
 * "why" for a curated puzzle (it has themes, not a blunder tag). Filters
 * out the Lichess meta-themes so it reads as "Fork, Discovered attack",
 * not "crushing, short, middlegame, fork". */
export function describeThemes(themes: string): string {
  const named = themes
    .split(" ")
    .map((t) => THEME_LABELS[t])
    .filter(Boolean);
  return [...new Set(named)].join(", ");
}

export interface PickOpts {
  themes: string[]; // OR-union; empty => any theme in the store
  ratingMin: number;
  ratingMax: number;
  openings?: string[]; // OR-union of Lichess OpeningTags
  excludeIds?: Set<string>;
}

/** Pulls a candidate pool for the chosen theme(s)/opening(s) via the
 * multiEntry indexes, then filters rating and exclusions in memory (a
 * per-theme pool is a few thousand rows at most). Returns null if nothing
 * matches even after ignoring the exclusion set. */
export async function pickCuratedPuzzle(db: IDBDatabase, opts: PickOpts): Promise<CuratedPuzzleRecord | null> {
  const byId = new Map<string, CuratedPuzzleRecord>();

  if (opts.openings && opts.openings.length) {
    for (const o of opts.openings) for (const p of await getCuratedPuzzlesByOpening(db, o)) byId.set(p.id, p);
  }
  if (opts.themes.length) {
    for (const t of opts.themes) for (const p of await getCuratedPuzzlesByTheme(db, t)) byId.set(p.id, p);
  }
  if (byId.size === 0 && !opts.themes.length && !(opts.openings && opts.openings.length)) {
    // No filter at all -- fall back to a broad common theme so we still
    // return something without scanning the whole store.
    for (const p of await getCuratedPuzzlesByTheme(db, "middlegame")) byId.set(p.id, p);
  }

  const inBand = [...byId.values()].filter((p) => p.rating >= opts.ratingMin && p.rating <= opts.ratingMax);
  const pool = inBand.length ? inBand : [...byId.values()]; // ignore the band before returning nothing
  if (pool.length === 0) return null;

  const fresh = opts.excludeIds ? pool.filter((p) => !opts.excludeIds!.has(p.id)) : pool;
  const candidates = fresh.length ? fresh : pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
