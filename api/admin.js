// api/admin.js
//
// Admin API — ek file, action-based dispatch. Pehle 5 alag files thi
// (admin/games.js, admin/creators.js, admin/deploy-multichain.js,
//  admin/sync-creator-nft.js, admin/sync-marketplace.js) — Vercel ke
// serverless function count cap (Hobby plan = 12) ko fit karne ke liye
// consolidate kiya. Routes query ?action= se decide hote hain.
//
// Actions:
//   GET  /api/admin?action=games                       → list all games
//   GET  /api/admin?action=games&status=pending        → filter by status
//   POST /api/admin?action=games-approve               { gameId }
//   POST /api/admin?action=games-reject                { gameId }
//   POST /api/admin?action=games-refresh-leaderboard   → badge leaderboard rebuild
//   GET  /api/admin?action=creators                    → creator list
//   POST /api/admin?action=deploy-multichain           { gameId }
//   POST /api/admin?action=sync-creator-nft            { username, avatarColor, originChainKey, targetAddress? }
//   POST /api/admin?action=sync-marketplace

import { ethers } from "ethers";
import jwt from "jsonwebtoken";
import admin from "firebase-admin";
import { CHAIN_LIST } from "../src/config/chains.js";

// ── CORS (fail-closed, same policy as games.js) ────────────────────
function cors(res) {
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed) res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  }
  return admin.firestore();
}

const ADMIN_ADDR = () => process.env.VITE_ADMIN_ADDRESS?.toLowerCase();

/** Admin-only JWT: must match VITE_ADMIN_ADDRESS. */
function verifyAdminToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
    if (decoded.address?.toLowerCase() !== ADMIN_ADDR()) return null;
    return decoded;
  } catch { return null; }
}

/** sync-creator-nft allows normal users to sync their OWN address;
 *  only admin can pass targetAddress for someone else. Returns the
 *  decoded token with an `isAdmin` flag so the handler can enforce that. */
function verifyAnyToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
    return { ...decoded, isAdmin: decoded.address?.toLowerCase() === ADMIN_ADDR() };
  } catch { return null; }
}

/** Per-chain admin key, falling back to the shared PRIVATE_KEY — e.g.
 *  "somnia" tries SOMNIA_ADMIN_PRIVATE_KEY first, then PRIVATE_KEY. */
function resolveAdminKey(chainKey) {
  const override = process.env[`${chainKey.toUpperCase()}_ADMIN_PRIVATE_KEY`];
  return override || process.env.PRIVATE_KEY || null;
}

// ── Badge leaderboard snapshot (used by games-refresh-leaderboard) ──
// • Only on-chain VERIFIED scores count (verified: true)
// • Players flagged 3+ times are dropped from the leaderboard
async function refreshBadgeLeaderboard(db) {
  const flaggedSnap = await db.collection("flagged").get();
  const flagCounts = {};
  flaggedSnap.docs.forEach(d => {
    const w = d.data().player?.toLowerCase();
    if (w) flagCounts[w] = (flagCounts[w] || 0) + 1;
  });
  const banned = new Set(
    Object.entries(flagCounts).filter(([, c]) => c >= 3).map(([w]) => w)
  );

  const scoresSnap = await db.collection("scores").where("verified", "==", true).get();
  const walletScores = {};
  scoresSnap.docs.forEach(d => {
    const data = d.data();
    const wallet = data.player?.toLowerCase();
    if (!wallet) return;
    if (banned.has(wallet)) return;
    walletScores[wallet] = (walletScores[wallet] || 0) + (data.score || 0);
  });

  const rankings = Object.entries(walletScores)
    .sort((a, b) => b[1] - a[1])
    .map(([wallet, totalScore], idx) => ({ wallet, totalScore, rank: idx + 1 }));

  await db.collection("badgeLeaderboard").doc("snapshot").set({
    rankings, updatedAt: new Date(),
    rankedCount: rankings.length, bannedCount: banned.size,
  });
  return rankings.length;
}

