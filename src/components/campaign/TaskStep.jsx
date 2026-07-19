// src/components/campaign/TaskStep.jsx
import { motion } from "framer-motion";
import { P, STATUS_COLORS } from "./tokens";

/**
 * A single step in the campaign tracker.
 * status: "completed" | "pending" | "active"
 */
export default function TaskStep({ index, total, label, status, onAction, actionLabel = "Verify", loading, children }) {
  const isCompleted = status === "completed";
  const color = isCompleted ? P.green : status === "active" ? P.blue : "rgba(123,47,255,0.3)";

  return (
    <div style={{ display: "flex", gap: 18 }}>
      {/* Rail: number + connecting line */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
        <div
          style={{
            width: 34, height: 34, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: isCompleted ? `${P.green}20` : "rgba(123,47,255,0.06)",
            border: `2px solid ${color}`,
            color, fontFamily: P.orb, fontWeight: 700, fontSize: 13,
            boxShadow: status === "active" ? `0 0 16px ${P.blue}55` : "none",
            transition: "all 0.3s ease",
          }}
        >
          {isCompleted ? "✓" : index}
        </div>
        {index < total && (
          <div style={{ width: 2, flex: 1, minHeight: 28, background: isCompleted ? P.green : "rgba(123,47,255,0.15)", marginTop: 4 }} />
        )}
      </div>

      {/* Content */}
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35 }}
        style={{ flex: 1, paddingBottom: 26 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontFamily: P.raj, fontSize: 15.5, fontWeight: 700, color: isCompleted ? "#fff" : P.textBright }}>
            {label}
          </div>
          {!isCompleted && onAction && (
            <button
              onClick={onAction}
              disabled={loading}
              style={{
                padding: "8px 18px", borderRadius: 8, border: "none",
                background: loading ? "rgba(123,47,255,0.2)" : `linear-gradient(135deg, ${P.purple}, #5a1fd4)`,
                color: loading ? "#5533aa" : "#fff",
                fontFamily: P.raj, fontWeight: 700, fontSize: 12.5, letterSpacing: "0.5px",
                cursor: loading ? "not-allowed" : "pointer", textTransform: "uppercase",
                transition: "all 0.2s ease",
              }}
            >
              {loading ? "Verifying..." : actionLabel}
            </button>
          )}
          {isCompleted && (
            <span style={{ fontFamily: P.raj, fontSize: 11, fontWeight: 700, color: P.green, textTransform: "uppercase", letterSpacing: "1px" }}>
              Completed
            </span>
          )}
        </div>
        {children && <div style={{ marginTop: 14 }}>{children}</div>}
      </motion.div>
    </div>
  );
}
