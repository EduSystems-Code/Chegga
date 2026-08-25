// Chegga Web — Stockfish WASM engine wrapper (Phase 0)
//
// Wraps the single-threaded stockfish-18-lite build (no SharedArrayBuffer/
// COOP-COEP headers required, unlike the multi-threaded build) as a Web
// Worker and speaks raw UCI over postMessage/onmessage.

export interface AnalysisLine {
  multipv: number;
  depth: number;
  scoreCp?: number; // mover-relative centipawns (as UCI reports it), mutually exclusive with scoreMate
  scoreMate?: number; // mover-relative moves-to-mate (negative = getting mated), mutually exclusive with scoreCp
  pv: string[]; // principal variation, UCI move strings
}

function parseInfoLine(line: string): AnalysisLine | null {
  if (!line.startsWith("info ") || !line.includes(" pv ")) return null;

  const depthMatch = /\bdepth (\d+)/.exec(line);
  const multipvMatch = /\bmultipv (\d+)/.exec(line);
  const cpMatch = /\bscore cp (-?\d+)/.exec(line);
  const mateMatch = /\bscore mate (-?\d+)/.exec(line);
  const pvMatch = /\bpv (.+)$/.exec(line);
  if (!depthMatch || !pvMatch) return null;

  return {
    depth: parseInt(depthMatch[1], 10),
    multipv: multipvMatch ? parseInt(multipvMatch[1], 10) : 1,
    scoreCp: cpMatch ? parseInt(cpMatch[1], 10) : undefined,
    scoreMate: mateMatch ? parseInt(mateMatch[1], 10) : undefined,
    pv: pvMatch[1].trim().split(/\s+/),
  };
}

export class Engine {
  private worker: Worker;
  private lineListeners: Array<(line: string) => void> = [];
  private currentMultipv = 1;
  // Set once and never cleared: a worker that failed to load/execute
  // doesn't recover. Every pending/future waitFor rejects immediately
  // against this instead of silently hanging until its own timeout --
  // in a restricted browser context that blocks Worker script loading,
  // there was previously no `worker.onerror` handler at all, so a
  // failure here produced no message back, ever: the caller just sat
  // waiting on its own setTimeout (10-30s) with nothing visibly wrong
  // in the meantime, which reads exactly like "it just stopped
  // responding" -- confirmed as the likely real cause, not assumed.
  private failed: string | null = null;
  private pendingRejects: Array<(err: Error) => void> = [];

  constructor() {
    this.worker = new Worker("/engine/stockfish-18-lite-single.js");
    this.worker.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === "string" ? e.data : String(e.data);
      for (const listener of this.lineListeners) listener(line);
    };
    this.worker.onerror = (e: ErrorEvent) => {
      const message = `Chess engine worker failed to load or crashed: ${e.message || "unknown error"} (${e.filename ?? "?"}:${e.lineno ?? "?"})`;
      this.failNow(message);
    };
  }

  private failNow(message: string): void {
    if (this.failed) return; // already failed, don't re-report on every subsequent message
    this.failed = message;
    const rejects = this.pendingRejects;
    this.pendingRejects = [];
    for (const reject of rejects) reject(new Error(message));
  }

  async init(): Promise<void> {
    await this.waitFor("uci", (line) => line.trim() === "uciok");
    await this.waitFor("isready", (line) => line.trim() === "readyok");
  }

  /**
   * Analyse one FEN to a fixed depth with the given MultiPV, mirroring
   * `engine_analysis.py`'s `_as_sorted_lines(engine.analyse(...))`: returns
   * one AnalysisLine per requested PV index, sorted by multipv, reflecting
   * the deepest info line seen for each before `bestmove` arrived (no
   * ready-made InfoDict here — the UCI `info depth ... multipv ... score
   * cp/mate ... pv ...` text has to be hand-parsed).
   */
  async analyse(
    fen: string,
    opts: { depth: number; multipv: number; movetimeMs?: number },
    timeoutMs = 30000,
  ): Promise<AnalysisLine[]> {
    if (opts.multipv !== this.currentMultipv) {
      this.send(`setoption name MultiPV value ${opts.multipv}`);
      this.currentMultipv = opts.multipv;
    }

    const byMultipv = new Map<number, AnalysisLine>();
    const listener = (line: string) => {
      const parsed = parseInfoLine(line);
      if (parsed) byMultipv.set(parsed.multipv, parsed);
    };
    this.lineListeners.push(listener);

    this.send(`position fen ${fen}`);
    // Same two-bound stop condition as the backend's
    // `chess.engine.Limit(depth=..., time=...)`: standard UCI semantics
    // stop the search at whichever of depth/movetime is hit first, not
    // "wait for both."
    const goCommand =
      opts.movetimeMs !== undefined ? `go depth ${opts.depth} movetime ${opts.movetimeMs}` : `go depth ${opts.depth}`;
    try {
      await this.waitFor(goCommand, (line) => line.startsWith("bestmove"), timeoutMs);
    } finally {
      this.lineListeners = this.lineListeners.filter((l) => l !== listener);
    }

    return Array.from(byMultipv.values()).sort((a, b) => a.multipv - b.multipv);
  }

  onLine(listener: (line: string) => void): void {
    this.lineListeners.push(listener);
  }

  send(command: string): void {
    this.worker.postMessage(command);
  }

  /** Send a command and resolve once a line matching `until` arrives. */
  waitFor(command: string, until: (line: string) => boolean, timeoutMs = 10000): Promise<string> {
    if (this.failed) return Promise.reject(new Error(this.failed));

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.lineListeners = this.lineListeners.filter((l) => l !== listener);
        this.pendingRejects = this.pendingRejects.filter((r) => r !== rejectNow);
      };
      const rejectNow = (err: Error) => {
        cleanup();
        reject(err);
      };
      const timer = setTimeout(() => {
        rejectNow(new Error(`Timed out waiting for response to "${command}"`));
      }, timeoutMs);

      const listener = (line: string) => {
        if (until(line)) {
          cleanup();
          resolve(line);
        }
      };
      this.lineListeners.push(listener);
      this.pendingRejects.push(rejectNow);
      this.send(command);
    });
  }

  terminate(): void {
    this.worker.terminate();
  }
}
