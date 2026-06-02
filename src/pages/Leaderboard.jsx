import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount, usePublicClient } from "wagmi";
import { useGames } from "../hooks/useGames";
import { getScores } from "../lib/gameService";

const LEADERBOARD_ADDRESS = import.meta.env.VITE_LEADERBOARD_ADDRESS;

const LEADERBOARD_ABI = [
  {
    name: "getPlayerStats",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [
      { name: "totalScore", type: "uint256" },
      { name: "gamesPlayed", type: "uint256" },
      { name: "bestScore", type: "uint256" },
      { name: "lastGameId", type: "uint256" },
    ],
  },
];

const shortAddr = (a) => a ? a.slice(0, 8) + "..." + a.slice(-4) : "—";
const fmtScore = (s) => s >= 1000000 ? (s / 1000000).toFixed(1) + "M" : s >= 1000 ? (s / 1000).toFixed(1) + "K" : String(s || "0");

function Avatar({ player, size = 36 }) {
  const initials = player ? player.slice(2, 4).toUpperCase() : "?";
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: "linear-gradient(135deg,#7B2FFF,#00d4ff)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.3, fontWeight: 700, color: "#fff",
      fontFamily: "'Orbitron',sans-serif", flexShrink: 0,
      border: "2px solid rgba(123,47,255,0.4)",
    }}>{initials}</div>
  );
}

function ArcadeCoin({ size = 20 }) {
  return (
    <img src="/Arcade-token-logo.png" alt="A"
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      onError={e => { e.target.style.display = "none"; }}
    />
  );
}

