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
import "./mobile.css"; // small-viewport pass — loaded after style.css so equal-specificity rules win
import { showEmptyStates, emptyFor, clearEmptyFor, wireEmptyStateCtas } from "./emptyStates";
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
  countSyncStatesForUsername,
} from "./db";
import type { GameRecord, MoveAnalysisRecord, ExportedData } from "./db";
import { Engine } from "./engine";
import { ChessComClient } from "./chessComClient";
import { syncGames, quickSyncRecentGames } from "./syncService";
import { analyzeGame, DEFAULT_ANALYSIS_OPTIONS } from "./engineAnalysis";
import { computeProfile } from "./profileService";
import { estimateStrength } from "./strengthEstimate";
import { renderProfile } from "./profileView";
import { computeOpeningFrequency, computeMoveFrequencyByDepth, topMovesPerOrigin } from "./openingExplorer";
import { renderOpeningBoard } from "./openingBoard";
import { renderCheatSheet } from "./cheatSheet";
import { renderTaxonomyBrowser, wireTaxonomyBrowser } from "./pkTaxonomyView";
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
import {
  ensureCuratedPuzzlesLoaded,
  pickCuratedPuzzle,
  describeThemes,
  THEME_OPTIONS,
} from "./curatedPuzzles";
import type { CuratedPuzzleRecord } from "./db";
import { getRating, seedRating, applyResult, ratingSparkline } from "./puzzleRating";
import { isRedeemed, markRedeemed, redeemedCount } from "./redemptionProgress";
import {
  buildToday,
  getToday,
  saveToday,
  bumpToday,
  isTodayComplete,
  getTodayStreak,
  recordTodayComplete,
  type TodayKind,
} from "./today";
import { renderToday } from "./todayView";
import { renderRedemptionList, type RedemptionRow } from "./redemptionView";
import { ACHIEVEMENTS, checkAchievements, getUnlocked, type AchievementStats } from "./achievements";
import { recordBotResult, bestWinElo } from "./botStats";
import { PIECE_SET_OPTIONS, getPieceSet, setPieceSet } from "./pieceSet";
import {
  confetti,
  celebrate,
  bump,
  shake,
  flash,
  floatText,
  countUp,
  achievementBanner,
  effectsEnabled,
  setEffectsEnabled,
} from "./juice";
import { assessSkills, type PrescriptionAction } from "./skillProfile";
import { renderSkillProfile } from "./skillProfileView";
import { computeRoadToTarget, averageFeatures, type RoadAction } from "./roadTo2000";
import { renderRoadToTarget, ROAD_TARGET_OPTIONS } from "./roadTo2000View";
import { computeBlunderRate } from "./blunderRate";
import { renderBlunderRate } from "./blunderRateView";
import { computeConsistency } from "./consistencyMetrics";
import { renderConsistency } from "./consistencyView";
import { buildWeeklyPlan, isoWeek, getDoneTasks, setTaskDone, type PlanActionKind } from "./weeklyPlan";
import { renderWeeklyPlan } from "./weeklyPlanView";
import { findThrownGames } from "./convertTheWin";
import { renderThrownGames } from "./convertTheWinView";
import { getProgress, isDue, recordAttempt, getStreak } from "./puzzleProgress";
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
import { computeRivalRecords, computeRivalInsights } from "./rivalTracking";
import { renderRivalTracking } from "./rivalTrackingView";
import { setupCollapsibleCards, expandCard } from "./collapsibleCards";
import { setupFeedbackWidget } from "./feedback";
import { setupFeedbackForm } from "./feedbackForm";
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
import {
  playMoveSound,
  playCaptureSound,
  playCheckSound,
  playGameEndSound,
  playSuccessSound,
  playFailSound,
  playLevelUpSound,
  playFanfareSound,
  isSoundEnabled,
  setSoundEnabled,
} from "./soundEffects";
import { saveBotGame, loadSavedBotGame, clearSavedBotGame } from "./botGameStorage";
import { createProgressBar } from "./progressBar";
import { isColorblindPalette, setColorblindPalette } from "./classificationColors";

// Cap arrows per origin square so the board stays legible as the synced
// history grows -- see openingExplorer.ts's topMovesPerOrigin.
const MOVES_PER_ORIGIN_SQUARE = 3;

