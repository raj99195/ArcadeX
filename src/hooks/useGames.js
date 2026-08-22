// src/hooks/useGames.js
import { useState, useEffect } from "react";

// ── sessionStorage helpers ──
// SH0030/SH0035 — cost-explosion fix + longer TTL. Har page navigation pe
// useGames() re-fire hoke same list fetch karta tha — 300 users × 15
// navigations = 4500 duplicate calls/day. Backend pe bhi Edge cache
// (5 min) added hai, but client-side sessionStorage 10-min cache means
// users ka apna session bhi duplicate calls nahi karta — CDN hit bhi
// save hote hain.
//
// TTL choice: 10 min. Approved games ki list rarely changes hourly.
// User apna tab 10+ min tak open rakhe (rare), phir action-driven cache-
// bust hai (post-submit, admin actions).
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function readCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, at } = JSON.parse(raw);
    if (Date.now() - at > CACHE_TTL_MS) return null;
    return data;
  } catch { return null; }
}

function writeCache(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ data, at: Date.now() }));
  } catch { /* quota exceeded / private mode — silently skip */ }
}

// ── Public helper: force cache invalidation ─────────────────────────
// SH0035 — call this after user-initiated actions that should reflect
// immediately (score submit, game create, like, etc.) so the next
// useGames() re-fetches fresh data. Usage:
//   import { bustGamesCache } from "../hooks/useGames";
//   bustGamesCache();
export function bustGamesCache() {
  try {
    sessionStorage.removeItem("useGames:list");
    // Also clear any per-user caches — key prefix scan
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith("useCreatorGames:")) {
        sessionStorage.removeItem(key);
      }
    }
  } catch { /* silent */ }
}

// ── Public games (approved only) — Home, Leaderboard, etc. ──
export function useGames() {
  const [games, setGames] = useState(() => readCache("useGames:list") || []);
  const [loading, setLoading] = useState(() => !readCache("useGames:list"));

  useEffect(() => {
    // Cache hit → skip fetch entirely
    const cached = readCache("useGames:list");
    if (cached) {
      setGames(cached);
      setLoading(false);
      return;
    }

    const fetchGames = async () => {
      try {
        const res = await fetch("/api/games?action=list");
        const data = await res.json();
        const formatted = (data.games || []).map(g => ({
          ...g,
          id: g.gameId,
          emoji: "🎮",
          bg: "#0d1a10",
          tag: null,
          plays: g.plays || 0,
          reward: g.rewardRate || 50,
        }));
        setGames(formatted);
        writeCache("useGames:list", formatted);
      } catch (err) {
        console.error("Games fetch failed:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchGames();
  }, []);

  return { games, loading };
}

// ── Creator games (all statuses) — CreatorGameDetail, Creator Dashboard ──
// Per-user cache key (address-scoped) so switching wallets doesn't leak
// data across accounts.
export function useCreatorGames() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchGames = async () => {
      try {
        const token = localStorage.getItem("arcadex_jwt");
        if (!token) { setLoading(false); return; }

        // Cache key scoped to address so wallet-switch doesn't leak
        const addr = localStorage.getItem("arcadex_jwt_address") || "anon";
        const cacheKey = `useCreatorGames:${addr}`;
        const cached = readCache(cacheKey);
        if (cached) {
          setGames(cached);
          setLoading(false);
          return;
        }

        const res = await fetch("/api/games?action=creator-games", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        const formatted = (data.games || []).map(g => ({
          ...g,
          id: g.gameId,
          emoji: "🎮",
          bg: "#0d1a10",
          tag: null,
          plays: g.plays || 0,
          reward: g.rewardRate || 50,
        }));
        setGames(formatted);
        writeCache(cacheKey, formatted);
      } catch (err) {
        console.error("Creator games fetch failed:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchGames();
  }, []);

  return { games, loading };
}