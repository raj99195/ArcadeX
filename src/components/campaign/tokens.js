// src/components/campaign/tokens.js
//
// Shared design tokens for the campaign portal pages. Matches the P{}
// convention already used across Creator.jsx / Marketplace.jsx so the
// campaign portal feels native to ArcadeX, not bolted on.

export const P = {
  bg: "#08070f",
  surface: "#0e0c1a",
  surface2: "#12101f",
  border: "rgba(123,47,255,0.14)",
  border2: "rgba(123,47,255,0.28)",
  purple: "#7B2FFF",
  blue: "#00d4ff",
  green: "#00FF88",
  red: "#ff4444",
  amber: "#ffaa00",
  textDim: "#7755aa",
  textMid: "#9977cc",
  textBright: "#c4a0ff",
  raj: "'Rajdhani', sans-serif",
  orb: "'Orbitron', sans-serif",
};

export const gradientText = {
  background: `linear-gradient(90deg, ${P.purple}, ${P.blue})`,
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
};

export const glassCard = {
  background: `linear-gradient(160deg, rgba(123,47,255,0.05) 0%, rgba(10,8,20,0.9) 65%)`,
  border: `1px solid ${P.border}`,
  borderRadius: 16,
  backdropFilter: "blur(12px)",
};

export const STATUS_COLORS = {
  pending: P.amber,
  eligible: P.blue,
  verified: P.green,
  completed: P.green,
  claimed: P.green,
  rejected: P.red,
};
