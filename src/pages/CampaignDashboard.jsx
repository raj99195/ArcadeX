// src/pages/CampaignDashboard.jsx
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { P, glassCard } from "../components/campaign/tokens";
import StatusBadge from "../components/campaign/StatusBadge";
import ProgressBar from "../components/campaign/ProgressBar";
import { getDashboard } from "../lib/campaignService";

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: `1px solid ${P.border}` }}>
      <span style={{ fontFamily: P.raj, fontSize: 12.5, color: P.textDim, textTransform: "uppercase", letterSpacing: "0.8px" }}>{label}</span>
      <span style={{ fontFamily: P.raj, fontSize: 13.5, color: "#fff", fontWeight: 600, textAlign: "right", wordBreak: "break-all", maxWidth: "60%" }}>{value}</span>
    </div>
  );
}

export default function CampaignDashboard() {
  const { address } = useAccount();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (address) getDashboard(address).then(setData);
  }, [address]);

  if (!address) {
    return (
      <div style={{ minHeight: "100vh", background: P.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontFamily: P.raj, color: P.textDim }}>Connect your wallet to view your dashboard.</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: P.bg, padding: "60px 24px 100px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h1 style={{ fontFamily: P.orb, fontSize: 24, color: "#fff", marginBottom: 28 }}>Your Dashboard</h1>

        {!data ? (
          <p style={{ fontFamily: P.raj, color: P.textDim }}>Loading...</p>
        ) : (
          <>
            <div style={{ ...glassCard, padding: "24px 26px", marginBottom: 20 }}>
              <ProgressBar pct={data.progressPct} label="Campaign progress" />
            </div>

            <div style={{ ...glassCard, padding: "10px 26px" }}>
              <Row label="Wallet Address" value={address} />
              <Row label="Completed Tasks" value={`${data.completedTasks} / ${data.totalTasks}`} />
              <Row label="Games Played" value={data.gamesPlayed} />
              <Row label="Transaction Hash" value={data.txHash} />
              <Row label="Verification Status" value={<StatusBadge status={data.verificationStatus} size="sm" />} />
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0" }}>
                <span style={{ fontFamily: P.raj, fontSize: 12.5, color: P.textDim, textTransform: "uppercase", letterSpacing: "0.8px" }}>Reward Status</span>
                <StatusBadge status={data.rewardStatus} size="sm" />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
