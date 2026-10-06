// Serverless function (Vercel /api route): receives a vineyard "register your
// interest" submission from /vineyards and emails it to the team.
//
// Delivery uses Resend (https://resend.com). Set these in the Vercel project
// environment variables:
//   RESEND_API_KEY   (required)  API key from Resend
//   NOTIFY_EMAIL     (optional)  where submissions go (default hello@sapphirepanda.com)
//   MAIL_FROM        (optional)  verified sender, e.g. "Sapphire Panda <hello@sapphirepanda.com>"
//                                (default: Resend's onboarding sender, which only
//                                delivers to the Resend account owner's email)
// If RESEND_API_KEY isn't set the function answers 503 and the page falls back
// to a pre-filled "email us your details" link, so nothing is lost.

const FIELDS = {
  winery: 120, contact: 100, email: 160, phone: 40, state: 40, region: 100,
  scale: 40, export: 40, web: 200, notes: 1500,
};

function clean(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}
function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== "object") { res.status(400).json({ error: "Invalid body" }); return; }

  // Honeypot: bots fill the hidden field. Pretend success, send nothing.
  if (clean(body.company, 50)) { res.status(200).json({ ok: true }); return; }

  const d = {};
  Object.keys(FIELDS).forEach((k) => { d[k] = clean(body[k], FIELDS[k]); });
  if (!d.winery || !d.contact || !d.phone || !d.region || !d.state || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email) || body.consent !== true) {
    res.status(400).json({ error: "Missing or invalid fields" }); return;
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) { res.status(503).json({ error: "Email delivery not configured", fallback: true }); return; }

  const rows = [
    ["Vineyard", d.winery], ["Contact", d.contact], ["Email", d.email], ["Phone", d.phone],
    ["State", d.state], ["Region", d.region], ["Annual production", d.scale],
    ["Export experience", d.export], ["Website / Instagram", d.web], ["Notes", d.notes],
  ].filter((r) => r[1]);
  const html = "<h2>New vineyard registration</h2><table cellpadding=\"6\" style=\"border-collapse:collapse\">" +
    rows.map((r) => "<tr><td style=\"color:#666;vertical-align:top\"><b>" + esc(r[0]) + "</b></td><td>" + esc(r[1]).replace(/\n/g, "<br>") + "</td></tr>").join("") + "</table>";
  const text = rows.map((r) => r[0] + ": " + r[1]).join("\n");

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || "Sapphire Panda <onboarding@resend.dev>",
        to: [process.env.NOTIFY_EMAIL || "hello@sapphirepanda.com"],
        reply_to: d.email,
        subject: "Vineyard registration: " + d.winery,
        html, text,
      }),
    });
    if (!r.ok) { res.status(502).json({ error: "Email provider error" }); return; }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: "Email provider unreachable" });
  }
};
