// Chegga Web — main entry / app orchestration
//
// Phase 0: WASM Stockfish handshake + IndexedDB schema.
// Phase 1: connect a real Chess.com username and sync their games.
// Phase 2: per-move engine analysis (CP-loss/classification/blunder tags).
// Phase 3: profile & pattern-stat aggregation.
// Phase 4: client-side strength estimate.
// Phase 5 (this file's UI): connect → sync → analyze → profile dashboard,
// visual language reused from Chegga's own frontend (see profileView.ts).
// No drill mode, no rival tracking in v1 — profile/analyzer only, per the
// phase plan's explicit scope decision.

import { installErrorOverlay } from "./errorOverlay";
installErrorOverlay(); // first, before anything else can throw

import "./style.css";
import {
  openDb,
  putGame,
  putMoveAnalyses,
  markGameAnalyzed,
  getGame,
  getGamesByUsername,
  getMoveAnalysesForGame,
  getMoveAnalysesForGames,
  exportAllData,
  importAllData,
  putSkillSnapshot,
  getSkillSnapshots,
} from "./db";
import type { GameRecord, ExportedData } from "./db";
import { Engine } from "./engine";
import { ChessComClient } from "./chessComClient";
import { syncGames } from "./syncService";
import { analyzeGame, DEFAULT_ANALYSIS_OPTIONS } from "./engineAnalysis";
import { computeProfile } from "./profileService";
import { estimateStrength } from "./strengthEstimate";
import { renderProfile } from "./profileView";
import { computeOpeningFrequency, computeMoveFrequencyByDepth, topMovesPerOrigin } from "./openingExplorer";
import { renderOpeningBoard } from "./openingBoard";
import { renderCheatSheet } from "./cheatSheet";
import { PlayBoard } from "./playBoard";
import { chooseBotMove } from "./botEngine";
import { hasHangingPiece } from "./blunderTagger";
import { Chess } from "chess.js";
import {
  accuracyFromCpLoss,
  leakHeadline,
  weakestPhase,
  weakestOpening,
  timePressureAlert,
  roughRatingBandContext,
} from "./statsInsights";
import { extractPuzzles, type Puzzle, type Difficulty } from "./puzzleTrainer";
import { assessSkills, type PrescriptionAction } from "./skillProfile";
import { renderSkillProfile } from "./skillProfileView";
import { getProgress, isSolved, recordAttempt, getStreak } from "./puzzleProgress";
import { ENDGAME_DRILLS, ODDS_OPTIONS, oddsFen } from "./practicePositions";
import {
  computeEndingBreakdown,
  computeRatingTrajectory,
  computeOpponentStrengthPerformance,
  computeGameLengthPatterns,
  computeTimeOfDayPatterns,
  computeCastlingBreakdown,
  computeFirstMistakePly,
} from "./gamePatterns";
import { renderGamePatterns } from "./gamePatternsView";
import { setupCollapsibleCards, expandCard } from "./collapsibleCards";
import { BOARD_THEMES, applyBoardTheme, loadSavedBoardTheme } from "./boardTheme";
import {
  analyzePosition,
  evalBarWhiteFraction,
  formatEval,
  bestMoveSquares,
  describeLines,
  getAnalysisEngine,
} from "./analysisPanel";
import { analyzeFinishedBotGame, renderPostGameReport, buildAnnotatedPgn, downloadTextFile } from "./postGameReport";
import { playMoveSound, playCaptureSound, playCheckSound, playGameEndSound, isSoundEnabled, setSoundEnabled } from "./soundEffects";
import { saveBotGame, loadSavedBotGame, clearSavedBotGame } from "./botGameStorage";

