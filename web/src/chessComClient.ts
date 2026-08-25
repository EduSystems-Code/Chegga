// Chegga Web — Chess.com Published-Data API client (Phase 1)
//
// Ported from Chegga's own `app/services/chess_com_client.py`, same
// contract: only the official read-only `api.chess.com/pub/...`
// endpoints, serial requests only (never parallel — that's what
// triggers 429s), a minimum spacing enforced client-side, exponential
// backoff honoring `Retry-After` on 429/5xx. A browser hitting the same
// public GET endpoint is exactly what Chess.com's PubAPI is meant for —
// no proxy, no server-side key.

const CHESS_COM_API_BASE = "https://api.chess.com/pub";

export interface ChessComPlayerSide {
  username: string;
  rating?: number;
  result: string;
}

export interface ChessComRawGame {
  uuid: string;
  url?: string;
  pgn?: string;
  time_control?: string;
  time_class?: string;
  rules?: string;
  rated?: boolean;
  end_time?: number;
  eco?: string;
  white: ChessComPlayerSide;
  black: ChessComPlayerSide;
}

/** Thrown for a non-retryable HTTP error so callers can special-case a
 * specific status (e.g. a 404 archive month) without string-matching a
 * generic Error's message. */
export class ChessComHttpError extends Error {
  status: number;

  constructor(status: number, url: string) {
    super(`Chess.com API request failed: ${status} ${url}`);
    this.status = status;
  }
}

export class ChessComClient {
  private minIntervalMs: number;
  private maxRetries: number;
  private lastRequestAt = 0;

  // `contact` no longer has anywhere to go (see the note on `get()` below
  // about why no custom header is sent) — kept as a required param so call
  // sites still read as "who's using this instance," but it's unused.
  constructor(_contact: string, opts: { minIntervalSeconds?: number; maxRetries?: number } = {}) {
    this.minIntervalMs = (opts.minIntervalSeconds ?? 1.0) * 1000;
    this.maxRetries = opts.maxRetries ?? 5;
  }

  private async throttle(): Promise<void> {
    const elapsed = performance.now() - this.lastRequestAt;
    const wait = this.minIntervalMs - elapsed;
    if (wait > 0) await sleep(wait);
  }

  private async get<T>(url: string): Promise<T> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      await this.throttle();
      // No custom headers: Chess.com's CORS preflight only allows the
      // browser's own simple-request headers, and a custom header here
      // (an attempted User-Agent/contact-string equivalent, like the
      // backend client sends) makes the preflight fail outright. Browsers
      // also restrict/override User-Agent on fetch regardless, so there's
      // no real equivalent to Python's requests-level UA string from here.
      const response = await fetch(url);
      this.lastRequestAt = performance.now();

      if (response.ok) return (await response.json()) as T;

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = response.headers.get("Retry-After");
        const delayMs = retryAfter ? parseFloat(retryAfter) * 1000 : Math.min(2 ** attempt, 60) * 1000;
        console.warn(
          `Chess.com API ${response.status} on ${url} (attempt ${attempt}/${this.maxRetries}) — backing off ${delayMs}ms`,
        );
        await sleep(delayMs);
        continue;
      }

      throw new ChessComHttpError(response.status, url);
    }

    throw new Error(`Chess.com API request failed after ${this.maxRetries} retries: ${url}`);
  }

  async getArchiveUrls(username: string): Promise<string[]> {
    const data = await this.get<{ archives?: string[] }>(
      `${CHESS_COM_API_BASE}/player/${encodeURIComponent(username)}/games/archives`,
    );
    return data.archives ?? [];
  }

  async getArchive(archiveUrl: string): Promise<ChessComRawGame[]> {
    const data = await this.get<{ games?: ChessComRawGame[] }>(archiveUrl);
    return data.games ?? [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
