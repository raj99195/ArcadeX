import { useState, useRef, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAppKit } from "@reown/appkit/react";
import { useAccount, useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { useArcadeBalance } from "../hooks/useArcadeBalance";
import { getActiveAvatarStyle } from "../utils/avatarUtils";
import { useChain } from "../context/ChainContext";

const LOGO_SIZE = 28;

export default function Navbar() {
  const { open } = useAppKit();
  const { isConnected, address } = useAccount();
  const { connectAsync } = useConnect();
  const navigate = useNavigate();
  const location = useLocation();
  const { balance } = useArcadeBalance();
  
  // Need rewardToken to display ARCADE or MSTC dynamically
  const { chainName, clearChainSelection, rewardToken, activeChain } = useChain();
  
  const [ddOpen, setDdOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [avatarStyle, setAvatarStyle] = useState("bottts");
  
  const ddRef = useRef(null);
  const menuRef = useRef(null);

  // Connect button click flow:
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
      // AppKit open() NAHI — woh internally switchChain(BOTChain) karta hai.
      // wagmi connectAsync with chainId = MetaMask pehle se correct chain pe hai,
      // toh koi extra switch request nahi aayegi.
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
          
          <img src="/IA-logo.png" alt="ArcadeX Logo" style={{ width: 30, height: 30, objectFit: "contain", filter: "drop-shadow(0 0 12px rgba(150,80,255,0.9)) drop-shadow(0 0 22px rgba(0,212,255,0.35))" }} />
          
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
            {!isMobile && <span style={{ color: "#00d4ff", fontSize: 11, fontWeight: 700, letterSpacing: "0.3px" }}>{chainName}</span>}
            <svg width="8" height="8" viewBox="0 0 9 9" style={{ opacity: 0.6 }}>
              <path d="M1.5 3L4.5 6L7.5 3" stroke="#00d4ff" strokeWidth="1.2" fill="none" strokeLinecap="round" />
            </svg>
          </button>
        )}

        {/* 2. REWARD BALANCE FIX - Avatar + Balance + Symbol */}
        {isConnected && balance !== null && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: isMobile ? "0 8px" : "0 12px", height: LOGO_SIZE + 8, borderRadius: (LOGO_SIZE + 8) / 2, background: "rgba(123,47,255,0.1)", border: "1px solid rgba(123,47,255,0.25)", boxShadow: "0 0 14px rgba(123,47,255,0.12)" }}>
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
          </div>
        )}

        {/* Wallet button */}
        {!isMobile && (
          isConnected ? (
            <button onClick={() => open({ view: "Account" })} style={{ padding: "6px 13px", background: "rgba(123,47,255,0.1)", border: "1px solid rgba(123,47,255,0.28)", borderRadius: 6, color: "#a67fff", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, transition: "all 0.2s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(123,47,255,0.55)"; e.currentTarget.style.boxShadow = "0 0 14px rgba(123,47,255,0.25)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(123,47,255,0.28)"; e.currentTarget.style.boxShadow = "none"; }}
            >
              <span style={{ fontFamily: "monospace", fontSize: 10, color: "#b8a8e0" }}>{shortAddress(address)}</span>
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
            {isConnected ? (
              <button onClick={() => open({ view: "Account" })} style={{ padding: "5px 10px", background: "rgba(123,47,255,0.08)", border: "1px solid rgba(123,47,255,0.2)", borderRadius: 6, color: "#a67fff", fontSize: 10, cursor: "pointer", fontFamily: "monospace" }}>
                {shortAddress(address)}
              </button>
            ) : (
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
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </nav>
  );
}