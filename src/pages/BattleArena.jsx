import { useEffect, useState, useRef, useCallback, memo, forwardRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount, usePublicClient, useWalletClient, useReadContract } from "wagmi";
import { writeContract, waitForTransactionReceipt } from "@wagmi/core";
import { wagmiAdapter } from "../Providers";
import { useChain } from "../context/ChainContext";
import { signInAndGetJwt, hasValidJwtForWallet } from "../hooks/useAutoAuth";
import { useTurnstile } from "../context/TurnstileContext";
import Seo from "../components/Seo";
import BattleShopOverlay from "../components/BattleShopOverlay";
import ConfettiBurst from "../components/ConfettiBurst";
import BattleResultRecap from "../components/BattleResultRecap";
import BattleMatchHistory from "../components/BattleMatchHistory";

// ── Contract ABI (minimal — only what we call) ─────────────────────────────
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
  {
    name: "dollarToArcadeRate", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "isSessionClaimed", type: "function", stateMutability: "view",
    inputs: [{ name: "sessionId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
];

// ── Design tokens ──────────────────────────────────────────────────────────
const C = {
  bg:        "#04030a",
  bgDeep:    "#020106",
  card:      "rgba(15,10,35,0.7)",
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

// ── Particle Canvas Background ─────────────────────────────────────────────
const ParticleField = memo(function ParticleField() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf, particles = [];
    const setSize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    setSize();
    window.addEventListener("resize", setSize);

    // Seed particles
    for (let i = 0; i < 140; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 2 + 0.4,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        hue: Math.random() < 0.6 ? 270 : (Math.random() < 0.5 ? 190 : 320), // violet / cyan / magenta
        alpha: Math.random() * 0.5 + 0.2,
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;  if (p.x > canvas.width)  p.x = 0;
        if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        grad.addColorStop(0,   `hsla(${p.hue}, 100%, 70%, ${p.alpha})`);
        grad.addColorStop(0.4, `hsla(${p.hue}, 100%, 60%, ${p.alpha * 0.4})`);
        grad.addColorStop(1,   `hsla(${p.hue}, 100%, 50%, 0)`);
        ctx.fillStyle = grad;
        ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", setSize); };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        background:
          "radial-gradient(ellipse at 20% 30%, rgba(139,92,246,0.15) 0%, transparent 50%)," +
          "radial-gradient(ellipse at 80% 70%, rgba(0,229,255,0.12) 0%, transparent 50%)," +
          "radial-gradient(ellipse at 50% 100%, rgba(236,72,153,0.08) 0%, transparent 60%)," +
          `linear-gradient(180deg, ${C.bgDeep} 0%, ${C.bg} 100%)`,
      }}
    />
  );
});

// ── Grid Overlay ───────────────────────────────────────────────────────────
const GridOverlay = memo(function GridOverlay() {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1, pointerEvents: "none",
        backgroundImage:
          "linear-gradient(rgba(139,92,246,0.04) 1px, transparent 1px)," +
          "linear-gradient(90deg, rgba(139,92,246,0.04) 1px, transparent 1px)",
        backgroundSize: "60px 60px",
        maskImage:    "radial-gradient(ellipse at center, black 40%, transparent 90%)",
        WebkitMaskImage: "radial-gradient(ellipse at center, black 40%, transparent 90%)",
      }}
    />
  );
});

// ── Game Frame with Fullscreen + Reload + Landscape (mobile) ───────────────
const GameFrame = memo(forwardRef(function GameFrame({
  url, isMobile, isFullscreen, onToggleFullscreen, onReload, reloadKey,
}, ref) {
  const containerStyle = isFullscreen
    ? {
        position: "fixed", inset: 0, zIndex: 9999, background: "#000",
        display: "flex", flexDirection: "column",
        paddingTop:    "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft:   "env(safe-area-inset-left, 0px)",
        paddingRight:  "env(safe-area-inset-right, 0px)",
      }
    : { position: "relative" };

  const iframeStyle = isFullscreen
    ? { flex: 1, width: "100%", border: "none", display: "block" }
    : {
        width: "100%",
        height: isMobile ? "56vw" : "calc(100vh - 54px - 220px)",
        minHeight: isMobile ? 240 : 500,
        border: "none",
        display: "block",
        background: "#000",
      };

  const btnBase = {
    padding: "8px 14px", background: "rgba(0,0,0,0.85)",
    border: `1px solid ${C.borderHot}`, borderRadius: 7,
    color: C.cyanL, fontSize: 11, cursor: "pointer",
    fontFamily: C.raj, fontWeight: 700,
    backdropFilter: "blur(8px)", display: "flex",
    alignItems: "center", gap: 5,
    boxShadow: `0 0 20px rgba(0,229,255,0.3)`,
    letterSpacing: "1.5px", textTransform: "uppercase",
    transition: "all 0.15s ease",
  };
  // Fullscreen overlay button style
  const overlayBtnStyle = {
    ...btnBase, position: "absolute",
    top:   `calc(12px + env(safe-area-inset-top, 0px))`,
    right: `calc(12px + env(safe-area-inset-right, 0px))`,
    zIndex: 10000,
    padding: isMobile ? "10px 16px" : "8px 14px",
    fontSize: isMobile ? 13 : 11,
  };

  return (
    <div style={containerStyle}>
      {/* Iframe — key prop forces remount on reload, giving a fresh game load */}
      <iframe
        key={reloadKey}
        ref={ref}
        src={url}
        style={iframeStyle}
        allow="fullscreen; autoplay; gyroscope; accelerometer; gamepad *"
        allowFullScreen
        title="Battle Arena"
      />

      {/* Fullscreen: overlay controls at top-right (Reload + Exit) */}
      {isFullscreen && (
        <>
          <button
            onClick={onReload}
            style={{ ...overlayBtnStyle, right: `calc(120px + env(safe-area-inset-right, 0px))` }}
            title="Reload game"
          >
            <span>↻</span> Reload
          </button>
          <button onClick={onToggleFullscreen} style={overlayBtnStyle}>
            <span>✕</span> Exit
          </button>
        </>
      )}

      {/* Not fullscreen: dedicated control bar BELOW the iframe — no overlap with game HUD */}
      {!isFullscreen && (
        <div style={{
          display: "flex", gap: 10, justifyContent: "flex-end",
          padding: "10px 4px 0",
          flexWrap: "wrap",
        }}>
          <button
            onClick={onReload}
            style={btnBase}
            title="Reload game (if stuck)"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(0,229,255,0.12)";
              e.currentTarget.style.boxShadow = `0 0 25px rgba(0,229,255,0.5)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(0,0,0,0.85)";
              e.currentTarget.style.boxShadow = `0 0 20px rgba(0,229,255,0.3)`;
            }}
          >
            <span>↻</span> Reload
          </button>
          <button
            onClick={onToggleFullscreen}
            style={btnBase}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(0,229,255,0.12)";
              e.currentTarget.style.boxShadow = `0 0 25px rgba(0,229,255,0.5)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(0,0,0,0.85)";
              e.currentTarget.style.boxShadow = `0 0 20px rgba(0,229,255,0.3)`;
            }}
          >
            <span>⛶</span> Fullscreen
          </button>
        </div>
      )}
    </div>
  );
}));

