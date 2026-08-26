// src/lib/gameService.js — All Firebase calls replaced with API calls
// ── helpers ──
async function apiCall(url, options = {}) {
  const token = localStorage.getItem("arcadex_jwt");
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "API error");
  return data;
}
// Bech32 → Hex (unchanged)
export function bech32ToHex(addr) {
  const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const stripped = addr.slice(addr.indexOf("1") + 1);
  const data = [];
  for (const c of stripped) {
    const idx = charset.indexOf(c);
    if (idx !== -1) data.push(idx);
  }
  const result = [];
  let acc = 0, bits = 0;
  for (const val of data.slice(0, -6)) {
    acc = ((acc << 5) | val) & 0x1fff;
    bits += 5;
    if (bits >= 8) { bits -= 8; result.push((acc >> bits) & 0xff); }
  }
  return "0x" + result.map(b => b.toString(16).padStart(2, "0")).join("");
}
// ── Game save ──
export async function saveGame({ gameId, name, description, iframeUrl, thumbnailUrl, category, rewardRate, rewardRateNative, creator, txHash }) {
  return apiCall("/api/games?action=save-game", {
    method: "POST",
    body: { gameId, name, description, iframeUrl, thumbnailUrl, category, rewardRate, rewardRateNative, creator, txHash },
  });
}
// ── Creator save ──
export async function saveCreator({ address, displayName }) {
  return apiCall("/api/creators", { method: "POST", body: { displayName } });
}
// ── Creator register ──
export async function registerCreator({ address, displayName }) {
  return apiCall("/api/creators", { method: "POST", body: { displayName } });
}
// ── Game by ID ──
export async function getGameById(gameId) {
  try {
    const data = await apiCall(`/api/games?action=stats&gameId=${gameId}`);
    return data || null;
  } catch { return null; }
}
// ── Creator status ──
export async function getCreatorStatus(address) {
  try {
    const token = localStorage.getItem("arcadex_jwt");
    const res = await fetch("/api/creators", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
// ── Next game ID ──
export async function getNextGameId() {
  try {
    const data = await apiCall("/api/games?action=list");
    const games = data.games || [];
    if (games.length === 0) return 1;
    return Math.max(...games.map(g => g.gameId || 0)) + 1;
  } catch { return 1; }
}
// ── Creator games (all statuses — pending/approved/rejected) ──
export async function getGamesByCreator(creatorAddress) {
  try {
    // Use dedicated endpoint that returns ALL games for this creator
    const data = await apiCall("/api/games?action=creator-games");
    return (data.games || []).sort((a, b) => (b.gameId || 0) - (a.gameId || 0));
  } catch {
    // Fallback: filter from public list (approved only)
    try {
      const data = await apiCall("/api/games?action=list");
      const games = (data.games || []).filter(g =>
        g.creator?.toLowerCase() === creatorAddress?.toLowerCase()
      );
      return games.sort((a, b) => (b.gameId || 0) - (a.gameId || 0));
    } catch { return []; }
  }
}
// ── Single game ──
export async function getGame(gameId) {
  try {
    const data = await apiCall(`/api/games?action=stats&gameId=${gameId}`);
    return data ? { id: String(gameId), gameId, ...data } : null;
  } catch { return null; }
}
// ── All games (Admin) ──
export async function getAllGames() {
  try {
    const data = await apiCall("/api/admin/games");
    return data.games || [];
  } catch { return []; }
}
// ── Pending games (Admin) ──
export async function getPendingGames() {
  try {
    const data = await apiCall("/api/admin/games?status=pending");
    return data.games || [];
  } catch { return []; }
}
// ── Approve game (Admin) ──
export async function approveGameInFirebase(gameId) {
  return apiCall("/api/admin/games?action=approve", { method: "POST", body: { gameId } });
}
// ── Reject game (Admin) ──
export async function rejectGameInFirebase(gameId) {
  return apiCall("/api/admin/games?action=reject", { method: "POST", body: { gameId } });
}
// ── Total games count ──
export async function getTotalGamesCount() {
  try {
    const data = await apiCall("/api/games?action=list");
    return (data.games || []).length;
  } catch { return 0; }
}
// ── Save score ──
export async function saveScore({ player, score, gameId, gameName, txHash, chain }) {
  try {
    await apiCall("/api/games?action=score", {
      method: "POST",
      body: { player, score, gameId, gameName, txHash, chain },
    });
  } catch (err) { console.error("Score save failed:", err); }
}
// ── Get all scores ──
// SH0030 — chain filter aur limit ab server-side hote hain. Pehle full
// scores collection fetch hoke JS mein filter hota tha — cost explosion.
// Ab query params se backend pe filter → sirf matching docs read.
// Default limit 500 — leaderboards/recent activity ke liye kaafi hai.
//
// SH0039 — client-side sessionStorage cache added (10-min TTL). Home.jsx
// homepage pe har mount pe 500 reads karta tha sirf top-8 leaderboard
// dikhane ke liye — 947 executions/day × 500 = 473K Firebase reads/day.
// Backend pe already Edge cache (s-maxage=120) hai, but wo tab bhi
// CDN se serve karta hai when reachable. Client cache means user ka
// apna session hi duplicate calls nahi karta — homepage bounce/return
// bhi zero-cost. Post-submit ke liye bustScoresCache() export hai.
const SCORES_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function readScoresCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, at } = JSON.parse(raw);
    if (Date.now() - at > SCORES_CACHE_TTL_MS) return null;
    return data;
  } catch { return null; }
}
function writeScoresCache(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ data, at: Date.now() }));
  } catch { /* quota / private mode — silently skip */ }
}

