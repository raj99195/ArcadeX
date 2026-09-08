// src/components/BattleMatchHistory.jsx
//
// Full-screen modal listing the player's last 20 battle sessions with
// per-round dollar breakdown and tx link. Fetched lazily when opened.

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { useChain } from "../context/ChainContext";
import { CHAINS } from "../config/chains";

const C = {
  bg:        "rgba(4,3,10,0.92)",
  panel:     "rgba(12,8,28,0.95)",
  panelSolid:"#0d0b1a",
  border:    "rgba(139,92,246,0.35)",
  borderHot: "rgba(0,229,255,0.6)",
  violet:    "#8b5cf6",
  violetL:   "#c4b5fd",
  cyan:      "#00e5ff",
  cyanL:     "#7ff5ff",
  magenta:   "#ec4899",
  green:     "#00ff88",
  gold:      "#ffb700",
  danger:    "#ff3860",
  dim:       "#9977cc",
  dimMore:   "#5533aa",
  raj:       "'Rajdhani', sans-serif",
  orb:       "'Orbitron', sans-serif",
};

function timeAgo(ms) {
  if (!ms) return "—";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60)     return `${s}s ago`;
  if (s < 3600)   return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)  return `${Math.floor(s / 3600)}h ago`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`;
  const d = new Date(ms);
  return `${d.toLocaleDateString()}`;
}

function fmtDateTime(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

const STATUS = {
  active:    { color: C.cyanL,   glow: "rgba(0,229,255,0.4)",  label: "IN PROGRESS", icon: "◉" },
  completed: { color: C.gold,    glow: "rgba(255,183,0,0.4)",  label: "UNCLAIMED",   icon: "⚠" },
  claimed:   { color: C.green,   glow: "rgba(0,255,136,0.4)",  label: "CLAIMED",     icon: "✓" },
  expired:   { color: C.dim,     glow: "rgba(153,119,204,0.3)",label: "EXPIRED",     icon: "○" },
};

function SessionCard({ session, expanded, onToggle }) {
  const st        = STATUS[session.status] || STATUS.completed;
  const chainMeta = Object.values(CHAINS).find(c => c.chainId === session.chainId) || null;
  const chainName = chainMeta?.name || session.chain;
  const explorer  = chainMeta?.explorerUrl;
  const rounds    = session.rounds || [];
  const maxD      = Math.max(...rounds.map(r => r.dollars), 1);
  const best      = rounds.reduce((a, r) => (r.dollars > a.dollars ? r : a), { round: 0, dollars: 0 });
  const avg       = rounds.length ? Math.round((session.totalDollars || 0) / rounds.length) : 0;

  return (
    <div
      style={{
        background: C.panelSolid,
        border: `1px solid ${expanded ? st.color : C.border}`,
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
        boxShadow: expanded ? `0 0 20px ${st.glow}` : "none",
        transition: "all 0.25s ease",
      }}
    >
      {/* Row: status, chain, when, total, expand */}
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 12,
          cursor: "pointer",
        }}
      >
        {/* Status dot */}
        <div
          style={{
            width: 40, height: 40, borderRadius: "50%",
            background: `radial-gradient(circle, ${st.color}33, transparent 70%)`,
            border: `1px solid ${st.color}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
            boxShadow: `0 0 10px ${st.glow}`,
          }}
        >
          <span style={{ color: st.color, fontSize: 15, textShadow: `0 0 8px ${st.color}` }}>{st.icon}</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
            <span
              style={{
                fontFamily: C.orb, fontWeight: 700, fontSize: 11,
                color: st.color, letterSpacing: "1.5px",
                textShadow: `0 0 8px ${st.glow}`,
              }}
            >
              {st.label}
            </span>
            <span
              style={{
                padding: "1px 6px", background: "rgba(139,92,246,0.15)",
                border: `1px solid ${C.border}`, borderRadius: 3,
                fontFamily: C.raj, fontSize: 9, fontWeight: 700,
                color: C.violetL, letterSpacing: "1px",
              }}
            >
              {chainName?.toUpperCase() || "—"}
            </span>
            <span style={{ fontFamily: C.raj, fontSize: 10, color: C.dim }}>
              {timeAgo(session.createdAt)}
            </span>
          </div>
          <div style={{ fontFamily: C.raj, fontSize: 10, color: C.dimMore, wordBreak: "break-all" }}>
            {rounds.length}/5 rounds
          </div>
        </div>

        {/* Total */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: C.orb, fontWeight: 800, fontSize: 20, color: C.gold, textShadow: `0 0 10px ${C.gold}`, lineHeight: 1 }}>
            ${session.totalDollars || 0}
          </div>
          <div style={{ fontFamily: C.raj, fontSize: 9, color: C.dim, marginTop: 2, letterSpacing: "1.5px" }}>
            TOTAL BOUNTY
          </div>
        </div>

        <div style={{ color: C.violetL, fontSize: 12, transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease" }}>
          ▼
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          {/* Mini bar chart */}
          {rounds.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: C.raj, fontSize: 9, color: C.dim, letterSpacing: "2px", textTransform: "uppercase", marginBottom: 8 }}>
                Round Breakdown
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 70 }}>
                {[1, 2, 3, 4, 5].map(rnum => {
                  const r = rounds.find(x => x.round === rnum);
                  const d = r?.dollars ?? 0;
                  const h = r ? Math.max(6, (d / maxD) * 100) : 0;
                  const isBest = r && r.round === best.round && best.dollars > 0;
                  return (
                    <div key={rnum} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                      <div style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 10, color: r ? (isBest ? C.gold : C.cyanL) : C.dimMore }}>
                        ${d}
                      </div>
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "flex-end" }}>
                        <div
                          style={{
                            width: "100%",
                            height: `${h}%`,
                            background: !r ? "rgba(85,51,170,0.2)" :
                                        isBest ? `linear-gradient(180deg, ${C.gold}, #ff8800)` :
                                        `linear-gradient(180deg, ${C.cyan}, ${C.violet})`,
                            borderRadius: "3px 3px 0 0",
                            boxShadow: r ? `0 0 8px ${isBest ? C.gold : C.cyan}` : "none",
                          }}
                        />
                      </div>
                      <div style={{ fontFamily: C.raj, fontSize: 8, color: C.dim, letterSpacing: "1px" }}>
                        R{rnum}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Stats grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
            <div style={{ padding: 8, background: "rgba(0,0,0,0.3)", borderRadius: 6, textAlign: "center" }}>
              <div style={{ fontFamily: C.raj, fontSize: 8, color: C.dim, letterSpacing: "1.5px" }}>AVG</div>
              <div style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 13, color: C.cyanL }}>${avg}</div>
            </div>
            <div style={{ padding: 8, background: "rgba(0,0,0,0.3)", borderRadius: 6, textAlign: "center" }}>
              <div style={{ fontFamily: C.raj, fontSize: 8, color: C.dim, letterSpacing: "1.5px" }}>BEST</div>
              <div style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 13, color: C.gold }}>
                {best.round ? `R${best.round}` : "—"}
              </div>
            </div>
            <div style={{ padding: 8, background: "rgba(0,0,0,0.3)", borderRadius: 6, textAlign: "center" }}>
              <div style={{ fontFamily: C.raj, fontSize: 8, color: C.dim, letterSpacing: "1.5px" }}>ROUNDS</div>
              <div style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 13, color: C.violetL }}>{rounds.length}/5</div>
            </div>
          </div>

          {/* Meta */}
          <div style={{ fontFamily: C.raj, fontSize: 10, color: C.dim, marginBottom: 8 }}>
            <div>Started: {fmtDateTime(session.createdAt)}</div>
            {session.claimedAt && <div>Claimed: {fmtDateTime(session.claimedAt)}</div>}
          </div>

          {/* Tx link */}
          {session.claimTxHash && explorer && (
            <a
              href={`${explorer}/tx/${session.claimTxHash}`}
              target="_blank" rel="noreferrer"
              style={{
                display: "inline-block",
                padding: "6px 12px",
                background: "rgba(0,229,255,0.08)",
                border: `1px solid ${C.borderHot}`,
                borderRadius: 5,
                color: C.cyanL,
                fontFamily: C.raj, fontSize: 10, fontWeight: 700,
                letterSpacing: "1px", textDecoration: "none",
              }}
            >
              🔗 View Transaction →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function BattleMatchHistory({ open, onClose }) {
  const { address } = useAccount();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !address) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const jwt = localStorage.getItem("arcadex_jwt");
        if (!jwt) throw new Error("Not signed in");
        const r = await fetch("/api/games?action=battle-match-history", {
          headers: { Authorization: `Bearer ${jwt}` },
        });
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok) throw new Error(d.error || "Failed to load history");
        setSessions(d.sessions || []);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [open, address]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9998,
        background: C.bg,
        backdropFilter: "blur(12px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: isMobile ? 0 : 30,
        animation: "fadeIn 0.3s ease",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 720, width: "100%",
          maxHeight: isMobile ? "100vh" : "90vh",
          background: C.panel,
          border: `2px solid ${C.borderHot}`,
          borderRadius: isMobile ? 0 : 18,
          overflow: "hidden",
          boxShadow: `0 0 80px rgba(0,229,255,0.4), 0 0 200px rgba(139,92,246,0.2)`,
          display: "flex", flexDirection: "column",
          animation: "historySlideUp 0.4s ease",
        }}
      >
        <div
          style={{
            padding: isMobile ? "16px" : "20px 28px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex", alignItems: "center", gap: 16,
            background: "linear-gradient(180deg, rgba(139,92,246,0.15), rgba(0,229,255,0.05))",
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: C.orb, fontWeight: 900, fontSize: isMobile ? 18 : 24,
                color: "#fff", letterSpacing: isMobile ? "3px" : "6px",
                textShadow: `0 0 20px ${C.violet}, 0 0 40px ${C.cyan}`,
                lineHeight: 1,
              }}
            >
              📜 MATCH HISTORY
            </div>
            {!isMobile && (
              <div style={{ fontFamily: C.raj, fontSize: 11, color: C.cyan, letterSpacing: "3px", marginTop: 6, textShadow: `0 0 8px ${C.cyan}` }}>
                ▸ LAST 20 BATTLES ◂
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              width: 40, height: 40,
              background: "rgba(0,0,0,0.6)",
              border: `1px solid ${C.borderHot}`, borderRadius: 8,
              color: C.cyanL, fontSize: 18, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 0 15px rgba(0,229,255,0.3)`,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "14px" : "20px 24px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <div
                style={{
                  width: 50, height: 50, margin: "0 auto 16px",
                  border: `4px solid rgba(139,92,246,0.2)`,
                  borderTop: `4px solid ${C.violet}`,
                  borderRadius: "50%",
                  animation: "spinnerRing 1s linear infinite",
                }}
              />
              <div style={{ fontFamily: C.raj, fontSize: 13, color: C.violetL, letterSpacing: "2px" }}>
                Loading history...
              </div>
            </div>
          ) : error ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: C.danger, fontFamily: C.raj, fontSize: 13 }}>
              ⚠ {error}
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "80px 20px" }}>
              <div style={{ fontSize: 60, marginBottom: 16, filter: `drop-shadow(0 0 20px ${C.violet})` }}>⚔</div>
              <div style={{ fontFamily: C.orb, fontSize: 16, color: C.violetL, letterSpacing: "3px", marginBottom: 8, textShadow: `0 0 10px ${C.violet}` }}>
                NO BATTLES YET
              </div>
              <div style={{ fontFamily: C.raj, fontSize: 12, color: C.dim, maxWidth: 340, margin: "0 auto" }}>
                Complete your first 5-round battle to see it here.
              </div>
            </div>
          ) : (
            <div>
              {sessions.map((s) => (
                <SessionCard
                  key={s.sessionId}
                  session={s}
                  expanded={expanded === s.sessionId}
                  onToggle={() => setExpanded(expanded === s.sessionId ? null : s.sessionId)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes historySlideUp {
          from { opacity: 0; transform: translateY(30px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes spinnerRing { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