// Cap arrows per origin square so the board stays legible as the synced
// history grows -- see openingExplorer.ts's topMovesPerOrigin.
const MOVES_PER_ORIGIN_SQUARE = 3;

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <div class="wrap">
    <div class="header">
      <h1><span class="text-accent">Chegga</span> Web</h1>
    </div>
    <p class="tagline">Your Chess.com games, analyzed in your browser — nothing leaves your device.</p>

    <section class="card" id="focus-section" style="display:none">
      <h2>Your focus</h2>
      <p class="tagline" style="margin-bottom:16px">
        A rule-based read on exactly where your play is weakest right now, one specific thing to practice for it, and
        whether that number is actually moving — not an AI opinion, just your own numbers measured the same way each
        time.
      </p>
      <div id="focus-output"></div>
    </section>

    <details class="collapsible">
      <summary>New to chess? A full rules cheat sheet — setup, how pieces move, castling, tactics, and more</summary>
      <section class="card">
        ${renderCheatSheet()}
      </section>
    </details>

    <section class="card">
      <h2>Play vs. bot</h2>
      <p class="tagline" style="margin-bottom:16px">
        A real Stockfish opponent, scaled anywhere from 100 to 3000 Elo — runs entirely in your browser, no account
        needed.
      </p>
      <div class="play-controls">
        <label for="bot-elo">Bot strength</label>
        <input type="range" id="bot-elo" min="100" max="3000" step="10" value="800" />
        <span id="bot-elo-value" class="play-elo-value">800 Elo</span>
        <label for="bot-color">Play as</label>
        <select id="bot-color">
          <option value="white">White</option>
          <option value="black">Black</option>
        </select>
        <button type="button" id="bot-new-game-btn">New game</button>
        <button type="button" id="bot-undo-btn">Undo</button>
      </div>
      <div class="play-controls">
        <label for="bot-odds">Handicap</label>
        <select id="bot-odds">
          ${ODDS_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join("")}
        </select>
        <label class="play-checkbox-label"><input type="checkbox" id="bot-hang-warning" /> Warn me about hanging pieces</label>
      </div>
      <div class="play-controls">
        <label class="play-checkbox-label"><input type="checkbox" id="bot-show-analysis" /> Show live analysis (eval bar + best move)</label>
        <label class="play-checkbox-label"><input type="checkbox" id="bot-show-heatmap" /> Show square control</label>
        <label class="play-checkbox-label"><input type="checkbox" id="bot-sound-enabled" checked /> Sound</label>
      </div>
      <div class="play-controls">
        <label for="board-theme">Board theme</label>
        <select id="board-theme">
          ${BOARD_THEMES.map((t) => `<option value="${t.id}">${t.label}</option>`).join("")}
        </select>
      </div>
      <div id="resume-banner" class="status-line status-ok" style="display:none">
        You have a game in progress.
        <button type="button" id="resume-btn">Resume it</button>
        <button type="button" id="discard-resume-btn">Discard</button>
      </div>
      <div class="play-layout">
        <div class="play-board-wrap" id="play-board-wrap"></div>
        <div class="play-sidebar">
          <p id="play-status" class="status-line">Click "New game" to start.</p>
          <p id="play-hang-warning" class="status-line status-error" style="display:none"></p>
          <div id="analysis-output"></div>
          <div id="play-move-list" class="play-move-list"></div>
          <div id="post-game-report" style="display:none">
            <h3>Game report</h3>
            <div id="post-game-report-output"></div>
            <button type="button" id="download-pgn-btn">Download annotated PGN</button>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Practice positions</h2>
      <p class="tagline" style="margin-bottom:16px">
        Standard endgame technique drills, playable right in the board above — no synced account needed.
      </p>
      <div class="play-controls">
        <label for="drill-select">Drill</label>
        <select id="drill-select">
          ${ENDGAME_DRILLS.map((d) => `<option value="${d.id}">${d.name}</option>`).join("")}
        </select>
        <button type="button" id="drill-load-btn">Load drill</button>
      </div>
      <p id="drill-objective" class="status-line"></p>
    </section>

    <section class="card" id="puzzle-section" style="display:none">
      <h2>Puzzle trainer — your own blunders</h2>
      <p class="tagline" style="margin-bottom:16px">
        Real positions from your own games, right before you made a mistake. Find the move you missed.
      </p>
      <div class="play-controls">
        <label for="puzzle-difficulty">Difficulty</label>
        <select id="puzzle-difficulty">
          <option value="all">All</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
        <button type="button" id="puzzle-next-btn">Next puzzle</button>
        <span id="puzzle-streak" class="status-line"></span>
      </div>
      <p id="puzzle-focus-indicator" class="status-line status-ok" style="display:none"></p>
      <div class="play-layout">
        <div class="play-board-wrap" id="puzzle-board-wrap"></div>
        <div class="play-sidebar">
          <p id="puzzle-status" class="status-line">Click "Next puzzle" to start.</p>
          <p id="puzzle-progress" class="status-line"></p>
        </div>
      </div>
    </section>

    <section class="card" id="vision-section" style="display:none">
      <h2>Vision trainer — is anything hanging?</h2>
      <p class="tagline" style="margin-bottom:16px">Real positions from your own games. Quick yes/no.</p>
      <div class="play-layout">
        <div class="play-board-wrap" id="vision-board-wrap"></div>
        <div class="play-sidebar">
          <p id="vision-status" class="status-line">Click "Start" to begin.</p>
          <div class="play-controls">
            <button type="button" id="vision-yes-btn">Yes, hanging</button>
            <button type="button" id="vision-no-btn">No, all safe</button>
          </div>
          <button type="button" id="vision-next-btn">Next position</button>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>1. Connect your Chess.com username</h2>
      <p class="tagline" style="margin-bottom:16px">
        Chess.com already shows you one game at a time. This looks across every game you've ever played to find the
        patterns a single review can't: which openings actually win for you, what kind of blunder you make most, and
        whether time pressure or a specific game phase is where you lose the most ground. Nothing is uploaded
        anywhere — the sync and the analysis both run right here in this browser tab.
      </p>
      <form id="sync-form" class="row">
        <input id="username" type="text" placeholder="e.g. MichaelBottega" autocomplete="off" required />
        <button type="submit" id="sync-btn">Sync games</button>
      </form>
      <p id="sync-log" class="status-line">enter a username and click Sync.</p>
    </section>

    <details class="collapsible">
      <summary>Back up or move your data (export / import)</summary>
      <section class="card">
        <p class="tagline" style="margin-bottom:16px">
          Everything synced and analyzed lives only in this browser's local storage — clearing site data, switching
          browsers, or moving to another device loses it with no warning. Export a backup file here, and import it
          again (in this browser or a different one) to bring it back.
        </p>
        <div class="play-controls">
          <button type="button" id="export-data-btn">Export my data</button>
          <label for="import-data-input" class="button-like">Import a backup file</label>
          <input type="file" id="import-data-input" accept="application/json" style="display:none" />
        </div>
        <p id="data-io-log" class="status-line"></p>
      </section>
    </details>

    <section class="card">
      <h2>2. Analyze your games</h2>
      <form id="analyze-recent-form" class="row">
        <input id="analyze-count" type="number" min="1" max="200" value="10" />
        <button type="submit" id="analyze-recent-btn">Analyze most recent</button>
      </form>
      <p id="analyze-recent-log" class="status-line">games are analyzed newest-first, right here in your browser.</p>
    </section>

    <section class="card" id="profile-section" style="display:none">
      <h2>Your profile</h2>
      <div id="profile-output"></div>
    </section>

    <section class="card" id="insights-section" style="display:none">
      <h2>Insights</h2>
      <div id="insights-output" class="insights-list"></div>
    </section>

    <section class="card" id="patterns-section" style="display:none">
      <h2>Game patterns</h2>
      <p class="tagline" style="margin-bottom:16px">
        From every synced game, not just the ones analyzed by the engine — how your games end, your rating over
        time, and how you do against different opponent strengths.
      </p>
      <div id="patterns-output"></div>
    </section>

    <section class="card" id="opening-section" style="display:none">
      <h2>Move explorer</h2>
      <p class="tagline" style="margin-bottom:16px">
        Every line is a move you've made, anywhere in the game — more solid and thicker means you play it more
        often, and the color shows how well it tends to go for you.
      </p>
      <div class="opening-tabs">
        <button type="button" class="tab active" data-color="white">As White</button>
        <button type="button" class="tab" data-color="black">As Black</button>
      </div>
      <div id="opening-output"></div>
    </section>

    <section class="card" id="depth-section" style="display:none">
      <h2>Move-by-move heatmap</h2>
      <p class="tagline" style="margin-bottom:16px">
        Games stacked on top of each other by move number — your 1st move across every game, then your 2nd, and so
        on. Step through with the arrows or the ← → keys.
      </p>
      <div class="opening-tabs">
        <button type="button" class="tab active" data-depth-color="white">As White</button>
        <button type="button" class="tab" data-depth-color="black">As Black</button>
      </div>
      <div class="depth-stepper">
        <button type="button" id="depth-prev" aria-label="Previous move number">◀</button>
        <span id="depth-label" class="depth-label">Move #1</span>
        <button type="button" id="depth-next" aria-label="Next move number">▶</button>
      </div>
      <div id="depth-output"></div>
    </section>

    <details class="collapsible">
      <summary>Developer tools (engine handshake check, raw PGN analysis, IndexedDB status)</summary>
      <section class="card">
        <h3>Analyze a single pasted PGN</h3>
        <form id="analyze-form">
          <textarea id="pgn-input" rows="5" placeholder="Paste a PGN here (must include [TimeControl])"></textarea>
          <button type="submit" id="analyze-btn">Analyze</button>
        </form>
        <pre id="analyze-log" class="log">paste a PGN and click Analyze.</pre>
      </section>
      <section class="card">
        <h3>Phase 0 status</h3>
        <pre id="engine-log" class="log">starting…</pre>
        <pre id="db-log" class="log">opening…</pre>
      </section>
    </details>
  </div>
