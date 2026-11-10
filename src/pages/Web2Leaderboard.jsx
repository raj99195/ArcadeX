// src/pages/Web2Leaderboard.jsx
//
// Web2 mode leaderboard. Parallels Web3 Leaderboard.jsx but:
//   • reads from Firestore via /api/games?action=web2-leaderboard
//   • three time windows (All-time / Weekly / Daily)
//   • cyan theme matches Web2LoginScreen + ModeSelector cyan card
//   • no wallet/chain concepts — identity = OAuth display name + photo
//
// Routed through LeaderboardRoute in App.jsx so Web3 users still see
// the on-chain leaderboard on the same /leaderboard URL.

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Seo from "../components/Seo";
import { Icon } from "../components/Icon";
import AdBanner from "../components/AdBanner";

const fmtScore = (s) => s >= 1_000_000 ? (s / 1_000_000).toFixed(1) + "M"
                     : s >= 1_000     ? (s / 1_000).toFixed(1) + "K"
                     : String(s || 0);

function ProviderBadge({ provider }) {
  const map = {
    google:  { label: "G", color: "#4285F4", title: "Signed in with Google" },
    twitter: { label: "X", color: "#1DA1F2", title: "Signed in with X" },
  };
  const m = map[provider];
  if (!m) return null;
  return (
    <span title={m.title} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 14, height: 14, borderRadius: "50%",
      background: m.color, color: "#fff", fontSize: 8, fontWeight: 800,
      fontFamily: "'Rajdhani',sans-serif", marginLeft: 6,
    }}>{m.label}</span>
  );
}

