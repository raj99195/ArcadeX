import { useState, useEffect } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { writeContract, waitForTransactionReceipt } from "@wagmi/core";
import { wagmiAdapter } from "../Providers";
import { useChain } from "../context/ChainContext";
import { getAllGames, approveGameInFirebase, rejectGameInFirebase } from "../lib/gameService";
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import SDKTestModal from "../components/SDKTestModal";

const ADMIN_ADDRESS = import.meta.env.VITE_ADMIN_ADDRESS;

const PLATFORM_ABI = [
  {
    name: "approveGame",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [],
  },
];

async function getGasWithBuffer(publicClient, { address, abi, functionName, args, account, bufferPct = 30 }) {
  try {
    const estimated = await publicClient.estimateContractGas({
      address, abi, functionName, args, account,
    });
    return (estimated * BigInt(100 + bufferPct)) / 100n;
  } catch (err) {
    console.warn(`Gas estimation failed for ${functionName}, using fallback:`, err.shortMessage || err.message);
    return BigInt(3000000);
  }
}

const P = {
  p: "#7B2FFF", p2: "rgba(123,47,255,0.14)", p3: "rgba(123,47,255,0.06)",
  pb: "rgba(123,47,255,0.25)", bg: "#08070f", s1: "#0e0c1a", s2: "#12101f",
  b: "rgba(123,47,255,0.12)", b2: "rgba(123,47,255,0.22)",
  raj: "'Rajdhani',sans-serif", orb: "'Orbitron',sans-serif",
};

const statusMap = {
  approved: { bg: "rgba(0,255,136,0.08)", color: "#00FF88", border: "rgba(0,255,136,0.2)", label: "✓ Live" },
  pending: { bg: "rgba(255,184,0,0.08)", color: "#FFB800", border: "rgba(255,184,0,0.2)", label: "⏳ Pending" },
  rejected: { bg: "rgba(255,68,68,0.08)", color: "#ff4444", border: "rgba(255,68,68,0.2)", label: "✗ Rejected" },
};