// ── Portrait Warning (mobile only) ─────────────────────────────────────────
// Battle Arena is designed for landscape orientation — show a rotate hint
// when a phone is held vertically.
function PortraitWarning({ visible }) {
  if (!visible) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100000,
      background: "linear-gradient(180deg, #04030a 0%, #12081f 100%)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: 24, textAlign: "center",
    }}>
      <div style={{
        fontSize: 72, marginBottom: 24,
        animation: "rotateHint 1.5s ease-in-out infinite",
        filter: `drop-shadow(0 0 20px ${C.cyan})`,
      }}>
        📱
      </div>
      <div style={{
        fontFamily: C.orb, fontWeight: 900, fontSize: 20,
        color: C.cyanL, letterSpacing: "3px",
        textTransform: "uppercase", marginBottom: 12,
        textShadow: `0 0 15px ${C.cyan}`,
      }}>
        Rotate Your Device
      </div>
      <div style={{
        fontFamily: C.raj, fontWeight: 500, fontSize: 14,
        color: C.violetL, maxWidth: 320, lineHeight: 1.5,
      }}>
        Battle Arena is best played in <b style={{ color: C.gold }}>landscape mode</b>.
        Turn your phone sideways to enter combat.
      </div>
      <style>{`
        @keyframes rotateHint {
          0%,100% { transform: rotate(0deg); }
          50%     { transform: rotate(90deg); }
        }
      `}</style>
    </div>
  );
}

