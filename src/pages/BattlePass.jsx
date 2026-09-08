// src/pages/BattlePass.jsx
//
// Battle Pass page. Reads active season + player status, renders the tier
// ladder (Premium row + Free row + tier numbers), handles ARCADE claim tx
// via BattleArena.claim(), and shows "unlock premium" CTA.
//
// Design tokens match BattleArena aesthetic. Uses ConfettiBurst on claim.

import { useEffect, useState, useRef, useCallback, memo } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount, useWalletClient } from "wagmi";
import { writeContract, waitForTransactionReceipt } from "@wagmi/core";
import { wagmiAdapter } from "../Providers";
import { useChain } from "../context/ChainContext";
import { signInAndGetJwt, hasValidJwtForWallet } from "../hooks/useAutoAuth";
import { useTurnstile } from "../context/TurnstileContext";
import ConfettiBurst from "../components/ConfettiBurst";
import Seo from "../components/Seo";

const BATTLE_ARENA_ABI = [
  {
    name: "claim", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "sessionId", type: "bytes32" },
      { name: "dollars",   type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
];

const C = {
  bg:        "#04030a",
  bgDeep:    "#020106",
  card:      "rgba(15,10,35,0.75)",
  cardSolid: "#0d0b1a",
  border:    "rgba(139,92,246,0.3)",
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

// ── Background particle field (lightweight — reuse the BattleArena vibe) ────
const ParticleField = memo(function ParticleField() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf, particles = [];
    const setSize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    setSize();
    window.addEventListener("resize", setSize);
    for (let i = 0; i < 120; i++) {
      particles.push({
        x: Math.random() * canvas.width, y: Math.random() * canvas.height,
        r: Math.random() * 2 + 0.4, vx: (Math.random() - 0.5) * 0.15, vy: (Math.random() - 0.5) * 0.15,
        hue: Math.random() < 0.6 ? 270 : (Math.random() < 0.5 ? 190 : 320),
        alpha: Math.random() * 0.5 + 0.2,
      });
    }
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        g.addColorStop(0, `hsla(${p.hue},100%,70%,${p.alpha})`);
        g.addColorStop(1, `hsla(${p.hue},100%,50%,0)`);
        ctx.fillStyle = g;
        ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", setSize); };
  }, []);
  return (
    <canvas ref={canvasRef} style={{
      position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
      background:
        "radial-gradient(ellipse at 20% 30%, rgba(139,92,246,0.15) 0%, transparent 50%)," +
        "radial-gradient(ellipse at 80% 70%, rgba(0,229,255,0.12) 0%, transparent 50%)," +
        `linear-gradient(180deg, ${C.bgDeep} 0%, ${C.bg} 100%)`,
    }} />
  );
});

