// Serverless function (Vercel /api route): receives a message from /contact and
// emails it to the team via Resend. Uses the same env vars as api/vineyard.js:
//   RESEND_API_KEY (required), NOTIFY_EMAIL (optional), MAIL_FROM (optional).
// Without RESEND_API_KEY it answers 503 and the page offers a mailto fallback.

const FIELDS = { name: 100, email: 160, phone: 40, topic: 40, subject: 150, message: 3000 };

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
  if (!d.name || !d.subject || !d.message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) {
    res.status(400).json({ error: "Missing or invalid fields" }); return;
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) { res.status(503).json({ error: "Email delivery not configured", fallback: true }); return; }

  const rows = [["Name", d.name], ["Email", d.email], ["Phone", d.phone], ["Type", d.topic]].filter((r) => r[1]);
  const html = "<h2>" + esc(d.subject) + "</h2><table cellpadding=\"6\" style=\"border-collapse:collapse\">" +
    rows.map((r) => "<tr><td style=\"color:#666\"><b>" + esc(r[0]) + "</b></td><td>" + esc(r[1]) + "</td></tr>").join("") +
    "</table><p style=\"white-space:pre-wrap\">" + esc(d.message) + "</p>";
  const text = rows.map((r) => r[0] + ": " + r[1]).join("\n") + "\n\n" + d.message;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || "Sapphire Panda <onboarding@resend.dev>",
        to: [process.env.NOTIFY_EMAIL || "hello@sapphirepanda.com"],
        reply_to: d.email,
        subject: "Website contact: " + d.subject,
        html, text,
      }),
    });
    if (!r.ok) { res.status(502).json({ error: "Email provider error" }); return; }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: "Email provider unreachable" });
  }
};
