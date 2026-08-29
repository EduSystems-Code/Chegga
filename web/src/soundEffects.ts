// Chegga Web — move/capture/check sound effects
//
// Synthesized with the Web Audio API rather than shipping audio files —
// no assets to bundle or fetch, genuinely zero network involved. A
// single shared AudioContext, created lazily on first use (browsers
// block audio contexts from starting before a user gesture anyway, so
// eager creation at page load would just throw/warn for nothing).

const STORAGE_KEY = "chegga-web:sound-enabled";

let ctx: AudioContext | null = null;
// Some embedded/restricted browser contexts (confirmed: VS Code's Simple
// Browser breaks in a way consistent with this) either don't have
// AudioContext or throw constructing/using one. Sound is a nice-to-have,
// never something a move/click should be gated on -- one failure disables
// it for the rest of the session instead of retrying (and re-throwing)
// on every single move.
let audioBroken = false;

function getContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function tone(freq: number, durationMs: number, type: OscillatorType = "sine", startDelayMs = 0): void {
  if (!isSoundEnabled() || audioBroken) return;
  try {
    const audio = getContext();
    // Chrome/Edge's autoplay policy creates every AudioContext in a
    // "suspended" state until something explicitly resumes it -- being
    // inside a click handler (a real user gesture) is not enough on its
    // own, `.resume()` still has to be called. Without this, every tone
    // below schedules silently and nothing is ever actually heard: no
    // error, no thrown exception, just no sound -- the exact "not quite
    // hearing sound effects" symptom, confirmed by there being no
    // .resume() call anywhere in the original version of this file.
    if (audio.state === "suspended") void audio.resume();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const startAt = audio.currentTime + startDelayMs / 1000;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationMs / 1000);
    osc.connect(gain).connect(audio.destination);
    osc.start(startAt);
    osc.stop(startAt + durationMs / 1000 + 0.02);
  } catch (err) {
    audioBroken = true;
    console.warn("Sound effects unavailable in this browser context -- disabling for the rest of the session.", err);
  }
}

export function playMoveSound(): void {
  tone(420, 90, "sine");
}

export function playCaptureSound(): void {
  tone(260, 70, "square");
  tone(180, 100, "square", 40);
}

export function playCheckSound(): void {
  tone(660, 90, "triangle");
  tone(880, 120, "triangle", 90);
}

export function playGameEndSound(won: boolean): void {
  if (won) {
    tone(523, 100, "sine");
    tone(659, 100, "sine", 100);
    tone(784, 180, "sine", 200);
  } else {
    tone(330, 150, "sine");
    tone(262, 220, "sine", 130);
  }
}

/** A short, bright rising triad — a puzzle solved / correct answer. */
export function playSuccessSound(): void {
  tone(523, 90, "sine");
  tone(659, 90, "sine", 70);
  tone(784, 160, "sine", 140);
}

/** A soft, low double-thud — a wrong answer. Deliberately gentle, not a
 * harsh buzzer: getting a hard puzzle wrong shouldn't feel punishing. */
export function playFailSound(): void {
  tone(200, 120, "sine");
  tone(150, 160, "sine", 90);
}

/** A quick 4-note arpeggio flourish — achievement unlocked / rating
 * milestone crossed. */
export function playLevelUpSound(): void {
  tone(523, 80, "triangle");
  tone(659, 80, "triangle", 70);
  tone(784, 80, "triangle", 140);
  tone(1047, 220, "triangle", 210);
}

/** A little 5-note fanfare — the whole Today set complete, or beating the
 * bot. The biggest sound in the app; used sparingly. */
export function playFanfareSound(): void {
  tone(523, 110, "sine");
  tone(523, 110, "sine", 120);
  tone(523, 110, "sine", 240);
  tone(659, 140, "sine", 360);
  tone(784, 320, "sine", 480);
}

export function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0"; // on by default
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // ignore -- best-effort only
  }
}
