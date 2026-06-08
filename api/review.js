// Receives a review submission from /review and emails it to the brand inbox for moderation.
// Uses the Gmail app password (GMAIL_ADDRESS / GMAIL_APP_PASSWORD env vars on Vercel).
import nodemailer from "nodemailer";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (b.website) return res.status(200).json({ ok: true }); // honeypot — silently drop bots

    const rating = Math.max(0, Math.min(5, parseInt(b.rating) || 0));
    const name = String(b.name || "").trim().slice(0, 80);
    const product = String(b.product || "").trim().slice(0, 140);
    const handle = String(b.handle || "").trim().slice(0, 180);
    const body = String(b.body || "").trim().slice(0, 2000);
    const email = String(b.email || "").trim().slice(0, 160);
    if (!rating || !name || !body) return res.status(400).json({ error: "Missing rating, name, or review." });

    const user = process.env.GMAIL_ADDRESS, pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) return res.status(500).json({ error: "Email not configured." });

    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const jsonLine = JSON.stringify({ author: name, rating, verified: true, body });
    const html =
      `<h2 style="font-family:sans-serif">New review &middot; ${"★".repeat(rating)}${"☆".repeat(5 - rating)} (${rating}/5)</h2>` +
      `<p style="font-family:sans-serif"><b>Product:</b> ${esc(product)} <code>(${esc(handle)})</code><br>` +
      `<b>Name:</b> ${esc(name)}<br><b>Email:</b> ${esc(email) || "&mdash;"}</p>` +
      `<blockquote style="font-family:sans-serif;border-left:3px solid #ff6b35;padding-left:14px;color:#333">${esc(body).replace(/\n/g, "<br>")}</blockquote>` +
      `<hr><p style="font-family:monospace;font-size:12px;color:#888">To publish: add this under <b>"${esc(handle)}"</b> in reviews.json, then regen + deploy:<br><br>${esc(jsonLine)}</p>`;

    const transport = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    await transport.sendMail({
      from: `"${process.env.GMAIL_DISPLAY_NAME || "NullMade"} Reviews" <${user}>`,
      to: user,
      replyTo: email || undefined,
      subject: `★ New review (${rating}/5) — ${product || handle || "NullMade"}`,
      html,
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "Could not submit. Please try again." });
  }
}
