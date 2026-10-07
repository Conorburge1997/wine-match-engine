// Serverless function (Vercel /api route) — the private matching backend.
//
// The real vineyard/wine inventory never ships to the browser. This
// function holds it server-side (currently a 289-row DUMMY dataset — see
// api/data/wines.json's header comment and the Notes written into the
// original spreadsheet — standing in for what real vineyard partners will
// eventually supply) and the match tool's frontend only ever receives:
//   - small counts (how many regions/wines match so far), or
//   - the final ranked shortlist for a submitted brief.
// The dataset itself, and the scoring internals, are never sent to the
// client — this is the actual "private backend, public surfaces only the
// results" pattern described for the production version of the tool.
//
// Actions (POST body: { action, ...params }):
//   "regionCounts" — given selected states, returns how many regions (and
//                    optionally, how many wines) are available per state/
//                    region, filtered by any style/variety already picked.
//   "search"       — given a full brief, scores and ranks the dataset and
//                    returns only the top 3 per matched style/varietal
//                    group (never the full list) — e.g. if the buyer
//                    picked Red+White with Shiraz+Chardonnay varietals,
//                    the response groups results as "Shiraz" (top 3),
//                    "Chardonnay" (top 3). If no varietal is picked for a
//                    style, that style itself is the group. This keeps the
//                    buyer-facing surface small and curated rather than
//                    dumping the whole dataset into the browser.
//   "debug"        — INTERNAL/OPERATOR ONLY. Not called from the public
//                    match tool. Returns the full scored+ranked list for
//                    every wine in the dataset, with per-wine notes, so
//                    Conor can see what's scoring well/badly across the
//                    whole catalogue while tuning the brief or the scoring
//                    weights. Never linked from buyer-facing pages.

const WINES = require("./data/wines.json");
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Ordering rules
// A buyer orders at least VINEYARD_MIN bottles (one 12-bottle case) from each
// vineyard they buy from, mixed across that vineyard's wines however they like.
// The order total minimum (48) is enforced in the match tool's pallet.
const VINEYARD_MIN = 12;

// ---------------------------------------------------------------------------
// Destination pricing — THEORETICAL PLACEHOLDERS, NOT DECIDED.
// The price a buyer sees is the vineyard's price plus everything it takes to
// land the wine in their market (margin, shipping, paperwork, duties), shown as
// one all-in price per bottle. These numbers are stand-ins so the tool can show
// prices that change by destination; set the real ones before launch.
// Lives server-side only, so the markup is never sent to the browser.
const MARKET_UPLIFT = {
  "Hong Kong": 0.15,
  "Mainland China": 0.30,
  "Japan": 0.30,
  "Singapore": 0.20,
  "Other": 0.35,
};
// Optional per-country overrides for buyers who pick "Other", e.g. { "United Kingdom": 0.40 }
const COUNTRY_UPLIFT = {};

function upliftFor(brief) {
  if (brief && brief.market === "Other" && brief.otherCountry && COUNTRY_UPLIFT[brief.otherCountry] != null) {
    return COUNTRY_UPLIFT[brief.otherCountry];
  }
  const m = brief && MARKET_UPLIFT[brief.market];
  return m != null ? m : MARKET_UPLIFT["Other"];
}

// All-in AUD price per bottle for this buyer's destination, rounded to whole dollars.
function priceFor(brief, wine) {
  return Math.round(wine.price * (1 + upliftFor(brief)));
}

// Opaque id so the browser can group wines from one vineyard without ever
// learning the vineyard's name.
function vineyardKeyFor(wine) {
  return crypto.createHash("sha256").update("sp-vineyard:" + wine.vineyard).digest("hex").slice(0, 10);
}

