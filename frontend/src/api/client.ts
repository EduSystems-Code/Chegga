import type { GameDetail, GameSummary, SyncStatus } from "../types/game";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, init);
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string }>("/api/health"),
  listGames: () => request<GameSummary[]>("/api/games"),
  getGame: (id: number) => request<GameDetail>(`/api/games/${id}`),
  startSync: () => request<{ message: string }>("/api/sync", { method: "POST" }),
  syncStatus: () => request<SyncStatus>("/api/sync/status"),
};
