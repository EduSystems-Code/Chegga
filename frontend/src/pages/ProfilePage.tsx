import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import type {
  CoachingReport,
  ProfileSummary,
  StrengthPrediction,
  StrengthTrainStatus,
} from "../types/game";

const CLASSIFICATION_ORDER = ["best", "excellent", "good", "inaccuracy", "mistake", "blunder"];

// Same palette as MoveList's per-move badges, so a color means the same
// thing whether you're looking at one game or the aggregate profile.
const CLASS_COLOR: Record<string, string> = {
  best: "#4caf50",
  excellent: "#8bc34a",
  good: "#cddc39",
  inaccuracy: "#ffb300",
  mistake: "#fb8c00",
  blunder: "#e53935",
};

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [strengthStatus, setStrengthStatus] = useState<StrengthTrainStatus | null>(null);
  const [predictions, setPredictions] = useState<StrengthPrediction[]>([]);

  const [coachingState, setCoachingState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [coachingError, setCoachingError] = useState<string | null>(null);
  const [report, setReport] = useState<CoachingReport | null>(null);

  useEffect(() => {
    api.getProfile().then(setProfile).catch((e) => setError(String(e)));
    api.strengthTrainingStatus().then(setStrengthStatus).catch(() => {});
    api.latestCoachingReport().then(setReport).catch(() => {});
  }, []);

  useEffect(() => {
    if (strengthStatus?.state === "done") {
      api.strengthPredictions().then(setPredictions).catch(() => {});
    }
  }, [strengthStatus?.state]);

  const trainStrength = async () => {
    await api.startStrengthTraining();
    const poll = setInterval(async () => {
      const status = await api.strengthTrainingStatus();
      setStrengthStatus(status);
      if (status.state === "done" || status.state === "error") clearInterval(poll);
    }, 2000);
  };

  const generateCoaching = async () => {
    setCoachingState("running");
    setCoachingError(null);
    await api.startCoachingGeneration();
    const poll = setInterval(async () => {
      const status = await api.coachingStatus();
      if (status.state === "done") {
        clearInterval(poll);
        setCoachingState("done");
        api.latestCoachingReport().then(setReport).catch(() => {});
      } else if (status.state === "error") {
        clearInterval(poll);
        setCoachingState("error");
        setCoachingError(status.last_error);
      }
    }, 2000);
  };

  if (error) return <p className="status status-error">{error}</p>;
  if (!profile) return <p className="status">Loading profile…</p>;

  return (
    <div className="page">
      <h2>Profile</h2>

      {profile.games_analyzed === 0 ? (
        <p className="status">No analyzed games yet — run the analysis pipeline first.</p>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard label="Games analyzed" value={profile.games_analyzed} />
            <StatCard label="Avg centipawn loss" value={profile.avg_centipawn_loss} />
            <StatCard label="As white" value={profile.color_avg_cp_loss.white ?? "—"} />
            <StatCard label="As black" value={profile.color_avg_cp_loss.black ?? "—"} />
          </div>

          <h3>Move quality</h3>
          <div className="classification-bar">
            {CLASSIFICATION_ORDER.filter((c) => profile.classification_counts[c]).map((c) => (
              <div
                key={c}
                className="classification-segment"
                style={{ flexGrow: profile.classification_rate[c] ?? 0, background: CLASS_COLOR[c] }}
              >
                <span>
                  {c} {((profile.classification_rate[c] ?? 0) * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>

          <h3>By game phase</h3>
          <table>
            <thead>
              <tr>
                <th>Phase</th>
                <th>Avg centipawn loss</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(profile.phase_avg_cp_loss).map(([phase, loss]) => (
                <tr key={phase}>
                  <td>{phase}</td>
                  <td>{loss}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Play quality over time</h3>
          <div className="eval-graph">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={profile.monthly_trend} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="year_month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="avg_centipawn_loss" name="Avg CP loss" stroke="#4f8ef7" dot strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <h3>Top openings</h3>
          <table>
            <thead>
              <tr>
                <th>Opening</th>
                <th>Games</th>
                <th>W</th>
                <th>L</th>
                <th>D</th>
              </tr>
            </thead>
            <tbody>
              {profile.top_openings.map((o) => (
                <tr key={o.opening_name}>
                  <td>{o.opening_name}</td>
                  <td>{o.games}</td>
                  <td>{o.wins}</td>
                  <td>{o.losses}</td>
                  <td>{o.draws}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Strength model — predicted rating from play quality</h3>
          <div className="page-toolbar">
            <button onClick={trainStrength} disabled={strengthStatus?.state === "running"}>
              {strengthStatus?.state === "running" ? "Training…" : "Train / retrain"}
            </button>
            {strengthStatus?.state === "done" && (
              <span className="sync-note">
                {strengthStatus.n_samples} games, {strengthStatus.cv_folds}-fold CV — MAE {strengthStatus.cv_mae} rating
                points, R² {strengthStatus.cv_r2}
              </span>
            )}
            {strengthStatus?.state === "error" && <span className="sync-note status-error">{strengthStatus.last_error}</span>}
          </div>
          {predictions.length > 0 && (
            <div className="eval-graph">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={predictions} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="game_id" tick={{ fontSize: 11 }} />
                  <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="actual_rating" name="Actual rating" stroke="#4f8ef7" dot={false} strokeWidth={2} isAnimationActive={false} />
                  <Line type="monotone" dataKey="predicted_rating" name="Predicted from play quality" stroke="#4caf50" dot={false} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <h3>Coaching</h3>
          <div className="page-toolbar">
            <button onClick={generateCoaching} disabled={coachingState === "running"}>
              {coachingState === "running" ? "Generating…" : report ? "Regenerate report" : "Generate coaching report"}
            </button>
          </div>
          {coachingState === "error" && coachingError && <p className="status status-error">{coachingError}</p>}
          {report && (
            <div className="coaching-report">
              <h4>{report.headline}</h4>
              <p>{report.summary}</p>
              <div className="coaching-columns">
                <div>
                  <strong>Strengths</strong>
                  <ul>
                    {report.strengths.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Weaknesses</strong>
                  <ul>
                    {report.weaknesses.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <p>
                <strong>Focus area:</strong> {report.focus_area}
              </p>
              <p>
                <strong>Openings:</strong> {report.opening_notes}
              </p>
              <p className="status">{report.encouragement}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
