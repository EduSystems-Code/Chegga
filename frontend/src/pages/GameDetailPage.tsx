import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import type { GameDetail } from "../types/game";
import EvalGraph from "../components/EvalGraph";
import MoveList from "../components/MoveList";

export default function GameDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [game, setGame] = useState<GameDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.getGame(Number(id)).then(setGame).catch((e) => setError(String(e)));
  }, [id]);

  if (error) return <p className="status status-error">{error}</p>;
  if (!game) return <p className="status">Loading…</p>;

  const opponent = game.user_color === "white" ? game.black_username : game.white_username;

  return (
    <div className="page">
      <h2>
        vs {opponent} — {game.user_result} ({game.time_class})
      </h2>
      {game.moves.length === 0 ? (
        <p className="status">Not analyzed yet. Run the analysis pipeline for this game.</p>
      ) : (
        <>
          <EvalGraph moves={game.moves} />
          <MoveList moves={game.moves} />
        </>
      )}
    </div>
  );
}
