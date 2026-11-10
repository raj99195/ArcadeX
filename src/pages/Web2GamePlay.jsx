// Place at: src/pages/Web2GamePlay.jsx
import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState, useRef, useCallback, memo, forwardRef } from "react";
import { useGames } from "../hooks/useGames";
import { useWeb2Auth } from "../hooks/useWeb2Auth";
import { useArcadeCoins } from "../hooks/useArcadeCoins";
import { getActiveAvatarStyle } from "../utils/avatarUtils";
import Seo from "../components/Seo";
import AdBanner from "../components/AdBanner";

/**
 * Web2 game page — same iframe + SDK bridge as GamePlay.jsx but:
 *   - No wallet / no chain
 *   - Score submits with Firebase ID token
 *   - 60-sec rate limit per uid
 *   - Guest mode: plays but no submission, no coins
 *   - PURCHASE_SKIN / PURCHASE_POWERUP respond with "not available in Web2"
 *   - PLAYER_INFO shape: { address: displayName, balance: coins, isWeb2: true }
 *   - Baseline-reset pattern same as GamePlay.jsx (SH0036) for repeat claims
 */

const C = {
  bg: "#08070f", card: "#0d0b1a", card2: "#12102a",
  border: "rgba(0,212,255,0.14)", border2: "rgba(0,212,255,0.3)",
  cyan: "#00D4FF", cyanL: "#8ab8d8",
  green: "#00FF88", gold: "#FFB700",
  dim: "#8ab8d8", dimMore: "#4a7a9a",
  raj: "'Rajdhani', sans-serif", orb: "'Orbitron', sans-serif",
};

