// src/components/campaign/StatCard.jsx
import { motion } from "framer-motion";
import { P, glassCard } from "./tokens";

export default function StatCard({ label, value, accent = P.purple, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      style={{
        ...glassCard,
        padding: "20px 22px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
      <div style={{ fontFamily: P.orb, fontSize: 30, fontWeight: 700, color: "#fff", letterSpacing: "0.5px", lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontFamily: P.raj, fontSize: 11.5, color: P.textDim, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", marginTop: 6 }}>
        {label}
      </div>
    </motion.div>
  );
}
