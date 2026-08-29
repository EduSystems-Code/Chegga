// Chegga Web — Featurebase feedback widget (opt-in, inert until configured)
//
// This module does NOTHING until FEATUREBASE_ORG below is filled in with a
// real Featurebase organization slug (the subdomain part of your
// <slug>.featurebase.app portal URL). With it empty, no third-party script
// is loaded, no network request is made, and the Feedback button stays
// hidden — so this is safe to ship in that state.
//
// To activate:
//   1. Set FEATUREBASE_ORG to your org slug.
//   2. Optionally set FEATUREBASE_BOARD to the board new posts should land
//      on (e.g. "chegga-web" if you run all projects through one org).
//   3. Rebuild and deploy. A "Feedback" button appears in the header and
//      also floats at the screen edge (Featurebase's own `placement`).
//
// Docs: https://help.featurebase.app/en/help/articles/1261560-install-feedback-widget

const FEATUREBASE_ORG = "mibottega"; // org slug — the subdomain of your <slug>.featurebase.app portal
// One shared org across all four products (PixelRoom, Chegga Web, Little
// Sprout Stories, Atlas); each site points at its own board so feedback
// lands sorted. This must match a board that actually exists in the
// dashboard — if it doesn't, the widget just opens on the default board.
const FEATUREBASE_BOARD = "chegga-web";

interface FeaturebaseFn {
  (...args: unknown[]): void;
  q?: unknown[];
}
declare global {
  interface Window {
    Featurebase?: FeaturebaseFn;
  }
}

/** Loads the Featurebase SDK once and queues calls made before it's ready
 * (the standard command-queue shim). No-op if already present. */
function loadSdk(): void {
  if (typeof window.Featurebase !== "function") {
    const fb: FeaturebaseFn = function (...args: unknown[]) {
      (fb.q = fb.q || []).push(args);
    };
    window.Featurebase = fb;
  }
  if (document.getElementById("featurebase-sdk")) return;
  const s = document.createElement("script");
  s.id = "featurebase-sdk";
  s.src = "https://do.featurebase.app/js/sdk.js";
  document.head.appendChild(s);
}

/** Opens the feedback widget, optionally targeting a specific board. Safe
 * to call before the SDK finishes loading — the message is delivered once
 * the widget iframe is listening. */
export function openFeedbackWidget(): void {
  if (!FEATUREBASE_ORG) return;
  window.postMessage(
    {
      target: "FeaturebaseWidget",
      data: {
        action: "openFeedbackWidget",
        ...(FEATUREBASE_BOARD ? { setBoard: FEATUREBASE_BOARD } : {}),
      },
    },
    "*",
  );
}

/** Call once at startup. Reveals the header Feedback button and initializes
 * the edge widget — but only when an org slug is configured. */
export function setupFeedbackWidget(): void {
  const btn = document.getElementById("feedback-btn");
  if (!FEATUREBASE_ORG) {
    // Leave the button hidden; nothing else to do.
    return;
  }

  loadSdk();
  window.Featurebase?.(
    "initialize_feedback_widget",
    {
      organization: FEATUREBASE_ORG,
      theme: "dark",
      // No `placement` — we drive the widget from the header "Feedback"
      // button only, rather than also showing Featurebase's own purple
      // edge tab (which clashes with the site's dark/gold).
      ...(FEATUREBASE_BOARD ? { defaultBoard: FEATUREBASE_BOARD } : {}),
    },
    (_err: unknown, callback: { action?: string } | undefined) => {
      if (callback?.action === "widgetReady" && btn) {
        btn.hidden = false;
      }
    },
  );

  if (btn) {
    btn.hidden = false; // show immediately; the widget queues the open call
    btn.addEventListener("click", openFeedbackWidget);
  }
}
