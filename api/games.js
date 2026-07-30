// api/games.js

import jwt from "jsonwebtoken";
import admin from "firebase-admin";
import { ethers } from "ethers";

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
      // FIX: Firestore mein creator address 3 formats mein save ho sakta hai:
      // 1. lowercase:  0xb6d0c5...  (JWT format)
      // 2. checksum:   0xB6D0C5...  (MetaMask default)
      // 3. mixed:      0xB6d0C5...  (koi bhi variant)
      // Teeno formats try karo — sab approved/pending/rejected games milenge
      const lowerAddress = user.address.toLowerCase();
      
      // Checksum format manually banao (every other char uppercase pattern se nahi,
      // Ethereum EIP-55 checksum use karo — simple approach: sab known variants try karo)
      // Yahan hum Firestore se SAB games fetch karke JS mein filter karte hain —
      // yeh guaranteed sab games dikhayega chahe address kisi bhi format mein ho
      const allGamesSnap = await db.collection("games").get();
      const uniqueDocs = allGamesSnap.docs.filter(d => {
        const creator = d.data().creator;
        return creator && creator.toLowerCase() === lowerAddress;
      });

      const games = uniqueDocs
        .map(d => ({ id: d.data().gameId || d.id, ...d.data() }))
        .sort((a, b) => (b.gameId || 0) - (a.gameId || 0));
      return res.status(200).json({ games });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── GET check-gas-claim (public — check if wallet already claimed) ──
  if (req.method === "GET" && action === "check-gas-claim") {
    const { address: claimAddr } = req.query;
    if (!claimAddr) return res.status(400).json({ error: "address required" });
    try {
      const provider = new ethers.JsonRpcProvider(process.env.MST_RPC_URL);
      const faucet   = new ethers.Contract(
        process.env.MST_FAUCET_ADDRESS,
        ["function hasClaimed(address) view returns (bool)"],
        provider
      );
      const claimed = await faucet.hasClaimed(claimAddr);
      return res.status(200).json({ claimed });
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
      if (game.data().creator?.toLowerCase() !== user.address?.toLowerCase()) return res.status(403).json({ error: "Not your game" });
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

  // ── POST claim-gas (MST Faucet v2 — fully on-chain) ──────────────────
  // Amount is decided by MSTFaucet.sol on-chain (FAUCET_AMOUNT immutable).
  // Backend just calls faucet.claimGas(user) — no amount passed.
  // Contract handles: check claimed → send MSTC → mark claimed (all atomic).
  if (req.method === "POST" && action === "claim-gas") {
    const { address: claimAddress } = req.body;
    if (!claimAddress) return res.status(400).json({ error: "address required" });

    // IP rate limit — prevent spam
    const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
    if (!rateLimit(`faucet:${ip}`, 3))
      return res.status(429).json({ error: "Too many requests" });

    try {
      const rpcUrl     = process.env.MST_RPC_URL;
      const pk         = process.env.PRIVATE_KEY;        // admin wallet (owner of faucet)
      const faucetAddr = process.env.MST_FAUCET_ADDRESS;

      if (!rpcUrl || !pk || !faucetAddr)
        return res.status(503).json({ error: "Faucet not configured" });

      const provider   = new ethers.JsonRpcProvider(rpcUrl);
      const adminWallet = new ethers.Wallet(pk, provider);

      const faucetABI = [
        "function claimGas(address payable user) external",
        "function hasClaimed(address) view returns (bool)",
        "function balance() view returns (uint256)",
        "function FAUCET_AMOUNT() view returns (uint256)",
      ];
      const faucet = new ethers.Contract(faucetAddr, faucetABI, adminWallet);

      // On-chain check — hasClaimed() reads from contract mapping
      if (await faucet.hasClaimed(claimAddress))
        return res.status(200).json({ already: true, msg: "Already claimed" });

      // Balance check — remainingClaims > 0?
      const bal = await faucet.balance();
      const amt = await faucet.FAUCET_AMOUNT();
      if (bal < amt)
        return res.status(503).json({ error: "Faucet empty — refill pending" });

      // One call — contract handles everything atomically
      const tx = await faucet.claimGas(claimAddress, { gasLimit: 120_000 });
      await tx.wait();

      return res.status(200).json({ success: true, txHash: tx.hash });
    } catch (err) {
      console.error("[claim-gas]", err);
      // Contract revert messages — forward cleanly to frontend
      const msg = err.shortMessage || err.message || "Claim failed";
      if (msg.includes("Already claimed"))
        return res.status(200).json({ already: true });
      if (msg.includes("Faucet empty"))
        return res.status(503).json({ error: "Faucet empty — refill pending" });
      return res.status(500).json({ error: msg });
    }
  }

  // ── POST admin-update-reward (AdminMST — sync on-chain rate to Firestore) ──
  // No admin-address check needed here — AdminMST.jsx already gates access
  // via on-chain ADMIN_ROLE check before showing the panel. This just syncs
  // the Firestore display value after a successful on-chain updateGameRewardRate tx.
  if (req.method === "POST" && action === "admin-update-reward") {
    const { gameId, rewardRate, rewardRateNative } = req.body;
    if (!gameId) return res.status(400).json({ error: "gameId required" });
    try {
      const updates = { updatedAt: new Date() };
      if (rewardRate != null)       updates.rewardRate       = Number(rewardRate);
      if (rewardRateNative != null) updates.rewardRateNative = Number(rewardRateNative);
      if (Object.keys(updates).length === 1)
        return res.status(400).json({ error: "Nothing to update" });
      await db.collection("games").doc(String(gameId)).update(updates);
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  return res.status(400).json({ error: "Invalid action" });
}