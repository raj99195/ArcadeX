// src/pages/ChainSelector.jsx
import { useChain } from "../context/ChainContext";
import { useSwitchChain, useAccount } from "wagmi";
import { useState, useEffect } from "react";

const P = {
  bg: "#08070f",
  border: "rgba(255,255,255,0.08)",
  purple: "#7B2FFF",
  cyan: "#00d4ff",
  raj: "'Rajdhani', sans-serif",
  orb: "'Orbitron', sans-serif",
};

const ACCENTS = {
  botchain: "#00e0c8",
  mst: "#ff2f5e",
  somnia: "#7B2FFF",
};
function accentFor(key) {
  return ACCENTS[key?.toLowerCase()] || P.purple;
}

const FEATURES = [
  { icon: "🛡", title: "Secure", desc: "Your assets are safe" },
  { icon: "◈", title: "Decentralized", desc: "Built on blockchain" },
  { icon: "⚡", title: "Fast & Scalable", desc: "Low fees, high speed" },
  { icon: "🌐", title: "Community Driven", desc: "Players. Creators. You." },
];

function ChainCard({ chain, onSelect, isSwitching, isMobile }) {
  const isLive = chain.status === "live";
  const [logoFailed, setLogoFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const accent = isLive ? accentFor(chain.key) : "rgba(255,255,255,0.25)";

  const initials = chain.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const showLogo = chain.logo && !logoFailed;

  const iconInner = isSwitching ? (
    <div
      style={{
        width: isMobile ? 20 : 30,
        height: isMobile ? 20 : 30,
        borderRadius: "50%",
        border: "3px solid rgba(255,255,255,0.15)",
        borderTopColor: accent,
        animation: "chainSpin 0.7s linear infinite",
      }}
    />
  ) : showLogo ? (
    <img
      src={chain.logo}
      alt={chain.name}
      style={{
        width: "56%",
        height: "56%",
        objectFit: "contain",
        filter: isLive ? "none" : "grayscale(1)",
        display: "block",
      }}
      onError={() => setLogoFailed(true)}
    />
  ) : (
    <span
      style={{
        fontFamily: P.orb,
        fontWeight: 700,
        fontSize: isMobile ? 18 : 30,
        color: isLive ? accent : "rgba(255,255,255,0.25)",
      }}
    >
      {initials}
    </span>
  );

  // ── MOBILE: compact full-width horizontal row ──
  if (isMobile) {
    return (
      <button
        onClick={() => isLive && !isSwitching && onSelect(chain)}
        disabled={!isLive || isSwitching}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "13px 15px",
          borderRadius: 14,
          textAlign: "left",
          background: isLive
            ? `linear-gradient(120deg, ${accent}14 0%, rgba(10,8,18,0.7) 72%)`
            : "rgba(255,255,255,0.02)",
          border: `1px solid ${isLive ? accent + "44" : "rgba(255,255,255,0.06)"}`,
          cursor: isLive && !isSwitching ? "pointer" : "not-allowed",
          transition: "all 0.2s ease",
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            flexShrink: 0,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `${accent}14`,
            border: `2px solid ${accent}55`,
          }}
        >
          {iconInner}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: P.raj,
              fontWeight: 700,
              fontSize: 17,
              lineHeight: 1.15,
              color: isLive ? "#fff" : "rgba(255,255,255,0.4)",
            }}
          >
            {chain.name}
          </div>
          <div
            style={{
              fontFamily: P.raj,
              fontWeight: 700,
              fontSize: 12,
              marginTop: 3,
              color: isLive ? accent : "rgba(255,255,255,0.25)",
            }}
          >
            Earn <span style={{ fontWeight: 800 }}>{chain.rewardToken}</span>
          </div>
        </div>

        <span
          style={{
            flexShrink: 0,
            fontFamily: P.raj,
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            color: isLive ? accent : "rgba(255,255,255,0.3)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            whiteSpace: "nowrap",
          }}
        >
          {!isLive ? "Soon" : isSwitching ? "..." : <>Select <span>→</span></>}
        </span>
      </button>
    );
  }

  // ── DESKTOP: original vertical card ──
  return (
    <div
      onMouseEnter={() => isLive && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 260,
        padding: "40px 28px 28px",
        borderRadius: 18,
        textAlign: "center",
        position: "relative",
        background: isLive
          ? `linear-gradient(160deg, ${accent}0f 0%, rgba(10,8,18,0.7) 65%)`
          : "rgba(255,255,255,0.02)",
        border: `1px solid ${isLive ? accent + "44" : "rgba(255,255,255,0.06)"}`,
        boxShadow: isLive && hovered ? `0 0 50px ${accent}33, 0 0 0 1px ${accent}55` : "0 8px 32px rgba(0,0,0,0.35)",
        transform: isLive && hovered ? "translateY(-6px)" : "translateY(0)",
        transition: "all 0.3s ease",
      }}
    >
      <div
        style={{
          width: 96,
          height: 96,
          margin: "0 auto 22px",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `${accent}14`,
          border: `2px solid ${accent}55`,
          boxShadow: isLive ? `0 0 30px ${accent}22` : "none",
        }}
      >
        {iconInner}
      </div>

      <div
        style={{
          fontFamily: P.raj,
          fontWeight: 700,
          fontSize: 21,
          color: isLive ? "#fff" : "rgba(255,255,255,0.35)",
          marginBottom: 10,
        }}
      >
        {chain.name}
      </div>

      <div style={{ width: 36, height: 2, background: accent, opacity: isLive ? 1 : 0.4, margin: "0 auto 12px", borderRadius: 2 }} />

      <div
        style={{
          fontFamily: P.raj,
          fontWeight: 700,
          fontSize: 13,
          color: isLive ? accent : "rgba(255,255,255,0.25)",
          marginBottom: 24,
        }}
      >
        Earn <span style={{ fontWeight: 800 }}>{chain.rewardToken}</span>
      </div>

      <button
        onClick={() => isLive && !isSwitching && onSelect(chain)}
        disabled={!isLive || isSwitching}
        style={{
          width: "100%",
          padding: "12px 18px",
          borderRadius: 999,
          border: `1.5px solid ${isLive ? accent : "rgba(255,255,255,0.12)"}`,
          background: isLive && hovered ? accent : "transparent",
          color: !isLive ? "rgba(255,255,255,0.3)" : hovered ? "#040c08" : accent,
          fontFamily: P.raj,
          fontWeight: 700,
          fontSize: 13,
          letterSpacing: "0.6px",
          textTransform: "uppercase",
          cursor: isLive && !isSwitching ? "pointer" : "not-allowed",
          transition: "all 0.2s ease",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        {!isLive ? "Coming Soon" : isSwitching ? "Switching..." : (
          <>Select Chain <span>→</span></>
        )}
      </button>
    </div>
  );
}

