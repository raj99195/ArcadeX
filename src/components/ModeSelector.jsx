// src/components/ModeSelector.jsx
//
// First-visit mode picker. Full-screen immersive overlay — animated
// particle grid + mesh gradient backdrop, two glass-depth cards with
// custom SVG iconography and tilt-on-hover micro-interactions.
//
// Typography stack (loaded in index.html):
//   Orbitron       — mega display (ArcadeX wordmark, mode names)
//   Rajdhani       — labels & feature chips (condensed sans)
//   Space Grotesk  — body copy
//
// z-index 10000 — above ChainSelector (9999). Dismisses by setting mode
// in localStorage via useMode.setMode(key).

import { useEffect, useState, useRef } from "react";
import { useMode } from "../hooks/useMode";

// ── Icons ──────────────────────────────────────────────────────────
// Custom SVGs instead of emoji — they inherit `currentColor` so the
// hover glow can tint the icon live without needing a second asset.

function JoypadIcon({ size = 56 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 20h28a10 10 0 0 1 10 10v4a10 10 0 0 1-10 10h-5l-4-6H25l-4 6h-5A10 10 0 0 1 6 34v-4a10 10 0 0 1 10-10h2z" fill="rgba(0,212,255,0.08)" />
      <path d="M16 30h8M20 26v8" />
      <circle cx="43" cy="29" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="49" cy="34" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="37" cy="34" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="43" cy="39" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ChainIcon({ size = 56 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="12" y="22" width="20" height="20" rx="6" fill="rgba(123,47,255,0.08)" />
      <rect x="32" y="22" width="20" height="20" rx="6" fill="rgba(123,47,255,0.12)" />
      <path d="M24 32h16" />
      <circle cx="22" cy="32" r="3" fill="currentColor" stroke="none" />
      <circle cx="42" cy="32" r="3" fill="currentColor" stroke="none" />
      <path d="M18 18l-4-4M46 46l4 4M46 18l4-4M18 46l-4 4" strokeWidth="2" opacity="0.5" />
    </svg>
  );
}

function CheckIcon({ color = "#00FF88" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="7" fill={`${color}1a`} />
      <path d="M4 7.5l2 2 4-4.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9h12M10 4l5 5-5 5" />
    </svg>
  );
}

// ── Particle field ────────────────────────────────────────────────
// Floating dots with per-dot drift. Canvas is cheap vs. DOM nodes and
// renders behind the glass cards for atmosphere.
function ParticleField() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf = 0;
    let w = 0, h = 0;
    const dots = [];
    const COUNT = 60;

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
        x: Math.random() * w,
        y: Math.random() * h,
        r: (Math.random() * 1.8 + 0.6) * window.devicePixelRatio,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
        hue: Math.random() < 0.5 ? "0,212,255" : "123,47,255",
        alpha: Math.random() * 0.5 + 0.2,
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

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.9 }}
    />
  );
}

// ── Tilt card ─────────────────────────────────────────────────────
// Reads pointer position relative to the card and applies a subtle 3D
// rotation. transformStyle: preserve-3d so children (icon, badge) can
// also offset in Z for a parallax feel.
function TiltCard({ children, color, borderColor, glowColor, onClick, delay }) {
  const ref = useRef(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, hover: false });

  const onMove = (e) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    const ry = (px - 0.5) * 8;    // left/right tilt
    const rx = (0.5 - py) * 8;    // up/down tilt
    setTilt({ rx, ry, hover: true });
  };
  const onLeave = () => setTilt({ rx: 0, ry: 0, hover: false });

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onClick={onClick}
      className="ms-card"
      style={{
        cursor: "pointer",
        position: "relative",
        borderRadius: 24,
        padding: "32px 28px 28px",
        background: color,
        border: `1px solid ${tilt.hover ? borderColor.hover : borderColor.rest}`,
        boxShadow: tilt.hover
          ? `0 30px 80px rgba(0,0,0,0.6), 0 0 60px ${glowColor}, inset 0 1px 0 rgba(255,255,255,0.08)`
          : `0 14px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)`,
        transform: `perspective(1200px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) ${tilt.hover ? "translateZ(10px)" : ""}`,
        transformStyle: "preserve-3d",
        transition: "transform 0.25s cubic-bezier(0.2,1,0.3,1), box-shadow 0.25s, border-color 0.25s",
        overflow: "hidden",
        animation: `msCardIn 0.65s cubic-bezier(0.34,1.56,0.64,1) ${delay}s backwards`,
      }}
    >
      {children({ hover: tilt.hover })}
    </div>
  );
}