// ── Multi-chain game approval ──
const PLATFORM_ABI = [
  "function games(uint256) external view returns (uint256 gameId, string name, address creator, string iframeUrl, uint256 rewardRate, uint256 totalPlays, bool isActive)",
  "function approveGame(uint256 gameId) external",
  "function adminRegisterAndApprove(uint256 specificGameId, address creator, string name, string iframeUrl, uint256 rewardRate) external",
];

async function approveOnChain(chain, gameData) {
  const privateKey = resolveAdminKey(chain.key);
  if (!privateKey) {
    return { chain: chain.name, key: chain.key, status: "skipped", reason: "No admin key configured (set PRIVATE_KEY in .env)" };
  }
  if (!chain.contracts?.platform) {
    return { chain: chain.name, key: chain.key, status: "skipped", reason: "Platform contract address not deployed on this chain yet" };
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
        gameData.gameId, gameData.creator, gameData.name,
        gameData.iframeUrl || "", gameData.rewardRate || 50,
        { gasLimit: 3000000 }
      );
    }
    await tx.wait();
    return { chain: chain.name, key: chain.key, status: "live", txHash: tx.hash, mode: alreadyRegistered ? "approved" : "registered_and_approved" };
  } catch (err) {
    return { chain: chain.name, key: chain.key, status: "failed", reason: err.shortMessage || err.reason || err.message };
  }
}

// ── Creator NFT cross-chain sync ──
const CREATOR_NFT_ABI = [
  "function walletToToken(address) external view returns (uint256)",
  "function adminMintFor(address creator, string username, string avatarColor) external",
];