// A brand-new visitor's first sync pulls only this many recent games
// (newest-first) instead of an entire account's history -- the direct
// fix for "the player might click off before seeing what this does."
// A returning visitor (anything already synced) always gets the regular
// full incremental sync instead, same as before this existed.
const QUICK_SYNC_GAME_TARGET = 30;
// And the first-look analysis that auto-runs right after that quick
// sync, so there's something to actually look at without a second click.
const QUICK_SYNC_ANALYZE_COUNT = 25;

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <div class="wrap">
    <header class="header">
      <div class="brand">
        <svg class="brand-mark" width="30" height="30" viewBox="0 0 64 64" aria-hidden="true">
          <rect width="64" height="64" rx="14" fill="#12151b" />
          <rect x="12" y="12" width="10" height="10" fill="#e3a857" />
          <rect x="32" y="12" width="10" height="10" fill="#e3a857" />
          <rect x="22" y="22" width="10" height="10" fill="#e3a857" />
          <rect x="42" y="22" width="10" height="10" fill="#e3a857" />
          <rect x="12" y="32" width="10" height="10" fill="#e3a857" />
          <rect x="32" y="32" width="10" height="10" fill="#e3a857" />
          <rect x="22" y="42" width="10" height="10" fill="#e3a857" />
          <rect x="42" y="42" width="10" height="10" fill="#e3a857" />
          <rect x="12" y="12" width="40" height="40" fill="none" stroke="#f0be73" stroke-width="2" />
        </svg>
        <h1><span class="text-accent">Chegga</span> Web</h1>
      </div>
      <button type="button" id="feedback-btn" class="feedback-btn" hidden>Feedback</button>
    </header>

    <section class="hero" aria-labelledby="hero-title">
      <h2 id="hero-title">The patterns in your chess that a single game review can't show you.</h2>
      <p>
        Connect your Chess.com username and every game you've ever played is analyzed right here in your
        browser — your real opening results, the mistake you keep making, where time pressure costs you.
        Nothing is uploaded.
      </p>
      <div class="hero-cta">
        <button type="button" id="hero-analyze-btn">Analyze my games</button>
        <button type="button" id="hero-play-btn" class="btn-ghost">Play a bot instead</button>
      </div>
    </section>

    <nav class="section-nav" aria-label="Jump to section">
      <a href="#today-section">Today</a>
      <a href="#weekly-plan-section">Plan</a>
      <a href="#sync-section">Get started</a>
      <a href="#road-section">Road to rating</a>
      <a href="#profile-section">Profile</a>
      <a href="#lichess-puzzle-section">Puzzles</a>
      <a href="#play-section">Play</a>
      <a href="#opening-section">Explore</a>
      <a href="#feedback-form-details">Feedback</a>
    </nav>

    <main id="main-content">
    <section class="card" id="today-section" data-tier="primary">
      <h2>Today</h2>
      <p class="tagline" style="margin-bottom:16px">
        One regimented set a day — aimed at your weakest area, with a clear finish line. Keep going past it if you
        want; nothing here is locked.
      </p>
      <div id="today-output"></div>
    </section>

    <section class="card" id="sync-section" data-tier="primary">
      <h2>Get started — connect your Chess.com username</h2>
      <p class="tagline" style="margin-bottom:16px">
        The first sync pulls just your recent games, so you see results in seconds; one click grabs the rest later.
        No account? Jump to <strong>Play vs. bot</strong> below instead.
      </p>
      <form id="sync-form" class="row">
        <label for="username" class="sr-only">Chess.com username</label>
        <input id="username" type="text" placeholder="e.g. MichaelBottega" autocomplete="off" required />
        <button type="submit" id="sync-btn">Sync games</button>
      </form>
      <p id="sync-log" class="status-line"></p>
      <div id="sync-progress"></div>
      <p id="full-sync-prompt" class="status-line status-ok" style="display:none">
        <span id="full-sync-prompt-text"></span> <button type="button" id="full-sync-btn">Get my full history</button>
      </p>
      <h3 style="margin-top:24px">Analyze more games</h3>
      <p class="tagline" style="margin-bottom:16px">
        A quick first batch analyzes automatically right after your first sync — use this to analyze more, any
        time.
      </p>
      <form id="analyze-recent-form" class="row">
        <label for="analyze-count" class="sr-only">Number of recent games to analyze</label>
        <input id="analyze-count" type="number" min="1" max="200" value="10" />
        <button type="submit" id="analyze-recent-btn">Analyze most recent</button>
      </form>
      <p id="analyze-recent-log" class="status-line"></p>
      <div id="analyze-progress"></div>
    </section>

    <section class="card" id="focus-section" data-tier="primary" style="display:none">
      <h2>Your focus</h2>
      <p class="tagline" style="margin-bottom:16px">
        A rule-based read on exactly where your play is weakest right now, one specific thing to practice for it, and
        whether that number is actually moving — not an AI opinion, just your own numbers measured the same way each
        time.
      </p>
      <div id="focus-output"></div>
    </section>

    <section class="card" id="road-section" data-tier="primary" style="display:none">
      <h2>Road to a target rating</h2>
      <p class="tagline" style="margin-bottom:16px">
        The strength model, run backwards: pick a target and see which parts of your play it thinks are costing you
        the most rating points — and what to do about each. A rough linear model, not a promise.
      </p>
      <div id="road-output"></div>
    </section>

    <section class="card" id="weekly-plan-section" data-tier="primary" style="display:none">
      <h2>This week's plan</h2>
      <p class="tagline" style="margin-bottom:16px">
        A seven-day training structure, weighted toward your weakest area, with the numbers filled in from your
        puzzle rating and worst opening. Tick things off; it resets every Monday.
      </p>
      <div id="weekly-plan-output"></div>
    </section>

    <section class="card" id="profile-section" data-tier="primary" style="display:none">
      <h2>Your profile</h2>
      <div id="profile-output"></div>
    </section>

    <section class="card" id="puzzle-section" data-tier="primary" style="display:none">
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

    <section class="card" id="lichess-puzzle-section" data-tier="primary">
      <h2>Themed puzzles — tactics library</h2>
      <p class="tagline" style="margin-bottom:16px">
        ~99,000 puzzles from the <a href="https://database.lichess.org" target="_blank" rel="noopener">Lichess open
        database</a> (CC0), tagged by tactic and rated. Pick a theme and difficulty — or let "Your focus" and the PK
        taxonomy point you at one. Nothing is uploaded; the set loads once into this browser.
      </p>
      <p id="lichess-rating-readout" class="status-line" style="margin-bottom:12px"></p>
      <div class="play-controls">
        <label for="lichess-theme">Theme</label>
        <select id="lichess-theme"></select>
        <label for="lichess-rating">Difficulty</label>
        <select id="lichess-rating">
          <option value="match" selected>Match my rating (±120)</option>
          <option value="600-1000">Beginner (600–1000)</option>
          <option value="1000-1400">Casual (1000–1400)</option>
          <option value="1400-1800">Intermediate (1400–1800)</option>
          <option value="1800-2200">Advanced (1800–2200)</option>
          <option value="2200-2600">Expert (2200–2600)</option>
        </select>
        <button type="button" id="lichess-next-btn">Next puzzle</button>
        <span id="lichess-streak" class="status-line"></span>
      </div>
      <div id="lichess-load-progress"></div>
      <p id="lichess-focus-indicator" class="status-line status-ok" style="display:none"></p>
      <div class="play-layout">
        <div class="play-board-wrap" id="lichess-board-wrap"></div>
        <div class="play-sidebar">
          <p id="lichess-status" class="status-line">Pick a theme and click "Next puzzle".</p>
          <p id="lichess-progress" class="status-line"></p>
        </div>
      </div>
    </section>

    <section class="card" id="redemption-section" data-tier="secondary" style="display:none">
      <h2>Redeem a loss</h2>
      <p class="tagline" style="margin-bottom:16px">
        Every blunder the engine found in your games, worst first. Pick one, play the position again from the
        mistake — first move has to match the engine, then play it out against the bot at the opponent's strength.
      </p>
      <div class="play-layout">
        <div class="play-board-wrap" id="redemption-board-wrap"></div>
        <div class="play-sidebar">
          <p id="redemption-status" class="status-line">Pick a loss from the list to replay it.</p>
          <p id="redemption-progress" class="status-line"></p>
        </div>
      </div>
      <div id="redemption-output"></div>
    </section>

    <section class="card" id="play-section" data-tier="primary">
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
        <label for="hang-sensitivity">Hang-detection sensitivity</label>
        <select id="hang-sensitivity">
          <option value="5">Beginner (queen/rook only)</option>
          <option value="3">Intermediate (+ bishop/knight)</option>
          <option value="1" selected>Advanced (+ pawns)</option>
        </select>
      </div>
      <div class="play-controls">
        <label class="play-checkbox-label"><input type="checkbox" id="bot-show-analysis" /> Show live analysis (eval bar + best move)</label>
        <label class="play-checkbox-label"><input type="checkbox" id="bot-show-heatmap" /> Show square control</label>
        <label class="play-checkbox-label"><input type="checkbox" id="bot-sound-enabled" checked /> Sound</label>
        <label class="play-checkbox-label"><input type="checkbox" id="fx-enabled" checked /> Effects (confetti, animations)</label>
      </div>
      <div class="play-controls">
        <label for="board-theme">Board theme</label>
        <select id="board-theme">
          ${BOARD_THEMES.map((t) => `<option value="${t.id}">${t.label}</option>`).join("")}
        </select>
        <label for="piece-set">Pieces</label>
        <select id="piece-set">
          ${PIECE_SET_OPTIONS.map((o) => `<option value="${o.id}">${o.label}</option>`).join("")}
        </select>
        <label class="play-checkbox-label"><input type="checkbox" id="colorblind-palette" /> Colorblind-safe move colors</label>
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

    <section class="card" id="vision-section" data-tier="secondary" style="display:none">
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

    <section class="card" id="opening-section" data-tier="secondary" style="display:none">
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

    <section class="card" id="depth-section" data-tier="secondary" style="display:none">
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

    <section class="card" id="achievements-section" data-tier="secondary">
      <h2>Achievements</h2>
      <div id="achievements-output"></div>
    </section>

    <section class="card" id="insights-section" data-tier="secondary" style="display:none">
      <h2>Insights</h2>
      <div id="insights-output" class="insights-list"></div>
    </section>

    <section class="card" id="blunder-rate-section" data-tier="secondary" style="display:none">
      <h2>Blunder rate over time</h2>
      <p class="tagline" style="margin-bottom:16px">
        One-move oversights per 100 moves — the single biggest rating leak below 2000. Watch this line fall.
      </p>
      <div id="blunder-rate-output"></div>
    </section>

    <section class="card" id="consistency-section" data-tier="secondary" style="display:none">
      <h2>Consistency &amp; tilt</h2>
      <p class="tagline" style="margin-bottom:16px">
        How your results hold up after a loss and deep into a session — measured from your own game history.
      </p>
      <div id="consistency-output"></div>
    </section>

    <section class="card" id="convert-section" data-tier="secondary" style="display:none">
      <h2>Games you didn't convert</h2>
      <p class="tagline" style="margin-bottom:16px">
        Analyzed games where you reached a clearly winning position and drew or lost it — worst first, with the move
        where it slipped.
      </p>
      <div id="convert-output"></div>
    </section>

    <section class="card" id="patterns-section" data-tier="secondary" style="display:none">
      <h2>Game patterns</h2>
      <p class="tagline" style="margin-bottom:16px">
        From every synced game, not just the ones analyzed by the engine — how your games end, your rating over
        time, and how you do against different opponent strengths.
      </p>
      <div id="patterns-output"></div>
    </section>

    <section class="card" id="rivals-section" data-tier="secondary" style="display:none">
      <h2>Rivals</h2>
      <p class="tagline" style="margin-bottom:16px">
        Opponents you've faced more than once — your real record against each one, not just a lifetime win rate.
      </p>
      <div id="rivals-output"></div>
    </section>

    <section class="card" id="practice-section" data-tier="secondary">
      <h2>Practice positions</h2>
      <p class="tagline" style="margin-bottom:16px">
        Standard endgame technique drills, playable right in the Play vs. bot board — no synced account needed.
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

    <p class="section-divider">Reference &amp; tools</p>

    <details class="collapsible" id="feedback-form-details">
      <summary>Send feedback — bugs, ideas, anything that felt off</summary>
      <section class="card">
        <p class="tagline" style="margin-bottom:16px">
          Goes straight to a short form. For feature requests you can also use the
          <strong>Feedback</strong> button at the top of the page.
        </p>
        <div id="tally-embed"></div>
      </section>
    </details>

    <details class="collapsible">
      <summary>New to chess? A full rules cheat sheet — setup, how pieces move, castling, tactics, and more</summary>
      <section class="card">
        ${renderCheatSheet()}
      </section>
    </details>

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

    <details class="collapsible">
      <summary>PK Mastery taxonomy — the full skill map behind Chegga's curriculum (draft)</summary>
      <section class="card">
        <p class="tagline" style="margin-bottom:16px">
          74 draft concept nodes across 5 domains and 5 rating tiers, each with its prerequisites — the design behind
          a coming prescriptive curriculum layer. Browse-only for now: puzzle content isn't wired to these nodes yet.
        </p>
        <div id="pk-taxonomy-root">${renderTaxonomyBrowser()}</div>
      </section>
    </details>

    <details class="collapsible">
      <summary>Developer tools (engine handshake check, raw PGN analysis, IndexedDB status)</summary>
      <section class="card">
        <h3>Analyze a single pasted PGN</h3>
        <form id="analyze-form">
          <label for="pgn-input" class="sr-only">PGN to analyze</label>
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
    </main>
    <footer class="site-footer">
      <p>
        Puzzle data from the <a href="https://database.lichess.org" target="_blank" rel="noopener">Lichess open database</a> (CC0).
        Piece sets <strong>Cburnett</strong> (© Colin M.L. Burnett) and <strong>Merida</strong> (© Armando Hernandez Marroquin),
        <a href="https://www.gnu.org/licenses/gpl-2.0.txt" target="_blank" rel="noopener">GPLv2+</a>, via
        <a href="https://github.com/lichess-org/lila" target="_blank" rel="noopener">lichess-org/lila</a>.
        Not affiliated with Chess.com or Lichess.
      </p>
    </footer>
  </div>