export default function ChainSelector() {
  const { allChains, setChainKey } = useChain();
  const { isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [switchingKey, setSwitchingKey] = useState(null);
  const [error, setError] = useState("");
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth <= 768 : false
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleSelect = async (chain) => {
    setError("");
    setSwitchingKey(chain.key);
    try {
      if (window.ethereum) {
        const chainIdHex = "0x" + chain.chainId.toString(16);
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: chainIdHex }],
          });
        } catch (switchErr) {
          if (switchErr.code === 4902 || switchErr.code === -32603) {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId: chainIdHex,
                chainName: chain.name,
                rpcUrls: [chain.rpcUrl],
                nativeCurrency: chain.nativeCurrency,
                blockExplorerUrls: chain.explorerUrl ? [chain.explorerUrl] : [],
              }],
            });
          } else if (!switchErr.message?.includes("rejected")) {
            throw switchErr;
          }
        }
      }

      if (isConnected) {
        await switchChainAsync({ chainId: chain.chainId });
      }

      setChainKey(chain.key);
    } catch (err) {
      setError(
        err.message?.includes("rejected") || err.code === 4001
          ? "Switch cancelled — try again when you're ready."
          : `Couldn't switch to ${chain.name}. Add the network in your wallet and try again.`
      );
    } finally {
      setSwitchingKey(null);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: P.bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: isMobile ? "flex-start" : "center",
        padding: isMobile ? "28px 18px 40px" : 24,
        overflowY: "auto",
      }}
    >
      <style>{`
        @keyframes chainSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      <div
        style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(123,47,255,0.08) 0%, transparent 70%)",
        }}
      />

      <div style={{ textAlign: "center", marginBottom: isMobile ? 26 : 48, position: "relative" }}>
        <div
          style={{
            fontSize: 11, fontFamily: P.raj, fontWeight: 700,
            color: P.purple, letterSpacing: "4px", textTransform: "uppercase",
            marginBottom: isMobile ? 10 : 14,
          }}
        >
          ArcadeX
        </div>
        <h1
          style={{
            fontFamily: P.orb, fontWeight: 700, fontSize: isMobile ? 27 : 44,
            color: "#fff", margin: 0, letterSpacing: "1px", lineHeight: 1.15,
            textTransform: "uppercase",
          }}
        >
          Choose Your{" "}
          <span
            style={{
              background: `linear-gradient(90deg, ${P.purple}, ${P.cyan})`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Chain
          </span>
        </h1>
        <p
          style={{
            fontSize: isMobile ? 13 : 14, color: "rgba(255,255,255,0.45)", fontFamily: P.raj,
            margin: "10px 0 0", fontWeight: 500,
          }}
        >
          Select a blockchain to start playing and earning
        </p>
        {!isMobile && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 18 }}>
            <div style={{ width: 40, height: 2, background: `linear-gradient(90deg, ${P.purple}, transparent)`, borderRadius: 2 }} />
            <div style={{ width: 4, height: 4, borderRadius: "50%", background: P.purple }} />
            <div style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(123,47,255,0.4)" }} />
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            marginBottom: 20, padding: "10px 20px", borderRadius: 8,
            background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.25)",
            color: "#ff8080", fontFamily: P.raj, fontSize: 13, fontWeight: 600,
            maxWidth: 420, textAlign: "center", position: "relative",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          gap: isMobile ? 12 : 24,
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "stretch",
          width: isMobile ? "100%" : "auto",
          maxWidth: isMobile ? 440 : 900,
          position: "relative",
          marginBottom: isMobile ? 28 : 40,
        }}
      >
        {allChains.map((chain) => (
          <ChainCard
            key={chain.key}
            chain={chain}
            onSelect={handleSelect}
            isSwitching={switchingKey === chain.key}
            isMobile={isMobile}
          />
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fit, minmax(180px, 1fr))",
          gap: isMobile ? 12 : 20,
          width: "100%",
          maxWidth: isMobile ? 440 : 1000,
          padding: isMobile ? "16px 18px" : "24px 32px",
          borderRadius: 16,
          border: `1px solid ${P.border}`,
          background: "rgba(255,255,255,0.02)",
          position: "relative",
        }}
      >
        {FEATURES.map((f) => (
          <div key={f.title} style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 14 }}>
            <div
              style={{
                width: isMobile ? 34 : 42, height: isMobile ? 34 : 42, borderRadius: "50%", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(123,47,255,0.1)", border: `1px solid ${P.purple}33`,
                fontSize: isMobile ? 15 : 18,
              }}
            >
              {f.icon}
            </div>
            <div>
              <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: isMobile ? 12 : 14, color: "#fff" }}>{f.title}</div>
              {!isMobile && <div style={{ fontFamily: P.raj, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{f.desc}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}