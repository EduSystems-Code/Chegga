import type { MoveAnalysis } from "../types/game";

const CLASS_COLOR: Record<string, string> = {
  best: "#4caf50",
  excellent: "#8bc34a",
  good: "#cddc39",
  inaccuracy: "#ffb300",
  mistake: "#fb8c00",
  blunder: "#e53935",
};

export default function MoveList({ moves }: { moves: MoveAnalysis[] }) {
  return (
    <table className="move-list">
      <thead>
        <tr>
          <th>#</th>
          <th>Side</th>
          <th>Move</th>
          <th>Best</th>
          <th>CP loss</th>
          <th>Class</th>
          <th>Phase</th>
        </tr>
      </thead>
      <tbody>
        {moves.map((m) => (
          <tr key={m.ply}>
            <td>
              {Math.ceil(m.ply / 2)}
              {m.side_to_move === "white" ? "." : "…"}
            </td>
            <td>{m.side_to_move}</td>
            <td>{m.san}</td>
            <td>{m.best_move_san ?? "—"}</td>
            <td>{m.centipawn_loss}</td>
            <td>
              <span className="badge" style={{ background: CLASS_COLOR[m.classification] ?? "#999" }}>
                {m.classification}
              </span>
            </td>
            <td>{m.game_phase}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