`;

setupCollapsibleCards();

function setStatus(el: HTMLElement, text: string, kind: "ok" | "error" | "" = "") {
  el.textContent = text;
  el.classList.remove("status-ok", "status-error");
  if (kind === "ok") el.classList.add("status-ok");
  if (kind === "error") el.classList.add("status-error");
}

// --- Play vs. bot ---

const botEloInput = document.querySelector<HTMLInputElement>("#bot-elo")!;
const botEloValue = document.querySelector<HTMLSpanElement>("#bot-elo-value")!;
const botColorSelect = document.querySelector<HTMLSelectElement>("#bot-color")!;
const botNewGameBtn = document.querySelector<HTMLButtonElement>("#bot-new-game-btn")!;
const botUndoBtn = document.querySelector<HTMLButtonElement>("#bot-undo-btn")!;
const playBoardWrap = document.querySelector<HTMLDivElement>("#play-board-wrap")!;
const playStatus = document.querySelector<HTMLParagraphElement>("#play-status")!;
const playMoveList = document.querySelector<HTMLDivElement>("#play-move-list")!;

const botOddsSelect = document.querySelector<HTMLSelectElement>("#bot-odds")!;
const botHangWarningCheckbox = document.querySelector<HTMLInputElement>("#bot-hang-warning")!;
const playHangWarning = document.querySelector<HTMLParagraphElement>("#play-hang-warning")!;

const botShowAnalysisCheckbox = document.querySelector<HTMLInputElement>("#bot-show-analysis")!;
const botShowHeatmapCheckbox = document.querySelector<HTMLInputElement>("#bot-show-heatmap")!;
const botSoundCheckbox = document.querySelector<HTMLInputElement>("#bot-sound-enabled")!;
const boardThemeSelect = document.querySelector<HTMLSelectElement>("#board-theme")!;
const analysisOutput = document.querySelector<HTMLDivElement>("#analysis-output")!;
const resumeBanner = document.querySelector<HTMLDivElement>("#resume-banner")!;
const resumeBtn = document.querySelector<HTMLButtonElement>("#resume-btn")!;
const discardResumeBtn = document.querySelector<HTMLButtonElement>("#discard-resume-btn")!;
const postGameReportSection = document.querySelector<HTMLDivElement>("#post-game-report")!;
const postGameReportOutput = document.querySelector<HTMLDivElement>("#post-game-report-output")!;
const downloadPgnBtn = document.querySelector<HTMLButtonElement>("#download-pgn-btn")!;

let botEngine: Engine | null = null;
let sanHistory: string[] = [];
let humanColor: "white" | "black" = "white";
let gameReportedThisGame = false; // guards the post-game report/sound from firing more than once per game
let lastAnnotatedPgn: string | null = null;

botEloInput.addEventListener("input", () => {
  botEloValue.textContent = `${botEloInput.value} Elo`;
});

botSoundCheckbox.checked = isSoundEnabled();
botSoundCheckbox.addEventListener("change", () => setSoundEnabled(botSoundCheckbox.checked));

boardThemeSelect.value = loadSavedBoardTheme();
boardThemeSelect.addEventListener("change", () => applyBoardTheme(boardThemeSelect.value));

function renderMoveList() {
  let html = "";
  for (let i = 0; i < sanHistory.length; i += 2) {
    const moveNum = i / 2 + 1;
    const white = sanHistory[i] ?? "";
    const black = sanHistory[i + 1] ?? "";
    html += `<div class="move-pair"><span class="move-num">${moveNum}.</span><span>${white}</span><span>${black}</span></div>`;
  }
  playMoveList.innerHTML = html;
  playMoveList.scrollTop = playMoveList.scrollHeight;
}

function describeStatus(status: ReturnType<PlayBoard["getStatus"]>): { text: string; over: boolean } {
  if (!status.over) {
    return { text: status.inCheck ? "Check! Your move." : "Your move.", over: false };
  }
  if (status.result === "checkmate") {
    const humanWon = status.winner === humanColor;
    return { text: `Checkmate — ${humanWon ? "you win!" : "the bot wins."}`, over: true };
  }
  if (status.result === "stalemate") return { text: "Draw by stalemate.", over: true };
  return { text: "Draw.", over: true };
}

function playSoundForSan(san: string) {
  if (san.includes("#") || san.includes("+")) playCheckSound();
  else if (san.includes("x")) playCaptureSound();
  else playMoveSound();
}

/** Live analysis: eval bar + best-move arrow + top candidate lines,
 * driven by analysisPanel.ts's own dedicated (always full-strength)
 * engine. No-ops (and clears the arrow) when the checkbox is off. */
async function updateAnalysisPanel(board: PlayBoard) {
  if (!botShowAnalysisCheckbox.checked) {
    analysisOutput.innerHTML = "";
    board.showArrow(undefined, undefined);
    return;
  }
  const fen = board.getFen();
  const sideToMove: "white" | "black" = fen.split(" ")[1] === "w" ? "white" : "black";
  analysisOutput.innerHTML = `<p class="status-line">Analyzing…</p>`;
  try {
    const result = await analyzePosition(fen, sideToMove);
    const whiteFraction = evalBarWhiteFraction(result.whiteRelativeCp, result.whiteRelativeMate);
    const lines = describeLines(fen, result);
    const best = bestMoveSquares(result);
    board.showArrow(best?.from, best?.to);

    const evalLabel = formatEval(result.whiteRelativeCp, result.whiteRelativeMate);
    const linesHtml = lines
      .map((l, i) => `<div class="status-line">${i + 1}. ${l.san} (${formatEval(l.cp, l.mate)})</div>`)
      .join("");
    analysisOutput.innerHTML = `
      <div class="eval-bar-wrap">
        <div class="eval-bar-white" style="width:${(whiteFraction * 100).toFixed(1)}%"></div>
        <div class="eval-bar-black" style="width:${(100 - whiteFraction * 100).toFixed(1)}%"></div>
        <span class="eval-bar-label">${evalLabel}</span>
      </div>
      <div class="eval-lines">${linesHtml}</div>
    `;
  } catch (err: any) {
    analysisOutput.innerHTML = `<p class="status-line status-error">Analysis failed: ${err.message ?? err}</p>`;
  }
}

function updateHeatmap(board: PlayBoard) {
  board.setHeatmapMode(botShowHeatmapCheckbox.checked ? "control" : "off");
}

async function runPostGameReport(board: PlayBoard) {
  postGameReportSection.style.display = "";
  postGameReportOutput.innerHTML = `<p class="status-line">Analyzing your game…</p>`;
  try {
    const pgn = board.getPgn();
    const report = await analyzeFinishedBotGame(pgn, humanColor);
    postGameReportOutput.innerHTML = renderPostGameReport(report);

    const engine = await getAnalysisEngine();
    const syntheticMoves = await analyzeGame(
      engine,
      {
        chessComUuid: "report",
        username: "bot-game",
        url: "",
        pgn,
        timeControl: "0",
        timeClass: "unknown",
        rules: "chess",
        rated: false,
        endTime: 0,
        whiteUsername: "",
        whiteRating: 0,
        blackUsername: "",
        blackRating: 0,
        whiteResult: "win",
        blackResult: "loss",
        userColor: humanColor,
        userResult: "win",
        analyzed: false,
      },
      DEFAULT_ANALYSIS_OPTIONS,
    );
    lastAnnotatedPgn = buildAnnotatedPgn(pgn, syntheticMoves, humanColor);
  } catch (err: any) {
    postGameReportOutput.innerHTML = `<p class="status-line status-error">Report failed: ${err.message ?? err}</p>`;
  }
}

downloadPgnBtn.addEventListener("click", () => {
  if (!lastAnnotatedPgn) return;
  const ok = downloadTextFile(`chegga-web-game-${Date.now()}.pgn`, lastAnnotatedPgn);
  if (!ok) {
    // Downloads are blocked in some embedded browser contexts -- fall
    // back to showing the PGN as selectable text instead of failing silently.
    postGameReportOutput.innerHTML += `<pre class="log">${lastAnnotatedPgn.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)}</pre>`;
  }
});

async function maybePlayBotMove(board: PlayBoard) {
  const status = board.getStatus();
  if (status.over) {
    const { text } = describeStatus(status);
    setStatus(playStatus, text, "ok");
    if (!gameReportedThisGame) {
      gameReportedThisGame = true;
      clearSavedBotGame();
      playGameEndSound(status.result === "checkmate" && status.winner === humanColor);
      void runPostGameReport(board);
    }
    return;
  }

  const botColor = humanColor === "white" ? "black" : "white";
  const isBotTurn = board.getFen().split(" ")[1] === (botColor === "white" ? "w" : "b");
  if (!isBotTurn) {
    board.setLocked(false);
    const { text } = describeStatus(status);
    setStatus(playStatus, text);
    return;
  }

  board.setLocked(true);
  setStatus(playStatus, "Bot is thinking…");

  const elo = parseInt(botEloInput.value, 10);
  try {
    if (!botEngine) {
      botEngine = new Engine();
      await botEngine.init();
    }
    const move = await chooseBotMove(botEngine, board.getFen(), elo);
    board.applyMove(move.uci);
    sanHistory.push(move.san);
    renderMoveList();
    playSoundForSan(move.san);
    saveBotGame({ pgn: board.getPgn(), humanColor, elo, savedAt: Date.now() });
    await updateAnalysisPanel(board);
    updateHeatmap(board);
    await maybePlayBotMove(board);
  } catch (err: any) {
    setStatus(playStatus, `Bot move failed: ${err.message ?? err}`, "error");
    board.setLocked(false);
    botEngine = null; // don't keep reusing a possibly half-initialized engine on the next attempt
  }
}

let playBoard: PlayBoard | null = null;

function checkHangWarning(board: PlayBoard) {
  playHangWarning.style.display = "none";
  if (!botHangWarningCheckbox.checked) return;
  const chess = new Chess(board.getFen());
  // Checked right after the human's own move commits: is the mover's own
  // color (them) now leaving something hanging for the opponent to grab?
  if (hasHangingPiece(chess, humanColor === "white" ? "w" : "b")) {
    playHangWarning.textContent = "⚠️ Heads up — that move may have left something hanging.";
    playHangWarning.style.display = "";
  }
}

function ensurePlayBoard(): PlayBoard {
  if (!playBoard) {
    playBoard = new PlayBoard(playBoardWrap, (_uci, san) => {
      sanHistory.push(san);
      renderMoveList();
      playSoundForSan(san);
      if (!playBoard) return;
      checkHangWarning(playBoard);
      saveBotGame({ pgn: playBoard.getPgn(), humanColor, elo: parseInt(botEloInput.value, 10), savedAt: Date.now() });
      void updateAnalysisPanel(playBoard).then(() => {
        if (playBoard) updateHeatmap(playBoard);
      });
      void maybePlayBotMove(playBoard);
    });
  }
  return playBoard;
}

botNewGameBtn.addEventListener("click", async () => {
  humanColor = botColorSelect.value === "black" ? "black" : "white";
  sanHistory = [];
  gameReportedThisGame = false;
  lastAnnotatedPgn = null;
  renderMoveList();
  playHangWarning.style.display = "none";
  postGameReportSection.style.display = "none";
  setStatus(drillObjective, "");
  clearSavedBotGame();

  const botColor = humanColor === "white" ? "black" : "white";
  const startFen = oddsFen(botOddsSelect.value as any, botColor);

  const board = ensurePlayBoard();
  board.reset(humanColor, startFen);
  setStatus(playStatus, humanColor === "white" ? "Your move." : "Waiting for the bot to open…");
  await updateAnalysisPanel(board);
  updateHeatmap(board);
  await maybePlayBotMove(board);
});

botUndoBtn.addEventListener("click", async () => {
  if (!playBoard) return;
  const undone = playBoard.undoMoves(2);
  if (undone === 0) return;
  sanHistory = playBoard.getSanHistory();
  renderMoveList();
  playHangWarning.style.display = "none";
  postGameReportSection.style.display = "none";
  gameReportedThisGame = false;
  playBoard.setLocked(false);
  setStatus(playStatus, "Move undone. Your move.");
  saveBotGame({ pgn: playBoard.getPgn(), humanColor, elo: parseInt(botEloInput.value, 10), savedAt: Date.now() });
  await updateAnalysisPanel(playBoard);
  updateHeatmap(playBoard);
});

botShowAnalysisCheckbox.addEventListener("change", () => {
  if (playBoard) void updateAnalysisPanel(playBoard);
});
botShowHeatmapCheckbox.addEventListener("change", () => {
  if (playBoard) updateHeatmap(playBoard);
});

// --- Resume a saved in-progress game ---

const savedGame = loadSavedBotGame();
if (savedGame) {
  resumeBanner.style.display = "";
}

resumeBtn.addEventListener("click", async () => {
  if (!savedGame) return;
  resumeBanner.style.display = "none";
  humanColor = savedGame.humanColor;
  botColorSelect.value = humanColor;
  botEloInput.value = String(savedGame.elo);
  botEloValue.textContent = `${savedGame.elo} Elo`;
  gameReportedThisGame = false;
  lastAnnotatedPgn = null;
  postGameReportSection.style.display = "none";

  const board = ensurePlayBoard();
  board.loadFromPgn(humanColor, savedGame.pgn);
  sanHistory = board.getSanHistory();
  renderMoveList();
  setStatus(playStatus, "Game resumed.", "ok");
  await updateAnalysisPanel(board);
  updateHeatmap(board);
  await maybePlayBotMove(board);
});

discardResumeBtn.addEventListener("click", () => {
  clearSavedBotGame();
  resumeBanner.style.display = "none";
});

// --- Phase 0 status (dev tools) ---

const engineLog = document.querySelector<HTMLPreElement>("#engine-log")!;
const dbLog = document.querySelector<HTMLPreElement>("#db-log")!;

async function verifyEngine() {
  engineLog.textContent = "loading worker…";
  const engine = new Engine();
  await engine.waitFor("uci", (line) => line.trim() === "uciok");
  await engine.waitFor("isready", (line) => line.trim() === "readyok");
  engine.send("position startpos");
  const best = await engine.waitFor("go depth 10", (line) => line.startsWith("bestmove"), 20000);
  engineLog.textContent = `✅ engine ok — ${best}`;
  engine.terminate();
}

async function verifyDb() {
  const db = await openDb();
  const stores = Array.from(db.objectStoreNames).sort();
  const expected = ["games", "moveAnalysis", "syncState"].sort();
  dbLog.textContent =
    JSON.stringify(stores) === JSON.stringify(expected)
      ? `✅ db ok — stores: ${stores.join(", ")}`
      : `❌ store mismatch: ${stores.join(", ")}`;
  db.close();
}

verifyEngine().catch((err) => (engineLog.textContent = `❌ engine failed: ${err.message ?? err}`));
verifyDb().catch((err) => (dbLog.textContent = `❌ db failed: ${err.message ?? err}`));

// --- Phase 1: sync ---

const syncForm = document.querySelector<HTMLFormElement>("#sync-form")!;
const usernameInput = document.querySelector<HTMLInputElement>("#username")!;
const syncBtn = document.querySelector<HTMLButtonElement>("#sync-btn")!;
const syncLog = document.querySelector<HTMLParagraphElement>("#sync-log")!;

let currentUsername: string | null = null;

// Dev convenience: remember the last-synced username in localStorage so
// reloading the page during development doesn't mean retyping it and
// re-clicking Sync every time. Per-viewer only (see artifact/browser-
// storage conventions) — not a real login, just a local shortcut.
const LAST_USERNAME_KEY = "chegga-web:last-username";

async function runSync(username: string) {
  syncBtn.disabled = true;
  setStatus(syncLog, `syncing ${username}…`);

  try {
    const db = await openDb();
    const client = new ChessComClient(`chegga-web visitor sync for ${username}`);
    const result = await syncGames(db, client, username, (progress) => {
      setStatus(syncLog, `syncing… month ${progress.currentMonth}: ${progress.monthsProcessed} months, ${progress.gamesAdded} games added so far`);
    });
    db.close();

    currentUsername = username;
    try {
      localStorage.setItem(LAST_USERNAME_KEY, username);
    } catch {
      // best-effort only -- private browsing / blocked storage just means no auto-fill next time
    }
    setStatus(
      syncLog,
      `${result.monthsProcessed} months checked, ${result.gamesAdded} new games synced for ${username}. Ready to analyze.`,
      "ok",
    );
    await refreshProfile();
  } catch (err: any) {
    // syncGames marks each month "complete" as it finishes (see
    // syncService.ts), so a failure partway through doesn't lose earlier
    // months -- the next Sync click resumes from wherever it stopped
    // instead of starting over. Said explicitly here so a mid-sync failure
    // (a real, observed Chess.com flakiness, not hypothetical) doesn't
    // read as "everything is lost, start again from scratch."
    setStatus(syncLog, `Sync stopped partway: ${err.message ?? err}. Already-synced months are saved — click Sync again to resume.`, "error");
  } finally {
    syncBtn.disabled = false;
  }
}

syncForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = usernameInput.value.trim();
  if (!username) return;
  await runSync(username);
});

// Auto-fill + auto-sync on load if a username was remembered -- this is
// the "skip the login screen" shortcut: no click needed, and any games
// already analyzed in a previous session show up immediately from
// IndexedDB while the (usually fast, current-month-only) re-sync runs.
(async () => {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LAST_USERNAME_KEY);
  } catch {
    // ignore -- storage may be blocked
  }
  if (saved) {
    usernameInput.value = saved;
    currentUsername = saved;
    await refreshProfile(); // show whatever's already analyzed immediately
    await runSync(saved); // then catch up with anything new
  }
})();

// --- Data export/import (backs up the browser-only IndexedDB copy) ---

const exportDataBtn = document.querySelector<HTMLButtonElement>("#export-data-btn")!;
const importDataInput = document.querySelector<HTMLInputElement>("#import-data-input")!;
const dataIoLog = document.querySelector<HTMLParagraphElement>("#data-io-log")!;

exportDataBtn.addEventListener("click", async () => {
  exportDataBtn.disabled = true;
  setStatus(dataIoLog, "exporting…");
  const db = await openDb();
  try {
    const data = await exportAllData(db);
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chegga-web-backup-${dateStamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(dataIoLog, `Exported ${data.games.length} games, ${data.moveAnalysis.length} analyzed moves.`, "ok");
  } catch (err: any) {
    setStatus(dataIoLog, `Export failed: ${err.message ?? err}`, "error");
  } finally {
    db.close();
    exportDataBtn.disabled = false;
  }
});

importDataInput.addEventListener("change", async () => {
  const file = importDataInput.files?.[0];
  if (!file) return;
  setStatus(dataIoLog, `importing ${file.name}…`);
  try {
    const text = await file.text();
    const data = JSON.parse(text) as ExportedData;
    const db = await openDb();
    try {
      const result = await importAllData(db, data);
      setStatus(
        dataIoLog,
        `Imported ${result.games} games, ${result.moveAnalysis} analyzed moves, ${result.skillSnapshots} progress snapshots. Merged with anything already here.`,
        "ok",
      );
      await refreshProfile();
    } finally {
      db.close();
    }
  } catch (err: any) {
    setStatus(dataIoLog, `Import failed: ${err.message ?? err} — is this a real export file from this app?`, "error");
  } finally {
    importDataInput.value = ""; // allow re-selecting the same file
  }
});

// --- Phase 2: analyze recent games ---

const analyzeRecentForm = document.querySelector<HTMLFormElement>("#analyze-recent-form")!;
const analyzeCountInput = document.querySelector<HTMLInputElement>("#analyze-count")!;
const analyzeRecentBtn = document.querySelector<HTMLButtonElement>("#analyze-recent-btn")!;
const analyzeRecentLog = document.querySelector<HTMLParagraphElement>("#analyze-recent-log")!;

analyzeRecentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUsername) {
    setStatus(analyzeRecentLog, "Sync a username first.", "error");
    return;
  }
  const count = Math.max(1, Math.min(200, parseInt(analyzeCountInput.value, 10) || 10));

  analyzeRecentBtn.disabled = true;
  const db = await openDb();
  const engine = new Engine();

  try {
    await engine.init();

    const allGames = await getGamesByUsername(db, currentUsername);
    const candidates = allGames
      .filter((g) => !g.analyzed && g.rules === "chess")
      .sort((a, b) => b.endTime - a.endTime)
      .slice(0, count);

    if (candidates.length === 0) {
      setStatus(analyzeRecentLog, "No unanalyzed standard-chess games left to analyze.", "ok");
      return;
    }

    // One bad game (a malformed PGN, a position the engine chokes on)
    // used to abort the whole batch here -- every game analyzed before it
    // was already saved (putMoveAnalyses/markGameAnalyzed per game), but
    // the user had no way to know that from a bare "Analysis failed" and
    // no reason to expect re-running would do anything but fail again on
    // the same game. Now a single game's failure is skipped, not fatal;
    // only a real run of consecutive failures (the engine itself is
    // probably dead, e.g. the Worker crashed) stops the batch early,
    // since grinding through the rest one-by-one at that point just wastes
    // time repeating the same failure.
    let analyzed = 0;
    let consecutiveFailures = 0;
    const failures: string[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const game = candidates[i];
      setStatus(analyzeRecentLog, `analyzing game ${i + 1}/${candidates.length} (${game.endTime ? new Date(game.endTime * 1000).toISOString().slice(0, 10) : game.chessComUuid})…`);
      try {
        const moves = await analyzeGame(engine, game, DEFAULT_ANALYSIS_OPTIONS);
        await putMoveAnalyses(db, moves);
        await markGameAnalyzed(db, game);
        analyzed += 1;
        consecutiveFailures = 0;
      } catch (err: any) {
        console.warn(`Skipping game ${game.chessComUuid}: ${err.message ?? err}`);
        failures.push(game.chessComUuid);
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) {
          setStatus(analyzeRecentLog, `Stopped after 3 games in a row failed (engine may have crashed) — see console. ${analyzed} analyzed before that.`, "error");
          await refreshProfile();
          return;
        }
      }
    }

    setStatus(
      analyzeRecentLog,
      failures.length
        ? `Analyzed ${analyzed} of ${candidates.length} (${failures.length} skipped — see console). Updating profile…`
        : `Analyzed ${candidates.length} games. Updating profile…`,
      failures.length ? "error" : "ok",
    );
    await refreshProfile();
  } catch (err: any) {
    setStatus(analyzeRecentLog, `Analysis failed: ${err.message ?? err}`, "error");
  } finally {
    engine.terminate();
    db.close();
    analyzeRecentBtn.disabled = false;
  }
});

// --- Phase 3 + 4: profile dashboard ---

const profileSection = document.querySelector<HTMLElement>("#profile-section")!;
const profileOutput = document.querySelector<HTMLDivElement>("#profile-output")!;
const openingSection = document.querySelector<HTMLElement>("#opening-section")!;
const openingOutput = document.querySelector<HTMLDivElement>("#opening-output")!;
const openingTabs = document.querySelectorAll<HTMLButtonElement>(".opening-tabs .tab");

async function computeProfileForUsername(username: string) {
  const db = await openDb();
  try {
    const allGames = await getGamesByUsername(db, username);
    const analyzedGames = allGames.filter((g) => g.analyzed);
    const gameIds = new Set(analyzedGames.map((g) => g.chessComUuid));
    const gamesByUuid = new Map(analyzedGames.map((g) => [g.chessComUuid, g]));

    const allMoves = await getMoveAnalysesForGames(db, gameIds);
    const ownMoves = allMoves.filter((m) => gamesByUuid.get(m.gameId)?.userColor === m.sideToMove);

    const profile = computeProfile(analyzedGames, ownMoves);
    const openingFrequency = computeOpeningFrequency(analyzedGames, ownMoves);
    const depthFrequency = computeMoveFrequencyByDepth(analyzedGames, ownMoves);

    const estimates: number[] = [];
    let latestCvR2: number | undefined;
    for (const game of analyzedGames) {
      const ownGameMoves = ownMoves.filter((m) => m.gameId === game.chessComUuid);
      const estimate = estimateStrength(game, ownGameMoves);
      if (estimate) {
        estimates.push(estimate.estimatedRating);
        latestCvR2 = estimate.cvR2; // same frozen model for every game, so any one value works
      }
    }
    const strength = estimates.length
      ? { avgEstimate: estimates.reduce((a, b) => a + b, 0) / estimates.length, sampleSize: estimates.length, cvR2: latestCvR2 }
      : undefined;

    return { profile, strength, openingFrequency, depthFrequency, analyzedGames, ownMoves, allGames };
  } finally {
    db.close();
  }
}

let activeOpeningColor: "white" | "black" = "white";
let lastOpeningFrequency: Awaited<ReturnType<typeof computeProfileForUsername>>["openingFrequency"] | null = null;

function renderOpeningSection() {
  if (!lastOpeningFrequency) return;
  const isWhite = activeOpeningColor === "white";
  const allMoves = isWhite ? lastOpeningFrequency.white : lastOpeningFrequency.black;
  const displayMoves = topMovesPerOrigin(allMoves, MOVES_PER_ORIGIN_SQUARE);
  const total = isWhite ? lastOpeningFrequency.totalWhiteGames : lastOpeningFrequency.totalBlackGames;
  openingOutput.innerHTML = renderOpeningBoard(
    displayMoves,
    allMoves,
    total,
    isWhite ? "Every move you've made as White" : "Every move you've made as Black",
  );
}

openingTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    openingTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    activeOpeningColor = tab.dataset.color === "black" ? "black" : "white";
    renderOpeningSection();
  });
});

// --- Move-by-move heatmap (games stacked by own-move-number) ---

const depthSection = document.querySelector<HTMLElement>("#depth-section")!;
const depthOutput = document.querySelector<HTMLDivElement>("#depth-output")!;
const depthLabel = document.querySelector<HTMLSpanElement>("#depth-label")!;
const depthPrevBtn = document.querySelector<HTMLButtonElement>("#depth-prev")!;
const depthNextBtn = document.querySelector<HTMLButtonElement>("#depth-next")!;
const depthTabs = document.querySelectorAll<HTMLButtonElement>("[data-depth-color]");

let activeDepthColor: "white" | "black" = "white";
let currentDepth = 1;
let lastDepthFrequency: Awaited<ReturnType<typeof computeProfileForUsername>>["depthFrequency"] = [];

function renderDepthSection() {
  const maxDepth = lastDepthFrequency.length;
  if (maxDepth === 0) return;
  currentDepth = Math.max(1, Math.min(currentDepth, maxDepth));

  const layer = lastDepthFrequency[currentDepth - 1];
  const isWhite = activeDepthColor === "white";
  const allMoves = isWhite ? layer.white : layer.black;
  const displayMoves = topMovesPerOrigin(allMoves, MOVES_PER_ORIGIN_SQUARE);
  const total = isWhite ? layer.totalWhiteGames : layer.totalBlackGames;

  depthLabel.textContent = `Move #${currentDepth} of ${maxDepth}`;
  depthPrevBtn.disabled = currentDepth <= 1;
  depthNextBtn.disabled = currentDepth >= maxDepth;

  depthOutput.innerHTML = renderOpeningBoard(
    displayMoves,
    allMoves,
    total,
    `Your move #${currentDepth} as ${isWhite ? "White" : "Black"}`,
  );
}

depthTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    depthTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    activeDepthColor = tab.dataset.depthColor === "black" ? "black" : "white";
    renderDepthSection();
  });
});

depthPrevBtn.addEventListener("click", () => {
  currentDepth -= 1;
  renderDepthSection();
});
depthNextBtn.addEventListener("click", () => {
  currentDepth += 1;
  renderDepthSection();
});

// Arrow-key stepping, per the user's own request -- ignored while typing
// in a text field/textarea so it doesn't hijack normal cursor movement,
// and only active while the heatmap section is actually visible.
document.addEventListener("keydown", (e) => {
  if (depthSection.style.display === "none") return;
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

  if (e.key === "ArrowLeft") {
    e.preventDefault();
    currentDepth -= 1;
    renderDepthSection();
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    currentDepth += 1;
    renderDepthSection();
  }
});

// --- Your focus (skill assessment / growth path) ---

const focusSection = document.querySelector<HTMLElement>("#focus-section")!;
const focusOutput = document.querySelector<HTMLDivElement>("#focus-output")!;

// One listener on the whole output, not one per render -- focus-output's
// innerHTML gets replaced wholesale every refreshProfile call, which would
// silently drop a directly-attached listener each time.
focusOutput.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("#skill-prescription-btn");
  if (!btn) return;
  const action = JSON.parse(btn.dataset.action ?? btn.getAttribute("data-action") ?? "{}") as PrescriptionAction;

  if (action.kind === "puzzle") {
    puzzleFocusFilter = { phase: action.phase, blunderTag: action.blunderTag };
    updatePuzzleFocusIndicator();
    expandCard("puzzle-section");
    loadPuzzle();
    puzzleSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (action.kind === "vision") {
    expandCard("vision-section");
    visionSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (action.kind === "drill") {
    drillSelect.value = action.drillId;
    drillLoadBtn.click();
    drillSelect.closest("section.card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (action.kind === "openings") {
    expandCard("opening-section");
    openingSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

/** One snapshot per calendar day per visitor -- frequent enough to build a
 * real trend over weeks of use, not so frequent that re-opening the app
 * five times in one afternoon fills the store with noise (putSkillSnapshot
 * upserts on the [username, dateStamp] key, so same-day calls just
 * overwrite with the latest number rather than duplicating). */
async function saveSkillSnapshot(username: string, scores: Record<string, number | undefined>, weakestCategory: string | undefined, gamesAnalyzed: number) {
  const cleanScores: Record<string, number> = {};
  for (const [k, v] of Object.entries(scores)) if (v !== undefined) cleanScores[k] = v;
  if (Object.keys(cleanScores).length === 0) return; // nothing scoreable yet -- don't save an empty snapshot

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10);
  const db = await openDb();
  try {
    await putSkillSnapshot(db, { username, dateStamp, timestamp: now.getTime(), scores: cleanScores, weakestCategory, gamesAnalyzed });
  } finally {
    db.close();
  }
}

async function refreshProfile() {
  if (!currentUsername) return;
  const { profile, strength, openingFrequency, depthFrequency, analyzedGames, ownMoves, allGames } =
    await computeProfileForUsername(currentUsername);

  // Game patterns only need synced games, not analyzed ones -- shown
  // independent of whether any analysis has run yet.
  const endings = computeEndingBreakdown(allGames);
  const trajectories = computeRatingTrajectory(allGames);
  const opponentStrength = computeOpponentStrengthPerformance(allGames);
  const gameLength = computeGameLengthPatterns(allGames);
  const timeOfDay = computeTimeOfDayPatterns(allGames);
  const castling = computeCastlingBreakdown(allGames);
  const firstMistakePly = computeFirstMistakePly(analyzedGames, ownMoves);
  const patternsHtml = renderGamePatterns(endings, trajectories, opponentStrength, gameLength, timeOfDay, castling, firstMistakePly);
  patternsSection.style.display = patternsHtml ? "" : "none";
  patternsOutput.innerHTML = patternsHtml;

  if (profile.gamesAnalyzed === 0) {
    profileSection.style.display = "none";
    insightsSection.style.display = "none";
    openingSection.style.display = "none";
    depthSection.style.display = "none";
    puzzleSection.style.display = "none";
    visionSection.style.display = "none";
    focusSection.style.display = "none";
    return;
  }
  profileSection.style.display = "";
  profileOutput.innerHTML = renderProfile(profile, strength);

  const assessment = assessSkills(ownMoves);
  const scoreMap: Record<string, number | undefined> = {};
  for (const s of assessment.scores) scoreMap[s.category] = s.score;
  await saveSkillSnapshot(currentUsername, scoreMap, assessment.weakest?.category, profile.gamesAnalyzed);
  const snapshotDb = await openDb();
  let snapshots: Awaited<ReturnType<typeof getSkillSnapshots>> = [];
  try {
    snapshots = await getSkillSnapshots(snapshotDb, currentUsername);
  } finally {
    snapshotDb.close();
  }
  focusSection.style.display = "";
  focusOutput.innerHTML = renderSkillProfile(assessment, snapshots);

  renderInsights(profile, analyzedGames, ownMoves);

  lastOpeningFrequency = openingFrequency;
  if (openingFrequency.white.length > 0 || openingFrequency.black.length > 0) {
    openingSection.style.display = "";
    renderOpeningSection();
  } else {
    openingSection.style.display = "none";
  }

  lastDepthFrequency = depthFrequency;
  if (depthFrequency.length > 0) {
    depthSection.style.display = "";
    renderDepthSection();
  } else {
    depthSection.style.display = "none";
  }

  currentPuzzles = extractPuzzles(analyzedGames, ownMoves);
  if (currentPuzzles.length > 0) {
    puzzleSection.style.display = "";
    updatePuzzleStreakDisplay();
  } else {
    puzzleSection.style.display = "none";
  }

  visionPositions = Array.from(new Set(ownMoves.map((m) => m.fenBefore)));
  visionSection.style.display = visionPositions.length > 0 ? "" : "none";
  if (visionPositions.length > 0 && !visionCurrentFen) loadVisionPosition();
}

// --- Insights (quick-win stats derived from data already computed) ---

const insightsSection = document.querySelector<HTMLElement>("#insights-section")!;
const insightsOutput = document.querySelector<HTMLDivElement>("#insights-output")!;
const patternsSection = document.querySelector<HTMLElement>("#patterns-section")!;
const patternsOutput = document.querySelector<HTMLDivElement>("#patterns-output")!;

function renderInsights(
  profile: Awaited<ReturnType<typeof computeProfileForUsername>>["profile"],
  games: Awaited<ReturnType<typeof computeProfileForUsername>>["analyzedGames"],
  ownMoves: Awaited<ReturnType<typeof computeProfileForUsername>>["ownMoves"],
) {
  const items: string[] = [];

  items.push(`<div class="insight-item"><strong>Accuracy:</strong> ${accuracyFromCpLoss(profile.avgCentipawnLoss)}/100 average, across ${profile.gamesAnalyzed} analyzed games.</div>`);

  const leak = leakHeadline(profile);
  if (leak) items.push(`<div class="insight-item">${leak.text}</div>`);

  const phase = weakestPhase(profile);
  if (phase) items.push(`<div class="insight-item">${phase.text}</div>`);

  const opening = weakestOpening(games, ownMoves);
  if (opening) items.push(`<div class="insight-item">${opening.text}</div>`);

  const timePressure = timePressureAlert(profile, ownMoves);
  if (timePressure) items.push(`<div class="insight-item">${timePressure.text}</div>`);

  items.push(`<div class="insight-item status-line">${roughRatingBandContext(profile.avgCentipawnLoss)}</div>`);

  insightsSection.style.display = "";
  insightsOutput.innerHTML = items.join("");
}

// --- Puzzle trainer (blunder replay) ---

const puzzleSection = document.querySelector<HTMLElement>("#puzzle-section")!;
const puzzleBoardWrap = document.querySelector<HTMLDivElement>("#puzzle-board-wrap")!;
const puzzleStatus = document.querySelector<HTMLParagraphElement>("#puzzle-status")!;
const puzzleProgressEl = document.querySelector<HTMLParagraphElement>("#puzzle-progress")!;
const puzzleStreakEl = document.querySelector<HTMLSpanElement>("#puzzle-streak")!;
const puzzleDifficultySelect = document.querySelector<HTMLSelectElement>("#puzzle-difficulty")!;
const puzzleNextBtn = document.querySelector<HTMLButtonElement>("#puzzle-next-btn")!;
const puzzleFocusIndicator = document.querySelector<HTMLParagraphElement>("#puzzle-focus-indicator")!;

let currentPuzzles: Puzzle[] = [];
let activePuzzle: Puzzle | null = null;
let puzzleBoard: PlayBoard | null = null;
// Set by clicking "Go practice this" on the Your Focus card -- narrows the
// puzzle pool to the specific phase/blunder-tag the skill assessment
// flagged as the weakest area, on top of whatever difficulty is selected.
// Persists across "Next puzzle" clicks until explicitly cleared, so the
// practice session actually stays on the prescribed topic instead of
// reverting to a random puzzle on the very next click.
let puzzleFocusFilter: { phase?: string; blunderTag?: string } | null = null;

function updatePuzzleFocusIndicator() {
  if (!puzzleFocusFilter) {
    puzzleFocusIndicator.style.display = "none";
    return;
  }
  const parts = [puzzleFocusFilter.phase, puzzleFocusFilter.blunderTag?.replace(/_/g, " ")].filter(Boolean);
  puzzleFocusIndicator.style.display = "";
  puzzleFocusIndicator.textContent = `Focused on: ${parts.join(", ")} — `;
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.textContent = "Clear focus";
  clearBtn.style.marginLeft = "8px";
  clearBtn.addEventListener("click", () => {
    puzzleFocusFilter = null;
    updatePuzzleFocusIndicator();
    loadPuzzle();
  });
  puzzleFocusIndicator.appendChild(clearBtn);
}

function updatePuzzleStreakDisplay() {
  if (!currentUsername) return;
  const streak = getStreak(currentUsername);
  const progress = getProgress(currentUsername);
  const solvedCount = Object.values(progress).filter((p) => p.solved).length;
  puzzleStreakEl.textContent = `🔥 ${streak.currentStreak}-day streak (best ${streak.bestStreak}) — ${solvedCount}/${currentPuzzles.length} solved`;
}

function pickPuzzle(): Puzzle | null {
  const difficulty = puzzleDifficultySelect.value as Difficulty | "all";
  let pool = difficulty === "all" ? currentPuzzles : currentPuzzles.filter((p) => p.difficulty === difficulty);
  if (puzzleFocusFilter) {
    const focused = pool.filter(
      (p) =>
        (!puzzleFocusFilter!.phase || p.gamePhase === puzzleFocusFilter!.phase) &&
        (!puzzleFocusFilter!.blunderTag || p.blunderTag === puzzleFocusFilter!.blunderTag),
    );
    // If the focus filter would leave nothing (small sample), fall back to
    // the unfiltered pool rather than showing "no puzzles" -- the focus
    // indicator stays on so the viewer knows it's not actually applying.
    if (focused.length > 0) pool = focused;
  }
  if (pool.length === 0) return null;

  const unsolved = currentUsername ? pool.filter((p) => !isSolved(currentUsername!, p.id)) : pool;
  const candidates = unsolved.length > 0 ? unsolved : pool; // once everything's solved, just recycle
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function loadPuzzle() {
  const puzzle = pickPuzzle();
  activePuzzle = puzzle;
  if (!puzzle) {
    setStatus(puzzleStatus, "No puzzles at this difficulty yet — analyze more games or pick a different difficulty.");
    return;
  }

  if (!puzzleBoard) {
    puzzleBoard = new PlayBoard(puzzleBoardWrap, (uci) => {
      if (!activePuzzle || !currentUsername) return;
      const correct = uci === activePuzzle.bestMoveUci;
      recordAttempt(currentUsername, activePuzzle.id, correct);
      updatePuzzleStreakDisplay();
      puzzleBoard!.setLocked(true);
      setStatus(
        puzzleProgressEl,
        correct
          ? `✅ Correct — ${activePuzzle.bestMoveSan} was the move.`
          : `❌ Not quite. You played ${activePuzzle.playedSan}; the engine's move was ${activePuzzle.bestMoveSan}.`,
        correct ? "ok" : "error",
      );
    });
  }
  puzzleBoard.reset(puzzle.sideToMove, puzzle.fenBefore);
  setStatus(
    puzzleStatus,
    `${puzzle.difficulty.toUpperCase()} — find the best move for ${puzzle.sideToMove} (you lost ${puzzle.centipawnLoss}cp here in the real game).`,
  );
  puzzleProgressEl.textContent = "";
}

puzzleNextBtn.addEventListener("click", loadPuzzle);
puzzleDifficultySelect.addEventListener("change", () => {
  if (currentPuzzles.length > 0) loadPuzzle();
});

// --- Vision trainer (is anything hanging?) ---

const visionSection = document.querySelector<HTMLElement>("#vision-section")!;
const visionBoardWrap = document.querySelector<HTMLDivElement>("#vision-board-wrap")!;
const visionStatus = document.querySelector<HTMLParagraphElement>("#vision-status")!;
const visionYesBtn = document.querySelector<HTMLButtonElement>("#vision-yes-btn")!;
const visionNoBtn = document.querySelector<HTMLButtonElement>("#vision-no-btn")!;
const visionNextBtn = document.querySelector<HTMLButtonElement>("#vision-next-btn")!;

let visionPositions: string[] = [];
let visionCurrentFen: string | null = null;
let visionBoard: PlayBoard | null = null;
let visionAnswered = false;

function loadVisionPosition() {
  if (visionPositions.length === 0) return;
  visionCurrentFen = visionPositions[Math.floor(Math.random() * visionPositions.length)];
  visionAnswered = false;

  if (!visionBoard) {
    // Read-only: this board never unlocks, it's a display only -- the
    // Yes/No buttons drive the interaction, not clicks on the board.
    visionBoard = new PlayBoard(visionBoardWrap, () => {});
  }
  const chess = new Chess(visionCurrentFen);
  visionBoard.reset(chess.turn() === "w" ? "white" : "black", visionCurrentFen);
  visionBoard.setLocked(true);
  setStatus(visionStatus, `Does ${chess.turn() === "w" ? "White" : "Black"} (to move) have a piece hanging right now?`);
}

function answerVision(guessHanging: boolean) {
  if (!visionCurrentFen || visionAnswered) return;
  visionAnswered = true;
  const chess = new Chess(visionCurrentFen);
  const actuallyHanging = hasHangingPiece(chess, chess.turn());
  const correct = guessHanging === actuallyHanging;
  setStatus(
    visionStatus,
    `${correct ? "✅ Correct" : "❌ Not quite"} — ${chess.turn() === "w" ? "White" : "Black"} ${actuallyHanging ? "does" : "does not"} have something hanging.`,
    correct ? "ok" : "error",
  );
}

visionYesBtn.addEventListener("click", () => answerVision(true));
visionNoBtn.addEventListener("click", () => answerVision(false));
visionNextBtn.addEventListener("click", loadVisionPosition);

// --- Practice positions (endgame drills) ---

const drillSelect = document.querySelector<HTMLSelectElement>("#drill-select")!;
const drillLoadBtn = document.querySelector<HTMLButtonElement>("#drill-load-btn")!;
const drillObjective = document.querySelector<HTMLParagraphElement>("#drill-objective")!;

drillLoadBtn.addEventListener("click", async () => {
  const drill = ENDGAME_DRILLS.find((d) => d.id === drillSelect.value);
  if (!drill) return;

  humanColor = drill.practicingColor;
  sanHistory = [];
  renderMoveList();
  setStatus(drillObjective, drill.objective, "ok");

  if (!playBoard) {
    playBoard = new PlayBoard(playBoardWrap, (_uci, san) => {
      sanHistory.push(san);
      renderMoveList();
      if (playBoard) checkHangWarning(playBoard);
      if (playBoard) void maybePlayBotMove(playBoard);
    });
  }
  playBoard.reset(humanColor, drill.fen);
  setStatus(playStatus, "Drill loaded — your move.");
  await maybePlayBotMove(playBoard);
});

// --- Dev tools: single-PGN analysis ---

const analyzeForm = document.querySelector<HTMLFormElement>("#analyze-form")!;
const pgnInput = document.querySelector<HTMLTextAreaElement>("#pgn-input")!;
const analyzeBtn = document.querySelector<HTMLButtonElement>("#analyze-btn")!;
const analyzeLog = document.querySelector<HTMLPreElement>("#analyze-log")!;

function extractHeader(pgn: string, tag: string): string {
  const match = new RegExp(`\\[${tag} "([^"]*)"\\]`).exec(pgn);
  return match ? match[1] : "";
}

/** Exposed on window so a headless verify script can call it directly and
 * get back raw JSON, without going through form events. */
(window as any).__cheggaAnalyzePgn = async (pgn: string) => {
  const game: GameRecord = {
    chessComUuid: "dev-tool-pasted-pgn",
    username: "dev-tool",
    url: extractHeader(pgn, "Link"),
    pgn,
    timeControl: extractHeader(pgn, "TimeControl"),
    timeClass: "unknown",
    rules: "chess",
    rated: true,
    endTime: 0,
    whiteUsername: extractHeader(pgn, "White"),
    whiteRating: parseInt(extractHeader(pgn, "WhiteElo"), 10) || 0,
    blackUsername: extractHeader(pgn, "Black"),
    blackRating: parseInt(extractHeader(pgn, "BlackElo"), 10) || 0,
    whiteResult: "win",
    blackResult: "loss",
    userColor: "white",
    userResult: "win",
    analyzed: false,
  };

  const engine = new Engine();
  await engine.init();
  try {
    const moves = await analyzeGame(engine, game, DEFAULT_ANALYSIS_OPTIONS);
    const db = await openDb();
    await putMoveAnalyses(db, moves);
    await markGameAnalyzed(db, game);
    db.close();
    return moves;
  } finally {
    engine.terminate();
  }
};

analyzeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pgn = pgnInput.value.trim();
  if (!pgn) return;

  analyzeBtn.disabled = true;
  analyzeLog.textContent = "analyzing…";

  try {
    const moves = await (window as any).__cheggaAnalyzePgn(pgn);
    analyzeLog.textContent = `✅ ${moves.length} moves analyzed.\n${JSON.stringify(moves, null, 2)}`;
  } catch (err: any) {
    analyzeLog.textContent = `❌ ANALYSIS FAILED: ${err.message ?? err}`;
  } finally {
    analyzeBtn.disabled = false;
  }
});

// --- Dev tools window hooks (used by headless cross-check scripts to seed
// raw GameRecord/MoveAnalysisRecord rows dumped straight from Chegga's own
// chegga.db, bypassing sync/analysis, so the aggregation/estimate math can
// be checked against known-good backend numbers without re-running engine
// analysis in the browser). ---

async function computeStrengthForGame(chessComUuid: string) {
  const db = await openDb();
  try {
    const game = await getGame(db, chessComUuid);
    if (!game) throw new Error(`No game with uuid ${chessComUuid} in IndexedDB`);
    const allMoves = await getMoveAnalysesForGame(db, chessComUuid);
    const ownMoves = allMoves.filter((m) => m.sideToMove === game.userColor);
    return estimateStrength(game, ownMoves);
  } finally {
    db.close();
  }
}

(window as any).__cheggaDevTools = {
  openDb,
  putGame,
  putMoveAnalyses,
  computeProfileForUsername: async (username: string) => (await computeProfileForUsername(username)).profile,
  computeStrengthForGame,
  getActivePuzzle: () => activePuzzle,
  refreshProfileForUsername: async (username: string) => {
    currentUsername = username;
    await refreshProfile();
  },
};
