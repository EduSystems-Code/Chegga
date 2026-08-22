import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
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
  RatingGapBucket,
  RivalRecord,
  StrengthPrediction,
  StrengthTrainStatus,
  TimePressureBucket,
} from "../types/game";

// Same idea as CLASS_COLOR below, one color per blunder_tag so the same
// pattern reads consistently wherever it shows up.
const TAG_LABEL: Record<string, string> = {
  missed_mate: "missed mate",
  allowed_mate: "allowed mate",
  hung_material: "hung material",
  missed_capture: "missed capture",
  positional: "positional",
};
const TAG_COLOR: Record<string, string> = {
  missed_mate: "#e53935",
  allowed_mate: "#d81b60",
  hung_material: "#fb8c00",
  missed_capture: "#ffb300",
  positional: "#9aa2b1",
};

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

  const [rivals, setRivals] = useState<RivalRecord[]>([]);
  const [ratingGap, setRatingGap] = useState<RatingGapBucket[]>([]);
  const [timePressure, setTimePressure] = useState<TimePressureBucket[]>([]);

  useEffect(() => {
    api.getProfile().then(setProfile).catch((e) => setError(String(e)));
    api.strengthTrainingStatus().then(setStrengthStatus).catch(() => {});
    api.latestCoachingReport().then(setReport).catch(() => {});
    api.getRivals().then(setRivals).catch(() => {});
    api.getRatingGap().then(setRatingGap).catch(() => {});
    api.getTimePressure().then(setTimePressure).catch(() => {});
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

          {Object.keys(profile.blunder_tag_counts).length > 0 && (
            <>
              <h3>Blunder patterns — why, not just how costly</h3>
              <div className="classification-bar">
                {Object.entries(profile.blunder_tag_counts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([tag, count]) => {
                    const total = Object.values(profile.blunder_tag_counts).reduce((a, b) => a + b, 0);
                    return (
                      <div
                        key={tag}
                        className="classification-segment"
                        style={{ flexGrow: count, background: TAG_COLOR[tag] ?? "#9aa2b1" }}
                      >
                        <span>
                          {TAG_LABEL[tag] ?? tag} {((count / total) * 100).toFixed(0)}%
                        </span>
                      </div>
                    );
                  })}
              </div>
            </>
          )}

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

          {timePressure.some((b) => b.moves > 0) && (
            <>
              <h3>Blunder rate by time remaining</h3>
              <p className="status">
                Live time controls only (bullet/blitz/rapid) — from the real clock time on each of your moves, not an estimate.
              </p>
              <div className="eval-graph">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={timePressure} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                    <Tooltip formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`} />
                    <Bar dataKey="blunder_rate" name="Blunder rate" fill="#e53935" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

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

          {rivals.length > 0 && (
            <>
              <h3>Rivals (2+ games played)</h3>
              <table>
                <thead>
                  <tr>
                    <th>Opponent</th>
                    <th>Games</th>
                    <th>W</th>
                    <th>L</th>
                    <th>D</th>
                    <th>Win rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rivals.map((r) => (
                    <tr key={r.opponent}>
                      <td>{r.opponent}</td>
                      <td>{r.games}</td>
                      <td>{r.wins}</td>
                      <td>{r.losses}</td>
                      <td>{r.draws}</td>
                      <td>{(r.win_rate * 100).toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {ratingGap.some((b) => b.games > 0) && (
            <>
              <h3>Performance by opponent strength</h3>
              <div className="eval-graph">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={ratingGap} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} domain={[0, 1]} />
                    <Tooltip formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`} />
                    <Bar dataKey="win_rate" name="Win rate" fill="#4f8ef7" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

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
