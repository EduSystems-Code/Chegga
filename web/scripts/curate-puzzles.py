"""Stream the Lichess CC0 puzzle DB from stdin (zstd-compressed CSV),
filter for quality, stratified-sample to ~100k across rating bands x
themes, and write a compact positional-tuple JSON to the path in argv[1].

Usage:
  curl -s https://database.lichess.org/lichess_db_puzzle.csv.zst \
    | python curate_puzzles.py ../.../web/public/curated-puzzles.json
"""
import sys, io, csv, json, collections
import zstandard

TARGET_TOTAL = 100_000
BAND_LO, BAND_HI, BAND_STEP = 600, 2500, 100          # bands 600..2500 => 20 bands
PER_BAND = 5_200                                       # ~104k before trim
PER_BAND_THEME = 750                                   # keeps one theme from dominating a band
MIN_POP = 88
MIN_PLAYS = 1_000
MAX_RD = 90

out_path = sys.argv[1]

dctx = zstandard.ZstdDecompressor()
stream = dctx.stream_reader(sys.stdin.buffer)
text = io.TextIOWrapper(stream, encoding="utf-8", newline="")
reader = csv.reader(text)

header = next(reader)
# PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate
assert header[0] == "PuzzleId" and header[7] == "Themes", header

band_count = collections.Counter()
band_theme_count = collections.defaultdict(collections.Counter)
theme_total = collections.Counter()
seen_fen = set()
rows = []

scanned = 0
for r in reader:
    scanned += 1
    if scanned % 500_000 == 0:
        print(f"  ...scanned {scanned:,}, kept {len(rows):,}", file=sys.stderr)
    try:
        rating = int(r[3]); rd = int(r[4]); pop = int(r[5]); plays = int(r[6])
    except (ValueError, IndexError):
        continue
    themes = r[7].strip()
    if not themes:
        continue
    if pop < MIN_POP or plays < MIN_PLAYS or rd > MAX_RD:
        continue
    fen = r[1]
    if fen in seen_fen:
        continue

    band = min(max(rating, BAND_LO), BAND_HI) // BAND_STEP * BAND_STEP
    if band_count[band] >= PER_BAND:
        continue
    tlist = themes.split(" ")
    btc = band_theme_count[band]
    if not any(btc[t] < PER_BAND_THEME for t in tlist):
        continue

    seen_fen.add(fen)
    band_count[band] += 1
    for t in tlist:
        btc[t] += 1
        theme_total[t] += 1
    rows.append([r[0], fen, r[2], rating, rd, pop, themes, r[9].strip()])

# Trim to TARGET_TOTAL proportionally per band (rows are in file order,
# which is effectively random by PuzzleId hash -> a head slice per band is fine).
if len(rows) > TARGET_TOTAL:
    keep_frac = TARGET_TOTAL / len(rows)
    per_band_keep = {b: max(1, int(c * keep_frac)) for b, c in band_count.items()}
    kept, taken = [], collections.Counter()
    for row in rows:
        b = min(max(row[3], BAND_LO), BAND_HI) // BAND_STEP * BAND_STEP
        if taken[b] < per_band_keep[b]:
            taken[b] += 1
            kept.append(row)
    rows = kept

payload = {
    "v": 1,
    "source": "lichess_db_puzzle.csv CC0, dated 2026-08-02, curated subset",
    "fields": ["id", "fen", "moves", "rating", "ratingDeviation", "popularity", "themes", "openingTags"],
    "rows": rows,
}
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)

print(f"\nscanned {scanned:,} rows, wrote {len(rows):,} puzzles to {out_path}", file=sys.stderr)
print("\nby rating band:", file=sys.stderr)
for b in sorted(band_count):
    bar = "#" * (band_count[b] // 120)
    print(f"  {b:>4}-{b+BAND_STEP-1:<4} {band_count[b]:>6}  {bar}", file=sys.stderr)
print("\ntop 25 themes (pre-trim counts):", file=sys.stderr)
for t, c in theme_total.most_common(25):
    print(f"  {t:<22} {c:>7,}", file=sys.stderr)
