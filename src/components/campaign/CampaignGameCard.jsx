// src/components/campaign/CampaignGameCard.jsx
import { motion } from "framer-motion";
import { P, glassCard } from "./tokens";

export default function CampaignGameCard({ game, onPlay }) {
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      style={{ ...glassCard, overflow: "hidden", cursor: "pointer" }}
      onClick={() => onPlay?.(game)}
    >
      <div style={{ height: 140, position: "relative", overflow: "hidden" }}>
        {game.banner ? (
          <img src={game.banner} alt={game.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", background: `linear-gradient(135deg, ${P.purple}33, ${P.blue}22)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>
            🎮
          </div>
        )}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 50%, rgba(8,7,15,0.9) 100%)" }} />
        <div style={{ position: "absolute", bottom: 10, left: 14, fontFamily: P.orb, fontSize: 15, fontWeight: 700, color: "#fff" }}>
          {game.name}
        </div>
      </div>
      <div style={{ padding: "14px 16px 18px" }}>
        <div style={{ fontFamily: P.raj, fontSize: 12, color: P.textDim, lineHeight: 1.5, minHeight: 34, marginBottom: 14 }}>
          {game.description}
        </div>
        <button
          style={{
            width: "100%", padding: "10px", borderRadius: 8, border: "none",
            background: `linear-gradient(135deg, ${P.purple}, #5a1fd4)`, color: "#fff",
            fontFamily: P.raj, fontWeight: 700, fontSize: 12.5, letterSpacing: "0.8px",
            textTransform: "uppercase", cursor: "pointer",
          }}
        >
          ▶ Play Now
        </button>
      </div>
    </motion.div>
  );
}
