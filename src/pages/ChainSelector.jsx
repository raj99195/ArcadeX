// src/pages/ChainSelector.jsx
import { useChain } from "../context/ChainContext";
import { useSwitchChain, useAccount } from "wagmi";
import { useState } from "react";

const P = {
  bg: "#08070f",
  border: "rgba(255,255,255,0.08)",
  purple: "#7B2FFF",
  cyan: "#00d4ff",
  raj: "'Rajdhani', sans-serif",
  orb: "'Orbitron', sans-serif",
};

// Per-chain accent color — matched to the BOTChain (cyan), MST (red/pink),
// Somnia (purple) treatment in the reference mockup. Falls back to purple
// for any chain not explicitly listed here.
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

function ChainCard({ chain, onSelect, isSwitching }) {
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
      {/* Icon circle */}
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
        {isSwitching ? (
          <div
            style={{
              width: 30,
              height: 30,
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
              fontSize: 30,
              color: isLive ? accent : "rgba(255,255,255,0.25)",
            }}
          >
            {initials}
          </span>
        )}
      </div>

      {/* Name */}
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

      {/* Divider */}
      <div style={{ width: 36, height: 2, background: accent, opacity: isLive ? 1 : 0.4, margin: "0 auto 12px", borderRadius: 2 }} />

      {/* Reward token */}
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

      {/* CTA */}
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

  const handleSelect = async (chain) => {
    setError("");
    setSwitchingKey(chain.key);
    try {
      // Always attempt to add/switch the chain in MetaMask first — whether
      // connected or not. This ensures MetaMask is already on the correct
      // chain before AppKit's wallet-connect flow runs, preventing AppKit
      // from defaulting to BOTChain (wagmiNetworks[0]) on first visit.
      if (window.ethereum) {
        const chainIdHex = "0x" + chain.chainId.toString(16);
        try {
          // Try switching first (works if chain already added)
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: chainIdHex }],
          });
        } catch (switchErr) {
          // 4902 = chain not added yet — add it
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

      // If already connected via wagmi, also switch through wagmi so
      // useAccount()/useChainId() hooks update correctly
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
        justifyContent: "center",
        padding: 24,
        overflowY: "auto",
      }}
    >
      <style>{`
        @keyframes chainSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* Background glow */}
      <div
        style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(123,47,255,0.08) 0%, transparent 70%)",
        }}
      />

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 48, position: "relative" }}>
        <div
          style={{
            fontSize: 11, fontFamily: P.raj, fontWeight: 700,
            color: P.purple, letterSpacing: "4px", textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          ArcadeX
        </div>
        <h1
          style={{
            fontFamily: P.orb, fontWeight: 700, fontSize: 44,
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
            fontSize: 14, color: "rgba(255,255,255,0.45)", fontFamily: P.raj,
            margin: "12px 0 0", fontWeight: 500,
          }}
        >
          Select a blockchain to start playing and earning
        </p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 18 }}>
          <div style={{ width: 40, height: 2, background: `linear-gradient(90deg, ${P.purple}, transparent)`, borderRadius: 2 }} />
          <div style={{ width: 4, height: 4, borderRadius: "50%", background: P.purple }} />
          <div style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(123,47,255,0.4)" }} />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            marginBottom: 28, padding: "10px 20px", borderRadius: 8,
            background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.25)",
            color: "#ff8080", fontFamily: P.raj, fontSize: 13, fontWeight: 600,
            maxWidth: 420, textAlign: "center", position: "relative",
          }}
        >
          {error}
        </div>
      )}

      {/* Chain cards */}
      <div
        style={{
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
          justifyContent: "center",
          maxWidth: 900,
          position: "relative",
          marginBottom: 40,
        }}
      >
        {allChains.map((chain) => (
          <ChainCard
            key={chain.key}
            chain={chain}
            onSelect={handleSelect}
            isSwitching={switchingKey === chain.key}
          />
        ))}
      </div>

      {/* Feature strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 20,
          width: "100%",
          maxWidth: 1000,
          padding: "24px 32px",
          borderRadius: 16,
          border: `1px solid ${P.border}`,
          background: "rgba(255,255,255,0.02)",
          position: "relative",
        }}
      >
        {FEATURES.map((f) => (
          <div key={f.title} style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(123,47,255,0.1)", border: `1px solid ${P.purple}33`,
                fontSize: 18,
              }}
            >
              {f.icon}
            </div>
            <div>
              <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 14, color: "#fff" }}>{f.title}</div>
              <div style={{ fontFamily: P.raj, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{f.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}