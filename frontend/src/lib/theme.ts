// Mirrors the CSS custom properties in index.css -- Recharts color props take
// a literal string, not a CSS var, so anything charted needs its hex here too.
// Keep these two files in sync by hand; there are only a handful of values.
export const chartColors = {
  accent: "#e3a857",
  accentStrong: "#f0be73",
  win: "#4ade80",
  loss: "#f2555a",
  info: "#5b8def",
  muted: "#8a93a6",
  border: "#232833",
  grid: "#232833",
};

// Recharts' <Tooltip> renders a white box by default unless contentStyle is
// set -- every chart in the app passes this so none of them flash a jarring
// light-mode tooltip against the dark theme.
export const chartTooltipStyle = {
  contentStyle: {
    background: "#12151b",
    border: "1px solid #232833",
    borderRadius: 8,
    fontSize: 12,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  },
  labelStyle: { color: "#8a93a6" },
  itemStyle: { color: "#edeff3" },
};
