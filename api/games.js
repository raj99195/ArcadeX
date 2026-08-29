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
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: "Unauthorized — connect wallet" });

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

      // 4) On-chain se hi values lo — body ke score/earned pe trust nahi
      const onChainGameId = matched.args.gameId.toString();
      const onChainReward = Number(ethers.formatEther(matched.args.playerReward));

      await db.collection("scores").doc(txHash).set({
        player:       user.address,
        score:        parseInt(score),          // display score (game se)
        gameId:       parseInt(onChainGameId),   // on-chain verified
        gameName:     gameName || "Unknown",
        chain:        chainKey,
        earned:       onChainReward,             // on-chain verified reward
        earnedSymbol: earnedSymbol || "ARCADE",
        txHash,
        verified:     true,                      // Layer 2 stamp
        createdAt:    new Date(),
      });
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
  if (req.method === "GET" && action === "admin-player-analytics") {
    const aUser = verifyToken(req);
    if (!aUser) return res.status(401).json({ error: "Unauthorized" });
    if (!(await checkOnChainAdmin(aUser.address)))
      return res.status(403).json({ error: "Admin only" });

    try {
      // 5-min cache — same admin refreshes safe, Firestore hit only every 5 min
      res.setHeader("Cache-Control", "private, max-age=300");

      const { chain, from, to } = req.query;
      if (!chain) return res.status(400).json({ error: "chain required" });

      const fromDate = from ? new Date(from) : null;
      const toDate   = to   ? new Date(to)   : null;
      if (toDate && !isNaN(toDate)) toDate.setHours(23, 59, 59, 999);

      // Step 1: Fetch approved games for this chain — filter map + reward rates
      const gamesSnap = await db.collection("games")
        .where("status", "==", "approved").get();
      const approvedGames = {};
      gamesSnap.docs.forEach(d => {
        const g = d.data();
        const rate = g.rewardRateNative != null
          ? Number(g.rewardRateNative)
          : Number(g.rewardRate || 0) / 1e18;
        approvedGames[g.gameId] = { name: g.name, rate };
      });

      // Step 2: Fetch ALL scores for this chain. Strategy chosen for
      // reliability over efficiency — we filter by date IN MEMORY after,
      // so no composite index (chain+createdAt) is ever required. The
      // only auto-index used is the single-field `chain` index which
      // Firestore creates automatically for every collection field.
      //
      // Pagination by document ID via `orderBy(FieldPath.documentId())`
      // is guaranteed to work without any custom index. Batch size 500
      // (Firestore's recommended read batch), max 200 batches = 100K
      // scores hard safety.
      const FieldPath = admin.firestore.FieldPath;
      const BATCH_SIZE  = 500;
      const MAX_BATCHES = 200; // 100K score safety ceiling

      let allScores = [];
      let lastDoc   = null;
      let batchNum  = 0;

      try {
        for (batchNum = 0; batchNum < MAX_BATCHES; batchNum++) {
          let q = db.collection("scores")
            .where("chain", "==", chain)
            .orderBy(FieldPath.documentId())
            .limit(BATCH_SIZE);
          if (lastDoc) q = q.startAfter(lastDoc);
          const snap = await q.get();
          if (snap.empty) break;
          allScores.push(...snap.docs);
          lastDoc = snap.docs[snap.docs.length - 1];
          if (snap.docs.length < BATCH_SIZE) break; // no more pages
        }
      } catch (paginationErr) {
        // Log the exact error for debugging but don't fail — return partial
        // aggregation if we got any batches through.
        console.error(
          "[admin-analytics] pagination error at batch", batchNum,
          "— scores fetched so far:", allScores.length,
          "— error:", paginationErr?.message || paginationErr?.code || paginationErr
        );
        if (allScores.length === 0) {
          return res.status(500).json({
            error: "Firestore pagination failed",
            detail: paginationErr?.message || String(paginationErr),
            hint: "Check Vercel logs for full stack trace; may need to increase function timeout.",
          });
        }
        // Partial data — continue with what we have, note it in response
      }

      // In-memory date filter (avoids needing chain+createdAt composite index)
      if (fromDate || toDate) {
        allScores = allScores.filter(doc => {
          const s = doc.data();
          const scoreDate = s.createdAt?.toDate?.() || new Date(s.createdAt);
          if (!scoreDate || isNaN(scoreDate)) return false;
          if (fromDate && !isNaN(fromDate) && scoreDate < fromDate) return false;
          if (toDate   && !isNaN(toDate)   && scoreDate > toDate)   return false;
          return true;
        });
      }

      // Step 3: Aggregate in-memory
      const playerAgg = {};        // wallet → { plays, earned, lastPlayed, games:Set }
      const dailyAgg  = {};        // "YYYY-MM-DD" → { plays, earned, playersSet }
      const gameAgg   = {};        // gameId → { plays, earned }
      let totalPlays = 0;
      let totalPayout = 0;
      let skippedNonApproved = 0;

      // Server-side player-share fetch (settings collection)
      let playerSharePct = 100; // MST default from your earlier setup
      try {
        const settingsDoc = await db.collection("chainSettings").doc(chain).get();
        if (settingsDoc.exists) {
          const s = settingsDoc.data();
          if (s.playerPct != null) playerSharePct = Number(s.playerPct);
        }
      } catch { /* keep default */ }

      for (const doc of allScores) {
        const s = doc.data();
        const gameInfo = approvedGames[s.gameId];
        if (!gameInfo) { skippedNonApproved++; continue; }

        // Use stored `earned` if present (accurate), else calculate from rate * share
        const earned = (s.earned != null && !isNaN(s.earned))
          ? Number(s.earned)
          : gameInfo.rate * (playerSharePct / 100);

        totalPlays += 1;
        totalPayout += earned;

        // Player aggregation — LOWERCASE the wallet to prevent same player
        // being counted twice when their address is stored in mixed case
        // across different score docs (checksum vs lowercase from wagmi).
        // Without this, activePlayers count and per-player totals would
        // split across duplicate entries.
        const w = (s.player || "").toLowerCase();
        if (!w) continue; // skip malformed scores with no player
        if (!playerAgg[w]) {
          playerAgg[w] = { wallet: w, plays: 0, earned: 0, lastPlayed: null, games: new Set() };
        }
        playerAgg[w].plays += 1;
        playerAgg[w].earned += earned;
        playerAgg[w].games.add(s.gameId);
        const scoreDate = s.createdAt?.toDate?.() || new Date(s.createdAt);
        if (!playerAgg[w].lastPlayed || scoreDate > playerAgg[w].lastPlayed) {
          playerAgg[w].lastPlayed = scoreDate;
        }

        // Daily aggregation — same lowercased wallet for unique-player counting
        const dayKey = scoreDate.toISOString().slice(0, 10);
        if (!dailyAgg[dayKey]) dailyAgg[dayKey] = { plays: 0, earned: 0, playersSet: new Set() };
        dailyAgg[dayKey].plays += 1;
        dailyAgg[dayKey].earned += earned;
        dailyAgg[dayKey].playersSet.add(w);

        // Game aggregation
        if (!gameAgg[s.gameId]) gameAgg[s.gameId] = { name: gameInfo.name, plays: 0, earned: 0 };
        gameAgg[s.gameId].plays += 1;
        gameAgg[s.gameId].earned += earned;
      }

      // Step 4: Serialize for response
      const playerRows = Object.values(playerAgg)
        .map(p => ({
          wallet: p.wallet,
          plays: p.plays,
          earned: Number(p.earned.toFixed(4)),
          gamesPlayed: p.games.size,
          lastPlayed: p.lastPlayed?.toISOString() || null,
        }))
        .sort((a, b) => b.earned - a.earned);

      const dailyRows = Object.entries(dailyAgg)
        .map(([date, d]) => ({
          date,
          plays: d.plays,
          earned: Number(d.earned.toFixed(4)),
          uniquePlayers: d.playersSet.size,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const gameRows = Object.entries(gameAgg)
        .map(([gameId, g]) => ({
          gameId: Number(gameId),
          name: g.name,
          plays: g.plays,
          earned: Number(g.earned.toFixed(4)),
        }))
        .sort((a, b) => b.plays - a.plays);

      return res.status(200).json({
        summary: {
          totalPlays,
          totalPayout: Number(totalPayout.toFixed(4)),
          activePlayers: playerRows.length,
          totalGames: gameRows.length,
          avgPerPlayer: playerRows.length > 0 ? Number((totalPayout / playerRows.length).toFixed(4)) : 0,
          skippedNonApproved,
          scannedScores: allScores.length,
          playerSharePct,
        },
        players: playerRows,          // ALL players for CSV export
        daily: dailyRows,             // for chart
        games: gameRows,              // per-game breakdown
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

  return res.status(400).json({ error: "Invalid action" });
}