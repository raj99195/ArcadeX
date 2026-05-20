import { useNavigate } from "react-router-dom";
import { useAccount } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { useGames } from "../hooks/useGames";
import GameCard from "../components/GameCard";
import { useEffect, useState } from "react";
import { getScores } from "../lib/gameService";
import { useArcadeBalance } from "../hooks/useArcadeBalance";

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
      setHeroAngle(a => a - (360 / Math.max(games.length, 3)));
      setHeroCardIndex(i => (i + 1) % Math.max(games.length, 1));
    }, 2200);
    return () => clearInterval(interval);
  }, [games]);

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
      background: "#08070f",
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "1fr 280px",
      overflow: isMobile ? "auto" : "hidden",
      height: isMobile ? "auto" : "calc(100vh - 54px)",
      position: "relative",
    }}>

      <style>{`
        @keyframes tagFloat  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-7px)} }
        @keyframes lbPulse   { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes medalGlow { 0%,100%{filter:drop-shadow(0 0 4px rgba(255,215,0,0.4))} 50%{filter:drop-shadow(0 0 8px rgba(255,215,0,0.8))} }
        @keyframes ringPulse { 0%,100%{opacity:0.5;transform:scale(1)} 50%{opacity:1;transform:scale(1.04)} }
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
          {!isMobile && games && games.length > 0 && (
            <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", height: "100%" }}>

              {/* Ambient glow */}
              <div style={{ position: "absolute", width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(123,47,255,0.12) 0%, transparent 70%)", pointerEvents: "none" }} />
              <div style={{ position: "absolute", width: 290, height: 290, borderRadius: "50%", border: "1px solid rgba(123,47,255,0.1)", pointerEvents: "none", animation: "tagFloat 6s ease-in-out infinite" }} />

              {/* Cards fan */}
              <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>

                {/* Far left peek */}
                {games[(heroCardIndex - 2 + games.length) % games.length] && (
                  <div style={{
                    position: "absolute", left: "2%",
                    width: 95, height: 130, borderRadius: 10, overflow: "hidden",
                    border: "1px solid rgba(123,47,255,0.12)", opacity: 0.3,
                    transform: "perspective(600px) rotateY(38deg) scale(0.78)",
                    zIndex: 1, background: "#0a0616",
                  }}>
                    {games[(heroCardIndex - 2 + games.length) % games.length].imageUrl
                      ? <img src={games[(heroCardIndex - 2 + games.length) % games.length].imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <div style={{ width: "100%", height: "100%", background: "rgba(123,47,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🎮</div>
                    }
                  </div>
                )}

                {/* Left card */}
                {games[(heroCardIndex - 1 + games.length) % games.length] && (() => {
                  const g = games[(heroCardIndex - 1 + games.length) % games.length];
                  return (
                    <div onClick={() => setHeroCardIndex((heroCardIndex - 1 + games.length) % games.length)} style={{
                      position: "absolute", left: "14%",
                      width: 140, height: 188, borderRadius: 12, overflow: "hidden",
                      border: "1px solid rgba(123,47,255,0.28)", opacity: 0.72,
                      transform: "perspective(700px) rotateY(26deg) scale(0.88)",
                      zIndex: 2, background: "#0a0616", cursor: "pointer",
                      transition: "all 0.5s cubic-bezier(0.4,0,0.2,1)",
                      boxShadow: "0 4px 22px rgba(0,0,0,0.7)",
                    }}>
                      {g.imageUrl
                        ? <img src={g.imageUrl} alt={g.name} style={{ width: "100%", height: 118, objectFit: "cover", display: "block" }} />
                        : <div style={{ width: "100%", height: 118, background: "linear-gradient(135deg,rgba(123,47,255,0.3),rgba(0,212,255,0.12))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34 }}>🎮</div>
                      }
                      <div style={{ padding: "8px 10px" }}>
                        <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 11, color: "#c4a0ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</div>
                        <div style={{ fontSize: 8, color: "rgba(180,150,255,0.45)", fontFamily: "'Rajdhani',sans-serif", textTransform: "uppercase", marginBottom: 5 }}>{g.genre || "Arcade"}</div>
                        {g.rewardPoints && <span style={{ fontSize: 8, color: "#00d4ff", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 4, padding: "2px 6px" }}>+{g.rewardPoints} ARCADE</span>}
                      </div>
                    </div>
                  );
                })()}

                {/* CENTER card — active */}
                {(() => {
                  const g = games[heroCardIndex % games.length];
                  return (
                    <div onClick={() => navigate(`/games/${g.id}`)} style={{
                      position: "absolute",
                      width: 178, height: 240, borderRadius: 14, overflow: "hidden",
                      border: "2px solid rgba(123,47,255,0.88)",
                      boxShadow: "0 0 38px rgba(123,47,255,0.65), 0 12px 44px rgba(0,0,0,0.85)",
                      zIndex: 4, background: "#0d0a1e", cursor: "pointer",
                      transition: "all 0.5s cubic-bezier(0.4,0,0.2,1)",
                    }}>
                      {/* Gloss */}
                      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "45%", background: "linear-gradient(180deg,rgba(255,255,255,0.05) 0%,transparent 100%)", borderRadius: "14px 14px 0 0", pointerEvents: "none", zIndex: 5 }} />
                      {/* Game icon badge */}
                      <div style={{ position: "absolute", top: 10, right: 10, zIndex: 6, width: 30, height: 30, borderRadius: "50%", background: "rgba(123,47,255,0.35)", border: "1px solid rgba(123,47,255,0.5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>🎮</div>
                      {g.imageUrl
                        ? <img src={g.imageUrl} alt={g.name} style={{ width: "100%", height: 158, objectFit: "cover", display: "block" }} />
                        : <div style={{ width: "100%", height: 158, background: "linear-gradient(135deg,rgba(123,47,255,0.35),rgba(0,212,255,0.15))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 48 }}>🎮</div>
                      }
                      <div style={{ padding: "10px 12px" }}>
                        <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 14, color: "#e0d0ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 3 }}>{g.name}</div>
                        <div style={{ fontSize: 10, color: "rgba(180,150,255,0.5)", fontFamily: "'Rajdhani',sans-serif", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 7 }}>{g.genre || "Arcade"}</div>
                        {g.rewardPoints && <span style={{ fontSize: 11, color: "#00d4ff", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.25)", borderRadius: 5, padding: "3px 9px" }}>+{g.rewardPoints} ARCADE</span>}
                      </div>
                      {/* Bottom glow */}
                      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(180deg,transparent 55%,rgba(123,47,255,0.15) 100%)", borderRadius: 14 }} />
                    </div>
                  );
                })()}

                {/* Right card */}
                {games[(heroCardIndex + 1) % games.length] && (() => {
                  const g = games[(heroCardIndex + 1) % games.length];
                  return (
                    <div onClick={() => setHeroCardIndex((heroCardIndex + 1) % games.length)} style={{
                      position: "absolute", right: "14%",
                      width: 140, height: 188, borderRadius: 12, overflow: "hidden",
                      border: "1px solid rgba(123,47,255,0.28)", opacity: 0.72,
                      transform: "perspective(700px) rotateY(-26deg) scale(0.88)",
                      zIndex: 2, background: "#0a0616", cursor: "pointer",
                      transition: "all 0.5s cubic-bezier(0.4,0,0.2,1)",
                      boxShadow: "0 4px 22px rgba(0,0,0,0.7)",
                    }}>
                      {g.imageUrl
                        ? <img src={g.imageUrl} alt={g.name} style={{ width: "100%", height: 118, objectFit: "cover", display: "block" }} />
                        : <div style={{ width: "100%", height: 118, background: "linear-gradient(135deg,rgba(123,47,255,0.3),rgba(0,212,255,0.12))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34 }}>🎮</div>
                      }
                      <div style={{ padding: "8px 10px" }}>
                        <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 11, color: "#c4a0ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</div>
                        <div style={{ fontSize: 8, color: "rgba(180,150,255,0.45)", fontFamily: "'Rajdhani',sans-serif", textTransform: "uppercase", marginBottom: 5 }}>{g.genre || "Arcade"}</div>
                        {g.rewardPoints && <span style={{ fontSize: 8, color: "#00d4ff", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 4, padding: "2px 6px" }}>+{g.rewardPoints} ARCADE</span>}
                      </div>
                    </div>
                  );
                })()}

                {/* Far right peek */}
                {games[(heroCardIndex + 2) % games.length] && (
                  <div style={{
                    position: "absolute", right: "2%",
                    width: 95, height: 130, borderRadius: 10, overflow: "hidden",
                    border: "1px solid rgba(123,47,255,0.12)", opacity: 0.3,
                    transform: "perspective(600px) rotateY(-38deg) scale(0.78)",
                    zIndex: 1, background: "#0a0616",
                  }}>
                    {games[(heroCardIndex + 2) % games.length].imageUrl
                      ? <img src={games[(heroCardIndex + 2) % games.length].imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <div style={{ width: "100%", height: "100%", background: "rgba(123,47,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🎮</div>
                    }
                  </div>
                )}

                {/* Nav arrows */}
                <button onClick={() => setHeroCardIndex((heroCardIndex - 1 + games.length) % games.length)} style={{ position: "absolute", left: 6, zIndex: 10, width: 32, height: 32, borderRadius: "50%", background: "rgba(123,47,255,0.18)", border: "1px solid rgba(123,47,255,0.35)", color: "#c4a0ff", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
                <button onClick={() => setHeroCardIndex((heroCardIndex + 1) % games.length)} style={{ position: "absolute", right: 6, zIndex: 10, width: 32, height: 32, borderRadius: "50%", background: "rgba(123,47,255,0.18)", border: "1px solid rgba(123,47,255,0.35)", color: "#c4a0ff", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>

                {/* Active game label */}
                <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 10, color: "rgba(180,150,255,0.4)", letterSpacing: "3px", textTransform: "uppercase", whiteSpace: "nowrap", pointerEvents: "none" }}>
                  {games[heroCardIndex % games.length]?.name || ""}
                </div>

                {/* Dot nav */}
                <div style={{ position: "absolute", bottom: 22, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 5, zIndex: 10 }}>
                  {games.slice(0, Math.min(games.length, 8)).map((_, i) => (
                    <button key={i} onClick={() => setHeroCardIndex(i)} style={{
                      width: i === heroCardIndex % games.length ? 16 : 5, height: 4, borderRadius: 3,
                      background: i === heroCardIndex % games.length ? "#7B2FFF" : "rgba(123,47,255,0.22)",
                      border: "none", cursor: "pointer", padding: 0, transition: "all 0.25s ease",
                    }} />
                  ))}
                </div>
              </div>

              {/* Floating tags */}
              {[
                { style: { left: "2%", top: "10%", border: "1px solid rgba(123,47,255,0.45)" }, icon: "◈", iconColor: "rgba(180,150,255,0.7)", label: "Own", labelColor: "rgba(200,170,255,0.6)", value: "Your Assets", valueColor: "#d4b8ff", delay: "0s", dur: "3.2s" },
                { style: { right: "2%", top: "6%", border: "1px solid rgba(0,212,255,0.4)" }, icon: "◎", iconColor: "rgba(0,212,255,0.7)", label: "Earn", labelColor: "rgba(0,212,255,0.6)", value: "Real Rewards", valueColor: "#00d4ff", delay: "0.7s", dur: "3.5s" },
                { style: { right: "2%", bottom: "14%", border: "1px solid rgba(0,255,136,0.35)" }, icon: "▶", iconColor: "rgba(0,255,136,0.65)", label: "Play", labelColor: "rgba(0,255,136,0.55)", value: "No Limits", valueColor: "#00FF88", delay: "1.4s", dur: "2.9s" },
              ].map((tag, i) => (
                <div key={i} style={{
                  position: "absolute", ...tag.style,
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
          )}
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

        {/* BOTChain Panel */}
        <div style={{ flex: 1, overflowY: isMobile ? "visible" : "auto", position: "relative", zIndex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1 }}>
          {/* BOTChain Panel */}
          <div style={{ padding: "16px", background: "linear-gradient(180deg,rgba(20,8,40,0.95),rgba(10,4,25,0.98))", borderRadius: 12, border: "1px solid rgba(123,47,255,0.25)", margin: "10px 10px 8px" }}>
            <div style={{ textAlign: "center", padding: "12px 10px 14px", borderBottom: "1px solid rgba(123,47,255,0.15)" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", fontFamily: "Rajdhani", marginBottom: 5 }}>Built on BOTChain</div>
              <div style={{ fontSize: 11, background: "linear-gradient(90deg,#7B2FFF,#00d4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", fontWeight: 700, marginBottom: 7 }}>Powered by the Future</div>
              <p style={{ fontSize: 9, color: "#7755aa", lineHeight: 1.6 }}>High-performance EVM L1 for scalable, secure on-chain gaming.</p>
            </div>
            {[
              { title: "Built on BOTChain", desc: "High-performance EVM L1", icon: "⛓️" },
              { title: "True Ownership", desc: "Your assets live on-chain", icon: "⭐" },
              { title: "Play & Earn", desc: "Real rewards from gameplay", icon: "🎮" },
              { title: "Interoperable", desc: "Connect across ecosystem", icon: "🔗" },
            ].map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 8px", borderBottom: i < 3 ? "1px solid rgba(123,47,255,0.1)" : "none" }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(123,47,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, border: "1px solid rgba(123,47,255,0.3)", flexShrink: 0 }}>{item.icon}</div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#c4a0ff", marginBottom: 2 }}>{item.title}</div>
                  <div style={{ fontSize: 9, color: "#7755aa" }}>{item.desc}</div>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 8px", marginTop: 4, background: "rgba(123,47,255,0.05)", borderRadius: 8 }}>
              <span style={{ fontSize: 18 }}>⛓️</span>
              <div>
                <div style={{ fontSize: 11, color: "#c4a0ff", fontWeight: 700 }}>BOTChain</div>
                <div style={{ fontSize: 9, color: "#5533aa" }}>One Network. Infinite Games.</div>
              </div>
            </div>
          </div>

          {/* Live Stats */}
          <div style={{ margin: "0 10px 8px", padding: "12px 14px", background: "rgba(123,47,255,0.06)", borderRadius: 10, border: "1px solid rgba(123,47,255,0.18)" }}>
            <div style={{ fontSize: 9, fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", color: "rgba(180,150,255,0.5)", marginBottom: 10 }}>Network Stats</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { label: "Total Players", value: leaderboard.length > 0 ? `${leaderboard.length * 12}+` : "2.4K+", icon: "👥", color: "#c4a0ff" },
                { label: "Games Live", value: `${games.length}`, icon: "🎮", color: "#00d4ff" },
                { label: "Rewards Paid", value: leaderboard.length > 0 ? fmtScore(leaderboard.reduce((a, b) => a + b.totalScore, 0)) : "—", icon: "💎", color: "#FFD700" },
                { label: "On-Chain Txns", value: "100%", icon: "⛓️", color: "#00FF88" },
              ].map((stat, i) => (
                <div key={i} style={{ background: "rgba(123,47,255,0.08)", borderRadius: 8, padding: "9px 10px", border: "1px solid rgba(123,47,255,0.12)" }}>
                  <div style={{ fontSize: 14, marginBottom: 4 }}>{stat.icon}</div>
                  <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 14, color: stat.color, marginBottom: 2 }}>{stat.value}</div>
                  <div style={{ fontSize: 8, color: "rgba(180,150,255,0.4)", fontFamily: "'Rajdhani',sans-serif", textTransform: "uppercase", letterSpacing: "0.5px" }}>{stat.label}</div>
                </div>
              ))}
            </div>
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