`;

setupCollapsibleCards();
wireEmptyStateCtas();
showEmptyStates(); // seed data-dependent cards for a visitor with no synced account (redesign #5)
setupFeedbackWidget(); // Featurebase widget — org slug "mibottega" set in feedback.ts
setupFeedbackForm(); // Tally form — loads on first open of the "Send feedback" card

// Hero CTAs: scroll to the relevant card and put the cursor where it's needed.
document.getElementById("hero-analyze-btn")?.addEventListener("click", () => {
  document.getElementById("sync-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => document.getElementById("username")?.focus(), 400);
});
document.getElementById("hero-play-btn")?.addEventListener("click", () => {
  expandCard("play-section");
  document.getElementById("play-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
});
wireTaxonomyBrowser(document.querySelector<HTMLElement>("#pk-taxonomy-root")!, (_code, themes, nodeName) => {
  practiceLichessThemes(themes, nodeName);
});

// --- Shareable/bookmarkable state in the URL hash (critique #10) ---
// `#u=<name>` seeds the username (so a link works in a fresh browser, not
// just one that already has it in localStorage); `#open=<card-id>`
// expands and scrolls to a specific card. The hash is kept current as the
// viewer opens cards and syncs, via replaceState (no history spam).
function readHashState(): { u?: string; open?: string } {
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  return { u: h.get("u") || undefined, open: h.get("open") || undefined };
}
function writeHashState(patch: { u?: string; open?: string }) {
  const cur = readHashState();
  const next = { ...cur, ...patch };
  const h = new URLSearchParams();
  if (next.u) h.set("u", next.u);
  if (next.open) h.set("open", next.open);
  const s = h.toString();
  history.replaceState(null, "", s ? `#${s}` : location.pathname + location.search);
}
const initialHash = readHashState();
if (initialHash.open) {
  const target = document.getElementById(initialHash.open);
  if (target) {
    expandCard(initialHash.open);
    target.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}
// Track which card the viewer last opened, so a bookmark reopens it.
document.querySelectorAll<HTMLElement>("section.card[id] > h2.card-heading-collapsible").forEach((h2) => {
  h2.addEventListener("click", () => {
    const card = h2.closest("section.card")!;
    // click toggles AFTER this handler in collapsibleCards' own listener,
    // so read the state that's about to result: currently-visible -> will close.
    const body = card.querySelector<HTMLElement>(".card-body");
    const willOpen = body ? body.style.display === "none" : true;
    writeHashState({ open: willOpen ? card.id : undefined });
  });
});

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

const fxCheckbox = document.querySelector<HTMLInputElement>("#fx-enabled")!;
fxCheckbox.checked = effectsEnabled();
fxCheckbox.addEventListener("change", () => {
  setEffectsEnabled(fxCheckbox.checked);
  if (fxCheckbox.checked) confetti(fxCheckbox, 0.6); // little acknowledgement
});

boardThemeSelect.value = loadSavedBoardTheme();
boardThemeSelect.addEventListener("change", () => applyBoardTheme(boardThemeSelect.value));

const pieceSetSelect = document.querySelector<HTMLSelectElement>("#piece-set")!;
pieceSetSelect.value = getPieceSet();
pieceSetSelect.addEventListener("change", () => {
  setPieceSet(pieceSetSelect.value as ReturnType<typeof getPieceSet>);
  // Re-render every board in place so the new set shows without losing
  // any game/puzzle state.
  for (const b of [playBoard, puzzleBoard, lcBoard, redemptionBoard, visionBoard]) b?.redraw();
  if (lastOpeningFrequency) renderOpeningSection();
  if (lastDepthFrequency) renderDepthSection();
});

// --- Hang-detection sensitivity (shared by the live bot-game warning and
// the standalone Vision Trainer -- one setting, not two, since both call
// the same hasHangingPiece check) ---

const HANG_SENSITIVITY_KEY = "chegga-web:hang-sensitivity";
const hangSensitivitySelect = document.querySelector<HTMLSelectElement>("#hang-sensitivity")!;

function loadHangSensitivity(): number {
  try {
    const saved = localStorage.getItem(HANG_SENSITIVITY_KEY);
    if (saved) return parseInt(saved, 10);
  } catch {
    // ignore -- storage may be blocked
  }
  return 1; // Advanced -- matches the original, pre-setting behavior
}

function currentHangMinValue(): number {
  return parseInt(hangSensitivitySelect.value, 10) || 1;
}

hangSensitivitySelect.value = String(loadHangSensitivity());
hangSensitivitySelect.addEventListener("change", () => {
  try {
    localStorage.setItem(HANG_SENSITIVITY_KEY, hangSensitivitySelect.value);
  } catch {
    // best-effort only
  }
});

// --- Colorblind-safe move-quality palette ---

const colorblindCheckbox = document.querySelector<HTMLInputElement>("#colorblind-palette")!;
colorblindCheckbox.checked = isColorblindPalette();
colorblindCheckbox.addEventListener("change", () => {
  setColorblindPalette(colorblindCheckbox.checked);
  // Re-renders the profile bar and opening/depth boards, the only real
  // consumers of the move-quality palette -- no-op if nothing's synced yet.
  void refreshProfile();
});

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
      const outcome: "win" | "loss" | "draw" =
        status.result === "checkmate" ? (status.winner === humanColor ? "win" : "loss") : "draw";
      recordBotResult(lcUser(), parseInt(botEloInput.value, 10), outcome);
      if (outcome === "win") {
        celebrate(document.getElementById("play-board-wrap"));
        playFanfareSound();
      }
      refreshAchievements();
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
  if (hasHangingPiece(chess, humanColor === "white" ? "w" : "b", currentHangMinValue())) {
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

const syncProgressBar = createProgressBar(document.querySelector<HTMLElement>("#sync-progress")!);
const fullSyncPrompt = document.querySelector<HTMLParagraphElement>("#full-sync-prompt")!;
const fullSyncPromptText = document.querySelector<HTMLSpanElement>("#full-sync-prompt-text")!;
const fullSyncBtn = document.querySelector<HTMLButtonElement>("#full-sync-btn")!;

/** `quick: true` is the fast onboarding path (this visitor's very first
 * sync ever, judged by having zero prior syncState rows) -- newest
 * games only, target set by QUICK_SYNC_GAME_TARGET, so there's something
 * to look at in seconds instead of however long a full account takes.
 * Every other call (a returning visitor, or explicitly clicking "Get my
 * full history") gets the real full sync, unchanged from before this
 * existed. */
async function runSync(username: string) {
  syncBtn.disabled = true;
  fullSyncPrompt.style.display = "none";

  try {
    const db = await openDb();

    // Real "resuming"/"first ever" signal, not guessed -- an actual count
    // of months this visitor already has synced, so the message (and
    // which sync path runs) says something true instead of a generic
    // "syncing…" that looks identical whether this is the first sync ever
    // or the hundredth.
    const alreadySynced = await countSyncStatesForUsername(db, username);
    const isFirstEverSync = alreadySynced === 0;
    setStatus(syncLog, isFirstEverSync ? `syncing ${username} for the first time…` : `You have ${alreadySynced} months already synced — checking for updates…`);

    const client = new ChessComClient(`chegga-web visitor sync for ${username}`);
    const onProgress = (progress: { monthsProcessed: number; totalMonths: number; gamesAdded: number; currentMonth?: string }) => {
      syncProgressBar.update(progress.monthsProcessed, progress.totalMonths, `Checking ${progress.currentMonth ?? "…"} — ${progress.gamesAdded} new games so far`);
    };

    currentUsername = username;
    try {
      localStorage.setItem(LAST_USERNAME_KEY, username);
    } catch {
      // best-effort only -- private browsing / blocked storage just means no auto-fill next time
    }
    writeHashState({ u: username }); // make the current view linkable/bookmarkable

    if (isFirstEverSync) {
      const result = await quickSyncRecentGames(db, client, username, QUICK_SYNC_GAME_TARGET, onProgress);
      db.close();
      syncProgressBar.hide();
      setStatus(syncLog, `Synced your ${result.gamesAdded} most recent games. Analyzing a first batch…`, "ok");
      if (!result.fullyCaughtUp) {
        // The real count, not the QUICK_SYNC_GAME_TARGET constant -- a
        // month with more games than the target (a very active recent
        // month) means the actual number synced can run well past the
        // target, so the copy says what really happened, not the goal.
        fullSyncPromptText.textContent = `That's your ${result.gamesAdded} most recent games.`;
        fullSyncPrompt.style.display = "";
      }
      await refreshProfile();
      // The actual "don't make them click twice to see anything" fix --
      // runs the same analysis path Analyze-recent's button does, just
      // triggered automatically instead of waiting for a second click.
      await runAnalyzeRecent(QUICK_SYNC_ANALYZE_COUNT);
    } else {
      const result = await syncGames(db, client, username, onProgress);
      db.close();
      syncProgressBar.hide();
      setStatus(
        syncLog,
        `${result.monthsProcessed} months checked, ${result.gamesAdded} new games synced for ${username}. Ready to analyze.`,
        "ok",
      );
      await refreshProfile();
    }
  } catch (err: any) {
    syncProgressBar.hide();
    // Both sync paths mark each month "complete" as they finish (see
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

// "Get my full history" -- the explicit second pass. By the time this is
// visible, this visitor's newest months are already marked complete (the
// quick sync did that), so a plain full syncGames() call here correctly
// picks up only what's left, oldest-first, no special-casing needed.
fullSyncBtn.addEventListener("click", async () => {
  if (!currentUsername) return;
  fullSyncBtn.disabled = true;
  fullSyncPrompt.style.display = "none";
  setStatus(syncLog, `Getting your full history for ${currentUsername}…`);
  try {
    const db = await openDb();
    const client = new ChessComClient(`chegga-web visitor sync for ${currentUsername}`);
    const result = await syncGames(db, client, currentUsername, (progress) => {
      syncProgressBar.update(progress.monthsProcessed, progress.totalMonths, `Checking ${progress.currentMonth ?? "…"} — ${progress.gamesAdded} new games so far`);
    });
    db.close();
    syncProgressBar.hide();
    setStatus(syncLog, `${result.monthsProcessed} months checked, ${result.gamesAdded} new games synced. Full history is up to date.`, "ok");
    await refreshProfile();
  } catch (err: any) {
    syncProgressBar.hide();
    setStatus(syncLog, `Full sync stopped partway: ${err.message ?? err}. What's already synced is saved — click "Get my full history" again to resume.`, "error");
    fullSyncPrompt.style.display = "";
  } finally {
    fullSyncBtn.disabled = false;
  }
});

// Auto-fill + auto-sync on load if a username was remembered -- this is
// the "skip the login screen" shortcut: no click needed, and any games
// already analyzed in a previous session show up immediately from
// IndexedDB while the (usually fast, current-month-only) re-sync runs.
(async () => {
  let saved: string | null = initialHash.u ?? null;
  if (!saved) {
    try {
      saved = localStorage.getItem(LAST_USERNAME_KEY);
    } catch {
      // ignore -- storage may be blocked
    }
  }
  if (saved) {
    usernameInput.value = saved;
    currentUsername = saved;
    try {
      await refreshProfile(); // show whatever's already analyzed immediately
    } catch (err: any) {
      // Real bug caught live: refreshProfile's openDb() call can fail (a
      // blocked/timed-out IndexedDB open -- see db.ts) before runSync ever
      // runs, so runSync's own error message never has a chance to show.
      // Uncaught, this was a silent failure -- nothing on screen, only a
      // console error -- that looked exactly like "the page just doesn't
      // work," indistinguishable from every button being broken.
      setStatus(syncLog, `Couldn't load your saved data: ${err.message ?? err}`, "error");
      return;
    }
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
const analyzeProgressBar = createProgressBar(document.querySelector<HTMLElement>("#analyze-progress")!);

/** Shared by the "Analyze most recent" form and the automatic first
 * batch that runs right after a brand-new visitor's quick sync -- same
 * logic either way, just two different triggers. */
async function runAnalyzeRecent(count: number) {
  if (!currentUsername) {
    setStatus(analyzeRecentLog, "Sync a username first.", "error");
    return;
  }

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
      const dateLabel = game.endTime ? new Date(game.endTime * 1000).toISOString().slice(0, 10) : game.chessComUuid;
      analyzeProgressBar.update(i + 1, candidates.length, `Analyzing ${dateLabel}`);
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
          analyzeProgressBar.hide();
          setStatus(analyzeRecentLog, `Stopped after 3 games in a row failed (engine may have crashed) — see console. ${analyzed} analyzed before that.`, "error");
          await refreshProfile();
          return;
        }
      }
    }

    analyzeProgressBar.hide();
    setStatus(
      analyzeRecentLog,
      failures.length
        ? `Analyzed ${analyzed} of ${candidates.length} (${failures.length} skipped — see console). Updating profile…`
        : `Analyzed ${candidates.length} games. Updating profile…`,
      failures.length ? "error" : "ok",
    );
    await refreshProfile();
  } catch (err: any) {
    analyzeProgressBar.hide();
    setStatus(analyzeRecentLog, `Analysis failed: ${err.message ?? err}`, "error");
  } finally {
    engine.terminate();
    db.close();
    analyzeRecentBtn.disabled = false;
  }
}

analyzeRecentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const count = Math.max(1, Math.min(200, parseInt(analyzeCountInput.value, 10) || 10));
  await runAnalyzeRecent(count);
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
    let latestCvMae: number | undefined;
    for (const game of analyzedGames) {
      const ownGameMoves = ownMoves.filter((m) => m.gameId === game.chessComUuid);
      const estimate = estimateStrength(game, ownGameMoves);
      if (estimate) {
        estimates.push(estimate.estimatedRating);
        latestCvR2 = estimate.cvR2; // same frozen model for every game, so any one value works
        latestCvMae = estimate.cvMae;
      }
    }
    const strength = estimates.length
      ? {
          avgEstimate: estimates.reduce((a, b) => a + b, 0) / estimates.length,
          sampleSize: estimates.length,
          cvR2: latestCvR2,
          cvMae: latestCvMae,
        }
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

// Shared state for the spine features (Today / Redemption / Achievements),
// populated by refreshProfile once per data load.
let lastAssessment: ReturnType<typeof assessSkills> | null = null;
let lastGamesAnalyzed = 0;
let lastGamesSynced = 0;
let redemptionRows: RedemptionRow[] = [];

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

// --- Road to a target rating / This week's plan / other growth cards ---

const roadSection = document.querySelector<HTMLElement>("#road-section")!;
const roadOutput = document.querySelector<HTMLDivElement>("#road-output")!;
const weeklyPlanSection = document.querySelector<HTMLElement>("#weekly-plan-section")!;
const weeklyPlanOutput = document.querySelector<HTMLDivElement>("#weekly-plan-output")!;
const blunderRateSection = document.querySelector<HTMLElement>("#blunder-rate-section")!;
const blunderRateOutput = document.querySelector<HTMLDivElement>("#blunder-rate-output")!;
const consistencySection = document.querySelector<HTMLElement>("#consistency-section")!;
const consistencyOutput = document.querySelector<HTMLDivElement>("#consistency-output")!;
const convertSection = document.querySelector<HTMLElement>("#convert-section")!;
const convertOutput = document.querySelector<HTMLDivElement>("#convert-output")!;

let roadTarget = 2000;
let lastRoadFeatures: Record<string, number> | null = null;
let lastRoadEstimate = 0;

function renderRoadOutput() {
  if (!lastRoadFeatures) return;
  const road = computeRoadToTarget(lastRoadFeatures, lastRoadEstimate, roadTarget);
  roadOutput.innerHTML = renderRoadToTarget(road);
}

// One delegated handler each for the two cards whose innerHTML is
// replaced wholesale on every data load (same reasoning as focusOutput).
roadOutput.addEventListener("change", (e) => {
  const sel = (e.target as HTMLElement).closest<HTMLSelectElement>("#road-target-select");
  if (!sel) return;
  const v = Number(sel.value);
  roadTarget = (ROAD_TARGET_OPTIONS as readonly number[]).includes(v) ? v : 2000;
  renderRoadOutput();
});
roadOutput.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".road-jump-btn");
  if (!btn) return;
  jumpToGrowthAction(JSON.parse(btn.dataset.action ?? "{}") as RoadAction | { kind: PlanActionKind; phase?: "opening" | "middlegame" | "endgame" });
});

