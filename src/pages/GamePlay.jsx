import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { writeContract, waitForTransactionReceipt } from "@wagmi/core";
import { wagmiAdapter } from "../Providers";
import { useGames } from "../hooks/useGames";
import { saveScore } from "../lib/gameService";
import { getActiveAvatarStyle } from "../utils/avatarUtils";

const PLATFORM_ADDRESS = import.meta.env.VITE_PLATFORM_ADDRESS;
const TOURNAMENT_ADDRESS = import.meta.env.VITE_TOURNAMENT_ADDRESS;
const CHAIN_ID = Number(import.meta.env.VITE_BOTCHAIN_MAINNET_CHAIN_ID);

const TOURNAMENT_SCORE_ABI = [{ name: "submitTournamentScore", type: "function", stateMutability: "nonpayable", inputs: [{ name: "tournamentId", type: "uint256" }, { name: "score", type: "uint256" }], outputs: [] }];
const PLATFORM_ABI = [{ name: "recordPlayAndEarn", type: "function", stateMutability: "nonpayable", inputs: [{ name: "gameId", type: "uint256" }, { name: "score", type: "uint256" }], outputs: [] }];
const PLATFORM_READ_ABI = [{ name: "games", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "gameId", type: "uint256" }, { name: "name", type: "string" }, { name: "creator", type: "address" }, { name: "iframeUrl", type: "string" }, { name: "rewardRate", type: "uint256" }, { name: "totalPlays", type: "uint256" }, { name: "isActive", type: "bool" }] }];

const C = {
  bg: "#08070f", card: "#0d0b1a", card2: "#12102a",
  border: "rgba(123,47,255,0.14)", border2: "rgba(123,47,255,0.25)",
  purple: "#7B2FFF", purpleL: "#B088FF", cyan: "#00D4FF",
  green: "#00FF88", gold: "#FFB700", dim: "#9977CC", dimMore: "#5533AA",
  raj: "'Rajdhani', sans-serif", orb: "'Orbitron', sans-serif",
};

