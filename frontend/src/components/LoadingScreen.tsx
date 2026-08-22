import { LogoMark } from "./Logo";

// Shown by App.tsx for a minimum stretch on first mount (see the timing
// logic there) so the brand mark actually registers even on a fast local
// load, rather than flashing. The knight-path stroke draws itself in via
// CSS (see .logo-mark-animate in index.css) instead of a generic spinner.
export default function LoadingScreen({ fadingOut }: { fadingOut: boolean }) {
  return (
    <div className={`loading-screen ${fadingOut ? "fading" : ""}`}>
      <LogoMark size={64} animate />
      <div className="loading-wordmark">Chegga</div>
      <div className="loading-hint">reading the board…</div>
    </div>
  );
}
