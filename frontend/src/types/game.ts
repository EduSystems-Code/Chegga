export interface GameSummary {
  id: number;
  chess_com_uuid: string;
  url: string;
  time_class: string;
  rated: boolean;
  end_time: number;
  eco: string | null;
  opening_name: string | null;
  white_username: string;
  white_rating: number;
  black_username: string;
  black_rating: number;
  user_color: "white" | "black";
  user_result: "win" | "loss" | "draw";
  analyzed: boolean;
}

export interface MoveAnalysis {
  ply: number;
  side_to_move: "white" | "black";
  san: string;
  uci: string;
  eval_before_cp: number | null;
  eval_before_mate: number | null;
  eval_after_cp: number | null;
  eval_after_mate: number | null;
  best_move_san: string | null;
  centipawn_loss: number;
  move_rank: number | null;
  classification: string;
  game_phase: string;
}

export interface GameDetail extends GameSummary {
  pgn: string;
  moves: MoveAnalysis[];
}

export interface SyncStatus {
  state: "idle" | "running" | "done" | "error";
  months_processed: number;
  games_added: number;
  last_error: string | null;
}

export interface OpeningStat {
  opening_name: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface MonthlyStat {
  year_month: string;
  games: number;
  avg_centipawn_loss: number;
  blunder_rate: number;
}

export interface ProfileSummary {
  games_analyzed: number;
  total_moves: number;
  avg_centipawn_loss: number;
  classification_counts: Record<string, number>;
  classification_rate: Record<string, number>;
  phase_avg_cp_loss: Record<string, number>;
  color_avg_cp_loss: Record<string, number>;
  time_class_breakdown: Record<string, number>;
  top_openings: OpeningStat[];
  monthly_trend: MonthlyStat[];
}

export interface StrengthTrainStatus {
  state: "idle" | "running" | "done" | "error";
  n_samples: number | null;
  cv_folds: number | null;
  cv_mae: number | null;
  cv_r2: number | null;
  trained_at: string | null;
  last_error: string | null;
}

export interface StrengthPrediction {
  game_id: number;
  end_time: number;
  time_class: string;
  actual_rating: number;
  predicted_rating: number;
}

export interface Drill {
  move_analysis_id: number;
  fen: string;
  side_to_move: "white" | "black";
  game_id: number;
  opponent: string;
  choices: string[];
}

export interface DrillAttemptResult {
  correct: boolean;
  correct_san: string;
}

export interface DrillStats {
  total_mistakes: number;
  attempted: number;
  solved: number;
}

export interface CoachingReport {
  id: number;
  model: string;
  games_analyzed_count: number;
  headline: string;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  focus_area: string;
  opening_notes: string;
  encouragement: string;
  created_at: string;
}

export interface CoachingStatus {
  state: "idle" | "running" | "done" | "error";
  last_error: string | null;
}