weeklyPlanOutput.addEventListener("click", (e) => {
  const jump = (e.target as HTMLElement).closest<HTMLButtonElement>(".plan-jump-btn");
  if (jump) {
    jumpToGrowthAction(JSON.parse(jump.dataset.action ?? "{}") as { kind: PlanActionKind; phase?: "opening" | "middlegame" | "endgame" });
    return;
  }
});
weeklyPlanOutput.addEventListener("change", (e) => {
  const box = (e.target as HTMLElement).closest<HTMLInputElement>(".plan-check");
  if (!box) return;
  setTaskDone(lcUser(), isoWeek(), box.dataset.task ?? "", box.checked);
  box.closest(".plan-task")?.classList.toggle("plan-task-done", box.checked);
});

/** Shared "take me to the right card" jump used by both the road factors
 * and the weekly plan tasks. Superset of the focusOutput handler's kinds. */
function jumpToGrowthAction(action: { kind: string; phase?: "opening" | "middlegame" | "endgame" }) {
  switch (action.kind) {
    case "openings":
      expandCard("opening-section");
      openingSection.scrollIntoView({ behavior: "smooth", block: "start" });
      break;
    case "puzzle":
      puzzleFocusFilter = action.phase ? { phase: action.phase } : null;
      updatePuzzleFocusIndicator();
      expandCard("puzzle-section");
      loadPuzzle();
      puzzleSection.scrollIntoView({ behavior: "smooth", block: "start" });
      break;
    case "themed":
      expandCard("lichess-puzzle-section");
      document.querySelector("#lichess-puzzle-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      break;
    case "drill":
      expandCard("practice-section");
      drillSelect.closest("section.card")?.scrollIntoView({ behavior: "smooth", block: "start" });
      break;
    case "vision":
      expandCard("vision-section");
      visionSection.scrollIntoView({ behavior: "smooth", block: "start" });
      break;
    case "play":
      expandCard("play-section");
      document.querySelector("#play-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      break;
    case "redemption":
      expandCard("redemption-section");
      document.querySelector("#redemption-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      break;
  }
}

function suggestedBotElo(): number {
  const r = getRating(lcUser()).rating;
  return Math.max(800, Math.min(2400, Math.round(r / 50) * 50));
}

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
  if (patternsHtml) {
    clearEmptyFor("patterns-section");
    patternsSection.style.display = "";
    patternsOutput.innerHTML = patternsHtml;
  } else {
    emptyFor("patterns-section");
  }

  // Rivals, like game patterns, only need synced games -- no engine
  // analysis required, so this shows up right after sync too.
  const rivalRecords = computeRivalRecords(allGames);
  const rivalInsights = computeRivalInsights(rivalRecords);
  if (allGames.length) {
    clearEmptyFor("rivals-section");
    rivalsSection.style.display = "";
    rivalsOutput.innerHTML = renderRivalTracking(rivalRecords, rivalInsights);
  } else {
    emptyFor("rivals-section");
  }

  lastGamesSynced = allGames.length;
  // One-time puzzle-rating seed from the visitor's most recent rated game.
  if (currentUsername) {
    const recentRated = [...allGames].filter((g) => g.rated).sort((a, b) => b.endTime - a.endTime)[0];
    if (recentRated) {
      seedRating(currentUsername, recentRated.userColor === "white" ? recentRated.whiteRating : recentRated.blackRating);
    }
  }

  if (profile.gamesAnalyzed === 0) {
    // No analyzed games yet -- show each card in its designed waiting
    // state (redesign #5) instead of hiding it outright.
    emptyFor("profile-section");
    emptyFor("insights-section");
    emptyFor("opening-section");
    emptyFor("depth-section");
    emptyFor("puzzle-section");
    emptyFor("vision-section");
    emptyFor("focus-section");
    lastGamesAnalyzed = 0;
    redemptionRows = [];
    renderRedemptionSection();
    updateLichessRatingReadout();
    renderTodaySection();
    refreshAchievements();
    // These need analyzed moves -- keep them hidden until analysis runs.
    roadSection.style.display = "none";
    weeklyPlanSection.style.display = "none";
    blunderRateSection.style.display = "none";
    convertSection.style.display = "none";
    // Consistency only needs synced game results.
    renderGrowthConsistency(allGames, []);
    return;
  }
  clearEmptyFor("profile-section");
  profileSection.style.display = "";
  profileOutput.innerHTML = renderProfile(profile, strength);

  const assessment = assessSkills(ownMoves);
  lastAssessment = assessment;
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
  clearEmptyFor("focus-section");
  focusSection.style.display = "";
  focusOutput.innerHTML = renderSkillProfile(assessment, snapshots);

  clearEmptyFor("insights-section");
  renderInsights(profile, analyzedGames, ownMoves);

  lastOpeningFrequency = openingFrequency;
  if (openingFrequency.white.length > 0 || openingFrequency.black.length > 0) {
    clearEmptyFor("opening-section");
    openingSection.style.display = "";
    renderOpeningSection();
  } else {
    emptyFor("opening-section");
  }

  lastDepthFrequency = depthFrequency;
  if (depthFrequency.length > 0) {
    clearEmptyFor("depth-section");
    depthSection.style.display = "";
    renderDepthSection();
  } else {
    emptyFor("depth-section");
  }

  currentPuzzles = extractPuzzles(analyzedGames, ownMoves);
  if (currentPuzzles.length > 0) {
    clearEmptyFor("puzzle-section");
    puzzleSection.style.display = "";
    updatePuzzleStreakDisplay();
  } else {
    emptyFor("puzzle-section");
  }

  visionPositions = Array.from(new Set(ownMoves.map((m) => m.fenBefore)));
  if (visionPositions.length > 0) {
    clearEmptyFor("vision-section");
    visionSection.style.display = "";
    if (!visionCurrentFen) loadVisionPosition();
  } else {
    emptyFor("vision-section");
  }

  // --- Spine features (Today / Redemption / Achievements) ---
  lastGamesAnalyzed = profile.gamesAnalyzed;
  const gameById = new Map(analyzedGames.map((g) => [g.chessComUuid, g]));
  redemptionRows = [...currentPuzzles]
    .sort((a, b) => b.centipawnLoss - a.centipawnLoss)
    .map((p) => {
      const g = gameById.get(p.gameId);
      const opp = g ? (g.userColor === "white" ? g.blackRating : g.whiteRating) : 0;
      return { puzzle: p, opponentRating: opp || 1200, redeemed: isRedeemed(lcUser(), p.id) };
    });
  renderRedemptionSection();
  updateLichessRatingReadout();
  maybeUpgradeToday();
  renderTodaySection();
  refreshAchievements();

  // --- Growth cards (Road to rating / Weekly plan / Blunder rate /
  // Consistency / Games you didn't convert) ---
  renderGrowthCards(analyzedGames, ownMoves, allGames, strength, assessment);
}

function renderGrowthConsistency(allGames: GameRecord[], ownMoves: MoveAnalysisRecord[]) {
  const consistency = computeConsistency(allGames, ownMoves);
  if (consistency) {
    consistencySection.style.display = "";
    consistencyOutput.innerHTML = renderConsistency(consistency);
  } else {
    consistencySection.style.display = "none";
  }
}

function renderGrowthCards(
  analyzedGames: GameRecord[],
  ownMoves: MoveAnalysisRecord[],
  allGames: GameRecord[],
  strength: { avgEstimate: number } | undefined,
  assessment: ReturnType<typeof assessSkills>,
) {
  // Road to a target rating -- needs the strength estimate.
  const features = averageFeatures(analyzedGames, ownMoves);
  if (features && strength) {
    lastRoadFeatures = features;
    lastRoadEstimate = strength.avgEstimate;
    roadSection.style.display = "";
    renderRoadOutput();
  } else {
    roadSection.style.display = "none";
  }

  // This week's plan.
  const weakOpening = weakestOpening(analyzedGames, ownMoves);
  const plan = buildWeeklyPlan({
    focus: assessment.weakest?.category ?? null,
    puzzleRating: getRating(lcUser()).rating,
    weakestOpeningName: weakOpening?.openingName,
    botElo: suggestedBotElo(),
  });
  weeklyPlanSection.style.display = "";
  weeklyPlanOutput.innerHTML = renderWeeklyPlan(plan, getDoneTasks(lcUser(), plan.isoWeek));

  // Blunder rate over time.
  const blunderRate = computeBlunderRate(analyzedGames, ownMoves);
  if (blunderRate) {
    blunderRateSection.style.display = "";
    blunderRateOutput.innerHTML = renderBlunderRate(blunderRate);
  } else {
    blunderRateSection.style.display = "none";
  }

  // Consistency & tilt.
  renderGrowthConsistency(allGames, ownMoves);

  // Games you didn't convert.
  const thrown = findThrownGames(analyzedGames, ownMoves);
  if (thrown.length > 0) {
    convertSection.style.display = "";
    convertOutput.innerHTML = renderThrownGames(thrown);
  } else {
    convertSection.style.display = "none";
  }
}

// --- Insights (quick-win stats derived from data already computed) ---

const insightsSection = document.querySelector<HTMLElement>("#insights-section")!;
const insightsOutput = document.querySelector<HTMLDivElement>("#insights-output")!;
const patternsSection = document.querySelector<HTMLElement>("#patterns-section")!;
const patternsOutput = document.querySelector<HTMLDivElement>("#patterns-output")!;
const rivalsSection = document.querySelector<HTMLElement>("#rivals-section")!;
const rivalsOutput = document.querySelector<HTMLDivElement>("#rivals-output")!;

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

  // Prefer puzzles that are "due" -- never seen, or past their spaced-
  // repetition interval (critique #2). Only once nothing is due do we
  // recycle the whole pool, so a fluked-once pattern still comes back.
  const due = currentUsername ? pool.filter((p) => isDue(currentUsername!, p.id)) : pool;
  const candidates = due.length > 0 ? due : pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/** Turns the blunder tag already computed for this move in Phase 2 into a
 * plain sentence naming the idea, so the puzzle feedback teaches "why"
 * instead of just stating the engine's move (critique #9). No engine call
 * -- the tag is deterministic and already on the puzzle. */
function puzzleWhy(p: Puzzle): string {
  switch (p.blunderTag) {
    case "missed_mate":
      return ` There was a forced mate here — ${p.bestMoveSan} starts it.`;
    case "allowed_mate":
      return ` ${p.playedSan} walked into a forced mate; ${p.bestMoveSan} avoids it.`;
    case "hung_material":
      return ` ${p.playedSan} left a piece hanging — ${p.bestMoveSan} keeps your material defended.`;
    case "missed_capture":
      return ` ${p.bestMoveSan} wins material with a capture you passed up.`;
    case "positional":
      return ` No tactic — ${p.bestMoveSan} is just a clearly stronger move for the position.`;
    default:
      return "";
  }
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
          ? `✅ Correct — ${activePuzzle.bestMoveSan} was the move.${puzzleWhy(activePuzzle)}`
          : `❌ Not quite. You played ${activePuzzle.playedSan}; the engine's move was ${activePuzzle.bestMoveSan}.${puzzleWhy(activePuzzle)}`,
        correct ? "ok" : "error",
      );
      if (correct) {
        flash(puzzleBoardWrap, "good");
        playSuccessSound();
        confetti(puzzleBoardWrap, 0.8);
        bumpToday(lcUser(), "review");
        renderTodaySection();
      } else {
        shake(puzzleBoardWrap);
        flash(puzzleBoardWrap, "bad");
        playFailSound();
      }
      refreshAchievements();
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

// --- Themed puzzles (bundled Lichess CC0 library) ---

const lichessThemeSelect = document.querySelector<HTMLSelectElement>("#lichess-theme")!;
const lichessRatingSelect = document.querySelector<HTMLSelectElement>("#lichess-rating")!;
const lichessNextBtn = document.querySelector<HTMLButtonElement>("#lichess-next-btn")!;
const lichessStreakEl = document.querySelector<HTMLSpanElement>("#lichess-streak")!;
const lichessStatus = document.querySelector<HTMLParagraphElement>("#lichess-status")!;
const lichessProgressEl = document.querySelector<HTMLParagraphElement>("#lichess-progress")!;
const lichessFocusIndicator = document.querySelector<HTMLParagraphElement>("#lichess-focus-indicator")!;
const lichessRatingReadout = document.querySelector<HTMLParagraphElement>("#lichess-rating-readout")!;
const lcBoardWrapEl = document.querySelector<HTMLElement>("#lichess-board-wrap")!;
const lichessLoadBar = createProgressBar(document.querySelector<HTMLElement>("#lichess-load-progress")!);
let lcCombo = 0; // consecutive themed-puzzle solves, for escalating juice

// Populate the theme picker, grouped.
{
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const t of THEME_OPTIONS) {
    let g = groups.get(t.group);
    if (!g) {
      g = document.createElement("optgroup");
      g.label = t.group;
      groups.set(t.group, g);
      lichessThemeSelect.appendChild(g);
    }
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.label;
    g.appendChild(opt);
  }
}

let lcPuzzle: CuratedPuzzleRecord | null = null;
let lcBoard: PlayBoard | null = null;
let lcSolIdx = 1;
let lcDone = false;
let lcFocusThemes: string[] | null = null; // set by "practice this" from PK taxonomy / focus
const lcSeen = new Set<string>(); // session-level no-immediate-repeat

function lcUser(): string {
  return currentUsername || "guest";
}

function updateLichessStreakDisplay() {
  const s = getStreak(lcUser());
  lichessStreakEl.textContent = `🔥 ${s.currentStreak}-day streak (best ${s.bestStreak})`;
}

function parseRatingBand(): [number, number] {
  if (lichessRatingSelect.value === "match") {
    const r = getRating(lcUser()).rating;
    return [r - 120, r + 120];
  }
  const [lo, hi] = lichessRatingSelect.value.split("-").map(Number);
  return [lo, hi];
}

function updateLichessRatingReadout(animateFrom?: number) {
  const st = getRating(lcUser());
  const spark = ratingSparkline(st.history);
  lichessRatingReadout.innerHTML =
    st.solved === 0
      ? `Puzzle rating: <strong id="lichess-rating-num">${st.rating}</strong> (unrated — solve a few to calibrate)`
      : `Puzzle rating: <strong id="lichess-rating-num">${st.rating}</strong> &nbsp;${spark} &nbsp;<span class="status-line">${st.solved} solved</span>`;
  const numEl = document.getElementById("lichess-rating-num");
  if (animateFrom !== undefined && numEl) {
    countUp(numEl, animateFrom, st.rating);
    bump(numEl);
  }
}

function updateLichessFocusIndicator() {
  if (!lcFocusThemes) {
    lichessFocusIndicator.style.display = "none";
    return;
  }
  lichessFocusIndicator.style.display = "";
  lichessFocusIndicator.textContent = `Focused on: ${describeThemes(lcFocusThemes.join(" ")) || lcFocusThemes.join(", ")} — `;
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = "Clear focus";
  clear.style.marginLeft = "8px";
  clear.addEventListener("click", () => {
    lcFocusThemes = null;
    updateLichessFocusIndicator();
  });
  lichessFocusIndicator.appendChild(clear);
}

/** SAN for a UCI move applied to fen + the moves already played, for the
 * "the move was ..." feedback. Best-effort — returns the raw UCI on any
 * parse failure rather than throwing. */
function sanForLine(fen: string, uciMoves: string[], nextUci: string): string {
  try {
    const c = new Chess(fen);
    for (const u of uciMoves) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4) || undefined });
    const m = c.move({ from: nextUci.slice(0, 2), to: nextUci.slice(2, 4), promotion: nextUci.slice(4) || undefined });
    return m?.san ?? nextUci;
  } catch {
    return nextUci;
  }
}

