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
export function messageFor(status: number, username: string): string {
  if (status === 404) return `Lichess has no account named "${username}". Check the spelling and try again.`;
  if (status === 429) return "Lichess asked us to slow down. Wait a minute, then try again.";
  return `Lichess could not be reached (error ${status}). Try again in a moment.`;
}

/** One NDJSON line -> a game, or null when it is blank or not a game. */
function parseNdjsonLine(line: string): LichessRawGame | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const game = JSON.parse(trimmed) as LichessRawGame;
    return game && typeof game.id === "string" ? game : null;
  } catch {
    return null;
  }
}

/** NDJSON: one JSON game per line. A line that does not parse is skipped,
 * so one bad record cannot lose the rest. */
export function parseNdjson(text: string): LichessRawGame[] {
  const games: LichessRawGame[] = [];
  for (const line of text.split("\n")) {
    const game = parseNdjsonLine(line);
    if (game) games.push(game);
  }
  return games;
}

/** The games URL, with the same fields every Lichess request asks for so a
 * stored game has the same shape whichever path fetched it. `sinceMs` and
 * `untilMs` are milliseconds. */
export function lichessGamesUrl(username: string, opts: { max: number; sinceMs?: number; untilMs?: number }): string {
  const params = new URLSearchParams({
    max: String(opts.max),
    pgnInJson: "true",
    clocks: "true",
    opening: "true",
  });
  if (opts.sinceMs !== undefined) params.set("since", String(opts.sinceMs));
  if (opts.untilMs !== undefined) params.set("until", String(opts.untilMs));
  return `${LICHESS_API_BASE}/games/user/${encodeURIComponent(username)}?${params.toString()}`;
}

/** The newest `max` games, newest first. `sinceMs` limits it to games
 * played after that time, for an incremental re-sync. */
export async function fetchLichessGames(
  username: string,
  opts: { max: number; sinceMs?: number; untilMs?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<LichessRawGame[]> {
  const url = lichessGamesUrl(username, opts);

  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Accept: "application/x-ndjson" } });
  } catch {
    throw new LichessHttpError(0, "Could not reach Lichess. Check your connection and try again.");
  }
  if (!response.ok) throw new LichessHttpError(response.status, messageFor(response.status, username));
  return parseNdjson(await response.text());
}

/** The same request as fetchLichessGames, but the body is read as it
 * arrives and each game is handed out as soon as its line is complete. A line
 * can be split across two network chunks, so bytes are held until the
 * newline. Stops reading (and closes the connection) when the caller stops
 * iterating or `signal` aborts. Used by the full-history sync, where one
 * response can be long. */
export async function* streamLichessGames(
  username: string,
  opts: { max: number; sinceMs?: number; untilMs?: number },
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): AsyncGenerator<LichessRawGame> {
  const url = lichessGamesUrl(username, opts);

  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Accept: "application/x-ndjson" }, signal });
  } catch {
    if (signal?.aborted) return;
    throw new LichessHttpError(0, "Could not reach Lichess. Check your connection and try again.");
  }
  if (!response.ok) throw new LichessHttpError(response.status, messageFor(response.status, username));

  if (!response.body) {
    // No streaming in this environment: fall back to the whole body.
    for (const game of parseNdjson(await response.text())) yield game;
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      if (signal?.aborted) return;
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        if (signal?.aborted) return;
        throw new LichessHttpError(0, "The connection to Lichess dropped. Check your connection and try again.");
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const game = parseNdjsonLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (game) yield game;
        newline = buffer.indexOf("\n");
      }
    }
    const last = parseNdjsonLine(buffer + decoder.decode());
    if (last) yield last;
  } finally {
    reader.cancel().catch(() => {});
  }
}
