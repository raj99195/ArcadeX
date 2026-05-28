// server.js — Local dev server
import express from "express";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { ethers } from "ethers";
import jwt from "jsonwebtoken";
import admin from "firebase-admin";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Firebase Admin Init ──
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

const FV = () => admin.firestore.FieldValue;

// ── JWT helpers ──
function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try { return jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET); }
  catch { return null; }
}

// ── Rate limiter ──
const rateLimits = new Map();
function rateLimit(key, max = 10) {
  const now = Date.now();
  const calls = (rateLimits.get(key) || []).filter(t => t > now - 60000);
  if (calls.length >= max) return false;
  rateLimits.set(key, [...calls, now]);
  return true;
}

const ADMIN_ADDR = process.env.VITE_ADMIN_ADDRESS?.toLowerCase();
const CHANNELS = ["general", "game-talk", "flex", "announcements"];

async function startServer() {
  const app = express();
  app.use(cors({ origin: "*" }));
  app.use(express.json());

  // ══════════════════════════════════════
  // AUTH
  // ══════════════════════════════════════
  app.post("/api/auth", async (req, res) => {
    try {
      const { address, signature, message } = req.body;
      if (!address || !signature || !message)
        return res.status(400).json({ error: "Missing fields" });

      const tsMatch = message.match(/(\d+)$/);
      if (!tsMatch) return res.status(400).json({ error: "Invalid message" });
      if (Date.now() - parseInt(tsMatch[1]) > 5 * 60 * 1000)
        return res.status(400).json({ error: "Message expired" });

      const recovered = ethers.verifyMessage(message, signature);
      if (recovered.toLowerCase() !== address.toLowerCase())
        return res.status(401).json({ error: "Invalid signature" });

      const token = jwt.sign(
        { address: address.toLowerCase() },
        process.env.JWT_SECRET,
        { expiresIn: "24h" }
      );
      res.json({ token, address: address.toLowerCase() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ══════════════════════════════════════
  // GAMES
  // ══════════════════════════════════════
  app.get("/api/games", async (req, res) => {
    const { action, gameId } = req.query;
    const db = getDb();

    if (action === "list") {
      try {
        const snap = await db.collection("games").where("status", "==", "approved").get();
        return res.json({ games: snap.docs.map(d => ({ id: d.data().gameId, ...d.data() })) });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (action === "stats" && gameId) {
      try {
        const gDoc = await db.collection("games").doc(String(gameId)).get();
        const data = gDoc.exists ? gDoc.data() : {};
        const pSnap = await db.collection("games").doc(String(gameId)).collection("players").get();
        const cSnap = await db.collection("games").doc(String(gameId)).collection("comments")
          .orderBy("createdAt", "desc").limit(50).get();
        return res.json({
          plays: data.plays || 0, likes: data.likes || 0,
          uniquePlayers: pSnap.size,
          comments: cSnap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.() || null })),
        });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (action === "scores") {
      try {
        const snap = await db.collection("scores").orderBy("score", "desc").get();
        return res.json({ scores: snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.() || null })) });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    res.status(400).json({ error: "Invalid action" });
  });

  app.post("/api/games", async (req, res) => {
    const { action } = req.query;
    const db = getDb();
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    if (action === "play") {
      const { gameId } = req.body;
      if (!rateLimit(`play:${user.address}`, 30)) return res.status(429).json({ error: "Too many requests" });
      try {
        await db.collection("games").doc(String(gameId)).update({ plays: FV().increment(1) });
        await db.collection("games").doc(String(gameId)).collection("players").doc(user.address)
          .set({ address: user.address, lastPlayed: new Date() }, { merge: true });
        return res.json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (action === "like") {
      const { gameId } = req.body;
      if (!rateLimit(`like:${user.address}:${gameId}`, 2)) return res.status(429).json({ error: "Already liked" });
      try {
        await db.collection("games").doc(String(gameId)).update({ likes: FV().increment(1) });
        return res.json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (action === "comment") {
      const { gameId, text } = req.body;
      if (!text || text.length > 200) return res.status(400).json({ error: "Invalid comment" });
      if (!rateLimit(`comment:${user.address}`, 5)) return res.status(429).json({ error: "Too many comments" });
      try {
        await db.collection("games").doc(String(gameId)).collection("comments")
          .add({ text, player: user.address, createdAt: new Date() });
        return res.json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (action === "score") {
      const { txHash, score, gameId, gameName } = req.body;
      if (!txHash || !score) return res.status(400).json({ error: "Missing fields" });
      try {
        await db.collection("scores").doc(txHash).set({
          player: user.address, score: parseInt(score),
          gameId: parseInt(gameId), gameName: gameName || "Unknown",
          txHash, createdAt: new Date(),
        });
        return res.json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (action === "save-game") {
      const { gameId, name, description, iframeUrl, thumbnailUrl, category, rewardRate, txHash } = req.body;
      try {
        const ref = db.collection("games").doc(String(gameId));
        if ((await ref.get()).exists) return res.status(400).json({ error: "Game ID exists" });
        await ref.set({
          gameId, name, description, iframeUrl, thumbnailUrl: thumbnailUrl || "",
          category, rewardRate: parseInt(rewardRate) || 50,
          creator: user.address, txHash, status: "pending",
          plays: 0, earned: 0, createdAt: new Date(),
        });
        return res.json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (action === "update-game") {
      const { gameId, rewardRate } = req.body;
      try {
        const ref = db.collection("games").doc(String(gameId));
        const game = await ref.get();
        if (!game.exists) return res.status(404).json({ error: "Not found" });
        if (game.data().creator !== user.address) return res.status(403).json({ error: "Not your game" });
        await ref.update({ rewardRate: parseInt(rewardRate) });
        return res.json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    res.status(400).json({ error: "Invalid action" });
  });

  // ══════════════════════════════════════
  // COMMUNITY
  // ══════════════════════════════════════
  app.get("/api/community", async (req, res) => {
    const { channel } = req.query;
    if (!CHANNELS.includes(channel)) return res.status(400).json({ error: "Invalid channel" });
    const db = getDb();
    try {
      const snap = await db.collection("community").doc(channel)
        .collection("messages").orderBy("createdAt", "asc").limit(100).get();
      res.json({ messages: snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.() || null })) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/community", async (req, res) => {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const { channel, text, avatarStyle } = req.body;
    if (!CHANNELS.includes(channel)) return res.status(400).json({ error: "Invalid channel" });
    if (!text?.trim() || text.length > 500) return res.status(400).json({ error: "Invalid message" });
    if (channel === "announcements" && user.address !== ADMIN_ADDR)
      return res.status(403).json({ error: "Admin only" });
    if (!rateLimit(user.address, 5)) return res.status(429).json({ error: "Too many messages" });
    const db = getDb();
    try {
      const ref = await db.collection("community").doc(channel).collection("messages").add({
        text: text.trim(), address: user.address,
        avatarStyle: avatarStyle || "bottts",
        isAdmin: user.address === ADMIN_ADDR,
        createdAt: new Date(),
      });
      res.json({ success: true, id: ref.id });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/community", async (req, res) => {
    const user = verifyToken(req);
    if (!user || user.address !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
    const { channel, messageId } = req.body;
    const db = getDb();
    try {
      await db.collection("community").doc(channel).collection("messages").doc(messageId).delete();
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ══════════════════════════════════════
  // CREATORS
  // ══════════════════════════════════════
  app.get("/api/creators", async (req, res) => {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: "address required" });
    const db = getDb();
    try {
      let snap = await db.collection("creators").doc(address.toLowerCase()).get();
      if (!snap.exists) snap = await db.collection("creators").doc(address).get();
      res.json(snap.exists ? snap.data() : null);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/creators", async (req, res) => {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const { displayName, avatarStyle, txHash } = req.body;
    const db = getDb();
    try {
      const ref = db.collection("creators").doc(user.address);
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({
          address: user.address, displayName: displayName || "",
          avatarStyle: avatarStyle || "bottts", txHash: txHash || "",
          status: "pending", gamesPublished: 0, totalEarned: 0,
          registeredAt: new Date(), joinedAt: new Date(),
        });
      } else {
        await ref.update({ displayName: displayName || snap.data().displayName, updatedAt: new Date() });
      }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ══════════════════════════════════════
  // ADMIN
  // ══════════════════════════════════════
  app.get("/api/admin/games", async (req, res) => {
    const user = verifyToken(req);
    if (!user || user.address !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
    const { status } = req.query;
    const db = getDb();
    try {
      let ref = db.collection("games").orderBy("createdAt", "desc");
      if (status) ref = db.collection("games").where("status", "==", status).orderBy("createdAt", "desc");
      const snap = await ref.get();
      res.json({ games: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/games", async (req, res) => {
    const user = verifyToken(req);
    if (!user || user.address !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
    const { action } = req.query;
    const { gameId } = req.body;
    const db = getDb();
    try {
      if (action === "approve") {
        await db.collection("games").doc(String(gameId)).update({ status: "approved", approvedAt: new Date() });
      } else if (action === "reject") {
        await db.collection("games").doc(String(gameId)).update({ status: "rejected", rejectedAt: new Date() });
      }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);

  app.listen(3000, () => {
    console.log("✅ ArcadeX Dev Server running at http://localhost:3000");
    console.log("   API: http://localhost:3000/api/*");
    console.log("   Frontend: http://localhost:3000");
  });
}

startServer().catch(console.error);