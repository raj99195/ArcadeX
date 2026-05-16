import { useAccount } from "wagmi";
import { useInterwovenKit } from "@initia/interwovenkit-react";

export default function ConnectButton() {
  const { isConnected, address } = useAccount();
  const { openConnect, openWallet } = useInterwovenKit();

  return (
    <div>
      {isConnected ? (
        <>
          <p>✅ {address}</p>
          <button onClick={openWallet}>
            Open Wallet
          </button>
        </>
      ) : (
        <button onClick={openConnect}>
          🔗 Connect Wallet
        </button>
      )}
    </div>
  );
}