function RankMedal({ rank }) {
  const medals = {
    1: { bg: "linear-gradient(135deg,#FFD700,#FF8C00)", shadow: "0 0 16px rgba(255,215,0,0.6)", border: "rgba(255,215,0,0.6)", text: "#FFD700" },
    2: { bg: "linear-gradient(135deg,#C0C0C0,#808080)", shadow: "0 0 12px rgba(192,192,192,0.4)", border: "rgba(192,192,192,0.5)", text: "#C0C0C0" },
    3: { bg: "linear-gradient(135deg,#CD7F32,#8B4513)", shadow: "0 0 12px rgba(205,127,50,0.4)", border: "rgba(205,127,50,0.5)", text: "#CD7F32" },
  };
  const m = medals[rank];
  if (!m) return <span style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 11, color: "#5533aa", minWidth: 28, textAlign: "center" }}>{rank}</span>;
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%",
      background: m.bg, boxShadow: m.shadow,
      border: `1.5px solid ${m.border}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Orbitron',sans-serif", fontWeight: 700, fontSize: 11,
      color: "#fff", flexShrink: 0,
    }}>{rank}</div>
  );
}

export default function Leaderboard() {
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { games } = useGames();
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("global");
  const [selectedGame, setSelectedGame] = useState("all");
  const [myStats, setMyStats] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchScores = async () => {
    setLoading(true);
    try { setScores(await getScores()); } catch { }
    setLoading(false);
  };

  const fetchMyStats = async () => {
    if (!address || !publicClient) return;
    try {
      const result = await publicClient.readContract({
        address: LEADERBOARD_ADDRESS,
        abi: LEADERBOARD_ABI,
        functionName: "getPlayerStats",
        args: [address],
      });
      setMyStats({
        totalScore: Number(result[0]),
        gamesPlayed: Number(result[1]),
        bestScore: Number(result[2]),
        lastGameId: Number(result[3]),
      });
    } catch { }
  };

  useEffect(() => {
    fetchScores();
    if (address) fetchMyStats();
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [address]);

  const refresh = async () => {
    setRefreshing(true);
    await fetchScores();
    await fetchMyStats();
    setRefreshing(false);
  };

  const globalLB = Object.values(
    scores.reduce((acc, s) => {
      const p = s.player;
      if (!acc[p]) acc[p] = { player: p, bestScore: 0, totalScore: 0, gamesPlayed: 0, bestGame: "" };
      acc[p].totalScore += s.score; acc[p].gamesPlayed += 1;
      if (s.score > acc[p].bestScore) { acc[p].bestScore = s.score; acc[p].bestGame = s.gameName; }
      return acc;
    }, {})
  ).sort((a, b) => b.bestScore - a.bestScore).map((p, i) => ({ ...p, rank: i + 1 }));

  const gameLB = (selectedGame === "all" ? scores : scores.filter(s => s.gameId === parseInt(selectedGame)))
    .sort((a, b) => b.score - a.score).map((s, i) => ({ ...s, rank: i + 1 }));

  const myRank = globalLB.findIndex(p => p.player?.toLowerCase() === address?.toLowerCase()) + 1;
  const displayData = activeTab === "global" ? globalLB : gameLB;

  const rankRowStyle = (rank, isMe) => {
    if (rank === 1) return { background: isMe ? "rgba(255,215,0,0.12)" : "rgba(255,215,0,0.07)", borderLeft: "3px solid rgba(255,215,0,0.5)" };
    if (rank === 2) return { background: isMe ? "rgba(192,192,192,0.1)" : "rgba(192,192,192,0.05)", borderLeft: "3px solid rgba(192,192,192,0.35)" };
    if (rank === 3) return { background: isMe ? "rgba(205,127,50,0.1)" : "rgba(205,127,50,0.05)", borderLeft: "3px solid rgba(205,127,50,0.35)" };
    return { background: isMe ? "rgba(123,47,255,0.12)" : "transparent", borderLeft: "3px solid transparent" };
  };

  const scoreColor = (rank) => {
    if (rank === 1) return "#FFD700";
    if (rank === 2) return "#C0C0C0";
    if (rank === 3) return "#CD7F32";
    return "#a67fff";
  };

  return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: "transparent", position: "relative", overflow: "hidden" }}>
      <style>{`
        @keyframes lbPulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes floatUp  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        .lb-row:hover { background: rgba(123,47,255,0.1) !important; }
        .tab-btn:hover { color: #c4a0ff !important; }
        .lb-scroll::-webkit-scrollbar { display: none; }
      `}</style>

      {/* Grid BG */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", background: "#08070f" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(123,47,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(123,47,255,0.07) 1px, transparent 1px)", backgroundSize: "50px 50px" }} />
        <div style={{ position: "absolute", top: "10%", left: "50%", transform: "translateX(-50%)", width: 600, height: 400, background: "radial-gradient(circle, rgba(123,47,255,0.15) 0%, transparent 70%)", borderRadius: "50%" }} />
        <div style={{ position: "absolute", bottom: 0, right: 0, width: 400, height: 400, background: "radial-gradient(circle, rgba(0,212,255,0.06) 0%, transparent 70%)", borderRadius: "50%" }} />
      </div>

      <div style={{ position: "relative", zIndex: 1 }}>

        {/* HERO HEADER */}
        <div style={{ padding: isMobile ? "20px 16px 16px" : "36px 36px 28px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", border: "1px solid rgba(123,47,255,0.2)", borderRadius: 4, fontSize: 9, color: "rgba(180,150,255,0.6)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 14, background: "rgba(123,47,255,0.06)", fontFamily: "'Rajdhani',sans-serif", fontWeight: 600 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#00FF88", animation: "lbPulse 1.5s ease-in-out infinite" }} />
            Live On-Chain Scores
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1 style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: isMobile ? 28 : 48, letterSpacing: "-0.5px", textTransform: "uppercase", lineHeight: 1, color: "#fff" }}>
              Global{" "}
              <span style={{ background: "linear-gradient(90deg,#7B2FFF,#00d4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                Leaderboard
              </span>
            </h1>
            <button onClick={refresh} disabled={refreshing} style={{
              padding: "8px 18px", background: "rgba(123,47,255,0.15)",
              border: "1px solid rgba(123,47,255,0.3)", borderRadius: 7,
              color: "#a67fff", fontSize: 11, cursor: "pointer",
              fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: "0.5px",
              transition: "all 0.2s", backdropFilter: "blur(8px)",
            }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(123,47,255,0.55)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(123,47,255,0.3)"}
            >{refreshing ? "..." : "↻ Refresh"}</button>
          </div>
          <p style={{ color: "rgba(180,150,255,0.7)", fontSize: 12, marginTop: 8, fontFamily: "'Rajdhani',sans-serif" }}>
            Tamper-proof scores from OnChain — verified every block.
          </p>
        </div>

        {/* MAIN CONTENT */}
        <div style={{ padding: isMobile ? "0 16px 24px" : "0 36px 36px", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(600px, 1fr) 340px", gap: isMobile ? 20 : 40 }}>

          {/* LEFT */}
          <div style={{ minWidth: 0 }}>
            {/* Tabs */}
            <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 20, borderBottom: "1px solid rgba(123,47,255,0.15)" }}>
              {["global", "by-game"].map(tab => (
                <button key={tab} className="tab-btn" onClick={() => setActiveTab(tab)} style={{
                  padding: "10px 22px", background: "transparent", border: "none",
                  borderBottom: activeTab === tab ? "2px solid #7B2FFF" : "1px solid transparent",
                  color: activeTab === tab ? "#c4a0ff" : "#5533aa",
                  fontSize: 12, cursor: "pointer", marginBottom: "-1px",
                  fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: "0.5px",
                  textTransform: "uppercase", transition: "color 0.18s",
                }}>{tab === "global" ? "Global" : "By Game"}</button>
              ))}
              {activeTab === "by-game" && (
                <select value={selectedGame} onChange={e => setSelectedGame(e.target.value)} style={{
                  marginLeft: 50,
                  background: "rgba(123,47,255,0.15)", border: "1px solid rgba(123,47,255,0.2)",
                  borderRadius: 6, color: "#a67fff", fontSize: 11, padding: "5px 10px",
                  cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontWeight: 600,
                  backdropFilter: "blur(8px)",
                }}>
                  <option value="all">All Games</option>
                  {games.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              )}
            </div>

            {/* TABLE */}
            <div style={{ border: "1px solid rgba(123,47,255,0.15)", borderRadius: 12, overflow: "hidden", background: "rgba(6,5,12,0.82)", backdropFilter: "blur(20px)", display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(123,47,255,0.1)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(123,47,255,0.06)" }}>
                <span style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 13, color: "#fff", letterSpacing: "0.3px" }}>
                  {activeTab === "global" ? "Top Players" : selectedGame === "all" ? "All Scores" : `Game #${selectedGame}`}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "#7755aa", fontFamily: "'Rajdhani',sans-serif" }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#00FF88", animation: "lbPulse 1.5s ease-in-out infinite" }} />
                  Live · {displayData.length} entries
                </div>
              </div>

              {/* Col headers */}
              <div style={{ display: isMobile ? "grid" : "grid", gridTemplateColumns: isMobile ? "36px 1fr 80px" : "52px 160px 1fr 130px", padding: "10px 20px", borderBottom: "1px solid rgba(123,47,255,0.08)", background: "rgba(0,0,0,0.2)" }}>
                {["Rank", "Player", activeTab === "global" ? "Best Game" : "Game", "Score"].map((h, i) => (
                  <div key={i} style={{ fontSize: 9, color: "#5533aa", textTransform: "uppercase", letterSpacing: "1.2px", textAlign: i === 2 ? "center" : i === 3 ? "right" : "left", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700 }}>{h}</div>
                ))}
              </div>

              {loading ? (
                <div style={{ padding: 48, textAlign: "center", fontSize: 12, color: "#7755aa", fontFamily: "'Rajdhani',sans-serif" }}>Loading scores...</div>
              ) : displayData.length === 0 ? (
                <div style={{ padding: 64, textAlign: "center" }}>
                  <div style={{ fontSize: 40, marginBottom: 14 }}>🏆</div>
                  <div style={{ fontSize: 13, color: "#9977cc", fontFamily: "'Rajdhani',sans-serif" }}>No scores yet</div>
                  <button onClick={() => navigate("/games")} style={{ marginTop: 12, padding: "8px 18px", background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 6, color: "#fff", fontSize: 11, cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700 }}>Play a Game →</button>
                </div>
              ) : (
                <div className="lb-scroll" style={{ overflowY: "auto", maxHeight: 520, scrollbarWidth: "none", msOverflowStyle: "none" }}>
                  {displayData.map((row, idx) => {
                    const isMe = row.player?.toLowerCase() === address?.toLowerCase();
                    const rStyle = rankRowStyle(row.rank, isMe);
                    const copyAddr = () => { if (row.player) navigator.clipboard.writeText(row.player); };
                    return (
                      <div key={idx} className="lb-row" style={{
                        display: isMobile ? "grid" : "grid", gridTemplateColumns: isMobile ? "36px 1fr 80px" : "52px 160px 1fr 130px",
                        padding: "12px 20px",
                        borderBottom: "1px solid rgba(123,47,255,0.05)",
                        transition: "background 0.15s",
                        alignItems: "center",
                        ...rStyle,
                      }}>
                        {/* Rank */}
                        <div style={{ display: "flex", alignItems: "center" }}>
                          <RankMedal rank={row.rank} />
                        </div>

                        {/* Player */}
                        <div onClick={copyAddr} title="Click to copy address" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                          <div style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: isMe ? "#00FF88" : row.rank <= 3 ? scoreColor(row.rank) : "rgba(123,47,255,0.5)", boxShadow: isMe ? "0 0 6px #00FF88" : row.rank <= 3 ? `0 0 6px ${scoreColor(row.rank)}` : "none" }} />
                          <div>
                            <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 10, color: isMe ? "#c4a0ff" : row.rank <= 3 ? scoreColor(row.rank) : "#9977cc", letterSpacing: "0.3px" }}>
                              {shortAddr(row.player)}
                            </div>
                            {isMe && <div style={{ fontSize: 9, color: "#00FF88", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, marginTop: 1 }}>← You</div>}
                          </div>
                          <svg width="11" height="11" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.55, flexShrink: 0 }}>
                            <rect x="3" y="3" width="6" height="6" rx="1" stroke="#a67fff" strokeWidth="1" />
                            <path d="M2 7V2h5" stroke="#a67fff" strokeWidth="1" strokeLinecap="round" />
                          </svg>
                        </div>

                        {/* Game */}
                        <div style={{ fontSize: 11, color: "#8866bb", fontFamily: "'Rajdhani',sans-serif", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>
                          {activeTab === "global" ? (row.bestGame || "—") : (row.gameName || `Game #${row.gameId}`)}
                        </div>

                        {/* Score */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5 }}>
                          <ArcadeCoin size={14} />
                          <span style={{ fontFamily: "'Orbitron',sans-serif", fontWeight: 700, fontSize: 13, color: scoreColor(row.rank) }}>
                            {fmtScore(activeTab === "global" ? row.bestScore : row.score)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT SIDEBAR */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Your Rank */}
            <div style={{ background: "rgba(6,5,12,0.82)", border: "1px solid rgba(123,47,255,0.12)", borderRadius: 12, padding: 20, marginTop: 35, position: "relative", overflow: "hidden", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
              <div style={{ position: "absolute", top: -20, right: -20, width: 100, height: 100, background: "radial-gradient(circle,rgba(123,47,255,0.12) 0%,transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 65 }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1l1.5 3 3.5.5-2.5 2.5.6 3.5L7 9 3.9 10.5l.6-3.5L2 4.5l3.5-.5z" fill="#7B2FFF" opacity="0.8" />
                </svg>
                <span style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 11, color: "#c4a0ff", textTransform: "uppercase", letterSpacing: "1px" }}>Your Rank</span>
              </div>
              {isConnected ? (
                myStats ? (
                  <div>
                    <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 44, fontWeight: 700, color: "#a67fff", letterSpacing: "-2px", lineHeight: 1, marginBottom: 4 }}>
                      {myRank > 0 ? `#${myRank}` : "—"}
                    </div>
                    <div style={{ fontSize: 10, color: "#5533aa", marginBottom: 16, fontFamily: "'Rajdhani',sans-serif" }}>Global ranking</div>
                    {[["Best Score", fmtScore(myStats.bestScore)], ["Total Score", fmtScore(myStats.totalScore)], ["Games Played", myStats.gamesPlayed]].map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid rgba(123,47,255,0.06)" }}>
                        <span style={{ color: "#7755aa", fontFamily: "'Rajdhani',sans-serif" }}>{k}</span>
                        <span style={{ color: "#a67fff", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700 }}>{v}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "#7755aa", fontFamily: "'Rajdhani',sans-serif", lineHeight: 1.6 }}>No scores yet — play and claim your spot!</div>
                )
              ) : (
                <div style={{ fontSize: 11, color: "#7755aa", fontFamily: "'Rajdhani',sans-serif" }}>Connect wallet to see your rank</div>
              )}
            </div>

            {/* Top Games */}
            <div style={{ background: "rgba(6,5,12,0.82)", border: "1px solid rgba(123,47,255,0.12)", borderRadius: 12, padding: 20, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="2" y="7" width="10" height="5" rx="2" stroke="#7B2FFF" strokeWidth="1.2" fill="none" />
                  <path d="M4 7V4.5M10 7V4.5" stroke="#7B2FFF" strokeWidth="1.2" strokeLinecap="round" />
                  <path d="M5 6v-2M7 6v-2M9 6v-2" stroke="#7B2FFF" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
                </svg>
                <span style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 11, color: "#c4a0ff", textTransform: "uppercase", letterSpacing: "1px" }}>Top Games</span>
              </div>
              {games.slice(0, 5).map((g, i) => {
                const cnt = scores.filter(s => s.gameId === g.id).length;
                return (
                  <div key={g.id} onClick={() => navigate(`/play/${g.id}`)}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid rgba(123,47,255,0.05)", cursor: "pointer", transition: "all 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.opacity = "0.75"}
                    onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 8, color: "#5533aa", minWidth: 14 }}>{i + 1}</span>
                      <span style={{ color: "#c4a0ff", fontFamily: "'Rajdhani',sans-serif", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 130 }}>{g.name}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <ArcadeCoin size={13} />
                      <span style={{ fontSize: 9, color: "#7755aa", fontFamily: "'Orbitron',sans-serif" }}>{cnt}</span>
                    </div>
                  </div>
                );
              })}
            </div>

           
          </div>
        </div>
      </div>
    </div>
  );
}