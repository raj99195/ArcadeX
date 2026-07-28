// src/pages/ChainLanding.jsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useChain } from "../context/ChainContext";

export default function ChainLanding({ chainKey }) {
  const { setChainKey, allChains } = useChain();
  const navigate = useNavigate();

  useEffect(() => {
    const chain = allChains.find(c => c.key === chainKey);
    if (chain && chain.status === "live") {
      setChainKey(chainKey);      // MST set karo
    }
    navigate("/", { replace: true }); // Home pe bhejo
  }, []);

  // Loading flash
  return (
    <div style={{ minHeight: "100vh", background: "#08070f", display: "flex",
      alignItems: "center", justifyContent: "center", color: "#7B2FFF",
      fontFamily: "'Rajdhani', sans-serif", fontSize: 14, letterSpacing: "2px" }}>
      Entering MST Blockchain...
    </div>
  );
}