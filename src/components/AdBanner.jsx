// src/components/AdBanner.jsx
//
// Reusable Google AdSense banner for Web2 mode only.
//
// Setup (free):
//   1. Sign up at https://www.google.com/adsense/ with rajagrahari9919@gmail.com
//   2. Add your site playarcadex.in → wait for approval (1–14 days)
//   3. Replace ADSENSE_CLIENT_ID below with your "ca-pub-XXXXXXXXXXXXXXXX"
//   4. Create ad units in AdSense dashboard, grab the slot IDs, pass as `slot` prop
//
// Until a real client ID is set, the component shows a themed placeholder so
// the layout is already reserved and nothing visually breaks.

import { useEffect, useRef } from "react";
import { useMode } from "../hooks/useMode";

// ⚠️ REPLACE this with your real AdSense publisher ID after signup.
// Format: "ca-pub-" followed by 16 digits.
export const ADSENSE_CLIENT_ID = "ca-pub-XXXXXXXXXXXXXXXX";

const isConfigured = () =>
  typeof ADSENSE_CLIENT_ID === "string" &&
  ADSENSE_CLIENT_ID.startsWith("ca-pub-") &&
  !ADSENSE_CLIENT_ID.includes("XXXX");

let scriptInjected = false;
function ensureAdSenseScript() {
  if (scriptInjected || !isConfigured() || typeof document === "undefined") return;
  const existing = document.querySelector('script[data-arcadex-adsense="1"]');
  if (existing) { scriptInjected = true; return; }
  const s = document.createElement("script");
  s.async = true;
  s.setAttribute("data-arcadex-adsense", "1");
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}`;
  s.crossOrigin = "anonymous";
  document.head.appendChild(s);
  scriptInjected = true;
}

const SIZES = {
  horizontal: { minHeight: 90,  maxWidth: 970 },
  leaderboard:{ minHeight: 90,  maxWidth: 728 },
  square:     { minHeight: 250, maxWidth: 300 },
  mobile:     { minHeight: 100, maxWidth: 320 },
};

export default function AdBanner({
  slot = "",
  layout = "horizontal",
  format = "auto",
  responsive = true,
  showLabel = true,
  style = {},
  className = "",
}) {
  const { mode } = useMode();
  const insRef = useRef(null);
  const pushedRef = useRef(false);

  useEffect(() => {
    if (mode !== "web2" || !isConfigured() || !slot) return;
    ensureAdSenseScript();
    if (pushedRef.current) return;
    // Give the script a tick to attach adsbygoogle before pushing.
    const t = setTimeout(() => {
      try {
        if (!insRef.current) return;
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        pushedRef.current = true;
      } catch (e) {
        // AdSense throws if the slot is pushed twice or script not ready — harmless.
        if (typeof console !== "undefined") console.warn("[AdBanner] push skipped:", e?.message);
      }
    }, 60);
    return () => clearTimeout(t);
  }, [mode, slot]);

  // Hide completely in Web3 mode — ads are a Web2-only monetisation layer.
  if (mode !== "web2") return null;

  const dims = SIZES[layout] || SIZES.horizontal;
  const configured = isConfigured() && !!slot;

  return (
    <div
      className={`ax-fade-up ${className}`}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        margin: "16px auto", width: "100%", ...style,
      }}
    >
      {showLabel && (
        <div style={{
          fontSize: 9, color: "#4a7a9a", letterSpacing: "2px",
          fontFamily: "'Rajdhani',sans-serif", fontWeight: 700,
          textTransform: "uppercase", marginBottom: 6, opacity: 0.75,
          animation: "axFlicker 3s ease-in-out infinite",
        }}>Advertisement</div>
      )}
      <div
        className="ax-lift"
        style={{
          width: "100%",
          maxWidth: dims.maxWidth,
          minHeight: dims.minHeight,
          background: "linear-gradient(135deg, rgba(0,212,255,0.04), rgba(0,212,255,0.01))",
          border: "1px dashed rgba(0,212,255,0.18)",
          borderRadius: 10, overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
          position: "relative",
      }}>
        {/* Subtle sheen sweep behind the ad */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "linear-gradient(90deg, transparent, rgba(0,212,255,0.06), transparent)",
          backgroundSize: "250% 100%",
          animation: "axSheenMove 5s linear infinite",
        }} />
        {configured ? (
          <ins
            ref={insRef}
            className="adsbygoogle"
            style={{ display: "block", width: "100%", minHeight: dims.minHeight }}
            data-ad-client={ADSENSE_CLIENT_ID}
            data-ad-slot={slot}
            data-ad-format={format}
            data-full-width-responsive={responsive ? "true" : "false"}
          />
        ) : (
          <div style={{
            padding: "20px 16px", textAlign: "center",
            fontFamily: "'Rajdhani',sans-serif", position: "relative", zIndex: 1,
          }}>
            <div
              className="ax-breathe"
              style={{
                fontSize: 11, color: "#6fb8d4", letterSpacing: "1.5px",
                textTransform: "uppercase", fontWeight: 700,
              }}>Ad space</div>
            <div style={{
              fontSize: 10, color: "#3a5a7a", marginTop: 4, letterSpacing: "0.5px",
              animation: "axFadeIn 1.5s ease 0.4s both",
            }}>
              AdSense pending — ads will appear once approved
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
