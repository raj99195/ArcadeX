// src/pages/Web2Tournaments.jsx
//
// Full Web2 tournament arena — mirrors Web3 Tournaments.jsx: card grid,
// status chips, countdown timers, prize-pool counters, player progress,
// join flow, leaderboard podium. Everything off-chain via /api/games
// web2-tournament-* endpoints. ArcadeCoins act as the entry/prize token.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWeb2Auth } from "../hooks/useWeb2Auth";
import { useArcadeCoins } from "../hooks/useArcadeCoins";
import { Icon, MedalBadge } from "../components/Icon";

const C = {
  cyan: "#00d4ff", cyanL: "#9ee8ff", cyanD: "#0088ff",
  gold: "#FFD56A", green: "#00FF88", red: "#ff6b7f",
  dim: "#6fb8d4", dimMore: "#5a7f93",
  raj: "'Rajdhani',sans-serif", orb: "'Orbitron',sans-serif",
};

const STATUS = {
  Upcoming:  { color: "#00d4ff", bg: "rgba(0,212,255,0.08)",  border: "rgba(0,212,255,0.25)" },
  Active:    { color: "#00FF88", bg: "rgba(0,255,136,0.08)",  border: "rgba(0,255,136,0.3)" },
  Ended:     { color: "#9ee8ff", bg: "rgba(0,212,255,0.05)",  border: "rgba(0,212,255,0.15)" },
  Cancelled: { color: "#ff4444", bg: "rgba(255,68,68,0.08)",  border: "rgba(255,68,68,0.3)" },
};

function getRealStatus(t) {
  const now = Date.now();
  if (t.status === "cancelled") return "Cancelled";
  if (t.prizesDistributed || t.status === "ended") return "Ended";
  if (now >= Number(t.startTime) && now <= Number(t.endTime)) return "Active";
  if (now > Number(t.endTime)) return "Ended";
  return "Upcoming";
}

async function apiAuth(user, path, opts = {}) {
  if (!user?.firebaseUser) throw new Error("Sign in to continue.");
  const idToken = await user.firebaseUser.getIdToken();
  const r = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      ...(opts.headers || {}),
    },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

// ── Countdown ───────────────────────────────────────────────────────
function useCountdown(targetMs) {
  const [left, setLeft] = useState(targetMs - Date.now());
  useEffect(() => {
    const t = setInterval(() => setLeft(targetMs - Date.now()), 1000);
    return () => clearInterval(t);
  }, [targetMs]);
  return Math.max(0, left);
}

function CountdownTimer({ startTime, endTime }) {
  const now = Date.now();
  const target = now < startTime ? startTime : endTime;
  const label  = now < startTime ? "Starts in" : "Ends in";
  const left   = useCountdown(target);
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  const str = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  const urgent = left < 3_600_000;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 4 }}>{label}</div>
      <div style={{
        fontFamily: C.orb, fontWeight: 700, fontSize: 18,
        color: urgent ? "#ff4444" : C.cyan,
        animation: urgent ? "urgentPulse 1s ease-in-out infinite" : "none",
        letterSpacing: "2px",
      }}>{str}</div>
    </div>
  );
}

// ── Prize pool counter ──────────────────────────────────────────────
function PrizePoolCounter({ prizePool }) {
  const [n, setN] = useState(0);
  const target = Number(prizePool || 0);
  useEffect(() => {
    let v = 0;
    const step = target / 30;
    const t = setInterval(() => {
      v += step;
      if (v >= target) { setN(target); clearInterval(t); }
      else setN(v);
    }, 30);
    return () => clearInterval(t);
  }, [target]);
  return <span>{Math.round(n).toLocaleString()}</span>;
}

