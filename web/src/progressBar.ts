// Chegga Web — a small reusable progress bar, shared by Sync and
// Analyze-recent. Replaces plain status-line text for those two flows,
// which are the only two that loop over a known-length list of work
// (archive months / candidate games) and previously only reported
// progress as scrolling text.

export interface ProgressBarHandle {
  /** current/total both 1-based counts, e.g. (3, 94). */
  update(current: number, total: number, label: string): void;
  hide(): void;
}

export function createProgressBar(container: HTMLElement): ProgressBarHandle {
  container.innerHTML = `
    <div class="progress-wrap" style="display:none">
      <div class="progress-track"><div class="progress-fill"></div></div>
      <p class="progress-label status-line"></p>
    </div>
  `;
  const wrap = container.querySelector<HTMLDivElement>(".progress-wrap")!;
  const fill = container.querySelector<HTMLDivElement>(".progress-fill")!;
  const label = container.querySelector<HTMLParagraphElement>(".progress-label")!;

  return {
    update(current, total, text) {
      wrap.style.display = "";
      const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
      fill.style.width = `${pct}%`;
      label.textContent = `${text} (${current}/${total})`;
    },
    hide() {
      wrap.style.display = "none";
    },
  };
}
