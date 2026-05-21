import { useState, useEffect, useRef } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useNavigate } from "react-router-dom";
import { useGames } from "../hooks/useGames";

const TOURNAMENT_ADDRESS = import.meta.env.VITE_TOURNAMENT_ADDRESS;
const ARCADE_TOKEN_ADDRESS = import.meta.env.VITE_ARCADE_TOKEN_ADDRESS;

const TOURNAMENT_ABI = [
  { name: "createTournament", type: "function", stateMutability: "nonpayable", inputs: [{ name: "gameId", type: "uint256" }, { name: "gameName", type: "string" }, { name: "gameThumbnail", type: "string" }, { name: "entryFee", type: "uint256" }, { name: "maxPlayers", type: "uint256" }, { name: "startTime", type: "uint256" }, { name: "durationInHours", type: "uint256" }], outputs: [] },
  { name: "joinTournament", type: "function", stateMutability: "nonpayable", inputs: [{ name: "tournamentId", type: "uint256" }], outputs: [] },
  { name: "submitTournamentScore", type: "function", stateMutability: "nonpayable", inputs: [{ name: "tournamentId", type: "uint256" }, { name: "score", type: "uint256" }], outputs: [] },
  { name: "endTournamentAndDistribute", type: "function", stateMutability: "nonpayable", inputs: [{ name: "tournamentId", type: "uint256" }], outputs: [] },
  { name: "getTournamentInfo", type: "function", stateMutability: "view", inputs: [{ name: "tournamentId", type: "uint256" }], outputs: [{ name: "", type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "gameId", type: "uint256" }, { name: "gameName", type: "string" }, { name: "gameThumbnail", type: "string" }, { name: "creator", type: "address" }, { name: "entryFee", type: "uint256" }, { name: "maxPlayers", type: "uint256" }, { name: "startTime", type: "uint256" }, { name: "endTime", type: "uint256" }, { name: "prizePool", type: "uint256" }, { name: "status", type: "uint8" }, { name: "players", type: "address[]" }, { name: "prizesDistributed", type: "bool" }] }] },
  { name: "nextTournamentId", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "getTournamentPlayers", type: "function", stateMutability: "view", inputs: [{ name: "tournamentId", type: "uint256" }], outputs: [{ name: "", type: "address[]" }, { name: "", type: "uint256[]" }] },
];

const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
];

const STATUS = ["Upcoming", "Active", "Ended", "Cancelled"];
const STATUS_COLOR = {
  Upcoming: { color: "#00d4ff", bg: "rgba(0,212,255,0.08)", border: "rgba(0,212,255,0.25)" },
  Active: { color: "#00FF88", bg: "rgba(0,255,136,0.08)", border: "rgba(0,255,136,0.25)" },
  Ended: { color: "#7755aa", bg: "rgba(123,47,255,0.08)", border: "rgba(123,47,255,0.2)" },
  Cancelled: { color: "#ff4444", bg: "rgba(255,68,68,0.08)", border: "rgba(255,68,68,0.2)" },
};

