// src/components/BattleShop3DViewer.jsx
//
// Full-screen 3D model preview for a shop item. Uses Google's <model-viewer>
// web component (lazy-loaded from CDN on first open) which handles:
//   • Mouse drag → rotate
//   • Scroll wheel → zoom
//   • Touch: 1-finger rotate, pinch zoom
//   • Optional auto-rotate
//
// Only .glb models are supported (single-file binary GLTF — small, portable,
// no external asset chasing). Admin uploads .glb via ShopItemModal.
//
// Props:
//   open:    boolean
//   item:    { itemId, name, rarity, category, description, imageUrl,
//              modelUrl, priceARCADE, priceUSDC }
//   isOwned: boolean
//   onBuy(item, currency, price):  triggered when user clicks BUY inside viewer
//   onClose():                     dismiss viewer

import { useEffect, useRef, useState } from "react";

const MODEL_VIEWER_CDN =
  "https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js";

// Lazy-load the model-viewer script only once, even across multiple mounts.
function loadModelViewerScript() {
  if (typeof window === "undefined") return Promise.resolve();
  if (customElements.get("model-viewer")) return Promise.resolve();
  if (window.__arcadex_mv_loading) return window.__arcadex_mv_loading;

  window.__arcadex_mv_loading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.type    = "module";
    s.src     = MODEL_VIEWER_CDN;
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error("Failed to load 3D viewer library"));
    document.head.appendChild(s);
  });
  return window.__arcadex_mv_loading;
}

const S = {
  bg:          "rgba(4,3,10,0.96)",
  panel:       "rgba(12,8,28,0.95)",
  panelSolid:  "#0d0b1a",
  border:      "rgba(139,92,246,0.35)",
  borderHot:   "rgba(0,229,255,0.6)",
  violet:      "#8b5cf6",
  violetL:     "#c4b5fd",
  cyan:        "#00e5ff",
  cyanL:       "#7ff5ff",
  magenta:     "#ec4899",
  green:       "#00ff88",
  gold:        "#ffb700",
  danger:      "#ff3860",
  dim:         "#9977cc",
  dimMore:     "#5533aa",
  raj:         "'Rajdhani', sans-serif",
  orb:         "'Orbitron', sans-serif",
};

const RARITY = {
  common:    { color: "#7c8ca7", glow: "rgba(124,140,167,0.4)", label: "COMMON" },
  rare:      { color: S.cyan,     glow: "rgba(0,229,255,0.5)",   label: "RARE" },
  epic:      { color: S.violet,   glow: "rgba(139,92,246,0.5)",  label: "EPIC" },
  legendary: { color: S.gold,     glow: "rgba(255,183,0,0.6)",   label: "LEGENDARY" },
};

const CATEGORY_ICON = {
  gun_skin:    "🔫",
  environment: "🌌",
  power_up:    "⚡",
  cosmetic:    "✨",
};

