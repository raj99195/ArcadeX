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
export async function saveGame({ gameId, name, description, iframeUrl, thumbnailUrl, category, rewardRate, creator, txHash }) {
  return apiCall("/api/games?action=save-game", {
    method: "POST",
    body: { gameId, name, description, iframeUrl, thumbnailUrl, category, rewardRate, creator, txHash },
  });
}

// ── Creator save ──
export async function saveCreator({ address, displayName }) {
  return apiCall("/api/creators", {
    method: "POST",
    body: { displayName },
  });
}

// ── Creator register ──
export async function registerCreator({ address, displayName }) {
  return apiCall("/api/creators", {
    method: "POST",
    body: { displayName },
  });
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
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
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
  } catch {
    return 1;
  }
}

// ── Creator games ──
export async function getGamesByCreator(creatorAddress) {
  try {
    const data = await apiCall("/api/games?action=list");
    const games = (data.games || []).filter(g =>
      g.creator?.toLowerCase() === creatorAddress?.toLowerCase()
    );
    return games.sort((a, b) => (b.gameId || 0) - (a.gameId || 0));
  } catch { return []; }
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
  return apiCall("/api/admin/games?action=approve", {
    method: "POST",
    body: { gameId },
  });
}

// ── Reject game (Admin) ──
export async function rejectGameInFirebase(gameId) {
  return apiCall("/api/admin/games?action=reject", {
    method: "POST",
    body: { gameId },
  });
}

// ── Total games count ──
export async function getTotalGamesCount() {
  try {
    const data = await apiCall("/api/games?action=list");
    return (data.games || []).length;
  } catch { return 0; }
}

// ── Save score ──
export async function saveScore({ player, score, gameId, gameName, txHash }) {
  try {
    await apiCall("/api/games?action=score", {
      method: "POST",
      body: { player, score, gameId, gameName, txHash },
    });
  } catch (err) {
    console.error("Score save failed:", err);
  }
}

// ── Get all scores ──
export async function getScores() {
  try {
    const data = await apiCall("/api/games?action=scores");
    return data.scores || [];
  } catch {
    console.error("Scores fetch failed");
    return [];
  }
}

// ── Get scores by game ──
export async function getScoresByGame(gameId) {
  try {
    const data = await apiCall("/api/games?action=scores");
    return (data.scores || []).filter(s => s.gameId === parseInt(gameId));
  } catch { return []; }
}