async function loadLichessPuzzle() {
  lichessNextBtn.disabled = true;
  setStatus(lichessStatus, "Loading…");
  setStatus(lichessProgressEl, "");
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (err: any) {
    setStatus(lichessStatus, `Couldn't open local storage: ${err.message ?? err}`, "error");
    lichessNextBtn.disabled = false;
    return;
  }
  try {
    await ensureCuratedPuzzlesLoaded(db, (frac, note) => lichessLoadBar.update(Math.round(frac * 100), 100, note));
    lichessLoadBar.hide();

    const [lo, hi] = parseRatingBand();
    const themes = lcFocusThemes ?? [lichessThemeSelect.value];
    const p = await pickCuratedPuzzle(db, { themes, ratingMin: lo, ratingMax: hi, excludeIds: lcSeen });
    if (!p) {
      setStatus(lichessStatus, "No puzzles match that theme and difficulty — try a wider band.", "error");
      return;
    }
    lcSeen.add(p.id);
    if (lcSeen.size > 500) lcSeen.clear(); // bounded

    lcPuzzle = p;
    lcSolIdx = 1;
    lcDone = false;
    const moves = p.moves.split(" ");

    // Solver is whoever is to move AFTER the puzzle's setup move (moves[0]).
    const scratch = new Chess(p.fen);
    scratch.move({ from: moves[0].slice(0, 2), to: moves[0].slice(2, 4), promotion: moves[0].slice(4) || undefined });
    const solverColor: "white" | "black" = scratch.turn() === "w" ? "white" : "black";

    if (!lcBoard) {
      lcBoard = new PlayBoard(document.querySelector<HTMLDivElement>("#lichess-board-wrap")!, (uci) => onLichessMove(uci));
    }
    lcBoard.reset(solverColor, p.fen);
    lcBoard.applyMove(moves[0]);
    lcBoard.setLocked(false);

    setStatus(
      lichessStatus,
      `Rated ${p.rating}${describeThemes(p.themes) ? ` — ${describeThemes(p.themes)}` : ""}. ${solverColor[0].toUpperCase() + solverColor.slice(1)} to move.`,
    );
    setStatus(lichessProgressEl, moves.length > 3 ? "Find the whole line." : "Find the move.");
  } catch (err: any) {
    lichessLoadBar.hide();
    setStatus(lichessStatus, `Puzzle load failed: ${err.message ?? err}`, "error");
  } finally {
    db.close();
    lichessNextBtn.disabled = false;
  }
}