// ── Round Card ─────────────────────────────────────────────────────────────
function RoundCard({ round, status, dollars, xpFlash }) {
  // status: "locked" | "active" | "complete"
  const stateColors = {
    locked:   { bg: "rgba(20,15,45,0.5)", border: C.dimMore,    text: C.dimMore,  glow: "none" },
    active:   { bg: "rgba(0,229,255,0.08)", border: C.cyan,      text: C.cyanL,   glow: `0 0 30px rgba(0,229,255,0.5), inset 0 0 20px rgba(0,229,255,0.1)` },
    complete: { bg: "rgba(0,255,136,0.06)", border: C.green,     text: C.green,   glow: `0 0 20px rgba(0,255,136,0.3)` },
  };
  const s = stateColors[status];

  return (
    <div
      style={{
        position: "relative",
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 14px",
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 10,
        boxShadow: s.glow,
        transition: "all 0.4s ease",
        overflow: "hidden",
        animation: status === "active" ? "roundPulse 1.4s ease-in-out infinite" : "none",
      }}
    >
      {/* Round number badge */}
      <div
        style={{
          width: 40, height: 40,
          borderRadius: "50%",
          background: status === "complete"
            ? `linear-gradient(135deg, ${C.green}, #00cc6a)`
            : status === "active"
              ? `linear-gradient(135deg, ${C.cyan}, ${C.violet})`
              : "rgba(0,0,0,0.4)",
          border: `2px solid ${s.border}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: C.orb, fontWeight: 700, fontSize: 15,
          color: status === "locked" ? C.dim : "#fff",
          boxShadow: status !== "locked" ? `0 0 15px ${s.border}` : "none",
          flexShrink: 0,
        }}
      >
        {status === "locked" ? "🔒" : round}
      </div>

      {/* Label + status */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: C.raj, fontWeight: 700, fontSize: 12,
            color: s.text, textTransform: "uppercase", letterSpacing: "1.5px",
            textShadow: status !== "locked" ? `0 0 8px ${s.border}` : "none",
          }}
        >
          ROUND {round}
        </div>
        <div
          style={{
            fontFamily: C.raj, fontSize: 10,
            color: s.text, opacity: 0.7, marginTop: 2,
          }}
        >
          {status === "locked"   && "Awaiting..."}
          {status === "active"   && "◉ IN COMBAT"}
          {status === "complete" && "✓ Complete"}
        </div>
      </div>

      {/* Dollar amount */}
      <div
        style={{
          position: "relative",
          fontFamily: C.orb, fontWeight: 700,
          fontSize: 18,
          color: status === "complete" ? C.green : status === "active" ? C.cyanL : C.dimMore,
          textShadow: status === "complete"
            ? `0 0 12px ${C.green}`
            : status === "active"
              ? `0 0 12px ${C.cyan}`
              : "none",
        }}
      >
        {dollars != null ? `$${dollars}` : "—"}
        {/* +XP flash badge */}
        {xpFlash > 0 && (
          <div
            style={{
              position: "absolute",
              top: -18, right: -6,
              padding: "2px 7px",
              background: `linear-gradient(135deg, ${C.gold}, #ff8800)`,
              borderRadius: 4,
              fontFamily: C.orb, fontSize: 9, fontWeight: 800,
              color: "#000", letterSpacing: "1px",
              boxShadow: `0 0 12px ${C.gold}`,
              animation: "xpFlash 2.4s ease-out forwards",
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            +{xpFlash} XP
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function BattleArena() {
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  const {
    chainKey, contracts, chainId, chainName, explorerUrl,
  } = useChain();
  const BATTLE_ARENA_ADDRESS = contracts?.battleArena;

  // ARCADE token address — try chain context first, then fall back to known
  // deployed addresses per chain. This makes the balance card work even if
  // the ChainContext doesn't expose the token address under `arcadeToken`.
  const ARCADE_TOKEN_ADDRESSES = {
    mst:      "0xA3C5ffB1B9d0640e72720D0A029878262943D943",
    botchain: "0x66D4484CE37CB5108A7846E7D97E0d38e5e141c8",
  };
  const ARCADE_TOKEN_ADDRESS =
    contracts?.arcadeToken ||
    contracts?.arcade ||
    contracts?.token ||
    ARCADE_TOKEN_ADDRESSES[chainKey] ||
    null;

  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { getToken: getTurnstileToken } = useTurnstile();

  // ── Live ARCADE balance read ──
  // Refreshes every 15s + immediately after a claim/purchase.
  const { data: arcadeBalanceRaw, refetch: refetchArcadeBalance } = useReadContract({
    address:      ARCADE_TOKEN_ADDRESS,
    abi:          [{
      name: "balanceOf", type: "function", stateMutability: "view",
      inputs:  [{ name: "account", type: "address" }],
      outputs: [{ name: "", type: "uint256" }],
    }],
    functionName: "balanceOf",
    args:         address ? [address] : undefined,
    chainId:      chainId,
    query: {
      enabled: !!address && !!ARCADE_TOKEN_ADDRESS,
      refetchInterval: 15000,
    },
  });
  const arcadeBalance = arcadeBalanceRaw
    ? Number(BigInt(arcadeBalanceRaw) / 10n ** 16n) / 100  // 2 decimal precision
    : 0;

  // ── Session state ──
  const [sessionId, setSessionId]       = useState(null);
  const [sessionToken, setSessionToken] = useState(null);
  const sessionRef = useRef({ sessionId: null, sessionToken: null }); // for stale-closure fix
  const [sessionError, setSessionError] = useState(null);

  // ── Inventory (owned shop items) ──
  const [inventory, setInventory] = useState([]);       // array of itemIds
  const inventoryRef = useRef([]);                       // stale-closure fix for message handler
  // ── Equipped loadout (skins + powerups currently active) ──
  const equippedRef = useRef([]);

  // ── Battle progress state ──
  const [rounds, setRounds]           = useState([]); // [{ round, dollars }]
  const [totalDollars, setTotalDollars] = useState(0);
  const [currentRound, setCurrentRound] = useState(0);
  const [gameCompleted, setGameCompleted] = useState(false);

  // ── Shop overlay ──
  const [shopOpen, setShopOpen] = useState(false);

  // ── Match history overlay ──
  const [historyOpen, setHistoryOpen] = useState(false);

  // ── Confetti (celebrations) ──
  const [confettiActive, setConfettiActive] = useState(false);

  // ── Post-battle recap (auto-shows when gameCompleted, dismissible) ──
  const [recapDismissedFor, setRecapDismissedFor] = useState(null); // sessionId dismissed

  // ── Battle Pass sidebar state ──
  const [bpStatus, setBpStatus] = useState(null); // { seasonName, tier, seasonXP, xpPerTier, maxTier, passType }
  const bpStatusRef = useRef(null);
  // Round-end XP flash animations — keyed by round number
  const [roundXpFlashes, setRoundXpFlashes] = useState({}); // { round: xpAmount }
  // Tier-up flash — shown briefly when tier increases mid-battle
  const [tierUpFlash, setTierUpFlash] = useState(null);     // { from, to }

  // ── Claim state ──
  const [claimStage, setClaimStage] = useState(null); // null | 'signing' | 'wallet' | 'confirming' | 'success' | 'failed'
  const [claimError, setClaimError] = useState(null);
  const [txHash, setTxHash]         = useState("");
  const [arcadeAmount, setArcadeAmount] = useState(null);
  const [dollarRate, setDollarRate] = useState(1); // ARCADE per dollar (whole units, for display)

  // ── Fullscreen (same pattern as GamePlay) ──
  const [isFakeFullscreen, setIsFakeFullscreen]   = useState(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const isFullscreen = isNativeFullscreen || isFakeFullscreen;
  const iframeRef = useRef(null);

  // ── Reload counter — increment to force iframe remount ──
  const [reloadKey, setReloadKey] = useState(0);
  const handleReloadGame = useCallback(() => {
    // Reset all UI state that ties to the current session, then increment
    // key so the iframe fully remounts (fresh game load, fresh SDK init).
    setReloadKey(k => k + 1);
  }, []);

  // ── Portrait warning (mobile only) ──
  const [isPortrait, setIsPortrait] = useState(false);
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Only trigger portrait warning on actual phones (small screens),
      // not on desktop windows that happen to be taller than wide.
      setIsPortrait(w <= 768 && h > w);
    };
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  const BATTLE_GAME_URL = import.meta.env.VITE_BATTLE_ARENA_URL;

  // ─── Effects: window / fullscreen / mobile ───
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      setIsNativeFullscreen(!!fsEl);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
    };
  }, []);

  useEffect(() => {
    if (!isFakeFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isFakeFullscreen]);

  useEffect(() => {
    if (!isFakeFullscreen) return;
    const onKey = (e) => { if (e.key === "Escape") setIsFakeFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFakeFullscreen]);

  const handleToggleFullscreen = useCallback(() => {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      try { exit?.call(document); } catch { /* no-op */ }
      // Also clear the fake-fullscreen state in case both were somehow active
      setIsFakeFullscreen(false);
      return;
    }
    if (isFakeFullscreen) { setIsFakeFullscreen(false); return; }

    // Mobile: skip native fullscreen (spotty support). Use fake fullscreen
    // + orientation lock for the best experience.
    if (isMobile) {
      setIsFakeFullscreen(true);
      // Try to lock landscape — no-op on iOS Safari, works on Android
      try {
        screen.orientation?.lock?.("landscape").catch(() => {});
      } catch { /* not supported */ }
      return;
    }

    const iframe = iframeRef.current;
    const nativeFS = iframe?.requestFullscreen || iframe?.webkitRequestFullscreen;
    if (!nativeFS) { setIsFakeFullscreen(true); return; }

    // Safety timeout: if native fullscreen doesn't respond in 800ms, fall
    // back to fake — prevents the "stuck loading" bug where the browser
    // never resolves the promise (rare, but happens when clicking during
    // page navigation or before user gesture registers).
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        setIsFakeFullscreen(true);
      }
    }, 800);

    try {
      const p = nativeFS.call(iframe);
      if (p && typeof p.then === "function") {
        p.then(() => { settled = true; clearTimeout(timeoutId); })
         .catch(() => {
           settled = true;
           clearTimeout(timeoutId);
           setIsFakeFullscreen(true);
         });
      } else {
        settled = true;
        clearTimeout(timeoutId);
      }
    } catch {
      settled = true;
      clearTimeout(timeoutId);
      setIsFakeFullscreen(true);
    }
  }, [isMobile, isFakeFullscreen]);

  // ─── Fetch on-chain dollar → ARCADE rate for UI display ───
  useEffect(() => {
    if (!BATTLE_ARENA_ADDRESS || !publicClient) return;
    (async () => {
      try {
        const rate = await publicClient.readContract({
          address: BATTLE_ARENA_ADDRESS,
          abi: BATTLE_ARENA_ABI,
          functionName: "dollarToArcadeRate",
        });
        // rate is in wei per dollar (e.g. 1e18 = 1 ARCADE per dollar)
        const rateWhole = Number(rate) / 1e18;
        setDollarRate(rateWhole);
      } catch (e) {
        console.warn("[BattleArena] dollarToArcadeRate read failed:", e.message);
      }
    })();
  }, [BATTLE_ARENA_ADDRESS, publicClient]);

  // ─── Start session on wallet connect + chain ───
  // Exposed via ref so recap "View later" can trigger a fresh session
  // without duplicating the logic.
  const startSessionRef = useRef(null);

  useEffect(() => {
    if (!address || !chainKey) return;
    let cancelled = false;

    const startSession = async () => {
      try {
        setSessionError(null);
        // Ensure JWT before session start
        let token = localStorage.getItem("arcadex_jwt");
        if (!token || !hasValidJwtForWallet(address)) {
          const tsToken = await getTurnstileToken().catch(() => null);
          token = await signInAndGetJwt({ address, walletClient, turnstileToken: tsToken });
        }
        if (!token) throw new Error("Wallet sign-in required");

        const res = await fetch("/api/games?action=battle-start-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ chain: chainKey }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Session start failed");
        if (cancelled) return;

        setSessionId(data.sessionId);
        setSessionToken(data.sessionToken);
        sessionRef.current = { sessionId: data.sessionId, sessionToken: data.sessionToken };

        // Reset battle progress on new session
        setRounds([]);
        setTotalDollars(0);
        setCurrentRound(0);
        setGameCompleted(false);
        setClaimStage(null);
        setClaimError(null);
        setTxHash("");
        setArcadeAmount(null);
      } catch (err) {
        console.error("[battle-start-session]", err);
        if (!cancelled) setSessionError(err.message);
      }
    };

    startSessionRef.current = startSession;
    startSession();
    return () => { cancelled = true; };
  }, [address, chainKey, walletClient]);

  // ─── Fetch inventory (owned shop items) on wallet connect ───
  // Used to seed BATTLE_INVENTORY sent to the game on BATTLE_READY, and
  // to know what to sync back after purchases. Purchase-side updates
  // append to inventoryRef locally + resend to game (see onItemUnlocked
  // callback below on the BattleShopOverlay).
  useEffect(() => {
    if (!address) {
      setInventory([]);
      inventoryRef.current = [];
      return;
    }
    let cancelled = false;
    const loadInventory = async () => {
      try {
        const token = localStorage.getItem("arcadex_jwt");
        if (!token) return;
        const res = await fetch("/api/games?action=battle-shop-inventory", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const items = (data.items || []).map(x => x.itemId).filter(Boolean);
        setInventory(items);
        inventoryRef.current = items;
        // Also process equipped loadout — combine skins slot map + powerUps into a flat list
        const equippedMap = data.equipped || {};
        const powerUps    = data.powerUps || [];
        const activeItems = [...Object.values(equippedMap), ...powerUps].filter(Boolean);
        equippedRef.current = activeItems;
        // Push both to game
        sendToGame("BATTLE_INVENTORY", { items });
        sendToGame("BATTLE_EQUIPPED",  { activeItems });
      } catch (err) {
        console.warn("[battle-shop-inventory]", err.message);
      }
    };
    loadInventory();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // ─── Fetch Battle Pass status ───
  useEffect(() => {
    if (!address) { setBpStatus(null); bpStatusRef.current = null; return; }
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem("arcadex_jwt");
        if (!token) return;
        const res = await fetch("/api/games?action=battle-bp-status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data.activeSeason) return;
        const bp = {
          seasonId:   data.activeSeason.seasonId,
          seasonName: data.activeSeason.name,
          xpPerTier:  data.activeSeason.xpPerTier,
          maxTier:    data.activeSeason.numTiers,
          tier:       data.player?.currentTier || 0,
          seasonXP:   data.player?.seasonXP    || 0,
          passType:   data.player?.passType    || "free",
        };
        setBpStatus(bp);
        bpStatusRef.current = bp;
      } catch (err) {
        console.warn("[battle-bp-status]", err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [address]);

  // ─── postMessage helper: platform → game ───
  const getGameOrigin = () => {
    try {
      if (BATTLE_GAME_URL) return new URL(BATTLE_GAME_URL, window.location.origin).origin;
    } catch { /* noop */ }
    return null;
  };
  const sendToGame = useCallback((type, payload) => {
    const origin = getGameOrigin();
    if (!origin) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type, _platform: true, ...payload }, origin
    );
  }, []);

  // ─── SDK message listener (game → platform) ───
  useEffect(() => {
    if (!BATTLE_GAME_URL) return;
    let allowedOrigin = null;
    try { allowedOrigin = new URL(BATTLE_GAME_URL, window.location.origin).origin; }
    catch { allowedOrigin = null; }

    const handleMessage = async (event) => {
      if (!allowedOrigin) return;
      if (event.origin !== allowedOrigin) return;
      if (!event.data?._arcadex_battle) return;

      const d = event.data;

      switch (d.type) {
        case "BATTLE_READY":
        case "BATTLE_GET_PLAYER_INFO": {
          // Send player info + session token back to game
          const s = sessionRef.current;
          sendToGame("BATTLE_PLAYER_INFO", {
            address:      address || "",
            chainName:    chainName || "",
            chainId:      chainId || 0,
            sessionToken: s.sessionToken || null,
          });
          // Also push the current inventory so the game can apply skins
          // immediately on boot (v1.1.0 SDK)
          sendToGame("BATTLE_INVENTORY", { items: inventoryRef.current });
          sendToGame("BATTLE_EQUIPPED",  { activeItems: equippedRef.current });
          break;
        }

        case "BATTLE_GET_INVENTORY": {
          // Game requested an inventory refresh (e.g. after scene reload)
          sendToGame("BATTLE_INVENTORY", { items: inventoryRef.current });
          sendToGame("BATTLE_EQUIPPED",  { activeItems: equippedRef.current });
          break;
        }

        case "BATTLE_OPEN_SHOP": {
          // Game requested platform to open the shop overlay
          setShopOpen(true);
          break;
        }

        case "BATTLE_ROUND_START": {
          const r = parseInt(d.round);
          if (r >= 1 && r <= 5) setCurrentRound(r);
          break;
        }

        case "BATTLE_ROUND_END": {
          const r = parseInt(d.round);
          const dollars = parseInt(d.dollars);
          if (!(r >= 1 && r <= 5) || !Number.isFinite(dollars) || dollars < 0) break;

          const s = sessionRef.current;
          if (!s.sessionId || !s.sessionToken) break;

          // Optimistic UI — show immediately, backend will validate
          setRounds(prev => {
            if (prev.find(x => x.round === r)) return prev;
            return [...prev, { round: r, dollars }];
          });
          setTotalDollars(prev => prev + dollars);

          // Record with backend
          try {
            const token = localStorage.getItem("arcadex_jwt");
            const res = await fetch("/api/games?action=battle-round", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                sessionId:    s.sessionId,
                sessionToken: s.sessionToken,
                round: r,
                dollars,
              }),
            });
            const data = await res.json();
            if (!res.ok) {
              console.error("[battle-round] rejected:", data.error);
              // Roll back optimistic update
              setRounds(prev => prev.filter(x => x.round !== r));
              setTotalDollars(prev => prev - dollars);
            } else {
              // Sync total to server's authoritative value
              setTotalDollars(data.totalDollars);

              // ── Handle XP payload (Battle Pass) ──
              if (data.xp) {
                const { earned, seasonXP, tierBefore, tierAfter, tieredUp, xpPerTier, maxTier } = data.xp;
                // Flash "+XP" on the round card
                if (earned > 0) {
                  setRoundXpFlashes(prev => ({ ...prev, [r]: earned }));
                  setTimeout(() => {
                    setRoundXpFlashes(prev => {
                      const c = { ...prev }; delete c[r]; return c;
                    });
                  }, 2500);
                }
                // Update sidebar BP state
                const newBP = {
                  ...(bpStatusRef.current || {}),
                  tier:     tierAfter,
                  seasonXP: seasonXP,
                  xpPerTier: xpPerTier,
                  maxTier:  maxTier,
                };
                setBpStatus(newBP);
                bpStatusRef.current = newBP;
                // Tier up celebration
                if (tieredUp) {
                  setTierUpFlash({ from: tierBefore, to: tierAfter });
                  setTimeout(() => setTierUpFlash(null), 3500);
                }
              }
            }
          } catch (err) {
            console.error("[battle-round]", err);
          }
          break;
        }

        case "BATTLE_GAME_COMPLETE":
          setGameCompleted(true);
          break;

        default:
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [BATTLE_GAME_URL, address, chainName, chainId, sendToGame]);

  // ─── Claim handler ───
  const handleClaim = async () => {
    if (!isConnected || !address || !BATTLE_ARENA_ADDRESS) return;
    const s = sessionRef.current;
    if (!s.sessionId || !s.sessionToken) return;
    if (claimStage) return; // already in progress

    setClaimError(null);
    setClaimStage("signing");
    sendToGame("BATTLE_CLAIM_STARTED", {});

    try {
      // 1. Get signature from backend
      const token = localStorage.getItem("arcadex_jwt");
      const signRes = await fetch("/api/games?action=battle-sign-claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sessionId:    s.sessionId,
          sessionToken: s.sessionToken,
        }),
      });
      const signData = await signRes.json();
      if (!signRes.ok) throw new Error(signData.error || "Signing failed");

      // 2. Submit on-chain
      setClaimStage("wallet");
      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: BATTLE_ARENA_ADDRESS,
        abi: BATTLE_ARENA_ABI,
        functionName: "claim",
        args: [
          signData.sessionIdBytes32,
          BigInt(signData.dollars),
          signData.signature,
        ],
        chainId,
      });
      setTxHash(hash);

      // 3. Wait for receipt
      setClaimStage("confirming");
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash, chainId });

      // 4. Record on backend
      await fetch("/api/games?action=battle-record-claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sessionId:    s.sessionId,
          sessionToken: s.sessionToken,
          txHash: hash,
        }),
      });

      // 5. Compute arcade amount for display + notify game
      const amt = totalDollars * dollarRate;
      setArcadeAmount(amt);
      setClaimStage("success");
      sendToGame("BATTLE_CLAIM_SUCCESS", {
        txHash: hash,
        arcadeAmount: String(amt),
        explorerUrl: `${explorerUrl}/tx/${hash}`,
      });

      // Trigger balance refresh so the sidebar card shows the new ARCADE
      try { refetchArcadeBalance?.(); } catch { /* no-op */ }

      // 🎉 Full-screen celebration
      setConfettiActive(true);
      setTimeout(() => setConfettiActive(false), 4500);

    } catch (err) {
      console.error("[claim]", err);
      const msg = err?.shortMessage || err?.message || "Claim failed";
      const friendly = /user rejected|user denied/i.test(msg)
        ? "Transaction cancelled"
        : msg;
      setClaimError(friendly);
      setClaimStage("failed");
      sendToGame("BATTLE_CLAIM_FAILED", { error: friendly });
    }
  };

  // ─── Derive round status ───
  const roundStates = [1, 2, 3, 4, 5].map(r => {
    const done = rounds.find(x => x.round === r);
    if (done)                                       return { round: r, status: "complete", dollars: done.dollars };
    if (r === currentRound || (r === rounds.length + 1 && !gameCompleted))
      return { round: r, status: "active", dollars: null };
    return { round: r, status: "locked", dollars: null };
  });

  const canClaim = gameCompleted && rounds.length === 5 && !claimStage;
  const claimReward = totalDollars * dollarRate;

  return (
    <div style={{ minHeight: "calc(100vh - 54px)", position: "relative", overflow: "hidden" }}>
      <Seo
        title="Battle Arena"
        description="5-round PvP battle arena — earn ARCADE tokens per kill"
        path="/battle-arena"
      />

      <ParticleField />
      <GridOverlay />

      {/* Ambient glow orbs */}
      <div
        style={{
          position: "fixed", top: "20%", left: "8%", width: 300, height: 300,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${C.violet}22 0%, transparent 65%)`,
          zIndex: 1, pointerEvents: "none",
          animation: "ambientDrift1 12s ease-in-out infinite",
          filter: "blur(30px)",
        }}
      />
      <div
        style={{
          position: "fixed", bottom: "15%", right: "6%", width: 350, height: 350,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${C.cyan}18 0%, transparent 65%)`,
          zIndex: 1, pointerEvents: "none",
          animation: "ambientDrift2 15s ease-in-out infinite",
          filter: "blur(30px)",
        }}
      />

      {/* Scanline */}
      <div
        style={{
          position: "fixed", left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, transparent, ${C.cyan}, transparent)`,
          boxShadow: `0 0 20px ${C.cyan}`,
          zIndex: 2, pointerEvents: "none",
          animation: "scanline 8s linear infinite",
        }}
      />

      {/* Corner HUD brackets */}
      {["top-left", "top-right", "bottom-left", "bottom-right"].map((pos) => {
        const [v, h] = pos.split("-");
        return (
          <svg
            key={pos}
            width="60" height="60"
            style={{
              position: "fixed",
              [v]: 60, [h]: 12,
              zIndex: 4, pointerEvents: "none",
              transform:
                pos === "top-right"    ? "scaleX(-1)" :
                pos === "bottom-left"  ? "scaleY(-1)" :
                pos === "bottom-right" ? "scale(-1,-1)" : "none",
              animation: "cornerHudGlow 2.5s ease-in-out infinite",
            }}
          >
            <path
              d="M2 25 L2 4 L25 4"
              stroke={C.cyan}
              strokeWidth="2"
              fill="none"
              opacity="0.7"
            />
            <circle cx="4" cy="4" r="2" fill={C.cyan} />
          </svg>
        );
      })}

      <style>{`
        @keyframes roundPulse {
          0%,100% { box-shadow: 0 0 30px rgba(0,229,255,0.5), inset 0 0 20px rgba(0,229,255,0.1); }
          50%     { box-shadow: 0 0 45px rgba(0,229,255,0.8), inset 0 0 30px rgba(0,229,255,0.2); }
        }
        @keyframes titleGlow {
          0%,100% { text-shadow: 0 0 12px ${C.violet}, 0 0 24px ${C.violet}, 0 0 40px ${C.cyan}, 4px 4px 0 rgba(0,229,255,0.15); }
          50%     { text-shadow: 0 0 20px ${C.violet}, 0 0 40px ${C.magenta}, 0 0 60px ${C.cyan}, 4px 4px 0 rgba(0,229,255,0.3); }
        }
        @keyframes ringRotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes iframeBorderGlow {
          0%,100% { box-shadow: 0 0 20px ${C.violet}, 0 0 40px rgba(139,92,246,0.4), inset 0 0 30px rgba(139,92,246,0.1); }
          50%     { box-shadow: 0 0 30px ${C.cyan}, 0 0 60px rgba(0,229,255,0.5), inset 0 0 40px rgba(0,229,255,0.15); }
        }
        @keyframes claimPulse {
          0%,100% { box-shadow: 0 0 30px ${C.gold}, 0 0 60px rgba(255,183,0,0.5), inset 0 0 20px rgba(255,183,0,0.2); transform: scale(1); }
          50%     { box-shadow: 0 0 50px ${C.gold}, 0 0 100px rgba(255,183,0,0.7), inset 0 0 30px rgba(255,183,0,0.3); transform: scale(1.02); }
        }
        @keyframes scanline {
          0%   { transform: translateY(-100%); opacity: 0; }
          5%   { opacity: 1; }
          100% { transform: translateY(100vh); opacity: 0.4; }
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spinnerRing { to { transform: rotate(360deg); } }
        @keyframes ambientDrift1 {
          0%,100% { transform: translate(0,0) scale(1); }
          50%     { transform: translate(60px,-40px) scale(1.15); }
        }
        @keyframes ambientDrift2 {
          0%,100% { transform: translate(0,0) scale(1); }
          50%     { transform: translate(-50px,50px) scale(1.1); }
        }
        @keyframes shopPulse {
          0%,100% { box-shadow: 0 0 20px ${C.violet}, 0 0 40px rgba(139,92,246,0.5), inset 0 0 15px rgba(139,92,246,0.3); }
          50%     { box-shadow: 0 0 30px ${C.cyan}, 0 0 60px rgba(0,229,255,0.6), inset 0 0 20px rgba(0,229,255,0.4); }
        }
        @keyframes potionBubble {
          0%,100% { transform: translateY(0) scale(1); opacity: 0.6; }
          50%     { transform: translateY(-4px) scale(1.1); opacity: 1; }
        }
        @keyframes numberTick {
          0%   { transform: scale(1); }
          40%  { transform: scale(1.15); text-shadow: 0 0 30px ${C.gold}, 0 0 60px ${C.gold}; }
          100% { transform: scale(1); }
        }
        @keyframes cornerHudGlow {
          0%,100% { opacity: 0.7; }
          50%     { opacity: 1; filter: drop-shadow(0 0 8px ${C.cyan}); }
        }
        @keyframes xpFlash {
          0%   { opacity: 0; transform: translateY(6px) scale(0.7); }
          20%  { opacity: 1; transform: translateY(0) scale(1.15); }
          40%  { transform: translateY(-4px) scale(1); }
          80%  { opacity: 1; transform: translateY(-10px) scale(1); }
          100% { opacity: 0; transform: translateY(-16px) scale(0.9); }
        }
        @keyframes bpBarShine {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes tierUpBanner {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
          20%  { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
          30%  { transform: translate(-50%, -50%) scale(1); }
          80%  { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(1.1); }
        }
      `}</style>

      {/* ═══ HEADER ═══ */}
      <div
        style={{
          position: "relative", zIndex: 5,
          padding: isMobile ? "16px 14px" : "20px 32px",
          display: "flex", alignItems: "center", gap: 16,
          borderBottom: `1px solid ${C.border}`,
          background: "linear-gradient(180deg, rgba(4,3,10,0.8) 0%, rgba(4,3,10,0.4) 100%)",
          backdropFilter: "blur(6px)",
        }}
      >
        <button
          onClick={() => navigate(-1)}
          style={{
            padding: "8px 16px",
            background: "rgba(0,0,0,0.6)",
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            color: C.violetL,
            fontSize: 12, cursor: "pointer",
            fontFamily: C.raj, fontWeight: 700,
            backdropFilter: "blur(8px)", flexShrink: 0,
            boxShadow: `0 0 12px rgba(139,92,246,0.3)`,
          }}
        >
          ← EXIT
        </button>

        <div style={{ flex: 1, textAlign: "center", position: "relative" }}>
          <div
            style={{
              fontFamily: C.orb, fontWeight: 900,
              fontSize: isMobile ? 22 : 40,
              color: "#fff",
              letterSpacing: isMobile ? "3px" : "6px",
              textTransform: "uppercase",
              animation: "titleGlow 3s ease-in-out infinite",
              lineHeight: 1,
            }}
          >
            ⚔ Battle Arena ⚔
          </div>
          {!isMobile && (
            <div
              style={{
                fontFamily: C.raj, fontSize: 10,
                color: C.cyan, letterSpacing: "4px",
                textTransform: "uppercase", marginTop: 6,
                textShadow: `0 0 10px ${C.cyan}`,
              }}
            >
              ▸ 5 rounds · earn dollars · claim ARCADE ◂
            </div>
          )}
        </div>

        {/* History button — clock icon */}
        <button
          onClick={() => setHistoryOpen(true)}
          aria-label="Match History"
          style={{
            position: "relative",
            width: isMobile ? 44 : 52,
            height: isMobile ? 44 : 52,
            background: "rgba(0,0,0,0.7)",
            border: `2px solid ${C.cyan}`,
            borderRadius: "50%",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 0 20px rgba(0,229,255,0.4)`,
            flexShrink: 0,
            padding: 0,
            transition: "transform 0.2s ease",
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.1)"}
          onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
        >
          <svg viewBox="0 0 24 24" width={isMobile ? 22 : 26} height={isMobile ? 22 : 26}>
            <circle cx="12" cy="12" r="9" fill="none" stroke={C.cyanL} strokeWidth="1.8" />
            <path d="M12 7 L12 12 L15 14" stroke={C.cyanL} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Shop button — glowing potion */}
        <button
          onClick={() => setShopOpen(true)}
          aria-label="Open Shop"
          style={{
            position: "relative",
            width: isMobile ? 44 : 52,
            height: isMobile ? 44 : 52,
            background: "rgba(0,0,0,0.7)",
            border: `2px solid ${C.violet}`,
            borderRadius: "50%",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "shopPulse 2s ease-in-out infinite",
            flexShrink: 0,
            transition: "transform 0.2s ease",
            padding: 0,
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.1)"}
          onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
        >
          <svg
            viewBox="0 0 24 24"
            width={isMobile ? 22 : 26}
            height={isMobile ? 22 : 26}
            style={{ animation: "potionBubble 1.5s ease-in-out infinite" }}
          >
            <defs>
              <linearGradient id="potionLiquid" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={C.cyan} />
                <stop offset="50%"  stopColor={C.violet} />
                <stop offset="100%" stopColor={C.magenta} />
              </linearGradient>
            </defs>
            <path
              d="M9 3v5.5L5.5 15.5A3.5 3.5 0 009 20h6a3.5 3.5 0 003.5-4.5L15 8.5V3H9z"
              fill="url(#potionLiquid)"
              stroke={C.cyanL}
              strokeWidth="1.5"
              opacity="0.9"
            />
            <path d="M9 3h6" stroke={C.cyanL} strokeWidth="2" strokeLinecap="round" />
            <circle cx="11" cy="14" r="1" fill="#fff" opacity="0.6" />
            <circle cx="14" cy="16" r="0.7" fill="#fff" opacity="0.5" />
          </svg>
        </button>
      </div>

      {/* ═══ MAIN CONTENT ═══ */}
      <div
        style={{
          position: "relative", zIndex: 3,
          padding: isMobile ? "14px 12px" : "20px 32px",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "1fr 340px",
            gap: 20,
          }}
        >
          {/* ─── GAME IFRAME ─── */}
          <div
            style={{
              position: "relative",
              background: C.cardSolid,
              border: `2px solid ${C.violet}`,
              borderRadius: 14,
              overflow: "hidden",
              animation: "iframeBorderGlow 3s ease-in-out infinite",
            }}
          >
            {BATTLE_GAME_URL ? (
              <GameFrame
                ref={iframeRef}
                url={BATTLE_GAME_URL}
                isMobile={isMobile}
                isFullscreen={isFullscreen}
                onToggleFullscreen={handleToggleFullscreen}
                onReload={handleReloadGame}
                reloadKey={reloadKey}
              />
            ) : (
              <div
                style={{
                  height: isMobile ? "75vw" : "calc(100vh - 54px - 180px)",
                  minHeight: 400,
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  gap: 16, background: "rgba(0,0,0,0.6)",
                }}
              >
                <div style={{ fontSize: 60, filter: "drop-shadow(0 0 20px rgba(139,92,246,0.7))" }}>⚔</div>
                <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 14, color: C.violetL, textAlign: "center" }}>
                  Battle game URL not configured<br/>
                  <span style={{ fontSize: 11, color: C.dimMore }}>Set VITE_BATTLE_ARENA_URL in .env</span>
                </div>
              </div>
            )}

            {/* Tag bar */}
            <div
              style={{
                padding: "10px 16px",
                borderTop: `1px solid ${C.border}`,
                display: "flex", gap: 10,
                background: "rgba(0,0,0,0.5)",
                flexWrap: "wrap",
              }}
            >
              {[chainName?.toUpperCase() || "ON-CHAIN", "BATTLE ARENA", "5 ROUNDS"].map((t, i) => (
                <span
                  key={t}
                  style={{
                    fontSize: 9,
                    padding: "3px 10px",
                    background: `rgba(${i === 0 ? "0,229,255" : i === 1 ? "236,72,153" : "139,92,246"}, 0.1)`,
                    border: `1px solid ${i === 0 ? C.cyan : i === 1 ? C.magenta : C.violet}`,
                    borderRadius: 4,
                    color: i === 0 ? C.cyanL : i === 1 ? "#f9a8d4" : C.violetL,
                    fontFamily: C.raj, fontWeight: 700,
                    letterSpacing: "1.5px",
                  }}
                >
                  {t}
                </span>
              ))}
              <span style={{ marginLeft: "auto", fontSize: 10, color: C.dim, fontFamily: C.raj }}>
                ⚡ Live
              </span>
            </div>
          </div>

          {/* ─── SIDEBAR ─── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* ── ARCADE Balance card ── */}
            {isConnected && (
              <div style={{
                position: "relative",
                background: `linear-gradient(135deg, rgba(0,255,136,0.06), rgba(0,229,255,0.05))`,
                border: `1px solid ${C.green}`,
                borderRadius: 12,
                padding: "12px 16px",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                boxShadow: `0 0 20px rgba(0,255,136,0.12)`,
                overflow: "hidden",
              }}>
                {/* Ambient corner glow */}
                <div style={{
                  position: "absolute", top: -20, right: -20, width: 80, height: 80,
                  background: `radial-gradient(circle, ${C.green}44 0%, transparent 70%)`,
                  pointerEvents: "none",
                }} />
                <div style={{
                  fontFamily: C.orb, fontWeight: 800, fontSize: 10,
                  color: C.green, letterSpacing: "2px",
                  textTransform: "uppercase",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <span style={{ fontSize: 14 }}>◆</span> ARCADE
                </div>
                <div style={{
                  fontFamily: C.orb, fontWeight: 900, fontSize: 18,
                  color: "#fff",
                  textShadow: `0 0 12px ${C.green}`,
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {arcadeBalance.toLocaleString(undefined, {
                    maximumFractionDigits: arcadeBalance < 100 ? 2 : 0,
                  })}
                </div>
              </div>
            )}

            {/* ── Battle Pass XP card (compact) ── */}
            {bpStatus && (
              <div
                onClick={() => navigate("/battle-pass")}
                style={{
                  position: "relative",
                  background: `linear-gradient(135deg, rgba(255,183,0,0.08), rgba(139,92,246,0.06))`,
                  border: `1px solid ${bpStatus.passType === "premium" ? C.gold : C.borderHot}`,
                  borderRadius: 12,
                  padding: "12px 14px",
                  cursor: "pointer",
                  backdropFilter: "blur(8px)",
                  boxShadow: bpStatus.passType === "premium"
                    ? `0 0 20px rgba(255,183,0,0.25)`
                    : `0 0 15px rgba(0,229,255,0.2)`,
                  transition: "transform 0.2s ease",
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-2px)"}
                onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      fontFamily: C.orb, fontWeight: 800, fontSize: 10,
                      color: bpStatus.passType === "premium" ? C.gold : C.cyanL,
                      letterSpacing: "2px", textShadow: `0 0 8px ${bpStatus.passType === "premium" ? C.gold : C.cyan}`,
                    }}>
                      {bpStatus.passType === "premium" ? "👑 BATTLE PASS" : "⚡ BATTLE PASS"}
                    </span>
                  </div>
                  <div style={{
                    fontFamily: C.orb, fontWeight: 800, fontSize: 13,
                    color: C.gold, textShadow: `0 0 8px ${C.gold}`,
                    letterSpacing: "1px",
                  }}>
                    TIER {bpStatus.tier}
                  </div>
                </div>
                {(() => {
                  const xpIntoTier = (bpStatus.seasonXP || 0) - bpStatus.tier * (bpStatus.xpPerTier || 500);
                  const pct = Math.min(100, (xpIntoTier / (bpStatus.xpPerTier || 500)) * 100);
                  return (
                    <>
                      <div style={{
                        width: "100%", height: 8,
                        background: "rgba(0,0,0,0.5)",
                        border: `1px solid ${C.border}`,
                        borderRadius: 4, overflow: "hidden",
                      }}>
                        <div style={{
                          width: `${pct}%`, height: "100%",
                          background: `linear-gradient(90deg, ${C.violet}, ${C.cyan}, ${C.gold})`,
                          backgroundSize: "200% 100%",
                          animation: "bpBarShine 3s linear infinite",
                          transition: "width 0.6s ease-out",
                          boxShadow: `0 0 8px ${C.cyan}`,
                        }} />
                      </div>
                      <div style={{
                        fontFamily: C.raj, fontSize: 10, color: C.dim,
                        marginTop: 5, letterSpacing: "1px", textAlign: "right",
                      }}>
                        {xpIntoTier} / {bpStatus.xpPerTier} XP
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {/* Rounds card */}
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: "16px 14px",
                backdropFilter: "blur(10px)",
                boxShadow: `0 8px 32px rgba(0,0,0,0.5)`,
              }}
            >
              <div
                style={{
                  fontFamily: C.orb, fontWeight: 700, fontSize: 12,
                  color: C.cyanL, textTransform: "uppercase",
                  letterSpacing: "3px", marginBottom: 14,
                  textShadow: `0 0 10px ${C.cyan}`,
                  textAlign: "center",
                  borderBottom: `1px solid ${C.border}`, paddingBottom: 10,
                }}
              >
                ▸ Combat Log ◂
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {roundStates.map(r => (
                  <RoundCard key={r.round} {...r} xpFlash={roundXpFlashes[r.round]} />
                ))}
              </div>
            </div>

            {/* Total earned */}
            <div
              style={{
                position: "relative",
                background: "linear-gradient(135deg, rgba(255,183,0,0.08), rgba(139,92,246,0.05))",
                border: `1px solid ${C.gold}`,
                borderRadius: 14,
                padding: "18px 16px",
                textAlign: "center",
                boxShadow: `0 0 30px rgba(255,183,0,0.2), inset 0 0 30px rgba(255,183,0,0.05)`,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  fontFamily: C.raj, fontWeight: 700, fontSize: 10,
                  color: C.gold, textTransform: "uppercase",
                  letterSpacing: "2.5px", marginBottom: 6,
                  textShadow: `0 0 8px ${C.gold}`,
                }}
              >
                ⚡ Total Bounty ⚡
              </div>
              <div
                key={totalDollars}
                style={{
                  fontFamily: C.orb, fontWeight: 900,
                  fontSize: 44, color: C.gold, lineHeight: 1,
                  textShadow: `0 0 20px ${C.gold}, 0 0 40px rgba(255,183,0,0.5)`,
                  animation: totalDollars > 0 ? "numberTick 0.5s ease" : "none",
                }}
              >
                ${totalDollars}
              </div>
              {claimReward > 0 && (
                <div
                  style={{
                    fontFamily: C.raj, fontWeight: 700, fontSize: 12,
                    color: C.cyanL, marginTop: 8,
                    textShadow: `0 0 8px ${C.cyan}`,
                  }}
                >
                  = {claimReward} ARCADE
                </div>
              )}
            </div>

            {/* Session error */}
            {sessionError && (
              <div
                style={{
                  background: "rgba(255,56,96,0.08)",
                  border: `1px solid ${C.danger}`,
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontFamily: C.raj, fontSize: 12, color: C.danger,
                }}
              >
                ⚠ {sessionError}
              </div>
            )}

            {/* Wallet warning */}
            {!isConnected && (
              <div
                style={{
                  background: "rgba(255,183,0,0.08)",
                  border: `1px solid ${C.gold}`,
                  borderRadius: 10,
                  padding: "12px 14px",
                  fontFamily: C.raj, fontSize: 12, color: C.gold,
                  textAlign: "center",
                }}
              >
                ⚠ Connect wallet to start battle
              </div>
            )}

            {/* CLAIM BUTTON */}
            {canClaim && (
              <button
                onClick={handleClaim}
                style={{
                  padding: "18px",
                  background: `linear-gradient(135deg, ${C.gold} 0%, #ff8800 50%, ${C.gold} 100%)`,
                  border: "none",
                  borderRadius: 12,
                  color: "#000",
                  fontFamily: C.orb, fontWeight: 900,
                  fontSize: 15,
                  letterSpacing: "3px",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  animation: "claimPulse 1.5s ease-in-out infinite",
                  clipPath: "polygon(4% 0, 100% 0, 96% 100%, 0 100%)",
                }}
              >
                ⚡ Claim {claimReward} ARCADE ⚡
              </button>
            )}

            {/* Claim in progress */}
            {claimStage && claimStage !== "success" && claimStage !== "failed" && (
              <ClaimProgressCard stage={claimStage} />
            )}

            {/* Claim success */}
            {claimStage === "success" && (
              <div
                style={{
                  background: "rgba(0,255,136,0.08)",
                  border: `1px solid ${C.green}`,
                  borderRadius: 12,
                  padding: "16px",
                  textAlign: "center",
                  boxShadow: `0 0 40px rgba(0,255,136,0.3)`,
                  animation: "fadeSlideIn 0.5s ease",
                }}
              >
                <div style={{ fontSize: 32, marginBottom: 6 }}>🏆</div>
                <div
                  style={{
                    fontFamily: C.orb, fontWeight: 700, fontSize: 13,
                    color: C.green, textTransform: "uppercase",
                    letterSpacing: "2px", marginBottom: 8,
                    textShadow: `0 0 10px ${C.green}`,
                  }}
                >
                  Victory Claimed
                </div>
                <div style={{ fontFamily: C.orb, fontWeight: 900, fontSize: 22, color: C.green, marginBottom: 10 }}>
                  +{arcadeAmount} ARCADE
                </div>
                                {txHash && (
                  
                   <a href={`${explorerUrl}/tx/${txHash}`}
                    target="_blank" rel="noreferrer"
                    style={{
                      fontSize: 11, color: C.cyanL,
                      textDecoration: "none",
                      fontFamily: C.raj, fontWeight: 700,
                    }}
                  >
                    View on {chainName} Explorer →
                  </a>
                )}
              </div>
            )}

            {/* Claim failed */}
            {claimStage === "failed" && (
              <div
                style={{
                  background: "rgba(255,56,96,0.08)",
                  border: `1px solid ${C.danger}`,
                  borderRadius: 12,
                  padding: "14px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontFamily: C.raj, fontWeight: 700, fontSize: 12,
                    color: C.danger, marginBottom: 8,
                  }}
                >
                  ⚠ {claimError || "Claim failed"}
                </div>
                <button
                  onClick={() => { setClaimStage(null); setClaimError(null); }}
                  style={{
                    padding: "8px 20px",
                    background: "rgba(255,56,96,0.15)",
                    border: `1px solid ${C.danger}`,
                    borderRadius: 6,
                    color: C.danger,
                    fontFamily: C.raj, fontWeight: 700, fontSize: 11,
                    cursor: "pointer", letterSpacing: "1px",
                    textTransform: "uppercase",
                  }}
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ SHOP OVERLAY ═══ */}
      <BattleShopOverlay
        open={shopOpen}
        onClose={() => setShopOpen(false)}
        onItemUnlocked={(item) => {
          // 1. Update local inventory (source of truth for BATTLE_INVENTORY)
          const newInv = inventoryRef.current.includes(item.itemId)
            ? inventoryRef.current
            : [...inventoryRef.current, item.itemId];
          inventoryRef.current = newInv;
          setInventory(newInv);

          // 2. Notify game: single-item unlock (animation trigger)
          sendToGame("BATTLE_ITEM_UNLOCKED", {
            itemId:   item.itemId,
            category: item.category,
            name:     item.name,
          });

          // 3. Push fresh full inventory so game re-applies state
          sendToGame("BATTLE_INVENTORY", { items: newInv });

          // 4. Balance dropped after purchase — refresh sidebar
          try { refetchArcadeBalance?.(); } catch { /* no-op */ }
        }}
        onEquippedChanged={(activeItems) => {
          // User equipped/unequipped inside the shop overlay OR backend
          // auto-equipped a new purchase. Update ref + push to game so
          // Unity's SkinManager activates the new loadout.
          equippedRef.current = activeItems || [];
          sendToGame("BATTLE_EQUIPPED", { activeItems: equippedRef.current });
        }}
      />

      {/* ═══ PORTRAIT ROTATION HINT (mobile only) ═══ */}
      <PortraitWarning visible={isPortrait} />

      {/* ═══ MATCH HISTORY OVERLAY ═══ */}
      <BattleMatchHistory
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />

      {/* ═══ POST-BATTLE RECAP ═══ */}
      {gameCompleted && rounds.length === 5 && recapDismissedFor !== sessionId && (
        <BattleResultRecap
          rounds={rounds}
          totalDollars={totalDollars}
          arcadeReward={totalDollars * dollarRate}
          chainName={chainName}
          claimStage={claimStage}
          claimError={claimError}
          canClaim={canClaim}
          onClaim={handleClaim}
          onClose={() => {
            // "View later" — user dismissed without claiming. Reset the
            // whole battle UI (combat log, total bounty, round states,
            // etc.) and start a fresh session so the sidebar is empty
            // and ready for a new game.
            setRecapDismissedFor(sessionId);
            setRounds([]);
            setTotalDollars(0);
            setCurrentRound(0);
            setGameCompleted(false);
            setClaimStage(null);
            setClaimError(null);
            setTxHash("");
            setArcadeAmount(null);
            // Reset iframe game state via message so Unity clears too
            sendToGame("BATTLE_RESET", {});
            // Kick off a fresh session (old one stays "completed" for later claim from history)
            if (startSessionRef.current) startSessionRef.current();
          }}
          bpStatus={bpStatus}
          xpEarned={Object.values(roundXpFlashes).reduce((a, b) => a + (b || 0), 0)
                    /* Live-fired XP flashes may have cleared already; if all zero, fall back to summing round-level bonus estimates so the recap still shows something. */
                    || (rounds.length ? rounds.reduce((sum, r) => sum + r.dollars * 2 + 20 + (r.dollars >= 20 ? 10 : 0) + (r.round === 5 ? 100 : 0), 0) : 0)}
        />
      )}

      {/* ═══ CONFETTI CELEBRATION ═══ */}
      {confettiActive && (
        <ConfettiBurst
          colors={["#ffb700", "#8b5cf6", "#00e5ff", "#ec4899", "#00ff88", "#ffffff"]}
          count={200}
          duration={4500}
        />
      )}

      {/* ═══ TIER-UP BANNER ═══ */}
      {tierUpFlash && (
        <div style={{
          position: "fixed", top: "40%", left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 10499,
          padding: "24px 40px",
          background: "rgba(4,3,10,0.9)",
          border: `3px solid ${C.gold}`,
          borderRadius: 20,
          textAlign: "center",
          boxShadow: `0 0 60px ${C.gold}, 0 0 120px rgba(255,183,0,0.5)`,
          animation: "tierUpBanner 3.5s ease-in-out forwards",
          pointerEvents: "none",
          backdropFilter: "blur(10px)",
        }}>
          <div style={{
            fontFamily: C.raj, fontSize: 14, color: C.cyanL,
            letterSpacing: "4px", marginBottom: 8, textTransform: "uppercase",
            textShadow: `0 0 10px ${C.cyan}`,
          }}>
            ⚡ TIER UP ⚡
          </div>
          <div style={{
            fontFamily: C.orb, fontWeight: 900, fontSize: 48,
            color: C.gold, letterSpacing: "6px",
            textShadow: `0 0 20px ${C.gold}, 0 0 40px rgba(255,183,0,0.7)`,
            lineHeight: 1,
          }}>
            TIER {tierUpFlash.to}
          </div>
          <div style={{
            fontFamily: C.raj, fontSize: 12, color: C.gold,
            letterSpacing: "3px", marginTop: 8, opacity: 0.8,
          }}>
            from Tier {tierUpFlash.from}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Claim Progress Card ────────────────────────────────────────────────────
function ClaimProgressCard({ stage }) {
  const labels = {
    signing:    { text: "Requesting signature...", icon: "⚙" },
    wallet:     { text: "Approve in wallet",       icon: "👛" },
    confirming: { text: "Confirming on-chain...",  icon: "⛓" },
  };
  const s = labels[stage] || { text: stage, icon: "⏳" };

  return (
    <div
      style={{
        background: "rgba(0,229,255,0.06)",
        border: `1px solid ${C.borderHot}`,
        borderRadius: 12,
        padding: "16px",
        textAlign: "center",
        boxShadow: `0 0 30px rgba(0,229,255,0.2)`,
      }}
    >
      <div
        style={{
          width: 40, height: 40, margin: "0 auto 10px",
          border: `3px solid rgba(0,229,255,0.2)`,
          borderTop: `3px solid ${C.cyan}`,
          borderRadius: "50%",
          animation: "spinnerRing 1s linear infinite",
        }}
      />
      <div
        style={{
          fontFamily: C.orb, fontWeight: 700, fontSize: 12,
          color: C.cyanL, textTransform: "uppercase",
          letterSpacing: "2px",
          textShadow: `0 0 10px ${C.cyan}`,
        }}
      >
        {s.icon} {s.text}
      </div>
      {stage === "wallet" && (
        <div style={{ fontSize: 10, color: C.dim, fontFamily: C.raj, marginTop: 6 }}>
          Keep this tab open
        </div>
      )}
    </div>
  );
}