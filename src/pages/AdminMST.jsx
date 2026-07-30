// src/pages/AdminMST.jsx
//
// A dedicated admin panel for MST Blockchain — separate from the main
// Admin.jsx dashboard because access here is gated by an ON-CHAIN role
// (ADMIN_ROLE on MST's Platform + Tournament contracts), not by a
// hardcoded platform-owner wallet check. Whoever the MST team grants
// ADMIN_ROLE to can use this page with their own wallet — no shared admin
// key, no backend auth changes needed.
//
// NOTE: Score-signer and withdraw controls are intentionally NOT here —
// those live in a separate, more restricted admin surface (Raj-only).
// This panel only exposes settings the MST team should be tuning
// day-to-day: reward split, caps, throttle, min score, tournaments.

import { useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { writeContract, waitForTransactionReceipt, readContract } from "@wagmi/core";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { wagmiAdapter } from "../Providers";
import { useChain } from "../context/ChainContext";

const P = {
  bg: "#08070f", card: "#0d0b1a",
  border: "rgba(123,47,255,0.14)", border2: "rgba(123,47,255,0.28)",
  purple: "#7B2FFF", purpleL: "#a67fff", cyan: "#00d4ff",
  green: "#00FF88", red: "#ff4444", amber: "#ffaa00",
  dim: "#9977cc", dimMore: "#6a5a8a",
  raj: "'Rajdhani',sans-serif", orb: "'Orbitron',sans-serif",
};

// MST's RPC doesn't reliably auto-estimate gas for wallet popups — without
// an explicit gas limit, writeContract() can hang indefinitely waiting on
// a MetaMask popup that never appears. Creator.jsx already solved this
// with getGasWithBuffer(); same fix applied here for every write call.
async function getGasWithBuffer(publicClient, { address, abi, functionName, args, account, bufferPct = 30 }) {
  console.log(`[gas] Estimating for ${functionName}...`, { address, args, account });
  try {
    const estimated = await publicClient.estimateContractGas({ address, abi, functionName, args, account });
    const withBuffer = (estimated * BigInt(100 + bufferPct)) / 100n;
    console.log(`[gas] ${functionName} estimated=${estimated} withBuffer=${withBuffer}`);
    return withBuffer;
  } catch (err) {
    console.warn(`[gas] Estimation FAILED for ${functionName}, using fallback 500000:`, err.shortMessage || err.message, err);
    return BigInt(500000);
  }
}

async function writeWithGas(publicClient, { address, abi, functionName, args, chainId, account }) {
  console.log("[writeWithGas] STEP 1 - called:", functionName);
  console.log("[writeWithGas] STEP 1 - params:", { address, chainId, account, argsLen: args?.length });

  let gas;
  try {
    gas = await getGasWithBuffer(publicClient, { address, abi, functionName, args, account });
    console.log("[writeWithGas] STEP 2 - gas ready:", gas?.toString());
  } catch (gasErr) {
    console.error("[writeWithGas] STEP 2 FAILED:", gasErr);
    throw gasErr;
  }

  console.log("[writeWithGas] STEP 3 - calling writeContract, wagmiConfig ok?", !!wagmiAdapter?.wagmiConfig);
  console.log("[writeWithGas] STEP 3 - args:", { address, functionName, gas: gas?.toString(), chainId, account });

  let hash;
  try {
    // chainId deliberately omitted — passing it causes wagmi to attempt a chain-switch on MST which hangs indefinitely
    hash = await writeContract(wagmiAdapter.wagmiConfig, { address, abi, functionName, args, gas, account });
    console.log("[writeWithGas] STEP 4 - hash:", hash);
  } catch (writeErr) {
    console.error("[writeWithGas] STEP 4 FAILED:", writeErr?.message, writeErr);
    throw writeErr;
  }

  return hash;
}
const PLATFORM_ABI = [
  { name: "hasRole", type: "function", stateMutability: "view", inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { name: "ADMIN_ROLE", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bytes32" }] },
  { name: "playerSharePercent", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "creatorSharePercent", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "playerDailyCap", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "chainDailyCap", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "capResetPeriod", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "paused", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { name: "getTotalGames", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "getGame", type: "function", stateMutability: "view", inputs: [{ name: "gameId", type: "uint256" }], outputs: [{ name: "", type: "tuple", components: [{ name: "gameId", type: "uint256" }, { name: "name", type: "string" }, { name: "creator", type: "address" }, { name: "iframeUrl", type: "string" }, { name: "rewardRate", type: "uint256" }, { name: "totalPlays", type: "uint256" }, { name: "isActive", type: "bool" }] }] },
  { name: "gameMinScore", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "minSecondsBetweenPlays", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },

  { name: "setRewardSplit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_playerPercent", type: "uint256" }, { name: "_creatorPercent", type: "uint256" }], outputs: [] },
  { name: "setPlayerDailyCap", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_cap", type: "uint256" }], outputs: [] },
  { name: "setChainDailyCap", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_cap", type: "uint256" }], outputs: [] },
  { name: "setCapResetPeriod", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_seconds", type: "uint256" }], outputs: [] },
  { name: "setGameMinScore", type: "function", stateMutability: "nonpayable", inputs: [{ name: "gameId", type: "uint256" }, { name: "minScore", type: "uint256" }], outputs: [] },
  { name: "updateGameRewardRate", type: "function", stateMutability: "nonpayable", inputs: [{ name: "gameId", type: "uint256" }, { name: "newRate", type: "uint256" }], outputs: [] },
  { name: "setPaused", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_paused", type: "bool" }], outputs: [] },
  { name: "setMinSecondsBetweenPlays", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_seconds", type: "uint256" }], outputs: [] },
];

const TOURNAMENT_ABI = [
  { name: "createTournament", type: "function", stateMutability: "nonpayable", inputs: [{ name: "gameId", type: "uint256" }, { name: "gameName", type: "string" }, { name: "gameThumbnail", type: "string" }, { name: "entryFee", type: "uint256" }, { name: "maxPlayers", type: "uint256" }, { name: "startTime", type: "uint256" }, { name: "durationInHours", type: "uint256" }], outputs: [] },
  { name: "setPrizePercents", type: "function", stateMutability: "nonpayable", inputs: [{ name: "percents", type: "uint256[]" }], outputs: [] },
  { name: "endTournamentAndDistribute", type: "function", stateMutability: "nonpayable", inputs: [{ name: "tournamentId", type: "uint256" }], outputs: [] },
  { name: "getTournamentInfo", type: "function", stateMutability: "view", inputs: [{ name: "tournamentId", type: "uint256" }], outputs: [{ name: "", type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "gameId", type: "uint256" }, { name: "gameName", type: "string" }, { name: "gameThumbnail", type: "string" }, { name: "creator", type: "address" }, { name: "entryFee", type: "uint256" }, { name: "maxPlayers", type: "uint256" }, { name: "startTime", type: "uint256" }, { name: "endTime", type: "uint256" }, { name: "prizePool", type: "uint256" }, { name: "status", type: "uint8" }, { name: "players", type: "address[]" }, { name: "prizesDistributed", type: "bool" }] }] },
  { name: "nextTournamentId", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
];

// ── Shared UI primitives ─────────────────────────────────────────
const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "11px 14px",
  background: "rgba(255,255,255,0.03)", border: `1px solid ${P.border}`, borderRadius: 9,
  color: "#f0e8ff", fontSize: 13.5, fontFamily: P.raj, outline: "none",
  colorScheme: "dark", // fixes native date/time picker icons being invisible on dark backgrounds
};
const labelStyle = { display: "block", fontSize: 10.5, fontWeight: 700, color: P.dim, marginBottom: 7, fontFamily: P.raj, textTransform: "uppercase", letterSpacing: "0.6px" };
const hintStyle = { fontSize: 11.5, color: P.dimMore, fontFamily: P.raj, lineHeight: 1.6 };

function Btn({ children, busy, disabled, onClick, variant = "primary" }) {
  const styles = {
    primary: { background: busy ? "rgba(123,47,255,0.2)" : `linear-gradient(135deg, ${P.purple}, #5a1fd4)`, color: busy ? "#5533aa" : "#fff" },
    danger:  { background: busy ? "rgba(255,68,68,0.15)" : "rgba(255,68,68,0.16)", color: P.red, border: `1px solid rgba(255,68,68,0.4)` },
    ghost:   { background: "rgba(255,255,255,0.03)", color: P.dim, border: `1px solid ${P.border2}` },
  };
  return (
    <button
      onClick={onClick} disabled={busy || disabled}
      style={{
        padding: "11px 22px", borderRadius: 9, border: "none",
        fontFamily: P.raj, fontWeight: 700, fontSize: 12.5, letterSpacing: "0.4px",
        textTransform: "uppercase", cursor: (busy || disabled) ? "not-allowed" : "pointer",
        opacity: disabled && !busy ? 0.5 : 1, whiteSpace: "nowrap",
        display: "flex", alignItems: "center", gap: 8, justifyContent: "center",
        ...styles[variant],
      }}
    >
      {busy ? "Working..." : children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function EmptyState({ icon, text }) {
  return (
    <div style={{ textAlign: "center", padding: "44px 20px", color: P.dimMore }}>
      <div style={{ fontSize: 30, marginBottom: 12, opacity: 0.55 }}>{icon}</div>
      <div style={{ fontFamily: P.raj, fontSize: 12.5, maxWidth: 340, margin: "0 auto", lineHeight: 1.6 }}>{text}</div>
    </div>
  );
}

// Card with a colored left accent stripe + icon badge — matches the visual
// language of pause/danger/info cards without needing corner-bracket SVGs.
function SettingCard({ icon, iconBg, accent, title, desc, children, warning }) {
  return (
    <div style={{
      background: P.card, borderRadius: 16, padding: 26,
      border: `1px solid ${accent}33`, borderLeft: `3px solid ${accent}`,
      boxShadow: `-6px 0 24px -12px ${accent}22`,
    }}>
      <div style={{ display: "flex", gap: 16, marginBottom: 18 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 11, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 19, background: iconBg || `${accent}18`, border: `1px solid ${accent}40`,
        }}>{icon}</div>
        <div>
          <div style={{ fontFamily: P.orb, fontSize: 14, color: "#fff", marginBottom: 4, letterSpacing: "0.3px" }}>{title}</div>
          <div style={hintStyle}>{desc}</div>
          {warning && <div style={{ ...hintStyle, color: P.red, marginTop: 4, fontWeight: 700 }}>{warning}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

const TABS = [
  { id: "settings", label: "Reward Settings", icon: "⚙️" },
  { id: "games", label: "Games", icon: "🎮" },
  { id: "tournament", label: "Tournaments", icon: "🏆" },
  { id: "players", label: "Player Activity", icon: "📊" },
];

const RANK_STYLE = { 0: { bg: "rgba(255,215,0,0.12)", color: "#FFD700" }, 1: { bg: "rgba(192,192,192,0.12)", color: "#C0C0C0" }, 2: { bg: "rgba(205,127,50,0.12)", color: "#CD7F32" } };

export default function AdminMST() {
  const { address, isConnected } = useAccount();
  const { contracts, chainId } = useChain();
  const publicClient = usePublicClient();

  const PLATFORM = contracts?.platform;
  const TOURNAMENT = contracts?.tournament;

  const [checkingAccess, setCheckingAccess] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [activeTab, setActiveTab] = useState("settings");

  const [settings, setSettings] = useState(null);
  const [poolBalance, setPoolBalance] = useState(null);
  const [faucetBalance, setFaucetBalance] = useState(null);
  const [faucetClaims, setFaucetClaims] = useState(null);
  const [copied, setCopied] = useState(false); // "pool" | "faucet" | false
  const [form, setForm] = useState({ playerPercent: "80", creatorPercent: "20", playerCap: "0", chainCap: "0", resetHours: "24", cooldownSeconds: "0" });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState({ text: "", ok: true });

  const [games, setGames] = useState([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [minScoreInputs, setMinScoreInputs] = useState({});
  const [rewardRateInputs, setRewardRateInputs] = useState({});

  const [tForm, setTForm] = useState({ gameId: "", gameName: "", entryFee: "", maxPlayers: "10", durationInHours: "24" });
  const [prizeSplit, setPrizeSplit] = useState(["60", "25", "15"]);
  const [myTournaments, setMyTournaments] = useState([]);
  const [tournamentsLoading, setTournamentsLoading] = useState(false);
  const [showCreateTournament, setShowCreateTournament] = useState(false);
  const [tMsg, setTMsg] = useState("");
  const [tCreating, setTCreating] = useState(false);

  const [scores, setScores] = useState([]);
  const [loadingData, setLoadingData] = useState(true);

  const showMsg = (text, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg({ text: "", ok: true }), 5000); };

  // ── Access check — on-chain, not backend auth ──
  useEffect(() => {
    if (!address || !PLATFORM) { setCheckingAccess(false); return; }
    (async () => {
      try {
        const role = await readContract(wagmiAdapter.wagmiConfig, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "ADMIN_ROLE", chainId });
        const granted = await readContract(wagmiAdapter.wagmiConfig, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "hasRole", args: [role, address], chainId });
        setHasAccess(granted);
      } catch (err) {
        console.error("Access check failed:", err);
        setHasAccess(false);
      } finally {
        setCheckingAccess(false);
      }
    })();
  }, [address, PLATFORM, chainId]);

  // ── Load settings + games once access confirmed ──
  useEffect(() => {
    if (!hasAccess || !PLATFORM) return;
    (async () => {
      try {
        const [playerPct, creatorPct, playerCap, chainCap, resetPeriod, isPaused, cooldown, total] = await Promise.all([
          readContract(wagmiAdapter.wagmiConfig, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "playerSharePercent", chainId }),
          readContract(wagmiAdapter.wagmiConfig, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "creatorSharePercent", chainId }),
          readContract(wagmiAdapter.wagmiConfig, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "playerDailyCap", chainId }),
          readContract(wagmiAdapter.wagmiConfig, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "chainDailyCap", chainId }),
          readContract(wagmiAdapter.wagmiConfig, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "capResetPeriod", chainId }),
          readContract(wagmiAdapter.wagmiConfig, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "paused", chainId }),
          readContract(wagmiAdapter.wagmiConfig, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "minSecondsBetweenPlays", chainId }),
          readContract(wagmiAdapter.wagmiConfig, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "getTotalGames", chainId }),
        ]);

        const bal = await publicClient.getBalance({ address: PLATFORM });
        setPoolBalance(bal);

        // Faucet balance + remaining claims
        const FAUCET_ADDRESS = contracts?.faucet;
        if (FAUCET_ADDRESS) {
          try {
            const fBal = await publicClient.getBalance({ address: FAUCET_ADDRESS });
            setFaucetBalance(fBal);
            const FAUCET_ABI = [
              { name: "remainingClaims", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
            ];
            const remaining = await readContract(wagmiAdapter.wagmiConfig, {
              address: FAUCET_ADDRESS, abi: FAUCET_ABI,
              functionName: "remainingClaims", chainId,
            });
            setFaucetClaims(Number(remaining));
          } catch (e) {
            console.warn("Faucet balance fetch failed:", e.message);
          }
        }
        setSettings({ playerPct, creatorPct, playerCap, chainCap, resetPeriod, isPaused, cooldown });
        setForm({
          playerPercent: playerPct.toString(), creatorPercent: creatorPct.toString(),
          playerCap: playerCap.toString(), chainCap: chainCap.toString(),
          resetHours: (Number(resetPeriod) / 3600).toString(),
          cooldownSeconds: cooldown.toString(),
        });

        setGamesLoading(true);
        const totalGames = Number(total);
        const gameList = [];
        for (let i = 1; i <= totalGames; i++) {
          try {
            const g = await readContract(wagmiAdapter.wagmiConfig, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "getGame", args: [BigInt(i)], chainId });
            if (g.gameId > 0n) {
              const minScore = await readContract(wagmiAdapter.wagmiConfig, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "gameMinScore", args: [BigInt(i)], chainId });
              gameList.push({ ...g, id: i, minScore: minScore.toString() });
            }
          } catch { /* skip gaps */ }
        }
          // ── Firestore se thumbnailUrl fetch karo (on-chain me nahi hota) ──
try {
  const res = await fetch(`/api/games?action=list&chain=mst`);
  const data = await res.json();
  const firestoreMap = {};
  (data.games || []).forEach(fg => {
    firestoreMap[String(fg.gameId || fg.id)] = fg.thumbnailUrl || "";
  });
  gameList.forEach(g => {
    g.thumbnailUrl = firestoreMap[String(g.id)] || "";
  });
} catch (err) {
  console.warn("Firestore thumbnail fetch failed:", err);
}
        setGames(gameList);
        const initialMinScores = {};
        gameList.forEach(g => { initialMinScores[g.id] = g.minScore; });
        const initialRewardRates = {};
        gameList.forEach(g => { initialRewardRates[g.id] = g.rewardRate ? (Number(g.rewardRate) / 1e18).toString() : ""; });
        setRewardRateInputs(initialRewardRates);
        setMinScoreInputs(initialMinScores);
      } catch (err) {
        console.error("Failed to load platform settings:", err);
      } finally {
        setGamesLoading(false);
      }
    })();
  }, [hasAccess, PLATFORM, chainId, publicClient]);

  // ── Load player score/earning data ──
  useEffect(() => {
    if (!hasAccess) return;
    (async () => {
      setLoadingData(true);
      try {
        const res = await fetch("/api/games?action=scores&chain=mst");
        const data = await res.json();
        setScores(data.scores || []);
      } catch (err) {
        console.error("Failed to load scores:", err);
      } finally {
        setLoadingData(false);
      }
    })();
  }, [hasAccess]);

  useEffect(() => {
    if (hasAccess && activeTab === "tournament") fetchMyTournaments();
  }, [hasAccess, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const runTx = async (key, fn, successText = "Saved on-chain") => {
    console.log(`[runTx] "${key}" starting`);
    setBusy(key);
    try {
      const hash = await fn();
      console.log(`[runTx] "${key}" got hash, waiting for confirmation:`, hash);
      let receipt;
      try {
        // NOTE: deliberately NOT passing chainId here — Creator.jsx's working
        // tournament-creation flow calls this with just { hash }, and passing
        // chainId explicitly was what caused this to hang indefinitely here.
        receipt = await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, {
          hash,
          timeout: 45_000,
          pollingInterval: 2_000,
        });
      } catch (waitErr) {
        console.warn(`[runTx] "${key}" waitForTransactionReceipt timed out/failed — tx was still submitted:`, waitErr);
        showMsg(`Submitted (tx: ${hash.slice(0, 10)}...) but confirmation is taking longer than usual. Check the explorer — it likely still went through.`, true);
        return; // don't treat this as a failure — the tx itself was sent successfully
      }
      console.log(`[runTx] "${key}" receipt status:`, receipt.status);
      if (receipt.status !== "success") {
        throw new Error("Transaction reverted on-chain — check the contract's revert reason.");
      }
      showMsg(successText, true);
    } catch (err) {
      console.error(`[runTx] "${key}" FAILED:`, err);
      showMsg(err.shortMessage || err.message, false);
    } finally {
      setBusy("");
      console.log(`[runTx] "${key}" done (busy cleared)`);
    }
  };

  // ── Save reward rate — on-chain + Firestore ────────────────────
  const handleSaveRewardRate = async (gameId) => {
    const newRate = rewardRateInputs[gameId];
    if (!newRate || isNaN(Number(newRate))) return;

    const parsed = parseFloat(newRate);
    if (parsed <= 0) {
      showMsg("Rate must be greater than 0", false);
      return;
    }

    // Platform stores rewardRate in wei — 0.5 MSTC = 500000000000000000
    const rateWei = BigInt(Math.round(parsed * 1e18));

    const key = `rewardrate-${gameId}`;
    setBusy(key);
    try {
      // 1. On-chain update
      const hash = await writeWithGas(publicClient, {
        address: PLATFORM, abi: PLATFORM_ABI,
        functionName: "updateGameRewardRate",
        args: [BigInt(gameId), rateWei],
        chainId, account: address,
      });
      // MST RPC slow hai — explicit timeout + polling
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, {
        hash,
        timeout: 45_000,
        pollingInterval: 2_000,
      });
      console.log("[handleSaveRewardRate] on-chain done, hash:", hash);

      // 2. Firestore sync
      const token = localStorage.getItem("arcadex_jwt");
      if (!token) { console.warn("[handleSaveRewardRate] No JWT token found in localStorage"); }
      const res = await fetch("/api/games?action=admin-update-reward", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ gameId: String(gameId), rewardRateNative: parsed }),
      });
      const resJson = await res.json();
      if (!res.ok) {
        console.error("[handleSaveRewardRate] Firestore update failed:", resJson.error);
        showMsg(`On-chain ✓ but Firestore failed: ${resJson.error}`, false);
      } else {
        console.log("[handleSaveRewardRate] Firestore updated successfully");
        showMsg(`Reward rate updated to ${parsed} MSTC ✓`, true);
        setGames(prev => prev.map(g => g.id === gameId ? { ...g, rewardRateNative: parsed } : g));
      }
    } catch (err) {
      console.error("[handleSaveRewardRate] error:", err);
      showMsg("Error: " + (err.shortMessage || err.message), false);
    } finally {
      setBusy(null);
    }
  };

  // ── Tournament helpers ──────────────────────────────────────────
  const fetchMyTournaments = async () => {
    if (!TOURNAMENT) return;
    setTournamentsLoading(true);
    try {
      const nextId = await publicClient.readContract({ address: TOURNAMENT, abi: TOURNAMENT_ABI, functionName: "nextTournamentId" });
      const total = Number(nextId) - 1;
      if (total <= 0) { setMyTournaments([]); return; }
      const all = await Promise.all(
        Array.from({ length: total }, (_, i) =>
          publicClient.readContract({ address: TOURNAMENT, abi: TOURNAMENT_ABI, functionName: "getTournamentInfo", args: [BigInt(i + 1)] })
        )
      );
      setMyTournaments(all);
    } catch (err) {
      console.error("fetchMyTournaments failed:", err);
    } finally {
      setTournamentsLoading(false);
    }
  };

  const handleEndTournament = async (tournamentId) => {
    setTCreating(true);
    setTMsg("");
    try {
      const gas = await getGasWithBuffer(publicClient, {
        address: TOURNAMENT, abi: TOURNAMENT_ABI, functionName: "endTournamentAndDistribute",
        args: [BigInt(tournamentId)], account: address,
      });
      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: TOURNAMENT, abi: TOURNAMENT_ABI, functionName: "endTournamentAndDistribute",
        args: [BigInt(tournamentId)], gas,
        // chainId omitted — causes hang on MST
      });
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });
      setTMsg("✓ Prizes distributed!");
      await fetchMyTournaments();
    } catch (err) {
      console.error("End tournament error:", err);
      setTMsg("Error: " + (err.shortMessage || err.message));
    } finally {
      setTCreating(false);
    }
  };

  // ── Derived data for Player Activity ──
  // MST chain pe rewardRateNative use karo — rewardRate BOTChain (ARCADE) ka hai
  const gameRateMap = Object.fromEntries(
    games.map(g => [g.id, Number(g.rewardRateNative ?? g.rewardRate ?? 1)])
  );
  const playerAgg = {};
  const dayAgg = {};
  for (const s of scores) {
    const rate = gameRateMap[s.gameId] ?? 0;
    const playerShare = settings ? Number(settings.playerPct) : 80;
    const estEarned = rate * (playerShare / 100);
    if (!playerAgg[s.player]) playerAgg[s.player] = { plays: 0, estEarned: 0 };
    playerAgg[s.player].plays += 1;
    playerAgg[s.player].estEarned += estEarned;
    const day = s.createdAt ? new Date(s.createdAt).toISOString().slice(0, 10) : "unknown";
    dayAgg[day] = (dayAgg[day] || 0) + estEarned;
  }
  const playerRows = Object.entries(playerAgg).sort((a, b) => b[1].estEarned - a[1].estEarned);
  const dayRows = Object.entries(dayAgg).sort((a, b) => a[0].localeCompare(b[0])).slice(-14)
    .map(([day, val]) => ({ day: day.slice(5), full: day, mstc: Number(val.toFixed(3)) }));
  const totalPayout14d = dayRows.reduce((s, d) => s + d.mstc, 0);
  const totalPlays = scores.length;
  const activePlayers = playerRows.length;
  const avgPerPlayer = activePlayers > 0 ? totalPayout14d / activePlayers : 0;

  if (!isConnected) {
    return <div style={{ minHeight: "100vh", background: P.bg, display: "flex", alignItems: "center", justifyContent: "center", color: P.dim, fontFamily: P.raj, fontSize: 13 }}>Connect your wallet to continue.</div>;
  }
  if (checkingAccess) {
    return <div style={{ minHeight: "100vh", background: P.bg, display: "flex", alignItems: "center", justifyContent: "center", color: P.dim, fontFamily: P.raj, fontSize: 13 }}>Checking access...</div>;
  }
  if (!hasAccess) {
    return (
      <div style={{ minHeight: "100vh", background: P.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <div style={{ fontSize: 44 }}>🔒</div>
        <div style={{ fontFamily: P.raj, fontSize: 16, color: P.purpleL, fontWeight: 700 }}>No admin access on this wallet</div>
        <div style={{ fontFamily: P.raj, fontSize: 12, color: P.dimMore }}>{address}</div>
      </div>
    );
  }

  const poolLow = poolBalance !== null && poolBalance < 5000000000000000000n;

  return (
    <div style={{ minHeight: "100vh", background: P.bg, padding: "36px 24px 100px" }}>
      <div style={{ maxWidth: 940, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg, ${P.purple}, #4a1a9c)`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: P.orb, fontSize: 11, fontWeight: 700, color: "#fff", border: `1px solid ${P.border2}` }}>MST</div>
            <div>
              <div style={{ fontFamily: P.orb, fontSize: 19, color: "#fff", letterSpacing: "0.5px" }}>MST Admin Panel</div>
              <div style={{ fontFamily: P.raj, fontSize: 11.5, color: P.dimMore }}>{address?.slice(0, 8)}...{address?.slice(-6)}</div>
            </div>
          </div>
          {/* Reward Pool card */}
          <div style={{
            padding: "10px 18px", borderRadius: 12, background: P.card, border: `1px solid ${poolLow ? "rgba(255,170,0,0.35)" : P.border2}`,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: poolLow ? P.amber : P.green, boxShadow: `0 0 8px ${poolLow ? P.amber : P.green}` }} />
            <div>
              <div style={{ fontFamily: P.raj, fontSize: 9.5, color: P.dimMore, textTransform: "uppercase", letterSpacing: "0.8px" }}>Reward Pool</div>
              <div style={{ fontFamily: P.orb, fontSize: 15, color: poolLow ? P.amber : "#fff" }}>{poolBalance !== null ? (Number(poolBalance) / 1e18).toFixed(4) : "..."} MSTC</div>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(PLATFORM);
                setCopied("pool");
                setTimeout(() => setCopied(false), 2000);
              }}
              title="Copy Platform address to fund reward pool"
              style={{
                marginLeft: 6, padding: "4px 10px", borderRadius: 7,
                background: copied === "pool" ? "rgba(0,255,136,0.1)" : "rgba(0,255,136,0.06)",
                border: `1px solid ${copied === "pool" ? "rgba(0,255,136,0.4)" : "rgba(0,255,136,0.2)"}`,
                color: copied === "pool" ? P.green : "rgba(0,255,136,0.7)",
                fontFamily: P.raj, fontSize: 10, fontWeight: 700,
                cursor: "pointer", transition: "all 0.2s", whiteSpace: "nowrap",
              }}
            >
              {copied === "pool" ? "✓ Copied!" : "⎘ Copy Address"}
            </button>
          </div>

          {/* Faucet card */}
          {contracts?.faucet && (
            <div style={{
              padding: "10px 18px", borderRadius: 12, background: P.card,
              border: `1px solid ${faucetClaims !== null && faucetClaims < 10 ? "rgba(255,170,0,0.35)" : "rgba(0,212,255,0.25)"}`,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: faucetClaims !== null && faucetClaims < 10 ? P.amber : P.cyan, boxShadow: `0 0 8px ${faucetClaims !== null && faucetClaims < 10 ? P.amber : P.cyan}` }} />
              <div>
                <div style={{ fontFamily: P.raj, fontSize: 9.5, color: P.dimMore, textTransform: "uppercase", letterSpacing: "0.8px" }}>Gas Faucet</div>
                <div style={{ fontFamily: P.orb, fontSize: 15, color: faucetClaims !== null && faucetClaims < 10 ? P.amber : P.cyan }}>
                  {faucetBalance !== null ? (Number(faucetBalance) / 1e18).toFixed(2) : "..."} MSTC
                </div>
                <div style={{ fontFamily: P.raj, fontSize: 9.5, color: P.dimMore, marginTop: 2 }}>
                  {faucetClaims !== null ? `${faucetClaims} claims left` : "..."}
                </div>
              </div>
              {/* Copy address button */}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(contracts.faucet);
                  setCopied("faucet");
                  setTimeout(() => setCopied(false), 2000);
                }}
                title="Copy faucet address to fund it"
                style={{
                  marginLeft: 6, padding: "4px 10px", borderRadius: 7,
                  background: copied === "faucet" ? "rgba(0,212,255,0.1)" : "rgba(0,212,255,0.08)",
                  border: `1px solid ${copied === "faucet" ? "rgba(0,212,255,0.4)" : "rgba(0,212,255,0.25)"}`,
                  color: copied === "faucet" ? P.cyan : P.cyan,
                  fontFamily: P.raj, fontSize: 10, fontWeight: 700,
                  cursor: "pointer", transition: "all 0.2s", whiteSpace: "nowrap",
                }}
              >
                {copied === "faucet" ? "✓ Copied!" : "⎘ Copy Address"}
              </button>
            </div>
          )}
        </div>

        {msg.text && (
          <div style={{ marginBottom: 20, padding: "12px 18px", borderRadius: 10, fontFamily: P.raj, fontSize: 12.5, color: msg.ok ? P.green : P.red, background: msg.ok ? "rgba(0,255,136,0.06)" : "rgba(255,68,68,0.06)", border: `1px solid ${msg.ok ? "rgba(0,255,136,0.25)" : "rgba(255,68,68,0.25)"}`, display: "flex", alignItems: "center", gap: 8 }}>
            {msg.ok ? "✓" : "✕"} <span>{msg.text}</span>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: `1px solid ${P.border}`, overflowX: "auto" }}>
          {TABS.map(t => (
            <button
              key={t.id} onClick={() => setActiveTab(t.id)}
              style={{
                padding: "12px 20px", background: "transparent", border: "none",
                borderBottom: activeTab === t.id ? `2px solid ${P.purple}` : "2px solid transparent",
                color: activeTab === t.id ? "#fff" : P.dimMore,
                fontFamily: P.raj, fontWeight: 700, fontSize: 12.5, letterSpacing: "0.3px",
                cursor: "pointer", whiteSpace: "nowrap", marginBottom: -1,
                display: "flex", alignItems: "center", gap: 7, transition: "color 0.15s",
              }}
            >
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>

        {/* ══════════════ SETTINGS TAB ══════════════ */}
        {activeTab === "settings" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20 }}>

            <SettingCard icon="⏸" accent={P.amber} title="Emergency Controls" desc="Pause or resume all reward distribution across the platform. Affects every game and tournament.">
              <div style={{ display: "flex", gap: 10 }}>
                <Btn variant={settings?.isPaused ? "danger" : "ghost"} busy={busy === "pause"}
                  onClick={() => runTx("pause", () => writeWithGas(publicClient, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "setPaused", args: [!settings?.isPaused], chainId, account: address }), settings?.isPaused ? "Resumed" : "Paused")}>
                  {settings?.isPaused ? "⏸ Paused" : "⏸ Pause"}
                </Btn>
                {settings?.isPaused && <Btn onClick={() => runTx("pause", () => writeWithGas(publicClient, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "setPaused", args: [false], chainId, account: address }), "Resumed")}>▶ Resume</Btn>}
              </div>
            </SettingCard>

            <SettingCard icon="⚖️" accent={P.purple} title="Reward Split" desc="Player % + creator % must sum to 100. Set creator to 0 for a pure play-to-earn model.">
              <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                <Field label="Player %"><input style={inputStyle} type="number" value={form.playerPercent} onChange={e => setForm(f => ({ ...f, playerPercent: e.target.value }))} /></Field>
                <Field label="Creator %"><input style={inputStyle} type="number" value={form.creatorPercent} onChange={e => setForm(f => ({ ...f, creatorPercent: e.target.value }))} /></Field>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ ...hintStyle, color: (Number(form.playerPercent) + Number(form.creatorPercent)) === 100 ? P.green : P.red }}>
                  {(Number(form.playerPercent) + Number(form.creatorPercent)) === 100 ? "✓ Sums to 100" : "✕ Must sum to 100"}
                </span>
                <Btn busy={busy === "split"} onClick={() => runTx("split", () => writeWithGas(publicClient, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "setRewardSplit", args: [BigInt(form.playerPercent), BigInt(form.creatorPercent)], chainId, account: address }))}>Save</Btn>
              </div>
              {settings && <div style={{ ...hintStyle, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${P.border}` }}>Current: {settings.playerPct.toString()}% player / {settings.creatorPct.toString()}% creator</div>}
            </SettingCard>

            <SettingCard icon="🛡" accent={P.cyan} title="Daily Earning Caps" desc="Whole-token units, e.g. 10 = 10 MSTC. Set to 0 to disable a cap.">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <Field label="Per-player cap"><input style={inputStyle} type="number" value={form.playerCap} onChange={e => setForm(f => ({ ...f, playerCap: e.target.value }))} placeholder="e.g. 10" /></Field>
                <Field label="Chain-wide cap"><input style={inputStyle} type="number" value={form.chainCap} onChange={e => setForm(f => ({ ...f, chainCap: e.target.value }))} placeholder="0 = off" /></Field>
              </div>
              <Field label="Reset every (hours)"><input style={inputStyle} type="number" value={form.resetHours} onChange={e => setForm(f => ({ ...f, resetHours: e.target.value }))} placeholder="24" /></Field>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
                <Btn busy={busy === "caps"} onClick={async () => {
                  setBusy("caps");
                  try {
                    const h1 = await writeWithGas(publicClient, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "setPlayerDailyCap", args: [BigInt(form.playerCap)], chainId, account: address });
                    await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash: h1 });
                    const h2 = await writeWithGas(publicClient, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "setChainDailyCap", args: [BigInt(form.chainCap)], chainId, account: address });
                    await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash: h2 });
                    const seconds = BigInt(Math.round(Number(form.resetHours) * 3600));
                    const h3 = await writeWithGas(publicClient, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "setCapResetPeriod", args: [seconds], chainId, account: address });
                    await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash: h3 });
                    showMsg("Caps saved (3 transactions)", true);
                  } catch (err) { showMsg(err.shortMessage || err.message, false); }
                  finally { setBusy(""); }
                }}>Save all</Btn>
              </div>
              {settings && <div style={{ ...hintStyle, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${P.border}` }}>Current: player {settings.playerCap.toString()} · chain {settings.chainCap.toString()} · every {(Number(settings.resetPeriod) / 3600).toFixed(1)}h</div>}
            </SettingCard>

            <SettingCard icon="🤖" accent={P.cyan} title="Anti-Bot Throttle" desc="Minimum seconds a player must wait between plays. 0 disables it.">
              <div style={{ display: "flex", gap: 12, alignItems: "end" }}>
                <div style={{ flex: 1 }}><Field label="Seconds between plays"><input style={inputStyle} type="number" value={form.cooldownSeconds} onChange={e => setForm(f => ({ ...f, cooldownSeconds: e.target.value }))} placeholder="0" /></Field></div>
                <Btn busy={busy === "cooldown"} onClick={() => runTx("cooldown", () => writeWithGas(publicClient, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "setMinSecondsBetweenPlays", args: [BigInt(form.cooldownSeconds)], chainId, account: address }))}>Save</Btn>
              </div>
              {settings && <div style={{ ...hintStyle, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${P.border}` }}>Current: {settings.cooldown.toString()}s between plays</div>}
            </SettingCard>
          </div>
        )}

        {/* ══════════════ GAMES TAB ══════════════ */}
        {activeTab === "games" && (
          <div style={{ background: P.card, border: `1px solid ${P.border}`, borderRadius: 16, padding: 28 }}>
            <div style={{ fontFamily: P.orb, fontSize: 14, color: "#fff", marginBottom: 4 }}>Per-Game Minimum Score</div>
            <div style={{ ...hintStyle, marginBottom: 22 }}>Players must reach this score to receive a reward for that game. 0 = no minimum.</div>
            {gamesLoading ? (
              <EmptyState icon="⏳" text="Loading games..." />
            ) : games.length === 0 ? (
              <EmptyState icon="🎮" text="No games registered on this Platform contract yet. If you just redeployed, run the game-migration script first." />
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {games.map(g => (
                  <div key={g.id} style={{
                    padding: "16px 18px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: `1px solid ${P.border}`,
                  }}>
                    {/* Top row — name + plays */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div>
                        <div style={{ fontFamily: P.raj, fontSize: 14, color: "#fff", fontWeight: 700 }}>{g.name}</div>
                        <div style={{ fontFamily: P.raj, fontSize: 10.5, color: P.dimMore, marginTop: 2 }}>Game #{g.id} · {g.totalPlays.toString()} plays</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: P.orb, fontSize: 12, color: P.cyan }}>On-chain: {g.rewardRate ? (Number(g.rewardRate) / 1e18).toFixed(2) : "0"} MSTC</div>
                        <div style={{ fontFamily: P.raj, fontSize: 10, color: P.dimMore }}>Firestore: {g.rewardRateNative ?? "?"} MSTC</div>
                      </div>
                    </div>
                    {/* Controls row */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto", gap: 10, alignItems: "center" }}>
                      <input style={{ ...inputStyle, fontSize: 12 }} type="number" value={rewardRateInputs[g.id] ?? ""} onChange={e => setRewardRateInputs(m => ({ ...m, [g.id]: e.target.value }))} placeholder="Reward rate (MSTC)" />
                      <Btn busy={busy === `rewardrate-${g.id}`} onClick={() => handleSaveRewardRate(g.id)} style={{ fontSize: 11, padding: "8px 14px" }}>💰 Set Rate</Btn>
                      <input style={{ ...inputStyle, fontSize: 12 }} type="number" value={minScoreInputs[g.id] ?? ""} onChange={e => setMinScoreInputs(m => ({ ...m, [g.id]: e.target.value }))} placeholder="Min score" />
                      <Btn busy={busy === `minscore-${g.id}`} onClick={() => runTx(`minscore-${g.id}`, () => writeWithGas(publicClient, { address: PLATFORM, abi: PLATFORM_ABI, functionName: "setGameMinScore", args: [BigInt(g.id), BigInt(minScoreInputs[g.id] || 0)], chainId, account: address }))} style={{ fontSize: 11, padding: "8px 14px" }}>🎯 Min Score</Btn>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════ TOURNAMENT TAB ══════════════ */}
        {activeTab === "tournament" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* ── Create + List panel ── */}
            <div style={{ background: P.card, border: `1px solid ${P.border}`, borderRadius: 16, padding: 28 }}>
              {/* Header row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <div>
                  <div style={{ fontFamily: P.orb, fontSize: 14, color: "#fff", marginBottom: 3 }}>Tournaments</div>
                  <div style={{ ...hintStyle }}>Create and manage all tournaments on MST chain.</div>
                </div>
                <Btn onClick={() => { setShowCreateTournament(v => !v); setTMsg(""); }} style={{ padding: "10px 20px", flexShrink: 0 }}>
                  {showCreateTournament ? "✕ Cancel" : "🏆 Create Tournament"}
                </Btn>
              </div>

              {/* Create form (toggled) */}
              {showCreateTournament && (
                <div style={{ background: "rgba(123,47,255,0.04)", border: `1px solid ${P.border}`, borderRadius: 12, padding: 24, marginBottom: 24 }}>
                  <div style={{ fontFamily: P.orb, fontSize: 13, color: P.purpleL, marginBottom: 18 }}>Tournament Details</div>

                  {games.length === 0 ? (
                    <EmptyState icon="🎮" text="No games available yet — a game must exist before you can create a tournament." />
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      {/* Game selector */}
                      <div>
                        <label style={labelStyle}>Select Game <span style={{ color: P.red }}>*</span></label>
                        <select style={{ ...inputStyle, cursor: "pointer" }} value={tForm.gameId} onChange={e => {
                          const g = games.find(gm => String(gm.id) === e.target.value);
                          setTForm(f => ({ ...f, gameId: e.target.value, gameName: g?.name || "" }));
                        }}>
                          <option value="">-- Choose a game --</option>
                          {games.map(g => <option key={g.id} value={g.id}>#{g.id} — {g.name}</option>)}
                        </select>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
                        <div>
                          <label style={labelStyle}>Entry Fee (MSTC)</label>
                          <input style={inputStyle} type="number" min="0" value={tForm.entryFee} onChange={e => setTForm(f => ({ ...f, entryFee: e.target.value }))} placeholder="e.g. 5" />
                        </div>
                        <div>
                          <label style={labelStyle}>Max Players (2–100)</label>
                          <input style={inputStyle} type="number" min="2" max="100" value={tForm.maxPlayers} onChange={e => setTForm(f => ({ ...f, maxPlayers: e.target.value }))} />
                        </div>
                        <div>
                          <label style={labelStyle}>Duration (Hours, 1–168)</label>
                          <input style={inputStyle} type="number" min="1" max="168" value={tForm.durationInHours} onChange={e => setTForm(f => ({ ...f, durationInHours: e.target.value }))} />
                        </div>
                      </div>

                      {/* Info preview box */}
                      <div style={{ background: "rgba(123,47,255,0.05)", border: `1px solid ${P.border}`, borderRadius: 8, padding: "12px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {[
                          ["Prize Pool", `${Number(tForm.entryFee || 0) * Number(tForm.maxPlayers || 0)} MSTC`],
                          ["Starts In", "~1 min after creation"],
                          ["Max Players", tForm.maxPlayers || "—"],
                          ["Duration", `${tForm.durationInHours}h`],
                        ].map(([k, v]) => (
                          <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "5px 0", borderBottom: `1px solid ${P.border}` }}>
                            <span style={{ color: P.dimMore, fontFamily: P.raj }}>{k}</span>
                            <span style={{ color: P.purpleL, fontFamily: P.raj, fontWeight: 700 }}>{v}</span>
                          </div>
                        ))}
                      </div>

                      {tMsg && (
                        <div style={{ padding: 10, background: tMsg.startsWith("Error") ? "rgba(255,68,68,0.07)" : "rgba(0,255,136,0.06)", border: `1px solid ${tMsg.startsWith("Error") ? "rgba(255,68,68,0.2)" : "rgba(0,255,136,0.15)"}`, borderRadius: 7, color: tMsg.startsWith("Error") ? P.red : P.green, fontSize: 11, fontFamily: P.raj }}>
                          {tMsg}
                        </div>
                      )}

                      <div style={{ display: "flex", gap: 10 }}>
                        <Btn onClick={() => { setShowCreateTournament(false); setTMsg(""); }} variant="ghost" style={{ flex: 1 }}>Cancel</Btn>
                        <Btn
                          disabled={tCreating || !tForm.gameId || !tForm.entryFee}
                          busy={tCreating}
                          onClick={async () => {
                            if (!tForm.gameId) return;
                            setTCreating(true);
                            setTMsg("");
                            try {
                              const selGame = games.find(g => String(g.id) === String(tForm.gameId));
                              if (!selGame) throw new Error("Game not found");
                              const startTime = BigInt(Math.floor(Date.now() / 1000) + 60);
                              const entryFeeWei = BigInt(Math.floor(Number(tForm.entryFee) * 1e18));
                              const createArgs = [
                                BigInt(selGame.id),
                                selGame.name,
                                selGame.thumbnailUrl || "",
                                entryFeeWei,
                                BigInt(tForm.maxPlayers),
                                startTime,
                                BigInt(tForm.durationInHours),
                              ];
                              const gas = await getGasWithBuffer(publicClient, {
                                address: TOURNAMENT, abi: TOURNAMENT_ABI,
                                functionName: "createTournament", args: createArgs, account: address,
                              });
                              const hash = await writeContract(wagmiAdapter.wagmiConfig, {
                                address: TOURNAMENT, abi: TOURNAMENT_ABI,
                                functionName: "createTournament", args: createArgs, gas,
                                // chainId omitted — causes hang on MST
                              });
                              await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });
                              setTMsg("✓ Tournament created successfully!");
                              setShowCreateTournament(false);
                              setTForm({ gameId: "", gameName: "", entryFee: "", maxPlayers: "10", durationInHours: "24" });
                              await fetchMyTournaments();
                            } catch (err) {
                              console.error("Tournament create error:", err);
                              setTMsg("Error: " + (err.shortMessage || err.message));
                            } finally {
                              setTCreating(false);
                            }
                          }}
                          style={{ flex: 2 }}
                        >
                          {tCreating ? "Creating..." : "🚀 Create Tournament"}
                        </Btn>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Status message outside the form */}
              {tMsg && !showCreateTournament && (
                <div style={{ marginBottom: 16, padding: 10, background: tMsg.startsWith("Error") ? "rgba(255,68,68,0.07)" : "rgba(0,255,136,0.06)", border: `1px solid ${tMsg.startsWith("Error") ? "rgba(255,68,68,0.2)" : "rgba(0,255,136,0.15)"}`, borderRadius: 7, color: tMsg.startsWith("Error") ? P.red : P.green, fontSize: 11, fontFamily: P.raj }}>
                  {tMsg}
                </div>
              )}

              {/* Tournament list */}
              {tournamentsLoading ? (
                <EmptyState icon="⏳" text="Loading tournaments..." />
              ) : myTournaments.length === 0 ? (
                <div style={{ padding: 48, textAlign: "center" }}>
                  <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(123,47,255,0.08)", border: `1px solid ${P.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, margin: "0 auto 14px" }}>🏆</div>
                  <div style={{ fontFamily: P.orb, fontSize: 13, color: "#fff", marginBottom: 6 }}>No tournaments yet</div>
                  <div style={{ ...hintStyle, marginBottom: 20 }}>Create the first tournament to get started.</div>
                  <Btn onClick={() => setShowCreateTournament(true)}>Create First Tournament →</Btn>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {myTournaments.map(t => {
                    const now = Date.now() / 1000;
                    const realStatus = t.status === 2 ? "Ended"
                      : t.status === 3 ? "Cancelled"
                      : now >= Number(t.startTime) && now <= Number(t.endTime) ? "Active"
                      : now > Number(t.endTime) ? "Ended"
                      : "Upcoming";

                    const statusLabel = realStatus === "Upcoming"
                      ? { label: "⏳ Upcoming", color: P.amber, bg: "rgba(255,170,0,0.08)", border: "rgba(255,170,0,0.2)" }
                      : realStatus === "Active"
                      ? { label: "🟢 Active", color: P.green, bg: "rgba(0,255,136,0.08)", border: "rgba(0,255,136,0.2)" }
                      : realStatus === "Cancelled"
                      ? { label: "✗ Cancelled", color: P.red, bg: "rgba(255,68,68,0.08)", border: "rgba(255,68,68,0.2)" }
                      : { label: "✓ Ended", color: P.dimMore, bg: "rgba(123,47,255,0.08)", border: `${P.border}` };

                    const prizePool = Number(t.prizePool) / 1e18;
                    const endTime = new Date(Number(t.endTime) * 1000);

                    return (
                      <div key={String(t.id)} style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${P.border}`, borderRadius: 10, padding: "14px 18px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                        {t.gameThumbnail && (
                          <img src={t.gameThumbnail} alt="" style={{ width: 48, height: 48, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                            <span style={{ fontFamily: P.orb, fontSize: 12, color: "#f0e8ff" }}>{t.gameName}</span>
                            <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 3, fontWeight: 700, background: statusLabel.bg, color: statusLabel.color, border: `1px solid ${statusLabel.border}`, fontFamily: P.raj }}>{statusLabel.label}</span>
                          </div>
                          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                            {[
                              ["Players", `${t.players?.length || 0} / ${Number(t.maxPlayers)}`],
                              ["Entry Fee", `${Number(t.entryFee) / 1e18} MSTC`],
                              ["Prize Pool", `${prizePool.toFixed(2)} MSTC`],
                              ["Ends", endTime.toLocaleDateString()],
                            ].map(([k, v]) => (
                              <div key={k} style={{ fontSize: 10, fontFamily: P.raj }}>
                                <span style={{ color: P.dimMore }}>{k}: </span>
                                <span style={{ color: P.purpleL, fontWeight: 700 }}>{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {(realStatus === "Active" || realStatus === "Ended") && !t.prizesDistributed && (
                          <Btn onClick={() => handleEndTournament(t.id)} busy={tCreating} variant="ghost" style={{ fontSize: 11, padding: "7px 14px", flexShrink: 0 }}>
                            End & Distribute 🏆
                          </Btn>
                        )}
                        {t.prizesDistributed && (
                          <div style={{ fontSize: 10, color: P.green, fontFamily: P.raj, fontWeight: 700, padding: "7px 14px", flexShrink: 0 }}>✓ Prizes Sent</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Prize Split panel ── */}
            <div style={{ background: P.card, border: `1px solid ${P.border}`, borderRadius: 16, padding: 28 }}>
              <div style={{ fontFamily: P.orb, fontSize: 14, color: "#fff", marginBottom: 4 }}>Prize Split</div>
              <div style={{ ...hintStyle, marginBottom: 20 }}>Top 3 finishers — must sum to 100. Applies to every tournament created from now on.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 16 }}>
                {["🥇 1st place %", "🥈 2nd place %", "🥉 3rd place %"].map((lbl, i) => (
                  <Field key={lbl} label={lbl}><input style={inputStyle} type="number" value={prizeSplit[i]} onChange={e => setPrizeSplit(p => p.map((v, idx) => idx === i ? e.target.value : v))} /></Field>
                ))}
              </div>
              <div style={{ ...hintStyle, marginBottom: 14, color: prizeSplit.reduce((s, v) => s + Number(v || 0), 0) === 100 ? P.green : P.red }}>
                {prizeSplit.reduce((s, v) => s + Number(v || 0), 0) === 100 ? "✓ Sums to 100" : "✕ Must sum to 100"}
              </div>
              <Btn busy={busy === "prizesplit"} onClick={() => runTx("prizesplit", () => writeWithGas(publicClient, { address: TOURNAMENT, abi: TOURNAMENT_ABI, functionName: "setPrizePercents", args: [prizeSplit.map(v => BigInt(v || 0))], chainId, account: address }))}>Save Split</Btn>
            </div>
          </div>
        )}

        {/* ══════════════ PLAYERS TAB ══════════════ */}
        {activeTab === "players" && (
          <>
            {loadingData ? (
              <div style={{ background: P.card, border: `1px solid ${P.border}`, borderRadius: 16 }}><EmptyState icon="⏳" text="Loading activity..." /></div>
            ) : scores.length === 0 ? (
              <div style={{ background: P.card, border: `1px solid ${P.border}`, borderRadius: 16 }}><EmptyState icon="📊" text="No plays recorded on this chain yet." /></div>
            ) : (
              <>
                {/* Summary stat row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 20 }}>
                  {[
                    { label: "Payout (14d)", value: `${totalPayout14d.toFixed(2)} MSTC`, accent: P.purple },
                    { label: "Total Plays", value: totalPlays.toLocaleString(), accent: P.cyan },
                    { label: "Active Players", value: activePlayers.toLocaleString(), accent: P.green },
                    { label: "Avg / Player", value: `${avgPerPlayer.toFixed(2)} MSTC`, accent: P.amber },
                  ].map(s => (
                    <div key={s.label} style={{ background: P.card, border: `1px solid ${P.border}`, borderTop: `2px solid ${s.accent}`, borderRadius: 12, padding: "16px 18px" }}>
                      <div style={{ fontFamily: P.orb, fontSize: 20, color: "#fff" }}>{s.value}</div>
                      <div style={{ fontFamily: P.raj, fontSize: 10, color: P.dimMore, textTransform: "uppercase", letterSpacing: "0.6px", marginTop: 4 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Chart */}
                <div style={{ background: P.card, border: `1px solid ${P.border}`, borderRadius: 16, padding: 26, marginBottom: 20 }}>
                  <div style={{ fontFamily: P.orb, fontSize: 13, color: "#fff", marginBottom: 2 }}>Daily Payout</div>
                  <div style={{ ...hintStyle, marginBottom: 18 }}>Last 14 days, estimated MSTC paid out platform-wide.</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={dayRows} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="mstPayoutGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={P.purple} stopOpacity={0.5} />
                          <stop offset="100%" stopColor={P.cyan} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(123,47,255,0.08)" vertical={false} />
                      <XAxis dataKey="day" tick={{ fill: P.dimMore, fontSize: 10, fontFamily: P.raj }} axisLine={{ stroke: P.border }} tickLine={false} />
                      <YAxis tick={{ fill: P.dimMore, fontSize: 10, fontFamily: P.raj }} axisLine={false} tickLine={false} width={40} />
                      <Tooltip
                        contentStyle={{ background: "#0d0b1a", border: `1px solid ${P.border2}`, borderRadius: 8, fontFamily: P.raj, fontSize: 12 }}
                        labelStyle={{ color: P.dim }}
                        itemStyle={{ color: P.purpleL }}
                        formatter={(v) => [`${v} MSTC`, "Paid out"]}
                      />
                      <Area type="monotone" dataKey="mstc" stroke={P.purple} strokeWidth={2.5} fill="url(#mstPayoutGradient)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Leaderboard table */}
                <div style={{ background: P.card, border: `1px solid ${P.border}`, borderRadius: 16, padding: 26 }}>
                  <div style={{ fontFamily: P.orb, fontSize: 13, color: "#fff", marginBottom: 18 }}>Top Earners</div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "40px 1fr 90px 130px", gap: 12, padding: "0 12px 10px", borderBottom: `1px solid ${P.border2}` }}>
                      {["#", "Player", "Plays", "Est. Earned"].map(h => (
                        <div key={h} style={{ fontFamily: P.raj, fontSize: 10, color: P.dimMore, textTransform: "uppercase", letterSpacing: "0.6px" }}>{h}</div>
                      ))}
                    </div>
                    {playerRows.slice(0, 50).map(([player, d], i) => (
                      <div key={player} style={{ display: "grid", gridTemplateColumns: "40px 1fr 90px 130px", gap: 12, alignItems: "center", padding: "12px", borderBottom: `1px solid ${P.border}` }}>
                        <div style={{
                          width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                          fontFamily: P.orb, fontSize: 10.5, fontWeight: 700,
                          background: RANK_STYLE[i]?.bg || "rgba(255,255,255,0.05)", color: RANK_STYLE[i]?.color || P.dimMore,
                        }}>{i + 1}</div>
                        <div style={{ fontFamily: "monospace", fontSize: 12, color: "#fff" }}>{player.slice(0, 10)}...{player.slice(-6)}</div>
                        <div style={{ fontFamily: P.raj, fontSize: 12.5, color: P.dim }}>{d.plays}</div>
                        <div style={{ fontFamily: P.orb, fontSize: 12.5, color: P.purpleL }}>{d.estEarned.toFixed(2)} MSTC</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}