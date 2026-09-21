// Chegga Web — the first-run tutorial
//
// One guided pass, on the visitor's own game when there is one:
//   1. they give a Chess.com or Lichess username (public games; no password);
//   2. we read their newest games and look, ply by ply, for the first clear
//      move they missed (tutorialMoment.ts);
//   3. the guide shows that position, turns on the heatmap, and explains why
//      the best move is best (tutorialScript.ts) -- before the visitor plays;
//   4. the visitor plays it; the guide then says what Chegga does and that it
//      works the same for any game or position;
//   5. the tutorial closes and the normal page is there, with their games in it.
//
// A visitor with no account, or whose games hold nothing clear, gets a
// built-in example instead. "Skip" is always on screen. The guide is a
// script filled in from the engine's numbers, not an AI writer.
//
// This module builds and removes its own overlay and never imports main.ts;
// main.ts is told how it ended (`onDone`) and takes it from there.

import type { Square } from "chess.js";
import { PlayBoard } from "./playBoard";
import { getGamesByUsername, openDb, putSavedPuzzles } from "./db";
import type { GameRecord } from "./db";
import {
  getLastSite,
  setLastSite,
  SiteSyncError,
  syncRecentGames,
  usernameProblem,
  SITE_NAMES,
  type Site,
} from "./siteSync";
import { getAnalysisEngine } from "./analysisPanel";
import { analyzeCandidates } from "./candidateAnalysis";
import { buildCandidates, buildOverlay } from "./candidateMoves";
import { confirmMoment, findMomentInGames, SCAN_DEFAULTS, type TeachableMoment } from "./tutorialMoment";
import { EXAMPLE_MOMENT } from "./tutorialExample";
import { buildBeats, nudgeLine, type Beat, type BeatId } from "./tutorialScript";
import { connectFormHtml, nextButtonHtml, overlayHtml, scanningHtml, TUTORIAL_STEPS, waitingHtml } from "./tutorialView";
import { markTutorial } from "./firstRun";
import { getClassColor } from "./classificationColors";
import { confetti, effectsEnabled, flash, shake } from "./juice";
import { playFailSound, playSuccessSound } from "./soundEffects";
import { recordAttempt } from "./puzzleProgress";
import { difficultyFor } from "./puzzleTrainer";
import type { AnalysisLine } from "./engine";

export interface TutorialResult {
  outcome: "finished" | "skipped";
  site?: Site;
  username?: string;
  /** set when their games were read, even if the tutorial was then skipped */
  sync?: { gamesAdded: number; fullyCaughtUp: boolean };
  usedExample: boolean;
  savedPosition: boolean;
}

const TUTORIAL_SYNC_TARGET = 30; // the same first-look size the Get started form uses
const EXAMPLE_OFFER_AFTER_MS = 25_000; // a slow phone should never be stuck waiting
const TYPE_CHARS_PER_TICK = 2; // about 125 characters a second: fast enough to feel alive, slow enough to read along

class Cancelled extends Error {}

interface Found {
  moment: TeachableMoment;
  deepLines: AnalysisLine[];
  site?: Site;
  username?: string;
  sync?: { gamesAdded: number; fullyCaughtUp: boolean };
  dateLabel?: string;
  exampleNote?: string;
}

