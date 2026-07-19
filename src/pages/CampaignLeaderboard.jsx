// src/pages/CampaignLeaderboard.jsx
import { useEffect, useState } from "react";
import { P, glassCard } from "../components/campaign/tokens";
import StatusBadge from "../components/campaign/StatusBadge";
import { getLeaderboard } from "../lib/campaignService";

const RANK_COLOR = { 1: "#FFD700", 2: "#C0C0C0", 3: "#CD7F32" };

export default function CampaignLeaderboard() {
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    getLeaderboard().then((d) => setEntries(d.entries));
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: P.bg, padding: "60px 24px 100px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <h1 style={{ fontFamily: P.orb, fontSize: 24, color: "#fff", marginBottom: 28 }}>Leaderboard</h1>

        <div style={{ ...glassCard, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "50px 1fr 100px 110px 100px", padding: "12px 20px", borderBottom: `1px solid ${P.border2}` }}>
            {["#", "Wallet", "Points", "Games", "Status"].map((h) => (
              <span key={h} style={{ fontFamily: P.raj, fontSize: 10.5, color: P.textDim, textTransform: "uppercase", letterSpacing: "1px", fontWeight: 700 }}>{h}</span>
            ))}
          </div>
          {entries.map((e) => (
            <div key={e.rank} style={{ display: "grid", gridTemplateColumns: "50px 1fr 100px 110px 100px", padding: "14px 20px", borderBottom: `1px solid ${P.border}`, alignItems: "center" }}>
              <span style={{ fontFamily: P.orb, fontSize: 13, color: RANK_COLOR[e.rank] || P.textDim, fontWeight: 700 }}>{e.rank}</span>
              <span style={{ fontFamily: "monospace", fontSize: 12.5, color: "#fff" }}>{e.wallet}</span>
              <span style={{ fontFamily: P.orb, fontSize: 12.5, color: P.textBright }}>{e.points.toLocaleString()}</span>
              <span style={{ fontFamily: P.raj, fontSize: 12.5, color: P.textDim }}>{e.gamesPlayed}</span>
              <StatusBadge status={e.status} size="sm" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
