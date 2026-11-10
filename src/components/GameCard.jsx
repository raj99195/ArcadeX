import { useNavigate } from "react-router-dom";
import { useRef, useState } from "react";
import { useChain } from "../context/ChainContext";
import { useMode } from "../hooks/useMode";
import { Icon } from "./Icon";

const tagColors = {
  HOT: { bg: "linear-gradient(135deg,#ff4444,#ff7700)", color: "#fff", glow: "rgba(255,68,68,0.6)" },
  NEW: { bg: "linear-gradient(135deg,#7B2FFF,#b45cff)", color: "#fff", glow: "rgba(123,47,255,0.6)" },
  TOP: { bg: "linear-gradient(90deg,#7B2FFF,#00d4ff)", color: "#fff", glow: "rgba(0,212,255,0.6)" },
};

export default function GameCard({ game }) {
  const navigate = useNavigate();
  const { rewardToken, isNativeToken } = useChain();
  const { mode } = useMode();
  const isWeb2 = mode === "web2";
  const rewardSymbol = isWeb2 ? "ArcadeCoins" : (rewardToken || "ARCADE");
  const rewardRate = isWeb2
    ? (game.rewardRate || 50)
    : ((isNativeToken ? game.rewardRateNative : game.rewardRate) || (isNativeToken ? 1 : 50));
  const rewardColor = isWeb2 ? "#FFD56A" : "#a67fff";
  const accent = isWeb2 ? "0,212,255" : "123,47,255";

  const cardRef = useRef(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, hover: false });

  const onMove = (e) => {
    const r = cardRef.current?.getBoundingClientRect();
    if (!r) return;
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    const ry = (px - 0.5) * 6;
    const rx = (0.5 - py) * 6;
    setTilt({ rx, ry, hover: true });
  };
  const onLeave = () => setTilt({ rx: 0, ry: 0, hover: false });

  return (
    <div
      ref={cardRef}
      onClick={() => navigate(`/play/${game.id}`)}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className="ax-fade-up ax-shine-sweep"
      style={{
        background: tilt.hover
          ? `linear-gradient(145deg, rgba(${accent},0.12), #0e0c1a 60%)`
          : "#0e0c1a",
        border: `1px solid rgba(${accent},${tilt.hover ? 0.5 : 0.1})`,
        borderRadius: 12,
        overflow: "hidden",
        cursor: "pointer",
        transition: "background 0.25s, border-color 0.25s, box-shadow 0.25s, transform 0.3s cubic-bezier(0.2,1,0.3,1)",
        transform: `perspective(1000px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) ${tilt.hover ? "translateY(-6px) translateZ(12px)" : "translateY(0)"}`,
        transformStyle: "preserve-3d",
        boxShadow: tilt.hover
          ? `0 20px 50px rgba(0,0,0,0.6), 0 0 30px rgba(${accent},0.35), inset 0 0 0 1px rgba(${accent},0.3)`
          : "0 4px 12px rgba(0,0,0,0.3)",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* Top accent beam appears on hover */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2, zIndex: 3,
        background: `linear-gradient(90deg, transparent, rgba(${accent},1), transparent)`,
        opacity: tilt.hover ? 1 : 0,
        transition: "opacity 0.3s",
      }} />

      {/* ── THUMBNAIL ── */}
      <div style={{
        width: "100%",
        paddingTop: "62%",
        position: "relative",
        background: game.bg || "#0d0a1a",
        overflow: "hidden",
        flexShrink: 0,
      }}>
        {game.thumbnailUrl ? (
          <img
            src={game.thumbnailUrl}
            alt={game.name}
            loading="lazy"
            style={{
              position: "absolute",
              top: 0, left: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center",
              display: "block",
              transition: "transform 0.6s cubic-bezier(0.2,1,0.3,1), filter 0.3s",
              transform: tilt.hover ? "scale(1.08)" : "scale(1)",
              filter: tilt.hover ? "saturate(1.2) brightness(1.08)" : "none",
            }}
            onError={e => { e.target.style.display = "none"; }}
          />
        ) : (
          <span
            className={tilt.hover ? "ax-aura" : ""}
            style={{
              position: "absolute",
              top: 0, left: 0,
              width: "100%", height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: isWeb2 ? "rgba(0,212,255,0.75)" : "rgba(166,127,255,0.75)",
              transition: "transform 0.4s",
              transform: tilt.hover ? "scale(1.15)" : "scale(1)",
            }}>
            <Icon name="controller" size={44} />
          </span>
        )}

        {/* Gradient darkening overlay */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          height: "55%",
          background: "linear-gradient(to top, rgba(14,12,26,0.92), transparent)",
          pointerEvents: "none",
          zIndex: 1,
        }} />

        {/* Scan line on hover */}
        {tilt.hover && (
          <div style={{
            position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2,
            overflow: "hidden",
          }}>
            <div style={{
              position: "absolute", left: 0, right: 0, height: 2,
              background: `linear-gradient(90deg, transparent, rgba(${accent},0.8), transparent)`,
              animation: "axScanLine 2.2s linear infinite",
            }} />
          </div>
        )}

        {game.tag && (
          <span
            className={tilt.hover ? "ax-neon-flicker" : ""}
            style={{
              position: "absolute", top: 10, left: 10, zIndex: 3,
              padding: "4px 10px", borderRadius: 5,
              fontSize: 11, fontWeight: 800,
              letterSpacing: "0.08em", textTransform: "uppercase",
              fontFamily: "'Rajdhani',sans-serif",
              background: tagColors[game.tag]?.bg || "#7B2FFF",
              color: tagColors[game.tag]?.color || "#fff",
              boxShadow: tilt.hover ? `0 0 14px ${tagColors[game.tag]?.glow || "rgba(123,47,255,0.6)"}` : "0 2px 6px rgba(0,0,0,0.4)",
              transition: "box-shadow 0.3s",
              transform: "translateZ(20px)",
            }}>
            {game.tag}
          </span>
        )}

        <span style={{
          position: "absolute", bottom: 10, left: 10, zIndex: 3,
          padding: "3px 10px", borderRadius: 4,
          fontSize: 11, color: tilt.hover ? "rgba(220,200,255,0.95)" : "rgba(200,180,235,0.85)",
          background: tilt.hover ? `rgba(${accent},0.3)` : "rgba(123,47,255,0.2)",
          border: `1px solid rgba(${accent},${tilt.hover ? 0.6 : 0.3})`,
          backdropFilter: "blur(6px)",
          fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: "0.04em",
          transition: "all 0.3s",
          transform: "translateZ(15px)",
        }}>
          {game.category}
        </span>

        {/* Hover-only play icon in corner */}
        {tilt.hover && (
          <div
            className="ax-pop-in"
            style={{
              position: "absolute", bottom: 10, right: 10, zIndex: 3,
              width: 36, height: 36, borderRadius: "50%",
              background: `linear-gradient(135deg, rgba(${accent},0.9), rgba(${accent},0.5))`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", boxShadow: `0 0 16px rgba(${accent},0.7)`,
              transform: "translateZ(25px)",
            }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M3 2 L11 7 L3 12 Z" />
            </svg>
          </div>
        )}
      </div>

      {/* ── INFO ── */}
      <div style={{ padding: "12px 14px 0", flex: 1, position: "relative", zIndex: 1 }}>
        <div style={{
          fontSize: 14, fontWeight: 700, marginBottom: 4,
          fontFamily: "'Rajdhani',sans-serif", letterSpacing: "0.2px",
          color: tilt.hover ? "#fff" : "#f3f0ff",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          textShadow: tilt.hover ? `0 0 12px rgba(${accent},0.5)` : "none",
          transition: "text-shadow 0.3s, color 0.3s",
        }}>
          {game.name}
        </div>
        <div style={{
          fontSize: 13, color: "#c0b8e0", marginBottom: 8,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontFamily: "'Rajdhani',sans-serif", fontWeight: 500,
          lineHeight: 1.4,
        }}>
          {game.description || "A blockchain game on ArcadeX"}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 10 }}>
          <span
            className={tilt.hover ? "ax-flicker" : ""}
            style={{
              fontSize: 12, color: rewardColor, fontFamily: "'Orbitron',sans-serif",
              fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4,
              textShadow: tilt.hover ? `0 0 8px ${rewardColor}` : "none",
              transition: "text-shadow 0.3s",
            }}>
            +{rewardRate}
            {isWeb2 && <Icon name="coin" size={12} />}
            <span>{rewardSymbol}</span>
          </span>
        </div>
      </div>

      {/* ── PLAY BUTTON ── */}
      <div style={{ padding: "0 14px 12px", position: "relative", zIndex: 1 }}>
        <button
          className="play-btn ax-beam-host"
          style={{
            width: "100%", padding: "10px",
            background: tilt.hover
              ? `linear-gradient(90deg, rgba(${accent},1), rgba(${accent},0.6), rgba(${accent},1))`
              : "linear-gradient(90deg,#7B2FFF,#5a1fd4)",
            backgroundSize: "200% 100%",
            backgroundPosition: tilt.hover ? "100% 50%" : "0% 50%",
            border: `1px solid rgba(${accent},${tilt.hover ? 0.8 : 0.4})`,
            borderRadius: 7,
            fontFamily: "'Rajdhani',sans-serif", fontWeight: 800,
            fontSize: 12.5, color: "#fff",
            cursor: "pointer", letterSpacing: "0.1em",
            textTransform: "uppercase",
            transition: "background 0.3s, background-position 0.5s, box-shadow 0.3s, transform 0.2s",
            boxShadow: tilt.hover ? `0 6px 20px rgba(${accent},0.5), 0 0 20px rgba(${accent},0.3) inset` : "none",
            transform: tilt.hover ? "translateY(-1px)" : "translateY(0)",
          }}
        >
          {tilt.hover ? "▶ Play Now" : "Play Now"}
        </button>
      </div>
    </div>
  );
}
