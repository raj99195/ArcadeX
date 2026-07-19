import { useState, useEffect, useRef } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { writeContract, waitForTransactionReceipt } from "@wagmi/core";
import { wagmiAdapter } from "../Providers";
import { useNavigate } from "react-router-dom";
import { useChain } from "../context/ChainContext";
import { useFirebaseAuth } from "../hooks/useFirebaseAuth";

const S = {
  bg: "#08070f", card: "#0d0b1a", card2: "#12102a",
  border: "rgba(123,47,255,0.14)", border2: "rgba(123,47,255,0.28)",
  purple: "#7B2FFF", purpleL: "#B088FF", cyan: "#00D4FF",
  green: "#00FF88", gold: "#FFB700", red: "#FF4444",
  dim: "#9977CC", dimMore: "#5533AA",
  raj: "'Rajdhani', sans-serif", orb: "'Orbitron', sans-serif",
};

const TYPE_META = {
  battle: { label: "Battle Royale", color: "#FF4444", bg: "rgba(255,68,68,0.08)", border: "rgba(255,68,68,0.22)", icon: "🔥", desc: "Time limit — highest score wins." },
  elim:   { label: "Elimination",   color: "#FFB700", bg: "rgba(255,183,0,0.08)", border: "rgba(255,183,0,0.22)", icon: "⚔️", desc: "Lose once, you're out." },
  robin:  { label: "Round Robin",   color: "#00FF88", bg: "rgba(0,255,136,0.08)", border: "rgba(0,255,136,0.22)", icon: "🔄", desc: "Most cumulative points wins." },
};

const NAV_ITEMS = [
  { id: "browse",      icon: "🎮", label: "Browse" },
  { id: "live",        icon: "⚡", label: "Live Now" },
  { id: "my",          icon: "🏅", label: "My Tournaments" },
  { id: "create",      icon: "➕", label: "Host" },
  { id: "leaderboard", icon: "🏆", label: "Hall of Fame" },
];

const PRESET_TOKENS = ["ARCADE", "MSTC", "USDC", "ETH", "MATIC", "Custom..."];

const TOURNAMENT_ABI = [
  { name: "createTournament", type: "function", stateMutability: "nonpayable", inputs: [{ name: "gameId", type: "uint256" }, { name: "gameName", type: "string" }, { name: "gameThumbnail", type: "string" }, { name: "entryFee", type: "uint256" }, { name: "maxPlayers", type: "uint256" }, { name: "startTime", type: "uint256" }, { name: "durationInHours", type: "uint256" }], outputs: [] },
  { name: "joinTournament", type: "function", stateMutability: "nonpayable", inputs: [{ name: "tournamentId", type: "uint256" }], outputs: [] },
  { name: "getTournamentInfo", type: "function", stateMutability: "view", inputs: [{ name: "tournamentId", type: "uint256" }], outputs: [{ name: "", type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "gameId", type: "uint256" }, { name: "gameName", type: "string" }, { name: "gameThumbnail", type: "string" }, { name: "creator", type: "address" }, { name: "entryFee", type: "uint256" }, { name: "maxPlayers", type: "uint256" }, { name: "startTime", type: "uint256" }, { name: "endTime", type: "uint256" }, { name: "prizePool", type: "uint256" }, { name: "status", type: "uint8" }, { name: "players", type: "address[]" }, { name: "prizesDistributed", type: "bool" }] }] },
  { name: "nextTournamentId", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "endTournamentAndDistribute", type: "function", stateMutability: "nonpayable", inputs: [{ name: "tournamentId", type: "uint256" }], outputs: [] },
];

const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
];

function getRealStatus(t) {
  const now = Date.now() / 1000;
  if (t.status === 2) return "ended";
  if (t.status === 3) return "cancelled";
  if (now >= t.startTime && now <= t.endTime) return "live";
  if (now > t.endTime) return "ended";
  return "upcoming";
}

