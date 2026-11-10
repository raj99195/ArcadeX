// Place at: src/hooks/useArcadeCoins.js
import { useState, useEffect, useCallback } from "react";
import { useWeb2Auth } from "./useWeb2Auth";

/**
 * Web2 user ka ArcadeCoin balance + stats.
 *
 * Parallel hook to useArcadeBalance (which reads on-chain ARCADE/MSTC).
 * Yeh backend `/api/games?action=web2-user-stats` se Firebase ID token
 * ke saath data fetch karta hai. Guest mode mein balance always 0.
 *
 * Auto-refresh every 30s. Also exposes `refetch()` for manual trigger
 * (e.g. after score submission).
 *
 * Returned shape:
 *   {
 *     balance: number,              // totalArcadeCoins
 *     stats: {                      // full user stats or null
 *       totalArcadeCoins, totalPlays, lastPlayed,
 *       todayEarned, dailyCap, remainingToday,
 *       displayName, photoURL, provider
 *     } | null,
 *     loading: boolean,
 *     refetch: () => Promise<void>,
 *   }
 */
export function useArcadeCoins() {
  const { user: web2User, isGuest } = useWeb2Auth();
  const [balance, setBalance] = useState(0);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    // Guest: no backend state, no fetch
    if (!web2User || isGuest || !web2User.firebaseUser) {
      setBalance(0);
      setStats(null);
      return;
    }
    setLoading(true);
    try {
      const idToken = await web2User.firebaseUser.getIdToken();
      const res = await fetch("/api/games?action=web2-user-stats", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBalance(Number(data.totalArcadeCoins) || 0);
        setStats(data);
      } else {
        // Non-OK response — don't nuke existing state, just log
        console.warn("[useArcadeCoins] non-ok:", res.status);
      }
    } catch (e) {
      console.warn("[useArcadeCoins] fetch failed:", e.message);
    } finally {
      setLoading(false);
    }
  }, [web2User, isGuest]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30_000); // auto-refresh 30s
    return () => clearInterval(interval);
  }, [fetchStats]);

  return { balance, stats, loading, refetch: fetchStats };
}
