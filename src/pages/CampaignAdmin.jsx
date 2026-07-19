// src/pages/CampaignAdmin.jsx
import { useEffect, useMemo, useState } from "react";
import { P, glassCard } from "../components/campaign/tokens";
import StatCard from "../components/campaign/StatCard";
import StatusBadge from "../components/campaign/StatusBadge";
import { getAdminData, approveParticipant, rejectParticipant } from "../lib/campaignService";

function exportToCSV(users) {
  const headers = ["Wallet", "Twitter", "Telegram", "Discord", "Game Played", "Transaction Hash", "Verification Status", "Reward Status"];
  const rows = users.map((u) => [u.wallet, u.twitter, u.telegram, u.discord, u.gamePlayed, u.txHash, u.verificationStatus, u.rewardStatus]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "campaign-participants.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function CampaignAdmin() {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewingUser, setViewingUser] = useState(null);
  const [actingWallet, setActingWallet] = useState(null);

  const load = () => getAdminData().then((d) => { setStats(d.stats); setUsers(d.users); });
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return users.filter((u) => {
      const matchesSearch = !search || u.wallet.toLowerCase().includes(search.toLowerCase()) || u.twitter?.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || u.verificationStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [users, search, statusFilter]);

  const handleApprove = async (wallet) => {
    setActingWallet(wallet);
    try {
      await approveParticipant(wallet);
      setUsers((prev) => prev.map((u) => (u.wallet === wallet ? { ...u, verificationStatus: "verified", rewardStatus: "eligible" } : u)));
    } finally { setActingWallet(null); }
  };

  const handleReject = async (wallet) => {
    setActingWallet(wallet);
    try {
      await rejectParticipant(wallet);
      setUsers((prev) => prev.map((u) => (u.wallet === wallet ? { ...u, verificationStatus: "rejected" } : u)));
    } finally { setActingWallet(null); }
  };

  const inputStyle = {
    padding: "9px 13px", borderRadius: 8, border: `1px solid ${P.border}`,
    background: "rgba(123,47,255,0.05)", color: "#e0d4ff", fontFamily: P.raj, fontSize: 12.5, outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", background: P.bg, padding: "60px 24px 100px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <h1 style={{ fontFamily: P.orb, fontSize: 24, color: "#fff", marginBottom: 28 }}>Admin Dashboard</h1>

        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 30 }}>
            <StatCard label="Total Users" value={stats.totalUsers.toLocaleString()} accent={P.purple} />
            <StatCard label="Completed" value={stats.completed.toLocaleString()} accent={P.green} />
            <StatCard label="Pending" value={stats.pending.toLocaleString()} accent={P.amber} />
            <StatCard label="Rejected" value={stats.rejected.toLocaleString()} accent={P.red} />
            <StatCard label="Rewards" value={`${stats.rewardsBOT.toLocaleString()} BOT`} accent={P.blue} />
          </div>
        )}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
          <input
            placeholder="Search wallet or Twitter..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, flex: 1, minWidth: 220 }}
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle}>
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
          </select>
          <button
            onClick={() => exportToCSV(filtered)}
            style={{
              padding: "9px 18px", borderRadius: 8, border: `1px solid ${P.border2}`,
              background: "transparent", color: P.textBright, fontFamily: P.raj, fontWeight: 700,
              fontSize: 12, letterSpacing: "0.5px", textTransform: "uppercase", cursor: "pointer",
            }}
          >
            ⬇ CSV Export
          </button>
        </div>

        <div style={{ ...glassCard, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${P.border2}` }}>
                {["Wallet", "Twitter", "Telegram", "Discord", "Game", "Tx Hash", "Verification", "Reward", "Actions"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "12px 16px", fontFamily: P.raj, fontSize: 10.5, color: P.textDim, textTransform: "uppercase", letterSpacing: "0.8px" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.wallet} style={{ borderBottom: `1px solid ${P.border}` }}>
                  <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 12, color: "#fff" }}>{u.wallet}</td>
                  <td style={{ padding: "12px 16px", fontFamily: P.raj, fontSize: 12, color: P.textDim }}>{u.twitter}</td>
                  <td style={{ padding: "12px 16px", fontFamily: P.raj, fontSize: 12, color: P.textDim }}>{u.telegram}</td>
                  <td style={{ padding: "12px 16px", fontFamily: P.raj, fontSize: 12, color: P.textDim }}>{u.discord}</td>
                  <td style={{ padding: "12px 16px", fontFamily: P.raj, fontSize: 12, color: P.textDim }}>{u.gamePlayed}</td>
                  <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 11, color: P.textDim }}>{u.txHash.slice(0, 10)}...</td>
                  <td style={{ padding: "12px 16px" }}><StatusBadge status={u.verificationStatus} size="sm" /></td>
                  <td style={{ padding: "12px 16px" }}><StatusBadge status={u.rewardStatus} size="sm" /></td>
                  <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>
                    <button onClick={() => handleApprove(u.wallet)} disabled={actingWallet === u.wallet}
                      style={{ marginRight: 6, padding: "5px 10px", borderRadius: 6, border: "none", background: "rgba(0,255,136,0.15)", color: P.green, fontFamily: P.raj, fontWeight: 700, fontSize: 10.5, cursor: "pointer" }}>
                      Approve
                    </button>
                    <button onClick={() => handleReject(u.wallet)} disabled={actingWallet === u.wallet}
                      style={{ marginRight: 6, padding: "5px 10px", borderRadius: 6, border: "none", background: "rgba(255,68,68,0.15)", color: P.red, fontFamily: P.raj, fontWeight: 700, fontSize: 10.5, cursor: "pointer" }}>
                      Reject
                    </button>
                    <button onClick={() => setViewingUser(u)}
                      style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${P.border2}`, background: "transparent", color: P.textBright, fontFamily: P.raj, fontWeight: 700, fontSize: 10.5, cursor: "pointer" }}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", fontFamily: P.raj, color: P.textDim, fontSize: 12.5 }}>No participants match this search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {viewingUser && (
        <div onClick={() => setViewingUser(null)} style={{ position: "fixed", inset: 0, background: "rgba(5,4,10,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...glassCard, padding: 26, maxWidth: 420, width: "90%" }}>
            <h3 style={{ fontFamily: P.orb, fontSize: 16, color: "#fff", marginBottom: 16 }}>{viewingUser.wallet}</h3>
            {Object.entries(viewingUser).filter(([k]) => k !== "wallet").map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${P.border}` }}>
                <span style={{ fontFamily: P.raj, fontSize: 11, color: P.textDim, textTransform: "uppercase" }}>{k}</span>
                <span style={{ fontFamily: P.raj, fontSize: 12, color: "#fff", textAlign: "right", wordBreak: "break-all", maxWidth: "60%" }}>{String(v)}</span>
              </div>
            ))}
            <button onClick={() => setViewingUser(null)} style={{ marginTop: 16, width: "100%", padding: 10, borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${P.purple}, #5a1fd4)`, color: "#fff", fontFamily: P.raj, fontWeight: 700, cursor: "pointer" }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
