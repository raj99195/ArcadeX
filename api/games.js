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

// NOTE: was used (FV.increment) further down but never defined — that made
// the "play" and "like" actions throw ReferenceError in production.
const FV = admin.firestore.FieldValue;




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

  // ── GET creator-games (all statuses — pending/approved/rejected) ──
  if (req.method === "GET" && action === "creator-games") {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    try {
      // BUG FIX: Firestore mein kuch games lowercase address se save hain,
      // kuch checksum (mixed-case) se — server.js ki tarah dono query karo.
      // Sirf ek where() se sirf 2/9 games milti thi production pe.
      const lowerAddress = user.address.toLowerCase();
      const snapLower = await db.collection("games").where("creator", "==", lowerAddress).get();
      const snapExact = await db.collection("games").where("creator", "==", user.address).get();
      // Deduplicate by Firestore doc ID
      const allDocs = [...snapLower.docs, ...snapExact.docs];
      const uniqueDocs = Array.from(new Map(allDocs.map(d => [d.id, d])).values());
      const games = uniqueDocs
        .map(d => ({ id: d.data().gameId || d.id, ...d.data() }))
        .sort((a, b) => (b.gameId || 0) - (a.gameId || 0));
      return res.status(200).json({ games });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── GET scores (public) ──
  if (req.method === "GET" && action === "scores") {
    try {
      const { chain } = req.query;
      // Sort in JS instead of combining where()+orderBy() in the same query —
      // that combo needs a Firestore composite index, this doesn't.
      const ref = chain ? db.collection("scores").where("chain", "==", chain) : db.collection("scores");
      const snap = await ref.get();
      const scores = snap.docs
        .map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.() || null }))
        .sort((a, b) => (b.score || 0) - (a.score || 0));
      return res.status(200).json({ scores });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST record-time (no auth — off-chain analytics, matches what
  //     GamePlay.jsx actually sends: no Authorization header) ──
  if (req.method === "POST" && action === "record-time") {
    const { gameId, player, seconds, timestamp, chainId } = req.body;
    if (!gameId || !player || seconds == null) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!rateLimit(`record-time:${player}`, 60)) {
      return res.status(429).json({ error: "Too many requests" });
    }
    try {
      await db.collection("gameTimes").add({
        gameId, player, seconds,
        chainId: chainId ?? null,
        timestamp: timestamp ?? Date.now(),
        recordedAt: new Date(),
      });
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST record-event (no auth — off-chain analytics) ──
  if (req.method === "POST" && action === "record-event") {
    const { gameId, player, eventType, value, timestamp, chainId } = req.body;
    if (!gameId || !player || !eventType) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!rateLimit(`record-event:${player}`, 60)) {
      return res.status(429).json({ error: "Too many requests" });
    }
    try {
      await db.collection("gameEvents").add({
        gameId, player, eventType,
        value: value ?? null,
        chainId: chainId ?? null,
        timestamp: timestamp ?? Date.now(),
        recordedAt: new Date(),
      });
      return res.status(200).json({ success: true });
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
    const { txHash, score, gameId, gameName, chain } = req.body;
    if (!txHash || !score) return res.status(400).json({ error: "Missing fields" });
    try {
      await db.collection("scores").doc(txHash).set({
        player: user.address, score: parseInt(score),
        gameId: parseInt(gameId), gameName: gameName || "Unknown",
        chain: chain || "botchain",
        txHash, createdAt: new Date(),
      });
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST save-game (creator) ──
  if (req.method === "POST" && action === "save-game") {
    const { gameId, name, description, iframeUrl, thumbnailUrl, category, rewardRate, rewardRateNative, txHash } = req.body;
    try {
      const gameRef = db.collection("games").doc(String(gameId));
      const existing = await gameRef.get();
      if (existing.exists) {
        // Already exists — update (contract re-registered same ID)
        await gameRef.update({
          name, description, iframeUrl,
          thumbnailUrl: thumbnailUrl || existing.data().thumbnailUrl || "",
          category, rewardRate: parseInt(rewardRate) || 50,
          rewardRateNative: rewardRateNative != null ? parseInt(rewardRateNative) : (existing.data().rewardRateNative ?? 1),
          txHash, status: "pending", updatedAt: new Date(),
        });
      } else {
        await gameRef.set({
          gameId, name, description, iframeUrl,
          thumbnailUrl: thumbnailUrl || "",
          category, rewardRate: parseInt(rewardRate) || 50,
          rewardRateNative: rewardRateNative != null ? parseInt(rewardRateNative) : 1,
          creator: user.address, txHash,
          status: "pending", plays: 0, earned: 0,
          createdAt: new Date(),
        });
      }
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST update-game (creator) ──
  if (req.method === "POST" && action === "update-game") {
    const { gameId, rewardRate, rewardRateNative, helpContent } = req.body;
    try {
      const gameRef = db.collection("games").doc(String(gameId));
      const game = await gameRef.get();
      if (!game.exists) return res.status(404).json({ error: "Game not found" });
      if (game.data().creator !== user.address) return res.status(403).json({ error: "Not your game" });
      const updates = {};
      if (rewardRate != null) updates.rewardRate = parseInt(rewardRate);
      if (rewardRateNative != null) updates.rewardRateNative = parseInt(rewardRateNative);
      if (helpContent != null) {
        updates.helpContent = {
          objective: (helpContent.objective || "").trim(),
          controls: (helpContent.controls || "").trim(),
          instructions: (helpContent.instructions || "").trim(),
          tips: (helpContent.tips || "").trim(),
          videoUrl: (helpContent.videoUrl || "").trim(),
        };
      }
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Nothing to update" });
      await gameRef.update(updates);
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  return res.status(400).json({ error: "Invalid action" });
}