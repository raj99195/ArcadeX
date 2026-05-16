// components/SendTx.jsx
import { useInterwovenKit } from "@initia/interwovenkit-react";
import { useState } from "react";
import { calculateFee, GasPrice } from "@cosmjs/stargate"; // 👈 install: npm i @cosmjs/stargate

const CHAIN_ID = "initiation-2";

export default function SendTx() {
  // 👇 submitTxBlock + estimateGas — requestTxBlock hatao
  const { submitTxBlock, estimateGas, address, isConnected, autoSign } = useInterwovenKit();

  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState("");

  const handleSend = async () => {
    if (!isConnected || !address) {
      alert("Wallet not connected");
      return;
    }

    // 👇 Check karo auto-sign enabled hai ya nahi
    if (!autoSign.isEnabledByChain[CHAIN_ID]) {
      alert("Pehle Auto-sign enable karo 👆");
      return;
    }

    setLoading(true);
    try {
      const messages = [
        {
          typeUrl: "/cosmos.bank.v1beta1.MsgSend",
          value: {
            fromAddress: address,
            toAddress: address, // self transfer (test)
            amount: [{ denom: "uinit", amount: "1000" }],
          },
        },
      ];

      // 👇 Gas estimate karo
      const gasEstimate = await estimateGas({ messages });
      const fee = calculateFee(
        Math.ceil(gasEstimate * 1.4),       // 40% buffer
        GasPrice.fromString("0.015uinit")
      );

      // 👇 submitTxBlock = NO POPUP, auto sign ✅
      const { transactionHash } = await submitTxBlock({ messages, fee });

      console.log("TX SUCCESS:", transactionHash);
      setTxHash(transactionHash);
      alert("TX DONE ✅");

    } catch (err) {
      console.error("FULL ERROR:", err);
      alert("TX FAILED ❌");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: "20px" }}>
      <h3>⚡ Initia Auto-Sign Transaction</h3>

      {/* Auto-sign status dikhao */}
      <p style={{ fontSize: "13px", color: autoSign.isEnabledByChain[CHAIN_ID] ? "green" : "gray" }}>
        Auto-sign: {autoSign.isEnabledByChain[CHAIN_ID] ? "✅ Ready" : "❌ Not enabled"}
      </p>

      <button onClick={handleSend} disabled={loading || !autoSign.isEnabledByChain[CHAIN_ID]}>
        {loading ? "Processing..." : "Send Transaction (Auto-Sign)"}
      </button>

      {txHash && (
        <p style={{ fontSize: "12px", wordBreak: "break-all" }}>
          ✅ Tx Hash: {txHash}
        </p>
      )}
    </div>
  );
}