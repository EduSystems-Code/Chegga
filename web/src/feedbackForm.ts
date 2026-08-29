// Chegga Web — embedded Tally feedback form
//
// Loads a Tally form (https://tally.so/forms/aQqJVq) into #tally-embed the
// first time its card is opened, so the third-party script isn't fetched
// on a normal page load. Distinct from feedback.ts (Featurebase) — that's
// feature requests / roadmap; this is a plain form for open-ended notes.

const TALLY_FORM_ID = "aQqJVq";

declare global {
  interface Window {
    Tally?: { loadEmbeds: () => void };
  }
}

let loaded = false;

function loadTallyScript(): void {
  if (document.getElementById("tally-embed-script")) {
    window.Tally?.loadEmbeds();
    return;
  }
  const s = document.createElement("script");
  s.id = "tally-embed-script";
  s.src = "https://tally.so/widgets/embed.js";
  s.onload = () => window.Tally?.loadEmbeds();
  s.onerror = () => {
    // Fall back to a plain link if the embed script is blocked.
    const host = document.getElementById("tally-embed");
    if (host) {
      host.innerHTML =
        '<a href="https://tally.so/r/' +
        TALLY_FORM_ID +
        '" target="_blank" rel="noopener">Open the feedback form in a new tab</a>';
    }
  };
  document.head.appendChild(s);
}

/** Injects the Tally iframe into #tally-embed and loads the embed script.
 * Safe to call more than once — only does the work the first time. */
export function loadFeedbackForm(): void {
  if (loaded) return;
  const host = document.getElementById("tally-embed");
  if (!host) return;
  loaded = true;

  const iframe = document.createElement("iframe");
  iframe.setAttribute(
    "data-tally-src",
    `https://tally.so/embed/${TALLY_FORM_ID}?alignLeft=1&transparentBackground=1&dynamicHeight=1`,
  );
  iframe.setAttribute("loading", "lazy");
  iframe.width = "100%";
  iframe.height = "300";
  iframe.style.border = "0";
  iframe.title = "Chegga Web feedback form";
  host.appendChild(iframe);

  loadTallyScript();
}

/** Wire the form to load the first time its <details> is opened, so
 * nothing third-party loads unless the visitor actually goes looking for
 * the form. */
export function setupFeedbackForm(): void {
  const details = document.getElementById("feedback-form-details") as HTMLDetailsElement | null;
  if (!details) return;
  details.addEventListener("toggle", () => {
    if (details.open) loadFeedbackForm();
  });
}
