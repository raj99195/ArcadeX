// src/pages/Campaign.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount } from "wagmi";
import { motion, AnimatePresence } from "framer-motion";
import { P, glassCard } from "../components/campaign/tokens";
import TaskStep from "../components/campaign/TaskStep";
import StatusBadge from "../components/campaign/StatusBadge";
import { useChain } from "../context/ChainContext";
import { getTasks, verifySocialTask, submitTransaction, verifyTransaction } from "../lib/campaignService";

// ── Social task config ──────────────────────────────────────────
// TODO: replace these placeholder links with the real ArcadeX / BOT Chain
// handles once you have them from Brian Wong / the BOT Chain team.
const SOCIAL_TASKS = [
  { id: "follow_arcadex_x", index: 2, label: "Follow ArcadeX on X", link: "https://x.com/PlayArcadeX", placeholder: "Your X username (e.g. @yourhandle)", field: "twitter" },
  { id: "follow_botchain_x", index: 3, label: "Follow BOT Chain on X", link: "https://x.com/BOTChain_ai", placeholder: "Your X username (e.g. @yourhandle)", field: "twitter" },
  { id: "join_arcadex_tg", index: 4, label: "Join ArcadeX Telegram", link: "https://t.me/AracdeX", placeholder: "Your Telegram username", field: "telegram" },
  { id: "join_botchain_tg", index: 5, label: "Join BOT Chain Telegram", link: "https://t.me/BOTChainNetwork", placeholder: "Your Telegram username", field: "telegram" },
  { id: "join_discord", index: 6, label: "Join Discord", link: "https://discord.gg/836Mx9XjbB", placeholder: "Your Discord username", field: "discord" },
];