type ScanOutcome =
  | { kind: "moment"; found: Found }
  | { kind: "none"; note: string }
  | { kind: "example" }
  | { kind: "error"; message: string };

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function startTutorial(onDone: (result: TutorialResult) => void): void {
  // ---- overlay ----
  const app = document.getElementById("app");
  const previousFocus = document.activeElement as HTMLElement | null;
  const root = document.createElement("div");
  root.id = "tutorial";
  root.className = "tutorial";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "tutorial-title");
  root.innerHTML = overlayHtml();
  document.body.appendChild(root);
  app?.setAttribute("inert", "");
  const bodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const boardEl = $("tutorial-board");
  const captionEl = $("tutorial-caption");
  const legendEl = $("tutorial-legend");
  const titleEl = $("tutorial-title");
  const sayEl = $("tutorial-say");
  const liveEl = $("tutorial-say-live");
  const controlsEl = $("tutorial-controls");
  const dotsEl = $("tutorial-dots");
  const skipBtn = $<HTMLButtonElement>("tutorial-skip");

  // ---- state ----
  let account: { site: Site; username: string } | undefined;
  let sync: TutorialResult["sync"];
  let usedExample = false;
  let savedPosition = false;
  let stopScan = false;
  let done = false;
  let moveHandler: ((uci: string, san: string) => void) | null = null;

  let cancel!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => reject(new Cancelled());
  });
  cancelled.catch(() => undefined); // a skip is not an unhandled error
  const guard = <T>(p: Promise<T>): Promise<T> => Promise.race([p, cancelled]);

  const board = new PlayBoard(boardEl, (uci, san) => moveHandler?.(uci, san));

  // ---- the guide's voice: text appears as if typed; a click finishes it ----
  let typingTimer = 0;
  let finishTyping: (() => void) | null = null;

  function say(title: string, lines: string[]): Promise<void> {
    window.clearInterval(typingTimer);
    finishTyping = null;
    titleEl.textContent = title;
    liveEl.textContent = `${title}. ${lines.join(" ")}`; // screen readers get the whole thing at once
    sayEl.innerHTML = "";
    const paragraphs = lines.map(() => sayEl.appendChild(document.createElement("p")));
    const instant = !effectsEnabled() || reducedMotion();
    if (instant) {
      paragraphs.forEach((p, i) => (p.textContent = lines[i]));
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let line = 0;
      let chars = 0;
      const finish = () => {
        window.clearInterval(typingTimer);
        paragraphs.forEach((p, i) => (p.textContent = lines[i]));
        finishTyping = null;
        resolve();
      };
      finishTyping = finish;
      typingTimer = window.setInterval(() => {
        chars += TYPE_CHARS_PER_TICK;
        paragraphs[line].textContent = lines[line].slice(0, chars);
        if (chars >= lines[line].length) {
          line += 1;
          chars = 0;
          if (line >= lines.length) finish();
        }
      }, 16);
    });
  }

  root.querySelector(".tutorial-bubble")!.addEventListener("click", () => finishTyping?.());

  function setControls(html: string) {
    controlsEl.innerHTML = html;
  }

  /** "connect" and "scan" have nothing to show on the board, so on a phone the
   * board steps aside and the form is the first thing on screen (see mobile.css). */
  function setPhase(phase: "connect" | "scan" | "lesson") {
    root.dataset.phase = phase;
  }

  function focusControl() {
    const target = controlsEl.querySelector<HTMLElement>("input:not([type=radio]), button:not([hidden])");
    (target ?? titleEl).focus({ preventScroll: true });
  }

  function setStep(index: number) {
    dotsEl.setAttribute("aria-label", `Tutorial progress: step ${index + 1} of ${TUTORIAL_STEPS.length}, ${TUTORIAL_STEPS[index]}`);
    [...dotsEl.children].forEach((li, i) => {
      li.classList.toggle("is-done", i < index);
      li.classList.toggle("is-current", i === index);
    });
  }

  /** "Next": the first click while the guide is still typing shows the rest
   * of the text; the next one moves on. */
  async function waitForNext(typed: Promise<void>): Promise<void> {
    const button = controlsEl.querySelector<HTMLButtonElement>("#tutorial-next")!;
    let ready = false;
    void typed.then(() => (ready = true));
    await new Promise<void>((resolve) => {
      button.addEventListener("click", function handler() {
        if (!ready) {
          finishTyping?.();
          return;
        }
        button.removeEventListener("click", handler);
        resolve();
      });
    });
  }

  // ---- the board ----
  function showPreviewBoard() {
    board.reset("white");
    board.showPosition(board.getFen());
    // A taste of what is coming: the strong first moves in the starting position.
    board.setCandidateTints([
      { square: "e4", color: getClassColor("best"), opacity: 0.62 },
      { square: "d4", color: getClassColor("best"), opacity: 0.62 },
      { square: "c4", color: getClassColor("good"), opacity: 0.38 },
      { square: "f3", color: getClassColor("good"), opacity: 0.38 },
    ]);
    captionEl.textContent = "This is the heatmap, shown on the starting position.";
    legendEl.hidden = true;
  }

  // ---- phase 1: welcome, and a username ----
  async function connectPhase(errorText: string): Promise<{ kind: "account"; site: Site; username: string } | { kind: "example" }> {
    setPhase("connect");
    setStep(0);
    showPreviewBoard();
    setControls(connectFormHtml(getLastSite()));
    const form = controlsEl.querySelector<HTMLFormElement>("#tutorial-form")!;
    const input = controlsEl.querySelector<HTMLInputElement>("#tutorial-username")!;
    const errorEl = controlsEl.querySelector<HTMLElement>("#tutorial-error")!;
    errorEl.textContent = errorText;
    void say("Welcome to Chegga", [
      "Chegga finds the moves you missed in your own games, and shows you what to play instead.",
      "Choose where you play and type your username. Chegga will look at your latest games.",
    ]);
    // A phone's on-screen keyboard would cover the very text being read.
    if (!window.matchMedia("(pointer: coarse)").matches) input.focus({ preventScroll: true });

    return guard(
      new Promise((resolve) => {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const problem = usernameProblem(input.value);
          if (problem) {
            errorEl.textContent = problem;
            input.focus();
            return;
          }
          const site = (form.querySelector<HTMLInputElement>('input[name="tutorial-site"]:checked')?.value ?? "chesscom") as Site;
          resolve({ kind: "account", site, username: input.value.trim() });
        });
        controlsEl.querySelector("#tutorial-example")!.addEventListener("click", () => resolve({ kind: "example" }));
      }),
    );
  }

  // ---- phase 2: read the games, find the moment ----
  async function scanPhase(site: Site, username: string): Promise<ScanOutcome> {
    setPhase("scan");
    setStep(1);
    setControls(scanningHtml());
    const progressEl = controlsEl.querySelector<HTMLElement>("#tutorial-progress-text")!;
    const exampleBtn = controlsEl.querySelector<HTMLButtonElement>("#tutorial-example")!;
    const progress = (text: string) => (progressEl.textContent = text);
    void say("Looking at your games", [
      `Chegga is reading your newest games from ${SITE_NAMES[site]} and checking your moves with a chess engine.`,
      "This takes a few seconds. The engine runs in your browser.",
    ]);
    progress(`Reading your games from ${SITE_NAMES[site]}…`);
    stopScan = false;
    const offer = window.setTimeout(() => (exampleBtn.hidden = false), EXAMPLE_OFFER_AFTER_MS);
    const examplePressed = new Promise<ScanOutcome>((resolve) => {
      exampleBtn.addEventListener("click", () => {
        stopScan = true;
        resolve({ kind: "example" });
      });
    });

    const work = (async (): Promise<ScanOutcome> => {
      const db = await openDb();
      let games: GameRecord[];
      try {
        try {
          const result = await syncRecentGames(db, site, username, TUTORIAL_SYNC_TARGET, (p) => progress(p.text));
          sync = { gamesAdded: result.gamesAdded, fullyCaughtUp: result.fullyCaughtUp };
        } catch (err) {
          if (err instanceof SiteSyncError) return { kind: "error", message: err.message };
          throw err;
        }
        account = { site, username };
        setLastSite(site);
        games = (await getGamesByUsername(db, username)).filter((g) => (site === "lichess") === g.chessComUuid.startsWith("lichess:"));
      } finally {
        db.close();
      }
      if (games.length === 0) {
        return {
          kind: "error",
          message: `Chegga found no ${SITE_NAMES[site]} games for "${username}". Check the spelling, or try an example game.`,
        };
      }

      progress("Checking your latest game with the engine…");
      const engine = await getAnalysisEngine();
      const rejected = new Set<string>();
      for (let attempt = 0; attempt < 3 && !stopScan; attempt++) {
        const found = await findMomentInGames(
          engine,
          games,
          { ...SCAN_DEFAULTS, maxGames: 3, exclude: rejected },
          {
            shouldStop: () => stopScan || done,
            onGame: ({ index }) => progress(index === 0 ? "Checking your latest game with the engine…" : "Checking your next game…"),
            onPosition: ({ positionsAnalyzed }) => progress(`The engine has checked ${positionsAnalyzed} positions so far…`),
          },
        );
        if (!found) break;
        progress("Double-checking it with a deeper search…");
        const lines = await analyzeCandidates(found.moment.fenBefore);
        const confirmed = lines ? confirmMoment(found.moment, lines) : null;
        if (confirmed && lines) {
          return {
            kind: "moment",
            found: {
              moment: confirmed,
              deepLines: lines,
              site,
              username,
              sync,
              dateLabel: found.game.endTime
                ? new Date(found.game.endTime * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                : undefined,
            },
          };
        }
        rejected.add(found.moment.id);
      }
      return {
        kind: "none",
        // No claim about the whole account: the scan reads the newest few
        // games under a time budget, so "you play cleanly" would not be true.
        note: "Chegga did not find a clear missed move in your newest games.",
      };
    })();

    try {
      return await guard(Promise.race([work, examplePressed]));
    } finally {
      window.clearTimeout(offer);
    }
  }

  async function exampleFound(note?: string): Promise<Found> {
    usedExample = true;
    setPhase("scan");
    setStep(1);
    setControls("");
    void say("Getting the example ready", ["One moment: the engine is looking at the example position."]);
    const lines = (await guard(analyzeCandidates(EXAMPLE_MOMENT.fenBefore))) ?? [];
    const confirmed = confirmMoment(EXAMPLE_MOMENT, lines) ?? EXAMPLE_MOMENT;
    return { moment: confirmed, deepLines: lines, site: account?.site, username: account?.username, sync, exampleNote: note };
  }

  async function connectAndFind(): Promise<Found> {
    // Warm the engine now, while they type: it is a few megabytes of WebAssembly.
    void getAnalysisEngine().catch(() => undefined);
    let errorText = "";
    for (;;) {
      const choice = await connectPhase(errorText);
      if (choice.kind === "example") return exampleFound();
      const outcome = await scanPhase(choice.site, choice.username);
      if (outcome.kind === "moment") return outcome.found;
      if (outcome.kind === "example") return exampleFound();
      if (outcome.kind === "none") return exampleFound(outcome.note);
      errorText = outcome.message;
    }
  }

  // ---- phases 3-7: the lesson ----
  async function saveMoment(moment: TeachableMoment, username: string) {
    try {
      const db = await openDb();
      try {
        await putSavedPuzzles(db, [
          {
            id: moment.id,
            gameId: moment.gameId,
            ply: moment.ply,
            fenBefore: moment.fenBefore,
            sideToMove: moment.userColor,
            playedSan: moment.playedSan,
            playedUci: moment.playedUci,
            bestMoveUci: moment.bestUci,
            bestMoveSan: moment.bestSan,
            centipawnLoss: moment.centipawnLoss,
            classification: moment.classification,
            difficulty: difficultyFor(moment.centipawnLoss),
            openingName: moment.openingName,
            gamePhase: moment.gamePhase,
            blunderTag: moment.blunderTag,
            username,
            savedAt: Date.now(),
          },
        ]);
        savedPosition = true;
      } finally {
        db.close();
      }
      recordAttempt(username, moment.id, true);
    } catch {
      // saving is a courtesy; the lesson goes on without it
    }
  }

  async function playLesson(found: Found): Promise<void> {
    const { moment, deepLines } = found;
    const candidates = buildCandidates(moment.fenBefore, deepLines);
    const overlay = buildOverlay(candidates, moment.playedUci, moment.classification);
    const tints = overlay.tints;
    const bestArrow = {
      from: moment.bestUci.slice(0, 2) as Square,
      to: moment.bestUci.slice(2, 4) as Square,
      color: getClassColor("best"),
      width: 5,
    };
    const beats = buildBeats(moment, deepLines, {
      site: found.site,
      dateLabel: found.dateLabel,
      shadedCount: tints.length,
      exampleNote: found.exampleNote,
    });
    const beat = (id: BeatId): Beat => beats.find((b) => b.id === id)!;

    setPhase("lesson");
    // The player's own side is at the bottom; the opponent's last move is marked.
    board.reset(moment.userColor, moment.fenBefore);
    board.showPosition(moment.fenBefore, moment.previousMove);
    captionEl.textContent = moment.isExample
      ? `Example game — move ${moment.moveNumber}`
      : `Your game against ${moment.opponent} — move ${moment.moveNumber}`;

    async function runBeat(id: BeatId, step: number, nextLabel: string, onEnter?: () => void) {
      const b = beat(id);
      setStep(step);
      setControls(nextButtonHtml(nextLabel));
      root.scrollTop = 0; // on a phone the board is at the top; each new beat starts there
      onEnter?.();
      const typed = say(b.title, b.lines);
      focusControl();
      await guard(waitForNext(typed));
    }

    await runBeat("intro", 2, "Show me the position");
    await runBeat("position", 2, "Turn on the heatmap");
    await runBeat("heatmap", 3, "Why is that the best move?", () => {
      legendEl.hidden = false;
      board.showArrows([]);
      board.setCandidateTints(tints, { animate: true });
    });
    await runBeat("whyBest", 4, "Let me play it", () => {
      board.showArrows([bestArrow], { animate: true });
    });

    // ---- your turn ----
    setStep(5);
    const turn = beat("yourTurn");
    setControls(waitingHtml("Waiting for your move…"));
    void say(turn.title, turn.lines);
    board.setLocked(false);
    await guard(
      new Promise<void>((resolve) => {
        moveHandler = (uci, san) => {
          if (uci.slice(0, 4) === moment.bestUci.slice(0, 4)) {
            moveHandler = null;
            resolve();
            return;
          }
          // A legal but different move: put it back and say what is being asked.
          board.undoMoves(1);
          board.showArrows([bestArrow]);
          board.setCandidateTints(tints);
          board.setLocked(false);
          shake(boardEl);
          playFailSound();
          void say(turn.title, [nudgeLine(san, moment)]);
        };
      }),
    );
    board.setLocked(true);
    flash(boardEl, "good");
    playSuccessSound();
    confetti(boardEl, 0.8);
    if (!moment.isExample && found.username) await saveMoment(moment, found.username);

    await runBeat("played", 5, "What does Chegga do?");
    await runBeat("whatItDoes", 6, moment.isExample ? "Take me to Chegga" : "Show me my games");
  }

  // ---- finishing ----
  function teardown() {
    window.clearInterval(typingTimer);
    document.removeEventListener("keydown", onKey);
    root.remove();
    app?.removeAttribute("inert");
    document.body.style.overflow = bodyOverflow;
    previousFocus?.focus?.({ preventScroll: true });
  }

  function finish(outcome: TutorialResult["outcome"]) {
    if (done) return;
    done = true;
    teardown();
    markTutorial(outcome === "finished" ? "done" : "skipped");
    onDone({
      outcome,
      site: account?.site,
      username: account?.username,
      sync,
      usedExample,
      savedPosition,
    });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") skip();
  }

  function skip() {
    stopScan = true;
    cancel();
  }

  skipBtn.addEventListener("click", skip);
  document.addEventListener("keydown", onKey);

  void (async () => {
    try {
      const found = await connectAndFind();
      await playLesson(found);
      finish("finished");
    } catch (err) {
      if (!(err instanceof Cancelled)) console.error("Tutorial stopped:", err);
      finish("skipped");
    }
  })();
}
