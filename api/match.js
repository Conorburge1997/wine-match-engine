// Serverless function (Vercel /api route) — the private matching backend.
//
// The real vineyard/wine inventory never ships to the browser. This
// function holds it server-side (currently a 211-row DUMMY dataset — see
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
//                    returns only the top 5 per matched style/varietal
//                    group (never the full list) — e.g. if the buyer
//                    picked Red+White with Shiraz+Chardonnay varietals,
//                    the response groups results as "Shiraz" (top 5),
//                    "Chardonnay" (top 5). If no varietal is picked for a
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
    if (wine.price >= lo && wine.price <= hi) {
      points += 4;
      notes.push("Within price band");
    } else {
      const dist = wine.price < lo ? lo - wine.price : wine.price - hi;
      const ref = hi === Infinity ? lo || 1 : hi;
      points += 4 * clamp01(1 - dist / (ref * 0.6 || 1));
    }
  }

  // Volume / MOQ — critical, hard fail if below
  maxPoints += 5;
  let hardFail = false;
  if (brief.volume == null) {
    points += 5 * 0.7;
  } else if (brief.volume >= wine.moq) {
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
// Groups by varietal when the brief named one for a style (e.g. "Shiraz"),
// otherwise groups by the style itself (e.g. "Rosé", which has no single-
// varietal breakdown). Each group gets its own top-5, so a buyer asking
// for several styles/varietals sees a curated spread rather than one style
// crowding out the rest.
function groupKeyForWine(wine, brief) {
  const varieties = brief.varieties || [];
  if (varieties.length > 0 && wine.variety && varieties.includes(wine.variety)) {
    return wine.variety;
  }
  return wine.style;
}

const TOP_N_PER_GROUP = 5;

function buildGroupedResults(brief) {
  const scored = WINES.map((w) => scoreWine(brief, w)).filter((r) => !r.hardFail);
  const styles = brief.styles || [];

  // No style selected: one flat top-5, no grouping to speak of.
  if (styles.length === 0) {
    scored.sort((a, b) => b.score - a.score);
    return [{ label: "Top matches", results: trimResults(scored.slice(0, TOP_N_PER_GROUP)) }];
  }

  const groups = {}; // key -> { label, results: [] }
  scored.forEach((r) => {
    if (!styles.includes(r.wine.style)) return;
    const key = groupKeyForWine(r.wine, brief);
    if (!groups[key]) groups[key] = { label: key, results: [] };
    groups[key].results.push(r);
  });

  // Stable order: styles in the order the buyer picked them, varietal
  // groups for each style (alphabetical) before falling back to the bare
  // style group (wines of that style with no varietal match/pick).
  const ordered = [];
  styles.forEach((style) => {
    const varietalKeys = Object.keys(groups)
      .filter((k) => k !== style && groups[k].results[0] && groups[k].results[0].wine.style === style)
      .sort();
    varietalKeys.forEach((k) => ordered.push(k));
    if (groups[style]) ordered.push(style);
  });

  return ordered
    .filter((k) => groups[k] && groups[k].results.length)
    .map((k) => {
      const g = groups[k];
      g.results.sort((a, b) => b.score - a.score);
      return { label: g.label, results: trimResults(g.results.slice(0, TOP_N_PER_GROUP)) };
    });
}

function trimResults(scoredList) {
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
    price: r.wine.price,
    moq: r.wine.moq,
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
        price: r.wine.price,
        moq: r.wine.moq,
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
