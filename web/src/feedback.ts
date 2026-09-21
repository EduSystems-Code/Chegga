// Chegga Web — Featurebase feedback widget (opt-in, inert until configured)
//
// Nothing from Featurebase loads with the page. The SDK and its widget
// iframe load the first time a visitor clicks the header "Feedback" button —
// the same rule feedbackForm.ts follows for Tally. A visitor who never asks
// to give feedback never contacts Featurebase.
//
// This module does NOTHING until FEATUREBASE_ORG below is filled in with a
// real Featurebase organization slug (the subdomain part of your
// <slug>.featurebase.app portal URL). With it empty, the Feedback button
// stays hidden — so this is safe to ship in that state.
//
// To activate:
//   1. Set FEATUREBASE_ORG to your org slug.
//   2. Optionally set FEATUREBASE_BOARD to the board new posts should land
//      on (e.g. "chegga-web" if you run all projects through one org).
//   3. Rebuild and deploy. A "Feedback" button appears in the header.
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

let loading = false;
let ready = false;
let openWhenReady = false;

function openWidget(): void {
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

/** The SDK never loaded (an ad blocker or a network failure). Reset so the
 * next click retries, and send the visitor to the public feedback page so
 * the click still does something. */
function onSdkFailed(): void {
  document.getElementById("featurebase-sdk")?.remove();
  delete window.Featurebase; // drop the queued init so a retry starts clean
  loading = false;
  openWhenReady = false;
  window.open(`https://${FEATUREBASE_ORG}.featurebase.app/`, "_blank", "noopener");
}

/** Loads the SDK and starts the widget. Called once per attempt, from the
 * first Feedback click. */
function loadWidget(): void {
  loading = true;

  // Standard command-queue shim: calls made before the SDK loads are queued
  // and replayed by the SDK.
  const fb: FeaturebaseFn = function (...args: unknown[]) {
    (fb.q = fb.q || []).push(args);
  };
  window.Featurebase = fb;

  const s = document.createElement("script");
  s.id = "featurebase-sdk";
  s.src = "https://do.featurebase.app/js/sdk.js";
  s.onerror = onSdkFailed;
  document.head.appendChild(s);

  fb(
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
      if (callback?.action !== "widgetReady") return;
      ready = true;
      loading = false;
      // The open message is only heard once the widget iframe exists, so the
      // first click waits for this callback instead of posting straight away.
      if (openWhenReady) {
        openWhenReady = false;
        openWidget();
      }
    },
  );
}

function onFeedbackClick(): void {
  if (ready) {
    openWidget();
    return;
  }
  openWhenReady = true;
  if (!loading) loadWidget();
}

/** Call once at startup. Shows the header Feedback button when an org slug
 * is configured. Loads nothing until the button is clicked. */
export function setupFeedbackWidget(): void {
  const btn = document.getElementById("feedback-btn");
  if (!FEATUREBASE_ORG || !btn) return;
  btn.hidden = false;
  btn.addEventListener("click", onFeedbackClick);
}
