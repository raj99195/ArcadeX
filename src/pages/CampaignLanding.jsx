// src/pages/CampaignLanding.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAccount } from "wagmi";
import { P } from "../components/campaign/tokens";
import StatCard from "../components/campaign/StatCard";
import { getCampaign } from "../lib/campaignService";

export default function CampaignLanding() {
  const navigate = useNavigate();
  const { isConnected } = useAccount();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    getCampaign().then(setStats);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: P.bg, position: "relative", overflow: "hidden" }}>
      {/* Ambient glow, kept subtle since the banner is the visual centerpiece now */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <motion.div
          animate={{ x: [0, 30, 0], y: [0, -20, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
          style={{ position: "absolute", top: "-15%", left: "-5%", width: 420, height: 420, borderRadius: "50%", background: `radial-gradient(circle, ${P.purple}22 0%, transparent 70%)`, filter: "blur(40px)" }}
        />
      </div>

      <div style={{ position: "relative", maxWidth: 1080, margin: "0 auto", padding: "28px 24px 32px", display: "flex", flexDirection: "column", minHeight: "100vh", justifyContent: "center" }}>
        {/* Banner does all the messaging — headline, tagline, steps, socials —
            so nothing is duplicated in text below it. */}
        <motion.div
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          {/* TODO: rename this if your file in public/ isn't exactly "campaign-banner.png" */}
          <img
            src="/campaign-banner.png"
            alt="ArcadeX × BOT Chain — Play. Complete. Earn. Join communities, play games, complete tasks, verify on-chain, earn rewards."
            style={{
              width: "100%", maxHeight: "50vh", objectFit: "contain", display: "block", margin: "0 auto",
              borderRadius: 18, border: `1px solid ${P.border2}`,
              boxShadow: `0 20px 60px ${P.purple}33, 0 0 0 1px rgba(0,212,255,0.08)`,
            }}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          style={{ textAlign: "center", marginTop: 22 }}
        >
          <button
            onClick={() => navigate("/campaign/portal")}
            style={{
              padding: "12px 28px", borderRadius: 10, border: "none",
              background: `linear-gradient(135deg, ${P.purple}, #5a1fd4)`, color: "#fff",
              fontFamily: P.raj, fontWeight: 700, fontSize: 13.5, letterSpacing: "0.8px",
              textTransform: "uppercase", cursor: "pointer",
              boxShadow: `0 8px 24px ${P.purple}44`,
            }}
          >
            {isConnected ? "Start Campaign" : "Connect Wallet"}
          </button>
        </motion.div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginTop: 26 }}>
          <StatCard label="Participants" value={stats?.participants?.toLocaleString() ?? "—"} accent={P.purple} delay={0.05} />
          <StatCard label="Games Played" value={stats?.gamesPlayed?.toLocaleString() ?? "—"} accent={P.blue} delay={0.1} />
          <StatCard label="Verified Users" value={stats?.verifiedUsers?.toLocaleString() ?? "—"} accent={P.green} delay={0.15} />
        </div>
      </div>
    </div>
  );
}