// ── Auth Modal ───────────────────────────────────────────────────────────────
function AuthModal({ onClose }) {
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState("");
  const { loginWithGoogle, loginWithTwitter } = useFirebaseAuth();
  const handle = async (provider) => {
    setLoading(provider); setError("");
    try {
      if (provider === "google") await loginWithGoogle();
      else await loginWithTwitter();
      onClose();
    } catch { setError("Login failed. Try again."); }
    finally { setLoading(null); }
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }} />
      <div style={{ position: "relative", zIndex: 1, width: "min(420px, 92vw)", background: S.card2, border: `1px solid ${S.border2}`, borderRadius: 20, overflow: "hidden", animation: "modalIn 0.3s ease" }}>
        <div style={{ height: 3, background: `linear-gradient(90deg,${S.purple},${S.cyan},${S.gold})` }} />
        <div style={{ padding: "32px" }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: `linear-gradient(135deg,${S.purple},${S.cyan})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, margin: "0 auto 14px" }}>🏆</div>
            <div style={{ fontFamily: S.raj, fontWeight: 700, fontSize: 22, color: "#fff" }}>Join the Arena</div>
            <div style={{ fontSize: 13, color: S.dimMore, fontFamily: S.raj, marginTop: 6 }}>Sign in to host or join tournaments</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[["google","G","rgba(255,255,255,0.07)","rgba(255,255,255,0.15)","Continue with Google"],["twitter","✕","rgba(29,161,242,0.08)","rgba(29,161,242,0.3)","Continue with X"]].map(([p,icon,bg,border,label]) => (
              <button key={p} onClick={() => handle(p)} disabled={!!loading} style={{ width:"100%",padding:"14px 20px",background:loading===p?"rgba(123,47,255,0.1)":bg,border:`1px solid ${border}`,borderRadius:12,color:"#fff",fontSize:14,fontFamily:S.raj,fontWeight:700,cursor:loading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:12,transition:"all 0.2s" }}>
                <div style={{ width:28,height:28,borderRadius:8,background:p==="google"?"#fff":"#1da1f2",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:p==="google"?"#333":"#fff",flexShrink:0,fontWeight:700 }}>{icon}</div>
                {loading===p?"Signing in...":label}
              </button>
            ))}
          </div>
          {error && <div style={{ marginTop:12,padding:"10px 14px",background:"rgba(255,68,68,0.08)",border:"1px solid rgba(255,68,68,0.2)",borderRadius:9,fontSize:12,color:"#ff6b6b",fontFamily:S.raj }}>{error}</div>}
          <div style={{ marginTop:20,textAlign:"center",fontSize:11,color:S.dimMore,fontFamily:S.raj }}>No spam. No data sold.</div>
        </div>
      </div>
    </div>
  );
}

// ── Tournament Card ──────────────────────────────────────────────────────────
function TCard({ t, onJoin, myAddress }) {
  const [hovered, setHovered] = useState(false);
  const status = getRealStatus(t);
  const m = TYPE_META[t.type] || TYPE_META.battle;
  const entryFee = Number(t.entryFee) / 1e18;
  const prizePool = Number(t.prizePool) / 1e18;
  const players = t.players?.length || 0;
  const maxPlayers = Number(t.maxPlayers);
  const pct = maxPlayers > 0 ? (players / maxPlayers) * 100 : 0;
  const isJoined = t.players?.map(p => p.toLowerCase()).includes(myAddress?.toLowerCase());

  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ background: hovered ? S.card2 : S.card, border: `1px solid ${hovered ? m.border : S.border}`, borderRadius: 16, overflow: "hidden", transition: "all 0.25s", marginBottom: 12, transform: hovered ? "translateY(-2px)" : "none", boxShadow: hovered ? `0 16px 40px rgba(0,0,0,0.5)` : "none" }}>
      <div style={{ height: 2, background: `linear-gradient(90deg,transparent,${m.color},transparent)`, opacity: hovered ? 1 : 0.3, transition: "opacity 0.3s" }} />
      <div style={{ padding: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ display:"inline-flex",alignItems:"center",gap:5,padding:"3px 10px",borderRadius:20,background:m.bg,border:`1px solid ${m.border}`,color:m.color,fontSize:11,fontWeight:700,fontFamily:S.raj }}>{m.icon} {m.label}</span>
          {status === "live" && <span style={{ display:"flex",alignItems:"center",gap:5,fontSize:11,color:S.green,fontFamily:S.raj,fontWeight:700 }}><span style={{ width:6,height:6,borderRadius:"50%",background:S.green,animation:"livePulse 1s infinite" }} />LIVE</span>}
          {status === "upcoming" && <span style={{ fontSize:11,color:S.cyan,fontFamily:S.raj,fontWeight:700 }}>⏱ Upcoming</span>}
          {status === "ended" && <span style={{ fontSize:11,color:S.dimMore,fontFamily:S.raj,fontWeight:700 }}>🏁 Ended</span>}
        </div>
        <div style={{ fontFamily: S.raj, fontWeight: 700, fontSize: 18, color: "#fff", marginBottom: 4 }}>{t.gameName}</div>
        <div style={{ fontSize: 12, color: S.dimMore, fontFamily: S.raj, marginBottom: 14 }}>by {t.creator?.slice(0,8)}...{t.creator?.slice(-4)}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
          {[
            { l: "Prize Pool", v: t.prizeConfig ? `${t.prizeConfig.total} ${t.prizeConfig.token}` : `${prizePool.toFixed(0)} ARCADE`, c: S.purpleL },
            { l: "Players", v: `${players}/${maxPlayers}`, c: "#fff" },
            { l: "Entry", v: entryFee === 0 ? "Free" : `${entryFee}`, c: entryFee === 0 ? S.green : S.gold },
          ].map(({ l, v, c }) => (
            <div key={l} style={{ background:"rgba(123,47,255,0.05)",borderRadius:9,padding:"8px 10px" }}>
              <div style={{ fontSize:9,color:S.dimMore,fontFamily:S.raj,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:3 }}>{l}</div>
              <div style={{ fontFamily:S.orb,fontSize:12,fontWeight:700,color:c }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ height:4,background:"rgba(123,47,255,0.1)",borderRadius:2,overflow:"hidden",marginBottom:12 }}>
          <div style={{ height:"100%",width:`${pct}%`,background:pct>=80?`linear-gradient(90deg,${S.red},#ff7700)`:m.color,borderRadius:2,transition:"width 0.8s" }} />
        </div>
        {isJoined ? (
          <div style={{ padding:"10px",background:"rgba(0,255,136,0.06)",border:"1px solid rgba(0,255,136,0.15)",borderRadius:9,textAlign:"center",fontSize:12,color:S.green,fontFamily:S.raj,fontWeight:700 }}>✓ Joined</div>
        ) : status !== "ended" && status !== "cancelled" ? (
          <button onClick={() => onJoin(t)} style={{ width:"100%",padding:"10px",background:`linear-gradient(135deg,${S.purple},#5a1fd4)`,border:"none",borderRadius:9,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:S.raj,letterSpacing:"1px",textTransform:"uppercase" }}>
            {status === "upcoming" ? "Register" : "Join Now"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ── Create Tab ───────────────────────────────────────────────────────────────
function CreateTab({ rewardSymbol }) {
  const [type, setType] = useState("battle");
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState("");
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [games, setGames] = useState([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [selectedGame, setSelectedGame] = useState(null);
  const [prizeToken, setPrizeToken] = useState(rewardSymbol || "ARCADE");
  const [customToken, setCustomToken] = useState("");
  const [totalPrize, setTotalPrize] = useState("");
  const [distribution, setDistribution] = useState({ first: 60, second: 25, third: 15 });
  const [formData, setFormData] = useState({ maxPlayers: "100", entryFee: "0", durationHours: "2", startDelay: "1" });
  const { isConnected } = useAccount();
  const { contracts, chainId } = useChain();
  const { isLoggedIn, displayName, photoURL, logout } = useFirebaseAuth();

  useEffect(() => {
    const fetchGames = async () => {
      setGamesLoading(true);
      try {
        const res = await fetch("/api/games?action=list");
        const data = await res.json();
        const live = (data.games || []).filter(g => g.status === "approved");
        setGames(live);
        if (live.length > 0) setSelectedGame(live[0]);
      } catch (err) { console.error(err); }
      finally { setGamesLoading(false); }
    };
    fetchGames();
  }, []);

  const finalToken = prizeToken === "Custom..." ? customToken : prizeToken;
  const distTotal = distribution.first + distribution.second + distribution.third;
  const prize1 = totalPrize ? ((Number(totalPrize) * distribution.first) / 100).toFixed(2) : "0";
  const prize2 = totalPrize ? ((Number(totalPrize) * distribution.second) / 100).toFixed(2) : "0";
  const prize3 = totalPrize ? ((Number(totalPrize) * distribution.third) / 100).toFixed(2) : "0";

  const handleCreate = async () => {
    if (!isConnected) { setMsg("Connect wallet first"); return; }
    if (!selectedGame) { setMsg("Select a game first"); return; }
    if (!totalPrize || Number(totalPrize) <= 0) { setMsg("Enter prize pool amount"); return; }
    if (distTotal !== 100) { setMsg(`Distribution must total 100% (currently ${distTotal}%)`); return; }
    setCreating(true); setMsg("");
    try {
      const entryFeeWei = BigInt(Math.floor(Number(formData.entryFee) * 1e18));
      const startTime = BigInt(Math.floor(Date.now() / 1000) + Number(formData.startDelay) * 3600);
      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: contracts?.tournament, abi: TOURNAMENT_ABI,
        functionName: "createTournament",
        args: [BigInt(selectedGame.gameId || selectedGame.id), selectedGame.name, selectedGame.thumbnailUrl || "", entryFeeWei, BigInt(formData.maxPlayers), startTime, BigInt(formData.durationHours)],
        gas: BigInt(500000), chainId,
      });
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });
      setMsg("✅ Tournament deployed! Share it with players.");
    } catch (err) { setMsg("Error: " + (err.shortMessage || err.message)); }
    finally { setCreating(false); }
  };

  return (
    <div>
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}

      {/* Auth card */}
      <div style={{ background: S.card2, border: `1px solid ${S.border2}`, borderRadius: 16, overflow: "hidden", marginBottom: 16 }}>
        <div style={{ height: 2, background: `linear-gradient(90deg,${S.purple},${S.cyan})` }} />
        <div style={{ padding: "20px" }}>
          {isLoggedIn ? (
            <div style={{ display:"flex",alignItems:"center",gap:14 }}>
              {photoURL ? <img src={photoURL} alt="" style={{ width:44,height:44,borderRadius:"50%",border:`2px solid ${S.purple}`,flexShrink:0 }} /> : <div style={{ width:44,height:44,borderRadius:"50%",background:`linear-gradient(135deg,${S.purple},${S.cyan})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0 }}>🎮</div>}
              <div style={{ flex:1 }}>
                <div style={{ fontFamily:S.raj,fontWeight:700,fontSize:15,color:"#fff" }}>{displayName}</div>
                <div style={{ fontSize:11,color:S.green,fontFamily:S.raj,marginTop:2 }}>✅ Ready to host</div>
              </div>
              <button onClick={logout} style={{ padding:"6px 14px",background:"rgba(255,68,68,0.08)",border:"1px solid rgba(255,68,68,0.2)",borderRadius:8,color:"#ff6b6b",fontSize:12,fontFamily:S.raj,fontWeight:700,cursor:"pointer" }}>Sign out</button>
            </div>
          ) : (
            <div style={{ display:"flex",alignItems:"center",gap:16 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontFamily:S.raj,fontWeight:700,fontSize:15,color:"#fff",marginBottom:4 }}>Sign in to host</div>
                <div style={{ fontSize:12,color:S.dimMore,fontFamily:S.raj }}>Google or X required to create tournaments</div>
              </div>
              <button onClick={() => setShowAuthModal(true)} style={{ padding:"10px 20px",background:`linear-gradient(135deg,${S.purple},#5a1fd4)`,border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:S.raj,flexShrink:0 }}>Sign In →</button>
            </div>
          )}
        </div>
      </div>

      {/* Form */}
      <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, padding: "20px", display:"flex",flexDirection:"column",gap:18 }}>

        {/* Format */}
        <div>
          <div style={{ fontSize:11,color:S.dimMore,fontFamily:S.raj,fontWeight:700,textTransform:"uppercase",letterSpacing:"1px",marginBottom:10 }}>Format</div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10 }}>
            {Object.entries(TYPE_META).map(([key, m]) => (
              <div key={key} onClick={() => setType(key)} style={{ padding:"16px 10px",borderRadius:12,textAlign:"center",cursor:"pointer",border:`1px solid ${type===key?m.border:S.border}`,background:type===key?m.bg:"transparent",transition:"all 0.18s" }}>
                <div style={{ fontSize:26,marginBottom:6 }}>{m.icon}</div>
                <div style={{ fontSize:12,fontWeight:700,color:type===key?m.color:S.dimMore,fontFamily:S.raj }}>{m.label}</div>
                <div style={{ fontSize:10,color:type===key?m.color:S.dimMore,fontFamily:S.raj,marginTop:3,opacity:0.7 }}>{m.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Game Select */}
        <div>
          <div style={{ fontSize:11,color:S.dimMore,fontFamily:S.raj,fontWeight:700,textTransform:"uppercase",letterSpacing:"1px",marginBottom:8 }}>Select Game</div>
          {gamesLoading ? (
            <div style={{ padding:"12px 14px",background:"rgba(123,47,255,0.06)",border:`1px solid ${S.border2}`,borderRadius:9,fontSize:12,color:S.dimMore,fontFamily:S.raj }}>Loading games...</div>
          ) : games.length === 0 ? (
            <div style={{ padding:"12px 14px",background:"rgba(255,68,68,0.06)",border:"1px solid rgba(255,68,68,0.2)",borderRadius:9,fontSize:12,color:"#ff6b6b",fontFamily:S.raj }}>No approved games on this chain yet</div>
          ) : (
            <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
              {games.map(g => (
                <div key={g.id} onClick={() => setSelectedGame(g)} style={{ padding:"12px 14px",borderRadius:10,cursor:"pointer",background:selectedGame?.id===g.id?"rgba(123,47,255,0.15)":"rgba(123,47,255,0.04)",border:`1px solid ${selectedGame?.id===g.id?"rgba(123,47,255,0.5)":S.border}`,display:"flex",alignItems:"center",gap:12,transition:"all 0.18s" }}>
                  {g.thumbnailUrl ? <img src={g.thumbnailUrl} alt="" style={{ width:36,height:36,borderRadius:8,objectFit:"cover",flexShrink:0 }} /> : <div style={{ width:36,height:36,borderRadius:8,background:`linear-gradient(135deg,${S.purple},${S.cyan})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0 }}>🎮</div>}
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:S.raj,fontWeight:700,fontSize:14,color:selectedGame?.id===g.id?S.purpleL:"#fff" }}>{g.name}</div>
                    <div style={{ fontSize:10,color:S.dimMore,fontFamily:S.raj }}>Game ID #{g.gameId} · {g.category}</div>
                  </div>
                  {selectedGame?.id===g.id && <div style={{ width:18,height:18,borderRadius:"50%",background:S.purple,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#fff",flexShrink:0 }}>✓</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Prize Config */}
        <div style={{ background:"rgba(123,47,255,0.04)",border:`1px solid ${S.border}`,borderRadius:12,padding:"16px" }}>
          <div style={{ fontSize:11,color:S.dimMore,fontFamily:S.raj,fontWeight:700,textTransform:"uppercase",letterSpacing:"1px",marginBottom:14 }}>🏆 Prize Configuration</div>

          {/* Token selector */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11,color:S.dimMore,fontFamily:S.raj,fontWeight:700,marginBottom:8 }}>Reward Token</div>
            <div style={{ display:"flex",gap:6,flexWrap:"wrap",marginBottom:prizeToken==="Custom..."?10:0 }}>
              {PRESET_TOKENS.map(t => (
                <button key={t} onClick={() => setPrizeToken(t)} style={{ padding:"6px 14px",borderRadius:20,fontSize:12,fontFamily:S.raj,fontWeight:700,cursor:"pointer",transition:"all 0.18s",background:prizeToken===t?"rgba(123,47,255,0.2)":"transparent",border:`1px solid ${prizeToken===t?"rgba(123,47,255,0.5)":S.border}`,color:prizeToken===t?S.purpleL:S.dimMore }}>{t}</button>
              ))}
            </div>
            {prizeToken === "Custom..." && (
              <input type="text" value={customToken} onChange={e => setCustomToken(e.target.value)} placeholder="Enter token name e.g. MYTOKEN" style={{ width:"100%",padding:"10px 14px",background:"rgba(123,47,255,0.06)",border:`1px solid ${S.border2}`,borderRadius:9,color:"#fff",fontSize:13,fontFamily:S.raj,outline:"none",boxSizing:"border-box" }} />
            )}
          </div>

          {/* Total prize pool */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11,color:S.dimMore,fontFamily:S.raj,fontWeight:700,marginBottom:6 }}>Total Prize Pool ({finalToken || "token"})</div>
            <input type="number" min="0" value={totalPrize} onChange={e => setTotalPrize(e.target.value)} placeholder="e.g. 1000" style={{ width:"100%",padding:"10px 14px",background:"rgba(123,47,255,0.06)",border:`1px solid ${S.border2}`,borderRadius:9,color:"#fff",fontSize:16,fontFamily:S.orb,fontWeight:700,outline:"none",boxSizing:"border-box" }} />
          </div>

          {/* Distribution */}
          <div>
            <div style={{ fontSize:11,color:S.dimMore,fontFamily:S.raj,fontWeight:700,marginBottom:10 }}>Prize Distribution %</div>
            <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
              {[["🥇","first","1st Place"],["🥈","second","2nd Place"],["🥉","third","3rd Place"]].map(([medal,key,label]) => (
                <div key={key} style={{ display:"flex",alignItems:"center",gap:12 }}>
                  <span style={{ fontSize:18,minWidth:24 }}>{medal}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex",justifyContent:"space-between",marginBottom:4 }}>
                      <span style={{ fontSize:12,color:"#c4a0ff",fontFamily:S.raj,fontWeight:700 }}>{label}</span>
                      <span style={{ fontSize:12,color:S.gold,fontFamily:S.orb,fontWeight:700 }}>{distribution[key]}% = {totalPrize?((Number(totalPrize)*distribution[key])/100).toFixed(2):"0"} {finalToken}</span>
                    </div>
                    <input type="range" min="0" max="100" value={distribution[key]} onChange={e => setDistribution(d => ({ ...d, [key]: Number(e.target.value) }))} style={{ width:"100%",accentColor:S.purple }} />
                  </div>
                </div>
              ))}
              <div style={{ padding:"8px 12px",background:distTotal===100?"rgba(0,255,136,0.06)":"rgba(255,68,68,0.06)",border:`1px solid ${distTotal===100?"rgba(0,255,136,0.2)":"rgba(255,68,68,0.2)"}`,borderRadius:8,fontSize:12,color:distTotal===100?S.green:"#ff6b6b",fontFamily:S.raj,fontWeight:700,textAlign:"center" }}>
                Total: {distTotal}% {distTotal===100?"✓ Perfect":"← Must equal 100%"}
              </div>
            </div>
          </div>
        </div>

        {/* Settings */}
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
          {[
            { label:"Max Players", field:"maxPlayers", opts:["16","32","64","100","Unlimited"] },
            { label:"Entry Fee", field:"entryFee", opts:["0","10","50","100"] },
            { label:"Duration (hours)", field:"durationHours", opts:["1","2","4","8","24"] },
            { label:"Starts in (hours)", field:"startDelay", opts:["1","2","6","12","24"] },
          ].map(({ label, field, opts }) => (
            <div key={field}>
              <div style={{ fontSize:11,color:S.dimMore,fontFamily:S.raj,fontWeight:700,textTransform:"uppercase",letterSpacing:"1px",marginBottom:6 }}>{label}</div>
              <select value={formData[field]} onChange={e => setFormData(p => ({ ...p, [field]: e.target.value }))} style={{ width:"100%",padding:"10px 12px",background:"rgba(123,47,255,0.06)",border:`1px solid ${S.border2}`,borderRadius:9,color:"#fff",fontSize:13,fontFamily:S.raj,outline:"none" }}>
                {opts.map(o => <option key={o} value={o==="Unlimited"?"999999":o}>{o}</option>)}
              </select>
            </div>
          ))}
        </div>

        {msg && <div style={{ padding:"10px 14px",background:msg.startsWith("✅")?"rgba(0,255,136,0.06)":"rgba(255,68,68,0.06)",border:`1px solid ${msg.startsWith("✅")?"rgba(0,255,136,0.2)":"rgba(255,68,68,0.2)"}`,borderRadius:9,fontSize:12,color:msg.startsWith("✅")?S.green:"#ff6b6b",fontFamily:S.raj,fontWeight:700 }}>{msg}</div>}

        <button onClick={handleCreate} disabled={creating||!isConnected} style={{ width:"100%",padding:"13px",background:creating?"rgba(123,47,255,0.2)":`linear-gradient(135deg,${S.purple},#5a1fd4)`,border:"none",borderRadius:10,color:creating?S.dimMore:"#fff",fontSize:13,fontWeight:700,cursor:creating||!isConnected?"not-allowed":"pointer",fontFamily:S.raj,letterSpacing:"1px",textTransform:"uppercase" }}>
          {creating ? "Deploying..." : "🚀 Deploy Tournament On-Chain"}
        </button>
      </div>
    </div>
  );
}

// ── My Tournaments Tab ───────────────────────────────────────────────────────
function MyTab({ tournaments, loading, address, onRefresh }) {
  const [exporting, setExporting] = useState(null);
  const [marking, setMarking] = useState(null);
  const [winnersMap, setWinnersMap] = useState({});
  const { contracts, chainId } = useChain();

  const fetchWinners = async (t) => {
    if (winnersMap[t.id]) return;
    try {
      const gameId = Number(t.gameId);
      const players = t.players || [];
      const res = await fetch(`/api/games?action=scores&gameId=${gameId}`);
      const data = await res.json();
      const scores = (data.scores || []).filter(s => players.map(p => p.toLowerCase()).includes(s.player?.toLowerCase()));
      scores.sort((a, b) => b.score - a.score);
      setWinnersMap(m => ({ ...m, [t.id]: scores }));
    } catch (err) { console.error(err); }
  };

  const exportCSV = (t) => {
    const winners = winnersMap[t.id] || [];
    const rows = [["Rank","Wallet","Score","Prize Amount","Token"]];
    const dist = t.distribution || { first:60, second:25, third:15 };
    const total = Number(t.totalPrize || 0);
    const token = t.prizeToken || "ARCADE";
    winners.slice(0,3).forEach((w,i) => {
      const pct = i===0?dist.first:i===1?dist.second:dist.third;
      rows.push([i+1, w.player, w.score, ((total*pct)/100).toFixed(2), token]);
    });
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type:"text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `tournament_${t.id}_winners.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const markDistributed = async (t) => {
    setMarking(t.id);
    try {
      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: contracts?.tournament, abi: TOURNAMENT_ABI,
        functionName: "endTournamentAndDistribute", args: [BigInt(t.id)],
        gas: BigInt(500000), chainId,
      });
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });
      onRefresh();
    } catch (err) { console.error(err); }
    finally { setMarking(null); }
  };

  const myTournaments = tournaments.filter(t => t.creator?.toLowerCase() === address?.toLowerCase());

  if (loading) return <div style={{ padding:"60px 0",textAlign:"center",fontSize:11,color:S.dimMore,fontFamily:S.raj,textTransform:"uppercase",letterSpacing:"2px" }}>Loading...</div>;

  if (myTournaments.length === 0) return (
    <div style={{ padding:"60px 0",textAlign:"center" }}>
      <div style={{ fontSize:48,marginBottom:16 }}>🏆</div>
      <div style={{ fontFamily:S.raj,fontWeight:700,fontSize:16,color:S.purpleL,marginBottom:8 }}>No tournaments yet</div>
      <div style={{ fontSize:13,color:S.dimMore,fontFamily:S.raj }}>Host one from the Host tab</div>
    </div>
  );

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
      {myTournaments.map(t => {
        const status = getRealStatus(t);
        const winners = winnersMap[t.id];
        const entryFee = Number(t.entryFee)/1e18;
        return (
          <div key={t.id} style={{ background:S.card,border:`1px solid ${S.border}`,borderRadius:14,overflow:"hidden" }}>
            <div style={{ padding:"16px 18px",borderBottom:`1px solid ${S.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10 }}>
              <div>
                <div style={{ fontFamily:S.raj,fontWeight:700,fontSize:16,color:"#fff",marginBottom:4 }}>{t.gameName}</div>
                <div style={{ display:"flex",gap:10,flexWrap:"wrap" }}>
                  <span style={{ fontSize:11,color:status==="live"?S.green:status==="upcoming"?S.cyan:S.dimMore,fontFamily:S.raj,fontWeight:700 }}>
                    {status==="live"?"🟢 Live":status==="upcoming"?"⏱ Upcoming":"🏁 Ended"}
                  </span>
                  <span style={{ fontSize:11,color:S.dimMore,fontFamily:S.raj }}>👥 {t.players?.length||0}/{Number(t.maxPlayers)} players</span>
                  <span style={{ fontSize:11,color:S.dimMore,fontFamily:S.raj }}>Entry: {entryFee===0?"Free":`${entryFee}`}</span>
                  {t.totalPrize && <span style={{ fontSize:11,color:S.gold,fontFamily:S.raj,fontWeight:700 }}>🏆 {t.totalPrize} {t.prizeToken||"ARCADE"}</span>}
                </div>
              </div>
              <div style={{ display:"flex",gap:8}}>
                {status === "ended" && !t.prizesDistributed && (
                  <>
                    <button onClick={() => { fetchWinners(t); }} style={{ padding:"7px 14px",background:"rgba(0,212,255,0.08)",border:"1px solid rgba(0,212,255,0.25)",borderRadius:8,color:S.cyan,fontSize:12,fontFamily:S.raj,fontWeight:700,cursor:"pointer" }}>
                      👁 View Winners
                    </button>
                    <button onClick={() => exportCSV(t)} style={{ padding:"7px 14px",background:"rgba(255,183,0,0.08)",border:"1px solid rgba(255,183,0,0.25)",borderRadius:8,color:S.gold,fontSize:12,fontFamily:S.raj,fontWeight:700,cursor:"pointer" }}>
                      ⬇ Export CSV
                    </button>
                    <button onClick={() => markDistributed(t)} disabled={marking===t.id} style={{ padding:"7px 14px",background:`linear-gradient(135deg,${S.purple},#5a1fd4)`,border:"none",borderRadius:8,color:"#fff",fontSize:12,fontFamily:S.raj,fontWeight:700,cursor:"pointer" }}>
                      {marking===t.id?"Processing...":"✅ Mark Distributed"}
                    </button>
                  </>
                )}
                {t.prizesDistributed && <span style={{ fontSize:12,color:S.green,fontFamily:S.raj,fontWeight:700,padding:"7px 14px" }}>✓ Rewards Distributed</span>}
              </div>
            </div>

            {/* Winners panel */}
            {winners && (
              <div style={{ padding:"14px 18px",background:"rgba(123,47,255,0.04)" }}>
                <div style={{ fontSize:10,color:S.dimMore,fontFamily:S.raj,fontWeight:700,textTransform:"uppercase",letterSpacing:"1px",marginBottom:10 }}>Top Players</div>
                {winners.length === 0 ? (
                  <div style={{ fontSize:12,color:S.dimMore,fontFamily:S.raj }}>No scores recorded for this tournament</div>
                ) : winners.slice(0,5).map((w,i) => {
                  const dist = t.distribution||{first:60,second:25,third:15};
                  const total = Number(t.totalPrize||0);
                  const token = t.prizeToken||"ARCADE";
                  const pct = i===0?dist.first:i===1?dist.second:i===2?dist.third:0;
                  const prize = pct>0?((total*pct)/100).toFixed(2):null;
                  return (
                    <div key={w.player} style={{ display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:i<Math.min(winners.length-1,4)?`1px solid rgba(123,47,255,0.07)`:"none" }}>
                      <span style={{ fontFamily:S.orb,fontSize:14,minWidth:24,color:i===0?S.gold:i===1?"#C0C0C0":i===2?"#CD7F32":S.dimMore,fontWeight:700 }}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`}</span>
                      <div style={{ width:28,height:28,borderRadius:"50%",background:"rgba(123,47,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:S.purpleL,fontFamily:S.raj,fontWeight:700,flexShrink:0 }}>{w.player?.slice(2,4).toUpperCase()}</div>
                      <div style={{ flex:1,fontFamily:"monospace",fontSize:12,color:"#9977cc" }}>{w.player?.slice(0,10)}...{w.player?.slice(-4)}</div>
                      <div style={{ fontFamily:S.orb,fontSize:13,fontWeight:700,color:S.purpleL }}>{Number(w.score).toLocaleString()}</div>
                      {prize && <div style={{ fontSize:11,color:S.gold,fontFamily:S.raj,fontWeight:700,minWidth:80,textAlign:"right" }}>+{prize} {token}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Hall of Fame ─────────────────────────────────────────────────────────────
function HallOfFame({ tournaments }) {
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        // Sabhi tournaments ke players collect karo
        const allPlayers = new Set();
        tournaments.forEach(t => (t.players||[]).forEach(p => allPlayers.add(p.toLowerCase())));

        // Scores fetch karo
        const res = await fetch("/api/games?action=scores");
        const data = await res.json();
        const allScores = data.scores || [];

        // Sirf tournament players ka score
        const filtered = allScores.filter(s => allPlayers.has(s.player?.toLowerCase()));

        // Player ke best score aggregate karo
        const playerBest = {};
        filtered.forEach(s => {
          const p = s.player?.toLowerCase();
          if (!playerBest[p]) {
            playerBest[p] = { player: s.player, bestScore: 0, totalScore: 0, gamesPlayed: 0, wins: 0 };
          }
          playerBest[p].bestScore = Math.max(playerBest[p].bestScore, s.score);
          playerBest[p].totalScore += s.score;
          playerBest[p].gamesPlayed += 1;
        });

        // Wins count karo — jo tournaments mein top player tha
        tournaments.filter(t => getRealStatus(t) === "ended").forEach(t => {
          const players = t.players || [];
          if (players.length > 0) {
            const winner = players[0]?.toLowerCase();
            if (playerBest[winner]) playerBest[winner].wins += 1;
          }
        });

        const ranked = Object.values(playerBest).sort((a, b) => b.bestScore - a.bestScore);
        setScores(ranked);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    fetchAll();
  }, [tournaments.length]);

  const podiumColors = [S.gold, "#C0C0C0", "#CD7F32"];

  if (loading) return <div style={{ padding:"60px 0",textAlign:"center",fontSize:11,color:S.dimMore,fontFamily:S.raj,textTransform:"uppercase",letterSpacing:"2px" }}>Loading legends...</div>;

  if (scores.length === 0) return (
    <div style={{ padding:"60px 0",textAlign:"center" }}>
      <div style={{ fontSize:48,marginBottom:12 }}>🏆</div>
      <div style={{ fontFamily:S.raj,fontWeight:700,fontSize:16,color:S.purpleL,marginBottom:6 }}>No legends yet</div>
      <div style={{ fontSize:13,color:S.dimMore,fontFamily:S.raj }}>Complete tournaments to appear here</div>
    </div>
  );

  return (
    <div>
      {/* Top 3 podium */}
      {scores.length >= 1 && (
        <div style={{ display:"grid",gridTemplateColumns:scores.length>=3?"1fr 1.1fr 1fr":scores.length===2?"1fr 1fr":"1fr",gap:12,marginBottom:24,alignItems:"flex-end" }}>
          {scores.length >= 2 && (
            <div style={{ background:"rgba(192,192,192,0.06)",border:"1px solid rgba(192,192,192,0.2)",borderRadius:14,padding:"16px 10px",textAlign:"center",order:0 }}>
              <div style={{ fontSize:24,marginBottom:8 }}>🥈</div>
              <div style={{ width:40,height:40,borderRadius:"50%",background:"rgba(192,192,192,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:"#C0C0C0",margin:"0 auto 8px",fontFamily:S.raj }}>{scores[1].player?.slice(2,4).toUpperCase()}</div>
              <div style={{ fontFamily:"monospace",fontSize:10,color:"#C0C0C0",marginBottom:4 }}>{scores[1].player?.slice(0,8)}...</div>
              <div style={{ fontFamily:S.orb,fontWeight:700,fontSize:16,color:"#C0C0C0" }}>{scores[1].bestScore.toLocaleString()}</div>
              <div style={{ fontSize:10,color:S.dimMore,fontFamily:S.raj,marginTop:3 }}>{scores[1].wins} wins</div>
            </div>
          )}
          <div style={{ background:"rgba(255,183,0,0.06)",border:"2px solid rgba(255,183,0,0.3)",borderRadius:14,padding:"20px 10px",textAlign:"center",order:scores.length>=2?1:0,boxShadow:"0 0 24px rgba(255,183,0,0.15)" }}>
            <div style={{ fontSize:28,marginBottom:8 }}>🥇</div>
            <div style={{ width:48,height:48,borderRadius:"50%",background:"rgba(255,183,0,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:700,color:S.gold,margin:"0 auto 8px",border:`2px solid ${S.gold}`,fontFamily:S.raj }}>{scores[0].player?.slice(2,4).toUpperCase()}</div>
            <div style={{ fontFamily:"monospace",fontSize:10,color:S.gold,marginBottom:4 }}>{scores[0].player?.slice(0,8)}...</div>
            <div style={{ fontFamily:S.orb,fontWeight:700,fontSize:20,color:S.gold }}>{scores[0].bestScore.toLocaleString()}</div>
            <div style={{ fontSize:10,color:S.dimMore,fontFamily:S.raj,marginTop:3 }}>{scores[0].wins} wins</div>
          </div>
          {scores.length >= 3 && (
            <div style={{ background:"rgba(205,127,50,0.06)",border:"1px solid rgba(205,127,50,0.2)",borderRadius:14,padding:"16px 10px",textAlign:"center",order:2 }}>
              <div style={{ fontSize:24,marginBottom:8 }}>🥉</div>
              <div style={{ width:40,height:40,borderRadius:"50%",background:"rgba(205,127,50,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:"#CD7F32",margin:"0 auto 8px",fontFamily:S.raj }}>{scores[2].player?.slice(2,4).toUpperCase()}</div>
              <div style={{ fontFamily:"monospace",fontSize:10,color:"#CD7F32",marginBottom:4 }}>{scores[2].player?.slice(0,8)}...</div>
              <div style={{ fontFamily:S.orb,fontWeight:700,fontSize:16,color:"#CD7F32" }}>{scores[2].bestScore.toLocaleString()}</div>
              <div style={{ fontSize:10,color:S.dimMore,fontFamily:S.raj,marginTop:3 }}>{scores[2].wins} wins</div>
            </div>
          )}
        </div>
      )}

      {/* Full list */}
      <div style={{ background:S.card,border:`1px solid ${S.border}`,borderRadius:14,padding:"16px 18px" }}>
        <div style={{ fontSize:10,color:S.dimMore,fontFamily:S.raj,fontWeight:700,textTransform:"uppercase",letterSpacing:"1px",marginBottom:14 }}>All Legends</div>
        {scores.map((p,i) => (
          <div key={p.player} style={{ display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:i<scores.length-1?`1px solid rgba(123,47,255,0.06)`:"none" }}>
            <div style={{ fontFamily:S.orb,fontSize:14,fontWeight:700,color:i<3?podiumColors[i]:S.dimMore,minWidth:28,textAlign:"center" }}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`}</div>
            <div style={{ width:34,height:34,borderRadius:"50%",background:`linear-gradient(135deg,${S.purple},${S.cyan})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#fff",flexShrink:0,fontFamily:S.raj }}>{p.player?.slice(2,4).toUpperCase()}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"monospace",fontSize:12,color:"#c4a0ff" }}>{p.player?.slice(0,12)}...{p.player?.slice(-4)}</div>
              <div style={{ fontSize:10,color:S.dimMore,fontFamily:S.raj,marginTop:2 }}>{p.wins} wins · {p.gamesPlayed} games played</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontFamily:S.orb,fontWeight:700,fontSize:14,color:S.purpleL }}>{p.bestScore.toLocaleString()}</div>
              <div style={{ fontSize:9,color:S.dimMore,fontFamily:S.raj }}>best score</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main TAAS Page ───────────────────────────────────────────────────────────
export default function TAAS() {
  const [activeTab, setActiveTab] = useState("browse");
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [msg, setMsg] = useState("");
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { contracts, chainId, rewardToken, rewardType } = useChain();
  const publicClient = usePublicClient();
  const { address, isConnected } = useAccount();
  const { isLoggedIn, displayName, photoURL, logout } = useFirebaseAuth();
  const rewardSymbol = rewardToken || "ARCADE";

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  const fetchTournaments = async () => {
    if (!publicClient || !contracts?.tournament) { setLoading(false); return; }
    setLoading(true);
    try {
      const nextId = await publicClient.readContract({ address: contracts.tournament, abi: TOURNAMENT_ABI, functionName: "nextTournamentId" });
      const total = Number(nextId) - 1;
      if (total <= 0) { setTournaments([]); setLoading(false); return; }
      const results = await Promise.all(
        Array.from({ length: total }, (_, i) =>
          publicClient.readContract({ address: contracts.tournament, abi: TOURNAMENT_ABI, functionName: "getTournamentInfo", args: [BigInt(i + 1)] })
        )
      );
      setTournaments(results.map(t => ({
        ...t, id: Number(t.id), gameId: Number(t.gameId),
        maxPlayers: Number(t.maxPlayers), startTime: Number(t.startTime),
        endTime: Number(t.endTime), status: Number(t.status), players: t.players,
        type: "battle", // default; extend later
      })));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchTournaments(); }, [publicClient, contracts?.tournament]);

  const handleJoin = async (t) => {
    if (!isConnected) { setMsg("Connect wallet first"); return; }
    setJoining(true);
    try {
      if (rewardType !== "native" && Number(t.entryFee) > 0) {
        const allowance = await publicClient.readContract({ address: contracts.token, abi: ERC20_ABI, functionName: "allowance", args: [address, contracts.tournament] });
        if (BigInt(allowance) < BigInt(t.entryFee)) {
          const ah = await writeContract(wagmiAdapter.wagmiConfig, { address: contracts.token, abi: ERC20_ABI, functionName: "approve", args: [contracts.tournament, t.entryFee], gas: BigInt(100000), chainId });
          await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash: ah });
        }
      }
      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: contracts.tournament, abi: TOURNAMENT_ABI,
        functionName: "joinTournament", args: [BigInt(t.id)],
        ...(rewardType === "native" ? { value: BigInt(t.entryFee) } : {}),
        gas: BigInt(300000), chainId,
      });
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });
      setMsg("✅ Joined!"); await fetchTournaments();
    } catch (err) { setMsg("Error: " + (err.shortMessage || err.message)); }
    finally { setJoining(false); }
  };

  const liveCnt = tournaments.filter(t => getRealStatus(t) === "live").length;
  const upcomingCnt = tournaments.filter(t => getRealStatus(t) === "upcoming").length;

  const [browseFilter, setBrowseFilter] = useState("all");
  const browsed = tournaments.filter(t => {
    const s = getRealStatus(t);
    if (browseFilter === "live") return s === "live";
    if (browseFilter === "upcoming") return s === "upcoming";
    if (browseFilter === "ended") return s === "ended";
    return true;
  });

  return (
    <div style={{ minHeight:"calc(100vh - 54px)", background:S.bg, display:"flex" }}>
      <style>{`
        @keyframes livePulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(1.3)} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes slideUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes modalIn { from{opacity:0;transform:scale(0.95)} to{opacity:1;transform:scale(1)} }
        @keyframes gradientShift { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        select option { background: #0d0b1a; color: #fff; }
        ::-webkit-scrollbar { display: none; }
      `}</style>

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}

      {/* ── LEFT SIDEBAR ── */}
      {!isMobile && (
        <div style={{ width:220,flexShrink:0,borderRight:`1px solid ${S.border}`,display:"flex",flexDirection:"column",padding:"24px 0",position:"sticky",top:54,height:"calc(100vh - 54px)",overflowY:"auto",background:"rgba(13,11,26,0.95)" }}>
          <div style={{ padding:"0 20px 24px",borderBottom:`1px solid ${S.border}`,marginBottom:16 }}>
            <div style={{ display:"flex",alignItems:"center",gap:10 }}>
              <div style={{ width:36,height:36,borderRadius:10,background:`linear-gradient(135deg,${S.purple},${S.cyan})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0 }}>🏆</div>
              <div>
                <div style={{ fontFamily:S.orb,fontWeight:700,fontSize:13,color:"#fff" }}>TAAS</div>
                <div style={{ fontSize:9,color:S.dimMore,fontFamily:S.raj,letterSpacing:"1px" }}>TOURNAMENT AS A SERVICE</div>
              </div>
            </div>
          </div>
          <div style={{ padding:"0 16px 16px",display:"flex",flexDirection:"column",gap:6,borderBottom:`1px solid ${S.border}`,marginBottom:16 }}>
            <div style={{ display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"rgba(0,255,136,0.06)",border:"1px solid rgba(0,255,136,0.15)",borderRadius:8 }}>
              <span style={{ fontSize:11,color:S.green,fontFamily:S.raj,fontWeight:700,display:"flex",alignItems:"center",gap:5 }}><span style={{ width:5,height:5,borderRadius:"50%",background:S.green,animation:"livePulse 1s infinite" }} />LIVE</span>
              <span style={{ fontFamily:S.orb,fontSize:12,fontWeight:700,color:S.green }}>{liveCnt}</span>
            </div>
            <div style={{ display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"rgba(0,212,255,0.06)",border:"1px solid rgba(0,212,255,0.15)",borderRadius:8 }}>
              <span style={{ fontSize:11,color:S.cyan,fontFamily:S.raj,fontWeight:700 }}>UPCOMING</span>
              <span style={{ fontFamily:S.orb,fontSize:12,fontWeight:700,color:S.cyan }}>{upcomingCnt}</span>
            </div>
          </div>
          <div style={{ flex:1,padding:"0 12px" }}>
            {NAV_ITEMS.map(item => (
              <button key={item.id} onClick={() => setActiveTab(item.id)} style={{ width:"100%",padding:"11px 14px",borderRadius:10,marginBottom:4,background:activeTab===item.id?"rgba(123,47,255,0.2)":"transparent",border:`1px solid ${activeTab===item.id?"rgba(123,47,255,0.4)":"transparent"}`,color:activeTab===item.id?S.purpleL:S.dimMore,fontSize:13,cursor:"pointer",fontFamily:S.raj,fontWeight:700,display:"flex",alignItems:"center",gap:10,textAlign:"left",transition:"all 0.18s",boxShadow:activeTab===item.id?"0 0 12px rgba(123,47,255,0.2)":"none" }}>
                <span style={{ fontSize:16,minWidth:20 }}>{item.icon}</span>
                {item.label}
                {item.id==="live" && liveCnt>0 && <span style={{ marginLeft:"auto",padding:"2px 7px",background:S.green,color:"#000",borderRadius:20,fontSize:10,fontWeight:700,fontFamily:S.orb }}>{liveCnt}</span>}
              </button>
            ))}
          </div>
          <div style={{ padding:"16px 12px 0",borderTop:`1px solid ${S.border}`,marginTop:16 }}>
            {isLoggedIn ? (
              <div style={{ padding:"10px 12px",background:"rgba(123,47,255,0.08)",border:`1px solid ${S.border}`,borderRadius:10 }}>
                <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:8 }}>
                  {photoURL?<img src={photoURL} alt="" style={{ width:30,height:30,borderRadius:"50%",border:`1.5px solid ${S.purple}` }} />:<div style={{ width:30,height:30,borderRadius:"50%",background:`linear-gradient(135deg,${S.purple},${S.cyan})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13 }}>🎮</div>}
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontFamily:S.raj,fontWeight:700,fontSize:12,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{displayName}</div>
                    <div style={{ fontSize:10,color:S.green,fontFamily:S.raj }}>● Online</div>
                  </div>
                </div>
                <button onClick={logout} style={{ width:"100%",padding:"6px",background:"rgba(255,68,68,0.08)",border:"1px solid rgba(255,68,68,0.2)",borderRadius:7,color:"#ff6b6b",fontSize:11,fontFamily:S.raj,fontWeight:700,cursor:"pointer" }}>Sign out</button>
              </div>
            ) : (
              <button onClick={() => setShowAuthModal(true)} style={{ width:"100%",padding:"11px 14px",background:`linear-gradient(135deg,${S.purple},#5a1fd4)`,border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:S.raj,letterSpacing:"0.5px",display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>🔐 Sign In to Play</button>
            )}
          </div>
        </div>
      )}

      {/* ── MAIN ── */}
      <div style={{ flex:1,overflow:"auto" }}>
        {/* Hero */}
        <div style={{ padding:isMobile?"20px 16px":"28px 32px 24px",borderBottom:`1px solid ${S.border}`,position:"relative",overflow:"hidden" }}>
          <div style={{ position:"absolute",top:0,right:0,width:400,height:200,background:`radial-gradient(ellipse at top right, rgba(123,47,255,0.15) 0%, transparent 70%)`,pointerEvents:"none" }} />
          <div style={{ position:"relative",zIndex:1 }}>
            <div style={{ display:"inline-flex",alignItems:"center",gap:6,padding:"4px 12px",border:"1px solid rgba(123,47,255,0.3)",borderRadius:20,fontSize:10,color:S.purpleL,letterSpacing:"2px",textTransform:"uppercase",marginBottom:12,background:"rgba(123,47,255,0.08)",fontFamily:S.raj,fontWeight:700 }}>
              <span style={{ width:5,height:5,borderRadius:"50%",background:S.purple,animation:"pulse 1.5s ease-in-out infinite" }} />
              Tournament As A Service
            </div>
            <h1 style={{ fontFamily:S.raj,fontWeight:700,fontSize:isMobile?28:42,color:"#fff",textTransform:"uppercase",lineHeight:1,margin:"0 0 8px" }}>
              Compete. <span style={{ background:`linear-gradient(90deg,${S.purple},${S.cyan},${S.purple})`,backgroundSize:"200% 100%",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",animation:"gradientShift 3s ease infinite" }}>Win. Earn.</span>
            </h1>
            <p style={{ color:S.dimMore,fontSize:13,fontFamily:S.raj,margin:"0 0 16px" }}>On-chain tournaments — any token, any chain</p>
            <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
              <button onClick={() => setActiveTab("create")} style={{ padding:"9px 20px",background:`linear-gradient(135deg,${S.purple},#5a1fd4)`,border:"none",borderRadius:9,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:S.raj }}>🏆 Host Tournament</button>
              <button onClick={() => setActiveTab("browse")} style={{ padding:"9px 20px",background:"rgba(0,212,255,0.08)",border:"1px solid rgba(0,212,255,0.25)",borderRadius:9,color:S.cyan,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:S.raj }}>👁 Browse All</button>
            </div>
          </div>
        </div>

        {/* Mobile tabs */}
        {isMobile && (
          <div style={{ display:"flex",borderBottom:`1px solid ${S.border}`,overflowX:"auto",background:"rgba(13,11,26,0.9)" }}>
            {NAV_ITEMS.map(item => (
              <button key={item.id} onClick={() => setActiveTab(item.id)} style={{ padding:"10px 16px",background:"transparent",border:"none",borderBottom:activeTab===item.id?`2px solid ${S.purple}`:"2px solid transparent",color:activeTab===item.id?S.purpleL:S.dimMore,fontSize:12,cursor:"pointer",fontFamily:S.raj,fontWeight:700,flexShrink:0,marginBottom:"-1px" }}>{item.icon} {item.label}</button>
            ))}
          </div>
        )}

        {/* Content */}
        <div style={{ padding:isMobile?"16px":"24px 32px",animation:"slideUp 0.3s ease" }}>
          {msg && (
            <div style={{ marginBottom:16,padding:"12px 16px",background:msg.startsWith("✅")?"rgba(0,255,136,0.06)":"rgba(255,68,68,0.06)",border:`1px solid ${msg.startsWith("✅")?"rgba(0,255,136,0.2)":"rgba(255,68,68,0.2)"}`,borderRadius:10,fontSize:12,color:msg.startsWith("✅")?S.green:"#ff6b6b",fontFamily:S.raj,fontWeight:700,display:"flex",justifyContent:"space-between" }}>
              {msg}<button onClick={() => setMsg("")} style={{ background:"none",border:"none",color:"inherit",cursor:"pointer" }}>✕</button>
            </div>
          )}

          {/* Browse */}
          {(activeTab==="browse"||activeTab==="live") && (
            <div>
              <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:18 }}>
                {[{id:"all",l:"All"},{id:"live",l:"⚡ Live"},{id:"upcoming",l:"🔜 Upcoming"},{id:"ended",l:"🏁 Ended"}].map(f => (
                  <button key={f.id} onClick={() => setBrowseFilter(f.id)} style={{ padding:"6px 14px",borderRadius:20,fontSize:12,fontFamily:S.raj,fontWeight:700,cursor:"pointer",transition:"all 0.18s",background:browseFilter===f.id?"rgba(123,47,255,0.2)":"transparent",border:`1px solid ${browseFilter===f.id?"rgba(123,47,255,0.5)":"rgba(123,47,255,0.15)"}`,color:browseFilter===f.id?S.purpleL:S.dimMore }}>{f.l}</button>
                ))}
              </div>
              {loading ? (
                [1,2,3].map(i => <div key={i} style={{ height:220,borderRadius:16,background:"linear-gradient(90deg,rgba(123,47,255,0.06) 25%,rgba(123,47,255,0.12) 50%,rgba(123,47,255,0.06) 75%)",backgroundSize:"200% 100%",animation:"shimmer 1.5s infinite",border:`1px solid ${S.border}`,marginBottom:12 }} />)
              ) : browsed.length === 0 ? (
                <div style={{ padding:"60px 0",textAlign:"center" }}>
                  <div style={{ fontSize:48,marginBottom:12 }}>🏆</div>
                  <div style={{ fontFamily:S.raj,fontWeight:700,fontSize:16,color:S.purpleL }}>No tournaments found</div>
                </div>
              ) : browsed.map(t => <TCard key={t.id} t={t} onJoin={handleJoin} myAddress={address} />)}
            </div>
          )}

          {activeTab==="my" && <MyTab tournaments={tournaments} loading={loading} address={address} onRefresh={fetchTournaments} />}
          {activeTab==="create" && <CreateTab rewardSymbol={rewardSymbol} />}
          {activeTab==="leaderboard" && <HallOfFame tournaments={tournaments} />}
        </div>
      </div>
    </div>
  );
}