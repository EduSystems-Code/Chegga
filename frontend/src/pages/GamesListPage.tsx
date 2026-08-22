import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { GameSummary, SyncStatus } from "../types/game";

export default function GamesListPage() {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

  const loadGames = () => {
    setLoading(true);
    api
      .listGames()
      .then(setGames)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(loadGames, []);

  const handleSync = async () => {
    await api.startSync();
    const poll = setInterval(async () => {
      const status = await api.syncStatus();
      setSyncStatus(status);
      if (status.state === "done" || status.state === "error") {
        clearInterval(poll);
        loadGames();
      }
    }, 1500);
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
    </div>
  );
}
