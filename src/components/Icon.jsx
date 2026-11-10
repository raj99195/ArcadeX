// src/components/Icon.jsx
//
// Single source of truth for every UI icon in the app. All icons are inline
// SVGs on a 24×24 viewbox using `currentColor` + `stroke` only (so they
// inherit the surrounding text color and animate smoothly). Replaces the
// emoji glyphs that render inconsistently across OS/font fallbacks.
//
// Usage:   <Icon name="coin" size={16} />   <Icon name="trophy" />
//          <Icon name="check" color="#00FF88" size={14} />
//
// Add a new icon: drop a <path> under its key. Keep stroke 1.8, round caps.

import { memo } from "react";

const SW = 1.8;

const PATHS = {
  // ── Currency / rewards ────────────────────────────────────────
  coin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="6" />
      <path d="M12 8v8M9.5 10.5c0-.8.7-1.5 2.5-1.5s2.5.7 2.5 1.5-.7 1.4-2.5 1.5c-1.8.1-2.5.7-2.5 1.5s.7 1.5 2.5 1.5 2.5-.7 2.5-1.5" />
    </>
  ),

  trophy: (
    <>
      <path d="M6 4h12v4a6 6 0 0 1-12 0V4z" />
      <path d="M6 6H3v2a3 3 0 0 0 3 3M18 6h3v2a3 3 0 0 1-3 3" />
      <path d="M10 14h4l-.5 4h-3L10 14z" />
      <path d="M8 20h8" />
    </>
  ),

  // ── Game / play ───────────────────────────────────────────────
  controller: (
    <>
      <path d="M4 11a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v3a4 4 0 0 1-7 2.6l-.6-.6a2 2 0 0 0-2.8 0l-.6.6A4 4 0 0 1 4 14v-3z" />
      <path d="M8 11v3M6.5 12.5h3M15 11h.01M17 13h.01" strokeLinecap="round" />
    </>
  ),

  play: (
    <path d="M7 5l12 7-12 7V5z" strokeLinejoin="round" />
  ),

  // ── Status / state ────────────────────────────────────────────
  check: (
    <path d="M4 12l5 5L20 6" strokeLinecap="round" strokeLinejoin="round" />
  ),

  x: (
    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
  ),

  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" />
    </>
  ),

  warning: (
    <>
      <path d="M12 3L2 20h20L12 3z" strokeLinejoin="round" />
      <path d="M12 10v4M12 17h.01" strokeLinecap="round" />
    </>
  ),

  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7h.01" strokeLinecap="round" />
    </>
  ),

  bolt: (
    <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" strokeLinejoin="round" />
  ),

  // ── People / users ────────────────────────────────────────────
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a7 7 0 0 1 14 0v1" />
    </>
  ),

  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2 20v-1a6 6 0 0 1 12 0v1" />
      <circle cx="17" cy="9" r="3" />
      <path d="M14 15.5a5 5 0 0 1 8 4V20" />
    </>
  ),

  // ── Admin / moderation ────────────────────────────────────────
  shield: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  ban: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </>
  ),

  // ── Data / stats ──────────────────────────────────────────────
  chart: (
    <>
      <path d="M4 20V8M10 20V4M16 20v-8M22 20H2" strokeLinecap="round" />
    </>
  ),

  trend: (
    <>
      <path d="M3 17l6-6 4 4 8-9" strokeLinejoin="round" />
      <path d="M14 6h7v7" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  // ── Nav / actions ─────────────────────────────────────────────
  plus: (
    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
  ),

  minus: (
    <path d="M5 12h14" strokeLinecap="round" />
  ),

  external: (
    <>
      <path d="M14 4h6v6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 4L10 14" strokeLinecap="round" />
      <path d="M20 14v6H4V4h6" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  refresh: (
    <>
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 3v4h-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 12a9 9 0 0 1-15.5 6.3L3 17" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 21v-4h4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  exchange: (
    <>
      <path d="M4 7h16l-3-3M20 17H4l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  arrow: (
    <path d="M4 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
  ),

  arrowLeft: (
    <path d="M20 12H6M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
  ),

  // ── Content ───────────────────────────────────────────────────
  box: (
    <>
      <path d="M3 7l9-4 9 4-9 4-9-4z" strokeLinejoin="round" />
      <path d="M3 7v10l9 4 9-4V7" strokeLinejoin="round" />
      <path d="M12 11v10" />
    </>
  ),

  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),

  // ── Social (brand-colored, not currentColor; still 24×24) ─────
  google: null,  // handled inline where it appears (brand colors)
  twitterX: null,

  // ── Decorative/avatar fallback ────────────────────────────────
  bot: (
    <>
      <rect x="5" y="7" width="14" height="12" rx="3" />
      <path d="M12 3v4M9 12h.01M15 12h.01" strokeLinecap="round" />
      <path d="M9 16c1 1 2 1 3 1s2 0 3-1" strokeLinecap="round" />
    </>
  ),

  // ── Rank medals (variants with filled wreath for podium feel) ─
  medal: (
    <>
      <path d="M8 2l2 5-2 5-2-5 2-5zM16 2l2 5-2 5-2-5 2-5z" strokeLinejoin="round" />
      <circle cx="12" cy="16" r="6" />
      <path d="M12 13v6M9 16h6" strokeLinecap="round" />
    </>
  ),

  // ── Signal / badge ────────────────────────────────────────────
  live: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="11" opacity="0.4" />
    </>
  ),

  flame: (
    <path d="M12 3c0 4-5 5-5 10a5 5 0 0 0 10 0c0-2-1-3-2-4 0 2-1 3-2 3 0-3 1-5-1-9z" strokeLinejoin="round" />
  ),

  heart: (
    <path d="M12 20s-8-5-8-11a5 5 0 0 1 8-4 5 5 0 0 1 8 4c0 6-8 11-8 11z" strokeLinejoin="round" />
  ),

  // ── UI utility ────────────────────────────────────────────────
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" strokeLinecap="round" />
    </>
  ),

  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.65 1.65 0 0 0-1.8-.3 1.65 1.65 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.65 1.65 0 0 0-1-1.5 1.65 1.65 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.65 1.65 0 0 0 .3-1.8 1.65 1.65 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.65 1.65 0 0 0 1.5-1 1.65 1.65 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.65 1.65 0 0 0 1.8.3h.1a1.65 1.65 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.65 1.65 0 0 0 1 1.5h.1a1.65 1.65 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.65 1.65 0 0 0-.3 1.8v.1a1.65 1.65 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.65 1.65 0 0 0-1.5 1z" />
    </>
  ),

  // ── Pointer / expand ──────────────────────────────────────────
  chevronDown: (
    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  ),
  chevronRight: (
    <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
  ),
};

