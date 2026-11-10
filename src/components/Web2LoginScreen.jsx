// src/components/Web2LoginScreen.jsx
//
// Second-stage overlay after ModeSelector. Full immersive backdrop,
// Orbitron display header, premium provider buttons with sheen-sweep
// hover + arrow glide. Guest option is deliberately quieter.
//
// Shares the "layered backdrop + particle field + Orbitron title"
// language with ModeSelector so the two feel like one continuous flow.

import { useEffect, useRef, useState } from "react";
import { useWeb2Auth } from "../hooks/useWeb2Auth";
import { useMode } from "../hooks/useMode";

// ── Particle backdrop (same technique as ModeSelector) ──────────────
function ParticleField() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf = 0, w = 0, h = 0;
    const dots = [];
    const COUNT = 55;

    const resize = () => {
      w = canvas.width  = window.innerWidth  * window.devicePixelRatio;
      h = canvas.height = window.innerHeight * window.devicePixelRatio;
      canvas.style.width  = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
    };
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < COUNT; i++) {
      dots.push({
        x: Math.random() * w, y: Math.random() * h,
        r: (Math.random() * 1.6 + 0.6) * window.devicePixelRatio,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        hue: Math.random() < 0.75 ? "0,212,255" : "123,47,255",
        alpha: Math.random() * 0.4 + 0.2,
      });
    }

    const loop = () => {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.x += d.vx; d.y += d.vy;
        if (d.x < 0 || d.x > w) d.vx *= -1;
        if (d.y < 0 || d.y > h) d.vy *= -1;
        const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r * 6);
        g.addColorStop(0, `rgba(${d.hue},${d.alpha})`);
        g.addColorStop(1, `rgba(${d.hue},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r * 6, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.85 }} />;
}

function GuestIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="6" r="3" />
      <path d="M3 15c0-3 3-5 6-5s6 2 6 5" />
    </svg>
  );
}

function ArrowIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9h12M10 4l5 5-5 5" />
    </svg>
  );
}

function Spinner({ color = "#fff", size = 18 }) {
  return (
    <div style={{
      width: size, height: size, flexShrink: 0,
      border: `2.5px solid ${color}22`, borderTopColor: color,
      borderRadius: "50%", animation: "w2Spin 0.8s linear infinite",
    }} />
  );
}

export default function Web2LoginScreen() {
  const { signInGoogle, signInTwitter, signInGuest } = useWeb2Auth();
  const { clearMode } = useMode();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 768);

  useEffect(() => {
    const r = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);

  const run = async (key, fn) => {
    setBusy(key); setError("");
    try { await fn(); }
    catch (e) {
      const cancelled = e?.message?.includes("popup-closed") || e?.code === "auth/popup-closed-by-user";
      setError(cancelled ? "Login cancelled." : (e?.message || "Sign-in failed. Try again."));
    } finally { setBusy(null); }
  };

  const handleGoogle  = () => run("google",  signInGoogle);
  const handleTwitter = () => run("twitter", signInTwitter);
  const handleGuest   = () => run("guest",   async () => signInGuest());

  return (
    <>
      <style>{`
        @keyframes w2BgIn    { from{opacity:0} to{opacity:1} }
        @keyframes w2CardIn  { from{opacity:0;transform:translateY(24px) scale(0.96)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes w2Spin    { from{transform:rotate(0)} to{transform:rotate(360deg)} }
        @keyframes w2TitleIn { from{opacity:0;letter-spacing:0.14em} to{opacity:1;letter-spacing:0.02em} }
        @keyframes w2HaloIn  { from{opacity:0;transform:scale(0.6)} to{opacity:1;transform:scale(1)} }
        @keyframes w2Pulse   { 0%,100%{transform:scale(1);opacity:0.55} 50%{transform:scale(1.08);opacity:0.9} }
        @keyframes w2Orbit   { from{transform:rotate(0)} to{transform:rotate(360deg)} }
        @keyframes w2Beam    { 0%{transform:translateX(-120%) skewX(-20deg)} 100%{transform:translateX(220%) skewX(-20deg)} }
        @keyframes w2GradFlow{ 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
        @keyframes w2ChipIn  { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }

        .w2-title {
          font-family: 'Orbitron', 'Rajdhani', sans-serif;
          font-weight: 900;
          background: linear-gradient(90deg,#ffffff 0%,#9ee8ff 50%,#ffffff 100%);
          background-size: 240% auto;
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: w2GradFlow 9s linear infinite, w2TitleIn 0.9s ease both;
          text-shadow: 0 0 50px rgba(0,212,255,0.3);
        }
        .w2-sub {
          font-family: 'Rajdhani', sans-serif;
          font-weight: 500;
          letter-spacing: 0.35em;
          text-transform: uppercase;
        }
        .w2-btn {
          position: relative; overflow: hidden;
          display: flex; align-items: center; gap: 12px;
          width: 100%; padding: 14px 18px;
          border-radius: 14px;
          font-family: 'Space Grotesk', sans-serif;
          font-size: 14px; font-weight: 600;
          letter-spacing: 0.02em;
          cursor: pointer;
          transition: transform 0.2s cubic-bezier(0.2,1,0.3,1), box-shadow 0.2s, filter 0.2s, border-color 0.2s;
        }
        .w2-btn::after {
          content: ""; position: absolute; top: 0; left: 0; height: 100%; width: 60px;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);
          opacity: 0; transition: opacity 0.2s;
          pointer-events: none;
        }
        .w2-btn:not(:disabled):hover::after { opacity: 1; animation: w2Beam 1.1s ease-in-out infinite; }
        .w2-btn:not(:disabled):hover { transform: translateY(-2px); }
        .w2-btn:not(:disabled):hover .w2-arrow { transform: translateX(3px); opacity: 1; }
        .w2-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .w2-arrow { margin-left: auto; opacity: 0.5; transition: transform 0.2s, opacity 0.2s; }
      `}</style>

      <div style={{
        position: "fixed", inset: 0, zIndex: 10000,
        overflow: "hidden", animation: "w2BgIn 0.35s ease",
      }}>
        {/* ── Layered backdrop (same language as ModeSelector) ── */}
        <div style={{ position: "absolute", inset: 0, background: "#040309" }} />
        <div style={{
          position: "absolute", inset: 0,
          background:
            "radial-gradient(ellipse 70% 55% at 20% 30%, rgba(0,212,255,0.26) 0%, transparent 60%)," +
            "radial-gradient(ellipse 65% 50% at 85% 75%, rgba(123,47,255,0.18) 0%, transparent 55%)," +
            "radial-gradient(circle at 50% 50%, rgba(0,255,136,0.04) 0%, transparent 40%)",
          filter: "saturate(1.1)",
        }} />
        <div style={{
          position: "absolute", inset: 0, opacity: 0.3,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse 70% 70% at 50% 40%, #000 20%, transparent 85%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 70% at 50% 40%, #000 20%, transparent 85%)",
        }} />
        <ParticleField />
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(circle at 50% 50%, transparent 55%, rgba(0,0,0,0.65) 100%)",
        }} />

        {/* ── Content ── */}
        <div style={{
          position: "relative", zIndex: 2, minHeight: "100%", width: "100%",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: isMobile ? "24px 16px" : "32px 24px", overflowY: "auto",
        }}>
          <div style={{
            width: "min(460px, 100%)",
            display: "flex", flexDirection: "column", alignItems: "center",
          }}>
            {/* Header */}
            <div style={{ textAlign: "center", marginBottom: 28, position: "relative" }}>
              {/* Halo + orbit */}
              <div style={{
                position: "absolute", top: "50%", left: "50%",
                width: 150, height: 150, transform: "translate(-50%,-50%)",
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(0,212,255,0.4) 0%, transparent 60%)",
                animation: "w2Pulse 3.5s ease-in-out infinite",
                pointerEvents: "none",
              }} />
              <div style={{
                position: "absolute", top: "50%", left: "50%",
                width: 100, height: 100, transform: "translate(-50%,-50%)",
                borderRadius: "50%",
                border: "1px dashed rgba(0,212,255,0.2)",
                animation: "w2Orbit 18s linear infinite",
                pointerEvents: "none",
              }} />

              <img src="/IA-logo.webp" alt="ArcadeX" style={{
                position: "relative", width: 60, height: 60, objectFit: "contain",
                filter: "drop-shadow(0 0 26px rgba(0,212,255,0.75)) drop-shadow(0 0 50px rgba(123,47,255,0.3))",
                animation: "w2HaloIn 0.7s cubic-bezier(0.34,1.56,0.64,1)",
              }} />
              <div className="w2-sub" style={{
                marginTop: 18, fontSize: 10,
                color: "rgba(150,220,255,0.55)",
              }}>Web2 Mode · Earn ArcadeCoins</div>
              <h1 className="w2-title" style={{
                marginTop: 8,
                fontSize: isMobile ? 30 : 40,
                lineHeight: 1,
                textTransform: "uppercase",
              }}>Sign In</h1>
              <p style={{
                marginTop: 12,
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: 14, color: "rgba(190,215,235,0.65)",
                maxWidth: 360, marginLeft: "auto", marginRight: "auto",
                lineHeight: 1.5,
              }}>
                Pick a provider.{" "}
                <span style={{ color: "#9ee8ff" }}>No wallet, no setup — ready in seconds.</span>
              </p>
            </div>

            {/* Glass card */}
            <div style={{
              width: "100%",
              background: "linear-gradient(165deg, rgba(10,22,36,0.9) 0%, rgba(6,12,22,0.95) 100%)",
              border: "1px solid rgba(0,212,255,0.22)",
              borderRadius: 22,
              padding: "26px 24px 22px",
              boxShadow: "0 30px 80px rgba(0,0,0,0.55), 0 0 60px rgba(0,212,255,0.08), inset 0 1px 0 rgba(255,255,255,0.05)",
              animation: "w2CardIn 0.5s cubic-bezier(0.2,1,0.3,1) 0.15s backwards",
              position: "relative", overflow: "hidden",
            }}>
              {/* Top beam */}
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0, height: 2,
                background: "linear-gradient(90deg, transparent, #00d4ff, #0088ff, #00FF88, transparent)",
                opacity: 0.75,
              }} />

              {error && (
                <div style={{
                  marginBottom: 14, padding: "10px 14px",
                  background: "rgba(255,68,68,0.08)",
                  border: "1px solid rgba(255,68,68,0.3)",
                  borderRadius: 10,
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: 12, color: "#ff8080",
                  animation: "w2ChipIn 0.25s ease",
                }}>{error}</div>
              )}

              {/* Google */}
              <button className="w2-btn" onClick={handleGoogle} disabled={!!busy} style={{
                marginBottom: 10,
                background: "linear-gradient(180deg,#ffffff,#f3f4f6)",
                border: "1px solid rgba(0,0,0,0.08)",
                color: "#1f1f1f",
                boxShadow: "0 6px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.6)",
              }}>
                {busy === "google" ? <Spinner color="#1f1f1f" /> : (
                  <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                )}
                <span>{busy === "google" ? "Signing in…" : "Continue with Google"}</span>
                <span className="w2-arrow" style={{ color: "#1f1f1f" }}><ArrowIcon /></span>
              </button>

              {/* X / Twitter */}
              <button className="w2-btn" onClick={handleTwitter} disabled={!!busy} style={{
                marginBottom: 10,
                background: "linear-gradient(180deg,#111,#000)",
                border: "1px solid rgba(255,255,255,0.14)",
                color: "#fff",
                boxShadow: "0 6px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)",
              }}>
                {busy === "twitter" ? <Spinner color="#fff" /> : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2H21l-6.56 7.496L22 22h-5.962l-4.717-6.08L5.9 22H3.144l7.019-8.019L2 2h6.117l4.26 5.63L18.244 2zm-1.02 18h1.636L7.886 3.898H6.13L17.224 20z"/>
                  </svg>
                )}
                <span>{busy === "twitter" ? "Signing in…" : "Continue with X"}</span>
                <span className="w2-arrow"><ArrowIcon /></span>
              </button>

              {/* Divider */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0 14px" }}>
                <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.14))" }} />
                <span style={{
                  fontFamily: "'Rajdhani', sans-serif",
                  fontSize: 10, color: "rgba(255,255,255,0.4)",
                  letterSpacing: "0.25em", fontWeight: 700,
                }}>OR</span>
                <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, rgba(255,255,255,0.14), transparent)" }} />
              </div>

              {/* Guest */}
              <button className="w2-btn" onClick={handleGuest} disabled={!!busy} style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px dashed rgba(255,255,255,0.14)",
                color: "rgba(200,215,235,0.9)",
                padding: "12px 18px", fontSize: 13,
              }}>
                {busy === "guest" ? <Spinner color="#c8d7eb" size={16} /> : <GuestIcon />}
                <span>{busy === "guest" ? "Starting…" : "Continue as Guest"}</span>
                <span className="w2-arrow"><ArrowIcon size={14} /></span>
              </button>
              <div style={{
                marginTop: 8,
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: 11, color: "rgba(200,215,235,0.4)",
                textAlign: "center",
              }}>
                Guests can play, but don't earn ArcadeCoins.
              </div>

              {/* Switch mode footer */}
              <div style={{
                marginTop: 20, paddingTop: 16,
                borderTop: "1px solid rgba(255,255,255,0.06)",
                display: "flex", justifyContent: "center",
              }}>
                <button onClick={clearMode} style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: "transparent", border: "none",
                  color: "rgba(176,136,255,0.7)",
                  fontFamily: "'Rajdhani', sans-serif",
                  fontSize: 11, fontWeight: 700,
                  letterSpacing: "0.18em", textTransform: "uppercase",
                  cursor: "pointer", padding: 6,
                  transition: "color 0.2s",
                }}
                  onMouseEnter={e => e.currentTarget.style.color = "#c6a8ff"}
                  onMouseLeave={e => e.currentTarget.style.color = "rgba(176,136,255,0.7)"}
                >
                  ← Switch to Web3 Mode
                </button>
              </div>
            </div>

            {/* Trust microcopy */}
            <div style={{
              marginTop: 18, display: "flex", alignItems: "center", gap: 10,
              fontFamily: "'Rajdhani', sans-serif",
              fontSize: 10, color: "rgba(150,170,200,0.4)",
              letterSpacing: "0.2em", textTransform: "uppercase",
            }}>
              <span style={{ width: 24, height: 1, background: "linear-gradient(90deg, transparent, rgba(150,170,200,0.3))" }} />
              Secure sign-in via Firebase
              <span style={{ width: 24, height: 1, background: "linear-gradient(90deg, rgba(150,170,200,0.3), transparent)" }} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