// Public helper — call after actions that should reflect immediately
// (score submit, admin actions). Usage:
//   import { bustScoresCache } from "../lib/gameService";
//   bustScoresCache();
export function bustScoresCache() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith("scores:")) sessionStorage.removeItem(key);
    }
  } catch { /* silent */ }
}

export async function getScores(chainKey, limit = 500) {
  const cacheKey = `scores:${chainKey || "all"}:${limit}`;

  // Cache hit → return instantly, zero network / zero Firebase read
  const cached = readScoresCache(cacheKey);
  if (cached) return cached;

  try {
    const params = new URLSearchParams();
    if (chainKey) params.set("chain", chainKey);
    if (limit)    params.set("limit", String(limit));
    const data = await apiCall(`/api/games?action=scores&${params}`);
    const scores = data.scores || [];
    writeScoresCache(cacheKey, scores);
    return scores;
  } catch {
    console.error("Scores fetch failed");
    return [];
  }
}
// ── Get scores by game ──
// SH0030 — server-side filter with limit. Pehle full collection scan +
// client-side .filter() hota tha. Ab backend Firestore query kare
// where("gameId","==",X).orderBy("createdAt").limit(100) — per-game
// leaderboard ke liye ~100 reads instead of 100K+.
// SH0039 — sessionStorage cache added (same 10-min TTL as getScores),
// so per-game leaderboards on GamePlay pages don't re-fetch on every
// navigation. Cache-bust via bustScoresCache() covers both keys.
export async function getScoresByGame(gameId, limit = 100) {
  const cacheKey = `scores:game:${gameId}:${limit}`;
  const cached = readScoresCache(cacheKey);
  if (cached) return cached;
  try {
    const data = await apiCall(`/api/games?action=scores&gameId=${gameId}&limit=${limit}`);
    const scores = data.scores || [];
    writeScoresCache(cacheKey, scores);
    return scores;
  } catch { return []; }
}
// ── Get logged-in user's own scores ──
// SH0030 — new helper. Navbar earnings panel aur profile page ke liye.
// Backend `user-scores` endpoint JWT se player identify karke sirf user
// ke scores return karta hai — no full collection scan.
export async function getUserScores() {
  try {
    const data = await apiCall("/api/games?action=user-scores");
    return data.scores || [];
  } catch { return []; }
}