// Place at: src/components/Navbar.jsx (REPLACES existing)
import { useState, useRef, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAppKit } from "@reown/appkit/react";
import { useAccount, useConnect, useDisconnect, usePublicClient } from "wagmi";
import { injected } from "wagmi/connectors";
import { useArcadeBalance } from "../hooks/useArcadeBalance";
import { getActiveAvatarStyle } from "../utils/avatarUtils";
import { useChain } from "../context/ChainContext";
import { useFirebaseAuth } from "../hooks/useFirebaseAuth";
import { useMode } from "../hooks/useMode";
import { WEB2_ENABLED } from "../context/ModeContext";
import { useWeb2Auth } from "../hooks/useWeb2Auth";
import { useArcadeCoins } from "../hooks/useArcadeCoins";
import { Icon } from "./Icon";

const LOGO_SIZE = 28;

export default function Navbar() {
  const { open } = useAppKit();
  const { isConnected, address } = useAccount();
  const { connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const navigate = useNavigate();
  const location = useLocation();
  const { balance } = useArcadeBalance();

  // Need rewardToken to display ARCADE or MSTC dynamically
  const { chainName, clearChainSelection, rewardToken, activeChain, chainKey, contracts } = useChain();
  const publicClient = usePublicClient();

  // ── Mode + Web2 auth ──────────────────────────────────────────────────
  const { mode, clearMode: switchMode } = useMode();
  const { user: web2User, signOut: web2SignOut } = useWeb2Auth();
  const isWeb2 = mode === "web2";
  // ArcadeCoin balance for the Web2 navbar pill. Guests always see 0.
  const { balance: coinBalance, stats: coinStats } = useArcadeCoins();

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

  // Wallet menu (Copy address + Disconnect) — desktop dropdown, mobile modal
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [web2MenuOpen, setWeb2MenuOpen]     = useState(false);

  const ddRef = useRef(null);
  const menuRef = useRef(null);
  const walletMenuRef = useRef(null); // desktop wallet button + dropdown
  const web2MenuRef   = useRef(null);

  // ── Faucet: check if already claimed on MST connect ──────────────
  // SH0035 — localStorage cache to eliminate repeat MST RPC calls.
  //   • claimed=true → cached permanently per-wallet (can never revert
  //     to false; on-chain hasClaimed is monotonic)
  //   • claimed=false → cached 5 min (in case user just claimed elsewhere
  //     or a background refresh is desired)
  // Pehle Navbar mount pe har baar MST RPC hit hoti thi (~5K RPC calls/day).
  // Ab first-visit ke baad instant status from localStorage — RPC calls
  // 90%+ kam.
  useEffect(() => {
    if (!isConnected || !address || chainKey !== "mst" || isWeb2) return;

    const CACHE_KEY = `arcadex_gas_claimed_${address.toLowerCase()}`;
    const NEGATIVE_TTL_MS = 5 * 60 * 1000; // false result: 5 min

    // Check localStorage first
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.claimed === true) {
          // Permanent cache — hasClaimed monotonic, once true always true
          setFaucetClaimed(true);
          return;
        }
        if (parsed.claimed === false && parsed.at && Date.now() - parsed.at < NEGATIVE_TTL_MS) {
          // Recent false result — skip RPC, don't set state
          return;
        }
      }
    } catch { /* malformed cache, ignore and fall through to RPC */ }

    (async () => {
      try {
        const res = await fetch(`/api/games?action=check-gas-claim&address=${address}`);
        const data = await res.json();
        // Cache the result — both true and false, with timestamp
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({
            claimed: !!data.claimed,
            at: Date.now(),
          }));
        } catch { /* quota, private mode — silent */ }
        if (data.claimed) setFaucetClaimed(true);
      } catch (e) { /* silent fail */ }
    })();
  }, [isConnected, address, chainKey, isWeb2]);

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
        // SH0035 — persist to localStorage so future Navbar mounts skip
        // the MST RPC check-gas-claim call entirely. hasClaimed is
        // monotonic on-chain (never reverts), so caching true forever is safe.
        try {
          localStorage.setItem(`arcadex_gas_claimed_${address.toLowerCase()}`, JSON.stringify({
            claimed: true, at: Date.now(),
          }));
        } catch { /* quota, private mode — silent */ }
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
  // 1. Agar MetaMask available hai → directly wagmi injected connector use karo
  //    with correct chainId. AppKit ka open() internally BOTChain (networks[0])
  //    pe switchChain call karta hai — yeh bypass karta hai woh problem.
  // 2. Agar MetaMask nahi (mobile/WalletConnect) → AppKit open() fallback.
  const handleConnect = async () => {
    if (!activeChain) { open(); return; }

    if (window.ethereum) {
      const chainIdHex = "0x" + activeChain.chainId.toString(16);

      // Step 1: Pehle MetaMask mein correct chain ensure karo
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chainIdHex }],
        });
      } catch (switchErr) {
        if (switchErr.code === 4902 || switchErr.code === -32603) {
          try {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId: chainIdHex,
                chainName: activeChain.name,
                rpcUrls: [activeChain.rpcUrl],
                nativeCurrency: activeChain.nativeCurrency,
                blockExplorerUrls: activeChain.explorerUrl ? [activeChain.explorerUrl] : [],
              }],
            });
          } catch (_) { open(); return; } // user rejected add → AppKit fallback
        } else if (switchErr.code === 4001) {
          return; // user rejected switch → do nothing
        }
      }

      // Step 2: Ab wagmi ko directly connect karo injected connector se.
      try {
        await connectAsync({
          connector: injected(),
          chainId: activeChain.chainId,
        });
      } catch (connErr) {
        if (!connErr?.message?.includes("Already connected")) {
          console.warn("connectAsync failed, falling back to AppKit:", connErr.message);
          open(); // last resort fallback
        }
      }
    } else {
      // No MetaMask (mobile browser, WalletConnect etc.) → AppKit handle kare
      open();
    }
  };

  // ── Disconnect: wagmi disconnect + clear JWT (chain preserved) ────────
  const handleDisconnect = () => {
    try {
      localStorage.removeItem("arcadex_jwt");
    } catch { /* private mode — silent */ }
    try {
      disconnect();
    } catch (e) {
      console.warn("Disconnect failed:", e);
    }
    setWalletMenuOpen(false);
    setMenuOpen(false);
    setEarningsOpen(false);
  };

  // ── Web2: sign out current user, keep mode = web2 (login screen reappears)
  const handleWeb2SignOut = async () => {
    try { await web2SignOut(); } catch (e) { console.warn("Web2 sign-out:", e); }
    setWeb2MenuOpen(false);
    setMenuOpen(false);
  };

  // ── Mode switch: clear mode so ModeSelector reappears ─────────────────
  const handleSwitchMode = () => {
    switchMode();
    setDdOpen(false);
    setMenuOpen(false);
    setWalletMenuOpen(false);
    setWeb2MenuOpen(false);
  };

  const shortAddress = (addr) => addr ? addr.slice(0, 5) + "..." + addr.slice(-3) : "";
  const isActive = (path) => location.pathname === path;
  const avatarUrl = address
    ? `https://api.dicebear.com/9.x/${avatarStyle}/svg?seed=${address}`
    : null;

  // Web2 avatar — use OAuth photoURL if present, else dicebear from uid
  const web2AvatarUrl = web2User
    ? (web2User.photoURL || `https://api.dicebear.com/9.x/bottts/svg?seed=${web2User.uid}`)
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
      // Desktop wallet menu — mobile uses modal with its own backdrop
      if (!isMobile && walletMenuRef.current && !walletMenuRef.current.contains(e.target)) {
        setWalletMenuOpen(false);
      }
      if (!isMobile && web2MenuRef.current && !web2MenuRef.current.contains(e.target)) {
        setWeb2MenuOpen(false);
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [isMobile]);

  useEffect(() => { setMenuOpen(false); setWalletMenuOpen(false); setWeb2MenuOpen(false); }, [location.pathname]);

  // Auto-close wallet menu if wallet disconnects externally
  useEffect(() => {
    if (!isConnected) setWalletMenuOpen(false);
  }, [isConnected]);

  // ── Earnings fetch ───────────────────────────────────────────────────
  const fetchEarnings = async () => {
    if (!address) return;
    setEarningsLoading(true);
    try {
      const token = localStorage.getItem("arcadex_jwt");
      const [scoresRes, gamesRes] = await Promise.all([
        token
          ? fetch(`/api/games?action=user-scores`, { headers: { Authorization: `Bearer ${token}` } })
          : Promise.resolve({ json: async () => ({ scores: [] }) }),
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

      const mine = (scoresData.scores || [])
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

  // Web2 mode: Tournaments & Creators are Firestore-backed showcases;
  // Marketplace remains Web3-only.
  const navLinks = isWeb2
    ? [
        { label: "Home", path: "/" },
        { label: "Games", path: "/games" },
        { label: "Tournaments", path: "/tournaments" },
        { label: "Creators", path: "/publish" },
        { label: "AI Studio", path: "/studio" },
        { label: "Leaderboard", path: "/leaderboard" },
        { label: "Support", path: "/support" }
      ]
    : [
        { label: "Home", path: "/" },
        { label: "Games", path: "/games" },
        { label: "Leaderboard", path: "/leaderboard" },
        { label: "Tournaments", path: "/tournaments" },
        { label: "Marketplace", path: "/marketplace" },
        { label: "Creators", path: "/publish" },
        { label: "AI Studio", path: "/studio" },
        { label: "Support", path: "/support" }
      ];

  // ── Wallet menu items (shared by desktop dropdown + mobile modal) ─────
  const renderWalletMenuActions = () => (
    <>
      <button
        onClick={() => { copyAddress(); }}
        style={{
          width: "100%", padding: "12px 14px",
          background: copied ? "rgba(0,255,136,0.12)" : "rgba(123,47,255,0.08)",
          border: copied ? "1px solid rgba(0,255,136,0.45)" : "1px solid rgba(123,47,255,0.25)",
          borderRadius: 10, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 10,
          fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 13,
          color: copied ? "#00FF88" : "#c4a0ff",
          transition: "all 0.15s",
          justifyContent: "flex-start",
        }}
        onMouseEnter={e => { if (!copied) { e.currentTarget.style.background = "rgba(123,47,255,0.16)"; e.currentTarget.style.borderColor = "rgba(123,47,255,0.5)"; } }}
        onMouseLeave={e => { if (!copied) { e.currentTarget.style.background = "rgba(123,47,255,0.08)"; e.currentTarget.style.borderColor = "rgba(123,47,255,0.25)"; } }}
      >
        {copied
          ? <svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M2 6.5L4.5 9L10 3" stroke="#00FF88" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          : <svg width="14" height="14" viewBox="0 0 12 12" fill="none"><rect x="4" y="1" width="7" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="3.5" width="7" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.2" fill="rgba(123,47,255,0.08)"/></svg>
        }
        <span>{copied ? "Address copied!" : "Copy Address"}</span>
      </button>

      <button
        onClick={handleDisconnect}
        style={{
          width: "100%", padding: "12px 14px",
          background: "rgba(255,68,88,0.08)",
          border: "1px solid rgba(255,68,88,0.28)",
          borderRadius: 10, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 10,
          fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 13,
          color: "#ff6b7f",
          transition: "all 0.15s",
          justifyContent: "flex-start",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,68,88,0.16)"; e.currentTarget.style.borderColor = "rgba(255,68,88,0.55)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,68,88,0.08)"; e.currentTarget.style.borderColor = "rgba(255,68,88,0.28)"; }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M6 2H3.5C2.67 2 2 2.67 2 3.5V10.5C2 11.33 2.67 12 3.5 12H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          <path d="M9 4L12 7L9 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M12 7H5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        <span>Disconnect Wallet</span>
      </button>
    </>
  );

  // ── Web2 user menu actions (switch mode + sign out) ───────────────────
  const renderWeb2MenuActions = () => (
    <>
      <button
        onClick={handleSwitchMode}
        style={{
          width: "100%", padding: "12px 14px",
          background: "rgba(123,47,255,0.08)",
          border: "1px solid rgba(123,47,255,0.25)",
          borderRadius: 10, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 10,
          fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 13,
          color: "#c4a0ff",
          transition: "all 0.15s",
          justifyContent: "flex-start",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(123,47,255,0.16)"; e.currentTarget.style.borderColor = "rgba(123,47,255,0.5)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "rgba(123,47,255,0.08)"; e.currentTarget.style.borderColor = "rgba(123,47,255,0.25)"; }}
      >
        <Icon name="exchange" size={14} />
        <span>Switch to Web3 Mode</span>
      </button>

      <button
        onClick={handleWeb2SignOut}
        style={{
          width: "100%", padding: "12px 14px",
          background: "rgba(255,68,88,0.08)",
          border: "1px solid rgba(255,68,88,0.28)",
          borderRadius: 10, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 10,
          fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 13,
          color: "#ff6b7f",
          transition: "all 0.15s",
          justifyContent: "flex-start",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,68,88,0.16)"; e.currentTarget.style.borderColor = "rgba(255,68,88,0.55)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,68,88,0.08)"; e.currentTarget.style.borderColor = "rgba(255,68,88,0.28)"; }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M6 2H3.5C2.67 2 2 2.67 2 3.5V10.5C2 11.33 2.67 12 3.5 12H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          <path d="M9 4L12 7L9 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M12 7H5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        <span>Sign Out</span>
      </button>
    </>
  );

  // ── Mode badge next to logo ───────────────────────────────────────────
  const ModeBadge = () => {
    if (!mode) return null;
    const isWeb2Badge = mode === "web2";
    const color = isWeb2Badge ? "#00d4ff" : "#a67fff";
    const label = isWeb2Badge ? "WEB2" : "WEB3";
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "2px 7px",
        background: `${color}14`,
        border: `1px solid ${color}40`,
        borderRadius: 4,
        fontSize: 9, fontWeight: 800, letterSpacing: "0.8px",
        color: color, fontFamily: "'Rajdhani',sans-serif",
        marginLeft: 4,
      }}>
        <span style={{ width: 4, height: 4, borderRadius: "50%", background: color, boxShadow: `0 0 4px ${color}` }} />
        {label}
      </div>
    );
  };

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

      {/* 1. LOGO + MODE BADGE */}
      <div ref={ddRef} style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <div onClick={() => isMobile ? navigate("/") : setDdOpen(p => !p)} style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", userSelect: "none" }}>

          <img src="/IA-logo.webp" alt="ArcadeX Logo" style={{ width: 30, height: 30, objectFit: "contain", filter: "drop-shadow(0 0 12px rgba(150,80,255,0.9)) drop-shadow(0 0 22px rgba(0,212,255,0.35))" }} />

          <span style={{ fontSize: 14.5, fontWeight: 800, color: "#fff", fontFamily: "'Rajdhani',sans-serif", letterSpacing: "0.6px", background: "linear-gradient(90deg,#fff,#d8bfff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>ArcadeX</span>

          <ModeBadge />

          {!isMobile && (
            <svg width="9" height="9" viewBox="0 0 9 9" style={{ opacity: 0.3, transform: ddOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s", marginLeft: 2 }}>
              <path d="M1.5 3L4.5 6L7.5 3" stroke="#fff" strokeWidth="1.2" fill="none" strokeLinecap="round" />
            </svg>
          )}
        </div>

        {/* Desktop dropdown */}
        {!isMobile && (
          <div style={{
            position: "absolute", top: "calc(100% + 8px)", left: 0,
            background: "#0e0c1a", border: "1px solid rgba(123,47,255,0.2)",
            borderRadius: 8, overflow: "hidden", minWidth: 160,
            boxShadow: "0 16px 40px rgba(0,0,0,0.8)",
            opacity: ddOpen ? 1 : 0, pointerEvents: ddOpen ? "all" : "none",
            transform: ddOpen ? "translateY(0)" : "translateY(-6px)",
            transition: "opacity 0.16s, transform 0.16s",
          }}>
            {(isWeb2
              ? [
                  { label: "Games", path: "/games", color: "#00d4ff" },
                  { label: "Tournaments", path: "/tournaments", color: "#FFB700" },
                  { label: "Creators", path: "/publish", color: "#c4a0ff" },
                  { label: "Leaderboard", path: "/leaderboard", color: "#00FF88" },
                ]
              : [
                  { label: "Games", path: "/games", color: "#a67fff" },
                  { label: "Tournaments", path: "/tournaments", color: "#FFB700" },
                  { label: "Marketplace", path: "/marketplace", color: "#00FF88" },
                  { label: "Creators", path: "/publish", color: "#00d4ff" },
                ]
            ).map(({ label, path, color }) => (
              <div key={label} onClick={() => { navigate(path); setDdOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", fontSize: 12, cursor: "pointer", borderBottom: "1px solid rgba(123,47,255,0.08)", color: isActive(path) ? color : "#9a8fc2", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: "0.3px", transition: "background 0.15s, color 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(123,47,255,0.08)"; e.currentTarget.style.color = color; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = isActive(path) ? color : "#9a8fc2"; }}
              >
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: isActive(path) ? color : "#544a70", boxShadow: isActive(path) ? `0 0 6px ${color}` : "none" }} />
                {label}
              </div>
            ))}

            {WEB2_ENABLED && <div
              onClick={handleSwitchMode}
              style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", fontSize: 12, cursor: "pointer", color: "#ff8bb4", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: "0.3px", transition: "background 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,47,94,0.08)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
              <Icon name="exchange" size={11} />
              Switch Mode
            </div>}
          </div>
        )}
      </div>

      {/* Desktop Nav Links */}
      {!isMobile && (
        <div style={{ display: "flex", gap: 4 }}>
          {navLinks.map(({ label, path }) => (
            <Link
              key={label}
              to={path}
              style={{
                position: "relative", padding: "8px 18px", borderRadius: 7,
                color: isActive(path) ? "#fff" : "#c0b8e0",
                background: isActive(path)
                  ? "linear-gradient(135deg, rgba(123,47,255,0.22), rgba(0,212,255,0.08))"
                  : "transparent",
                fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: "0.4px",
                textDecoration: "none",
                transition: "color 0.25s, background 0.25s, transform 0.2s, box-shadow 0.3s",
                textShadow: isActive(path) ? "0 0 10px rgba(123,47,255,0.6)" : "none",
                boxShadow: isActive(path) ? "inset 0 0 20px rgba(123,47,255,0.1)" : "none",
                display: "inline-block",
              }}
              onMouseEnter={e => {
                if (!isActive(path)) {
                  e.currentTarget.style.color = "#fff";
                  e.currentTarget.style.background = "rgba(123,47,255,0.1)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }
              }}
              onMouseLeave={e => {
                if (!isActive(path)) {
                  e.currentTarget.style.color = "#c0b8e0";
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.transform = "translateY(0)";
                }
              }}
            >
              {label}
              {isActive(path) && (
                <span style={{
                  position: "absolute", bottom: -3, left: 12, right: 12, height: 2,
                  background: "linear-gradient(90deg,#7B2FFF,#00d4ff,#7B2FFF)",
                  backgroundSize: "200% 100%",
                  animation: "axSheenMove 2.5s linear infinite",
                  borderRadius: 2,
                  boxShadow: "0 0 10px rgba(123,47,255,0.9), 0 0 20px rgba(0,212,255,0.5)",
                }} />
              )}
            </Link>
          ))}
        </div>
      )}

      {/* RIGHT SIDE */}
      <div style={{ display: "flex", gap: 7, alignItems: "center" }}>

        {/* ─── WEB3 MODE: chain switcher ─── */}
        {!isWeb2 && isConnected && chainName && (
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

        {/* REWARD BALANCE — clickable → earnings panel (Web3 only) */}
        {!isWeb2 && isConnected && balance !== null && !(isMobile && chainKey === "mst" && !faucetClaimed && Number(balance) === 0) && (
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

        {/* ⛽ FAUCET — MST only, balance 0, not claimed (Web3) */}
        {!isWeb2 && isConnected && chainKey === "mst" &&
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

        {/* Wallet button — Desktop (Web3) */}
        {!isWeb2 && !isMobile && (
          isConnected ? (
            <div ref={walletMenuRef} style={{ position: "relative" }}>
              <button
                onClick={() => setWalletMenuOpen(p => !p)}
                title="Wallet options"
                style={{
                  padding: "6px 13px",
                  background: walletMenuOpen ? "rgba(123,47,255,0.2)" : "rgba(123,47,255,0.1)",
                  border: walletMenuOpen ? "1px solid rgba(123,47,255,0.55)" : "1px solid rgba(123,47,255,0.28)",
                  borderRadius: 6, color: "#a67fff",
                  fontSize: 11, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 7,
                  fontFamily: "'Rajdhani',sans-serif", fontWeight: 700,
                  transition: "all 0.2s",
                  boxShadow: walletMenuOpen ? "0 0 14px rgba(123,47,255,0.3)" : "none",
                }}
                onMouseEnter={e => { if (!walletMenuOpen) { e.currentTarget.style.borderColor = "rgba(123,47,255,0.55)"; e.currentTarget.style.boxShadow = "0 0 14px rgba(123,47,255,0.25)"; } }}
                onMouseLeave={e => { if (!walletMenuOpen) { e.currentTarget.style.borderColor = "rgba(123,47,255,0.28)"; e.currentTarget.style.boxShadow = "none"; } }}
              >
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                  <rect x="1.5" y="3.5" width="11" height="8" rx="1.5" stroke="#a67fff" strokeWidth="1.2"/>
                  <path d="M1.5 6H12.5" stroke="#a67fff" strokeWidth="1.2"/>
                  <circle cx="10" cy="8.5" r="0.7" fill="#a67fff"/>
                </svg>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#b8a8e0" }}>
                  {shortAddress(address)}
                </span>
                <svg width="8" height="8" viewBox="0 0 9 9" style={{ opacity: 0.6, transform: walletMenuOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                  <path d="M1.5 3L4.5 6L7.5 3" stroke="#a67fff" strokeWidth="1.2" fill="none" strokeLinecap="round" />
                </svg>
              </button>

              <div style={{
                position: "absolute", top: "calc(100% + 8px)", right: 0,
                background: "linear-gradient(160deg,#141021,#0d0a17)",
                border: "1px solid rgba(123,47,255,0.28)",
                borderRadius: 12, overflow: "hidden", minWidth: 260,
                boxShadow: "0 16px 40px rgba(0,0,0,0.8), 0 0 24px rgba(123,47,255,0.15)",
                opacity: walletMenuOpen ? 1 : 0,
                pointerEvents: walletMenuOpen ? "all" : "none",
                transform: walletMenuOpen ? "translateY(0)" : "translateY(-6px)",
                transition: "opacity 0.18s, transform 0.18s",
                zIndex: 200,
              }}>
                <div style={{ height: 2, background: "linear-gradient(90deg,#7B2FFF,#00d4ff,#7B2FFF)" }} />

                <div style={{ padding: "14px 14px 12px", borderBottom: "1px solid rgba(123,47,255,0.1)", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", overflow: "hidden", border: "1.5px solid rgba(123,47,255,0.4)", flexShrink: 0, background: "#0e0c1a" }}>
                    <img src={avatarUrl || `https://api.dicebear.com/9.x/bottts/svg?seed=${address}`} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 10, color: "rgba(123,47,255,0.7)", textTransform: "uppercase", letterSpacing: "1.2px", marginBottom: 2 }}>Connected Wallet</div>
                    <div style={{ fontFamily: "monospace", fontSize: 11, color: "#e8deff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {address ? `${address.slice(0, 10)}...${address.slice(-8)}` : ""}
                    </div>
                  </div>
                </div>

                <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: 8 }}>
                  {renderWalletMenuActions()}
                </div>
              </div>
            </div>
          ) : (
            <button onClick={handleConnect} style={{ padding: "7px 18px", background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 6, color: "#fff", fontSize: 12, cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: "0.5px", boxShadow: "0 0 16px rgba(123,47,255,0.35)", transition: "all 0.2s" }}
              onMouseEnter={e => { e.currentTarget.style.background = "linear-gradient(135deg,#8f44ff,#6b2fe8)"; e.currentTarget.style.boxShadow = "0 0 24px rgba(123,47,255,0.55)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "linear-gradient(135deg,#7B2FFF,#5a1fd4)"; e.currentTarget.style.boxShadow = "0 0 16px rgba(123,47,255,0.35)"; }}
            >
              Connect Wallet
            </button>
          )
        )}

        {/* ─── WEB2 MODE: ArcadeCoin balance pill ─── */}
        {isWeb2 && web2User && !web2User.isGuest && (
          <div
            onClick={() => navigate("/profile")}
            title={coinStats ? `${coinStats.todayEarned || 0}/${coinStats.dailyCap || 500} earned today` : "Your ArcadeCoin balance"}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: isMobile ? "0 10px" : "0 13px",
              height: LOGO_SIZE + 8,
              borderRadius: (LOGO_SIZE + 8) / 2,
              background: "linear-gradient(135deg, rgba(255,183,0,0.14), rgba(0,212,255,0.1))",
              border: "1px solid rgba(255,183,0,0.35)",
              boxShadow: "0 0 14px rgba(255,183,0,0.15)",
              cursor: "pointer", transition: "all 0.2s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(255,183,0,0.22), rgba(0,212,255,0.16))"; e.currentTarget.style.borderColor = "rgba(255,183,0,0.6)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(255,183,0,0.14), rgba(0,212,255,0.1))"; e.currentTarget.style.borderColor = "rgba(255,183,0,0.35)"; }}
          >
            <Icon name="coin" size={isMobile ? 13 : 14} color="#FFD56A" />
            <span style={{
              color: "#FFD56A", fontWeight: 700,
              fontFamily: "'Orbitron',sans-serif",
              fontSize: isMobile ? 11 : 12, letterSpacing: "0.3px",
            }}>
              {Number(coinBalance || 0).toLocaleString()}
            </span>
            {!isMobile && (
              <span style={{
                color: "#b58500", fontWeight: 700,
                fontFamily: "'Rajdhani',sans-serif", fontSize: 9,
                textTransform: "uppercase", letterSpacing: "1px",
              }}>
                Coins
              </span>
            )}
          </div>
        )}
        {isWeb2 && web2User?.isGuest && (
          <div
            title="Guests don't earn ArcadeCoins — sign in to start earning"
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: isMobile ? "4px 10px" : "5px 12px",
              borderRadius: 20,
              background: "rgba(255,255,255,0.04)",
              border: "1px dashed rgba(255,255,255,0.18)",
              fontFamily: "'Rajdhani',sans-serif", fontSize: isMobile ? 10 : 11,
              color: "rgba(200,215,235,0.5)", fontWeight: 700,
              letterSpacing: "0.5px",
            }}>
            <Icon name="coin" size={12} />
            <span>Guest</span>
          </div>
        )}

        {/* ─── WEB2 MODE: user chip (desktop) ─── */}
        {isWeb2 && !isMobile && web2User && (
          <div ref={web2MenuRef} style={{ position: "relative" }}>
            <button
              onClick={() => setWeb2MenuOpen(p => !p)}
              title="Account"
              style={{
                padding: "4px 10px 4px 4px",
                background: web2MenuOpen ? "rgba(0,212,255,0.14)" : "rgba(0,212,255,0.08)",
                border: web2MenuOpen ? "1px solid rgba(0,212,255,0.5)" : "1px solid rgba(0,212,255,0.25)",
                borderRadius: 20, color: "#8ab8d8",
                fontSize: 11, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 8,
                fontFamily: "'Rajdhani',sans-serif", fontWeight: 700,
                transition: "all 0.2s",
                boxShadow: web2MenuOpen ? "0 0 14px rgba(0,212,255,0.25)" : "none",
              }}
            >
              <div style={{ width: 24, height: 24, borderRadius: "50%", overflow: "hidden", border: "1.5px solid rgba(0,212,255,0.5)", flexShrink: 0, background: "#0e0c1a" }}>
                <img src={web2AvatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { e.target.src = `https://api.dicebear.com/9.x/bottts/svg?seed=${web2User.uid}`; }} />
              </div>
              <span style={{ fontSize: 12, color: "#d4eaf8", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {web2User.displayName}
              </span>
              {web2User.isGuest && (
                <span style={{ fontSize: 8, padding: "1px 5px", background: "rgba(255,255,255,0.08)", color: "#8ab8d8", borderRadius: 4, letterSpacing: "0.5px", fontWeight: 800 }}>GUEST</span>
              )}
              <svg width="8" height="8" viewBox="0 0 9 9" style={{ opacity: 0.6, transform: web2MenuOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                <path d="M1.5 3L4.5 6L7.5 3" stroke="#8ab8d8" strokeWidth="1.2" fill="none" strokeLinecap="round" />
              </svg>
            </button>

            <div style={{
              position: "absolute", top: "calc(100% + 8px)", right: 0,
              background: "linear-gradient(160deg,#0e1a2a,#0a0f1a)",
              border: "1px solid rgba(0,212,255,0.25)",
              borderRadius: 12, overflow: "hidden", minWidth: 260,
              boxShadow: "0 16px 40px rgba(0,0,0,0.8), 0 0 24px rgba(0,212,255,0.12)",
              opacity: web2MenuOpen ? 1 : 0,
              pointerEvents: web2MenuOpen ? "all" : "none",
              transform: web2MenuOpen ? "translateY(0)" : "translateY(-6px)",
              transition: "opacity 0.18s, transform 0.18s",
              zIndex: 200,
            }}>
              <div style={{ height: 2, background: "linear-gradient(90deg,#00d4ff,#0088ff,#00FF88)" }} />
              <div style={{ padding: "14px 14px 12px", borderBottom: "1px solid rgba(0,212,255,0.1)", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: "50%", overflow: "hidden", border: "1.5px solid rgba(0,212,255,0.4)", flexShrink: 0, background: "#0e0c1a" }}>
                  <img src={web2AvatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { e.target.src = `https://api.dicebear.com/9.x/bottts/svg?seed=${web2User.uid}`; }} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 13, color: "#e8f4ff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {web2User.displayName}
                  </div>
                  <div style={{ fontFamily: "'Rajdhani',sans-serif", fontSize: 10, color: "rgba(0,212,255,0.7)", textTransform: "uppercase", letterSpacing: "1px", marginTop: 2 }}>
                    {web2User.provider === "google" ? "Google Account"
                     : web2User.provider === "twitter" ? "X Account"
                     : "Guest Session"}
                  </div>
                </div>
              </div>
              <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: 8 }}>
                {renderWeb2MenuActions()}
              </div>
            </div>
          </div>
        )}

        {/* Mobile: wallet icon + hamburger */}
        {isMobile && (
          <>
            {!isWeb2 && !isConnected && (
              <button onClick={handleConnect} style={{ padding: "6px 12px", background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 6, color: "#fff", fontSize: 11, cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700 }}>
                Connect
              </button>
            )}

            {/* Wallet chip — mobile (connected, Web3) */}
            {!isWeb2 && isConnected && (
              <button
                onClick={() => setWalletMenuOpen(true)}
                title="Wallet options"
                style={{
                  width: 36, height: 36,
                  background: "rgba(123,47,255,0.08)",
                  border: "1px solid rgba(123,47,255,0.28)",
                  borderRadius: 7,
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: 0,
                  transition: "all 0.15s",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
                  <rect x="1.5" y="3.5" width="11" height="8" rx="1.5" stroke="#a67fff" strokeWidth="1.2"/>
                  <path d="M1.5 6H12.5" stroke="#a67fff" strokeWidth="1.2"/>
                  <circle cx="10" cy="8.5" r="0.9" fill="#a67fff"/>
                </svg>
              </button>
            )}

            {/* Web2 avatar button — mobile */}
            {isWeb2 && web2User && (
              <button
                onClick={() => setWeb2MenuOpen(true)}
                title="Account"
                style={{
                  width: 36, height: 36,
                  background: "rgba(0,212,255,0.08)",
                  border: "1px solid rgba(0,212,255,0.28)",
                  borderRadius: 7,
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: 0, overflow: "hidden",
                }}
              >
                <img src={web2AvatarUrl} alt="avatar" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} onError={e => { e.target.src = `https://api.dicebear.com/9.x/bottts/svg?seed=${web2User.uid}`; }} />
              </button>
            )}

            {/* Hamburger */}
            <div ref={menuRef} style={{ position: "relative" }}>
              <button onClick={() => setMenuOpen(p => !p)} style={{ width: 36, height: 36, background: "rgba(123,47,255,0.08)", border: "1px solid rgba(123,47,255,0.2)", borderRadius: 7, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: 0 }}>
                <span style={{ width: 16, height: 1.5, background: menuOpen ? "#7B2FFF" : "#a67fff", borderRadius: 2, transition: "all 0.2s", transform: menuOpen ? "rotate(45deg) translate(4px, 4px)" : "none" }} />
                <span style={{ width: 16, height: 1.5, background: menuOpen ? "transparent" : "#a67fff", borderRadius: 2, transition: "all 0.2s" }} />
                <span style={{ width: 16, height: 1.5, background: menuOpen ? "#7B2FFF" : "#a67fff", borderRadius: 2, transition: "all 0.2s", transform: menuOpen ? "rotate(-45deg) translate(4px, -4px)" : "none" }} />
              </button>

              {menuOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: "#0e0c1a", border: "1px solid rgba(123,47,255,0.2)", borderRadius: 12, overflow: "hidden", minWidth: 220, boxShadow: "0 16px 40px rgba(0,0,0,0.9)", zIndex: 200 }}>
                  {navLinks.map(({ label, path }, i) => (
                    <div key={label} onClick={() => { navigate(path); setMenuOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid rgba(123,47,255,0.07)", background: isActive(path) ? "rgba(123,47,255,0.14)" : "transparent", color: isActive(path) ? "#c4a0ff" : "#9a8fc2", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, transition: "background 0.15s" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(123,47,255,0.1)"; e.currentTarget.style.color = "#c4a0ff"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = isActive(path) ? "rgba(123,47,255,0.14)" : "transparent"; e.currentTarget.style.color = isActive(path) ? "#c4a0ff" : "#9a8fc2"; }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: isActive(path) ? "#7B2FFF" : "#544a70", boxShadow: isActive(path) ? "0 0 6px #7B2FFF" : "none", flexShrink: 0 }} />
                      {label}
                    </div>
                  ))}

                  {WEB2_ENABLED && <div
                    onClick={handleSwitchMode}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", fontSize: 12, cursor: "pointer", borderBottom: (isConnected || (isWeb2 && web2User)) ? "1px solid rgba(123,47,255,0.12)" : "none", color: "#ff8bb4", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: "0.3px" }}
                  >
                    <Icon name="exchange" size={12} />
                    Switch Mode
                  </div>}

                  {!isWeb2 && isConnected && (
                    <div
                      onClick={() => { setMenuOpen(false); setWalletMenuOpen(true); }}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 16px", fontSize: 12, cursor: "pointer", background: "transparent", color: "#b8a8e0", fontFamily: "monospace", transition: "background 0.15s" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(123,47,255,0.08)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <span>{shortAddress(address)}</span>
                      <span style={{ fontSize: 10, color: "#8866cc", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: "0.5px" }}>WALLET ▸</span>
                    </div>
                  )}

                  {isWeb2 && web2User && (
                    <div
                      onClick={() => { setMenuOpen(false); setWeb2MenuOpen(true); }}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 16px", fontSize: 12, cursor: "pointer", background: "transparent", color: "#b8d4e8", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, transition: "background 0.15s" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,212,255,0.08)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>{web2User.displayName}</span>
                      <span style={{ fontSize: 10, color: "#00d4ff", letterSpacing: "0.5px" }}>ACCOUNT ▸</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </nav>

      {/* ── 💳 MOBILE WALLET MENU MODAL (Web3) ─────────────────────── */}
      {!isWeb2 && isMobile && walletMenuOpen && isConnected && (
        <>
          <style>{`
            @keyframes wmBgIn    { from{opacity:0} to{opacity:1} }
            @keyframes wmModalIn { from{opacity:0;transform:scale(0.92) translateY(10px)} to{opacity:1;transform:scale(1) translateY(0)} }
          `}</style>

          <div
            onClick={() => setWalletMenuOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 3100, background: "rgba(4,3,10,0.82)", backdropFilter: "blur(10px)", animation: "wmBgIn 0.22s ease" }}
          />

          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            zIndex: 3101, width: "min(360px, 92vw)",
            background: "linear-gradient(160deg,#141021,#0d0a17)",
            border: "1px solid rgba(123,47,255,0.3)", borderRadius: 18,
            overflow: "hidden", animation: "wmModalIn 0.28s cubic-bezier(0.34,1.56,0.64,1)",
            boxShadow: "0 20px 70px rgba(0,0,0,0.6), 0 0 40px rgba(123,47,255,0.15)",
            fontFamily: "'Rajdhani',sans-serif",
          }}>
            <div style={{ height: 3, background: "linear-gradient(90deg,#7B2FFF,#00d4ff,#7B2FFF)" }} />

            <button onClick={() => setWalletMenuOpen(false)} style={{ position: "absolute", top: 12, right: 12, width: 28, height: 28, borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#aaa", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>✕</button>

            <div style={{ padding: "22px 20px 16px", borderBottom: "1px solid rgba(123,47,255,0.1)", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", overflow: "hidden", border: "2px solid rgba(123,47,255,0.45)", flexShrink: 0, background: "#0e0c1a", boxShadow: "0 0 18px rgba(123,47,255,0.25)" }}>
                <img src={avatarUrl || `https://api.dicebear.com/9.x/bottts/svg?seed=${address}`} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 10, color: "rgba(123,47,255,0.75)", textTransform: "uppercase", letterSpacing: "1.4px", marginBottom: 3 }}>Connected Wallet</div>
                <div style={{ fontFamily: "monospace", fontSize: 12, color: "#e8deff", wordBreak: "break-all", lineHeight: 1.35 }}>
                  {address}
                </div>
              </div>
            </div>

            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 10 }}>
              {renderWalletMenuActions()}
            </div>
          </div>
        </>
      )}

      {/* ── 💳 MOBILE WEB2 ACCOUNT MODAL ──────────────────────────── */}
      {isWeb2 && isMobile && web2MenuOpen && web2User && (
        <>
          <style>{`
            @keyframes w2mBgIn    { from{opacity:0} to{opacity:1} }
            @keyframes w2mModalIn { from{opacity:0;transform:scale(0.92) translateY(10px)} to{opacity:1;transform:scale(1) translateY(0)} }
          `}</style>

          <div
            onClick={() => setWeb2MenuOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 3100, background: "rgba(4,3,10,0.82)", backdropFilter: "blur(10px)", animation: "w2mBgIn 0.22s ease" }}
          />

          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            zIndex: 3101, width: "min(360px, 92vw)",
            background: "linear-gradient(160deg,#0e1a2a,#0a0f1a)",
            border: "1px solid rgba(0,212,255,0.3)", borderRadius: 18,
            overflow: "hidden", animation: "w2mModalIn 0.28s cubic-bezier(0.34,1.56,0.64,1)",
            boxShadow: "0 20px 70px rgba(0,0,0,0.6), 0 0 40px rgba(0,212,255,0.15)",
            fontFamily: "'Rajdhani',sans-serif",
          }}>
            <div style={{ height: 3, background: "linear-gradient(90deg,#00d4ff,#0088ff,#00FF88)" }} />
            <button onClick={() => setWeb2MenuOpen(false)} style={{ position: "absolute", top: 12, right: 12, width: 28, height: 28, borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#aaa", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>✕</button>

            <div style={{ padding: "22px 20px 16px", borderBottom: "1px solid rgba(0,212,255,0.1)", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", overflow: "hidden", border: "2px solid rgba(0,212,255,0.45)", flexShrink: 0, background: "#0e0c1a", boxShadow: "0 0 18px rgba(0,212,255,0.25)" }}>
                <img src={web2AvatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { e.target.src = `https://api.dicebear.com/9.x/bottts/svg?seed=${web2User.uid}`; }} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 14, color: "#e8f4ff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {web2User.displayName}
                </div>
                <div style={{ fontFamily: "'Rajdhani',sans-serif", fontSize: 10, color: "rgba(0,212,255,0.7)", textTransform: "uppercase", letterSpacing: "1.4px", marginTop: 3 }}>
                  {web2User.provider === "google" ? "Google Account"
                   : web2User.provider === "twitter" ? "X Account"
                   : "Guest Session"}
                </div>
              </div>
            </div>

            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 10 }}>
              {renderWeb2MenuActions()}
            </div>
          </div>
        </>
      )}

      {/* ── ⛽ GAS FAUCET PANEL (Web3 only) ──────────────────────────── */}
      {faucetPanel && !isWeb2 && (
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

          <div
            onClick={() => { if (faucetStage === "idle" || faucetStage === "error" || faucetStage === "success") setFaucetPanel(false); }}
            style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(4,3,10,0.82)", backdropFilter: "blur(10px)", animation: "fpBgIn 0.25s ease" }}
          />

          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            zIndex: 3001, width: "min(400px, 92vw)",
            background: "linear-gradient(160deg,#141021,#0d0a17)",
            border: "1px solid rgba(255,47,94,0.25)", borderRadius: 22,
            overflow: "hidden", animation: "fpModalIn 0.35s cubic-bezier(0.34,1.56,0.64,1)",
            boxShadow: "0 20px 70px rgba(0,0,0,0.6), 0 0 40px rgba(255,47,94,0.12)",
            fontFamily: "'Rajdhani',sans-serif",
          }}>
            <div style={{ height: 3, background: "linear-gradient(90deg,#ff2f5e,#ff6b35,#ffb800)" }} />

            {(faucetStage === "idle" || faucetStage === "error" || faucetStage === "success") && (
              <button onClick={() => setFaucetPanel(false)} style={{ position: "absolute", top: 14, right: 14, width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#aaa", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>✕</button>
            )}

            <div style={{ padding: "34px 30px 30px", textAlign: "center" }}>

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

              {faucetStage === "redirecting" && (
                <div style={{ padding: "18px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginBottom: 26 }}>
                    <div style={{ width: 52, height: 52, borderRadius: "50%", background: "linear-gradient(135deg,#7B2FFF,#a67fff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>🎮</div>
                    <div style={{ fontSize: 22, color: "#1da1f2", animation: "fpArrowSlide 1s ease-in-out infinite", margin: "0 4px" }}>→</div>
                    <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#1da1f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 900, color: "#fff", flexShrink: 0, animation: "fpPulseRing 1.4s ease-out infinite" }}>𝕏</div>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 6 }}>Redirecting to X</div>
                  <div style={{ fontSize: 13, color: "#b8b0d0" }}>Complete login in the popup window…</div>
                </div>
              )}

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

              {faucetStage === "success" && (
                <div style={{ padding: "14px 0" }}>
                  <div style={{ width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg,#00c853,#00e676)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 20px", animation: "fpDropIn 0.5s cubic-bezier(0.34,1.56,0.64,1)", boxShadow: "0 0 30px rgba(0,230,118,0.4)" }}>✓</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#00e676", marginBottom: 8 }}>Gas Claimed!</div>
                  <div style={{ fontSize: 14, color: "#b8b0d0" }}><b style={{ color: "#00e676" }}>0.1 MSTC</b> is now in your wallet.</div>
                </div>
              )}

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

      {/* ── EARNINGS PANEL (Web3 only) ──────────────────────────── */}
      {earningsOpen && !isWeb2 && (
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

          <div onClick={() => setEarningsOpen(false)}
            style={{ position:"fixed", inset:0, zIndex:998, background:"rgba(0,0,0,0.7)", backdropFilter:"blur(8px)", animation:"fadeInBg 0.2s ease" }} />

          <div style={{
            position:"fixed", top:0, right:0, bottom:0, zIndex:999,
            width: isMobile ? "100vw" : 400,
            background: "linear-gradient(180deg, #0c0a1e 0%, #08070f 100%)",
            borderLeft: "1px solid rgba(123,47,255,0.2)",
            boxShadow: "-40px 0 100px rgba(0,0,0,0.9), -1px 0 0 rgba(123,47,255,0.15)",
            animation: "slideInRight 0.3s cubic-bezier(0.34,1.4,0.64,1)",
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}>

            <div style={{ height:3, flexShrink:0, background:"linear-gradient(90deg,#7B2FFF,#00d4ff,#00FF88,#FFB700,#7B2FFF)", backgroundSize:"300% 100%", animation:"gradPulse 3s ease infinite" }} />

            <div style={{ position:"absolute", top:-80, right:-80, width:240, height:240, background:"radial-gradient(circle,rgba(123,47,255,0.12) 0%,transparent 65%)", borderRadius:"50%", pointerEvents:"none" }} />
            <div style={{ position:"absolute", bottom:-60, left:-60, width:180, height:180, background:"radial-gradient(circle,rgba(0,212,255,0.07) 0%,transparent 65%)", borderRadius:"50%", pointerEvents:"none" }} />

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

            <div style={{ margin:"16px 16px 0", flexShrink:0 }}>
              {(() => {
                const totalEarned = chainFiltered.reduce((sum, s) => {
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

                <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:10, color:"rgba(0,212,255,0.7)", textTransform:"uppercase", letterSpacing:"2px", marginBottom:6, fontWeight:700 }}>Current Balance</div>
                <div style={{ display:"flex", alignItems:"flex-end", gap:8, marginBottom:14 }}>
                  <span style={{ fontFamily:"'Orbitron',sans-serif", fontWeight:700, fontSize:34, color:"#fff", lineHeight:1, textShadow:"0 0 30px rgba(123,47,255,0.5)" }}>
                    {Number(balance).toLocaleString()}
                  </span>
                  <span style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:14, color:"rgba(0,212,255,0.8)", marginBottom:4 }}>{earnSymbol}</span>
                </div>

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

            <div style={{ flex:1, overflowY:"auto", padding:"14px 0 8px", scrollbarWidth:"none" }}>
              {earningsLoading ? (
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
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 20px 6px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <div style={{ width:3, height:14, borderRadius:2, background:"linear-gradient(180deg,#7B2FFF,#00d4ff)" }} />
                        <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.7)", textTransform:"uppercase", letterSpacing:"1.5px" }}>{date}</span>
                      </div>
                      <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:10, color:"rgba(123,47,255,0.6)", background:"rgba(123,47,255,0.1)", padding:"2px 8px", borderRadius:20, border:"1px solid rgba(123,47,255,0.2)" }}>
                        {plays.length} play{plays.length > 1 ? "s" : ""}
                      </span>
                    </div>

                    <div style={{ padding:"0 12px", display:"flex", flexDirection:"column", gap:4 }}>
                      {plays.map((play, i) => {
                        const gInfo = gameMap[play.gameId] || {};
                        const thumb = gInfo.thumbnail;
                        const time = play.createdAt ? new Date(play.createdAt).toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", hour12:true }) : "";
                        const playChain = (play.chain || "botchain").toLowerCase();
                        const isMstPlay = playChain === "mst";
                        const rate = isMstPlay ? (gInfo.rewardRateNative || 1) : (gInfo.rewardRate || 50);
                        const earned = (play.earned != null && Number(play.earned) > 0)
                          ? Number(play.earned)
                          : Math.round(rate * playerShareForEarnings / 100 * 100) / 100;
                        const earnedSymbol = isMstPlay ? "MSTC" : (play.earnedSymbol || "ARCADE");
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

                            <div style={{ width:44, height:44, borderRadius:10, overflow:"hidden", border:"1px solid rgba(123,47,255,0.25)", flexShrink:0, background:"linear-gradient(135deg,rgba(123,47,255,0.2),rgba(0,212,255,0.1))", position:"relative" }}>
                              {thumb ? (
                                <img src={thumb} alt={play.gameName} style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} onError={e => { e.target.style.display="none"; }} />
                              ) : (
                                <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🎮</div>
                              )}
                              <div style={{ position:"absolute", inset:0, background:"linear-gradient(135deg,transparent 40%,rgba(255,255,255,0.06) 50%,transparent 60%)" }} />
                            </div>

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
