// src/hooks/useGames.js
import { useState, useEffect } from "react";

export function useGames() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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