import { useState, useRef, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAppKit } from "@reown/appkit/react";
import { useAccount } from "wagmi";
import { useArcadeBalance } from "../hooks/useArcadeBalance";
import { getActiveAvatarStyle } from "../utils/avatarUtils";

const LOGO_SIZE = 28;

export default function Navbar() {
  const { open } = useAppKit();
  const { isConnected, address } = useAccount();
  const navigate = useNavigate();
  const location = useLocation();
  const { balance } = useArcadeBalance();
  const [ddOpen, setDdOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [avatarStyle, setAvatarStyle] = useState("bottts");
  const ddRef = useRef(null);
  const menuRef = useRef(null);

  const shortAddress = (addr) => addr ? addr.slice(0, 5) + "..." + addr.slice(-3) : "";
  const isActive = (path) => location.pathname === path;
  const avatarUrl = address
    ? `https://api.dicebear.com/9.x/${avatarStyle}/svg?seed=${address}`
    : null;

  useEffect(() => {
    if (address) setAvatarStyle(getActiveAvatarStyle(address));
  }, [address]);

  // Listen for style changes from Marketplace
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

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  const navLinks = [
    { label: "Home", path: "/" },
    { label: "Games", path: "/games" },
    { label: "Leaderboard", path: "/leaderboard" },
    { label: "Tournaments", path: "/tournaments" },
    { label: "Marketplace", path: "/marketplace" },
    { label: "Creators", path: "/publish" },
    { label: "Community", path: "/community" }
  ];

  return (
    <nav style={{
      position: "sticky", top: 0, zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: isMobile ? "0 16px" : "0 36px", height: "54px",
      background: "rgba(8,7,15,0.97)",
      borderBottom: "1px solid rgba(123,47,255,0.12)",
      backdropFilter: "blur(20px)",
    }}>

      {/* LOGO + Avatar */}
      <div ref={ddRef} style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <div onClick={() => isMobile ? navigate("/") : setDdOpen(p => !p)} style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", userSelect: "none" }}>
          {/* DiceBear Avatar — replaces logo when connected */}
          {isConnected && avatarUrl ? (
            <div style={{ width: 30, height: 30, borderRadius: "50%", overflow: "hidden", border: "1.5px solid rgba(123,47,255,0.6)", boxShadow: "0 0 10px rgba(123,47,255,0.5)", flexShrink: 0, background: "#0e0c1a" }}>
              <img src={avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          ) : (
            <img src="/IA-logo.png" alt="ArcadeX Logo" style={{ width: 30, height: 30, objectFit: "contain", filter: "drop-shadow(0 0 10px rgba(123,47,255,0.8))" }} />
          )}
          <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: "'Rajdhani',sans-serif", letterSpacing: "0.5px" }}>ArcadeX</span>
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
              <div key={label} onClick={() => { navigate(path); setDdOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", fontSize: 12, cursor: "pointer", borderBottom: label === "Games" ? "1px solid rgba(123,47,255,0.08)" : "none", color: isActive(path) ? color : "#444", fontFamily: "'Rajdhani',sans-serif", fontWeight: 600, letterSpacing: "0.3px", transition: "background 0.15s, color 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(123,47,255,0.08)"; e.currentTarget.style.color = color; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = isActive(path) ? color : "#444"; }}
              >
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: isActive(path) ? color : "#2a2a2a" }} />
                {label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Desktop Nav Links */}
      {!isMobile && (
        <div style={{ display: "flex", gap: 4 }}>
          {[["Home", "/"], ["Games", "/games"], ["Leaderboard", "/leaderboard"], ["Tournaments", "/tournaments"], ["Marketplace", "/marketplace"],["Community", "/Community"]].map(([label, path]) => (
            <Link key={label} to={path} style={{ padding: "6px 14px", borderRadius: 6, color: isActive(path) ? "#a67fff" : "#444", background: isActive(path) ? "rgba(123,47,255,0.08)" : "transparent", fontFamily: "'Rajdhani',sans-serif", fontWeight: 600, fontSize: 13, letterSpacing: "0.3px", textDecoration: "none", transition: "all 0.2s" }}
              onMouseEnter={e => { if (!isActive(path)) { e.target.style.color = "#888"; e.target.style.background = "rgba(123,47,255,0.04)"; } }}
              onMouseLeave={e => { if (!isActive(path)) { e.target.style.color = "#444"; e.target.style.background = "transparent"; } }}
            >
              {label}
            </Link>
          ))}
        </div>
      )}

      {/* RIGHT */}
      <div style={{ display: "flex", gap: 7, alignItems: "center" }}>

        {/* ARCADE BALANCE — desktop only or connected mobile */}
        {isConnected && balance !== null && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: isMobile ? "0 8px" : "0 12px", height: LOGO_SIZE + 8, borderRadius: (LOGO_SIZE + 8) / 2, background: "rgba(123,47,255,0.08)" }}>
            {/* DiceBear avatar — replaces ARCADE token logo */}
            <div style={{ width: LOGO_SIZE, height: LOGO_SIZE, borderRadius: "50%", overflow: "hidden", border: "1.5px solid rgba(123,47,255,0.5)", flexShrink: 0, background: "#0e0c1a" }}>
              <img src={avatarUrl || `https://api.dicebear.com/9.x/bottts/svg?seed=${address}`} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <span style={{ color: "#c4a0ff", fontWeight: 700, fontFamily: "'Orbitron',sans-serif", fontSize: isMobile ? 10 : 11, letterSpacing: "0.3px" }}>
              {Number(balance).toLocaleString()}
            </span>
          </div>
        )}

        {/* Wallet button */}
        {!isMobile && (
          isConnected ? (
            <button onClick={() => open({ view: "Account" })} style={{ padding: "6px 13px", background: "rgba(123,47,255,0.08)", border: "1px solid rgba(123,47,255,0.2)", borderRadius: 6, color: "#a67fff", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, fontFamily: "'Rajdhani',sans-serif", fontWeight: 600, transition: "all 0.2s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(123,47,255,0.4)"; e.currentTarget.style.color = "#c4a0ff"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(123,47,255,0.2)"; e.currentTarget.style.color = "#a67fff"; }}
            >
              <span style={{ fontFamily: "monospace", fontSize: 10, color: "#888" }}>{shortAddress(address)}</span>
            </button>
          ) : (
            <button onClick={() => open()} style={{ padding: "7px 18px", background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 6, color: "#fff", fontSize: 12, cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: "0.5px", transition: "all 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.background = "linear-gradient(135deg,#8f44ff,#6b2fe8)"}
              onMouseLeave={e => e.currentTarget.style.background = "linear-gradient(135deg,#7B2FFF,#5a1fd4)"}
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
              <button onClick={() => open()} style={{ padding: "6px 12px", background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 6, color: "#fff", fontSize: 11, cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700 }}>
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
                    <div key={label} onClick={() => { navigate(path); setMenuOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", fontSize: 13, cursor: "pointer", borderBottom: i < navLinks.length - 1 ? "1px solid rgba(123,47,255,0.07)" : "none", background: isActive(path) ? "rgba(123,47,255,0.12)" : "transparent", color: isActive(path) ? "#c4a0ff" : "#888", fontFamily: "'Rajdhani',sans-serif", fontWeight: 600, transition: "background 0.15s" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(123,47,255,0.08)"; e.currentTarget.style.color = "#c4a0ff"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = isActive(path) ? "rgba(123,47,255,0.12)" : "transparent"; e.currentTarget.style.color = isActive(path) ? "#c4a0ff" : "#888"; }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: isActive(path) ? "#7B2FFF" : "#2a2a2a", flexShrink: 0 }} />
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