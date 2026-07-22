// api/admin/games.js
//
// Admin-only endpoint — sab actions ek file mein:
//   GET  /api/admin/games              → all games (any status)
//   GET  /api/admin/games?status=X     → filtered by status
//   POST /api/admin/games?action=approve   { gameId }
//   POST /api/admin/games?action=reject    { gameId }
//   POST /api/admin/games?action=refresh-leaderboard → badgeLeaderboard snapshot rebuild
//
// server.js mein yeh app.get/post("/api/admin/games") tha — Vercel pe file missing
// thi, isliye Admin Dashboard pe 0 games dikh rahe the.

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

// Badge leaderboard snapshot rebuild — scores collection se
// ARCADE earned calculate karke top players rank karo
async function refreshBadgeLeaderboard(db) {
  const scoresSnap = await db.collection("scores").get();

  // Wallet ke hisaab se total score aggregate karo
  const walletScores = {};
  scoresSnap.docs.forEach(d => {
    const data = d.data();
    const wallet = data.player?.toLowerCase();
    if (!wallet) return;
    walletScores[wallet] = (walletScores[wallet] || 0) + (data.score || 0);
  });

  // Sort by total score descending → rank assign karo
  const rankings = Object.entries(walletScores)
    .sort((a, b) => b[1] - a[1])
    .map(([wallet, totalScore], idx) => ({
      wallet,
      totalScore,
      rank: idx + 1,
    }));

  // Firestore mein snapshot save karo
  await db.collection("badgeLeaderboard").doc("snapshot").set({
    rankings,
    updatedAt: new Date(),
    rankedCount: rankings.length,
  });

  return rankings.length;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const user = verifyAdminToken(req);
  if (!user) return res.status(403).json({ error: "Admin only" });

  const db = getDb();

  // ── GET /api/admin/games?status=pending|approved|rejected ──
  if (req.method === "GET") {
    const { status } = req.query;
    try {
      const snap = status
        ? await db.collection("games").where("status", "==", status).get()
        : await db.collection("games").get();

      const games = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
          const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
          return bTime - aTime;
        });

      return res.status(200).json({ games });
    } catch (err) {
      console.error("admin/games GET error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST actions ──
  if (req.method === "POST") {
    const { action } = req.query;

    // ── approve ──
    if (action === "approve") {
      const { gameId } = req.body;
      if (!gameId) return res.status(400).json({ error: "gameId required" });
      try {
        await db.collection("games").doc(String(gameId)).update({
          status: "approved",
          approvedAt: new Date(),
        });
        return res.status(200).json({ success: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // ── reject ──
    if (action === "reject") {
      const { gameId } = req.body;
      if (!gameId) return res.status(400).json({ error: "gameId required" });
      try {
        await db.collection("games").doc(String(gameId)).update({
          status: "rejected",
          rejectedAt: new Date(),
        });
        return res.status(200).json({ success: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // ── refresh-leaderboard (Admin.jsx "Refresh Leaderboard Cache" button) ──
    if (action === "refresh-leaderboard") {
      try {
        const rankedCount = await refreshBadgeLeaderboard(db);
        return res.status(200).json({ success: true, rankedCount });
      } catch (err) {
        console.error("refresh-leaderboard error:", err);
        return res.status(500).json({ error: err.message });
      }
    }

    return res.status(400).json({ error: "action must be: approve | reject | refresh-leaderboard" });
  }

  return res.status(405).json({ error: "Method not allowed" });
}