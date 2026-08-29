import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import Board from "../components/Board";
import { CLASS_COLOR, CLASSIFICATION_ORDER } from "../lib/classification";
import type { Drill, DrillAttemptResult, DrillStats } from "../types/game";

// "1. e4 e5 2. Nf3 Nc6 ..." from the flat ply-ordered SAN list the backend
// sends -- pairs white/black by index; an odd-length history (the drill
// position is Black to move, so the last White move has no reply yet)
// just prints that last move without a pair.
function formatMoveHistory(history: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < history.length; i += 2) {
    const moveNumber = i / 2 + 1;
    const white = history[i];
    const black = history[i + 1];
    parts.push(black ? `${moveNumber}. ${white} ${black}` : `${moveNumber}. ${white}`);
  }
  return parts.join("  ");
}

export default function DrillsPage() {
  const [drill, setDrill] = useState<Drill | null>(null);
  const [result, setResult] = useState<DrillAttemptResult | null>(null);
  const [stats, setStats] = useState<DrillStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(() => {
    api.drillStats().then(setStats).catch(() => {});
  }, []);

  const loadNext = useCallback(() => {
    setLoading(true);
    setResult(null);
    setError(null);
    api
      .nextDrill()
      .then(setDrill)
      .catch((e) => {
        setDrill(null);
        setError(String(e));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadNext();
    loadStats();
  }, [loadNext, loadStats]);

  const handleMove = async (san: string) => {
    if (!drill || result) return;
    const outcome = await api.attemptDrill(drill.move_analysis_id, san);
    setResult(outcome);
    loadStats();
  };

  const accuracyTotal = drill ? Object.values(drill.accuracy).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="page">
      <h2>Drills</h2>
      {stats && (
        <p className="status">
          {stats.solved} / {stats.total_mistakes} mistakes solved ({stats.attempted} attempted so far)
        </p>
      )}
      {loading ? (
        <p className="status">Loading a drill…</p>
      ) : error ? (
        <p className="status status-error">{error}</p>
      ) : !drill ? (
        <p className="status">No unsolved mistakes right now — nice work, or analyze more games to find more.</p>
      ) : (
        <div className="drill">
          <p className="status">
            vs {drill.opponent}
            {drill.opening_name && ` — ${drill.opening_name}`} — find {drill.side_to_move}'s best move
          </p>

          {drill.move_history.length > 0 && (
            <p className="drill-notation">{formatMoveHistory(drill.move_history)}</p>
          )}

          {accuracyTotal > 0 && (
            <>
              <p className="status">Your accuracy in this game up to this point:</p>
              <div className="classification-bar drill-accuracy-bar">
                {CLASSIFICATION_ORDER.filter((c) => drill.accuracy[c]).map((c) => (
                  <div
                    key={c}
                    className="classification-segment"
                    style={{ flexGrow: drill.accuracy[c], background: CLASS_COLOR[c] }}
                  >
                    <span>{c} {drill.accuracy[c]}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <p className="status drill-hint">Drag a piece to make your move.</p>
          <Board fen={drill.fen} interactive={!result} onMove={handleMove} />

          {result && (
            <div className={`drill-result ${result.correct ? "status" : "status-error"}`}>
              <span>{result.correct ? "Correct!" : `Not quite — the best move was ${result.correct_san}.`}</span>
              <button onClick={loadNext}>Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
