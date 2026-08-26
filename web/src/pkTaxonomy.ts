// Chegga Web — PK Mastery System taxonomy data.
//
// Ported from the vault's design doc (my-brain/projects/chegga/
// pk-taxonomy.md), not re-derived -- this is the v1 draft node list:
// 74 PK-coded concepts across 5 domains x 5 rating tiers, with a
// prerequisite graph. Pure data, no logic -- this is not yet wired to
// real puzzle content (see pk-mastery-system.md's "what happens next":
// the Lichess theme -> PK mapping table is the next concrete step).
// This module exists so the taxonomy can be browsed on-site instead of
// only in the vault's design doc.

export type PkDomain = "BV" | "TC" | "EG" | "ST" | "OP";
export type PkLevel = 10 | 20 | 30 | 40 | 50;

export interface PkNode {
  code: string; // e.g. "TC-30-01"
  name: string;
  domain: PkDomain;
  level: PkLevel;
  prereqs: string[]; // PK codes; empty = entry point
}

export const PK_DOMAIN_INFO: Record<PkDomain, { name: string; note?: string }> = {
  BV: { name: "Board Vision & Fluency", note: "Foundational — almost every other node traces back here." },
  TC: { name: "Tactics", note: "Largest domain — where most sub-1800 rating gains actually come from." },
  EG: { name: "Endgames" },
  ST: { name: "Strategy" },
  OP: {
    name: "Openings",
    note: "Deliberately small — transferable skills, not a per-opening encyclopedia; your actual repertoire lines live in the opening-repertoire feature above, not here.",
  },
};

export const PK_LEVEL_LABEL: Record<PkLevel, string> = {
  10: "<1000",
  20: "1000–1400",
  30: "1400–1800",
  40: "1800–2200",
  50: "2200+",
};

