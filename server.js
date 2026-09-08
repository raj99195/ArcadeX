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
import { randomBytes } from "crypto";
import dotenv from "dotenv";
dotenv.config();
const __dirname = dirname(fileURLToPath(import.meta.url));

const deployedAddresses = JSON.parse(
  readFileSync(join(__dirname, "src", "config", "deployedAddresses.json"), "utf8")
);
const CHAIN_LIST = [
  {
    key: "botchain", chainId: 677, name: "BOTChain",
    rpcUrl: "https://rpc.botchain.ai",
    contracts: deployedAddresses.botchain,
    rewardToken: "ARCADE", rewardType: "erc20", status: "live",
  },
  {
    key: "mst", chainId: 4646, name: "MST Blockchain",
    rpcUrl: "https://mariorpc.mstblockchain.com",
    contracts: deployedAddresses.mst,
    rewardToken: "MSTC", rewardType: "native", status: "live",
  },
  {
    key: "somnia", chainId: 50312, name: "Somnia",
    rpcUrl: "https://50312.rpc.thirdweb.com",
    contracts: deployedAddresses.somnia,
    rewardToken: "ARCADE", rewardType: "erc20", status: "coming_soon",
  },
];

// ── Score Signer Config & Constants (from games.js) ────────────────────────
const PLATFORM_ADDRESSES = {
  botchain: "0x2Ca0C74C1ee7e65e5f96c469cef840B62Ba6cFB4",
  mst:      "0xd9181c86f9E1D5825E47ED80Ae9E76B4dF18c0B8",
};
const TOURNAMENT_ADDRESSES = {
  botchain: "0xf1086B6e247D1322Cd9A0b3b9C02539Ae05BA8eC",
  mst:      "0x3f2AAa35E0cFa71804079317eA68fdBdcb6BD5d3",
};
const CHAIN_IDS = {
  botchain: 677n,
  mst:      4646n,
};
const RPC_URLS = {
  botchain: process.env.BOTCHAIN_RPC_URL,
  mst:      process.env.MST_RPC_URL,
};
const PLATFORM_EVENT_ABI = [
  "event PlayRecorded(address indexed player, uint256 indexed gameId, uint256 playerReward, uint256 creatorReward)",
];
const BATTLE_ARENA_ADDRESSES = {
  botchain: process.env.BATTLE_ARENA_ADDRESS_BOTCHAIN,
  mst:      process.env.BATTLE_ARENA_ADDRESS_MST,
};
const BATTLE_SHOP_ADDRESSES = {
  botchain: process.env.BATTLE_SHOP_ADDRESS_BOTCHAIN,
  mst:      process.env.BATTLE_SHOP_ADDRESS_MST,
};
const BATTLE_SHOP_TOKENS = {
  botchain: {
    ARCADE: process.env.BATTLE_SHOP_TOKEN_ARCADE_BOTCHAIN,
    USDC:   process.env.BATTLE_SHOP_TOKEN_USDC_BOTCHAIN,
  },
  mst: {
    ARCADE: process.env.BATTLE_SHOP_TOKEN_ARCADE_MST,
    USDC:   process.env.BATTLE_SHOP_TOKEN_USDC_MST,
  },
};
const BATTLE_SHOP_TOKEN_DECIMALS = {
  ARCADE: Number(process.env.BATTLE_SHOP_DECIMALS_ARCADE) || 18,
  USDC:   Number(process.env.BATTLE_SHOP_DECIMALS_USDC)   || 6,
};

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

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try { return jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET); }
  catch { return null; }
}

const rateLimits = new Map();
function rateLimit(key, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const calls = (rateLimits.get(key) || []).filter(t => t > now - windowMs);
  if (calls.length >= max) return false;
  rateLimits.set(key, [...calls, now]);
  return true;
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || null;
}

async function isWalletBanned(dbRef, address) {
  if (!address) return false;
  try {
    const snap = await dbRef.collection("bannedWallets").doc(address.toLowerCase()).get();
    return snap.exists;
  } catch { return false; }
}

const _taskonConfigCache = new Map();
const _taskonListCache   = new Map();
const _taskonUserCache   = new Map();
const TASKON_CFG_TTL     =  60 * 1000;
const TASKON_LIST_TTL    = 10 * 60 * 1000;

async function getTaskonConfig(dbRef, chain) {
  if (!chain) return null;
  const now = Date.now();
  const cached = _taskonConfigCache.get(chain);
  if (cached && now - cached.at < TASKON_CFG_TTL) return cached.cfg;

  let cfg = null;
  try {
    const snap = await dbRef.collection("taskonConfig").doc(chain).get();
    if (snap.exists) cfg = snap.data();
  } catch (e) {
    console.warn(`[taskon] config read failed for ${chain}:`, e.message);
  }
  _taskonConfigCache.set(chain, { at: now, cfg });
  return cfg;
}

function bustTaskonCache(chain) {
  if (chain) {
    _taskonConfigCache.delete(chain);
    _taskonListCache.delete(chain);
    for (const key of _taskonUserCache.keys()) {
      if (key.startsWith(`${chain}:`)) _taskonUserCache.delete(key);
    }
  } else {
    _taskonConfigCache.clear();
    _taskonListCache.clear();
    _taskonUserCache.clear();
  }
}

async function fetchTaskonParticipants(questId) {
  const clientId     = process.env.TASKON_CLIENT_ID;
  const clientSecret = process.env.TASKON_CLIENT_SECRET;
  if (!clientId || !clientSecret || !questId) return null;

  const wallets = new Set();
  let offset = 0;
  const limit = 100;
  const MAX_PAGES = 50; 

  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await fetch("https://api.taskon.xyz/v1/exportQuestData", {
      method: "POST",
      headers: {
        "Content-Type":            "application/json",
        "X-Taskon-Client-Id":      clientId,
        "X-Taskon-Client-Secret":  clientSecret,
      },
      body: JSON.stringify({ scene: "CampaignDataParticipant", ref_id: Number(questId), offset, limit }),
    });
    if (!r.ok) throw new Error(`TaskOn API ${r.status}`);
    const data = await r.json();

    const before = wallets.size;
    (function walk(v) {
      if (typeof v === "string") {
        if (/^0x[a-fA-F0-9]{40}$/.test(v)) wallets.add(v.toLowerCase());
      } else if (Array.isArray(v)) {
        v.forEach(walk);
      } else if (v && typeof v === "object") {
        Object.values(v).forEach(walk);
      }
    })(data);

    if (wallets.size - before < limit) break;
    offset += limit;
  }
  return wallets;
}

async function checkTaskonForChain(dbRef, address, chain) {
  if (!address || !chain) return { enabled: false, completed: true };
  const cfg = await getTaskonConfig(dbRef, chain);
  if (!cfg || !cfg.enabled || !cfg.questId) {
    return { enabled: false, completed: true, cfg };
  }

  const userKey = `${chain}:${address.toLowerCase()}`;
  if (_taskonUserCache.has(userKey)) {
    return { enabled: true, completed: true, cfg };
  }

  const now = Date.now();
  const chainList = _taskonListCache.get(chain) || { at: 0, wallets: new Set() };
  if (now - chainList.at > TASKON_LIST_TTL) {
    try {
      const fresh = await fetchTaskonParticipants(cfg.questId);
      if (fresh !== null) {
        _taskonListCache.set(chain, { at: now, wallets: fresh });
      }
    } catch (e) {
      console.warn(`[taskon] refresh failed for ${chain}, using stale cache:`, e.message);
    }
  }

  const list = _taskonListCache.get(chain) || chainList;
  const found = list.wallets.has(address.toLowerCase());
  if (found) {
    _taskonUserCache.set(userKey, { at: now });
    if (_taskonUserCache.size > 50_000) _taskonUserCache.clear();
  }
  return { enabled: true, completed: found, cfg };
}

const checkClaimCache = new Map();

async function checkOnChainAdmin(addr) {
  if (!addr) return false;
  const lower = addr.toLowerCase();
  const superAdmin = process.env.VITE_ADMIN_ADDRESS?.toLowerCase();
  if (superAdmin && lower === superAdmin) return true;

  const DEFAULT_ADMIN_ROLE = "0x" + "0".repeat(64);
  const abi = [
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function ADMIN_ROLE() view returns (bytes32)",
  ];
  for (const chain of Object.keys(PLATFORM_ADDRESSES)) {
    const platformAddr = PLATFORM_ADDRESSES[chain];
    const rpc = RPC_URLS[chain];
    if (!platformAddr || !rpc) continue;
    try {
      const c = new ethers.Contract(platformAddr, abi, new ethers.JsonRpcProvider(rpc));
      const adminRole = await c.ADMIN_ROLE().catch(() => null);
      const checks = await Promise.all([
        adminRole ? c.hasRole(adminRole, addr).catch(() => false) : Promise.resolve(false),
        c.hasRole(DEFAULT_ADMIN_ROLE, addr).catch(() => false),
      ]);
      if (checks.some(Boolean)) return true;
    } catch (_) { }
  }
  return false;
}

const ADMIN_ADDR = process.env.VITE_ADMIN_ADDRESS?.toLowerCase();
const CHANNELS = ["general", "game-talk", "flex", "announcements"];

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
  if (!privateKey) return { chain: chain.name, key: chain.key, status: "skipped", reason: "No admin key configured" };
  if (!chain.contracts?.platform) return { chain: chain.name, key: chain.key, status: "skipped", reason: "Platform contract not deployed" };
  try {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const platform = new ethers.Contract(chain.contracts.platform, PLATFORM_ABI, wallet);
    const existing = await platform.games(gameData.gameId);
    const alreadyRegistered = existing.gameId.toString() !== "0";
    let tx;
    if (alreadyRegistered) {
      if (existing.isActive) return { chain: chain.name, key: chain.key, status: "already_live", txHash: null };
      tx = await platform.approveGame(gameData.gameId, { gasLimit: 500000 });
    } else {
      tx = await platform.adminRegisterAndApprove(
        gameData.gameId, gameData.creator, gameData.name,
        gameData.iframeUrl || "", gameData.rewardRate || 50, { gasLimit: 3000000 }
      );
    }
    await tx.wait();
    return { chain: chain.name, key: chain.key, status: "live", txHash: tx.hash, mode: alreadyRegistered ? "approved" : "registered_and_approved" };
  } catch (err) {
    return { chain: chain.name, key: chain.key, status: "failed", reason: err.shortMessage || err.reason || err.message };
  }
}