function onLichessMove(uci: string) {
  if (!lcPuzzle || lcDone || !lcBoard) return;
  const moves = lcPuzzle.moves.split(" ");
  const expected = moves[lcSolIdx];

  if (uci !== expected) {
    lcDone = true;
    lcBoard.setLocked(true);
    recordAttempt(lcUser(), `lichess:${lcPuzzle.id}`, false);
    const before = getRating(lcUser()).rating;
    const st = applyResult(lcUser(), lcPuzzle.rating, false);
    lcCombo = 0;
    updateLichessStreakDisplay();
    updateLichessRatingReadout(before);
    shake(lcBoardWrapEl);
    flash(lcBoardWrapEl, "bad");
    playFailSound();
    floatText(lichessRatingReadout, `${st.rating - before}`, "bad");
    const wantSan = sanForLine(lcPuzzle.fen, moves.slice(0, lcSolIdx), expected);
    setStatus(lichessProgressEl, `❌ ${wantSan} was the move. Puzzle rating ${st.rating}.${describeThemes(lcPuzzle.themes) ? ` (${describeThemes(lcPuzzle.themes)})` : ""}`, "error");
    onThemedPuzzleResolved(false);
    return;
  }

  lcSolIdx += 1;
  if (lcSolIdx >= moves.length) {
    lcDone = true;
    lcBoard.setLocked(true);
    recordAttempt(lcUser(), `lichess:${lcPuzzle.id}`, true);
    const before = getRating(lcUser()).rating;
    const st = applyResult(lcUser(), lcPuzzle.rating, true);
    lcCombo += 1;
    updateLichessStreakDisplay();
    updateLichessRatingReadout(before);
    flash(lcBoardWrapEl, "good");
    playSuccessSound();
    const delta = st.rating - before;
    floatText(lichessRatingReadout, delta >= 0 ? `+${delta}` : `${delta}`, "good");
    const comboPower = lcCombo >= 10 ? 2 : lcCombo >= 5 ? 1.5 : lcCombo >= 3 ? 1.1 : 0.8;
    confetti(lcBoardWrapEl, comboPower);
    if (lcCombo === 3 || lcCombo === 5 || lcCombo === 10) {
      floatText(lcBoardWrapEl, `${lcCombo} in a row!`, "gold");
    }
    setStatus(lichessProgressEl, `✅ Solved! Puzzle rating ${st.rating}.${lcCombo >= 2 ? ` 🔥 ${lcCombo} in a row.` : ""}${describeThemes(lcPuzzle.themes) ? ` (${describeThemes(lcPuzzle.themes)})` : ""}`, "ok");
    onThemedPuzzleResolved(true);
    return;
  }

  // Opponent's reply, then it's the solver's move again.
  lcBoard.applyMove(moves[lcSolIdx]);
  lcSolIdx += 1;
  lcBoard.setLocked(false);
  setStatus(lichessProgressEl, "✓ Keep going…", "ok");
}

