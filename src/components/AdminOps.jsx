import { useState, useEffect } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { writeContract, waitForTransactionReceipt } from "@wagmi/core";
import { parseEther, formatEther, isAddress } from "viem";
import { wagmiAdapter } from "../Providers";
import { useChain } from "../context/ChainContext";

const P = {
  p: "#7B2FFF", p2: "rgba(123,47,255,0.14)", bg: "#08070f", s1: "#0e0c1a", s2: "#12101f",
  b: "rgba(123,47,255,0.12)", b2: "rgba(123,47,255,0.22)",
  raj: "'Rajdhani',sans-serif",
  green: "#00FF88", red: "#ff4444", amber: "#FFB800", cyan: "#00d4ff",
};

const ROLE_ABI = [
  { name: "ADMIN_ROLE", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { name: "hasRole", type: "function", stateMutability: "view", inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }], outputs: [{ type: "bool" }] },
  { name: "grantRole", type: "function", stateMutability: "nonpayable", inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }], outputs: [] },
  { name: "revokeRole", type: "function", stateMutability: "nonpayable", inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }], outputs: [] },
];

const WITHDRAW_ABI = [
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
];

// Read straight from the Platform contract — no chainId hardcoding. isNativeToken
// tells us whether this chain's Platform holds a native reward-pool balance
// (true on MST); rewardTokenSymbol gives us the display symbol (e.g. "MSTC").
const POOL_INFO_ABI = [
  { name: "isNativeToken", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { name: "rewardTokenSymbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
];

async function getGasWithBuffer(publicClient, { address, abi, functionName, args, account, bufferPct = 30 }) {
  try {
    const estimated = await publicClient.estimateContractGas({ address, abi, functionName, args, account });
    return (estimated * BigInt(100 + bufferPct)) / 100n;
  } catch {
    return BigInt(300000);
  }
}

// ── shared styling ──────────────────────────────────────────────────────────
const card = { background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10, padding: 20, marginTop: 24 };
const cardTitle = { fontFamily: P.raj, fontWeight: 700, fontSize: 14, color: "#c4a0ff", marginBottom: 6 };
const cardDesc = { fontSize: 11, color: "#5533aa", fontFamily: P.raj, marginBottom: 14, lineHeight: 1.6 };
const input = { flex: 1, minWidth: 0, padding: "9px 12px", background: P.s2, border: `1px solid ${P.b2}`, borderRadius: 8, color: "#e6d9ff", fontSize: 12, fontFamily: "monospace", outline: "none" };
const smallInput = { ...input, fontFamily: P.raj, maxWidth: 160 };
const btn = (bg, color = "#fff") => ({ padding: "9px 16px", background: bg, border: "none", borderRadius: 8, color, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: P.raj, letterSpacing: "0.4px", whiteSpace: "nowrap" });
const btnPurple = btn("linear-gradient(135deg,#7B2FFF,#5a1fd4)");
const btnRed = btn("rgba(255,68,68,0.1)", P.red);
const btnGhost = btn("rgba(123,47,255,0.1)", "#a67fff");
const disabledBtn = { opacity: 0.5, cursor: "not-allowed" };

function LogLine({ msg }) {
  if (!msg) return null;
  const ok = msg.startsWith("✓");
  const pending = msg.startsWith("⏳");
  const color = ok ? P.green : pending ? P.amber : P.red;
  const bg = ok ? "rgba(0,255,136,0.06)" : pending ? "rgba(255,184,0,0.06)" : "rgba(255,68,68,0.06)";
  return (
    <div style={{ marginTop: 12, padding: 10, background: bg, border: `1px solid ${color}33`, borderRadius: 7, fontSize: 11, color, fontFamily: P.raj, wordBreak: "break-all" }}>
      {msg}
    </div>
  );
}

export default function AdminOps() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { contracts, chainId, chainName } = useChain();

  // Grant/revoke runs on Platform + Tournament (whichever the chain registry has).
  const roleTargets = [
    ["Platform", contracts?.platform],
    ["Tournament", contracts?.tournament],
  ].filter(([, a]) => !!a);

  // ── ROLE MANAGER ──
  const [roleAddr, setRoleAddr] = useState("");
  const [roleStatus, setRoleStatus] = useState(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleLog, setRoleLog] = useState("");

  const checkRole = async () => {
    if (!isAddress(roleAddr)) { setRoleLog("Enter a valid address first."); return; }
    setRoleBusy(true); setRoleLog("");
    try {
      const status = {};
      for (const [label, addr] of roleTargets) {
        const ADMIN_ROLE = await publicClient.readContract({ address: addr, abi: ROLE_ABI, functionName: "ADMIN_ROLE" });
        status[label] = await publicClient.readContract({ address: addr, abi: ROLE_ABI, functionName: "hasRole", args: [ADMIN_ROLE, roleAddr] });
      }
      setRoleStatus(status);
      setRoleLog("✓ Status refreshed.");
    } catch (e) { setRoleLog(`Error: ${e.shortMessage || e.message}`); }
    finally { setRoleBusy(false); }
  };

  const grantOrRevoke = async (kind) => {
    if (!isAddress(roleAddr)) { setRoleLog("Enter a valid address first."); return; }
    if (!roleTargets.length) { setRoleLog("No Platform/Tournament address in the chain registry."); return; }
    const verb = kind === "grant" ? "Grant" : "Revoke";
    if (!window.confirm(`${verb} ADMIN_ROLE ${kind === "grant" ? "to" : "from"} ${roleAddr} on ${roleTargets.map(t => t[0]).join(" + ")}?`)) return;
    setRoleBusy(true); setRoleLog("");
    try {
      for (const [label, addr] of roleTargets) {
        const ADMIN_ROLE = await publicClient.readContract({ address: addr, abi: ROLE_ABI, functionName: "ADMIN_ROLE" });
        const fn = kind === "grant" ? "grantRole" : "revokeRole";
        const args = [ADMIN_ROLE, roleAddr];
        setRoleLog(`⏳ ${verb}ing on ${label}…`);
        const gas = await getGasWithBuffer(publicClient, { address: addr, abi: ROLE_ABI, functionName: fn, args, account: address });
        const hash = await writeContract(wagmiAdapter.wagmiConfig, { address: addr, abi: ROLE_ABI, functionName: fn, args, gas, chainId });
        await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });
      }
      setRoleLog(`✓ ${verb}ed ADMIN_ROLE on ${roleTargets.map(t => t[0]).join(" + ")}.`);
      await checkRole();
    } catch (e) { setRoleLog(`Error: ${e.shortMessage || e.message}`); }
    finally { setRoleBusy(false); }
  };

  // ── REWARD POOL WITHDRAW (client-side, Platform.withdraw — native chains only) ──
  const [isNative, setIsNative] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [poolTo, setPoolTo] = useState("");
  const [poolAmount, setPoolAmount] = useState("");
  const [poolBal, setPoolBal] = useState(null);
  const [poolBusy, setPoolBusy] = useState(false);
  const [poolLog, setPoolLog] = useState("");

  const loadPoolInfo = async () => {
    if (!contracts?.platform || !publicClient) { setIsNative(false); setPoolBal(null); return; }
    try {
      const [native, sym] = await Promise.all([
        publicClient.readContract({ address: contracts.platform, abi: POOL_INFO_ABI, functionName: "isNativeToken" }),
        publicClient.readContract({ address: contracts.platform, abi: POOL_INFO_ABI, functionName: "rewardTokenSymbol" }).catch(() => ""),
      ]);
      setIsNative(!!native);
      setSymbol(sym || "");
      if (native) {
        const bal = await publicClient.getBalance({ address: contracts.platform });
        setPoolBal(formatEther(bal));
      } else {
        setPoolBal(null);
      }
    } catch { setIsNative(false); setPoolBal(null); }
  };
  useEffect(() => { loadPoolInfo(); /* eslint-disable-next-line */ }, [chainId, contracts?.platform]);

  const poolSym = symbol || "tokens";

  const withdrawPool = async () => {
    if (!isAddress(poolTo)) { setPoolLog("Enter a valid recipient address."); return; }
    const amt = Number(poolAmount);
    if (!amt || amt <= 0) { setPoolLog("Enter a valid amount."); return; }
    if (!window.confirm(`Withdraw ${amt} ${poolSym} from the Reward Pool to ${poolTo}?`)) return;
    setPoolBusy(true); setPoolLog("");
    try {
      const args = [poolTo, parseEther(String(poolAmount))];
      const gas = await getGasWithBuffer(publicClient, { address: contracts.platform, abi: WITHDRAW_ABI, functionName: "withdraw", args, account: address });
      const hash = await writeContract(wagmiAdapter.wagmiConfig, { address: contracts.platform, abi: WITHDRAW_ABI, functionName: "withdraw", args, gas, chainId });
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });
      setPoolLog(`✓ Withdrew ${amt} ${poolSym} → ${poolTo}`);
      setPoolAmount(""); setPoolTo("");
      await loadPoolInfo();
    } catch (e) { setPoolLog(`Error: ${e.shortMessage || e.message}`); }
    finally { setPoolBusy(false); }
  };

  // ── FAUCET WITHDRAW (backend, server key = faucet owner) ──
  const [faucetTo, setFaucetTo] = useState("");
  const [faucetAmount, setFaucetAmount] = useState("");
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [faucetLog, setFaucetLog] = useState("");

  const withdrawFaucet = async () => {
    if (!isAddress(faucetTo)) { setFaucetLog("Enter a valid recipient address."); return; }
    const amt = Number(faucetAmount);
    if (!amt || amt <= 0) { setFaucetLog("Enter a valid amount."); return; }
    if (!window.confirm(`Withdraw ${amt} MSTC from the Faucet to ${faucetTo}?`)) return;
    setFaucetBusy(true); setFaucetLog("");
    try {
      const token = localStorage.getItem("arcadex_jwt");
      const res = await fetch("/api/games?action=admin-faucet-withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ to: faucetTo, amount: String(faucetAmount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Withdraw failed");
      setFaucetLog(`✓ Withdrew ${amt} MSTC → ${faucetTo}  (tx ${data.txHash?.slice(0, 12)}…)`);
      setFaucetAmount(""); setFaucetTo("");
    } catch (e) { setFaucetLog(`Error: ${e.message}`); }
    finally { setFaucetBusy(false); }
  };

  // ── FLAGGED ACCOUNTS ──
  const [flagged, setFlagged] = useState([]);
  const [flaggedBusy, setFlaggedBusy] = useState(false);
  const [clearingPlayer, setClearingPlayer] = useState(null);
  const [flagLog, setFlagLog] = useState("");

  const fetchFlagged = async () => {
    setFlaggedBusy(true); setFlagLog("");
    try {
      const token = localStorage.getItem("arcadex_jwt");
      const res = await fetch("/api/games?action=flagged-list", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fetch failed");
      setFlagged(data.players || []);
    } catch (e) { setFlagLog(`Error: ${e.message}`); }
    finally { setFlaggedBusy(false); }
  };
  useEffect(() => { fetchFlagged(); }, []);

  const clearFlags = async (player) => {
    if (!window.confirm(`Clear all flags for ${player}? This immediately un-bans the wallet.`)) return;
    setClearingPlayer(player); setFlagLog("");
    try {
      const token = localStorage.getItem("arcadex_jwt");
      const res = await fetch("/api/games?action=clear-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ player }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Clear failed");
      setFlagLog(`✓ Cleared ${data.cleared} flag(s) for ${player.slice(0, 10)}…`);
      await fetchFlagged();
    } catch (e) { setFlagLog(`Error: ${e.message}`); }
    finally { setClearingPlayer(null); }
  };

  const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

  return (
    <div>
      {/* ── 1. ADMIN ROLE MANAGER ─────────────────────────────────────────── */}
      <div style={card}>
        <div style={cardTitle}>🛡️ Admin Role — Grant / Revoke</div>
        <div style={cardDesc}>
          Grants or revokes <b>ADMIN_ROLE</b> on {roleTargets.map(t => t[0]).join(" + ") || "the platform contracts"} for the entered wallet.
          Your connected wallet must hold <b>DEFAULT_ADMIN_ROLE</b> or the transaction reverts. Runs one tx per contract.
          {roleTargets.length < 2 && (
            <span style={{ color: P.amber }}> {" "}⚠ Tournament address not in the chain registry — only Platform will be affected.</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input style={input} placeholder="0x wallet address" value={roleAddr} onChange={e => setRoleAddr(e.target.value.trim())} />
          <button style={{ ...btnGhost, ...(roleBusy ? disabledBtn : {}) }} disabled={roleBusy} onClick={checkRole}>Check</button>
          <button style={{ ...btnPurple, ...(roleBusy ? disabledBtn : {}) }} disabled={roleBusy} onClick={() => grantOrRevoke("grant")}>Grant</button>
          <button style={{ ...btnRed, ...(roleBusy ? disabledBtn : {}) }} disabled={roleBusy} onClick={() => grantOrRevoke("revoke")}>Revoke</button>
        </div>
        {roleStatus && (
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {Object.entries(roleStatus).map(([label, has]) => (
              <span key={label} style={{ fontSize: 10, padding: "3px 10px", borderRadius: 10, fontFamily: P.raj, fontWeight: 700, background: has ? "rgba(0,255,136,0.1)" : "rgba(255,68,68,0.1)", color: has ? P.green : P.red, border: `1px solid ${has ? P.green : P.red}33` }}>
                {label}: {has ? "✓ has ADMIN_ROLE" : "✗ no role"}
              </span>
            ))}
          </div>
        )}
        <LogLine msg={roleLog} />
      </div>

      {/* ── 2. REWARD POOL WITHDRAW ────────────────────────────────────────── */}
      <div style={card}>
        <div style={cardTitle}>🏦 Reward Pool — Withdraw</div>
        <div style={cardDesc}>
          Sends native {poolSym} from the Platform contract's own balance (the reward pool) to any address, via on-chain
          <b> Platform.withdraw()</b> — signed by your connected admin wallet. Available only on native-token chains
          (detected from the contract's isNativeToken).
          {isNative && poolBal != null && <span style={{ color: P.cyan }}> {" "}Pool balance: <b>{Number(poolBal).toLocaleString()} {poolSym}</b>.</span>}
        </div>
        {!isNative ? (
          <div style={{ fontSize: 11, color: P.amber, fontFamily: P.raj }}>
            {chainName} isn't a native-token chain — its Platform mints rewards instead of holding a pool balance. Switch to the native-token chain (MST) to withdraw from the reward pool.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input style={input} placeholder="0x recipient address" value={poolTo} onChange={e => setPoolTo(e.target.value.trim())} />
              <input style={smallInput} placeholder={`amount (${poolSym})`} value={poolAmount} onChange={e => setPoolAmount(e.target.value.trim())} />
              <button style={{ ...btnPurple, ...(poolBusy ? disabledBtn : {}) }} disabled={poolBusy} onClick={withdrawPool}>
                {poolBusy ? "Withdrawing…" : "Withdraw"}
              </button>
            </div>
            <LogLine msg={poolLog} />
          </>
        )}
      </div>

      {/* ── 3. FAUCET WITHDRAW ─────────────────────────────────────────────── */}
      <div style={card}>
        <div style={cardTitle}>🚰 Faucet — Withdraw</div>
        <div style={cardDesc}>
          Sends MSTC out of the MST faucet to any address. Runs server-side with the faucet-owner key (the same key the gas
          faucet uses), gated by your on-chain admin role — you don't need to connect the owner wallet.
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input style={input} placeholder="0x recipient address" value={faucetTo} onChange={e => setFaucetTo(e.target.value.trim())} />
          <input style={smallInput} placeholder="amount (MSTC)" value={faucetAmount} onChange={e => setFaucetAmount(e.target.value.trim())} />
          <button style={{ ...btnPurple, ...(faucetBusy ? disabledBtn : {}) }} disabled={faucetBusy} onClick={withdrawFaucet}>
            {faucetBusy ? "Withdrawing…" : "Withdraw"}
          </button>
        </div>
        <LogLine msg={faucetLog} />
      </div>

      {/* ── 4. FLAGGED ACCOUNTS ────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={cardTitle}>🚩 Flagged Accounts — Anti-Cheat</div>
          <button style={{ ...btnGhost, ...(flaggedBusy ? disabledBtn : {}) }} disabled={flaggedBusy} onClick={fetchFlagged}>
            {flaggedBusy ? "Loading…" : "🔄 Refresh"}
          </button>
        </div>
        <div style={cardDesc}>
          Wallets with anti-cheat flags. A wallet is soft-banned from score signing while it has <b>3+ flags in the last 24h</b>.
          Clearing removes all of a wallet's flags and un-bans it immediately.
        </div>

        {flagged.length === 0 ? (
          <div style={{ fontSize: 11, color: "#5533aa", fontFamily: P.raj, padding: "8px 0" }}>
            {flaggedBusy ? "Loading flagged wallets…" : "No flagged wallets. 🎉"}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {flagged.map((f) => (
              <div key={f.player} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: P.s2, border: `1px solid ${f.banned ? "rgba(255,68,68,0.3)" : P.b}`, borderRadius: 8, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "monospace", fontSize: 12, color: "#c4a0ff" }} title={f.player}>{short(f.player)}</span>
                    {f.banned && <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 8, background: "rgba(255,68,68,0.12)", color: P.red, border: `1px solid ${P.red}33`, fontFamily: P.raj, fontWeight: 700 }}>⛔ BANNED</span>}
                    <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 8, background: "rgba(255,184,0,0.1)", color: P.amber, border: `1px solid ${P.amber}33`, fontFamily: P.raj, fontWeight: 700 }}>{f.recent} in 24h · {f.total} total</span>
                    {(f.chains || []).map(c => <span key={c} style={{ fontSize: 9, padding: "2px 7px", borderRadius: 8, background: "rgba(0,212,255,0.08)", color: P.cyan, border: `1px solid ${P.cyan}33`, fontFamily: P.raj, fontWeight: 700 }}>{c}</span>)}
                  </div>
                  <div style={{ fontSize: 10, color: "#5533aa", fontFamily: P.raj, marginTop: 4 }}>
                    {Object.entries(f.reasons || {}).map(([r, n]) => `${r} ×${n}`).join(" · ")}
                    {f.lastFlaggedAt && <span> · last {new Date(f.lastFlaggedAt).toLocaleString()}</span>}
                  </div>
                </div>
                <button style={{ ...btnRed, ...(clearingPlayer === f.player ? disabledBtn : {}) }} disabled={clearingPlayer === f.player} onClick={() => clearFlags(f.player)}>
                  {clearingPlayer === f.player ? "Clearing…" : "Clear Flags"}
                </button>
              </div>
            ))}
          </div>
        )}
        <LogLine msg={flagLog} />
      </div>
    </div>
  );
}