const CREATOR_NFT_ABI = [
  "function walletToToken(address) external view returns (uint256)",
  "function adminMintFor(address creator, string username, string avatarColor) external",
];
async function syncCreatorOnChain(chain, creator, username, avatarColor) {
  const privateKey = resolveAdminKey(chain.key);
  if (!privateKey) return { chain: chain.name, key: chain.key, status: "skipped", reason: "No admin key configured" };
  if (!chain.contracts?.creatorNft) return { chain: chain.name, key: chain.key, status: "skipped", reason: "CreatorNFT not deployed" };
  try {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const creatorNft = new ethers.Contract(chain.contracts.creatorNft, CREATOR_NFT_ABI, wallet);
    const existingTokenId = await creatorNft.walletToToken(creator);
    if (existingTokenId.toString() !== "0") return { chain: chain.name, key: chain.key, status: "already_minted", txHash: null };
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
      if (!address || !signature || !message) return res.status(400).json({ error: "Missing fields" });
      const tsMatch = message.match(/(\d+)$/);
      if (!tsMatch) return res.status(400).json({ error: "Invalid message" });
      if (Date.now() - parseInt(tsMatch[1]) > 5 * 60 * 1000) return res.status(400).json({ error: "Message expired" });
      const recovered = ethers.verifyMessage(message, signature);
      if (recovered.toLowerCase() !== address.toLowerCase()) return res.status(401).json({ error: "Invalid signature" });
      const token = jwt.sign({ address: address.toLowerCase() }, process.env.JWT_SECRET, { expiresIn: "24h" });
      res.json({ token, address: address.toLowerCase() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ══════════════════════════════════════
  // GAMES (Exact unified logic from games.js)
  // ══════════════════════════════════════
  app.all("/api/games", async (req, res) => {
    const { action } = req.query;
    const db = getDb();

    async function updateAggregates({ player, gameId, gameName, chain, earned, creatorEarned, createdAt }) {
      if (!player || !chain || gameId == null) return;
  
      const w   = player.toLowerCase();
      const gid = String(gameId);
      const playerAmt  = Number(earned) || 0;
      const creatorAmt = Number(creatorEarned) || 0;
      const totalAmt   = playerAmt + creatorAmt;
  
      const scoreDate = createdAt instanceof Date
        ? createdAt
        : createdAt?.toDate?.() || new Date();
      const dateKey = scoreDate.toISOString().slice(0, 10);
  
      const batch = db.batch();
  
      batch.set(db.doc(`platformStats/${chain}`), {
        chain,
        totalPlays:  FV.increment(1),
        totalPayout: FV.increment(totalAmt),
        updatedAt:   FV.serverTimestamp(),
      }, { merge: true });
  
      batch.set(db.doc(`dailyStats/${chain}_${dateKey}`), {
        chain, date: dateKey,
        plays:  FV.increment(1),
        earned: FV.increment(totalAmt),
        updatedAt: FV.serverTimestamp(),
      }, { merge: true });
  
      batch.set(db.doc(`playerStats/${chain}_${w}`), {
        chain, wallet: w,
        plays:      FV.increment(1),
        earned:     FV.increment(playerAmt),
        lastPlayed: scoreDate,
        gameIds:    FV.arrayUnion(gid),
      }, { merge: true });
  
      batch.set(db.doc(`playerDailyStats/${chain}_${dateKey}_${w}`), {
        chain, date: dateKey, wallet: w,
        plays:   FV.increment(1),
        earned:  FV.increment(playerAmt),
        gameIds: FV.arrayUnion(gid),
      }, { merge: true });
  
      batch.set(db.doc(`gameStats/${chain}_${gid}`), {
        chain, gameId: gid, name: gameName || null,
        plays:      FV.increment(1),
        earned:     FV.increment(totalAmt),
        lastPlayed: scoreDate,
      }, { merge: true });
  
      batch.set(db.doc(`gameDailyStats/${chain}_${dateKey}_${gid}`), {
        chain, date: dateKey, gameId: gid,
        plays:  FV.increment(1),
        earned: FV.increment(totalAmt),
      }, { merge: true });
  
      await batch.commit();
    }

    if (req.method === "GET" && action === "stats") {
      const { gameId } = req.query;
      if (!gameId) return res.status(400).json({ error: "gameId required" });
      try {
        res.setHeader("Cache-Control", "public, s-maxage=180, stale-while-revalidate=600");
        const gDoc = await db.collection("games").doc(String(gameId)).get();
        const data = gDoc.exists ? gDoc.data() : {};
        return res.status(200).json({
          plays: data.plays || 0,
          likes: data.likes || 0,
          uniquePlayers: data.uniquePlayers || 0,
          comments: [],
        });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "GET" && action === "comments") {
      const { gameId, limit: cLimStr } = req.query;
      if (!gameId) return res.status(400).json({ error: "gameId required" });
      try {
        res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=300");
        const cLim = Math.min(parseInt(cLimStr) || 50, 100);
        const cSnap = await db.collection("games").doc(String(gameId)).collection("comments")
          .orderBy("createdAt", "desc").limit(cLim).get();
        return res.status(200).json({
          comments: cSnap.docs.map(d => ({
            id: d.id, ...d.data(),
            createdAt: d.data().createdAt?.toDate?.() || null
          })),
        });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "GET" && action === "list") {
      try {
        res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
        const snap = await db.collection("games").where("status", "==", "approved").get();
        const games = snap.docs.map(d => ({ id: d.data().gameId, ...d.data() }));
        return res.status(200).json({ games });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "GET" && action === "sitemap") {
      try {
        const BASE = "https://www.playarcadex.in";
        const staticRoutes = ["/", "/games", "/leaderboard", "/tournaments", "/marketplace", "/support", "/sdk", "/publish"];
        const snap = await db.collection("games").where("status", "==", "approved").get();
        const gamePaths = snap.docs
          .map(d => d.data().gameId)
          .filter(id => id != null)
          .map(id => `/play/${id}`);
        const today = new Date().toISOString().split("T")[0];
        const body = [...staticRoutes, ...gamePaths].map(path => {
          const priority = path === "/" ? "1.0" : path.startsWith("/play/") ? "0.8" : "0.6";
          const freq     = (path === "/" || path === "/games") ? "daily" : "weekly";
          return `  <url>\n    <loc>${BASE}${path}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
        }).join("\n");
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
        res.setHeader("Content-Type", "application/xml; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
        return res.status(200).send(xml);
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "GET" && action === "creator-games") {
      const user = verifyToken(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      try {
        const lowerAddress = user.address.toLowerCase();
        const snap = await db.collection("games").where("creator", "==", lowerAddress).get();
        const games = snap.docs
          .map(d => ({ id: d.data().gameId || d.id, ...d.data() }))
          .sort((a, b) => (b.gameId || 0) - (a.gameId || 0));
        return res.status(200).json({ games });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "GET" && action === "check-gas-claim") {
      const cgcIp = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
      if (!rateLimit(`check-claim:${cgcIp}`, 20))
        return res.status(429).json({ error: "Too many requests" });
      const { address: claimAddr } = req.query;
      if (!claimAddr || !ethers.isAddress(claimAddr))
        return res.status(400).json({ error: "Valid address required" });

      const addrLc = claimAddr.toLowerCase();
      const cached = checkClaimCache.get(addrLc);
      if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
        res.setHeader("Cache-Control", "private, max-age=60");
        return res.status(200).json({ claimed: cached.value, cached: true });
      }

      try {
        const provider = new ethers.JsonRpcProvider(process.env.MST_RPC_URL);
        const faucet   = new ethers.Contract(
          process.env.MST_FAUCET_ADDRESS,
          ["function hasClaimed(address) view returns (bool)"],
          provider
        );
        const claimed = await faucet.hasClaimed(claimAddr);
        checkClaimCache.set(addrLc, { value: claimed, at: Date.now() });
        if (checkClaimCache.size > 5000) {
          const entries = [...checkClaimCache.entries()].sort((a, b) => a[1].at - b[1].at);
          entries.slice(0, 500).forEach(([k]) => checkClaimCache.delete(k));
        }
        res.setHeader("Cache-Control", "private, max-age=60");
        return res.status(200).json({ claimed });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "GET" && action === "scores") {
      try {
        res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=300");
        const { chain, gameId, limit: limitStr, from, to } = req.query;

        const scUser = verifyToken(req);
        const requestedLim = parseInt(limitStr) || 500;
        const lim = scUser
          ? Math.min(requestedLim, 10000)
          : Math.min(requestedLim, 500);

        let ref = db.collection("scores");
        if (chain)  ref = ref.where("chain",  "==", chain);
        if (gameId) ref = ref.where("gameId", "==", parseInt(gameId));

        const fromDate = from ? new Date(from) : null;
        const toDate   = to   ? new Date(to)   : null;
        if (toDate && !isNaN(toDate)) toDate.setHours(23, 59, 59, 999);

        let scores = [];
        try {
          let q = ref.orderBy("createdAt", "desc");
          if (fromDate && !isNaN(fromDate)) q = q.where("createdAt", ">=", fromDate);
          if (toDate   && !isNaN(toDate))   q = q.where("createdAt", "<=", toDate);
          const snap = await q.limit(lim).get();
          scores = snap.docs.map(d => ({
            id: d.id, ...d.data(),
            createdAt: d.data().createdAt?.toDate?.() || null,
          }));
        } catch (indexErr) {
          console.warn("[scores] orderBy fallback:", indexErr.code, indexErr.message);
          const snap = await ref.limit(lim).get();
          scores = snap.docs
            .map(d => ({
              id: d.id, ...d.data(),
              createdAt: d.data().createdAt?.toDate?.() || null,
            }))
            .filter(s => {
              if (!s.createdAt) return false;
              const d = new Date(s.createdAt);
              if (fromDate && !isNaN(fromDate) && d < fromDate) return false;
              if (toDate   && !isNaN(toDate)   && d > toDate)   return false;
              return true;
            })
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        }
        return res.status(200).json({ scores });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "GET" && action === "user-scores") {
      const uUser = verifyToken(req);
      if (!uUser) return res.status(401).json({ error: "Unauthorized" });
      try {
        res.setHeader("Cache-Control", "private, max-age=30");
        const wallet = uUser.address.toLowerCase();
        let scores = [];
        try {
          const snap = await db.collection("scores")
            .where("player", "==", wallet)
            .orderBy("createdAt", "desc")
            .limit(200)
            .get();
          scores = snap.docs.map(d => ({
            id: d.id, ...d.data(),
            createdAt: d.data().createdAt?.toDate?.() || null,
          }));
        } catch (indexErr) {
          console.warn("[user-scores] orderBy fallback:", indexErr.code, indexErr.message);
          const snap = await db.collection("scores")
            .where("player", "==", wallet)
            .limit(200)
            .get();
          scores = snap.docs
            .map(d => ({
              id: d.id, ...d.data(),
              createdAt: d.data().createdAt?.toDate?.() || null,
            }))
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        }
        return res.status(200).json({ scores });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "POST" && action === "record-time") {
      const rtUser = verifyToken(req);
      if (!rtUser) return res.status(401).json({ error: "Unauthorized" });
      const { gameId, seconds, timestamp, chainId } = req.body;
      if (!gameId || seconds == null) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const gidNum = Number(gameId);
      if (!Number.isFinite(gidNum) || gidNum < 0 || gidNum > 1e9)
        return res.status(400).json({ error: "Invalid gameId" });
      const secNum = Number(seconds);
      if (!Number.isFinite(secNum) || secNum < 0 || secNum > 86400)
        return res.status(400).json({ error: "Invalid seconds (0-86400)" });
      
      const player = rtUser.address;
      if (!rateLimit(`record-time:${player}`, 60)) {
        return res.status(429).json({ error: "Too many requests" });
      }
      try {
        await db.collection("gameTimes").add({
          gameId: String(gameId), player, seconds: secNum,
          chainId: chainId ?? null,
          timestamp: timestamp ?? Date.now(),
          recordedAt: new Date(),
        });
        return res.status(200).json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "POST" && action === "record-event") {
      const reUser = verifyToken(req);
      if (!reUser) return res.status(401).json({ error: "Unauthorized" });
      const { gameId, eventType, value, timestamp, chainId } = req.body;
      if (!gameId || !eventType) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const gidNum2 = Number(gameId);
      if (!Number.isFinite(gidNum2) || gidNum2 < 0 || gidNum2 > 1e9)
        return res.status(400).json({ error: "Invalid gameId" });
      const ALLOWED_EVENTS = new Set([
        "level_start", "level_complete", "level_fail", "death",
        "powerup_used", "purchase", "tutorial_complete", "share",
        "achievement", "session_end",
      ]);
      if (typeof eventType !== "string" || eventType.length > 64 || !ALLOWED_EVENTS.has(eventType))
        return res.status(400).json({ error: "Unknown eventType" });
      
      let valueClean = null;
      if (value != null) {
        try {
          const valStr = JSON.stringify(value);
          if (valStr.length > 500) return res.status(400).json({ error: "value too large" });
          valueClean = value;
        } catch { return res.status(400).json({ error: "Invalid value (must be JSON-serializable)" }); }
      }
      const player = reUser.address;
      if (!rateLimit(`record-event:${player}`, 60)) {
        return res.status(429).json({ error: "Too many requests" });
      }
      try {
        await db.collection("gameEvents").add({
          gameId: String(gameId), player, eventType,
          value: valueClean,
          chainId: chainId ?? null,
          timestamp: timestamp ?? Date.now(),
          recordedAt: new Date(),
        });
        return res.status(200).json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "POST" && action === "claim-gas") {
      const gasUser = verifyToken(req);
      if (!gasUser) return res.status(401).json({ error: "Unauthorized — connect wallet first" });
  
      const { firebaseToken } = req.body;
      if (!firebaseToken)
        return res.status(403).json({ error: "X login required to claim gas" });
  
      let xUid, xProvider;
      try {
        const decoded = await admin.auth().verifyIdToken(firebaseToken);
        xUid      = decoded.uid;
        xProvider = decoded.firebase?.sign_in_provider || "";
        if (!xProvider.includes("twitter"))
          return res.status(403).json({ error: "Must login with X (Twitter) to claim gas" });
      } catch (e) {
        return res.status(403).json({ error: "Invalid or expired X login. Please login again." });
      }
  
      const claimAddress = gasUser.address;
      const xClaimRef = db.collection("faucetXClaims").doc(xUid);
      const xClaimDoc = await xClaimRef.get();
      if (xClaimDoc.exists)
        return res.status(403).json({ error: "This X account has already claimed gas." });
  
      const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
      if (!rateLimit(`faucet:${ip}`, 3))
        return res.status(429).json({ error: "Too many requests" });
      if (!rateLimit(`faucet-addr:${claimAddress.toLowerCase()}`, 2))
        return res.status(429).json({ error: "Too many requests for this wallet" });
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
        
        await xClaimRef.set({
          xUid, wallet: claimAddress.toLowerCase(),
          txHash: tx.hash, claimedAt: new Date(),
        });
        return res.status(200).json({ success: true, txHash: tx.hash });
      } catch (err) {
        const msg = err.shortMessage || err.message || "Claim failed";
        if (msg.includes("Already claimed")) return res.status(200).json({ already: true });
        if (msg.includes("Faucet empty")) return res.status(503).json({ error: "Faucet empty" });
        return res.status(500).json({ error: msg });
      }
    }

    if (req.method === "POST" && action === "verify-item-price") {
      const vpUser = verifyToken(req);
      if (!vpUser) return res.status(401).json({ error: "Unauthorized" });
      const { gameId, itemType, itemKey } = req.body;
      if (!gameId || !itemType || itemKey == null) {
        return res.status(400).json({ error: "gameId, itemType, itemKey required" });
      }
      try {
        const itemDoc = await db
          .collection("games").doc(String(gameId))
          .collection("items").doc(`${itemType}_${itemKey}`)
          .get();
        if (!itemDoc.exists) {
          return res.status(404).json({ error: "Item not found", approved: false });
        }
        const { price, active } = itemDoc.data();
        if (!active) return res.status(403).json({ error: "Item not available", approved: false });
        
        const MAX_ITEM_PRICE = 10000;
        const pnum = Number(price);
        if (!Number.isFinite(pnum) || pnum < 0 || pnum > MAX_ITEM_PRICE)
          return res.status(500).json({ error: "Item price out of allowed range" });
        return res.status(200).json({ canonicalPrice: pnum, approved: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "GET" && action === "check-taskon") {
      const tUser = verifyToken(req);
      if (!tUser) return res.status(401).json({ error: "Unauthorized" });
  
      const chain = req.query.chain;
      if (!chain) {
        return res.status(200).json({
          completed: true, taskonEnabled: false,
          note: "chain query param required to enforce TaskOn",
        });
      }
  
      if (!process.env.TASKON_CLIENT_ID) {
        return res.status(200).json({ completed: true, taskonEnabled: false });
      }
      try {
        const { enabled, completed, cfg } = await checkTaskonForChain(db, tUser.address, chain);
        return res.status(200).json({
          completed,
          taskonEnabled: enabled,
          campaignUrl: cfg?.campaignUrl || process.env.VITE_TASKON_CAMPAIGN_URL || "https://taskon.xyz/",
          questId: cfg?.questId || null,
          chain,
        });
      } catch (err) {
        console.warn("[check-taskon]", err.message);
        return res.status(200).json({ completed: true, taskonEnabled: false, degraded: true });
      }
    }

    if (req.method === "POST" && action === "start-session") {
      const ssUser = verifyToken(req);
      if (!ssUser) return res.status(401).json({ error: "Unauthorized" });
  
      if (await isWalletBanned(db, ssUser.address))
        return res.status(403).json({ error: "This wallet has been suspended." });
      const ssIp = getClientIp(req);
      if (!rateLimit(`session-ip:${ssIp}`, 20, 60_000))
        return res.status(429).json({ error: "Too many session requests from this IP." });
  
      const { gameId, chain } = req.body;
      if (!gameId || !chain) return res.status(400).json({ error: "gameId and chain required" });
      if (!rateLimit(`session:${ssUser.address}:${gameId}`, 10))
        return res.status(429).json({ error: "Too many session requests" });
      try {
        const { randomUUID } = await import("crypto");
        const sessionToken = randomUUID();
        await db.collection("gameSessions").doc(sessionToken).set({
          sessionToken,
          player:    ssUser.address.toLowerCase(),
          gameId:    String(gameId),
          chain,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          used:      false,
        });
        return res.status(200).json({ sessionToken });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "POST" && action === "sign-score") {
      const signUser = verifyToken(req);
      if (!signUser) return res.status(401).json({ error: "Unauthorized" });
  
      const { gameId, score, chain, sessionToken } = req.body;
      if (!gameId || score == null || !chain || !sessionToken)
        return res.status(400).json({ error: "gameId, score, chain, sessionToken required" });
  
      const pk = process.env.SCORE_SIGNER_PRIVATE_KEY;
      if (!pk) return res.status(503).json({ error: "Score signing not configured" });
  
      const platformAddr = PLATFORM_ADDRESSES[chain];
      const chainId      = CHAIN_IDS[chain];
      if (!platformAddr || !chainId)
        return res.status(400).json({ error: `Unknown chain: ${chain}` });
  
      if (await isWalletBanned(db, signUser.address))
        return res.status(403).json({ error: "This wallet has been suspended." });
  
      const signIp = getClientIp(req);
      if (!rateLimit(`sign-ip:${signIp}`, 60, 60_000))
        return res.status(429).json({ error: "Too many sign requests from this IP." });
  
      const signRateMax = signUser.probation ? 5 : 30;
      if (!rateLimit(`sign:${signUser.address.toLowerCase()}:${gameId}`, signRateMax))
        return res.status(429).json({ error: "Too many sign requests" });
  
      if (process.env.TASKON_CLIENT_ID) {
        try {
          const { enabled, completed, cfg } = await checkTaskonForChain(db, signUser.address, chain);
          if (enabled && !completed) {
            return res.status(403).json({
              error: "Complete the community task on TaskOn to claim rewards.",
              requiresTaskOn: true,
              campaignUrl: cfg?.campaignUrl || process.env.VITE_TASKON_CAMPAIGN_URL || "https://taskon.xyz/",
              chain,
            });
          }
        } catch (err) {
          console.warn("[sign-score] TaskOn check failed, allowing:", err.message);
        }
      }
  
      try {
        const sessDocRef  = db.collection("gameSessions").doc(sessionToken);
        const sessDocSnap = await sessDocRef.get();
  
        if (!sessDocSnap.exists)
          return res.status(403).json({ error: "Invalid or expired session. Open the game page and play first." });
  
        const sessData = sessDocSnap.data();
  
        if (sessData.player !== signUser.address.toLowerCase())
          return res.status(403).json({ error: "Invalid or expired session. Open the game page and play first." });
  
        if (sessData.gameId !== String(gameId))
          return res.status(403).json({ error: "Invalid or expired session. Open the game page and play first." });
  
        const expiresAt = sessData.expiresAt?.toDate?.() || new Date(sessData.expiresAt);
        if (expiresAt < new Date())
          return res.status(403).json({ error: "Session expired. Reload the game page." });
  
        if (sessData.chain !== chain)
          return res.status(403).json({ error: "Session chain mismatch." });
  
        const sessDoc = sessDocSnap;
  
        const scoreNum   = Number(score);
        const createdAt  = sessDoc.data().createdAt?.toDate?.() || new Date(sessDoc.data().createdAt);
        const playSec    = (Date.now() - createdAt.getTime()) / 1000;
        const rate       = playSec > 0 ? scoreNum / playSec : Infinity;
  
        const flagAndReject = async (reason, extra = {}) => {
          await db.collection("flagged").add({
            player: signUser.address.toLowerCase(),
            gameId: String(gameId),
            score: scoreNum, playSec, rate, chain,
            reason, ...extra, flaggedAt: new Date(),
          });
          return res.status(403).json({ error: reason });
        };
  
        if (!Number.isFinite(scoreNum) || scoreNum < 0)
          return res.status(400).json({ error: "Invalid score value.", softReject: true });
  
        const statRef  = db.collection("gameStats").doc(String(gameId));
        const statSnap = await statRef.get();
        const { avgRate = null, avgPlaySec = null, maxRate = null, count = 0 } = statSnap.exists ? statSnap.data() : {};
        const LEARN_SAMPLES = 20;   
  
        const MIN_PLAY_FLOOR    = signUser.probation ? 15  : 3;
        const MIN_PLAY_CEILING  = signUser.probation ? 60  : 30;
        const MIN_PLAY_FRACTION = signUser.probation ? 0.5 : 0.25;
        const learnedRequirement = (count >= LEARN_SAMPLES && avgPlaySec)
          ? avgPlaySec * MIN_PLAY_FRACTION
          : 0;
        const minPlayRequired = Math.min(
          MIN_PLAY_CEILING,
          Math.max(MIN_PLAY_FLOOR, learnedRequirement)
        );
        if (playSec < minPlayRequired) {
          const secondsNeeded = Math.ceil(minPlayRequired);
          return res.status(400).json({
            error: `Play at least ${secondsNeeded} seconds before submitting.`,
            minPlaySeconds: secondsNeeded,
            softReject: true,
          });
        }
  
        const ABSOLUTE_MAX_RATE = 500;
        if (rate > ABSOLUTE_MAX_RATE)
          return await flagAndReject("Impossible score rate", { absoluteMaxRate: ABSOLUTE_MAX_RATE });
  
        const ANOMALY_AVG_MULT = 6;  
        const withinNormal = !avgRate || rate <= avgRate * ANOMALY_AVG_MULT;
        if (withinNormal) {
          const newCount   = count + 1;
          const newAvgRate = avgRate    ? (avgRate * count + rate) / newCount       : rate;
          const newAvgPlay = avgPlaySec ? (avgPlaySec * count + playSec) / newCount : playSec;
          const newMaxRate = Math.max(maxRate || 0, rate);
          await statRef.set({ avgRate: newAvgRate, avgPlaySec: newAvgPlay, maxRate: newMaxRate, count: newCount, lastUpdated: new Date() }, { merge: true });
        }
  
        const player       = signUser.address;
        const signerWallet = new ethers.Wallet(pk);
        const nonce        = ethers.toBigInt(ethers.keccak256(ethers.toUtf8Bytes("sess:" + sessionToken)));
  
        const messageHash = ethers.solidityPackedKeccak256(
          ["address", "uint256", "uint256", "uint256", "address", "uint256"],
          [player, BigInt(gameId), BigInt(score), nonce, platformAddr, chainId]
        );
  
        const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));
  
        let tournamentNonce = null, tournamentSignature = null;
        const { tournamentId } = req.body;
        if (tournamentId) {
          const tournamentAddr = TOURNAMENT_ADDRESSES[chain];
          if (tournamentAddr) {
            tournamentNonce = ethers.toBigInt(ethers.keccak256(ethers.toUtf8Bytes("tsess:" + sessionToken)));
            const tHash = ethers.solidityPackedKeccak256(
              ["address", "uint256", "uint256", "uint256", "address", "uint256"],
              [player, BigInt(tournamentId), BigInt(score), tournamentNonce, tournamentAddr, chainId]
            );
            tournamentSignature = await signerWallet.signMessage(ethers.getBytes(tHash));
          }
        }
  
        return res.status(200).json({
          nonce: nonce.toString(),
          signature,
          tournamentNonce: tournamentNonce?.toString() ?? null,
          tournamentSignature,
        });
  
      } catch (err) {
        console.error("[sign-score]", err);
        return res.status(500).json({ error: err.message });
      }
    }

    const user = verifyToken(req);
    if (!user && req.method === "POST") {
        return res.status(401).json({ error: "Unauthorized — connect wallet" });
    }

    if (req.method === "POST" && action === "play") {
      const { gameId } = req.body;
      if (!rateLimit(`play:${user.address}`, 30)) {
        return res.status(429).json({ error: "Too many requests" });
      }
      try {
        const gameRef   = db.collection("games").doc(String(gameId));
        const playerRef = gameRef.collection("players").doc(user.address);
  
        await gameRef.update({ plays: FV.increment(1) });
  
        const existingPlayer = await playerRef.get();
        if (!existingPlayer.exists) {
          await gameRef.update({ uniquePlayers: FV.increment(1) });
        }
  
        await playerRef.set(
          { address: user.address, lastPlayed: new Date() }, { merge: true }
        );
        return res.status(200).json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "POST" && action === "battle-start-session") {
      const bUser = verifyToken(req);
      if (!bUser) return res.status(401).json({ error: "Unauthorized" });
  
      if (await isWalletBanned(db, bUser.address))
        return res.status(403).json({ error: "This wallet has been suspended." });
  
      const bIp = getClientIp(req);
      if (!rateLimit(`battle-session-ip:${bIp}`, 10, 60_000))
        return res.status(429).json({ error: "Too many session requests from this IP." });
      if (!rateLimit(`battle-session:${bUser.address}`, 5, 60_000))
        return res.status(429).json({ error: "Too many session requests." });
  
      const { chain } = req.body;
      if (!chain) return res.status(400).json({ error: "chain required" });
  
      const battleArenaAddr = BATTLE_ARENA_ADDRESSES[chain];
      const chainId         = CHAIN_IDS[chain];
      if (!battleArenaAddr || !chainId)
        return res.status(400).json({ error: `Battle Arena not available on chain: ${chain}` });
  
      try {
        const { randomUUID } = await import("crypto");
        const sessionId    = randomUUID();
        const sessionToken = randomUUID();
        const ttlHours     = Number(process.env.BATTLE_SESSION_TTL_HOURS) || 2;
  
        await db.collection("battleSessions").doc(sessionId).set({
          sessionId,
          sessionToken,
          player:      bUser.address.toLowerCase(),
          chain,
          chainId:     Number(chainId),
          battleArena: battleArenaAddr,
          createdAt:   new Date(),
          expiresAt:   new Date(Date.now() + ttlHours * 60 * 60 * 1000),
          rounds:      [],          
          totalDollars: 0,
          status:      "active",     
          claimTxHash: null,
        });
  
        return res.status(200).json({ sessionId, sessionToken });
      } catch (err) {
        console.error("[battle-start-session]", err);
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method === "POST" && action === "battle-round") {
      const bUser = verifyToken(req);
      if (!bUser) return res.status(401).json({ error: "Unauthorized" });
  
      const { sessionId, sessionToken, round, dollars } = req.body;
      if (!sessionId || !sessionToken || round == null || dollars == null)
        return res.status(400).json({ error: "sessionId, sessionToken, round, dollars required" });
  
      const roundNum  = parseInt(round);
      const dollarNum = parseInt(dollars);
      if (!(roundNum >= 1 && roundNum <= 5))
        return res.status(400).json({ error: "round must be 1-5" });
      if (!Number.isFinite(dollarNum) || dollarNum < 0)
        return res.status(400).json({ error: "dollars must be >= 0" });
  
      const maxPerRound = Number(process.env.BATTLE_MAX_DOLLARS_PER_ROUND) || 50;
      if (dollarNum > maxPerRound)
        return res.status(400).json({ error: `Round earning capped at $${maxPerRound}` });
  
      if (!rateLimit(`battle-round:${bUser.address}`, 30, 60_000))
        return res.status(429).json({ error: "Too many round updates" });
  
      try {
        const sessRef  = db.collection("battleSessions").doc(sessionId);
        const sessSnap = await sessRef.get();
        if (!sessSnap.exists) return res.status(404).json({ error: "Session not found" });
        const sess = sessSnap.data();
  
        if (sess.sessionToken !== sessionToken)
          return res.status(403).json({ error: "Invalid session token" });
        if (sess.player !== bUser.address.toLowerCase())
          return res.status(403).json({ error: "Session belongs to another player" });
        if (sess.status !== "active")
          return res.status(409).json({ error: `Session is ${sess.status}` });
  
        const expiresAt = sess.expiresAt?.toDate?.() || new Date(sess.expiresAt);
        if (expiresAt < new Date()) {
          await sessRef.update({ status: "expired" });
          return res.status(410).json({ error: "Session expired" });
        }
  
        const existingRounds = sess.rounds || [];
        const expectedRound  = existingRounds.length + 1;
        if (roundNum !== expectedRound)
          return res.status(409).json({ error: `Expected round ${expectedRound}, got ${roundNum}` });
  
        const newTotal = (sess.totalDollars || 0) + dollarNum;
        const maxPerSession = Number(process.env.BATTLE_MAX_DOLLARS_PER_SESSION) || 100;
        if (newTotal > maxPerSession)
          return res.status(400).json({ error: `Session total capped at $${maxPerSession}` });
  
        const newRounds = [
          ...existingRounds,
          { round: roundNum, dollars: dollarNum, recordedAt: new Date() },
        ];
  
        const updates = {
          rounds: newRounds,
          totalDollars: newTotal,
          lastRoundAt: new Date(),
        };
        if (roundNum === 5) updates.status = "completed";
  
        await sessRef.update(updates);
  
        return res.status(200).json({
          accepted: true,
          round: roundNum,
          dollars: dollarNum,
          totalDollars: newTotal,
          status: updates.status || sess.status,
        });
      } catch (err) {
        console.error("[battle-round]", err);
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method === "POST" && action === "battle-sign-claim") {
      const bUser = verifyToken(req);
      if (!bUser) return res.status(401).json({ error: "Unauthorized" });
  
      const { sessionId, sessionToken } = req.body;
      if (!sessionId || !sessionToken)
        return res.status(400).json({ error: "sessionId, sessionToken required" });
  
      if (await isWalletBanned(db, bUser.address))
        return res.status(403).json({ error: "This wallet has been suspended." });
      if (!rateLimit(`battle-claim:${bUser.address}`, 5, 60_000))
        return res.status(429).json({ error: "Too many claim requests" });
  
      const pk = process.env.SCORE_SIGNER_PRIVATE_KEY;
      if (!pk) return res.status(503).json({ error: "Claim signing not configured" });
  
      try {
        const sessRef  = db.collection("battleSessions").doc(sessionId);
        const sessSnap = await sessRef.get();
        if (!sessSnap.exists) return res.status(404).json({ error: "Session not found" });
        const sess = sessSnap.data();
  
        if (sess.sessionToken !== sessionToken)
          return res.status(403).json({ error: "Invalid session token" });
        if (sess.player !== bUser.address.toLowerCase())
          return res.status(403).json({ error: "Session belongs to another player" });
        if (sess.status === "claimed")
          return res.status(409).json({ error: "Session already claimed" });
        if (sess.status !== "completed")
          return res.status(409).json({ error: "Complete all 5 rounds first" });
        if ((sess.rounds || []).length !== 5)
          return res.status(409).json({ error: "All 5 rounds must be recorded" });
  
        const player           = bUser.address;
        const battleArenaAddr  = sess.battleArena;
        const chainId          = BigInt(sess.chainId);
        const totalDollars     = BigInt(sess.totalDollars);
  
        const sessionIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(sessionId));
  
        const signerWallet = new ethers.Wallet(pk);
        const messageHash  = ethers.solidityPackedKeccak256(
          ["address", "bytes32", "uint256", "address", "uint256"],
          [player, sessionIdBytes32, totalDollars, battleArenaAddr, chainId]
        );
        const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));
  
        return res.status(200).json({
          sessionIdBytes32,              
          dollars:     totalDollars.toString(),
          signature,
          battleArena: battleArenaAddr,
          chainId:     sess.chainId,
        });
      } catch (err) {
        console.error("[battle-sign-claim]", err);
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method === "POST" && action === "battle-record-claim") {
      const bUser = verifyToken(req);
      if (!bUser) return res.status(401).json({ error: "Unauthorized" });
  
      const { sessionId, sessionToken, txHash } = req.body;
      if (!sessionId || !sessionToken || !txHash)
        return res.status(400).json({ error: "sessionId, sessionToken, txHash required" });
  
      try {
        const sessRef  = db.collection("battleSessions").doc(sessionId);
        const sessSnap = await sessRef.get();
        if (!sessSnap.exists) return res.status(404).json({ error: "Session not found" });
        const sess = sessSnap.data();
  
        if (sess.sessionToken !== sessionToken)
          return res.status(403).json({ error: "Invalid session token" });
        if (sess.player !== bUser.address.toLowerCase())
          return res.status(403).json({ error: "Session belongs to another player" });
  
        await sessRef.update({
          status:      "claimed",
          claimTxHash: txHash,
          claimedAt:   new Date(),
        });
  
        return res.status(200).json({ ok: true });
      } catch (err) {
        console.error("[battle-record-claim]", err);
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method === "GET" && action === "battle-shop-list") {
      const chain = String(req.query.chain || "").toLowerCase();
      if (!chain || !CHAIN_IDS[chain])
        return res.status(400).json({ error: "chain required" });
  
      try {
        const snap = await db.collection("battleShopItems")
          .where("active", "==", true)
          .get();
  
        const items = [];
        snap.forEach(doc => {
          const d = doc.data();
          if (!d.chain || d.chain === "*" || d.chain === chain) {
            items.push({
              itemId:        doc.id,
              itemIdBytes32: d.itemIdBytes32 || ethers.keccak256(ethers.toUtf8Bytes(doc.id)),
              name:          d.name || "",
              description:   d.description || "",
              category:      d.category || "cosmetic",
              rarity:        d.rarity || "common",
              imageUrl:      d.imageUrl || "",
              priceARCADE:   d.priceARCADE || 0,
              priceUSDC:     d.priceUSDC || 0,
              chain:         d.chain || "*",
              active:        !!d.active,
            });
          }
        });
  
        const rarityRank = { legendary: 4, epic: 3, rare: 2, common: 1 };
        items.sort((a, b) => {
          const rd = (rarityRank[b.rarity] || 0) - (rarityRank[a.rarity] || 0);
          if (rd !== 0) return rd;
          const ap = a.priceARCADE || a.priceUSDC || 0;
          const bp = b.priceARCADE || b.priceUSDC || 0;
          return ap - bp;
        });
  
        return res.status(200).json({ items });
      } catch (err) {
        console.error("[battle-shop-list]", err);
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method === "GET" && action === "battle-shop-inventory") {
      const bUser = verifyToken(req);
      if (!bUser) return res.status(401).json({ error: "Unauthorized" });
  
      try {
        const invRef = db.collection("battleShopInventory")
          .doc(bUser.address.toLowerCase())
          .collection("items");
        const snap = await invRef.get();
  
        const items = [];
        snap.forEach(doc => {
          const d = doc.data();
          items.push({
            itemId:       doc.id,
            chain:        d.chain || null,
            token:        d.token || null,
            price:        d.price || null,
            purchasedAt:  d.purchasedAt || null,
            txHash:       d.txHash || null,
          });
        });
  
        return res.status(200).json({ items });
      } catch (err) {
        console.error("[battle-shop-inventory]", err);
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method === "POST" && action === "battle-shop-purchase-quote") {
      const bUser = verifyToken(req);
      if (!bUser) return res.status(401).json({ error: "Unauthorized" });
  
      if (await isWalletBanned(db, bUser.address))
        return res.status(403).json({ error: "This wallet has been suspended." });
      if (!rateLimit(`shop-quote:${bUser.address}`, 20, 60_000))
        return res.status(429).json({ error: "Too many quote requests" });
  
      const { itemId, currency, chain } = req.body;
      if (!itemId || !currency || !chain)
        return res.status(400).json({ error: "itemId, currency, chain required" });
  
      const chainKey = String(chain).toLowerCase();
      const cur      = String(currency).toUpperCase();
      if (!CHAIN_IDS[chainKey])
        return res.status(400).json({ error: `Unknown chain: ${chainKey}` });
      if (cur !== "ARCADE" && cur !== "USDC")
        return res.status(400).json({ error: "currency must be ARCADE or USDC" });
  
      const shopAddr = BATTLE_SHOP_ADDRESSES[chainKey];
      const chainId  = CHAIN_IDS[chainKey];
      if (!shopAddr)
        return res.status(400).json({ error: `Battle Shop not deployed on ${chainKey}` });
  
      const tokenAddr = BATTLE_SHOP_TOKENS[chainKey]?.[cur];
      if (!tokenAddr)
        return res.status(400).json({ error: `${cur} not configured on ${chainKey}` });
  
      const decimals = BATTLE_SHOP_TOKEN_DECIMALS[cur];
      if (!decimals)
        return res.status(500).json({ error: `Missing decimals config for ${cur}` });
  
      const pk = process.env.SCORE_SIGNER_PRIVATE_KEY;
      if (!pk) return res.status(503).json({ error: "Quote signing not configured" });
  
      try {
        const itemSnap = await db.collection("battleShopItems").doc(itemId).get();
        if (!itemSnap.exists) return res.status(404).json({ error: "Item not found" });
        const item = itemSnap.data();
  
        if (!item.active) return res.status(409).json({ error: "Item is not active" });
        if (item.chain && item.chain !== "*" && item.chain !== chainKey)
          return res.status(409).json({ error: `Item not available on ${chainKey}` });
  
        const priceHuman = cur === "ARCADE" ? Number(item.priceARCADE) : Number(item.priceUSDC);
        if (!priceHuman || priceHuman <= 0)
          return res.status(409).json({ error: `Item not sold for ${cur}` });
  
        const ownedRef = db
          .collection("battleShopInventory")
          .doc(bUser.address.toLowerCase())
          .collection("items")
          .doc(itemId);
        const ownedSnap = await ownedRef.get();
        if (ownedSnap.exists)
          return res.status(409).json({ error: "You already own this item" });
  
        const priceWei = BigInt(priceHuman) * (10n ** BigInt(decimals));
  
        const { randomBytes, randomUUID } = await import("crypto");
        const nonce         = "0x" + randomBytes(32).toString("hex");
        const itemIdBytes32 = item.itemIdBytes32 || ethers.keccak256(ethers.toUtf8Bytes(itemId));
        const quoteId       = randomUUID();
  
        const signerWallet = new ethers.Wallet(pk);
        const messageHash  = ethers.solidityPackedKeccak256(
          ["address", "bytes32", "address", "uint256", "bytes32", "address", "uint256"],
          [bUser.address, itemIdBytes32, tokenAddr, priceWei, nonce, shopAddr, chainId]
        );
        const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));
  
        const ttlMinutes = Number(process.env.BATTLE_SHOP_QUOTE_TTL_MINUTES) || 10;
        const expiresAt  = new Date(Date.now() + ttlMinutes * 60 * 1000);
        await db.collection("battleShopQuotes").doc(quoteId).set({
          quoteId,
          nonce,
          buyer:         bUser.address.toLowerCase(),
          itemId,
          itemIdBytes32,
          chain:         chainKey,
          chainId:       Number(chainId),
          contract:      shopAddr,
          token:         tokenAddr,
          currency:      cur,
          price:         priceWei.toString(),
          priceHuman,
          signature,
          status:        "pending",   
          createdAt:     new Date(),
          expiresAt,
        });
  
        return res.status(200).json({
          itemId,
          itemIdBytes32,
          token:      tokenAddr,
          price:      priceWei.toString(),
          priceHuman,
          currency:   cur,
          nonce,
          signature,
          contract:   shopAddr,
          chainId:    Number(chainId),
          expiresAt:  expiresAt.toISOString(),
        });
      } catch (err) {
        console.error("[battle-shop-purchase-quote]", err);
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method === "POST" && action === "battle-shop-record-purchase") {
      const bUser = verifyToken(req);
      if (!bUser) return res.status(401).json({ error: "Unauthorized" });
  
      const { itemId, chain, nonce, txHash } = req.body;
      if (!itemId || !chain || !nonce || !txHash)
        return res.status(400).json({ error: "itemId, chain, nonce, txHash required" });
  
      const chainKey = String(chain).toLowerCase();
      const shopAddr = BATTLE_SHOP_ADDRESSES[chainKey];
      const rpcUrl   = RPC_URLS[chainKey];
      if (!shopAddr || !rpcUrl)
        return res.status(400).json({ error: `Shop not configured on ${chainKey}` });
  
      try {
        const quotesSnap = await db.collection("battleShopQuotes")
          .where("nonce", "==", nonce)
          .where("buyer", "==", bUser.address.toLowerCase())
          .limit(1)
          .get();
        if (quotesSnap.empty)
          return res.status(404).json({ error: "Quote not found for this nonce" });
        const quoteDoc  = quotesSnap.docs[0];
        const quote     = quoteDoc.data();
        const itemIdBytes32 = quote.itemIdBytes32;
  
        const abi = [
          "function hasItem(address user, bytes32 itemId) view returns (bool)",
          "function usedNonces(bytes32 n) view returns (bool)",
        ];
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const contract = new ethers.Contract(shopAddr, abi, provider);
  
        const [ownsIt, nonceUsed] = await Promise.all([
          contract.hasItem(bUser.address, itemIdBytes32),
          contract.usedNonces(nonce),
        ]);
  
        if (!ownsIt)
          return res.status(400).json({
            error: "On-chain ownership not confirmed. Tx may not have been mined yet.",
          });
        if (!nonceUsed)
          return res.status(400).json({
            error: "On-chain nonce not marked used. Purchase incomplete.",
          });
  
        const invRef = db
          .collection("battleShopInventory")
          .doc(bUser.address.toLowerCase())
          .collection("items")
          .doc(itemId);
        await invRef.set(
          {
            itemId,
            chain:       chainKey,
            token:       quote.token,
            price:       quote.price,
            currency:    quote.currency,
            purchasedAt: new Date(),
            txHash,
            nonce,
          },
          { merge: true }
        );
  
        await quoteDoc.ref.update({
          status:      "used",
          usedAt:      new Date(),
          txHash,
        });
  
        return res.status(200).json({ ok: true, itemId, txHash });
      } catch (err) {
        console.error("[battle-shop-record-purchase]", err);
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method === "POST" && action === "like") {
      const { gameId } = req.body;
      if (!gameId) return res.status(400).json({ error: "gameId required" });
      const likeId = `${String(gameId)}_${user.address.toLowerCase()}`;
      try {
        await db.collection("gameLikes").doc(likeId).create({
          gameId: String(gameId),
          player: user.address.toLowerCase(),
          at: new Date(),
        });
        await db.collection("games").doc(String(gameId)).update({ likes: FV.increment(1) });
        return res.status(200).json({ success: true });
      } catch (err) {
        if (err.code === 6 || /already exists/i.test(err.message || ""))
          return res.status(409).json({ error: "Already liked" });
        return res.status(500).json({ error: err.message });
      }
    }
  
    if (req.method === "POST" && action === "unlike") {
      const { gameId } = req.body;
      if (!gameId) return res.status(400).json({ error: "gameId required" });
      const likeId = `${String(gameId)}_${user.address.toLowerCase()}`;
      try {
        const likeRef = db.collection("gameLikes").doc(likeId);
        const existing = await likeRef.get();
        if (!existing.exists) return res.status(200).json({ success: true, alreadyUnliked: true });
        await likeRef.delete();
        await db.collection("games").doc(String(gameId)).update({ likes: FV.increment(-1) });
        return res.status(200).json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }
  
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

    if (req.method === "POST" && action === "score") {
      const { txHash, score, gameId, gameName, chain, earned, earnedSymbol } = req.body;
      if (!txHash || score == null) return res.status(400).json({ error: "Missing fields" });
  
      const chainKey = chain || "botchain";
      const rpcUrl   = RPC_URLS[chainKey];
      const platformAddr = PLATFORM_ADDRESSES[chainKey];
      if (!rpcUrl || !platformAddr)
        return res.status(400).json({ error: `Unknown chain: ${chainKey}` });
  
      try {
        const existing = await db.collection("scores").doc(txHash).get();
        if (existing.exists) return res.status(200).json({ success: true, cached: true });
  
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const receipt  = await provider.getTransactionReceipt(txHash);
        if (!receipt) return res.status(400).json({ error: "Transaction not found on-chain" });
        if (receipt.status !== 1) return res.status(400).json({ error: "Transaction failed on-chain" });
  
        if (receipt.to?.toLowerCase() !== platformAddr.toLowerCase())
          return res.status(400).json({ error: "Transaction not to Platform contract" });
  
        const iface = new ethers.Interface(PLATFORM_EVENT_ABI);
        let matched = null;
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== platformAddr.toLowerCase()) continue;
          try {
            const parsed = iface.parseLog({ topics: log.topics, data: log.data });
            if (parsed?.name === "PlayRecorded" &&
                parsed.args.player.toLowerCase() === user.address.toLowerCase()) {
              matched = parsed;
              break;
            }
          } catch { }
        }
        if (!matched)
          return res.status(400).json({ error: "No matching PlayRecorded event for this player" });
  
        const onChainGameId  = matched.args.gameId.toString();
        const onChainReward  = Number(ethers.formatEther(matched.args.playerReward));
        const onChainCreator = Number(ethers.formatEther(matched.args.creatorReward));
  
        const scoreDoc = {
          player:        user.address,
          score:         parseInt(score),          
          gameId:        parseInt(onChainGameId),   
          gameName:      gameName || "Unknown",
          chain:         chainKey,
          earned:        onChainReward,             
          creatorEarned: onChainCreator,            
          earnedSymbol:  earnedSymbol || "ARCADE",
          txHash,
          verified:      true,                      
          createdAt:     new Date(),
          aggregated:    true,                      
        };
        await db.collection("scores").doc(txHash).set(scoreDoc);
  
        try {
          await updateAggregates(scoreDoc);
        } catch (aggErr) {
          console.error("[score] aggregate update failed for", txHash, "—", aggErr.message);
          try { await db.collection("scores").doc(txHash).update({ aggregated: false }); } catch {}
        }
  
        return res.status(200).json({ success: true, verified: true });
      } catch (err) {
        console.error("[score verify]", err);
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method === "POST" && action === "save-game") {
      const { gameId, name, description, iframeUrl, thumbnailUrl, category, rewardRate, rewardRateNative, txHash } = req.body;
  
      if (gameId == null) return res.status(400).json({ error: "gameId required" });
      const gidNum3 = Number(gameId);
      if (!Number.isFinite(gidNum3) || gidNum3 < 0 || gidNum3 > 1e9)
        return res.status(400).json({ error: "Invalid gameId" });
  
      if (!iframeUrl || typeof iframeUrl !== "string" || iframeUrl.length > 500)
        return res.status(400).json({ error: "iframeUrl required (max 500 chars)" });
      try {
        const u = new URL(iframeUrl);
        if (u.protocol !== "https:")
          return res.status(400).json({ error: "iframeUrl must use https://" });
      } catch { return res.status(400).json({ error: "Invalid iframeUrl" }); }
  
      if (thumbnailUrl) {
        if (typeof thumbnailUrl !== "string" || thumbnailUrl.length > 500)
          return res.status(400).json({ error: "Invalid thumbnailUrl" });
        try {
          const tu = new URL(thumbnailUrl);
          if (tu.protocol !== "https:" && tu.protocol !== "http:")
            return res.status(400).json({ error: "thumbnailUrl must be http(s)://" });
        } catch { return res.status(400).json({ error: "Invalid thumbnailUrl" }); }
      }
  
      if (name && (typeof name !== "string" || name.length > 100))
        return res.status(400).json({ error: "name too long (max 100)" });
      if (description && (typeof description !== "string" || description.length > 1000))
        return res.status(400).json({ error: "description too long (max 1000)" });
      if (category && (typeof category !== "string" || category.length > 50))
        return res.status(400).json({ error: "category too long" });
  
      const MAX_REWARD_RATE        = 500;   
      const MAX_REWARD_RATE_NATIVE = 10;    
      const clampedRate       = Math.min(Math.max(parseInt(rewardRate) || 50, 0), MAX_REWARD_RATE);
      const clampedRateNative = rewardRateNative != null
        ? Math.min(Math.max(parseInt(rewardRateNative) || 1, 0), MAX_REWARD_RATE_NATIVE)
        : null;
  
      try {
        const gameRef = db.collection("games").doc(String(gameId));
        const existing = await gameRef.get();
        if (existing.exists) {
          const existingCreator = existing.data().creator?.toLowerCase();
          if (existingCreator && existingCreator !== user.address?.toLowerCase())
            return res.status(403).json({ error: "Not your game" });
  
          await gameRef.update({
            name, description, iframeUrl,
            thumbnailUrl: thumbnailUrl || existing.data().thumbnailUrl || "",
            category, rewardRate: clampedRate,
            rewardRateNative: clampedRateNative != null ? clampedRateNative : (existing.data().rewardRateNative ?? 1),
            txHash, status: "pending", updatedAt: new Date(),
          });
        } else {
          await gameRef.set({
            gameId: gidNum3, name, description, iframeUrl,
            thumbnailUrl: thumbnailUrl || "",
            category, rewardRate: clampedRate,
            rewardRateNative: clampedRateNative != null ? clampedRateNative : 1,
            creator: user.address, txHash,
            status: "pending", plays: 0, earned: 0,
            createdAt: new Date(),
          });
        }
        return res.status(200).json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }
  
    if (req.method === "POST" && action === "update-game") {
      const { gameId, rewardRate, rewardRateNative, helpContent } = req.body;
      try {
        const gameRef = db.collection("games").doc(String(gameId));
        const game = await gameRef.get();
        if (!game.exists) return res.status(404).json({ error: "Game not found" });
        if (game.data().creator?.toLowerCase() !== user.address?.toLowerCase()) return res.status(403).json({ error: "Not your game" });
        const updates = {};
        const MAX_REWARD_RATE        = 500;
        const MAX_REWARD_RATE_NATIVE = 10;
        if (rewardRate != null)
          updates.rewardRate = Math.min(Math.max(parseInt(rewardRate) || 0, 0), MAX_REWARD_RATE);
        if (rewardRateNative != null)
          updates.rewardRateNative = Math.min(Math.max(parseInt(rewardRateNative) || 0, 0), MAX_REWARD_RATE_NATIVE);
        if (helpContent != null) {
          const videoUrl = (helpContent.videoUrl || "").trim();
          if (videoUrl) {
            if (videoUrl.length > 500)
              return res.status(400).json({ error: "videoUrl too long" });
            try {
              const vu = new URL(videoUrl);
              if (vu.protocol !== "https:")
                return res.status(400).json({ error: "videoUrl must use https://" });
            } catch { return res.status(400).json({ error: "Invalid videoUrl" }); }
          }
          const capText = (v, max) => {
            if (v == null) return "";
            if (typeof v !== "string") return "";
            const t = v.trim();
            return t.length > max ? t.slice(0, max) : t;
          };
          updates.helpContent = {
            objective:    capText(helpContent.objective,    500),
            controls:     capText(helpContent.controls,     500),
            instructions: capText(helpContent.instructions, 1000),
            tips:         capText(helpContent.tips,         500),
            videoUrl,
          };
        }
        if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Nothing to update" });
        await gameRef.update(updates);
        return res.status(200).json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "GET" && action === "admin-player-analytics") {
      const aUser = verifyToken(req);
      if (!aUser) return res.status(401).json({ error: "Unauthorized" });
      if (!(await checkOnChainAdmin(aUser.address)))
        return res.status(403).json({ error: "Admin only" });
  
      try {
        const { chain, from, to } = req.query;
        if (!chain) return res.status(400).json({ error: "chain required" });
  
        const fromDate = from ? new Date(from) : null;
        const toDate   = to   ? new Date(to)   : null;
        if (toDate && !isNaN(toDate)) toDate.setUTCHours(23, 59, 59, 999);
        const isAllTime = !fromDate && !toDate;
  
        const fromKey = fromDate && !isNaN(fromDate) ? fromDate.toISOString().slice(0, 10) : null;
        const toKey   = toDate   && !isNaN(toDate)   ? toDate.toISOString().slice(0, 10)   : null;
  
        let playerSharePct = 100;
        try {
          const settingsDoc = await db.collection("chainSettings").doc(chain).get();
          if (settingsDoc.exists) {
            const s = settingsDoc.data();
            if (s.playerPct != null) playerSharePct = Number(s.playerPct);
          }
        } catch { }
  
        const gamesSnap = await db.collection("games")
          .where("status", "==", "approved").get();
        const approvedGames = {};
        gamesSnap.docs.forEach(d => {
          const g = d.data();
          approvedGames[String(g.gameId)] = { name: g.name };
        });
  
        if (isAllTime) {
          const [platformSnap, playersSnap, playersCountSnap, gamesAggSnap, dailySnap] = await Promise.all([
            db.doc(`platformStats/${chain}`).get(),
            db.collection("playerStats")
              .where("chain", "==", chain)
              .orderBy("earned", "desc")
              .limit(500)
              .get(),
            db.collection("playerStats")
              .where("chain", "==", chain)
              .count().get(),
            db.collection("gameStats")
              .where("chain", "==", chain)
              .get(),
            db.collection("dailyStats")
              .where("chain", "==", chain)
              .orderBy("date", "desc")
              .limit(90)
              .get(),
          ]);
  
          const platform = platformSnap.exists ? platformSnap.data() : { totalPlays: 0, totalPayout: 0 };
          const totalPlays  = Number(platform.totalPlays  || 0);
          const totalPayout = Number(platform.totalPayout || 0);
          const activePlayers = playersCountSnap.data().count;
  
          const playerRows = playersSnap.docs.map(d => {
            const p = d.data();
            return {
              wallet:      p.wallet,
              plays:       Number(p.plays  || 0),
              earned:      Number((Number(p.earned || 0)).toFixed(4)),
              gamesPlayed: Array.isArray(p.gameIds) ? p.gameIds.length : 0,
              lastPlayed:  p.lastPlayed?.toDate?.()?.toISOString?.() || null,
            };
          });
  
          const gameRows = gamesAggSnap.docs
            .map(d => {
              const g = d.data();
              const gid = String(g.gameId);
              if (!approvedGames[gid]) return null; 
              return {
                gameId: Number(g.gameId),
                name:   approvedGames[gid].name || g.name,
                plays:  Number(g.plays  || 0),
                earned: Number((Number(g.earned || 0)).toFixed(4)),
              };
            })
            .filter(Boolean)
            .sort((a, b) => b.plays - a.plays);
  
          const dailyRows = dailySnap.docs
            .map(d => {
              const x = d.data();
              return {
                date:          x.date,
                plays:         Number(x.plays  || 0),
                earned:        Number((Number(x.earned || 0)).toFixed(4)),
                uniquePlayers: 0,
              };
            })
            .sort((a, b) => a.date.localeCompare(b.date));
  
          const recentDates = dailyRows.slice(-30).map(r => r.date);
          if (recentDates.length > 0) {
            const countPromises = recentDates.map(date =>
              db.collection("playerDailyStats")
                .where("chain", "==", chain)
                .where("date",  "==", date)
                .count().get()
                .then(agg => ({ date, count: agg.data().count }))
                .catch(() => ({ date, count: 0 }))
            );
            const counts = await Promise.all(countPromises);
            const countMap = Object.fromEntries(counts.map(c => [c.date, c.count]));
            dailyRows.forEach(r => {
              if (countMap[r.date] != null) r.uniquePlayers = countMap[r.date];
            });
          }
  
          return res.status(200).json({
            summary: {
              totalPlays,
              totalPayout:  Number(totalPayout.toFixed(4)),
              activePlayers,                    
              totalGames:   gameRows.length,
              avgPerPlayer: activePlayers > 0
                ? Number((totalPayout / activePlayers).toFixed(4)) : 0,
              skippedNonApproved: 0,           
              scannedScores: totalPlays,       
              playerSharePct,
              source: "aggregates",            
            },
            players: playerRows,
            daily:   dailyRows,
            games:   gameRows,
          });
        }
  
        const [dailySnap, playerDailySnap, gameDailySnap] = await Promise.all([
          db.collection("dailyStats")
            .where("chain", "==", chain)
            .where("date",  ">=", fromKey || "0000-00-00")
            .where("date",  "<=", toKey   || "9999-99-99")
            .orderBy("date", "asc")
            .get(),
          db.collection("playerDailyStats")
            .where("chain", "==", chain)
            .where("date",  ">=", fromKey || "0000-00-00")
            .where("date",  "<=", toKey   || "9999-99-99")
            .get(),
          db.collection("gameDailyStats")
            .where("chain", "==", chain)
            .where("date",  ">=", fromKey || "0000-00-00")
            .where("date",  "<=", toKey   || "9999-99-99")
            .get(),
        ]);
  
        let totalPlays = 0;
        let totalPayout = 0;
        const dailyRows = dailySnap.docs.map(d => {
          const x = d.data();
          totalPlays  += Number(x.plays  || 0);
          totalPayout += Number(x.earned || 0);
          return {
            date:          x.date,
            plays:         Number(x.plays || 0),
            earned:        Number((Number(x.earned || 0)).toFixed(4)),
            uniquePlayers: 0,
          };
        });
  
        const playerAgg = {}; 
        playerDailySnap.docs.forEach(d => {
          const x = d.data();
          const w = x.wallet;
          if (!w) return;
          if (!playerAgg[w]) {
            playerAgg[w] = { wallet: w, plays: 0, earned: 0, lastPlayed: null, games: new Set() };
          }
          playerAgg[w].plays  += Number(x.plays  || 0);
          playerAgg[w].earned += Number(x.earned || 0);
          if (Array.isArray(x.gameIds)) x.gameIds.forEach(g => playerAgg[w].games.add(g));
          if (!playerAgg[w].lastPlayed || x.date > playerAgg[w].lastPlayed) {
            playerAgg[w].lastPlayed = x.date;
          }
        });
        const playerRows = Object.values(playerAgg)
          .map(p => ({
            wallet:      p.wallet,
            plays:       p.plays,
            earned:      Number(p.earned.toFixed(4)),
            gamesPlayed: p.games.size,
            lastPlayed:  p.lastPlayed
              ? new Date(p.lastPlayed + "T00:00:00Z").toISOString()
              : null,
          }))
          .sort((a, b) => b.earned - a.earned);
  
        const gameAgg = {}; 
        gameDailySnap.docs.forEach(d => {
          const x = d.data();
          const gid = String(x.gameId);
          if (!approvedGames[gid]) return; 
          if (!gameAgg[gid]) gameAgg[gid] = { plays: 0, earned: 0 };
          gameAgg[gid].plays  += Number(x.plays  || 0);
          gameAgg[gid].earned += Number(x.earned || 0);
        });
        const gameRows = Object.entries(gameAgg)
          .map(([gid, g]) => ({
            gameId: Number(gid),
            name:   approvedGames[gid]?.name || `Game ${gid}`,
            plays:  g.plays,
            earned: Number(g.earned.toFixed(4)),
          }))
          .sort((a, b) => b.plays - a.plays);
  
        const dates = dailyRows.map(r => r.date);
        if (dates.length > 0) {
          const dailyUnique = {};
          playerDailySnap.docs.forEach(d => {
            const x = d.data();
            if (!dailyUnique[x.date]) dailyUnique[x.date] = new Set();
            dailyUnique[x.date].add(x.wallet);
          });
          dailyRows.forEach(r => {
            if (dailyUnique[r.date]) r.uniquePlayers = dailyUnique[r.date].size;
          });
        }
  
        return res.status(200).json({
          summary: {
            totalPlays,
            totalPayout:  Number(totalPayout.toFixed(4)),
            activePlayers: playerRows.length,
            totalGames:   gameRows.length,
            avgPerPlayer: playerRows.length > 0
              ? Number((totalPayout / playerRows.length).toFixed(4)) : 0,
            skippedNonApproved: 0,
            scannedScores: totalPlays,
            playerSharePct,
            source: "aggregates",
            dateRange: { from: fromKey, to: toKey },
          },
          players: playerRows,
          daily:   dailyRows,
          games:   gameRows,
        });
      } catch (err) {
        console.error("[admin-analytics] fatal error:", err);
        return res.status(500).json({
          error: err?.message || err?.code || "Unknown server error",
          detail: err?.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : undefined,
        });
      }
    }

    if (req.method === "POST" && action === "admin-ban-wallet") {
      if (!(await checkOnChainAdmin(user.address)))
        return res.status(403).json({ error: "Admin only" });
      const { wallet, reason } = req.body || {};
      if (!wallet || !ethers.isAddress(wallet))
        return res.status(400).json({ error: "Valid wallet address required" });
      try {
        await db.collection("bannedWallets").doc(wallet.toLowerCase()).set({
          wallet:    wallet.toLowerCase(),
          reason:    (reason || "").toString().slice(0, 500),
          bannedBy:  user.address.toLowerCase(),
          bannedAt:  new Date(),
        });
        return res.status(200).json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }
  
    if (req.method === "POST" && action === "admin-unban-wallet") {
      if (!(await checkOnChainAdmin(user.address)))
        return res.status(403).json({ error: "Admin only" });
      const { wallet } = req.body || {};
      if (!wallet || !ethers.isAddress(wallet))
        return res.status(400).json({ error: "Valid wallet address required" });
      try {
        await db.collection("bannedWallets").doc(wallet.toLowerCase()).delete();
        return res.status(200).json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }
  
    if (req.method === "GET" && action === "admin-list-banned") {
      const alUser = verifyToken(req);
      if (!alUser) return res.status(401).json({ error: "Unauthorized" });
      if (!(await checkOnChainAdmin(alUser.address)))
        return res.status(403).json({ error: "Admin only" });
      try {
        const snap = await db.collection("bannedWallets").orderBy("bannedAt", "desc").limit(500).get();
        const rows = snap.docs.map(d => {
          const x = d.data();
          return {
            wallet:   x.wallet,
            reason:   x.reason || "",
            bannedBy: x.bannedBy || "",
            bannedAt: x.bannedAt?.toDate?.().toISOString() || null,
          };
        });
        return res.status(200).json({ banned: rows, count: rows.length });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "POST" && action === "admin-purge-cache") {
      if (!(await checkOnChainAdmin(user.address)))
        return res.status(403).json({ error: "Admin only" });
      try {
        checkClaimCache.clear();
        return res.status(200).json({
          success: true,
          note: "In-memory caches cleared. Edge cache will refresh within 2-5 minutes.",
        });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "POST" && action === "admin-update-reward") {
      const caller = user.address?.toLowerCase();
      const superAdmin = process.env.VITE_ADMIN_ADDRESS?.toLowerCase();
  
      const isOnChainAdmin = async (addr) => {
        if (!addr) return false;
        const DEFAULT_ADMIN_ROLE = "0x" + "0".repeat(64);
        const abi = [
          "function hasRole(bytes32 role, address account) view returns (bool)",
          "function ADMIN_ROLE() view returns (bytes32)",
        ];
        for (const chain of Object.keys(PLATFORM_ADDRESSES)) {
          const platformAddr = PLATFORM_ADDRESSES[chain];
          const rpc = RPC_URLS[chain];
          if (!platformAddr || !rpc) continue;
          try {
            const c = new ethers.Contract(platformAddr, abi, new ethers.JsonRpcProvider(rpc));
            const adminRole = await c.ADMIN_ROLE().catch(() => null);
            const checks = await Promise.all([
              adminRole ? c.hasRole(adminRole, addr).catch(() => false) : Promise.resolve(false),
              c.hasRole(DEFAULT_ADMIN_ROLE, addr).catch(() => false),
            ]);
            if (checks.some(Boolean)) return true;
          } catch (_) { }
        }
        return false;
      };
  
      const allowed = (superAdmin && caller === superAdmin) || await isOnChainAdmin(caller);
      if (!allowed)
        return res.status(403).json({ error: "Admin only" });
  
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

    if (req.method === "POST" && action === "flagged-list") {
      if (!(await checkOnChainAdmin(user.address)))
        return res.status(403).json({ error: "Admin only" });
      try {
        const FLAG_WINDOW_MS = 24 * 60 * 60 * 1000;
        const now = Date.now();
        const snap = await db.collection("flagged")
          .orderBy("flaggedAt", "desc").limit(1000).get();
  
        const byPlayer = {};
        snap.docs.forEach(d => {
          const data = d.data();
          const p = (data.player || "").toLowerCase();
          if (!p) return;
          const t = data.flaggedAt?.toDate?.()?.getTime?.() ?? new Date(data.flaggedAt).getTime();
          if (!byPlayer[p]) byPlayer[p] = { player: p, total: 0, recent: 0, lastFlaggedAt: null, reasons: {}, chains: new Set() };
          const e = byPlayer[p];
          e.total++;
          if (t > now - FLAG_WINDOW_MS) e.recent++;
          if (!e.lastFlaggedAt || t > e.lastFlaggedAt) e.lastFlaggedAt = t;
          if (data.reason) e.reasons[data.reason] = (e.reasons[data.reason] || 0) + 1;
          if (data.chain) e.chains.add(data.chain);
        });
  
        const players = Object.values(byPlayer).map(e => ({
          player: e.player,
          total: e.total,
          recent: e.recent,
          banned: e.recent >= 3,      
          lastFlaggedAt: e.lastFlaggedAt,
          reasons: e.reasons,
          chains: [...e.chains],
        })).sort((a, b) => b.recent - a.recent || b.total - a.total);
  
        return res.status(200).json({ players });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "POST" && action === "clear-flags") {
      if (!(await checkOnChainAdmin(user.address)))
        return res.status(403).json({ error: "Admin only" });
      const { player } = req.body;
      if (!player) return res.status(400).json({ error: "player required" });
      try {
        const target = String(player).toLowerCase();
        const snap = await db.collection("flagged").where("player", "==", target).get();
        if (snap.empty) return res.status(200).json({ success: true, cleared: 0 });
  
        const docs = snap.docs;
        let cleared = 0;
        for (let i = 0; i < docs.length; i += 450) {   
          const batch = db.batch();
          docs.slice(i, i + 450).forEach(d => batch.delete(d.ref));
          await batch.commit();
          cleared += Math.min(450, docs.length - i);
        }
        return res.status(200).json({ success: true, cleared });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "POST" && action === "clear-all-flags") {
      if (!(await checkOnChainAdmin(user.address)))
        return res.status(403).json({ error: "Admin only" });
      const { confirm } = req.body || {};
      if (confirm !== "CLEAR_ALL")
        return res.status(400).json({ error: "Confirmation required: send { confirm: 'CLEAR_ALL' }" });
      try {
        let totalCleared = 0;
        const BATCH_SIZE = 450;   
        const MAX_ROUNDS = 200;   
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const snap = await db.collection("flagged").limit(BATCH_SIZE).get();
          if (snap.empty) break;
          const batch = db.batch();
          snap.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();
          totalCleared += snap.docs.length;
          if (snap.docs.length < BATCH_SIZE) break; 
        }
        return res.status(200).json({ success: true, cleared: totalCleared });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "GET" && action === "admin-taskon-config") {
      const aUser = verifyToken(req);
      if (!aUser) return res.status(401).json({ error: "Unauthorized" });
      if (!(await checkOnChainAdmin(aUser.address)))
        return res.status(403).json({ error: "Admin only" });
      try {
        const snap = await db.collection("taskonConfig").get();
        const configs = {};
        snap.docs.forEach(d => {
          const x = d.data();
          configs[d.id] = {
            chain: d.id,
            enabled: !!x.enabled,
            questId: x.questId || "",
            campaignUrl: x.campaignUrl || "",
            updatedBy: x.updatedBy || null,
            updatedAt: x.updatedAt?.toDate?.()?.toISOString?.() || null,
            source: "firestore",
          };
        });
        const envFallback = {
          questId: process.env.TASKON_QUEST_ID || "",
          campaignUrl: process.env.VITE_TASKON_CAMPAIGN_URL || "",
          clientIdSet: !!process.env.TASKON_CLIENT_ID,
        };
        return res.status(200).json({ configs, envFallback });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }
  
    if (req.method === "POST" && action === "admin-taskon-config") {
      if (!(await checkOnChainAdmin(user.address)))
        return res.status(403).json({ error: "Admin only" });
      const { chain, enabled, questId, campaignUrl } = req.body || {};
      if (!chain || typeof chain !== "string")
        return res.status(400).json({ error: "chain required" });
      if (enabled && (!questId || !/^\d+$/.test(String(questId).trim())))
        return res.status(400).json({ error: "questId must be a numeric string when enabled" });
      if (enabled && (!campaignUrl || !/^https?:\/\//.test(campaignUrl)))
        return res.status(400).json({ error: "campaignUrl must be a valid https URL when enabled" });
      try {
        await db.collection("taskonConfig").doc(chain).set({
          chain,
          enabled: !!enabled,
          questId: (questId || "").toString().trim(),
          campaignUrl: (campaignUrl || "").toString().trim(),
          updatedBy: user.address.toLowerCase(),
          updatedAt: new Date(),
        }, { merge: true });
        bustTaskonCache(chain);
        return res.status(200).json({ success: true, chain });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    if (req.method === "POST" && action === "admin-faucet-withdraw") {
      if (!(await checkOnChainAdmin(user.address)))
        return res.status(403).json({ error: "Admin only" });
      const { to, amount } = req.body;   
      if (!to || !ethers.isAddress(to))
        return res.status(400).json({ error: "Valid 'to' address required" });
      if (amount == null || isNaN(Number(amount)) || Number(amount) <= 0)
        return res.status(400).json({ error: "Valid amount required" });
  
      const MAX_WITHDRAW_MSTC   = 500;   
      const DAILY_WITHDRAW_CAP  = 2000;  
      const amtNum = Number(amount);
      if (amtNum > MAX_WITHDRAW_MSTC)
        return res.status(400).json({ error: `Max ${MAX_WITHDRAW_MSTC} MSTC per call — split into multiple withdrawals` });
  
      const todayKey  = new Date().toISOString().split("T")[0];
      const dailyRef  = db.collection("adminAudit").doc(`faucetWithdraw_${todayKey}`);
      const dailySnap = await dailyRef.get();
      const usedToday = dailySnap.exists ? (dailySnap.data().totalMSTC || 0) : 0;
      if (usedToday + amtNum > DAILY_WITHDRAW_CAP)
        return res.status(400).json({ error: `Daily cap (${DAILY_WITHDRAW_CAP} MSTC) would be exceeded — used ${usedToday} today` });
  
      try {
        const rpcUrl     = process.env.MST_RPC_URL;
        const pk         = process.env.PRIVATE_KEY;
        const faucetAddr = process.env.MST_FAUCET_ADDRESS;
        if (!rpcUrl || !pk || !faucetAddr)
          return res.status(503).json({ error: "Faucet not configured" });
  
        const provider    = new ethers.JsonRpcProvider(rpcUrl);
        const ownerWallet = new ethers.Wallet(pk, provider);
        const faucetABI = [
          "function withdrawFunds(address payable to, uint256 amount) external",
          "function balance() view returns (uint256)",
          "function owner() view returns (address)",
        ];
        const faucet = new ethers.Contract(faucetAddr, faucetABI, ownerWallet);
  
        const owner = await faucet.owner();
        if (owner.toLowerCase() !== ownerWallet.address.toLowerCase())
          return res.status(500).json({ error: "Server key is not the faucet owner" });
  
        const amountWei = ethers.parseEther(String(amount));
        const bal = await faucet.balance();
        if (amountWei > bal)
          return res.status(400).json({ error: `Faucet balance too low (${ethers.formatEther(bal)} MSTC available)` });
  
        const tx = await faucet.withdrawFunds(to, amountWei, { gasLimit: 120000 });
        await tx.wait();
  
        try {
          await dailyRef.set({
            totalMSTC: usedToday + amtNum,
            lastAdmin: user.address.toLowerCase(),
            lastAmount: amtNum,
            lastTo: to.toLowerCase(),
            lastTxHash: tx.hash,
            lastAt: new Date(),
          }, { merge: true });
          await db.collection("adminAudit").add({
            kind: "faucetWithdraw",
            admin: user.address.toLowerCase(),
            amount: amtNum, to: to.toLowerCase(),
            txHash: tx.hash, at: new Date(),
          });
        } catch (auditErr) {
          console.error("[audit] faucetWithdraw log failed:", auditErr);
        }
  
        return res.status(200).json({ success: true, txHash: tx.hash, amount: String(amount), to, usedToday: usedToday + amtNum, dailyCap: DAILY_WITHDRAW_CAP });
      } catch (err) {
        return res.status(500).json({ error: err.shortMessage || err.message });
      }
    }

    if (req.method === "GET" && action === "admin-shop-list-all") {
      if (!(await checkOnChainAdmin(user.address)))
        return res.status(403).json({ error: "Admin only" });
  
      try {
        const snap  = await db.collection("battleShopItems").get();
        const items = [];
        snap.forEach(doc => {
          const d = doc.data();
          items.push({
            itemId:        doc.id,
            itemIdBytes32: d.itemIdBytes32 || ethers.keccak256(ethers.toUtf8Bytes(doc.id)),
            name:          d.name || "",
            description:   d.description || "",
            category:      d.category || "cosmetic",
            rarity:        d.rarity || "common",
            imageUrl:      d.imageUrl || "",
            priceARCADE:   d.priceARCADE || 0,
            priceUSDC:     d.priceUSDC || 0,
            chain:         d.chain || "*",
            active:        !!d.active,
            createdAt:     d.createdAt || null,
            updatedAt:     d.updatedAt || null,
          });
        });
        items.sort((a, b) => {
          const at = a.createdAt?.toMillis?.() || 0;
          const bt = b.createdAt?.toMillis?.() || 0;
          return bt - at;
        });
        return res.status(200).json({ items });
      } catch (err) {
        console.error("[admin-shop-list-all]", err);
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method === "POST" && action === "admin-shop-upsert") {
      if (!(await checkOnChainAdmin(user.address)))
        return res.status(403).json({ error: "Admin only" });
  
      const {
        itemId, name, description, category, rarity, imageUrl,
        priceARCADE, priceUSDC, chain, active,
      } = req.body;
  
      if (!itemId || !/^[a-z0-9_-]+$/.test(itemId))
        return res.status(400).json({ error: "itemId required — lowercase letters/digits/_/- only" });
      if (!name || typeof name !== "string" || !name.trim())
        return res.status(400).json({ error: "name required" });
      const validCat    = ["gun_skin", "environment", "power_up", "cosmetic"];
      const validRar    = ["common", "rare", "epic", "legendary"];
      const validChain  = ["*", "mst", "botchain"];
      if (!validCat.includes(category))
        return res.status(400).json({ error: `category must be one of ${validCat.join(", ")}` });
      if (!validRar.includes(rarity))
        return res.status(400).json({ error: `rarity must be one of ${validRar.join(", ")}` });
      if (!validChain.includes(chain))
        return res.status(400).json({ error: `chain must be one of ${validChain.join(", ")}` });
      const pA = Number(priceARCADE) || 0;
      const pU = Number(priceUSDC)   || 0;
      if (pA < 0 || pU < 0)
        return res.status(400).json({ error: "Prices cannot be negative" });
      if (!pA && !pU)
        return res.status(400).json({ error: "At least one price (ARCADE or USDC) must be > 0" });
  
      try {
        const docRef       = db.collection("battleShopItems").doc(itemId);
        const existingSnap = await docRef.get();
        const isNew        = !existingSnap.exists;
        const itemIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(itemId));
  
        const payload = {
          name:          name.trim(),
          description:   (description || "").trim(),
          category,
          rarity,
          imageUrl:      (imageUrl || "").trim(),
          priceARCADE:   pA,
          priceUSDC:     pU,
          chain,
          active:        active !== false,
          itemIdBytes32,
          updatedAt:     new Date(),
          updatedBy:     user.address.toLowerCase(),
        };
        if (isNew) {
          payload.createdAt = new Date();
          payload.createdBy = user.address.toLowerCase();
        }
  
        await docRef.set(payload, { merge: true });
  
        await db.collection("adminAudit").add({
          kind:     isNew ? "shopItemCreate" : "shopItemUpdate",
          admin:    user.address.toLowerCase(),
          itemId,
          payload:  { name: payload.name, category, rarity, chain, active: payload.active, priceARCADE: pA, priceUSDC: pU },
          at:       new Date(),
        }).catch(err => console.error("[audit] shopItemUpsert log failed:", err));
  
        return res.status(200).json({ ok: true, isNew, itemId, itemIdBytes32 });
      } catch (err) {
        console.error("[admin-shop-upsert]", err);
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method === "POST" && action === "admin-shop-delete") {
      if (!(await checkOnChainAdmin(user.address)))
        return res.status(403).json({ error: "Admin only" });
  
      const { itemId } = req.body;
      if (!itemId) return res.status(400).json({ error: "itemId required" });
  
      try {
        const docRef = db.collection("battleShopItems").doc(itemId);
        const snap   = await docRef.get();
        if (!snap.exists) return res.status(404).json({ error: "Item not found" });
  
        await docRef.delete();
  
        await db.collection("adminAudit").add({
          kind:   "shopItemDelete",
          admin:  user.address.toLowerCase(),
          itemId,
          at:     new Date(),
        }).catch(err => console.error("[audit] shopItemDelete log failed:", err));
  
        return res.status(200).json({ ok: true });
      } catch (err) {
        console.error("[admin-shop-delete]", err);
        return res.status(500).json({ error: err.message });
      }
    }

    return res.status(400).json({ error: "Invalid action" });
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
    if (channel === "announcements" && user.address !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
    if (!rateLimit(user.address, 5)) return res.status(429).json({ error: "Too many messages" });
    const db = getDb();
    try {
      const ref = await db.collection("community").doc(channel).collection("messages").add({
        text: text.trim(), address: user.address, avatarStyle: avatarStyle || "bottts",
        isAdmin: user.address === ADMIN_ADDR, createdAt: new Date(),
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
        await ref.set({ address: user.address, displayName: displayName || "", avatarStyle: avatarStyle || "bottts", txHash: txHash || "", status: "pending", gamesPublished: 0, totalEarned: 0, registeredAt: new Date(), joinedAt: new Date() });
      } else {
        await ref.update({ displayName: displayName || snap.data().displayName, updatedAt: new Date() });
      }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ══════════════════════════════════════
  // ADMIN (Auxiliary)
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
      const gameData = { gameId: data.gameId, name: data.name, creator: data.creator, iframeUrl: data.iframeUrl || "", rewardRate: data.rewardRate || 50 };
      const liveChains = CHAIN_LIST.filter(c => c.status === "live");
      if (liveChains.length === 0) return res.status(500).json({ error: "No live chains configured" });
      const results = await Promise.all(liveChains.map(chain => approveOnChain(chain, gameData)));
      const anySucceeded = results.some(r => r.status === "live" || r.status === "already_live");
      if (anySucceeded) await gameDoc.ref.update({ status: "approved", approvedAt: new Date() });
      return res.json({ success: anySucceeded, gameId, results });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/sync-creator-nft", async (req, res) => {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const { username, avatarColor, originChainKey, targetAddress } = req.body;
    if (!username || !avatarColor) return res.status(400).json({ error: "username and avatarColor required" });
    let creator = user.address;
    if (targetAddress) {
      if (user.address?.toLowerCase() !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
      creator = targetAddress;
    }
    try {
      const liveChains = CHAIN_LIST.filter(c => c.status === "live" && c.key !== originChainKey);
      if (liveChains.length === 0) return res.json({ success: true, results: [], message: "No other live chains to sync to" });
      const results = await Promise.all(liveChains.map(chain => syncCreatorOnChain(chain, creator, username, avatarColor)));
      return res.json({ success: true, results });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/creators", async (req, res) => {
    const user = verifyToken(req);
    if (!user || user.address !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
    const db = getDb();
    try {
      const snap = await db.collection("creators").orderBy("registeredAt", "desc").get();
      const creators = snap.docs.map(d => ({ address: d.id, ...d.data(), registeredAt: d.data().registeredAt?.toDate?.() || null, joinedAt: d.data().joinedAt?.toDate?.() || null }));
      res.json({ creators });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { return res.status(500).json({ error: err.message }); }
  });

  // ══════════════════════════════════════
  // BADGES
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
    let pioneer = false, legend = false;
    const snap = await db.collection("badgeLeaderboard").doc("snapshot").get();
    if (snap.exists) {
      const rankings = snap.data().rankings || [];
      const entry = rankings.find(r => r.wallet === wallet);
      if (entry) { if (entry.rank <= 500) pioneer = true; if (entry.rank <= 50) legend = true; }
    }
    const creatorSnap = await db.collection("games").where("creator", "==", wallet).get();
    const creator = creatorSnap.docs.some(d => { const cAt = d.data().createdAt?.toDate?.(); return cAt && cAt >= CAMPAIGN_START && cAt <= CAMPAIGN_END; });
    const creatorPlays = {};
    gamesSnap.docs.forEach(d => {
      const data = d.data();
      const cAt = data.createdAt?.toDate?.();
      if (!cAt || cAt < CAMPAIGN_START || cAt > CAMPAIGN_END || !data.creator) return;
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
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/badges/sign-claim", async (req, res) => {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const { badgeTypeId, chainId, contractAddress } = req.body;
    if (!badgeTypeId || !chainId || !contractAddress) return res.status(400).json({ error: "Missing required fields" });
    const BADGE_TYPE_KEYS = { 1: "genesis", 2: "pioneer", 3: "legend", 4: "creator", 5: "builder" };
    const badgeKey = BADGE_TYPE_KEYS[badgeTypeId];
    if (!badgeKey) return res.status(400).json({ error: "Invalid badgeTypeId" });
    try {
      const w = user.address.toLowerCase();
      const eligibility = await checkBadgeEligibility(getDb(), w);
      if (!eligibility[badgeKey]) return res.status(403).json({ error: `Not eligible for ${badgeKey} badge yet` });
      const messageHash = ethers.solidityPackedKeccak256(
        ["address", "uint256", "address", "uint256"],
        [w, badgeTypeId, contractAddress, Number(chainId)]
      );
      const signerWallet = new ethers.Wallet(process.env.BADGE_SIGNER_PRIVATE_KEY);
      const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));
      res.json({ signature });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ══════════════════════════════════════
  // SUPPORT
  // ══════════════════════════════════════
  app.post("/api/support", async (req, res) => {
    const { action } = req.query;
    const db = getDb();
    if (action === "ticket") {
      const { issueType, description, email, screenshotUrl, userAgent, wallet } = req.body;
      if (!issueType || !description?.trim()) return res.status(400).json({ error: "issueType and description required" });
      try {
        const ref = await db.collection("supportTickets").add({ issueType, description: description.trim(), email: email?.trim() || null, screenshotUrl: screenshotUrl || null, userAgent: userAgent || null, wallet: wallet ? wallet.toLowerCase() : null, status: "open", replies: [], createdAt: new Date() });
        return res.json({ success: true, ticketId: ref.id });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }
    if (action === "my-tickets") {
      const user = verifyToken(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      try {
        const snap = await db.collection("supportTickets").where("wallet", "==", user.address.toLowerCase()).get();
        const tickets = snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null }))
          .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        return res.json({ tickets });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }
    if (action === "list") {
      const user = verifyToken(req);
      if (!user || user.address !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
      try {
        const snap = await db.collection("supportTickets").orderBy("createdAt", "desc").get();
        return res.json({ tickets: snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null })) });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }
    return res.status(400).json({ error: "Invalid action" });
  });

  app.patch("/api/support", async (req, res) => {
    const { action } = req.query;
    const user = verifyToken(req);
    if (!user || user.address !== ADMIN_ADDR) return res.status(403).json({ error: "Admin only" });
    const db = getDb();
    if (action === "reply") {
      const { ticketId, replyText } = req.body;
      if (!ticketId || !replyText?.trim()) return res.status(400).json({ error: "ticketId and replyText required" });
      try {
        const ref = db.collection("supportTickets").doc(ticketId);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: "Ticket not found" });
        const replies = snap.data().replies || [];
        await ref.update({ replies: [...replies, { text: replyText.trim(), by: "admin", at: new Date().toISOString() }], status: "in-progress" });
        return res.json({ success: true });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }
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

  // ══════════════════════════════════════
  // VITE DEV SERVER
  // ══════════════════════════════════════
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
  app.listen(3000, () => {
    console.log("✅ ArcadeX Dev Server running at http://localhost:3000");
    console.log("   API: http://localhost:3000/api/*");
    console.log("   Frontend: http://localhost:3000");
  });
}
startServer().catch(console.error);