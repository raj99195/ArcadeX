import { useState, useRef, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAppKit } from "@reown/appkit/react";
import { useAccount, useSwitchChain, useChainId, usePublicClient } from "wagmi";
import { useArcadeBalance } from "../hooks/useArcadeBalance";
import { getActiveAvatarStyle } from "../utils/avatarUtils";
import { useChain } from "../context/ChainContext";
import { useFirebaseAuth } from "../hooks/useFirebaseAuth";

const LOGO_SIZE = 28;

export default function Navbar() {
  const { open } = useAppKit();
  const { isConnected, address } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const walletChainId = useChainId();
  const navigate = useNavigate();
  const location = useLocation();
  const { balance } = useArcadeBalance();
  
  // Need rewardToken to display ARCADE or MSTC dynamically
  const { chainName, clearChainSelection, rewardToken, activeChain, chainKey, contracts } = useChain();
  const publicClient = usePublicClient();
  
  const [ddOpen, setDdOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [avatarStyle, setAvatarStyle] = useState("bottts");
  const [earningsOpen, setEarningsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [earningsData, setEarningsData] = useState([]);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [gameMap, setGameMap] = useState({}); // gameId → { thumbnail, name }
  const [playerShareForEarnings, setPlayerShareForEarnings] = useState(80); // on-chain playerSharePercent
  const [faucetClaimed, setFaucetClaimed] = useState(false);
  const [faucetPanel, setFaucetPanel] = useState(false);      // panel open?
  const [faucetStage, setFaucetStage] = useState("idle");      // idle | redirecting | claiming | success | error
  const [faucetError, setFaucetError] = useState("");

  const ddRef = useRef(null);
  const menuRef = useRef(null);

  // ── Faucet: check if already claimed on MST connect ──────────────
  useEffect(() => {
    if (!isConnected || !address || chainKey !== "mst") return;
    (async () => {
      try {
        const res = await fetch(`/api/games?action=check-gas-claim&address=${address}`);
        const data = await res.json();
        if (data.claimed) setFaucetClaimed(true);
      } catch (e) { /* silent fail */ }
    })();
  }, [isConnected, address, chainKey]);

  const { user: xUser, loginWithTwitter } = useFirebaseAuth();

  // Panel-driven claim flow with staged animations
  const handleClaimGas = async () => {
    if (!address || faucetStage === "claiming" || faucetStage === "redirecting") return;
    setFaucetError("");

    const token = localStorage.getItem("arcadex_jwt");
    if (!token) {
      setFaucetStage("error");
      setFaucetError("Connect your wallet first.");
      return;
    }

    try {
      // ── Stage 1: X login (if not already) ──
      let fbUser = xUser;
      if (!fbUser) {
        setFaucetStage("redirecting");            // "Redirecting to X…" animation
        await new Promise(r => setTimeout(r, 600)); // let animation breathe
        try {
          fbUser = await loginWithTwitter();       // X popup
        } catch {
          setFaucetStage("idle");                  // user cancelled — back to panel
          setFaucetError("X login cancelled. Please try again.");
          return;
        }
      }
      const firebaseToken = await fbUser.getIdToken();

      // ── Stage 2: claiming ──
      setFaucetStage("claiming");                  // "Claiming 0.1 MSTC…" animation
      const res = await fetch("/api/games?action=claim-gas", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ address, firebaseToken }),
      });
      const data = await res.json();

      if (data.already || data.success) {
        setFaucetStage("success");
        setFaucetClaimed(true);
        if (data.success) console.log("✅ 0.1 MSTC claimed:", data.txHash);
        setTimeout(() => setFaucetPanel(false), 2200);  // auto-close after success
      } else {
        setFaucetStage("error");
        setFaucetError(data.error || "Claim failed. Try again.");
      }
    } catch (e) {
      console.error("Faucet claim failed:", e);
      setFaucetStage("error");
      setFaucetError("Something went wrong. Try again.");
    }
  };
  // ── Wallet connect ────────────────────────────────────────────────
  // Single source of truth: AppKit open() handles EVERYTHING —
  //   • injected wallets (MetaMask, Bridge Key, Rabby…)
  //   • WalletConnect / mobile deeplinks
  //   • chain add + switch
  //   • wagmi state sync (top-right updates correctly)
  //
  // Previously we ran window.ethereum.request(wallet_switchEthereumChain)
  // AND wagmi connectAsync(injected()) back-to-back. That produced:
  //   1) two connect popups (Ritik / MST team bug report)
  //   2) top-right state not updating (second popup owned the session,
  //      wagmi never saw the accountsChanged event from the first)
  //   3) Bridge Key wallet disconnect within ~1s (race between the two
  //      connection attempts)
  //
  // Providers.jsx already puts savedNetwork FIRST in appKitNetworks,
  // so open() connects to the correct chain — no manual switch needed.
  // For chain changes AFTER connect, the useEffect below auto-syncs.
  const handleConnect = () => open();

  // ── Auto-sync wallet chain to activeChain ─────────────────────────
  // If the user is already connected and then switches chain selection
  // via ChainSelector, quietly ask the wallet to switch. User only sees
  // ONE prompt (the wallet's native switch), no duplicate connect popup.
  useEffect(() => {
    if (!isConnected || !activeChain?.chainId) return;
    if (walletChainId && walletChainId !== activeChain.chainId) {
      switchChainAsync({ chainId: activeChain.chainId }).catch(err => {
        // User rejected, or chain not added yet — no-op. Next on-chain
        // tx will re-prompt via wagmi's built-in switch, so we don't
        // spam popups here.
        console.warn("Chain auto-sync skipped:", err?.shortMessage || err?.message);
      });
    }
  }, [isConnected, walletChainId, activeChain?.chainId, switchChainAsync]);

  const shortAddress = (addr) => addr ? addr.slice(0, 5) + "..." + addr.slice(-3) : "";
  const isActive = (path) => location.pathname === path;
  const avatarUrl = address
    ? `https://api.dicebear.com/9.x/${avatarStyle}/svg?seed=${address}`
    : null;

  useEffect(() => {
    if (address) setAvatarStyle(getActiveAvatarStyle(address));
  }, [address]);

  useEffect(() => {
    const handler = () => { if (address) setAvatarStyle(getActiveAvatarStyle(address)); };
    window.addEventListener("avatar_style_changed", handler);
    return () => window.removeEventListener("avatar_style_changed", handler);
  }, [address]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const h = (e) => {
      if (ddRef.current && !ddRef.current.contains(e.target)) setDdOpen(false);
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  // ── Earnings fetch ───────────────────────────────────────────────────
  const fetchEarnings = async () => {
    if (!address) return;
    setEarningsLoading(true);
    try {
      const [scoresRes, gamesRes] = await Promise.all([
        fetch(`/api/games?action=scores`),
        fetch(`/api/games?action=list`),
      ]);
      const scoresData = await scoresRes.json();
      const gamesData = await gamesRes.json();

      // Build gameId → { thumbnail, name, rewardRate, rewardRateNative } map
      const map = {};
      (gamesData.games || []).forEach(g => {
        map[g.gameId || g.id] = {
          thumbnail: g.thumbnailUrl || g.thumbnail || g.image || null,
          name: g.name,
          rewardRate: g.rewardRate || 50,
          rewardRateNative: g.rewardRateNative || 1,
        };
      });
      setGameMap(map);

      // Fetch on-chain playerSharePercent — fallback for plays without saved earned
      try {
        const SHARE_ABI = [{ name: "playerSharePercent", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }];
        const platformAddr = contracts?.platform;
        if (platformAddr && publicClient) {
          const share = await publicClient.readContract({ address: platformAddr, abi: SHARE_ABI, functionName: "playerSharePercent" });
          setPlayerShareForEarnings(Number(share));
        }
      } catch (e) { /* keep default 80 */ }

      // Filter only this player's scores
      const mine = (scoresData.scores || [])
        .filter(s => s.player?.toLowerCase() === address.toLowerCase())
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setEarningsData(mine);
    } catch (e) {
      setEarningsData([]);
    } finally {
      setEarningsLoading(false);
    }
  };

  const handleEarningsOpen = () => {
    setEarningsOpen(true);
    fetchEarnings();
  };

  const copyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address).catch(() => {
      // fallback for older browsers
      const el = document.createElement("textarea");
      el.value = address;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  // Group scores by date
  const groupByDay = (scores) => {
    const groups = {};
    scores.forEach(s => {
      const d = s.createdAt ? new Date(s.createdAt) : null;
      const key = d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Unknown";
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    });
    return groups;
  };

  // Only show plays for the currently selected chain
  const chainFiltered = earningsData.filter(
    s => (s.chain || "botchain").toLowerCase() === (chainKey || "botchain").toLowerCase()
  );
  const isCurrentMst = (chainKey || "botchain").toLowerCase() === "mst";

  const navLinks = [
    { label: "Home", path: "/" },
    { label: "Games", path: "/games" },
    { label: "Leaderboard", path: "/leaderboard" },
    { label: "Tournaments", path: "/tournaments" },
    { label: "Marketplace", path: "/marketplace" },
    { label: "Creators", path: "/publish" },
    { label: "Support", path: "/support" }
  ];

  return (
    <>
    <nav style={{
      position: "sticky", top: 0, zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: isMobile ? "0 16px" : "0 36px", height: "54px",
      background: "rgba(8,7,15,0.97)",
      borderBottom: "1px solid rgba(123,47,255,0.18)",
      boxShadow: "0 1px 24px rgba(123,47,255,0.1), 0 1px 0 rgba(0,212,255,0.06)",
      backdropFilter: "blur(20px)",
    }}>

      {/* 1. FIXED LOGO - Hamesha IA-logo dikhega */}
      <div ref={ddRef} style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <div onClick={() => isMobile ? navigate("/") : setDdOpen(p => !p)} style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", userSelect: "none" }}>
          
          <img src="/IA-logo.webp" alt="ArcadeX Logo" style={{ width: 30, height: 30, objectFit: "contain", filter: "drop-shadow(0 0 12px rgba(150,80,255,0.9)) drop-shadow(0 0 22px rgba(0,212,255,0.35))" }} />
          
          <span style={{ fontSize: 14.5, fontWeight: 800, color: "#fff", fontFamily: "'Rajdhani',sans-serif", letterSpacing: "0.6px", background: "linear-gradient(90deg,#fff,#d8bfff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>ArcadeX</span>
          {!isMobile && (
            <svg width="9" height="9" viewBox="0 0 9 9" style={{ opacity: 0.3, transform: ddOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
              <path d="M1.5 3L4.5 6L7.5 3" stroke="#fff" strokeWidth="1.2" fill="none" strokeLinecap="round" />
            </svg>
          )}
        </div>

        {/* Desktop dropdown */}
        {!isMobile && (
          <div style={{
            position: "absolute", top: "calc(100% + 8px)", left: 0,
            background: "#0e0c1a", border: "1px solid rgba(123,47,255,0.2)",
            borderRadius: 8, overflow: "hidden", minWidth: 152,
            boxShadow: "0 16px 40px rgba(0,0,0,0.8)",
            opacity: ddOpen ? 1 : 0, pointerEvents: ddOpen ? "all" : "none",
            transform: ddOpen ? "translateY(0)" : "translateY(-6px)",
            transition: "opacity 0.16s, transform 0.16s",
          }}>
            {[
              { label: "Games", path: "/games", color: "#a67fff" },
              { label: "Tournaments", path: "/tournaments", color: "#FFB700" },
              { label: "Marketplace", path: "/marketplace", color: "#00FF88" },
              { label: "Creators", path: "/publish", color: "#00d4ff" },
            ].map(({ label, path, color }) => (
              <div key={label} onClick={() => { navigate(path); setDdOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", fontSize: 12, cursor: "pointer", borderBottom: label === "Games" ? "1px solid rgba(123,47,255,0.08)" : "none", color: isActive(path) ? color : "#9a8fc2", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: "0.3px", transition: "background 0.15s, color 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(123,47,255,0.08)"; e.currentTarget.style.color = color; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = isActive(path) ? color : "#9a8fc2"; }}
              >
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: isActive(path) ? color : "#544a70", boxShadow: isActive(path) ? `0 0 6px ${color}` : "none" }} />
                {label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Desktop Nav Links */}
      {!isMobile && (
        <div style={{ display: "flex", gap: 4 }}>
          {[["Home", "/"], ["Games", "/games"], ["Leaderboard", "/leaderboard"], ["Tournaments", "/tournaments"], ["Marketplace", "/marketplace"],["Support", "/support"]].map(([label, path]) => (
            <Link key={label} to={path} style={{
              position: "relative", padding: "6px 14px", borderRadius: 6,
              color: isActive(path) ? "#fff" : "#9a8fc2",
              background: isActive(path) ? "rgba(123,47,255,0.14)" : "transparent",
              fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.3px",
              textDecoration: "none", transition: "all 0.2s",
            }}
              onMouseEnter={e => { if (!isActive(path)) { e.target.style.color = "#fff"; e.target.style.background = "rgba(123,47,255,0.08)"; } }}
              onMouseLeave={e => { if (!isActive(path)) { e.target.style.color = "#9a8fc2"; e.target.style.background = "transparent"; } }}
            >
              {label}
              {isActive(path) && (
                <span style={{
                  position: "absolute", bottom: -3, left: 12, right: 12, height: 2,
                  background: "linear-gradient(90deg,#7B2FFF,#00d4ff)", borderRadius: 2,
                  boxShadow: "0 0 8px rgba(123,47,255,0.8)",
                }} />
              )}
            </Link>
          ))}
        </div>
      )}

      {/* RIGHT */}
      <div style={{ display: "flex", gap: 7, alignItems: "center" }}>

        {/* CHAIN SWITCHER */}
        {isConnected && chainName && (
          <button onClick={clearChainSelection} title="Switch chain" style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: isMobile ? "4px 8px" : "5px 11px",
            background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.22)",
            borderRadius: 20, cursor: "pointer", fontFamily: "'Rajdhani',sans-serif",
            transition: "all 0.2s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(0,212,255,0.45)"; e.currentTarget.style.background = "rgba(0,212,255,0.14)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(0,212,255,0.22)"; e.currentTarget.style.background = "rgba(0,212,255,0.08)"; }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00d4ff", flexShrink: 0 }} />
            <span style={{ color: "#00d4ff", fontSize: isMobile ? 10 : 11, fontWeight: 700, letterSpacing: "0.3px", whiteSpace: "nowrap" }}>
              {isMobile ? (chainName || "").split(" ")[0] : chainName}
            </span>
            <svg width="8" height="8" viewBox="0 0 9 9" style={{ opacity: 0.6 }}>
              <path d="M1.5 3L4.5 6L7.5 3" stroke="#00d4ff" strokeWidth="1.2" fill="none" strokeLinecap="round" />
            </svg>
          </button>
        )}

        {/* 2. REWARD BALANCE — clickable → earnings panel */}
        {isConnected && balance !== null && !(isMobile && chainKey === "mst" && !faucetClaimed && Number(balance) === 0) && (
          <div
            onClick={handleEarningsOpen}
            title="View earning history"
            style={{ display: "flex", alignItems: "center", gap: 6, padding: isMobile ? "0 8px" : "0 12px", height: LOGO_SIZE + 8, borderRadius: (LOGO_SIZE + 8) / 2, background: "rgba(123,47,255,0.1)", border: "1px solid rgba(123,47,255,0.25)", boxShadow: "0 0 14px rgba(123,47,255,0.12)", cursor: "pointer", transition: "all 0.2s" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(123,47,255,0.18)"; e.currentTarget.style.borderColor = "rgba(123,47,255,0.5)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(123,47,255,0.1)"; e.currentTarget.style.borderColor = "rgba(123,47,255,0.25)"; }}
          >
            <div style={{ width: LOGO_SIZE, height: LOGO_SIZE, borderRadius: "50%", overflow: "hidden", border: "1.5px solid rgba(123,47,255,0.5)", flexShrink: 0, background: "#0e0c1a" }}>
              <img src={avatarUrl || `https://api.dicebear.com/9.x/bottts/svg?seed=${address}`} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ color: "#c4a0ff", fontWeight: 700, fontFamily: "'Orbitron',sans-serif", fontSize: isMobile ? 10 : 11, letterSpacing: "0.3px" }}>
                {Number(balance).toLocaleString()}
              </span>
              <span style={{ color: "#8866cc", fontWeight: 700, fontFamily: "'Rajdhani',sans-serif", fontSize: 9 }}>
                {rewardToken || "ARCADE"}
              </span>
            </div>
            <span style={{ fontSize: 9, color: "rgba(123,47,255,0.6)", marginLeft: 2 }}>▾</span>
          </div>
        )}

        {/* ⛽ FAUCET — MST only, balance 0, not claimed */}
        {isConnected && chainKey === "mst" &&
         !faucetClaimed && Number(balance) === 0 && (
          <button
            onClick={() => { setFaucetPanel(true); setFaucetStage("idle"); setFaucetError(""); }}
            title="Claim free MSTC for gas fees"
            style={{
              padding: isMobile ? "5px 10px" : "6px 14px",
              background: "linear-gradient(135deg,#ff2f5e,#ff6b35)",
              border: "none",
              borderRadius: 20,
              color: "#fff",
              fontFamily: "'Rajdhani',sans-serif",
              fontWeight: 700,
              fontSize: isMobile ? 10 : 12,
              cursor: "pointer",
              display: "flex", alignItems: "center", gap: 5,
              boxShadow: "0 0 18px rgba(255,47,94,0.35)",
              transition: "all 0.2s",
              whiteSpace: "nowrap",
            }}
          >
            ⛽ {isMobile ? "Free Gas" : "Claim 0.1 MSTC"}
          </button>
        )}

        {/* Wallet button */}
        {!isMobile && (
          isConnected ? (
            <button
              onClick={copyAddress}
              title={copied ? "Copied!" : "Click to copy address"}
              style={{
                padding: "6px 13px",
                background: copied ? "rgba(0,255,136,0.12)" : "rgba(123,47,255,0.1)",
                border: copied ? "1px solid rgba(0,255,136,0.45)" : "1px solid rgba(123,47,255,0.28)",
                borderRadius: 6, color: copied ? "#00FF88" : "#a67fff",
                fontSize: 11, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 7,
                fontFamily: "'Rajdhani',sans-serif", fontWeight: 700,
                transition: "all 0.2s",
                boxShadow: copied ? "0 0 14px rgba(0,255,136,0.2)" : "none",
              }}
              onMouseEnter={e => { if (!copied) { e.currentTarget.style.borderColor = "rgba(123,47,255,0.55)"; e.currentTarget.style.boxShadow = "0 0 14px rgba(123,47,255,0.25)"; } }}
              onMouseLeave={e => { if (!copied) { e.currentTarget.style.borderColor = "rgba(123,47,255,0.28)"; e.currentTarget.style.boxShadow = "none"; } }}
            >
              {/* copy icon */}
              {copied
                ? <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6.5L4.5 9L10 3" stroke="#00FF88" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                : <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="4" y="1" width="7" height="8" rx="1.2" stroke="#a67fff" strokeWidth="1.2"/><rect x="1" y="3.5" width="7" height="8" rx="1.2" stroke="#a67fff" strokeWidth="1.2" fill="rgba(123,47,255,0.08)"/></svg>
              }
              <span style={{ fontFamily: "monospace", fontSize: 10, color: copied ? "#00FF88" : "#b8a8e0" }}>
                {copied ? "Copied!" : shortAddress(address)}
              </span>
            </button>
          ) : (
            <button onClick={handleConnect} style={{ padding: "7px 18px", background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 6, color: "#fff", fontSize: 12, cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: "0.5px", boxShadow: "0 0 16px rgba(123,47,255,0.35)", transition: "all 0.2s" }}
              onMouseEnter={e => { e.currentTarget.style.background = "linear-gradient(135deg,#8f44ff,#6b2fe8)"; e.currentTarget.style.boxShadow = "0 0 24px rgba(123,47,255,0.55)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "linear-gradient(135deg,#7B2FFF,#5a1fd4)"; e.currentTarget.style.boxShadow = "0 0 16px rgba(123,47,255,0.35)"; }}
            >
              Connect Wallet
            </button>
          )
        )}

        {/* Mobile: wallet icon + hamburger */}
        {isMobile && (
          <>
            {!isConnected && (
              <button onClick={handleConnect} style={{ padding: "6px 12px", background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 6, color: "#fff", fontSize: 11, cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700 }}>
                Connect
              </button>
            )}

            {/* Hamburger */}
            <div ref={menuRef} style={{ position: "relative" }}>
              <button onClick={() => setMenuOpen(p => !p)} style={{ width: 36, height: 36, background: "rgba(123,47,255,0.08)", border: "1px solid rgba(123,47,255,0.2)", borderRadius: 7, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: 0 }}>
                <span style={{ width: 16, height: 1.5, background: menuOpen ? "#7B2FFF" : "#a67fff", borderRadius: 2, transition: "all 0.2s", transform: menuOpen ? "rotate(45deg) translate(4px, 4px)" : "none" }} />
                <span style={{ width: 16, height: 1.5, background: menuOpen ? "transparent" : "#a67fff", borderRadius: 2, transition: "all 0.2s" }} />
                <span style={{ width: 16, height: 1.5, background: menuOpen ? "#7B2FFF" : "#a67fff", borderRadius: 2, transition: "all 0.2s", transform: menuOpen ? "rotate(-45deg) translate(4px, -4px)" : "none" }} />
              </button>

              {/* Mobile menu dropdown */}
              {menuOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: "#0e0c1a", border: "1px solid rgba(123,47,255,0.2)", borderRadius: 12, overflow: "hidden", minWidth: 200, boxShadow: "0 16px 40px rgba(0,0,0,0.9)", zIndex: 200 }}>
                  {navLinks.map(({ label, path }, i) => (
                    <div key={label} onClick={() => { navigate(path); setMenuOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", fontSize: 13, cursor: "pointer", borderBottom: i < navLinks.length - 1 ? "1px solid rgba(123,47,255,0.07)" : "none", background: isActive(path) ? "rgba(123,47,255,0.14)" : "transparent", color: isActive(path) ? "#c4a0ff" : "#9a8fc2", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, transition: "background 0.15s" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(123,47,255,0.1)"; e.currentTarget.style.color = "#c4a0ff"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = isActive(path) ? "rgba(123,47,255,0.14)" : "transparent"; e.currentTarget.style.color = isActive(path) ? "#c4a0ff" : "#9a8fc2"; }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: isActive(path) ? "#7B2FFF" : "#544a70", boxShadow: isActive(path) ? "0 0 6px #7B2FFF" : "none", flexShrink: 0 }} />
                      {label}
                    </div>
                  ))}
                  {isConnected && (
                    <div
                      onClick={copyAddress}
                      title={copied ? "Copied!" : "Tap to copy address"}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 16px", fontSize: 12, cursor: "pointer", borderTop: "1px solid rgba(123,47,255,0.12)", background: copied ? "rgba(0,255,136,0.08)" : "transparent", color: copied ? "#00FF88" : "#b8a8e0", fontFamily: "monospace", transition: "background 0.15s" }}
                    >
                      <span>{copied ? "Copied!" : shortAddress(address)}</span>
                      <span style={{ fontSize: 10, color: copied ? "#00FF88" : "#8866cc", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: "0.5px" }}>{copied ? "✓" : "COPY"}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </nav>

      {/* ── ⛽ GAS FAUCET PANEL — X login + staged animations ────────── */}
      {faucetPanel && (
        <>
          <style>{`
            @keyframes fpModalIn    { from{opacity:0;transform:scale(0.92) translateY(10px)} to{opacity:1;transform:scale(1) translateY(0)} }
            @keyframes fpBgIn       { from{opacity:0} to{opacity:1} }
            @keyframes fpArrowSlide { 0%{transform:translateX(-5px);opacity:0.3} 50%{transform:translateX(5px);opacity:1} 100%{transform:translateX(-5px);opacity:0.3} }
            @keyframes fpPulseRing  { 0%{box-shadow:0 0 0 0 rgba(29,161,242,0.5)} 70%{box-shadow:0 0 0 16px rgba(29,161,242,0)} 100%{box-shadow:0 0 0 0 rgba(29,161,242,0)} }
            @keyframes fpDropIn     { 0%{transform:translateY(-24px) scale(0.4);opacity:0} 60%{transform:translateY(3px) scale(1.15)} 100%{transform:translateY(0) scale(1);opacity:1} }
            @keyframes fpSpin       { from{transform:rotate(0)} to{transform:rotate(360deg)} }
            @keyframes fpGradFlow   { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
            @keyframes fpFloat      { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
            .fp-x-btn { transition: transform 0.15s, box-shadow 0.15s, filter 0.15s; }
            .fp-x-btn:hover { transform: translateY(-2px); filter: brightness(1.1); box-shadow: 0 6px 22px rgba(29,161,242,0.4); }
            .fp-grad-title {
              background: linear-gradient(90deg,#ff2f5e,#ff6b35,#ffb800,#ff2f5e);
              background-size: 300% auto;
              -webkit-background-clip: text; background-clip: text;
              -webkit-text-fill-color: transparent;
              animation: fpGradFlow 5s linear infinite;
            }
          `}</style>

          {/* backdrop */}
          <div
            onClick={() => { if (faucetStage === "idle" || faucetStage === "error" || faucetStage === "success") setFaucetPanel(false); }}
            style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(4,3,10,0.82)", backdropFilter: "blur(10px)", animation: "fpBgIn 0.25s ease" }}
          />

          {/* panel */}
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            zIndex: 3001, width: "min(400px, 92vw)",
            background: "linear-gradient(160deg,#141021,#0d0a17)",
            border: "1px solid rgba(255,47,94,0.25)", borderRadius: 22,
            overflow: "hidden", animation: "fpModalIn 0.35s cubic-bezier(0.34,1.56,0.64,1)",
            boxShadow: "0 20px 70px rgba(0,0,0,0.6), 0 0 40px rgba(255,47,94,0.12)",
            fontFamily: "'Rajdhani',sans-serif",
          }}>
            {/* top gradient bar */}
            <div style={{ height: 3, background: "linear-gradient(90deg,#ff2f5e,#ff6b35,#ffb800)" }} />

            {/* close */}
            {(faucetStage === "idle" || faucetStage === "error" || faucetStage === "success") && (
              <button onClick={() => setFaucetPanel(false)} style={{ position: "absolute", top: 14, right: 14, width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#aaa", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>✕</button>
            )}

            <div style={{ padding: "34px 30px 30px", textAlign: "center" }}>

              {/* ═══ STAGE: IDLE ═══ */}
              {faucetStage === "idle" && (
                <>
                  <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg,#ff2f5e,#ff6b35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, margin: "0 auto 18px", boxShadow: "0 0 26px rgba(255,47,94,0.4)", animation: "fpFloat 3s ease-in-out infinite" }}>⛽</div>
                  <div className="fp-grad-title" style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Claim Free Gas</div>
                  <div style={{ fontSize: 13, color: "#b8b0d0", lineHeight: 1.6, marginBottom: 24 }}>
                    Get <b style={{ color: "#ff8f5e" }}>0.1 MSTC</b> to cover gas fees.<br />
                    Login with X to verify — one claim per account.
                  </div>

                  {faucetError && (
                    <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.25)", borderRadius: 10, fontSize: 12, color: "#ff8080" }}>{faucetError}</div>
                  )}

                  <button className="fp-x-btn" onClick={handleClaimGas} style={{
                    width: "100%", padding: "14px 20px",
                    background: "#1da1f2", border: "none", borderRadius: 13,
                    color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 11,
                  }}>
                    <div style={{ width: 26, height: 26, borderRadius: 7, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#1da1f2", fontSize: 15, fontWeight: 900 }}>𝕏</div>
                    Login with X to Claim
                  </button>

                  <div style={{ marginTop: 16, fontSize: 11, color: "#7a6fa0" }}>🔒 No spam · No data sold · One-time verification</div>
                </>
              )}

              {/* ═══ STAGE: REDIRECTING TO X ═══ */}
              {faucetStage === "redirecting" && (
                <div style={{ padding: "18px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginBottom: 26 }}>
                    {/* ArcadeX orb */}
                    <div style={{ width: 52, height: 52, borderRadius: "50%", background: "linear-gradient(135deg,#7B2FFF,#a67fff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>🎮</div>
                    {/* arrow */}
                    <div style={{ fontSize: 22, color: "#1da1f2", animation: "fpArrowSlide 1s ease-in-out infinite", margin: "0 4px" }}>→</div>
                    {/* X badge with pulse */}
                    <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#1da1f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 900, color: "#fff", flexShrink: 0, animation: "fpPulseRing 1.4s ease-out infinite" }}>𝕏</div>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 6 }}>Redirecting to X</div>
                  <div style={{ fontSize: 13, color: "#b8b0d0" }}>Complete login in the popup window…</div>
                </div>
              )}

              {/* ═══ STAGE: CLAIMING ═══ */}
              {faucetStage === "claiming" && (
                <div style={{ padding: "18px 0" }}>
                  <div style={{ width: 66, height: 66, margin: "0 auto 22px", position: "relative" }}>
                    <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "3px solid rgba(255,47,94,0.15)", borderTopColor: "#ff2f5e", animation: "fpSpin 0.8s linear infinite" }} />
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>⛽</div>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 6 }}>Claiming 0.1 MSTC</div>
                  <div style={{ fontSize: 13, color: "#b8b0d0" }}>Sending to your wallet on-chain…</div>
                </div>
              )}

              {/* ═══ STAGE: SUCCESS ═══ */}
              {faucetStage === "success" && (
                <div style={{ padding: "14px 0" }}>
                  <div style={{ width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg,#00c853,#00e676)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 20px", animation: "fpDropIn 0.5s cubic-bezier(0.34,1.56,0.64,1)", boxShadow: "0 0 30px rgba(0,230,118,0.4)" }}>✓</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#00e676", marginBottom: 8 }}>Gas Claimed!</div>
                  <div style={{ fontSize: 14, color: "#b8b0d0" }}><b style={{ color: "#00e676" }}>0.1 MSTC</b> is now in your wallet.</div>
                </div>
              )}

              {/* ═══ STAGE: ERROR ═══ */}
              {faucetStage === "error" && (
                <div style={{ padding: "14px 0" }}>
                  <div style={{ width: 66, height: 66, borderRadius: "50%", background: "rgba(255,68,68,0.12)", border: "2px solid rgba(255,68,68,0.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, margin: "0 auto 18px" }}>⚠️</div>
                  <div style={{ fontSize: 19, fontWeight: 700, color: "#ff6b6b", marginBottom: 8 }}>Couldn't Claim</div>
                  <div style={{ fontSize: 13, color: "#b8b0d0", marginBottom: 22, lineHeight: 1.5 }}>{faucetError || "Something went wrong."}</div>
                  <button onClick={() => { setFaucetStage("idle"); setFaucetError(""); }} style={{ width: "100%", padding: "13px", background: "linear-gradient(135deg,#ff2f5e,#ff6b35)", border: "none", borderRadius: 12, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Rajdhani',sans-serif" }}>Try Again</button>
                </div>
              )}

            </div>
          </div>
        </>
      )}

      {/* ── EARNINGS PANEL — Premium Design ──────────────────────── */}
      {earningsOpen && (
        <>
          <style>{`
            @keyframes slideInRight  { from{opacity:0;transform:translateX(32px)} to{opacity:1;transform:translateX(0)} }
            @keyframes fadeInBg      { from{opacity:0} to{opacity:1} }
            @keyframes rowIn         { from{opacity:0;transform:translateX(16px)} to{opacity:1;transform:translateX(0)} }
            @keyframes shimmer       { 0%{background-position:-400px 0} 100%{background-position:400px 0} }
            @keyframes spinLoad      { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
            @keyframes gradPulse     { 0%,100%{opacity:1} 50%{opacity:0.6} }
            .earn-row { transition: background 0.15s, transform 0.15s !important; }
            .earn-row:hover { background: rgba(123,47,255,0.1) !important; transform: translateX(3px) !important; }
            .close-btn:hover { background: rgba(255,68,68,0.15) !important; border-color: rgba(255,68,68,0.4) !important; color: #ff6b6b !important; }
            .tx-link:hover { color: #00d4ff !important; }
          `}</style>

          {/* Backdrop */}
          <div onClick={() => setEarningsOpen(false)}
            style={{ position:"fixed", inset:0, zIndex:998, background:"rgba(0,0,0,0.7)", backdropFilter:"blur(8px)", animation:"fadeInBg 0.2s ease" }} />

          {/* Panel */}
          <div style={{
            position:"fixed", top:0, right:0, bottom:0, zIndex:999,
            width: isMobile ? "100vw" : 400,
            background: "linear-gradient(180deg, #0c0a1e 0%, #08070f 100%)",
            borderLeft: "1px solid rgba(123,47,255,0.2)",
            boxShadow: "-40px 0 100px rgba(0,0,0,0.9), -1px 0 0 rgba(123,47,255,0.15)",
            animation: "slideInRight 0.3s cubic-bezier(0.34,1.4,0.64,1)",
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}>

            {/* Animated rainbow top bar */}
            <div style={{ height:3, flexShrink:0, background:"linear-gradient(90deg,#7B2FFF,#00d4ff,#00FF88,#FFB700,#7B2FFF)", backgroundSize:"300% 100%", animation:"gradPulse 3s ease infinite" }} />

            {/* Ambient glow orbs */}
            <div style={{ position:"absolute", top:-80, right:-80, width:240, height:240, background:"radial-gradient(circle,rgba(123,47,255,0.12) 0%,transparent 65%)", borderRadius:"50%", pointerEvents:"none" }} />
            <div style={{ position:"absolute", bottom:-60, left:-60, width:180, height:180, background:"radial-gradient(circle,rgba(0,212,255,0.07) 0%,transparent 65%)", borderRadius:"50%", pointerEvents:"none" }} />

            {/* ── HEADER ── */}
            <div style={{ padding:"20px 22px 16px", borderBottom:"1px solid rgba(255,255,255,0.05)", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0, position:"relative" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <div style={{ width:38, height:38, borderRadius:12, background:"linear-gradient(135deg,rgba(123,47,255,0.3),rgba(0,212,255,0.15))", border:"1px solid rgba(123,47,255,0.4)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, boxShadow:"0 0 20px rgba(123,47,255,0.2)" }}>
                  📊
                </div>
                <div>
                  <div style={{ fontFamily:"'Orbitron',sans-serif", fontWeight:700, fontSize:14, color:"#fff", letterSpacing:"0.5px" }}>Earning History</div>
                  <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:11, color:"rgba(123,47,255,0.7)", marginTop:1, letterSpacing:"1px" }}>
                    {address?.slice(0,6)}...{address?.slice(-4)} · {rewardToken||"ARCADE"}
                  </div>
                </div>
              </div>
              <button className="close-btn" onClick={() => setEarningsOpen(false)}
                style={{ width:32, height:32, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, color:"rgba(255,255,255,0.5)", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.2s" }}>
                ✕
              </button>
            </div>

                {/* ── TOTAL BALANCE CARD ── */}
            <div style={{ margin:"16px 16px 0", flexShrink:0 }}>
              {(() => {
                // Total earned — only current chain's plays
                const totalEarned = chainFiltered.reduce((sum, s) => {
                  // Use actual saved earned if > 0, else fallback with on-chain playerShare
                  if (s.earned != null && Number(s.earned) > 0) return sum + Number(s.earned);
                  const g = gameMap[s.gameId] || {};
                  const rate = isCurrentMst ? (g.rewardRateNative || 1) : (g.rewardRate || 50);
                  return sum + Math.round(rate * playerShareForEarnings / 100 * 100) / 100;
                }, 0);
                const earnSymbol = rewardToken || "ARCADE";
                const earnColor  = isCurrentMst ? "#ff2f5e" : "#00d4ff";
                return (
              <div style={{ borderRadius:16, padding:"18px 20px", position:"relative", overflow:"hidden", background:"linear-gradient(135deg,rgba(123,47,255,0.18) 0%,rgba(0,212,255,0.06) 100%)", border:"1px solid rgba(123,47,255,0.25)", boxShadow:"0 8px 32px rgba(123,47,255,0.12), inset 0 1px 0 rgba(255,255,255,0.05)" }}>
                <div style={{ position:"absolute", top:0, left:0, right:0, height:"50%", background:"linear-gradient(180deg,rgba(255,255,255,0.03) 0%,transparent 100%)", borderRadius:"16px 16px 0 0", pointerEvents:"none" }} />

                {/* Current Balance */}
                <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:10, color:"rgba(0,212,255,0.7)", textTransform:"uppercase", letterSpacing:"2px", marginBottom:6, fontWeight:700 }}>Current Balance</div>
                <div style={{ display:"flex", alignItems:"flex-end", gap:8, marginBottom:14 }}>
                  <span style={{ fontFamily:"'Orbitron',sans-serif", fontWeight:700, fontSize:34, color:"#fff", lineHeight:1, textShadow:"0 0 30px rgba(123,47,255,0.5)" }}>
                    {Number(balance).toLocaleString()}
                  </span>
                  <span style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:14, color:"rgba(0,212,255,0.8)", marginBottom:4 }}>{earnSymbol}</span>
                </div>

                {/* Total Earned — current chain only */}
                <div style={{ borderTop:"1px solid rgba(255,255,255,0.07)", paddingTop:12, marginBottom:14 }}>
                  <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:10, color:"rgba(255,255,255,0.3)", textTransform:"uppercase", letterSpacing:"1.5px", marginBottom:8, fontWeight:700 }}>Total Earned (Est.)</div>
                  {earningsLoading ? (
                    <div style={{ height:32, borderRadius:20, background:"rgba(255,255,255,0.05)", width:120, animation:"shimmer 1.4s infinite" }} />
                  ) : (
                    <div style={{ display:"inline-flex", alignItems:"baseline", gap:6, padding:"6px 14px", background:`${earnColor}10`, border:`1px solid ${earnColor}30`, borderRadius:20 }}>
                      <span style={{ fontFamily:"'Orbitron',sans-serif", fontWeight:700, fontSize:16, color: earnColor }}>
                        {isCurrentMst ? totalEarned.toFixed(2) : totalEarned.toLocaleString()}
                      </span>
                      <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:11, color:`${earnColor}80`, fontWeight:700 }}>{earnSymbol}</span>
                    </div>
                  )}
                </div>

                {/* Stats row */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                  {[
                    { label:"Plays", val: earningsLoading ? "—" : chainFiltered.length, color:"#00FF88" },
                    { label:"Games", val: earningsLoading ? "—" : new Set(chainFiltered.map(s=>s.gameId)).size, color:"#00d4ff" },
                    { label:"Days", val: earningsLoading ? "—" : Object.keys(groupByDay(chainFiltered)).length, color:"#FFB700" },
                  ].map(({ label, val, color }) => (
                    <div key={label} style={{ background:"rgba(0,0,0,0.25)", borderRadius:10, padding:"8px 10px", textAlign:"center", border:"1px solid rgba(255,255,255,0.05)" }}>
                      <div style={{ fontFamily:"'Orbitron',sans-serif", fontWeight:700, fontSize:18, color, lineHeight:1, marginBottom:4 }}>{val}</div>
                      <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:9, color:"rgba(255,255,255,0.35)", textTransform:"uppercase", letterSpacing:"0.5px" }}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>
                );
              })()}
            </div>

            {/* ── DAY-WISE LIST ── */}
            <div style={{ flex:1, overflowY:"auto", padding:"14px 0 8px", scrollbarWidth:"none" }}>
              {earningsLoading ? (
                // Skeleton shimmer
                <div style={{ padding:"0 16px", display:"flex", flexDirection:"column", gap:10 }}>
                  {[1,2,3,4].map(i => (
                    <div key={i} style={{ height:64, borderRadius:14, background:"linear-gradient(90deg,rgba(123,47,255,0.06) 25%,rgba(123,47,255,0.12) 50%,rgba(123,47,255,0.06) 75%)", backgroundSize:"400px 100%", animation:"shimmer 1.4s infinite", animationDelay:`${i*0.1}s` }} />
                  ))}
                </div>
              ) : chainFiltered.length === 0 ? (
                <div style={{ textAlign:"center", padding:"50px 24px" }}>
                  <div style={{ fontSize:48, marginBottom:14, filter:"drop-shadow(0 0 20px rgba(123,47,255,0.4))" }}>🎮</div>
                  <div style={{ fontFamily:"'Orbitron',sans-serif", fontWeight:700, fontSize:13, color:"rgba(255,255,255,0.4)", letterSpacing:"0.5px" }}>No plays yet</div>
                  <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:12, color:"rgba(123,47,255,0.5)", marginTop:6 }}>Start playing to earn {rewardToken||"ARCADE"}</div>
                </div>
              ) : (
                Object.entries(groupByDay(chainFiltered)).map(([date, plays], dayIdx) => (
                  <div key={date} style={{ marginBottom:4 }}>

                    {/* Day header chip */}
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 20px 6px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <div style={{ width:3, height:14, borderRadius:2, background:"linear-gradient(180deg,#7B2FFF,#00d4ff)" }} />
                        <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.7)", textTransform:"uppercase", letterSpacing:"1.5px" }}>{date}</span>
                      </div>
                      <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:10, color:"rgba(123,47,255,0.6)", background:"rgba(123,47,255,0.1)", padding:"2px 8px", borderRadius:20, border:"1px solid rgba(123,47,255,0.2)" }}>
                        {plays.length} play{plays.length > 1 ? "s" : ""}
                      </span>
                    </div>

                    {/* Play rows */}
                    <div style={{ padding:"0 12px", display:"flex", flexDirection:"column", gap:4 }}>
                      {plays.map((play, i) => {
                        const gInfo = gameMap[play.gameId] || {};
                        const thumb = gInfo.thumbnail;
                        const time = play.createdAt ? new Date(play.createdAt).toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", hour12:true }) : "";
                        // Earned amount — use the chain THIS play was on, not current chain
                        const playChain = (play.chain || "botchain").toLowerCase();
                        const isMstPlay = playChain === "mst";
                        const rate = isMstPlay ? (gInfo.rewardRateNative || 1) : (gInfo.rewardRate || 50);
                        // Use actual saved earned ONLY if > 0 (0 = save failed, use fallback)
                        const earned = (play.earned != null && Number(play.earned) > 0)
                          ? Number(play.earned)
                          : Math.round(rate * playerShareForEarnings / 100 * 100) / 100;
                        // Always override symbol based on chain — ignore wrong "ARCADE" on MST
                        const earnedSymbol = isMstPlay ? "MSTC" : (play.earnedSymbol || "ARCADE");
                        // Chain color
                        const chainColor = playChain === "mst" ? "#ff2f5e" : playChain === "botchain" ? "#00d4ff" : "#FFB700";
                        return (
                          <div key={play.id || i} className="earn-row"
                            onClick={() => play.txHash && window.open(`${activeChain?.explorerUrl||"https://scan.botchain.ai"}/tx/${play.txHash}`, "_blank")}
                            style={{
                              display:"flex", alignItems:"center", gap:12,
                              padding:"10px 12px", borderRadius:12, cursor: play.txHash ? "pointer" : "default",
                              background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.04)",
                              animation:`rowIn 0.3s ease both`, animationDelay:`${(dayIdx*3 + i) * 0.04}s`,
                            }}>

                            {/* Game thumbnail */}
                            <div style={{ width:44, height:44, borderRadius:10, overflow:"hidden", border:"1px solid rgba(123,47,255,0.25)", flexShrink:0, background:"linear-gradient(135deg,rgba(123,47,255,0.2),rgba(0,212,255,0.1))", position:"relative" }}>
                              {thumb ? (
                                <img src={thumb} alt={play.gameName} style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} onError={e => { e.target.style.display="none"; }} />
                              ) : (
                                <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🎮</div>
                              )}
                              {/* Shimmer on thumbnail */}
                              <div style={{ position:"absolute", inset:0, background:"linear-gradient(135deg,transparent 40%,rgba(255,255,255,0.06) 50%,transparent 60%)" }} />
                            </div>

                            {/* Info */}
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:13, color:"#e8deff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:3 }}>
                                {play.gameName || gInfo.name || `Game #${play.gameId}`}
                              </div>
                              <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                                <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:10, color:"rgba(255,255,255,0.3)" }}>Score</span>
                                <span style={{ fontFamily:"'Orbitron',sans-serif", fontSize:10, color:"#9977CC", fontWeight:700 }}>{Number(play.score||0).toLocaleString()}</span>
                                {time && <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:9, color:"rgba(255,255,255,0.2)" }}>· {time}</span>}
                                {play.chain && (
                                  <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:9, fontWeight:700, color: chainColor, background: `${chainColor}18`, padding:"1px 6px", borderRadius:4, border:`1px solid ${chainColor}40`, textTransform:"uppercase", letterSpacing:"0.5px" }}>
                                    {play.chain}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Earned + TX */}
                            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:3, flexShrink:0 }}>
                              <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
                                <span style={{ fontFamily:"'Orbitron',sans-serif", fontSize:11, fontWeight:700, color:"#00FF88" }}>+{earned}</span>
                                <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:9, color:"rgba(0,255,136,0.6)", fontWeight:700 }}>{earnedSymbol}</span>
                              </div>
                              {play.txHash && (
                                <span className="tx-link" style={{ fontFamily:"monospace", fontSize:8, color:"rgba(255,255,255,0.2)", transition:"color 0.15s" }}>
                                  {play.txHash.slice(0,6)}...↗
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* ── FOOTER ── */}
            <div style={{ padding:"12px 20px", borderTop:"1px solid rgba(255,255,255,0.06)", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
              <span style={{ fontSize:11 }}>⚡</span>
              <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:11, color:"rgba(176,136,255,0.6)", letterSpacing:"0.8px" }}>Powered by ArcadeX · On-Chain Gaming</span>
            </div>
          </div>
        </>
      )}
    </>
  );
}
