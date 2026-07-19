// api/support.js
import admin from "firebase-admin";
import jwt from "jsonwebtoken";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
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

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action } = req.query;
  const db = getDb();

  // ── POST /api/support?action=ticket — submit new ticket (public) ──
  if (req.method === "POST" && action === "ticket") {
    try {
      const { issueType, description, email, screenshotUrl, userAgent, wallet } = req.body;
      if (!issueType || !description?.trim()) {
        return res.status(400).json({ error: "issueType and description required" });
      }
      const ref = await db.collection("supportTickets").add({
        issueType,
        description: description.trim(),
        email: email?.trim() || null,
        screenshotUrl: screenshotUrl || null,
        userAgent: userAgent || null,
        wallet: wallet ? wallet.toLowerCase() : null,
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
    if (!user || user.address !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
    try {
      const snap = await db.collection("supportTickets").orderBy("createdAt", "desc").get();
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
    if (!user || user.address !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
    try {
      const { ticketId, replyText } = req.body;
      if (!ticketId || !replyText?.trim()) {
        return res.status(400).json({ error: "ticketId and replyText required" });
      }
      const ref = db.collection("supportTickets").doc(ticketId);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Ticket not found" });
      const replies = snap.data().replies || [];
      await ref.update({
        replies: [...replies, { text: replyText.trim(), by: "admin", at: new Date().toISOString() }],
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
    if (!user || user.address !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
    try {
      const { ticketId } = req.body;
      if (!ticketId) return res.status(400).json({ error: "ticketId required" });
      await db.collection("supportTickets").doc(ticketId).update({ status: "resolved" });
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(404).json({ error: "Unknown action" });
}