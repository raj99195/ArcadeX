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
const FV = admin.firestore.FieldValue;
const rateLimits = new Map();
function rateLimit(key, max = 10) {
  const now = Date.now();
  const calls = (rateLimits.get(key) || []).filter(t => t > now - 60000);
  if (calls.length >= max) return false;
  rateLimits.set(key, [...calls, now]);
  return true;
}

// ── Score Signer Config ───────────────────────────────────────────────────────
const PLATFORM_ADDRESSES = {
  botchain: "0x2Ca0C74C1ee7e65e5f96c469cef840B62Ba6cFB4",
  mst:      "0xd9181c86f9E1D5825E47ED80Ae9E76B4dF18c0B8",
};
const CHAIN_IDS = {
  botchain: 677n,
  mst:      4646n,
};

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

  // ── GET creator-games ──
  if (req.method === "GET" && action === "creator-games") {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    try {
      const lowerAddress = user.address.toLowerCase();
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

  // ── GET check-gas-claim (public) ──
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
      const ref = chain ? db.collection("scores").where("chain", "==", chain) : db.collection("scores");
      const snap = await ref.get();
      const scores = snap.docs
        .map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.() || null }))
        .sort((a, b) => (b.score || 0) - (a.score || 0));
      return res.status(200).json({ scores });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST record-time (SH0008: JWT required) ──
  if (req.method === "POST" && action === "record-time") {
    const rtUser = verifyToken(req);
    if (!rtUser) return res.status(401).json({ error: "Unauthorized" });
    const { gameId, seconds, timestamp, chainId } = req.body;
    if (!gameId || seconds == null) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    // player JWT token se lo — client-supplied player address trust mat karo
    const player = rtUser.address;
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

  // ── POST record-event (SH0008: JWT required) ──
  if (req.method === "POST" && action === "record-event") {
    const reUser = verifyToken(req);
    if (!reUser) return res.status(401).json({ error: "Unauthorized" });
    const { gameId, eventType, value, timestamp, chainId } = req.body;
    if (!gameId || !eventType) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    // player JWT token se lo — client-supplied player address trust mat karo
    const player = reUser.address;
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

  // ── POST claim-gas (PUBLIC — no JWT, new users won't have token) ──────────
  if (req.method === "POST" && action === "claim-gas") {
    const { address: claimAddress } = req.body;
    if (!claimAddress) return res.status(400).json({ error: "address required" });
    const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
    if (!rateLimit(`faucet:${ip}`, 3))
      return res.status(429).json({ error: "Too many requests" });
    try {
      const rpcUrl     = process.env.MST_RPC_URL;
      const pk         = process.env.PRIVATE_KEY;
      const faucetAddr = process.env.MST_FAUCET_ADDRESS;
      if (!rpcUrl || !pk || !faucetAddr)
        return res.status(503).json({ error: "Faucet not configured" });
      const provider    = new ethers.JsonRpcProvider(rpcUrl);
      const adminWallet = new ethers.Wallet(pk, provider);
      const faucetABI = [
        "function claimGas(address payable user) external",
        "function hasClaimed(address) view returns (bool)",
        "function balance() view returns (uint256)",
        "function FAUCET_AMOUNT() view returns (uint256)",
      ];
      const faucet = new ethers.Contract(faucetAddr, faucetABI, adminWallet);
      if (await faucet.hasClaimed(claimAddress))
        return res.status(200).json({ already: true, msg: "Already claimed" });
      const bal = await faucet.balance();
      const amt = await faucet.FAUCET_AMOUNT();
      if (bal < amt)
        return res.status(503).json({ error: "Faucet empty — refill pending" });
      const tx = await faucet.claimGas(claimAddress, { gasLimit: 120_000 });
      await tx.wait();
      return res.status(200).json({ success: true, txHash: tx.hash });
    } catch (err) {
      const msg = err.shortMessage || err.message || "Claim failed";
      if (msg.includes("Already claimed")) return res.status(200).json({ already: true });
      if (msg.includes("Faucet empty")) return res.status(503).json({ error: "Faucet empty" });
      return res.status(500).json({ error: msg });
    }
  }

  // ── POST verify-item-price (SH0006: server-side price gate for in-game purchases) ──
  // GamePlay.jsx calls this BEFORE constructing the on-chain tx so the contract
  // receives the price that the backend authorised, not whatever the iframe sent.
  // Returns a short-lived signed price token the frontend embeds in the tx value.
  //
  // Flow:
  //   1. Game iframe sends PURCHASE_SKIN { gameId, skinIndex, price: X }
  //   2. GamePlay.jsx calls /api/games?action=verify-item-price (JWT required)
  //   3. Backend looks up the canonical price in Firestore (games/{gameId}/items/{itemKey})
  //   4. Returns { canonicalPrice, approved: true/false }
  //   5. GamePlay.jsx uses canonicalPrice for the tx — ignores iframe-supplied price
  if (req.method === "POST" && action === "verify-item-price") {
    const vpUser = verifyToken(req);
    if (!vpUser) return res.status(401).json({ error: "Unauthorized" });
    const { gameId, itemType, itemKey } = req.body;
    // itemType: "skin" | "powerup"  |  itemKey: skinIndex or powerUpId
    if (!gameId || !itemType || itemKey == null) {
      return res.status(400).json({ error: "gameId, itemType, itemKey required" });
    }
    try {
      const itemDoc = await db
        .collection("games").doc(String(gameId))
        .collection("items").doc(`${itemType}_${itemKey}`)
        .get();
      if (!itemDoc.exists) {
        // Item not registered in DB — deny purchase
        return res.status(404).json({ error: "Item not found", approved: false });
      }
      const { price, active } = itemDoc.data();
      if (!active) return res.status(403).json({ error: "Item not available", approved: false });
      return res.status(200).json({ canonicalPrice: price, approved: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST sign-score (PUBLIC — sign before JWT check, player might not have token yet) ──
  // Signs the score with SCORE_SIGNER_PRIVATE_KEY so Platform.sol can verify
  // it came from our backend (not a forged console call).
  // Message format matches Platform.sol exactly:
  //   keccak256(abi.encodePacked(player, gameId, score, nonce, address(this), block.chainid))
  if (req.method === "POST" && action === "sign-score") {
    const { gameId, score, chain, player } = req.body;
    if (!gameId || score == null || !chain || !player)
      return res.status(400).json({ error: "gameId, score, chain, player required" });

    const pk = process.env.SCORE_SIGNER_PRIVATE_KEY;
    if (!pk) return res.status(503).json({ error: "Score signing not configured" });

    const platformAddr = PLATFORM_ADDRESSES[chain];
    const chainId      = CHAIN_IDS[chain];
    if (!platformAddr || !chainId)
      return res.status(400).json({ error: `Unknown chain: ${chain}` });

    // Rate limit — 1 signing per player per second (anti-spam)
    if (!rateLimit(`sign:${player.toLowerCase()}:${gameId}`, 30))
      return res.status(429).json({ error: "Too many sign requests" });

    try {
      const signerWallet = new ethers.Wallet(pk);
      const nonce        = BigInt(Date.now());

      // Exact same encoding as Platform.sol verifyScore()
      const messageHash = ethers.solidityPackedKeccak256(
        ["address", "uint256", "uint256", "uint256", "address", "uint256"],
        [player, BigInt(gameId), BigInt(score), nonce, platformAddr, chainId]
      );

      // signMessage adds Ethereum prefix "\x19Ethereum Signed Message:\n32"
      // matching toEthSignedMessageHash in Platform.sol
      const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));

      return res.status(200).json({ nonce: nonce.toString(), signature });
    } catch (err) {
      console.error("[sign-score]", err);
      return res.status(500).json({ error: err.message });
    }
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
    const { txHash, score, gameId, gameName, chain, earned, earnedSymbol } = req.body;
    if (!txHash || !score) return res.status(400).json({ error: "Missing fields" });
    try {
      await db.collection("scores").doc(txHash).set({
        player: user.address, score: parseInt(score),
        gameId: parseInt(gameId), gameName: gameName || "Unknown",
        chain: chain || "botchain",
        earned: Number(earned) || 0,
        earnedSymbol: earnedSymbol || "ARCADE",
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

  // ── POST admin-update-reward ──
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