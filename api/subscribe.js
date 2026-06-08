// Newsletter signup endpoint for nullmade.com.
// Receives POST { email }, sends a "new subscriber" notification to the brand
// inbox so the hub's AutoCourier picks it up, and a confirmation back to the
// subscriber so they know the signup worked.
//
// Env vars required in Vercel:
//   GMAIL_ADDRESS       — e.g. nullmade.shop@gmail.com
//   GMAIL_APP_PASSWORD  — the 16-char app password (NOT the account password)
//   GMAIL_DISPLAY_NAME  — optional, defaults to "NullMade"

import nodemailer from "nodemailer";

const BRAND     = process.env.GMAIL_DISPLAY_NAME || "NullMade";
const FROM_ADDR = process.env.GMAIL_ADDRESS      || "nullmade.shop@gmail.com";
const APP_PASS  = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");

// Simple in-memory dedupe per cold-start, so a hammer doesn't spam Gmail.
// (Real dedupe would live in KV — fine for now since signups are low-volume.)
const recentlySeen = new Map();
const DEDUPE_WINDOW_MS = 60 * 1000;

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || "");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!APP_PASS) {
    return res.status(500).json({ error: "Server email not configured" });
  }

  const email = (req.body?.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Invalid email" });
  }
  if (email.length > 200) {
    return res.status(400).json({ error: "Email too long" });
  }

  // Dedupe: ignore repeat submissions of the same address within 60s
  const now = Date.now();
  for (const [k, t] of recentlySeen) {
    if (now - t > DEDUPE_WINDOW_MS) recentlySeen.delete(k);
  }
  if (recentlySeen.has(email)) {
    return res.status(200).json({ ok: true, dedup: true });
  }
  recentlySeen.set(email, now);

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: FROM_ADDR, pass: APP_PASS },
  });

  // 1) Notify YOU — drops a brand-tagged message into the inbox so AutoCourier
  //    triages it and Captain reviews. Subject is parseable for future filters.
  const notification = {
    from:    `${BRAND} Site <${FROM_ADDR}>`,
    to:      FROM_ADDR,
    subject: `[Subscriber] ${email} joined the drop list`,
    text:    [
      `New newsletter signup from nullmade.com`,
      ``,
      `Email:     ${email}`,
      `Timestamp: ${new Date().toISOString()}`,
      `IP:        ${req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "?"}`,
      `UA:        ${(req.headers["user-agent"] || "?").slice(0, 200)}`,
      ``,
      `— posted by /api/subscribe`,
    ].join("\n"),
  };

  // 2) Confirm to the subscriber — keep it short, NullMade voice
  const confirmation = {
    from:    `${BRAND} <${FROM_ADDR}>`,
    to:      email,
    subject: "you're on the list",
    text:    [
      `You're on the NullMade drop list.`,
      ``,
      `When something new drops, you'll be the first to know. One email per drop.`,
      `No filler. No mainstream.`,
      ``,
      `If this wasn't you, ignore this email — you won't hear from us again.`,
      ``,
      `— NullMade`,
      `https://nullmade.com`,
    ].join("\n"),
  };

  try {
    // Fire both in parallel; subscriber gets priority but we don't fail the
    // request if the notification leg hiccups.
    const [confirmRes, notifyRes] = await Promise.allSettled([
      transporter.sendMail(confirmation),
      transporter.sendMail(notification),
    ]);

    if (confirmRes.status === "rejected") {
      console.error("Confirmation send failed:", confirmRes.reason?.message);
      return res.status(500).json({ error: "Email send failed" });
    }
    if (notifyRes.status === "rejected") {
      console.warn("Notification leg failed (subscriber still confirmed):", notifyRes.reason?.message);
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Subscribe handler error:", e?.message);
    return res.status(500).json({ error: "Internal error" });
  }
}
