// Chegga Web — PK taxonomy node -> Lichess puzzle theme(s)
//
// The concrete "next step" pk-mastery-system.md always named: wiring the
// 74-node taxonomy to real puzzle content. Every node with a clean
// Lichess-theme equivalent gets a mapping here; nodes that don't (pure
// strategy/planning concepts with no tactical puzzle motif) are left out
// and simply don't show a "Practice" button. Theme ids match
// curatedPuzzles.ts's THEME_OPTIONS / the Lichess `Themes` column.

export const PK_CODE_TO_LICHESS_THEMES: Record<string, string[]> = {
  "BV-10-04": ["promotion", "enPassant", "castling"],
  "BV-20-02": ["hangingPiece", "capturingDefender"],

  "TC-10-01": ["fork"],
  "TC-10-02": ["pin"],
  "TC-10-03": ["skewer"],
  "TC-10-04": ["discoveredAttack"],
  "TC-10-05": ["fork", "doubleCheck"],
  "TC-10-06": ["hangingPiece"],
  "TC-20-01": ["capturingDefender"],
  "TC-20-02": ["deflection", "attraction"],
  "TC-20-03": ["backRankMate"],
  "TC-20-04": ["discoveredAttack", "doubleCheck"],
  "TC-20-05": ["doubleCheck"],
  "TC-20-06": ["xRayAttack"],
  "TC-30-01": ["sacrifice", "fork", "pin"],
  "TC-30-02": ["zwischenzug", "intermezzo"],
  "TC-30-03": ["deflection", "capturingDefender"],
  "TC-30-04": ["trappedPiece"],
  "TC-30-05": ["mate", "mateIn2", "mateIn3"],
  "TC-40-01": ["sacrifice", "kingsideAttack"],
  "TC-40-02": ["attackingF2F7", "exposedKing"],
  "TC-40-03": ["mateIn3", "mateIn4"],
  "TC-50-01": ["quietMove", "defensiveMove"],
  "TC-50-02": ["sacrifice", "quietMove"],

  "EG-10-01": ["pawnEndgame", "endgame"],
  "EG-10-02": ["pawnEndgame"],
  "EG-10-03": ["endgame"],
  "EG-10-04": ["endgame", "queenEndgame"],
  "EG-20-01": ["advancedPawn", "promotion", "pawnEndgame"],
  "EG-20-02": ["advancedPawn", "pawnEndgame"],
  "EG-20-03": ["endgame"],
  "EG-20-04": ["rookEndgame"],
  "EG-20-05": ["rookEndgame"],
  "EG-30-01": ["bishopEndgame"],
  "EG-30-02": ["bishopEndgame"],
  "EG-30-03": ["knightEndgame", "bishopEndgame"],
  "EG-30-04": ["rookEndgame"],
  "EG-40-01": ["rookEndgame"],
  "EG-40-02": ["queenEndgame"],
  "EG-40-03": ["pawnEndgame", "endgame"],
  "EG-50-01": ["defensiveMove", "endgame"],
  "EG-50-02": ["zugzwang"],

  "ST-10-03": ["exposedKing", "kingsideAttack"],
  "ST-20-04": ["quietMove"],

  "OP-10-02": ["opening"],
};

export function lichessThemesForPkCode(code: string): string[] | undefined {
  return PK_CODE_TO_LICHESS_THEMES[code];
}
