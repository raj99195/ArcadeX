import { useNavigate } from "react-router-dom";
import { useAccount, usePublicClient } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { useGames } from "../hooks/useGames";
import GameCard from "../components/GameCard";
import { useEffect, useState } from "react";
import { getScores } from "../lib/gameService";
import { useArcadeBalance } from "../hooks/useArcadeBalance";


const TOURNAMENT_ADDRESS = import.meta.env.VITE_TOURNAMENT_ADDRESS;
const TOURNAMENT_ABI = [
  { name: "getTournamentInfo", type: "function", stateMutability: "view", inputs: [{ name: "tournamentId", type: "uint256" }], outputs: [{ name: "", type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "gameId", type: "uint256" }, { name: "gameName", type: "string" }, { name: "gameThumbnail", type: "string" }, { name: "creator", type: "address" }, { name: "entryFee", type: "uint256" }, { name: "maxPlayers", type: "uint256" }, { name: "startTime", type: "uint256" }, { name: "endTime", type: "uint256" }, { name: "prizePool", type: "uint256" }, { name: "status", type: "uint8" }, { name: "players", type: "address[]" }, { name: "prizesDistributed", type: "bool" }] }] },
  { name: "nextTournamentId", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
];

export default function Home() {
  const navigate = useNavigate();
  const { isConnected } = useAccount();
  const { open } = useAppKit();
  const { balance } = useArcadeBalance();
  const { games } = useGames();
  const [scores, setScores] = useState([]);
  const [page, setPage] = useState(0);
  const [visible, setVisible] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [heroCardIndex, setHeroCardIndex] = useState(0);
  const [heroAngle, setHeroAngle] = useState(0);
  const [carouselAnim, setCarouselAnim] = useState("idle"); // "idle" | "exit" | "enter"
  const publicClient = usePublicClient();
  const [upcomingTournaments, setUpcomingTournaments] = useState([]);
  const [tournamentsLoaded, setTournamentsLoaded] = useState(false);

  const CARDS_PER_PAGE = isMobile ? 1 : 3;
  const featured = games;
  const totalPages = Math.max(1, Math.ceil(featured.length / CARDS_PER_PAGE));
  const currentCards = featured.slice(page * CARDS_PER_PAGE, page * CARDS_PER_PAGE + CARDS_PER_PAGE);

  const goTo = (newPage) => {
    const clamped = Math.max(0, Math.min(newPage, totalPages - 1));
    if (clamped === page) return;
    setVisible(false);
    setTimeout(() => { setPage(clamped); setVisible(true); }, 280);
  };

  useEffect(() => {
    getScores().then(setScores).catch(() => {});
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!games || games.length === 0) return;
    const interval = setInterval(() => {
      setCarouselAnim("exit");
      setTimeout(() => {
        setHeroCardIndex(i => (i + 1) % Math.max(games.length, 1));
        setHeroAngle(a => a - (360 / Math.max(games.length, 3)));
        setCarouselAnim("enter");
        setTimeout(() => setCarouselAnim("idle"), 400);
      }, 350);
    }, 2800);
    return () => clearInterval(interval);
  }, [games]);

  useEffect(() => {
    const fetchUpcoming = async () => {
      if (!publicClient || !TOURNAMENT_ADDRESS) return;
      try {
        const nextId = await publicClient.readContract({ address: TOURNAMENT_ADDRESS, abi: TOURNAMENT_ABI, functionName: "nextTournamentId" });
        const total = Number(nextId) - 1;
        if (total <= 0) { setTournamentsLoaded(true); return; }
        const results = await Promise.all(Array.from({ length: total }, (_, i) =>
          publicClient.readContract({ address: TOURNAMENT_ADDRESS, abi: TOURNAMENT_ABI, functionName: "getTournamentInfo", args: [BigInt(i + 1)] })
        ));
        const now = Date.now() / 1000;
        const upcoming = results
          .map(t => ({ ...t, id: Number(t.id), startTime: Number(t.startTime), endTime: Number(t.endTime), prizePool: t.prizePool, maxPlayers: Number(t.maxPlayers), players: t.players, status: Number(t.status) }))
          .filter(t => t.status !== 2 && t.status !== 3 && now < t.endTime)
          .sort((a, b) => a.startTime - b.startTime)
          .slice(0, 3);
        setUpcomingTournaments(upcoming);
      } catch (err) { console.error("Home tournaments fetch:", err); }
      finally { setTournamentsLoaded(true); }
    };
    fetchUpcoming();
  }, [publicClient]);

  const leaderboard = Object.values(
    scores.reduce((acc, s) => {
      const p = s.player;
      if (!acc[p]) acc[p] = { player: p, bestScore: 0, bestGame: "", totalScore: 0 };
      acc[p].totalScore += s.score;
      if (s.score > acc[p].bestScore) { acc[p].bestScore = s.score; acc[p].bestGame = s.gameName; }
      return acc;
    }, {})
  ).sort((a, b) => b.bestScore - a.bestScore).slice(0, 8);

  const top3 = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);
  const shortAddr = (a) => a ? a.slice(0, 7) + "..." + a.slice(-4) : "—";
  const fmtScore = (s) => s >= 1000000 ? (s / 1000000).toFixed(1) + "M" : s >= 1000 ? (s / 1000).toFixed(1) + "K" : (s ? String(s) : "—");

  return (
    <div style={{
      minHeight: "calc(100vh - 54px)",
      maxHeight: isMobile ? "none" : "calc(100vh - 54px)",
      background: "#08070f",
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "1fr 280px",
      overflow: "hidden",
      height: isMobile ? "auto" : "calc(100vh - 54px)",
      position: "relative",
    }}>

      <style>{`
        @keyframes tagFloat  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-7px)} }
        @keyframes lbPulse   { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes medalGlow { 0%,100%{filter:drop-shadow(0 0 4px rgba(255,215,0,0.4))} 50%{filter:drop-shadow(0 0 8px rgba(255,215,0,0.8))} }
        @keyframes ringPulse { 0%,100%{opacity:0.5;transform:scale(1)} 50%{opacity:1;transform:scale(1.04)} }
        @keyframes cardSlideOut { 0%{opacity:1;transform:translateX(0) scale(1)} 100%{opacity:0;transform:translateX(-60px) scale(0.92)} }
        @keyframes cardSlideIn  { 0%{opacity:0;transform:translateX(60px) scale(0.92)} 100%{opacity:1;transform:translateX(0) scale(1)} }
        @keyframes sideSlideOut { 0%{opacity:0.72} 100%{opacity:0} }
        @keyframes sideSlideIn  { 0%{opacity:0} 100%{opacity:0.72} }
        @keyframes activeGlow   { 0%,100%{box-shadow:0 0 30px rgba(123,47,255,0.6),0 12px 44px rgba(0,0,0,0.85)} 50%{box-shadow:0 0 50px rgba(123,47,255,0.85),0 12px 60px rgba(0,0,0,0.9)} }
        .lb-scroll::-webkit-scrollbar { display: none; }
        .lb-scroll { scrollbar-width: none; -ms-overflow-style: none; }
        body { overflow: hidden; }
        @media (max-width: 768px) { body { overflow: auto; } }
      `}</style>

      {/* ══════ LEFT ══════ */}
      <div style={{
        position: "relative",
        overflow: isMobile ? "visible" : "hidden",
        display: "flex", flexDirection: "column",
        borderRight: isMobile ? "none" : "1px solid rgba(123,47,255,0.1)",
        borderBottom: isMobile ? "1px solid rgba(123,47,255,0.1)" : "none",
        height: isMobile ? "auto" : "100%",
      }}>

        {/* Grid BG */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
          backgroundImage: "linear-gradient(rgba(123,47,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(123,47,255,0.07) 1px, transparent 1px)",
          backgroundSize: "50px 50px",
        }} />
        {/* Purple glow top center */}
        <div style={{
          position: "absolute", top: "-10%", left: "40%", transform: "translateX(-50%)",
          width: 500, height: 400,
          background: "radial-gradient(circle, rgba(123,47,255,0.18) 0%, transparent 70%)",
          borderRadius: "50%", pointerEvents: "none", zIndex: 0,
        }} />
        {/* Cyan glow bottom right */}
        <div style={{
          position: "absolute", bottom: 0, right: 0,
          width: 300, height: 300,
          background: "radial-gradient(circle, rgba(0,212,255,0.07) 0%, transparent 70%)",
          borderRadius: "50%", pointerEvents: "none", zIndex: 0,
        }} />

        {/* Hero */}
        <div style={{
          position: "relative", zIndex: 2, flex: isMobile ? "none" : 1,
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "420px 1fr",
          minHeight: 0,
        }}>
          {/* TEXT */}
          <div style={{ padding: isMobile ? "20px 16px" : "16px 36px", display: "flex", flexDirection: "column", justifyContent: "center" }}>

            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 11px", border: "1px solid rgba(180,150,255,0.25)",
              borderRadius: 4, fontSize: 9, color: "rgba(210,190,255,0.75)",
              letterSpacing: "1.5px", textTransform: "uppercase",
              marginBottom: 14, width: "fit-content",
              background: "rgba(123,47,255,0.1)",
              fontFamily: "'Rajdhani',sans-serif", fontWeight: 600,
            }}>
              The Future of Gaming is On-Chain
            </div>

            <h1 style={{
              fontSize: isMobile ? 34 : 48, fontWeight: 700, lineHeight: 0.93,
              letterSpacing: "-0.5px", marginBottom: 12,
              fontFamily: "'Rajdhani',sans-serif", textTransform: "uppercase", color: "#fff",
            }}>
              Play. Earn.<br />Dominate<br />
              <span style={{ background: "linear-gradient(90deg,#7B2FFF,#00d4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                The Chain.
              </span>
            </h1>

            <p style={{ fontSize: 13, color: "rgba(220,200,255,0.6)", lineHeight: 1.65, maxWidth: 340, marginBottom: 16 }}>
              Discover, play and publish fully on-chain games.<br />
              True ownership. Real rewards. Infinite possibilities.
            </p>

            <div style={{ display: "flex", gap: 9, marginBottom: 10, flexWrap: "wrap" }}>
              <button onClick={() => navigate("/games")} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: isMobile ? "10px 18px" : "11px 22px",
                background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 7,
                fontSize: 12, fontWeight: 700, color: "#fff", cursor: "pointer",
                fontFamily: "'Rajdhani',sans-serif", letterSpacing: "1px", textTransform: "uppercase",
              }}>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <rect x="1" y="1" width="5" height="5" rx="1" fill="white" opacity="0.9" />
                  <rect x="7" y="1" width="5" height="5" rx="1" fill="white" opacity="0.55" />
                  <rect x="1" y="7" width="5" height="5" rx="1" fill="white" opacity="0.55" />
                  <rect x="7" y="7" width="5" height="5" rx="1" fill="white" opacity="0.25" />
                </svg>
                Play Games
              </button>
              <button onClick={() => navigate("/publish")} style={{
                padding: isMobile ? "10px 16px" : "11px 20px",
                background: "rgba(123,47,255,0.09)",
                border: "1px solid rgba(180,150,255,0.28)", borderRadius: 7,
                fontSize: 12, fontWeight: 700, color: "rgba(210,185,255,0.85)", cursor: "pointer",
                fontFamily: "'Rajdhani',sans-serif", letterSpacing: "1px", textTransform: "uppercase",
              }}>
                Publish Game +
              </button>
            </div>

            <button onClick={() => navigate("/games")} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "0", background: "transparent", border: "none",
              fontSize: 11, color: "rgba(180,150,255,0.55)", cursor: "pointer",
              fontFamily: "'Rajdhani',sans-serif", fontWeight: 700,
              letterSpacing: "1px", textTransform: "uppercase",
              marginBottom: 10, width: "fit-content",
            }}>
              Explore All Games
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <div style={{ fontSize: 9, color: "rgba(180,155,220,0.35)", letterSpacing: "0.3px", marginBottom: 10 }}>
              Fast · Secure · Interoperable
            </div>

                     </div>

          {/* 3D Rotating Game Cards — desktop only */}
          {!isMobile && games && games.length > 0 && (() => {
            const getThumb = (g) => g?.thumbnail || g?.imageUrl || g?.image || g?.coverImage || g?.thumbnailUrl || null;
            const n = games.length;
            const ci = heroCardIndex % n;
            const lIdx = (ci - 1 + n) % n;
            const rIdx = (ci + 1) % n;
            const flIdx = (ci - 2 + n) % n;
            const frIdx = (ci + 2) % n;
            const isExit = carouselAnim === "exit";
            const isEnter = carouselAnim === "enter";

            // ── SIZE CONTROLS ── change these to resize everything
            const C = { w: 330, h: 410, imgH: 290 };   // center card
            const S = { w: 175, h: 238, imgH: 148 };   // side cards (left/right)
            const P = { w: 110, h: 152 };               // peek cards (far left/right)
            const sideLeft = "8%";                      // left card position from left
            const sideRight = "8%";                     // right card position from right
            const peekLeft = "1%";                      // far left peek position
            const peekRight = "1%";                     // far right peek position

            const ThumbImg = ({ game, height, fallbackSize = 30 }) => {
              const src = getThumb(game);
              return src
                ? <img src={src} alt={game?.name || ""} style={{ width: "100%", height, objectFit: "cover", display: "block" }} onError={e => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }} />
                : null;
            };

            const FallbackDiv = ({ height, size = 30 }) => (
              <div style={{ width: "100%", height, background: "linear-gradient(135deg,rgba(123,47,255,0.28),rgba(0,212,255,0.1))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size }}>🎮</div>
            );

            return (
              <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", height: "100%" }}>
                {/* Glow rings */}
                <div style={{ position: "absolute", width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle,rgba(123,47,255,0.11) 0%,transparent 70%)", pointerEvents: "none" }} />
                <div style={{ position: "absolute", width: 300, height: 300, borderRadius: "50%", border: "1px solid rgba(123,47,255,0.09)", pointerEvents: "none", animation: "tagFloat 7s ease-in-out infinite" }} />

                <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>

                  {/* Far left peek */}
                  <div style={{
                    position: "absolute", left: peekLeft,
                    width: P.w, height: P.h, borderRadius: 9, overflow: "hidden",
                    border: "1px solid rgba(123,47,255,0.1)",
                    transform: "perspective(600px) rotateY(40deg) scale(0.75)",
                    zIndex: 1, background: "#0a0616",
                    animation: isExit ? "sideSlideOut 0.35s ease forwards" : isEnter ? "sideSlideIn 0.4s ease forwards" : "none",
                    opacity: isExit || isEnter ? undefined : 0.28,
                  }}>
                    {getThumb(games[flIdx]) ? <img src={getThumb(games[flIdx])} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <FallbackDiv height="100%" size={22} />}
                  </div>

                  {/* Left card */}
                  <div style={{
                    position: "absolute", left: sideLeft,
                    width: S.w, height: S.h, borderRadius: 12, overflow: "hidden",
                    border: "1px solid rgba(123,47,255,0.25)",
                    transform: "perspective(700px) rotateY(25deg) scale(0.87)",
                    zIndex: 2, background: "#0a0616",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.7)",
                    animation: isExit ? "sideSlideOut 0.35s ease forwards" : isEnter ? "sideSlideIn 0.4s ease forwards" : "none",
                    opacity: isExit || isEnter ? undefined : 0.7,
                  }}>
                    {getThumb(games[lIdx])
                      ? <img src={getThumb(games[lIdx])} alt={games[lIdx]?.name} style={{ width: "100%", height: S.imgH, objectFit: "contain", objectPosition: "center", display: "block", background: "#06040f" }} />
                      : <FallbackDiv height={S.imgH} size={28} />}
                    <div style={{ padding: "7px 9px" }}>
                      <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 11, color: "#b899ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{games[lIdx]?.name}</div>
                      <div style={{ fontSize: 8, color: "rgba(180,150,255,0.4)", fontFamily: "'Rajdhani',sans-serif", textTransform: "uppercase", marginBottom: 4 }}>{games[lIdx]?.category || games[lIdx]?.genre || "Arcade"}</div>
                      {games[lIdx]?.rewardRate && <span style={{ fontSize: 8, color: "#00d4ff", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, background: "rgba(0,212,255,0.07)", border: "1px solid rgba(0,212,255,0.18)", borderRadius: 4, padding: "1px 5px" }}>+{games[lIdx].rewardRate} ARCADE</span>}
                    </div>
                  </div>

                  {/* CENTER — Active */}
                  <div style={{
                    position: "absolute",
                    width: C.w, height: C.h, borderRadius: 14, overflow: "hidden",
                    border: "2px solid rgba(123,47,255,0.9)",
                    zIndex: 4, background: "#0d0a1e", cursor: "pointer",
                    animation: isExit
                      ? "cardSlideOut 0.35s cubic-bezier(0.4,0,0.2,1) forwards"
                      : isEnter
                        ? "cardSlideIn 0.4s cubic-bezier(0.4,0,0.2,1) forwards"
                        : "activeGlow 2.5s ease-in-out infinite",
                  }} onClick={() => navigate(`/games/${games[ci]?.id}`)}>
                    {/* Gloss */}
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "44%", background: "linear-gradient(180deg,rgba(255,255,255,0.05) 0%,transparent 100%)", borderRadius: "14px 14px 0 0", pointerEvents: "none", zIndex: 6 }} />
                    {/* Icon badge */}
                    <div style={{ position: "absolute", top: 10, right: 10, zIndex: 7, width: 28, height: 28, borderRadius: "50%", background: "rgba(123,47,255,0.4)", border: "1px solid rgba(180,150,255,0.5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>🎮</div>
                    {getThumb(games[ci])
                      ? <img src={getThumb(games[ci])} alt={games[ci]?.name} style={{ width: "100%", height: C.imgH, objectFit: "contain", objectPosition: "center", display: "block", background: "#06040f" }} />
                      : <FallbackDiv height={C.imgH} size={44} />}
                    <div style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                      {/* Name + genre row */}
                      <div>
                        <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 18, color: "#e0d0ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 4 }}>{games[ci]?.name}</div>
                        <div style={{ fontSize: 11, color: "rgba(180,150,255,0.5)", fontFamily: "'Rajdhani',sans-serif", textTransform: "uppercase", letterSpacing: "1px" }}>{games[ci]?.category || games[ci]?.genre || "Arcade"}</div>
                      </div>
                      {/* Divider */}
                      <div style={{ height: 1, background: "rgba(123,47,255,0.18)", borderRadius: 1 }} />
                      {/* Reward + play row */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        {games[ci]?.rewardRate
                          ? <span style={{ fontSize: 14, color: "#00d4ff", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.25)", borderRadius: 6, padding: "5px 12px" }}>+{games[ci].rewardRate} ARCADE</span>
                          : <span />}
                        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "rgba(180,150,255,0.45)", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00FF88", display: "inline-block" }} />
                          Play Now
                        </div>
                      </div>
                    </div>
                    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(180deg,transparent 55%,rgba(123,47,255,0.14) 100%)", borderRadius: 14 }} />
                  </div>

                  {/* Right card */}
                  <div style={{
                    position: "absolute", right: sideRight,
                    width: S.w, height: S.h, borderRadius: 12, overflow: "hidden",
                    border: "1px solid rgba(123,47,255,0.25)",
                    transform: "perspective(700px) rotateY(-25deg) scale(0.87)",
                    zIndex: 2, background: "#0a0616",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.7)",
                    animation: isExit ? "sideSlideOut 0.35s ease forwards" : isEnter ? "sideSlideIn 0.4s ease forwards" : "none",
                    opacity: isExit || isEnter ? undefined : 0.7,
                  }}>
                    {getThumb(games[rIdx])
                      ? <img src={getThumb(games[rIdx])} alt={games[rIdx]?.name} style={{ width: "100%", height: S.imgH, objectFit: "contain", objectPosition: "center", display: "block", background: "#06040f" }} />
                      : <FallbackDiv height={S.imgH} size={28} />}
                    <div style={{ padding: "7px 9px" }}>
                      <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 11, color: "#b899ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{games[rIdx]?.name}</div>
                      <div style={{ fontSize: 8, color: "rgba(180,150,255,0.4)", fontFamily: "'Rajdhani',sans-serif", textTransform: "uppercase", marginBottom: 4 }}>{games[rIdx]?.category || games[rIdx]?.genre || "Arcade"}</div>
                      {games[rIdx]?.rewardRate && <span style={{ fontSize: 8, color: "#00d4ff", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, background: "rgba(0,212,255,0.07)", border: "1px solid rgba(0,212,255,0.18)", borderRadius: 4, padding: "1px 5px" }}>+{games[rIdx].rewardRate} ARCADE</span>}
                    </div>
                  </div>

                  {/* Far right peek */}
                  <div style={{
                    position: "absolute", right: peekRight,
                    width: P.w, height: P.h, borderRadius: 9, overflow: "hidden",
                    border: "1px solid rgba(123,47,255,0.1)",
                    transform: "perspective(600px) rotateY(-40deg) scale(0.75)",
                    zIndex: 1, background: "#0a0616",
                    animation: isExit ? "sideSlideOut 0.35s ease forwards" : isEnter ? "sideSlideIn 0.4s ease forwards" : "none",
                    opacity: isExit || isEnter ? undefined : 0.28,
                  }}>
                    {getThumb(games[frIdx]) ? <img src={getThumb(games[frIdx])} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <FallbackDiv height="100%" size={22} />}
                  </div>

                  {/* Active name label */}
                  <div style={{ position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 10, color: "rgba(180,150,255,0.4)", letterSpacing: "3px", textTransform: "uppercase", whiteSpace: "nowrap", pointerEvents: "none", zIndex: 10 }}>
                    {games[ci]?.name || ""}
                  </div>

                  {/* Dot nav */}
                  <div style={{ position: "absolute", bottom: 26, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 5, zIndex: 10 }}>
                    {games.slice(0, Math.min(n, 8)).map((_, i) => (
                      <button key={i} onClick={() => { setCarouselAnim("exit"); setTimeout(() => { setHeroCardIndex(i); setCarouselAnim("enter"); setTimeout(() => setCarouselAnim("idle"), 400); }, 350); }} style={{
                        width: i === ci ? 16 : 5, height: 4, borderRadius: 3,
                        background: i === ci ? "#7B2FFF" : "rgba(123,47,255,0.22)",
                        border: "none", cursor: "pointer", padding: 0, transition: "all 0.25s ease",
                      }} />
                    ))}
                  </div>
                </div>

                {/* Floating tags */}
                {[
                  { style: { left: "2%", top: "10%" }, border: "1px solid rgba(123,47,255,0.45)", icon: "◈", iconColor: "rgba(180,150,255,0.7)", label: "Own", labelColor: "rgba(200,170,255,0.6)", value: "Your Assets", valueColor: "#d4b8ff", delay: "0s", dur: "3.2s" },
                  { style: { right: "2%", top: "6%" }, border: "1px solid rgba(0,212,255,0.4)", icon: "◎", iconColor: "rgba(0,212,255,0.7)", label: "Earn", labelColor: "rgba(0,212,255,0.6)", value: "Real Rewards", valueColor: "#00d4ff", delay: "0.7s", dur: "3.5s" },
                  { style: { right: "2%", bottom: "14%" }, border: "1px solid rgba(0,255,136,0.35)", icon: "▶", iconColor: "rgba(0,255,136,0.65)", label: "Play", labelColor: "rgba(0,255,136,0.55)", value: "No Limits", valueColor: "#00FF88", delay: "1.4s", dur: "2.9s" },
                ].map((tag, i) => (
                  <div key={i} style={{
                    position: "absolute", ...tag.style,
                    border: tag.border,
                    background: "rgba(8,7,15,0.85)", borderRadius: 8, padding: "8px 12px",
                    backdropFilter: "blur(14px)", animation: `tagFloat ${tag.dur} ease-in-out infinite`,
                    animationDelay: tag.delay, zIndex: 5,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                      <span style={{ fontSize: 9, color: tag.iconColor }}>{tag.icon}</span>
                      <span style={{ fontSize: 8, color: tag.labelColor, textTransform: "uppercase", letterSpacing: "1px", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700 }}>{tag.label}</span>
                    </div>
                    <div style={{ fontSize: 12, color: tag.valueColor, fontWeight: 700, fontFamily: "'Rajdhani',sans-serif" }}>{tag.value}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* FEATURED GAMES */}
        {featured.length > 0 && (
          <div style={{
            position: "relative", zIndex: 2, flexShrink: 0,
            padding: isMobile ? "12px 16px" : "8px 36px 10px",
            marginTop: 0,
            borderTop: "1px solid rgba(123,47,255,0.1)",
          }}
            onWheel={e => { if (!isMobile) { e.preventDefault(); if (e.deltaY > 0) goTo(page + 1); else goTo(page - 1); } }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: "rgba(210,185,255,0.8)", textTransform: "uppercase", letterSpacing: "2px", fontWeight: 700, fontFamily: "'Rajdhani',sans-serif" }}>
                Featured Games
              </span>
              {totalPages > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 9, color: "rgba(180,150,255,0.45)", fontFamily: "'Orbitron',sans-serif" }}>{page + 1} / {totalPages}</span>
                  <div style={{ display: "flex", gap: 5 }}>
                    {[["prev", page === 0], ["next", page >= totalPages - 1]].map(([dir, disabled]) => (
                      <button key={dir} onClick={() => goTo(dir === "prev" ? page - 1 : page + 1)} disabled={disabled} style={{
                        width: 22, height: 22, borderRadius: "50%",
                        cursor: disabled ? "not-allowed" : "pointer",
                        background: disabled ? "rgba(123,47,255,0.04)" : "rgba(123,47,255,0.16)",
                        border: `1px solid ${disabled ? "rgba(123,47,255,0.08)" : "rgba(123,47,255,0.38)"}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                          {dir === "prev"
                            ? <path d="M5 1.5L2 4l3 2.5" stroke={disabled ? "rgba(123,47,255,0.25)" : "#c4a0ff"} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                            : <path d="M3 1.5l3 2.5-3 2.5" stroke={disabled ? "rgba(123,47,255,0.25)" : "#c4a0ff"} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                          }
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 250px)",
              gap: 6,
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0px)" : "translateY(12px)",
              transition: "opacity 0.28s ease, transform 0.28s ease",
            }}>
              {currentCards.map(game => <GameCard key={game.id} game={game} />)}
            </div>

            {totalPages > 1 && (
              <div style={{ display: "flex", justifyContent: "center", gap: 5, marginTop: 6 }}>
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button key={i} onClick={() => goTo(i)} style={{
                    width: i === page ? 16 : 5, height: 4, borderRadius: 3,
                    background: i === page ? "#7B2FFF" : "rgba(123,47,255,0.22)",
                    border: "none", cursor: "pointer", padding: 0, transition: "all 0.25s ease",
                  }} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══════ RIGHT: Leaderboard ══════ */}
      <div style={{
        display: "flex", flexDirection: "column",
        overflow: isMobile ? "visible" : "hidden",
        background: "linear-gradient(180deg, #0f0820 0%, #0a0618 40%, #0d0a20 100%)",
        borderLeft: isMobile ? "none" : "1px solid rgba(123,47,255,0.15)",
        position: "relative",
        maxHeight: isMobile ? "none" : "calc(100vh - 54px)",
      }}>
        <div style={{ position: "absolute", top: -40, left: "50%", transform: "translateX(-50%)", width: 200, height: 200, background: "radial-gradient(circle, rgba(123,47,255,0.18) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

        {/* Header */}
        <div style={{ position: "relative", zIndex: 1, padding: "10px 14px", borderBottom: "1px solid rgba(123,47,255,0.15)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "1.5px", color: "#e0d0ff" }}>
              Live Leaderboard
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#00FF88", animation: "lbPulse 1.5s ease-in-out infinite" }} />
                <span style={{ fontSize: 9, color: "#4aaa6a", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700 }}>Live</span>
              </div>
              <button onClick={() => navigate("/leaderboard")} style={{ fontSize: 9, color: "#8866cc", background: "transparent", border: "none", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase" }}>
                View All
              </button>
            </div>
          </div>
        </div>

        {/* Top 3 Podium */}
        <div style={{ position: "relative", zIndex: 1, padding: "14px 8px 12px", borderBottom: "1px solid rgba(123,47,255,0.1)", display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 10, flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(123,47,255,0.2)", border: "2px solid rgba(192,192,192,0.5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🥈</div>
            <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 6, color: "#7755aa", textAlign: "center", maxWidth: 58, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{top3[1] ? shortAddr(top3[1].player) : "—"}</div>
            <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 12, color: "#C0C0C0" }}>{top3[1] ? fmtScore(top3[1].bestScore) : "—"}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, marginBottom: 10 }}>
            <div style={{ width: 46, height: 46, borderRadius: "50%", background: "rgba(123,47,255,0.15)", border: "2px solid rgba(255,215,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, boxShadow: "0 0 20px rgba(255,215,0,0.25)" }}>🥇</div>
            <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 6, color: "#9977dd", textAlign: "center", maxWidth: 68, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{top3[0] ? shortAddr(top3[0].player) : "—"}</div>
            <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 15, color: "#d4b8ff" }}>{top3[0] ? fmtScore(top3[0].bestScore) : "0.0K"}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(123,47,255,0.15)", border: "2px solid rgba(205,127,50,0.5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🥉</div>
            <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 6, color: "#6644aa", textAlign: "center", maxWidth: 58, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{top3[2] ? shortAddr(top3[2].player) : "—"}</div>
            <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 12, color: "#CD7F32" }}>{top3[2] ? fmtScore(top3[2].bestScore) : "—"}</div>
          </div>
        </div>

        {/* Creator Spotlight + Stats */}
        <div className="lb-scroll" style={{ flex: 1, overflowY: isMobile ? "visible" : "auto", overflowX: "hidden", position: "relative", zIndex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", scrollbarWidth: "none", msOverflowStyle: "none" }}>
          <div>

          {/* ── CREATOR SPOTLIGHT ── */}
          {(() => {
            // Find top creator by earnings (plays × rewardRate × 0.2)
            const creatorEarnings = {};
            const creatorGames = {};
            games.forEach(g => {
              const addr = g.creator?.toLowerCase();
              if (!addr) return;
              const earned = Math.floor((g.plays || 0) * (g.rewardRate || 50) * 0.2);
              if (!creatorEarnings[addr]) { creatorEarnings[addr] = 0; creatorGames[addr] = []; }
              creatorEarnings[addr] += earned;
              creatorGames[addr].push(g);
            });
            const topCreatorAddr = Object.entries(creatorEarnings).sort((a, b) => b[1] - a[1])[0];
            if (!topCreatorAddr) return null;
            const [addr, earned] = topCreatorAddr;
            const topGame = (creatorGames[addr] || []).sort((a, b) => (b.plays || 0) - (a.plays || 0))[0];
            const shortA = (a) => a ? a.slice(0, 6) + "..." + a.slice(-4) : "?";
            return (
              <div style={{ margin: "10px 10px 8px", position: "relative", overflow: "hidden" }}>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#FFB700", boxShadow: "0 0 6px #FFB700" }} />
                  <span style={{ fontSize: 9, fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", color: "#FFB700" }}>Creator Spotlight</span>
                  <span style={{ fontSize: 8, padding: "1px 6px", background: "rgba(255,183,0,0.1)", border: "1px solid rgba(255,183,0,0.2)", borderRadius: 3, color: "rgba(255,183,0,0.7)", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, marginLeft: "auto" }}>THIS WEEK</span>
                </div>

                {/* Card */}
                <div style={{ background: "linear-gradient(135deg, rgba(18,12,36,0.98) 0%, rgba(12,8,28,0.98) 100%)", borderRadius: 14, border: "1px solid rgba(255,183,0,0.2)", overflow: "hidden", position: "relative" }}>
                  {/* Glow */}
                  <div style={{ position: "absolute", top: -40, right: -40, width: 120, height: 120, background: "radial-gradient(circle, rgba(255,183,0,0.12) 0%, transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, #FFB700, transparent)" }} />

                  {/* Top game thumbnail banner */}
                  {topGame?.thumbnailUrl && (
                    <div style={{ position: "relative", width: "100%", paddingTop: "62%", overflow: "hidden" }}>
                      <img src={topGame.thumbnailUrl} alt="" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center", filter: "brightness(0.45)" }} />
                      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 0%, rgba(12,8,28,0.95) 100%)" }} />
                      <div style={{ position: "absolute", bottom: 8, left: 12, right: 12, display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 7, overflow: "hidden", border: "1px solid rgba(255,183,0,0.4)", flexShrink: 0 }}>
                          <img src={topGame.thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#fff", fontFamily: "'Rajdhani',sans-serif", lineHeight: 1 }}>{topGame.name}</div>
                          <div style={{ fontSize: 8, color: "rgba(255,183,0,0.7)", fontFamily: "'Rajdhani',sans-serif" }}>Top Game · {topGame.plays || 0} plays</div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ padding: "12px 14px" }}>
                    {/* Creator info */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <div style={{ width: 42, height: 42, borderRadius: "50%", overflow: "hidden", border: "2px solid rgba(255,183,0,0.5)", boxShadow: "0 0 12px rgba(255,183,0,0.2)", flexShrink: 0, background: "#0e0c1a" }}>
                        <img src={`https://api.dicebear.com/9.x/bottts/svg?seed=${addr}`} alt="" style={{ width: "100%", height: "100%" }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: "'Rajdhani',sans-serif", marginBottom: 2 }}>Top Creator</div>
                        <div style={{ fontSize: 9, color: "rgba(255,183,0,0.6)", fontFamily: "monospace" }}>{shortA(addr)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 8, color: "rgba(255,183,0,0.5)", fontFamily: "'Rajdhani',sans-serif", marginBottom: 1 }}>EARNED</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#FFB700", fontFamily: "'Orbitron',sans-serif" }}>{earned.toLocaleString()}</div>
                        <div style={{ fontSize: 7, color: "rgba(255,183,0,0.4)", fontFamily: "'Rajdhani',sans-serif" }}>ARCADE</div>
                      </div>
                    </div>

                    {/* Stats row */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                      {[
                        { label: "Games", value: creatorGames[addr]?.length || 0, color: "#a67fff" },
                        { label: "Total Plays", value: (creatorGames[addr] || []).reduce((s, g) => s + (g.plays || 0), 0), color: "#00d4ff" },
                        { label: "ARCADE", value: earned.toLocaleString(), color: "#FFB700" },
                      ].map(s => (
                        <div key={s.label} style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "7px 6px", textAlign: "center", border: "1px solid rgba(123,47,255,0.1)" }}>
                          <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 13, color: s.color, lineHeight: 1 }}>{s.value}</div>
                          <div style={{ fontSize: 7, color: "rgba(180,150,255,0.4)", fontFamily: "'Rajdhani',sans-serif", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── NETWORK STATS ── */}
          <div style={{ margin: "0 10px 8px", padding: "12px 14px", background: "rgba(123,47,255,0.05)", borderRadius: 12, border: "1px solid rgba(123,47,255,0.15)" }}>
            <div style={{ fontSize: 9, fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", color: "rgba(180,150,255,0.5)", marginBottom: 10 }}>Network Stats</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { label: "Top Players", value: leaderboard.length || "—", icon: "👥", color: "#c4a0ff" },
                { label: "Games Live",  value: games.length || "—",        icon: "🎮", color: "#00d4ff" },
                { label: "Top Score",   value: leaderboard.length > 0 ? fmtScore(leaderboard[0]?.bestScore) : "—", icon: "🏆", color: "#FFD700" },
                { label: "On-Chain",    value: "100%",                      icon: "⛓️", color: "#00FF88" },
              ].map((stat, i) => (
                <div key={i} style={{ background: "rgba(123,47,255,0.07)", borderRadius: 7, padding: "9px 12px", border: "1px solid rgba(123,47,255,0.1)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 14 }}>{stat.icon}</span>
                    <span style={{ fontSize: 9, color: "rgba(180,150,255,0.45)", fontFamily: "'Rajdhani',sans-serif", textTransform: "uppercase", letterSpacing: "0.5px" }}>{stat.label}</span>
                  </div>
                  <span style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 13, color: stat.color }}>{stat.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── UPCOMING TOURNAMENTS ── */}
          <div style={{ margin: "0 10px 8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#00d4ff", boxShadow: "0 0 6px #00d4ff" }} />
              <span style={{ fontSize: 9, fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", color: "#00d4ff" }}>Tournaments</span>
              <button onClick={() => navigate("/tournaments")} style={{ fontSize: 8, padding: "1px 6px", background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 3, color: "rgba(0,212,255,0.7)", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, marginLeft: "auto", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.5px" }}>VIEW ALL</button>
            </div>

            {!tournamentsLoaded ? (
              /* Loading skeleton */
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[1,2].map(i => (
                  <div key={i} style={{ height: 70, borderRadius: 10, background: "linear-gradient(90deg, rgba(123,47,255,0.06) 25%, rgba(123,47,255,0.1) 50%, rgba(123,47,255,0.06) 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite", border: "1px solid rgba(123,47,255,0.1)" }} />
                ))}
              </div>
            ) : upcomingTournaments.length === 0 ? (
              /* Empty state */
              <div style={{ background: "linear-gradient(135deg, rgba(123,47,255,0.06) 0%, rgba(0,212,255,0.04) 100%)", borderRadius: 12, border: "1px solid rgba(123,47,255,0.15)", padding: "18px 14px", textAlign: "center", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg, transparent, rgba(123,47,255,0.4), transparent)" }} />
                <div style={{ fontSize: 28, marginBottom: 8, filter: "grayscale(0.3)" }}>🏆</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#c4a0ff", fontFamily: "'Rajdhani',sans-serif", marginBottom: 4 }}>No Active Tournaments</div>
                <div style={{ fontSize: 9, color: "rgba(120,90,180,0.6)", fontFamily: "'Rajdhani',sans-serif", marginBottom: 14, lineHeight: 1.5 }}>New tournaments dropping soon.<br/>Stay tuned!</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  {[0,1,2,3,4].map(i => (
                    <div key={i} style={{
                      width: i === 2 ? 8 : (i === 1 || i === 3) ? 6 : 4,
                      height: i === 2 ? 8 : (i === 1 || i === 3) ? 6 : 4,
                      borderRadius: "50%",
                      background: i === 2 ? "#a67fff" : (i === 1 || i === 3) ? "rgba(166,127,255,0.5)" : "rgba(166,127,255,0.2)",
                      boxShadow: i === 2 ? "0 0 8px rgba(166,127,255,0.8)" : "none",
                      animation: `pulse-dot 1.4s ease-in-out ${i * 0.15}s infinite`,
                    }} />
                  ))}
                </div>
                <style>{`
                  @keyframes pulse-dot {
                    0%, 100% { opacity: 0.3; transform: scale(1); }
                    50% { opacity: 1; transform: scale(1.3); }
                  }
                `}</style>
              </div>
            ) : (
              /* Real tournament cards */
              upcomingTournaments.map((t) => {
                const now = Date.now() / 1000;
                const isActive = now >= t.startTime && now <= t.endTime;
                const statusColor = isActive ? "#00FF88" : "#00d4ff";
                const statusBorder = isActive ? "rgba(0,255,136,0.2)" : "rgba(0,212,255,0.18)";
                const statusGlow = isActive ? "rgba(0,255,136,0.08)" : "rgba(0,212,255,0.08)";
                const prize = Number(t.prizePool) / 1e18;
                const entryFee = Number(t.entryFee) / 1e18;
                const diff = (isActive ? t.endTime : t.startTime) - now;
                const h = Math.floor(diff / 3600);
                const m = Math.floor((diff % 3600) / 60);
                const timeStr = h > 48 ? `In ${Math.floor(h/24)}d` : h > 0 ? `${h}h ${m}m` : `${m}m`;
                return (
                  <div key={t.id} onClick={() => navigate("/tournaments")}
                    style={{ background: `linear-gradient(135deg, ${statusGlow} 0%, rgba(12,8,28,0.9) 100%)`, borderRadius: 10, border: `1px solid ${statusBorder}`, padding: "10px 12px", marginBottom: 6, position: "relative", overflow: "hidden", cursor: "pointer" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${statusColor}, transparent)` }} />
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 7 }}>
                      <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#fff", fontFamily: "'Rajdhani',sans-serif", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.gameName || "Tournament"}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                          <span style={{ width: 4, height: 4, borderRadius: "50%", background: statusColor, boxShadow: `0 0 4px ${statusColor}`, flexShrink: 0 }} />
                          <span style={{ fontSize: 8, color: statusColor, fontFamily: "'Rajdhani',sans-serif", fontWeight: 700 }}>{isActive ? "LIVE" : "UPCOMING"}</span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 7, color: "rgba(255,215,0,0.5)", fontFamily: "'Rajdhani',sans-serif" }}>PRIZE</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#FFD700", fontFamily: "'Orbitron',sans-serif", lineHeight: 1 }}>{prize > 0 ? prize.toFixed(0) : (entryFee * t.maxPlayers * 0.95).toFixed(0)}</div>
                        <div style={{ fontSize: 7, color: "rgba(255,215,0,0.4)", fontFamily: "'Rajdhani',sans-serif" }}>ARCADE</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 8 }}>⏱️</span>
                        <span style={{ fontSize: 8, color: statusColor, fontFamily: "'Rajdhani',sans-serif", fontWeight: 700 }}>{timeStr}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 8 }}>👥</span>
                        <span style={{ fontSize: 8, color: "rgba(180,150,255,0.5)", fontFamily: "'Rajdhani',sans-serif" }}>{t.players?.length || 0}/{t.maxPlayers}</span>
                      </div>
                      <div style={{ fontSize: 7, padding: "2px 7px", background: "rgba(123,47,255,0.15)", border: `1px solid ${statusBorder}`, borderRadius: 3, color: statusColor, fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        {isActive ? "Join Now" : "Register"}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "8px 14px", borderTop: "1px solid rgba(123,47,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, flexShrink: 0, position: "relative", zIndex: 1 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#00FF88", animation: "lbPulse 1.5s ease-in-out infinite" }} />
          <span style={{ fontSize: 9, color: "#4aaa6a", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700 }}>Live Updates</span>
        </div>
      </div>
    </div>
  );
}