import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { AnalysisStatus, GameSummary, SyncStatus } from "../types/game";

const ANALYSIS_BATCH_SIZE = 50;
const PAGE_SIZE = 50;

export default function GamesListPage() {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus | null>(null);

  const loadGames = () => {
    setLoading(true);
    api
      .listGames(0, PAGE_SIZE)
      .then((page) => {
        setGames(page);
        setHasMore(page.length === PAGE_SIZE);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  const loadMore = () => {
    setLoadingMore(true);
    api
      .listGames(games.length, PAGE_SIZE)
      .then((page) => {
        setGames((prev) => [...prev, ...page]);
        setHasMore(page.length === PAGE_SIZE);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingMore(false));
  };

  const loadAnalysisStatus = () => {
    api.analysisStatus().then(setAnalysisStatus).catch(() => {});
  };

  useEffect(loadGames, []);
  useEffect(loadAnalysisStatus, []);

  const handleSync = async () => {
    await api.startSync();
    const poll = setInterval(async () => {
      const status = await api.syncStatus();
      setSyncStatus(status);
      if (status.state === "done" || status.state === "error") {
        clearInterval(poll);
        loadGames();
        loadAnalysisStatus(); // a sync can pull in new unanalyzed games -- refresh the pending count too
      }
    }, 1500);
  };

  const handleAnalyze = async () => {
    await api.startAnalysis(ANALYSIS_BATCH_SIZE);
    const poll = setInterval(async () => {
      const status = await api.analysisStatus();
      setAnalysisStatus(status);
      if (status.state === "done" || status.state === "error") {
        clearInterval(poll);
        loadGames();
      }
    }, 2000);
  };

  if (loading) return <p className="status">Loading games…</p>;
  if (error) return <p className="status status-error">{error}</p>;

  return (
    <div className="page">
      <div className="page-toolbar">
        <button onClick={handleSync}>Sync from Chess.com</button>
        {syncStatus && (
          <span className="sync-note">
            {syncStatus.state}
            {syncStatus.state === "done" && ` — ${syncStatus.games_added} new games`}
            {syncStatus.state === "error" && `: ${syncStatus.last_error}`}
          </span>
        )}
      </div>
      <div className="page-toolbar">
        <button onClick={handleAnalyze} disabled={analysisStatus?.state === "running" || analysisStatus?.pending_games === 0}>
          {analysisStatus?.state === "running" ? "Analyzing…" : `Analyze next ${ANALYSIS_BATCH_SIZE} with Stockfish`}
        </button>
        {analysisStatus && (
          <span className="sync-note">
            {analysisStatus.analyzed_games} / {analysisStatus.total_games} analyzed
            {analysisStatus.pending_games > 0 && ` (${analysisStatus.pending_games} pending)`}
            {analysisStatus.state === "error" && ` — ${analysisStatus.last_error}`}
          </span>
        )}
      </div>
      {games.length === 0 ? (
        <p className="status">No games synced yet.</p>
      ) : (
        <table className="games-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Opponent</th>
              <th>Color</th>
              <th>Result</th>
              <th>Time class</th>
              <th>Analyzed</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g) => {
              const opponent = g.user_color === "white" ? g.black_username : g.white_username;
              return (
                <tr key={g.id}>
                  <td>{new Date(g.end_time * 1000).toLocaleDateString()}</td>
                  <td><Link to={`/games/${g.id}`}>{opponent}</Link></td>
                  <td>{g.user_color}</td>
                  <td className={`result-${g.user_result}`}>{g.user_result}</td>
                  <td>{g.time_class}</td>
                  <td>{g.analyzed ? "✓" : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {hasMore && games.length > 0 && (
        <div className="page-toolbar">
          <button onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : `Load ${PAGE_SIZE} more`}
          </button>
        </div>
      )}
    </div>
  );
}
