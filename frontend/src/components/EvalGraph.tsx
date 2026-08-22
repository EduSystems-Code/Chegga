import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MoveAnalysis } from "../types/game";

const CLAMP = 1000; // display clamp for mate-adjacent eval spikes, matches the backend's own cap

export default function EvalGraph({ moves }: { moves: MoveAnalysis[] }) {
  const data = moves.map((m) => ({
    ply: m.ply,
    eval: Math.max(-CLAMP, Math.min(CLAMP, m.eval_after_cp ?? 0)),
  }));

  return (
    <div className="eval-graph">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="ply" tick={{ fontSize: 11 }} />
          <YAxis domain={[-CLAMP, CLAMP]} tick={{ fontSize: 11 }} />
          <ReferenceLine y={0} stroke="currentColor" opacity={0.4} />
          <Tooltip
            formatter={(v) => (typeof v === "number" ? (v / 100).toFixed(2) : String(v))}
            labelFormatter={(p) => `Ply ${p}`}
          />
          <Line
            type="monotone"
            dataKey="eval"
            stroke="#4f8ef7"
            dot={false}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
