// src/components/BattleResultRecap.jsx
//
// Full-screen recap that appears when the player finishes all 5 rounds.
// Shows a bar chart of dollars per round, best round highlight, animated
// totals + averages, and the Claim CTA. Parent controls visibility.
//
// Props:
//   rounds:       [{ round: 1..5, dollars: number }]
//   totalDollars: number
//   arcadeReward: number    (dollars * dollarRate — for display)
//   chainName:    string    ("MST Blockchain" etc.)
//   claimStage:   null | 'signing' | 'wallet' | 'confirming' | 'success' | 'failed'
//   claimError:   string | null
//   onClaim():    () => void
//   onClose():    () => void   — user dismissed to see sidebar
//   canClaim:     boolean — controls whether CTA is enabled

import { useEffect, useState } from "react";

const C = {
  bg:        "rgba(4,3,10,0.94)",
  card:      "rgba(15,10,35,0.92)",
  border:    "rgba(139,92,246,0.4)",
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
  raj:       "'Rajdhani', sans-serif",
  orb:       "'Orbitron', sans-serif",
};

// ── Animated number counter (eased) ────────────────────────────────────────
function useCountUp(target, { duration = 1400, delay = 0 } = {}) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    setValue(0);
    if (!Number.isFinite(target) || target <= 0) return;
    let raf;
    const startAt = performance.now() + delay;
    const tick = (now) => {
      if (now < startAt) { raf = requestAnimationFrame(tick); return; }
      const t = Math.min(1, (now - startAt) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValue(Math.floor(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else setValue(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, delay]);

  return value;
}

// ── Bar chart of per-round dollars ─────────────────────────────────────────
function RoundBars({ rounds, best }) {
  const [visibleCount, setVisibleCount] = useState(0);
  const maxDollars = Math.max(...rounds.map(r => r.dollars), 1);

  useEffect(() => {
    let cancelled = false;
    const step = (i) => {
      if (cancelled) return;
      setVisibleCount(i);
      if (i < 5) setTimeout(() => step(i + 1), 180);
    };
    setTimeout(() => step(1), 500);
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-end", height: 200, marginBottom: 10 }}>
      {rounds.map((r, idx) => {
        const shown = idx < visibleCount;
        const heightPct = shown ? Math.max(4, (r.dollars / maxDollars) * 100) : 0;
        const isBest = r.round === best.round && best.dollars > 0;
        const barColor = isBest ? C.gold : C.cyan;
        const barGradient = isBest
          ? `linear-gradient(180deg, ${C.gold} 0%, #ff8800 100%)`
          : `linear-gradient(180deg, ${C.cyan} 0%, ${C.violet} 100%)`;

        return (
          <div key={r.round} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            {/* Dollar label */}
            <div
              style={{
                fontFamily: C.orb, fontWeight: 800, fontSize: 15,
                color: isBest ? C.gold : C.cyanL,
                textShadow: `0 0 10px ${barColor}`,
                opacity: shown ? 1 : 0,
                transition: "opacity 0.4s ease 0.3s",
              }}
            >
              ${r.dollars}
            </div>

            {/* Bar */}
            <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end", position: "relative" }}>
              <div
                style={{
                  width: "100%",
                  height: `${heightPct}%`,
                  background: barGradient,
                  borderRadius: "4px 4px 0 0",
                  boxShadow: `0 0 20px ${barColor}, inset 0 0 15px rgba(255,255,255,0.15)`,
                  transition: "height 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  border: isBest ? `1px solid ${C.gold}` : "none",
                  position: "relative",
                }}
              >
                {isBest && shown && (
                  <div
                    style={{
                      position: "absolute", top: -22, left: "50%", transform: "translateX(-50%)",
                      fontSize: 16, filter: `drop-shadow(0 0 8px ${C.gold})`,
                    }}
                  >
                    👑
                  </div>
                )}
              </div>
            </div>

            {/* Round label */}
            <div
              style={{
                fontFamily: C.raj, fontWeight: 700, fontSize: 10,
                color: isBest ? C.gold : C.dim,
                letterSpacing: "2px", textTransform: "uppercase",
                opacity: shown ? 1 : 0.3,
                transition: "opacity 0.3s ease",
              }}
            >
              R{r.round}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Stat card ──────────────────────────────────────────────────────────────
function StatCard({ label, value, color = C.cyanL, glow = "rgba(0,229,255,0.4)", delay = 0 }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  return (
    <div
      style={{
        flex: 1, minWidth: 0,
        padding: "12px 10px",
        background: "rgba(0,0,0,0.4)",
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        textAlign: "center",
        opacity: show ? 1 : 0,
        transform: show ? "translateY(0)" : "translateY(10px)",
        transition: "all 0.4s ease",
      }}
    >
      <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 9, color: C.dim, letterSpacing: "2px", textTransform: "uppercase", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontFamily: C.orb, fontWeight: 800, fontSize: 20, color, textShadow: `0 0 10px ${glow}`, lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

// ── Main recap component ───────────────────────────────────────────────────
export default function BattleResultRecap({
  rounds, totalDollars, arcadeReward, chainName,
  claimStage, claimError, onClaim, onClose, canClaim,
  bpStatus,   // { tier, seasonXP, xpPerTier, maxTier, seasonName }
  xpEarned,   // total XP earned during this session (sum of all rounds)
}) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setEntered(true));
  }, []);

  const best    = rounds.reduce((acc, r) => (r.dollars > acc.dollars ? r : acc), { round: 0, dollars: 0 });
  const average = rounds.length ? Math.round(totalDollars / rounds.length) : 0;

  const animatedTotal   = useCountUp(totalDollars,  { duration: 1500, delay: 1400 });
  const animatedArcade  = useCountUp(arcadeReward,  { duration: 1500, delay: 1800 });
  const animatedXP      = useCountUp(xpEarned || 0, { duration: 1500, delay: 2200 });

  const isProcessing = claimStage && claimStage !== "success" && claimStage !== "failed";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: C.bg,
        backdropFilter: "blur(10px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
        opacity: entered ? 1 : 0,
        transition: "opacity 0.3s ease",
      }}
    >
      <div
        style={{
          maxWidth: 640, width: "100%",
          background: C.card,
          border: `2px solid ${C.borderHot}`,
          borderRadius: 20,
          padding: "28px 26px 24px",
          boxShadow: `0 0 60px rgba(0,229,255,0.35), 0 0 120px rgba(139,92,246,0.2)`,
          transform: entered ? "translateY(0) scale(1)" : "translateY(30px) scale(0.94)",
          opacity: entered ? 1 : 0,
          transition: "all 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
          maxHeight: "94vh", overflowY: "auto",
        }}
      >
        {/* Title */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div
            style={{
              fontFamily: C.orb, fontWeight: 900, fontSize: 30,
              color: "#fff", letterSpacing: "6px", textTransform: "uppercase",
              textShadow: `0 0 15px ${C.violet}, 0 0 30px ${C.cyan}, 0 0 60px ${C.magenta}`,
              lineHeight: 1,
              animation: "recapTitleGlow 2.5s ease-in-out infinite",
            }}
          >
            🏆 Battle Complete 🏆
          </div>
          {chainName && (
            <div style={{ fontFamily: C.raj, fontSize: 11, color: C.cyan, letterSpacing: "3px", marginTop: 6, textShadow: `0 0 8px ${C.cyan}` }}>
              ▸ {chainName.toUpperCase()} ◂
            </div>
          )}
        </div>

        {/* Chart */}
        <div
          style={{
            background: "rgba(0,0,0,0.3)",
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: "18px 14px",
            marginBottom: 16,
          }}
        >
          <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 10, color: C.dim, letterSpacing: "2px", textAlign: "center", marginBottom: 12, textTransform: "uppercase" }}>
            ▸ Round Breakdown ◂
          </div>
          <RoundBars rounds={rounds} best={best} />
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <StatCard label="TOTAL" value={`$${animatedTotal}`} color={C.gold} glow={`rgba(255,183,0,0.5)`} delay={1400} />
          <StatCard label="AVG/ROUND" value={`$${average}`}         color={C.cyanL} delay={1600} />
          <StatCard label="BEST ROUND" value={best.round ? `R${best.round}` : "—"} color={C.gold} glow={`rgba(255,183,0,0.5)`} delay={1800} />
          <StatCard label="ARCADE" value={animatedArcade}           color={C.green} glow={`rgba(0,255,136,0.5)`} delay={2000} />
          {xpEarned > 0 && (
            <StatCard label="XP EARNED" value={`+${animatedXP}`}      color={C.violetL} glow={`rgba(139,92,246,0.5)`} delay={2200} />
          )}
        </div>

        {/* Battle Pass progress row (if we have BP status) */}
        {bpStatus && (
          <div style={{
            padding: "12px 16px",
            background: "rgba(255,183,0,0.06)",
            border: `1px solid rgba(255,183,0,0.35)`,
            borderRadius: 10,
            marginBottom: 18,
            display: "flex", alignItems: "center", gap: 14,
            animation: "fadeIn 0.5s ease 2.4s backwards",
          }}>
            <div style={{
              width: 46, height: 46, borderRadius: "50%",
              background: `linear-gradient(135deg, ${C.gold}, ${C.violet})`,
              border: `2px solid ${C.gold}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: C.orb, fontWeight: 900, fontSize: 15, color: "#000",
              boxShadow: `0 0 15px ${C.gold}`,
              flexShrink: 0,
            }}>
              {bpStatus.tier}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontFamily: C.raj, fontSize: 10, color: C.gold, letterSpacing: "2px", fontWeight: 700, textTransform: "uppercase" }}>
                  Battle Pass · Tier {bpStatus.tier}
                </span>
                <span style={{ fontFamily: C.raj, fontSize: 10, color: C.cyanL, letterSpacing: "1px" }}>
                  {(bpStatus.seasonXP || 0) - bpStatus.tier * (bpStatus.xpPerTier || 500)}/{bpStatus.xpPerTier} XP
                </span>
              </div>
              <div style={{ width: "100%", height: 8, background: "rgba(0,0,0,0.5)", border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
                <div style={{
                  width: `${Math.min(100, (((bpStatus.seasonXP || 0) - bpStatus.tier * (bpStatus.xpPerTier || 500)) / (bpStatus.xpPerTier || 500)) * 100)}%`,
                  height: "100%",
                  background: `linear-gradient(90deg, ${C.violet}, ${C.cyan}, ${C.gold})`,
                  boxShadow: `0 0 8px ${C.cyan}`,
                  transition: "width 0.8s ease-out",
                }} />
              </div>
            </div>
          </div>
        )}

        {/* Claim CTA / Status */}
        {claimStage === "success" ? (
          <div
            style={{
              padding: "16px", textAlign: "center",
              background: "rgba(0,255,136,0.08)",
              border: `1px solid ${C.green}`,
              borderRadius: 12,
              marginBottom: 12,
            }}
          >
            <div style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 14, color: C.green, letterSpacing: "3px", textShadow: `0 0 10px ${C.green}` }}>
              ✓ CLAIMED SUCCESSFULLY
            </div>
          </div>
        ) : isProcessing ? (
          <div
            style={{
              padding: "16px", textAlign: "center",
              background: "rgba(0,229,255,0.06)",
              border: `1px solid ${C.borderHot}`,
              borderRadius: 12,
              marginBottom: 12,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
            }}
          >
            <div style={{ width: 20, height: 20, border: `3px solid rgba(0,229,255,0.2)`, borderTop: `3px solid ${C.cyan}`, borderRadius: "50%", animation: "spinnerRing 1s linear infinite" }} />
            <div style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 12, color: C.cyanL, letterSpacing: "2px" }}>
              {claimStage === "signing" ? "REQUESTING SIGNATURE..." :
               claimStage === "wallet" ? "APPROVE IN WALLET" :
               claimStage === "confirming" ? "CONFIRMING ON-CHAIN..." : "PROCESSING..."}
            </div>
          </div>
        ) : (
          <button
            onClick={onClaim}
            disabled={!canClaim}
            style={{
              width: "100%",
              padding: "18px",
              background: canClaim
                ? `linear-gradient(135deg, ${C.gold} 0%, #ff8800 50%, ${C.gold} 100%)`
                : "rgba(120,120,140,0.15)",
              border: "none",
              borderRadius: 12,
              color: canClaim ? "#000" : C.dim,
              fontFamily: C.orb, fontWeight: 900,
              fontSize: 16,
              letterSpacing: "3px",
              textTransform: "uppercase",
              cursor: canClaim ? "pointer" : "not-allowed",
              boxShadow: canClaim ? `0 0 30px ${C.gold}, 0 0 60px rgba(255,183,0,0.5)` : "none",
              animation: canClaim ? "claimPulse 1.5s ease-in-out infinite" : "none",
              marginBottom: 12,
              transition: "all 0.2s",
            }}
          >
            ⚡ Claim {arcadeReward} ARCADE ⚡
          </button>
        )}

        {claimError && claimStage === "failed" && (
          <div
            style={{
              padding: "10px", textAlign: "center",
              background: "rgba(255,56,96,0.08)",
              border: `1px solid ${C.danger}`,
              borderRadius: 8,
              marginBottom: 12,
              fontFamily: C.raj, fontSize: 12, color: C.danger, fontWeight: 700,
            }}
          >
            ⚠ {claimError}
          </div>
        )}

        {/* Dismiss link */}
        <div style={{ textAlign: "center" }}>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "none",
              color: C.dim, cursor: "pointer",
              fontFamily: C.raj, fontSize: 11, fontWeight: 700,
              letterSpacing: "2px", textTransform: "uppercase",
              padding: "8px 16px",
            }}
          >
            {claimStage === "success" ? "Close" : "View later →"}
          </button>
        </div>

        <style>{`
          @keyframes recapTitleGlow {
            0%,100% { text-shadow: 0 0 15px ${C.violet}, 0 0 30px ${C.cyan}, 0 0 60px ${C.magenta}; }
            50%     { text-shadow: 0 0 25px ${C.violet}, 0 0 50px ${C.magenta}, 0 0 80px ${C.cyan}; }
          }
          @keyframes claimPulse {
            0%,100% { box-shadow: 0 0 30px ${C.gold}, 0 0 60px rgba(255,183,0,0.5); }
            50%     { box-shadow: 0 0 50px ${C.gold}, 0 0 100px rgba(255,183,0,0.7); }
          }
          @keyframes spinnerRing { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    </div>
  );
}
