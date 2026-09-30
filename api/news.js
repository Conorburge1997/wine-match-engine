// Serverless function (Vercel /api route) — fetches the Winetitles "Daily
// Wine News" RSS feed server-side (browsers can't fetch it directly, the
// feed has no CORS headers) and returns a small clean JSON list of recent
// Australian wine industry headlines for the homepage News section.
//
// Cached at the edge/CDN for 30 minutes (see Cache-Control below) so we
// don't hammer the source feed on every page load.

const FEED_URL = "https://winetitles.com.au/daily-wine-news/feed/";
const MAX_ITEMS = 8;

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
  for (const block of itemBlocks.slice(0, MAX_ITEMS)) {
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

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
  res.setHeader("Content-Type", "application/json");

  try {
    const upstream = await fetch(FEED_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SapphirePandaNewsBot/1.0)" },
    });
    if (!upstream.ok) throw new Error("Upstream feed returned " + upstream.status);
    const xml = await upstream.text();
    const items = parseRss(xml);
    if (!items.length) throw new Error("No items parsed from feed");
    res.status(200).json({ source: "Winetitles — Daily Wine News", items });
  } catch (err) {
    res.status(200).json({ source: null, items: [], error: String(err && err.message || err) });
  }
};
