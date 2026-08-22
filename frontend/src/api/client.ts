import type {
  AnalysisStatus,
  CoachingReport,
  CoachingStatus,
  Drill,
  DrillAttemptResult,
  DrillStats,
  GameDetail,
  GameSummary,
  ProfileSummary,
  StrengthPrediction,
  StrengthTrainStatus,
  SyncStatus,
} from "../types/game";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `${init?.method ?? "GET"} ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const postJson = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  health: () => request<{ status: string }>("/api/health"),
  listGames: () => request<GameSummary[]>("/api/games"),
  getGame: (id: number) => request<GameDetail>(`/api/games/${id}`),
  startSync: () => request<{ message: string }>("/api/sync", { method: "POST" }),
  syncStatus: () => request<SyncStatus>("/api/sync/status"),

  startAnalysis: (limit: number) => request<{ message: string }>(`/api/analysis/run?limit=${limit}`, { method: "POST" }),
  analysisStatus: () => request<AnalysisStatus>("/api/analysis/status"),

  getProfile: () => request<ProfileSummary>("/api/profile"),

  startStrengthTraining: () => request<{ message: string }>("/api/strength/train", { method: "POST" }),
  strengthTrainingStatus: () => request<StrengthTrainStatus>("/api/strength/status"),
  strengthPredictions: () => request<StrengthPrediction[]>("/api/strength/predictions"),

  nextDrill: () => request<Drill>("/api/drills/next"),
  attemptDrill: (moveAnalysisId: number, chosenSan: string) =>
    postJson<DrillAttemptResult>(`/api/drills/${moveAnalysisId}/attempt`, { chosen_san: chosenSan }),
  drillStats: () => request<DrillStats>("/api/drills/stats"),

  startCoachingGeneration: () => request<{ message: string }>("/api/coaching/generate", { method: "POST" }),
  coachingStatus: () => request<CoachingStatus>("/api/coaching/status"),
  latestCoachingReport: () => request<CoachingReport>("/api/coaching/latest"),
};
