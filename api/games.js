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
function rateLimit(key, max = 10) {
  const now = Date.now();
  const calls = (rateLimits.get(key) || []).filter(t => t > now - 60000);
  if (calls.length >= max) return false;
  rateLimits.set(key, [...calls, now]);
  return true;
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
  if (req.method === "POST" && action === "start-session") {
    const ssUser = verifyToken(req);
    if (!ssUser) return res.status(401).json({ error: "Unauthorized" });
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

    if (!rateLimit(`sign:${signUser.address.toLowerCase()}:${gameId}`, 30))
      return res.status(429).json({ error: "Too many sign requests" });

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
      // Fully automatic, per-game, permanent — no per-game config needed.
      const MIN_PLAY_FLOOR    = 3;      // absolute floor — blocks 0s/instant submits
      const MIN_PLAY_FRACTION = 0.25;   // must play >= 25% of this game's typical time
      const minPlayRequired = (count >= LEARN_SAMPLES && avgPlaySec)
        ? Math.max(MIN_PLAY_FLOOR, avgPlaySec * MIN_PLAY_FRACTION)
        : MIN_PLAY_FLOOR;
      if (playSec < minPlayRequired)
        return res.status(400).json({ error: "Play a little longer before submitting.", minPlaySeconds: Math.ceil(minPlayRequired), softReject: true });

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