// ── Leaderboard panel ───────────────────────────────────────────────
function LeaderboardPanel({ tournament, onClose, onPlay, prizes }) {
  const sorted = (tournament.players || []).slice()
    .sort((a, b) => Number(b.bestScore || 0) - Number(a.bestScore || 0));
  const podiumColors = ["#FFB700", "#C0C0C0", "#CD7F32"];
  const podiumBg     = ["rgba(255,183,0,0.1)", "rgba(192,192,192,0.08)", "rgba(205,127,50,0.08)"];

  const avatarFor = (p) => p.photoURL || `https://api.dicebear.com/9.x/bottts/svg?seed=${p.uid}`;
  const shortName = (n) => (n && n.length > 18) ? n.slice(0, 16) + "…" : (n || "Player");

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 1001, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", padding: 20 }}>
        <div style={{
          width: "min(860px, 100%)", maxHeight: "85vh",
          background: "#07090e",
          border: "1px solid rgba(0,212,255,0.3)", borderRadius: 16,
          display: "flex", flexDirection: "column",
          boxShadow: "0 24px 80px rgba(0,0,0,0.9), 0 0 60px rgba(0,212,255,0.15)",
          pointerEvents: "all",
          animation: "modalIn 0.3s cubic-bezier(0.4,0,0.2,1) forwards",
        }}>
          <div style={{ height: 3, background: `linear-gradient(90deg, ${C.cyan}, #FFB700, ${C.cyanD})`, flexShrink: 0 }} />
          <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid rgba(0,212,255,0.15)", background: "rgba(0,212,255,0.04)", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Icon name="trophy" size={24} color="#FFB700" />
                <div>
                  <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 18, color: "#fff", textTransform: "uppercase" }}>Leaderboard</div>
                  <div style={{ fontSize: 11, color: C.dim, fontFamily: C.raj }}>{tournament.gameName}</div>
                </div>
              </div>
              <button onClick={onClose} style={{ background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.3)", borderRadius: 7, color: C.red, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontFamily: C.raj, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon name="x" size={12} /> Close
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={{ padding: "3px 10px", background: "rgba(255,183,0,0.08)", border: "1px solid rgba(255,183,0,0.3)", borderRadius: 20, fontSize: 10, color: "#FFB700", fontFamily: C.raj, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Icon name="coin" size={12} /> {Number(tournament.prizePool || 0).toLocaleString()}
              </span>
              <span style={{ padding: "3px 10px", background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.3)", borderRadius: 20, fontSize: 10, color: C.cyan, fontFamily: C.raj, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Icon name="users" size={12} /> {sorted.length} Players
              </span>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
            {sorted.length === 0 ? (
              <div style={{ padding: 48, textAlign: "center" }}>
                <div style={{ marginBottom: 10, display: "flex", justifyContent: "center", color: C.dim }}>
                  <Icon name="controller" size={44} />
                </div>
                <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 16, color: C.cyanL }}>No scores yet</div>
                <div style={{ fontFamily: C.raj, fontSize: 12, color: C.dimMore, marginTop: 4 }}>Be the first to post a score!</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 12 }}>Top Players</div>
                <div style={{ display: "grid", gridTemplateColumns: sorted.length >= 3 ? "1fr 1.1fr 1fr" : sorted.length === 2 ? "1fr 1fr" : "1fr", gap: 8, alignItems: "flex-end", marginBottom: 20 }}>
                  {sorted.length >= 2 && (
                    <div style={{ background: podiumBg[1], border: `1px solid ${podiumColors[1]}50`, borderRadius: 12, padding: "14px 10px", textAlign: "center", order: 0 }}>
                      <div style={{ marginBottom: 6, display: "flex", justifyContent: "center" }}><MedalBadge rank={2} size={22} /></div>
                      <img src={avatarFor(sorted[1])} alt="" style={{ width: 38, height: 38, borderRadius: "50%", border: `2px solid ${podiumColors[1]}`, margin: "0 auto 6px" }} />
                      <div style={{ fontFamily: C.raj, fontSize: 10, color: podiumColors[1], marginBottom: 3, fontWeight: 700 }}>{shortName(sorted[1].displayName)}</div>
                      <div style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 16, color: podiumColors[1] }}>{Number(sorted[1].bestScore || 0).toLocaleString()}</div>
                      {prizes[1] > 0 && <div style={{ fontSize: 10, color: "#FFB700", fontFamily: C.raj, fontWeight: 700, marginTop: 3, display: "inline-flex", alignItems: "center", gap: 3 }}>+{prizes[1].toLocaleString()} <Icon name="coin" size={10} /></div>}
                    </div>
                  )}
                  <div style={{ background: podiumBg[0], border: `2px solid ${podiumColors[0]}80`, borderRadius: 12, padding: "18px 10px", textAlign: "center", order: sorted.length >= 2 ? 1 : 0, boxShadow: "0 0 24px rgba(255,183,0,0.2)" }}>
                    <div style={{ marginBottom: 6, display: "flex", justifyContent: "center" }}><MedalBadge rank={1} size={26} /></div>
                    <img src={avatarFor(sorted[0])} alt="" style={{ width: 46, height: 46, borderRadius: "50%", border: `3px solid ${podiumColors[0]}`, margin: "0 auto 6px", boxShadow: "0 0 16px rgba(255,183,0,0.4)" }} />
                    <div style={{ fontFamily: C.raj, fontSize: 11, color: podiumColors[0], marginBottom: 3, fontWeight: 700 }}>{shortName(sorted[0].displayName)}</div>
                    <div style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 20, color: podiumColors[0] }}>{Number(sorted[0].bestScore || 0).toLocaleString()}</div>
                    {prizes[0] > 0 && <div style={{ fontSize: 11, color: "#FFB700", fontFamily: C.raj, fontWeight: 700, marginTop: 3, display: "inline-flex", alignItems: "center", gap: 3 }}>+{prizes[0].toLocaleString()} <Icon name="coin" size={11} /></div>}
                  </div>
                  {sorted.length >= 3 && (
                    <div style={{ background: podiumBg[2], border: `1px solid ${podiumColors[2]}50`, borderRadius: 12, padding: "14px 10px", textAlign: "center", order: 2 }}>
                      <div style={{ marginBottom: 6, display: "flex", justifyContent: "center" }}><MedalBadge rank={3} size={22} /></div>
                      <img src={avatarFor(sorted[2])} alt="" style={{ width: 38, height: 38, borderRadius: "50%", border: `2px solid ${podiumColors[2]}`, margin: "0 auto 6px" }} />
                      <div style={{ fontFamily: C.raj, fontSize: 10, color: podiumColors[2], marginBottom: 3, fontWeight: 700 }}>{shortName(sorted[2].displayName)}</div>
                      <div style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 16, color: podiumColors[2] }}>{Number(sorted[2].bestScore || 0).toLocaleString()}</div>
                      {prizes[2] > 0 && <div style={{ fontSize: 10, color: "#FFB700", fontFamily: C.raj, fontWeight: 700, marginTop: 3, display: "inline-flex", alignItems: "center", gap: 3 }}>+{prizes[2].toLocaleString()} <Icon name="coin" size={10} /></div>}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 8 }}>All Players</div>
                {sorted.map((p, i) => (
                  <div key={p.uid} style={{
                    display: "grid", gridTemplateColumns: "32px 1fr auto",
                    alignItems: "center", gap: 12,
                    padding: "10px 12px",
                    background: i < 3 ? podiumBg[i] : "rgba(0,212,255,0.03)",
                    borderRadius: 9,
                    border: `1px solid ${i < 3 ? podiumColors[i] + "40" : "rgba(0,212,255,0.1)"}`,
                    marginBottom: 5,
                  }}>
                    <div style={{ fontFamily: C.orb, fontSize: 12, color: i < 3 ? podiumColors[i] : C.dimMore, fontWeight: 700, textAlign: "center", display: "flex", justifyContent: "center" }}>
                      {i < 3 ? <MedalBadge rank={i + 1} size={18} /> : `#${i + 1}`}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <img src={avatarFor(p)} alt="" style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0 }} />
                      <div style={{ fontFamily: C.raj, fontSize: 12, color: i < 3 ? podiumColors[i] : C.cyanL, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 700 }}>
                        {p.displayName}
                      </div>
                    </div>
                    <div style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 14, color: i < 3 ? podiumColors[i] : C.cyan }}>
                      {Number(p.bestScore || 0).toLocaleString()}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
          <div style={{ padding: "12px 20px", borderTop: "1px solid rgba(0,212,255,0.15)", background: "rgba(0,212,255,0.03)", flexShrink: 0, borderRadius: "0 0 16px 16px" }}>
            {getRealStatus(tournament) === "Active" ? (
              <button onClick={onPlay} style={{
                width: "100%", padding: 12,
                background: `linear-gradient(135deg, ${C.cyan}, ${C.cyanD})`,
                border: "none", borderRadius: 9, color: "#001018",
                fontFamily: C.raj, fontWeight: 800, fontSize: 13,
                letterSpacing: "1.5px", textTransform: "uppercase", cursor: "pointer",
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}><Icon name="controller" size={16} /> Play Now & Submit Score</button>
            ) : (
              <div style={{ padding: 12, background: "rgba(0,212,255,0.05)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 9, textAlign: "center", fontSize: 12, color: C.dim, fontFamily: C.raj, fontWeight: 700, letterSpacing: "1px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", boxSizing: "border-box" }}>
                <Icon name="check" size={14} /> {getRealStatus(tournament) === "Ended" ? "Tournament Ended — Final Results" : "Not yet live"}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Tournament card ────────────────────────────────────────────────
function TournamentCard({ tournament, user, balance, onJoin, onEnd, onCancel, isAdmin, joining, navigate }) {
  const [showLb, setShowLb] = useState(false);
  const [hovered, setHovered] = useState(false);
  const status = getRealStatus(tournament);
  const sc = STATUS[status];
  const players = tournament.players || [];
  const count   = players.length;
  const cap     = Number(tournament.maxPlayers || 10);
  const fillPct = cap ? (count / cap) * 100 : 0;
  const fee     = Number(tournament.entryFee || 0);
  const isJoined   = user && players.some(p => p.uid === user.uid);
  const isFull     = count >= cap;
  const canEnd     = isAdmin && status === "Active" && Number(tournament.endTime) < Date.now() && !tournament.prizesDistributed;
  const canEndAny  = isAdmin && status === "Ended" && !tournament.prizesDistributed;
  const enoughBal  = Number(balance || 0) >= fee;

  const prizes = [0.6, 0.25, 0.15].map(p => Math.floor(Number(tournament.prizePool || 0) * p));

  return (
    <>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: hovered ? "rgba(10,18,28,0.95)" : "rgba(6,12,18,0.9)",
          border: `1px solid ${hovered ? sc.border : "rgba(0,212,255,0.15)"}`,
          borderRadius: 16, overflow: "hidden",
          transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
          transform: hovered ? "translateY(-4px) scale(1.01)" : "translateY(0) scale(1)",
          boxShadow: hovered ? `0 20px 40px rgba(0,0,0,0.5), 0 0 30px ${sc.color}20` : "0 4px 12px rgba(0,0,0,0.3)",
          position: "relative",
        }}
      >
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${sc.color}, transparent)`, opacity: hovered ? 1 : 0.4, transition: "opacity 0.3s" }} />
        {/* Thumbnail */}
        <div style={{ position: "relative", height: 150, background: "#060510", overflow: "hidden" }}>
          {tournament.gameThumbnail ? (
            <img src={tournament.gameThumbnail} alt={tournament.gameName}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }}
              onError={e => { e.target.style.display = "none"; }} />
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,183,0,0.5)" }}>
              <Icon name="trophy" size={44} />
            </div>
          )}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(6,12,18,0.95) 0%, transparent 60%)" }} />
          <div style={{ position: "absolute", top: 10, left: 10, padding: "4px 10px", borderRadius: 20, fontSize: 9, fontWeight: 700, background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`, fontFamily: C.raj, letterSpacing: "1.5px", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 4 }}>
            {status === "Active" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00FF88", animation: "livePulse 1s ease-in-out infinite" }} />}
            {status.toUpperCase()}
          </div>
          <div style={{ position: "absolute", top: 10, right: 10, padding: "4px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: "rgba(255,183,0,0.15)", color: "#FFB700", border: "1px solid rgba(255,183,0,0.35)", fontFamily: C.orb, backdropFilter: "blur(8px)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="trophy" size={11} /> <PrizePoolCounter prizePool={tournament.prizePool} /> <Icon name="coin" size={11} />
          </div>
        </div>
        {/* Body */}
        <div style={{ padding: "14px 16px" }}>
          <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 16, color: "#fff", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tournament.gameName}</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
            <div style={{ fontSize: 10, color: C.dimMore, fontFamily: C.raj }}>Entry:</div>
            <div style={{ fontSize: 10, color: C.cyanL, fontFamily: C.orb, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
              {fee === 0 ? "FREE" : <>{fee} <Icon name="coin" size={10} /></>}
            </div>
          </div>
          {/* Players bar */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px" }}>Players</div>
              <div style={{ fontSize: 10, color: C.cyanL, fontFamily: C.orb, fontWeight: 700 }}>{count}/{cap}</div>
            </div>
            <div style={{ height: 4, background: "rgba(0,212,255,0.1)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${fillPct}%`,
                background: fillPct >= 80 ? "linear-gradient(90deg,#ff4444,#ff7700)" : `linear-gradient(90deg, ${C.cyan}, #00FF88)`,
                borderRadius: 2, transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)",
              }} />
            </div>
            <div style={{ display: "flex", gap: 3, marginTop: 6, flexWrap: "wrap" }}>
              {Array.from({ length: Math.min(cap, 10) }).map((_, i) => (
                <div key={i} style={{
                  width: 14, height: 14, borderRadius: "50%",
                  background: i < count ? (i < 3 ? sc.color : "rgba(0,212,255,0.5)") : "rgba(0,212,255,0.1)",
                  border: `1px solid ${i < count ? sc.border : "rgba(0,212,255,0.1)"}`,
                  transition: "all 0.3s", transitionDelay: `${i * 0.05}s`,
                }} />
              ))}
              {cap > 10 && <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj, alignSelf: "center" }}>+{cap - 10}</div>}
            </div>
          </div>
          {/* Countdown */}
          <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, border: "1px solid rgba(0,212,255,0.1)" }}>
            <CountdownTimer startTime={Number(tournament.startTime)} endTime={Number(tournament.endTime)} />
          </div>
          {/* CTA */}
          {!isJoined && !isFull && status === "Active" && user && !user.isGuest && !enoughBal && fee > 0 && (
            <div style={{ padding: "8px 12px", background: "rgba(255,68,68,0.06)", border: "1px solid rgba(255,68,68,0.2)", borderRadius: 8, fontSize: 11, color: C.red, fontFamily: C.raj, fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Icon name="warning" size={12} /> Need {fee} <Icon name="coin" size={11} /> — play games to earn
            </div>
          )}
          {(status === "Upcoming" || status === "Active") && !tournament.prizesDistributed && (
            isJoined ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <div style={{ padding: 10, background: "rgba(0,255,136,0.06)", border: "1px solid rgba(0,255,136,0.2)", borderRadius: 8, color: C.green, fontSize: 11, fontFamily: C.raj, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Icon name="check" size={13} /> JOINED</div>
                {status === "Active" && (
                  <button onClick={() => navigate(`/play/${tournament.gameId}`)} style={{
                    width: "100%", padding: 10,
                    background: `linear-gradient(135deg, ${C.cyan}, ${C.cyanD})`,
                    border: "none", borderRadius: 8, color: "#001018",
                    fontSize: 12, fontWeight: 800, cursor: "pointer",
                    fontFamily: C.raj, letterSpacing: "1px", textTransform: "uppercase",
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
                  }}><Icon name="controller" size={14} /> Play Now</button>
                )}
              </div>
            ) : isFull ? (
              <div style={{ padding: 10, background: "rgba(255,68,68,0.06)", border: "1px solid rgba(255,68,68,0.2)", borderRadius: 8, color: "#ff4444", fontSize: 11, fontFamily: C.raj, fontWeight: 700, textAlign: "center" }}>FULL</div>
            ) : !user || user.isGuest ? (
              <div style={{ padding: 10, background: "rgba(0,212,255,0.04)", border: "1px dashed rgba(0,212,255,0.25)", borderRadius: 8, color: C.dim, fontSize: 11, fontFamily: C.raj, fontWeight: 700, textAlign: "center" }}>
                Sign in to join
              </div>
            ) : (
              <button onClick={() => onJoin(tournament)}
                disabled={joining || (fee > 0 && !enoughBal)}
                style={{
                  width: "100%", padding: 11,
                  background: joining || (fee > 0 && !enoughBal) ? "rgba(0,212,255,0.15)" : `linear-gradient(135deg, ${C.cyan}, ${C.cyanD})`,
                  border: "none", borderRadius: 8,
                  color: joining || (fee > 0 && !enoughBal) ? C.dimMore : "#001018",
                  fontSize: 12, fontWeight: 800,
                  cursor: joining || (fee > 0 && !enoughBal) ? "not-allowed" : "pointer",
                  fontFamily: C.raj, letterSpacing: "1.5px", textTransform: "uppercase",
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}>
                {joining ? "Joining…" : fee === 0 ? "JOIN — FREE" : <>JOIN — {fee} <Icon name="coin" size={12} /></>}
              </button>
            )
          )}
          {(canEnd || canEndAny) && (
            <button onClick={() => onEnd(tournament)} style={{
              width: "100%", padding: 10, marginTop: 8,
              background: "rgba(255,183,0,0.08)", border: "1px solid rgba(255,183,0,0.3)",
              borderRadius: 8, color: "#FFB700",
              fontSize: 11, cursor: "pointer",
              fontFamily: C.raj, fontWeight: 700, letterSpacing: "1px",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}><Icon name="trophy" size={13} /> END & DISTRIBUTE PRIZES</button>
          )}
          {isAdmin && !tournament.prizesDistributed && status !== "Cancelled" && (
            <button onClick={() => onCancel(tournament)} style={{
              width: "100%", padding: 8, marginTop: 6,
              background: "rgba(255,68,68,0.06)", border: "1px solid rgba(255,68,68,0.2)",
              borderRadius: 8, color: C.red,
              fontSize: 10, cursor: "pointer",
              fontFamily: C.raj, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}><Icon name="ban" size={12} /> Cancel & Refund</button>
          )}
          {count > 0 && (status === "Active" || status === "Ended") && (
            <button onClick={() => setShowLb(true)} style={{
              width: "100%", padding: 8, marginTop: 7,
              background: "rgba(0,212,255,0.06)", border: "1px solid rgba(0,212,255,0.25)",
              borderRadius: 8, color: C.cyan,
              fontSize: 11, cursor: "pointer",
              fontFamily: C.raj, fontWeight: 700,
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}><Icon name="chart" size={13} /> View Leaderboard</button>
          )}
        </div>
      </div>
      {showLb && (
        <LeaderboardPanel tournament={tournament} prizes={prizes}
          onClose={() => setShowLb(false)}
          onPlay={() => { setShowLb(false); navigate(`/play/${tournament.gameId}`); }} />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
export default function Web2Tournaments() {
  const navigate = useNavigate();
  const { user } = useWeb2Auth();
  const { balance, refetch: refetchCoins } = useArcadeCoins();
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 820);
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all");
  const [joiningId, setJoiningId] = useState(null);
  // msg: null | { type: "ok" | "err", text: string }
  const [msg, setMsg] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const onR = () => setIsMobile(window.innerWidth < 820);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/games?action=web2-tournaments");
      const d = await r.json();
      setTournaments(d.tournaments || []);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);

  // Fetch admin flag — reuse creator-status; cheap
  useEffect(() => {
    if (!user || user.isGuest) { setIsAdmin(false); return; }
    (async () => {
      try {
        const d = await apiAuth(user, "/api/games?action=web2-creator-status");
        setIsAdmin(!!d.isAdmin);
      } catch { setIsAdmin(false); }
    })();
  }, [user]);

  const handleJoin = async (t) => {
    if (!user || user.isGuest) { setMsg({ type: "err", text: "Sign in to join tournaments." }); return; }
    setJoiningId(t.id); setMsg(null);
    try {
      await apiAuth(user, "/api/games?action=web2-tournament-join", {
        method: "POST", body: JSON.stringify({ tournamentId: t.id }),
      });
      setMsg({ type: "ok", text: `Joined "${t.gameName}"!` });
      await Promise.all([load(), refetchCoins()]);
    } catch (e) { setMsg({ type: "err", text: e.message || "Join failed." }); }
    finally { setJoiningId(null); }
  };
  const handleEnd = async (t) => {
    if (!confirm(`End "${t.gameName}" and distribute prizes?`)) return;
    try {
      await apiAuth(user, "/api/games?action=web2-tournament-end", {
        method: "POST", body: JSON.stringify({ tournamentId: t.id }),
      });
      setMsg({ type: "ok", text: "Prizes distributed!" });
      await load();
    } catch (e) { setMsg({ type: "err", text: e.message }); }
  };
  const handleCancel = async (t) => {
    if (!confirm(`Cancel "${t.gameName}" and refund all players?`)) return;
    try {
      await apiAuth(user, "/api/games?action=web2-tournament-cancel", {
        method: "POST", body: JSON.stringify({ tournamentId: t.id }),
      });
      setMsg({ type: "ok", text: "Tournament cancelled." });
      await load();
    } catch (e) { setMsg({ type: "err", text: e.message }); }
  };

  const filtered = tournaments.filter(t => {
    const s = getRealStatus(t);
    if (tab === "active")   return s === "Active";
    if (tab === "upcoming") return s === "Upcoming";
    if (tab === "ended")    return s === "Ended" || s === "Cancelled";
    return true;
  });
  const activeCnt   = tournaments.filter(t => getRealStatus(t) === "Active").length;
  const upcomingCnt = tournaments.filter(t => getRealStatus(t) === "Upcoming").length;
  const endedCnt    = tournaments.filter(t => ["Ended", "Cancelled"].includes(getRealStatus(t))).length;

  return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: "#07090e", position: "relative", overflow: "hidden" }}>
      <style>{`
        @keyframes livePulse  { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(1.3)} }
        @keyframes urgentPulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes w2tFloat    { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-14px)} }
        @keyframes w2tFadeUp   { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes w2tGrad     { to { background-position: 300% center; } }
        @keyframes modalIn     { from{opacity:0;transform:scale(0.95)} to{opacity:1;transform:scale(1)} }
        .w2t-title {
          background: linear-gradient(90deg,#00d4ff,#6fb8ff,#00d4ff);
          background-size: 300% auto;
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: w2tGrad 6s linear infinite;
        }
        .tab-btn:hover { color: #9ee8ff !important; }
      `}</style>

      {/* Backdrop */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
        <div style={{
          position: "absolute", inset: 0, opacity: 0.5,
          backgroundImage: "linear-gradient(rgba(0,212,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.045) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }} />
        <div style={{
          position: "absolute", top: "8%", left: "50%", transform: "translateX(-50%)",
          width: 700, height: 420,
          background: "radial-gradient(ellipse, rgba(0,212,255,0.12) 0%, transparent 70%)",
          animation: "w2tFloat 10s ease-in-out infinite",
        }} />
      </div>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1200, margin: "0 auto", padding: isMobile ? "20px 14px 40px" : "32px 36px 48px" }}>
        {/* Header */}
        <div style={{ marginBottom: 24, animation: "w2tFadeUp 0.5s ease both" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
            <div
              className="ax-float ax-heartbeat-hover"
              style={{
                color: "#FFB700", display: "flex",
                filter: "drop-shadow(0 0 12px rgba(255,183,0,0.5))",
              }}>
              <Icon name="trophy" size={40} />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "3px 11px", border: "1px solid rgba(255,183,0,0.3)",
                borderRadius: 4, fontSize: 9, color: "#FFB700",
                letterSpacing: "1.5px", textTransform: "uppercase",
                marginBottom: 8, background: "rgba(255,183,0,0.08)",
                fontFamily: C.raj, fontWeight: 600,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#FFB700", animation: "livePulse 1.5s ease-in-out infinite" }} />
                Compete · Earn · Dominate
              </div>
              <h1 style={{
                fontFamily: C.raj, fontWeight: 700,
                fontSize: isMobile ? 30 : 46, letterSpacing: "-0.5px",
                textTransform: "uppercase", lineHeight: 1, color: "#fff", margin: 0,
              }}>
                Tournament<br />
                <span className="w2t-title">ARENA</span>
              </h1>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {[
              { label: "Active",   value: activeCnt,   color: "#00FF88", icon: "bolt" },
              { label: "Upcoming", value: upcomingCnt, color: C.cyan,    icon: "clock" },
              { label: "Total",    value: tournaments.length, color: C.cyanL, icon: "controller" },
            ].map(s => (
              <div key={s.label} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 16px",
                background: "rgba(0,0,0,0.4)", border: `1px solid ${s.color}30`,
                borderRadius: 20, backdropFilter: "blur(8px)",
              }}>
                <Icon name={s.icon} size={13} color={s.color} />
                <span style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 14, color: s.color }}>{s.value}</span>
                <span style={{ fontSize: 10, color: C.dimMore, fontFamily: C.raj }}>{s.label}</span>
              </div>
            ))}
            {user && !user.isGuest && (
              <div style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 16px",
                background: "rgba(255,183,0,0.08)", border: "1px solid rgba(255,183,0,0.3)",
                borderRadius: 20,
              }}>
                <Icon name="coin" size={14} color="#FFC94A" />
                <span style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 14, color: "#FFC94A" }}>
                  {Number(balance || 0).toLocaleString()}
                </span>
                <span style={{ fontSize: 10, color: C.dimMore, fontFamily: C.raj }}>ArcadeCoins</span>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "1px solid rgba(0,212,255,0.15)", overflowX: "auto" }}>
          {[
            { id: "all",      label: `All (${tournaments.length})` },
            { id: "active",   label: `Live (${activeCnt})`, dot: true },
            { id: "upcoming", label: `Upcoming (${upcomingCnt})` },
            { id: "ended",    label: `Ended (${endedCnt})` },
          ].map(t => (
            <button key={t.id} className="tab-btn" onClick={() => setTab(t.id)} style={{
              padding: "10px 22px",
              background: "transparent", border: "none",
              borderBottom: tab === t.id ? `2px solid ${C.cyan}` : "2px solid transparent",
              color: tab === t.id ? C.cyanL : C.dimMore,
              fontSize: 12, cursor: "pointer", marginBottom: "-1px",
              fontFamily: C.raj, fontWeight: 700,
              letterSpacing: "0.5px", textTransform: "uppercase",
              transition: "color 0.18s", display: "flex", alignItems: "center", gap: 6,
              flexShrink: 0, whiteSpace: "nowrap",
            }}>
              {t.dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00FF88", animation: "livePulse 1s ease-in-out infinite" }} />}
              {t.label}
            </button>
          ))}
        </div>

        {msg && (
          <div style={{
            marginBottom: 16, padding: "12px 18px",
            background: msg.type === "ok" ? "rgba(0,255,136,0.06)" : "rgba(255,68,88,0.06)",
            border: `1px solid ${msg.type === "ok" ? "rgba(0,255,136,0.25)" : "rgba(255,68,88,0.25)"}`,
            borderRadius: 10, fontSize: 12,
            color: msg.type === "ok" ? C.green : C.red,
            fontFamily: C.raj, fontWeight: 700,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Icon name={msg.type === "ok" ? "check" : "warning"} size={14} />
              {msg.text}
            </span>
            <button onClick={() => setMsg(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
              <Icon name="x" size={13} />
            </button>
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ height: 360, borderRadius: 16, background: "linear-gradient(90deg, rgba(0,212,255,0.04) 25%, rgba(0,212,255,0.08) 50%, rgba(0,212,255,0.04) 75%)", border: "1px solid rgba(0,212,255,0.1)" }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "80px 0", textAlign: "center" }}>
            <div style={{ marginBottom: 14, color: "rgba(255,183,0,0.6)", display: "flex", justifyContent: "center" }}>
              <Icon name="trophy" size={56} />
            </div>
            <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 18, color: C.cyanL, marginBottom: 6 }}>
              {tab === "all" ? "No tournaments yet" : `No ${tab} tournaments`}
            </div>
            <div style={{ fontSize: 12, color: C.dimMore, fontFamily: C.raj }}>
              {isAdmin ? "Create one from Creators → Admin Queue" : "Check back soon — admin creates them."}
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))", gap: 16, animation: "w2tFadeUp 0.5s 0.1s ease both" }}>
            {filtered.map(t => (
              <TournamentCard
                key={t.id}
                tournament={t}
                user={user}
                balance={balance}
                isAdmin={isAdmin}
                joining={joiningId === t.id}
                onJoin={handleJoin}
                onEnd={handleEnd}
                onCancel={handleCancel}
                navigate={navigate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
