// Chegga Web — Lichess public games API client
//
// Lichess's game export is public and open to browsers (it answers with
// `Access-Control-Allow-Origin: *`), so a visitor's own tab can read their
// games directly: no login, no proxy, no key. `Accept` is one of the
// headers a browser may send without a CORS preflight, so this is a plain
// GET. No `User-Agent` is set on purpose: browsers do not allow it.
//
// One request at a time, and a 429 means "wait a minute" -- both are
// Lichess's own rules for the API. The tutorial and the sync form each
// make a single request, so neither needs a queue.

const LICHESS_API_BASE = "https://lichess.org/api";

export interface LichessPlayer {
  user?: { name: string; id?: string };
  rating?: number;
  aiLevel?: number;
}

export interface LichessRawGame {
  id: string;
  rated?: boolean;
  variant?: string; // "standard", "fromPosition", "chess960", ...
  speed?: string; // ultraBullet | bullet | blitz | rapid | classical | correspondence
  createdAt?: number; // ms
  lastMoveAt?: number; // ms
  status?: string; // mate | resign | stalemate | timeout | outoftime | draw | ...
  players?: { white?: LichessPlayer; black?: LichessPlayer };
  winner?: "white" | "black";
  opening?: { eco?: string; name?: string; ply?: number };
  clock?: { initial: number; increment: number };
  pgn?: string;
}

export class LichessHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Plain-language message for the errors a visitor can actually hit. */
function messageFor(status: number, username: string): string {
  if (status === 404) return `Lichess has no account named "${username}". Check the spelling and try again.`;
  if (status === 429) return "Lichess asked us to slow down. Wait a minute, then try again.";
  return `Lichess could not be reached (error ${status}). Try again in a moment.`;
}

/** NDJSON: one JSON game per line. A line that does not parse is skipped,
 * so one bad record cannot lose the rest. */
export function parseNdjson(text: string): LichessRawGame[] {
  const games: LichessRawGame[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const game = JSON.parse(trimmed) as LichessRawGame;
      if (game && typeof game.id === "string") games.push(game);
    } catch {
      continue;
    }
  }
  return games;
}

/** The newest `max` games, newest first. `sinceMs` limits it to games
 * played after that time, for an incremental re-sync. */
export async function fetchLichessGames(
  username: string,
  opts: { max: number; sinceMs?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<LichessRawGame[]> {
  const params = new URLSearchParams({
    max: String(opts.max),
    pgnInJson: "true",
    clocks: "true",
    opening: "true",
  });
  if (opts.sinceMs !== undefined) params.set("since", String(opts.sinceMs));
  const url = `${LICHESS_API_BASE}/games/user/${encodeURIComponent(username)}?${params.toString()}`;

  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Accept: "application/x-ndjson" } });
  } catch {
    throw new LichessHttpError(0, "Could not reach Lichess. Check your connection and try again.");
  }
  if (!response.ok) throw new LichessHttpError(response.status, messageFor(response.status, username));
  return parseNdjson(await response.text());
}
