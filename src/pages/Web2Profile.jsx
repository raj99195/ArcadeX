// src/pages/Web2Profile.jsx
//
// Shows a Web2 player's public profile (/profile?uid=...) OR the signed-in
// viewer's own profile when no uid is in the URL.
//
// Backend: GET /api/games?action=web2-user-profile&uid=...&history=30
// Guests: shown a friendly notice — guest UUIDs are never written to
// web2Users so there's nothing to display.

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useWeb2Auth } from "../hooks/useWeb2Auth";
import Seo from "../components/Seo";
import { Icon } from "../components/Icon";
import AdBanner from "../components/AdBanner";
import { CountUp, ScrollReveal } from "../components/Motion";

const fmtCoins = (n) => n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + "M"
                      : n >= 1_000     ? (n / 1_000).toFixed(1) + "K"
                      : String(n || 0);

const fmtDate = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return "—"; }
};

const relTime = (iso) => {
  if (!iso) return "—";
  const d = Date.now() - new Date(iso).getTime();
  const s = Math.floor(d / 1000);
  if (s < 60)       return `${s}s ago`;
  if (s < 3600)     return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)    return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800)   return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(iso);
};

function ProviderPill({ provider }) {
  const map = {
    google:  { label: "Google", color: "#4285F4" },
    twitter: { label: "X",      color: "#1DA1F2" },
  };
  const m = map[provider] || { label: provider || "Unknown", color: "#64748b" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", fontSize: 10, fontWeight: 700,
      fontFamily: "'Rajdhani',sans-serif", letterSpacing: "0.5px",
      textTransform: "uppercase", borderRadius: 10,
      background: `${m.color}22`, border: `1px solid ${m.color}66`, color: m.color,
    }}>{m.label}</span>
  );
}