/** Entry point for "practice this" buttons elsewhere (PK taxonomy nodes):
 * sets the theme focus, reveals the card, and loads a first puzzle. */
function practiceLichessThemes(themes: string[], label: string) {
  lcFocusThemes = themes;
  updateLichessFocusIndicator();
  expandCard("lichess-puzzle-section");
  document.getElementById("lichess-puzzle-section")?.scrollIntoView({ block: "start", behavior: "smooth" });
  setStatus(lichessStatus, `Practicing: ${label}`);
  void loadLichessPuzzle();
}

lichessNextBtn.addEventListener("click", () => void loadLichessPuzzle());
lichessThemeSelect.addEventListener("change", () => {
  lcFocusThemes = null;
  updateLichessFocusIndicator();
});
lichessRatingSelect.addEventListener("change", () => updateLichessRatingReadout());
updateLichessStreakDisplay();
updateLichessRatingReadout();

// --- Redemption list (replay a past loss) ---

const redemptionSection = document.querySelector<HTMLElement>("#redemption-section")!;
const redemptionOutput = document.querySelector<HTMLDivElement>("#redemption-output")!;
const redemptionStatus = document.querySelector<HTMLParagraphElement>("#redemption-status")!;
const redemptionProgressEl = document.querySelector<HTMLParagraphElement>("#redemption-progress")!;

let redemptionBoard: PlayBoard | null = null;
let activeRedemption: RedemptionRow | null = null;
let redemptionFirstMoveDone = false;

function renderRedemptionSection() {
  if (!redemptionRows.length) {
    emptyFor("redemption-section");
    return;
  }
  clearEmptyFor("redemption-section");
  redemptionSection.style.display = "";
  redemptionOutput.innerHTML = renderRedemptionList(redemptionRows, activeRedemption?.puzzle.id ?? null);
}

function loadRedemption(row: RedemptionRow) {
  activeRedemption = row;
  redemptionFirstMoveDone = false;
  const p = row.puzzle;
  if (!redemptionBoard) {
    redemptionBoard = new PlayBoard(document.querySelector<HTMLDivElement>("#redemption-board-wrap")!, (uci) => onRedemptionMove(uci));
  }
  redemptionBoard.reset(p.sideToMove, p.fenBefore);
  redemptionBoard.setLocked(false);
  setStatus(redemptionStatus, `Your game vs ~${row.opponentRating}. You played ${p.playedSan} and lost ${p.centipawnLoss}cp. Find the engine's move for ${p.sideToMove}.`);
  setStatus(redemptionProgressEl, "");
  renderRedemptionSection();
}

async function onRedemptionMove(uci: string) {
  if (!activeRedemption || !redemptionBoard) return;
  const p = activeRedemption.puzzle;

  const redemptionWrapEl = document.querySelector<HTMLElement>("#redemption-board-wrap");

  if (!redemptionFirstMoveDone) {
    if (uci !== p.bestMoveUci) {
      redemptionBoard.setLocked(true);
      shake(redemptionWrapEl);
      flash(redemptionWrapEl, "bad");
      playFailSound();
      setStatus(redemptionProgressEl, `❌ Not the move — the engine played ${p.bestMoveSan}. Load it again to retry.`, "error");
      return;
    }
    redemptionFirstMoveDone = true;
    const wasNew = !activeRedemption.redeemed;
    if (wasNew) {
      markRedeemed(lcUser(), p.id);
      activeRedemption.redeemed = true;
      bumpToday(lcUser(), "redemption");
      renderTodaySection();
      refreshAchievements();
    }
    if (wasNew) {
      celebrate(redemptionWrapEl);
      playLevelUpSound();
      floatText(redemptionWrapEl, "Redeemed!", "gold");
    } else {
      flash(redemptionWrapEl, "good");
      playSuccessSound();
    }
    setStatus(redemptionProgressEl, `✅ Redeemed — ${p.bestMoveSan}. Now play it out against the bot.`, "ok");
    renderRedemptionSection();
    await maybePlayRedemptionBot();
    return;
  }
  await maybePlayRedemptionBot();
}

