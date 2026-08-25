// Chegga Web — frozen strength-heuristic coefficients (Phase 4)
//
// NOT trained live in the browser — there's no server to run it on, per
// the phase plan's explicit call. This is a plain Ridge regression
// (scikit-learn, `sklearn.linear_model.Ridge`, alpha=10, StandardScaler-
// normalized features), trained OFFLINE against Chegga's own real,
// already-analyzed game history and frozen into this constant. Same
// feature set as the backend's real RandomForest model
// (`strength_model.py::FEATURE_NAMES`/`extract_features`) — reused so a
// future upgrade to real per-visitor training only has to swap the model,
// not redefine what a "feature" is.
//
// Retrain by re-running the training query in
// `backend/app/services/strength_model.py` with a plain Ridge model in
// place of the RandomForestRegressor and re-freezing the coefficients —
// there is no live/automatic retraining path here.
//
// cvR2 of 0.137 is honestly low — a simple linear model over these
// features explains only a modest share of rating variance. That's
// exactly why this is presented in the UI as a directional estimate, not
// the same cross-validated model the backend produces (cvR2 there is
// typically much higher thanks to RandomForest's non-linear splits).

export const STRENGTH_MODEL = {
  featureNames: [
    "avg_cp_loss",
    "blunder_rate",
    "mistake_rate",
    "inaccuracy_rate",
    "good_rate",
    "excellent_rate",
    "best_rate",
    "opening_avg_cp_loss",
    "middlegame_avg_cp_loss",
    "endgame_avg_cp_loss",
    "num_own_moves",
    "is_white",
    "time_class_bullet",
    "time_class_blitz",
    "time_class_rapid",
    "time_class_daily",
  ] as const,
  scalerMean: [
    67.76296753095703, 0.07879512715488285, 0.0769248963718998, 0.12007159341596987, 0.13620860601942442,
    0.14778213524864375, 0.440217641789181, 29.345834207398102, 69.09702716171546, 75.16351636367823,
    38.91541850220264, 0.5011453744493392, 0.1360352422907489, 0.8098678414096916, 0.05409691629955947, 0.0,
  ],
  scalerScale: [
    38.203911113804956, 0.05956522332228212, 0.056453319569693725, 0.06639571664254022, 0.06770548596714807,
    0.07020696313932864, 0.11856109169717895, 21.262909737892226, 63.39448783821197, 103.32883981695379,
    17.790961427795224, 0.49999868811565734, 0.34282598376676765, 0.3924053017736958, 0.22620884144179965, 1.0,
  ],
  coefficients: [
    0.21762054848186937, -2.5915383148587714, 0.08001785061785187, 0.29527225642194277, 1.7516887558573353,
    -0.07928023846016265, 0.1451619427901591, -0.01963007141980502, 2.7667569542776462, 1.5538743175382115,
    7.392493471908915, 0.13179194658689192, 14.424555768430942, -14.743870441208827, 3.7154180302042614, 0.0,
  ],
  intercept: 1737.8854625550664,
  trainedOnGames: 5675,
  cvMae: 59.0, // mean absolute error, in rating points, from k-fold cross-validation
  cvR2: 0.137, // honestly modest -- see the note above
} as const;