export default function Web2Profile() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user: viewer, isGuest, isAuthenticated } = useWeb2Auth();

  const queryUid = new URLSearchParams(location.search).get("uid");
  const targetUid = queryUid || viewer?.uid;

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    // Guests have no persistent profile — bail before fetching
    if (!targetUid || (isGuest && !queryUid)) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/games?action=web2-user-profile&uid=${encodeURIComponent(targetUid)}&history=30`);
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || "Failed to load profile");
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [targetUid, isGuest, queryUid]);

  // Guest viewing their "own" profile: friendly explainer, not an error.
  if (isGuest && !queryUid) {
    return (
      <GuestNotice onSignIn={() => navigate("/")} />
    );
  }

  // Signed-out viewer with no uid param: nothing to show.
  if (!targetUid) {
    return (
      <EmptyState title="No profile" message="Sign in to see your Web2 profile." />
    );
  }

  if (loading) return <EmptyState title="Loading…" message="" />;
  if (error)   return <EmptyState title="Error" message={error} />;
  if (!data)   return <EmptyState title="Not found" message="This profile doesn't exist yet." />;

  const { profile, history } = data;
  const isSelf = isAuthenticated && viewer?.uid === profile.uid;

  // Profile pages carry a `noindex` because they are per-user and would
  // otherwise bloat the index. The player's own page is where they share
  // their stats — social OG card still renders for shared links.
  return (
    <div style={{ minHeight: "100vh", background: "#07090e", color: "#fff" }}>
      <Seo
        title={`${profile.displayName} — ArcadeCoins Profile`}
        description={`${profile.displayName} has earned ${profile.totalArcadeCoins.toLocaleString()} ArcadeCoins across ${profile.totalPlays} plays on ArcadeX.`}
        path={`/profile?uid=${profile.uid}`}
      />
      <meta name="robots" content="noindex, follow" />
      {/* bg glow */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
        <div style={{
          position: "absolute", top: "6%", left: "50%", transform: "translateX(-50%)",
          width: 700, height: 420,
          background: "radial-gradient(circle, rgba(0,212,255,0.12) 0%, transparent 70%)",
          borderRadius: "50%",
        }} />
      </div>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1000, margin: "0 auto", padding: isMobile ? 16 : 36 }}>
        {/* Hero card */}
        <div className="ax-fade-up ax-shine-border" style={{
          padding: isMobile ? 20 : 28,
          background: "linear-gradient(135deg, rgba(0,212,255,0.14), rgba(0,212,255,0.03))",
          border: "1px solid rgba(0,212,255,0.3)",
          borderRadius: 20, marginBottom: 24,
          display: "flex", flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 16 : 24,
          boxShadow: "0 20px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)",
          position: "relative", overflow: "hidden",
        }}>
          <div
            className="ax-float"
            style={{
              position: "absolute", top: -80, right: -40, width: 240, height: 240,
              background: "radial-gradient(circle, rgba(0,212,255,0.18) 0%, transparent 70%)",
              borderRadius: "50%", pointerEvents: "none",
            }} />
          <div
            className="ax-float-rotate"
            style={{
              position: "absolute", bottom: -60, left: -40, width: 180, height: 180,
              background: "radial-gradient(circle, rgba(123,47,255,0.1) 0%, transparent 70%)",
              borderRadius: "50%", pointerEvents: "none",
            }} />
          {/* Scan line */}
          <div className="ax-scan-line" style={{ top: 0 }} />
          <div className="ax-zoom-in ax-glow-cyan" style={{ borderRadius: "50%" }}>
            <ProfileAvatar photoURL={profile.photoURL} name={profile.displayName} size={isMobile ? 72 : 96} />
          </div>
          <div style={{ flex: 1, minWidth: 0, position: "relative", zIndex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1
                className="ax-slide-left"
                style={{
                  fontFamily: "'Rajdhani',sans-serif", fontSize: isMobile ? 22 : 32,
                  fontWeight: 700, margin: 0, color: "#fff",
                  overflow: "hidden", textOverflow: "ellipsis",
                }}>{profile.displayName}</h1>
              <div className="ax-pop-in" style={{ animationDelay: "0.2s" }}>
                <ProviderPill provider={profile.provider} />
              </div>
              {isSelf && <div className="ax-pop-in" style={{ animationDelay: "0.3s" }}><SelfBadge /></div>}
            </div>
            <div
              className="ax-fade-in"
              style={{
                fontFamily: "'Rajdhani',sans-serif", fontSize: 11,
                color: "rgba(180,220,255,0.65)", marginTop: 4,
                animationDelay: "0.4s",
              }}>
              Joined {fmtDate(profile.createdAt)} · Last played {relTime(profile.lastPlayed)}
            </div>
          </div>

          {/* Rank chip */}
          <div className="ax-slide-right" style={{ textAlign: isMobile ? "left" : "right", position: "relative", zIndex: 1 }}>
            <div style={{ fontFamily: "'Rajdhani',sans-serif", fontSize: 10, color: "#6fb8d4", letterSpacing: "1.5px", textTransform: "uppercase" }}>Global Rank</div>
            <div
              style={{
                fontFamily: "'Orbitron',sans-serif",
                fontSize: isMobile ? 24 : 32, fontWeight: 800,
                color: profile.rank ? "#00d4ff" : "#64748b",
                animation: profile.rank && profile.rank <= 10 ? "axHeartbeat 2.4s ease-in-out infinite" : undefined,
                textShadow: profile.rank && profile.rank <= 3 ? "0 0 20px rgba(0,212,255,0.6)" : "none",
              }}>
              {profile.rank ? `#${profile.rank}` : "500+"}
            </div>
          </div>
        </div>

        {/* Stat tiles — numbers count up on scroll into view */}
        <div className="ax-stagger" style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, 1fr)",
          gap: isMobile ? 12 : 16, marginBottom: 28,
        }}>
          <StatTile
            label="ArcadeCoins"
            value={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Icon name="coin" size={14} />
                <CountUp to={profile.totalArcadeCoins} duration={1600} />
              </span>
            }
            accent="#00d4ff"
          />
          <StatTile label="Games Played" value={<CountUp to={profile.totalPlays} duration={1200} />} accent="#9ee8ff" />
          <StatTile label="Avg / Play" value={<CountUp to={profile.totalPlays ? Math.round(profile.totalArcadeCoins / profile.totalPlays) : 0} duration={1200} />} accent="#6fb8d4" />
        </div>

        {/* Ad banner — between stats and play history */}
        <AdBanner slot="" layout="leaderboard" style={{ marginBottom: 20 }} />

        {/* History */}
        <div style={{
          border: "1px solid rgba(0,212,255,0.18)", borderRadius: 14,
          background: "rgba(6,12,18,0.82)", overflow: "hidden",
        }}>
          <div style={{
            padding: "14px 20px", borderBottom: "1px solid rgba(0,212,255,0.1)",
            background: "rgba(0,212,255,0.06)",
            fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 13, color: "#fff",
          }}>Recent Plays ({history.length})</div>

          {history.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "#5a7f93", fontFamily: "'Rajdhani',sans-serif" }}>
              No plays yet.
            </div>
          )}

          {history.map((h, i) => (
            <div key={h.id} className="ax-row" style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr auto" : "2fr 1fr 1fr auto",
              gap: 10, alignItems: "center", padding: "12px 20px",
              borderBottom: "1px solid rgba(0,212,255,0.08)",
              animation: `axFadeUp 0.4s cubic-bezier(0.2,1,0.3,1) ${Math.min(i * 0.025, 0.4)}s both`,
            }}>
              <button
                onClick={() => navigate(`/play/${h.gameId}`)}
                style={{
                  background: "transparent", border: "none", padding: 0,
                  textAlign: "left", color: "#9ee8ff", cursor: "pointer",
                  fontFamily: "'Rajdhani',sans-serif", fontWeight: 600, fontSize: 13,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                {h.gameName || `Game #${h.gameId}`}
              </button>
              {!isMobile && (
                <span style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 12, color: "#cde6f3" }}>
                  Score {h.score.toLocaleString()}
                </span>
              )}
              <span style={{
                fontFamily: "'Orbitron',sans-serif", fontSize: 12, fontWeight: 700,
                color: h.coinsEarned > 0 ? "#00d4ff" : "#64748b",
                display: "inline-flex", alignItems: "center", gap: 4,
              }}>
                <Icon name="coin" size={12} /> {h.coinsEarned}{h.cappedToday ? "*" : ""}
              </span>
              <span style={{ fontFamily: "'Rajdhani',sans-serif", fontSize: 11, color: "#5a7f93", textAlign: "right" }}>
                {relTime(h.createdAt)}
              </span>
            </div>
          ))}

          {history.some(h => h.cappedToday) && (
            <div style={{ padding: "10px 20px", fontSize: 10, color: "#64748b", fontFamily: "'Rajdhani',sans-serif" }}>
              * Daily 500-coin cap hit — fewer coins awarded for that play.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Subcomponents
// ────────────────────────────────────────────────────────────────────

function ProfileAvatar({ photoURL, name, size }) {
  const initials = (name || "P").slice(0, 2).toUpperCase();
  if (photoURL) {
    return (
      <img src={photoURL} alt={name || "player"} referrerPolicy="no-referrer"
        onError={(e) => { e.currentTarget.style.display = "none"; }}
        style={{
          width: size, height: size, borderRadius: "50%", objectFit: "cover",
          border: "3px solid rgba(0,212,255,0.45)", flexShrink: 0,
        }} />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: "linear-gradient(135deg,#00d4ff,#1a7bbd)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.3, fontWeight: 800, color: "#fff",
      fontFamily: "'Orbitron',sans-serif", flexShrink: 0,
      border: "3px solid rgba(0,212,255,0.45)",
    }}>{initials}</div>
  );
}

function StatTile({ label, value, accent }) {
  return (
    <div className="ax-lift ax-tilt-hover" style={{
      padding: 18, borderRadius: 14,
      background: "linear-gradient(165deg, rgba(10,22,32,0.9), rgba(6,14,22,0.95))",
      border: `1px solid ${accent}33`,
      boxShadow: `0 10px 30px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)`,
      position: "relative", overflow: "hidden",
    }}>
      <div
        className="ax-float"
        style={{
          position: "absolute", top: -30, right: -30, width: 120, height: 120,
          background: `radial-gradient(circle, ${accent}22 0%, transparent 70%)`,
          borderRadius: "50%", pointerEvents: "none",
        }} />
      {/* Animated accent line at the top */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
        backgroundSize: "200% 100%",
        animation: "axSheenMove 3s linear infinite",
      }} />
      <div style={{ fontFamily: "'Rajdhani',sans-serif", fontSize: 10, color: "#6fb8d4", letterSpacing: "1.5px", textTransform: "uppercase", position: "relative" }}>{label}</div>
      <div style={{
        fontFamily: "'Orbitron',sans-serif", fontSize: 24, fontWeight: 800,
        color: accent, marginTop: 6, position: "relative",
        transition: "text-shadow 0.3s, transform 0.3s",
      }}>
        {value}
      </div>
    </div>
  );
}

