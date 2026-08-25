// Chegga Web — on-page error overlay
//
// VS Code's Simple Browser doesn't expose dev tools at all (by design),
// so "check the console" isn't an option there. This installs global
// `error`/`unhandledrejection` listeners that render the actual error
// text directly on the page instead -- readable and copyable without
// dev tools in any browser, restricted or not. Imported first, before
// anything else in main.ts, specifically so it's listening before any
// other module's top-level code has a chance to throw.

let overlayEl: HTMLDivElement | null = null;

function ensureOverlay(): HTMLDivElement {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement("div");
  overlayEl.id = "chegga-error-overlay";
  overlayEl.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "right:0",
    "z-index:99999",
    "background:#3a0d0d",
    "color:#ffd7d7",
    "font-family:monospace",
    "font-size:12px",
    "white-space:pre-wrap",
    "word-break:break-word",
    "padding:10px 14px",
    "max-height:40vh",
    "overflow-y:auto",
    "border-bottom:2px solid #f2555a",
  ].join(";");
  // Appended even before <body> may fully exist yet in edge cases --
  // documentElement always exists by the time any script runs.
  (document.body ?? document.documentElement).appendChild(overlayEl);
  return overlayEl;
}

function reportError(label: string, detail: string): void {
  const el = ensureOverlay();
  const line = document.createElement("div");
  line.style.marginBottom = "8px";
  line.style.paddingBottom = "8px";
  line.style.borderBottom = "1px solid #5a2020";
  line.textContent = `[${new Date().toLocaleTimeString()}] ${label}: ${detail}`;
  el.appendChild(line);
}

export function installErrorOverlay(): void {
  window.addEventListener("error", (e) => {
    reportError("Error", `${e.message} (${e.filename ?? "?"}:${e.lineno ?? "?"}:${e.colno ?? "?"})`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    const detail = reason instanceof Error ? `${reason.message}\n${reason.stack ?? ""}` : String(reason);
    reportError("Unhandled promise rejection", detail);
  });
}
