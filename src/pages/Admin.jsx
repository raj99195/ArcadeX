import { useState, useEffect } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { writeContract, waitForTransactionReceipt } from "@wagmi/core";
import { wagmiAdapter } from "../Providers";
import { useChain } from "../context/ChainContext";
import { CHAIN_LIST } from "../config/chains";
import { getAllGames, approveGameInFirebase, rejectGameInFirebase } from "../lib/gameService";
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import SDKTestModal from "../components/SDKTestModal";
import AdminOps from "../components/AdminOps";

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

  // ── Flags & Bans state ──────────────────────────────────────────────
  // Two Firestore-backed lists managed from one section.
  //   • flagged: soft-ban tracking (`flagged` collection) — auto-banned
  //     when ≥3 flags in 24h. Cleared per-wallet via `clear-flags` or in
  //     bulk via `clear-all-flags`.
  //   • banned:  admin-blacklist (`bannedWallets` collection) — hard
  //     block at auth + sign-score. Manual add/remove only.
  const [flaggedPlayers, setFlaggedPlayers] = useState([]);
  const [bannedPlayers,  setBannedPlayers]  = useState([]);
  const [flagsLoading,   setFlagsLoading]   = useState(false);
  const [clearingFlags,  setClearingFlags]  = useState(null); // wallet | "all" | null
  const [banningWallet,  setBanningWallet]  = useState(null);

  // ── TaskOn per-chain config state ───────────────────────────────────
  // Firestore doc `taskonConfig/{chain}` per chain. Each row's local draft
  // is edited before Save — prevents accidental writes on every keystroke.
  const [taskonConfigs,      setTaskonConfigs]      = useState({});   // chain → cfg
  const [taskonEnvFallback,  setTaskonEnvFallback]  = useState(null);
  const [taskonLoading,      setTaskonLoading]      = useState(false);
  const [taskonSaving,       setTaskonSaving]       = useState(null); // chain | null
  const [taskonDrafts,       setTaskonDrafts]       = useState({});   // chain → { enabled, questId, campaignUrl }
  const [taskonSaveMsg,      setTaskonSaveMsg]      = useState({});   // chain → success/error string

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
      // SH0030/SH0032 — admin analytics ke liye limit 10000 scores. Pehle
      // full collection scan tha (100K+ scores) — massive read on every
      // admin mount. Backend anonymous cap 500 hai (public leaderboard),
      // authenticated cap 10000 (admin/creator). JWT bhejna zaroori hai
      // warna backend anonymous manega → 500 cap → analytics chart aur
      // aggregates (total players, total plays) galat under-counted honge.
      const token = localStorage.getItem("arcadex_jwt");
      const scoresRes = await fetch("/api/games?action=scores&limit=10000", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
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
      // API side (api/support.js) expects GET for action=list.
      // Pehle yahan method: "POST" tha — request kisi handler pe match nahi
      // karti thi, seedha 404 "Unknown action" milta tha, res.ok false hota
      // tha, setTickets kabhi call nahi hoti thi → UI empty rehti thi even
      // when Firestore mein data present tha.
      const res = await fetch("/api/support?action=list", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if(res.ok) setTickets(data.tickets || []);
      else console.error("Tickets fetch failed:", res.status, data?.error);
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

  // ── Fetch: Flags + Banned (both loaded together for the Flags tab) ──
  const fetchFlagsAndBans = async () => {
    setFlagsLoading(true);
    try {
      const jwt = localStorage.getItem("arcadex_jwt");
      if (!jwt) { setFlaggedPlayers([]); setBannedPlayers([]); return; }

      // Flagged: uses existing flagged-list endpoint (POST, JWT-auth)
      const flagRes = await fetch("/api/games?action=flagged-list", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      });
      const flagData = await flagRes.json().catch(() => ({}));
      setFlaggedPlayers(flagRes.ok ? (flagData.players || []) : []);

      // Banned: existing admin-list-banned endpoint (GET, JWT-auth)
      const banRes = await fetch("/api/games?action=admin-list-banned", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const banData = await banRes.json().catch(() => ({}));
      setBannedPlayers(banRes.ok ? (banData.banned || []) : []);
    } catch (e) { console.error("[flags] fetch failed:", e); }
    finally { setFlagsLoading(false); }
  };

  const clearWalletFlags = async (wallet) => {
    if (!wallet) return;
    if (!confirm(`Clear all flags for ${wallet.slice(0, 10)}…?\n\nThis will remove them from the soft-ban list if currently over the 3-flag threshold.`)) return;
    setClearingFlags(wallet);
    try {
      const jwt = localStorage.getItem("arcadex_jwt");
      const r = await fetch("/api/games?action=clear-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ player: wallet }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) alert(d.error || "Failed to clear flags");
      else await fetchFlagsAndBans();
    } finally { setClearingFlags(null); }
  };

  const clearAllFlags = async () => {
    const proceed = confirm(
      "⚠️  CLEAR ALL FLAGS?\n\n" +
      "This will delete every doc in the `flagged` collection and unban " +
      "every currently soft-banned wallet at once.\n\n" +
      "Use only when you have a false-positive storm or need a clean slate. " +
      "Type OK on the next prompt to proceed."
    );
    if (!proceed) return;
    const confirmToken = prompt('Type "CLEAR_ALL" to confirm:');
    if (confirmToken !== "CLEAR_ALL") { alert("Cancelled — token did not match."); return; }
    setClearingFlags("all");
    try {
      const jwt = localStorage.getItem("arcadex_jwt");
      const r = await fetch("/api/games?action=clear-all-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ confirm: "CLEAR_ALL" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) alert(d.error || "Failed");
      else { alert(`Cleared ${d.cleared} flag record(s).`); await fetchFlagsAndBans(); }
    } finally { setClearingFlags(null); }
  };

  const banWallet = async (wallet, reason) => {
    if (!wallet) return;
    const r0 = reason ?? prompt(`Ban wallet ${wallet.slice(0, 10)}…?\n\nOptional reason:`);
    if (r0 === null) return; // cancelled
    setBanningWallet(wallet);
    try {
      const jwt = localStorage.getItem("arcadex_jwt");
      const r = await fetch("/api/games?action=admin-ban-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ wallet, reason: r0 || "" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) alert(d.error || "Failed to ban");
      else await fetchFlagsAndBans();
    } finally { setBanningWallet(null); }
  };

  const unbanWallet = async (wallet) => {
    if (!wallet) return;
    if (!confirm(`Unban ${wallet.slice(0, 10)}…?`)) return;
    setBanningWallet(wallet);
    try {
      const jwt = localStorage.getItem("arcadex_jwt");
      const r = await fetch("/api/games?action=admin-unban-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ wallet }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) alert(d.error || "Failed to unban");
      else await fetchFlagsAndBans();
    } finally { setBanningWallet(null); }
  };

  useEffect(() => {
    if (isAdmin && activeTab === "flags") fetchFlagsAndBans();
  }, [isAdmin, activeTab]);

  // ── Fetch: TaskOn per-chain config ──────────────────────────────────
  const fetchTaskonConfigs = async () => {
    setTaskonLoading(true);
    try {
      const jwt = localStorage.getItem("arcadex_jwt");
      if (!jwt) return;
      const r = await fetch("/api/games?action=admin-taskon-config", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { console.warn("[taskon] fetch failed:", d.error); return; }
      setTaskonConfigs(d.configs || {});
      setTaskonEnvFallback(d.envFallback || null);
      // Seed drafts from current configs so the form is pre-filled and
      // Save is only enabled when the user actually changes something.
      const drafts = {};
      for (const chain of CHAIN_LIST) {
        const cfg = (d.configs || {})[chain.key];
        drafts[chain.key] = {
          enabled: cfg?.enabled ?? false,
          questId: cfg?.questId ?? "",
          campaignUrl: cfg?.campaignUrl ?? "",
        };
      }
      setTaskonDrafts(drafts);
    } catch (e) { console.error(e); }
    finally { setTaskonLoading(false); }
  };

  const saveTaskonConfig = async (chainKey) => {
    const draft = taskonDrafts[chainKey];
    if (!draft) return;
    setTaskonSaving(chainKey);
    setTaskonSaveMsg(m => ({ ...m, [chainKey]: "" }));
    try {
      const jwt = localStorage.getItem("arcadex_jwt");
      const r = await fetch("/api/games?action=admin-taskon-config", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          chain: chainKey,
          enabled: draft.enabled,
          questId: draft.questId,
          campaignUrl: draft.campaignUrl,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTaskonSaveMsg(m => ({ ...m, [chainKey]: "❌ " + (d.error || "save failed") }));
      } else {
        setTaskonSaveMsg(m => ({ ...m, [chainKey]: "✅ Saved" }));
        await fetchTaskonConfigs();
        setTimeout(() => setTaskonSaveMsg(m => ({ ...m, [chainKey]: "" })), 3000);
      }
    } finally { setTaskonSaving(null); }
  };

  useEffect(() => {
    if (isAdmin && activeTab === "taskon") fetchTaskonConfigs();
  }, [isAdmin, activeTab]);


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
      const res = await fetch("/api/admin/games?action=refresh-leaderboard", {
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

        {/* ── TABS: grouped into Content / People / System ────────── */}
        <div style={{ marginBottom: 20, borderBottom: `1px solid ${P.b}`, paddingBottom: 6 }}>
          {[
            { group: "Content", color: "#00d4ff", tabs: [
              { id: "pending",  label: `Games · Pending (${pendingGames.length})`,   color: "#FFB800" },
              { id: "approved", label: `Games · Live (${approvedGames.length})`,     color: "#00FF88" },
              { id: "rejected", label: `Games · Rejected (${rejectedGames.length})`, color: "#ff4444" },
              { id: "support",  label: `🎫 Support`, color: "#ff8800" },
            ]},
            { group: "People", color: "#a67fff", tabs: [
              { id: "creators", label: `👤 Creators (${creators.length})`, color: "#a67fff" },
            ]},
            { group: "System", color: "#ff4488", tabs: [
              { id: "flags",     label: `🚩 Flags & Bans`,  color: "#ff4488" },
              { id: "taskon",    label: `🎯 TaskOn Config`, color: "#00d4ff" },
              { id: "analytics", label: `📊 Analytics`,     color: "#00d4ff" },
            ]},
          ].map(g => (
            <div key={g.group} style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
              <div style={{ minWidth: 68, fontSize: 9, letterSpacing: "1.5px", textTransform: "uppercase", color: g.color, fontFamily: P.raj, fontWeight: 700, opacity: 0.85 }}>{g.group}</div>
              {g.tabs.map(t => (
                <button key={t.id} className="adm-tab" onClick={() => setActiveTab(t.id)} style={{ padding: "7px 14px", background: activeTab === t.id ? `${t.color}18` : "transparent", border: `1px solid ${activeTab === t.id ? t.color : "transparent"}`, borderRadius: 6, color: activeTab === t.id ? t.color : "#5a3f8a", fontSize: 10.5, cursor: "pointer", fontFamily: P.raj, fontWeight: 700, letterSpacing: "0.4px", textTransform: "uppercase", transition: "all 0.18s", flexShrink: 0 }}>{t.label}</button>
              ))}
            </div>
          ))}
        </div>

        {/* ── FLAGS & BANS TAB ── */}
        {activeTab === "flags" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 16, color: "#fff", marginBottom: 2 }}>Flagged Wallets</div>
                <div style={{ fontSize: 11, color: "#7755aa", fontFamily: P.raj }}>Auto-flagged by anti-cheat gates. Soft-banned when ≥3 flags in 24h.</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={fetchFlagsAndBans} disabled={flagsLoading} style={{ padding: "7px 14px", background: P.p3, border: `1px solid ${P.b2}`, borderRadius: 6, color: "#a67fff", fontSize: 10.5, cursor: flagsLoading ? "wait" : "pointer", fontFamily: P.raj, fontWeight: 700, letterSpacing: "0.4px", textTransform: "uppercase" }}>↻ Refresh</button>
                <button onClick={clearAllFlags} disabled={clearingFlags === "all"} style={{ padding: "7px 14px", background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.28)", borderRadius: 6, color: "#ff4444", fontSize: 10.5, cursor: clearingFlags === "all" ? "wait" : "pointer", fontFamily: P.raj, fontWeight: 700, letterSpacing: "0.4px", textTransform: "uppercase" }}>
                  {clearingFlags === "all" ? "Clearing..." : "🧹 Clear All Flags"}
                </button>
              </div>
            </div>

            {flagsLoading ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: "#5533aa", fontFamily: P.raj }}>Loading...</div>
            ) : flaggedPlayers.length === 0 ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: "#5533aa", fontFamily: P.raj, background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10 }}>
                No flagged wallets. Anti-cheat gates haven't triggered recently.
              </div>
            ) : (
              <div style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10, overflow: "hidden", marginBottom: 32 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.6fr 0.5fr 0.5fr 1fr 1fr 1.4fr", padding: "10px 14px", background: P.p3, borderBottom: `1px solid ${P.b}`, fontSize: 9, color: "#7755aa", textTransform: "uppercase", letterSpacing: "1px", fontFamily: P.raj, fontWeight: 700 }}>
                  <div>Wallet</div>
                  <div>Total</div>
                  <div>Recent 24h</div>
                  <div>Status</div>
                  <div>Last Flag</div>
                  <div style={{ textAlign: "right" }}>Actions</div>
                </div>
                {flaggedPlayers.map(p => (
                  <div key={p.player} style={{ display: "grid", gridTemplateColumns: "1.6fr 0.5fr 0.5fr 1fr 1fr 1.4fr", padding: "11px 14px", borderBottom: `1px solid ${P.b}`, fontSize: 11, color: "#c4a0ff", fontFamily: "monospace", alignItems: "center" }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.player}</div>
                    <div>{p.total}</div>
                    <div style={{ color: p.recent >= 3 ? "#ff4444" : p.recent > 0 ? "#FFB800" : "#5533aa" }}>{p.recent}</div>
                    <div style={{ fontFamily: P.raj, fontSize: 10, fontWeight: 700, color: p.banned ? "#ff4444" : "#00FF88" }}>{p.banned ? "🚫 SOFT-BAN" : "OK"}</div>
                    <div style={{ fontFamily: P.raj, fontSize: 10, color: "#7755aa" }}>{p.lastFlaggedAt ? new Date(p.lastFlaggedAt).toLocaleString() : "-"}</div>
                    <div style={{ display: "flex", gap: 5, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <button onClick={() => clearWalletFlags(p.player)} disabled={clearingFlags === p.player} style={{ padding: "5px 10px", background: "rgba(0,255,136,0.08)", border: "1px solid rgba(0,255,136,0.25)", borderRadius: 5, color: "#00FF88", fontSize: 9.5, cursor: clearingFlags === p.player ? "wait" : "pointer", fontFamily: P.raj, fontWeight: 700 }}>
                        {clearingFlags === p.player ? "..." : "Clear"}
                      </button>
                      <button onClick={() => banWallet(p.player)} disabled={banningWallet === p.player} style={{ padding: "5px 10px", background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.25)", borderRadius: 5, color: "#ff4444", fontSize: 9.5, cursor: banningWallet === p.player ? "wait" : "pointer", fontFamily: P.raj, fontWeight: 700 }}>
                        {banningWallet === p.player ? "..." : "Ban"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 20 }}>
              <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 16, color: "#fff", marginBottom: 2 }}>Banned Wallets</div>
              <div style={{ fontSize: 11, color: "#7755aa", fontFamily: P.raj, marginBottom: 12 }}>Hard-blacklisted — refused at auth + sign-score. Manual only.</div>

              {bannedPlayers.length === 0 ? (
                <div style={{ padding: "24px 0", textAlign: "center", color: "#5533aa", fontFamily: P.raj, background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10 }}>
                  No banned wallets.
                </div>
              ) : (
                <div style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1.5fr 1fr 1fr 0.6fr", padding: "10px 14px", background: P.p3, borderBottom: `1px solid ${P.b}`, fontSize: 9, color: "#7755aa", textTransform: "uppercase", letterSpacing: "1px", fontFamily: P.raj, fontWeight: 700 }}>
                    <div>Wallet</div><div>Reason</div><div>Banned By</div><div>When</div><div style={{ textAlign: "right" }}>Actions</div>
                  </div>
                  {bannedPlayers.map(b => (
                    <div key={b.wallet} style={{ display: "grid", gridTemplateColumns: "1.6fr 1.5fr 1fr 1fr 0.6fr", padding: "11px 14px", borderBottom: `1px solid ${P.b}`, fontSize: 11, color: "#c4a0ff", fontFamily: "monospace", alignItems: "center" }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.wallet}</div>
                      <div style={{ fontFamily: P.raj, fontSize: 10.5, color: "#7755aa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.reason || "—"}</div>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.bannedBy ? b.bannedBy.slice(0, 10) + "…" : "—"}</div>
                      <div style={{ fontFamily: P.raj, fontSize: 10, color: "#7755aa" }}>{b.bannedAt ? new Date(b.bannedAt).toLocaleDateString() : "—"}</div>
                      <div style={{ textAlign: "right" }}>
                        <button onClick={() => unbanWallet(b.wallet)} disabled={banningWallet === b.wallet} style={{ padding: "5px 10px", background: "rgba(0,255,136,0.08)", border: "1px solid rgba(0,255,136,0.25)", borderRadius: 5, color: "#00FF88", fontSize: 9.5, cursor: banningWallet === b.wallet ? "wait" : "pointer", fontFamily: P.raj, fontWeight: 700 }}>
                          {banningWallet === b.wallet ? "..." : "Unban"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TASKON CONFIG TAB ── */}
        {activeTab === "taskon" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 16, color: "#fff", marginBottom: 2 }}>TaskOn Campaign Config</div>
                <div style={{ fontSize: 11, color: "#7755aa", fontFamily: P.raj }}>Per-chain quest ID + campaign URL. Enable = enforce; disable = fail-open.</div>
              </div>
              <button onClick={fetchTaskonConfigs} disabled={taskonLoading} style={{ padding: "7px 14px", background: P.p3, border: `1px solid ${P.b2}`, borderRadius: 6, color: "#a67fff", fontSize: 10.5, cursor: taskonLoading ? "wait" : "pointer", fontFamily: P.raj, fontWeight: 700, letterSpacing: "0.4px", textTransform: "uppercase" }}>↻ Refresh</button>
            </div>

            {taskonEnvFallback && !taskonEnvFallback.clientIdSet && (
              <div style={{ padding: "10px 14px", background: "rgba(255,183,0,0.06)", border: "1px solid rgba(255,183,0,0.22)", borderRadius: 8, color: "#FFB800", fontSize: 11, fontFamily: P.raj, marginBottom: 14 }}>
                ⚠️  TASKON_CLIENT_ID env var not set. TaskOn gate is disabled globally regardless of the per-chain switches below.
              </div>
            )}

            {taskonLoading ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: "#5533aa", fontFamily: P.raj }}>Loading configs...</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {CHAIN_LIST.map(chain => {
                  const draft = taskonDrafts[chain.key] || { enabled: false, questId: "", campaignUrl: "" };
                  const stored = taskonConfigs[chain.key];
                  const dirty = stored
                    ? (stored.enabled !== draft.enabled || stored.questId !== draft.questId || stored.campaignUrl !== draft.campaignUrl)
                    : (draft.enabled || draft.questId || draft.campaignUrl);
                  const msg = taskonSaveMsg[chain.key];
                  return (
                    <div key={chain.key} style={{ background: P.s1, border: `1px solid ${draft.enabled ? "rgba(0,255,136,0.25)" : P.b}`, borderRadius: 10, padding: "16px 18px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 15, color: "#fff", textTransform: "uppercase", letterSpacing: "0.3px" }}>{chain.name}</div>
                          <div style={{ fontSize: 9, color: "#7755aa", fontFamily: P.raj, letterSpacing: "1px", textTransform: "uppercase" }}>· {chain.key}</div>
                          {stored?.updatedAt && (
                            <div style={{ fontSize: 9.5, color: "#5533aa", fontFamily: P.raj, marginLeft: 6 }}>
                              updated {new Date(stored.updatedAt).toLocaleString()}
                            </div>
                          )}
                        </div>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
                          <span style={{ fontSize: 10, color: draft.enabled ? "#00FF88" : "#5533aa", fontFamily: P.raj, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase" }}>{draft.enabled ? "Enforced" : "Disabled"}</span>
                          <input
                            type="checkbox"
                            checked={draft.enabled}
                            onChange={e => setTaskonDrafts(d => ({ ...d, [chain.key]: { ...draft, enabled: e.target.checked } }))}
                            style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#00FF88" }}
                          />
                        </label>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 9, color: "#7755aa", textTransform: "uppercase", letterSpacing: "1.2px", fontFamily: P.raj, fontWeight: 700, marginBottom: 5 }}>Quest ID</div>
                          <input
                            type="text"
                            value={draft.questId}
                            placeholder="e.g. 904321254"
                            onChange={e => setTaskonDrafts(d => ({ ...d, [chain.key]: { ...draft, questId: e.target.value } }))}
                            style={{ width: "100%", padding: "8px 10px", background: P.bg, border: `1px solid ${P.b}`, borderRadius: 6, color: "#c4a0ff", fontFamily: "monospace", fontSize: 12, outline: "none" }}
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: "#7755aa", textTransform: "uppercase", letterSpacing: "1.2px", fontFamily: P.raj, fontWeight: 700, marginBottom: 5 }}>Campaign URL</div>
                          <input
                            type="text"
                            value={draft.campaignUrl}
                            placeholder="https://taskon.xyz/quest/…"
                            onChange={e => setTaskonDrafts(d => ({ ...d, [chain.key]: { ...draft, campaignUrl: e.target.value } }))}
                            style={{ width: "100%", padding: "8px 10px", background: P.bg, border: `1px solid ${P.b}`, borderRadius: 6, color: "#c4a0ff", fontFamily: "monospace", fontSize: 12, outline: "none" }}
                          />
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ fontSize: 10.5, color: msg?.startsWith("✅") ? "#00FF88" : msg?.startsWith("❌") ? "#ff4444" : "#5533aa", fontFamily: P.raj, fontWeight: 600 }}>
                          {msg || (dirty ? "Unsaved changes" : stored ? "In sync" : "Not configured")}
                        </div>
                        <button
                          onClick={() => saveTaskonConfig(chain.key)}
                          disabled={!dirty || taskonSaving === chain.key}
                          style={{ padding: "8px 18px", background: (!dirty || taskonSaving === chain.key) ? P.p3 : "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: (!dirty || taskonSaving === chain.key) ? `1px solid ${P.b2}` : "none", borderRadius: 6, color: (!dirty || taskonSaving === chain.key) ? "#5a3f8a" : "#fff", fontSize: 11, cursor: (!dirty || taskonSaving === chain.key) ? "not-allowed" : "pointer", fontFamily: P.raj, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase" }}>
                          {taskonSaving === chain.key ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

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

        <AdminOps />

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