// Serverless function (Vercel /api route) — fetches the Winetitles "Daily
// Wine News" RSS feed server-side (browsers can't fetch it directly, the
// feed has no CORS headers) and returns a small clean JSON list of recent
// Australian wine industry headlines for the homepage News section.
//
// Cached at the edge/CDN for 30 minutes (see Cache-Control below) so we
// don't hammer the source feed on every page load.

const FEED_URL = "https://winetitles.com.au/daily-wine-news/feed/";
const FETCH_POOL_SIZE = 60; // pull a bigger pool from the feed, then filter down
const MAX_ITEMS = 16;

// Winetitles' "Daily Wine News" covers the whole primary-industries beat
// (grants, appointments, forestry, general agriculture), not just wine a
// consumer or sommelier would care about. We keep only the wine-interest
// items — vintages, wine shows/medals/ratings, regions, consumer trends,
// weather/harvest impacts, supply — and drop generic corporate/appointment/
// policy/grant news even when a winery happens to be mentioned in passing.
const INCLUDE_KEYWORDS = [
  "vintage", "harvest", "wine show", "medal", "trophy", "rating", "score",
  "halliday", "sommelier", "cellar door", "tasting", "drink", "pairing",
  "shiraz", "cabernet", "pinot", "chardonnay", "riesling", "grenache",
  "sauvignon", "semillon", "merlot", "sparkling", "rose", "rosé", "fortified",
  "region", "valley", "barossa", "hunter valley", "margaret river", "yarra",
  "mclaren vale", "adelaide hills", "tasmania", "coonawarra", "clare valley",
  "orange", "canberra district", "great southern",
  "export", "consumer", "trend", "drought", "bushfire", "frost", "heatwave",
  "climate", "yield", "grape price", "grape prices", "supply", "shortage",
  "oversupply", "glut", "organic", "biodynamic", "natural wine", "low intervention",
  "vineyard", "winemaker", "winemaking", "blend", "oak", "terroir", "drinking",
];
const EXCLUDE_KEYWORDS = [
  "appoints", "appointment", "cfo", "ceo appointed", "chief executive",
  "board", "director", "resigns", "retires", "promotion",
  "grant fund", "grant scheme", "funding round", "research fund",
  "innovation fund", "primary industries fund", "forestry",
  "symposium", "conference agenda", "awards finalists announced",
  "communicator award", "membership", "scholarship",
];

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
    .trim();
}

function stripTags(str) {
  return str.replace(/<[^>]*>/g, "");
}

function extractTag(itemXml, tag) {
  // Handles both <tag>text</tag> and <tag><![CDATA[text]]></tag>
  const cdataMatch = itemXml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i"));
  if (cdataMatch) return cdataMatch[1].trim();
  const plainMatch = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return plainMatch ? plainMatch[1].trim() : "";
}

function parseRss(xml) {
  const items = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of itemBlocks.slice(0, FETCH_POOL_SIZE)) {
    const title = decodeEntities(stripTags(extractTag(block, "title")));
    const link = decodeEntities(stripTags(extractTag(block, "link")));
    const pubDate = extractTag(block, "pubDate");
    let description = decodeEntities(stripTags(extractTag(block, "description")));
    if (description.length > 160) description = description.slice(0, 157).trim() + "…";
    if (title && link) {
      items.push({ title, link, pubDate, description });
    }
  }
  return items;
}

function isWineInterest(item) {
  const text = (item.title + " " + item.description).toLowerCase();
  if (EXCLUDE_KEYWORDS.some((kw) => text.includes(kw))) return false;
  return INCLUDE_KEYWORDS.some((kw) => text.includes(kw));
}

function filterForWineInterest(items) {
  return items.filter(isWineInterest).slice(0, MAX_ITEMS);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
  res.setHeader("Content-Type", "application/json");

  try {
    const upstream = await fetch(FEED_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SapphirePandaNewsBot/1.0)" },
    });
    if (!upstream.ok) throw new Error("Upstream feed returned " + upstream.status);
    const xml = await upstream.text();
    const allItems = parseRss(xml);
    if (!allItems.length) throw new Error("No items parsed from feed");
    const items = filterForWineInterest(allItems);
    res.status(200).json({ source: "Winetitles — Daily Wine News", items });
  } catch (err) {
    res.status(200).json({ source: null, items: [], error: String(err && err.message || err) });
  }
};