function useCountdown(endTime) {
  const [time, setTime] = useState("");
  useEffect(() => {
    const update = () => {
      const diff = endTime * 1000 - Date.now();
      if (diff <= 0) { setTime("Ended"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTime(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [endTime]);
  return time;
}

function CountdownTimer({ endTime, startTime }) {
  const now = Date.now() / 1000;
  const target = now < startTime ? startTime : endTime;
  const label = now < startTime ? "Starts in" : "Ends in";
  const time = useCountdown(target);
  const isUrgent = (target * 1000 - Date.now()) < 3600000;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 9, color: "#5533aa", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 4 }}>{label}</div>
      <div style={{
        fontFamily: "'Orbitron',sans-serif", fontWeight: 700, fontSize: 18,
        color: isUrgent ? "#ff4444" : "#00d4ff",
        animation: isUrgent ? "urgentPulse 1s ease-in-out infinite" : "none",
        letterSpacing: "2px",
      }}>{time}</div>
    </div>
  );
}

function PrizePoolCounter({ prizePool }) {
  const [display, setDisplay] = useState(0);
  const target = Number(prizePool) / 1e18;
  useEffect(() => {
    let start = 0;
    const step = target / 30;
    const t = setInterval(() => {
      start += step;
      if (start >= target) { setDisplay(target); clearInterval(t); }
      else setDisplay(start);
    }, 30);
    return () => clearInterval(t);
  }, [target]);
  return <span>{display.toFixed(0)}</span>;
}

function TournamentCard({ tournament, onJoin, onEnd, address, joining }) {
  const [hovered, setHovered] = useState(false);
  const status = STATUS[tournament.status] || "Upcoming";
  const sc = STATUS_COLOR[status];
  const playersCount = tournament.players?.length || 0;
  const maxPlayers = Number(tournament.maxPlayers);
  const fillPct = maxPlayers > 0 ? (playersCount / maxPlayers) * 100 : 0;
  const entryFee = Number(tournament.entryFee) / 1e18;
  const prizePool = Number(tournament.prizePool) / 1e18;
  const isJoined = tournament.players?.map(p => p.toLowerCase()).includes(address?.toLowerCase());
  const isFull = playersCount >= maxPlayers;
  const canEnd = status === "Active" && Number(tournament.endTime) * 1000 < Date.now();
  const now = Date.now() / 1000;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "rgba(14,12,26,0.95)" : "rgba(10,8,20,0.9)",
        border: `1px solid ${hovered ? sc.border : "rgba(123,47,255,0.15)"}`,
        borderRadius: 16,
        overflow: "hidden",
        transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
        transform: hovered ? "translateY(-4px) scale(1.01)" : "translateY(0) scale(1)",
        boxShadow: hovered ? `0 20px 40px rgba(0,0,0,0.5), 0 0 30px ${sc.color}18` : "0 4px 12px rgba(0,0,0,0.3)",
        position: "relative",
      }}
    >
      {/* Glow top border */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${sc.color}, transparent)`, opacity: hovered ? 1 : 0.4, transition: "opacity 0.3s" }} />

      {/* Thumbnail */}
      <div style={{ position: "relative", height: 140, background: "#060510", overflow: "hidden" }}>
        {tournament.gameThumbnail ? (
          <img src={tournament.gameThumbnail} alt={tournament.gameName} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.8 }} />
        ) : (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44 }}>🏆</div>
        )}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(10,8,20,0.95) 0%, transparent 60%)" }} />

        {/* Status badge */}
        <div style={{ position: "absolute", top: 10, left: 10, padding: "4px 10px", borderRadius: 20, fontSize: 9, fontWeight: 700, background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`, fontFamily: "'Rajdhani',sans-serif", letterSpacing: "1.5px", backdropFilter: "blur(8px)" }}>
          {status === "Active" && <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#00FF88", marginRight: 5, animation: "livePulse 1s ease-in-out infinite" }} />}
          {status.toUpperCase()}
        </div>

        {/* Prize pool badge */}
        <div style={{ position: "absolute", top: 10, right: 10, padding: "4px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: "rgba(255,183,0,0.15)", color: "#FFB700", border: "1px solid rgba(255,183,0,0.3)", fontFamily: "'Orbitron',sans-serif", backdropFilter: "blur(8px)" }}>
          🏆 <PrizePoolCounter prizePool={tournament.prizePool} /> ARCADE
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "14px 16px" }}>
        <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 16, color: "#fff", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tournament.gameName}</div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: "#5533aa", fontFamily: "'Rajdhani',sans-serif" }}>Entry:</div>
          <div style={{ fontSize: 10, color: "#a67fff", fontFamily: "'Orbitron',sans-serif", fontWeight: 700 }}>{entryFee} ARCADE</div>
        </div>

        {/* Players bar */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <div style={{ fontSize: 9, color: "#5533aa", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px" }}>Players</div>
            <div style={{ fontSize: 10, color: "#a67fff", fontFamily: "'Orbitron',sans-serif", fontWeight: 700 }}>{playersCount}/{maxPlayers}</div>
          </div>
          <div style={{ height: 4, background: "rgba(123,47,255,0.1)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${fillPct}%`, background: fillPct >= 80 ? "linear-gradient(90deg,#ff4444,#ff7700)" : "linear-gradient(90deg,#7B2FFF,#00d4ff)", borderRadius: 2, transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
          </div>
          {/* Player dots */}
          <div style={{ display: "flex", gap: 3, marginTop: 6, flexWrap: "wrap" }}>
            {Array.from({ length: Math.min(maxPlayers, 10) }).map((_, i) => (
              <div key={i} style={{ width: 14, height: 14, borderRadius: "50%", background: i < playersCount ? (i < 3 ? sc.color : "rgba(123,47,255,0.5)") : "rgba(123,47,255,0.1)", border: `1px solid ${i < playersCount ? sc.border : "rgba(123,47,255,0.1)"}`, transition: "all 0.3s", transitionDelay: `${i * 0.05}s` }} />
            ))}
            {maxPlayers > 10 && <div style={{ fontSize: 9, color: "#5533aa", fontFamily: "'Rajdhani',sans-serif", alignSelf: "center" }}>+{maxPlayers - 10}</div>}
          </div>
        </div>

        {/* Countdown */}
        <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, border: "1px solid rgba(123,47,255,0.1)" }}>
          <CountdownTimer endTime={Number(tournament.endTime)} startTime={Number(tournament.startTime)} />
        </div>

        {/* Action button */}
        {status !== "Ended" && status !== "Cancelled" && (
          isJoined ? (
            <div style={{ width: "100%", padding: "10px", background: "rgba(0,255,136,0.06)", border: "1px solid rgba(0,255,136,0.15)", borderRadius: 8, color: "#00FF88", fontSize: 11, fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, textAlign: "center", letterSpacing: "1px" }}>
              ✓ JOINED
            </div>
          ) : isFull ? (
            <div style={{ width: "100%", padding: "10px", background: "rgba(255,68,68,0.06)", border: "1px solid rgba(255,68,68,0.15)", borderRadius: 8, color: "#ff4444", fontSize: 11, fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, textAlign: "center" }}>
              FULL
            </div>
          ) : (
            <button onClick={() => onJoin(tournament)} disabled={joining} style={{
              width: "100%", padding: "11px",
              background: joining ? "rgba(123,47,255,0.2)" : `linear-gradient(135deg, #7B2FFF, #5a1fd4)`,
              border: "none", borderRadius: 8,
              color: joining ? "#5533aa" : "#fff",
              fontSize: 12, fontWeight: 700, cursor: joining ? "not-allowed" : "pointer",
              fontFamily: "'Rajdhani',sans-serif", letterSpacing: "1.5px", textTransform: "uppercase",
              transition: "all 0.2s", position: "relative", overflow: "hidden",
            }}>
              {joining ? "Joining..." : `JOIN — ${entryFee} ARCADE`}
              {!joining && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent)", transform: hovered ? "translateX(100%)" : "translateX(-100%)", transition: "transform 0.5s" }} />}
            </button>
          )
        )}

        {canEnd && (
          <button onClick={() => onEnd(tournament)} style={{ width: "100%", padding: "10px", marginTop: 8, background: "rgba(255,183,0,0.08)", border: "1px solid rgba(255,183,0,0.2)", borderRadius: 8, color: "#FFB700", fontSize: 11, cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: "1px" }}>
            🏆 END & DISTRIBUTE PRIZES
          </button>
        )}
      </div>
    </div>
  );
}

function CreateModal({ games, onClose, onCreate, loading }) {
  const tomorrow = Math.floor(Date.now() / 1000) + 3600;
  const [form, setForm] = useState({ gameId: "", entryFee: "100", maxPlayers: "10", startTime: tomorrow, durationInHours: "24" });
  const selectedGame = games.find(g => g.id === Number(form.gameId));

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div style={{ background: "#0e0c1a", border: "1px solid rgba(123,47,255,0.3)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 480, position: "relative" }} onClick={e => e.stopPropagation()}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg,#7B2FFF,#00d4ff)", borderRadius: "16px 16px 0 0" }} />

        <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 20, color: "#fff", marginBottom: 20, textTransform: "uppercase", letterSpacing: "1px" }}>
          🏆 Create Tournament
        </div>

        {[
          { label: "Select Game", key: "gameId", type: "select", options: games.map(g => ({ value: g.id, label: g.name })) },
          { label: "Entry Fee (ARCADE)", key: "entryFee", type: "number", placeholder: "100" },
          { label: "Max Players", key: "maxPlayers", type: "number", placeholder: "10" },
          { label: "Duration (hours)", key: "durationInHours", type: "number", placeholder: "24" },
        ].map(field => (
          <div key={field.key} style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 9, color: "#7755aa", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", display: "block", marginBottom: 5 }}>{field.label}</label>
            {field.type === "select" ? (
              <select value={form[field.key]} onChange={e => setForm({ ...form, [field.key]: e.target.value })} style={{ width: "100%", padding: "10px 12px", background: "rgba(123,47,255,0.06)", border: "1px solid rgba(123,47,255,0.2)", borderRadius: 7, color: "#d4b8ff", fontSize: 12, fontFamily: "'Rajdhani',sans-serif", outline: "none" }}>
                <option value="">-- Select a game --</option>
                {field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input type={field.type} value={form[field.key]} onChange={e => setForm({ ...form, [field.key]: e.target.value })} placeholder={field.placeholder} style={{ width: "100%", padding: "10px 12px", background: "rgba(123,47,255,0.06)", border: "1px solid rgba(123,47,255,0.2)", borderRadius: 7, color: "#d4b8ff", fontSize: 12, fontFamily: "'Rajdhani',sans-serif", outline: "none", boxSizing: "border-box" }} />
            )}
          </div>
        ))}

        {/* Preview */}
        {form.gameId && form.entryFee && form.maxPlayers && (
          <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(123,47,255,0.15)", borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 9, color: "#7755aa", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 8 }}>Prize Preview</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center" }}>
              {[["🥇 1st", 60], ["🥈 2nd", 25], ["🥉 3rd", 15]].map(([label, pct]) => (
                <div key={label} style={{ background: "rgba(123,47,255,0.08)", borderRadius: 6, padding: "8px 4px" }}>
                  <div style={{ fontSize: 12, marginBottom: 3 }}>{label}</div>
                  <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 11, color: "#FFB700", fontWeight: 700 }}>
                    {Math.floor(Number(form.entryFee) * Number(form.maxPlayers) * 0.95 * pct / 100)}
                  </div>
                  <div style={{ fontSize: 8, color: "#5533aa", fontFamily: "'Rajdhani',sans-serif" }}>ARCADE</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "11px", background: "rgba(123,47,255,0.06)", border: "1px solid rgba(123,47,255,0.2)", borderRadius: 8, color: "#a67fff", fontSize: 12, cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700 }}>Cancel</button>
          <button onClick={() => onCreate(form, selectedGame)} disabled={loading || !form.gameId} style={{ flex: 2, padding: "11px", background: loading || !form.gameId ? "rgba(123,47,255,0.2)" : "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 8, color: loading || !form.gameId ? "#5533aa" : "#fff", fontSize: 12, fontWeight: 700, cursor: loading || !form.gameId ? "not-allowed" : "pointer", fontFamily: "'Rajdhani',sans-serif", letterSpacing: "0.5px" }}>
            {loading ? "Creating..." : "🚀 Create Tournament"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Tournaments() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const navigate = useNavigate();
  const { games } = useGames();

  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joiningId, setJoiningId] = useState(null);
  const [msg, setMsg] = useState("");
  const [particles] = useState(() => Array.from({ length: 20 }, (_, i) => ({
    id: i, x: Math.random() * 100, y: Math.random() * 100,
    size: Math.random() * 3 + 1, delay: Math.random() * 4, duration: Math.random() * 3 + 2,
  })));

  const fetchTournaments = async () => {
    if (!publicClient) return;
    setLoading(true);
    try {
      const nextId = await publicClient.readContract({ address: TOURNAMENT_ADDRESS, abi: TOURNAMENT_ABI, functionName: "nextTournamentId" });
      const total = Number(nextId) - 1;
      if (total <= 0) { setTournaments([]); setLoading(false); return; }
      const results = await Promise.all(
        Array.from({ length: total }, (_, i) =>
          publicClient.readContract({ address: TOURNAMENT_ADDRESS, abi: TOURNAMENT_ABI, functionName: "getTournamentInfo", args: [BigInt(i + 1)] })
        )
      );
      setTournaments(results.map(t => ({ ...t, id: Number(t.id), gameId: Number(t.gameId), entryFee: t.entryFee, maxPlayers: Number(t.maxPlayers), startTime: Number(t.startTime), endTime: Number(t.endTime), prizePool: t.prizePool, status: Number(t.status), players: t.players })));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchTournaments();
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [publicClient]);

  const handleCreate = async (form, selectedGame) => {
    if (!walletClient || !selectedGame) return;
    setCreating(true);
    try {
      const startTime = BigInt(Math.floor(Date.now() / 1000) + 60);
      const hash = await walletClient.writeContract({
        address: TOURNAMENT_ADDRESS, abi: TOURNAMENT_ABI, functionName: "createTournament",
        args: [BigInt(selectedGame.id), selectedGame.name, selectedGame.thumbnailUrl || "", BigInt(Number(form.entryFee) * 1e18), BigInt(form.maxPlayers), startTime, BigInt(form.durationInHours)],
        account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setMsg("✓ Tournament created!");
      setShowCreate(false);
      await fetchTournaments();
    } catch (err) { setMsg("Error: " + err.message); }
    finally { setCreating(false); }
  };

  const handleJoin = async (tournament) => {
    if (!walletClient || !address) return;
    setJoining(true);
    setJoiningId(tournament.id);
    try {
      // 1. Approve ARCADE tokens
      const allowance = await publicClient.readContract({ address: ARCADE_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "allowance", args: [address, TOURNAMENT_ADDRESS] });
      if (BigInt(allowance) < BigInt(tournament.entryFee)) {
        const approveHash = await walletClient.writeContract({ address: ARCADE_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "approve", args: [TOURNAMENT_ADDRESS, tournament.entryFee], account: address });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
      // 2. Join tournament
      const hash = await walletClient.writeContract({ address: TOURNAMENT_ADDRESS, abi: TOURNAMENT_ABI, functionName: "joinTournament", args: [BigInt(tournament.id)], account: address });
      await publicClient.waitForTransactionReceipt({ hash });
      setMsg("✓ Joined tournament!");
      await fetchTournaments();
    } catch (err) { setMsg("Error: " + err.message); }
    finally { setJoining(false); setJoiningId(null); }
  };

  const handleEnd = async (tournament) => {
    if (!walletClient) return;
    try {
      const hash = await walletClient.writeContract({ address: TOURNAMENT_ADDRESS, abi: TOURNAMENT_ABI, functionName: "endTournamentAndDistribute", args: [BigInt(tournament.id)], account: address });
      await publicClient.waitForTransactionReceipt({ hash });
      setMsg("🏆 Prizes distributed!");
      await fetchTournaments();
    } catch (err) { setMsg("Error: " + err.message); }
  };

  const filtered = tournaments.filter(t => {
    if (activeTab === "active") return t.status === 1;
    if (activeTab === "upcoming") return t.status === 0;
    if (activeTab === "ended") return t.status === 2;
    return true;
  });

  const activeCnt = tournaments.filter(t => t.status === 1).length;
  const upcomingCnt = tournaments.filter(t => t.status === 0).length;
  const endedCnt = tournaments.filter(t => t.status === 2).length;

  return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: "#08070f", position: "relative", overflow: "hidden" }}>
      <style>{`
        @keyframes livePulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(1.3)} }
        @keyframes urgentPulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes floatParticle { 0%{transform:translateY(0) scale(1);opacity:0.6} 50%{opacity:1} 100%{transform:translateY(-100px) scale(0.5);opacity:0} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes slideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes trophyBounce { 0%,100%{transform:translateY(0) rotate(-5deg)} 50%{transform:translateY(-8px) rotate(5deg)} }
        @keyframes gradientShift { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
        .tab-btn:hover { color: #c4a0ff !important; }
        .create-btn:hover { transform: translateY(-2px) !important; box-shadow: 0 8px 25px rgba(123,47,255,0.4) !important; }
      `}</style>

      {/* Animated particles */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        {particles.map(p => (
          <div key={p.id} style={{
            position: "absolute", left: `${p.x}%`, top: `${p.y}%`,
            width: p.size, height: p.size, borderRadius: "50%",
            background: p.id % 3 === 0 ? "#7B2FFF" : p.id % 3 === 1 ? "#00d4ff" : "#FFB700",
            opacity: 0.3, animation: `floatParticle ${p.duration}s ${p.delay}s ease-in-out infinite`,
          }} />
        ))}
        {/* Grid bg */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(123,47,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(123,47,255,0.04) 1px, transparent 1px)", backgroundSize: "50px 50px" }} />
        {/* Center glow */}
        <div style={{ position: "absolute", top: "10%", left: "50%", transform: "translateX(-50%)", width: 600, height: 300, background: "radial-gradient(ellipse, rgba(123,47,255,0.12) 0%, transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />
      </div>

      <div style={{ position: "relative", zIndex: 1, padding: "28px 36px" }}>

        {/* Hero Header */}
        <div style={{ marginBottom: 32, animation: "slideUp 0.6s ease forwards" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 40, animation: "trophyBounce 2s ease-in-out infinite" }}>🏆</div>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", border: "1px solid rgba(255,183,0,0.25)", borderRadius: 4, fontSize: 9, color: "rgba(255,183,0,0.7)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: 8, background: "rgba(255,183,0,0.06)", fontFamily: "'Rajdhani',sans-serif", fontWeight: 600 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#FFB700", animation: "livePulse 1.5s ease-in-out infinite" }} />
                Compete · Earn · Dominate
              </div>
              <h1 style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: isMobile ? 28 : 44, letterSpacing: "-0.5px", textTransform: "uppercase", lineHeight: 0.95, color: "#fff", margin: 0 }}>
                TOURNAMENT<br />
                <span style={{ background: "linear-gradient(90deg,#FFB700,#FF6B00,#FFB700)", backgroundSize: "200% 100%", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "gradientShift 3s ease infinite" }}>ARENA</span>
              </h1>
            </div>
          </div>

          {/* Stats row */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { label: "Active", value: activeCnt, color: "#00FF88", icon: "⚡" },
              { label: "Upcoming", value: upcomingCnt, color: "#00d4ff", icon: "🔜" },
              { label: "Total", value: tournaments.length, color: "#a67fff", icon: "🎮" },
            ].map(s => (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", background: "rgba(0,0,0,0.4)", border: `1px solid rgba(${s.color === "#00FF88" ? "0,255,136" : s.color === "#00d4ff" ? "0,212,255" : "123,47,255"},0.2)`, borderRadius: 20, backdropFilter: "blur(8px)" }}>
                <span style={{ fontSize: 12 }}>{s.icon}</span>
                <span style={{ fontFamily: "'Orbitron',sans-serif", fontWeight: 700, fontSize: 14, color: s.color }}>{s.value}</span>
                <span style={{ fontSize: 10, color: "#5533aa", fontFamily: "'Rajdhani',sans-serif" }}>{s.label}</span>
              </div>
            ))}


          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "1px solid rgba(123,47,255,0.15)" }}>
          {[
            { id: "all", label: `All (${tournaments.length})` },
            { id: "active", label: `Live (${activeCnt})`, dot: true },
            { id: "upcoming", label: `Upcoming (${upcomingCnt})` },
            { id: "ended", label: `Ended (${endedCnt})` },
          ].map(t => (
            <button key={t.id} className="tab-btn" onClick={() => setActiveTab(t.id)} style={{ padding: "10px 22px", background: "transparent", border: "none", borderBottom: activeTab === t.id ? "2px solid #7B2FFF" : "2px solid transparent", color: activeTab === t.id ? "#c4a0ff" : "#3a2a5a", fontSize: 12, cursor: "pointer", marginBottom: "-1px", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", transition: "color 0.18s", display: "flex", alignItems: "center", gap: 6 }}>
              {t.dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00FF88", animation: "livePulse 1s ease-in-out infinite" }} />}
              {t.label}
            </button>
          ))}
        </div>

        {/* Msg */}
        {msg && (
          <div style={{ marginBottom: 16, padding: "12px 18px", background: msg.startsWith("✓") || msg.startsWith("🏆") ? "rgba(0,255,136,0.06)" : "rgba(255,68,68,0.06)", border: `1px solid ${msg.startsWith("✓") || msg.startsWith("🏆") ? "rgba(0,255,136,0.2)" : "rgba(255,68,68,0.2)"}`, borderRadius: 10, fontSize: 12, color: msg.startsWith("✓") || msg.startsWith("🏆") ? "#00FF88" : "#ff4444", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {msg}
            <button onClick={() => setMsg("")} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 14 }}>✕</button>
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))", gap: isMobile ? 12 : 16 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ height: 340, borderRadius: 16, background: "linear-gradient(90deg, rgba(123,47,255,0.06) 25%, rgba(123,47,255,0.12) 50%, rgba(123,47,255,0.06) 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite", border: "1px solid rgba(123,47,255,0.1)" }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "80px 0", textAlign: "center", animation: "slideUp 0.4s ease forwards" }}>
            <div style={{ fontSize: 56, marginBottom: 16, animation: "trophyBounce 2s ease-in-out infinite" }}>🏆</div>
            <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 18, color: "#c4a0ff", marginBottom: 8 }}>No tournaments yet</div>
            <div style={{ fontSize: 12, color: "#5533aa", fontFamily: "'Rajdhani',sans-serif" }}>No tournaments yet — check back soon!</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))", gap: isMobile ? 12 : 16 }}>
            {filtered.map((t, i) => (
              <div key={t.id} style={{ animation: `slideUp 0.4s ${i * 0.05}s ease both` }}>
                <TournamentCard
                  tournament={t}
                  onJoin={handleJoin}
                  onEnd={handleEnd}
                  address={address}
                  joining={joining && joiningId === t.id}
                />
              </div>
            ))}
          </div>
        )}
      </div>


    </div>
  );
}
