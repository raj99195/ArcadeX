import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount, usePublicClient } from "wagmi";
import { useGames } from "../hooks/useGames";
import { useChain } from "../context/ChainContext";

// ── On-chain leaderboard ABI ──────────────────────────────────────────────
// Scores ab seedha Leaderboard.sol contract se aate hain — Firestore se nahi.
// Yeh tamper-proof hai: score sirf recordPlayAndEarn (valid signature) se
// contract mein aata hai, isliye koi fake score leaderboard poison nahi kar sakta.
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
  {
    name: "getGameScores",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "player", type: "address" },
          { name: "score", type: "uint256" },
          { name: "timestamp", type: "uint256" },
        ],
      },
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
  if (!m) return <span style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 12, fontWeight: 700, color: "#8b6fd4", minWidth: 28, textAlign: "center" }}>{rank}</span>;
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%",
      background: m.bg, boxShadow: m.shadow,
      border: `1.5px solid ${m.border}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Orbitron',sans-serif", fontWeight: 800, fontSize: 11,
      color: "#1a1206", flexShrink: 0,
      ...(rank === 1 ? { animation: "crownGlow 2s ease-in-out infinite" } : {}),
    }}>{rank}</div>
  );
}

export default function Leaderboard() {
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { games } = useGames();
  const { contracts, chainKey, chainName } = useChain();
  const LEADERBOARD_ADDRESS = contracts?.leaderboard;
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("global");
  const [selectedGame, setSelectedGame] = useState("all");
  const [myStats, setMyStats] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // ── On-chain scores fetch ──────────────────────────────────────────────
  // Har approved game ka getGameScores() parallel me padho, phir ek flat
  // array banao jisme har entry { player, score, gameId, gameName } ho —
  // wahi shape jo pehle Firestore deta tha, taaki neeche ki UI same rahe.
  const fetchScores = async () => {
    if (!publicClient || !LEADERBOARD_ADDRESS || !games?.length) {
      setScores([]); setLoading(false); return;
    }
    setLoading(true);
    try {
      const results = await Promise.all(
        games.map(async (g) => {
          try {
            const entries = await publicClient.readContract({
              address: LEADERBOARD_ADDRESS,
              abi: LEADERBOARD_ABI,
              functionName: "getGameScores",
              args: [BigInt(g.id)],
            });
            return entries.map((e) => ({
              player:    e.player,
              score:     Number(e.score),
              gameId:    g.id,
              gameName:  g.name,
              timestamp: Number(e.timestamp),
            }));
          } catch {
            return []; // is game ke koi score nahi / call fail
          }
        })
      );
      // flatten
      setScores(results.flat());
    } catch {
      setScores([]);
    }
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
    // games/chain change pe re-fetch — scores ab on-chain per-game aate hain
  }, [address, chainKey, games?.length, LEADERBOARD_ADDRESS]);

  const refresh = async () => {
    setRefreshing(true);
    await fetchScores();
    await fetchMyStats();
    setRefreshing(false);
  };

  // ── Anti-cheat display filter (Option B) ──────────────────────────────────
  // Purane cheated scores (jab Layer 1 nahi tha) contract pe rehte hain,
  // lekin UI pe hide karte hain. Contract untouched — sirf display filter.
  // Tunable thresholds:
  const CHEAT_FILTER = {
    maxSingleScore: 20000,   // koi bhi single score isse upar → suspicious
    maxScorePerPlay: 15000,  // best/plays ratio isse upar → suspicious (1 play me huge)
  };

  // Ek individual score suspicious hai?
  const isSuspiciousScore = (score) => score > CHEAT_FILTER.maxSingleScore;

  // Ek aggregated player suspicious hai?
  const isSuspiciousPlayer = (p) => {
    if (p.bestScore > CHEAT_FILTER.maxSingleScore) return true;
    const ratio = p.gamesPlayed > 0 ? p.bestScore / p.gamesPlayed : p.bestScore;
    return ratio > CHEAT_FILTER.maxScorePerPlay;
  };

  const globalLB = Object.values(
    scores.reduce((acc, s) => {
      const key = s.player?.toLowerCase();          // aggregate case-insensitively
      if (!key) return acc;
      if (!acc[key]) acc[key] = { player: s.player, bestScore: 0, totalScore: 0, gamesPlayed: 0, bestGame: "" };
      acc[key].totalScore += s.score; acc[key].gamesPlayed += 1;
      if (s.score > acc[key].bestScore) { acc[key].bestScore = s.score; acc[key].bestGame = s.gameName; }
      return acc;
    }, {})
  )
    .filter(p => !isSuspiciousPlayer(p))            // ← cheaters hide
    .sort((a, b) => b.bestScore - a.bestScore).map((p, i) => ({ ...p, rank: i + 1 }));

  const gameLB = (selectedGame === "all" ? scores : scores.filter(s => String(s.gameId) === String(selectedGame)))
    .filter(s => !isSuspiciousScore(s.score))       // ← cheated scores hide
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
        @keyframes lbRowIn { from { opacity:0; transform: translateX(-12px); } to { opacity:1; transform: translateX(0); } }
        @keyframes shimmer { 0%{ background-position: -200% 0; } 100%{ background-position: 200% 0; } }
        @keyframes crownGlow { 0%,100%{ filter: drop-shadow(0 0 3px rgba(255,215,0,0.6)); } 50%{ filter: drop-shadow(0 0 10px rgba(255,215,0,1)); } }
        @keyframes goldSweep { 0%{ transform: translateX(-100%); } 100%{ transform: translateX(200%); } }
        @keyframes rankBounce { 0%{ transform: scale(0.6); opacity:0; } 60%{ transform: scale(1.12); } 100%{ transform: scale(1); opacity:1; } }
        @keyframes gradShift { 0%{ background-position:0% 50%; } 50%{ background-position:100% 50%; } 100%{ background-position:0% 50%; } }
        @keyframes scorePop { 0%{ transform: scale(1); } 50%{ transform: scale(1.06); } 100%{ transform: scale(1); } }

        .lb-row { animation: lbRowIn 0.4s ease both; }
        .lb-row:hover { background: rgba(123,47,255,0.14) !important; transform: translateX(3px); box-shadow: inset 3px 0 0 rgba(166,127,255,0.6); }
        .lb-row { transition: background 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease; }

        .tab-btn:hover { color: #d9c4ff !important; }
        .lb-scroll::-webkit-scrollbar { display: none; }

        .rank-1-row { position: relative; }
        .rank-1-row::after {
          content: ""; position: absolute; top:0; left:0; height:100%; width:60px;
          background: linear-gradient(90deg, transparent, rgba(255,215,0,0.18), transparent);
          animation: goldSweep 3.5s ease-in-out infinite; pointer-events:none;
        }
        .lb-title-grad {
          background: linear-gradient(90deg,#a67fff,#00d4ff,#a67fff,#ff6ec4,#a67fff);
          background-size: 300% auto;
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: gradShift 6s linear infinite;
        }
        .medal-anim { animation: rankBounce 0.5s cubic-bezier(0.34,1.56,0.64,1) both; }
        .refresh-spin:hover svg { transform: rotate(180deg); transition: transform 0.4s ease; }
      `}</style>

      {/* Grid BG */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", background: "#08070f" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(123,47,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(123,47,255,0.07) 1px, transparent 1px)", backgroundSize: "50px 50px" }} />
        <div style={{ position: "absolute", top: "10%", left: "50%", transform: "translateX(-50%)", width: 600, height: 400, background: "radial-gradient(circle, rgba(123,47,255,0.15) 0%, transparent 70%)", borderRadius: "50%", animation: "floatUp 8s ease-in-out infinite" }} />
        <div style={{ position: "absolute", bottom: 0, right: 0, width: 400, height: 400, background: "radial-gradient(circle, rgba(0,212,255,0.06) 0%, transparent 70%)", borderRadius: "50%", animation: "floatUp 10s ease-in-out infinite" }} />
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
              <span className="lb-title-grad">
                Leaderboard
              </span>
            </h1>
            {chainName && (
              <span style={{ fontSize: 9, padding: "3px 10px", background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 10, color: "#00d4ff", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: "0.5px", whiteSpace: "nowrap" }}>
                {chainName}
              </span>
            )}
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
            {chainName ? `${chainName} scores — switch chain in navbar to see other chains.` : "Tamper-proof scores from OnChain — verified every block."}
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
                  <div key={i} style={{ fontSize: 9, color: "#7a5fc0", textTransform: "uppercase", letterSpacing: "1.2px", textAlign: i === 2 ? "center" : i === 3 ? "right" : "left", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700 }}>{h}</div>
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
                      <div key={idx} className={`lb-row${row.rank === 1 ? " rank-1-row" : ""}`} style={{
                        display: isMobile ? "grid" : "grid", gridTemplateColumns: isMobile ? "36px 1fr 80px" : "52px 160px 1fr 130px",
                        padding: "12px 20px",
                        borderBottom: "1px solid rgba(123,47,255,0.05)",
                        alignItems: "center",
                        animationDelay: `${Math.min(idx * 0.04, 0.6)}s`,
                        ...rStyle,
                      }}>
                        {/* Rank */}
                        <div style={{ display: "flex", alignItems: "center" }} className="medal-anim">
                          <RankMedal rank={row.rank} />
                        </div>

                        {/* Player */}
                        <div onClick={copyAddr} title="Click to copy address" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                          <div style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: isMe ? "#00FF88" : row.rank <= 3 ? scoreColor(row.rank) : "rgba(123,47,255,0.5)", boxShadow: isMe ? "0 0 6px #00FF88" : row.rank <= 3 ? `0 0 6px ${scoreColor(row.rank)}` : "none" }} />
                          <div>
                            <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 10, color: isMe ? "#d4b8ff" : row.rank <= 3 ? scoreColor(row.rank) : "#b79aeb", letterSpacing: "0.3px", fontWeight: row.rank <= 3 ? 700 : 500 }}>
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
                        <div style={{ textAlign: "center", overflow: "hidden" }}>
                          <span style={{
                            fontSize: 11, color: "#b79aeb", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            display: "inline-block", maxWidth: "100%",
                            padding: "3px 10px", borderRadius: 20,
                            background: "rgba(123,47,255,0.1)", border: "1px solid rgba(123,47,255,0.15)",
                          }}>
                            {activeTab === "global" ? (row.bestGame || "—") : (row.gameName || `Game #${row.gameId}`)}
                          </span>
                        </div>

                        {/* Score */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                          <ArcadeCoin size={14} />
                          <span style={{
                            fontFamily: "'Orbitron',sans-serif", fontWeight: 800, fontSize: 14,
                            color: row.rank <= 3 ? scoreColor(row.rank) : "#d9c4ff",
                            textShadow: row.rank <= 3 ? `0 0 12px ${scoreColor(row.rank)}88` : "none",
                            letterSpacing: "0.3px",
                          }}>
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
                    <div className="lb-title-grad" style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 44, fontWeight: 800, letterSpacing: "-2px", lineHeight: 1, marginBottom: 4 }}>
                      {myRank > 0 ? `#${myRank}` : "—"}
                    </div>
                    <div style={{ fontSize: 10, color: "#7a5fc0", marginBottom: 16, fontFamily: "'Rajdhani',sans-serif", fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase" }}>Global ranking</div>
                    {[["Best Score", fmtScore(myStats.bestScore)], ["Total Score", fmtScore(myStats.totalScore)], ["Games Played", myStats.gamesPlayed]].map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid rgba(123,47,255,0.06)" }}>
                        <span style={{ color: "#8b6fd4", fontFamily: "'Rajdhani',sans-serif", fontWeight: 600 }}>{k}</span>
                        <span style={{ color: "#d4b8ff", fontFamily: "'Orbitron',sans-serif", fontWeight: 700, fontSize: 12 }}>{v}</span>
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
                const cnt = scores.filter(s => String(s.gameId) === String(g.id)).length;
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