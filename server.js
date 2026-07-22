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
// ── Chain registry (Node-safe mirror of src/config/chains.js) ───────────
const deployedAddresses = JSON.parse(
  readFileSync(join(__dirname, "src", "config", "deployedAddresses.json"), "utf8")
);
const CHAIN_LIST = [
  {
    key: "botchain",
    chainId: 677,
    name: "BOTChain",
    rpcUrl: "https://rpc.botchain.ai",
    contracts: deployedAddresses.botchain,
    rewardToken: "ARCADE",
    rewardType: "erc20",
    status: "live",
  },
  {
    key: "mst",
    chainId: 4646,
    name: "MST Blockchain",
    rpcUrl: "https://mariorpc.mstblockchain.com",
    contracts: deployedAddresses.mst,
    rewardToken: "MSTC",
    rewardType: "native",
    status: "live",
  },
  {
    key: "somnia",
    chainId: 50312,
    name: "Somnia",
    rpcUrl: "https://50312.rpc.thirdweb.com",
    contracts: deployedAddresses.somnia,
    rewardToken: "ARCADE",
    rewardType: "erc20",
    status: "coming_soon",
  },
];
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
// ── Multi-chain game sync ────────────────────────────────────────────────
const PLATFORM_ABI = [
  "function games(uint256) external view returns (uint256 gameId, string name, address creator, string iframeUrl, uint256 rewardRate, uint256 totalPlays, bool isActive)",
  "function approveGame(uint256 gameId) external",
  "function adminRegisterAndApprove(uint256 specificGameId, address creator, string name, string iframeUrl, uint256 rewardRate) external",
];
function resolveAdminKey(chainKey) {
  const override = process.env[`${chainKey.toUpperCase()}_ADMIN_PRIVATE_KEY`];
  return override || process.env.PRIVATE_KEY || null;
}
async function approveOnChain(chain, gameData) {
  const privateKey = resolveAdminKey(chain.key);
  if (!privateKey) {
    return { chain: chain.name, key: chain.key, status: "skipped", reason: "No admin key configured" };
  }
  if (!chain.contracts?.platform) {
    return { chain: chain.name, key: chain.key, status: "skipped", reason: "Platform contract not deployed" };
  }
  try {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const platform = new ethers.Contract(chain.contracts.platform, PLATFORM_ABI, wallet);
    const existing = await platform.games(gameData.gameId);
    const alreadyRegistered = existing.gameId.toString() !== "0";
    let tx;
    if (alreadyRegistered) {
      if (existing.isActive) {
        return { chain: chain.name, key: chain.key, status: "already_live", txHash: null };
      }
      tx = await platform.approveGame(gameData.gameId, { gasLimit: 500000 });
    } else {
      tx = await platform.adminRegisterAndApprove(
        gameData.gameId,
        gameData.creator,
        gameData.name,
        gameData.iframeUrl || "",
        gameData.rewardRate || 50,
        { gasLimit: 3000000 }
      );
    }
    await tx.wait();
    return { chain: chain.name, key: chain.key, status: "live", txHash: tx.hash, mode: alreadyRegistered ? "approved" : "registered_and_approved" };
  } catch (err) {
    return { chain: chain.name, key: chain.key, status: "failed", reason: err.shortMessage || err.reason || err.message };
  }
}
// ── Multi-chain creator NFT sync ──────────────────────────────────────────
const CREATOR_NFT_ABI = [
  "function walletToToken(address) external view returns (uint256)",
  "function adminMintFor(address creator, string username, string avatarColor) external",
];
async function syncCreatorOnChain(chain, creator, username, avatarColor) {
  const privateKey = resolveAdminKey(chain.key);
  if (!privateKey) {
    return { chain: chain.name, key: chain.key, status: "skipped", reason: "No admin key configured" };
  }
  if (!chain.contracts?.creatorNft) {
    return { chain: chain.name, key: chain.key, status: "skipped", reason: "CreatorNFT not deployed" };
  }
  try {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const creatorNft = new ethers.Contract(chain.contracts.creatorNft, CREATOR_NFT_ABI, wallet);
    const existingTokenId = await creatorNft.walletToToken(creator);
    if (existingTokenId.toString() !== "0") {
      return { chain: chain.name, key: chain.key, status: "already_minted", txHash: null };
    }
    const tx = await creatorNft.adminMintFor(creator, username, avatarColor, { gasLimit: 5000000 });
    await tx.wait();
    return { chain: chain.name, key: chain.key, status: "minted", txHash: tx.hash };
  } catch (err) {
    return { chain: chain.name, key: chain.key, status: "failed", reason: err.shortMessage || err.reason || err.message };
  }
}
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
    // Creator ke saare games — pending/approved/rejected sab
    // ── GET creator-games (all statuses — pending/approved/rejected) ──
    if (action === "creator-games") {
      const walletAddress = req.query.address || verifyToken(req)?.address;
      
      if (!walletAddress) return res.status(401).json({ error: "Unauthorized or missing address param" });
      
      try {
        // Lowercase format
        const lowerAddress = walletAddress.toLowerCase();
        
        // Ethers.js ka use karke automatically Mixed-Case (Checksum) format generate karo
        let checksumAddress = lowerAddress;
        try {
          checksumAddress = ethers.getAddress(lowerAddress); 
        } catch (e) { /* ignore if invalid hex */ }

        // Firebase mein DONO formats ek sath dhoondho
        const snapLower = await db.collection("games").where("creator", "==", lowerAddress).get();
        const snapExact = await db.collection("games").where("creator", "==", checksumAddress).get();
        
        const allDocs = [...snapLower.docs, ...snapExact.docs];
        // Duplicates remove karne ke liye
        const uniqueDocs = Array.from(new Map(allDocs.map(d => [d.id, d])).values());

        const games = uniqueDocs
          .map(d => ({ id: d.data().gameId || d.id, ...d.data() }))
          .sort((a, b) => (b.gameId || 0) - (a.gameId || 0));
          
        return res.json({ games });
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
        const { chain } = req.query;
        // Sort in JS instead of combining where()+orderBy() in the same query —
        // that combo needs a Firestore composite index, this doesn't.
        let ref = chain ? db.collection("scores").where("chain", "==", chain) : db.collection("scores");
        const snap = await ref.get();
        const scores = snap.docs
          .map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.() || null }))
          .sort((a, b) => (b.score || 0) - (a.score || 0));
        return res.json({ scores });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }
    res.status(400).json({ error: "Invalid action" });
  });
  app.post("/api/games", async (req, res) => {
    const { action } = req.query;
    const db = getDb();

    // record-time / record-event: off-chain analytics only (playtime, custom
    // events). GamePlay.jsx calls these without an Authorization header, so
    // they're handled here BEFORE the mandatory auth check below — no wallet
    // signature required, just basic shape validation + rate limiting.
    if (action === "record-time") {
      const { gameId, player, seconds, timestamp, chainId } = req.body;
      if (!gameId || !player || seconds == null) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      if (!rateLimit(`record-time:${player}`, 60)) return res.status(429).json({ error: "Too many requests" });
      try {
        await db.collection("gameTimes").add({
          gameId, player, seconds,
          chainId: chainId ?? null,
          timestamp: timestamp ?? Date.now(),
          recordedAt: new Date(),
        });
        return res.json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (action === "record-event") {
      const { gameId, player, eventType, value, timestamp, chainId } = req.body;
      if (!gameId || !player || !eventType) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      if (!rateLimit(`record-event:${player}`, 60)) return res.status(429).json({ error: "Too many requests" });
      try {
        await db.collection("gameEvents").add({
          gameId, player, eventType,
          value: value ?? null,
          chainId: chainId ?? null,
          timestamp: timestamp ?? Date.now(),
          recordedAt: new Date(),
        });
        return res.json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

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
    // ── Score proof signing — required by Platform.sol's recordPlayAndEarn()
    // when a chain has scoreSigner set. This is what stands between "score
    // submitted by an actual game session" and "anyone calling the contract
    // directly with a made-up number". Signature format must exactly match
    // Platform.sol's: keccak256(player, gameId, score, nonce, platform, chainId)
    // with the standard Ethereum Signed Message prefix.
    if (action === "sign-score") {
      const { gameId, score, chain } = req.body;
      if (gameId == null || score == null || !chain) return res.status(400).json({ error: "gameId, score and chain required" });
      if (!rateLimit(`sign-score:${user.address}`, 60)) return res.status(429).json({ error: "Too many requests" });

      const chainInfo = CHAIN_LIST.find(c => c.key === chain);
      const platformAddress = chainInfo?.contracts?.platform;
      if (!platformAddress) return res.status(400).json({ error: `No platform contract configured for chain "${chain}"` });
      if (!process.env.SCORE_SIGNER_PRIVATE_KEY) return res.status(500).json({ error: "Score signer not configured" });

      // TODO: this is where real anti-cheat checks belong — session
      // duration, per-game max-plausible-score, server-tracked game state,
      // etc. Right now this only confirms the request came from an
      // authenticated wallet and rate-limits it; it does not independently
      // verify the score is legitimate.
      try {
        const nonce = BigInt("0x" + require("crypto").randomBytes(32).toString("hex")).toString();
        const messageHash = ethers.solidityPackedKeccak256(
          ["address", "uint256", "uint256", "uint256", "address", "uint256"],
          [user.address, gameId, score, nonce, platformAddress, chainInfo.chainId]
        );
        const signerWallet = new ethers.Wallet(process.env.SCORE_SIGNER_PRIVATE_KEY);
        const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));
        return res.json({ nonce, signature });
      } catch (err) {
        console.error("sign-score error:", err);
        return res.status(500).json({ error: err.message });
      }
    }
    if (action === "score") {
      const { txHash, score, gameId, gameName, chain } = req.body;
      if (!txHash || !score) return res.status(400).json({ error: "Missing fields" });
      try {
        await db.collection("scores").doc(txHash).set({
          player: user.address, score: parseInt(score),
          gameId: parseInt(gameId), gameName: gameName || "Unknown",
          chain: chain || "botchain",
          txHash, createdAt: new Date(),
        });
        return res.json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }
    if (action === "save-game") {
      const { gameId, name, description, iframeUrl, thumbnailUrl, category, rewardRate, rewardRateNative, txHash } = req.body;
      try {
        const ref = db.collection("games").doc(String(gameId));
        const existing = await ref.get();
        if (existing.exists) {
          // Already exists — update with new txHash (contract re-registered)
          await ref.update({ 
            name, description, iframeUrl, 
            thumbnailUrl: thumbnailUrl || existing.data().thumbnailUrl || "",
            category, rewardRate: parseInt(rewardRate) || 50,
            rewardRateNative: rewardRateNative != null ? parseInt(rewardRateNative) : (existing.data().rewardRateNative ?? 1),
            txHash, status: "pending", updatedAt: new Date(),
          });
        } else {
          await ref.set({
            gameId, name, description, iframeUrl, thumbnailUrl: thumbnailUrl || "",
            category, rewardRate: parseInt(rewardRate) || 50,
            rewardRateNative: rewardRateNative != null ? parseInt(rewardRateNative) : 1,
            creator: user.address, txHash, status: "pending",
            plays: 0, earned: 0, createdAt: new Date(),
          });
        }
        return res.json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }
    if (action === "update-game") {
      const { gameId, rewardRate, rewardRateNative, helpContent } = req.body;
      try {
        const ref = db.collection("games").doc(String(gameId));
        const game = await ref.get();
        if (!game.exists) return res.status(404).json({ error: "Not found" });
        if (game.data().creator !== user.address) return res.status(403).json({ error: "Not your game" });
        const updates = {};
        if (rewardRate != null) updates.rewardRate = parseInt(rewardRate);
        if (rewardRateNative != null) updates.rewardRateNative = parseInt(rewardRateNative);
        if (helpContent != null) {
          // Trim + only keep known fields — avoid storing arbitrary junk keys
          updates.helpContent = {
            objective: (helpContent.objective || "").trim(),
            controls: (helpContent.controls || "").trim(),
            instructions: (helpContent.instructions || "").trim(),
            tips: (helpContent.tips || "").trim(),
            videoUrl: (helpContent.videoUrl || "").trim(),
          };
        }
        if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Nothing to update" });
        await ref.update(updates);
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
  // ══════════════════════════════════════
  // MULTI-CHAIN SYNC
  // ══════════════════════════════════════
  app.post("/api/admin/deploy-multichain", async (req, res) => {
    const user = verifyToken(req);
    if (!user || user.address !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
    const { gameId } = req.body;
    if (!gameId) return res.status(400).json({ error: "gameId required" });
    try {
      const db = getDb();
      const gameDoc = await db.collection("games").doc(String(gameId)).get();
      if (!gameDoc.exists) return res.status(404).json({ error: "Game not found in database" });
      const data = gameDoc.data();
      const gameData = {
        gameId: data.gameId,
        name: data.name,
        creator: data.creator,
        iframeUrl: data.iframeUrl || "",
        rewardRate: data.rewardRate || 50,
      };
      const liveChains = CHAIN_LIST.filter(c => c.status === "live");
      if (liveChains.length === 0) {
        return res.status(500).json({ error: "No live chains configured in registry" });
      }
      const results = await Promise.all(liveChains.map(chain => approveOnChain(chain, gameData)));
      const anySucceeded = results.some(r => r.status === "live" || r.status === "already_live");
      if (anySucceeded) {
        await gameDoc.ref.update({ status: "approved", approvedAt: new Date() });
      }
      return res.json({ success: anySucceeded, gameId, results });
    } catch (err) {
      console.error("deploy-multichain error:", err);
      return res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/admin/sync-creator-nft", async (req, res) => {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: "Unauthorized — connect wallet" });
    const { username, avatarColor, originChainKey, targetAddress } = req.body;
    if (!username || !avatarColor) {
      return res.status(400).json({ error: "username and avatarColor required" });
    }
    let creator = user.address;
    if (targetAddress) {
      if (user.address?.toLowerCase() !== ADMIN_ADDR) {
        return res.status(403).json({ error: "Only admin can sync on behalf of another address" });
      }
      creator = targetAddress;
    }
    try {
      const liveChains = CHAIN_LIST.filter(c => c.status === "live" && c.key !== originChainKey);
      if (liveChains.length === 0) {
        return res.json({ success: true, results: [], message: "No other live chains to sync to" });
      }
      const results = await Promise.all(
        liveChains.map(chain => syncCreatorOnChain(chain, creator, username, avatarColor))
      );
      return res.json({ success: true, results });
    } catch (err) {
      console.error("sync-creator-nft error:", err);
      return res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/admin/creators", async (req, res) => {
    const user = verifyToken(req);
    if (!user || user.address !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
    const db = getDb();
    try {
      const snap = await db.collection("creators").orderBy("registeredAt", "desc").get();
      const creators = snap.docs.map(d => ({
        address: d.id,
        ...d.data(),
        registeredAt: d.data().registeredAt?.toDate?.() || null,
        joinedAt: d.data().joinedAt?.toDate?.() || null,
      }));
      res.json({ creators });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/admin/sync-marketplace", async (req, res) => {
    const user = verifyToken(req);
    if (!user || user.address !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
    const E18 = (n) => ethers.parseEther(n);
    const SKIN = 3;
    const AVATAR_STYLES = [
      { name: "Style: Adventurer",  desc: "Unlock Adventurer avatar style — gamer cartoon look",    price: E18("100"), supply: 0 },
      { name: "Style: Lorelei",     desc: "Unlock Lorelei avatar style — anime-inspired character",  price: E18("100"), supply: 0 },
      { name: "Style: Notionists",  desc: "Unlock Notionists avatar style — minimal line art",       price: E18("300"), supply: 0 },
      { name: "Style: Micah",       desc: "Unlock Micah avatar style — modern illustration",         price: E18("300"), supply: 0 },
      { name: "Style: Rings",       desc: "Unlock Rings avatar style — abstract geometric design",   price: E18("500"), supply: 0 },
      { name: "Style: Shapes",      desc: "Unlock Shapes avatar style — bold abstract art",          price: E18("500"), supply: 0 },
      { name: "Style: Thumbs",      desc: "Unlock Thumbs avatar style — ultra rare character",       price: E18("800"), supply: 0 },
      { name: "Style: Croodles",    desc: "Unlock Croodles avatar style — hand-drawn exclusive",     price: E18("800"), supply: 0 },
    ];
    const MARKETPLACE_ABI = [
      "function addItem(string name, string description, string imageURI, uint8 itemType, uint256 arcadePrice, uint256 botPrice, uint256 totalSupply) external",
      "function nextItemId() external view returns (uint256)",
    ];
    const syncChain = async (chain) => {
      const privateKey = resolveAdminKey(chain.key);
      if (!privateKey) return { chain: chain.name, key: chain.key, status: "skipped", reason: "No admin key", added: 0 };
      if (!chain.contracts?.marketplace) return { chain: chain.name, key: chain.key, status: "skipped", reason: "Marketplace not deployed", added: 0 };
      try {
        const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
        const wallet = new ethers.Wallet(privateKey, provider);
        const marketplace = new ethers.Contract(chain.contracts.marketplace, MARKETPLACE_ABI, wallet);
        const nextId = await marketplace.nextItemId();
        const existingCount = Number(nextId) - 1;
        const toAdd = AVATAR_STYLES.slice(existingCount);
        if (toAdd.length === 0) return { chain: chain.name, key: chain.key, status: "already_synced", added: 0, total: existingCount };
        const txHashes = [];
        for (const style of toAdd) {
          const tx = await marketplace.addItem(style.name, style.desc, "", SKIN, style.price, 0, style.supply, { gasLimit: 500000 });
          await tx.wait();
          txHashes.push(tx.hash);
        }
        return { chain: chain.name, key: chain.key, status: "synced", added: toAdd.length, total: existingCount + toAdd.length, txHashes };
      } catch (err) {
        return { chain: chain.name, key: chain.key, status: "failed", reason: err.shortMessage || err.reason || err.message, added: 0 };
      }
    };
    try {
      const liveChains = CHAIN_LIST.filter(c => c.status === "live");
      const results = await Promise.all(liveChains.map(syncChain));
      return res.json({ success: true, results });
    } catch (err) {
      console.error("sync-marketplace error:", err);
      return res.status(500).json({ error: err.message });
    }
  });
  // ══════════════════════════════════════
  // BADGES (Campaign)
  // ══════════════════════════════════════
  async function checkBadgeEligibility(db, wallet) {
    const CAMPAIGN_START = new Date(process.env.CAMPAIGN_START_DATE || "2026-06-29");
    const CAMPAIGN_END = new Date(process.env.CAMPAIGN_END_DATE || "2026-07-31");
    const gamesSnap = await db.collection("games").get();
    let distinctGames = 0;
    for (const gDoc of gamesSnap.docs) {
      const pDoc = await gDoc.ref.collection("players").doc(wallet).get();
      if (pDoc.exists) distinctGames++;
      if (distinctGames >= 5) break;
    }
    const genesis = distinctGames >= 5;
    let pioneer = false;
    let legend = false;
    const snap = await db.collection("badgeLeaderboard").doc("snapshot").get();
    if (snap.exists) {
      const rankings = snap.data().rankings || [];
      const entry = rankings.find(r => r.wallet === wallet);
      if (entry) {
        if (entry.rank <= 500) pioneer = true;
        if (entry.rank <= 50) legend = true;
      }
    }
    const creatorSnap = await db.collection("games").where("creator", "==", wallet).get();
    const creator = creatorSnap.docs.some(d => {
      const cAt = d.data().createdAt?.toDate?.();
      return cAt && cAt >= CAMPAIGN_START && cAt <= CAMPAIGN_END;
    });
    const creatorPlays = {};
    gamesSnap.docs.forEach(d => {
      const data = d.data();
      const cAt = data.createdAt?.toDate?.();
      if (!cAt || cAt < CAMPAIGN_START || cAt > CAMPAIGN_END) return;
      if (!data.creator) return;
      creatorPlays[data.creator] = (creatorPlays[data.creator] || 0) + (data.plays || 0);
    });
    const ranked = Object.entries(creatorPlays).sort((a, b) => b[1] - a[1]).slice(0, 10).map(x => x[0]);
    const builder = ranked.includes(wallet);
    return { genesis, pioneer, legend, creator, builder };
  }
  app.get("/api/badges/status", async (req, res) => {
    const { wallet } = req.query;
    if (!wallet) return res.status(400).json({ error: "wallet required" });
    try {
      const eligibility = await checkBadgeEligibility(getDb(), wallet.toLowerCase());
      res.json({ eligibility });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/badges/sign-claim", async (req, res) => {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const { badgeTypeId, chainId, contractAddress } = req.body;
    if (!badgeTypeId || !chainId || !contractAddress) {
      return res.status(400).json({ error: "Missing required fields for multi-chain signing" });
    }
    const BADGE_TYPE_KEYS = { 1: "genesis", 2: "pioneer", 3: "legend", 4: "creator", 5: "builder" };
    const badgeKey = BADGE_TYPE_KEYS[badgeTypeId];
    if (!badgeKey) return res.status(400).json({ error: "Invalid badgeTypeId" });
    try {
      const w = user.address.toLowerCase();
      const eligibility = await checkBadgeEligibility(getDb(), w);
      if (!eligibility[badgeKey]) {
        return res.status(403).json({ error: `Not eligible for ${badgeKey} badge yet` });
      }
      const messageHash = ethers.solidityPackedKeccak256(
        ["address", "uint256", "address", "uint256"],
        [w, badgeTypeId, contractAddress, Number(chainId)]
      );
      const signerWallet = new ethers.Wallet(process.env.BADGE_SIGNER_PRIVATE_KEY);
      const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));
      res.json({ signature });
    } catch (err) {
      console.error("sign-claim error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  // ══════════════════════════════════════
  // CAMPAIGN (ArcadeX × BOT Chain)
  // ══════════════════════════════════════
  // Firestore layout: campaignParticipants/{wallet} = {
  //   tasks: { [taskId]: "pending" | "completed" },
  //   txHash, verificationStatus, rewardStatus,
  //   points, gamesPlayed, twitter, telegram, discord, gamePlayed,
  //   updatedAt
  // }
  const CAMPAIGN_TASK_IDS = [
    "connect_wallet", "follow_arcadex_x", "follow_botchain_x",
    "join_arcadex_tg", "join_botchain_tg", "join_discord",
    "play_games", "submit_tx",
  ];
  const CAMPAIGN_TASK_LABELS = {
    connect_wallet: "Connect Wallet",
    follow_arcadex_x: "Follow ArcadeX on X",
    follow_botchain_x: "Follow BOT Chain on X",
    join_arcadex_tg: "Join ArcadeX Telegram",
    join_botchain_tg: "Join BOT Chain Telegram",
    join_discord: "Join Discord",
    play_games: "Play Games",
    submit_tx: "Submit Transaction Hash",
  };

  function defaultCampaignDoc() {
    const tasks = {};
    CAMPAIGN_TASK_IDS.forEach((id) => { tasks[id] = "pending"; });
    return {
      tasks, txHash: null, verificationStatus: "pending", rewardStatus: "pending",
      points: 0, gamesPlayed: 0, twitter: null, telegram: null, discord: null,
      gamePlayed: null,
    };
  }

  async function getOrCreateParticipant(db, wallet) {
    const ref = db.collection("campaignParticipants").doc(wallet);
    const snap = await ref.get();
    if (!snap.exists) {
      const fresh = defaultCampaignDoc();
      await ref.set({ ...fresh, updatedAt: new Date() });
      return { ref, data: fresh };
    }
    return { ref, data: snap.data() };
  }

  function computeProgress(data) {
    const completed = Object.values(data.tasks || {}).filter((s) => s === "completed").length;
    return {
      completedTasks: completed,
      totalTasks: CAMPAIGN_TASK_IDS.length,
      progressPct: Math.round((completed / CAMPAIGN_TASK_IDS.length) * 100),
    };
  }

  // GET /api/campaign?action=stats — landing page top-line numbers
  // GET /api/campaign?action=tasks&wallet=0x...
  // GET /api/campaign?action=dashboard&wallet=0x...
  // GET /api/campaign?action=leaderboard
  // GET /api/campaign?action=admin  (admin only)
  app.get("/api/campaign", async (req, res) => {
    const { action, wallet } = req.query;
    const db = getDb();
    try {
      if (action === "stats") {
        const snap = await db.collection("campaignParticipants").get();
        const docs = snap.docs.map((d) => d.data());
        return res.json({
          name: "ArcadeX × BOT Chain Campaign",
          participants: docs.length,
          gamesPlayed: docs.reduce((sum, d) => sum + (d.gamesPlayed || 0), 0),
          verifiedUsers: docs.filter((d) => d.verificationStatus === "verified").length,
          rewardsDistributed: `${docs.filter((d) => d.rewardStatus === "claimed").length * 20} BOT`,
          active: true,
        });
      }

      if (action === "tasks") {
        if (!wallet) return res.status(400).json({ error: "wallet query param required" });
        const w = wallet.toLowerCase();
        const { data } = await getOrCreateParticipant(db, w);
        // connect_wallet is implicitly complete the moment we're being asked about a wallet
        const tasks = CAMPAIGN_TASK_IDS.map((id) => ({
          id, label: CAMPAIGN_TASK_LABELS[id],
          status: id === "connect_wallet" ? "completed" : (data.tasks?.[id] || "pending"),
        }));
        return res.json({ walletAddress: w, tasks });
      }

      if (action === "dashboard") {
        if (!wallet) return res.status(400).json({ error: "wallet query param required" });
        const w = wallet.toLowerCase();
        const { data } = await getOrCreateParticipant(db, w);
        const progress = computeProgress(data);
        return res.json({
          walletAddress: w,
          ...progress,
          gamesPlayed: data.gamesPlayed || 0,
          txHash: data.txHash,
          verificationStatus: data.verificationStatus,
          rewardStatus: data.rewardStatus,
        });
      }

      if (action === "leaderboard") {
        const snap = await db.collection("campaignParticipants")
          .orderBy("points", "desc").limit(50).get();
        const entries = snap.docs.map((d, i) => ({
          rank: i + 1,
          wallet: d.id,
          points: d.data().points || 0,
          gamesPlayed: d.data().gamesPlayed || 0,
          status: d.data().verificationStatus || "pending",
        }));
        return res.json({ entries });
      }

      if (action === "admin") {
        const user = verifyToken(req);
        if (!user || user.address !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
        const snap = await db.collection("campaignParticipants").get();
        const users = snap.docs.map((d) => ({ wallet: d.id, ...d.data() }));
        const stats = {
          totalUsers: users.length,
          completed: users.filter((u) => u.verificationStatus === "verified").length,
          pending: users.filter((u) => u.verificationStatus === "pending").length,
          rejected: users.filter((u) => u.verificationStatus === "rejected").length,
          rewardsBOT: users.filter((u) => u.rewardStatus === "eligible" || u.rewardStatus === "claimed").length * 20,
        };
        return res.json({ stats, users });
      }

      return res.status(400).json({ error: "Invalid action" });
    } catch (err) {
      console.error("campaign GET error:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/campaign?action=verify-social   { wallet, taskId }
  // POST /api/campaign?action=submit-transaction { wallet, txHash }
  // POST /api/campaign?action=verify-transaction { wallet, txHash }
  // POST /api/campaign?action=approve  { wallet }   (admin only)
  // POST /api/campaign?action=reject   { wallet, reason } (admin only)
  app.post("/api/campaign", async (req, res) => {
    const { action } = req.query;
    const db = getDb();

    if (action === "verify-social") {
      const { wallet, taskId, username, field } = req.body;
      if (!wallet || !taskId) return res.status(400).json({ error: "wallet and taskId required" });
      if (!CAMPAIGN_TASK_IDS.includes(taskId)) return res.status(400).json({ error: "Unknown taskId" });
      if (!username?.trim()) return res.status(400).json({ error: "username required" });
      const ALLOWED_FIELDS = ["twitter", "telegram", "discord"];
      if (field && !ALLOWED_FIELDS.includes(field)) return res.status(400).json({ error: "Invalid field" });
      if (!rateLimit(`verify-social:${wallet}`, 30)) return res.status(429).json({ error: "Too many requests" });
      try {
        const w = wallet.toLowerCase();
        const { ref, data } = await getOrCreateParticipant(db, w);
        // NOTE: this records the submitted username against the wallet for an
        // admin to check by hand (X/Telegram/Discord follow-status isn't
        // verified automatically here) — see the Admin dashboard's
        // Approve/Reject actions for the manual review step.
        const tasks = { ...data.tasks, [taskId]: "completed" };
        const update = { tasks, updatedAt: new Date() };
        if (field) update[field] = username.trim();
        await ref.set(update, { merge: true });
        return res.json({ taskId, walletAddress: w, verified: true, status: "completed" });
      } catch (err) {
        console.error("verify-social error:", err);
        return res.status(500).json({ error: err.message });
      }
    }

    if (action === "submit-transaction") {
      const { wallet, txHash } = req.body;
      if (!wallet || !txHash) return res.status(400).json({ error: "wallet and txHash required" });
      try {
        const w = wallet.toLowerCase();
        const { ref } = await getOrCreateParticipant(db, w);
        await ref.set({ txHash, updatedAt: new Date() }, { merge: true });
        return res.json({ walletAddress: w, txHash, received: true, status: "submitted" });
      } catch (err) {
        console.error("submit-transaction error:", err);
        return res.status(500).json({ error: err.message });
      }
    }

    if (action === "verify-transaction") {
      const { wallet, txHash } = req.body;
      if (!wallet || !txHash) return res.status(400).json({ error: "wallet and txHash required" });

      const checks = { hashFormat: false, wallet: false, network: false, contract: false, function: false };

      if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        return res.json({ verified: false, reason: "Hash format invalid — expected a 66-character 0x-prefixed transaction hash.", checks });
      }
      checks.hashFormat = true;

      // Campaign requires activity specifically on BOTChain — that's the whole
      // point of the ArcadeX × BOT Chain partnership, so we don't accept a tx
      // from MST or Somnia here even though ArcadeX supports those too.
      const botchain = CHAIN_LIST.find((c) => c.key === "botchain");
      if (!botchain) {
        return res.status(500).json({ error: "BOTChain not configured in CHAIN_LIST" });
      }

      let tx = null;
      let receipt = null;
      try {
        // Passing chainId explicitly + staticNetwork:true skips ethers' automatic
        // eth_chainId "detect network" call on startup — that extra round-trip
        // was what timed out. A longer request timeout also gives the public
        // BOTChain RPC more room to respond under load.
        const fetchReq = new ethers.FetchRequest(botchain.rpcUrl);
        fetchReq.timeout = 15000;
        const provider = new ethers.JsonRpcProvider(fetchReq, botchain.chainId, { staticNetwork: true });
        tx = await provider.getTransaction(txHash);
        if (tx) receipt = await provider.getTransactionReceipt(txHash);
      } catch (err) {
        console.warn("verify-transaction: RPC lookup failed:", err.message);
      }

      if (!tx) {
        return res.json({ verified: false, reason: "Transaction not found on BOTChain. Make sure you submitted the hash from a BOTChain transaction.", checks });
      }
      checks.network = true;

      if (tx.from?.toLowerCase() !== wallet.toLowerCase()) {
        return res.json({ verified: false, reason: "Transaction sender does not match the connected wallet.", checks });
      }
      checks.wallet = true;

      // Must be sent to BOTChain's Platform contract specifically — that's
      // where recordPlayAndEarn (the submit-score call) lives.
      const platformAddress = botchain.contracts?.platform?.toLowerCase();
      if (!platformAddress || tx.to?.toLowerCase() !== platformAddress) {
        return res.json({ verified: false, reason: "Transaction is not addressed to the ArcadeX Platform contract on BOTChain.", checks });
      }
      checks.contract = true;

      // Must specifically be a recordPlayAndEarn(uint256,uint256) call — the
      // function GamePlay.jsx calls when a player finishes a game and submits
      // their score. Any other function (e.g. a skin purchase) does not count
      // as proof of "Play Games", so we check the 4-byte selector directly.
      const RECORD_PLAY_AND_EARN_SELECTOR = ethers.id("recordPlayAndEarn(uint256,uint256)").slice(0, 10);
      const succeeded = !receipt || receipt.status === 1;
      const calledCorrectFunction = tx.data?.slice(0, 10)?.toLowerCase() === RECORD_PLAY_AND_EARN_SELECTOR.toLowerCase();

      if (!calledCorrectFunction || !succeeded) {
        return res.json({ verified: false, reason: "Transaction did not successfully call recordPlayAndEarn (submit game score) on BOTChain.", checks });
      }
      checks.function = true;

      try {
        const w = wallet.toLowerCase();
        const { ref, data } = await getOrCreateParticipant(db, w);
        const tasks = { ...data.tasks, submit_tx: "completed", play_games: "completed" };
        await ref.set({ tasks, txHash, verificationStatus: "verified", updatedAt: new Date() }, { merge: true });
      } catch (err) {
        console.warn("verify-transaction: failed to persist result:", err.message);
      }

      return res.json({ verified: true, checks });
    }

    if (action === "approve" || action === "reject") {
      const user = verifyToken(req);
      if (!user || user.address !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
      const { wallet, reason } = req.body;
      if (!wallet) return res.status(400).json({ error: "wallet required" });
      try {
        const w = wallet.toLowerCase();
        const ref = db.collection("campaignParticipants").doc(w);
        if (action === "approve") {
          await ref.set({ verificationStatus: "verified", rewardStatus: "eligible", updatedAt: new Date() }, { merge: true });
          return res.json({ wallet: w, verificationStatus: "verified", rewardStatus: "eligible" });
        } else {
          await ref.set({ verificationStatus: "rejected", updatedAt: new Date() }, { merge: true });
          return res.json({ wallet: w, verificationStatus: "rejected", rewardStatus: "pending", reason: reason || "Did not meet criteria" });
        }
      } catch (err) {
        console.error(`${action} error:`, err);
        return res.status(500).json({ error: err.message });
      }
    }

    return res.status(400).json({ error: "Invalid action" });
  });
  // ══════════════════════════════════════
  // AI Game Generator
  // ══════════════════════════════════════
  app.post("/api/ai/generate-game", async (req, res) => {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const { description, genre, complexity } = req.body;
    if (!description?.trim()) return res.status(400).json({ error: "description required" });
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) return res.status(500).json({ error: "GROQ_API_KEY not set in .env" });
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const limitRef = db.collection("aiGenerations").doc(`${user.address}_${today}`);
    try {
      const snap = await limitRef.get();
      const count = snap.exists ? (snap.data().count || 0) : 0;
      if (count >= 5) return res.status(429).json({ error: "Daily limit reached (5/day). Try again tomorrow." });
      await limitRef.set({ count: count + 1, address: user.address, date: today }, { merge: true });
    } catch (e) { console.warn("Rate limit check failed:", e.message); }
    const SYSTEM_PROMPT = `You are an expert HTML5 game developer. Generate a COMPLETE, PLAYABLE single-file HTML5 game.
Return ONLY raw HTML starting with <!DOCTYPE html>. No markdown, no code fences.
Include: <script src="https://cdn.jsdelivr.net/gh/ArcadeX-project/public/arcade-sdk.js"></script> in head.
Call ArcadeSDK.init("GAME_001") on load. Call ArcadeSDK.updateScore(n) on score change. Call ArcadeSDK.gameOver(finalScore) on game end.
Canvas: 480x420px. Dark theme. Touch + keyboard controls. 60fps. Start screen + game over screen with restart. No external libraries.`;
    const complexityNote = { simple: "Simple and reliable.", medium: "Medium complexity.", complex: "Complex mechanics." }[complexity || "medium"];
    try {
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${groqKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `Create a ${genre || "arcade"} game: ${description.trim()}\n${complexityNote}\nTouch controls. Dark gaming theme.` },
          ],
          max_tokens: 8000,
          temperature: 0.7,
        }),
      });
      if (!groqRes.ok) {
        const err = await groqRes.json().catch(() => ({}));
        throw new Error(err.error?.message || `Groq error ${groqRes.status}`);
      }
      const data = await groqRes.json();
      let code = data.choices?.[0]?.message?.content?.trim() || "";
      code = code.replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
      if (!code.includes("<!DOCTYPE") && !code.includes("<html")) {
        return res.status(422).json({ error: "Model returned non-HTML. Try a simpler description." });
      }
      return res.json({ success: true, code });
    } catch (err) {
      console.error("AI generate error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  });
  // ══════════════════════════════════════
  // SUPPORT TICKETS
  // ══════════════════════════════════════
  app.post("/api/support", async (req, res) => {
    const { action } = req.query;
    const db = getDb();

    // Submit ticket — public, no auth required
    if (action === "ticket") {
      const { issueType, description, email, screenshotUrl, userAgent, wallet } = req.body;
      if (!issueType || !description?.trim()) {
        return res.status(400).json({ error: "issueType and description required" });
      }
      try {
        const ref = await db.collection("supportTickets").add({
          issueType,
          description: description.trim(),
          email: email?.trim() || null,
          screenshotUrl: screenshotUrl || null,
          userAgent: userAgent || null,
          wallet: wallet ? wallet.toLowerCase() : null,
          status: "open",
          replies: [],
          createdAt: new Date(),
        });
        return res.json({ success: true, ticketId: ref.id });
      } catch (err) {
        console.error("Ticket submit error:", err);
        return res.status(500).json({ error: err.message });
      }
    }

    // List tickets — admin only
    // ── GET my-tickets — any connected wallet, sees only their own tickets ──
    if (action === "my-tickets") {
      const user = verifyToken(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      try {
        const wallet = user.address.toLowerCase();
        const snap = await db.collection("supportTickets").where("wallet", "==", wallet).get();
        // Sort in JS instead of where()+orderBy() together — avoids needing
        // a Firestore composite index for this combo.
        const tickets = snap.docs
          .map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null }))
          .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        return res.json({ tickets });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }
    if (action === "list") {
      const user = verifyToken(req);
      if (!user || user.address !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
      try {
        const snap = await db.collection("supportTickets").orderBy("createdAt", "desc").get();
        const tickets = snap.docs.map(d => ({
          id: d.id, ...d.data(),
          createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null,
        }));
        return res.json({ tickets });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    return res.status(400).json({ error: "Invalid action" });
  });

  app.patch("/api/support", async (req, res) => {
    const { action } = req.query;
    const user = verifyToken(req);
    if (!user || user.address !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
    const db = getDb();

    // Admin reply
    if (action === "reply") {
      const { ticketId, replyText } = req.body;
      if (!ticketId || !replyText?.trim()) return res.status(400).json({ error: "ticketId and replyText required" });
      try {
        const ref = db.collection("supportTickets").doc(ticketId);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: "Ticket not found" });
        const replies = snap.data().replies || [];
        await ref.update({
          replies: [...replies, { text: replyText.trim(), by: "admin", at: new Date().toISOString() }],
          status: "in-progress",
        });
        return res.json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    // Mark resolved
    if (action === "resolve") {
      const { ticketId } = req.body;
      if (!ticketId) return res.status(400).json({ error: "ticketId required" });
      try {
        await db.collection("supportTickets").doc(ticketId).update({ status: "resolved", resolvedAt: new Date() });
        return res.json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    return res.status(400).json({ error: "Invalid action" });
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