// ── Tier card — rendered for each of Free / Premium slots ──────────────────
function TierRewardCard({ reward, unlocked, claimed, disabled, disabledReason, onClaim, claiming, trackColor, trackGlow, trackLabel }) {
  const arcade = reward?.arcade || 0;
  const itemId = reward?.itemId || "";
  const hasReward = arcade > 0 || !!itemId;

  const state = claimed ? "claimed" : (unlocked && hasReward ? "unlocked" : "locked");

  const stateStyles = {
    locked: {
      bg: "rgba(20,15,45,0.4)",
      border: C.dimMore,
      textOpacity: 0.4,
      shadow: "none",
    },
    unlocked: {
      bg: `linear-gradient(135deg, ${trackColor}22, rgba(0,0,0,0.4))`,
      border: trackColor,
      textOpacity: 1,
      shadow: `0 0 25px ${trackGlow}, inset 0 0 20px ${trackGlow}`,
    },
    claimed: {
      bg: "rgba(0,255,136,0.06)",
      border: C.green,
      textOpacity: 0.75,
      shadow: `0 0 15px rgba(0,255,136,0.3)`,
    },
  };
  const s = stateStyles[state];

  return (
    <div
      style={{
        position: "relative",
        width: 120, minWidth: 120,
        background: s.bg,
        border: `2px solid ${s.border}`,
        borderRadius: 10,
        padding: 8,
        display: "flex", flexDirection: "column",
        alignItems: "center", gap: 6,
        boxShadow: s.shadow,
        transition: "all 0.3s ease",
        animation: state === "unlocked" ? "tierPulse 2s ease-in-out infinite" : "none",
      }}
    >
      {/* Track label */}
      <div style={{
        fontFamily: C.orb, fontSize: 8, fontWeight: 800,
        color: state === "locked" ? C.dimMore : trackColor,
        letterSpacing: "2px", textShadow: state === "locked" ? "none" : `0 0 6px ${trackGlow}`,
      }}>
        {trackLabel}
      </div>

      {/* Reward icon */}
      <div style={{
        width: 60, height: 60,
        borderRadius: 8,
        background: state === "locked"
          ? "rgba(0,0,0,0.4)"
          : `radial-gradient(circle, ${trackGlow} 0%, transparent 70%), rgba(0,0,0,0.3)`,
        border: `1px solid ${state === "locked" ? C.dimMore : trackColor}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 30,
        color: state === "locked" ? C.dimMore : "#fff",
        filter: state === "locked" ? "none" : `drop-shadow(0 0 8px ${trackGlow})`,
      }}>
        {state === "locked" && !hasReward ? "—" :
         state === "claimed" ? "✓" :
         disabled && !unlocked ? "🔒" :
         itemId ? "◈" :
         arcade > 0 ? "◎" : "—"}
      </div>

      {/* Reward label */}
      <div style={{
        fontFamily: C.orb, fontSize: 11, fontWeight: 700,
        color: state === "claimed" ? C.green : (state === "locked" ? C.dimMore : "#fff"),
        textAlign: "center", lineHeight: 1.2,
        opacity: s.textOpacity,
      }}>
        {arcade > 0 ? `${arcade} ARCADE` : (itemId ? "Item" : "—")}
      </div>

      {/* Action */}
      {state === "claimed" ? (
        <div style={{
          fontFamily: C.raj, fontSize: 9, fontWeight: 700, color: C.green,
          letterSpacing: "1.5px", textTransform: "uppercase",
        }}>
          ✓ Claimed
        </div>
      ) : state === "unlocked" ? (
        <button
          onClick={onClaim}
          disabled={claiming}
          style={{
            width: "100%", padding: "5px",
            background: claiming ? "rgba(0,0,0,0.4)" : `linear-gradient(135deg, ${trackColor}, ${C.violet})`,
            border: "none", borderRadius: 5,
            color: claiming ? C.dim : "#000",
            fontFamily: C.orb, fontSize: 9, fontWeight: 800,
            cursor: claiming ? "wait" : "pointer",
            letterSpacing: "1.5px", textTransform: "uppercase",
          }}
        >
          {claiming ? "…" : "Claim"}
        </button>
      ) : disabled ? (
        <div style={{
          fontFamily: C.raj, fontSize: 8, fontWeight: 700, color: C.gold,
          letterSpacing: "1px", textTransform: "uppercase", textAlign: "center", lineHeight: 1.2,
        }}>
          {disabledReason || "Locked"}
        </div>
      ) : (
        <div style={{
          fontFamily: C.raj, fontSize: 9, fontWeight: 700, color: C.dimMore,
          letterSpacing: "1.5px", textTransform: "uppercase",
        }}>
          Locked
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function BattlePass() {
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  const { contracts, chainKey, chainName, chainId, explorerUrl } = useChain();
  const BATTLE_ARENA_ADDRESS = contracts?.battleArena;

  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { getToken: getTurnstileToken } = useTurnstile();

  const [status, setStatus]   = useState(null);   // { activeSeason, player }
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const [claiming, setClaiming] = useState(null);  // "tier:track" key
  const [claimMsg, setClaimMsg] = useState("");
  const [confetti, setConfetti] = useState(false);
  const [confettiColors, setConfettiColors] = useState(["#ffb700", "#8b5cf6", "#00e5ff"]);

  const [unlocking, setUnlocking] = useState(false);

  const laddersRef = useRef(null);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!address) return;
    setLoading(true); setError(null);
    try {
      let jwt = localStorage.getItem("arcadex_jwt");
      if (!jwt || !hasValidJwtForWallet(address)) {
        const tsToken = await getTurnstileToken().catch(() => null);
        jwt = await signInAndGetJwt({ address, walletClient, turnstileToken: tsToken });
      }
      const r = await fetch("/api/games?action=battle-bp-status", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to load Battle Pass");
      setStatus(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [address, walletClient, getTurnstileToken]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // ── Scroll to current tier on load ──
  useEffect(() => {
    if (!laddersRef.current || !status?.player) return;
    const currentTier = status.player.currentTier || 0;
    const tierWidth = 130; // 120 + 10 gap
    // Center current tier in viewport
    const container = laddersRef.current;
    const targetLeft = Math.max(0, currentTier * tierWidth - container.clientWidth / 2);
    container.scrollTo({ left: targetLeft, behavior: "smooth" });
  }, [status?.player?.currentTier]);

  const handleClaim = async (tier, track) => {
    if (!isConnected || !address || !BATTLE_ARENA_ADDRESS) return;
    const key = `${tier}:${track}`;
    if (claiming) return;

    setClaiming(key); setClaimMsg("");
    try {
      const jwt = localStorage.getItem("arcadex_jwt");
      const signRes = await fetch("/api/games?action=battle-bp-sign-tier-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ tier, track, chain: chainKey }),
      });
      const signData = await signRes.json();
      if (!signRes.ok) throw new Error(signData.error || "Signing failed");

      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: BATTLE_ARENA_ADDRESS,
        abi: BATTLE_ARENA_ABI,
        functionName: "claim",
        args: [signData.sessionIdBytes32, BigInt(signData.dollars), signData.signature],
        chainId,
      });

      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash, chainId });

      await fetch("/api/games?action=battle-bp-record-tier-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ tier, track, txHash: hash }),
      });

      // 🎉 Celebrate
      setConfettiColors(track === "premium"
        ? ["#ffb700", "#ff8800", "#8b5cf6", "#ec4899", "#ffffff"]
        : ["#00e5ff", "#8b5cf6", "#00ff88", "#ffffff"]);
      setConfetti(true);
      setTimeout(() => setConfetti(false), 4000);
      setClaimMsg(`✓ Claimed ${signData.dollars} ARCADE from Tier ${tier} (${track})`);
      setTimeout(() => setClaimMsg(""), 5000);

      await fetchStatus();
    } catch (err) {
      console.error(err);
      const msg = err?.shortMessage || err?.message || "Claim failed";
      setClaimMsg(/user rejected|user denied/i.test(msg) ? "Transaction cancelled" : msg);
    } finally {
      setClaiming(null);
    }
  };

  const handleUnlockPremium = async () => {
    if (!isConnected || !address || unlocking) return;
    setUnlocking(true); setClaimMsg("");
    try {
      const jwt = localStorage.getItem("arcadex_jwt");
      const r = await fetch("/api/games?action=battle-bp-unlock-premium", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Unlock failed");
      setConfettiColors(["#ffb700", "#ff8800", "#8b5cf6", "#ec4899", "#ffffff"]);
      setConfetti(true);
      setTimeout(() => setConfetti(false), 4500);
      setClaimMsg("✓ Premium unlocked!");
      setTimeout(() => setClaimMsg(""), 4000);
      await fetchStatus();
    } catch (err) {
      setClaimMsg("⚠ " + (err.message || "Unlock failed"));
    } finally {
      setUnlocking(false);
    }
  };

  const season       = status?.activeSeason;
  const player       = status?.player;
  const XP_PER_TIER  = season?.xpPerTier || 500;
  const numTiers     = season?.numTiers  || 50;
  const currentTier  = player?.currentTier || 0;
  const seasonXP     = player?.seasonXP   || 0;
  const isPremium    = player?.passType   === "premium";
  const claimedTiers = new Set(player?.claimedTiers || []);
  const totalXPForMax = XP_PER_TIER * numTiers;

  // Countdown
  const daysLeft = season?.endDate
    ? Math.max(0, Math.floor((season.endDate - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  // Progress within current tier
  const xpIntoTier = seasonXP - currentTier * XP_PER_TIER;
  const progressPct = Math.min(100, (xpIntoTier / XP_PER_TIER) * 100);

  return (
    <div style={{ minHeight: "calc(100vh - 54px)", position: "relative", overflow: "hidden" }}>
      <Seo title="Battle Pass" description="Earn XP, tier up, unlock rewards" path="/battle-pass" />

      <ParticleField />

      <style>{`
        @keyframes titleGlow {
          0%,100% { text-shadow: 0 0 15px ${C.violet}, 0 0 30px ${C.cyan}, 0 0 60px ${C.magenta}; }
          50%     { text-shadow: 0 0 25px ${C.violet}, 0 0 50px ${C.magenta}, 0 0 80px ${C.cyan}; }
        }
        @keyframes tierPulse {
          0%,100% { transform: translateY(0); }
          50%     { transform: translateY(-3px); }
        }
        @keyframes progressShine {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes premiumPulse {
          0%,100% { box-shadow: 0 0 25px ${C.gold}, 0 0 50px rgba(255,183,0,0.4); transform: scale(1); }
          50%     { box-shadow: 0 0 45px ${C.gold}, 0 0 80px rgba(255,183,0,0.6); transform: scale(1.02); }
        }
        @keyframes currentMarker {
          0%,100% { transform: translateY(0) scale(1); }
          50%     { transform: translateY(-4px) scale(1.1); }
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      {/* ═══ HEADER ═══ */}
      <div style={{
        position: "relative", zIndex: 5,
        padding: isMobile ? "16px 14px" : "24px 32px",
        display: "flex", alignItems: "center", gap: 16,
        borderBottom: `1px solid ${C.border}`,
        background: "linear-gradient(180deg, rgba(4,3,10,0.85), rgba(4,3,10,0.4))",
        backdropFilter: "blur(6px)",
      }}>
        <button onClick={() => navigate(-1)} style={{
          padding: "8px 16px", background: "rgba(0,0,0,0.6)",
          border: `1px solid ${C.border}`, borderRadius: 8,
          color: C.violetL, fontSize: 12, cursor: "pointer",
          fontFamily: C.raj, fontWeight: 700, flexShrink: 0,
          boxShadow: `0 0 12px rgba(139,92,246,0.3)`,
        }}>
          ← EXIT
        </button>

        <div style={{ flex: 1, textAlign: "center", position: "relative" }}>
          <div style={{
            fontFamily: C.orb, fontWeight: 900,
            fontSize: isMobile ? 22 : 36,
            color: "#fff",
            letterSpacing: isMobile ? "3px" : "6px",
            textTransform: "uppercase",
            animation: "titleGlow 3s ease-in-out infinite",
            lineHeight: 1,
          }}>
            ⚡ Battle Pass ⚡
          </div>
          {season && !isMobile && (
            <div style={{
              fontFamily: C.raj, fontSize: 12, color: C.cyan,
              letterSpacing: "4px", marginTop: 6,
              textShadow: `0 0 10px ${C.cyan}`,
              textTransform: "uppercase",
            }}>
              ▸ {season.name} ◂
            </div>
          )}
        </div>

        {daysLeft != null && !isMobile && (
          <div style={{
            padding: "8px 16px",
            background: "rgba(0,0,0,0.6)",
            border: `1px solid ${C.borderHot}`,
            borderRadius: 20,
            fontFamily: C.raj, fontWeight: 700, fontSize: 11,
            color: C.cyanL, letterSpacing: "1.5px",
            boxShadow: `0 0 20px rgba(0,229,255,0.3)`,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span>⏱</span> {daysLeft} DAYS LEFT
          </div>
        )}
      </div>

      {/* ═══ CONTENT ═══ */}
      <div style={{ position: "relative", zIndex: 3, padding: isMobile ? "16px 12px" : "24px 32px" }}>
        {loading ? (
          <div style={{ padding: 80, textAlign: "center" }}>
            <div style={{
              width: 60, height: 60, margin: "0 auto 20px",
              border: `4px solid rgba(139,92,246,0.2)`,
              borderTop: `4px solid ${C.violet}`,
              borderRadius: "50%",
              animation: "spinnerRing 1s linear infinite",
            }} />
            <div style={{ fontFamily: C.raj, fontSize: 14, color: C.violetL, letterSpacing: "2px" }}>
              Loading Battle Pass...
            </div>
            <style>{`@keyframes spinnerRing { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : error ? (
          <div style={{
            padding: 40, textAlign: "center",
            color: C.danger, fontFamily: C.raj, fontSize: 14,
          }}>
            ⚠ {error}
          </div>
        ) : !season ? (
          <div style={{ padding: 80, textAlign: "center" }}>
            <div style={{ fontSize: 80, marginBottom: 20 }}>⚡</div>
            <div style={{
              fontFamily: C.orb, fontSize: 20, color: C.violetL,
              letterSpacing: "4px", marginBottom: 12, textShadow: `0 0 10px ${C.violet}`,
            }}>
              NO ACTIVE SEASON
            </div>
            <div style={{ fontFamily: C.raj, fontSize: 13, color: C.dim, maxWidth: 400, margin: "0 auto" }}>
              Admin has not activated a Battle Pass season yet. Check back soon!
            </div>
          </div>
        ) : (
          <>
            {/* Tier + XP progress card */}
            <div style={{
              background: C.card,
              border: `2px solid ${C.borderHot}`,
              borderRadius: 16,
              padding: isMobile ? "18px 16px" : "24px 28px",
              marginBottom: 20,
              boxShadow: `0 0 40px rgba(0,229,255,0.2)`,
              backdropFilter: "blur(10px)",
              display: "flex", alignItems: "center",
              gap: isMobile ? 14 : 24,
              flexDirection: isMobile ? "column" : "row",
            }}>
              {/* Tier badge */}
              <div style={{
                width: isMobile ? 100 : 130,
                height: isMobile ? 100 : 130,
                borderRadius: "50%",
                background: `radial-gradient(circle, ${C.gold} 0%, ${C.violet} 60%, rgba(0,0,0,0.5) 100%)`,
                border: `3px solid ${C.gold}`,
                boxShadow: `0 0 40px ${C.gold}, inset 0 0 30px rgba(0,0,0,0.5)`,
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                <div style={{ fontFamily: C.raj, fontSize: 10, color: "#000", letterSpacing: "3px", fontWeight: 800 }}>
                  TIER
                </div>
                <div style={{
                  fontFamily: C.orb, fontWeight: 900,
                  fontSize: isMobile ? 34 : 46, color: "#000", lineHeight: 1,
                }}>
                  {currentTier}
                </div>
                <div style={{ fontFamily: C.raj, fontSize: 9, color: "#000", letterSpacing: "2px", fontWeight: 700, marginTop: 2 }}>
                  OF {numTiers}
                </div>
              </div>

              {/* XP bar area */}
              <div style={{ flex: 1, width: isMobile ? "100%" : "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, alignItems: "flex-end" }}>
                  <div>
                    <div style={{ fontFamily: C.orb, fontSize: 11, color: C.cyanL, letterSpacing: "2px", textTransform: "uppercase" }}>
                      Season XP
                    </div>
                    <div style={{ fontFamily: C.orb, fontWeight: 800, fontSize: 22, color: "#fff", textShadow: `0 0 10px ${C.cyan}` }}>
                      {seasonXP.toLocaleString()} <span style={{ color: C.dim, fontSize: 14 }}>/ {totalXPForMax.toLocaleString()}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: C.raj, fontSize: 10, color: C.dim, letterSpacing: "1.5px", textTransform: "uppercase" }}>
                      Next tier
                    </div>
                    <div style={{ fontFamily: C.orb, fontSize: 14, color: C.gold, textShadow: `0 0 8px ${C.gold}` }}>
                      {xpIntoTier}/{XP_PER_TIER} XP
                    </div>
                  </div>
                </div>
                {/* Progress bar */}
                <div style={{
                  width: "100%", height: 14,
                  background: "rgba(0,0,0,0.5)",
                  border: `1px solid ${C.border}`,
                  borderRadius: 7, overflow: "hidden", position: "relative",
                }}>
                  <div style={{
                    width: `${progressPct}%`, height: "100%",
                    background: `linear-gradient(90deg, ${C.violet}, ${C.cyan}, ${C.gold})`,
                    backgroundSize: "200% 100%",
                    animation: "progressShine 3s linear infinite",
                    boxShadow: `0 0 15px ${C.cyan}`,
                    transition: "width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  }} />
                </div>
                {isMobile && daysLeft != null && (
                  <div style={{ marginTop: 10, fontFamily: C.raj, fontSize: 11, color: C.cyanL, textAlign: "center" }}>
                    ⏱ {daysLeft} days left in season
                  </div>
                )}
              </div>

              {/* Premium status / unlock CTA */}
              {isPremium ? (
                <div style={{
                  padding: "12px 20px",
                  background: `linear-gradient(135deg, ${C.gold}, #ff8800)`,
                  border: "none", borderRadius: 12,
                  fontFamily: C.orb, fontWeight: 900,
                  fontSize: 13, color: "#000",
                  letterSpacing: "2px", textShadow: "none",
                  boxShadow: `0 0 25px ${C.gold}`,
                  flexShrink: 0,
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <span style={{ fontSize: 18 }}>👑</span>
                  PREMIUM
                </div>
              ) : (
                <button
                  onClick={handleUnlockPremium}
                  disabled={unlocking || !isConnected}
                  style={{
                    padding: "16px 24px",
                    background: `linear-gradient(135deg, ${C.gold}, #ff8800, ${C.gold})`,
                    border: "none", borderRadius: 12,
                    color: "#000",
                    fontFamily: C.orb, fontWeight: 900,
                    fontSize: 13,
                    letterSpacing: "2px", textTransform: "uppercase",
                    cursor: (unlocking || !isConnected) ? "not-allowed" : "pointer",
                    opacity: (unlocking || !isConnected) ? 0.6 : 1,
                    animation: (unlocking || !isConnected) ? "none" : "premiumPulse 1.5s ease-in-out infinite",
                    flexShrink: 0,
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                  }}
                >
                  <span>{unlocking ? "..." : "⚡ UNLOCK PREMIUM"}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1.5px" }}>
                    {season.premiumPriceARCADE} ARCADE
                  </span>
                </button>
              )}
            </div>

            {/* Toast */}
            {claimMsg && (
              <div style={{
                padding: "12px 18px", marginBottom: 16, borderRadius: 10,
                background: claimMsg.startsWith("✓") ? "rgba(0,255,136,0.08)" : "rgba(255,56,96,0.08)",
                border: `1px solid ${claimMsg.startsWith("✓") ? C.green : C.danger}`,
                fontFamily: C.orb, fontWeight: 700, fontSize: 13,
                color: claimMsg.startsWith("✓") ? C.green : C.danger,
                letterSpacing: "1.5px", textAlign: "center",
                animation: "fadeIn 0.3s ease",
              }}>
                {claimMsg}
              </div>
            )}

            {/* Tier ladder */}
            <div style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 16,
              padding: "20px 0",
              overflow: "hidden",
              boxShadow: `0 0 30px rgba(0,0,0,0.5)`,
            }}>
              <div style={{ padding: "0 24px 12px", fontFamily: C.orb, fontSize: 13, color: C.violetL, letterSpacing: "3px", textTransform: "uppercase" }}>
                ▸ TIER LADDER ◂
              </div>

              <div ref={laddersRef} style={{
                overflowX: "auto",
                padding: "8px 20px 20px",
                scrollSnapType: "x mandatory",
                scrollbarColor: `${C.violet} transparent`,
                scrollbarWidth: "thin",
              }}>
                {/* PREMIUM row */}
                <div style={{
                  display: "flex", gap: 10,
                  marginBottom: 12,
                  paddingBottom: 8,
                }}>
                  {season.tiers.map((t) => {
                    const tierUnlocked = t.tier <= currentTier;
                    const key = `${season.seasonId}:${t.tier}:premium`;
                    const alreadyClaimed = claimedTiers.has(key);
                    const isPremDisabled = !isPremium;
                    return (
                      <TierRewardCard
                        key={`prem-${t.tier}`}
                        reward={t.premium}
                        unlocked={tierUnlocked && !isPremDisabled}
                        claimed={alreadyClaimed}
                        disabled={isPremDisabled}
                        disabledReason="Premium only"
                        claiming={claiming === `${t.tier}:premium`}
                        onClaim={() => handleClaim(t.tier, "premium")}
                        trackColor={C.gold}
                        trackGlow="rgba(255,183,0,0.5)"
                        trackLabel="PREMIUM"
                      />
                    );
                  })}
                </div>

                {/* TIER NUMBERS row (with current-tier marker) */}
                <div style={{
                  display: "flex", gap: 10, marginBottom: 12,
                  position: "relative",
                }}>
                  {season.tiers.map((t) => {
                    const isCurrent = t.tier === currentTier + 1;   // "next" tier
                    const isReached = t.tier <= currentTier;
                    return (
                      <div key={`num-${t.tier}`} style={{
                        width: 120, minWidth: 120,
                        display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                      }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: "50%",
                          background: isReached
                            ? `linear-gradient(135deg, ${C.gold}, ${C.violet})`
                            : "rgba(0,0,0,0.5)",
                          border: `2px solid ${isReached ? C.gold : C.dimMore}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontFamily: C.orb, fontWeight: 900, fontSize: 13,
                          color: isReached ? "#000" : C.dim,
                          boxShadow: isReached ? `0 0 12px ${C.gold}` : "none",
                        }}>
                          {t.tier}
                        </div>
                        {isCurrent && (
                          <div style={{
                            fontFamily: C.raj, fontSize: 9, fontWeight: 700, color: C.cyan,
                            letterSpacing: "1.5px", textShadow: `0 0 6px ${C.cyan}`,
                            animation: "currentMarker 1.2s ease-in-out infinite",
                          }}>
                            ▲ NEXT
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* FREE row */}
                <div style={{ display: "flex", gap: 10 }}>
                  {season.tiers.map((t) => {
                    const tierUnlocked = t.tier <= currentTier;
                    const key = `${season.seasonId}:${t.tier}:free`;
                    const alreadyClaimed = claimedTiers.has(key);
                    return (
                      <TierRewardCard
                        key={`free-${t.tier}`}
                        reward={t.free}
                        unlocked={tierUnlocked}
                        claimed={alreadyClaimed}
                        disabled={false}
                        claiming={claiming === `${t.tier}:free`}
                        onClaim={() => handleClaim(t.tier, "free")}
                        trackColor={C.cyan}
                        trackGlow="rgba(0,229,255,0.5)"
                        trackLabel="FREE"
                      />
                    );
                  })}
                </div>
              </div>
            </div>

            {/* XP guide */}
            <div style={{
              marginTop: 20, padding: "16px 22px",
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              backdropFilter: "blur(8px)",
            }}>
              <div style={{ fontFamily: C.orb, fontSize: 12, color: C.cyan, letterSpacing: "2px", marginBottom: 10, textTransform: "uppercase" }}>
                ⚡ How to earn XP
              </div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontFamily: C.raj, fontSize: 12, color: C.violetL }}>
                <span>• $1 earned in Battle Arena = <b style={{ color: C.gold }}>2 XP</b></span>
                <span>• Complete a round = <b style={{ color: C.gold }}>+20 XP</b></span>
                <span>• Round with $20+ = <b style={{ color: C.gold }}>+10 XP bonus</b></span>
                <span>• Complete all 5 rounds = <b style={{ color: C.gold }}>+100 XP</b></span>
              </div>
              <div style={{ marginTop: 12, fontFamily: C.raj, fontSize: 11, color: C.dim, letterSpacing: "1px" }}>
                Avg session (~$50 with 5 rounds) ≈ <b style={{ color: C.cyan }}>300 XP</b> — nearly a full tier!
              </div>
            </div>
          </>
        )}
      </div>

      {confetti && <ConfettiBurst colors={confettiColors} count={200} duration={4000} />}
    </div>
  );
}