async function syncCreatorOnChain(chain, creator, username, avatarColor) {
  const privateKey = resolveAdminKey(chain.key);
  if (!privateKey) {
    return { chain: chain.name, key: chain.key, status: "skipped", reason: "No admin key configured (set PRIVATE_KEY in .env)" };
  }
  if (!chain.contracts?.creatorNft) {
    return { chain: chain.name, key: chain.key, status: "skipped", reason: "CreatorNFT not deployed on this chain yet" };
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

// ── Marketplace sync (avatar styles) ──
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

async function syncMarketplaceOnChain(chain) {
  const privateKey = resolveAdminKey(chain.key);
  if (!privateKey) {
    return { chain: chain.name, key: chain.key, status: "skipped", reason: "No admin key (set PRIVATE_KEY in .env)", added: 0 };
  }
  if (!chain.contracts?.marketplace) {
    return { chain: chain.name, key: chain.key, status: "skipped", reason: "Marketplace contract not deployed on this chain yet", added: 0 };
  }
  try {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const marketplace = new ethers.Contract(chain.contracts.marketplace, MARKETPLACE_ABI, wallet);

    const nextId = await marketplace.nextItemId();
    const existingCount = Number(nextId) - 1;
    const toAdd = AVATAR_STYLES.slice(existingCount);

    if (toAdd.length === 0) {
      return { chain: chain.name, key: chain.key, status: "already_synced", added: 0, total: existingCount };
    }
    const txHashes = [];
    for (const style of toAdd) {
      const tx = await marketplace.addItem(
        style.name, style.desc, "", SKIN,
        style.price, 0, style.supply, { gasLimit: 500000 }
      );
      await tx.wait();
      txHashes.push(tx.hash);
    }
    return { chain: chain.name, key: chain.key, status: "synced", added: toAdd.length, total: existingCount + toAdd.length, txHashes };
  } catch (err) {
    return { chain: chain.name, key: chain.key, status: "failed", reason: err.shortMessage || err.reason || err.message, added: 0 };
  }
}

// ════════════════════════════════════════════════════════════════════
// Handler
// ════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action } = req.query;
  if (!action) return res.status(400).json({ error: "action query param required" });

  const db = getDb();

  // ── GET games — list all games (optionally filtered by status) ──
  if (action === "games" && req.method === "GET") {
    const user = verifyAdminToken(req);
    if (!user) return res.status(403).json({ error: "Admin only" });
    try {
      const { status } = req.query;
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
      console.error("admin games GET error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST games-approve ──
  if (action === "games-approve" && req.method === "POST") {
    const user = verifyAdminToken(req);
    if (!user) return res.status(403).json({ error: "Admin only" });
    const { gameId } = req.body || {};
    if (!gameId) return res.status(400).json({ error: "gameId required" });
    try {
      await db.collection("games").doc(String(gameId)).update({
        status: "approved", approvedAt: new Date(),
      });
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST games-reject ──
  if (action === "games-reject" && req.method === "POST") {
    const user = verifyAdminToken(req);
    if (!user) return res.status(403).json({ error: "Admin only" });
    const { gameId } = req.body || {};
    if (!gameId) return res.status(400).json({ error: "gameId required" });
    try {
      await db.collection("games").doc(String(gameId)).update({
        status: "rejected", rejectedAt: new Date(),
      });
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST games-refresh-leaderboard ──
  if (action === "games-refresh-leaderboard" && req.method === "POST") {
    const user = verifyAdminToken(req);
    if (!user) return res.status(403).json({ error: "Admin only" });
    try {
      const rankedCount = await refreshBadgeLeaderboard(db);
      return res.status(200).json({ success: true, rankedCount });
    } catch (err) {
      console.error("refresh-leaderboard error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET creators ──
  if (action === "creators" && req.method === "GET") {
    const user = verifyAdminToken(req);
    if (!user) return res.status(401).json({ error: "Admin only" });
    try {
      const snap = await db.collection("creators").orderBy("registeredAt", "desc").get();
      const creators = snap.docs.map(d => ({
        address: d.id, ...d.data(),
        registeredAt: d.data().registeredAt?.toDate?.() || null,
        joinedAt:     d.data().joinedAt?.toDate?.()     || null,
      }));
      return res.status(200).json({ creators });
    } catch (err) {
      console.error("admin creators error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST deploy-multichain ──
  if (action === "deploy-multichain" && req.method === "POST") {
    const user = verifyAdminToken(req);
    if (!user) return res.status(401).json({ error: "Admin only" });
    const { gameId } = req.body || {};
    if (!gameId) return res.status(400).json({ error: "gameId required" });
    try {
      const gameDoc = await db.collection("games").doc(String(gameId)).get();
      if (!gameDoc.exists) return res.status(404).json({ error: "Game not found in database" });

      const data = gameDoc.data();
      const gameData = {
        gameId:     data.gameId,
        name:       data.name,
        creator:    data.creator,
        iframeUrl:  data.iframeUrl || "",
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
      return res.status(200).json({ success: anySucceeded, gameId, results });
    } catch (err) {
      console.error("deploy-multichain error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST sync-creator-nft (any logged-in user for self; admin for others) ──
  if (action === "sync-creator-nft" && req.method === "POST") {
    const user = verifyAnyToken(req);
    if (!user) return res.status(401).json({ error: "Unauthorized — connect wallet" });

    const { username, avatarColor, originChainKey, targetAddress } = req.body || {};
    if (!username || !avatarColor) {
      return res.status(400).json({ error: "username and avatarColor required" });
    }

    let creator = user.address;
    if (targetAddress) {
      if (!user.isAdmin) {
        return res.status(403).json({ error: "Only admin can sync on behalf of another address" });
      }
      creator = targetAddress;
    }

    try {
      const liveChains = CHAIN_LIST.filter(
        c => c.status === "live" && c.key !== originChainKey
      );
      if (liveChains.length === 0) {
        return res.status(200).json({ success: true, results: [], message: "No other live chains to sync to" });
      }
      const results = await Promise.all(
        liveChains.map(chain => syncCreatorOnChain(chain, creator, username, avatarColor))
      );
      return res.status(200).json({ success: true, results });
    } catch (err) {
      console.error("sync-creator-nft error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST sync-marketplace ──
  if (action === "sync-marketplace" && req.method === "POST") {
    const user = verifyAdminToken(req);
    if (!user) return res.status(403).json({ error: "Admin only" });
    try {
      const liveChains = CHAIN_LIST.filter(c => c.status === "live");
      if (liveChains.length === 0) return res.status(500).json({ error: "No live chains configured" });

      const results = await Promise.all(liveChains.map(chain => syncMarketplaceOnChain(chain)));
      const anySucceeded = results.some(r => r.status === "synced" || r.status === "already_synced");
      return res.status(200).json({ success: anySucceeded, results });
    } catch (err) {
      console.error("sync-marketplace error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET web2-analytics ──
  // Dashboard tiles for the Admin → Web2 tab. Scans web2Users + web2Scores
  // (bounded by period) and web2Transactions for a coins-distributed total.
  //   ?period=daily|weekly|monthly|all   default: weekly
  if (action === "web2-analytics" && req.method === "GET") {
    const user = verifyAdminToken(req);
    if (!user) return res.status(403).json({ error: "Admin only" });
    try {
      const period = (req.query.period || "weekly").toLowerCase();
      const windowDays = period === "daily" ? 1 : period === "monthly" ? 30 : period === "all" ? 3650 : 7;
      const since = new Date(Date.now() - windowDays * 86_400_000);

      // ── Users: lifetime totals + provider breakdown + top earners ──
      const usersSnap = await db.collection("web2Users").get();
      const providerBreakdown = { google: 0, twitter: 0, other: 0 };
      let totalCoinsLifetime = 0;
      const topEarners = [];
      usersSnap.docs.forEach(d => {
        const u = d.data();
        const prov = u.provider === "google" ? "google"
                   : u.provider === "twitter" ? "twitter" : "other";
        providerBreakdown[prov]++;
        totalCoinsLifetime += Number(u.totalArcadeCoins || 0);
        topEarners.push({
          uid: d.id,
          displayName: u.displayName || "Player",
          photoURL:    u.photoURL    || null,
          provider:    u.provider    || "unknown",
          totalArcadeCoins: Number(u.totalArcadeCoins || 0),
          totalPlays:       Number(u.totalPlays || 0),
          createdAt:        u.createdAt?.toDate?.()?.toISOString?.() || null,
        });
      });
      topEarners.sort((a, b) => b.totalArcadeCoins - a.totalArcadeCoins);

      // ── Submissions in window: scans web2Scores ──
      const scoresSnap = await db.collection("web2Scores")
        .where("createdAt", ">=", since).get();

      let submissionsInWindow = 0;
      let coinsInWindow = 0;
      const perDay = new Map();      // "YYYY-MM-DD" → submissions
      const perDayCoins = new Map(); // "YYYY-MM-DD" → coins awarded
      const perGame = new Map();     // gameId → { gameName, plays, coins }
      const activeUidsInWindow = new Set();

      scoresSnap.docs.forEach(d => {
        const s = d.data();
        submissionsInWindow++;
        const coins = Number(s.coinsEarned || 0);
        coinsInWindow += coins;
        if (s.uid) activeUidsInWindow.add(s.uid);

        const ts = s.createdAt?.toDate?.();
        if (ts) {
          const key = ts.toISOString().slice(0, 10);
          perDay.set(key, (perDay.get(key) || 0) + 1);
          perDayCoins.set(key, (perDayCoins.get(key) || 0) + coins);
        }

        const gid = s.gameId != null ? String(s.gameId) : "unknown";
        const g = perGame.get(gid) || { gameId: gid, gameName: s.gameName || "", plays: 0, coins: 0, uniquePlayers: new Set() };
        g.plays++;
        g.coins += coins;
        if (s.uid) g.uniquePlayers.add(s.uid);
        g.gameName = s.gameName || g.gameName;
        perGame.set(gid, g);
      });

      const daily = [...perDay.entries()]
        .map(([date, submissions]) => ({ date, submissions, coins: perDayCoins.get(date) || 0 }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const topGames = [...perGame.values()]
        .map(g => ({ gameId: g.gameId, gameName: g.gameName, plays: g.plays, coins: g.coins, uniquePlayers: g.uniquePlayers.size }))
        .sort((a, b) => b.plays - a.plays)
        .slice(0, 20);

      // ── Flagged count (quick peek — full list is a separate endpoint) ──
      let flaggedCount = 0;
      try {
        const fc = await db.collection("web2Flagged").count().get();
        flaggedCount = fc.data().count;
      } catch {
        const fs = await db.collection("web2Flagged").get();
        flaggedCount = fs.size;
      }

      return res.status(200).json({
        period,
        totals: {
          users:              usersSnap.size,
          activeUsersInWindow: activeUidsInWindow.size,
          submissionsInWindow,
          coinsInWindow,
          coinsLifetime:      totalCoinsLifetime,
          flaggedCount,
        },
        providerBreakdown,
        daily,
        topGames,
        topEarners: topEarners.slice(0, 50),
      });
    } catch (err) {
      console.error("[web2-analytics]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET web2-flagged-list ──
  // Latest anti-cheat flags for admin review. No action/approve flow yet —
  // this is a read-only queue (Phase 3 scope).
  if (action === "web2-flagged-list" && req.method === "GET") {
    const user = verifyAdminToken(req);
    if (!user) return res.status(403).json({ error: "Admin only" });
    try {
      const limit = Math.min(parseInt(req.query.limit) || 100, 500);
      const snap = await db.collection("web2Flagged")
        .orderBy("at", "desc").limit(limit).get();
      const rows = snap.docs.map(d => {
        const f = d.data();
        return {
          id:       d.id,
          uid:      f.uid,
          provider: f.provider,
          gameId:   f.gameId,
          score:    Number(f.score || 0),
          reason:   f.reason || "",
          at:       f.at?.toDate?.()?.toISOString?.() || null,
        };
      });
      return res.status(200).json({ flagged: rows });
    } catch (err) {
      console.error("[web2-flagged-list]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET web2-export-csv ──
  // Streams every web2Users row as CSV for offline analysis.
  if (action === "web2-export-csv" && req.method === "GET") {
    const user = verifyAdminToken(req);
    if (!user) return res.status(403).json({ error: "Admin only" });
    try {
      const snap = await db.collection("web2Users").orderBy("totalArcadeCoins", "desc").get();
      const header = ["uid","displayName","provider","email","totalArcadeCoins","totalPlays","createdAt","lastPlayed"];
      const esc = (v) => {
        if (v == null) return "";
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      };
      const lines = [header.join(",")];
      snap.docs.forEach(d => {
        const u = d.data();
        lines.push([
          d.id,
          u.displayName || "",
          u.provider || "",
          u.email || "",
          Number(u.totalArcadeCoins || 0),
          Number(u.totalPlays || 0),
          u.createdAt?.toDate?.()?.toISOString?.() || "",
          u.lastPlayed?.toDate?.()?.toISOString?.() || "",
        ].map(esc).join(","));
      });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="web2-users-${new Date().toISOString().slice(0,10)}.csv"`);
      return res.status(200).send(lines.join("\n"));
    } catch (err) {
      console.error("[web2-export-csv]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({
    error: "Unknown admin action",
    hint: "games | games-approve | games-reject | games-refresh-leaderboard | creators | deploy-multichain | sync-creator-nft | sync-marketplace | web2-analytics | web2-flagged-list | web2-export-csv",
  });
}
