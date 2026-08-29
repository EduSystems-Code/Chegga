// The mark: a knight's-move path (two up, one across) in a rounded square --
// distinct from a literal chess-piece silhouette, but unmistakably chess,
// and it doubles as the loading screen's draw-in animation target (the same
// path, animated via stroke-dasharray in LoadingScreen.tsx). Reused as-is
// for the favicon (index.html) as an inlined data URI of this exact markup.
export function LogoMark({ size = 28, animate = false }: { size?: number; animate?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={animate ? "logo-mark logo-mark-animate" : "logo-mark"}
    >
      <rect width="32" height="32" rx="7" fill="var(--bg-elevated)" />
      <path
        d="M10 24V11h11"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
      />
      <circle cx="21" cy="11" r="2.1" fill="var(--accent)" />
    </svg>
  );
}

export default function Logo({ size = 28, wordmark = true }: { size?: number; wordmark?: boolean }) {
  return (
    <span className="logo-lockup">
      <LogoMark size={size} />
      {wordmark && <span className="logo-word">Chegga</span>}
    </span>
  );
}