/**
 * <Icon name="…" size={16} color="#fff" />
 *
 * `color` sets stroke via currentColor. `fill` is "none" by default — pass
 * a specific fill when an icon needs it (e.g. a filled trophy).
 */
export const Icon = memo(function Icon({
  name,
  size = 16,
  color,
  fill = "none",
  strokeWidth = SW,
  style,
  className,
  title,
  ...rest
}) {
  const content = PATHS[name];
  if (!content) {
    if (typeof window !== "undefined" && !PATHS[`__warned_${name}`]) {
      console.warn(`[Icon] Unknown icon "${name}"`);
      PATHS[`__warned_${name}`] = true;
    }
    return null;
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={fill}
      stroke={color || "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle", ...style }}
      aria-label={title}
      role={title ? "img" : "presentation"}
      {...rest}
    >
      {title && <title>{title}</title>}
      {content}
    </svg>
  );
});

/**
 * Convenience ribbon for medal places with filled gradient fill — used by
 * leaderboard podiums where plain stroke icons feel too flat.
 */
export const MedalBadge = memo(function MedalBadge({ rank = 1, size = 20 }) {
  const palette = {
    1: { stop1: "#FFE68A", stop2: "#FF8A1A", stroke: "#FFB700" },
    2: { stop1: "#E6E6E6", stop2: "#8B8B8B", stroke: "#C0C0C0" },
    3: { stop1: "#EFB37A", stop2: "#7A4A1F", stroke: "#CD7F32" },
  };
  const p = palette[rank] || palette[1];
  const id = `m-${rank}`;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.stop1} />
          <stop offset="1" stopColor={p.stop2} />
        </linearGradient>
      </defs>
      <path d="M7 2l2 5h6l2-5" fill="none" stroke={p.stroke} strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="15" r="7" fill={`url(#${id})`} stroke={p.stroke} strokeWidth="1.5" />
      <text x="12" y="18" textAnchor="middle" fontSize="8" fontWeight="800" fill="#1a0f00" fontFamily="'Rajdhani', sans-serif">
        {rank}
      </text>
    </svg>
  );
});

export default Icon;
