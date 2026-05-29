// api/games.js

import jwt from "jsonwebtoken";
import admin from "firebase-admin";

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try { return jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET); }
  catch { return null; }
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
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




// Rate limiter
const rateLimits = new Map();
function rateLimit(key, max = 10) {
  const now = Date.now();
  const calls = (rateLimits.get(key) || []).filter(t => t > now - 60000);
  if (calls.length >= max) return false;
  rateLimits.set(key, [...calls, now]);
  return true;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action } = req.query;
  const db = getDb();

  // ── GET stats (public) ──
  if (req.method === "GET" && action === "stats") {
    const { gameId } = req.query;
    if (!gameId) return res.status(400).json({ error: "gameId required" });
    try {
      const gDoc = await db.collection("games").doc(String(gameId)).get();
      const data = gDoc.exists ? gDoc.data() : {};
      const pSnap = await db.collection("games").doc(String(gameId)).collection("players").get();
      const cSnap = await db.collection("games").doc(String(gameId)).collection("comments")
        .orderBy("createdAt", "desc").limit(50).get();
      return res.status(200).json({
        plays: data.plays || 0,
        likes: data.likes || 0,
        uniquePlayers: pSnap.size,
        comments: cSnap.docs.map(d => ({
          id: d.id, ...d.data(),
          createdAt: d.data().createdAt?.toDate?.() || null
        })),
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── GET list (public — approved games) ──
  if (req.method === "GET" && action === "list") {
    try {
      const snap = await db.collection("games").where("status", "==", "approved").get();
      const games = snap.docs.map(d => ({ id: d.data().gameId, ...d.data() }));
      return res.status(200).json({ games });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── GET scores (public) ──
  if (req.method === "GET" && action === "scores") {
    try {
      const snap = await db.collection("scores").orderBy("score", "desc").get();
      return res.status(200).json({
        scores: snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.() || null }))
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── All writes require JWT ──
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: "Unauthorized — connect wallet" });

  // ── POST play ──
  if (req.method === "POST" && action === "play") {
    const { gameId } = req.body;
    if (!rateLimit(`play:${user.address}`, 30)) {
      return res.status(429).json({ error: "Too many requests" });
    }
    try {
      await db.collection("games").doc(String(gameId)).update({ plays: FV.increment(1) });
      await db.collection("games").doc(String(gameId)).collection("players").doc(user.address).set(
        { address: user.address, lastPlayed: new Date() }, { merge: true }
      );
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST like ──
  if (req.method === "POST" && action === "like") {
    const { gameId } = req.body;
    if (!rateLimit(`like:${user.address}:${gameId}`, 2)) {
      return res.status(429).json({ error: "Already liked" });
    }
    try {
      await db.collection("games").doc(String(gameId)).update({ likes: FV.increment(1) });
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST comment ──
  if (req.method === "POST" && action === "comment") {
    const { gameId, text } = req.body;
    if (!text || text.length > 200) return res.status(400).json({ error: "Invalid comment" });
    if (!rateLimit(`comment:${user.address}`, 5)) {
      return res.status(429).json({ error: "Too many comments" });
    }
    try {
      await db.collection("games").doc(String(gameId)).collection("comments").add({
        text, player: user.address, createdAt: new Date(),
      });
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST score ──
  if (req.method === "POST" && action === "score") {
    const { txHash, score, gameId, gameName } = req.body;
    if (!txHash || !score) return res.status(400).json({ error: "Missing fields" });
    try {
      await db.collection("scores").doc(txHash).set({
        player: user.address, score: parseInt(score),
        gameId: parseInt(gameId), gameName: gameName || "Unknown",
        txHash, createdAt: new Date(),
      });
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST save-game (creator) ──
  if (req.method === "POST" && action === "save-game") {
    const { gameId, name, description, iframeUrl, thumbnailUrl, category, rewardRate, txHash } = req.body;
    try {
      const gameRef = db.collection("games").doc(String(gameId));
      const existing = await gameRef.get();
      if (existing.exists()) return res.status(400).json({ error: "Game ID already exists" });
      await gameRef.set({
        gameId, name, description, iframeUrl,
        thumbnailUrl: thumbnailUrl || "",
        category, rewardRate: parseInt(rewardRate) || 50,
        creator: user.address, txHash,
        status: "pending", plays: 0, earned: 0,
        createdAt: new Date(),
      });
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST update-game (creator) ──
  if (req.method === "POST" && action === "update-game") {
    const { gameId, rewardRate } = req.body;
    try {
      const gameRef = db.collection("games").doc(String(gameId));
      const game = await gameRef.get();
      if (!game.exists()) return res.status(404).json({ error: "Game not found" });
      if (game.data().creator !== user.address) return res.status(403).json({ error: "Not your game" });
      await gameRef.update({ rewardRate: parseInt(rewardRate) });
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  return res.status(400).json({ error: "Invalid action" });
}
