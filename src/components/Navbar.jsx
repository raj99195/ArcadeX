import { useState, useRef, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAppKit } from "@reown/appkit/react";
import { useAccount } from "wagmi";
import { useArcadeBalance } from "../hooks/useArcadeBalance";

const LOGO_SIZE = 32;

const S = {
  nav: {
    position: "sticky", top: 0, zIndex: 100,
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "0 36px", height: "54px",
    background: "rgba(8,7,15,0.97)",
    borderBottom: "1px solid rgba(123,47,255,0.12)",
    backdropFilter: "blur(20px)",
  },
};

export default function Navbar() {
  const { open } = useAppKit();
  const { isConnected, address } = useAccount();
  const navigate = useNavigate();
  const location = useLocation();
  const { balance } = useArcadeBalance();
  const [ddOpen, setDdOpen] = useState(false);
  const ddRef = useRef(null);

  const shortAddress = (addr) => addr ? addr.slice(0, 6) + "..." + addr.slice(-4) : "";
  const isActive = (path) => location.pathname === path;

  useEffect(() => {
    const h = (e) => { if (ddRef.current && !ddRef.current.contains(e.target)) setDdOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <nav style={S.nav}>
      {/* LOGO + DROPDOWN */}
      <div ref={ddRef} style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <div onClick={() => setDdOpen(p => !p)} style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", userSelect: "none" }}>
          <img src="/IA-logo.png" alt="ArcadeX Logo" style={{ width: 32, height: 32, objectFit: "contain", filter: "drop-shadow(0 0 10px rgba(123,47,255,0.8))" }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: "'Rajdhani',sans-serif", letterSpacing: "0.5px" }}>
            ArcadeX
          </span>
          <svg width="9" height="9" viewBox="0 0 9 9" style={{ opacity: 0.3, transform: ddOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
            <path d="M1.5 3L4.5 6L7.5 3" stroke="#fff" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          </svg>
        </div>

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
            { label: "Creators", path: "/publish", color: "#00d4ff" },
          ].map(({ label, path, color }) => (
            <div key={label} onClick={() => { navigate(path); setDdOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 9,
                padding: "10px 14px", fontSize: 12, cursor: "pointer",
                borderBottom: label === "Games" ? "1px solid rgba(123,47,255,0.08)" : "none",
                color: isActive(path) ? color : "#444",
                fontFamily: "'Rajdhani',sans-serif", fontWeight: 600, letterSpacing: "0.3px",
                transition: "background 0.15s, color 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(123,47,255,0.08)"; e.currentTarget.style.color = color; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = isActive(path) ? color : "#444"; }}
            >
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: isActive(path) ? color : "#2a2a2a" }} />
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* NAV LINKS */}
      <div style={{ display: "flex", gap: 4 }}>
        {[["Home", "/"], ["Games", "/games"], ["Leaderboard", "/leaderboard"]].map(([label, path]) => (
          <Link key={label} to={path} style={{
            padding: "6px 14px", borderRadius: 6,
            color: isActive(path) ? "#a67fff" : "#444",
            background: isActive(path) ? "rgba(123,47,255,0.08)" : "transparent",
            fontFamily: "'Rajdhani',sans-serif", fontWeight: 600, fontSize: 13,
            letterSpacing: "0.3px", textDecoration: "none", transition: "all 0.2s",
          }}
            onMouseEnter={e => { if (!isActive(path)) { e.target.style.color = "#888"; e.target.style.background = "rgba(123,47,255,0.04)"; } }}
            onMouseLeave={e => { if (!isActive(path)) { e.target.style.color = "#444"; e.target.style.background = "transparent"; } }}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* RIGHT */}
      <div style={{ display: "flex", gap: 7, alignItems: "center" }}>

        {/* ARCADE BALANCE */}
        {isConnected && balance !== null && (
          <div style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "0 12px", height: LOGO_SIZE + 8,
            borderRadius: (LOGO_SIZE + 8) / 2,
            background: "rgba(123,47,255,0.08)",
          }}>
            <img src="/Arcade-token-logo.png" alt="ARCADE"
              style={{ width: LOGO_SIZE, height: LOGO_SIZE, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
              onError={e => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
            />
            <div style={{
              display: "none", width: LOGO_SIZE, height: LOGO_SIZE, borderRadius: "50%",
              background: "linear-gradient(135deg,#7B2FFF,#00d4ff)",
              alignItems: "center", justifyContent: "center",
              fontSize: 9, fontWeight: 700, color: "#fff",
              fontFamily: "'Orbitron',sans-serif", flexShrink: 0,
            }}>A</div>
            <span style={{ color: "#c4a0ff", fontWeight: 700, fontFamily: "'Orbitron',sans-serif", fontSize: 11, letterSpacing: "0.3px" }}>
              {Number(balance).toLocaleString()}
            </span>
          </div>
        )}

        {/* WALLET BUTTON */}
        {isConnected ? (
          <button onClick={() => open({ view: "Account" })} style={{
            padding: "6px 13px", background: "rgba(123,47,255,0.08)",
            border: "1px solid rgba(123,47,255,0.2)", borderRadius: 6,
            color: "#a67fff", fontSize: 11, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 7,
            fontFamily: "'Rajdhani',sans-serif", fontWeight: 600, transition: "all 0.2s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(123,47,255,0.4)"; e.currentTarget.style.color = "#c4a0ff"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(123,47,255,0.2)"; e.currentTarget.style.color = "#a67fff"; }}
          >
            <span style={{ fontFamily: "monospace", fontSize: 10, color: "#888" }}>
              {shortAddress(address)}
            </span>
          </button>
        ) : (
          <button onClick={() => open()} style={{
            padding: "7px 18px",
            background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)",
            border: "none", borderRadius: 6,
            color: "#fff", fontSize: 12, cursor: "pointer",
            fontFamily: "'Rajdhani',sans-serif", fontWeight: 700,
            letterSpacing: "0.5px", transition: "all 0.2s",
          }}
            onMouseEnter={e => e.currentTarget.style.background = "linear-gradient(135deg,#8f44ff,#6b2fe8)"}
            onMouseLeave={e => e.currentTarget.style.background = "linear-gradient(135deg,#7B2FFF,#5a1fd4)"}
          >
            Connect Wallet
          </button>
        )}
      </div>
    </nav>
  );
}