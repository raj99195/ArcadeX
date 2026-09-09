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
// ── CORS ────────────────────────────────────────────────────────────
// FAIL-CLOSED: pehle "*" fallback tha. Vercel pe ALLOWED_ORIGIN accidentally
// unset ho jaaye toh koi bhi website APIs call kar sakti thi → JWT theft aur
// admin actions cross-origin trigger ho sakte the. Ab env missing → CORS
// header hi nahi lagta → browser same-origin ke alawa sab block karega.
function cors(res) {
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed) res.setHeader("Access-Control-Allow-Origin", allowed);
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
      // For Firebase Storage uploads (battle shop item images + 3D models).
      // Reads FIREBASE_STORAGE_BUCKET first, then falls back to the frontend
      // env VITE_FIREBASE_STORAGE_BUCKET (same value — no need to duplicate),
      // then a legacy default. Newer Firebase projects use .firebasestorage.app
      // instead of .appspot.com — both are valid depending on when the
      // bucket was created.
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET
        || process.env.VITE_FIREBASE_STORAGE_BUCKET
        || `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`,
    });
  }
  return admin.firestore();
}
const FV = admin.firestore.FieldValue;
const rateLimits = new Map();
// windowMs added as an optional 3rd arg — existing callers unchanged
// (default 60_000 = 1 min, matching old behaviour). Pass a bigger window
// for burst checks that shouldn't reset every minute (e.g. IP-based
// checks on auth-sensitive endpoints).
function rateLimit(key, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const calls = (rateLimits.get(key) || []).filter(t => t > now - windowMs);
  if (calls.length >= max) return false;
  rateLimits.set(key, [...calls, now]);
  return true;
}

// ── Client IP helper ────────────────────────────────────────────────
// Vercel proxies through Cloudflare's / Vercel's own edge — real client
// IP is in x-forwarded-for (first entry).
function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || null;
}

// ── Banned wallet check (Firestore) ─────────────────────────────────
// Wrapped so a Firestore hiccup NEVER blocks legit users — the ban
// system is best-effort defence in depth on top of Turnstile + on-chain
// cooldown. Doc path: bannedWallets/{lowercase-address}. Admin sets
// this via the admin-ban-wallet endpoint below.
async function isWalletBanned(dbRef, address) {
  if (!address) return false;
  try {
    const snap = await dbRef.collection("bannedWallets").doc(address.toLowerCase()).get();
    return snap.exists;
  } catch { return false; }
}

// ── TaskOn campaign completion check (PER-CHAIN) ─────────────────────
// One-time community task gate: user must complete a TaskOn quest
// (Twitter follow, Discord join, etc.) before they can claim rewards.
// This raises the per-wallet farming cost for attackers dramatically
// (each fresh wallet needs a Twitter account + manual task completion),
// with a clear, explicit UX for legit users.
//
// PER-CHAIN CONFIG: Firestore `taskonConfig/{chain}` doc controls
// enable/questId/campaignUrl for each chain independently. Admin panel
// (see admin-taskon-config-set) writes this. Env vars are fallback
// defaults only — Firestore takes priority when a doc exists.
//
// Firestore doc shape:
//   taskonConfig/{chain} = {
//     chain, enabled, questId, campaignUrl,
//     updatedBy, updatedAt
//   }
// If enabled=false or doc missing → gate is OPEN for that chain
// (fail-open: rewards still work, task not required).
//
// Env vars (fallback / bootstrap):
//   TASKON_CLIENT_ID       — TaskOn API credentials (SHARED across chains)
//   TASKON_CLIENT_SECRET   — TaskOn API credentials (SHARED across chains)
//   TASKON_QUEST_ID        — fallback questId if Firestore config missing
//   VITE_TASKON_CAMPAIGN_URL — fallback campaign URL
//
// Caching strategy (chain-scoped):
//   • Per-chain config cache — 60s TTL. Admin edits reflect within a
//     minute across all warm instances.
//   • Per-chain participant list — 10-min TTL.
//   • Per-user cache — Map key `${chain}:${wallet}`; once confirmed,
//     never re-checked for that chain.
//
// If TASKON_CLIENT_ID/SECRET are unset → API can't work at all, gate
// stays disabled everywhere (log-only warning, no user impact).
const _taskonConfigCache = new Map();  // key: chain, val: { at, cfg | null }
const _taskonListCache   = new Map();  // key: chain, val: { at, wallets: Set }
const _taskonUserCache   = new Map();  // key: `${chain}:${wallet}`, val: { at }
const TASKON_CFG_TTL     =  60 * 1000; // 1 min — admin edits propagate fast
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
  // NO env-var fallback here — the per-chain design means a chain without
  // an explicit Firestore config must be treated as DISABLED. Otherwise
  // the env-var TASKON_QUEST_ID (which is one specific chain's quest)
  // would incorrectly gate every other chain too, blocking users on
  // chains where admin never enabled TaskOn. Admin enables per chain via
  // the admin panel (writes taskonConfig/{chain}); no doc = fail-open.
  _taskonConfigCache.set(chain, { at: now, cfg });
  return cfg;
}

// Cache bust helper — admin-taskon-config-set calls this after writing
// so the next check-taskon reflects the new value immediately (no wait
// for 60s TTL).
function bustTaskonCache(chain) {
  if (chain) {
    _taskonConfigCache.delete(chain);
    _taskonListCache.delete(chain);
    // Also drop per-user cache for this chain
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
  const MAX_PAGES = 50; // 5000-participant safety cap

  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await fetch("https://api.taskon.xyz/v1/exportQuestData", {
      method: "POST",
      headers: {
        "Content-Type":            "application/json",
        "X-Taskon-Client-Id":      clientId,
        "X-Taskon-Client-Secret":  clientSecret,
      },
      // ref_id MUST be a Number, not a String. TaskOn API returns 200 OK
      // with empty results if sent as a string — silent failure that makes
      // check-taskon report "not completed" for every wallet. Env vars are
      // always strings so explicit Number() cast is required.
      body: JSON.stringify({ scene: "CampaignDataParticipant", ref_id: Number(questId), offset, limit }),
    });
    if (!r.ok) throw new Error(`TaskOn API ${r.status}`);
    const data = await r.json();

    // TaskOn response shape isn't strictly typed on their end. Walk the
    // whole tree and collect anything that looks like an EVM address.
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

    // Page had fewer new items than the limit → last page reached
    if (wallets.size - before < limit) break;
    offset += limit;
  }
  return wallets;
}

// Returns:
//   { enabled: false, completed: true }  → gate is off for this chain (fail-open)
//   { enabled: true, completed: bool, cfg } → checked against real config
async function checkTaskonForChain(dbRef, address, chain) {
  if (!address || !chain) return { enabled: false, completed: true };
  const cfg = await getTaskonConfig(dbRef, chain);
  if (!cfg || !cfg.enabled || !cfg.questId) {
    return { enabled: false, completed: true, cfg };
  }

  const userKey = `${chain}:${address.toLowerCase()}`;
  // Once-confirmed users skip the whole fetch — completion is monotonic
  if (_taskonUserCache.has(userKey)) {
    return { enabled: true, completed: true, cfg };
  }

  const now = Date.now();
  const chainList = _taskonListCache.get(chain) || { at: 0, wallets: new Set() };
  if (now - chainList.at > TASKON_LIST_TTL) {
    // Refresh the participant list. If refresh throws, KEEP the old
    // cache (fail-open on transient TaskOn errors) and let the caller
    // check membership against the last known set.
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
    // Bound the per-user cache — clear all if grows too large
    if (_taskonUserCache.size > 50_000) _taskonUserCache.clear();
  }
  return { enabled: true, completed: found, cfg };
}

// SH0030 — check-gas-claim in-memory cache (5-min TTL per address). MST
// faucet's hasClaimed() is monotonic (false→true, never reverts), so caching
// is safe. Bounded to 5000 entries — beyond that, oldest 500 evicted. Per
// warm serverless instance; cold starts fetch fresh from RPC.
const checkClaimCache = new Map();

// ── Score Signer Config ───────────────────────────────────────────────────────
const PLATFORM_ADDRESSES = {
  botchain: "0x2Ca0C74C1ee7e65e5f96c469cef840B62Ba6cFB4",
  mst:      "0xd9181c86f9E1D5825E47ED80Ae9E76B4dF18c0B8",
};
// Tournament contracts (SH0018 signature-verified). From deployedAddresses.json.
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
// Minimal ABI — sirf PlayRecorded event parse karne ke liye
const PLATFORM_EVENT_ABI = [
  "event PlayRecorded(address indexed player, uint256 indexed gameId, uint256 playerReward, uint256 creatorReward)",
];
// ── Battle Arena addresses (env-driven for prod/staging flexibility) ────────
const BATTLE_ARENA_ADDRESSES = {
  botchain: process.env.BATTLE_ARENA_ADDRESS_BOTCHAIN,
  mst:      process.env.BATTLE_ARENA_ADDRESS_MST,
};

