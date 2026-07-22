// api/admin/games.js
//
// Admin-only endpoint — fetch all games (any status) + approve/reject actions.
// server.js mein tha as app.get/post("/api/admin/games") — Vercel pe
// yeh file missing thi, isliye Admin Dashboard pe 0 games dikh rahe the.

import jwt from "jsonwebtoken";
import admin from "firebase-admin";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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

const ADMIN_ADDR = process.env.VITE_ADMIN_ADDRESS?.toLowerCase();

function verifyAdminToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
    if (decoded.address?.toLowerCase() !== ADMIN_ADDR) return null;
    return decoded;
  } catch { return null; }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const user = verifyAdminToken(req);
  if (!user) return res.status(403).json({ error: "Admin only" });

  const db = getDb();

  // ── GET /api/admin/games?status=pending|approved|rejected ──
  // status param optional — without it returns ALL games
  if (req.method === "GET") {
    const { status } = req.query;
    try {
      // orderBy("createdAt") needs a Firestore index if combined with where() —
      // sort in JS instead to avoid index requirement (same pattern as server.js)
      const snap = status
        ? await db.collection("games").where("status", "==", status).get()
        : await db.collection("games").get();

      const games = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
          const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
          return bTime - aTime; // newest first
        });

      return res.status(200).json({ games });
    } catch (err) {
      console.error("admin/games GET error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST /api/admin/games?action=approve|reject ──
  if (req.method === "POST") {
    const { action } = req.query;
    const { gameId } = req.body;
    if (!gameId) return res.status(400).json({ error: "gameId required" });

    try {
      if (action === "approve") {
        await db.collection("games").doc(String(gameId)).update({
          status: "approved",
          approvedAt: new Date(),
        });
      } else if (action === "reject") {
        await db.collection("games").doc(String(gameId)).update({
          status: "rejected",
          rejectedAt: new Date(),
        });
      } else {
        return res.status(400).json({ error: "action must be approve or reject" });
      }
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("admin/games POST error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}