export const PK_NODES: PkNode[] = [
  { code: "BV-10-01", name: "Board Setup & Notation", domain: "BV", level: 10, prereqs: [] },
  { code: "BV-10-02", name: "Piece Movement Rules", domain: "BV", level: 10, prereqs: ["BV-10-01"] },
  { code: "BV-10-03", name: "Check, Checkmate, Stalemate", domain: "BV", level: 10, prereqs: ["BV-10-02"] },
  { code: "BV-10-04", name: "Castling, En Passant, Promotion", domain: "BV", level: 10, prereqs: ["BV-10-02"] },
  { code: "BV-10-05", name: "Square Color & Diagonal Recognition", domain: "BV", level: 10, prereqs: ["BV-10-01"] },
  { code: "BV-20-01", name: "Piece Value & Material Count", domain: "BV", level: 20, prereqs: ["BV-10-02"] },
  { code: "BV-20-02", name: "Counting Attackers & Defenders", domain: "BV", level: 20, prereqs: ["BV-20-01"] },
  { code: "BV-20-03", name: "Visualization / Blindfold Basics", domain: "BV", level: 20, prereqs: ["BV-20-02"] },
  { code: "BV-30-01", name: "Calculation Depth Building", domain: "BV", level: 30, prereqs: ["BV-20-03"] },
  { code: "BV-30-02", name: "Candidate Move Generation", domain: "BV", level: 30, prereqs: ["BV-30-01"] },

  { code: "TC-10-01", name: "Forks", domain: "TC", level: 10, prereqs: ["BV-20-02"] },
  { code: "TC-10-02", name: "Pins", domain: "TC", level: 10, prereqs: ["BV-20-02"] },
  { code: "TC-10-03", name: "Skewers", domain: "TC", level: 10, prereqs: ["TC-10-02"] },
  { code: "TC-10-04", name: "Discovered Attacks", domain: "TC", level: 10, prereqs: ["BV-20-02"] },
  { code: "TC-10-05", name: "Double Attacks", domain: "TC", level: 10, prereqs: ["TC-10-01"] },
  { code: "TC-10-06", name: "Hanging-Piece Awareness", domain: "TC", level: 10, prereqs: ["BV-20-01"] },
  { code: "TC-20-01", name: "Removing the Defender", domain: "TC", level: 20, prereqs: ["TC-10-02"] },
  { code: "TC-20-02", name: "Deflection & Decoy", domain: "TC", level: 20, prereqs: ["TC-20-01"] },
  { code: "TC-20-03", name: "Back-Rank Mates", domain: "TC", level: 20, prereqs: ["TC-10-01", "BV-10-03"] },
  { code: "TC-20-04", name: "Discovered Check", domain: "TC", level: 20, prereqs: ["TC-10-04"] },
  { code: "TC-20-05", name: "Double Check", domain: "TC", level: 20, prereqs: ["TC-20-04"] },
  { code: "TC-20-06", name: "X-Ray Attacks", domain: "TC", level: 20, prereqs: ["TC-10-03"] },
  { code: "TC-30-01", name: "Combination Building (2–3 move)", domain: "TC", level: 30, prereqs: ["TC-20-02", "BV-30-02"] },
  { code: "TC-30-02", name: "Zwischenzug / Intermezzo", domain: "TC", level: 30, prereqs: ["TC-30-01"] },
  { code: "TC-30-03", name: "Overloading", domain: "TC", level: 30, prereqs: ["TC-20-01"] },
  { code: "TC-30-04", name: "Trapped-Piece Exploitation", domain: "TC", level: 30, prereqs: ["TC-10-06"] },
  { code: "TC-30-05", name: "Mating-Net Construction", domain: "TC", level: 30, prereqs: ["TC-20-03"] },
  { code: "TC-40-01", name: "Sacrifice for Initiative", domain: "TC", level: 40, prereqs: ["TC-30-01"] },
  { code: "TC-40-02", name: "Attacking the Uncastled King", domain: "TC", level: 40, prereqs: ["TC-40-01"] },
  { code: "TC-40-03", name: "Long Calculation / Forcing Sequences", domain: "TC", level: 40, prereqs: ["TC-30-01", "BV-30-02"] },
  { code: "TC-50-01", name: "Prophylactic Tactics", domain: "TC", level: 50, prereqs: ["TC-40-03"] },
  { code: "TC-50-02", name: "Deep Positional Sacrifice", domain: "TC", level: 50, prereqs: ["TC-40-01"] },

  { code: "EG-10-01", name: "King & Pawn Basics", domain: "EG", level: 10, prereqs: ["BV-10-02"] },
  { code: "EG-10-02", name: "Opposition", domain: "EG", level: 10, prereqs: ["EG-10-01"] },
  { code: "EG-10-03", name: "King & Rook vs. King", domain: "EG", level: 10, prereqs: ["BV-10-03"] },
  { code: "EG-10-04", name: "Basic Mating Patterns (KQ, KR)", domain: "EG", level: 10, prereqs: ["EG-10-03"] },
  { code: "EG-20-01", name: "Promotion Race / Rule of the Square", domain: "EG", level: 20, prereqs: ["EG-10-01"] },
  { code: "EG-20-02", name: "Passed-Pawn Technique", domain: "EG", level: 20, prereqs: ["EG-20-01"] },
  { code: "EG-20-03", name: "King Activity in the Endgame", domain: "EG", level: 20, prereqs: ["EG-10-02"] },
  { code: "EG-20-04", name: "Basic Rook Endgames — Lucena", domain: "EG", level: 20, prereqs: ["EG-10-03"] },
  { code: "EG-20-05", name: "Basic Rook Endgames — Philidor", domain: "EG", level: 20, prereqs: ["EG-20-04"] },
  { code: "EG-30-01", name: "Minor-Piece Endgames — Same Bishop", domain: "EG", level: 30, prereqs: ["EG-20-03"] },
  { code: "EG-30-02", name: "Minor-Piece Endgames — Opposite Bishop", domain: "EG", level: 30, prereqs: ["EG-30-01"] },
  { code: "EG-30-03", name: "Knight vs. Bishop Endgames", domain: "EG", level: 30, prereqs: ["EG-30-01"] },
  { code: "EG-30-04", name: "Rook vs. Minor Piece", domain: "EG", level: 30, prereqs: ["EG-20-04"] },
  { code: "EG-40-01", name: "Complex Rook Endgames", domain: "EG", level: 40, prereqs: ["EG-20-05"] },
  { code: "EG-40-02", name: "Queen Endgame Basics", domain: "EG", level: 40, prereqs: ["EG-10-04"] },
  { code: "EG-40-03", name: "Multi-Pawn Endgame Technique", domain: "EG", level: 40, prereqs: ["EG-20-02"] },
  { code: "EG-50-01", name: "Fortress Positions", domain: "EG", level: 50, prereqs: ["EG-40-01"] },
  { code: "EG-50-02", name: "Zugzwang Exploitation", domain: "EG", level: 50, prereqs: ["EG-10-02"] },

  { code: "ST-10-01", name: "Center Control Basics", domain: "ST", level: 10, prereqs: ["BV-10-02"] },
  { code: "ST-10-02", name: "Piece Development Principles", domain: "ST", level: 10, prereqs: ["ST-10-01"] },
  { code: "ST-10-03", name: "King Safety Basics", domain: "ST", level: 10, prereqs: ["BV-10-04"] },
  { code: "ST-20-01", name: "Pawn Structure Basics (Isolated/Doubled)", domain: "ST", level: 20, prereqs: ["ST-10-01"] },
  { code: "ST-20-02", name: "Open & Half-Open Files", domain: "ST", level: 20, prereqs: ["ST-20-01"] },
  { code: "ST-20-03", name: "Good vs. Bad Bishops", domain: "ST", level: 20, prereqs: ["ST-20-01"] },
  { code: "ST-20-04", name: "Outposts", domain: "ST", level: 20, prereqs: ["ST-20-02"] },
  { code: "ST-30-01", name: "Pawn Chains & Breaks", domain: "ST", level: 30, prereqs: ["ST-20-01"] },
  { code: "ST-30-02", name: "Minority Attack", domain: "ST", level: 30, prereqs: ["ST-20-01"] },
  { code: "ST-30-03", name: "Piece Activity vs. Material", domain: "ST", level: 30, prereqs: ["ST-20-03"] },
  { code: "ST-30-04", name: "Weak Squares & Color Complexes", domain: "ST", level: 30, prereqs: ["ST-20-03"] },
  { code: "ST-30-05", name: "Exchanging Decisions", domain: "ST", level: 30, prereqs: ["ST-30-03"] },
  { code: "ST-40-01", name: "Prophylaxis", domain: "ST", level: 40, prereqs: ["ST-30-04"] },
  { code: "ST-40-02", name: "Space Advantage Exploitation", domain: "ST", level: 40, prereqs: ["ST-30-01"] },
  { code: "ST-40-03", name: "Dynamic vs. Static Imbalances", domain: "ST", level: 40, prereqs: ["ST-30-03"] },
  { code: "ST-50-01", name: "Long-Term Planning (Multi-Phase)", domain: "ST", level: 50, prereqs: ["ST-40-01"] },

  { code: "OP-10-01", name: "Opening Principles (Development, Center, Safety)", domain: "OP", level: 10, prereqs: ["ST-10-02"] },
  { code: "OP-10-02", name: "Common Traps & Blunders", domain: "OP", level: 10, prereqs: ["OP-10-01"] },
  { code: "OP-20-01", name: "Repertoire Basics (One White, One Black)", domain: "OP", level: 20, prereqs: ["OP-10-01"] },
  { code: "OP-20-02", name: "Understanding Transpositions", domain: "OP", level: 20, prereqs: ["OP-20-01"] },
  { code: "OP-30-01", name: "Main-Line Theory (Chosen Repertoire)", domain: "OP", level: 30, prereqs: ["OP-20-01"] },
  { code: "OP-30-02", name: "Typical Middlegame Plans by Opening", domain: "OP", level: 30, prereqs: ["OP-30-01", "ST-30-01"] },
  { code: "OP-40-01", name: "Deep Repertoire Preparation", domain: "OP", level: 40, prereqs: ["OP-30-01"] },
  { code: "OP-40-02", name: "Move-Order Nuances", domain: "OP", level: 40, prereqs: ["OP-30-01"] },
];

export function nodesByDomain(domain: PkDomain): PkNode[] {
  return PK_NODES.filter((n) => n.domain === domain);
}