// ── Battle Shop addresses + payment token config ────────────────────────────
// Env-driven. Each chain has its own BattleShop deployment. Payment tokens
// (ARCADE / USDC) also per chain — ARCADE is per-chain, USDC only where a
// bridged/native USDC exists on that chain.
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
// Human-readable prices in Firestore are multiplied by 10^decimals to get
// on-chain amounts. Standard values — override via env if a chain uses a
// non-standard USDC decimals.
const BATTLE_SHOP_TOKEN_DECIMALS = {
  ARCADE: Number(process.env.BATTLE_SHOP_DECIMALS_ARCADE) || 18,
  USDC:   Number(process.env.BATTLE_SHOP_DECIMALS_USDC)   || 6,
};
// ── Module-scope admin gate ────────────────────────────────────────────────
// Verifies ADMIN_ROLE / DEFAULT_ADMIN_ROLE on ANY configured Platform contract,
// plus the legacy super-admin (VITE_ADMIN_ADDRESS). Mirrors the inline gate used
// by admin-update-reward so every admin action agrees on who counts as admin.
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
    } catch (_) { /* RPC hiccup — try next chain */ }
  }
  return false;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  const { action } = req.query;
  const db = getDb();

  // ── GET stats (public) ──
  // SH0030/SH0035 — cost-explosion fix + comments split-out.
  //
  // Pehle: har call mein plays/likes + PLAYERS SUBCOLLECTION + COMMENTS (50 docs)
  //  fetch hote the sirf game details show karne ke liye. 300 users × 20
  //  games viewed = 6000 stats calls/day, each fetching 50 comments =
  //  300K comment reads/day.
  //
  // Ab: stats endpoint sirf scalar fields return karta hai (1 doc read).
  //  Comments alag endpoint (`action=comments`) pe lazy-load hote hain
  //  jab user actually comments section pe scroll kare (or opens the game
  //  page since GamePlay.jsx auto-loads). ~30% users comments dekhte hain,
  //  matlab 70% traffic ka comment-fetch cost saved.
  //
  //  Cache: 3 min — plays/likes/uniquePlayers rarely change per-second;
  //  users notice nahi karte 2-3 min stale count.
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
        // Comments field intentionally omitted — use action=comments to fetch.
        // Backward-compat: return empty array so old frontend code doesn't crash.
        comments: [],
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── GET comments (public — split out from stats) ──
  // SH0035 — dedicated endpoint for comments. Called separately by frontend
  // so game detail page loads faster and 70% users who don't view comments
  // never trigger this fetch.
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

  // ── GET list (public — approved games) ──
  // SH0030/SH0035 — Edge cache upgrade. Games list rarely changes hourly
  // (approved games ek din mein 1-3 baar hi update hote hain). Aggressive
  // 5-min cache = 5x fewer origin hits vs 60-sec cache. Admin actions
  // (approve/reject) cache invalidate karne ke liye "Purge Cache" button
  // banaya hai Admin panels mein. User-initiated changes cache-bust
  // sessionStorage clear se handle hote hain.
  if (req.method === "GET" && action === "list") {
    try {
      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
      const snap = await db.collection("games").where("status", "==", "approved").get();
      const games = snap.docs.map(d => ({ id: d.data().gameId, ...d.data() }));
      return res.status(200).json({ games });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── GET sitemap.xml (SEO) ─────────────────────────────────────────────────
  // Served at /sitemap.xml via a vercel.json rewrite. Auto-lists every approved
  // game page + static routes so Google discovers the whole catalogue — no
  // separate serverless function (12-function limit), always fresh.
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

  // ── GET creator-games ──
  // SH0030 — pehle POORI games collection read hoti thi (`.get()` without
  // filter) aur client-side `.filter()` se creator match hota tha. Matlab
  // 500 games hain aur creator ke 3 hain — reads 500, useful 3.
  // Ab server-side where("creator", "==", addr) — sirf 3 reads.
  //
  // Firestore mein `creator` field pe automatic single-field index hota hai,
  // so no manual index setup needed. Address JWT se lowercase aata hai, aur
  // save-game bhi lowercase mein store karta hai, so query direct match kare.
  if (req.method === "GET" && action === "creator-games") {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    try {
      const lowerAddress = user.address.toLowerCase();
      // Server-side filter — Firestore reads only matching docs
      const snap = await db.collection("games").where("creator", "==", lowerAddress).get();
      const games = snap.docs
        .map(d => ({ id: d.data().gameId || d.id, ...d.data() }))
        .sort((a, b) => (b.gameId || 0) - (a.gameId || 0));
      return res.status(200).json({ games });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── GET check-gas-claim (public) ──
  // Public → koi bhi random address bhej ke MST RPC hammer kar sakta hai
  // (RPC quota drain + Vercel function budget). IP-scoped rate limit.
  //
  // SH0030 — 5-minute in-memory cache added. Navbar mount pe hit hota hai;
  // hasClaimed status once claimed never changes back to false. Cache
  // hit → skip RPC entirely. Reduces MST RPC calls from 12K/day to
  // ~500-1000/day (24x reduction). In-memory = per-instance, but per-warm-
  // instance ka bhi savings massive hai. Once-per-address hits at cold
  // start; subsequent hits are cache-served for 5 min.
  if (req.method === "GET" && action === "check-gas-claim") {
    const cgcIp = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
    if (!rateLimit(`check-claim:${cgcIp}`, 20))
      return res.status(429).json({ error: "Too many requests" });
    const { address: claimAddr } = req.query;
    if (!claimAddr || !ethers.isAddress(claimAddr))
      return res.status(400).json({ error: "Valid address required" });

    // Cache lookup — hasClaimed = true never reverts, so 5-min cache is
    // safe for both true and false values. If false and user claims soon
    // after, cache miss on next lookup after 5 min will pick up the change.
    const addrLc = claimAddr.toLowerCase();
    const cached = checkClaimCache.get(addrLc);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
      // Also set browser cache to prevent Navbar re-fires within the same session
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
      // Save to cache
      checkClaimCache.set(addrLc, { value: claimed, at: Date.now() });
      // Bound cache size — prevent memory bloat over long-running instance
      if (checkClaimCache.size > 5000) {
        // Delete oldest 500 entries
        const entries = [...checkClaimCache.entries()].sort((a, b) => a[1].at - b[1].at);
        entries.slice(0, 500).forEach(([k]) => checkClaimCache.delete(k));
      }
      res.setHeader("Cache-Control", "private, max-age=60");
      return res.status(200).json({ claimed });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── GET scores (public) ──
  // SH0030 — THIS WAS THE MAIN BILL KILLER. Pehle FULL scores collection
  // read hoti thi har call pe (100K+ docs = 100K+ reads per call). getScores
  // called from Leaderboard, Navbar earnings panel, gameService, various
  // hooks — total ~500-1000 calls/day × 100K docs = **50M-100M reads/day**.
  // Ye Firebase bill ka 90%+ tha.
  //
  // Fix:
  //   • Hard limit 500 (recent scores only) — leaderboard aur latest activity
  //     ke liye kaafi. Historical scores per-user profile pe alag endpoint
  //     se aayenge (user-scores).
  //   • orderBy createdAt desc — sabse recent pehle, deterministic
  //   • Edge cache 30 sec — same query result 30-sec tak CDN se serve
  //   • Optional gameId + chain filters — server-side, saves reads
  //
  // SH0031 — Firestore composite-index fallback. `.where() + .orderBy()`
  // combo ke liye composite index chahiye (chain+createdAt, gameId+createdAt,
  // etc.). Deploy ke turant baad index nahi hoti → query fail → frontend
  // empty state. Try-catch se fallback: index missing ho toh sirf `.where()`
  // + JS-side sort. Slower + slightly more reads, but keeps the endpoint
  // functional while indexes build in background (5-10 min after creation).
  if (req.method === "GET" && action === "scores") {
    try {
      // Edge/CDN cache — safe because response is same for all users.
      // SH0035 — bumped 30s → 120s. Leaderboard/scoreboard rarely needs
      // second-level freshness. User's own score post-submit ka cache-bust
      // frontend handle karta hai (sessionStorage.removeItem).
      res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=300");

      const { chain, gameId, limit: limitStr, from, to } = req.query;

      // SH0032 — split cap: anonymous users get 500 (public leaderboard/casual
      // reads); authenticated users get up to 10000 (admin analytics dashboards,
      // creator earnings, etc.). Pehle hard cap 500 tha for everyone — Admin
      // panel ka Player Activity tab galat data dikhata tha (500 se zyada
      // plays wale platform pe sirf 500 clipped total mila, matlab payout /
      // active players sab under-counted). JWT presence = trust signal;
      // anonymous scrapers still capped, admins get real numbers.
      const scUser = verifyToken(req);
      const requestedLim = parseInt(limitStr) || 500;
      const lim = scUser
        ? Math.min(requestedLim, 10000)   // authenticated (admin/creator)
        : Math.min(requestedLim, 500);    // anonymous (public leaderboard)

      let ref = db.collection("scores");
      if (chain)  ref = ref.where("chain",  "==", chain);
      if (gameId) ref = ref.where("gameId", "==", parseInt(gameId));

      // SH0033 — date range filter for admin Player Activity dashboards.
      // MST team ka feature request: "date to date" custom range.
      // Firestore: equality-on-many-fields + range-on-ONE-field allowed —
      // chain equality + createdAt range works within same composite index.
      // Fallback (JS filter) covers missing-index case.
      const fromDate = from ? new Date(from) : null;
      const toDate   = to   ? new Date(to)   : null;
      // Include full "to" day (end-of-day) — user picks 2026-08-22, matlab
      // us din 23:59:59 tak ke scores include ho
      if (toDate && !isNaN(toDate)) toDate.setHours(23, 59, 59, 999);

      let scores = [];
      try {
        // Preferred — needs composite index (chain+createdAt, gameId+createdAt)
        let q = ref.orderBy("createdAt", "desc");
        if (fromDate && !isNaN(fromDate)) q = q.where("createdAt", ">=", fromDate);
        if (toDate   && !isNaN(toDate))   q = q.where("createdAt", "<=", toDate);
        const snap = await q.limit(lim).get();
        scores = snap.docs.map(d => ({
          id: d.id, ...d.data(),
          createdAt: d.data().createdAt?.toDate?.() || null,
        }));
      } catch (indexErr) {
        // Firestore code 9 = FAILED_PRECONDITION (index missing / building)
        console.warn("[scores] orderBy fallback:", indexErr.code, indexErr.message);
        const snap = await ref.limit(lim).get();
        scores = snap.docs
          .map(d => ({
            id: d.id, ...d.data(),
            createdAt: d.data().createdAt?.toDate?.() || null,
          }))
          // JS-side date filter — same semantics as Firestore range query
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

  // ── GET user-scores (JWT — user's own scores across all games) ──
  // SH0030 — new endpoint. Navbar earnings panel pehle full scores collection
  // fetch karke client-side filter karta tha (user's wallet ka match). Ab
  // server-side where("player", "==", wallet) — reads sirf user ke scores.
  //
  // SH0031 — same composite-index fallback as scores endpoint (player + createdAt)
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

  // ── POST record-time (SH0008: JWT required) ──
  if (req.method === "POST" && action === "record-time") {
    const rtUser = verifyToken(req);
    if (!rtUser) return res.status(401).json({ error: "Unauthorized" });
    const { gameId, seconds, timestamp, chainId } = req.body;
    if (!gameId || seconds == null) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    // SH0025 — input caps. Pehle koi bhi authenticated user Number.MAX_VALUE
    // seconds / nested-object value / random gameIds bhej ke Firestore mein
    // 60/min × warm-instances writes bha sakta tha. Storage cost DoS.
    // gameId must be a positive number, seconds capped to 24h.
    const gidNum = Number(gameId);
    if (!Number.isFinite(gidNum) || gidNum < 0 || gidNum > 1e9)
      return res.status(400).json({ error: "Invalid gameId" });
    const secNum = Number(seconds);
    if (!Number.isFinite(secNum) || secNum < 0 || secNum > 86400)
      return res.status(400).json({ error: "Invalid seconds (0-86400)" });
    // player JWT token se lo — client-supplied player address trust mat karo
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

  // ── POST record-event (SH0008: JWT required) ──
  if (req.method === "POST" && action === "record-event") {
    const reUser = verifyToken(req);
    if (!reUser) return res.status(401).json({ error: "Unauthorized" });
    const { gameId, eventType, value, timestamp, chainId } = req.body;
    if (!gameId || !eventType) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    // SH0025 — input caps (see record-time comment). eventType allowlisted,
    // value serialized-length capped so nested-object attacks can't bloat
    // Firestore. gameId format validated. Add new event types to the set
    // as your SDK / games expand — anything else is rejected.
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
    // value can be number/string/small object — serialize and cap.
    let valueClean = null;
    if (value != null) {
      try {
        const valStr = JSON.stringify(value);
        if (valStr.length > 500) return res.status(400).json({ error: "value too large" });
        valueClean = value;
      } catch { return res.status(400).json({ error: "Invalid value (must be JSON-serializable)" }); }
    }
    // player JWT token se lo — client-supplied player address trust mat karo
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

  // ── POST claim-gas (SH0017: JWT + X-account required) ────────────────────
  // Pehle koi bhi wallet address bhej ke claim kar sakta tha — attacker unlimited
  // fresh wallets bana ke faucet drain kar sakta tha. Ab do gates:
  //   1. JWT (wallet ownership) — claim JWT ke address ke liye hi
  //   2. X/Twitter account (Firebase) — one claim per X account
  // Fresh wallets free hain, lekin fresh X accounts mass-generate karna mushkil
  // (phone verify, rate limits) — isliye farming impractical.
  if (req.method === "POST" && action === "claim-gas") {
    const gasUser = verifyToken(req);
    if (!gasUser) return res.status(401).json({ error: "Unauthorized — connect wallet first" });

    // ── X/Twitter account verification (Firebase ID token) ──
    // Frontend Firebase X login karke idToken bhejta hai (body.firebaseToken).
    const { firebaseToken } = req.body;
    if (!firebaseToken)
      return res.status(403).json({ error: "X login required to claim gas" });

    let xUid, xProvider;
    try {
      const decoded = await admin.auth().verifyIdToken(firebaseToken);
      xUid      = decoded.uid;
      xProvider = decoded.firebase?.sign_in_provider || "";
      // Sirf Twitter/X login accept karo (Google se bypass na ho)
      if (!xProvider.includes("twitter"))
        return res.status(403).json({ error: "Must login with X (Twitter) to claim gas" });
    } catch (e) {
      return res.status(403).json({ error: "Invalid or expired X login. Please login again." });
    }

    // claimAddress body se nahi — JWT se (koi doosre ka wallet claim nahi kar sakta)
    const claimAddress = gasUser.address;

    // ── One claim per X account ──
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
      // X account ko record karo — ab ye X account dubara claim nahi kar sakta
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
      // SH0026 — sanity cap. Firestore mein galat / tampered price (creator
      // misconfig, admin typo) frontend tak pahunch ke priceWei = price * 1e18
      // banata hai. Bina cap ke user ki wallet drain ho sakti hai agar wo
      // approve dabaye. Ye ceiling business-logic ke hisaab se adjust karo.
      const MAX_ITEM_PRICE = 10000; // whole tokens (ARCADE or MSTC)
      const pnum = Number(price);
      if (!Number.isFinite(pnum) || pnum < 0 || pnum > MAX_ITEM_PRICE)
        return res.status(500).json({ error: "Item price out of allowed range" });
      return res.status(200).json({ canonicalPrice: pnum, approved: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST start-session (SH0009: JWT required) ────────────────────────────────
  // Game open hone pe GamePlay.jsx call karta hai.
  // Ek one-time sessionToken generate hota hai — sign-score tabhi milega jab yeh token ho.
  //
  // sessionToken ko document ID ke roop mein use karte hain (`.doc(token).set()`)
  // instead of `.add({sessionToken, ...})`. Reason:
  //   .where("sessionToken","==",token) query indexes use karta hai — index
  //   update mein 50-500ms lag sakta hai after a write. Old flow me issue
  //   nahi tha kyunki user 30s+ khelta tha before submitting. But new inline
  //   submitScore flow (user rejects auto-auth, later signs & submits) creates
  //   the session and IMMEDIATELY calls sign-score ~100ms later — index abhi
  //   update nahi hua hota → query returns empty → 403 "Invalid or expired
  //   session". Single-doc .doc(id).get() lookups are ALWAYS strongly
  //   consistent — no index dependency, no race.
  // ── GET check-taskon (JWT required) ─────────────────────────────────
  // Frontend calls this BEFORE opening the sign-score flow. If the wallet
  // hasn't completed the TaskOn campaign yet, the frontend shows a panel
  // with an "Open Task" button — user completes off-site and returns.
  //
  // Chain-scoped: pass ?chain=mst / ?chain=botchain. Each chain has its
  // own Firestore taskonConfig doc (admin-managed) with its own quest ID.
  // If a chain's config is missing or `enabled: false`, the endpoint
  // returns `{ completed: true, taskonEnabled: false }` and the frontend
  // proceeds normally (feature disabled for that chain).
  if (req.method === "GET" && action === "check-taskon") {
    const tUser = verifyToken(req);
    if (!tUser) return res.status(401).json({ error: "Unauthorized" });

    const chain = req.query.chain;
    if (!chain) {
      // Backward-compat: no chain param → treat as disabled to avoid
      // accidentally blocking clients that haven't updated yet.
      return res.status(200).json({
        completed: true, taskonEnabled: false,
        note: "chain query param required to enforce TaskOn",
      });
    }

    // TaskOn API creds are shared across chains — if unset globally,
    // nothing can be enforced anywhere.
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
      // Fail-open: TaskOn outage shouldn't block legit users
      return res.status(200).json({ completed: true, taskonEnabled: false, degraded: true });
    }
  }

  if (req.method === "POST" && action === "start-session") {
    const ssUser = verifyToken(req);
    if (!ssUser) return res.status(401).json({ error: "Unauthorized" });

    // ── Defence-in-depth checks (added after the drain incident) ──
    // 1. Banned wallets can't refresh session even if their old JWT is
    //    still valid — instant kill of an active abuser.
    // 2. Per-IP burst limit — attacker rotating wallets stays on ONE IP
    //    (or a small pool); this catches them where per-wallet checks
    //    can't. Legit user needs at most ~5 session starts/min.
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
        sessionToken,                       // keep field too for backward compat / debug
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

  // ── POST sign-score (SH0009: JWT + sessionToken required) ───────────────────
  // Bina valid gameplay session ke sign nahi milega — no fallback.
  if (req.method === "POST" && action === "sign-score") {
    const signUser = verifyToken(req);
    if (!signUser) return res.status(401).json({ error: "Unauthorized" });

    const { gameId, score, chain, sessionToken } = req.body;
    if (!gameId || score == null || !chain || !sessionToken)
      return res.status(400).json({ error: "gameId, score, chain, sessionToken required" });

    // ── LAYER 3 — soft-ban: DISABLED (flags are admin-review-only now) ──
    // Auto-banning on accumulated flags was blocking legitimate high-scorers with
    // "Account under review" and hurting growth — especially while the rate metric
    // is unreliable (playSec is measured from page-open, not actual gameplay).
    // Suspicious submissions are still written to `flagged` for review in the Admin
    // panel, where a genuine cheater can be actioned manually. A single impossibly-
    // high submission is still hard-blocked by GATE 2 below. No user is auto-banned.
    //
    // const FLAG_WINDOW_MS     = 24 * 60 * 60 * 1000;
    // const FLAG_BAN_THRESHOLD = 3;
    // const recentFlags = (await db.collection("flagged")
    //   .where("player", "==", signUser.address.toLowerCase())
    //   .limit(10).get())
    //   .docs.filter(d => {
    //     const t = d.data().flaggedAt?.toDate?.() || new Date(d.data().flaggedAt);
    //     return t.getTime() > Date.now() - FLAG_WINDOW_MS;
    //   }).length;
    // if (recentFlags >= FLAG_BAN_THRESHOLD)
    //   return res.status(403).json({ error: "Account under review due to suspicious activity." });

    const pk = process.env.SCORE_SIGNER_PRIVATE_KEY;
    if (!pk) return res.status(503).json({ error: "Score signing not configured" });

    const platformAddr = PLATFORM_ADDRESSES[chain];
    const chainId      = CHAIN_IDS[chain];
    if (!platformAddr || !chainId)
      return res.status(400).json({ error: `Unknown chain: ${chain}` });

    // ── Defence-in-depth checks (added after the drain incident) ──
    // Banned wallet — instant kill even if the attacker's old JWT is still
    // valid (JWTs live 24h, and revoking them centrally is expensive).
    if (await isWalletBanned(db, signUser.address))
      return res.status(403).json({ error: "This wallet has been suspended." });

    // Per-IP burst — catches attacker rotating wallets from same IP,
    // which per-wallet limits never see.
    const signIp = getClientIp(req);
    if (!rateLimit(`sign-ip:${signIp}`, 60, 60_000))
      return res.status(429).json({ error: "Too many sign requests from this IP." });

    // Probation-aware per-wallet limit: 30/min for trusted users, 5/min
    // for probation JWTs (issued when auth flagged this wallet as
    // suspicious — bot UA, fresh wallet, IP burst, etc). Legit users on
    // probation still get more than they'd ever use in a minute.
    const signRateMax = signUser.probation ? 5 : 30;
    if (!rateLimit(`sign:${signUser.address.toLowerCase()}:${gameId}`, signRateMax))
      return res.status(429).json({ error: "Too many sign requests" });

    // ── TaskOn campaign gate (PER-CHAIN) ──
    // Defence-in-depth: even if the frontend somehow skips its own
    // check-taskon step, the backend refuses to sign a score for a wallet
    // that hasn't completed the campaign FOR THIS CHAIN. Each chain has
    // its own Firestore taskonConfig (admin-managed). Fail-open on API
    // errors so a TaskOn outage doesn't block payouts.
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
        // Fail-open on TaskOn infra hiccups — logged only
        console.warn("[sign-score] TaskOn check failed, allowing:", err.message);
      }
    }

    try {
      // Session validate via strongly-consistent doc lookup (no index lag,
      // no race with a just-created session). Fields are validated in-memory
      // after the fetch — same semantics as the old .where() chain.
      const sessDocRef  = db.collection("gameSessions").doc(sessionToken);
      const sessDocSnap = await sessDocRef.get();

      if (!sessDocSnap.exists)
        return res.status(403).json({ error: "Invalid or expired session. Open the game page and play first." });

      const sessData = sessDocSnap.data();

      // Session must belong to the same wallet as the JWT (defence-in-depth:
      // even if someone leaks a sessionToken UUID, they can't spend it from a
      // different wallet — every field is checked, no shortcut).
      if (sessData.player !== signUser.address.toLowerCase())
        return res.status(403).json({ error: "Invalid or expired session. Open the game page and play first." });

      if (sessData.gameId !== String(gameId))
        return res.status(403).json({ error: "Invalid or expired session. Open the game page and play first." });

      // NOTE: session ka `used` field kabhi true set nahi hota (dekho line ~565
      // ka intentional "not burned" comment). Anti-replay guarantee ON-CHAIN
      // se aati hai — nonce = keccak256("sess:" + sessionToken) deterministic
      // hai, aur contract ka usedScoreProofs[nonce] mapping same nonce ko
      // dobara accept nahi karta. Isliye yahan `used` check remove kar diya
      // — dead code tha aur mental model confuse karta tha ("one-time use"
      // kehna galat lagta jab actually rely kar rahe hain contract pe).

      const expiresAt = sessData.expiresAt?.toDate?.() || new Date(sessData.expiresAt);
      if (expiresAt < new Date())
        return res.status(403).json({ error: "Session expired. Reload the game page." });

      if (sessData.chain !== chain)
        return res.status(403).json({ error: "Session chain mismatch." });

      // Shim so the rest of this handler (which reads sessDoc.data()) keeps
      // working unchanged — sessDoc has the same shape as the old query result.
      const sessDoc = sessDocSnap;

      // ═══════════════════════════════════════════════════════════════════════
      // LAYER 1 — Server-authoritative score validation (anti-cheat gates)
      // sign-score ab generic oracle nahi — score pe "sochta" hai before signing.
      // ═══════════════════════════════════════════════════════════════════════
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

      // GATE 0 — malformed score (negative / NaN / non-finite).
      // Almost always a UI glitch, not cheating → soft reject, NO flag.
      if (!Number.isFinite(scoreNum) || scoreNum < 0)
        return res.status(400).json({ error: "Invalid score value.", softReject: true });

      // Per-game learned stats (Option B, no manual config). Each game learns
      // its own normal score-rate AND typical play duration from real plays.
      const statRef  = db.collection("gameStats").doc(String(gameId));
      const statSnap = await statRef.get();
      const { avgRate = null, avgPlaySec = null, maxRate = null, count = 0 } = statSnap.exists ? statSnap.data() : {};
      const LEARN_SAMPLES = 20;   // plays needed before learned thresholds kick in

      // GATE 1 — self-learning minimum play time. SOFT signal (no flag/ban).
      // Refreshes/reconnects/double-clicks reset the timer, and game lengths
      // vary wildly — a 5s puzzle and a 3-min runner can't share one number.
      // Cold start: only block near-instant (bot/no-play) submits via a small
      // floor. Once learned: require a fraction of THIS game's typical duration.
      //
      // Ceiling matters as much as floor. Popular games learn very long
      // avgPlaySec (Arrow Out: ~3-4 min), and MIN_PLAY_FRACTION was
      // multiplying that into 60-120s minimums — which then blocked
      // legit users who submitted between rounds. Ceiling caps at what
      // the on-chain 30s cooldown already enforces (normal) / doubles it
      // for probation. Legit users always pass; bots that submit every
      // few seconds still get caught.
      //
      // Probation-aware: trusted users need 3s floor, probation 15s;
      // ceiling 30s / 60s respectively.
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

      // GATE 2 — absolute impossible-rate ceiling (bootstrap safety net)
      // Koi bhi game realistically 500 pts/sec cross nahi karega.
      const ABSOLUTE_MAX_RATE = 500;
      if (rate > ABSOLUTE_MAX_RATE)
        return await flagAndReject("Impossible score rate", { absoluteMaxRate: ABSOLUTE_MAX_RATE });

      // GATE 3 — self-learning anomaly. ⚠️ TEMPORARILY DISABLED.
      // The rate metric (score / playSec) is unreliable: playSec is measured
      // from session creation (page open), not from actual gameplay start, so
      // idle time skews it — this gate was mass-flagging legit players. Until
      // playSec is measured from real gameplay, GATE 3 neither flags nor blocks.
      // GATE 2 (impossible >500 pts/sec) remains the hard cheat cap. We still
      // roll the learned averages forward below so GATE 3 can be re-enabled
      // cleanly once the playSec fix lands.
      const ANOMALY_AVG_MULT = 6;   // kept for the average-poisoning guard below
      // const ANOMALY_MAX_MULT = 2;
      // if (
      //   count >= LEARN_SAMPLES && avgRate &&
      //   rate > avgRate * ANOMALY_AVG_MULT &&
      //   rate > (maxRate || avgRate) * ANOMALY_MAX_MULT
      // ) {
      //   return await flagAndReject("Score anomaly — far above normal for this game", { learnedAvgRate: avgRate, learnedMaxRate: maxRate });
      // }

      // Legit submission → roll BOTH averages forward (skip rate outliers so a
      // near-miss cheat doesn't poison the learned norms).
      // Legit submission → roll averages forward. Skip rate outliers (beyond the
      // avg multiplier) so a near-miss cheat can't poison the learned norms, and
      // track the best legit rate so the anomaly ceiling self-calibrates.
      const withinNormal = !avgRate || rate <= avgRate * ANOMALY_AVG_MULT;
      if (withinNormal) {
        const newCount   = count + 1;
        const newAvgRate = avgRate    ? (avgRate * count + rate) / newCount       : rate;
        const newAvgPlay = avgPlaySec ? (avgPlaySec * count + playSec) / newCount : playSec;
        const newMaxRate = Math.max(maxRate || 0, rate);
        await statRef.set({ avgRate: newAvgRate, avgPlaySec: newAvgPlay, maxRate: newMaxRate, count: newCount, lastUpdated: new Date() }, { merge: true });
      }
      // ═══════════════════════════════════════════════════════════════════════
      // END LAYER 1
      // ═══════════════════════════════════════════════════════════════════════

      // NOTE: the session is intentionally NOT burned here. Burning it before the
      // on-chain tx meant that if the player rejected the wallet prompt or the tx
      // failed, the session was already gone → "Invalid session, play first" →
      // they had to replay the whole game to submit. Retry-safety instead comes
      // from the deterministic per-session nonce below + the contract's
      // usedScoreProofs mapping (each score-proof lands on-chain exactly once).
      // The session simply expires on its own timer.

      // player JWT se lo — body se nahi (SH0009)
      const player       = signUser.address;
      const signerWallet = new ethers.Wallet(pk);
      // Deterministic per session: every retry for this play produces the SAME
      // signature, so the contract accepts it at most once (usedScoreProofs).
      const nonce        = ethers.toBigInt(ethers.keccak256(ethers.toUtf8Bytes("sess:" + sessionToken)));

      const messageHash = ethers.solidityPackedKeccak256(
        ["address", "uint256", "uint256", "uint256", "address", "uint256"],
        [player, BigInt(gameId), BigInt(score), nonce, platformAddr, chainId]
      );

      const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));

      // ── Tournament proof (only if this play is part of a tournament) ──
      // Contract expects a SEPARATE signature over the tournament tuple:
      //   keccak256(player, tournamentId, score, nonce, TOURNAMENT_ADDR, chainId)
      // Same already-validated score — no separate anti-cheat path, gates above
      // (session burn, min play time, rate ceiling, self-learning avg, soft-ban)
      // all ran before we reached here.
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

  // ── All writes require JWT ──
  // Public GET actions bypass this — they read data that doesn't need auth.
  const isPublicGet = req.method === "GET" && ["battle-shop-list"].includes(action);
  const user = isPublicGet ? null : verifyToken(req);
  if (!isPublicGet && !user) return res.status(401).json({ error: "Unauthorized — connect wallet" });

  // ── POST play ──
  if (req.method === "POST" && action === "play") {
    const { gameId } = req.body;
    if (!rateLimit(`play:${user.address}`, 30)) {
      return res.status(429).json({ error: "Too many requests" });
    }
    try {
      const gameRef   = db.collection("games").doc(String(gameId));
      const playerRef = gameRef.collection("players").doc(user.address);

      // Increment plays every time
      await gameRef.update({ plays: FV.increment(1) });

      // SH0030 — uniquePlayers ab scalar field pe track hota hai (stats
      // endpoint ka fix depends on this). Check if this player doc already
      // exists — if not, increment uniquePlayers count. Existing → just
      // update lastPlayed. Ye ensures backfill-friendly + idempotent.
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
  // ═══════════════════════════════════════════════════════════════════════
  // BATTLE ARENA — 5-round dollar-earning game, ARCADE mint on any chain
  // ═══════════════════════════════════════════════════════════════════════

  // ── POST battle-start-session ──────────────────────────────────────────
  // Creates a new battle session for the connected wallet. Returns the
  // sessionId (UUID) + sessionToken which the iframe game and future
  // battle-round calls need to authenticate.
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
      const ttlHours     = Number(process.env.BATTLE_SESSION_TTL_HOURS) || 2;
      const ttlMs        = ttlHours * 60 * 60 * 1000;
      const cutoff       = new Date(Date.now() - ttlMs);

      // ── Reuse existing active session if it's completely fresh ─────────
      // Only reuse if the session has NO rounds recorded AND is recent —
      // this handles rapid page reloads / wallet re-connects BEFORE any
      // gameplay started. Once even 1 round is recorded, Unity's game state
      // is effectively gone (nothing to resume to), so a new session must
      // be created and the old one is left as-is (shows up in match history
      // as "5 ROUNDS REQUIRED — Can't Claim").
      const existingSnap = await db.collection("battleSessions")
        .where("player", "==", bUser.address.toLowerCase())
        .where("chain",  "==", chain)
        .where("status", "==", "active")
        .orderBy("createdAt", "desc")
        .limit(1)
        .get()
        .catch(() => null);

      if (existingSnap && !existingSnap.empty) {
        const doc = existingSnap.docs[0];
        const d   = doc.data();
        const created    = d.createdAt?.toMillis?.() || 0;
        const hasRounds  = (d.rounds || []).length > 0;

        if (created > cutoff.getTime() && !hasRounds) {
          // Fresh, unplayed session — safe to hand back for reload continuity
          return res.status(200).json({
            sessionId:    doc.id,
            sessionToken: d.sessionToken,
            resumed:      true,
            rounds:       [],
            totalDollars: 0,
          });
        }
        // Otherwise: leave the old session untouched. Fall through to
        // create a new one. The old session stays "active" and appears in
        // match history where the user can see they abandoned it.
      }

      const sessionId    = randomUUID();
      const sessionToken = randomUUID();

      await db.collection("battleSessions").doc(sessionId).set({
        sessionId,
        sessionToken,
        player:      bUser.address.toLowerCase(),
        chain,
        chainId:     Number(chainId),
        battleArena: battleArenaAddr,
        createdAt:   new Date(),
        expiresAt:   new Date(Date.now() + ttlMs),
        rounds:      [],           // [{ round, dollars, recordedAt }]
        totalDollars: 0,
        status:      "active",      // active | completed | claimed | expired
        claimTxHash: null,
      });

      return res.status(200).json({ sessionId, sessionToken, resumed: false });
    } catch (err) {
      console.error("[battle-start-session]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST battle-round ──────────────────────────────────────────────────
  // Records one round's dollar earning. Enforces strict order (1→2→3→4→5),
  // per-round cap, and per-session cap. Round 5 auto-marks session
  // "completed" — after that only sign-claim/record-claim are allowed.
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

    // ── Per-round cap: CLAMP instead of REJECT ─────────────────────────
    // Old behaviour rejected the round entirely if dollars > cap, which
    // stalled the session (next round would be out-of-order). Now we just
    // clamp the reward to the cap and record it — the game keeps flowing.
    const maxPerRound = Number(process.env.BATTLE_MAX_DOLLARS_PER_ROUND) || 500;
    let effectiveDollars = dollarNum;
    let wasClampedRound  = false;
    if (dollarNum > maxPerRound) {
      effectiveDollars = maxPerRound;
      wasClampedRound  = true;
      console.warn(`[battle-round] clamped round ${roundNum} of ${sessionId}: reported $${dollarNum}, capped at $${maxPerRound}`);
    }

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

      // ── Per-session cap: CLAMP the last-round contribution ────────────
      const maxPerSession = Number(process.env.BATTLE_MAX_DOLLARS_PER_SESSION) || 2500;
      const currentTotal  = sess.totalDollars || 0;
      let addedThisRound  = effectiveDollars;
      let wasClampedSess  = false;
      if (currentTotal + addedThisRound > maxPerSession) {
        addedThisRound  = Math.max(0, maxPerSession - currentTotal);
        wasClampedSess  = true;
        console.warn(`[battle-round] clamped session ${sessionId} at $${maxPerSession} (had $${currentTotal}, tried +$${effectiveDollars}, actually added $${addedThisRound})`);
      }
      effectiveDollars = addedThisRound;
      const newTotal   = currentTotal + effectiveDollars;

      const newRounds = [
        ...existingRounds,
        { round: roundNum, dollars: effectiveDollars, recordedAt: new Date() },
      ];

      const updates = {
        rounds: newRounds,
        totalDollars: newTotal,
        lastRoundAt: new Date(),
      };
      if (roundNum === 5) updates.status = "completed";

      await sessRef.update(updates);

      // ═══════════════════════════════════════════════════════════════════
      // BATTLE PASS — award XP for this round + update player tier state
      // ═══════════════════════════════════════════════════════════════════
      // XP formula (tuned in previous discussion — configurable via env):
      //   base = dollars * 2
      //         + 20 (round completion)
      //         + 10 (only if dollars >= 20 — "big round" bonus)
      //         + 100 (only on round 5 — "full match" bonus)
      const XP_PER_DOLLAR   = Number(process.env.BATTLE_BP_XP_PER_DOLLAR)    || 2;
      const XP_ROUND_BONUS  = Number(process.env.BATTLE_BP_XP_ROUND_BONUS)   || 20;
      const XP_BIG_ROUND    = Number(process.env.BATTLE_BP_XP_BIG_ROUND)     || 10;
      const XP_BIG_ROUND_MIN = Number(process.env.BATTLE_BP_XP_BIG_ROUND_MIN) || 20;
      const XP_MATCH_BONUS  = Number(process.env.BATTLE_BP_XP_MATCH_BONUS)   || 100;

      // Use effectiveDollars (post-clamp) for XP so caps affect XP too
      let xpEarned = effectiveDollars * XP_PER_DOLLAR + XP_ROUND_BONUS;
      if (effectiveDollars >= XP_BIG_ROUND_MIN) xpEarned += XP_BIG_ROUND;
      if (roundNum === 5)                        xpEarned += XP_MATCH_BONUS;

      // Fetch active season (cached briefly per warm invocation)
      const activeSeasonId = await _getActiveSeasonId(db);
      const XP_PER_TIER    = Number(process.env.BATTLE_BP_XP_PER_TIER) || 500;
      const MAX_TIER       = Number(process.env.BATTLE_BP_MAX_TIER)    || 50;

      let bpXpBefore = 0, bpTierBefore = 0, bpXpAfter = 0, bpTierAfter = 0;
      let bpTotalXP = 0;

      try {
        const bpRef  = db.collection("playerBattlePass").doc(bUser.address.toLowerCase());
        const bpSnap = await bpRef.get();

        let bpDoc = bpSnap.exists ? bpSnap.data() : null;
        // Reset season XP if season changed (or first time)
        if (!bpDoc || bpDoc.seasonId !== activeSeasonId) {
          bpDoc = {
            address:      bUser.address.toLowerCase(),
            totalXP:      bpDoc?.totalXP || 0,
            seasonId:     activeSeasonId,
            seasonXP:     0,
            currentTier:  0,
            passType:     "free",
            claimedTiers: [],
            premiumUnlockedAt: null,
            createdAt:    bpDoc?.createdAt || new Date(),
          };
        }

        bpXpBefore   = bpDoc.seasonXP || 0;
        bpTierBefore = Math.min(MAX_TIER, Math.floor(bpXpBefore / XP_PER_TIER));

        bpXpAfter   = bpXpBefore + xpEarned;
        bpTierAfter = Math.min(MAX_TIER, Math.floor(bpXpAfter / XP_PER_TIER));
        bpTotalXP   = (bpDoc.totalXP || 0) + xpEarned;

        const bpUpdate = {
          address:      bUser.address.toLowerCase(),
          totalXP:      bpTotalXP,
          seasonId:     activeSeasonId,
          seasonXP:     bpXpAfter,
          currentTier:  bpTierAfter,
          passType:     bpDoc.passType || "free",
          claimedTiers: bpDoc.claimedTiers || [],
          lastRoundAt:  new Date(),
          updatedAt:    new Date(),
        };
        if (bpDoc.premiumUnlockedAt) bpUpdate.premiumUnlockedAt = bpDoc.premiumUnlockedAt;
        if (bpDoc.createdAt)         bpUpdate.createdAt         = bpDoc.createdAt;

        await bpRef.set(bpUpdate, { merge: true });
      } catch (bpErr) {
        // Don't fail the round if BP tracking blows up — log + continue
        console.error("[battle-round BP]", bpErr);
      }

      return res.status(200).json({
        accepted: true,
        round: roundNum,
        dollars: effectiveDollars,          // post-clamp value
        reported: dollarNum,                // what the game sent
        clamped: wasClampedRound || wasClampedSess,
        totalDollars: newTotal,
        status: updates.status || sess.status,
        xp: {
          earned:      xpEarned,
          seasonXP:    bpXpAfter,
          totalXP:     bpTotalXP,
          tierBefore:  bpTierBefore,
          tierAfter:   bpTierAfter,
          tieredUp:    bpTierAfter > bpTierBefore,
          seasonId:    activeSeasonId,
          xpPerTier:   XP_PER_TIER,
          maxTier:     MAX_TIER,
        },
      });
    } catch (err) {
      console.error("[battle-round]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST battle-sign-claim ─────────────────────────────────────────────
  // After all 5 rounds are recorded, generates the ECDSA claim proof that
  // BattleArena.sol will verify. Matches contract's hash:
  //   keccak256(player, sessionIdBytes32, dollars, address(this), chainid)
  // sessionIdBytes32 is derived deterministically from the UUID sessionId
  // via keccak256(utf8_bytes(sessionId)) — the same value gets stored in
  // contract's claimedSessions mapping, so replays are blocked on-chain.
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

      // Derived bytes32 sessionId — matches contract's expected type
      const sessionIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(sessionId));

      const signerWallet = new ethers.Wallet(pk);
      const messageHash  = ethers.solidityPackedKeccak256(
        ["address", "bytes32", "uint256", "address", "uint256"],
        [player, sessionIdBytes32, totalDollars, battleArenaAddr, chainId]
      );
      const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));

      return res.status(200).json({
        sessionIdBytes32,               // pass this to contract.claim(sessionId, ...)
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

  // ── POST battle-record-claim ───────────────────────────────────────────
  // Called after the on-chain claim tx confirms. Marks session as claimed
  // in Firestore for UI history / support debugging. Not a security gate —
  // the contract's claimedSessions mapping is the actual replay guard.
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

  // ── GET battle-match-history ────────────────────────────────────────────
  // Returns the caller's last 20 battle sessions (newest first) with the
  // per-round breakdown, claim tx, and status. Used by the /battle-arena
  // "Match History" modal.
  //
  // NOTE: Requires a Firestore composite index on
  //   battleSessions: (player ASC, createdAt DESC)
  // Firestore prints a one-click "Create index" link in the console on the
  // first failed call — click it once and the index builds in ~1 minute.
  if (req.method === "GET" && action === "battle-match-history") {
    const bUser = verifyToken(req);
    if (!bUser) return res.status(401).json({ error: "Unauthorized" });

    try {
      // Fetch more than 20 so we can filter out empty in-progress sessions
      // (orphans from page reloads / wallet re-connects) and still return 20
      // meaningful entries in most cases.
      const snap = await db.collection("battleSessions")
        .where("player", "==", bUser.address.toLowerCase())
        .orderBy("createdAt", "desc")
        .limit(60)
        .get();

      const toMs = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : null);
      const all = [];
      snap.forEach(doc => {
        const d = doc.data();
        all.push({
          sessionId:    doc.id,
          chain:        d.chain || null,
          chainId:      d.chainId || null,
          battleArena:  d.battleArena || null,
          rounds:       (d.rounds || []).map(r => ({
                          round:   r.round,
                          dollars: r.dollars,
                        })),
          totalDollars: d.totalDollars || 0,
          status:       d.status || "unknown",
          claimTxHash:  d.claimTxHash || null,
          createdAt:    toMs(d.createdAt),
          claimedAt:    toMs(d.claimedAt),
          lastRoundAt:  toMs(d.lastRoundAt),
        });
      });

      // Hide orphans: sessions with 0 rounds that are still "active" or
      // "expired" without ever having gameplay data. Keep everything else,
      // including completed/claimed sessions even if rounds is empty (edge
      // cases where a claim happened without recorded round detail).
      const sessions = all
        .filter(s => {
          const hasRounds = (s.rounds?.length || 0) > 0;
          const meaningful = ["completed", "claimed"].includes(s.status);
          return hasRounds || meaningful;
        })
        .slice(0, 20);

      return res.status(200).json({ sessions });
    } catch (err) {
      console.error("[battle-match-history]", err);
      // Missing index → Firestore returns a specific error with a URL to fix it
      if (String(err.message || "").includes("index")) {
        return res.status(503).json({
          error: "Firestore composite index required — check server logs for the auto-generated Create Index link.",
        });
      }
      return res.status(500).json({ error: err.message });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BATTLE SHOP — Permanent-unlock item shop (gun skins, environments, etc)
  // ═══════════════════════════════════════════════════════════════════════

  // ── GET battle-shop-list ────────────────────────────────────────────────
  // Public — no auth needed. Returns active items for the given chain
  // (or items marked chain: "*" which apply to all chains).
  //
  // Response shape:
  //   { items: [ {
  //       itemId, itemIdBytes32, name, description, category, rarity,
  //       imageUrl, priceARCADE, priceUSDC, chain, active
  //     } ] }
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
            modelUrl:      d.modelUrl || "",
            slot:          d.slot || "",     // admin override; empty = auto-derive
            priceARCADE:   d.priceARCADE || 0,
            priceUSDC:     d.priceUSDC || 0,
            chain:         d.chain || "*",
            active:        !!d.active,
          });
        }
      });

      // Stable order — rarity desc (legendary first) then price asc
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

  // ── GET battle-shop-inventory ───────────────────────────────────────────
  // Auth'd. Returns items the caller has unlocked (across all chains).
  // Ownership is stored in Firestore mirror; on-chain contract is source of
  // truth, but this endpoint reads from the fast-path cache.
  if (req.method === "GET" && action === "battle-shop-inventory") {
    const bUser = verifyToken(req);
    if (!bUser) return res.status(401).json({ error: "Unauthorized" });

    try {
      const addrLc = bUser.address.toLowerCase();
      const invRef = db.collection("battleShopInventory").doc(addrLc).collection("items");
      const [snap, eqSnap] = await Promise.all([
        invRef.get(),
        db.collection("battleShopEquipped").doc(addrLc).get(),
      ]);

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

      const eq = eqSnap.exists ? eqSnap.data() : {};
      return res.status(200).json({
        items,
        equipped: eq.equipped || {},   // slot → itemId (single-equip skins)
        powerUps: eq.powerUps || [],   // array (multi-equip power-ups)
      });
    } catch (err) {
      console.error("[battle-shop-inventory]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST battle-shop-equip ──────────────────────────────────────────────
  // Equip an owned item. For skins (any category other than power_up), sets
  // the slot to this itemId — automatically un-equipping any previous skin
  // in the same slot. For power_up items, adds to the powerUps array
  // (multi-equip). Requires ownership.
  //
  // Body: { itemId }
  // Returns: { equipped, powerUps }  (updated state)
  if (req.method === "POST" && action === "battle-shop-equip") {
    const bUser = verifyToken(req);
    if (!bUser) return res.status(401).json({ error: "Unauthorized" });

    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ error: "itemId required" });

    try {
      const addrLc = bUser.address.toLowerCase();

      // 1. Ownership check
      const ownRef = db.collection("battleShopInventory").doc(addrLc)
        .collection("items").doc(itemId);
      const ownSnap = await ownRef.get();
      if (!ownSnap.exists)
        return res.status(403).json({ error: "You don't own this item" });

      // 2. Item metadata (slot + category)
      const itemSnap = await db.collection("battleShopItems").doc(itemId).get();
      if (!itemSnap.exists) return res.status(404).json({ error: "Item no longer exists" });
      const item = itemSnap.data();

      // 3. Merge into equipped state
      const eqRef  = db.collection("battleShopEquipped").doc(addrLc);
      const eqSnap = await eqRef.get();
      const eq     = eqSnap.exists ? eqSnap.data() : { equipped: {}, powerUps: [] };
      const currentEquipped = { ...(eq.equipped || {}) };
      const currentPowerUps = new Set(eq.powerUps || []);

      if (item.category === "power_up") {
        currentPowerUps.add(itemId);
      } else {
        const slot = _getItemSlot({ itemId, slot: item.slot });
        currentEquipped[slot] = itemId;
      }

      const payload = {
        address:  addrLc,
        equipped: currentEquipped,
        powerUps: Array.from(currentPowerUps),
        updatedAt: new Date(),
      };
      await eqRef.set(payload, { merge: true });

      return res.status(200).json({
        ok:       true,
        equipped: payload.equipped,
        powerUps: payload.powerUps,
      });
    } catch (err) {
      console.error("[battle-shop-equip]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST battle-shop-unequip ────────────────────────────────────────────
  // Remove an item from equipped state. For power-ups, removes from array.
  // For skins, removes from slot (game goes back to default). No ownership
  // check needed — un-equipping something you don't own is a no-op.
  //
  // Body: { itemId }
  if (req.method === "POST" && action === "battle-shop-unequip") {
    const bUser = verifyToken(req);
    if (!bUser) return res.status(401).json({ error: "Unauthorized" });

    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ error: "itemId required" });

    try {
      const addrLc = bUser.address.toLowerCase();
      const eqRef  = db.collection("battleShopEquipped").doc(addrLc);
      const eqSnap = await eqRef.get();
      if (!eqSnap.exists)
        return res.status(200).json({ ok: true, equipped: {}, powerUps: [] });

      const eq = eqSnap.data();
      const newPowerUps = (eq.powerUps || []).filter(id => id !== itemId);
      const newEquipped = { ...(eq.equipped || {}) };
      // Strip this itemId from any slot it's occupying
      for (const [slot, val] of Object.entries(newEquipped)) {
        if (val === itemId) delete newEquipped[slot];
      }

      await eqRef.set({
        address:  addrLc,
        equipped: newEquipped,
        powerUps: newPowerUps,
        updatedAt: new Date(),
      });

      return res.status(200).json({ ok: true, equipped: newEquipped, powerUps: newPowerUps });
    } catch (err) {
      console.error("[battle-shop-unequip]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST battle-shop-purchase-quote ─────────────────────────────────────
  // Auth'd. Generates a signed purchase quote the user submits on-chain.
  //
  // Body: { itemId, currency: 'ARCADE' | 'USDC', chain }
  //
  // Validates:
  //   - Session ends when user calls the contract with the returned payload
  //   - Item exists, is active, and offered on the requested chain
  //   - User doesn't already own the item (Firestore mirror check)
  //   - Currency is offered for this item + supported on this chain
  //
  // Returns everything the frontend needs to call BattleShop.purchase():
  //   { itemId, itemIdBytes32, token, price, priceHuman, nonce, signature,
  //     contract, chainId, expiresAt }
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
      // ── Fetch item ──
      const itemSnap = await db.collection("battleShopItems").doc(itemId).get();
      if (!itemSnap.exists) return res.status(404).json({ error: "Item not found" });
      const item = itemSnap.data();

      if (!item.active) return res.status(409).json({ error: "Item is not active" });
      if (item.chain && item.chain !== "*" && item.chain !== chainKey)
        return res.status(409).json({ error: `Item not available on ${chainKey}` });

      const priceHuman = cur === "ARCADE" ? Number(item.priceARCADE) : Number(item.priceUSDC);
      if (!priceHuman || priceHuman <= 0)
        return res.status(409).json({ error: `Item not sold for ${cur}` });

      // ── Ownership check (Firestore mirror) ──
      const ownedRef = db
        .collection("battleShopInventory")
        .doc(bUser.address.toLowerCase())
        .collection("items")
        .doc(itemId);
      const ownedSnap = await ownedRef.get();
      if (ownedSnap.exists)
        return res.status(409).json({ error: "You already own this item" });

      // ── Compute on-chain amount ──
      const priceWei = BigInt(priceHuman) * (10n ** BigInt(decimals));

      // ── Generate nonce + itemId bytes32 ──
      const { randomBytes, randomUUID } = await import("crypto");
      const nonce         = "0x" + randomBytes(32).toString("hex");
      const itemIdBytes32 = item.itemIdBytes32 || ethers.keccak256(ethers.toUtf8Bytes(itemId));
      const quoteId       = randomUUID();

      // ── Sign quote ──
      // Contract expects: keccak256(buyer, itemId, token, price, nonce, contract, chainId)
      const signerWallet = new ethers.Wallet(pk);
      const messageHash  = ethers.solidityPackedKeccak256(
        ["address", "bytes32", "address", "uint256", "bytes32", "address", "uint256"],
        [bUser.address, itemIdBytes32, tokenAddr, priceWei, nonce, shopAddr, chainId]
      );
      const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));

      // ── Store quote for audit + record-purchase verification ──
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
        status:        "pending",   // pending → used | expired
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

  // ── POST battle-shop-record-purchase ────────────────────────────────────
  // Auth'd. Called after the on-chain purchase tx confirms. Verifies the
  // tx by reading hasItem() from the contract via RPC, then writes the
  // ownership entry to the Firestore mirror.
  //
  // Body: { itemId, chain, nonce, txHash }
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
      // ── Fetch quote for audit + get itemIdBytes32 ──
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

      // ── Verify on-chain state ──
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

      // ── Write to inventory (upsert; safe on retry) ──
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

      // ── Mark quote as used ──
      await quoteDoc.ref.update({
        status:      "used",
        usedAt:      new Date(),
        txHash,
      });

      // ── Auto-equip logic ──
      // Fresh purchases become active immediately when it makes sense:
      //   - Power-ups: always added to the equipped powerUps array (multi)
      //   - Skins: only auto-equipped if the target slot is currently empty
      //     (never override a skin the player deliberately chose earlier)
      try {
        const itemDataSnap = await db.collection("battleShopItems").doc(itemId).get();
        if (itemDataSnap.exists) {
          const itemMeta = itemDataSnap.data();
          const eqRef  = db.collection("battleShopEquipped").doc(bUser.address.toLowerCase());
          const eqSnap = await eqRef.get();
          const eq     = eqSnap.exists ? eqSnap.data() : { equipped: {}, powerUps: [] };

          if (itemMeta.category === "power_up") {
            const pu = new Set(eq.powerUps || []);
            pu.add(itemId);
            await eqRef.set({
              address:  bUser.address.toLowerCase(),
              equipped: eq.equipped || {},
              powerUps: Array.from(pu),
              updatedAt: new Date(),
            }, { merge: true });
          } else {
            const slot = _getItemSlot({ itemId, slot: itemMeta.slot });
            const currentEquipped = { ...(eq.equipped || {}) };
            if (!currentEquipped[slot]) {
              currentEquipped[slot] = itemId;
              await eqRef.set({
                address:  bUser.address.toLowerCase(),
                equipped: currentEquipped,
                powerUps: eq.powerUps || [],
                updatedAt: new Date(),
              }, { merge: true });
            }
          }
        }
      } catch (eqErr) {
        // Don't fail the purchase if auto-equip errors — user can equip from shop UI
        console.error("[auto-equip]", eqErr);
      }

      return res.status(200).json({ ok: true, itemId, txHash });
    } catch (err) {
      console.error("[battle-shop-record-purchase]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST like ──
  // SH0024 — pehle `rateLimit('like:...', 2)` tha with 60-sec window: user
  // har minute 2 baar like kar sakta tha → 60+ likes/hr per game. Ab
  // Firestore mein permanent doc create karte hain (gameLikes/{gameId}_{addr}).
  // `.create()` fails if exists (atomic), so double-like exactly = 1 like
  // globally, no per-instance rate-limit fudge factor.
  if (req.method === "POST" && action === "like") {
    const { gameId } = req.body;
    if (!gameId) return res.status(400).json({ error: "gameId required" });
    const likeId = `${String(gameId)}_${user.address.toLowerCase()}`;
    try {
      // Atomic create — Firestore rejects if doc exists (code 6 = ALREADY_EXISTS)
      await db.collection("gameLikes").doc(likeId).create({
        gameId: String(gameId),
        player: user.address.toLowerCase(),
        at: new Date(),
      });
      await db.collection("games").doc(String(gameId)).update({ likes: FV.increment(1) });
      return res.status(200).json({ success: true });
    } catch (err) {
      // code 6 = ALREADY_EXISTS (Firestore Admin SDK)
      if (err.code === 6 || /already exists/i.test(err.message || ""))
        return res.status(409).json({ error: "Already liked" });
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST unlike ──
  // Companion to `like` — delete the idempotency doc and decrement the count.
  // No-op if the user never liked. Kept simple; if you want optimistic UI,
  // frontend can flip state and trust the 200 that comes back.
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

  // ── POST score (LAYER 2: on-chain verified before leaderboard) ──
  // Score tabhi save hota hai jab txHash actually blockchain pe exist kare,
  // succeed hui ho, aur us player ke liye PlayRecorded event emit kiya ho.
  // Isse koi bhi fake { txHash, score } bhej ke leaderboard poison nahi kar sakta.
  if (req.method === "POST" && action === "score") {
    const { txHash, score, gameId, gameName, chain, earned, earnedSymbol } = req.body;
    if (!txHash || score == null) return res.status(400).json({ error: "Missing fields" });

    const chainKey = chain || "botchain";
    const rpcUrl   = RPC_URLS[chainKey];
    const platformAddr = PLATFORM_ADDRESSES[chainKey];
    if (!rpcUrl || !platformAddr)
      return res.status(400).json({ error: `Unknown chain: ${chainKey}` });

    try {
      // Idempotency — already recorded? (double-submit safe)
      const existing = await db.collection("scores").doc(txHash).get();
      if (existing.exists) return res.status(200).json({ success: true, cached: true });

      // 1) Tx blockchain pe fetch karo
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const receipt  = await provider.getTransactionReceipt(txHash);
      if (!receipt) return res.status(400).json({ error: "Transaction not found on-chain" });
      if (receipt.status !== 1) return res.status(400).json({ error: "Transaction failed on-chain" });

      // 2) Tx Platform contract ko hi gayi thi?
      if (receipt.to?.toLowerCase() !== platformAddr.toLowerCase())
        return res.status(400).json({ error: "Transaction not to Platform contract" });

      // 3) PlayRecorded event parse karo — player match kare?
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
        } catch { /* not this event */ }
      }
      if (!matched)
        return res.status(400).json({ error: "No matching PlayRecorded event for this player" });

      // 4) On-chain se hi values lo — body ke score/earned pe trust nahi.
      //    Also extract creatorReward so aggregate totals match on-chain
      //    exactly (previously ignored — caused a small delta between the
      //    MST admin panel and the on-chain event totals since creator
      //    payouts weren't being counted in the "total distributed" number).
      const onChainGameId  = matched.args.gameId.toString();
      const onChainReward  = Number(ethers.formatEther(matched.args.playerReward));
      const onChainCreator = Number(ethers.formatEther(matched.args.creatorReward));

      const scoreDoc = {
        player:        user.address,
        score:         parseInt(score),          // display score (game se)
        gameId:        parseInt(onChainGameId),   // on-chain verified
        gameName:      gameName || "Unknown",
        chain:         chainKey,
        earned:        onChainReward,             // player's on-chain reward
        creatorEarned: onChainCreator,            // creator's on-chain reward
        earnedSymbol:  earnedSymbol || "ARCADE",
        txHash,
        verified:      true,                      // Layer 2 stamp
        createdAt:     new Date(),
        aggregated:    true,                      // marks: aggregates already updated below
      };
      await db.collection("scores").doc(txHash).set(scoreDoc);

      // ── Aggregate rollup (fire-and-log; do not block user response) ──
      // updateAggregates writes 6 docs atomically. If it fails for any
      // reason we log but don't fail the whole request — the score is
      // already saved on-chain and in Firestore, aggregates can be
      // reconciled later via scripts/migrateAggregates.js. Marking the
      // score doc with `aggregated: false` on failure would let migration
      // pick it up automatically; on success it stays `true`.
      try {
        await updateAggregates(scoreDoc);
      } catch (aggErr) {
        console.error("[score] aggregate update failed for", txHash, "—", aggErr.message);
        // Flip the marker so a future migration run backfills this score
        try { await db.collection("scores").doc(txHash).update({ aggregated: false }); } catch {}
      }

      return res.status(200).json({ success: true, verified: true });
    } catch (err) {
      console.error("[score verify]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST save-game (creator) ──
  // SH0027 — three fixes bundled here:
  //   1. OWNERSHIP CHECK on existing games. Pehle koi bhi authenticated user
  //      kisi bhi live game ka name / iframeUrl / thumbnail / rewardRate
  //      overwrite kar sakta tha (attacker swaps Arrow Out iframe to a
  //      phishing site — critical). Now: existing.creator must match caller.
  //   2. iframeUrl VALIDATION — https-only, parses as URL, length cap. Pehle
  //      creator kuch bhi bhej sakta tha (http://, javascript:, typo-squat
  //      domain). Admin approval loop can still miss subtle phishing URLs.
  //   3. rewardRate SANITY CAP — pehle backend accepted anything
  //      (frontend UI enforced limits, easily bypassed). Malicious creator
  //      could self-set rate = 1e9 to drain the platform's reward pool as
  //      soon as their game got approved.
  if (req.method === "POST" && action === "save-game") {
    const { gameId, name, description, iframeUrl, thumbnailUrl, category, rewardRate, rewardRateNative, txHash } = req.body;

    // gameId sanity — pehle "undefined" doc ID create ho sakti thi
    if (gameId == null) return res.status(400).json({ error: "gameId required" });
    const gidNum3 = Number(gameId);
    if (!Number.isFinite(gidNum3) || gidNum3 < 0 || gidNum3 > 1e9)
      return res.status(400).json({ error: "Invalid gameId" });

    // iframeUrl — https-only, valid URL, length cap. javascript: aur data:
    // schemes reject; http:// reject (mixed-content warnings anyway).
    if (!iframeUrl || typeof iframeUrl !== "string" || iframeUrl.length > 500)
      return res.status(400).json({ error: "iframeUrl required (max 500 chars)" });
    try {
      const u = new URL(iframeUrl);
      if (u.protocol !== "https:")
        return res.status(400).json({ error: "iframeUrl must use https://" });
    } catch { return res.status(400).json({ error: "Invalid iframeUrl" }); }

    // thumbnailUrl (optional) — same treatment
    if (thumbnailUrl) {
      if (typeof thumbnailUrl !== "string" || thumbnailUrl.length > 500)
        return res.status(400).json({ error: "Invalid thumbnailUrl" });
      try {
        const tu = new URL(thumbnailUrl);
        if (tu.protocol !== "https:" && tu.protocol !== "http:")
          return res.status(400).json({ error: "thumbnailUrl must be http(s)://" });
      } catch { return res.status(400).json({ error: "Invalid thumbnailUrl" }); }
    }

    // Text field caps
    if (name && (typeof name !== "string" || name.length > 100))
      return res.status(400).json({ error: "name too long (max 100)" });
    if (description && (typeof description !== "string" || description.length > 1000))
      return res.status(400).json({ error: "description too long (max 1000)" });
    if (category && (typeof category !== "string" || category.length > 50))
      return res.status(400).json({ error: "category too long" });

    // Reward-rate caps — realistic upper bounds per business logic. Adjust
    // if your economy legitimately needs higher rates for specific games,
    // but do NOT accept unbounded input from creators.
    const MAX_REWARD_RATE        = 500;   // ARCADE per play
    const MAX_REWARD_RATE_NATIVE = 10;    // native (MSTC) per play
    const clampedRate       = Math.min(Math.max(parseInt(rewardRate) || 50, 0), MAX_REWARD_RATE);
    const clampedRateNative = rewardRateNative != null
      ? Math.min(Math.max(parseInt(rewardRateNative) || 1, 0), MAX_REWARD_RATE_NATIVE)
      : null;

    try {
      const gameRef = db.collection("games").doc(String(gameId));
      const existing = await gameRef.get();
      if (existing.exists) {
        // OWNERSHIP CHECK — this is the critical fix. Without it, any
        // authenticated wallet could hijack any live game.
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

  // ── POST update-game (creator) ──
  if (req.method === "POST" && action === "update-game") {
    const { gameId, rewardRate, rewardRateNative, helpContent } = req.body;
    try {
      const gameRef = db.collection("games").doc(String(gameId));
      const game = await gameRef.get();
      if (!game.exists) return res.status(404).json({ error: "Game not found" });
      if (game.data().creator?.toLowerCase() !== user.address?.toLowerCase()) return res.status(403).json({ error: "Not your game" });
      const updates = {};
      // Reward-rate caps — same ceilings as save-game (SH0027)
      const MAX_REWARD_RATE        = 500;
      const MAX_REWARD_RATE_NATIVE = 10;
      if (rewardRate != null)
        updates.rewardRate = Math.min(Math.max(parseInt(rewardRate) || 0, 0), MAX_REWARD_RATE);
      if (rewardRateNative != null)
        updates.rewardRateNative = Math.min(Math.max(parseInt(rewardRateNative) || 0, 0), MAX_REWARD_RATE_NATIVE);
      if (helpContent != null) {
        // SH0028 — videoUrl XSS fix. Pehle creator "javascript:fetch(...jwt)"
        // set kar sakta tha; frontend <a href={videoUrl}> raw insert karta
        // hai. Modern browsers mostly block javascript: in target=_blank,
        // but not guaranteed on older Android WebViews (in-app wallet
        // browsers on old Android). Backend fail-closed check: https-only
        // OR empty string (empty = "no video, hide the link").
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
        // Text field caps for the other helpContent sub-fields
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

  // ── POST admin-purge-cache (admin-only) ──
  // SH0035 — cache invalidation for admin actions. Public read endpoints
  // (list/stats/scores/comments) have aggressive Edge cache (2-5 min).
  // Admin ne game approve/reject/update kiya toh users ko turant dikhna
  // chahiye — is button se cache purge hoti hai, next request fresh
  // Firestore hit karti hai. Vercel purge API cache tag revalidate karta
  // hai — full-project stateless approach: cache tags nahi lage yet, so
  // fallback is a simple "no-op success" that reminds admin to wait a few
  // minutes if they didn't want stale reads. Once Vercel cache tags wire
  // in (`res.setHeader("Cache-Tag", ...)`), this endpoint calls Vercel's
  // /v1/purge with the tag.
  //
  // Ye endpoint currently just clears any in-memory caches (checkClaimCache)
  // and returns success — the Edge TTL is short enough (2-5 min) that most
  // scenarios don't need explicit purge. Full Vercel cache-tag integration
  // is future work.
  // ── GET admin-player-analytics (admin-only, PROPER data — no limit) ──
  // SH0038 — MST team ka critical requirement: dashboard pe 100% accurate
  // real all-time data dikhna chahiye, koi cap nahi. Pehle scores endpoint
  // 10K docs pe cap tha (public leaderboard safety) — matlab 25K+ plays wale
  // platform pe admin panel galat aggregate dikhata tha (payout 5K vs actual
  // 11K, total plays 10K vs actual 19K).
  //
  // Ye dedicated endpoint:
  //   • Admin-only (checkOnChainAdmin gate — sirf grant kiye admins)
  //   • NO limit — full scores collection paginate karke aggregate karta hai
  //   • Server-side aggregation → response payload chhota (bandwidth save)
  //   • 5-min Edge cache → same admin bar-bar refresh kare toh Firestore
  //     ek hi baar hit hoti hai (cost control despite no doc limit)
  //   • CSV-ready data: per-wallet totals included for export
  //   • Filters approved games only (junk games ke scores skip)
  //
  // Cost impact per call: ~25K reads (full scores scan). With 5-min cache
  // and typical admin usage (3-5 dashboard opens/day), effective daily
  // cost = ~25K reads/day. Sustainable at your current scale. Long-term,
  // proper aggregate architecture (platformStats/dailyStats/playerStats
  // pre-computed docs) will bring this to <100 reads/day.
  // ── AGGREGATE COLLECTIONS: helper to atomically update 6 aggregate docs ──
  //
  // Called after every successful score save. Uses batched writes with
  // FieldValue.increment() which is atomic and concurrent-safe (multiple
  // scores in the same second cannot lose an increment). Total cost per
  // score submit = 6 writes ≈ $0.00000108 (Blaze pricing).
  //
  // The 6 aggregate collections mirror what MST admin analytics needs:
  //   1. platformStats/{chain}                       — all-time chain totals
  //   2. dailyStats/{chain}_{date}                   — per-day totals
  //   3. playerStats/{chain}_{wallet}                — all-time per player
  //   4. playerDailyStats/{chain}_{date}_{wallet}    — per-player per-day
  //   5. gameStats/{chain}_{gameId}                  — all-time per game
  //   6. gameDailyStats/{chain}_{date}_{gameId}     — per-game per-day
  //
  // Read cost drops from 20K+ per analytics call to ~600 — 97% reduction.
  // Data is 100% accurate (real counts, real sums) and always fresh
  // (updated the moment a score is confirmed on-chain).
  const FieldValue = admin.firestore.FieldValue;
  async function updateAggregates({ player, gameId, gameName, chain, earned, creatorEarned, createdAt }) {
    if (!player || !chain || gameId == null) return;

    const w   = player.toLowerCase();
    const gid = String(gameId);
    // Semantic split — playerStats tracks what the player earned (their
    // own cut only), platformStats/dailyStats/gameStats track TOTAL MSTC
    // distributed (player + creator). This matches how on-chain event
    // totals are computed and makes the MST admin panel numbers line up
    // exactly with a direct PlayRecorded event scan.
    const playerAmt  = Number(earned) || 0;
    const creatorAmt = Number(creatorEarned) || 0;
    const totalAmt   = playerAmt + creatorAmt;

    // Normalise date to UTC YYYY-MM-DD for consistent daily grouping
    // across timezones. Every aggregate uses UTC so MST team sees the
    // same day boundary regardless of where analytics is loaded from.
    const scoreDate = createdAt instanceof Date
      ? createdAt
      : createdAt?.toDate?.() || new Date();
    const dateKey = scoreDate.toISOString().slice(0, 10);

    const batch = db.batch();

    // 1. Platform (all-time chain totals — includes creator payouts)
    batch.set(db.doc(`platformStats/${chain}`), {
      chain,
      totalPlays:  FieldValue.increment(1),
      totalPayout: FieldValue.increment(totalAmt),
      updatedAt:   FieldValue.serverTimestamp(),
    }, { merge: true });

    // 2. Daily totals for this chain — includes creator payouts
    batch.set(db.doc(`dailyStats/${chain}_${dateKey}`), {
      chain, date: dateKey,
      plays:  FieldValue.increment(1),
      earned: FieldValue.increment(totalAmt),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // 3. Player all-time — player's own earnings only (not creator cut).
    // `gameIds` array is bounded (a player won't play more than ~100
    // unique games in practice; Firestore array cap is 1MB per doc
    // which supports ~20K short strings).
    batch.set(db.doc(`playerStats/${chain}_${w}`), {
      chain, wallet: w,
      plays:      FieldValue.increment(1),
      earned:     FieldValue.increment(playerAmt),
      lastPlayed: scoreDate,
      gameIds:    FieldValue.arrayUnion(gid),
    }, { merge: true });

    // 4. Player-per-day — player's own earnings only
    batch.set(db.doc(`playerDailyStats/${chain}_${dateKey}_${w}`), {
      chain, date: dateKey, wallet: w,
      plays:   FieldValue.increment(1),
      earned:  FieldValue.increment(playerAmt),
      gameIds: FieldValue.arrayUnion(gid),
    }, { merge: true });

    // 5. Game all-time — total distributed via this game (player + creator)
    batch.set(db.doc(`gameStats/${chain}_${gid}`), {
      chain, gameId: gid, name: gameName || null,
      plays:      FieldValue.increment(1),
      earned:     FieldValue.increment(totalAmt),
      lastPlayed: scoreDate,
    }, { merge: true });

    // 6. Game-per-day — total distributed via this game per day
    batch.set(db.doc(`gameDailyStats/${chain}_${dateKey}_${gid}`), {
      chain, date: dateKey, gameId: gid,
      plays:  FieldValue.increment(1),
      earned: FieldValue.increment(totalAmt),
    }, { merge: true });

    await batch.commit();
  }

  if (req.method === "GET" && action === "admin-player-analytics") {
    const aUser = verifyToken(req);
    if (!aUser) return res.status(401).json({ error: "Unauthorized" });
    if (!(await checkOnChainAdmin(aUser.address)))
      return res.status(403).json({ error: "Admin only" });

    try {
      // No CDN cache anymore — reads are ~600 total per call (vs 20K+
      // scan), fresh data is safe to serve every time. MST team gets
      // real-time accurate numbers with no staleness.

      const { chain, from, to } = req.query;
      if (!chain) return res.status(400).json({ error: "chain required" });

      // Date range handling. If BOTH from and to are absent → "all time"
      // path (use pre-computed all-time aggregates for max cost efficiency).
      // If either is present → date-range path (reads from playerDailyStats
      // + gameDailyStats + dailyStats within the range).
      const fromDate = from ? new Date(from) : null;
      const toDate   = to   ? new Date(to)   : null;
      if (toDate && !isNaN(toDate)) toDate.setUTCHours(23, 59, 59, 999);
      const isAllTime = !fromDate && !toDate;

      // Date-range → YYYY-MM-DD strings for querying by `date` field
      const fromKey = fromDate && !isNaN(fromDate) ? fromDate.toISOString().slice(0, 10) : null;
      const toKey   = toDate   && !isNaN(toDate)   ? toDate.toISOString().slice(0, 10)   : null;

      // Player-share percent (used for legacy display; aggregates already
      // store real earned amounts on-chain)
      let playerSharePct = 100;
      try {
        const settingsDoc = await db.collection("chainSettings").doc(chain).get();
        if (settingsDoc.exists) {
          const s = settingsDoc.data();
          if (s.playerPct != null) playerSharePct = Number(s.playerPct);
        }
      } catch { /* keep default */ }

      // Approved games map — used to attach current names + filter out
      // rejected games from the game breakdown (matches previous
      // behaviour where `skippedNonApproved` counted these).
      const gamesSnap = await db.collection("games")
        .where("status", "==", "approved").get();
      const approvedGames = {};
      gamesSnap.docs.forEach(d => {
        const g = d.data();
        approvedGames[String(g.gameId)] = { name: g.name };
      });

      // ── ALL-TIME PATH (no date filter) ───────────────────────────
      // Fetch: platformStats(1) + playerStats(500 for display) +
      // playerStats.count() (real count, +1 read) + gameStats(all) +
      // dailyStats(last 90 days for chart). ~612 reads total.
      if (isAllTime) {
        const [platformSnap, playersSnap, playersCountSnap, gamesAggSnap, dailySnap] = await Promise.all([
          db.doc(`platformStats/${chain}`).get(),
          // Top 500 players by earnings — displayed list only.
          // Real total comes from the parallel count() query below —
          // previously we returned playerRows.length here, which capped
          // activePlayers at 500 and made MST admin under-report by ~30%.
          db.collection("playerStats")
            .where("chain", "==", chain)
            .orderBy("earned", "desc")
            .limit(500)
            .get(),
          // Real active-player count via Firestore's count() aggregation
          // — 1 read regardless of collection size. This is the number
          // MST admin should see for "Active Players".
          db.collection("playerStats")
            .where("chain", "==", chain)
            .count().get(),
          db.collection("gameStats")
            .where("chain", "==", chain)
            .get(),
          // Last 90 days of daily rollups for the chart
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
            if (!approvedGames[gid]) return null; // skip rejected games
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
              uniquePlayers: 0, // filled below via secondary count query
            };
          })
          .sort((a, b) => a.date.localeCompare(b.date));

        // Fill uniquePlayers per day using a single count query per day
        // Only for last 30 days to keep read count sane (30 counts = 30 reads)
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
            activePlayers,                    // real count from count() query
            totalGames:   gameRows.length,
            avgPerPlayer: activePlayers > 0
              ? Number((totalPayout / activePlayers).toFixed(4)) : 0,
            skippedNonApproved: 0,           // aggregates-based, always 0
            scannedScores: totalPlays,       // legacy field, = totalPlays now
            playerSharePct,
            source: "aggregates",            // marker for frontend if needed
          },
          players: playerRows,
          daily:   dailyRows,
          games:   gameRows,
        });
      }

      // ── DATE-RANGE PATH ──────────────────────────────────────────
      // Reads: dailyStats in range + playerDailyStats in range +
      // gameDailyStats in range. Typical 14d window ≈ 1200 reads.
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

      // Roll up dailyStats → daily rows + summary totals
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
          uniquePlayers: 0, // filled below
        };
      });

      // Roll up playerDailyStats → per-player aggregates within range
      const playerAgg = {}; // wallet → { plays, earned, lastPlayed, games:Set }
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
        // Track lastPlayed as the max date-key in range (accurate to day)
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

      // Roll up gameDailyStats → per-game aggregates within range
      const gameAgg = {}; // gameId → { plays, earned }
      gameDailySnap.docs.forEach(d => {
        const x = d.data();
        const gid = String(x.gameId);
        if (!approvedGames[gid]) return; // filter rejected games
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

      // Unique-players-per-day fill via count aggregation (1 read per day)
      const dates = dailyRows.map(r => r.date);
      if (dates.length > 0) {
        // For date-range views, uniquePlayers per day comes from the same
        // playerDailySnap already fetched — group locally, no extra reads
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

  // ── POST admin-ban-wallet (admin-only) ─────────────────────────────
  // Adds a wallet to the bannedWallets collection. Effect is immediate:
  //   • /api/auth refuses to issue new JWTs to this wallet
  //   • /api/games sign-score and start-session refuse existing JWTs
  //     from this wallet
  //   • Their on-chain plays already succeed only via a signature we
  //     don't hand out anymore, so no further drain is possible
  // Legit users get a clear "wallet suspended" message and can contact
  // support. Use for immediate incident response — bulk / long-term
  // filtering should still go through the flagged review flow.
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

  // ── POST admin-unban-wallet (admin-only) ───────────────────────────
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

  // ── GET admin-list-banned (admin-only) ─────────────────────────────
  // Returns all currently-banned wallets. Small collection expected
  // (dozens, not thousands) — pagination not needed.
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

  // ── POST admin-purge-cache (admin-only) ──
  if (req.method === "POST" && action === "admin-purge-cache") {
    if (!(await checkOnChainAdmin(user.address)))
      return res.status(403).json({ error: "Admin only" });
    try {
      // Clear in-memory caches — these are per-instance so not perfectly
      // effective across Vercel warm pool, but helps for the caller's instance.
      checkClaimCache.clear();
      // Vercel Edge cache TTL is short (2-5 min) so full propagation
      // happens naturally. If instant purge needed later, integrate
      // Vercel's cache-tag API here.
      return res.status(200).json({
        success: true,
        note: "In-memory caches cleared. Edge cache will refresh within 2-5 minutes.",
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST admin-update-reward (admin-only) ──
  if (req.method === "POST" && action === "admin-update-reward") {
    // Admin gate — verifies the caller's ADMIN_ROLE ON-CHAIN (no env / allowlist
    // to maintain). Grant ADMIN_ROLE on the Platform contract and the backend
    // respects it automatically, in sync with the on-chain gate AdminMST uses.
    // The legacy /admin super-admin (VITE_ADMIN_ADDRESS) is still honored too.
    const caller = user.address?.toLowerCase();
    const superAdmin = process.env.VITE_ADMIN_ADDRESS?.toLowerCase();

    const isOnChainAdmin = async (addr) => {
      if (!addr) return false;
      const DEFAULT_ADMIN_ROLE = "0x" + "0".repeat(64);
      const abi = [
        "function hasRole(bytes32 role, address account) view returns (bool)",
        "function ADMIN_ROLE() view returns (bytes32)",
      ];
      // Admin on ANY configured chain's Platform can manage rates.
      for (const chain of Object.keys(PLATFORM_ADDRESSES)) {
        const platformAddr = PLATFORM_ADDRESSES[chain];
        const rpc = RPC_URLS[chain];
        if (!platformAddr || !rpc) continue;
        try {
          const c = new ethers.Contract(platformAddr, abi, new ethers.JsonRpcProvider(rpc));
          // Read the role hash straight from the contract (exactly like the
          // AdminMST gate does) so it matches no matter how it was declared.
          const adminRole = await c.ADMIN_ROLE().catch(() => null);
          const checks = await Promise.all([
            adminRole ? c.hasRole(adminRole, addr).catch(() => false) : Promise.resolve(false),
            c.hasRole(DEFAULT_ADMIN_ROLE, addr).catch(() => false),
          ]);
          if (checks.some(Boolean)) return true;
        } catch (_) { /* RPC hiccup — try next chain */ }
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

  // ── POST flagged-list (admin-only) ────────────────────────────────────────
  // Groups the `flagged` collection by player so the panel can show who's
  // currently soft-banned (>=3 flags in the trailing 24h window).
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
        banned: e.recent >= 3,      // matches sign-score FLAG_BAN_THRESHOLD
        lastFlaggedAt: e.lastFlaggedAt,
        reasons: e.reasons,
        chains: [...e.chains],
      })).sort((a, b) => b.recent - a.recent || b.total - a.total);

      return res.status(200).json({ players });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST clear-flags (admin-only) ─────────────────────────────────────────
  // Deletes ALL flag docs for a player → immediately un-bans them (the
  // sign-score soft-ban counts flags in a 24h window; zero flags = not banned).
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
      for (let i = 0; i < docs.length; i += 450) {   // Firestore batch cap = 500
        const batch = db.batch();
        docs.slice(i, i + 450).forEach(d => batch.delete(d.ref));
        await batch.commit();
        cleared += Math.min(450, docs.length - i);
      }
      return res.status(200).json({ success: true, cleared });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST clear-all-flags (admin-only, nuclear option) ─────────────────────
  // Deletes EVERY doc in the `flagged` collection. Use with extreme
  // caution — this unbans every currently soft-banned wallet at once.
  // Intended for two scenarios:
  //   1. False-positive storms (a legit event triggered GATE 2 for many
  //      users at once — e.g. a very short game type that scores fast).
  //   2. Testing / clean slate before a feature launch.
  // Requires explicit `confirm: "CLEAR_ALL"` in the body so an
  // accidental fetch can't wipe things. Paginated internally so a
  // 50K-doc collection still completes.
  if (req.method === "POST" && action === "clear-all-flags") {
    if (!(await checkOnChainAdmin(user.address)))
      return res.status(403).json({ error: "Admin only" });
    const { confirm } = req.body || {};
    if (confirm !== "CLEAR_ALL")
      return res.status(400).json({ error: "Confirmation required: send { confirm: 'CLEAR_ALL' }" });
    try {
      let totalCleared = 0;
      const BATCH_SIZE = 450;   // Firestore commit cap = 500
      const MAX_ROUNDS = 200;   // safety: 200 * 450 = 90K docs max
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const snap = await db.collection("flagged").limit(BATCH_SIZE).get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        totalCleared += snap.docs.length;
        if (snap.docs.length < BATCH_SIZE) break; // last page
      }
      return res.status(200).json({ success: true, cleared: totalCleared });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── GET admin-taskon-config (admin-only, per-chain list) ──────────────────
  // Returns every chain's current TaskOn config from Firestore, PLUS the
  // env fallback (marked as source: "env-fallback"). Frontend renders one
  // row per chain in CHAIN_LIST — populates fields from the returned map
  // by chain key.
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
      // Include env fallback so the UI can show what would apply if no
      // Firestore doc exists for a given chain
      const envFallback = {
        questId: process.env.TASKON_QUEST_ID || "",
        campaignUrl: process.env.VITE_TASKON_CAMPAIGN_URL || "",
        clientIdSet: !!process.env.TASKON_CLIENT_ID,
      };
      return res.status(200).json({ configs, envFallback });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST admin-taskon-config (admin-only, per-chain upsert) ───────────────
  // Body: { chain, enabled, questId, campaignUrl }
  // Writes/updates taskonConfig/{chain}. Immediately busts the in-memory
  // cache for this chain so the next check-taskon reflects the change
  // (no wait for the 60s TTL). Validates questId is numeric per TaskOn's
  // API requirement (see fetchTaskonParticipants — ref_id must be Number).
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
      // Bust caches so the next check-taskon uses the new config immediately
      bustTaskonCache(chain);
      return res.status(200).json({ success: true, chain });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST admin-faucet-withdraw (admin-only, server key = faucet owner) ─────
  // faucet.withdrawFunds is onlyOwner; the server PRIVATE_KEY is that owner
  // (same key claim-gas uses), so an on-chain admin can trigger a withdrawal
  // without ever holding/connecting the owner wallet in a browser.
  //
  // SH0029 — SAFETY CAPS. Pehle admin authenticated ho toh full faucet balance
  // in one call withdraw kar sakta tha to any address. Admin wallet compromise
  // (phishing sig, malicious extension, seed leak) = instant drain. Now:
  //   • per-call cap (MAX_WITHDRAW_MSTC)
  //   • rolling 24h aggregate cap (DAILY_WITHDRAW_CAP), tracked in Firestore
  //   • audit log entry per withdrawal (who / when / how much / where / tx)
  // Adjust the caps to whatever legitimate withdrawal needs actually require.
  if (req.method === "POST" && action === "admin-faucet-withdraw") {
    if (!(await checkOnChainAdmin(user.address)))
      return res.status(403).json({ error: "Admin only" });
    const { to, amount } = req.body;   // amount in whole MSTC (string/number)
    if (!to || !ethers.isAddress(to))
      return res.status(400).json({ error: "Valid 'to' address required" });
    if (amount == null || isNaN(Number(amount)) || Number(amount) <= 0)
      return res.status(400).json({ error: "Valid amount required" });

    const MAX_WITHDRAW_MSTC   = 500;   // per-call ceiling
    const DAILY_WITHDRAW_CAP  = 2000;  // rolling-24h aggregate ceiling
    const amtNum = Number(amount);
    if (amtNum > MAX_WITHDRAW_MSTC)
      return res.status(400).json({ error: `Max ${MAX_WITHDRAW_MSTC} MSTC per call — split into multiple withdrawals` });

    // Daily-cap check via Firestore. Key by UTC date so cap resets at 00:00 UTC.
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

      // Audit + daily cap accounting (append-only). If this fails, the tx
      // has already gone through — log it and continue so the admin sees
      // success rather than a confusing 500 after money moved.
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

  // ═══════════════════════════════════════════════════════════════════════
  // BATTLE SHOP ADMIN — manage items in battleShopItems collection
  // ═══════════════════════════════════════════════════════════════════════

  // ── GET admin-shop-list-all ─────────────────────────────────────────────
  // Returns ALL items (active + inactive). Public list uses battle-shop-list.
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
          modelUrl:      d.modelUrl || "",
          slot:          d.slot || "",
          priceARCADE:   d.priceARCADE || 0,
          priceUSDC:     d.priceUSDC || 0,
          chain:         d.chain || "*",
          active:        !!d.active,
          createdAt:     d.createdAt || null,
          updatedAt:     d.updatedAt || null,
        });
      });
      // Newest first
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

  // ── POST admin-shop-upsert ──────────────────────────────────────────────
  // Create OR update an item. itemId is the document ID and is immutable
  // once set. Server always writes the derived itemIdBytes32 (bytes32 for
  // the contract) alongside — never trust the client for that.
  if (req.method === "POST" && action === "admin-shop-upsert") {
    if (!(await checkOnChainAdmin(user.address)))
      return res.status(403).json({ error: "Admin only" });

    const {
      itemId, name, description, category, rarity, imageUrl, modelUrl, slot,
      priceARCADE, priceUSDC, chain, active,
    } = req.body;

    // Validation
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
        modelUrl:      (modelUrl || "").trim(),
        slot:          (slot || "").trim().toUpperCase(),
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

      // Audit log
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

  // ── POST admin-shop-delete ──────────────────────────────────────────────
  // Hard-delete an item. Does NOT touch already-purchased inventory in
  // battleShopInventory subcollections — users keep what they own.
  // If you want to hide instead of delete, use setActive(false).
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

  // ── POST admin-shop-upload-image ────────────────────────────────────────
  // Upload a shop item image to Firebase Storage. Client sends base64-encoded
  // image data + filename + contentType; server decodes, uploads to
  //   gs://<bucket>/battleShopItems/images/<uuid>-<safe-filename>
  // and returns a public URL for storing in item.imageUrl.
  //
  // Constraints:
  //   - Max 2 MB (post-base64 payload ~2.7 MB, within Vercel's 4.5 MB limit)
  //   - Only PNG / JPEG / WebP / GIF accepted
  //
  // Env: FIREBASE_STORAGE_BUCKET (optional; defaults to <project>.appspot.com)
  if (req.method === "POST" && action === "admin-shop-upload-image") {
    if (!(await checkOnChainAdmin(user.address)))
      return res.status(403).json({ error: "Admin only" });

    const { filename, base64Data, contentType } = req.body;
    if (!filename || !base64Data || !contentType)
      return res.status(400).json({ error: "filename, base64Data, contentType required" });

    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
    if (!allowedTypes.includes(contentType.toLowerCase()))
      return res.status(400).json({ error: `Content type ${contentType} not allowed. Use PNG/JPEG/WebP/GIF` });

    // base64 length * 0.75 ≈ decoded byte size (rough)
    const binarySize = Math.floor(base64Data.length * 0.75);
    const MAX_SIZE = 2 * 1024 * 1024; // 2 MB
    if (binarySize > MAX_SIZE)
      return res.status(400).json({
        error: `Image too large (${(binarySize / 1024 / 1024).toFixed(2)}MB). Max 2 MB.`,
      });

    if (!rateLimit(`shop-upload:${user.address}`, 20, 60_000))
      return res.status(429).json({ error: "Too many uploads — slow down" });

    try {
      // Sanitize filename — strip anything that isn't a-zA-Z0-9._-
      const safeFilename = String(filename)
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .substring(0, 60) || "image";

      const { randomUUID } = await import("crypto");
      const uniqueId = randomUUID();
      const path     = `battleShopItems/images/${uniqueId}-${safeFilename}`;

      const bucket = admin.storage().bucket();
      const file   = bucket.file(path);
      const buffer = Buffer.from(base64Data, "base64");

      await file.save(buffer, {
        metadata: {
          contentType,
          metadata: {
            uploadedBy: user.address.toLowerCase(),
            uploadedAt: new Date().toISOString(),
            originalFilename: String(filename).substring(0, 200),
          },
        },
        resumable: false,
      });

      // Uniform bucket-level access (default on .firebasestorage.app buckets)
      // means file.makePublic() throws. Firebase Storage's own download URL
      // format works instead — provided rules allow public read on the path
      // (see the storage.rules block for battleShopItems/**).
      const encoded   = encodeURIComponent(path);
      const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media`;

      return res.status(200).json({ url: publicUrl, path, size: binarySize });
    } catch (err) {
      console.error("[admin-shop-upload-image]", err);
      // Common cause: storage bucket not enabled in Firebase console
      const msg = err.message || String(err);
      if (msg.includes("bucket") || msg.includes("Not Found")) {
        return res.status(503).json({
          error: "Firebase Storage bucket not configured. Enable Storage in Firebase console + set FIREBASE_STORAGE_BUCKET env.",
        });
      }
      return res.status(500).json({ error: msg });
    }
  }

  // ── POST admin-shop-upload-model ────────────────────────────────────────
  // Upload a 3D model (.glb only) for a shop item to Firebase Storage.
  // Returns a public URL for storing in item.modelUrl. Rendered client-side
  // by BattleShop3DViewer via Google's <model-viewer> web component.
  //
  // Constraints:
  //   - Max 3 MB binary (~4 MB base64 — under Vercel's 4.5 MB body limit)
  //   - Only .glb accepted (single-file binary GLTF)
  if (req.method === "POST" && action === "admin-shop-upload-model") {
    if (!(await checkOnChainAdmin(user.address)))
      return res.status(403).json({ error: "Admin only" });

    const { filename, base64Data, contentType } = req.body;
    if (!filename || !base64Data)
      return res.status(400).json({ error: "filename and base64Data required" });

    // Browsers send inconsistent content types for .glb — accept common ones
    // and enforce .glb extension as the source of truth.
    const nameLower = String(filename).toLowerCase();
    if (!nameLower.endsWith(".glb"))
      return res.status(400).json({ error: "Only .glb files supported" });

    const binarySize = Math.floor(base64Data.length * 0.75);
    const MAX_SIZE = 3 * 1024 * 1024;
    if (binarySize > MAX_SIZE)
      return res.status(400).json({
        error: `Model too large (${(binarySize / 1024 / 1024).toFixed(2)}MB). Max 3 MB — optimize with gltfpack / Blender export settings.`,
      });

    if (!rateLimit(`shop-upload-model:${user.address}`, 15, 60_000))
      return res.status(429).json({ error: "Too many uploads — slow down" });

    try {
      const safeFilename = String(filename)
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .substring(0, 60) || "model.glb";

      const { randomUUID } = await import("crypto");
      const uniqueId = randomUUID();
      const path     = `battleShopItems/models/${uniqueId}-${safeFilename}`;

      const bucket = admin.storage().bucket();
      const file   = bucket.file(path);
      const buffer = Buffer.from(base64Data, "base64");

      await file.save(buffer, {
        metadata: {
          contentType: "model/gltf-binary",  // canonicalize
          metadata: {
            uploadedBy: user.address.toLowerCase(),
            uploadedAt: new Date().toISOString(),
            originalFilename: String(filename).substring(0, 200),
            sizeBytes: String(binarySize),
          },
        },
        resumable: false,
      });

      // Same rationale as image upload — uniform bucket access requires
      // the Firebase Storage download URL format instead of makePublic().
      const encoded   = encodeURIComponent(path);
      const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media`;

      return res.status(200).json({ url: publicUrl, path, size: binarySize });
    } catch (err) {
      console.error("[admin-shop-upload-model]", err);
      const msg = err.message || String(err);
      if (msg.includes("bucket") || msg.includes("Not Found")) {
        return res.status(503).json({
          error: "Firebase Storage bucket not configured. Enable Storage in Firebase console + set FIREBASE_STORAGE_BUCKET env.",
        });
      }
      return res.status(500).json({ error: msg });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GAME THUMBNAIL MIGRATION — Cloudinary → Firebase Storage
  // ═══════════════════════════════════════════════════════════════════════

  // ── GET admin-list-storage-files ────────────────────────────────────────
  // Lists all image files in Firebase Storage. Used by the thumbnail
  // migration UI to build the picker dropdown.
  if (req.method === "GET" && action === "admin-list-storage-files") {
    if (!(await checkOnChainAdmin(user.address)))
      return res.status(403).json({ error: "Admin only" });

    try {
      const bucket = admin.storage().bucket();
      const [files] = await bucket.getFiles();
      const items = files
        .filter(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f.name))
        .map(f => {
          const encoded = encodeURIComponent(f.name);
          return {
            name: f.name,
            url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media`,
            size: Number(f.metadata?.size || 0),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return res.status(200).json({ files: items });
    } catch (err) {
      console.error("[admin-list-storage-files]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET admin-games-thumbnails ──────────────────────────────────────────
  // Lists all games with their current thumbnailUrl. Used by migration UI.
  if (req.method === "GET" && action === "admin-games-thumbnails") {
    if (!(await checkOnChainAdmin(user.address)))
      return res.status(403).json({ error: "Admin only" });

    try {
      const snap = await db.collection("games").get();
      const games = [];
      snap.forEach(doc => {
        const d = doc.data();
        games.push({
          gameId:       doc.id,
          name:         d.name || "",
          thumbnailUrl: d.thumbnailUrl || "",
          status:       d.status || "",
        });
      });
      games.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      return res.status(200).json({ games });
    } catch (err) {
      console.error("[admin-games-thumbnails]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST admin-update-game-thumbnail ────────────────────────────────────
  // Sets a single game's thumbnailUrl. Accepts { gameId, thumbnailUrl }.
  // Used both per-game save and bulk save (called in a loop from frontend).
  if (req.method === "POST" && action === "admin-update-game-thumbnail") {
    if (!(await checkOnChainAdmin(user.address)))
      return res.status(403).json({ error: "Admin only" });

    const { gameId, thumbnailUrl } = req.body;
    if (!gameId || typeof thumbnailUrl !== "string")
      return res.status(400).json({ error: "gameId and thumbnailUrl required" });

    try {
      await db.collection("games").doc(String(gameId)).update({
        thumbnailUrl: thumbnailUrl.trim(),
        updatedAt:    new Date(),
      });

      await db.collection("adminAudit").add({
        kind:         "gameThumbnailUpdate",
        admin:        user.address.toLowerCase(),
        gameId:       String(gameId),
        thumbnailUrl,
        at:           new Date(),
      }).catch(err => console.error("[audit] gameThumbnailUpdate:", err));

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[admin-update-game-thumbnail]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BATTLE PASS — XP, tiers, season claims
  // ═══════════════════════════════════════════════════════════════════════

  // ── GET battle-bp-status ────────────────────────────────────────────────
  // Player-facing: returns current season + player's BP state (XP, tier,
  // claimed tiers, passType). Used by /battle-pass page + XP sidebar bar.
  if (req.method === "GET" && action === "battle-bp-status") {
    const bUser = verifyToken(req);
    if (!bUser) return res.status(401).json({ error: "Unauthorized" });

    try {
      const activeSeasonId = await _getActiveSeasonId(db);
      if (!activeSeasonId)
        return res.status(200).json({ activeSeason: null, player: null });

      const seasonSnap = await db.collection("battlePassSeasons").doc(activeSeasonId).get();
      if (!seasonSnap.exists)
        return res.status(200).json({ activeSeason: null, player: null });
      const season = seasonSnap.data();

      const bpRef  = db.collection("playerBattlePass").doc(bUser.address.toLowerCase());
      const bpSnap = await bpRef.get();
      const bp     = bpSnap.exists ? bpSnap.data() : null;

      const XP_PER_TIER = season.xpPerTier || 500;
      const MAX_TIER    = season.numTiers  || 50;

      let player;
      if (!bp || bp.seasonId !== activeSeasonId) {
        // First time this season — return zeros
        player = {
          address: bUser.address.toLowerCase(),
          totalXP:      bp?.totalXP || 0,
          seasonId:     activeSeasonId,
          seasonXP:     0,
          currentTier:  0,
          passType:     "free",
          claimedTiers: [],
          premiumUnlockedAt: null,
        };
      } else {
        player = {
          address:      bp.address || bUser.address.toLowerCase(),
          totalXP:      bp.totalXP || 0,
          seasonId:     bp.seasonId,
          seasonXP:     bp.seasonXP || 0,
          currentTier:  Math.min(MAX_TIER, Math.floor((bp.seasonXP || 0) / XP_PER_TIER)),
          passType:     bp.passType || "free",
          claimedTiers: bp.claimedTiers || [],
          premiumUnlockedAt: bp.premiumUnlockedAt?.toMillis?.() || null,
        };
      }

      // Timestamps → ms for easy client formatting
      const toMs = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : t || null);

      return res.status(200).json({
        activeSeason: {
          seasonId:            season.seasonId || activeSeasonId,
          name:                season.name,
          description:         season.description || "",
          startDate:           toMs(season.startDate),
          endDate:             toMs(season.endDate),
          premiumPriceARCADE:  season.premiumPriceARCADE || 100,
          xpPerTier:           XP_PER_TIER,
          numTiers:            MAX_TIER,
          tiers:               season.tiers || [],
          active:              !!season.active,
        },
        player,
      });
    } catch (err) {
      console.error("[battle-bp-status]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST battle-bp-sign-tier-claim ──────────────────────────────────────
  // Player claims a specific tier's reward. Validates:
  //   - Season is active
  //   - Player's currentTier >= requested tier (unlocked)
  //   - Tier not already claimed
  //   - Track = "free" OR passType === "premium"
  //
  // Returns an ECDSA-signed claim payload identical in shape to
  // battle-sign-claim. The frontend then calls BattleArena.claim() with the
  // payload, minting the ARCADE reward. Backend marks tier as claimed only
  // after battle-bp-record-tier-claim confirms the on-chain tx.
  //
  // Body: { tier, track: "free"|"premium", chain }
  if (req.method === "POST" && action === "battle-bp-sign-tier-claim") {
    const bUser = verifyToken(req);
    if (!bUser) return res.status(401).json({ error: "Unauthorized" });

    const { tier, track, chain } = req.body;
    if (tier == null || !track || !chain)
      return res.status(400).json({ error: "tier, track, chain required" });
    if (track !== "free" && track !== "premium")
      return res.status(400).json({ error: "track must be free or premium" });

    const tierNum  = parseInt(tier);
    const chainKey = String(chain).toLowerCase();

    const battleArenaAddr = BATTLE_ARENA_ADDRESSES[chainKey];
    const chainId         = CHAIN_IDS[chainKey];
    if (!battleArenaAddr || !chainId)
      return res.status(400).json({ error: `Battle Arena not deployed on ${chainKey}` });

    const pk = process.env.SCORE_SIGNER_PRIVATE_KEY;
    if (!pk) return res.status(503).json({ error: "Claim signing not configured" });

    if (!rateLimit(`bp-claim:${bUser.address}`, 20, 60_000))
      return res.status(429).json({ error: "Too many claim requests" });

    try {
      const activeSeasonId = await _getActiveSeasonId(db);
      if (!activeSeasonId) return res.status(404).json({ error: "No active season" });

      const seasonSnap = await db.collection("battlePassSeasons").doc(activeSeasonId).get();
      if (!seasonSnap.exists) return res.status(404).json({ error: "Season config missing" });
      const season = seasonSnap.data();

      const XP_PER_TIER = season.xpPerTier || 500;
      const MAX_TIER    = season.numTiers  || 50;
      if (!(tierNum >= 1 && tierNum <= MAX_TIER))
        return res.status(400).json({ error: `Tier must be 1-${MAX_TIER}` });

      const tierConfig = (season.tiers || []).find(t => t.tier === tierNum);
      if (!tierConfig) return res.status(404).json({ error: `Tier ${tierNum} not configured` });

      const reward = tierConfig[track] || {};
      const arcadeAmount = Number(reward.arcade) || 0;
      if (arcadeAmount <= 0)
        return res.status(400).json({ error: `Tier ${tierNum} ${track} has no ARCADE reward` });

      // Player state check
      const bpRef  = db.collection("playerBattlePass").doc(bUser.address.toLowerCase());
      const bpSnap = await bpRef.get();
      if (!bpSnap.exists) return res.status(409).json({ error: "No BP progress yet" });
      const bp = bpSnap.data();

      if (bp.seasonId !== activeSeasonId)
        return res.status(409).json({ error: "Season mismatch — refresh page" });

      const currentTier = Math.min(MAX_TIER, Math.floor((bp.seasonXP || 0) / XP_PER_TIER));
      if (tierNum > currentTier)
        return res.status(409).json({ error: `Tier ${tierNum} not unlocked yet` });

      if (track === "premium" && bp.passType !== "premium")
        return res.status(403).json({ error: "Premium not unlocked" });

      const claimKey = `${activeSeasonId}:${tierNum}:${track}`;
      if ((bp.claimedTiers || []).includes(claimKey))
        return res.status(409).json({ error: "Tier reward already claimed" });

      // Derive sessionId for BattleArena.claim() — must be unique per
      // (season, tier, track, address) so contract's claimedSessions map
      // blocks replays exactly like it does for regular battle sessions.
      const sessionIdSource = `bp:${activeSeasonId}:${tierNum}:${track}:${bUser.address.toLowerCase()}`;
      const sessionIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(sessionIdSource));

      const player      = bUser.address;
      const chainIdBn   = BigInt(chainId);
      const arcadeBn    = BigInt(arcadeAmount);

      const signerWallet = new ethers.Wallet(pk);
      const messageHash  = ethers.solidityPackedKeccak256(
        ["address", "bytes32", "uint256", "address", "uint256"],
        [player, sessionIdBytes32, arcadeBn, battleArenaAddr, chainIdBn]
      );
      const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));

      return res.status(200).json({
        sessionIdBytes32,
        dollars:     arcadeAmount.toString(),
        signature,
        battleArena: battleArenaAddr,
        chainId,
        tier:        tierNum,
        track,
        seasonId:    activeSeasonId,
        claimKey,
      });
    } catch (err) {
      console.error("[battle-bp-sign-tier-claim]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST battle-bp-record-tier-claim ────────────────────────────────────
  // After the on-chain BattleArena.claim() tx confirms, frontend calls this
  // to mark the tier as claimed in Firestore. Body: { tier, track, txHash }.
  if (req.method === "POST" && action === "battle-bp-record-tier-claim") {
    const bUser = verifyToken(req);
    if (!bUser) return res.status(401).json({ error: "Unauthorized" });

    const { tier, track, txHash } = req.body;
    if (tier == null || !track || !txHash)
      return res.status(400).json({ error: "tier, track, txHash required" });

    try {
      const activeSeasonId = await _getActiveSeasonId(db);
      if (!activeSeasonId) return res.status(404).json({ error: "No active season" });
      const claimKey = `${activeSeasonId}:${parseInt(tier)}:${track}`;

      const bpRef = db.collection("playerBattlePass").doc(bUser.address.toLowerCase());
      await bpRef.update({
        claimedTiers: admin.firestore.FieldValue.arrayUnion(claimKey),
        updatedAt: new Date(),
      });

      await db.collection("battleBPClaimLog").add({
        address:  bUser.address.toLowerCase(),
        seasonId: activeSeasonId,
        tier:     parseInt(tier),
        track,
        claimKey,
        txHash,
        at:       new Date(),
      }).catch(() => {});

      return res.status(200).json({ ok: true, claimKey });
    } catch (err) {
      console.error("[battle-bp-record-tier-claim]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST battle-bp-unlock-premium (MVP — Firestore-only) ────────────────
  // Marks the player as premium for the active season. In v2 this will be
  // gated by an on-chain ARCADE payment via the BattleShop purchase flow.
  // For MVP: any authenticated call succeeds so we can test the UX end-to-end.
  // Admin can lock this behind an env flag when going live.
  if (req.method === "POST" && action === "battle-bp-unlock-premium") {
    const bUser = verifyToken(req);
    if (!bUser) return res.status(401).json({ error: "Unauthorized" });

    if (process.env.BATTLE_BP_ALLOW_FREE_PREMIUM_UNLOCK !== "1")
      return res.status(503).json({ error: "Premium unlock is coming in the next release (on-chain payment flow — Turn 2)." });

    try {
      const activeSeasonId = await _getActiveSeasonId(db);
      if (!activeSeasonId) return res.status(404).json({ error: "No active season" });

      const bpRef = db.collection("playerBattlePass").doc(bUser.address.toLowerCase());
      await bpRef.set({
        address:  bUser.address.toLowerCase(),
        seasonId: activeSeasonId,
        passType: "premium",
        premiumUnlockedAt: new Date(),
        updatedAt: new Date(),
      }, { merge: true });

      return res.status(200).json({ ok: true, passType: "premium" });
    } catch (err) {
      console.error("[battle-bp-unlock-premium]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BATTLE PASS ADMIN
  // ═══════════════════════════════════════════════════════════════════════

  // ── GET admin-bp-seasons-list ───────────────────────────────────────────
  if (req.method === "GET" && action === "admin-bp-seasons-list") {
    if (!(await checkOnChainAdmin(user.address)))
      return res.status(403).json({ error: "Admin only" });
    try {
      const snap = await db.collection("battlePassSeasons").get();
      const seasons = [];
      const toMs = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : t || null);
      snap.forEach(doc => {
        const d = doc.data();
        seasons.push({
          seasonId:            doc.id,
          name:                d.name || "",
          description:         d.description || "",
          startDate:           toMs(d.startDate),
          endDate:             toMs(d.endDate),
          premiumPriceARCADE:  d.premiumPriceARCADE || 100,
          xpPerTier:           d.xpPerTier || 500,
          numTiers:            d.numTiers  || 50,
          active:              !!d.active,
          tierCount:           (d.tiers || []).length,
        });
      });
      seasons.sort((a, b) => (b.startDate || 0) - (a.startDate || 0));
      return res.status(200).json({ seasons });
    } catch (err) {
      console.error("[admin-bp-seasons-list]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST admin-bp-create-default-season ─────────────────────────────────
  // One-click season seeder — generates a 30-day season with 50 tiers of
  // escalating ARCADE rewards. Handy for testing + reasonable production
  // default. Items assigned in Turn 2 via editor UI.
  if (req.method === "POST" && action === "admin-bp-create-default-season") {
    if (!(await checkOnChainAdmin(user.address)))
      return res.status(403).json({ error: "Admin only" });

    const { name, description, durationDays, numTiers, xpPerTier, premiumPriceARCADE } = req.body;

    try {
      const { randomUUID } = await import("crypto");
      const seasonId    = `season_${Date.now()}_${randomUUID().substring(0, 6)}`;
      const now         = new Date();
      const days        = Number(durationDays) || 30;
      const endDate     = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      const nT          = Math.max(10, Math.min(100, Number(numTiers) || 50));
      const xpT         = Math.max(100, Math.min(5000, Number(xpPerTier) || 500));

      // Default tier rewards — escalating ARCADE amounts.
      // Free track: 5-50 ARCADE gradient; Premium track: 3x + item slots.
      const tiers = [];
      for (let i = 1; i <= nT; i++) {
        const isMilestone   = i % 5 === 0;
        const isBigMilestone = i % 10 === 0;
        const isFinal        = i === nT;
        const freeArcade     = Math.round(3 + (i / nT) * 47);           // 3 → 50
        const premiumArcade  = Math.round(10 + (i / nT) * 140);         // 10 → 150
        tiers.push({
          tier: i,
          free: {
            arcade: freeArcade,
            itemId: "",   // Turn 2 — attach shop items
          },
          premium: {
            arcade: isFinal ? premiumArcade * 3 : (isBigMilestone ? premiumArcade * 2 : premiumArcade),
            itemId: "",
          },
          isMilestone,
          isBigMilestone,
          isFinal,
        });
      }

      await db.collection("battlePassSeasons").doc(seasonId).set({
        seasonId,
        name:                name        || `Season ${new Date().toLocaleDateString()}`,
        description:         description || "",
        startDate:           now,
        endDate,
        premiumPriceARCADE:  Number(premiumPriceARCADE) || 100,
        xpPerTier:           xpT,
        numTiers:            nT,
        active:              false,   // admin activates separately
        tiers,
        createdAt:           now,
        createdBy:           user.address.toLowerCase(),
      });

      await db.collection("adminAudit").add({
        kind: "bpSeasonCreate", admin: user.address.toLowerCase(),
        seasonId, at: new Date(),
      }).catch(() => {});

      return res.status(200).json({ ok: true, seasonId });
    } catch (err) {
      console.error("[admin-bp-create-default-season]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST admin-bp-set-active-season ─────────────────────────────────────
  if (req.method === "POST" && action === "admin-bp-set-active-season") {
    if (!(await checkOnChainAdmin(user.address)))
      return res.status(403).json({ error: "Admin only" });

    const { seasonId } = req.body;
    if (!seasonId) return res.status(400).json({ error: "seasonId required" });

    try {
      // Deactivate all currently-active seasons
      const activeSnap = await db.collection("battlePassSeasons")
        .where("active", "==", true).get();
      const batch = db.batch();
      activeSnap.forEach(doc => batch.update(doc.ref, { active: false, updatedAt: new Date() }));

      const targetRef = db.collection("battlePassSeasons").doc(seasonId);
      const targetSnap = await targetRef.get();
      if (!targetSnap.exists) return res.status(404).json({ error: "Season not found" });
      batch.update(targetRef, { active: true, updatedAt: new Date() });
      await batch.commit();

      await db.collection("battlePassActive").doc("config").set({
        activeSeasonId: seasonId,
        updatedAt: new Date(),
        updatedBy: user.address.toLowerCase(),
      }, { merge: true });

      return res.status(200).json({ ok: true, activeSeasonId: seasonId });
    } catch (err) {
      console.error("[admin-bp-set-active-season]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST admin-bp-delete-season ─────────────────────────────────────────
  if (req.method === "POST" && action === "admin-bp-delete-season") {
    if (!(await checkOnChainAdmin(user.address)))
      return res.status(403).json({ error: "Admin only" });
    const { seasonId } = req.body;
    if (!seasonId) return res.status(400).json({ error: "seasonId required" });
    try {
      await db.collection("battlePassSeasons").doc(seasonId).delete();
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[admin-bp-delete-season]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "Invalid action" });
}

// ═════════════════════════════════════════════════════════════════════════
// BP helpers (outside handler to keep them warm across invocations)
// ═════════════════════════════════════════════════════════════════════════
// ─── Item slot resolver (single source of truth) ───
// Admin can set an explicit "slot" on a shop item (dropdown in admin UI).
// If not set, we derive it from itemId by splitting on the first "_".
// Examples:
//   { itemId: "AK47_RED",     slot: "" }        → "AK47"
//   { itemId: "AK47_GOLD",    slot: "" }        → "AK47"    (same slot — mutually exclusive)
//   { itemId: "AK47_RED_V2",  slot: "" }        → "AK47"    (only first "_" splits)
//   { itemId: "custom_thing", slot: "PISTOL" }  → "PISTOL"  (admin override wins)
function _getItemSlot(item) {
  if (item.slot && String(item.slot).trim()) return String(item.slot).trim().toUpperCase();
  const parts = String(item.itemId || "").split("_");
  return (parts[0] || item.itemId || "").toUpperCase();
}

let _bpActiveCache = { seasonId: null, at: 0 };
async function _getActiveSeasonId(db) {
  // 30-sec in-memory cache to save Firestore reads on hot paths (battle-round)
  if (_bpActiveCache.seasonId && Date.now() - _bpActiveCache.at < 30_000) {
    return _bpActiveCache.seasonId;
  }
  try {
    const cfg = await db.collection("battlePassActive").doc("config").get();
    if (cfg.exists) {
      const id = cfg.data().activeSeasonId;
      _bpActiveCache = { seasonId: id, at: Date.now() };
      return id;
    }
    // Fallback: query battlePassSeasons where active=true
    const snap = await db.collection("battlePassSeasons").where("active", "==", true).limit(1).get();
    if (!snap.empty) {
      const id = snap.docs[0].id;
      _bpActiveCache = { seasonId: id, at: Date.now() };
      return id;
    }
  } catch (err) {
    console.error("[_getActiveSeasonId]", err);
  }
  return null;
}