import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import Board from "../components/Board";
import type { Drill, DrillAttemptResult, DrillStats } from "../types/game";

export default function DrillsPage() {
  const [drill, setDrill] = useState<Drill | null>(null);
  const [result, setResult] = useState<DrillAttemptResult | null>(null);
  const [chosenSan, setChosenSan] = useState<string | null>(null);
  const [stats, setStats] = useState<DrillStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(() => {
    api.drillStats().then(setStats).catch(() => {});
  }, []);

  const loadNext = useCallback(() => {
    setLoading(true);
    setResult(null);
    setChosenSan(null);
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

  const choose = async (san: string) => {
    if (!drill || result) return;
    setChosenSan(san);
    const outcome = await api.attemptDrill(drill.move_analysis_id, san);
    setResult(outcome);
    loadStats();
  };

  const choiceClass = (san: string) => {
    if (!result) return "drill-choice";
    if (san === result.correct_san) return "drill-choice correct";
    if (san === chosenSan) return "drill-choice incorrect";
    return "drill-choice";
  };

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
            vs {drill.opponent} — find {drill.side_to_move}'s best move
          </p>
          <Board fen={drill.fen} />
          <div className="drill-choices">
            {drill.choices.map((san) => (
              <button key={san} disabled={!!result} className={choiceClass(san)} onClick={() => choose(san)}>
                {san}
              </button>
            ))}
          </div>
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
