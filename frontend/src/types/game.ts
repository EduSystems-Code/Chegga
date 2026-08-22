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