async function maybePlayRedemptionBot() {
  if (!activeRedemption || !redemptionBoard) return;
  const status = redemptionBoard.getStatus();
  if (status.over) {
    redemptionBoard.setLocked(true);
    setStatus(redemptionProgressEl, "Game over — load another loss to redeem.", "ok");
    return;
  }
  const solverColor = activeRedemption.puzzle.sideToMove;
  const isSolverTurn = redemptionBoard.getFen().split(" ")[1] === (solverColor === "white" ? "w" : "b");
  if (isSolverTurn) {
    redemptionBoard.setLocked(false);
    return;
  }
  redemptionBoard.setLocked(true);
  try {
    if (!botEngine) {
      botEngine = new Engine();
      await botEngine.init();
    }
    const mv = await chooseBotMove(botEngine, redemptionBoard.getFen(), activeRedemption.opponentRating);
    redemptionBoard.applyMove(mv.uci);
  } catch {
    // if the bot fails, just hand the move back to the player
  }
  redemptionBoard.setLocked(false);
  const s2 = redemptionBoard.getStatus();
  if (s2.over) {
    redemptionBoard.setLocked(true);
    setStatus(redemptionProgressEl, "Game over — load another loss to redeem.", "ok");
  }
}

redemptionOutput.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".redeem-btn[data-redeem-id]");
  if (!btn) return;
  const row = redemptionRows.find((r) => r.puzzle.id === btn.dataset.redeemId);
  if (row) loadRedemption(row);
});

// --- Achievements ---

const achievementsOutput = document.querySelector<HTMLDivElement>("#achievements-output")!;

function gatherAchievementStats(): AchievementStats {
  const user = lcUser();
  const blunderSolved = Object.values(getProgress(user)).filter((p) => p.solved).length;
  return {
    puzzlesSolved: blunderSolved,
    themedSolved: getRating(user).solved,
    puzzleRating: getRating(user).rating,
    puzzleBestStreak: getStreak(user).bestStreak,
    redeemed: redeemedCount(user),
    gamesAnalyzed: lastGamesAnalyzed,
    gamesSynced: lastGamesSynced,
    todayStreakBest: getTodayStreak(user).best,
    botBestWinElo: bestWinElo(user),
  };
}

function renderAchievementsSection() {
  const unlocked = getUnlocked(lcUser());
  const grid = ACHIEVEMENTS.map((a) => {
    const got = unlocked.has(a.id);
    return `<div class="achv${got ? " achv-got" : ""}" title="${a.description}">
      <span class="achv-name">${got ? "🏅 " : "🔒 "}${a.label}</span>
      <span class="achv-desc">${a.description}</span>
    </div>`;
  }).join("");
  achievementsOutput.innerHTML = `
    <p class="status-line">${unlocked.size}/${ACHIEVEMENTS.length} unlocked</p>
    <div class="achv-grid">${grid}</div>`;
}

function refreshAchievements() {
  const fresh = checkAchievements(lcUser(), gatherAchievementStats());
  // Cap the banner run so a first-time rollout (which can unlock a dozen
  // at once from existing history) doesn't bury the screen -- show the
  // first few, then a single summary line.
  const SHOWN = 4;
  fresh.slice(0, SHOWN).forEach((id, i) => {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (a) window.setTimeout(() => achievementBanner(a.label, a.description), i * 350);
  });
  if (fresh.length > SHOWN) {
    window.setTimeout(() => achievementBanner(`+${fresh.length - SHOWN} more unlocked`, "See the Achievements card"), SHOWN * 350);
  }
  if (fresh.length) {
    confetti(null, 1.3);
    playLevelUpSound();
  }
  renderAchievementsSection();
}

let toastTimer: number | undefined;
function showToast(text: string) {
  let el = document.getElementById("chegga-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "chegga-toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("toast-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove("toast-visible"), 4000);
}

// --- Today ---

const todayOutput = document.querySelector<HTMLDivElement>("#today-output")!;

/** Maps the skill assessment's weakest category to Lichess puzzle themes
 * for Today's focus, reusing the PK map where a specific node fits. */
function focusThemesFromAssessment(): string[] {
  const a = lastAssessment;
  if (!a || !a.weakest) return [];
  const cat = a.weakest.category;
  const action = a.prescription?.action;
  if (action && action.kind === "puzzle" && action.blunderTag) {
    const map: Record<string, string[]> = {
      hung_material: ["hangingPiece"],
      missed_capture: ["capturingDefender", "hangingPiece"],
      missed_mate: ["mate", "mateIn2"],
      allowed_mate: ["defensiveMove"],
      positional: ["quietMove"],
    };
    if (map[action.blunderTag]) return map[action.blunderTag];
  }
  if (cat === "endgame") return ["endgame", "rookEndgame", "pawnEndgame"];
  if (cat === "opening") return ["opening"];
  if (cat === "timeManagement") return ["fork", "hangingPiece"];
  return ["fork", "pin", "discoveredAttack"]; // middlegame default
}

function dueReviewCount(): number {
  return currentPuzzles.filter((p) => isDue(lcUser(), p.id)).length;
}

function ensureTodayForUser() {
  const user = lcUser();
  let state = getToday(user);
  if (!state) {
    const r = getRating(user).rating;
    state = buildToday({
      focusThemes: focusThemesFromAssessment(),
      ratingMin: r - 120,
      ratingMax: r + 120,
      hasAnalyzedGames: lastGamesAnalyzed > 0,
      dueReviewCount: dueReviewCount(),
      unredeemedCount: redemptionRows.filter((row) => !row.redeemed).length,
    });
    saveToday(user, state);
  }
  return state;
}

/** If today's set was built before any analysis data was available (only
 * a themed item) but games have since been analyzed, rebuild it with the
 * review/redemption items — preserving the themed progress so far. */
function maybeUpgradeToday() {
  const user = lcUser();
  const state = getToday(user);
  if (!state) return;
  const hasNonThemed = state.items.some((i) => i.kind !== "themed");
  if (hasNonThemed || lastGamesAnalyzed === 0) return;
  const themedDone = state.items.find((i) => i.kind === "themed")?.done ?? 0;
  const r = getRating(user).rating;
  const fresh = buildToday({
    focusThemes: focusThemesFromAssessment(),
    ratingMin: r - 120,
    ratingMax: r + 120,
    hasAnalyzedGames: true,
    dueReviewCount: dueReviewCount(),
    unredeemedCount: redemptionRows.filter((row) => !row.redeemed).length,
  });
  const t = fresh.items.find((i) => i.kind === "themed");
  if (t) t.done = Math.min(themedDone, t.target);
  saveToday(user, fresh);
}

function renderTodaySection() {
  const user = lcUser();
  const state = ensureTodayForUser();
  if (isTodayComplete(state) && !state.streakCounted) {
    state.streakCounted = true;
    saveToday(user, state);
    const streak = recordTodayComplete(user);
    refreshAchievements();
    celebrate(document.getElementById("today-section"));
    playFanfareSound();
    showToast(`Today complete — 🔥 ${streak.current}-day streak`);
  }
  todayOutput.innerHTML = renderToday(state, getTodayStreak(user));
}

function onThemedPuzzleResolved(solved: boolean) {
  if (solved) {
    bumpToday(lcUser(), "themed");
    renderTodaySection();
  }
  refreshAchievements();
}

// "Start" buttons inside Today: configure + scroll to the right card.
todayOutput.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.id === "today-keep-going") {
    document.getElementById("lichess-puzzle-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const btn = target.closest<HTMLButtonElement>(".today-start-btn[data-today-kind]");
  if (!btn) return;
  const kind = btn.dataset.todayKind as TodayKind;
  const state = getToday(lcUser());
  const item = state?.items.find((i) => i.kind === kind);

  if (kind === "themed") {
    if (item?.themes) {
      lcFocusThemes = item.themes;
      updateLichessFocusIndicator();
    }
    expandCard("lichess-puzzle-section");
    document.getElementById("lichess-puzzle-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    void loadLichessPuzzle();
  } else if (kind === "review") {
    expandCard("puzzle-section");
    document.getElementById("puzzle-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    loadPuzzle();
  } else if (kind === "redemption") {
    expandCard("redemption-section");
    document.getElementById("redemption-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    const next = redemptionRows.find((r) => !r.redeemed);
    if (next) loadRedemption(next);
  }
});

renderTodaySection();
renderAchievementsSection();

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
  const actuallyHanging = hasHangingPiece(chess, chess.turn(), currentHangMinValue());
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
// Deployed via Vercel, connected to GitHub for auto-deploy (2026-08-26).