function timeAgo(date) {
  if (!date) return "";
  const d = date?.toDate ? date.toDate() : new Date(date);
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function DiceBearAvatar({ address, style, size = 28 }) {
  const s = style || getActiveAvatarStyle(address);
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", overflow: "hidden", border: "1.5px solid rgba(123,47,255,0.4)", flexShrink: 0, background: "#0e0c1a" }}>
      <img src={`https://api.dicebear.com/9.x/${s}/svg?seed=${address}`} alt="" style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

export default function GamePlay() {
  const { gameId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const tournamentId = searchParams.get("tournamentId");
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  const { games } = useGames();
  const game = games.find(g => g.id === Number(gameId));
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();

  const [score, setScore] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [gameLoading, setGameLoading] = useState(true);
  const [tokensEarned, setTokensEarned] = useState(0);
  const [totalPlays, setTotalPlays] = useState(0);
  const [uniquePlayers, setUniquePlayers] = useState(0);
  const [creatorProfile, setCreatorProfile] = useState(null);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(true);

  const iframeRef = useRef(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  useEffect(() => {
    if (games.length > 0) setGameLoading(false);
  }, [games]);

  useEffect(() => { if (game) setLikeCount(game.likes || 0); }, [game]);

  useEffect(() => {
    if (!gameId || !address) return;
    setLiked(!!localStorage.getItem(`liked_game_${gameId}_${address}`));
  }, [gameId, address]);

  // Fetch game stats via API
  useEffect(() => {
    if (!game) return;
    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/games?action=stats&gameId=${game.gameId || game.id}`);
        const data = await res.json();
        setTotalPlays(data.plays || 0);
        setUniquePlayers(data.uniquePlayers || 0);
        setComments(data.comments || []);
        setCommentsLoading(false);
      } catch (e) {}
    };
    fetchStats();
  }, [game?.id]);

  // Fetch creator via API
  useEffect(() => {
    if (!game?.creator) return;
    const fetchCreator = async () => {
      try {
        const res = await fetch(`/api/creators?address=${game.creator}`);
        const data = await res.json();
        if (data) setCreatorProfile(data);
      } catch (e) {}
    };
    fetchCreator();
  }, [game?.creator]);

  // Comments fetched with stats above

  // Track play via API
  useEffect(() => {
    if (!game || !address || gameLoading) return;
    const trackPlay = async () => {
      try {
        const token = localStorage.getItem("arcadex_jwt");
        await fetch("/api/games?action=play", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ gameId: game.gameId || game.id }),
        });
        setTotalPlays(p => p + 1);
      } catch (e) {}
    };
    trackPlay();
  }, [game?.id, address, gameLoading]);

  // SDK messages
  useEffect(() => {
    const handleMessage = (event) => {
      if (!event.data?._sdk && !event.data?.type) return;
      if (event.data?.type === "SCORE_UPDATE") {
        if (submitted) { setSubmitted(false); setTxHash(""); setSubmitError(""); submittingRef.current = false; }
        setScore(event.data.score);
      }
      if (event.data?.type === "GAME_OVER") {
        setScore(event.data.score); setSubmitted(false); setTxHash(""); setSubmitError(""); submittingRef.current = false;
        submitScore(event.data.score);
      }
      if (event.data?.type === "GET_PLAYER_INFO") {
        iframeRef.current?.contentWindow?.postMessage({ type: "PLAYER_INFO", _platform: true, player: { address: address || "", username: null, balance: "0" } }, "*");
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [address, game, submitted]);

  const handleLike = async () => {
    if (!address) return;
    const key = `liked_game_${gameId}_${address}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    setLiked(true);
    setLikeCount(c => c + 1);
    try {
      const token = localStorage.getItem("arcadex_jwt");
      await fetch("/api/games?action=like", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ gameId }),
      });
    } catch (e) {}
  };

  const handleComment = async () => {
    if (!commentText.trim() || !address || postingComment) return;
    setPostingComment(true);
    const text = commentText.trim();
    setCommentText("");
    try {
      const token = localStorage.getItem("arcadex_jwt");
      await fetch("/api/games?action=comment", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ gameId, text }),
      });
      setComments(prev => [{ id: Date.now(), text, player: address, createdAt: null }, ...prev]);
    } catch (e) { setCommentText(text); }
    finally { setPostingComment(false); }
  };

  const submitScore = async (finalScore) => {
    if (submittingRef.current || !address || !game) return;
    submittingRef.current = true;
    setSubmitting(true); setSubmitError("");
    try {
      const onChainGameId = game.gameId;
      if (!onChainGameId) throw new Error("Game not registered on-chain");
      const rewardRate = game.rewardRate || 50;
      const playerReward = Math.floor(rewardRate * 80 / 100);

      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: PLATFORM_ADDRESS, abi: PLATFORM_ABI,
        functionName: "recordPlayAndEarn",
        args: [BigInt(onChainGameId), BigInt(finalScore)],
        gas: BigInt(500000),
      });
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });

      if (tournamentId) {
        try {
          const tHash = await writeContract(wagmiAdapter.wagmiConfig, {
            address: TOURNAMENT_ADDRESS, abi: TOURNAMENT_SCORE_ABI,
            functionName: "submitTournamentScore",
            args: [BigInt(tournamentId), BigInt(finalScore)],
            gas: BigInt(200000), chainId: CHAIN_ID,
          });
          await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash: tHash });
        } catch (tErr) {
          if (tErr.message?.includes("not active") || tErr.message?.includes("Outside tournament")) {
            setSubmitError("⚠️ Tournament has ended — score not counted.");
          }
        }
      }

      setTokensEarned(playerReward);
      await saveScore({ player: address, score: finalScore, gameId: game.id, gameName: game.name, txHash: hash });
      setTxHash(hash); setSubmitted(true);
      iframeRef.current?.contentWindow?.postMessage({ type: "TRANSACTION_SUCCESS", _platform: true, txHash: hash }, "*");
    } catch (err) {
      setSubmitError(err.message || "Transaction failed");
      iframeRef.current?.contentWindow?.postMessage({ type: "TRANSACTION_FAILED", _platform: true, error: err.message }, "*");
    } finally { setSubmitting(false); submittingRef.current = false; }
  };

  if (gameLoading) return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: C.raj, fontSize: 11, color: C.dimMore, textTransform: "uppercase", letterSpacing: "2px" }}>Loading game...</div>
    </div>
  );
  if (!game) return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 48 }}>🎮</div>
      <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 16, color: "#c4a0ff" }}>Game not found</div>
      <button onClick={() => navigate("/games")} style={{ padding: "8px 20px", background: "rgba(123,47,255,0.1)", border: `1px solid ${C.border2}`, borderRadius: 8, color: "#a67fff", fontSize: 12, cursor: "pointer", fontFamily: C.raj, fontWeight: 700 }}>Browse Games</button>
    </div>
  );

  const rewardRate = game.rewardRate || 50;
  const playerReward = Math.floor(rewardRate * 80 / 100);
  const creatorReward = Math.floor(rewardRate * 20 / 100);
  const shortAddr = (a) => a ? a.slice(0, 6) + "..." + a.slice(-4) : "?";
  const thumbnail = game.thumbnailUrl || game.thumbnail || game.image || null;

  return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: C.bg }}>
      <style>{`
        @keyframes lbPulse{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes poweredGlow{0%,100%{opacity:0.7}50%{opacity:1}}
        @keyframes heartBeat{0%,100%{transform:scale(1)}50%{transform:scale(1.35)}}
        @keyframes slideIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes scoreFlash{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}
        .like-btn:hover{background:rgba(255,100,100,0.1)!important;border-color:rgba(255,100,100,0.3)!important;}
        .comment-input:focus{outline:none;border-color:rgba(123,47,255,0.5)!important;}
        .comment-input::placeholder{color:#3a2a5a;}
        .comment-row:hover{background:rgba(123,47,255,0.05)!important;}
        .send-btn:hover:not(:disabled){background:linear-gradient(135deg,#8f44ff,#6b2fe8)!important;}
        .send-btn:disabled{opacity:0.3;cursor:not-allowed;}
        * { scrollbar-width: none; }
        *::-webkit-scrollbar { display: none; }
      `}</style>

      {/* ── GAME HEADER with thumbnail bg ── */}
      <div style={{ position: "relative", overflow: "hidden", borderBottom: `1px solid ${C.border}` }}>
        {/* Blurred thumbnail background */}
        {thumbnail && (
          <>
            <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${thumbnail})`, backgroundSize: "cover", backgroundPosition: "center", filter: "blur(18px) brightness(0.22)", transform: "scale(1.1)" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(8,7,15,0.3) 0%, rgba(8,7,15,0.85) 100%)" }} />
          </>
        )}
        {!thumbnail && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(123,47,255,0.1), rgba(0,212,255,0.05))" }} />}

        <div style={{ position: "relative", zIndex: 1, padding: isMobile ? "14px 16px" : "16px 32px", display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={() => navigate(-1)} style={{ padding: "7px 14px", background: "rgba(0,0,0,0.5)", border: `1px solid ${C.border2}`, borderRadius: 7, color: "#a67fff", fontSize: 12, cursor: "pointer", fontFamily: C.raj, fontWeight: 700, backdropFilter: "blur(8px)", flexShrink: 0 }}>← Back</button>

          {/* Thumbnail icon */}
          <div style={{ width: isMobile ? 48 : 56, height: isMobile ? 48 : 56, borderRadius: 10, overflow: "hidden", border: `2px solid ${C.border2}`, flexShrink: 0, background: "#0e0c1a", boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>
            {thumbnail ? (
              <img src={thumbnail} alt={game.name} style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "center", background: "#0e0c1a" }} />
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, background: "linear-gradient(135deg,rgba(123,47,255,0.3),rgba(0,212,255,0.1))" }}>🎮</div>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: isMobile ? 18 : 22, color: "#fff", textTransform: "uppercase", letterSpacing: "0.5px", lineHeight: 1.1, marginBottom: 3 }}>{game.name}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {game.category && <span style={{ fontSize: 9, padding: "2px 8px", background: "rgba(123,47,255,0.2)", border: `1px solid ${C.border2}`, borderRadius: 4, color: C.purpleL, fontFamily: C.raj, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase" }}>{game.category}</span>}
              {tournamentId && <span style={{ fontSize: 9, padding: "2px 8px", background: "rgba(255,183,0,0.15)", border: "1px solid rgba(255,183,0,0.3)", borderRadius: 4, color: C.gold, fontFamily: C.raj, fontWeight: 700, letterSpacing: "1px" }}>🏆 TOURNAMENT</span>}
            </div>
          </div>

          {/* Stats pills — desktop */}
          {!isMobile && (
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {[["🎮", totalPlays.toLocaleString(), "Plays"], ["👥", uniquePlayers, "Players"]].map(([icon, val, label]) => (
                <div key={label} style={{ padding: "6px 12px", background: "rgba(0,0,0,0.4)", border: `1px solid ${C.border}`, borderRadius: 8, textAlign: "center", backdropFilter: "blur(8px)" }}>
                  <div style={{ fontFamily: C.orb, fontSize: 13, fontWeight: 700, color: C.purpleL }}>{icon} {val}</div>
                  <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj, textTransform: "uppercase", letterSpacing: "1px" }}>{label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div style={{ padding: isMobile ? "12px 14px" : "16px 32px" }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 300px", gap: 16 }}>

          {/* ── GAME IFRAME ── */}
          <div style={{ background: C.card, border: `1px solid ${C.border2}`, borderRadius: 14, overflow: "hidden", position: "relative" }}>
            {game.iframeUrl && !game.iframeUrl.includes("your-unity-game") ? (
              <>
                <iframe ref={iframeRef} src={game.iframeUrl}
                  style={{ width: "100%", height: isMobile ? "75vw" : "calc(100vh - 54px - 160px)", minHeight: isMobile ? 300 : 480, border: "none", display: "block" }}
                  allow="fullscreen" allowFullScreen title={game.name} />
                <button onClick={() => {
                  const iframe = iframeRef.current;
                  if (iframe.requestFullscreen) iframe.requestFullscreen();
                  else if (iframe.webkitRequestFullscreen) iframe.webkitRequestFullscreen();
                }} style={{ position: "absolute", bottom: 10, right: 10, padding: "6px 12px", background: "rgba(0,0,0,0.8)", border: `1px solid ${C.border2}`, borderRadius: 7, color: "#a67fff", fontSize: 11, cursor: "pointer", fontFamily: C.raj, fontWeight: 700, backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 5 }}>
                  <span>⛶</span> Fullscreen
                </button>
              </>
            ) : (
              <div style={{ height: isMobile ? "75vw" : "calc(100vh - 54px - 160px)", minHeight: isMobile ? 300 : 480, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
                <div style={{ fontSize: 56, filter: "drop-shadow(0 0 20px rgba(123,47,255,0.5))" }}>🎮</div>
                <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 14, color: C.dimMore }}>Game coming soon</div>
                <button onClick={() => { const s = Math.floor(Math.random() * 10000); setScore(s); submitScore(s); }}
                  style={{ padding: "11px 28px", background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: C.raj }}>
                  Simulate Game Over (Test)
                </button>
              </div>
            )}

            {/* BOTCHAIN tags bar */}
            <div style={{ padding: "8px 14px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 8, background: "rgba(0,0,0,0.3)" }}>
              {["BOTCHAIN", "ARCADE X", "BOTCHAIN"].map((t, i) => (
                <span key={i} style={{ fontSize: 9, padding: "3px 8px", background: i === 2 ? "rgba(123,47,255,0.15)" : "rgba(0,0,0,0.4)", border: `1px solid ${i === 2 ? C.border2 : C.border}`, borderRadius: 4, color: i === 2 ? C.purpleL : C.dimMore, fontFamily: C.raj, fontWeight: 700, letterSpacing: "1px" }}>{t}</span>
              ))}
              <span style={{ marginLeft: "auto", fontSize: 9, color: C.dimMore, fontFamily: C.raj, display: "flex", alignItems: "center" }}>⚡ On-Chain Gaming</span>
            </div>
          </div>

          {/* ── RIGHT SIDEBAR ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

            {/* Score Card */}
            <div style={{ background: C.card, border: `1px solid ${C.border2}`, borderRadius: 12, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: -30, right: -30, width: 120, height: 120, background: "radial-gradient(circle,rgba(123,47,255,0.2) 0%,transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,#7B2FFF,#00d4ff)" }} />
              <div style={{ fontSize: 9, color: C.dimMore, textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: C.raj, fontWeight: 700, marginBottom: 6 }}>Current Score</div>
              <div style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 44, color: "#c4a0ff", letterSpacing: "-1px", lineHeight: 1, animation: score > 0 ? "scoreFlash 0.3s ease" : "none" }}>
                {score.toLocaleString()}
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <div style={{ flex: 1, padding: "6px 10px", background: "rgba(0,255,136,0.06)", border: "1px solid rgba(0,255,136,0.15)", borderRadius: 7, textAlign: "center" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.green, fontFamily: C.raj }}>+{playerReward}</div>
                  <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj }}>You earn</div>
                </div>
                <div style={{ flex: 1, padding: "6px 10px", background: "rgba(123,47,255,0.06)", border: `1px solid ${C.border}`, borderRadius: 7, textAlign: "center" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.purpleL, fontFamily: C.raj }}>+{creatorReward}</div>
                  <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj }}>Creator</div>
                </div>
              </div>
            </div>

            {/* Creator Card */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 16px" }}>
              <div style={{ fontSize: 9, color: C.dimMore, textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: C.raj, fontWeight: 700, marginBottom: 10 }}>Creator</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <DiceBearAvatar address={game.creator || "arcade"} size={38} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#d4b8ff", fontFamily: C.raj, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {creatorProfile?.displayName
                      ? `${creatorProfile.displayName}.arcade`
                      : shortAddr(game.creator)}
                  </div>
                  {creatorProfile?.displayName && (
                    <div style={{ fontSize: 9, color: C.dimMore, fontFamily: "monospace" }}>{shortAddr(game.creator)}</div>
                  )}
                </div>
                {creatorProfile?.displayName && (
                  <span style={{ fontSize: 8, padding: "2px 6px", background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 4, color: C.cyan, fontFamily: C.raj, fontWeight: 700 }}>NFT ✓</span>
                )}
              </div>
              {/* Game info */}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 5 }}>
                {[["Category", game.category || "—"], ["Reward Rate", `${rewardRate} ARCADE/play`], ["Total Plays", totalPlays.toLocaleString()], ["Unique Players", uniquePlayers]].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ color: C.dimMore, fontFamily: C.raj }}>{k}</span>
                    <span style={{ color: "#9977cc", fontFamily: C.raj, fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* TX status */}
            {submitting && (
              <div style={{ background: "rgba(123,47,255,0.06)", border: `1px solid ${C.border2}`, borderRadius: 10, padding: "13px 16px", textAlign: "center" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.purple, animation: "lbPulse 1s ease-in-out infinite" }} />
                  <div style={{ fontFamily: C.raj, fontSize: 13, fontWeight: 700, color: "#a67fff" }}>Writing on chain...</div>
                </div>
                <div style={{ fontSize: 10, color: C.dimMore, fontFamily: C.raj }}>Approve in your wallet</div>
              </div>
            )}
            {submitError && (
              <div style={{ background: "rgba(255,68,68,0.06)", border: "1px solid rgba(255,68,68,0.2)", borderRadius: 10, padding: "12px 16px" }}>
                <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 11, color: "#ff4444", marginBottom: 4 }}>Submission failed</div>
                <div style={{ fontSize: 10, color: C.dimMore, wordBreak: "break-all", fontFamily: "monospace" }}>{submitError}</div>
              </div>
            )}
            {submitted && txHash && (
              <div style={{ background: "rgba(0,255,136,0.05)", border: "1px solid rgba(0,255,136,0.15)", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 12, color: C.green, marginBottom: 5 }}>✓ Score submitted on-chain!</div>
                {tokensEarned > 0 && <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 16, color: C.green, marginBottom: 6 }}>+{tokensEarned} ARCADE earned! 🎉</div>}
                <a href={`https://scan.botchain.ai/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#a67fff", textDecoration: "none", fontFamily: C.raj, fontWeight: 700 }}>View on BOTScan →</a>
              </div>
            )}
            {score > 0 && !submitted && !submitting && (
              <button onClick={() => submitScore(score)} disabled={!isConnected}
                style={{ padding: "12px", background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 9, color: "#fff", fontSize: 12, fontWeight: 700, cursor: isConnected ? "pointer" : "not-allowed", fontFamily: C.raj, letterSpacing: "1px", textTransform: "uppercase", opacity: isConnected ? 1 : 0.5 }}>
                ⛓ Submit Score On-Chain
              </button>
            )}

            {/* Community card */}
            <div style={{ background: C.card, border: `1px solid ${C.border2}`, borderRadius: 12, overflow: "hidden" }}>
              {/* Header */}
              <div style={{ padding: "11px 14px", borderBottom: `1px solid ${C.border}`, background: "rgba(123,47,255,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: 13 }}>💬</span>
                  <span style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 12, color: "#c4a0ff", textTransform: "uppercase", letterSpacing: "1px" }}>Community</span>
                </div>
                <span style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj }}>{comments.length} comments</span>
              </div>

              {/* Like bar */}
              <div style={{ padding: "9px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <button className="like-btn" onClick={handleLike} disabled={!address}
                  style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", background: liked ? "rgba(255,100,100,0.12)" : "rgba(123,47,255,0.06)", border: `1px solid ${liked ? "rgba(255,100,100,0.3)" : C.border}`, borderRadius: 18, cursor: liked ? "default" : "pointer", fontFamily: C.raj, fontWeight: 700, fontSize: 11, color: liked ? "#ff6b6b" : "#9977cc", transition: "all 0.2s" }}>
                  <span style={{ fontSize: 14, animation: liked ? "heartBeat 0.4s ease" : "none" }}>{liked ? "❤️" : "🤍"}</span>
                  {liked ? "Liked!" : "Like"}
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontSize: 13 }}>❤️</span>
                  <span style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 12, color: "#ff6b6b" }}>{likeCount}</span>
                </div>
              </div>

              {/* Comment input */}
              {address ? (
                <div style={{ padding: "9px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 7, alignItems: "center" }}>
                  <DiceBearAvatar address={address} size={26} />
                  <input className="comment-input" value={commentText} onChange={e => setCommentText(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleComment()}
                    placeholder="Share your thoughts..." maxLength={200}
                    style={{ flex: 1, padding: "7px 11px", background: "rgba(123,47,255,0.06)", border: `1px solid ${C.border}`, borderRadius: 18, color: "#d4b8ff", fontSize: 12, fontFamily: C.raj, transition: "border-color 0.18s" }} />
                  <button className="send-btn" onClick={handleComment} disabled={postingComment || !commentText.trim()}
                    style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", color: "#fff", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.18s" }}>
                    {postingComment ? "·" : "↑"}
                  </button>
                </div>
              ) : (
                <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`, textAlign: "center", fontSize: 11, color: C.dimMore, fontFamily: C.raj }}>Connect wallet to comment</div>
              )}

              {/* Comments list */}
              <div style={{ maxHeight: 200, overflowY: "auto" }}>
                {commentsLoading ? (
                  <div style={{ padding: 20, textAlign: "center", fontSize: 10, color: C.dimMore, fontFamily: C.raj }}>Loading...</div>
                ) : comments.length === 0 ? (
                  <div style={{ padding: "20px 14px", textAlign: "center" }}>
                    <div style={{ fontSize: 22, marginBottom: 6 }}>💬</div>
                    <div style={{ fontSize: 11, color: C.dimMore, fontFamily: C.raj }}>No comments yet — be first!</div>
                  </div>
                ) : comments.map((c, i) => (
                  <div key={c.id} className="comment-row" style={{ padding: "9px 14px", borderBottom: i < comments.length - 1 ? `1px solid rgba(123,47,255,0.06)` : "none", animation: "slideIn 0.2s ease", transition: "background 0.15s" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
                      <DiceBearAvatar address={c.player} size={22} />
                      <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, background: "linear-gradient(90deg,#7B2FFF,#00d4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{shortAddr(c.player)}</span>
                      <span style={{ fontSize: 9, color: "#3a2a5a", fontFamily: C.raj }}>{timeAgo(c.createdAt)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#c4a0ff", fontFamily: C.raj, lineHeight: 1.5, wordBreak: "break-word", paddingLeft: 29 }}>{c.text}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Powered by */}
            <div style={{ textAlign: "center", padding: "6px 0", animation: "poweredGlow 3s ease-in-out infinite" }}>
              <div style={{ fontSize: 10, fontFamily: C.raj, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", background: "linear-gradient(90deg,#7B2FFF,#00d4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>⚡ Powered by ArcadeX</div>
              <div style={{ fontSize: 9, color: "#3a2a5a", fontFamily: C.raj, letterSpacing: "1px", marginTop: 1 }}>On-Chain Gaming</div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}