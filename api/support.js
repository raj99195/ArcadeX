// api/support.js
import admin from "firebase-admin";
import jwt from "jsonwebtoken";

// ── CORS ────────────────────────────────────────────────────────────
// FAIL-CLOSED: same reasoning as auth.js — pehle "*" fallback tha, ab env
// missing → no CORS header → browser same-origin ke alawa block karega.
function cors(res) {
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed) res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  }
  return admin.firestore();
}

// NOTE: these were completely missing before — the "list" action had NO
// auth check at all, meaning anyone could fetch every user's support tickets
// (emails, descriptions, screenshots) without even connecting a wallet.
function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try { return jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET); }
  catch { return null; }
}
const ADMIN_ADDR = process.env.VITE_ADMIN_ADDRESS?.toLowerCase();

// ── Simple in-memory rate limit (per Vercel warm instance) ──────────
// Not perfect (cold-start bypass) but blocks the trivial "flood the DB with
// tickets from one machine" case. Real global limit would need Redis/KV.
const rateLimits = new Map();
function rateLimit(key, max = 5) {
  const now = Date.now();
  const calls = (rateLimits.get(key) || []).filter(t => t > now - 60000);
  if (calls.length >= max) return false;
  rateLimits.set(key, [...calls, now]);
  return true;
}

// ── Input caps for the PUBLIC ticket endpoint ───────────────────────
// No auth required to submit → spammer/attacker can flood the DB with huge
// payloads. Cap each field so one bad actor can't blow up storage costs.
const MAX_DESC_LEN         = 2000;
const MAX_EMAIL_LEN        = 200;
const MAX_URL_LEN          = 500;
const MAX_UA_LEN           = 500;
const ALLOWED_ISSUE_TYPES  = new Set([
  "bug", "wallet", "score", "reward", "faucet", "creator", "purchase", "tournament", "other"
]);

// Basic URL check for screenshot links — reject javascript:/data: schemes
// even if some CDN accepted them. Allow http and https (some ImgBB-style
// hosts still redirect http).
function isSafeHttpUrl(u) {
  if (!u) return true;
  if (typeof u !== "string" || u.length > MAX_URL_LEN) return false;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch { return false; }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action } = req.query;
  const db = getDb();

  // ── POST /api/support?action=ticket — submit new ticket (public) ──
  if (req.method === "POST" && action === "ticket") {
    // IP-scoped rate limit — public endpoint, no auth to gate spam.
    const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
    if (!rateLimit(`ticket:${ip}`, 3)) {
      return res.status(429).json({ error: "Too many tickets — please wait a moment before submitting again." });
    }
    try {
      const { issueType, description, email, screenshotUrl, userAgent, wallet } = req.body;

      // Type + presence
      if (!issueType || typeof issueType !== "string" || !ALLOWED_ISSUE_TYPES.has(issueType))
        return res.status(400).json({ error: "Invalid issueType" });
      if (!description || typeof description !== "string" || !description.trim())
        return res.status(400).json({ error: "description required" });

      // Size caps — prevent 5MB descriptions from bloating Firestore
      const desc = description.trim();
      if (desc.length > MAX_DESC_LEN)
        return res.status(400).json({ error: `Description too long (max ${MAX_DESC_LEN} chars)` });
      if (email && (typeof email !== "string" || email.length > MAX_EMAIL_LEN))
        return res.status(400).json({ error: "Invalid email" });
      if (userAgent && (typeof userAgent !== "string" || userAgent.length > MAX_UA_LEN))
        return res.status(400).json({ error: "Invalid userAgent" });

      // Screenshot URL — reject non-http(s) schemes (javascript:, data:)
      if (!isSafeHttpUrl(screenshotUrl))
        return res.status(400).json({ error: "screenshotUrl must be a valid http(s) URL" });

      // Wallet address — if provided, must look like one; store lowercase.
      let walletClean = null;
      if (wallet) {
        if (typeof wallet !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(wallet))
          return res.status(400).json({ error: "Invalid wallet address" });
        walletClean = wallet.toLowerCase();
      }

      const ref = await db.collection("supportTickets").add({
        issueType,
        description: desc,
        email: email?.trim() || null,
        screenshotUrl: screenshotUrl || null,
        userAgent: userAgent || null,
        wallet: walletClean,
        status: "open",
        replies: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true, ticketId: ref.id });
    } catch (err) {
      console.error("Ticket submit error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET /api/support?action=my-tickets — any connected wallet, own tickets only ──
  if ((req.method === "GET" || req.method === "POST") && action === "my-tickets") {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    try {
      const wallet = user.address.toLowerCase();
      const snap = await db.collection("supportTickets").where("wallet", "==", wallet).get();
      // Sort in JS instead of where()+orderBy() together — avoids needing a
      // Firestore composite index for this combo.
      const tickets = snap.docs
        .map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate()?.toISOString() || null }))
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      return res.status(200).json({ tickets });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── GET /api/support?action=list — list all tickets (admin only) ──
  if (req.method === "GET" && action === "list") {
    const user = verifyToken(req);
    if (!user || user.address?.toLowerCase() !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
    try {
      // Cap at 500 — as ticket count grows this endpoint would otherwise
      // eventually hit Vercel's 10-sec function timeout. Admin panel can
      // paginate later if needed.
      const snap = await db.collection("supportTickets").orderBy("createdAt", "desc").limit(500).get();
      const tickets = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        createdAt: d.data().createdAt?.toDate()?.toISOString() || null,
      }));
      return res.status(200).json({ tickets });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH /api/support?action=reply — admin reply ──
  if (req.method === "PATCH" && action === "reply") {
    const user = verifyToken(req);
    if (!user || user.address?.toLowerCase() !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
    try {
      const { ticketId, replyText } = req.body;
      if (!ticketId || typeof ticketId !== "string")
        return res.status(400).json({ error: "ticketId required" });
      if (!replyText || typeof replyText !== "string" || !replyText.trim())
        return res.status(400).json({ error: "replyText required" });
      const reply = replyText.trim();
      if (reply.length > MAX_DESC_LEN)
        return res.status(400).json({ error: `Reply too long (max ${MAX_DESC_LEN} chars)` });

      const ref = db.collection("supportTickets").doc(ticketId);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Ticket not found" });
      const replies = snap.data().replies || [];
      await ref.update({
        replies: [...replies, { text: reply, by: "admin", at: new Date().toISOString() }],
        status: "in-progress",
      });
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH /api/support?action=resolve — mark resolved ──
  if (req.method === "PATCH" && action === "resolve") {
    const user = verifyToken(req);
    if (!user || user.address?.toLowerCase() !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
    try {
      const { ticketId } = req.body;
      if (!ticketId || typeof ticketId !== "string") return res.status(400).json({ error: "ticketId required" });
      await db.collection("supportTickets").doc(ticketId).update({ status: "resolved" });
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(404).json({ error: "Unknown action" });
}