export default function BattleShop3DViewer({ open, item, isOwned, onBuy, onClose }) {
  const [scriptReady, setScriptReady] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [loadError,   setLoadError]   = useState(null);
  const [autoRotate,  setAutoRotate]  = useState(true);
  const [isMobile,    setIsMobile]    = useState(window.innerWidth <= 768);
  const mvRef = useRef(null);

  // Reset load state whenever the item changes
  useEffect(() => {
    setModelLoaded(false);
    setLoadError(null);
  }, [item?.itemId, item?.modelUrl]);

  // Mobile detection
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  // Lazy-load model-viewer script on first open
  useEffect(() => {
    if (!open) return;
    loadModelViewerScript()
      .then(() => setScriptReady(true))
      .catch((e) => setLoadError(e.message));
  }, [open]);

  // Body scroll lock while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Attach load/error listeners to <model-viewer>
  useEffect(() => {
    if (!scriptReady || !mvRef.current) return;
    const el = mvRef.current;
    const onLoad  = () => setModelLoaded(true);
    const onError = (e) => setLoadError("Model failed to load — check the file");
    el.addEventListener("load", onLoad);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("load", onLoad);
      el.removeEventListener("error", onError);
    };
  }, [scriptReady, item?.modelUrl]);

  if (!open || !item) return null;

  const rarity = RARITY[item.rarity] || RARITY.common;

  // Price currency handling (single-price fast path, else default to ARCADE)
  const hasArcade = item.priceARCADE > 0;
  const hasUsdc   = item.priceUSDC > 0;
  const [selectedCurrency, setSelectedCurrency] = useState("");
  // Initialize once when opened / item changes
  useEffect(() => {
    if (!open) return;
    setSelectedCurrency(hasArcade ? "ARCADE" : (hasUsdc ? "USDC" : ""));
  }, [open, item?.itemId, hasArcade, hasUsdc]);

  const currentPrice = selectedCurrency === "ARCADE" ? item.priceARCADE
                     : selectedCurrency === "USDC"   ? item.priceUSDC
                     : 0;

  const handleBuyClick = () => {
    if (!selectedCurrency || !currentPrice || isOwned) return;
    onBuy(item, selectedCurrency, currentPrice);
  };

  const backdropClose = (e) => { if (e.target === e.currentTarget) onClose(); };

  return (
    <div
      onClick={backdropClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: S.bg,
        backdropFilter: "blur(14px)",
        display: "flex", flexDirection: "column",
        animation: "viewer3DFadeIn 0.3s ease",
      }}
    >
      {/* Ambient background glow tied to rarity */}
      <div
        style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background:
            `radial-gradient(ellipse at 20% 40%, ${rarity.glow} 0%, transparent 60%),` +
            `radial-gradient(ellipse at 80% 60%, rgba(139,92,246,0.15) 0%, transparent 60%)`,
        }}
      />

      {/* ═══ HEADER ═══ */}
      <div
        style={{
          position: "relative", zIndex: 2,
          padding: isMobile ? "14px" : "18px 26px",
          borderBottom: `1px solid ${S.border}`,
          display: "flex", alignItems: "center", gap: 16,
          background: "linear-gradient(180deg, rgba(0,0,0,0.5), rgba(0,0,0,0.2))",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
            <span
              style={{
                padding: "2px 8px",
                background: rarity.color,
                borderRadius: 3,
                fontFamily: S.orb, fontSize: 9, fontWeight: 800,
                color: "#000", letterSpacing: "1.5px",
              }}
            >
              {rarity.label}
            </span>
            <span
              style={{
                padding: "2px 8px",
                background: "rgba(139,92,246,0.2)",
                border: `1px solid ${S.border}`,
                borderRadius: 3,
                fontFamily: S.raj, fontSize: 9, fontWeight: 700,
                color: S.violetL, letterSpacing: "1px",
              }}
            >
              {CATEGORY_ICON[item.category]} {item.category?.replace("_", " ").toUpperCase()}
            </span>
            {isOwned && (
              <span
                style={{
                  padding: "2px 8px",
                  background: S.green,
                  borderRadius: 3,
                  fontFamily: S.orb, fontSize: 9, fontWeight: 800,
                  color: "#000", letterSpacing: "1.5px",
                  boxShadow: `0 0 12px ${S.green}`,
                }}
              >
                ✓ OWNED
              </span>
            )}
          </div>
          <div
            style={{
              fontFamily: S.orb, fontWeight: 800, fontSize: isMobile ? 18 : 24,
              color: "#fff", letterSpacing: "3px",
              textShadow: `0 0 12px ${rarity.glow}`,
              lineHeight: 1.1,
            }}
          >
            {item.name}
          </div>
        </div>

        <button
          onClick={onClose}
          aria-label="Close 3D preview"
          style={{
            width: 42, height: 42,
            background: "rgba(0,0,0,0.6)",
            border: `1px solid ${S.borderHot}`, borderRadius: 8,
            color: S.cyanL, fontSize: 18, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 0 15px rgba(0,229,255,0.3)`,
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* ═══ VIEWER AREA ═══ */}
      <div
        style={{
          position: "relative", zIndex: 2,
          flex: 1,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: isMobile ? 10 : 20,
          minHeight: 0,
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%", height: "100%",
            maxWidth: 900, maxHeight: "100%",
            background:
              `radial-gradient(circle at center, ${rarity.glow} 0%, transparent 70%),` +
              `linear-gradient(135deg, rgba(0,0,0,0.4), rgba(139,92,246,0.05))`,
            border: `2px solid ${rarity.color}`,
            borderRadius: 16,
            overflow: "hidden",
            boxShadow: `0 0 40px ${rarity.glow}, inset 0 0 60px rgba(0,0,0,0.5)`,
          }}
        >
          {/* Corner brackets — HUD style */}
          {["tl", "tr", "bl", "br"].map((corner) => (
            <svg
              key={corner}
              width="30" height="30"
              style={{
                position: "absolute",
                top:    corner.includes("t") ? 8  : "auto",
                bottom: corner.includes("b") ? 8  : "auto",
                left:   corner.includes("l") ? 8  : "auto",
                right:  corner.includes("r") ? 8  : "auto",
                transform: corner === "tr" ? "scaleX(-1)" :
                           corner === "bl" ? "scaleY(-1)" :
                           corner === "br" ? "scale(-1,-1)" : "none",
                pointerEvents: "none", zIndex: 3,
              }}
            >
              <path d="M2 15 L2 4 L15 4" stroke={rarity.color} strokeWidth="2" fill="none" opacity="0.8" />
            </svg>
          ))}

          {/* Loading / error / model */}
          {loadError ? (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 20 }}>
              <div style={{ fontSize: 50, filter: `drop-shadow(0 0 20px ${S.danger})` }}>⚠</div>
              <div style={{ fontFamily: S.orb, fontWeight: 700, fontSize: 13, color: S.danger, letterSpacing: "2px" }}>
                {loadError}
              </div>
              <div style={{ fontFamily: S.raj, fontSize: 12, color: S.dim, textAlign: "center", maxWidth: 300 }}>
                Make sure the model file is a valid .glb and publicly readable.
              </div>
            </div>
          ) : !item.modelUrl ? (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 20 }}>
              <div style={{ fontSize: 80, filter: `drop-shadow(0 0 20px ${rarity.glow})` }}>
                {CATEGORY_ICON[item.category] || "✨"}
              </div>
              <div style={{ fontFamily: S.orb, fontWeight: 700, fontSize: 13, color: S.violetL, letterSpacing: "2px", textAlign: "center" }}>
                No 3D model uploaded yet
              </div>
              <div style={{ fontFamily: S.raj, fontSize: 12, color: S.dim, textAlign: "center", maxWidth: 320 }}>
                Admin needs to upload a .glb model for this item.
              </div>
            </div>
          ) : !scriptReady ? (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
              <div
                style={{
                  width: 50, height: 50,
                  border: `4px solid ${rarity.color}22`,
                  borderTop: `4px solid ${rarity.color}`,
                  borderRadius: "50%",
                  animation: "spinnerRing 1s linear infinite",
                }}
              />
              <div style={{ fontFamily: S.orb, fontSize: 12, color: rarity.color, letterSpacing: "2px", textShadow: `0 0 8px ${rarity.glow}` }}>
                LOADING 3D ENGINE...
              </div>
            </div>
          ) : (
            <>
              {/* eslint-disable-next-line react/no-unknown-property */}
              <model-viewer
                ref={mvRef}
                src={item.modelUrl}
                poster={item.imageUrl || undefined}
                camera-controls=""
                {...(autoRotate ? { "auto-rotate": "", "auto-rotate-delay": "1500" } : {})}
                shadow-intensity="1"
                exposure="1"
                environment-image="neutral"
                touch-action="pan-y"
                interaction-prompt="none"
                style={{
                  width: "100%", height: "100%",
                  background: "transparent",
                  "--poster-color": "transparent",
                }}
              />
              {!modelLoaded && (
                <div
                  style={{
                    position: "absolute", inset: 0,
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    gap: 12, background: "rgba(0,0,0,0.5)",
                    pointerEvents: "none",
                  }}
                >
                  <div
                    style={{
                      width: 40, height: 40,
                      border: `3px solid ${rarity.color}22`,
                      borderTop: `3px solid ${rarity.color}`,
                      borderRadius: "50%",
                      animation: "spinnerRing 1s linear infinite",
                    }}
                  />
                  <div style={{ fontFamily: S.orb, fontSize: 11, color: rarity.color, letterSpacing: "2px", textShadow: `0 0 8px ${rarity.glow}` }}>
                    LOADING MODEL...
                  </div>
                </div>
              )}

              {/* Controls hint overlay (bottom-left) */}
              {modelLoaded && (
                <div
                  style={{
                    position: "absolute", bottom: 14, left: 14,
                    padding: "6px 12px",
                    background: "rgba(0,0,0,0.65)",
                    border: `1px solid ${S.border}`,
                    borderRadius: 6,
                    fontFamily: S.raj, fontSize: 10, fontWeight: 700,
                    color: S.violetL, letterSpacing: "1.5px",
                    textTransform: "uppercase",
                    backdropFilter: "blur(6px)",
                    display: "flex", gap: 12, alignItems: "center",
                    pointerEvents: "none",
                    animation: "hintFadeOut 5s ease forwards",
                  }}
                >
                  <span>🖱 {isMobile ? "Drag" : "Drag"} · Rotate</span>
                  <span style={{ color: S.dimMore }}>│</span>
                  <span>{isMobile ? "🤏 Pinch" : "⚙ Scroll"} · Zoom</span>
                </div>
              )}

              {/* Auto-rotate toggle (top-right) */}
              {modelLoaded && (
                <button
                  onClick={() => setAutoRotate((v) => !v)}
                  style={{
                    position: "absolute", top: 14, right: 14,
                    padding: "6px 12px",
                    background: autoRotate ? `${rarity.color}22` : "rgba(0,0,0,0.6)",
                    border: `1px solid ${autoRotate ? rarity.color : S.border}`,
                    borderRadius: 6,
                    color: autoRotate ? rarity.color : S.violetL,
                    fontFamily: S.raj, fontSize: 10, fontWeight: 700,
                    cursor: "pointer", letterSpacing: "1.5px",
                    textTransform: "uppercase",
                    backdropFilter: "blur(6px)",
                  }}
                >
                  {autoRotate ? "◉ Auto-rotate" : "○ Auto-rotate"}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ═══ FOOTER — description + buy ═══ */}
      <div
        style={{
          position: "relative", zIndex: 2,
          padding: isMobile ? "14px" : "16px 26px",
          borderTop: `1px solid ${S.border}`,
          background: "linear-gradient(0deg, rgba(0,0,0,0.7), rgba(0,0,0,0.3))",
          display: "flex", gap: 14, alignItems: "center",
          flexDirection: isMobile ? "column" : "row",
        }}
      >
        <div style={{ flex: 1, minWidth: 0, alignSelf: isMobile ? "stretch" : "auto" }}>
          {item.description ? (
            <div
              style={{
                fontFamily: S.raj, fontSize: 12, color: S.violetL,
                lineHeight: 1.4,
                display: "-webkit-box", WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical", overflow: "hidden",
              }}
            >
              {item.description}
            </div>
          ) : (
            <div style={{ fontFamily: S.raj, fontSize: 11, color: S.dim, fontStyle: "italic" }}>
              No description
            </div>
          )}
        </div>

        {/* Currency toggle (only if both prices set + not owned) */}
        {hasArcade && hasUsdc && !isOwned && (
          <div style={{ display: "flex", gap: 4 }}>
            {["ARCADE", "USDC"].map((c) => (
              <button
                key={c}
                onClick={() => setSelectedCurrency(c)}
                style={{
                  padding: "8px 12px",
                  background: selectedCurrency === c ? `${rarity.color}22` : "rgba(0,0,0,0.5)",
                  border: `1px solid ${selectedCurrency === c ? rarity.color : S.border}`,
                  borderRadius: 5,
                  color: selectedCurrency === c ? rarity.color : S.dim,
                  fontFamily: S.raj, fontSize: 11, fontWeight: 700,
                  cursor: "pointer", letterSpacing: "1.5px",
                }}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {/* Buy / Owned */}
        {isOwned ? (
          <div
            style={{
              padding: "12px 24px",
              background: "rgba(0,255,136,0.1)",
              border: `1px solid ${S.green}`,
              borderRadius: 8,
              fontFamily: S.orb, fontWeight: 800, fontSize: 12,
              color: S.green, letterSpacing: "2px",
              textShadow: `0 0 10px ${S.green}`,
              alignSelf: isMobile ? "stretch" : "auto",
              textAlign: "center",
            }}
          >
            ✓ UNLOCKED
          </div>
        ) : (
          <button
            onClick={handleBuyClick}
            disabled={!selectedCurrency || !currentPrice}
            style={{
              padding: "13px 26px",
              background: `linear-gradient(135deg, ${rarity.color}, ${S.violet})`,
              border: "none", borderRadius: 8,
              color: "#000",
              fontFamily: S.orb, fontWeight: 900, fontSize: 13,
              cursor: (!selectedCurrency || !currentPrice) ? "not-allowed" : "pointer",
              letterSpacing: "2px", textTransform: "uppercase",
              boxShadow: `0 0 24px ${rarity.glow}`,
              opacity: (!selectedCurrency || !currentPrice) ? 0.5 : 1,
              transition: "all 0.15s ease",
              alignSelf: isMobile ? "stretch" : "auto",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => { if (selectedCurrency && currentPrice) e.currentTarget.style.filter = "brightness(1.15)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = "brightness(1)"; }}
          >
            ⚡ BUY · {currentPrice} {selectedCurrency}
          </button>
        )}
      </div>

      <style>{`
        @keyframes viewer3DFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes spinnerRing { to { transform: rotate(360deg); } }
        @keyframes hintFadeOut {
          0%,60% { opacity: 1; }
          100%   { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