function Avatar({ photoURL, name, size = 36 }) {
  const initials = (name || "P").slice(0, 2).toUpperCase();
  if (photoURL) {
    return (
      <img src={photoURL} alt={name || "player"} referrerPolicy="no-referrer"
        onError={(e) => { e.currentTarget.style.display = "none"; }}
        className="ax-heartbeat-hover"
        style={{
          width: size, height: size, borderRadius: "50%",
          objectFit: "cover", flexShrink: 0,
          border: "2px solid rgba(0,212,255,0.35)",
          transition: "border-color 0.25s, box-shadow 0.25s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 0 14px rgba(0,212,255,0.4)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }} />
    );
  }
  return (
    <div
      className="ax-heartbeat-hover"
      style={{
        width: size, height: size, borderRadius: "50%",
        background: "linear-gradient(135deg,#00d4ff,#1a7bbd)",
        backgroundSize: "200% 200%",
        animation: "axGradFlow 6s ease infinite",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.3, fontWeight: 700, color: "#fff",
        fontFamily: "'Orbitron',sans-serif", flexShrink: 0,
        border: "2px solid rgba(0,212,255,0.35)",
      }}>{initials}</div>
  );
}

function RankMedal({ rank }) {
  const medals = {
    1: { bg: "linear-gradient(135deg,#FFD700,#FF8C00)", shadow: "0 0 16px rgba(255,215,0,0.6)", pulseClass: "ax-glow-gold" },
    2: { bg: "linear-gradient(135deg,#C0C0C0,#808080)", shadow: "0 0 12px rgba(192,192,192,0.4)", pulseClass: "" },
    3: { bg: "linear-gradient(135deg,#CD7F32,#8B4513)", shadow: "0 0 12px rgba(205,127,50,0.4)", pulseClass: "" },
  };
  const m = medals[rank];
  if (!m) {
    return (
      <span style={{
        fontFamily: "'Orbitron',sans-serif", fontSize: 12, fontWeight: 700,
        color: "#6fb8d4", minWidth: 28, textAlign: "center",
      }}>{rank}</span>
    );
  }
  return (
    <div
      className={`${m.pulseClass} ax-heartbeat-hover`}
      style={{
        width: 28, height: 28, borderRadius: "50%", background: m.bg,
        boxShadow: m.shadow, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#fff",
        fontFamily: "'Orbitron',sans-serif",
        animation: rank === 1 ? "axFloatY 3s ease-in-out infinite" : undefined,
      }}>{rank}</div>
  );
}

export default function Web2Leaderboard() {
  const navigate = useNavigate();
  const [period, setPeriod]       = useState("all"); // all | weekly | daily
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [isMobile, setIsMobile]   = useState(typeof window !== "undefined" && window.innerWidth < 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/games?action=web2-leaderboard&period=${period}&limit=100`);
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Failed to load leaderboard");
        if (!cancelled) setRows(data.leaderboard || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [period]);

  const tabs = [
    { key: "all",    label: "All-Time" },
    { key: "weekly", label: "This Week" },
    { key: "daily",  label: "Today" },
  ];

  const periodLabel = tabs.find(t => t.key === period)?.label || "All-Time";
  return (
    <div style={{ minHeight: "100vh", color: "#fff", background: "#07090e", position: "relative", overflowX: "hidden" }}>
      <Seo
        title={`Leaderboard — ${periodLabel}`}
        description="See the top ArcadeCoin earners on ArcadeX. Free arcade games, no wallet required — sign in with Google or X and climb the daily, weekly, and all-time leaderboards."
        path="/leaderboard"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "ArcadeX ArcadeCoins Leaderboard",
          description: "Daily, weekly, and all-time top players on ArcadeX Web2 mode.",
          url: "https://www.playarcadex.in/leaderboard",
        }}
      />
      <style>{`
        @keyframes w2Pulse { 0%,100%{opacity:0.6} 50%{opacity:1} }
        @keyframes w2Float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-20px)} }
        .w2-row:hover { background: rgba(0,212,255,0.05) !important; }
        .w2-title-grad {
          background: linear-gradient(90deg,#00d4ff,#6fb8ff,#00d4ff);
          background-size: 300% auto;
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: gradShift 6s linear infinite;
        }
        @keyframes gradShift { to { background-position: 300% center; } }
      `}</style>

      {/* Background grid + glow */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: "linear-gradient(rgba(0,212,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.05) 1px, transparent 1px)",
          backgroundSize: "50px 50px",
        }} />
        <div style={{
          position: "absolute", top: "10%", left: "50%", transform: "translateX(-50%)",
          width: 600, height: 400,
          background: "radial-gradient(circle, rgba(0,212,255,0.14) 0%, transparent 70%)",
          borderRadius: "50%", animation: "w2Float 10s ease-in-out infinite",
        }} />
      </div>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1100, margin: "0 auto" }}>
        {/* Header */}
        <div className="ax-fade-up" style={{ padding: isMobile ? "20px 16px 16px" : "36px 36px 24px" }}>
          <div
            className="ax-fade-down"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 11px", border: "1px solid rgba(0,212,255,0.3)",
              borderRadius: 4, fontSize: 9, color: "#6fb8d4",
              letterSpacing: "1.5px", textTransform: "uppercase",
              marginBottom: 14, background: "rgba(0,212,255,0.08)",
              fontFamily: "'Rajdhani',sans-serif", fontWeight: 600,
            }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#00FF88", animation: "w2Pulse 1.5s ease-in-out infinite" }} />
            Web2 Mode — ArcadeCoins
          </div>
          <h1
            className="ax-slide-left"
            style={{
              fontFamily: "'Rajdhani',sans-serif", fontWeight: 700,
              fontSize: isMobile ? 28 : 48, letterSpacing: "-0.5px",
              textTransform: "uppercase", lineHeight: 1, color: "#fff",
              margin: 0,
            }}>
            Global <span className="w2-title-grad">Leaderboard</span>
          </h1>
          <p
            className="ax-fade-in"
            style={{
              color: "rgba(180,220,255,0.65)", fontSize: 12, marginTop: 8,
              fontFamily: "'Rajdhani',sans-serif",
              animationDelay: "0.3s",
            }}>
            Earn ArcadeCoins by playing — no wallet needed.
          </p>
        </div>

        {/* Ad banner — between header and tabs */}
        <div style={{ padding: isMobile ? "0 16px" : "0 36px" }}>
          <AdBanner slot="" layout="leaderboard" style={{ marginBottom: 8 }} />
        </div>

        {/* Tabs */}
        <div style={{ padding: isMobile ? "0 16px" : "0 36px" }}>
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid rgba(0,212,255,0.15)" }}>
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setPeriod(t.key)}
                style={{
                  padding: isMobile ? "10px 15px" : "10px 22px",
                  background: "transparent", border: "none",
                  borderBottom: period === t.key ? "2px solid #00d4ff" : "1px solid transparent",
                  color: period === t.key ? "#9ee8ff" : "#3d7a95",
                  fontSize: 12, cursor: "pointer", marginBottom: "-1px",
                  fontFamily: "'Rajdhani',sans-serif", fontWeight: 700,
                  letterSpacing: "0.5px", textTransform: "uppercase",
                  transition: "color 0.2s, transform 0.2s, letter-spacing 0.2s",
                  boxShadow: period === t.key ? "0 2px 10px rgba(0,212,255,0.25)" : "none",
                }}
                onMouseEnter={(e) => {
                  if (period !== t.key) {
                    e.currentTarget.style.color = "#6fb8d4";
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (period !== t.key) {
                    e.currentTarget.style.color = "#3d7a95";
                    e.currentTarget.style.transform = "translateY(0)";
                  }
                }}
              >{t.label}</button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div style={{ padding: isMobile ? "16px" : "20px 36px 36px" }}>
          <div
            className="ax-fade-up ax-shine-border"
            style={{
              border: "1px solid rgba(0,212,255,0.18)", borderRadius: 12,
              overflow: "hidden", background: "rgba(6,12,18,0.82)",
              backdropFilter: "blur(20px)",
              animationDelay: "0.15s",
            }}>
            <div style={{
              padding: "14px 20px", borderBottom: "1px solid rgba(0,212,255,0.1)",
              background: "rgba(0,212,255,0.06)", display: "flex", justifyContent: "space-between",
            }}>
              <span style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 13, color: "#fff" }}>
                Top Players — {tabs.find(t => t.key === period)?.label}
              </span>
              <span style={{ fontFamily: "'Rajdhani',sans-serif", fontSize: 11, color: "#6fb8d4" }}>
                {loading ? "Loading…" : `${rows.length} ranked`}
              </span>
            </div>

            {error && (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "#ff6b6b", fontFamily: "'Rajdhani',sans-serif" }}>
                {error}
              </div>
            )}

            {!error && !loading && rows.length === 0 && (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "#5a7f93", fontFamily: "'Rajdhani',sans-serif" }}>
                No scores yet — be the first to play and earn ArcadeCoins!
              </div>
            )}

            {!error && rows.map((r, idx) => (
              <div key={r.uid} className="ax-row"
                onClick={() => navigate(`/profile?uid=${encodeURIComponent(r.uid)}`)}
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "40px 1fr auto" : "60px 2fr 1fr 1fr",
                  gap: 12, alignItems: "center", padding: "14px 20px",
                  borderBottom: "1px solid rgba(0,212,255,0.08)",
                  cursor: "pointer",
                  animation: `axFadeUp 0.4s cubic-bezier(0.2,1,0.3,1) ${Math.min(idx * 0.03, 0.6)}s both`,
                }}>
                <RankMedal rank={r.rank} />
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <Avatar photoURL={r.photoURL} name={r.displayName} />
                  <div style={{ minWidth: 0, display: "flex", alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{
                      fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 14,
                      color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: isMobile ? 140 : 220,
                    }}>{r.displayName}</span>
                    <ProviderBadge provider={r.provider} />
                  </div>
                </div>
                {!isMobile && (
                  <span style={{ fontFamily: "'Rajdhani',sans-serif", fontSize: 13, color: "#9ee8ff", fontWeight: 600 }}>
                    {r.totalPlays} plays
                  </span>
                )}
                <span style={{
                  fontFamily: "'Orbitron',sans-serif", fontSize: 14, fontWeight: 700,
                  color: "#00d4ff", textAlign: "right", display: "inline-flex",
                  alignItems: "center", gap: 6, justifyContent: "flex-end",
                }}>
                  <Icon name="coin" size={14} color="#00d4ff" /> {fmtScore(r.totalArcadeCoins)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
