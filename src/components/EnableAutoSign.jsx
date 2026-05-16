// src/components/EnableAutoSign.jsx
import { useInterwovenKit } from "@initia/interwovenkit-react";
import { useMutation } from "@tanstack/react-query";

const CHAIN_ID = import.meta.env.VITE_CHAIN_ID || "initiation-2";
const P = { raj: "'Rajdhani',sans-serif" };

export default function EnableAutoSign() {
  const { autoSign, address, initiaAddress } = useInterwovenKit();

  const enable = useMutation({
    mutationFn: () => autoSign.enable(CHAIN_ID),
    onError: (err) => console.error("Enable failed:", err),
  });

  const disable = useMutation({
    mutationFn: () => autoSign.disable(CHAIN_ID),
    onError: (err) => console.error("Disable failed:", err),
  });

  if (!address && !initiaAddress) return null;
  if (autoSign?.isLoading) return null;

  const isEnabled = autoSign?.isEnabledByChain?.[CHAIN_ID];

  if (isEnabled) {
    const expiry = autoSign?.expiredAtByChain?.[CHAIN_ID];
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 16px",
        background: "rgba(0,255,136,0.06)",
        border: "1px solid rgba(0,255,136,0.2)",
        borderRadius: 8, fontSize: 12,
      }}>
        <span style={{ color: "#00FF88", fontFamily: P.raj, fontWeight: 700 }}>
          ⚡ Auto-sign active
        </span>
        {expiry && (
          <span style={{ color: "#5533aa", fontFamily: P.raj, fontSize: 10 }}>
            Expires: {new Date(expiry).toLocaleString()}
          </span>
        )}
        <button onClick={() => disable.mutate()} disabled={disable.isPending}
          style={{
            padding: "4px 10px", background: "transparent",
            border: "1px solid rgba(255,68,68,0.3)", borderRadius: 6,
            color: "#ff4444", fontSize: 11, cursor: "pointer",
            fontFamily: P.raj, fontWeight: 700,
          }}>
          {disable.isPending ? "Revoking..." : "Revoke"}
        </button>
      </div>
    );
  }

  return (
    <button onClick={() => enable.mutate()} disabled={enable.isPending}
      style={{
        padding: "10px 20px",
        background: enable.isPending ? "rgba(123,47,255,0.2)" : "linear-gradient(135deg,#7B2FFF,#5a1fd4)",
        border: "none", borderRadius: 8,
        color: enable.isPending ? "#5533aa" : "#fff",
        fontSize: 13, cursor: enable.isPending ? "not-allowed" : "pointer",
        fontFamily: P.raj, fontWeight: 700,
        letterSpacing: "0.5px", textTransform: "uppercase",
      }}>
      {enable.isPending ? "Setting up..." : "⚡ Enable Auto-sign"}
    </button>
  );
}