function SelfBadge() {
  return (
    <span
      className="ax-glow-green"
      style={{
        padding: "3px 10px", borderRadius: 10,
        background: "rgba(0,255,136,0.15)", border: "1px solid rgba(0,255,136,0.4)",
        color: "#00ff88", fontSize: 10, fontWeight: 700,
        fontFamily: "'Rajdhani',sans-serif", letterSpacing: "0.5px", textTransform: "uppercase",
        display: "inline-block",
      }}>You</span>
  );
}

function GuestNotice({ onSignIn }) {
  return (
    <div style={{ minHeight: "80vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div
        className="ax-pop-in ax-shine-border"
        style={{
          maxWidth: 480, padding: 28, borderRadius: 16, textAlign: "center",
          background: "linear-gradient(135deg, rgba(0,212,255,0.1), rgba(0,212,255,0.02))",
          border: "1px solid rgba(0,212,255,0.25)",
          position: "relative", overflow: "hidden",
        }}>
        <div className="ax-float" style={{ marginBottom: 12, color: "#9ee8ff", display: "flex", justifyContent: "center" }}>
          <Icon name="user" size={48} />
        </div>
        <h2 className="ax-fade-up" style={{ fontFamily: "'Rajdhani',sans-serif", color: "#fff", margin: 0, animationDelay: "0.1s" }}>Playing as Guest</h2>
        <p className="ax-fade-up" style={{ color: "rgba(180,220,255,0.75)", fontFamily: "'Rajdhani',sans-serif", fontSize: 14, marginTop: 10, animationDelay: "0.2s" }}>
          Guest sessions don't save progress. Sign in with Google or X to start earning ArcadeCoins and build your profile.
        </p>
        <button
          onClick={onSignIn}
          className="ax-fade-up ax-beam-host"
          style={{
            marginTop: 18, padding: "10px 22px",
            background: "linear-gradient(135deg,#00d4ff,#1a7bbd)",
            backgroundSize: "200% 200%", border: "none",
            borderRadius: 10, color: "#fff", fontWeight: 700, cursor: "pointer",
            fontFamily: "'Rajdhani',sans-serif", letterSpacing: "0.5px",
            animationDelay: "0.3s",
            transition: "transform 0.2s, box-shadow 0.2s, background-position 0.4s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-2px) scale(1.03)";
            e.currentTarget.style.boxShadow = "0 10px 25px rgba(0,212,255,0.4)";
            e.currentTarget.style.backgroundPosition = "100% 50%";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0) scale(1)";
            e.currentTarget.style.boxShadow = "none";
            e.currentTarget.style.backgroundPosition = "0% 50%";
          }}
        >Sign In</button>
      </div>
    </div>
  );
}

function EmptyState({ title, message }) {
  return (
    <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", padding: 24 }}>
      <div style={{ textAlign: "center" }}>
        <h2 style={{ fontFamily: "'Rajdhani',sans-serif", margin: 0 }}>{title}</h2>
        {message && <p style={{ color: "rgba(180,220,255,0.7)", fontFamily: "'Rajdhani',sans-serif" }}>{message}</p>}
      </div>
    </div>
  );
}