function GamePreviewModal({ game, onClose, onApprove, onReject, loading }) {
  if (!game) return null;
  const s = statusMap[game.status] || statusMap.pending;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div style={{ background: P.s1, border: `1px solid ${P.b2}`, borderRadius: 14, width: "100%", maxWidth: 580, position: "relative", overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.8)" }} onClick={e => e.stopPropagation()}>
        <div style={{ height: 240, background: "#060510", position: "relative" }}>
          {game.thumbnailUrl ? <img src={game.thumbnailUrl} alt={game.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : game.iframeUrl ? <iframe src={game.iframeUrl} style={{ width: "100%", height: "100%", border: "none" }} title={game.name} />
              : <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 52 }}>🎮</div>}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(14,12,26,0.8), transparent)", pointerEvents: "none" }} />
          <span style={{ position: "absolute", top: 12, left: 12, padding: "3px 9px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontFamily: P.raj }}>{s.label}</span>
          <button onClick={onClose} style={{ position: "absolute", top: 10, right: 10, background: "rgba(8,7,15,0.85)", border: `1px solid ${P.b2}`, borderRadius: 6, color: "#a67fff", fontSize: 11, padding: "5px 11px", cursor: "pointer", fontFamily: P.raj, fontWeight: 700 }}>✕ Close</button>
        </div>
        <div style={{ padding: 22 }}>
          <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 18, color: "#fff", marginBottom: 4 }}>{game.name}</div>
          <div style={{ fontSize: 12, color: "#5533aa", marginBottom: 18, lineHeight: 1.6, fontFamily: P.raj }}>{game.description || "No description"}</div>
          {[["Game ID", `#${game.gameId}`], ["Category", game.category], ["Creator", game.creator], ["Game URL", game.iframeUrl], ["Reward Rate", `${game.rewardRate} ARCADE per play`], ["Submitted", game.createdAt?.toDate?.()?.toLocaleDateString() || "Recently"], ["TX Hash", game.txHash?.slice(0, 20) + "..." || "N/A"]].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "7px 0", borderBottom: `1px solid ${P.b}` }}>
              <span style={{ color: "#5533aa", minWidth: 100, fontFamily: P.raj }}>{k}</span>
              <span style={{ color: "#c4a0ff", textAlign: "right", wordBreak: "break-all", maxWidth: 360, fontFamily: k === "Creator" || k === "TX Hash" ? "monospace" : P.raj, fontWeight: 600 }}>{v}</span>
            </div>
          ))}
          {game.status === "pending" && (
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button onClick={() => onReject(game)} disabled={loading} style={{ flex: 1, padding: "11px", background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.22)", borderRadius: 8, color: "#ff4444", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: P.raj }}>{loading ? "..." : "✗ Reject"}</button>
              <button onClick={() => onApprove(game)} disabled={loading} style={{ flex: 2, padding: "11px", background: loading ? "rgba(123,47,255,0.2)" : "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 8, color: loading ? "#5533aa" : "#fff", fontSize: 12, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: P.raj }}>{loading ? "Processing..." : "✓ Approve Game"}</button>
            </div>
          )}
          {game.status === "approved" && <div style={{ marginTop: 16, padding: 11, background: "rgba(0,255,136,0.06)", border: "1px solid rgba(0,255,136,0.15)", borderRadius: 7, fontSize: 11, color: "#00FF88", textAlign: "center", fontFamily: P.raj, fontWeight: 700 }}>✓ This game is live</div>}
          {game.status === "rejected" && <div style={{ marginTop: 16, padding: 11, background: "rgba(255,68,68,0.06)", border: "1px solid rgba(255,68,68,0.15)", borderRadius: 7, fontSize: 11, color: "#ff4444", textAlign: "center", fontFamily: P.raj, fontWeight: 700 }}>✗ This game was rejected</div>}
        </div>
      </div>
    </div>
  );
}

export default function Admin() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { contracts, chainId, chainName, explorerUrl } = useChain();
  const PLATFORM_ADDRESS = contracts.platform;

  const [refreshingLeaderboard, setRefreshingLeaderboard] = useState(false);

  // Creators tab
  const [creators, setCreators] = useState([]);
  const [creatorsLoading, setCreatorsLoading] = useState(false);
  const [syncingCreatorAddr, setSyncingCreatorAddr] = useState(null);
  const [creatorSyncResults, setCreatorSyncResults] = useState({}); 
  const [leaderboardMsg, setLeaderboardMsg] = useState("");

  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [selectedGame, setSelectedGame] = useState(null);
  const [log, setLog] = useState("");
  const [activeTab, setActiveTab] = useState("pending");
  const [gameStats, setGameStats] = useState({});

  // Support Tickets State
  const [tickets, setTickets] = useState([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState("");

  // Analytics state
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [totalMessages, setTotalMessages] = useState(0);
  const [scores, setScores] = useState([]);
  const [timeRange, setTimeRange] = useState("7d");
  const [playsChartData, setPlaysChartData] = useState([]);

  const isAdmin = address?.toLowerCase() === ADMIN_ADDRESS?.toLowerCase();

  const fetchGames = async () => {
    setGamesLoading(true);
    try {
      const allGames = await getAllGames();
      setGames(allGames);
      const statsObj = {};
      await Promise.all(allGames.map(async (game) => {
        try {
          const res = await fetch(`/api/games?action=stats&gameId=${game.gameId || game.id}`);
          const data = await res.json();
          statsObj[game.gameId || game.id] = { uniquePlayers: data.uniquePlayers || 0, plays: data.plays || 0 };
        } catch { statsObj[game.gameId || game.id] = { uniquePlayers: 0, plays: 0 }; }
      }));
      setGameStats(statsObj);
    } catch (e) { console.error(e); }
    finally { setGamesLoading(false); }
  };

  const fetchAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const scoresRes = await fetch("/api/games?action=scores");
      const scoresData = await scoresRes.json();
      const allScores = scoresData.scores || [];
      setScores(allScores);

      const uniqueWallets = new Set(allScores.map(s => s.player)).size;
      setTotalPlayers(uniqueWallets);

      const channels = ["general", "game-talk", "flex", "announcements"];
      let msgCount = 0;
      await Promise.all(channels.map(async ch => {
        try {
          const res = await fetch(`/api/community?channel=${ch}`);
          const data = await res.json();
          msgCount += (data.messages || []).length;
        } catch {}
      }));
      setTotalMessages(msgCount);
      generateChartData(allScores, timeRange);
    } catch (e) { console.error(e); }
    finally { setAnalyticsLoading(false); }
  };

 // Support Tickets Fetch Logic
  const fetchTickets = async () => {
    setTicketsLoading(true);
    try {
      const token = localStorage.getItem("arcadex_jwt");
      const res = await fetch("/api/support?action=list", {
        method: "POST", // 👈 YE LINE MISSING THI
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if(res.ok) setTickets(data.tickets || []);
    } catch (e) { console.error("Error fetching tickets:", e); }
    finally { setTicketsLoading(false); }
  };

  const generateChartData = (allScores, range) => {
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    const labels = [];
    const data = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const label = range === "7d"
        ? d.toLocaleDateString("en", { weekday: "short" })
        : d.toLocaleDateString("en", { month: "short", day: "numeric" });
      labels.push(label);
      const totalP = allScores.length;
      const weight = i === 0 ? 0.25 : i === 1 ? 0.18 : i === 2 ? 0.14 : 0.43 / (days - 3);
      data.push({ day: label, plays: Math.floor(totalP * weight), players: Math.floor(totalP * weight * 0.7) });
    }
    setPlaysChartData(data);
  };

  useEffect(() => { if (isAdmin) fetchGames(); }, [isAdmin]);
  useEffect(() => { if (isAdmin && activeTab === "analytics") fetchAnalytics(); }, [isAdmin, activeTab]);
  useEffect(() => { if (isAdmin && activeTab === "support") fetchTickets(); }, [isAdmin, activeTab]);
  useEffect(() => { if (scores.length) generateChartData(scores, timeRange); }, [timeRange]);

  const approveGame = async (game) => {
    setLoading(true);
    try {
      const approveArgs = [BigInt(game.gameId)];
      const approveGas = await getGasWithBuffer(publicClient, {
        address: PLATFORM_ADDRESS, abi: PLATFORM_ABI,
        functionName: "approveGame", args: approveArgs, account: address,
      });
      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: PLATFORM_ADDRESS,
        abi: PLATFORM_ABI,
        functionName: "approveGame",
        args: approveArgs,
        gas: approveGas,
        chainId,
      });
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });
      await approveGameInFirebase(game.gameId);
      setLog(`✓ Game #${game.gameId} "${game.name}" approved!`);
      setSelectedGame(null);
      await fetchGames();
    } catch (e) { setLog(`Error: ${e.message}`); }
    finally { setLoading(false); }
  };

  const rejectGame = async (game) => {
    setLoading(true);
    try {
      await rejectGameInFirebase(game.gameId);
      setLog(`✗ Game #${game.gameId} "${game.name}" rejected.`);
      setSelectedGame(null);
      await fetchGames();
    } catch (e) { setLog(`Error: ${e.message}`); }
    finally { setLoading(false); }
  };

  const [syncingGameId, setSyncingGameId] = useState(null);
  const [syncResults, setSyncResults] = useState({});
  const [testingGame, setTestingGame] = useState(null);
  const [syncingMarketplace, setSyncingMarketplace] = useState(false);
  const [marketplaceSyncResults, setMarketplaceSyncResults] = useState(null);

  const handleSyncMultichain = async (game) => {
    const gameId = game.gameId || game.id;
    setSyncingGameId(gameId);
    setSyncResults(prev => ({ ...prev, [gameId]: null }));
    try {
      const token = localStorage.getItem("arcadex_jwt");
      const res = await fetch("/api/admin/deploy-multichain", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ gameId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setSyncResults(prev => ({ ...prev, [gameId]: data.results }));
    } catch (err) {
      setSyncResults(prev => ({ ...prev, [gameId]: [{ chain: "Error", status: "failed", reason: err.message }] }));
    } finally {
      setSyncingGameId(null);
    }
  };

  const fetchCreators = async () => {
    setCreatorsLoading(true);
    try {
      const token = localStorage.getItem("arcadex_jwt");
      const res = await fetch("/api/admin/creators", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      setCreators(data.creators || []);
    } catch (e) { console.error(e); }
    finally { setCreatorsLoading(false); }
  };

  useEffect(() => { if (isAdmin && activeTab === "creators") fetchCreators(); }, [isAdmin, activeTab]);

  const handleSyncCreator = async (creator) => {
    setSyncingCreatorAddr(creator.address);
    setCreatorSyncResults(prev => ({ ...prev, [creator.address]: null }));
    try {
      const token = localStorage.getItem("arcadex_jwt");
      const res = await fetch("/api/admin/sync-creator-nft", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          username: creator.displayName,
          avatarColor: creator.avatarStyle || "bottts",
          originChainKey: null, 
          targetAddress: creator.address,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setCreatorSyncResults(prev => ({ ...prev, [creator.address]: data.results }));
    } catch (err) {
      setCreatorSyncResults(prev => ({ ...prev, [creator.address]: [{ chain: "Error", status: "failed", reason: err.message }] }));
    } finally {
      setSyncingCreatorAddr(null);
    }
  };

  const handleRefreshLeaderboard = async () => {
    setRefreshingLeaderboard(true);
    setLeaderboardMsg("");
    try {
      const token = localStorage.getItem("arcadex_jwt");
      const res = await fetch("/api/admin/refresh-badge-leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Refresh failed");
      setLeaderboardMsg(`✓ Refreshed — ${data.rankedCount} players ranked.`);
    } catch (err) {
      setLeaderboardMsg(`Error: ${err.message}`);
    } finally {
      setRefreshingLeaderboard(false);
    }
  };

  const handleSyncMarketplace = async () => {
    setSyncingMarketplace(true);
    setMarketplaceSyncResults(null);
    try {
      const token = localStorage.getItem("arcadex_jwt");
      const res = await fetch("/api/admin/sync-marketplace", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setMarketplaceSyncResults(data.results);
    } catch (err) {
      setMarketplaceSyncResults([{ chain: "Error", status: "failed", reason: err.message }]);
    } finally {
      setSyncingMarketplace(false);
    }
  };

  // Ticket Actions
  const handleReplyTicket = async (ticketId) => {
    if (!replyText.trim()) return;
    try {
      const token = localStorage.getItem("arcadex_jwt");
      const res = await fetch("/api/support?action=reply", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ticketId, replyText })
      });
      if(res.ok) {
        setReplyingTo(null);
        setReplyText("");
        fetchTickets();
      }
    } catch (e) { console.error(e); }
  };

  const handleResolveTicket = async (ticketId) => {
    try {
      const token = localStorage.getItem("arcadex_jwt");
      await fetch("/api/support?action=resolve", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ticketId })
      });
      fetchTickets();
    } catch (e) { console.error(e); }
  };

  if (!isConnected) return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: P.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: P.p2, border: `1px solid ${P.pb}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, margin: "0 auto 16px" }}>🔐</div>
        <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 16, color: "#c4a0ff" }}>Connect wallet to access admin panel</div>
      </div>
    </div>
  );

  if (!isAdmin) return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: P.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(255,68,68,0.1)", border: "1px solid rgba(255,68,68,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, margin: "0 auto 16px" }}>🚫</div>
        <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 16, color: "#ff4444", marginBottom: 8 }}>Access Denied — Admin Only</div>
        <div style={{ fontFamily: "monospace", fontSize: 10, color: "#3a2a5a" }}>{address}</div>
      </div>
    </div>
  );

  const pendingGames = games.filter(g => g.status === "pending");
  const approvedGames = games.filter(g => g.status === "approved");
  const rejectedGames = games.filter(g => g.status === "rejected");
  const tabGames = { pending: pendingGames, approved: approvedGames, rejected: rejectedGames }[activeTab] || [];

  return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: P.bg, padding: "28px 36px" }}>
      <style>{`
        @keyframes lbPulse{0%,100%{opacity:1}50%{opacity:0.3}}
        .adm-row:hover { background: rgba(123,47,255,0.06) !important; border-color: rgba(123,47,255,0.3) !important; }
        .adm-tab:hover { color: #c4a0ff !important; }
      `}</style>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", border: `1px solid ${P.pb}`, borderRadius: 4, fontSize: 9, color: "rgba(200,170,255,0.6)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 14, background: P.p3, fontFamily: P.raj, fontWeight: 600 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#ff4444", animation: "lbPulse 1.5s ease-in-out infinite" }} />
            Admin Access · ArcadeX
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div>
              <h1 style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 36, textTransform: "uppercase", letterSpacing: "-0.3px", color: "#fff", marginBottom: 4 }}>
                Admin <span style={{ background: "linear-gradient(90deg,#7B2FFF,#ff4444)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Dashboard</span>
              </h1>
              <p style={{ color: "#5533aa", fontSize: 12, fontFamily: P.raj }}>Platform management — only you can see this.</p>
            </div>
            <button onClick={fetchGames} style={{ padding: "8px 18px", background: P.p3, border: `1px solid ${P.b2}`, borderRadius: 7, color: "#a67fff", fontSize: 11, cursor: "pointer", fontFamily: P.raj, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", transition: "all 0.18s" }}>↻ Refresh</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 24 }}>
          {[
            { label: "Total Games", value: games.length, color: "#a67fff" },
            { label: "Pending", value: pendingGames.length, color: "#FFB800" },
            { label: "Live", value: approvedGames.length, color: "#00FF88" },
            { label: "Total Plays", value: Object.values(gameStats).reduce((s, g) => s + (g.plays || 0), 0), color: "#00d4ff" },
          ].map(s => (
            <div key={s.label} style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
              <div style={{ fontSize: 9, color: "#5533aa", textTransform: "uppercase", letterSpacing: "1.2px", fontFamily: P.raj, fontWeight: 700, marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontFamily: P.orb, fontWeight: 700, fontSize: 28, color: s.color, letterSpacing: "-1px", lineHeight: 1 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* ── TABS ── */}
        <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: `1px solid ${P.b}`, overflowX: "auto" }}>
          {[
            { id: "pending", label: `Pending (${pendingGames.length})`, color: "#FFB800" },
            { id: "approved", label: `Approved (${approvedGames.length})`, color: "#00FF88" },
            { id: "rejected", label: `Rejected (${rejectedGames.length})`, color: "#ff4444" },
            { id: "creators", label: `👤 Creators (${creators.length})`, color: "#a67fff" },
            { id: "support", label: `🎫 Support`, color: "#ff8800" },
            { id: "analytics", label: "📊 Analytics", color: "#00d4ff" },
          ].map(t => (
            <button key={t.id} className="adm-tab" onClick={() => setActiveTab(t.id)} style={{ padding: "9px 20px", background: "transparent", border: "none", borderBottom: activeTab === t.id ? `2px solid ${t.color}` : "2px solid transparent", color: activeTab === t.id ? t.color : "#3a2a5a", fontSize: 11, cursor: "pointer", marginBottom: "-1px", fontFamily: P.raj, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", transition: "color 0.18s", flexShrink: 0 }}>{t.label}</button>
          ))}
        </div>

        {/* ── SUPPORT TICKETS TAB ── */}
        {activeTab === "support" && (
          <div>
             {ticketsLoading ? (
               <div style={{ padding: "40px 0", textAlign: "center", color: "#5533aa", fontFamily: P.raj }}>Loading tickets...</div>
             ) : tickets.length === 0 ? (
               <div style={{ padding: "40px 0", textAlign: "center", color: "#5533aa", fontFamily: P.raj }}>No support tickets found.</div>
             ) : (
               <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                 {tickets.map((ticket) => (
                   <div key={ticket.id} style={{ background: P.s1, border: `1px solid ${ticket.status === 'resolved' ? 'rgba(0,255,136,0.2)' : P.b}`, borderRadius: 10, padding: 18 }}>
                     <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                       <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: "rgba(123,47,255,0.15)", color: "#c4a0ff", fontFamily: P.raj, fontWeight: 700, textTransform: "uppercase" }}>{ticket.issueType}</span>
                          <span style={{ fontSize: 10, color: "#5533aa", fontFamily: "monospace" }}>Ticket: {ticket.id}</span>
                       </div>
                       <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: ticket.status === 'resolved' ? "rgba(0,255,136,0.1)" : ticket.status === 'in-progress' ? "rgba(255,183,0,0.1)" : "rgba(255,68,68,0.1)", color: ticket.status === 'resolved' ? "#00FF88" : ticket.status === 'in-progress' ? "#FFB700" : "#ff4444", fontFamily: P.raj, fontWeight: 700, textTransform: "uppercase" }}>
                         {ticket.status}
                       </span>
                     </div>
                     
                     <div style={{ fontSize: 13, color: "#fff", fontFamily: P.raj, lineHeight: 1.5, marginBottom: 10 }}>{ticket.description}</div>
                     
                     {ticket.email && <div style={{ fontSize: 11, color: "#a67fff", fontFamily: P.raj, marginBottom: 6 }}>Email: {ticket.email}</div>}
                     {ticket.screenshotUrl && (
                        <a href={ticket.screenshotUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#00d4ff", fontFamily: P.raj, textDecoration: "none", display: "inline-block", marginBottom: 10 }}>🖼️ View Screenshot →</a>
                     )}

                     {ticket.replies && ticket.replies.length > 0 && (
                       <div style={{ marginTop: 12, padding: 12, background: "rgba(123,47,255,0.04)", borderRadius: 8, borderLeft: `2px solid ${P.p}` }}>
                         {ticket.replies.map((reply, i) => (
                           <div key={i} style={{ marginBottom: i < ticket.replies.length - 1 ? 10 : 0 }}>
                             <div style={{ fontSize: 9, color: "#7755aa", fontFamily: P.raj, fontWeight: 700, marginBottom: 3 }}>ADMIN REPLY:</div>
                             <div style={{ fontSize: 12, color: "#c4a0ff", fontFamily: P.raj, lineHeight: 1.4 }}>{reply.text}</div>
                           </div>
                         ))}
                       </div>
                     )}

                     {ticket.status !== 'resolved' && (
                       <div style={{ marginTop: 16, display: "flex", gap: 10, borderTop: `1px solid ${P.b}`, paddingTop: 16 }}>
                         {replyingTo === ticket.id ? (
                           <div style={{ flex: 1, display: "flex", gap: 8 }}>
                             <input 
                               value={replyText} 
                               onChange={e => setReplyText(e.target.value)} 
                               placeholder="Type reply..." 
                               style={{ flex: 1, padding: "8px 12px", background: "rgba(123,47,255,0.06)", border: `1px solid ${P.b}`, borderRadius: 6, color: "#fff", fontSize: 12, fontFamily: P.raj, outline: "none" }} 
                             />
                             <button onClick={() => handleReplyTicket(ticket.id)} style={{ padding: "8px 16px", background: P.p, border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 11, fontFamily: P.raj, fontWeight: 700 }}>Send</button>
                             <button onClick={() => setReplyingTo(null)} style={{ padding: "8px 16px", background: "transparent", border: `1px solid ${P.b}`, borderRadius: 6, color: "#a67fff", cursor: "pointer", fontSize: 11, fontFamily: P.raj, fontWeight: 700 }}>Cancel</button>
                           </div>
                         ) : (
                           <>
                             <button onClick={() => setReplyingTo(ticket.id)} style={{ padding: "8px 16px", background: "rgba(123,47,255,0.1)", border: `1px solid ${P.b2}`, borderRadius: 6, color: "#c4a0ff", cursor: "pointer", fontSize: 11, fontFamily: P.raj, fontWeight: 700 }}>💬 Reply</button>
                             <button onClick={() => handleResolveTicket(ticket.id)} style={{ padding: "8px 16px", background: "rgba(0,255,136,0.1)", border: "1px solid rgba(0,255,136,0.25)", borderRadius: 6, color: "#00FF88", cursor: "pointer", fontSize: 11, fontFamily: P.raj, fontWeight: 700 }}>✓ Mark Resolved</button>
                           </>
                         )}
                       </div>
                     )}
                   </div>
                 ))}
               </div>
             )}
          </div>
        )}

        {/* ── CREATORS TAB ── */}
        {activeTab === "creators" && (
          <div>
            {creatorsLoading ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: "#5533aa", fontFamily: P.raj }}>Loading creators...</div>
            ) : creators.length === 0 ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: "#5533aa", fontFamily: P.raj }}>No creators registered yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {creators.map(creator => {
                  const isSyncing = syncingCreatorAddr === creator.address;
                  const results = creatorSyncResults[creator.address];
                  return (
                    <div key={creator.address} style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 9, padding: "12px 18px", display: "flex", alignItems: "center", gap: 14 }}>
                      {/* Avatar */}
                      <div style={{ width: 40, height: 40, borderRadius: "50%", overflow: "hidden", border: "1.5px solid rgba(123,47,255,0.4)", flexShrink: 0, background: "#0e0c1a" }}>
                        <img src={`https://api.dicebear.com/9.x/${creator.avatarStyle || "bottts"}/svg?seed=${creator.displayName || creator.address}`} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 13, color: "#c4a0ff", marginBottom: 2 }}>
                          {creator.displayName || "—"}<span style={{ color: "#5533aa" }}>.arcade</span>
                        </div>
                        <div style={{ fontSize: 9, color: "#5533aa", fontFamily: "monospace" }}>{creator.address}</div>
                        <div style={{ fontSize: 9, color: "#5533aa", fontFamily: P.raj, marginTop: 2 }}>
                          {creator.gamesPublished || 0} games · Joined {creator.registeredAt ? new Date(creator.registeredAt).toLocaleDateString() : "—"}
                        </div>
                      </div>

                      {/* Sync button + results */}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => handleSyncCreator(creator)} disabled={isSyncing} style={{
                          padding: "5px 12px", background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.25)",
                          borderRadius: 6, color: "#00d4ff", fontSize: 10, cursor: isSyncing ? "not-allowed" : "pointer",
                          fontFamily: P.raj, fontWeight: 700, opacity: isSyncing ? 0.6 : 1, whiteSpace: "nowrap",
                        }}>
                          {isSyncing ? "🔄 Syncing..." : "🔗 Sync to All Chains"}
                        </button>
                        {results && (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 200 }}>
                            {results.map((r, i) => (
                              <span key={i} title={r.reason || ""} style={{
                                fontSize: 8, padding: "2px 7px", borderRadius: 10, fontFamily: P.raj, fontWeight: 700,
                                background: r.status === "minted" || r.status === "already_minted" ? "rgba(0,255,136,0.1)" : r.status === "skipped" ? "rgba(255,184,0,0.1)" : "rgba(255,68,68,0.1)",
                                color: r.status === "minted" || r.status === "already_minted" ? "#00FF88" : r.status === "skipped" ? "#FFB800" : "#ff4444",
                                border: `1px solid ${r.status === "minted" || r.status === "already_minted" ? "rgba(0,255,136,0.25)" : r.status === "skipped" ? "rgba(255,184,0,0.25)" : "rgba(255,68,68,0.25)"}`,
                              }}>
                                {r.chain}: {r.status === "minted" ? "✓ minted" : r.status === "already_minted" ? "✓ already" : r.status === "skipped" ? "skip" : "✗ fail"}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── ANALYTICS TAB ── */}
        {activeTab === "analytics" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {analyticsLoading ? (
              <div style={{ padding: 48, textAlign: "center", fontSize: 11, color: "#5533aa", fontFamily: P.raj }}>Loading analytics...</div>
            ) : (
              <>
                {/* Stats row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                  {[
                    { label: "Total Plays", value: Object.values(gameStats).reduce((s, g) => s + (g.plays || 0), 0), color: "#00d4ff", icon: "🎮" },
                    { label: "Unique Players", value: totalPlayers, color: "#00FF88", icon: "👥" },
                    { label: "ARCADE Minted", value: Math.floor(Object.values(gameStats).reduce((s, g) => s + (g.plays || 0), 0) * games.reduce((s, g) => s + (g.rewardRate || 50), 0) / Math.max(games.length, 1)), color: "#FFB700", icon: "🪙" },
                    { label: "Community Msgs", value: totalMessages, color: "#a67fff", icon: "💬" },
                  ].map(s => (
                    <div key={s.label} style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10, padding: "14px 16px", position: "relative", overflow: "hidden" }}>
                      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${s.color}, transparent)` }} />
                      <div style={{ fontSize: 8, color: "#5533aa", textTransform: "uppercase", letterSpacing: "1.2px", fontFamily: P.raj, fontWeight: 700, marginBottom: 6 }}>{s.icon} {s.label}</div>
                      <div style={{ fontFamily: P.orb, fontWeight: 700, fontSize: 24, color: s.color, letterSpacing: "-1px", lineHeight: 1 }}>{s.value.toLocaleString()}</div>
                    </div>
                  ))}
                </div>

                {/* Time range toggle */}
                <div style={{ display: "flex", gap: 8 }}>
                  {["7d", "30d", "90d"].map(r => (
                    <button key={r} onClick={() => setTimeRange(r)} style={{ padding: "6px 16px", background: timeRange === r ? "rgba(0,212,255,0.15)" : "transparent", border: `1px solid ${timeRange === r ? "rgba(0,212,255,0.4)" : P.b}`, borderRadius: 6, color: timeRange === r ? "#00d4ff" : "#5533aa", fontSize: 11, cursor: "pointer", fontFamily: P.raj, fontWeight: 700, transition: "all 0.15s" }}>{r}</button>
                  ))}
                </div>

                {/* Plays + Players Area Chart */}
                <div style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 12, padding: "20px 22px" }}>
                  <div style={{ fontSize: 9, color: "#5533aa", fontFamily: P.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 16 }}>📈 Plays & Players — Last {timeRange}</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={playsChartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="playsG" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00D4FF" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#00D4FF" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="playersG" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00FF88" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#00FF88" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(123,47,255,0.1)" />
                      <XAxis dataKey="day" tick={{ fontSize: 9, fill: "#5533AA", fontFamily: "Rajdhani" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: "#5533AA" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: "#0d0b1a", border: "1px solid rgba(123,47,255,0.25)", borderRadius: 8, fontSize: 11, fontFamily: "Rajdhani" }} labelStyle={{ color: "#c4a0ff", fontWeight: 700 }} />
                      <Legend wrapperStyle={{ fontSize: 10, fontFamily: "Rajdhani" }} />
                      <Area type="monotone" dataKey="plays" name="Plays" stroke="#00D4FF" strokeWidth={2} fill="url(#playsG)" dot={false} />
                      <Area type="monotone" dataKey="players" name="Players" stroke="#00FF88" strokeWidth={2} fill="url(#playersG)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Top games by earnings Bar chart */}
                <div style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 12, padding: "20px 22px" }}>
                  <div style={{ fontSize: 9, color: "#5533aa", fontFamily: P.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 16 }}>🏆 Top Games by Earnings (ARCADE)</div>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={games.filter(g => g.status === "approved").map(g => ({ name: g.name.slice(0, 12), earned: Math.floor((gameStats[g.gameId]?.plays || 0) * (g.rewardRate || 50) * 0.2) })).sort((a, b) => b.earned - a.earned).slice(0, 6)} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="earnG" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#FFB700" stopOpacity={0.9} />
                          <stop offset="100%" stopColor="#FF6B00" stopOpacity={0.5} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(123,47,255,0.1)" />
                      <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#5533AA", fontFamily: "Rajdhani" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: "#5533AA" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: "#0d0b1a", border: "1px solid rgba(255,183,0,0.25)", borderRadius: 8, fontSize: 11, fontFamily: "Rajdhani" }} formatter={val => [`${val} ARCADE`, "Earned"]} />
                      <Bar dataKey="earned" fill="url(#earnG)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* ARCADE Distribution Pie + New Players */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {/* Pie chart */}
                  <div style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 12, padding: "20px 22px" }}>
                    <div style={{ fontSize: 9, color: "#5533aa", fontFamily: P.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 16 }}>🥧 ARCADE Distribution</div>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={[{ name: "Players (80%)", value: 80 }, { name: "Creators (20%)", value: 20 }]} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                          <Cell fill="#00D4FF" />
                          <Cell fill="#7B2FFF" />
                        </Pie>
                        <Tooltip contentStyle={{ background: "#0d0b1a", border: "1px solid rgba(123,47,255,0.25)", borderRadius: 8, fontSize: 11, fontFamily: "Rajdhani" }} formatter={val => [`${val}%`]} />
                        <Legend wrapperStyle={{ fontSize: 10, fontFamily: "Rajdhani" }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Platform health */}
                  <div style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 12, padding: "20px 22px" }}>
                    <div style={{ fontSize: 9, color: "#5533aa", fontFamily: P.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 16 }}>⛓ Blockchain Stats</div>
                    {[
                      ["Total On-Chain Txns", scores.length + games.length, "#00d4ff"],
                      ["Avg Plays/Game", games.length > 0 ? Math.floor(Object.values(gameStats).reduce((s, g) => s + (g.plays || 0), 0) / Math.max(games.filter(g => g.status === "approved").length, 1)) : 0, "#a67fff"],
                      ["Total ARCADE Minted", Math.floor(Object.values(gameStats).reduce((s, g) => s + (g.plays || 0), 0) * (games.reduce((s, g) => s + (g.rewardRate || 50), 0) / Math.max(games.length, 1))), "#FFB700"],
                      ["Creator Earnings", Math.floor(Object.values(gameStats).reduce((s, g) => s + (g.plays || 0), 0) * (games.reduce((s, g) => s + (g.rewardRate || 50), 0) / Math.max(games.length, 1)) * 0.2), "#00FF88"],
                    ].map(([k, v, color]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "8px 0", borderBottom: `1px solid ${P.b}` }}>
                        <span style={{ color: "#5533aa", fontFamily: P.raj }}>{k}</span>
                        <span style={{ color, fontFamily: P.orb, fontWeight: 700, fontSize: 12 }}>{Number(v).toLocaleString()}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 12, padding: "8px 12px", background: "rgba(0,255,136,0.05)", border: "1px solid rgba(0,255,136,0.12)", borderRadius: 7 }}>
                      <div style={{ fontSize: 9, color: "#5533aa", fontFamily: P.raj, marginBottom: 3 }}>Network</div>
                      <div style={{ fontSize: 11, color: "#00FF88", fontFamily: P.raj, fontWeight: 700 }}>{chainName} (Chain ID: {chainId})</div>
                    </div>
                  </div>
                </div>

                {/* Contract addresses */}
                <div style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 12, padding: "16px 20px" }}>
                  <div style={{ fontSize: 9, color: "#5533aa", fontFamily: P.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 12 }}>📋 Deployed Contracts — {chainName}</div>
                  {[
                    ["ArcadeToken", contracts.token],
                    ["Platform", contracts.platform],
                    ["Tournament", contracts.tournament],
                    ["Leaderboard", contracts.leaderboard],
                    ["Marketplace", contracts.marketplace],
                    ["CreatorNFT", contracts.creatorNft],
                  ].map(([name, addr]) => (
                    <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, padding: "7px 0", borderBottom: `1px solid ${P.b}` }}>
                      <span style={{ color: "#a67fff", fontFamily: P.raj, fontWeight: 700, minWidth: 100 }}>{name}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ color: "#5533aa", fontFamily: "monospace", fontSize: 10 }}>{addr?.slice(0, 10)}...{addr?.slice(-6)}</span>
                        {explorerUrl && (
                          <a href={`${explorerUrl}/address/${addr}`} target="_blank" rel="noreferrer" style={{ fontSize: 9, color: "#00d4ff", textDecoration: "none", fontFamily: P.raj, fontWeight: 700 }}>View →</a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab !== "analytics" && activeTab !== "creators" && activeTab !== "support" && (gamesLoading ? (
          <div style={{ padding: 48, textAlign: "center", fontSize: 11, color: "#5533aa", fontFamily: P.raj }}>Loading...</div>
        ) : tabGames.length === 0 ? (
          <div style={{ padding: 56, textAlign: "center" }}>
            <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 14, color: "#7755aa" }}>No {activeTab} games</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {tabGames.map(game => {
              const s = statusMap[game.status] || statusMap.pending;
              return (
                <div key={game.id} className="adm-row" style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 9, padding: "13px 18px", display: "flex", alignItems: "center", gap: 14, cursor: "pointer", transition: "all 0.2s" }} onClick={() => setSelectedGame(game)}>
                  <div style={{ width: 56, height: 40, borderRadius: 6, overflow: "hidden", background: "#060510", flexShrink: 0 }}>
                    {game.thumbnailUrl ? <img src={game.thumbnailUrl} alt={game.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🎮</div>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 13, color: "#d4b8ff", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{game.name}</div>
                    <div style={{ fontSize: 9, color: "#5533aa", fontFamily: P.raj }}>Game #{game.gameId} · {game.category} · {game.creator?.slice(0, 16)}...</div>
                  </div>
                  <div style={{ textAlign: "center", flexShrink: 0 }}>
                    <div style={{ fontFamily: P.orb, fontSize: 12, color: "#a67fff", fontWeight: 700 }}>{game.rewardRate}</div>
                    <div style={{ fontSize: 8, color: "#5533aa", fontFamily: P.raj }}>ARCADE/play</div>
                  </div>
                  <div style={{ textAlign: "center", flexShrink: 0, minWidth: 60 }}>
                    <div style={{ fontFamily: P.orb, fontSize: 12, color: "#00d4ff", fontWeight: 700 }}>{gameStats[game.gameId || game.id]?.plays || game.plays || 0}</div>
                    <div style={{ fontSize: 8, color: "#5533aa", fontFamily: P.raj }}>Plays</div>
                  </div>
                  <div style={{ textAlign: "center", flexShrink: 0, minWidth: 60 }}>
                    <div style={{ fontFamily: P.orb, fontSize: 12, color: "#00FF88", fontWeight: 700 }}>{gameStats[game.gameId || game.id]?.uniquePlayers || 0}</div>
                    <div style={{ fontSize: 8, color: "#5533aa", fontFamily: P.raj }}>Players</div>
                  </div>
                  {activeTab === "pending" && (
                    <div style={{ display: "flex", gap: 7, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => rejectGame(game)} disabled={loading} style={{ padding: "5px 13px", background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.2)", borderRadius: 6, color: "#ff4444", fontSize: 10, cursor: "pointer", fontFamily: P.raj, fontWeight: 700 }}>Reject</button>
                      <button onClick={() => approveGame(game)} disabled={loading} style={{ padding: "5px 13px", background: "rgba(0,255,136,0.08)", border: "1px solid rgba(0,255,136,0.2)", borderRadius: 6, color: "#00FF88", fontSize: 10, cursor: "pointer", fontFamily: P.raj, fontWeight: 700 }}>{loading ? "..." : "Approve"}</button>
                    </div>
                  )}
                  {activeTab === "approved" && (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => setTestingGame(game)} style={{ padding: "5px 13px", background: "rgba(255,183,0,0.08)", border: "1px solid rgba(255,183,0,0.25)", borderRadius: 6, color: "#FFB700", fontSize: 10, cursor: "pointer", fontFamily: P.raj, fontWeight: 700, whiteSpace: "nowrap" }}>
                          🧪 Test SDK
                        </button>
                        <button onClick={() => handleSyncMultichain(game)} disabled={syncingGameId === (game.gameId || game.id)} style={{ padding: "5px 13px", background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.25)", borderRadius: 6, color: "#00d4ff", fontSize: 10, cursor: "pointer", fontFamily: P.raj, fontWeight: 700, whiteSpace: "nowrap" }}>
                          {syncingGameId === (game.gameId || game.id) ? "🔄 Syncing..." : "🔗 Sync to All Chains"}
                        </button>
                      </div>
                      {syncResults[game.gameId || game.id] && (
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 220 }}>
                          {syncResults[game.gameId || game.id].map((r, i) => (
                            <span key={i} title={r.reason || ""} style={{
                              fontSize: 8, padding: "2px 7px", borderRadius: 10, fontFamily: P.raj, fontWeight: 700,
                              background: r.status === "live" || r.status === "already_live" ? "rgba(0,255,136,0.12)" : r.status === "skipped" ? "rgba(255,184,0,0.12)" : "rgba(255,68,68,0.12)",
                              color: r.status === "live" || r.status === "already_live" ? "#00FF88" : r.status === "skipped" ? "#FFB800" : "#ff4444",
                              border: `1px solid ${r.status === "live" || r.status === "already_live" ? "rgba(0,255,136,0.25)" : r.status === "skipped" ? "rgba(255,184,0,0.25)" : "rgba(255,68,68,0.25)"}`,
                            }}>
                              {r.chain}: {r.status === "live" ? "✓ live" : r.status === "already_live" ? "✓ already" : r.status === "skipped" ? "skipped" : "✗ failed"}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: "#5533aa", flexShrink: 0, fontFamily: P.raj }}>View →</div>
                </div>
              );
            })}
          </div>
        ))}

        <div style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10, padding: 20, marginTop: 24 }}>
          <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 14, color: "#c4a0ff", marginBottom: 6 }}>🏆 Campaign Badges</div>
          <div style={{ fontSize: 11, color: "#5533aa", fontFamily: P.raj, marginBottom: 14, lineHeight: 1.6 }}>
            Recalculates the ARCADE-earned leaderboard used for Pioneer (top 500) and Legend (top 50) badge eligibility. Run this whenever you want fresh rankings — claims always check eligibility live, this just refreshes the cached ranking they check against.
          </div>
          <button onClick={handleRefreshLeaderboard} disabled={refreshingLeaderboard} style={{
            padding: "10px 20px", background: refreshingLeaderboard ? "rgba(123,47,255,0.2)" : "linear-gradient(135deg,#7B2FFF,#5a1fd4)",
            border: "none", borderRadius: 8, color: refreshingLeaderboard ? "#5533aa" : "#fff",
            fontSize: 12, fontWeight: 700, cursor: refreshingLeaderboard ? "not-allowed" : "pointer",
            fontFamily: P.raj, letterSpacing: "0.5px",
          }}>
            {refreshingLeaderboard ? "🔄 Refreshing..." : "🔄 Refresh Leaderboard Cache"}
          </button>
          {leaderboardMsg && (
            <div style={{ marginTop: 12, padding: 10, background: leaderboardMsg.startsWith("✓") ? "rgba(0,255,136,0.06)" : "rgba(255,68,68,0.06)", border: `1px solid ${leaderboardMsg.startsWith("✓") ? "rgba(0,255,136,0.18)" : "rgba(255,68,68,0.18)"}`, borderRadius: 7, fontSize: 11, color: leaderboardMsg.startsWith("✓") ? "#00FF88" : "#ff4444", fontFamily: P.raj }}>
              {leaderboardMsg}
            </div>
          )}
        </div>

        <div style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10, padding: 20, marginTop: 24 }}>
          <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 14, color: "#c4a0ff", marginBottom: 14 }}>🏪 Marketplace — Per-Chain Sync</div>
          <div style={{ fontSize: 11, color: "#5533aa", fontFamily: P.raj, marginBottom: 14, lineHeight: 1.6 }}>
            Syncs all avatar style items to every live chain. Safe to run multiple times — only adds items that are missing on each chain (checks nextItemId before adding).
          </div>
          <button onClick={handleSyncMarketplace} disabled={syncingMarketplace} style={{
            padding: "10px 20px", background: syncingMarketplace ? "rgba(123,47,255,0.2)" : "linear-gradient(135deg,#7B2FFF,#5a1fd4)",
            border: "none", borderRadius: 8, color: syncingMarketplace ? "#5533aa" : "#fff",
            fontSize: 12, fontWeight: 700, cursor: syncingMarketplace ? "not-allowed" : "pointer",
            fontFamily: P.raj, letterSpacing: "0.5px",
          }}>
            {syncingMarketplace ? "🔄 Syncing..." : "🛒 Sync Marketplace Items"}
          </button>
          {marketplaceSyncResults && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {marketplaceSyncResults.map((r, i) => (
                <div key={i} style={{
                  padding: "8px 12px", borderRadius: 7, fontSize: 10, fontFamily: P.raj,
                  background: r.status === "synced" ? "rgba(0,255,136,0.06)" : r.status === "already_synced" ? "rgba(0,212,255,0.06)" : r.status === "skipped" ? "rgba(255,183,0,0.06)" : "rgba(255,68,68,0.06)",
                  border: `1px solid ${r.status === "synced" ? "rgba(0,255,136,0.2)" : r.status === "already_synced" ? "rgba(0,212,255,0.2)" : r.status === "skipped" ? "rgba(255,183,0,0.2)" : "rgba(255,68,68,0.2)"}`,
                  color: r.status === "synced" ? "#00FF88" : r.status === "already_synced" ? "#00d4ff" : r.status === "skipped" ? "#FFB700" : "#ff4444",
                }}>
                  {r.chain}: {r.status === "synced" ? `✓ ${r.added} items added (total: ${r.total})` : r.status === "already_synced" ? `✓ Already synced (${r.total} items)` : r.status === "skipped" ? `⏭ Skipped — ${r.reason}` : `✗ Failed — ${r.reason}`}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10, padding: 20, marginTop: 24 }}>
          <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 14, color: "#c4a0ff", marginBottom: 14 }}>Platform Settings</div>
          {[["Player share", "80%"], ["Creator share", "20%"], ["Chain", chainName], ["Chain ID", chainId], ["Platform Contract", PLATFORM_ADDRESS], ["Admin", ADMIN_ADDRESS]].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "8px 0", borderBottom: `1px solid ${P.b}` }}>
              <span style={{ color: "#5533aa", fontFamily: P.raj }}>{k}</span>
              <span style={{ color: "#9977cc", fontFamily: k === "Platform Contract" || k === "Admin" ? "monospace" : P.raj, fontWeight: 600, fontSize: k === "Platform Contract" || k === "Admin" ? 10 : 11 }}>{v}</span>
            </div>
          ))}
        </div>

        {log && (
          <div style={{ marginTop: 14, padding: 14, background: log.startsWith("✓") ? "rgba(0,255,136,0.06)" : "rgba(255,68,68,0.06)", border: `1px solid ${log.startsWith("✓") ? "rgba(0,255,136,0.18)" : "rgba(255,68,68,0.18)"}`, borderRadius: 9, fontSize: 11, color: log.startsWith("✓") ? "#00FF88" : "#ff4444", wordBreak: "break-all", fontFamily: P.raj }}>
            {log}
          </div>
        )}
      </div>
      {selectedGame && <GamePreviewModal game={selectedGame} onClose={() => setSelectedGame(null)} onApprove={approveGame} onReject={rejectGame} loading={loading} />}
      {testingGame && (
        <SDKTestModal
          iframeUrl={testingGame.iframeUrl}
          gameName={testingGame.name}
          onClose={() => setTestingGame(null)}
        />
      )}
    </div>
  );
}