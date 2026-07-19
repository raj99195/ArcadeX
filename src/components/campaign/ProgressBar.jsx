// src/components/campaign/ProgressBar.jsx
import { motion } from "framer-motion";
import { P } from "./tokens";

export default function ProgressBar({ pct = 0, label }) {
  return (
    <div>
      {label && (
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
          <span style={{ fontFamily: P.raj, fontSize: 11, color: P.textDim, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px" }}>{label}</span>
          <span style={{ fontFamily: P.orb, fontSize: 11, color: P.textBright, fontWeight: 700 }}>{pct}%</span>
        </div>
      )}
      <div style={{ height: 8, background: "rgba(123,47,255,0.08)", borderRadius: 5, overflow: "hidden" }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.9, ease: "easeOut" }}
          style={{
            height: "100%",
            background: `linear-gradient(90deg, ${P.purple}, ${P.blue})`,
            borderRadius: 5,
            boxShadow: `0 0 12px ${P.purple}77`,
          }}
        />
      </div>
    </div>
  );
}