// How many wines each vineyard lists, so a result can say "N other wines from
// this vineyard" without naming the vineyard.
const VINEYARD_WINE_COUNT = {};
WINES.forEach((w) => {
  const k = vineyardKeyFor(w);
  VINEYARD_WINE_COUNT[k] = (VINEYARD_WINE_COUNT[k] || 0) + 1;
});

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function tokenize(str) {
  return (str || "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------- scoring (server-side port of the original client-side logic,
// extended with region/variety/state awareness) ----------
function scoreWine(brief, wine) {
  let points = 0;
  let maxPoints = 0;
  const notes = [];

  // Style — critical
  maxPoints += 5;
  if (!brief.styles || brief.styles.length === 0) points += 5 * 0.7;
  else if (brief.styles.includes(wine.style)) points += 5;
  else points += 5 * 0.1;

  // Varietal — moderate, only scored when the buyer picked one
  if (brief.varieties && brief.varieties.length > 0) {
    maxPoints += 3;
    if (wine.variety && brief.varieties.includes(wine.variety)) {
      points += 3;
      notes.push(wine.variety + " match");
    } else {
      points += 3 * 0.15;
    }
  }

  // State — light signal (region match below is more specific)
  if (brief.states && brief.states.length > 0) {
    maxPoints += 1;
    if (brief.states.includes(wine.state)) points += 1;
    else points += 1 * 0.2;
  }

  // Region — moderate
  maxPoints += 2;
  if (!brief.regions || brief.regions.length === 0) points += 2 * 0.7;
  else if (brief.regions.includes(wine.region)) {
    points += 2;
    notes.push("Region match");
  } else points += 2 * 0.3;

  // Body — moderate
  maxPoints += 3;
  if (!brief.bodies || brief.bodies.length === 0) points += 3 * 0.7;
  else if (brief.bodies.includes(wine.body)) points += 3;
  else points += 3 * 0.4;

  // Flavour overlap
  maxPoints += 3;
  if (!brief.flavour || brief.flavour.length === 0) points += 3 * 0.7;
  else {
    const wf = tokenize(wine.flavour);
    const overlap = brief.flavour.filter((f) =>
      wf.some((x) => x.indexOf(f) > -1 || f.indexOf(x) > -1)
    ).length;
    points += 3 * clamp01(overlap / brief.flavour.length);
    if (overlap > 0) notes.push(overlap + " flavour note" + (overlap > 1 ? "s" : "") + " matched");
  }

  // Price fit — critical
  maxPoints += 4;
  if (brief.priceMin == null && brief.priceMax == null) {
    points += 4 * 0.7;
  } else {
    const lo = brief.priceMin ?? 0;
    const hi = brief.priceMax ?? Infinity;
    const price = priceFor(brief, wine);
    if (price >= lo && price <= hi) {
      points += 4;
      notes.push("Within price band");
    } else {
      const dist = price < lo ? lo - price : price - hi;
      const ref = hi === Infinity ? lo || 1 : hi;
      points += 4 * clamp01(1 - dist / (ref * 0.6 || 1));
    }
  }

  // Volume — critical, hard fail if the buyer's volume can't cover one vineyard minimum
  maxPoints += 5;
  let hardFail = false;
  if (brief.volume == null) {
    points += 5 * 0.7;
  } else if (brief.volume >= VINEYARD_MIN) {
    points += 5;
  } else {
    hardFail = true;
  }

  // Exclusivity
  maxPoints += 3;
  if (brief.novelty !== "market") points += 3 * 0.7;
  else if (wine.neverExported) {
    points += 3;
    notes.push("Never exported — genuine exclusive");
  } else points += 3 * 0.2;

  let score = Math.round((points / maxPoints) * 100);
  if (hardFail) score = Math.min(score, 38);
  return { wine, score, notes, hardFail };
}

// ---------- region/state counts, filtered by style+variety so far ----------
function computeRegionCounts(body) {
  const styles = body.styles || [];
  const varieties = body.varieties || [];

  const filtered = WINES.filter((w) => {
    if (styles.length > 0 && !styles.includes(w.style)) return false;
    if (varieties.length > 0 && !(w.variety && varieties.includes(w.variety))) return false;
    return true;
  });

  const regionsByState = {};
  const wineCountByRegion = {};
  filtered.forEach((w) => {
    if (!regionsByState[w.state]) regionsByState[w.state] = new Set();
    regionsByState[w.state].add(w.region);
    wineCountByRegion[w.region] = (wineCountByRegion[w.region] || 0) + 1;
  });

  const states = Object.keys(regionsByState).map((state) => ({
    state,
    regionCount: regionsByState[state].size,
    regions: Array.from(regionsByState[state]).sort().map((region) => ({
      region,
      wineCount: wineCountByRegion[region],
    })),
  }));

  return { states, totalWinesMatching: filtered.length };
}

// ---------- grouping for the buyer-facing "search" action ----------
// A style (e.g. "Red") is only ever shown as its own group when the buyer
// picked that style but named no varietal belonging to it — "Red" is a
// parent category, not a wine type in its own right, so once the buyer
// gets specific (Shiraz, Grenache, Pinot Noir...) we group and show only
// those varietals, and the parent style group disappears entirely. Which
// varietals "belong" to a style is read from the dataset itself (which
// varieties actually appear on wines of that style), not a hardcoded map,
// so it can't drift from the real data.
const TOP_N_PER_GROUP = 3;

function varietiesForStyle(style) {
  const set = new Set();
  WINES.forEach((w) => { if (w.style === style && w.variety) set.add(w.variety); });
  return set;
}

function buildGroupedResults(brief) {
  const scored = WINES.map((w) => scoreWine(brief, w)).filter((r) => !r.hardFail);
  const styles = brief.styles || [];
  const pickedVarieties = brief.varieties || [];

  // No style selected: one flat top-3, no grouping to speak of.
  if (styles.length === 0) {
    scored.sort((a, b) => b.score - a.score);
    return [{ label: "Top matches", results: trimResults(scored.slice(0, TOP_N_PER_GROUP), brief) }];
  }

  // For each selected style, work out whether the buyer named any varietal
  // that actually belongs to it. If so, that style is "specific" — only
  // its matching varietal groups are shown, never the bare style group.
  const specificStyles = new Set();
  styles.forEach((style) => {
    const available = varietiesForStyle(style);
    if (pickedVarieties.some((v) => available.has(v))) specificStyles.add(style);
  });

  const groups = {}; // key -> { label, results: [] }
  scored.forEach((r) => {
    const style = r.wine.style;
    if (!styles.includes(style)) return;
    if (specificStyles.has(style)) {
      // Specific style: only wines matching one of the picked varietals
      // for this style make it into a group — no bare "Red" bucket.
      if (!r.wine.variety || !pickedVarieties.includes(r.wine.variety)) return;
      const key = r.wine.variety;
      if (!groups[key]) groups[key] = { label: key, results: [] };
      groups[key].results.push(r);
    } else {
      // Buyer picked this style with no (matching) varietal — show the
      // style itself as one group.
      if (!groups[style]) groups[style] = { label: style, results: [] };
      groups[style].results.push(r);
    }
  });

  // Stable order: styles in the order the buyer picked them, then their
  // varietal groups alphabetically (or the bare style group, never both).
  const ordered = [];
  styles.forEach((style) => {
    if (specificStyles.has(style)) {
      Object.keys(groups)
        .filter((k) => groups[k].results[0] && groups[k].results[0].wine.style === style)
        .sort()
        .forEach((k) => ordered.push(k));
    } else if (groups[style]) {
      ordered.push(style);
    }
  });

  return ordered
    .filter((k) => groups[k] && groups[k].results.length)
    .map((k) => {
      const g = groups[k];
      g.results.sort((a, b) => b.score - a.score);
      return { label: g.label, results: trimResults(g.results.slice(0, TOP_N_PER_GROUP), brief) };
    });
}

function trimResults(scoredList, brief) {
  // Never send the raw dataset — only the scored, ranked results, and only
  // the fields the buyer-facing UI actually needs.
  return scoredList.map((r) => ({
    id: r.wine.id,
    name: r.wine.name,
    vineyard: r.wine.vineyardScale,
    region: r.wine.region,
    state: r.wine.state,
    style: r.wine.style,
    variety: r.wine.variety,
    body: r.wine.body,
    price: priceFor(brief, r.wine),
    vineyardKey: vineyardKeyFor(r.wine),
    vineyardMin: VINEYARD_MIN,
    moreFromVineyard: Math.max(0, (VINEYARD_WINE_COUNT[vineyardKeyFor(r.wine)] || 1) - 1),
    neverExported: r.wine.neverExported,
    score: r.score,
    notes: r.notes,
    hardFail: r.hardFail,
  }));
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
  }
  body = body || {};

  try {
    if (body.action === "regionCounts") {
      const result = computeRegionCounts(body);
      res.status(200).json(result);
      return;
    }

    if (body.action === "search") {
      const brief = body.brief || {};
      const groups = buildGroupedResults(brief);
      const count = groups.reduce((n, g) => n + g.results.length, 0);
      res.status(200).json({ groups, count });
      return;
    }

    // Every wine from one vineyard (identified by the opaque key from a prior
    // result), so a buyer can fill that vineyard's 12-bottle minimum with other
    // styles and varieties. Scored against the brief for ordering only; never
    // filtered, since the point is to explore the rest of the vineyard's range.
    if (body.action === "vineyardWines") {
      const brief = body.brief || {};
      const key = String(body.vineyardKey || "");
      const mine = WINES.filter((w) => vineyardKeyFor(w) === key);
      if (!mine.length) {
        res.status(404).json({ error: "Unknown vineyard" });
        return;
      }
      const scored = mine.map((w) => scoreWine(brief, w));
      scored.sort((a, b) => b.score - a.score);
      res.status(200).json({ results: trimResults(scored, brief) });
      return;
    }

    // Operator-only: full scored list across the whole dataset, including
    // hard-failed wines, so Conor can see what's scoring well/badly rather
    // than only the trimmed buyer-facing shortlist. Not called by the
    // public match tool.
    if (body.action === "debug") {
      const brief = body.brief || {};
      const scored = WINES.map((w) => scoreWine(brief, w));
      scored.sort((a, b) => b.score - a.score);
      const results = scored.map((r) => ({
        id: r.wine.id,
        name: r.wine.name,
        vineyard: r.wine.vineyardScale,
        region: r.wine.region,
        state: r.wine.state,
        style: r.wine.style,
        variety: r.wine.variety,
        body: r.wine.body,
        price: priceFor(brief, r.wine),
        basePrice: r.wine.price,
        vineyardKey: vineyardKeyFor(r.wine),
        stock: r.wine.stock,
        neverExported: r.wine.neverExported,
        score: r.score,
        notes: r.notes,
        hardFail: r.hardFail,
      }));
      res.status(200).json({ results, count: results.length });
      return;
    }

    res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
