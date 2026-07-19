// src/components/campaign/StatusBadge.jsx
import { P, STATUS_COLORS } from "./tokens";

export default function StatusBadge({ status, size = "md" }) {
  const color = STATUS_COLORS[status] || P.textDim;
  const pad = size === "sm" ? "3px 9px" : "5px 13px";
  const font = size === "sm" ? 9 : 10.5;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: pad,
        borderRadius: 20,
        background: `${color}1a`,
        border: `1px solid ${color}55`,
        color,
        fontFamily: P.raj,
        fontWeight: 700,
        fontSize: font,
        letterSpacing: "0.8px",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />
      {status}
    </span>
  );
}