export default function ModeSelector() {
  const { setMode } = useMode();
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const r = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);

  return (
    <>
      <style>{`
        @keyframes msBgIn    { from{opacity:0} to{opacity:1} }
        @keyframes msCardIn  { from{opacity:0;transform:perspective(1200px) translateY(24px) rotateX(-6deg)} to{opacity:1;transform:perspective(1200px) translateY(0) rotateX(0)} }
        @keyframes msHaloIn  { from{opacity:0;transform:scale(0.6)} to{opacity:1;transform:scale(1)} }
        @keyframes msTitleIn { from{opacity:0;letter-spacing:0.15em} to{opacity:1;letter-spacing:0.02em} }
        @keyframes msBeam    { 0%{transform:translateX(-120%) skewX(-20deg)} 100%{transform:translateX(220%) skewX(-20deg)} }
        @keyframes msGradFlow{ 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
        @keyframes msPulse   { 0%,100%{transform:scale(1);opacity:0.55} 50%{transform:scale(1.08);opacity:0.9} }
        @keyframes msOrbit   { from{transform:rotate(0)} to{transform:rotate(360deg)} }

        .ms-title {
          font-family: 'Orbitron', 'Rajdhani', sans-serif;
          font-weight: 900;
          background: linear-gradient(90deg,#ffffff 0%,#9ee8ff 25%,#b58bff 50%,#9ee8ff 75%,#ffffff 100%);
          background-size: 300% auto;
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: msGradFlow 10s linear infinite, msTitleIn 1s ease both;
          text-shadow: 0 0 60px rgba(123,47,255,0.3);
        }
        .ms-sub {
          font-family: 'Rajdhani', sans-serif;
          font-weight: 500;
          letter-spacing: 0.35em;
          text-transform: uppercase;
        }
        .ms-cta {
          display: inline-flex; align-items: center; gap: 10px;
          justify-content: center;
          padding: 13px 20px;
          border-radius: 12px;
          font-family: 'Rajdhani', sans-serif;
          font-weight: 700; font-size: 14px;
          letter-spacing: 0.08em; text-transform: uppercase;
          transition: all 0.25s cubic-bezier(0.2,1,0.3,1);
          position: relative; overflow: hidden;
        }
        .ms-cta::after {
          content: ""; position: absolute; top: 0; left: 0; height: 100%; width: 50px;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);
          opacity: 0; transition: opacity 0.25s;
        }
        .ms-card:hover .ms-cta::after {
          opacity: 1;
          animation: msBeam 1.2s ease-in-out infinite;
        }
        .ms-card:hover .ms-arrow {
          transform: translateX(4px);
        }
        .ms-arrow { transition: transform 0.25s cubic-bezier(0.2,1,0.3,1); }
      `}</style>

      <div style={{
        position: "fixed", inset: 0, zIndex: 10000,
        overflow: "hidden",
        animation: "msBgIn 0.35s ease",
      }}>
        {/* ── Layered backdrop ── */}
        {/* 1. Base black */}
        <div style={{ position: "absolute", inset: 0, background: "#040309" }} />

        {/* 2. Mesh gradient (two large soft-light radial beams) */}
        <div style={{
          position: "absolute", inset: 0,
          background:
            "radial-gradient(ellipse 70% 55% at 20% 30%, rgba(123,47,255,0.28) 0%, transparent 60%)," +
            "radial-gradient(ellipse 65% 50% at 85% 75%, rgba(0,212,255,0.22) 0%, transparent 55%)," +
            "radial-gradient(circle at 50% 50%, rgba(255,183,0,0.05) 0%, transparent 40%)",
          filter: "saturate(1.1)",
        }} />

        {/* 3. Fine grid */}
        <div style={{
          position: "absolute", inset: 0, opacity: 0.35,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse 70% 70% at 50% 40%, #000 20%, transparent 85%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 70% at 50% 40%, #000 20%, transparent 85%)",
        }} />

        {/* 4. Floating particle layer */}
        <ParticleField />

        {/* 5. Vignette */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(circle at 50% 50%, transparent 55%, rgba(0,0,0,0.65) 100%)",
        }} />

        {/* ── Content ── */}
        <div style={{
          position: "relative", zIndex: 2,
          minHeight: "100%", width: "100%",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: isMobile ? "32px 18px" : "40px 24px",
          overflowY: "auto",
        }}>
          <div style={{
            maxWidth: 920, width: "100%",
            display: "flex", flexDirection: "column", alignItems: "center",
          }}>
            {/* ── Header ── */}
            <div style={{ textAlign: "center", marginBottom: isMobile ? 32 : 48, position: "relative" }}>
              {/* Halo + orbit ring behind logo */}
              <div style={{
                position: "absolute", top: "50%", left: "50%",
                width: 160, height: 160, transform: "translate(-50%,-50%)",
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(123,47,255,0.4) 0%, transparent 60%)",
                animation: "msPulse 3.5s ease-in-out infinite",
                pointerEvents: "none",
              }} />
              <div style={{
                position: "absolute", top: "50%", left: "50%",
                width: 110, height: 110, transform: "translate(-50%,-50%)",
                borderRadius: "50%",
                border: "1px dashed rgba(255,255,255,0.12)",
                animation: "msOrbit 20s linear infinite",
                pointerEvents: "none",
              }} />

              <img src="/IA-logo.webp" alt="ArcadeX" style={{
                position: "relative", width: 68, height: 68,
                objectFit: "contain",
                filter: "drop-shadow(0 0 30px rgba(150,80,255,0.9)) drop-shadow(0 0 50px rgba(0,212,255,0.4))",
                animation: "msHaloIn 0.7s cubic-bezier(0.34,1.56,0.64,1)",
              }} />

              <div className="ms-sub" style={{
                marginTop: 22, fontSize: 10,
                color: "rgba(180,200,255,0.55)",
              }}>
                Welcome · The Multi-Chain Arcade
              </div>

              <h1 className="ms-title" style={{
                marginTop: 10,
                fontSize: isMobile ? 42 : 68,
                lineHeight: 1,
                textTransform: "uppercase",
              }}>
                ArcadeX
              </h1>

              <p style={{
                marginTop: 14,
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: isMobile ? 14 : 16,
                color: "rgba(220,210,255,0.65)",
                maxWidth: 500, marginLeft: "auto", marginRight: "auto",
                lineHeight: 1.5,
              }}>
                Pick how you want to play.{" "}
                <span style={{ color: "#9ee8ff" }}>Casual &amp; instant</span>, or{" "}
                <span style={{ color: "#c6a8ff" }}>on-chain &amp; owned</span>.
              </p>
            </div>

            {/* ── Cards ── */}
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
              gap: isMobile ? 18 : 24,
              width: "100%",
            }}>
              {/* WEB2 */}
              <TiltCard
                onClick={() => setMode("web2")}
                delay={0.12}
                color="linear-gradient(165deg, rgba(6,22,36,0.95) 0%, rgba(4,12,22,0.98) 100%)"
                borderColor={{ rest: "rgba(0,212,255,0.22)", hover: "rgba(0,212,255,0.75)" }}
                glowColor="rgba(0,212,255,0.3)"
              >
                {({ hover }) => (
                  <>
                    {/* Top accent beam */}
                    <div style={{
                      position: "absolute", top: 0, left: 0, right: 0, height: 2,
                      background: "linear-gradient(90deg, transparent, #00d4ff, #0088ff, transparent)",
                      opacity: hover ? 1 : 0.65,
                      transition: "opacity 0.25s",
                    }} />
                    {/* Corner glow */}
                    <div style={{
                      position: "absolute", top: -80, right: -60, width: 220, height: 220,
                      background: "radial-gradient(circle, rgba(0,212,255,0.22) 0%, transparent 70%)",
                      borderRadius: "50%", pointerEvents: "none",
                      transform: hover ? "scale(1.15)" : "scale(1)",
                      transition: "transform 0.35s",
                    }} />

                    {/* Icon + chip row */}
                    <div style={{
                      display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                      marginBottom: 20, transform: "translateZ(20px)",
                    }}>
                      <div style={{
                        width: 72, height: 72,
                        borderRadius: 18,
                        background: "linear-gradient(135deg, rgba(0,212,255,0.18), rgba(0,136,255,0.08))",
                        border: "1px solid rgba(0,212,255,0.3)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#00d4ff",
                        boxShadow: hover ? "0 0 24px rgba(0,212,255,0.4) inset" : "none",
                        transition: "box-shadow 0.25s",
                      }}>
                        <JoypadIcon size={44} />
                      </div>
                      <span style={{
                        padding: "4px 10px", borderRadius: 999,
                        background: "rgba(0,255,136,0.1)",
                        border: "1px solid rgba(0,255,136,0.3)",
                        color: "#00ff88",
                        fontFamily: "'Rajdhani', sans-serif",
                        fontWeight: 700, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
                      }}>Recommended</span>
                    </div>

                    <div className="ms-sub" style={{
                      color: "#6fb8d4", fontSize: 10, marginBottom: 6,
                    }}>Casual · No Wallet</div>

                    <h2 style={{
                      fontFamily: "'Orbitron', sans-serif",
                      fontWeight: 800,
                      fontSize: isMobile ? 26 : 30,
                      color: "#fff", margin: 0, letterSpacing: "0.02em",
                      textTransform: "uppercase",
                    }}>Web2 Mode</h2>

                    <p style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontSize: 14, color: "rgba(190,220,240,0.72)",
                      lineHeight: 1.55, marginTop: 10, marginBottom: 20,
                    }}>
                      Sign in with Google, X or play as Guest. Start earning{" "}
                      <span style={{ color: "#00d4ff", fontWeight: 600 }}>ArcadeCoins</span>{" "}
                      in seconds.
                    </p>

                    <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 24 }}>
                      {["Instant sign-in · no wallet setup", "Daily ArcadeCoins — free to earn", "Zero gas, zero friction, zero waiting"].map(t => (
                        <div key={t} style={{
                          display: "flex", alignItems: "center", gap: 9,
                          fontFamily: "'Space Grotesk', sans-serif",
                          fontSize: 13, color: "rgba(200,230,245,0.85)",
                        }}>
                          <CheckIcon color="#00d4ff" />{t}
                        </div>
                      ))}
                    </div>

                    <div className="ms-cta" style={{
                      background: hover
                        ? "linear-gradient(135deg,#00d4ff,#0088ff)"
                        : "rgba(0,212,255,0.08)",
                      border: `1px solid ${hover ? "transparent" : "rgba(0,212,255,0.35)"}`,
                      color: hover ? "#001424" : "#00d4ff",
                    }}>
                      Enter Web2 Mode
                      <span className="ms-arrow"><ArrowIcon /></span>
                    </div>
                  </>
                )}
              </TiltCard>

              {/* WEB3 */}
              <TiltCard
                onClick={() => setMode("web3")}
                delay={0.22}
                color="linear-gradient(165deg, rgba(22,8,38,0.95) 0%, rgba(12,6,20,0.98) 100%)"
                borderColor={{ rest: "rgba(123,47,255,0.28)", hover: "rgba(167,120,255,0.75)" }}
                glowColor="rgba(123,47,255,0.35)"
              >
                {({ hover }) => (
                  <>
                    <div style={{
                      position: "absolute", top: 0, left: 0, right: 0, height: 2,
                      background: "linear-gradient(90deg, transparent, #7B2FFF, #ff6ec4, #FFB700, transparent)",
                      opacity: hover ? 1 : 0.65,
                      transition: "opacity 0.25s",
                    }} />
                    <div style={{
                      position: "absolute", top: -80, right: -60, width: 220, height: 220,
                      background: "radial-gradient(circle, rgba(123,47,255,0.25) 0%, transparent 70%)",
                      borderRadius: "50%", pointerEvents: "none",
                      transform: hover ? "scale(1.15)" : "scale(1)",
                      transition: "transform 0.35s",
                    }} />

                    <div style={{
                      display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                      marginBottom: 20, transform: "translateZ(20px)",
                    }}>
                      <div style={{
                        width: 72, height: 72, borderRadius: 18,
                        background: "linear-gradient(135deg, rgba(123,47,255,0.22), rgba(90,31,212,0.08))",
                        border: "1px solid rgba(167,120,255,0.35)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#b58bff",
                        boxShadow: hover ? "0 0 24px rgba(123,47,255,0.4) inset" : "none",
                        transition: "box-shadow 0.25s",
                      }}>
                        <ChainIcon size={44} />
                      </div>
                      <span style={{
                        padding: "4px 10px", borderRadius: 999,
                        background: "linear-gradient(135deg,#FFB700,#ff6b35)",
                        color: "#1a0d00",
                        fontFamily: "'Rajdhani', sans-serif",
                        fontWeight: 800, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
                        boxShadow: "0 0 18px rgba(255,183,0,0.35)",
                      }}>Full Experience</span>
                    </div>

                    <div className="ms-sub" style={{
                      color: "#b58bff", fontSize: 10, marginBottom: 6,
                    }}>Play · Earn · Own</div>

                    <h2 style={{
                      fontFamily: "'Orbitron', sans-serif",
                      fontWeight: 800,
                      fontSize: isMobile ? 26 : 30,
                      color: "#fff", margin: 0, letterSpacing: "0.02em",
                      textTransform: "uppercase",
                    }}>Web3 Mode</h2>

                    <p style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontSize: 14, color: "rgba(220,205,245,0.72)",
                      lineHeight: 1.55, marginTop: 10, marginBottom: 20,
                    }}>
                      Connect your wallet, earn real{" "}
                      <span style={{ color: "#c6a8ff", fontWeight: 600 }}>ARCADE / MSTC</span>{" "}
                      tokens on-chain. Tournaments, NFTs, marketplace.
                    </p>

                    <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 24 }}>
                      {["Real on-chain token rewards", "Tournaments, NFTs & marketplace", "Multi-chain: BOTChain · MST · Somnia"].map(t => (
                        <div key={t} style={{
                          display: "flex", alignItems: "center", gap: 9,
                          fontFamily: "'Space Grotesk', sans-serif",
                          fontSize: 13, color: "rgba(230,215,245,0.85)",
                        }}>
                          <CheckIcon color="#b58bff" />{t}
                        </div>
                      ))}
                    </div>

                    <div className="ms-cta" style={{
                      background: hover
                        ? "linear-gradient(135deg,#7B2FFF,#5a1fd4)"
                        : "rgba(123,47,255,0.08)",
                      border: `1px solid ${hover ? "transparent" : "rgba(167,120,255,0.4)"}`,
                      color: hover ? "#fff" : "#c6a8ff",
                    }}>
                      Enter Web3 Mode
                      <span className="ms-arrow"><ArrowIcon /></span>
                    </div>
                  </>
                )}
              </TiltCard>
            </div>

            {/* Footer */}
            <div style={{
              marginTop: isMobile ? 28 : 36,
              display: "flex", alignItems: "center", gap: 10,
              fontFamily: "'Rajdhani', sans-serif",
              fontSize: 11, color: "rgba(176,160,220,0.5)",
              letterSpacing: "0.2em", textTransform: "uppercase",
            }}>
              <span style={{ width: 36, height: 1, background: "linear-gradient(90deg, transparent, rgba(176,160,220,0.35))" }} />
              Switch anytime from the menu
              <span style={{ width: 36, height: 1, background: "linear-gradient(90deg, rgba(176,160,220,0.35), transparent)" }} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