function DiceBearAvatar({ seed, size = 28 }) {
  const style = getActiveAvatarStyle(seed || "arcade");
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", overflow: "hidden", border: "1.5px solid rgba(0,212,255,0.4)", flexShrink: 0, background: "#0e0c1a" }}>
      <img src={`https://api.dicebear.com/9.x/${style}/svg?seed=${seed || "arcade"}`} alt="" style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

// Memoized iframe (same pattern as GamePlay.jsx) — prevents iOS Safari reload
// on parent re-renders.
const GameFrame = memo(forwardRef(function GameFrame({ url, title, isMobile, isFullscreen, onToggleFullscreen }, ref) {
  const containerStyle = isFullscreen
    ? {
        position: "fixed", inset: 0, zIndex: 9999, background: "#000",
        display: "flex", flexDirection: "column",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }
    : { position: "relative" };
  const iframeStyle = isFullscreen
    ? { flex: 1, width: "100%", border: "none", display: "block" }
    : { width: "100%", height: isMobile ? "75vw" : "calc(100vh - 54px - 160px)", minHeight: isMobile ? 300 : 480, border: "none", display: "block" };
  const btnBase = { padding: "6px 12px", background: "rgba(0,0,0,0.8)", border: `1px solid ${C.border2}`, borderRadius: 7, color: C.cyanL, fontSize: 11, cursor: "pointer", fontFamily: C.raj, fontWeight: 700, backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 5 };
  const exitBtnStyle = isFullscreen
    ? {
        ...btnBase,
        position: "absolute",
        top: `calc(12px + env(safe-area-inset-top, 0px))`,
        right: `calc(12px + env(safe-area-inset-right, 0px))`,
        zIndex: 10000,
        padding: isMobile ? "10px 16px" : "6px 12px",
        fontSize: isMobile ? 13 : 11,
      }
    : { ...btnBase, position: "absolute", bottom: 10, right: 10 };
  return (
    <div style={containerStyle}>
      <iframe ref={ref} src={url}
        style={iframeStyle}
        allow="fullscreen; autoplay; gyroscope; accelerometer" allowFullScreen title={title} />
      <button onClick={onToggleFullscreen} style={exitBtnStyle}>
        <span>{isFullscreen ? "✕" : "⛶"}</span> {isFullscreen ? "Exit" : "Fullscreen"}
      </button>
    </div>
  );
}));

export default function Web2GamePlay() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  const { games } = useGames();
  const game = games.find(g => g.id === Number(gameId));
  const { user: web2User, isGuest } = useWeb2Auth();
  const { balance, stats, refetch: refetchBalance } = useArcadeCoins();

  const [gameLoading, setGameLoading] = useState(true);
  const [score, setScore] = useState(0);
  const [rawGameScore, setRawGameScore] = useState(0);
  const [scoreBaseline, setScoreBaseline] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [coinsEarned, setCoinsEarned] = useState(0);
  const [cappedToday, setCappedToday] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [isFakeFullscreen, setIsFakeFullscreen] = useState(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [showHelpModal, setShowHelpModal] = useState(false);

  const iframeRef = useRef(null);
  const submittingRef = useRef(false);
  const lastSubmitAtRef = useRef(0);
  const rawGameScoreRef = useRef(0);
  const scoreBaselineRef = useRef(0);

  const isFullscreen = isNativeFullscreen || isFakeFullscreen;

  // Keep refs in sync for message-listener closure
  useEffect(() => { rawGameScoreRef.current = rawGameScore; }, [rawGameScore]);
  useEffect(() => { scoreBaselineRef.current = scoreBaseline; }, [scoreBaseline]);

  // Mobile detection
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  // Native fullscreen tracking
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

  // Body scroll lock during fake FS
  useEffect(() => {
    if (!isFakeFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isFakeFullscreen]);

  // ESC exits fake FS
  useEffect(() => {
    if (!isFakeFullscreen) return;
    const onKey = (e) => { if (e.key === "Escape") setIsFakeFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFakeFullscreen]);

  // Fullscreen toggle (same pattern as GamePlay.jsx)
  const handleToggleFullscreen = useCallback(() => {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      try { exit?.call(document); } catch {}
      return;
    }
    if (isFakeFullscreen) { setIsFakeFullscreen(false); return; }
    if (isMobile) { setIsFakeFullscreen(true); return; }
    const iframe = iframeRef.current;
    const nativeFS = iframe?.requestFullscreen || iframe?.webkitRequestFullscreen;
    if (!nativeFS) { setIsFakeFullscreen(true); return; }
    try {
      const p = nativeFS.call(iframe);
      if (p && typeof p.then === "function") p.catch(() => setIsFakeFullscreen(true));
    } catch { setIsFakeFullscreen(true); }
  }, [isMobile, isFakeFullscreen]);

  // Games list → loading state
  useEffect(() => {
    if (games.length > 0) setGameLoading(false);
  }, [games]);

  // Score baseline load from localStorage (SH0036 pattern — per uid+game)
  useEffect(() => {
    if (!game?.id || !web2User?.uid) {
      setScoreBaseline(0);
      setRawGameScore(0);
      setScore(0);
      return;
    }
    try {
      const key = `arcadex_web2_score_baseline_${web2User.uid}_${game.id}`;
      const stored = localStorage.getItem(key);
      const baseline = stored ? Number(stored) || 0 : 0;
      setScoreBaseline(baseline);
    } catch { setScoreBaseline(0); }
    setRawGameScore(0);
    setScore(0);
  }, [game?.id, web2User?.uid]);

  // Cooldown ticker — updates every second while remaining > 0
  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const t = setInterval(() => {
      const elapsed = (Date.now() - lastSubmitAtRef.current) / 1000;
      const remaining = Math.max(0, Math.ceil(60 - elapsed));
      setCooldownRemaining(remaining);
      if (remaining <= 0) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [cooldownRemaining]);

  // ── SDK message bridge ──────────────────────────────────────────
  useEffect(() => {
    let allowedOrigin = null;
    try {
      if (game?.iframeUrl) allowedOrigin = new URL(game.iframeUrl, window.location.origin).origin;
    } catch { allowedOrigin = null; }

    const handleMessage = (event) => {
      if (!allowedOrigin || event.origin !== allowedOrigin) return;
      if (!event.data?._sdk && !event.data?.type) return;

      if (event.data.type === "SCORE_UPDATE") {
        const sc = Number(event.data.score);
        if (!Number.isFinite(sc) || sc < 0) return;
        if (submitted) {
          setSubmitted(false);
          setCoinsEarned(0);
          setSubmitError(null);
          submittingRef.current = false;
        }
        setRawGameScore(sc);
        const currentBaseline = scoreBaselineRef.current;
        let effectiveBaseline = currentBaseline;
        if (sc < currentBaseline) {
          effectiveBaseline = 0;
          setScoreBaseline(0);
          try {
            const key = `arcadex_web2_score_baseline_${web2User?.uid}_${game?.id}`;
            localStorage.removeItem(key);
          } catch {}
        }
        setScore(Math.max(0, sc - effectiveBaseline));
      }

      if (event.data.type === "GAME_OVER") {
        const sc = Number(event.data.score);
        if (!Number.isFinite(sc) || sc < 0) return;
        setRawGameScore(sc);
        const currentBaseline = scoreBaselineRef.current;
        let effectiveBaseline = currentBaseline;
        if (sc < currentBaseline) {
          effectiveBaseline = 0;
          setScoreBaseline(0);
          try {
            const key = `arcadex_web2_score_baseline_${web2User?.uid}_${game?.id}`;
            localStorage.removeItem(key);
          } catch {}
        }
        const displayScore = Math.max(0, sc - effectiveBaseline);
        setScore(displayScore);
        setSubmitted(false);
        setSubmitError(null);
        submittingRef.current = false;
        // Auto-submit for registered users only; guests play without submitting
        if (!isGuest && displayScore > 0) submitScore(displayScore);
      }

      if (event.data.type === "GET_PLAYER_INFO") {
        // Send Web2-shaped player info. `address` is displayName so games
        // showing "Welcome, 0x..." will show the player's name instead.
        iframeRef.current?.contentWindow?.postMessage({
          type: "PLAYER_INFO",
          _platform: true,
          player: {
            address: web2User?.displayName || "Player",
            balance: Number(balance) || 0,
            isWeb2: true,
            isGuest,
          }
        }, allowedOrigin);
      }

      // Purchases blocked in Web2 — respond with PURCHASE_FAILED so SDK notifies game
      if (event.data.type === "PURCHASE_SKIN") {
        iframeRef.current?.contentWindow?.postMessage({
          type: "PURCHASE_FAILED", _platform: true,
          kind: "skin", skinIndex: event.data.skinIndex,
          error: "In-game purchases are not available in Web2 mode",
        }, allowedOrigin);
      }
      if (event.data.type === "PURCHASE_POWERUP") {
        iframeRef.current?.contentWindow?.postMessage({
          type: "PURCHASE_FAILED", _platform: true,
          kind: "powerup", powerUpId: event.data.powerUpId,
          error: "In-game purchases are not available in Web2 mode",
        }, allowedOrigin);
      }
      // RECORD_GAME_TIME, GAME_EVENT, CLASHPOT_JOIN — silently ignored in Web2
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [web2User, game, balance, submitted, isGuest]);

  // ── Submit score to backend ─────────────────────────────────────
  const submitScore = async (finalScore) => {
    if (submittingRef.current || !web2User || isGuest) return;

    // Client-side rate limit check (soft — backend enforces hard)
    const now = Date.now();
    const elapsed = (now - lastSubmitAtRef.current) / 1000;
    if (lastSubmitAtRef.current > 0 && elapsed < 60) {
      const remaining = Math.ceil(60 - elapsed);
      setCooldownRemaining(remaining);
      setSubmitError({
        icon: "⏱",
        title: "Please wait",
        msg: `You can submit again in ${remaining} seconds.`,
      });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const idToken = await web2User.firebaseUser.getIdToken();
      const res = await fetch("/api/games?action=web2-submit-score", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ gameId: game.id, score: finalScore }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSubmitError({
          icon: res.status === 429 ? "⏱" : "✕",
          title: res.status === 429 ? "Please wait" : "Submission failed",
          msg: data.error || "Something went wrong.",
        });
        return;
      }

      lastSubmitAtRef.current = Date.now();
      setCooldownRemaining(60);
      setCoinsEarned(data.coinsAwarded || 0);
      setCappedToday(!!data.cappedToday);
      setSubmitted(true);
      setShowSuccessOverlay(true);

      // Baseline reset — next SCORE_UPDATE shows only NEW points
      try {
        const currentRaw = rawGameScoreRef.current;
        const key = `arcadex_web2_score_baseline_${web2User.uid}_${game.id}`;
        localStorage.setItem(key, String(currentRaw));
        setScoreBaseline(currentRaw);
        setScore(0);
      } catch {}

      // Refresh balance (navbar + sidebar picks up new value)
      refetchBalance?.();

      // Auto-dismiss success overlay after 2.8s
      setTimeout(() => setShowSuccessOverlay(false), 2800);
    } catch (err) {
      console.error("[web2-submit-score]", err);
      setSubmitError({
        icon: "✕",
        title: "Network error",
        msg: "Please check your connection and try again.",
      });
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  // ── Early returns ────────────────────────────────────────────────
  if (gameLoading) return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: C.raj, fontSize: 11, color: C.dimMore, textTransform: "uppercase", letterSpacing: "2px" }}>Loading game...</div>
    </div>
  );
  if (!game) return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 48 }}>🎮</div>
      <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 16, color: C.cyanL }}>Game not found</div>
      <button onClick={() => navigate("/games")} style={{ padding: "8px 20px", background: "rgba(0,212,255,0.1)", border: `1px solid ${C.border2}`, borderRadius: 8, color: C.cyan, fontSize: 12, cursor: "pointer", fontFamily: C.raj, fontWeight: 700 }}>Browse Games</button>
    </div>
  );

  const rewardRate = game.rewardRate || 50;
  const thumbnail = game.thumbnailUrl || game.thumbnail || game.image || null;
  const hasHelpContent = !!(game.helpContent && Object.values(game.helpContent).some(v => v && v.trim()));
  const minScoreGate = Number(game.minScoreWeb2) || 0;

  // SEO
  const gameSlugId = game.gameId || game.id;
  const seoDesc = (game.description
    || `Play ${game.name} on ArcadeX Web2 — a free online ${game.category || "arcade"} game. Earn ArcadeCoins, no wallet needed.`);

  // ── Error card ──
  const renderErrorCard = () => {
    if (!submitError) return null;
    return (
      <div style={{ background: "rgba(255,183,0,0.06)", border: "1px solid rgba(255,183,0,0.25)", borderRadius: 10, padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{submitError.icon}</span>
          <span style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 12, color: C.gold, letterSpacing: "0.3px" }}>
            {submitError.title}
          </span>
        </div>
        <div style={{ fontSize: 11, color: C.cyanL, fontFamily: C.raj, lineHeight: 1.6 }}>
          {submitError.msg}
        </div>
        <button
          onClick={() => setSubmitError(null)}
          style={{ marginTop: 10, fontSize: 10, color: C.cyan, background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 6, padding: "4px 14px", cursor: "pointer", fontFamily: C.raj, fontWeight: 700, letterSpacing: "0.5px" }}>
          Dismiss
        </button>
      </div>
    );
  };

  // ── Success overlay ──
  // Celebration moment — layered ring expansion, 20-piece confetti burst,
  // coin flip, animated gradient title. The overlay auto-dismisses after
  // 2.8s (effect elsewhere) so each piece is choreographed to peak well
  // under that window.
  const renderSuccessOverlay = () => {
    if (!showSuccessOverlay) return null;

    // Deterministic-ish confetti layout generated once per render — not
    // worth memoising since the overlay only mounts on success.
    const confetti = Array.from({ length: 24 }, (_, i) => {
      const angle = (i / 24) * Math.PI * 2;
      const dist  = 110 + Math.random() * 60;
      const hues  = ["#00d4ff","#00FF88","#FFB700","#ff6ec4","#b58bff","#9ee8ff"];
      return {
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        c: hues[i % hues.length],
        s: 4 + Math.random() * 4,
        d: (i % 6) * 0.03,
      };
    });

    return (
      <>
        <style>{`
          @keyframes w2sBgIn       { from{opacity:0} to{opacity:1} }
          @keyframes w2sCardIn     { from{opacity:0;transform:translate(-50%,-50%) scale(0.84)} to{opacity:1;transform:translate(-50%,-50%) scale(1)} }
          @keyframes w2sCoinSpin   { 0%{transform:rotateY(0deg) scale(0.4);opacity:0} 60%{transform:rotateY(540deg) scale(1.18)} 100%{transform:rotateY(720deg) scale(1);opacity:1} }
          @keyframes w2sRing       { 0%{transform:scale(0.4);opacity:0.8} 100%{transform:scale(1.6);opacity:0} }
          @keyframes w2sConfetti   { 0%{transform:translate(0,0) scale(0);opacity:0} 20%{opacity:1} 100%{transform:translate(var(--tx),var(--ty)) scale(1);opacity:0} }
          @keyframes w2sTitleGlow  { 0%,100%{filter:drop-shadow(0 0 8px rgba(0,255,136,0.5))} 50%{filter:drop-shadow(0 0 18px rgba(0,255,136,0.9))} }
          @keyframes w2sShine      { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
          .w2s-title {
            background: linear-gradient(90deg,#00FF88 0%,#9ee8ff 25%,#00FF88 50%,#9ee8ff 75%,#00FF88 100%);
            background-size: 300% auto;
            -webkit-background-clip: text; background-clip: text;
            -webkit-text-fill-color: transparent;
            animation: w2sShine 3s linear infinite, w2sTitleGlow 2s ease-in-out infinite;
          }
        `}</style>
        <div style={{
          position: "fixed", inset: 0, zIndex: 20000,
          background: "radial-gradient(circle at 50% 50%, rgba(0,80,40,0.35) 0%, rgba(4,3,10,0.92) 60%)",
          backdropFilter: "blur(14px)",
          animation: "w2sBgIn 0.22s ease",
        }} />
        <div style={{
          position: "fixed", top: "50%", left: "50%",
          transform: "translate(-50%,-50%)",
          zIndex: 20001, width: "min(380px, 92vw)",
          background: "linear-gradient(165deg,#0e1a2a 0%,#071017 100%)",
          border: `1px solid rgba(0,255,136,0.5)`, borderRadius: 24,
          padding: "40px 28px 32px", textAlign: "center",
          boxShadow: "0 30px 90px rgba(0,0,0,0.7), 0 0 60px rgba(0,255,136,0.25), inset 0 1px 0 rgba(255,255,255,0.05)",
          fontFamily: "'Space Grotesk', 'Rajdhani', sans-serif",
          animation: "w2sCardIn 0.42s cubic-bezier(0.34,1.56,0.64,1)",
          overflow: "hidden", position: "fixed",
        }}>
          {/* Top beam */}
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 2,
            background: "linear-gradient(90deg, transparent, #00FF88, #FFB700, #00FF88, transparent)",
          }} />
          {/* Corner glow */}
          <div style={{
            position: "absolute", top: -80, right: -60, width: 220, height: 220,
            background: "radial-gradient(circle, rgba(0,255,136,0.22) 0%, transparent 70%)",
            borderRadius: "50%", pointerEvents: "none",
          }} />

          {/* Coin + rings + confetti */}
          <div style={{ position: "relative", width: 120, height: 120, margin: "0 auto 20px" }}>
            {/* Expanding rings */}
            {[0, 0.3, 0.6].map((delay, i) => (
              <div key={i} style={{
                position: "absolute", inset: 0,
                border: "2px solid rgba(0,255,136,0.6)",
                borderRadius: "50%",
                animation: `w2sRing 1.6s cubic-bezier(0.2,1,0.3,1) ${delay}s infinite`,
                pointerEvents: "none",
              }} />
            ))}

            {/* Confetti burst */}
            {confetti.map((p, i) => (
              <span key={i} style={{
                position: "absolute", top: "50%", left: "50%",
                width: p.s, height: p.s,
                background: p.c, borderRadius: 2,
                "--tx": `${p.x}px`, "--ty": `${p.y}px`,
                animation: `w2sConfetti 1.1s cubic-bezier(0.2,0.8,0.4,1) ${p.d}s both`,
                pointerEvents: "none",
                boxShadow: `0 0 8px ${p.c}`,
              }} />
            ))}

            {/* The coin */}
            <div style={{
              position: "absolute", top: 18, left: 18,
              width: 84, height: 84, borderRadius: "50%",
              background: "radial-gradient(circle at 35% 35%, #FFE085 0%, #FFB700 45%, #B07000 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 44, fontWeight: 900, color: "#1a0f00",
              boxShadow: "0 0 36px rgba(255,183,0,0.6), inset 0 2px 6px rgba(255,255,255,0.5), inset 0 -4px 8px rgba(0,0,0,0.25)",
              animation: "w2sCoinSpin 1s cubic-bezier(0.34,1.56,0.64,1)",
            }}>🪙</div>
          </div>

          <div style={{
            fontFamily: "'Rajdhani', sans-serif",
            fontSize: 10, color: "rgba(150,255,200,0.65)",
            letterSpacing: "0.32em", textTransform: "uppercase",
            marginBottom: 4,
          }}>Score Submitted</div>
          <div className="w2s-title" style={{
            fontFamily: "'Orbitron', sans-serif",
            fontSize: 32, fontWeight: 900, letterSpacing: "0.02em",
            marginBottom: 6,
          }}>
            +{coinsEarned.toLocaleString()}
          </div>
          <div style={{
            fontFamily: "'Rajdhani', sans-serif",
            fontSize: 13, fontWeight: 700, color: "#9ee8ff",
            letterSpacing: "0.1em", textTransform: "uppercase",
            marginBottom: 14,
          }}>ArcadeCoins Earned</div>

          <div style={{
            padding: "10px 14px", borderRadius: 10,
            background: "rgba(0,212,255,0.06)",
            border: "1px solid rgba(0,212,255,0.2)",
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 13, color: C.cyanL,
          }}>
            Total balance:{" "}
            <b style={{
              fontFamily: "'Orbitron', sans-serif",
              color: "#fff", fontSize: 15,
            }}>{Number(balance).toLocaleString()}</b>{" "}
            🪙
          </div>

          {cappedToday && (
            <div style={{
              marginTop: 10, padding: "9px 12px",
              background: "linear-gradient(135deg, rgba(255,183,0,0.14), rgba(255,183,0,0.04))",
              border: "1px solid rgba(255,183,0,0.3)",
              borderRadius: 10,
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 11, color: C.gold, lineHeight: 1.5,
            }}>
              ⚡ Daily cap reached — rewards reset tomorrow
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: C.bg }}>
      <Seo
        title={game.name}
        description={seoDesc}
        path={`/play/${gameSlugId}`}
        image={thumbnail || undefined}
      />
      <style>{`
        @keyframes w2Pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes w2PoweredGlow{0%,100%{opacity:0.7}50%{opacity:1}}
        @keyframes w2ScoreFlash{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}
        * { scrollbar-width: none; }
        *::-webkit-scrollbar { display: none; }
      `}</style>

      {/* ── GAME HEADER with thumbnail bg ── */}
      <div className="ax-fade-down" style={{ position: "relative", overflow: "hidden", borderBottom: `1px solid ${C.border}` }}>
        {thumbnail && (
          <>
            <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${thumbnail})`, backgroundSize: "cover", backgroundPosition: "center", filter: "blur(18px) brightness(0.22)", transform: "scale(1.1)", animation: "axBreathe 8s ease-in-out infinite" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(8,7,15,0.3) 0%, rgba(8,7,15,0.85) 100%)" }} />
          </>
        )}
        {!thumbnail && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(0,212,255,0.1), rgba(0,255,136,0.05))", backgroundSize: "200% 200%", animation: "axGradFlow 8s ease infinite" }} />}

        <div style={{ position: "relative", zIndex: 1, padding: isMobile ? "14px 16px" : "16px 32px", display: "flex", alignItems: "center", gap: 14 }}>
          <button
            onClick={() => navigate(-1)}
            className="ax-slide-left ax-beam-host"
            style={{
              padding: "7px 14px", background: "rgba(0,0,0,0.5)",
              border: `1px solid ${C.border2}`, borderRadius: 7,
              color: C.cyan, fontSize: 12, cursor: "pointer",
              fontFamily: C.raj, fontWeight: 700, backdropFilter: "blur(8px)",
              flexShrink: 0, transition: "transform 0.2s, background 0.2s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateX(-3px)"; e.currentTarget.style.background = "rgba(0,212,255,0.15)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "translateX(0)"; e.currentTarget.style.background = "rgba(0,0,0,0.5)"; }}
          >← Back</button>

          {hasHelpContent && (
            <button
              onClick={() => setShowHelpModal(true)}
              className="ax-fade-down ax-wiggle-hover"
              style={{
                padding: "7px 14px", background: "rgba(0,212,255,0.15)",
                border: `1px solid ${C.border2}`, borderRadius: 7,
                color: C.cyan, fontSize: 12, cursor: "pointer",
                fontFamily: C.raj, fontWeight: 700, backdropFilter: "blur(8px)",
                flexShrink: 0, whiteSpace: "nowrap",
                transition: "background 0.2s, box-shadow 0.2s",
                animationDelay: "0.1s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 0 16px rgba(0,212,255,0.3)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
            >
              ❓ How to Play
            </button>
          )}

          <div
            className="ax-pop-in ax-heartbeat-hover"
            style={{
              width: isMobile ? 48 : 56, height: isMobile ? 48 : 56,
              borderRadius: 10, overflow: "hidden",
              border: `2px solid ${C.border2}`, flexShrink: 0,
              background: "#0e0c1a", boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
              animationDelay: "0.15s",
            }}>
            {thumbnail ? (
              <img src={thumbnail} alt={game.name} style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "center", background: "#0e0c1a" }} />
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, background: "linear-gradient(135deg,rgba(0,212,255,0.3),rgba(0,255,136,0.1))" }}>🎮</div>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ax-slide-left" style={{ fontFamily: C.raj, fontWeight: 700, fontSize: isMobile ? 18 : 22, color: "#fff", textTransform: "uppercase", letterSpacing: "0.5px", lineHeight: 1.1, marginBottom: 3, animationDelay: "0.1s" }}>{game.name}</div>
            <div className="ax-stagger" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {game.category && <span style={{ fontSize: 9, padding: "2px 8px", background: "rgba(0,212,255,0.2)", border: `1px solid ${C.border2}`, borderRadius: 4, color: C.cyan, fontFamily: C.raj, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase" }}>{game.category}</span>}
              <span style={{ fontSize: 9, padding: "2px 8px", background: "rgba(0,212,255,0.15)", border: `1px solid ${C.border2}`, borderRadius: 4, color: C.cyan, fontFamily: C.raj, fontWeight: 700, letterSpacing: "1px" }}>🎮 WEB2</span>
              {isGuest && <span className="ax-glow-gold" style={{ fontSize: 9, padding: "2px 8px", background: "rgba(255,183,0,0.15)", border: "1px solid rgba(255,183,0,0.3)", borderRadius: 4, color: C.gold, fontFamily: C.raj, fontWeight: 700, letterSpacing: "1px", display: "inline-block" }}>GUEST</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div style={{ padding: isMobile ? "12px 14px" : "16px 32px" }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 300px", gap: 16 }}>

          {/* ── GAME IFRAME ── */}
          <div className="ax-fade-up ax-shine-border" style={{ background: C.card, border: `1px solid ${C.border2}`, borderRadius: 14, overflow: "hidden", position: "relative" }}>
            {game.iframeUrl && !game.iframeUrl.includes("your-unity-game") ? (
              <GameFrame
                ref={iframeRef}
                url={game.iframeUrl}
                title={game.name}
                isMobile={isMobile}
                isFullscreen={isFullscreen}
                onToggleFullscreen={handleToggleFullscreen}
              />
            ) : (
              <div style={{ height: isMobile ? "75vw" : "calc(100vh - 54px - 160px)", minHeight: isMobile ? 300 : 480, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
                <div style={{ fontSize: 56, filter: "drop-shadow(0 0 20px rgba(0,212,255,0.5))" }}>🎮</div>
                <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 14, color: C.dimMore }}>Game coming soon</div>
              </div>
            )}
            <div style={{ padding: "8px 14px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 8, background: "rgba(0,0,0,0.3)" }}>
              <span style={{ fontSize: 9, padding: "3px 8px", background: "rgba(0,0,0,0.4)", border: `1px solid ${C.border}`, borderRadius: 4, color: C.dimMore, fontFamily: C.raj, fontWeight: 700, letterSpacing: "1px" }}>WEB2 MODE</span>
              <span style={{ fontSize: 9, padding: "3px 8px", background: "rgba(0,212,255,0.15)", border: `1px solid ${C.border2}`, borderRadius: 4, color: C.cyan, fontFamily: C.raj, fontWeight: 700, letterSpacing: "1px" }}>ARCADE X</span>
              <span style={{ marginLeft: "auto", fontSize: 9, color: C.dimMore, fontFamily: C.raj, display: "flex", alignItems: "center" }}>⚡ No wallet needed</span>
            </div>
          </div>

          {/* ── RIGHT SIDEBAR ── */}
          <div className="ax-stagger" style={{ display: "flex", flexDirection: "column", gap: 10 }}>

            {/* Guest banner (prominent nudge) */}
            {isGuest && (
              <div className="ax-glow-gold ax-lift" style={{ background: "linear-gradient(135deg,rgba(255,183,0,0.1),rgba(255,140,0,0.04))", border: "1px solid rgba(255,183,0,0.3)", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 18 }}>👤</span>
                  <span style={{ fontFamily: C.raj, fontWeight: 800, fontSize: 13, color: C.gold, letterSpacing: "0.3px" }}>Playing as Guest</span>
                </div>
                <div style={{ fontSize: 11, color: "#d4b580", fontFamily: C.raj, lineHeight: 1.5 }}>
                  Guests can play but <b>don't earn ArcadeCoins</b>. Sign in with Google or X to start earning!
                </div>
              </div>
            )}

            {/* Score Card */}
            <div className="ax-lift ax-tilt-hover" style={{ background: C.card, border: `1px solid ${C.border2}`, borderRadius: 12, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
              <div className="ax-float" style={{ position: "absolute", top: -30, right: -30, width: 120, height: 120, background: "radial-gradient(circle,rgba(0,212,255,0.2) 0%,transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,#00d4ff,#00FF88,#00d4ff)", backgroundSize: "200% 100%", animation: "axSheenMove 3s linear infinite" }} />
              <div style={{ fontSize: 9, color: C.dimMore, textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: C.raj, fontWeight: 700, marginBottom: 6 }}>Current Score</div>
              <div style={{
                fontFamily: C.orb, fontWeight: 700, fontSize: 44,
                color: score > 0 ? C.cyan : "#8ab8d8",
                letterSpacing: "-1px", lineHeight: 1,
                animation: score > 0 ? "w2ScoreFlash 0.3s ease, axHeartbeat 2s ease-in-out infinite" : "none",
                textShadow: score > 0 ? "0 0 20px rgba(0,212,255,0.5)" : "none",
                transition: "color 0.3s, text-shadow 0.3s",
              }}>
                {score.toLocaleString()}
              </div>
              <div className="ax-glow-gold" style={{ marginTop: 10, padding: "6px 10px", background: "rgba(255,183,0,0.06)", border: "1px solid rgba(255,183,0,0.15)", borderRadius: 7, textAlign: "center" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.gold, fontFamily: C.raj }}>
                  +{rewardRate} <span style={{ display: "inline-block", animation: "axHeartbeat 2.4s ease-in-out infinite" }}>🪙</span> <span style={{ fontSize: 10, color: C.dim, fontWeight: 500 }}>per claim</span>
                </div>
              </div>
            </div>

            {/* Balance + daily cap */}
            {!isGuest && (
              <div className="ax-lift" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ fontSize: 9, color: C.dimMore, textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: C.raj, fontWeight: 700, marginBottom: 8 }}>Your Balance</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 10 }}>
                  <span style={{
                    fontFamily: C.orb, fontWeight: 700, fontSize: 26,
                    color: C.gold, lineHeight: 1,
                    textShadow: "0 0 12px rgba(255,183,0,0.3)",
                  }}>{Number(balance).toLocaleString()}</span>
                  <span style={{ fontSize: 12, color: "#d4b580", fontFamily: C.raj, fontWeight: 700 }}>
                    <span style={{ display: "inline-block", animation: "axHeartbeat 2.8s ease-in-out infinite" }}>🪙</span> ArcadeCoins
                  </span>
                </div>
                {stats && (
                  <div style={{ paddingTop: 10, borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                      <span style={{ color: C.dimMore, fontFamily: C.raj }}>Today earned</span>
                      <span style={{ color: C.cyan, fontFamily: C.raj, fontWeight: 700 }}>{stats.todayEarned || 0} / {stats.dailyCap || 500}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                      <span style={{ color: C.dimMore, fontFamily: C.raj }}>Total plays</span>
                      <span style={{ color: C.cyan, fontFamily: C.raj, fontWeight: 700 }}>{stats.totalPlays || 0}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Creator card */}
            <div className="ax-lift" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 16px" }}>
              <div style={{ fontSize: 9, color: C.dimMore, textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: C.raj, fontWeight: 700, marginBottom: 10 }}>Creator</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <DiceBearAvatar seed={game.creator || "arcade"} size={38} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#d8f4ff", fontFamily: C.raj, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {game.creator ? `${game.creator.slice(0, 6)}...${game.creator.slice(-4)}` : "ArcadeX"}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 5 }}>
                {[["Category", game.category || "—"], ["Reward rate", `${rewardRate} 🪙 / play`], (minScoreGate > 0 ? ["Min score", String(minScoreGate)] : null)].filter(Boolean).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ color: C.dimMore, fontFamily: C.raj }}>{k}</span>
                    <span style={{ color: "#8ab8d8", fontFamily: C.raj, fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Submitting status */}
            {submitting && (
              <div style={{ background: "rgba(0,212,255,0.06)", border: `1px solid ${C.border2}`, borderRadius: 10, padding: "13px 16px", textAlign: "center" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.cyan, animation: "w2Pulse 1s ease-in-out infinite" }} />
                  <div style={{ fontFamily: C.raj, fontSize: 13, fontWeight: 700, color: C.cyan }}>Submitting score...</div>
                </div>
              </div>
            )}

            {renderErrorCard()}

            {/* Submitted confirmation (sidebar version) */}
            {submitted && coinsEarned > 0 && (
              <div className="ax-pop-in ax-glow-green" style={{ background: "rgba(0,255,136,0.05)", border: "1px solid rgba(0,255,136,0.15)", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 12, color: C.green, marginBottom: 5 }}>✓ Score submitted!</div>
                <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 16, color: C.green, animation: "axHeartbeat 1.5s ease-in-out infinite" }}>+{coinsEarned} 🪙 earned!</div>
                {cappedToday && <div style={{ fontSize: 10, color: C.gold, fontFamily: C.raj, marginTop: 4 }}>Daily cap reached — resets tomorrow</div>}
              </div>
            )}

            {/* Manual submit button */}
            {score > 0 && !submitted && !submitting && !isGuest && cooldownRemaining <= 0 && (
              <button
                onClick={() => submitScore(score)}
                className="ax-pop-in ax-glow-cyan ax-beam-host"
                style={{
                  padding: "12px",
                  background: "linear-gradient(135deg,#00d4ff,#0088ff,#00d4ff)",
                  backgroundSize: "200% 200%",
                  border: "none", borderRadius: 9, color: "#fff", fontSize: 12,
                  fontWeight: 700, cursor: "pointer", fontFamily: C.raj,
                  letterSpacing: "1px", textTransform: "uppercase",
                  transition: "transform 0.2s, background-position 0.4s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px) scale(1.03)"; e.currentTarget.style.backgroundPosition = "100% 50%"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0) scale(1)"; e.currentTarget.style.backgroundPosition = "0% 50%"; }}
              >
                <span style={{ display: "inline-block", animation: "axHeartbeat 1.4s ease-in-out infinite" }}>🪙</span> Submit Score
              </button>
            )}

            {/* Cooldown indicator */}
            {cooldownRemaining > 0 && (
              <div style={{ background: "rgba(255,183,0,0.06)", border: "1px solid rgba(255,183,0,0.2)", borderRadius: 10, padding: "10px 14px", textAlign: "center" }}>
                <div style={{ fontFamily: C.raj, fontSize: 11, fontWeight: 700, color: C.gold }}>
                  ⏱ Next submit in {cooldownRemaining}s
                </div>
              </div>
            )}

            {/* Guest CTA */}
            {score > 0 && isGuest && (
              <div style={{ background: "rgba(0,212,255,0.06)", border: `1px solid ${C.border2}`, borderRadius: 10, padding: "12px 14px", textAlign: "center" }}>
                <div style={{ fontSize: 11, color: C.cyanL, fontFamily: C.raj, lineHeight: 1.5 }}>
                  Sign in to save your score and earn <b style={{ color: C.gold }}>ArcadeCoins</b>!
                </div>
              </div>
            )}

            {/* Sidebar ad — rectangular slot that stacks under the sidebar cards */}
            <AdBanner slot="" layout="square" style={{ margin: "4px auto 0" }} />

            {/* Powered by */}
            <div style={{ textAlign: "center", padding: "6px 0", animation: "w2PoweredGlow 3s ease-in-out infinite" }}>
              <div style={{ fontSize: 10, fontFamily: C.raj, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", background: "linear-gradient(90deg,#00d4ff,#00FF88)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>⚡ Powered by ArcadeX</div>
              <div style={{ fontSize: 9, color: "#3a5a7a", fontFamily: C.raj, letterSpacing: "1px", marginTop: 1 }}>Web2 Mode</div>
            </div>
          </div>
        </div>

        {/* Bottom horizontal ad — below the full game grid */}
        <AdBanner slot="" layout="horizontal" style={{ marginTop: 20 }} />
      </div>

      {/* Help modal */}
      {showHelpModal && hasHelpContent && (
        <div onClick={() => setShowHelpModal(false)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "linear-gradient(160deg, #0e1a2a 0%, #0a0f1a 100%)",
            border: `1px solid rgba(0,212,255,0.35)`,
            borderRadius: 18,
            width: "100%", maxWidth: 500,
            maxHeight: "82vh", overflowY: "auto",
            boxShadow: "0 0 60px rgba(0,212,255,0.25), 0 24px 80px rgba(0,0,0,0.8)",
          }}>
            <div style={{ padding: "22px 24px 16px", borderBottom: `1px solid rgba(0,212,255,0.15)`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(0,212,255,0.18)", border: "1px solid rgba(0,212,255,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>❓</div>
                <div>
                  <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 17, color: "#fff", lineHeight: 1 }}>How to Play</div>
                  <div style={{ fontFamily: C.raj, fontSize: 10, color: C.dimMore, marginTop: 2, letterSpacing: "0.5px" }}>{game.name}</div>
                </div>
              </div>
              <button onClick={() => setShowHelpModal(false)} style={{ background: "rgba(255,255,255,0.05)", border: `1px solid rgba(0,212,255,0.2)`, borderRadius: 8, color: C.dimMore, fontSize: 18, width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: C.raj }}>✕</button>
            </div>
            <div style={{ padding: "18px 24px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
              {["objective", "controls", "instructions", "tips"].map(k => game.helpContent?.[k] && (
                <div key={k}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                    <div style={{ width: 3, height: 18, borderRadius: 2, background: C.cyan, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: C.cyan, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "2px" }}>{k}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#d8f4ff", fontFamily: C.raj, lineHeight: 1.7, whiteSpace: "pre-wrap", paddingLeft: 11 }}>{game.helpContent[k]}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Success overlay */}
      {renderSuccessOverlay()}
    </div>
  );
}