export default function Campaign() {
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const { chainKey, setChainKey } = useChain();
  const [tasks, setTasks] = useState([]);
  const [loadingTaskId, setLoadingTaskId] = useState(null);
  const [usernames, setUsernames] = useState({}); // { [taskId]: string }
  const [taskErrors, setTaskErrors] = useState({}); // { [taskId]: string }
  const [txHash, setTxHash] = useState("");
  const [txResult, setTxResult] = useState(null); // { verified, reason, checks }
  const [txLoading, setTxLoading] = useState(false);

  useEffect(() => {
    getTasks(address).then((d) => setTasks(d.tasks));
  }, [address]);

  const taskStatus = (id) => tasks.find((t) => t.id === id)?.status || "pending";

  // Records the username you entered against your wallet (twitter/telegram/discord
  // field, same ones the Admin dashboard table shows) so it can be checked by
  // hand later — there's no automated follow/join check here.
  const handleVerifySocial = async (task) => {
    const username = (usernames[task.id] || "").trim();
    if (!username) {
      setTaskErrors((prev) => ({ ...prev, [task.id]: "Enter your username first." }));
      return;
    }
    setTaskErrors((prev) => ({ ...prev, [task.id]: null }));
    setLoadingTaskId(task.id);
    try {
      await verifySocialTask(task.id, address, username, task.field);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: "completed" } : t)));
    } catch (err) {
      setTaskErrors((prev) => ({ ...prev, [task.id]: err.message }));
    } finally {
      setLoadingTaskId(null);
    }
  };

  const handleVerifyTx = async () => {
    setTxLoading(true);
    setTxResult(null);
    try {
      await submitTransaction(address, txHash);
      const result = await verifyTransaction(address, txHash);
      setTxResult(result);
      if (result.verified) {
        setTasks((prev) => prev.map((t) => (t.id === "submit_tx" || t.id === "play_games" ? { ...t, status: "completed" } : t)));
      }
    } finally {
      setTxLoading(false);
    }
  };

  const walletStatus = isConnected ? "completed" : "active";
  const gamesStatus = taskStatus("play_games");
  const txStatus = taskStatus("submit_tx");

  const inputStyle = {
    flex: 1, minWidth: 180, boxSizing: "border-box", padding: "9px 12px",
    background: "rgba(123,47,255,0.05)", border: `1px solid ${P.border}`, borderRadius: 8,
    color: "#e0d4ff", fontSize: 12.5, fontFamily: P.raj, outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", background: P.bg, padding: "60px 24px 100px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <h1 style={{ fontFamily: P.orb, fontSize: 26, color: "#fff", marginBottom: 6 }}>Campaign Progress</h1>
        <p style={{ fontFamily: P.raj, fontSize: 13.5, color: P.textDim, marginBottom: 24 }}>
          Complete every step below to become eligible for rewards.
        </p>

        {chainKey !== "botchain" && (
          <div style={{
            ...glassCard, padding: "14px 18px", marginBottom: 24,
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap",
            border: `1px solid rgba(255,170,0,0.35)`, background: "rgba(255,170,0,0.06)",
          }}>
            <div style={{ fontFamily: P.raj, fontSize: 12.5, color: P.amber, lineHeight: 1.5 }}>
              ⚠ This campaign only counts activity on <strong>BOTChain</strong>. Play your game and submit your
              score while connected to BOTChain — transactions on other chains won't verify.
            </div>
            <button
              onClick={() => setChainKey("botchain")}
              style={{
                padding: "8px 16px", borderRadius: 8, border: "none", whiteSpace: "nowrap",
                background: `linear-gradient(135deg, ${P.purple}, #5a1fd4)`, color: "#fff",
                fontFamily: P.raj, fontWeight: 700, fontSize: 11.5, letterSpacing: "0.5px",
                textTransform: "uppercase", cursor: "pointer",
              }}
            >
              Switch to BOTChain
            </button>
          </div>
        )}

        <div style={{ ...glassCard, padding: "28px 28px 4px" }}>
          {/* Step 1 */}
          <TaskStep index={1} total={8} label="Connect Wallet" status={walletStatus}>
            {!isConnected && (
              <span style={{ fontFamily: P.raj, fontSize: 12, color: P.textDim }}>
                Use the Connect Wallet button in the header to continue.
              </span>
            )}
          </TaskStep>

          {/* Steps 2–6: social tasks — real link to click + username to record */}
          {SOCIAL_TASKS.map((task) => {
            const status = taskStatus(task.id);
            return (
              <TaskStep
                key={task.id}
                index={task.index}
                total={8}
                label={task.label}
                status={status}
                onAction={() => handleVerifySocial(task)}
                actionLabel="Verify"
                loading={loadingTaskId === task.id}
              >
                {status !== "completed" && (
                  <div>
                    <a
                      href={task.link}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-block", marginBottom: 10, padding: "7px 14px", borderRadius: 7,
                        border: `1px solid ${P.border2}`, color: P.textBright, fontFamily: P.raj,
                        fontSize: 11.5, fontWeight: 700, textDecoration: "none", textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}
                    >
                      ↗ Open link
                    </a>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <input
                        value={usernames[task.id] || ""}
                        onChange={(e) => setUsernames((prev) => ({ ...prev, [task.id]: e.target.value }))}
                        placeholder={task.placeholder}
                        style={inputStyle}
                      />
                    </div>
                    {taskErrors[task.id] && (
                      <div style={{ marginTop: 8, fontFamily: P.raj, fontSize: 11.5, color: P.red }}>
                        {taskErrors[task.id]}
                      </div>
                    )}
                  </div>
                )}
              </TaskStep>
            );
          })}

          {/* Step 7: Play Games — links out to the real Games tab instead of a hardcoded list */}
          <TaskStep index={7} total={8} label="Play Games" status={gamesStatus}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <span style={{ fontFamily: P.raj, fontSize: 12.5, color: P.textDim }}>
                Play any game on the Games tab, finish a session, and submit your score's transaction hash below.
              </span>
              <button
                onClick={() => navigate("/games")}
                style={{
                  padding: "9px 20px", borderRadius: 8, border: "none",
                  background: `linear-gradient(135deg, ${P.purple}, #5a1fd4)`, color: "#fff",
                  fontFamily: P.raj, fontWeight: 700, fontSize: 12, letterSpacing: "0.5px",
                  textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                ▶ Go to Games
              </button>
            </div>
          </TaskStep>

          {/* Step 8: Submit tx hash */}
          <TaskStep index={8} total={8} label="Submit Transaction Hash" status={txStatus}>
            <textarea
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              placeholder="Paste tx hash"
              rows={2}
              style={{
                width: "100%", boxSizing: "border-box", padding: "11px 13px", resize: "vertical",
                background: "rgba(123,47,255,0.05)", border: `1px solid ${P.border}`, borderRadius: 8,
                color: "#e0d4ff", fontSize: 13, fontFamily: "monospace", outline: "none", marginBottom: 12,
              }}
            />
            <button
              onClick={handleVerifyTx}
              disabled={txLoading || !txHash}
              style={{
                padding: "10px 22px", borderRadius: 8, border: "none",
                background: (txLoading || !txHash) ? "rgba(123,47,255,0.2)" : `linear-gradient(135deg, ${P.purple}, #5a1fd4)`,
                color: (txLoading || !txHash) ? "#5533aa" : "#fff",
                fontFamily: P.raj, fontWeight: 700, fontSize: 12.5, letterSpacing: "0.5px",
                textTransform: "uppercase", cursor: (txLoading || !txHash) ? "not-allowed" : "pointer",
                position: "relative", overflow: "hidden",
              }}
            >
              {txLoading && (
                <motion.span
                  initial={{ x: "-100%" }}
                  animate={{ x: "100%" }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
                  style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)" }}
                />
              )}
              {txLoading ? "Scanning chain..." : "Verify"}
            </button>

            <AnimatePresence>
              {txResult && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  style={{
                    marginTop: 14, padding: "12px 14px", borderRadius: 8,
                    background: txResult.verified ? "rgba(0,255,136,0.07)" : "rgba(255,68,68,0.07)",
                    border: `1px solid ${txResult.verified ? "rgba(0,255,136,0.3)" : "rgba(255,68,68,0.3)"}`,
                    color: txResult.verified ? P.green : P.red,
                    fontFamily: P.raj, fontSize: 12.5,
                  }}
                >
                  {txResult.verified ? "✓ Transaction verified — task complete." : `✕ ${txResult.reason}`}
                </motion.div>
              )}
            </AnimatePresence>
          </TaskStep>
        </div>

        {/* Rewards section */}
        <div style={{ ...glassCard, padding: 24, marginTop: 32 }}>
          <h2 style={{ fontFamily: P.orb, fontSize: 16, color: "#fff", marginBottom: 18 }}>Rewards</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
            <div>
              <div style={{ fontFamily: P.raj, fontSize: 11, color: P.textDim, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 6 }}>Campaign Reward</div>
              <div style={{ fontFamily: P.orb, fontSize: 18, color: P.textBright }}>20 BOT</div>
            </div>
         
            <div>
              <div style={{ fontFamily: P.raj, fontSize: 11, color: P.textDim, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 6 }}>Reward Status</div>
              <StatusBadge status={txResult?.verified ? "eligible" : "pending"} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}