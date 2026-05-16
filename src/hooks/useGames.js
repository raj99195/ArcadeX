import { useState, useEffect } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";

export function useGames() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchGames = async () => {
      try {
        const q = query(
          collection(db, "games"),
          where("status", "==", "approved")
        );
        const snap = await getDocs(q);
        const data = snap.docs.map(d => ({
          ...d.data(),
          id: d.data().gameId,
          emoji: "🎮",
          bg: "#0d1a10",
          tag: null,
          plays: d.data().plays || 0,
          reward: d.data().rewardRate || 50,
        }));
        setGames(data);
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